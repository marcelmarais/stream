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

/// The last few moves of a turn fit here, unless a tool returned something huge
const ACTIVITY_WINDOW: u64 = 256 * 1024;

const ACTIVITY_MAX_CHARS: usize = 80;

const CLAUDE_CHAT_URL: &str = "claude://code/continue?session=";
const CODEX_CHAT_URL: &str = "codex://threads/";

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
    /// What it's doing now, or what it's waiting for
    pub activity: Option<String>,
    pub chat: Option<ChatLink>,
}

/// Where the conversation lives: a link into the app, or the app running it
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChatLink {
    pub target: String,
    pub app: String,
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
    activity: Option<String>,
    chat: Option<ChatLink>,
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

/// Bring an agent's chat to the front. Only opens what `list_running_agents`
/// hands out, so this can't be used to open anything else.
#[tauri::command]
pub(crate) async fn open_agent_chat(target: String) -> Result<(), String> {
    if !is_chat_target(&target) {
        return Err("Not an agent chat".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let status = Command::new("/usr/bin/open")
            .arg(&target)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("Couldn't open {target}"))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn is_chat_target(target: &str) -> bool {
    target.starts_with(CLAUDE_CHAT_URL)
        || target.starts_with(CODEX_CHAT_URL)
        || (target.starts_with('/') && target.ends_with(".app") && Path::new(target).is_dir())
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
    waiting_for: Option<String>,
    host_session_id: Option<String>,
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

            let transcript = claude_transcript(home, &session.session_id);
            let activity = match status {
                AgentStatus::Working => transcript.as_deref().and_then(claude_activity),
                AgentStatus::Waiting => session.waiting_for.clone(),
            };

            Some(Session {
                title: claude_title(transcript.as_deref(), &session),
                chat: claude_chat(&session),
                id: session.session_id,
                kind: AgentKind::Claude,
                status,
                cwd: session.cwd,
                since: session.status_updated_at,
                activity,
            })
        })
        .collect()
}

/// A session that moves into a worktree keeps writing to the folder it started
/// in, and can leave a stale copy under its new one, so the newest file wins
fn claude_transcript(home: &Path, session_id: &str) -> Option<PathBuf> {
    fs::read_dir(home.join(".claude/projects"))
        .ok()?
        .flatten()
        .map(|project| project.path().join(format!("{session_id}.jsonl")))
        .filter_map(|path| Some((fs::metadata(&path).ok()?.modified().ok()?, path)))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// A `derived` name is a placeholder like `stream-26`, used until the chat has
/// a real title, so prefer the title in the transcript when there is one
fn claude_title(transcript: Option<&Path>, session: &ClaudeSession) -> Option<String> {
    let name = session.name.clone().filter(|name| !name.is_empty());
    let from_transcript = || transcript.and_then(transcript_title);

    if session.name_source.as_deref() == Some("derived") {
        from_transcript().or(name)
    } else {
        name.or_else(from_transcript)
    }
}

/// Desktop sessions open in the Claude app. A terminal session has no chat
/// there, so the best one click can do is bring its terminal forward.
fn claude_chat(session: &ClaudeSession) -> Option<ChatLink> {
    match session.host_session_id.as_deref() {
        Some(id) if id.starts_with("local_") => Some(ChatLink {
            target: format!("{CLAUDE_CHAT_URL}{id}"),
            app: "Claude".to_string(),
        }),
        _ => running_app(session.pid),
    }
}

/// The app a process was started from, found by walking up its parents
fn running_app(pid: u32) -> Option<ChatLink> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,comm="])
        .stderr(Stdio::null())
        .output()
        .ok()?;

    enclosing_app(pid, &String::from_utf8_lossy(&output.stdout))
}

fn enclosing_app(pid: u32, process_list: &str) -> Option<ChatLink> {
    let processes: HashMap<u32, (u32, &str)> =
        process_list.lines().filter_map(parse_process).collect();

    let mut current = pid;
    for _ in 0..processes.len() {
        let (parent, command) = processes.get(&current)?;
        if let Some(end) = command.find(".app/") {
            let bundle = &command[..end + ".app".len()];
            return Some(ChatLink {
                target: bundle.to_string(),
                app: Path::new(bundle).file_stem()?.to_str()?.to_string(),
            });
        }
        current = *parent;
    }

    None
}

fn parse_process(line: &str) -> Option<(u32, (u32, &str))> {
    let (pid, rest) = line.trim_start().split_once(char::is_whitespace)?;
    let (parent, command) = rest.trim_start().split_once(char::is_whitespace)?;
    Some((
        pid.parse().ok()?,
        (parent.parse().ok()?, command.trim_start()),
    ))
}

/// The latest tool call of the running turn, in words
fn claude_activity(transcript: &Path) -> Option<String> {
    let tail = read_tail(transcript, ACTIVITY_WINDOW)?;

    tail.lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|record| record["isSidechain"] != true)
        .take_while(|record| !is_user_prompt(record))
        .filter(|record| record["type"] == "assistant")
        .find_map(|record| {
            record["message"]["content"]
                .as_array()?
                .iter()
                .rev()
                .find_map(describe_tool)
        })
}

