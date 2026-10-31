use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use serde::Serialize;
use tauri::Manager;

/// How many folders below a root to look for repositories
const MAX_SCAN_DEPTH: usize = 6;

/// Scanning a parent of a connected repo, so its neighbours show up too
const KNOWN_PARENT_SCAN_DEPTH: usize = 2;

/// A slow disk or network mount stops the scan here and returns what it found
const SCAN_BUDGET: Duration = Duration::from_secs(2);

/// Folders that hold generated files and never contain a project
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "venv",
    "__pycache__",
];

/// Home folders left out of the scan. Reading Desktop, Documents and Downloads
/// makes macOS show a permission prompt, and the rest hold no code.
const SKIPPED_HOME_DIRS: &[&str] = &[
    "Applications",
    "Desktop",
    "Documents",
    "Downloads",
    "Library",
    "Movies",
    "Music",
    "Pictures",
    "Public",
];

#[derive(Debug, Serialize)]
pub struct DiscoveredRepo {
    pub path: String,
    pub display_path: String,
    pub name: String,
    pub last_modified: Option<u64>,
}

/// Find git repositories on this machine, most recently active first.
/// `known_repos` are always included, even when they're outside the scan.
#[tauri::command]
pub(crate) async fn discover_git_repos(
    app: tauri::AppHandle,
    known_repos: Vec<String>,
) -> Result<Vec<DiscoveredRepo>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || discover(&home, &known_repos))
        .await
        .map_err(|e| e.to_string())
}

fn discover(home: &Path, known_repos: &[String]) -> Vec<DiscoveredRepo> {
    let deadline = Instant::now() + SCAN_BUDGET;
    let skipped: HashSet<PathBuf> = SKIPPED_HOME_DIRS.iter().map(|d| home.join(d)).collect();

    let known: Vec<PathBuf> = known_repos.iter().map(PathBuf::from).collect();
    let known_parents: HashSet<PathBuf> = known
        .iter()
        .filter_map(|repo| repo.parent().map(Path::to_path_buf))
        .collect();

    let mut repos: HashSet<PathBuf> = known.iter().cloned().collect();
    repos.extend(find_repos(
        vec![home.to_path_buf()],
        MAX_SCAN_DEPTH,
        &skipped,
        deadline,
    ));
    repos.extend(find_repos(
        known_parents.into_iter().collect(),
        KNOWN_PARENT_SCAN_DEPTH,
        &skipped,
        deadline,
    ));

    let mut discovered: Vec<DiscoveredRepo> = repos
        .into_par_iter()
        .map(|repo| describe_repo(&repo, home))
        .collect();

    discovered.sort_by(|a, b| {
        b.last_modified
            .cmp(&a.last_modified)
            .then_with(|| a.name.cmp(&b.name))
    });
    discovered
}

/// Walk one level at a time so the deadline can stop the scan between levels
fn find_repos(
    roots: Vec<PathBuf>,
    max_depth: usize,
    skipped: &HashSet<PathBuf>,
    deadline: Instant,
) -> Vec<PathBuf> {
    let mut repos = Vec::new();
    let mut frontier = roots;

    for _ in 0..=max_depth {
        if frontier.is_empty() || Instant::now() >= deadline {
            break;
        }

        let scans: Vec<DirScan> = frontier.par_iter().map(|dir| scan_dir(dir)).collect();

        frontier = Vec::new();
        for (dir, scan) in scans {
            match scan {
                Some(children) => frontier.extend(
                    children
                        .into_iter()
                        .filter(|child| !skipped.contains(child)),
                ),
                None => repos.push(dir),
            }
        }
    }

    repos
}

/// A folder and its subfolders, or `None` subfolders when it's a repository.
/// Unreadable folders scan as empty.
type DirScan = (PathBuf, Option<Vec<PathBuf>>);

fn scan_dir(dir: &Path) -> DirScan {
    let Ok(entries) = fs::read_dir(dir) else {
        return (dir.to_path_buf(), Some(Vec::new()));
    };

    let mut children = Vec::new();

    for entry in entries.flatten() {
        // `file_type` doesn't follow symlinks, so links can't cause loops, and
        // a `.git` file marks a worktree or submodule rather than a project
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }

        let name = entry.file_name();

        if name == ".git" {
            return (dir.to_path_buf(), None);
        }

        let name = name.to_string_lossy();
        if !name.starts_with('.') && !SKIPPED_DIRS.contains(&name.as_ref()) {
            children.push(entry.path());
        }
    }

    (dir.to_path_buf(), Some(children))
}

fn describe_repo(repo: &Path, home: &Path) -> DiscoveredRepo {
    let name = repo
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| repo.to_string_lossy().into_owned());

    let display_path = match repo.strip_prefix(home) {
        Ok(relative) => format!("~/{}", relative.display()),
        Err(_) => repo.display().to_string(),
    };

    DiscoveredRepo {
        path: repo.to_string_lossy().into_owned(),
        display_path,
        name,
        last_modified: last_modified(repo),
    }
}

