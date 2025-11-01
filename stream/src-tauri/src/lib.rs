mod search;

use tauri::{Emitter, Manager, WindowEvent};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use git2::{Repository, Time};
use chrono::{DateTime, Utc, NaiveDate};
use xattr;
use regex::Regex;

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};

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
pub struct StructuredMarkdownFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64, // Unix timestamp in milliseconds
    pub modified_at: u64, // Unix timestamp in milliseconds
    pub size: u64,
    pub country: Option<String>, // Location country from xattrs
    pub city: Option<String>,    // Location city from xattrs
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StructuredMarkdownFile {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64, // Unix timestamp in milliseconds
    pub modified_at: u64, // Unix timestamp in milliseconds
    pub size: u64,
    pub country: Option<String>, // Location country from xattrs
    pub city: Option<String>,    // Location city from xattrs
    pub description: Option<String>, // File description from xattrs
    pub content: String,          // File content
    pub refresh_interval: Option<String>, // Refresh interval from xattrs
    pub last_refreshed_at: Option<u64>, // Last refresh timestamp from xattrs
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

// Compile regex once on first use for efficient reuse
static DATE_FILENAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{4})-(\d{2})-(\d{2})\.md$").expect("Failed to compile date filename regex")
});

// Helper functions for xattr operations
const XATTR_COUNTRY_KEY: &str = "user.location.country";
const XATTR_CITY_KEY: &str = "user.location.city";
const XATTR_DESCRIPTION_KEY: &str = "user.file.description";
const XATTR_REFRESH_INTERVAL_KEY: &str = "user.refresh.interval";
const XATTR_LAST_REFRESHED_KEY: &str = "user.refresh.last_refreshed";

// Refresh interval enum
#[derive(Debug, Clone, PartialEq)]
enum RefreshInterval {
    Minutely,
    Hourly,
    Daily,
    Weekly,
    None,
}

impl RefreshInterval {
    fn from_string(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "minutely" => Some(RefreshInterval::Minutely),
            "hourly" => Some(RefreshInterval::Hourly),
            "daily" => Some(RefreshInterval::Daily),
            "weekly" => Some(RefreshInterval::Weekly),
            "none" => Some(RefreshInterval::None),
            _ => None,
        }
    }
    
    fn to_string(&self) -> String {
        match self {
            RefreshInterval::Minutely => "minutely".to_string(),
            RefreshInterval::Hourly => "hourly".to_string(),
            RefreshInterval::Daily => "daily".to_string(),
            RefreshInterval::Weekly => "weekly".to_string(),
            RefreshInterval::None => "none".to_string(),
        }
    }
    
    fn duration_ms(&self) -> Option<u64> {
        match self {
            RefreshInterval::Minutely => Some(60 * 1000),
            RefreshInterval::Hourly => Some(60 * 60 * 1000),
            RefreshInterval::Daily => Some(24 * 60 * 60 * 1000),
            RefreshInterval::Weekly => Some(7 * 24 * 60 * 60 * 1000),
            RefreshInterval::None => None,
        }
    }
}

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

