use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use chrono::DateTime;
use git2::Repository;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

/// How far back to look for the current Codex turn. Idle threads end in a turn
/// event, so the first window is nearly always enough even on a huge rollout.
const ROLLOUT_WINDOWS: &[u64] = &[64 * 1024, 1024 * 1024, 16 * 1024 * 1024];

/// Generated titles are written near the start of a turn
const TRANSCRIPT_WINDOW: u64 = 1024 * 1024;

/// Inner quotes are escaped in chat text, so these only match real events
const TURN_EVENTS: &[&str] = &[
    r#""type":"task_started""#,
    r#""type":"task_complete""#,
    r#""type":"turn_aborted""#,
];

const CLAUDE_TITLE_EVENTS: &[&str] = &[r#""type":"custom-title""#, r#""type":"ai-title""#];

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Working,
    Waiting,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct RunningAgent {
    pub id: String,
    pub kind: AgentKind,
    pub status: AgentStatus,
    pub title: Option<String>,
    pub repo_path: String,
    pub branch: Option<String>,
    /// When the current turn or wait began, in Unix milliseconds
    pub since: Option<u64>,
}

/// A running agent before it's matched to a connected repository
#[derive(Debug)]
struct Session {
    id: String,
    kind: AgentKind,
    status: AgentStatus,
    title: Option<String>,
    cwd: PathBuf,
    since: Option<u64>,
}

/// List Claude Code and Codex sessions working in `repo_paths`. Both tools keep
/// this state in private files that can change, so anything unreadable is
/// skipped and the app shows no agent rather than an error.
#[tauri::command]
pub(crate) async fn list_running_agents(
    app: tauri::AppHandle,
    repo_paths: Vec<String>,
) -> Result<Vec<RunningAgent>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut sessions = claude_sessions(&home, process_is_alive);
        sessions.extend(codex_sessions(&home, &open_rollouts(&home)));
        place_in_repos(sessions, &repo_paths)
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSession {
    pid: u32,
    session_id: String,
    cwd: PathBuf,
    status: Option<String>,
    name: Option<String>,
    name_source: Option<String>,
    status_updated_at: Option<u64>,
}

/// Claude Code keeps one file per process. A killed process leaves its file
/// behind for a while, still saying busy, so check the process is alive.
fn claude_sessions(home: &Path, is_alive: impl Fn(u32) -> bool) -> Vec<Session> {
    let Ok(entries) = fs::read_dir(home.join(".claude/sessions")) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().is_none_or(|extension| extension != "json") {
                return None;
            }

            let session: ClaudeSession = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
            let status = match session.status.as_deref() {
                Some("busy") => AgentStatus::Working,
                Some("waiting") => AgentStatus::Waiting,
                _ => return None,
            };

            if !is_alive(session.pid) {
                return None;
            }

            Some(Session {
                title: claude_title(home, &session),
                id: session.session_id,
                kind: AgentKind::Claude,
                status,
                cwd: session.cwd,
                since: session.status_updated_at,
            })
        })
        .collect()
}

/// A `derived` name is a placeholder like `stream-26`, used until the chat has
/// a real title, so prefer the title in the transcript when there is one
fn claude_title(home: &Path, session: &ClaudeSession) -> Option<String> {
    let name = session.name.clone().filter(|name| !name.is_empty());

    if session.name_source.as_deref() == Some("derived") {
        transcript_title(home, session).or(name)
    } else {
        name.or_else(|| transcript_title(home, session))
    }
}

fn transcript_title(home: &Path, session: &ClaudeSession) -> Option<String> {
    let project: String = session
        .cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let transcript = home
        .join(".claude/projects")
        .join(project)
        .join(format!("{}.jsonl", session.session_id));

    let tail = read_tail(&transcript, TRANSCRIPT_WINDOW)?;

    tail.lines()
        .rev()
        .filter(|line| CLAUDE_TITLE_EVENTS.iter().any(|event| line.contains(event)))
        .find_map(|line| {
            let record: Value = serde_json::from_str(line).ok()?;
            let title = record
                .get("customTitle")
                .or_else(|| record.get("aiTitle"))?
                .as_str()?;
            Some(title.to_string())
        })
}

