use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use chrono::{DateTime, Utc};
use git2::{self, Repository, Time};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::ipc::github::find_executable;

/// Maximum number of commits to return per repository to prevent memory issues
const MAX_COMMITS_PER_REPO: usize = 200;

/// Limit the number of branch tips used for non-tip commit matching (performance guard)
const MAX_BRANCH_TIPS_FOR_MATCH: usize = 50;

/// Agents commit under their own name for you, in cloud sessions for example.
const AGENT_AUTHOR_EMAILS: [&str; 2] = ["noreply@anthropic.com", "cursoragent@cursor.com"];

/// A stuck fetch must not hold up every later one.
const FETCH_TIMEOUT: Duration = Duration::from_secs(120);

/// Commits are attributed to branches through remote-tracking refs, so a pruned
/// ref would regroup past days. `--no-prune` also overrides `fetch.prune`.
const FETCH_ARGS: [&str; 4] = ["fetch", "--all", "--quiet", "--no-prune"];

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommit {
    pub id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: u64,
    pub date: String,
    pub repo_path: String,
    pub branches: Vec<String>,
    pub parents: Vec<String>,
    pub url: Option<String>,
    pub is_mine: bool,
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
    let Some(git) = find_executable("git").await else {
        return Ok(repo_paths
            .into_iter()
            .map(|repo_path| FetchResult {
                repo_path,
                success: false,
                message: "git is not installed".to_string(),
            })
            .collect());
    };

    let fetches: Vec<_> = repo_paths
        .into_iter()
        .map(|repo_path| {
            let git = git.clone();
            tauri::async_runtime::spawn(async move {
                match fetch_repo(&git, &repo_path, FETCH_TIMEOUT).await {
                    Ok(message) => FetchResult {
                        repo_path,
                        success: true,
                        message,
                    },
                    Err(message) => FetchResult {
                        repo_path,
                        success: false,
                        message,
                    },
                }
            })
        })
        .collect();

    let mut results = Vec::new();
    for fetch in fetches {
        results.push(fetch.await.map_err(|e| e.to_string())?);
    }

    Ok(results)
}

/// Every branch tip in a repo, local and remote-tracking. A commit moves a local
/// one and a push moves a remote-tracking one.
#[tauri::command]
pub(crate) async fn get_branch_tips(repo_paths: Vec<String>) -> Vec<String> {
    repo_paths
        .par_iter()
        .flat_map(|repo_path| read_branch_tips(repo_path).unwrap_or_default())
        .collect()
}

fn read_branch_tips(repo_path: &str) -> Result<Vec<String>, git2::Error> {
    let repo = Repository::open(repo_path)?;
    let mut tips = Vec::new();

    for reference in repo.references()? {
        let reference = reference?;
        if !reference.is_branch() && !reference.is_remote() {
            continue;
        }
        if let (Some(name), Some(target)) = (reference.name(), reference.target()) {
            tips.push(format!("{} {} {}", repo_path, name, target));
        }
    }

    tips.sort();
    Ok(tips)
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

#[derive(Clone)]
struct BranchTip {
    name: String,
    oid: git2::Oid,
    is_remote: bool,
    time_seconds: i64,
}

/// Build a list of all branch tips (local + remote) with normalized names.
fn build_branch_tip_list(
    repo: &Repository,
) -> Result<Vec<BranchTip>, Box<dyn std::error::Error>> {
    let mut tips = Vec::new();

    let local_branches = repo.branches(Some(git2::BranchType::Local))?;
    for branch in local_branches {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            let reference = branch.get();
            if let Some(target) = reference.target() {
                let time_seconds = repo
                    .find_commit(target)
                    .map(|commit| commit.time().seconds())
                    .unwrap_or(0);
                tips.push(BranchTip {
                    name: normalize_branch_name(name),
                    oid: target,
                    is_remote: false,
                    time_seconds,
                });
            }
        }
    }

    let remote_branches = repo.branches(Some(git2::BranchType::Remote))?;
    for branch in remote_branches {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            let reference = branch.get();
            if let Some(target) = reference.target() {
                let time_seconds = repo
                    .find_commit(target)
                    .map(|commit| commit.time().seconds())
                    .unwrap_or(0);
                tips.push(BranchTip {
                    name: normalize_branch_name(name),
                    oid: target,
                    is_remote: true,
                    time_seconds,
                });
            }
        }
    }

    Ok(tips)
}