fn read_description_xattr(file_path: &Path) -> Option<String> {
    xattr::get(file_path, XATTR_DESCRIPTION_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn write_description_xattr(file_path: &Path, description: &str) -> Result<(), Box<dyn std::error::Error>> {
    if description.is_empty() {
        // Remove the xattr if description is empty
        let _ = xattr::remove(file_path, XATTR_DESCRIPTION_KEY);
        Ok(())
    } else {
        xattr::set(file_path, XATTR_DESCRIPTION_KEY, description.as_bytes())?;
        Ok(())
    }
}

fn write_location_xattrs(file_path: &Path, country: &str, city: &str) -> Result<(), Box<dyn std::error::Error>> {
    xattr::set(file_path, XATTR_COUNTRY_KEY, country.as_bytes())?;
    xattr::set(file_path, XATTR_CITY_KEY, city.as_bytes())?;
    Ok(())
}

fn read_refresh_interval(file_path: &Path) -> Option<RefreshInterval> {
    xattr::get(file_path, XATTR_REFRESH_INTERVAL_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|s| RefreshInterval::from_string(&s))
}

fn write_refresh_interval(file_path: &Path, interval: &RefreshInterval) -> Result<(), Box<dyn std::error::Error>> {
    let interval_str = interval.to_string();
    xattr::set(file_path, XATTR_REFRESH_INTERVAL_KEY, interval_str.as_bytes())?;
    Ok(())
}

fn read_last_refreshed(file_path: &Path) -> Option<u64> {
    xattr::get(file_path, XATTR_LAST_REFRESHED_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn write_last_refreshed(file_path: &Path, timestamp_ms: u64) -> Result<(), Box<dyn std::error::Error>> {
    let timestamp_str = timestamp_ms.to_string();
    xattr::set(file_path, XATTR_LAST_REFRESHED_KEY, timestamp_str.as_bytes())?;
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
async fn set_file_description(file_path: String, description: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    write_description_xattr(path, &description)
        .map_err(|e| format!("Failed to set file description: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn set_file_refresh_interval(file_path: String, interval: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    let refresh_interval = RefreshInterval::from_string(&interval)
        .ok_or_else(|| format!("Invalid refresh interval: {}", interval))?;
    
    write_refresh_interval(path, &refresh_interval)
        .map_err(|e| format!("Failed to set refresh interval: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn update_last_refreshed(file_path: String, timestamp_ms: u64) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    write_last_refreshed(path, timestamp_ms)
        .map_err(|e| format!("Failed to update last refreshed timestamp: {}", e))?;
    
    Ok(())
}

// Note: Actual refresh logic (reading, processing, writing content) 
// should be implemented on the TypeScript side. This command just updates
// the last refreshed timestamp after TypeScript completes the refresh.
#[tauri::command]
async fn mark_file_as_refreshed(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    // Update last refreshed timestamp to now
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    
    write_last_refreshed(path, now)
        .map_err(|e| format!("Failed to update last refreshed: {}", e))?;
    
    Ok(())
}


#[tauri::command]
async fn get_files_needing_refresh(directory_path: String) -> Result<Vec<String>, String> {
    let structured_dir_path = Path::new(&directory_path).join("structured");
    
    // Check if structured directory exists
    if !structured_dir_path.exists() {
        return Ok(Vec::new());
    }
    
    let mut files_needing_refresh = Vec::new();
    
    let entries = match fs::read_dir(&structured_dir_path) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        
        let path = entry.path();
        
        if path.is_file() {
            if let Some(extension) = path.extension() {
                if extension.to_string_lossy().to_lowercase() == "md" {
                    // Check if file has refresh interval set
                    if let Some(interval) = read_refresh_interval(&path) {
                        if interval != RefreshInterval::None {
                            // Check if file needs refresh based on interval and last refresh time
                            let last_refreshed = read_last_refreshed(&path).unwrap_or(0);
                            
                            if let Some(duration_ms) = interval.duration_ms() {
                                let time_since_refresh = now.saturating_sub(last_refreshed);
                                
                                if time_since_refresh >= duration_ms {
                                    files_needing_refresh.push(path.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(files_needing_refresh)
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

#[tauri::command]
async fn read_structured_markdown_files_metadata(directory_path: String, max_file_size: Option<u64>) -> Result<Vec<StructuredMarkdownFileMetadata>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024); // 10MB default
    let mut files = Vec::new();
    
    // Build the structured directory path
    let structured_dir_path = Path::new(&directory_path).join("structured");
    
    // Check if structured directory exists
    if !structured_dir_path.exists() {
        return Ok(files); // Return empty list if directory doesn't exist yet
    }
    
    if !structured_dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", structured_dir_path.display()));
    }
    
    // Read all .md files in the structured directory (non-recursive for structured files)
    let entries = match fs::read_dir(&structured_dir_path) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Error reading structured directory: {}", e)),
    };
    
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("Error reading directory entry: {}", e);
                continue;
            }
        };
        
        let path = entry.path();
        
        // Only process files (not subdirectories)
        if path.is_file() {
            // Check if it's a markdown file
            if let Some(extension) = path.extension() {
                if extension.to_string_lossy().to_lowercase() == "md" {
                    let file_name = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    
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
                            
                            files.push(StructuredMarkdownFileMetadata {
                                file_path,
                                file_name,
                                created_at,
                                modified_at,
                                size,
                                country,
                                city,
                            });
                        }
                    }
                }
            }
        }
    }
    
    // Sort by modified time (newest first)
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    
    Ok(files)
}

#[tauri::command]
async fn read_structured_markdown_files(directory_path: String, max_file_size: Option<u64>) -> Result<Vec<StructuredMarkdownFile>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024); // 10MB default
    let mut files = Vec::new();
    
    // Build the structured directory path
    let structured_dir_path = Path::new(&directory_path).join("structured");
    
    // Check if structured directory exists
    if !structured_dir_path.exists() {
        return Ok(files); // Return empty list if directory doesn't exist yet
    }
    
    if !structured_dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", structured_dir_path.display()));
    }
    
    // Read all .md files in the structured directory (non-recursive for structured files)
    let entries = match fs::read_dir(&structured_dir_path) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Error reading structured directory: {}", e)),
    };
    
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("Error reading directory entry: {}", e);
                continue;
            }
        };
        
        let path = entry.path();
        
        // Only process files (not subdirectories)
        if path.is_file() {
            // Check if it's a markdown file
            if let Some(extension) = path.extension() {
                if extension.to_string_lossy().to_lowercase() == "md" {
                    let file_name = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    
                    // Get file metadata
                    if let Ok(metadata) = entry.metadata() {
                        let size = metadata.len();
                        
                        // Filter by file size
                        if size <= max_size {
                            let file_path = path.to_string_lossy().to_string();
                            
                            // Read file content
                            let content = match fs::read_to_string(&path) {
                                Ok(content) => content,
                                Err(e) => {
                                    eprintln!("Error reading file content for {}: {}", file_path, e);
                                    continue; // Skip this file if we can't read it
                                }
                            };
                            
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
                            
                            // Read description from xattrs
                            let description = read_description_xattr(&path);
                            
                            // Read refresh metadata from xattrs
                            let refresh_interval = read_refresh_interval(&path).map(|i| i.to_string());
                            let last_refreshed_at = read_last_refreshed(&path);
                            
                            files.push(StructuredMarkdownFile {
                                file_path,
                                file_name,
                                created_at,
                                modified_at,
                                size,
                                country,
                                city,
                                description,
                                content,
                                refresh_interval,
                                last_refreshed_at,
                            });
                        }
                    }
                }
            }
        }
    }
    
    // Sort by modified time (newest first)
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    
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

#[cfg(target_os = "macos")]
fn setup_macos_window(window: &tauri::Window) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        let ns_window = window.ns_window()? as id;
        
        if ns_window != nil {
            // Set corner radius using Objective-C messaging
            let _: () = msg_send![ns_window, setHasShadow: true];
            
            // Get the content view
            let content_view: id = msg_send![ns_window, contentView];
            if content_view != nil {
                let _: () = msg_send![content_view, setWantsLayer: true];
                
                // Get the layer
                let layer: id = msg_send![content_view, layer];  
                if layer != nil {
                    let _: () = msg_send![layer, setCornerRadius: 8.0f64];
                    let _: () = msg_send![layer, setMasksToBounds: true];
                }
            }
        }
    }
    
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_files_metadata, 
            read_structured_markdown_files_metadata,
            read_structured_markdown_files,
            read_markdown_files_content, 
            get_git_commits_for_repos, 
            fetch_repos, 
            set_file_location_metadata,
            set_file_description,
            set_file_refresh_interval,
            update_last_refreshed,
            mark_file_as_refreshed,
            get_files_needing_refresh,
            search::search_markdown_files, 
            search::rebuild_search_index
        ])
        .on_window_event(|window, event| {
            match event {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                    #[cfg(target_os = "macos")]
                    if let Err(e) = setup_macos_window(window) {
                        eprintln!("Failed to setup macOS window: {}", e);
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Some(webview_window) = app.get_webview_window("main") {
                    let window = webview_window.as_ref().window();
                    if let Err(e) = setup_macos_window(&window) {
                        eprintln!("Failed to setup macOS window: {}", e);
                    }
                }
            }
            
            // Start background thread to check for files needing refresh
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    // Sleep for 60 seconds between checks
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    
                    // Emit event to frontend
                    if let Err(e) = app_handle.emit("check-for-refresh", ()) {
                        eprintln!("Failed to emit check-for-refresh event: {}", e);
                    }
                }
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
