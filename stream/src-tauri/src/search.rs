use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use tantivy::{
    collector::TopDocs, doc, query::QueryParser, schema::*, Index, IndexWriter,
};
use regex::Regex;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
    pub file_path: String,
    pub line_number: u64,
    pub char_start: usize,
    pub char_end: usize,
    pub context_snippet: String,
    pub score: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResults {
    pub matches: Vec<SearchMatch>,
    pub total_results: usize,
    pub search_time_ms: u64,
}

// Compile regex once on first use for efficient reuse
static DATE_FILENAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{4})-(\d{2})-(\d{2})\.md$").expect("Failed to compile date filename regex")
});

// Global index cache to avoid recreating indices
static INDEX_CACHE: LazyLock<Mutex<HashMap<String, Arc<Index>>>> = LazyLock::new(|| {
    Mutex::new(HashMap::new())
});

// Mutex per folder to prevent concurrent sync operations
static SYNC_LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = LazyLock::new(|| {
    Mutex::new(HashMap::new())
});

// Track last sync time per folder to avoid frequent syncs
static LAST_SYNC_TIME: LazyLock<Mutex<HashMap<String, std::time::Instant>>> = LazyLock::new(|| {
    Mutex::new(HashMap::new())
});

// Search index schema
fn create_search_schema() -> Schema {
    let mut schema_builder = Schema::builder();
    schema_builder.add_text_field("file_path", STRING | STORED);
    schema_builder.add_text_field("line_content", TEXT | STORED);
    schema_builder.add_u64_field("line_number", STORED | INDEXED);
    schema_builder.add_u64_field("modified_at", STORED | INDEXED);
    schema_builder.build()
}