/// Get the primary branch for a commit using a simplified approach
/// Instead of walking all branch histories, we check if commit is reachable from main branches
fn get_branch_for_commit_fast(
    repo: &Repository,
    commit_oid: git2::Oid,
    branch_tip_map: &HashMap<git2::Oid, (Vec<String>, bool)>,
    branch_tips: &[BranchTip],
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

    // For non-tip commits, find all branches whose tip contains this commit.
    let mut branches = Vec::new();
    let mut is_on_remote = false;

    // Oldest tip first: the branch closest to a commit is the one it was made on.
    for tip in branch_tips.iter().rev() {
        let is_ancestor = tip.oid == commit_oid
            || repo
                .graph_descendant_of(tip.oid, commit_oid)
                .unwrap_or(false);

        if is_ancestor {
            if !branches.contains(&tip.name) {
                branches.push(tip.name.clone());
            }
            if tip.is_remote {
                is_on_remote = true;
            }
        }
    }

    if branches.is_empty() {
        return (vec!["unknown".to_string()], false);
    }

    branches.sort_by_key(|branch| !is_main_branch(branch));
    branches.truncate(3);

    (branches, is_on_remote)
}

/// What main's history says about where commits were made.
struct MainLine {
    name: String,
    oid: git2::Oid,
    /// Commits made on main itself, found by following first parents.
    commits: HashSet<git2::Oid>,
    /// Branches holding all of main, such as a new worktree. They contain its
    /// commits but say nothing about where those commits came from.
    followers: HashSet<String>,
}

fn build_main_line(
    repo: &Repository,
    branch_tips: &[BranchTip],
    start_seconds: i64,
) -> Option<MainLine> {
    let tip = ["main", "master", "develop"]
        .iter()
        .find_map(|name| branch_tips.iter().find(|tip| tip.name == *name))?;

    let mut commits = HashSet::new();
    let mut next = repo.find_commit(tip.oid).ok();

    while let Some(commit) = next {
        if commit.time().seconds() < start_seconds {
            break;
        }
        commits.insert(commit.id());
        next = commit.parent(0).ok();
    }

    let followers = branch_tips
        .iter()
        .filter(|other| {
            other.name != tip.name
                && (other.oid == tip.oid
                    || repo.graph_descendant_of(other.oid, tip.oid).unwrap_or(false))
        })
        .map(|other| other.name.clone())
        .collect();

    Some(MainLine {
        name: tip.name.clone(),
        oid: tip.oid,
        commits,
        followers,
    })
}

/// A commit made on main belongs to main alone, and one merged into it keeps
/// only the branch it came from.
fn attribute_to_main(
    repo: &Repository,
    main_line: &MainLine,
    commit_oid: git2::Oid,
    branches: Vec<String>,
) -> Vec<String> {
    if main_line.commits.contains(&commit_oid) {
        return vec![main_line.name.clone()];
    }

    let is_merged = repo
        .graph_descendant_of(main_line.oid, commit_oid)
        .unwrap_or(false);

    if !is_merged {
        return branches;
    }

    let source_branches = branches
        .into_iter()
        .filter(|branch| *branch != main_line.name && !main_line.followers.contains(branch));

    std::iter::once(main_line.name.clone())
        .chain(source_branches)
        .collect()
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

/// Runs git itself rather than libgit2, because only git knows the user's
/// credential helpers and SSH config.
async fn fetch_repo(git: &Path, repo_path: &str, timeout: Duration) -> Result<String, String> {
    let mut command = Command::new(git);
    command
        .args(FETCH_ARGS)
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);

    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| "Timed out waiting for git fetch".to_string())?
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        return Ok("Fetched".to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git fetch failed: {}", output.status)
    } else {
        stderr
    })
}