fn process_is_alive(pid: u32) -> bool {
    Command::new("/bin/ps")
        .args(["-p", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// A Codex process keeps the rollout of every loaded thread open, working or
/// not, and starting another app-server wouldn't show threads loaded elsewhere
fn open_rollouts(home: &Path) -> Vec<PathBuf> {
    let sessions = home.join(".codex/sessions");
    if !sessions.is_dir() {
        return Vec::new();
    }

    let Ok(output) = Command::new("/usr/sbin/lsof")
        .args(["-c", "codex", "-Fn"])
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };

    let open: HashSet<PathBuf> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix('n'))
        .map(PathBuf::from)
        .filter(|path| {
            path.starts_with(&sessions)
                && path
                    .extension()
                    .is_some_and(|extension| extension == "jsonl")
        })
        .collect();

    open.into_iter().collect()
}

fn codex_sessions(home: &Path, rollouts: &[PathBuf]) -> Vec<Session> {
    let mut sessions: Vec<Session> = rollouts
        .iter()
        .filter_map(|rollout| codex_session(rollout))
        .collect();

    if !sessions.is_empty() {
        let mut titles = codex_titles(home);
        for session in &mut sessions {
            session.title = titles.remove(&session.id);
        }
    }

    sessions
}

/// Approval requests aren't written to the rollout, so a Codex thread waiting
/// for an answer reads as working
fn codex_session(rollout: &Path) -> Option<Session> {
    let since = current_turn(rollout)?;
    let (id, cwd) = rollout_meta(rollout)?;

    Some(Session {
        id,
        kind: AgentKind::Codex,
        status: AgentStatus::Working,
        title: None,
        cwd,
        since,
    })
}

enum TurnEvent {
    Started(Option<u64>),
    Ended,
}

/// When the running turn started, or `None` if no turn is running
fn current_turn(rollout: &Path) -> Option<Option<u64>> {
    let event = ROLLOUT_WINDOWS.iter().find_map(|window| {
        read_tail(rollout, *window)?
            .lines()
            .rev()
            .find_map(turn_event)
    })?;

    match event {
        TurnEvent::Started(since) => Some(since),
        TurnEvent::Ended => None,
    }
}

fn turn_event(line: &str) -> Option<TurnEvent> {
    if !TURN_EVENTS.iter().any(|event| line.contains(event)) {
        return None;
    }

    let record: Value = serde_json::from_str(line).ok()?;
    if record["type"] != "event_msg" {
        return None;
    }

    match record["payload"]["type"].as_str()? {
        "task_started" => {
            let since = record["timestamp"]
                .as_str()
                .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
                .map(|time| time.timestamp_millis() as u64);
            Some(TurnEvent::Started(since))
        }
        "task_complete" | "turn_aborted" => Some(TurnEvent::Ended),
        _ => None,
    }
}

/// The thread id and working folder. Subagents work for a parent thread that's
/// already listed, so they're left out.
fn rollout_meta(rollout: &Path) -> Option<(String, PathBuf)> {
    let mut first_line = String::new();
    BufReader::new(File::open(rollout).ok()?)
        .read_line(&mut first_line)
        .ok()?;

    let record: Value = serde_json::from_str(&first_line).ok()?;
    if record["type"] != "session_meta" {
        return None;
    }

    let meta = &record["payload"];
    if meta["source"].get("subagent").is_some() {
        return None;
    }

    Some((
        meta["id"].as_str()?.to_string(),
        PathBuf::from(meta["cwd"].as_str()?),
    ))
}

/// Renames append to the index, so the last entry for a thread wins
fn codex_titles(home: &Path) -> HashMap<String, String> {
    let Ok(index) = fs::read_to_string(home.join(".codex/session_index.jsonl")) else {
        return HashMap::new();
    };

    index
        .lines()
        .filter_map(|line| {
            let entry: Value = serde_json::from_str(line).ok()?;
            Some((
                entry["id"].as_str()?.to_string(),
                entry["thread_name"].as_str()?.to_string(),
            ))
        })
        .collect()
}

/// Up to `window` bytes from the end of a file. The first line may be cut off.
fn read_tail(path: &Path, window: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(window)))
        .ok()?;

    let mut tail = Vec::new();
    file.read_to_end(&mut tail).ok()?;
    Some(String::from_utf8_lossy(&tail).into_owned())
}