/// Tool results come back as user lines too, but they don't start a turn
fn is_user_prompt(record: &Value) -> bool {
    record["type"] == "user"
        && !record["message"]["content"]
            .as_array()
            .is_some_and(|blocks| blocks.iter().any(|block| block["type"] == "tool_result"))
}

fn describe_tool(block: &Value) -> Option<String> {
    if block["type"] != "tool_use" {
        return None;
    }

    let input = &block["input"];
    let file_name = || {
        let path = input["file_path"].as_str()?;
        Path::new(path).file_name()?.to_str()
    };

    let activity = match block["name"].as_str()? {
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => format!("Editing {}", file_name()?),
        "Read" => format!("Reading {}", file_name()?),
        "Bash" => input["description"]
            .as_str()
            .unwrap_or("Running a command")
            .to_string(),
        "Grep" | "Glob" => "Searching the code".to_string(),
        "WebSearch" | "WebFetch" => "Reading the web".to_string(),
        "Agent" | "Task" => "Running a subagent".to_string(),
        _ => return None,
    };

    Some(one_line(&activity))
}

fn one_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default().trim();

    if line.chars().count() <= ACTIVITY_MAX_CHARS {
        return line.to_string();
    }
    let cut: String = line.chars().take(ACTIVITY_MAX_CHARS).collect();
    format!("{}…", cut.trim_end())
}

fn transcript_title(transcript: &Path) -> Option<String> {
    let tail = read_tail(transcript, TRANSCRIPT_WINDOW)?;

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
        chat: Some(ChatLink {
            target: format!("{CODEX_CHAT_URL}{id}"),
            app: "Codex".to_string(),
        }),
        activity: codex_activity(rollout),
        id,
        kind: AgentKind::Codex,
        status: AgentStatus::Working,
        title: None,
        cwd,
        since,
    })
}