/// The index changes on staging and status, the reflog on commits and checkouts.
/// Reading these timestamps avoids opening every repository with libgit2.
fn last_modified(repo: &Path) -> Option<u64> {
    let git_dir = repo.join(".git");

    [git_dir.join("index"), git_dir.join("logs/HEAD"), git_dir]
        .iter()
        .filter_map(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok())
        .max()
        .and_then(to_millis)
}

fn to_millis(time: SystemTime) -> Option<u64> {
    let elapsed = time.duration_since(UNIX_EPOCH).ok()?;
    Some(elapsed.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_DIR: AtomicU32 = AtomicU32::new(0);

    struct TempHome(PathBuf);

    impl TempHome {
        fn new() -> Self {
            let id = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "stream-repos-test-{}-{}",
                std::process::id(),
                id
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn add_repo(&self, relative: &str, modified: Option<SystemTime>) -> PathBuf {
            let repo = self.0.join(relative);
            fs::create_dir_all(repo.join(".git/logs")).unwrap();
            let index = File::create(repo.join(".git/index")).unwrap();
            if let Some(time) = modified {
                index.set_modified(time).unwrap();
                let git_dir = File::open(repo.join(".git")).unwrap();
                git_dir.set_modified(time).unwrap();
                let logs = File::open(repo.join(".git/logs")).unwrap();
                logs.set_modified(time).unwrap();
            }
            repo
        }

        fn found(&self, known: &[String]) -> Vec<String> {
            discover(&self.0, known)
                .into_iter()
                .map(|repo| repo.name)
                .collect()
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn days_ago(days: u64) -> Option<SystemTime> {
        Some(SystemTime::now() - Duration::from_secs(days * 86_400))
    }

    #[test]
    fn sorts_most_recently_modified_first() {
        let home = TempHome::new();
        home.add_repo("projects/older", days_ago(30));
        home.add_repo("projects/newest", days_ago(1));
        home.add_repo("oss/middle", days_ago(7));

        assert_eq!(home.found(&[]), ["newest", "middle", "older"]);
    }

    #[test]
    fn does_not_descend_into_a_repo() {
        let home = TempHome::new();
        let repo = home.add_repo("projects/outer", None);
        fs::create_dir_all(repo.join("packages/inner/.git")).unwrap();

        assert_eq!(home.found(&[]), ["outer"]);
    }

    #[test]
    fn skips_generated_hidden_and_protected_folders() {
        let home = TempHome::new();
        home.add_repo("projects/keep", None);
        home.add_repo("node_modules/dep", None);
        home.add_repo(".cache/hidden", None);
        home.add_repo("Library/app", None);
        home.add_repo("Documents/private", None);

        assert_eq!(home.found(&[]), ["keep"]);
    }

    #[test]
    fn ignores_worktrees_which_have_a_git_file() {
        let home = TempHome::new();
        let worktree = home.0.join("projects/worktree");
        fs::create_dir_all(&worktree).unwrap();
        File::create(worktree.join(".git")).unwrap();

        assert!(home.found(&[]).is_empty());
    }

    #[test]
    fn stops_at_the_depth_limit() {
        let home = TempHome::new();
        home.add_repo("a/b/c/d/e/reachable", None);
        home.add_repo("a/b/c/d/e/f/too-deep", None);

        assert_eq!(home.found(&[]), ["reachable"]);
    }

    #[test]
    fn keeps_known_repos_and_scans_their_neighbours() {
        let home = TempHome::new();
        let connected = home.add_repo("Documents/connected", days_ago(1));
        home.add_repo("Documents/neighbour", days_ago(2));

        let known = [connected.to_string_lossy().into_owned()];
        assert_eq!(home.found(&known), ["connected", "neighbour"]);
    }

    #[test]
    fn lists_a_deleted_known_repo_last() {
        let home = TempHome::new();
        home.add_repo("projects/present", None);
        let missing = home.0.join("projects/missing");

        let known = [missing.to_string_lossy().into_owned()];
        assert_eq!(home.found(&known), ["present", "missing"]);
    }

    #[test]
    fn stops_scanning_past_the_deadline() {
        let home = TempHome::new();
        home.add_repo("projects/repo", None);

        let repos = find_repos(
            vec![home.0.clone()],
            MAX_SCAN_DEPTH,
            &HashSet::new(),
            Instant::now(),
        );

        assert!(repos.is_empty());
    }

    /// Run with `cargo test --release scan_speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn scan_speed_on_this_machine() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let started = Instant::now();
        let repos = discover(&home, &[]);
        println!("{} repos in {:?}", repos.len(), started.elapsed());
        for repo in repos.iter().take(8) {
            println!("  {}", repo.display_path);
        }
    }
}
