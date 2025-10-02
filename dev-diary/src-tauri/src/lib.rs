use tauri::{TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use git2::{Repository, Time};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64, // Unix timestamp in milliseconds
    pub modified_at: u64, // Unix timestamp in milliseconds
    pub size: u64,
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoCommits {
    pub repo_path: String,
    pub commits: Vec<GitCommit>,
    pub error: Option<String>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
                        // Get file metadata
                        if let Ok(metadata) = entry.metadata() {
                            let size = metadata.len();
                            
                            // Filter by file size
                            if size <= max_size {
                                let file_name = path.file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                
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
                                
                                files.push(MarkdownFileMetadata {
                                    file_path,
                                    file_name,
                                    created_at,
                                    modified_at,
                                    size,
                                });
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
    
    // Sort by creation date (newest first)
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    
    Ok(files)
}

fn time_to_timestamp_ms(time: Time) -> u64 {
    (time.seconds() as u64) * 1000 + (time.offset_minutes() as u64) * 60 * 1000
}

fn time_to_iso_date(time: Time) -> String {
    let timestamp = time.seconds();
    let dt = DateTime::from_timestamp(timestamp, 0).unwrap_or_else(|| Utc::now());
    dt.format("%Y-%m-%d").to_string()
}

fn get_branches_for_commit(repo: &Repository, commit_oid: git2::Oid) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut all_branches = std::collections::HashSet::new();
    let mut main_branches = std::collections::HashSet::new();
    let mut feature_branches = std::collections::HashSet::new();
    
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
    
    Ok(result)
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

fn get_repo_commits(repo_path: &str, start_seconds: i64, end_seconds: i64) -> Result<Vec<GitCommit>, Box<dyn std::error::Error>> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    
    // Walk all branches (local and remote)
    revwalk.push_glob("refs/heads/*")?;  // All local branches
    revwalk.push_glob("refs/remotes/*")?; // All remote branches
    revwalk.set_sorting(git2::Sort::TIME)?;
    
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
            
            // Get branches that contain this commit (simplified approach)
            let branches = get_branches_for_commit(&repo, oid)?;
            
            let git_commit = GitCommit {
                id: format!("{}", oid),
                message: message.lines().next().unwrap_or("").to_string(), // First line only
                author_name: author.name().unwrap_or("Unknown").to_string(),
                author_email: author.email().unwrap_or("").to_string(),
                timestamp: time_to_timestamp_ms(commit_time),
                date: time_to_iso_date(commit_time),
                repo_path: repo_path.to_string(),
                files_changed,
                branches,
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
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
        .invoke_handler(tauri::generate_handler![greet, read_markdown_files_metadata, read_markdown_files_content, get_git_commits_for_repos, fetch_repos])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
