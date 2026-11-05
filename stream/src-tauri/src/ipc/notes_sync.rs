//! Keeps the notes folder in sync with its git remote: commit the notes, pull
//! with rebase, push. Only files under the notes folder are ever committed,
//! because the repo around it may hold other people's or other apps' work.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::ipc::git::{git_output, run_git};
use crate::ipc::github::find_executable;

const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

/// obsidian-git or an editor may hold the index for a moment
const INDEX_LOCK_RETRY: Duration = Duration::from_secs(1);

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct NotesSyncStatus {
    pub repo_root: Option<String>, // None when the folder isn't in a repo
    pub branch: Option<String>,    // None when detached
    pub upstream: Option<String>,
    pub changed: u32, // Uncommitted changes under the notes folder
    pub ahead: u32,
    pub behind: u32,
    pub busy: bool, // A rebase or merge is in progress
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct NotesSyncResult {
    pub committed: bool,
    pub pulled: bool,
    pub pushed: bool,
}

#[tauri::command]
pub(crate) async fn get_notes_sync_status(folder_path: String) -> Result<NotesSyncStatus, String> {
    let git = find_git().await?;
    read_status(&git, Path::new(&folder_path)).await
}

#[tauri::command]
pub(crate) async fn sync_notes(folder_path: String) -> Result<NotesSyncResult, String> {
    let git = find_git().await?;
    sync(&git, Path::new(&folder_path)).await
}

async fn find_git() -> Result<PathBuf, String> {
    find_executable("git")
        .await
        .ok_or_else(|| "git is not installed".to_string())
}

/// Paths below are relative to the notes folder, which every command runs in,
/// so "." means "only the notes".
async fn read_status(git: &Path, folder: &Path) -> Result<NotesSyncStatus, String> {
    let Some((repo_root, git_dir)) = find_repo(git, folder).await else {
        return Ok(NotesSyncStatus::default());
    };

    let porcelain = run_git(
        git,
        folder,
        &["status", "--porcelain=v2", "--branch", "--", "."],
        LOCAL_TIMEOUT,
    )
    .await?;

    let mut status = parse_status(&porcelain);
    status.repo_root = Some(repo_root);
    status.busy = is_busy(&git_dir);
    Ok(status)
}

async fn find_repo(git: &Path, folder: &Path) -> Option<(String, PathBuf)> {
    let output = run_git(
        git,
        folder,
        &["rev-parse", "--show-toplevel", "--absolute-git-dir"],
        LOCAL_TIMEOUT,
    )
    .await
    .ok()?;
    let mut lines = output.lines();
    let root = lines.next()?.to_string();
    let git_dir = PathBuf::from(lines.next()?);
    Some((root, git_dir))
}

fn is_busy(git_dir: &Path) -> bool {
    ["rebase-merge", "rebase-apply", "MERGE_HEAD"]
        .iter()
        .any(|name| git_dir.join(name).exists())
}

fn parse_status(porcelain: &str) -> NotesSyncStatus {
    let mut status = NotesSyncStatus::default();

    for line in porcelain.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            status.branch = (head != "(detached)").then(|| head.to_string());
        } else if let Some(upstream) = line.strip_prefix("# branch.upstream ") {
            status.upstream = Some(upstream.to_string());
        } else if let Some(counts) = line.strip_prefix("# branch.ab ") {
            for count in counts.split_whitespace() {
                if let Some(ahead) = count.strip_prefix('+') {
                    status.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = count.strip_prefix('-') {
                    status.behind = behind.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            status.changed += 1;
        }
    }

    status
}

fn repo_locks() -> &'static Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(Default::default)
}

async fn sync(git: &Path, folder: &Path) -> Result<NotesSyncResult, String> {
    let Some((repo_root, git_dir)) = find_repo(git, folder).await else {
        return Err("The notes folder isn't in a git repository".to_string());
    };

    // A manual sync and an automatic one must not interleave
    let lock = repo_locks()
        .lock()
        .map_err(|e| e.to_string())?
        .entry(repo_root.clone())
        .or_default()
        .clone();
    let _guard = lock.lock().await;

    let repo_name = Path::new(&repo_root)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| repo_root.clone());
    if is_busy(&git_dir) {
        return Err(format!("Finish the rebase in {repo_name} first"));
    }

    let mut result = NotesSyncResult {
        committed: commit_notes(git, folder).await?,
        ..Default::default()
    };

    let status = read_status(git, folder).await?;
    let Some(upstream) = status.upstream else {
        return Ok(result);
    };

    pull(git, folder, &upstream).await?;
    result.pulled = true;

    let ahead = run_git(
        git,
        folder,
        &["rev-list", "--count", "@{upstream}..HEAD"],
        LOCAL_TIMEOUT,
    )
    .await?;
    if ahead.trim().parse::<u32>().unwrap_or(0) > 0 {
        run_git(git, folder, &["push", "--quiet"], NETWORK_TIMEOUT).await?;
        result.pushed = true;
    }

    Ok(result)
}