/// Codex's tool calls are scripts, which don't read well, but it narrates what
/// it's doing in short commentary messages as it goes
fn codex_activity(rollout: &Path) -> Option<String> {
    let tail = read_tail(rollout, ACTIVITY_WINDOW)?;

    tail.lines()
        .rev()
        .take_while(|line| !line.contains(TURN_EVENTS[0]))
        .filter(|line| line.contains(r#""phase":"commentary""#))
        .find_map(|line| {
            let record: Value = serde_json::from_str(line).ok()?;
            if record["payload"]["type"] != "message" {
                return None;
            }
            let text = record["payload"]["content"][0]["text"].as_str()?;
            Some(one_line(text))
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
                activity: session.activity,
                chat: session.chat,
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
            activity: None,
            chat: None,
        }
    }

    fn assistant_tool(name: &str, input: Value) -> Value {
        json!({
            "type": "assistant",
            "message": { "content": [{ "type": "tool_use", "name": name, "input": input }] },
        })
    }

    fn write_transcript(home: &TempHome, project: &str, session: &str, lines: &[Value]) -> PathBuf {
        let folder = home.0.join(".claude/projects").join(project);
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("{session}.jsonl"));
        let lines: Vec<String> = lines.iter().map(Value::to_string).collect();
        fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn commentary(text: &str) -> Value {
        json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "phase": "commentary",
                "content": [{ "type": "output_text", "text": text }],
            },
        })
    }

    #[test]
    fn describes_the_latest_claude_tool_call() {
        let home = TempHome::new();
        let tool_result = json!({
            "type": "user",
            "message": { "content": [{ "type": "tool_result" }] },
        });
        let transcript = write_transcript(
            &home,
            "project",
            "one",
            &[
                assistant_tool("Read", json!({ "file_path": "/repo/src/first.rs" })),
                tool_result,
                assistant_tool("Edit", json!({ "file_path": "/repo/src/second.rs" })),
                assistant_tool("mcp__plan__update", json!({})),
            ],
        );

        assert_eq!(
            claude_activity(&transcript).as_deref(),
            Some("Editing second.rs")
        );
    }

    #[test]
    fn uses_the_description_of_a_claude_command() {
        let home = TempHome::new();
        let transcript = write_transcript(
            &home,
            "project",
            "one",
            &[assistant_tool(
                "Bash",
                json!({ "command": "cargo test", "description": "Run the tests" }),
            )],
        );

        assert_eq!(
            claude_activity(&transcript).as_deref(),
            Some("Run the tests")
        );
    }

    #[test]
    fn a_new_prompt_clears_the_last_turns_activity() {
        let home = TempHome::new();
        let prompt = json!({ "type": "user", "message": { "content": "next task" } });
        let transcript = write_transcript(
            &home,
            "project",
            "one",
            &[
                assistant_tool("Read", json!({ "file_path": "/repo/old.rs" })),
                prompt,
            ],
        );

        assert_eq!(claude_activity(&transcript), None);
    }

    #[test]
    fn ignores_subagent_tool_calls() {
        let home = TempHome::new();
        let mut subagent = assistant_tool("Read", json!({ "file_path": "/repo/sub.rs" }));
        subagent["isSidechain"] = json!(true);
        let transcript = write_transcript(
            &home,
            "project",
            "one",
            &[
                assistant_tool("Read", json!({ "file_path": "/repo/main.rs" })),
                subagent,
            ],
        );

        assert_eq!(
            claude_activity(&transcript).as_deref(),
            Some("Reading main.rs")
        );
    }

    #[test]
    fn finds_a_transcript_left_in_the_folder_the_session_started_in() {
        let home = TempHome::new();
        let stale = write_transcript(&home, "worktree", "one", &[]);
        let live = write_transcript(&home, "project", "one", &[]);
        let earlier = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(earlier)
            .unwrap();

        assert_eq!(claude_transcript(&home.0, "one"), Some(live));
    }

    #[test]
    fn links_a_desktop_session_to_its_chat() {
        let home = TempHome::new();
        home.add_claude(
            1,
            json!({ "status": "busy", "hostSessionId": "local_abc-123" }),
        );

        let sessions = claude_sessions(&home.0, |_| true);

        assert_eq!(
            sessions[0].chat,
            Some(ChatLink {
                target: "claude://code/continue?session=local_abc-123".to_string(),
                app: "Claude".to_string(),
            })
        );
    }

    #[test]
    fn shows_what_a_claude_session_is_waiting_for() {
        let home = TempHome::new();
        home.add_claude(
            1,
            json!({ "status": "waiting", "waitingFor": "approve Bash" }),
        );

        let sessions = claude_sessions(&home.0, |_| true);

        assert_eq!(sessions[0].activity.as_deref(), Some("approve Bash"));
    }

    #[test]
    fn finds_the_app_a_terminal_session_runs_in() {
        let processes = "\
            1 0 /sbin/launchd\n\
            50 1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\n\
            60 50 login\n\
            70 60 -zsh\n\
            80 70 /Users/me/.local/bin/claude\n";

        assert_eq!(
            enclosing_app(80, processes),
            Some(ChatLink {
                target: "/System/Applications/Utilities/Terminal.app".to_string(),
                app: "Terminal".to_string(),
            })
        );
    }

    #[test]
    fn keeps_spaces_in_an_app_name_and_stops_at_the_outer_app() {
        let processes = "\
            1 0 /sbin/launchd\n\
            50 1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n\
            60 50 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper\n\
            80 60 /Users/me/.local/bin/claude\n";

        assert_eq!(
            enclosing_app(80, processes).map(|chat| chat.app),
            Some("Visual Studio Code".to_string())
        );
    }

    #[test]
    fn has_no_app_for_a_session_outside_one() {
        let processes = "1 0 /sbin/launchd\n80 1 /usr/bin/tmux\n90 80 claude\n";

        assert_eq!(enclosing_app(90, processes), None);
    }

    #[test]
    fn only_opens_chats_and_apps() {
        let home = TempHome::new();
        let app = home.0.join("Terminal.app");
        fs::create_dir_all(&app).unwrap();

        assert!(is_chat_target("claude://code/continue?session=local_one"));
        assert!(is_chat_target("codex://threads/one"));
        assert!(is_chat_target(app.to_str().unwrap()));

        assert!(!is_chat_target("https://example.com"));
        assert!(!is_chat_target("/Applications/Missing.app"));
        assert!(!is_chat_target("/etc/passwd"));
        assert!(!is_chat_target("claude://claude.ai/new"));
    }

    #[test]
    fn reads_the_latest_codex_commentary_of_the_running_turn() {
        let home = TempHome::new();
        let rollout = home.add_rollout(
            "one",
            "/repo",
            json!("vscode"),
            &[
                commentary("From the last turn"),
                turn("task_started"),
                commentary("I'll check the panel.\nThen fix it."),
            ],
        );

        let sessions = codex_sessions(&home.0, &[rollout]);

        assert_eq!(
            sessions[0].activity.as_deref(),
            Some("I'll check the panel.")
        );
        assert_eq!(
            sessions[0].chat.as_ref().map(|chat| chat.target.as_str()),
            Some("codex://threads/one")
        );
    }

    #[test]
    fn a_new_codex_turn_clears_the_last_activity() {
        let home = TempHome::new();
        let rollout = home.add_rollout(
            "one",
            "/repo",
            json!("vscode"),
            &[commentary("From the last turn"), turn("task_started")],
        );

        let sessions = codex_sessions(&home.0, &[rollout]);

        assert_eq!(sessions[0].activity, None);
    }

    #[test]
    fn shortens_long_activity() {
        let activity = one_line(&"word ".repeat(40));

        assert!(activity.ends_with('…'));
        assert!(activity.chars().count() <= ACTIVITY_MAX_CHARS + 1);
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
        let title = json!({ "type": "ai-title", "aiTitle": "Add agent presence" });
        write_transcript(
            &home,
            "-Users-me--claude-worktrees-one",
            "session-1",
            &[title],
        );

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