pub(crate) fn get_remote_url(repo: &Repository) -> Option<String> {
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

fn get_user_email(repo: &Repository) -> Option<String> {
    repo.config()
        .ok()?
        .get_string("user.email")
        .ok()
        .filter(|email| !email.is_empty())
}

// Names vary between machines, so the email is what identifies an author
fn is_my_commit(author_email: &str, user_email: Option<&str>) -> bool {
    AGENT_AUTHOR_EMAILS.contains(&author_email)
        || user_email.is_some_and(|email| email.eq_ignore_ascii_case(author_email))
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
    let user_email = get_user_email(&repo);
    
    // Build branch tip map once upfront (much faster than per-commit checks)
    let branch_tip_map = build_branch_tip_map(&repo).unwrap_or_default();
    let branch_tips_raw = build_branch_tip_list(&repo).unwrap_or_default();

    // Consolidate by branch name and keep the newest tip per branch
    let mut tips_by_name: HashMap<String, BranchTip> = HashMap::new();
    for tip in branch_tips_raw {
        tips_by_name
            .entry(tip.name.clone())
            .and_modify(|existing| {
                if tip.time_seconds > existing.time_seconds {
                    existing.oid = tip.oid;
                    existing.time_seconds = tip.time_seconds;
                }
                if tip.is_remote {
                    existing.is_remote = true;
                }
            })
            .or_insert(tip);
    }

    let mut branch_tips: Vec<BranchTip> = tips_by_name.into_values().collect();
    branch_tips.sort_by(|a, b| b.time_seconds.cmp(&a.time_seconds));

    // Always include main-like branches even if they are old
    let mut main_like: Vec<BranchTip> = branch_tips
        .iter()
        .filter(|tip| is_main_branch(&tip.name))
        .cloned()
        .collect();

    let mut limited: Vec<BranchTip> = branch_tips
        .into_iter()
        .take(MAX_BRANCH_TIPS_FOR_MATCH)
        .collect();

    for tip in main_like.drain(..) {
        if !limited.iter().any(|existing| existing.name == tip.name) {
            limited.push(tip);
        }
    }

    let main_line = build_main_line(&repo, &limited, start_seconds);

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

        // Use the fast branch detection
        let (branches, is_on_remote) =
            get_branch_for_commit_fast(&repo, oid, &branch_tip_map, &limited);
        let branches = match &main_line {
            Some(main_line) => attribute_to_main(&repo, main_line, oid, branches),
            None => branches,
        };

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
            branches,
            parents: commit.parent_ids().map(|id| id.to_string()).collect(),
            url,
            is_mine: is_my_commit(author.email().unwrap_or(""), user_email.as_deref()),
        };

        commits.push(git_commit);
    }

    commits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn my_commits_match_the_git_user_or_an_agent() {
        let me = Some("marcel@example.com");

        assert!(is_my_commit("Marcel@Example.com", me));
        assert!(is_my_commit("noreply@anthropic.com", me));
        assert!(is_my_commit("cursoragent@cursor.com", None));
        assert!(!is_my_commit("49699333+dependabot[bot]@users.noreply.github.com", me));
        assert!(!is_my_commit("", None));
    }
    use git2::{Oid, Signature};
    use std::path::PathBuf;

    struct TestRepo {
        path: PathBuf,
        repo: Repository,
    }

    impl TestRepo {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "stream-git-{}-{}",
                name,
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&path);
            let repo = Repository::init_opts(
                &path,
                git2::RepositoryInitOptions::new().initial_head("main"),
            )
            .unwrap();

            Self { path, repo }
        }

        fn commit(&self, branch: &str, message: &str, time: i64, parents: &[Oid]) -> Oid {
            let signature =
                Signature::new("Test", "test@example.com", &Time::new(time, 0)).unwrap();
            let tree = self.repo.treebuilder(None).unwrap().write().unwrap();
            let tree = self.repo.find_tree(tree).unwrap();
            let parents: Vec<git2::Commit> = parents
                .iter()
                .map(|oid| self.repo.find_commit(*oid).unwrap())
                .collect();
            let parents: Vec<&git2::Commit> = parents.iter().collect();

            self.repo
                .commit(
                    Some(&format!("refs/heads/{}", branch)),
                    &signature,
                    &signature,
                    message,
                    &tree,
                    &parents,
                )
                .unwrap()
        }

        fn branches_of(&self, message: &str) -> Vec<String> {
            get_repo_commits(self.path.to_str().unwrap(), 0, i64::MAX / 2)
                .unwrap()
                .into_iter()
                .find(|commit| commit.message == message)
                .unwrap()
                .branches
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn create_branch(test: &TestRepo, name: &str, oid: Oid) {
        let commit = test.repo.find_commit(oid).unwrap();
        test.repo.branch(name, &commit, false).unwrap();
    }

    #[test]
    fn commits_on_main_stay_on_main_when_a_branch_points_at_it() {
        let test = TestRepo::new("follower");
        let first = test.commit("main", "first", 100, &[]);
        let release = test.commit("main", "release", 200, &[first]);
        create_branch(&test, "worktree", release);

        assert_eq!(test.branches_of("first"), vec!["main"]);
        assert_eq!(test.branches_of("release"), vec!["main"]);
    }

    #[test]
    fn merged_commits_keep_their_branch_but_not_a_follower() {
        let test = TestRepo::new("merged");
        let first = test.commit("main", "first", 100, &[]);
        create_branch(&test, "feature", first);
        let feature = test.commit("feature", "feature work", 200, &[first]);
        let older = test.commit("feature", "feature tip", 250, &[feature]);
        let merge = test.commit("main", "merge feature", 300, &[first, older]);
        create_branch(&test, "worktree", merge);

        assert_eq!(test.branches_of("merge feature"), vec!["main"]);
        assert_eq!(test.branches_of("feature work"), vec!["main", "feature"]);
    }

    #[test]
    fn unmerged_commits_stay_on_their_branch() {
        let test = TestRepo::new("unmerged");
        let first = test.commit("main", "first", 100, &[]);
        create_branch(&test, "feature", first);
        test.commit("feature", "feature work", 200, &[first]);

        assert_eq!(test.branches_of("feature work"), vec!["feature"]);
    }

    #[test]
    fn commits_list_their_parents() {
        let test = TestRepo::new("parents");
        let first = test.commit("main", "first", 100, &[]);
        let second = test.commit("main", "second", 100, &[first]);

        let commits = get_repo_commits(test.path.to_str().unwrap(), 0, i64::MAX / 2).unwrap();
        let parents_of = |oid: Oid| {
            commits
                .iter()
                .find(|commit| commit.id == oid.to_string())
                .unwrap()
                .parents
                .clone()
        };

        assert_eq!(parents_of(second), vec![first.to_string()]);
        assert!(parents_of(first).is_empty());
    }

    fn git() -> PathBuf {
        tauri::async_runtime::block_on(find_executable("git")).unwrap()
    }

    fn fetch(path: &Path, timeout: Duration) -> Result<String, String> {
        tauri::async_runtime::block_on(fetch_repo(&git(), path.to_str().unwrap(), timeout))
    }

    /// A repo with a commit on main, and a clone that hasn't fetched it yet.
    fn with_clone(name: &str) -> (TestRepo, TestRepo, Oid) {
        let origin = TestRepo::new(&format!("{name}-origin"));
        let clone = TestRepo::new(&format!("{name}-clone"));
        let tip = origin.commit("main", "first", 100, &[]);
        clone
            .repo
            .remote("origin", origin.path.to_str().unwrap())
            .unwrap();

        (origin, clone, tip)
    }

    #[test]
    fn fetching_updates_remote_tracking_refs() {
        let (_origin, clone, tip) = with_clone("fetch");

        assert_eq!(fetch(&clone.path, FETCH_TIMEOUT), Ok("Fetched".to_string()));
        assert_eq!(
            clone.repo.refname_to_id("refs/remotes/origin/main"),
            Ok(tip)
        );
    }

    #[test]
    fn fetching_keeps_refs_of_deleted_branches_whatever_the_config_says() {
        let (origin, clone, tip) = with_clone("no-prune");
        create_branch(&origin, "feature", tip);
        clone
            .repo
            .config()
            .unwrap()
            .set_bool("fetch.prune", true)
            .unwrap();
        fetch(&clone.path, FETCH_TIMEOUT).unwrap();

        origin
            .repo
            .find_branch("feature", git2::BranchType::Local)
            .unwrap()
            .delete()
            .unwrap();
        fetch(&clone.path, FETCH_TIMEOUT).unwrap();

        assert_eq!(
            clone.repo.refname_to_id("refs/remotes/origin/feature"),
            Ok(tip)
        );
    }

    #[test]
    fn a_repo_without_remotes_has_nothing_to_fetch() {
        let test = TestRepo::new("no-remotes");

        assert!(fetch(&test.path, FETCH_TIMEOUT).is_ok());
    }

    #[test]
    fn a_failed_fetch_reports_what_git_said() {
        let test = TestRepo::new("missing-remote");
        test.repo
            .remote("origin", "/nonexistent/stream-remote.git")
            .unwrap();

        let error = fetch(&test.path, FETCH_TIMEOUT).unwrap_err();

        assert!(error.contains("/nonexistent/stream-remote.git"), "{error}");
    }

    #[test]
    fn a_stuck_fetch_times_out() {
        let (_origin, clone, _) = with_clone("timeout");
        let slow_git = clone.path.join("slow-git");
        std::fs::write(&slow_git, "#!/bin/sh\nsleep 5\n").unwrap();
        std::fs::set_permissions(
            &slow_git,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .unwrap();

        let result = tauri::async_runtime::block_on(fetch_repo(
            &slow_git,
            clone.path.to_str().unwrap(),
            Duration::from_millis(50),
        ));

        assert_eq!(result, Err("Timed out waiting for git fetch".to_string()));
    }

    #[test]
    fn branch_tips_cover_local_and_remote_tracking_branches() {
        let (_origin, clone, tip) = with_clone("tips");
        fetch(&clone.path, FETCH_TIMEOUT).unwrap();
        let path = clone.path.to_str().unwrap();
        let remote_only = read_branch_tips(path).unwrap();

        assert_eq!(
            remote_only,
            vec![format!("{path} refs/remotes/origin/main {tip}")]
        );

        let local = clone.commit("feature", "local work", 200, &[tip]);

        assert_eq!(
            read_branch_tips(path).unwrap(),
            vec![
                format!("{path} refs/heads/feature {local}"),
                format!("{path} refs/remotes/origin/main {tip}"),
            ]
        );
    }
}
