use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Arc, Mutex};
use std::collections::{HashMap, BTreeMap};
use git2::{Repository, Time};
use chrono::{DateTime, Utc, NaiveDate};
use xattr;
use regex::Regex;
use sha2::{Sha256, Digest};
use tantivy::{Index, IndexWriter, schema::*, collector::TopDocs, query::QueryParser, doc};

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64, // Unix timestamp in milliseconds
    pub modified_at: u64, // Unix timestamp in milliseconds
    pub size: u64,
    pub country: Option<String>, // Location country from xattrs
    pub city: Option<String>,    // Location city from xattrs
    pub date_from_filename: u64, // Date from filename as Unix timestamp (midnight UTC)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommit {
    pub id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: u64, // Unix timestamp in milliseconds
    pub date: String, // ISO 8601 date string
    pub repo_path: String,
    pub files_changed: Vec<String>,
    pub branches: Vec<String>, // Branches that contain this commit
    pub url: Option<String>, // URL to commit on remote (if available)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoCommits {
    pub repo_path: String,
    pub commits: Vec<GitCommit>,
    pub error: Option<String>,
}

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
fn get_or_create_index(folder_path: &str, app_data_dir: &Path) -> Result<Arc<Index>, Box<dyn std::error::Error>> {
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
    fn visit_dir(dir: &Path, files: &mut Vec<(String, u64)>) -> Result<(), Box<dyn std::error::Error>> {
        if !dir.is_dir() {
            return Ok(());
        }
        
        let entries = fs::read_dir(dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                visit_dir(&path, files)?;
            } else if path.is_file() {
                if let Some(extension) = path.extension() {
                    if extension.to_string_lossy().to_lowercase() == "md" {
                        let file_name = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown");
                        
                        // Only process files that match YYYY-MM-DD.md pattern
                        if DATE_FILENAME_REGEX.is_match(file_name) {
                            if let Ok(metadata) = entry.metadata() {
                                let modified_at = metadata.modified()
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
    
    visit_dir(Path::new(folder_path), &mut files)?;
    
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
                    if !line.trim().is_empty() { // Skip empty lines
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
fn search_index(index: &Index, query_str: &str, limit: usize) -> Result<SearchResults, Box<dyn std::error::Error>> {
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
    let query_terms: Vec<String> = query_str.to_lowercase().split_whitespace()
        .map(|s| s.to_string())
        .collect();
    
    for (_score, doc_address) in top_docs {
        let retrieved_doc: BTreeMap<Field, OwnedValue> = searcher.doc(doc_address)?;
        
        let file_path = retrieved_doc.get(&file_path_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        
        let line_content = retrieved_doc.get(&line_content_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        
        let line_number = retrieved_doc.get(&line_number_field)
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
                    let byte_end = char_indices.get(i + term_chars.len())
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
        
        let context_start_byte = char_indices.get(context_start_char_idx)
            .map(|(idx, _)| *idx)
            .unwrap_or(0);
        let context_end_byte = char_indices.get(context_end_char_idx)
            .map(|(idx, _)| *idx)
            .unwrap_or(line_content.len());
        
        let context_snippet = line_content[context_start_byte..context_end_byte].to_string();
        
        // Convert character indices to UTF-16 code unit positions for JavaScript
        // JavaScript uses UTF-16, where some characters (like emojis) take 2 code units
        let snippet_chars: Vec<char> = context_snippet.chars().collect();
        let relative_match_start = match_char_idx_start.saturating_sub(context_start_char_idx);
        let relative_match_end = match_char_idx_end.saturating_sub(context_start_char_idx);
        
        // Count UTF-16 code units up to each position
        let utf16_start = snippet_chars.iter()
            .take(relative_match_start)
            .map(|c| c.len_utf16())
            .sum::<usize>();
        let utf16_end = snippet_chars.iter()
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
    
    let search_time_ms = start_time.elapsed().as_millis() as u64;
    
    Ok(SearchResults {
        total_results: matches.len(),
        matches,
        search_time_ms,
    })
}

// Helper functions for xattr operations
const XATTR_COUNTRY_KEY: &str = "user.location.country";
const XATTR_CITY_KEY: &str = "user.location.city";

fn read_location_xattrs(file_path: &Path) -> (Option<String>, Option<String>) {
    let country = xattr::get(file_path, XATTR_COUNTRY_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok());
    
    let city = xattr::get(file_path, XATTR_CITY_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok());
    
    (country, city)
}

fn write_location_xattrs(file_path: &Path, country: &str, city: &str) -> Result<(), Box<dyn std::error::Error>> {
    xattr::set(file_path, XATTR_COUNTRY_KEY, country.as_bytes())?;
    xattr::set(file_path, XATTR_CITY_KEY, city.as_bytes())?;
    Ok(())
}

// Helper function to validate and parse date from filename (YYYY-MM-DD.md)
// Returns Unix timestamp in milliseconds for the date at midnight UTC
fn parse_date_from_filename(file_name: &str) -> Option<u64> {
    // Use the pre-compiled regex for efficiency
    let caps = DATE_FILENAME_REGEX.captures(file_name)?;
    
    let year: i32 = caps.get(1)?.as_str().parse().ok()?;
    let month: u32 = caps.get(2)?.as_str().parse().ok()?;
    let day: u32 = caps.get(3)?.as_str().parse().ok()?;
    
    // Validate date is actually valid (chrono will return None for invalid dates like 2025-02-30)
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    
    // Convert to midnight UTC timestamp in milliseconds
    let datetime = date.and_hms_opt(0, 0, 0)?.and_utc();
    let timestamp_ms = datetime.timestamp_millis() as u64;
    
    Some(timestamp_ms)
}

#[tauri::command]
async fn set_file_location_metadata(file_path: String, country: String, city: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    write_location_xattrs(path, &country, &city)
        .map_err(|e| format!("Failed to set location metadata: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn read_markdown_files_content(file_paths: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    use std::collections::HashMap;
    
    let mut results = HashMap::new();
    
    for file_path in file_paths {
        match std::fs::read_to_string(&file_path) {
            Ok(content) => {
                results.insert(file_path, content);
            }
            Err(e) => {
                eprintln!("Error reading file {}: {}", file_path, e);
                // Continue with other files, don't fail the entire operation
            }
        }
    }
    
    Ok(results)
}

#[tauri::command]
async fn read_markdown_files_metadata(directory_path: String, max_file_size: Option<u64>) -> Result<Vec<MarkdownFileMetadata>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024); // 10MB default
    let mut files = Vec::new();
    
    fn visit_dir(dir: &Path, files: &mut Vec<MarkdownFileMetadata>, max_size: u64) -> Result<(), Box<dyn std::error::Error>> {
        if !dir.is_dir() {
            return Ok(());
        }
        
        let entries = fs::read_dir(dir)?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                // Recursively visit subdirectories
                visit_dir(&path, files, max_size)?;
            } else if path.is_file() {
                // Check if it's a markdown file
                if let Some(extension) = path.extension() {
                    if extension.to_string_lossy().to_lowercase() == "md" {
                        let file_name = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        
                        // Only process files that match YYYY-MM-DD.md pattern
                        if let Some(date_timestamp) = parse_date_from_filename(&file_name) {
                            // Get file metadata
                            if let Ok(metadata) = entry.metadata() {
                                let size = metadata.len();
                                
                                // Filter by file size
                                if size <= max_size {
                                    let file_path = path.to_string_lossy().to_string();
                                    
                                    // Convert system time to unix timestamp in milliseconds
                                    let created_at = metadata.created()
                                        .or_else(|_| metadata.modified())
                                        .unwrap_or_else(|_| std::time::SystemTime::now())
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis() as u64;
                                    
                                    let modified_at = metadata.modified()
                                        .unwrap_or_else(|_| std::time::SystemTime::now())
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis() as u64;
                                    
                                    // Read location metadata from xattrs
                                    let (country, city) = read_location_xattrs(&path);
                                    
                                    files.push(MarkdownFileMetadata {
                                        file_path,
                                        file_name,
                                        created_at,
                                        modified_at,
                                        size,
                                        country,
                                        city,
                                        date_from_filename: date_timestamp,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
    
    let dir_path = Path::new(&directory_path);
    if let Err(e) = visit_dir(dir_path, &mut files, max_size) {
        return Err(format!("Error reading directory: {}", e));
    }
    
    // Sort by date from filename (newest first)
    files.sort_by(|a, b| b.date_from_filename.cmp(&a.date_from_filename));
    
    Ok(files)
}

fn time_to_timestamp_ms(time: Time) -> u64 {
    (time.seconds() as u64) * 1000
}

fn time_to_iso_date(time: Time) -> String {
    let timestamp = time.seconds();
    let dt = DateTime::from_timestamp(timestamp, 0).unwrap_or_else(|| Utc::now());
    dt.format("%Y-%m-%d").to_string()
}

fn get_branches_for_commit(repo: &Repository, commit_oid: git2::Oid) -> Result<(Vec<String>, bool), Box<dyn std::error::Error>> {
    let mut all_branches = std::collections::HashSet::new();
    let mut main_branches = std::collections::HashSet::new();
    let mut feature_branches = std::collections::HashSet::new();
    let mut found_on_remote = false;
    
    // Check local branches
    let local_branches = repo.branches(Some(git2::BranchType::Local))?;
    for branch in local_branches {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            let reference = branch.get();
            if let Some(target) = reference.target() {
                let mut revwalk = repo.revwalk()?;
                revwalk.push(target)?;
                
                for oid in revwalk {
                    let oid = oid?;
                    if oid == commit_oid {
                        all_branches.insert(name.to_string());
                        if is_main_branch(name) {
                            main_branches.insert(normalize_branch_name(name));
                        } else {
                            feature_branches.insert(name.to_string());
                        }
                        break;
                    }
                }
            }
        }
    }
    
    // Check remote branches (limit to avoid too many)
    let remote_branches = repo.branches(Some(git2::BranchType::Remote))?;
    for branch in remote_branches {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            let reference = branch.get();
            if let Some(target) = reference.target() {
                let mut revwalk = repo.revwalk()?;
                revwalk.push(target)?;
                
                for oid in revwalk {
                    let oid = oid?;
                    if oid == commit_oid {
                        found_on_remote = true; // Mark that we found it on a remote branch
                        
                        // Only add if we don't already have the local equivalent
                        let normalized = normalize_branch_name(name);
                        if !all_branches.contains(&normalized) {
                            all_branches.insert(name.to_string());
                            if is_main_branch(name) {
                                main_branches.insert(normalized);
                            } else if feature_branches.len() < 3 {
                                feature_branches.insert(name.to_string());
                            }
                        }
                        break;
                    }
                }
            }
        }
    }
    
    let mut result = Vec::new();
    
    // If commit is on main branch, ONLY show main branch (it's been merged)
    if !main_branches.is_empty() {
        // Pick one main branch (prefer local over remote)
        if main_branches.contains("main") {
            result.push("main".to_string());
        } else if main_branches.contains("master") {
            result.push("master".to_string());
        } else if main_branches.contains("develop") {
            result.push("develop".to_string());
        } else {
            result.push(main_branches.iter().next().unwrap().clone());
        }
        // Don't show feature branches if commit is on main - it's been merged
    } else {
        // No main branch, show feature branches (up to 2)
        result.extend(feature_branches.into_iter().take(2));
    }
    
    // If no branches found, return "unknown"
    if result.is_empty() {
        result.push("unknown".to_string());
    }
    
    Ok((result, found_on_remote))
}

fn normalize_branch_name(branch_name: &str) -> String {
    branch_name.replace("origin/", "").replace("refs/heads/", "")
}

fn is_main_branch(branch_name: &str) -> bool {
    let main_branch_names = ["main", "master", "origin/main", "origin/master", "develop", "origin/develop"];
    main_branch_names.contains(&branch_name)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResult {
    pub repo_path: String,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
async fn fetch_repos(repo_paths: Vec<String>) -> Result<Vec<FetchResult>, String> {
    let mut results = Vec::new();
    
    for repo_path in repo_paths {
        let result = match fetch_repo(&repo_path).await {
            Ok(message) => FetchResult {
                repo_path: repo_path.clone(),
                success: true,
                message,
            },
            Err(e) => FetchResult {
                repo_path: repo_path.clone(),
                success: false,
                message: format!("Failed to fetch: {}", e),
            },
        };
        results.push(result);
    }
    
    Ok(results)
}

async fn fetch_repo(repo_path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let repo = Repository::open(repo_path)?;
    
    // Get all remotes
    let remotes = repo.remotes()?;
    let mut fetch_results = Vec::new();
    
    for remote_name in remotes.iter() {
        if let Some(remote_name) = remote_name {
            match repo.find_remote(remote_name) {
                Ok(mut remote) => {
                    // Perform the fetch
                    let mut fetch_options = git2::FetchOptions::new();
                    
                    // Set up callbacks for authentication if needed
                    let mut callbacks = git2::RemoteCallbacks::new();
                    callbacks.credentials(|_url, username_from_url, _allowed_types| {
                        // Try to use SSH agent or system credentials
                        if let Some(username) = username_from_url {
                            git2::Cred::ssh_key_from_agent(username)
                        } else {
                            git2::Cred::default()
                        }
                    });
                    
                    fetch_options.remote_callbacks(callbacks);
                    
                    match remote.fetch(&[] as &[&str], Some(&mut fetch_options), None) {
                        Ok(()) => {
                            let stats = remote.stats();
                            fetch_results.push(format!(
                                "{}: {} objects received", 
                                remote_name, 
                                stats.received_objects()
                            ));
                        }
                        Err(e) => {
                            fetch_results.push(format!("{}: {}", remote_name, e));
                        }
                    }
                }
                Err(e) => {
                    fetch_results.push(format!("{}: Failed to find remote - {}", remote_name, e));
                }
            }
        }
    }
    
    if fetch_results.is_empty() {
        Ok("No remotes found".to_string())
    } else {
        Ok(fetch_results.join("; "))
    }
}

#[tauri::command]
async fn get_git_commits_for_repos(
    repo_paths: Vec<String>,
    start_timestamp: u64, // Unix timestamp in milliseconds
    end_timestamp: u64,   // Unix timestamp in milliseconds
) -> Result<Vec<RepoCommits>, String> {
    let mut results = Vec::new();
    
    let start_seconds = (start_timestamp / 1000) as i64;
    let end_seconds = (end_timestamp / 1000) as i64;
    
    for repo_path in repo_paths {
        let repo_commits = match get_repo_commits(&repo_path, start_seconds, end_seconds) {
            Ok(commits) => RepoCommits {
                repo_path: repo_path.clone(),
                commits,
                error: None,
            },
            Err(e) => RepoCommits {
                repo_path: repo_path.clone(),
                commits: Vec::new(),
                error: Some(format!("Error reading repository: {}", e)),
            },
        };
        results.push(repo_commits);
    }
    
    Ok(results)
}

/// Get the remote URL for a repository (prefers 'origin' remote)
fn get_remote_url(repo: &Repository) -> Option<String> {
    // Try to get 'origin' remote first
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            return Some(url.to_string());
        }
    }
    
    // Fallback: get first available remote
    if let Ok(remotes) = repo.remotes() {
        for remote_name in remotes.iter() {
            if let Some(remote_name) = remote_name {
                if let Ok(remote) = repo.find_remote(remote_name) {
                    if let Some(url) = remote.url() {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }
    
    None
}

/// Convert a git remote URL to a web URL for a specific commit
fn build_commit_url(remote_url: &str, commit_id: &str) -> Option<String> {
    // Handle SSH URLs (e.g., git@github.com:owner/repo.git)
    let url = if remote_url.starts_with("git@") {
        // Convert git@host:owner/repo.git to https://host/owner/repo
        let parts: Vec<&str> = remote_url.split(':').collect();
        if parts.len() != 2 {
            return None;
        }
        let host = parts[0].replace("git@", "");
        let path = parts[1].trim_end_matches(".git");
        format!("https://{}/{}", host, path)
    } else if remote_url.starts_with("https://") || remote_url.starts_with("http://") {
        // Handle HTTPS URLs
        remote_url.trim_end_matches(".git").to_string()
    } else {
        return None;
    };
    
    // Build commit URL based on hosting service
    if url.contains("github.com") {
        Some(format!("{}/commit/{}", url, commit_id))
    } else if url.contains("gitlab.com") || url.contains("gitlab.") {
        Some(format!("{}/-/commit/{}", url, commit_id))
    } else if url.contains("bitbucket.org") {
        Some(format!("{}/commits/{}", url, commit_id))
    } else {
        // Generic format (works for many git hosting services)
        Some(format!("{}/commit/{}", url, commit_id))
    }
}

fn get_repo_commits(repo_path: &str, start_seconds: i64, end_seconds: i64) -> Result<Vec<GitCommit>, Box<dyn std::error::Error>> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    
    // Walk all branches (local and remote)
    revwalk.push_glob("refs/heads/*")?;  // All local branches
    revwalk.push_glob("refs/remotes/*")?; // All remote branches
    revwalk.set_sorting(git2::Sort::TIME)?;
    
    // Get remote URL once for all commits
    let remote_url = get_remote_url(&repo);
    
    let mut commits = Vec::new();
    let mut seen_commits = std::collections::HashSet::new();
    
    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let commit_time = commit.time();
        let commit_timestamp = commit_time.seconds();
        
        // Skip duplicate commits (same commit can be on multiple branches)
        if seen_commits.contains(&oid) {
            continue;
        }
        seen_commits.insert(oid);

        // Filter by date range
        if commit_timestamp >= start_seconds && commit_timestamp <= end_seconds {
            let author = commit.author();
            let message = commit.message().unwrap_or("").to_string();
            
            // Get files changed in this commit
            let mut files_changed = Vec::new();
            if let Some(parent) = commit.parent(0).ok() {
                let tree = commit.tree()?;
                let parent_tree = parent.tree()?;
                let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), None)?;
                
                diff.foreach(
                    &mut |delta, _| {
                        if let Some(file) = delta.new_file().path() {
                            if let Some(path_str) = file.to_str() {
                                files_changed.push(path_str.to_string());
                            }
                        }
                        true
                    },
                    None,
                    None,
                    None,
                )?;
            }
            
            // Get branches that contain this commit and check if it's on remote
            let (branches, is_on_remote) = get_branches_for_commit(&repo, oid)?;
            
            // Build commit URL only if commit exists on remote AND remote URL exists
            let commit_id = format!("{}", oid);
            let url = if is_on_remote {
                remote_url.as_ref().and_then(|remote| build_commit_url(remote, &commit_id))
            } else {
                None
            };
            
            let git_commit = GitCommit {
                id: commit_id,
                message: message.lines().next().unwrap_or("").to_string(), // First line only
                author_name: author.name().unwrap_or("Unknown").to_string(),
                author_email: author.email().unwrap_or("").to_string(),
                timestamp: time_to_timestamp_ms(commit_time),
                date: time_to_iso_date(commit_time),
                repo_path: repo_path.to_string(),
                files_changed,
                branches,
                url,
            };
            
            commits.push(git_commit);
        }
    }
    
    // Sort by timestamp (newest first)
    commits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    
    Ok(commits)
}

#[tauri::command]
async fn search_markdown_files(
    folder_path: String,
    query: String,
    limit: Option<usize>,
    app_handle: tauri::AppHandle,
) -> Result<SearchResults, String> {
    let limit = limit.unwrap_or(100);
    
    // Get app data directory
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    // Get or create index
    let index = get_or_create_index(&folder_path, &app_data_dir)
        .map_err(|e| format!("Failed to get or create index: {}", e))?;
    
    // Get or create sync lock for this folder
    let folder_hash = hash_folder_path(&folder_path);
    let sync_lock = {
        let mut locks = SYNC_LOCKS.lock().unwrap();
        locks.entry(folder_hash.clone())
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
    let results = search_index(&index, &query, limit)
        .map_err(|e| format!("Search failed: {}", e))?;
    
    Ok(results)
}

#[tauri::command]
async fn rebuild_search_index(
    folder_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle.path().app_data_dir()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("")
                .inner_size(800.0, 600.0);

            // set transparent title bar only when building for macOS
            #[cfg(target_os = "macos")]
            let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

            let window = win_builder.build().unwrap();

            // set black background only when building for macOS
            #[cfg(target_os = "macos")]
            {
                use objc2::runtime::AnyObject;
                use objc2_app_kit::NSColor;

                let ns_window = window.ns_window().unwrap();
                unsafe {
                    // Match the dark theme background color: #0c0a09
                    // RGB(12, 10, 9) normalized to 0-1 range
                    let bg_color = NSColor::colorWithRed_green_blue_alpha(0.047, 0.039, 0.035, 1.0);
                    let window_obj: *mut AnyObject = ns_window as *mut AnyObject;
                    let _: () = objc2::msg_send![window_obj, setBackgroundColor: &*bg_color];
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_markdown_files_metadata, read_markdown_files_content, get_git_commits_for_repos, fetch_repos, set_file_location_metadata, search_markdown_files, rebuild_search_index])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