/// Commits everything under the notes folder, and nothing else even if other
/// files are already staged. Returns whether there was anything to commit.
async fn commit_notes(git: &Path, folder: &Path) -> Result<bool, String> {
    run_git_retrying(git, folder, &["add", "--all", "--", "."]).await?;

    let staged = git_output(
        git,
        folder,
        &["diff", "--cached", "--quiet", "--", "."],
        LOCAL_TIMEOUT,
    )
    .await?;
    if staged.status.success() {
        return Ok(false);
    }

    let message = format!("notes: {}", chrono::Local::now().format("%Y-%m-%d %H:%M"));
    run_git_retrying(
        git,
        folder,
        &["commit", "--quiet", "-m", &message, "--", "."],
    )
    .await?;
    Ok(true)
}

/// Rebases onto the upstream. A conflict is aborted rather than left for the
/// user to find half-done; the notes commit stays safe locally.
async fn pull(git: &Path, folder: &Path, upstream: &str) -> Result<(), String> {
    let pulled = run_git(
        git,
        folder,
        &["pull", "--rebase", "--autostash", "--quiet"],
        NETWORK_TIMEOUT,
    )
    .await;
    let Err(error) = pulled else {
        return Ok(());
    };

    let Some((_, git_dir)) = find_repo(git, folder).await else {
        return Err(error);
    };
    if !is_busy(&git_dir) {
        return Err(error); // Offline or rejected, nothing to undo
    }

    let conflicts = run_git(
        git,
        folder,
        &["diff", "--name-only", "--diff-filter=U"],
        LOCAL_TIMEOUT,
    )
    .await
    .unwrap_or_default();
    let _ = run_git(git, folder, &["rebase", "--abort"], LOCAL_TIMEOUT).await;

    let files: Vec<&str> = conflicts.lines().collect();
    Err(if files.is_empty() {
        format!("Couldn't rebase onto {upstream}. Your notes are committed locally.")
    } else {
        format!(
            "Couldn't rebase onto {upstream}: conflict in {}. Your notes are committed locally.",
            files.join(", ")
        )
    })
}