/// Keep the sessions working in a connected repository, and add their branch.
/// A linked worktree counts as the repository it belongs to.
fn place_in_repos(sessions: Vec<Session>, repo_paths: &[String]) -> Vec<RunningAgent> {
    let connected: HashMap<PathBuf, &String> = repo_paths
        .iter()
        .filter_map(|path| Some((fs::canonicalize(path).ok()?, path)))
        .collect();

    let mut agents: Vec<RunningAgent> = sessions
        .into_iter()
        .filter_map(|session| {
            let repo = Repository::discover(&session.cwd).ok()?;
            let repo_path = connected_repo(&repo, &connected)?.clone();

            Some(RunningAgent {
                branch: current_branch(&repo),
                id: session.id,
                kind: session.kind,
                status: session.status,
                title: session.title,
                repo_path,
                since: session.since,
            })
        })
        .collect();

    agents.sort_by(|a, b| a.since.cmp(&b.since).then_with(|| a.id.cmp(&b.id)));
    agents
}

fn connected_repo<'a>(
    repo: &Repository,
    connected: &HashMap<PathBuf, &'a String>,
) -> Option<&'a String> {
    [repo.workdir().map(Path::to_path_buf), main_repo_root(repo)]
        .into_iter()
        .flatten()
        .find_map(|root| connected.get(&fs::canonicalize(root).ok()?).copied())
}

