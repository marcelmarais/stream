use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
    pub file_path: String,
    pub line_number: u64,
    pub match_ranges: Vec<(usize, usize)>, // Vec of (start, end) UTF-16 positions
    pub context_snippet: String,
    pub score: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResults {
    pub matches: Vec<SearchMatch>,
    pub total_results: usize,
    pub search_time_ms: u64,
}

// Compile regex once for efficient reuse
static DATE_FILENAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{4})-(\d{2})-(\d{2})\.md$").expect("Failed to compile date filename regex")
});

// Find all markdown files matching YYYY-MM-DD.md pattern
fn find_markdown_files(folder_path: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut files = Vec::new();

    fn visit_dir(
        dir: &Path,
        files: &mut Vec<String>,
        date_regex: &Regex,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !dir.is_dir() {
            return Ok(());
        }

        let entries = fs::read_dir(dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                visit_dir(&path, files, date_regex)?;
            } else if path.is_file() {
                // Quick extension check - case sensitive for performance
                if let Some(extension) = path.extension() {
                    if extension == "md" {
                        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                            // Only process files that match YYYY-MM-DD.md pattern
                            if date_regex.is_match(file_name) {
                                files.push(path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    visit_dir(Path::new(folder_path), &mut files, &DATE_FILENAME_REGEX)?;
    Ok(files)
}

// Tokenize query into terms (split on whitespace and punctuation)
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

// Combined matching and position finding - single pass optimization
// Returns None if no match, or Some with match positions if matched
fn match_and_find_positions(
    line: &str,
    query_terms: &[String],
) -> Option<Vec<(usize, usize, usize, usize)>> {
    if query_terms.is_empty() {
        return None;
    }

    let line_lower = line.to_lowercase();
    let char_indices: Vec<(usize, char)> = line.char_indices().collect();
    let line_lower_chars: Vec<char> = line_lower.chars().collect();

    // Pre-convert all query terms to char vectors once
    let query_term_chars: Vec<Vec<char>> = query_terms
        .iter()
        .map(|term| term.chars().collect())
        .collect();

    // Track which terms we've found for matching check
    let mut terms_found = vec![false; query_terms.len()];
    let mut match_positions = Vec::new();

    // Single pass through the line to find all matches
    for (term_idx, term_chars) in query_term_chars.iter().enumerate() {
        if term_chars.is_empty() {
            terms_found[term_idx] = true;
            continue;
        }

        let is_last_term = term_idx == query_terms.len() - 1;
        let mut i = 0;

        while i < line_lower_chars.len() {
            // Check if we're at a word boundary (start of line or after whitespace/punctuation)
            let at_word_boundary = i == 0
                || line_lower_chars[i - 1].is_whitespace()
                || line_lower_chars[i - 1].is_ascii_punctuation();

            // Only attempt match if we're at a word boundary
            let match_len = if !at_word_boundary {
                None
            } else if is_last_term {
                // Prefix match: find words starting with this term (at word boundary)
                if i + term_chars.len() <= line_lower_chars.len()
                    && line_lower_chars[i..i + term_chars.len()] == term_chars[..]
                {
                    // Found prefix match - extend to end of word
                    let mut end = i + term_chars.len();
                    while end < line_lower_chars.len()
                        && !line_lower_chars[end].is_whitespace()
                        && !line_lower_chars[end].is_ascii_punctuation()
                    {
                        end += 1;
                    }
                    Some(end - i)
                } else {
                    None
                }
            } else {
                // Exact word match: must match full word at word boundary
                if i + term_chars.len() <= line_lower_chars.len()
                    && line_lower_chars[i..i + term_chars.len()] == term_chars[..]
                {
                    // Check that match ends at word boundary too (complete word)
                    let end = i + term_chars.len();
                    let at_end_boundary = end >= line_lower_chars.len()
                        || line_lower_chars[end].is_whitespace()
                        || line_lower_chars[end].is_ascii_punctuation();

                    if at_end_boundary {
                        Some(term_chars.len())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            if let Some(len) = match_len {
                terms_found[term_idx] = true;
                let byte_start = char_indices
                    .get(i)
                    .map(|(byte_idx, _)| *byte_idx)
                    .unwrap_or(0);
                let byte_end = char_indices
                    .get(i + len)
                    .map(|(byte_idx, _)| *byte_idx)
                    .unwrap_or(line.len());
                // (char_start, char_end, byte_start, byte_end)
                match_positions.push((i, i + len, byte_start, byte_end));
                i += len;
            } else {
                i += 1;
            }
        }
    }

    // Check if all terms were found
    if terms_found.iter().all(|&found| found) {
        Some(match_positions)
    } else {
        None
    }
}

// Process a single file and return all matches
fn search_file(file_path: &str, query_terms: &[String]) -> Vec<SearchMatch> {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(), // Skip files we can't read
    };

    let mut file_matches = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        // Combined matching and position finding in single pass
        let match_positions = match match_and_find_positions(line, query_terms) {
            Some(positions) => positions,
            None => continue, // Line doesn't match, skip it
        };

        let line_number = (line_idx + 1) as u64;

        // Create context snippet around first match
        let first_match_start = match_positions
            .first()
            .map(|(char_start, _, _, _)| *char_start)
            .unwrap_or(0);

        let char_indices: Vec<(usize, char)> = line.char_indices().collect();
        let context_start_char_idx = first_match_start.saturating_sub(50);
        let context_end_char_idx = (first_match_start + 100).min(char_indices.len());

        let context_start_byte = char_indices
            .get(context_start_char_idx)
            .map(|(idx, _)| *idx)
            .unwrap_or(0);
        let context_end_byte = char_indices
            .get(context_end_char_idx)
            .map(|(idx, _)| *idx)
            .unwrap_or(line.len());

        let context_snippet = &line[context_start_byte..context_end_byte];

        // Convert match positions to UTF-16 offsets relative to snippet
        let mut utf16_ranges = Vec::with_capacity(match_positions.len());

        // Build UTF-16 position map incrementally to avoid repeated iteration
        let mut utf16_pos = 0;
        let mut utf16_map = Vec::with_capacity(context_snippet.chars().count());

        for ch in context_snippet.chars() {
            utf16_map.push(utf16_pos);
            utf16_pos += ch.len_utf16();
        }
        utf16_map.push(utf16_pos); // Final position

        for &(match_char_start, match_char_end, _, _) in &match_positions {
            if match_char_start >= context_start_char_idx && match_char_start < context_end_char_idx
            {
                let relative_start = match_char_start.saturating_sub(context_start_char_idx);
                let relative_end = match_char_end
                    .saturating_sub(context_start_char_idx)
                    .min(utf16_map.len().saturating_sub(1));

                if relative_start < utf16_map.len() && relative_end < utf16_map.len() {
                    utf16_ranges.push((utf16_map[relative_start], utf16_map[relative_end]));
                }
            }
        }

        // Simple scoring: more matches = higher score
        let score = match_positions.len() as f32;

        file_matches.push(SearchMatch {
            file_path: file_path.to_string(),
            line_number,
            match_ranges: utf16_ranges,
            context_snippet: context_snippet.to_string(),
            score,
        });
    }

    file_matches
}

// Search through files and return matches (parallel processing)
fn search_files(
    files: &[String],
    query_str: &str,
    limit: usize,
    sort_by_date: bool,
) -> Result<SearchResults, Box<dyn std::error::Error>> {
    let start_time = std::time::Instant::now();
    let query_terms = tokenize(query_str);

    if query_terms.is_empty() {
        return Ok(SearchResults {
            matches: vec![],
            total_results: 0,
            search_time_ms: 0,
        });
    }

    // Process all files in parallel and collect matches
    let mut matches: Vec<SearchMatch> = files
        .par_iter()
        .flat_map(|file_path| search_file(file_path, &query_terms))
        .collect();

    // Sort by date if requested (newest first), otherwise by score
    if sort_by_date {
        matches.sort_by(|a, b| {
            // Extract YYYY-MM-DD directly from path (we know files match the pattern)
            let get_date_from_path = |path: &str| -> Option<[u8; 10]> {
                let file_name = Path::new(path).file_name()?.to_str()?;
                // Files matching YYYY-MM-DD.md pattern have date at start
                if file_name.len() >= 10 {
                    let mut date = [0u8; 10];
                    date.copy_from_slice(file_name[0..10].as_bytes());
                    Some(date)
                } else {
                    None
                }
            };

            let date_a = get_date_from_path(&a.file_path);
            let date_b = get_date_from_path(&b.file_path);

            match (date_a, date_b) {
                (Some(a), Some(b)) => b.cmp(&a), // Descending order (newest first)
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
    } else {
        // Sort by score (highest first)
        matches.sort_unstable_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    // Apply limit after sorting
    let total_results = matches.len();
    matches.truncate(limit);

    let search_time_ms = start_time.elapsed().as_millis() as u64;

    Ok(SearchResults {
        total_results,
        matches,
        search_time_ms,
    })
}

#[tauri::command]
pub async fn search_markdown_files(
    folder_path: String,
    query: String,
    limit: Option<usize>,
    sort_by_date: Option<bool>,
) -> Result<SearchResults, String> {
    let limit = limit.unwrap_or(100);
    let sort_by_date = sort_by_date.unwrap_or(false);

    // Find all markdown files
    let files = find_markdown_files(&folder_path)
        .map_err(|e| format!("Failed to find markdown files: {}", e))?;

    // Search through files
    let results = search_files(&files, &query, limit, sort_by_date)
        .map_err(|e| format!("Search failed: {}", e))?;

    Ok(results)
}

#[tauri::command]
pub async fn rebuild_search_index(_folder_path: String) -> Result<(), String> {
    // No-op: grep-based search doesn't use an index
    // Keeping this command for API compatibility
    Ok(())
}
