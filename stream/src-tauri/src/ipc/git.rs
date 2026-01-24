use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use git2::{self, DiffOptions, Repository, Time};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

/// Maximum number of commits to return per repository to prevent memory issues
const MAX_COMMITS_PER_REPO: usize = 200;

/// Maximum number of files changed to return per commit
const MAX_FILES_PER_COMMIT: usize = 50;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommit {
    pub id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: u64,
    pub date: String,
    pub repo_path: String,
    pub files_changed: Vec<String>,
    pub branches: Vec<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoCommits {
    pub repo_path: String,
    pub commits: Vec<GitCommit>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchResult {
    pub repo_path: String,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub(crate) async fn fetch_repos(repo_paths: Vec<String>) -> Result<Vec<FetchResult>, String> {
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

#[tauri::command]
pub(crate) async fn get_git_commits_for_repos(
    repo_paths: Vec<String>,
    start_timestamp: u64,
    end_timestamp: u64,
) -> Result<Vec<RepoCommits>, String> {
    let start_seconds = (start_timestamp / 1000) as i64;
    let end_seconds = (end_timestamp / 1000) as i64;

    // Process all repos in parallel using rayon
    let results: Vec<RepoCommits> = repo_paths
        .par_iter()
        .map(|repo_path| {
            match get_repo_commits(repo_path, start_seconds, end_seconds) {
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
            }
        })
        .collect();

    Ok(results)
}

fn time_to_timestamp_ms(time: Time) -> u64 {
    (time.seconds() as u64) * 1000
}

fn time_to_iso_date(time: Time) -> String {
    let timestamp = time.seconds();
    let dt = DateTime::from_timestamp(timestamp, 0).unwrap_or_else(|| Utc::now());
    dt.format("%Y-%m-%d").to_string()
}

/// Build a map of commit OID -> (branches, is_on_remote) for all branch tips
/// This is much more efficient than walking history for each commit
fn build_branch_tip_map(
    repo: &Repository,
) -> Result<HashMap<git2::Oid, (Vec<String>, bool)>, Box<dyn std::error::Error>> {
    let mut tip_map: HashMap<git2::Oid, (Vec<String>, bool)> = HashMap::new();

    // Process local branches - just get the tip commits
    let local_branches = repo.branches(Some(git2::BranchType::Local))?;
    for branch in local_branches {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            let reference = branch.get();
            if let Some(target) = reference.target() {
                let entry = tip_map.entry(target).or_insert_with(|| (Vec::new(), false));
                entry.0.push(name.to_string());
            }
        }
    }

    // Process remote branches - just get the tip commits
    let remote_branches = repo.branches(Some(git2::BranchType::Remote))?;
    for branch in remote_branches {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            let reference = branch.get();
            if let Some(target) = reference.target() {
                let entry = tip_map.entry(target).or_insert_with(|| (Vec::new(), false));
                entry.1 = true; // Mark as on remote
                let normalized = normalize_branch_name(name);
                if !entry.0.contains(&normalized) {
                    entry.0.push(normalized);
                }
            }
        }
    }

    Ok(tip_map)
}

/// Get the primary branch for a commit using a simplified approach
/// Instead of walking all branch histories, we check if commit is reachable from main branches
fn get_branch_for_commit_fast(
    repo: &Repository,
    commit_oid: git2::Oid,
    branch_tip_map: &HashMap<git2::Oid, (Vec<String>, bool)>,
) -> (Vec<String>, bool) {
    // First check if this commit is a branch tip (fast path)
    if let Some((branches, is_remote)) = branch_tip_map.get(&commit_oid) {
        let mut result = branches.clone();
        // Prioritize main branches
        result.sort_by(|a, b| {
            let a_main = is_main_branch(a);
            let b_main = is_main_branch(b);
            b_main.cmp(&a_main)
        });
        result.truncate(2);
        return (result, *is_remote);
    }

    // For non-tip commits, check if reachable from main/master only (for performance)
    // This is a simplified check - we don't try to find ALL branches
    let main_branch_names = ["main", "master", "origin/main", "origin/master"];
    
    for branch_name in &main_branch_names {
        if let Ok(reference) = repo.find_reference(&format!("refs/heads/{}", branch_name))
            .or_else(|_| repo.find_reference(&format!("refs/remotes/{}", branch_name)))
        {
            if let Some(target) = reference.target() {
                // Check if commit is an ancestor of the branch tip (limited depth)
                if let Ok(true) = repo.graph_descendant_of(target, commit_oid) {
                    let is_remote = branch_name.starts_with("origin/");
                    return (vec![normalize_branch_name(branch_name)], is_remote);
                }
            }
        }
    }

    // Default: assume it's on some branch and likely pushed
    (vec!["main".to_string()], true)
}

fn normalize_branch_name(branch_name: &str) -> String {
    branch_name
        .replace("origin/", "")
        .replace("refs/heads/", "")
}

fn is_main_branch(branch_name: &str) -> bool {
    let main_branch_names = [
        "main",
        "master",
        "origin/main",
        "origin/master",
        "develop",
        "origin/develop",
    ];
    main_branch_names.contains(&branch_name)
}

async fn fetch_repo(repo_path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let repo = Repository::open(repo_path)?;

    let remotes = repo.remotes()?;
    let mut fetch_results = Vec::new();

    for remote_name in remotes.iter() {
        if let Some(remote_name) = remote_name {
            match repo.find_remote(remote_name) {
                Ok(mut remote) => {
                    let mut fetch_options = git2::FetchOptions::new();

                    let mut callbacks = git2::RemoteCallbacks::new();
                    callbacks.credentials(|_url, username_from_url, _allowed_types| {
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

fn get_remote_url(repo: &Repository) -> Option<String> {
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            return Some(url.to_string());
        }
    }

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

fn build_commit_url(remote_url: &str, commit_id: &str) -> Option<String> {
    let url = if remote_url.starts_with("git@") {
        let parts: Vec<&str> = remote_url.split(':').collect();
        if parts.len() != 2 {
            return None;
        }
        let host = parts[0].replace("git@", "");
        let path = parts[1].trim_end_matches(".git");
        format!("https://{}/{}", host, path)
    } else if remote_url.starts_with("https://") || remote_url.starts_with("http://") {
        remote_url.trim_end_matches(".git").to_string()
    } else {
        return None;
    };

    if url.contains("github.com") {
        Some(format!("{}/commit/{}", url, commit_id))
    } else if url.contains("gitlab.com") || url.contains("gitlab.") {
        Some(format!("{}/-/commit/{}", url, commit_id))
    } else if url.contains("bitbucket.org") {
        Some(format!("{}/commits/{}", url, commit_id))
    } else {
        Some(format!("{}/commit/{}", url, commit_id))
    }
}

/// Get files changed for a commit using optimized diff options (no content, just file names)
fn get_files_changed_fast(
    repo: &Repository,
    commit: &git2::Commit,
) -> Vec<String> {
    let mut files_changed = Vec::new();

    let parent = match commit.parent(0) {
        Ok(p) => p,
        Err(_) => return files_changed, // Initial commit or error
    };

    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return files_changed,
    };

    let parent_tree = match parent.tree() {
        Ok(t) => t,
        Err(_) => return files_changed,
    };

    // Configure diff to skip content computation entirely
    let mut diff_opts = DiffOptions::new();
    diff_opts.skip_binary_check(true); // Don't check if files are binary
    diff_opts.ignore_submodules(true); // Skip submodule processing
    diff_opts.context_lines(0); // No context lines needed

    let diff = match repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), Some(&mut diff_opts)) {
        Ok(d) => d,
        Err(_) => return files_changed,
    };

    // Use deltas() iterator - much faster than foreach, no callbacks
    for delta in diff.deltas().take(MAX_FILES_PER_COMMIT) {
        if let Some(path) = delta.new_file().path() {
            if let Some(path_str) = path.to_str() {
                files_changed.push(path_str.to_string());
            }
        }
    }

    files_changed
}

fn get_repo_commits(
    repo_path: &str,
    start_seconds: i64,
    end_seconds: i64,
) -> Result<Vec<GitCommit>, Box<dyn std::error::Error>> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;

    revwalk.push_glob("refs/heads/*")?;
    revwalk.push_glob("refs/remotes/*")?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let remote_url = get_remote_url(&repo);
    
    // Build branch tip map once upfront (much faster than per-commit checks)
    let branch_tip_map = build_branch_tip_map(&repo).unwrap_or_default();

    let mut commits = Vec::new();
    let mut seen_commits = HashSet::new();

    for oid in revwalk {
        // Stop early if we've reached the limit
        if commits.len() >= MAX_COMMITS_PER_REPO {
            break;
        }

        let oid = match oid {
            Ok(oid) => oid,
            Err(_) => continue,
        };

        if seen_commits.contains(&oid) {
            continue;
        }
        seen_commits.insert(oid);

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let commit_time = commit.time();
        let commit_timestamp = commit_time.seconds();

        // Skip commits outside the date range
        // Since we're sorted by time, we can break early if we're past the range
        if commit_timestamp < start_seconds {
            break;
        }
        if commit_timestamp > end_seconds {
            continue;
        }

        let author = commit.author();
        let message = commit.message().unwrap_or("").to_string();

        // Get files changed using optimized method (no diff content)
        let files_changed = get_files_changed_fast(&repo, &commit);

        // Use the fast branch detection
        let (branches, is_on_remote) = get_branch_for_commit_fast(&repo, oid, &branch_tip_map);

        let commit_id = format!("{}", oid);
        let url = if is_on_remote {
            remote_url
                .as_ref()
                .and_then(|remote| build_commit_url(remote, &commit_id))
        } else {
            None
        };

        let git_commit = GitCommit {
            id: commit_id,
            message: message.lines().next().unwrap_or("").to_string(),
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

    commits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(commits)
}