/// A linked worktree's git directory has a `commondir` file pointing back to
/// the main repository's `.git`. Other repositories don't have one.
fn main_repo_root(repo: &Repository) -> Option<PathBuf> {
    let git_dir = repo.path();
    let common_dir = fs::read_to_string(git_dir.join("commondir"))
        .map(|pointer| git_dir.join(pointer.trim()))
        .unwrap_or_else(|_| git_dir.to_path_buf());

    fs::canonicalize(common_dir)
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

fn current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Signature, WorktreeAddOptions};
    use serde_json::json;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_DIR: AtomicU32 = AtomicU32::new(0);

    struct TempHome(PathBuf);

    impl TempHome {
        fn new() -> Self {
            let id = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "stream-agents-test-{}-{}",
                std::process::id(),
                id
            ));
            fs::create_dir_all(dir.join(".claude/sessions")).unwrap();
            fs::create_dir_all(dir.join(".codex/sessions")).unwrap();
            Self(fs::canonicalize(dir).unwrap())
        }

        fn add_claude(&self, pid: u32, session: Value) {
            let mut session = session;
            session["pid"] = json!(pid);
            session["sessionId"] = json!(format!("session-{pid}"));
            session
                .as_object_mut()
                .unwrap()
                .entry("cwd")
                .or_insert(json!("/repo"));
            fs::write(
                self.0.join(format!(".claude/sessions/{pid}.json")),
                session.to_string(),
            )
            .unwrap();
        }

        fn add_rollout(&self, id: &str, cwd: &str, source: Value, events: &[Value]) -> PathBuf {
            let meta = json!({
                "type": "session_meta",
                "payload": { "id": id, "cwd": cwd, "source": source },
            });
            let lines: Vec<String> = std::iter::once(&meta)
                .chain(events)
                .map(Value::to_string)
                .collect();
            let path = self.0.join(format!(".codex/sessions/rollout-{id}.jsonl"));
            fs::write(&path, lines.join("\n") + "\n").unwrap();
            path
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn turn(kind: &str) -> Value {
        json!({
            "timestamp": "2026-11-01T12:00:00.000Z",
            "type": "event_msg",
            "payload": { "type": kind },
        })
    }

    fn message(text: &str) -> Value {
        json!({ "type": "response_item", "payload": { "type": "message", "text": text } })
    }

    fn committed_repo(path: &Path) -> Repository {
        let repo = Repository::init(path).unwrap();
        {
            let signature = Signature::now("Test", "test@example.com").unwrap();
            let tree = repo.treebuilder(None).unwrap().write().unwrap();
            let tree = repo.find_tree(tree).unwrap();
            repo.commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
                .unwrap();
        }
        repo
    }

    fn session_in(cwd: &Path) -> Session {
        Session {
            id: "one".to_string(),
            kind: AgentKind::Claude,
            status: AgentStatus::Working,
            title: None,
            cwd: cwd.to_path_buf(),
            since: None,
        }
    }

    #[test]
    fn reads_busy_and_waiting_claude_sessions_only() {
        let home = TempHome::new();
        home.add_claude(1, json!({ "status": "busy", "name": "Working chat" }));
        home.add_claude(2, json!({ "status": "waiting", "name": "Waiting chat" }));
        home.add_claude(3, json!({ "status": "idle", "name": "Idle chat" }));

        let mut sessions = claude_sessions(&home.0, |_| true);
        sessions.sort_by(|a, b| a.id.cmp(&b.id));

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].title.as_deref(), Some("Working chat"));
        assert_eq!(sessions[0].status, AgentStatus::Working);
        assert_eq!(sessions[1].status, AgentStatus::Waiting);
    }

    #[test]
    fn skips_claude_sessions_left_behind_by_a_dead_process() {
        let home = TempHome::new();
        home.add_claude(1, json!({ "status": "busy" }));

        assert!(claude_sessions(&home.0, |_| false).is_empty());
    }

    #[test]
    fn skips_unreadable_claude_session_files() {
        let home = TempHome::new();
        fs::write(home.0.join(".claude/sessions/9.json"), "{ not json").unwrap();

        assert!(claude_sessions(&home.0, |_| true).is_empty());
    }

    #[test]
    fn prefers_the_transcript_title_over_a_derived_name() {
        let home = TempHome::new();
        let cwd = "/Users/me/.claude/worktrees/one";
        home.add_claude(
            1,
            json!({ "status": "busy", "name": "stream-26", "nameSource": "derived", "cwd": cwd }),
        );
        let project = home
            .0
            .join(".claude/projects/-Users-me--claude-worktrees-one");
        fs::create_dir_all(&project).unwrap();
        let title = json!({ "type": "ai-title", "aiTitle": "Add agent presence" });
        fs::write(project.join("session-1.jsonl"), format!("{title}\n")).unwrap();

        let sessions = claude_sessions(&home.0, |_| true);

        assert_eq!(sessions[0].title.as_deref(), Some("Add agent presence"));
    }

    #[test]
    fn keeps_a_derived_name_when_there_is_no_transcript_title() {
        let home = TempHome::new();
        home.add_claude(
            1,
            json!({ "status": "busy", "name": "stream-26", "nameSource": "derived" }),
        );

        let sessions = claude_sessions(&home.0, |_| true);

        assert_eq!(sessions[0].title.as_deref(), Some("stream-26"));
    }

    #[test]
    fn a_codex_thread_is_working_until_its_turn_ends() {
        let home = TempHome::new();
        let working =
            home.add_rollout("working", "/repo", json!("vscode"), &[turn("task_started")]);
        let finished = home.add_rollout(
            "finished",
            "/repo",
            json!("vscode"),
            &[turn("task_started"), turn("task_complete")],
        );
        let aborted = home.add_rollout(
            "aborted",
            "/repo",
            json!("vscode"),
            &[turn("task_started"), turn("turn_aborted")],
        );
        let never_started = home.add_rollout("empty", "/repo", json!("vscode"), &[]);

        let sessions = codex_sessions(&home.0, &[working, finished, aborted, never_started]);

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "working");
        assert_eq!(sessions[0].since, Some(1_793_534_400_000));
    }

    #[test]
    fn ignores_turn_events_quoted_in_chat_text() {
        let home = TempHome::new();
        let rollout = home.add_rollout(
            "quoted",
            "/repo",
            json!("vscode"),
            &[turn("task_started"), message(r#"{"type":"task_complete"}"#)],
        );

        assert_eq!(codex_sessions(&home.0, &[rollout]).len(), 1);
    }

    #[test]
    fn finds_the_turn_start_beyond_the_first_window() {
        let home = TempHome::new();
        let filler = "x".repeat(ROLLOUT_WINDOWS[0] as usize);
        let rollout = home.add_rollout(
            "long",
            "/repo",
            json!("vscode"),
            &[turn("task_started"), message(&filler)],
        );

        assert_eq!(codex_sessions(&home.0, &[rollout]).len(), 1);
    }

    #[test]
    fn leaves_out_codex_subagents() {
        let home = TempHome::new();
        let source = json!({ "subagent": { "thread_spawn": { "parent_thread_id": "one" } } });
        let rollout = home.add_rollout("child", "/repo", source, &[turn("task_started")]);

        assert!(codex_sessions(&home.0, &[rollout]).is_empty());
    }

    #[test]
    fn uses_the_latest_codex_title() {
        let home = TempHome::new();
        let index = [
            json!({ "id": "one", "thread_name": "First name" }),
            json!({ "id": "one", "thread_name": "Renamed" }),
        ]
        .map(|entry| entry.to_string())
        .join("\n");
        fs::write(home.0.join(".codex/session_index.jsonl"), index).unwrap();
        let rollout = home.add_rollout("one", "/repo", json!("cli"), &[turn("task_started")]);

        let sessions = codex_sessions(&home.0, &[rollout]);

        assert_eq!(sessions[0].title.as_deref(), Some("Renamed"));
    }

    #[test]
    fn places_a_session_in_a_subfolder_on_the_repo_and_branch() {
        let home = TempHome::new();
        let repo_path = home.0.join("project");
        let repo = committed_repo(&repo_path);
        let branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let subfolder = repo_path.join("src");
        fs::create_dir_all(&subfolder).unwrap();

        let connected = [repo_path.to_string_lossy().into_owned()];
        let agents = place_in_repos(vec![session_in(&subfolder)], &connected);

        assert_eq!(agents[0].repo_path, connected[0]);
        assert_eq!(agents[0].branch, Some(branch));
    }

    #[test]
    fn counts_a_linked_worktree_as_its_parent_repo() {
        let home = TempHome::new();
        let repo_path = home.0.join("project");
        let repo = committed_repo(&repo_path);
        let worktree_path = home.0.join("linked");
        repo.worktree("linked", &worktree_path, Some(&WorktreeAddOptions::new()))
            .unwrap();

        let connected = [repo_path.to_string_lossy().into_owned()];
        let agents = place_in_repos(vec![session_in(&worktree_path)], &connected);

        assert_eq!(agents[0].repo_path, connected[0]);
        assert_eq!(agents[0].branch.as_deref(), Some("linked"));
    }

    #[test]
    fn leaves_out_sessions_outside_connected_repos() {
        let home = TempHome::new();
        let connected_path = home.0.join("connected");
        committed_repo(&connected_path);
        let other = home.0.join("other");
        committed_repo(&other);

        let connected = [connected_path.to_string_lossy().into_owned()];

        assert!(place_in_repos(vec![session_in(&other)], &connected).is_empty());
    }

    /// Run with `cargo test agents_on_this_machine -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn agents_on_this_machine() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let mut sessions = claude_sessions(&home, process_is_alive);
        sessions.extend(codex_sessions(&home, &open_rollouts(&home)));
        for session in sessions {
            println!("{session:?}");
        }
    }
}
