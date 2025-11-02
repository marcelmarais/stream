use std::collections::HashSet;

use chrono::{DateTime, Utc};
use git2::{self, Repository, Time};
use serde::{Deserialize, Serialize};

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

fn time_to_timestamp_ms(time: Time) -> u64 {
    (time.seconds() as u64) * 1000
}

fn time_to_iso_date(time: Time) -> String {
    let timestamp = time.seconds();
    let dt = DateTime::from_timestamp(timestamp, 0).unwrap_or_else(|| Utc::now());
    dt.format("%Y-%m-%d").to_string()
}

fn get_branches_for_commit(
    repo: &Repository,
    commit_oid: git2::Oid,
) -> Result<(Vec<String>, bool), Box<dyn std::error::Error>> {
    let mut all_branches = HashSet::new();
    let mut main_branches = HashSet::new();
    let mut feature_branches = HashSet::new();
    let mut found_on_remote = false;

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
                        found_on_remote = true;

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

    if !main_branches.is_empty() {
        if main_branches.contains("main") {
            result.push("main".to_string());
        } else if main_branches.contains("master") {
            result.push("master".to_string());
        } else if main_branches.contains("develop") {
            result.push("develop".to_string());
        } else if let Some(branch) = main_branches.iter().next() {
            result.push(branch.clone());
        }
    } else {
        result.extend(feature_branches.into_iter().take(2));
    }

    if result.is_empty() {
        result.push("unknown".to_string());
    }

    Ok((result, found_on_remote))
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

    let mut commits = Vec::new();
    let mut seen_commits = HashSet::new();

    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let commit_time = commit.time();
        let commit_timestamp = commit_time.seconds();

        if seen_commits.contains(&oid) {
            continue;
        }
        seen_commits.insert(oid);

        if commit_timestamp >= start_seconds && commit_timestamp <= end_seconds {
            let author = commit.author();
            let message = commit.message().unwrap_or("").to_string();

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

            let (branches, is_on_remote) = get_branches_for_commit(&repo, oid)?;

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
    }

    commits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(commits)
}