async fn run_git_retrying(git: &Path, folder: &Path, args: &[&str]) -> Result<String, String> {
    match run_git(git, folder, args, LOCAL_TIMEOUT).await {
        Err(error) if error.contains("index.lock") => {
            tokio::time::sleep(INDEX_LOCK_RETRY).await;
            run_git(git, folder, args, LOCAL_TIMEOUT).await
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn git_path() -> PathBuf {
        block_on(find_executable("git")).unwrap()
    }

    fn git(cwd: &Path, args: &[&str]) -> String {
        let output = Command::new(git_path())
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    /// A bare origin and clones of it, each with a "Daily Notes" folder.
    struct Remote {
        root: PathBuf,
    }

    impl Remote {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "stream-notes-sync-{}-{}",
                name,
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            git(
                &root,
                &["init", "--quiet", "--bare", "-b", "main", "origin.git"],
            );

            let remote = Self { root };
            let seed = remote.clone_as("seed");
            write(&seed, "Daily Notes/2026-11-05.md", "first\n");
            write(&seed, "README.md", "vault\n");
            git(&seed, &["add", "--all"]);
            git(&seed, &["commit", "--quiet", "-m", "seed"]);
            git(&seed, &["push", "--quiet", "-u", "origin", "main"]);
            remote
        }

        fn clone_as(&self, name: &str) -> PathBuf {
            git(&self.root, &["clone", "--quiet", "origin.git", name]);
            let path = self.root.join(name);
            git(&path, &["config", "user.name", "Test"]);
            git(&path, &["config", "user.email", "test@example.com"]);
            git(&path, &["config", "commit.gpgsign", "false"]);
            path
        }
    }

    impl Drop for Remote {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn write(repo: &Path, file: &str, content: &str) {
        let path = repo.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn notes(repo: &Path) -> PathBuf {
        repo.join("Daily Notes")
    }

    fn status(folder: &Path) -> NotesSyncStatus {
        block_on(read_status(&git_path(), folder)).unwrap()
    }

    fn sync_now(folder: &Path) -> Result<NotesSyncResult, String> {
        block_on(sync(&git_path(), folder))
    }

    #[test]
    fn parses_branch_counts_and_changes() {
        let status = parse_status(
            "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b Daily Notes/a.md\n? Daily Notes/b.md\n",
        );

        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind, status.changed), (2, 1, 2));
    }

    #[test]
    fn a_folder_outside_any_repo_has_no_repo() {
        let folder = std::env::temp_dir().join(format!("stream-no-repo-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();

        assert_eq!(status(&folder), NotesSyncStatus::default());
        assert!(sync_now(&folder).is_err());

        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn status_counts_only_changes_under_the_notes_folder() {
        let remote = Remote::new("status");
        let clone = remote.clone_as("clone");
        write(&clone, "Daily Notes/2026-11-05.md", "edited\n");
        write(&clone, "README.md", "edited elsewhere\n");

        let status = status(&notes(&clone));

        assert_eq!(status.changed, 1);
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert!(status.repo_root.is_some());
        assert!(!status.busy);
    }

    #[test]
    fn commits_only_the_notes_and_pushes_them() {
        let remote = Remote::new("scope");
        let clone = remote.clone_as("clone");
        write(&clone, "Daily Notes/2026-11-05.md", "edited\n");
        write(&clone, "Daily Notes/new.md", "new\n");
        write(&clone, "README.md", "staged elsewhere\n");
        git(&clone, &["add", "README.md"]);

        let result = sync_now(&notes(&clone)).unwrap();

        assert_eq!(
            result,
            NotesSyncResult {
                committed: true,
                pulled: true,
                pushed: true
            }
        );
        let files = git(&clone, &["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(files, "Daily Notes/2026-11-05.md\nDaily Notes/new.md");
        // The autostash brings it back unstaged, which is fine: it's not committed
        assert_eq!(git(&clone, &["status", "--porcelain"]), "M README.md");
        assert_eq!(
            git(&clone, &["rev-parse", "HEAD"]),
            git(&remote.root.join("origin.git"), &["rev-parse", "main"])
        );
    }

    #[test]
    fn commits_deleted_notes() {
        let remote = Remote::new("delete");
        let clone = remote.clone_as("clone");
        std::fs::remove_file(clone.join("Daily Notes/2026-11-05.md")).unwrap();

        sync_now(&notes(&clone)).unwrap();

        assert_eq!(git(&clone, &["status", "--porcelain"]), "");
    }

    #[test]
    fn rebases_onto_new_remote_commits_and_keeps_other_edits() {
        let remote = Remote::new("rebase");
        let mine = remote.clone_as("mine");
        let theirs = remote.clone_as("theirs");
        write(&theirs, "README.md", "theirs\n");
        git(&theirs, &["commit", "--quiet", "-am", "theirs"]);
        git(&theirs, &["push", "--quiet"]);
        write(&mine, "Daily Notes/2026-11-06.md", "mine\n");
        write(&mine, "Home.md", "untracked elsewhere\n");
        std::fs::write(mine.join("README.md"), "vault\nwip\n").ok();

        let result = sync_now(&notes(&mine)).unwrap();

        assert!(result.committed && result.pushed);
        let log = git(&mine, &["log", "--format=%s", "-3"]);
        assert!(log.starts_with("notes: "), "{log}");
        assert!(log.contains("theirs"), "{log}");
        assert_eq!(
            git(&mine, &["rev-list", "--merges", "--count", "HEAD"]),
            "0"
        );
        // The autostash puts my uncommitted edit outside the notes back
        assert!(std::fs::read_to_string(mine.join("README.md"))
            .unwrap()
            .contains("wip"));
    }

    #[test]
    fn a_conflict_is_aborted_and_the_commit_kept() {
        let remote = Remote::new("conflict");
        let mine = remote.clone_as("mine");
        let theirs = remote.clone_as("theirs");
        write(&theirs, "Daily Notes/2026-11-05.md", "theirs\n");
        git(&theirs, &["commit", "--quiet", "-am", "theirs"]);
        git(&theirs, &["push", "--quiet"]);
        write(&mine, "Daily Notes/2026-11-05.md", "mine\n");

        let error = sync_now(&notes(&mine)).unwrap_err();

        assert!(
            error.contains("conflict in Daily Notes/2026-11-05.md"),
            "{error}"
        );
        let status = status(&notes(&mine));
        assert!(!status.busy);
        assert_eq!(status.changed, 0);
        assert!(git(&mine, &["log", "-1", "--format=%s"]).starts_with("notes: "));
    }

    #[test]
    fn without_an_upstream_it_commits_but_does_not_push() {
        let remote = Remote::new("local");
        let clone = remote.clone_as("clone");
        git(&clone, &["switch", "--quiet", "-c", "local"]);
        write(&clone, "Daily Notes/2026-11-05.md", "edited\n");

        let result = sync_now(&notes(&clone)).unwrap();

        assert_eq!(
            result,
            NotesSyncResult {
                committed: true,
                pulled: false,
                pushed: false
            }
        );
    }

    #[test]
    fn nothing_to_do_pulls_but_does_not_commit_or_push() {
        let remote = Remote::new("clean");
        let clone = remote.clone_as("clone");

        let result = sync_now(&notes(&clone)).unwrap();

        assert_eq!(
            result,
            NotesSyncResult {
                committed: false,
                pulled: true,
                pushed: false
            }
        );
    }

    /// Reads a real notes folder's status without changing anything. Run with
    /// `FOLDER=/path cargo test status_of_real_folder -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn status_of_real_folder() {
        let folder = PathBuf::from(std::env::var("FOLDER").unwrap());

        println!("{:#?}", status(&folder));
    }

    #[test]
    fn refuses_to_sync_mid_rebase() {
        let remote = Remote::new("busy");
        let clone = remote.clone_as("clone");
        std::fs::create_dir_all(clone.join(".git/rebase-merge")).unwrap();

        let error = sync_now(&notes(&clone)).unwrap_err();

        assert!(error.starts_with("Finish the rebase in clone"), "{error}");
    }
}