// Generate a hash-based directory name for a folder path
fn hash_folder_path(folder_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(folder_path.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", result)
}

// Get or create the index for a specific folder
fn get_or_create_index(
    folder_path: &str,
    app_data_dir: &Path,
) -> Result<Arc<Index>, Box<dyn std::error::Error>> {
    let folder_hash = hash_folder_path(folder_path);

    // Check cache first
    {
        let cache = INDEX_CACHE.lock().unwrap();
        if let Some(index) = cache.get(&folder_hash) {
            return Ok(Arc::clone(index));
        }
    }

    // Create index directory
    let index_dir = app_data_dir.join("search_indices").join(&folder_hash);
    fs::create_dir_all(&index_dir)?;

    let schema = create_search_schema();
    let index = if index_dir.join("meta.json").exists() {
        // Open existing index
        Index::open_in_dir(&index_dir)?
    } else {
        // Create new index
        Index::create_in_dir(&index_dir, schema)?
    };

    let arc_index = Arc::new(index);

    // Store in cache
    {
        let mut cache = INDEX_CACHE.lock().unwrap();
        cache.insert(folder_hash, Arc::clone(&arc_index));
    }

    Ok(arc_index)
}

// Sync the index with the current state of markdown files
fn sync_index(folder_path: &str, index: &Index) -> Result<(), Box<dyn std::error::Error>> {
    let schema = index.schema();
    let file_path_field = schema.get_field("file_path").unwrap();
    let line_content_field = schema.get_field("line_content").unwrap();
    let line_number_field = schema.get_field("line_number").unwrap();
    let modified_at_field = schema.get_field("modified_at").unwrap();

    // Get all markdown files from the folder
    let mut files = Vec::new();
    fn visit_dir(
        dir: &Path,
        files: &mut Vec<(String, u64)>,
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
                if let Some(extension) = path.extension() {
                    if extension.to_string_lossy().to_lowercase() == "md" {
                        let file_name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown");

                        // Only process files that match YYYY-MM-DD.md pattern
                        if date_regex.is_match(file_name) {
                            if let Ok(metadata) = entry.metadata() {
                                let modified_at = metadata
                                    .modified()
                                    .unwrap_or_else(|_| std::time::SystemTime::now())
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64;

                                files.push((path.to_string_lossy().to_string(), modified_at));
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    visit_dir(Path::new(folder_path), &mut files, &DATE_FILENAME_REGEX)?;

    // Create a map of current files for quick lookup
    let current_files: HashMap<String, u64> = files.iter().cloned().collect();

    // Get index reader to check existing documents
    let reader = index.reader()?;
    let searcher = reader.searcher();

    // Build a set of indexed files with their modified_at times
    let mut indexed_files: HashMap<String, u64> = HashMap::new();
    for segment_reader in searcher.segment_readers() {
        let store_reader = segment_reader.get_store_reader(0)?;
        for doc_id in 0..segment_reader.num_docs() {
            let doc: BTreeMap<Field, OwnedValue> = store_reader.get(doc_id)?;
            if let Some(file_path_value) = doc.get(&file_path_field) {
                if let Some(file_path_str) = file_path_value.as_str() {
                    if let Some(modified_value) = doc.get(&modified_at_field) {
                        if let Some(modified_at) = modified_value.as_u64() {
                            indexed_files.insert(file_path_str.to_string(), modified_at);
                        }
                    }
                }
            }
        }
    }

    // Determine what needs to be updated
    let mut files_to_add = Vec::new();
    let mut files_to_remove = Vec::new();

    // Check for new or modified files
    for (file_path, modified_at) in &current_files {
        if let Some(&indexed_modified) = indexed_files.get(file_path) {
            if *modified_at != indexed_modified {
                // File has been modified
                files_to_remove.push(file_path.clone());
                files_to_add.push((file_path.clone(), *modified_at));
            }
        } else {
            // New file
            files_to_add.push((file_path.clone(), *modified_at));
        }
    }

    // Check for deleted files
    for file_path in indexed_files.keys() {
        if !current_files.contains_key(file_path) {
            files_to_remove.push(file_path.clone());
        }
    }

    // If there are changes, update the index
    if !files_to_add.is_empty() || !files_to_remove.is_empty() {
        let mut index_writer: IndexWriter = index.writer(50_000_000)?; // 50MB buffer

        // Remove outdated documents
        for file_path in files_to_remove {
            let term = Term::from_field_text(file_path_field, &file_path);
            index_writer.delete_term(term);
        }

        // Add new/updated documents
        for (file_path, modified_at) in files_to_add {
            // Read file content
            if let Ok(content) = fs::read_to_string(&file_path) {
                // Index each line separately
                for (line_idx, line) in content.lines().enumerate() {
                    if !line.trim().is_empty() {
                        // Skip empty lines
                        let doc = doc!(
                            file_path_field => file_path.as_str(),
                            line_content_field => line,
                            line_number_field => (line_idx + 1) as u64,
                            modified_at_field => modified_at
                        );
                        index_writer.add_document(doc)?;
                    }
                }
            }
        }

        index_writer.commit()?;
    }

    Ok(())
}

// Search the index and return formatted results
fn search_index(
    index: &Index,
    query_str: &str,
    limit: usize,
    sort_by_date: bool,
) -> Result<SearchResults, Box<dyn std::error::Error>> {
    let start_time = std::time::Instant::now();

    let schema = index.schema();
    let line_content_field = schema.get_field("line_content").unwrap();
    let file_path_field = schema.get_field("file_path").unwrap();
    let line_number_field = schema.get_field("line_number").unwrap();

    let reader = index.reader()?;
    let searcher = reader.searcher();

    // Parse query
    let query_parser = QueryParser::for_index(index, vec![line_content_field]);
    let query = query_parser.parse_query(query_str)?;

    // Execute search
    let top_docs = searcher.search(&query, &TopDocs::with_limit(limit))?;

    let mut matches = Vec::new();
    let query_terms: Vec<String> = query_str
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    for (_score, doc_address) in top_docs {
        let retrieved_doc: BTreeMap<Field, OwnedValue> = searcher.doc(doc_address)?;

        let file_path = retrieved_doc
            .get(&file_path_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let line_content = retrieved_doc
            .get(&line_content_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let line_number = retrieved_doc
            .get(&line_number_field)
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // Find character positions of matches in the line (using char indices, not byte indices)
        let line_lower = line_content.to_lowercase();
        let mut match_positions = Vec::new();

        // Convert to char indices for safe slicing
        let char_indices: Vec<(usize, char)> = line_content.char_indices().collect();
        let line_lower_chars: Vec<char> = line_lower.chars().collect();

        for term in &query_terms {
            let term_chars: Vec<char> = term.chars().collect();
            if term_chars.is_empty() {
                continue;
            }

            let mut i = 0;
            while i + term_chars.len() <= line_lower_chars.len() {
                // Check if term matches at position i
                if line_lower_chars[i..i + term_chars.len()] == term_chars[..] {
                    // Found a match - store both char index and byte positions
                    let byte_start = char_indices.get(i).map(|(byte_idx, _)| *byte_idx).unwrap_or(0);
                    let byte_end = char_indices
                        .get(i + term_chars.len())
                        .map(|(byte_idx, _)| *byte_idx)
                        .unwrap_or(line_content.len());
                    // Store as (char_idx_start, char_idx_end, byte_start, byte_end)
                    match_positions.push((i, i + term_chars.len(), byte_start, byte_end));
                    i += term_chars.len();
                } else {
                    i += 1;
                }
            }
        }

        // Use the first match position or default to start of line
        let (match_char_idx_start, match_char_idx_end) =
            if let Some(&(char_start, char_end, _, _)) = match_positions.first() {
                (char_start, char_end)
            } else {
                (0, char_indices.len().min(50))
            };

        // Create context snippet (surrounding context) - safely using char boundaries
        let context_start_char_idx = match_char_idx_start.saturating_sub(50);
        let context_end_char_idx = (match_char_idx_end + 50).min(char_indices.len());

        let context_start_byte = char_indices
            .get(context_start_char_idx)
            .map(|(idx, _)| *idx)
            .unwrap_or(0);
        let context_end_byte = char_indices
            .get(context_end_char_idx)
            .map(|(idx, _)| *idx)
            .unwrap_or(line_content.len());

        let context_snippet = line_content[context_start_byte..context_end_byte].to_string();

        let snippet_chars: Vec<char> = context_snippet.chars().collect();
        let relative_match_start = match_char_idx_start.saturating_sub(context_start_char_idx);
        let relative_match_end = match_char_idx_end.saturating_sub(context_start_char_idx);

        // Count UTF-16 code units up to each position
        let utf16_start = snippet_chars
            .iter()
            .take(relative_match_start)
            .map(|c| c.len_utf16())
            .sum::<usize>();
        let utf16_end = snippet_chars
            .iter()
            .take(relative_match_end)
            .map(|c| c.len_utf16())
            .sum::<usize>();

        matches.push(SearchMatch {
            file_path,
            line_number,
            char_start: utf16_start,
            char_end: utf16_end,
            context_snippet,
            score: _score,
        });
    }

    // Sort by date if requested (newest first)
    if sort_by_date {
        matches.sort_by(|a, b| {
            let extract_date = |path: &str| -> Option<String> {
                let file_name = Path::new(path).file_name()?.to_str()?;
                if DATE_FILENAME_REGEX.is_match(file_name) {
                    // Extract YYYY-MM-DD from filename
                    Some(file_name[0..10].to_string())
                } else {
                    None
                }
            };

            let date_a = extract_date(&a.file_path);
            let date_b = extract_date(&b.file_path);

            // Sort in descending order (newest first)
            match (date_a, date_b) {
                (Some(a), Some(b)) => b.cmp(&a),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
    }

    let search_time_ms = start_time.elapsed().as_millis() as u64;

    Ok(SearchResults {
        total_results: matches.len(),
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
    app_handle: tauri::AppHandle,
) -> Result<SearchResults, String> {
    let limit = limit.unwrap_or(100);

    // Get app data directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Get or create index
    let index = get_or_create_index(&folder_path, &app_data_dir)
        .map_err(|e| format!("Failed to get or create index: {}", e))?;

    // Get or create sync lock for this folder
    let folder_hash = hash_folder_path(&folder_path);
    let sync_lock = {
        let mut locks = SYNC_LOCKS.lock().unwrap();
        locks
            .entry(folder_hash.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };

    // Try to acquire sync lock (non-blocking)
    if let Ok(_guard) = sync_lock.try_lock() {
        // We got the lock! Check if we need to sync
        let should_sync = {
            let last_sync = LAST_SYNC_TIME.lock().unwrap();

            if let Some(last_time) = last_sync.get(&folder_hash) {
                // Sync if more than 5 seconds have passed
                last_time.elapsed().as_secs() >= 5
            } else {
                // First sync for this folder
                true
            }
        };

        if should_sync {
            // Sync index with current files
            sync_index(&folder_path, &index)
                .map_err(|e| format!("Failed to sync index: {}", e))?;

            // Update last sync time
            let mut last_sync = LAST_SYNC_TIME.lock().unwrap();
            last_sync.insert(folder_hash, std::time::Instant::now());
        }
    }
    // If we couldn't get the lock, another sync is in progress - skip it and just search

    // Search
    let sort_by_date = sort_by_date.unwrap_or(false);
    let results = search_index(&index, &query, limit, sort_by_date)
        .map_err(|e| format!("Search failed: {}", e))?;

    Ok(results)
}

#[tauri::command]
pub async fn rebuild_search_index(
    folder_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let folder_hash = hash_folder_path(&folder_path);
    let index_dir = app_data_dir.join("search_indices").join(&folder_hash);

    // Remove from caches
    {
        let mut cache = INDEX_CACHE.lock().unwrap();
        cache.remove(&folder_hash);

        let mut locks = SYNC_LOCKS.lock().unwrap();
        locks.remove(&folder_hash);

        let mut last_sync = LAST_SYNC_TIME.lock().unwrap();
        last_sync.remove(&folder_hash);
    }

    // Delete the index directory
    if index_dir.exists() {
        fs::remove_dir_all(&index_dir)
            .map_err(|e| format!("Failed to delete index directory: {}", e))?;
    }

    // Recreate the index
    let index = get_or_create_index(&folder_path, &app_data_dir)
        .map_err(|e| format!("Failed to recreate index: {}", e))?;

    // Recreate the sync lock for this folder
    let sync_lock = {
        let mut locks = SYNC_LOCKS.lock().unwrap();
        let new_lock = Arc::new(Mutex::new(()));
        locks.insert(folder_hash.clone(), new_lock.clone());
        new_lock
    };

    // Acquire lock and sync to populate the new index
    let _guard = sync_lock.lock().unwrap();
    sync_index(&folder_path, &index)
        .map_err(|e| format!("Failed to populate new index: {}", e))?;

    // Update last sync time
    {
        let mut last_sync = LAST_SYNC_TIME.lock().unwrap();
        last_sync.insert(folder_hash, std::time::Instant::now());
    }

    Ok(())
}

