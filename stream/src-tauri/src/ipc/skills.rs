use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::ipc::agents::AgentKind;

const SKILLS_DIR: &str = "Skills";
const SKILL_FILE: &str = "SKILL.md";

/// Enough of a long line to say where this came from
const ORIGIN_TEXT_MAX_CHARS: usize = 500;

/// Apps launched from Finder don't inherit the shell PATH, so look here first.
/// Relative paths are from the home folder.
const CLAUDE_CLI_PATHS: &[&str] = &[
    ".local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
];

/// The desktop app ships its own CLI, and doesn't put it on the PATH
const CODEX_CLI_PATHS: &[&str] = &[
    ".local/bin/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
];

#[derive(Debug, PartialEq, Serialize)]
pub struct Skill {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
}

/// Where a skill was picked, and which agent it goes to
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRun {
    agent: AgentKind,
    model: Option<String>,
    skill_name: String,
    folder_path: String,
    skill_path: String,
    note_path: String,
    line: usize,
    heading: Option<String>,
    text: Option<String>,
}

/// List the skills in the notes folder, creating `Skills` if it isn't there yet
#[tauri::command]
pub(crate) async fn list_skills(folder_path: String) -> Result<Vec<Skill>, String> {
    tauri::async_runtime::spawn_blocking(move || read_skills(Path::new(&folder_path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Run the skill in a new thread, with nothing on screen, and resolve when it
/// finishes. This goes through the CLI because the apps' links only fill in the
/// composer.
#[tauri::command]
pub(crate) async fn start_skill_thread(app: tauri::AppHandle, run: SkillRun) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || run_cli(&find_cli(run.agent, &home), &run))
        .await
        .map_err(|e| e.to_string())?
}

/// Goes through the user's shell because an app launched from Finder has a bare
/// PATH, and the agent's own commands need tools like gh
fn run_cli(cli: &str, run: &SkillRun) -> Result<(), String> {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    let status = Command::new(shell)
        .args(["-ilc", r#"exec "$0" "$@""#, cli])
        .args(cli_args(run))
        .current_dir(&run.folder_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Couldn't run {cli}: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("{cli} stopped with {status}"))
    }
}

/// Falls back to the bare name, so a missing CLI fails with a clear error
fn find_cli(agent: AgentKind, home: &Path) -> String {
    let (name, paths) = match agent {
        AgentKind::Claude => ("claude", CLAUDE_CLI_PATHS),
        AgentKind::Codex => ("codex", CODEX_CLI_PATHS),
    };

    paths
        .iter()
        .map(|path| home.join(path))
        .find(|path| path.is_file())
        .map_or_else(
            || name.to_string(),
            |path| path.to_string_lossy().into_owned(),
        )
}

/// Nobody is there to approve anything. Claude Code's auto mode doesn't ask and
/// keeps its safety checks, and Codex's sandbox limits it to writing in the notes
/// folder. Print mode rather than `--bg`, which would edit a worktree of the
/// notes repo instead of the notes.
fn cli_args(run: &SkillRun) -> Vec<String> {
    let mut args: Vec<String> = match run.agent {
        AgentKind::Claude => vec![
            "--print".to_string(),
            "--permission-mode".to_string(),
            "auto".to_string(),
            "--name".to_string(),
            run.skill_name.clone(),
        ],
        AgentKind::Codex => vec![
            "exec".to_string(),
            "--skip-git-repo-check".to_string(),
            "--sandbox".to_string(),
            "workspace-write".to_string(),
        ],
    };

    if let Some(model) = &run.model {
        args.extend(["--model".to_string(), model.clone()]);
    }

    args.push(skill_prompt(run));
    args
}

fn read_skills(folder: &Path) -> Result<Vec<Skill>, String> {
    let dir = folder.join(SKILLS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut skills: Vec<Skill> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| read_skill(&entry.path()))
        .collect();

    skills.sort_by_key(|skill| skill.name.to_lowercase());
    Ok(skills)
}

/// A skill is a folder with a `SKILL.md`, which is how Claude Code and Codex lay
/// them out so theirs can be copied straight in, or a single markdown file.
/// Anything else in the folder is ignored.
fn read_skill(path: &Path) -> Option<Skill> {
    let file = if path.is_dir() {
        path.join(SKILL_FILE)
    } else if path.extension().is_some_and(|extension| extension == "md") {
        path.to_path_buf()
    } else {
        return None;
    };

    let text = fs::read_to_string(&file).ok()?;
    let file_name = path.file_stem()?.to_str()?;

    Some(Skill {
        name: frontmatter_field(&text, "name").unwrap_or_else(|| file_name.to_string()),
        description: frontmatter_field(&text, "description"),
        path: file.to_string_lossy().into_owned(),
    })
}

/// A value from the frontmatter. Long descriptions are often written as a block
/// (`>-` or `|`) on the indented lines below, so those are read as one line.
fn frontmatter_field(text: &str, field: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }

    let header: Vec<&str> = lines.take_while(|line| line.trim_end() != "---").collect();
    let index = header.iter().position(|line| {
        line.strip_prefix(field)
            .is_some_and(|rest| rest.starts_with(':'))
    })?;
    let value = header[index][field.len() + 1..].trim();

    let value = if value.is_empty() || value.starts_with(['>', '|']) {
        header[index + 1..]
            .iter()
            .take_while(|line| line.starts_with([' ', '\t']))
            .map(|line| line.trim())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        value.trim_matches(['"', '\'']).to_string()
    };

    (!value.is_empty()).then_some(value)
}

/// Points at the skill instead of including it, so the thread opens on a short
/// prompt and the agent can find any files kept next to the skill
fn skill_prompt(run: &SkillRun) -> String {
    let mut prompt = format!(
        "Use the skill at {}. Read it first, then follow it.\n\n\
         I started this from a daily note in Stream:\n\
         - Note: {}\n",
        run.skill_path, run.note_path
    );

    if let Some(heading) = &run.heading {
        prompt.push_str(&format!("- Section: {heading}\n"));
    }

    match &run.text {
        Some(text) => {
            let text: String = text.chars().take(ORIGIN_TEXT_MAX_CHARS).collect();
            prompt.push_str(&format!("- Line {}: {text}\n", run.line));
        }
        None => prompt.push_str(&format!("- Line {}\n", run.line)),
    }

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_DIR: AtomicU32 = AtomicU32::new(0);

    struct TempFolder(PathBuf);

    impl TempFolder {
        fn new() -> Self {
            let id = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("stream-skills-test-{}-{id}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn write(&self, path: &str, text: &str) {
            let path = self.0.join(SKILLS_DIR).join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
    }

    impl Drop for TempFolder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run(heading: Option<&str>, text: Option<&str>) -> SkillRun {
        SkillRun {
            agent: AgentKind::Claude,
            model: None,
            skill_name: "review".to_string(),
            folder_path: "/notes".to_string(),
            skill_path: "/notes/Skills/review/SKILL.md".to_string(),
            note_path: "/notes/2026-11-02.md".to_string(),
            line: 14,
            heading: heading.map(str::to_string),
            text: text.map(str::to_string),
        }
    }

    #[test]
    fn creates_the_skills_folder() {
        let folder = TempFolder::new();

        assert_eq!(read_skills(&folder.0), Ok(Vec::new()));
        assert!(folder.0.join(SKILLS_DIR).is_dir());
    }

    #[test]
    fn keeps_the_skills_already_in_the_folder() {
        let folder = TempFolder::new();
        folder.write("review.md", "Review the day");

        assert_eq!(read_skills(&folder.0).unwrap().len(), 1);
    }

    #[test]
    fn reads_skill_folders_and_single_files() {
        let folder = TempFolder::new();
        folder.write(
            "weekly-review/SKILL.md",
            "---\nname: weekly-review\ndescription: Look back at the week\n---\n\n# Review\n",
        );
        folder.write("standup.md", "Write my standup");

        let skills = read_skills(&folder.0).unwrap();

        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].name, "standup");
        assert_eq!(skills[0].description, None);
        assert!(skills[0].path.ends_with("Skills/standup.md"));
        assert_eq!(skills[1].name, "weekly-review");
        assert_eq!(
            skills[1].description.as_deref(),
            Some("Look back at the week")
        );
        assert!(skills[1].path.ends_with("Skills/weekly-review/SKILL.md"));
    }

    #[test]
    fn ignores_everything_else_in_the_folder() {
        let folder = TempFolder::new();
        folder.write(".DS_Store", "");
        folder.write("notes.txt", "Not a skill");
        folder.write("empty/notes.md", "No SKILL.md in here");

        assert_eq!(read_skills(&folder.0), Ok(Vec::new()));
    }

    #[test]
    fn sorts_skills_regardless_of_case() {
        let folder = TempFolder::new();
        folder.write("banana.md", "");
        folder.write("Cherry.md", "");
        folder.write("apple.md", "");

        let names: Vec<String> = read_skills(&folder.0)
            .unwrap()
            .into_iter()
            .map(|skill| skill.name)
            .collect();

        assert_eq!(names, ["apple", "banana", "Cherry"]);
    }

    #[test]
    fn uses_the_folder_name_without_a_name_in_the_frontmatter() {
        let folder = TempFolder::new();
        folder.write("standup/SKILL.md", "---\ndescription: Write it\n---\n");

        assert_eq!(read_skills(&folder.0).unwrap()[0].name, "standup");
    }

    #[test]
    fn reads_quoted_and_block_frontmatter() {
        let text = "---\n\
                    name: \"quoted\"\n\
                    version: 2\n\
                    description: >-\n  \
                    Spread over\n  \
                    two lines\n\
                    other: value\n\
                    ---\n\
                    description: not this one\n";

        assert_eq!(frontmatter_field(text, "name").as_deref(), Some("quoted"));
        assert_eq!(
            frontmatter_field(text, "description").as_deref(),
            Some("Spread over two lines")
        );
    }

    #[test]
    fn only_reads_whole_field_names() {
        let text = "---\nname_old: wrong\nname: right\n---\n";

        assert_eq!(frontmatter_field(text, "name").as_deref(), Some("right"));
    }

    #[test]
    fn finds_no_frontmatter_in_plain_markdown() {
        assert_eq!(frontmatter_field("name: not this\n", "name"), None);
        assert_eq!(frontmatter_field("", "name"), None);
    }

    #[test]
    fn reads_a_run_as_the_frontend_sends_it() {
        let run: SkillRun = serde_json::from_value(serde_json::json!({
            "agent": "codex",
            "model": null,
            "skillName": "review",
            "folderPath": "/notes",
            "skillPath": "/notes/Skills/review.md",
            "notePath": "/notes/2026-11-02.md",
            "line": 14,
            "heading": null,
            "text": null,
        }))
        .unwrap();

        assert_eq!(run.agent, AgentKind::Codex);
        assert_eq!(run.skill_name, "review");
    }

    #[test]
    fn says_where_the_skill_was_started() {
        let prompt = skill_prompt(&run(Some("Planning"), Some("- follow up with Alex")));

        assert_eq!(
            prompt,
            "Use the skill at /notes/Skills/review/SKILL.md. Read it first, then follow it.\n\
             \n\
             I started this from a daily note in Stream:\n\
             - Note: /notes/2026-11-02.md\n\
             - Section: Planning\n\
             - Line 14: - follow up with Alex\n"
        );
    }

    #[test]
    fn leaves_out_context_it_does_not_have() {
        let prompt = skill_prompt(&run(None, None));

        assert!(!prompt.contains("Section"));
        assert!(prompt.ends_with("- Line 14\n"));
    }

    #[test]
    fn shortens_a_long_line() {
        let prompt = skill_prompt(&run(None, Some(&"x".repeat(5000))));

        assert!(prompt.len() < ORIGIN_TEXT_MAX_CHARS + 200);
    }

    #[test]
    fn starts_claude_with_a_name() {
        assert_eq!(
            cli_args(&run(None, None))[..5],
            ["--print", "--permission-mode", "auto", "--name", "review"]
        );
    }

    #[test]
    fn starts_codex_able_to_edit_the_notes_folder() {
        let mut run = run(None, None);
        run.agent = AgentKind::Codex;

        assert_eq!(
            cli_args(&run)[..4],
            [
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "workspace-write"
            ]
        );
    }

    #[test]
    fn passes_the_model_before_the_prompt() {
        let mut run = run(None, None);
        run.model = Some("opus".to_string());

        let args = cli_args(&run);

        assert_eq!(args[args.len() - 3..args.len() - 1], ["--model", "opus"]);
        assert_eq!(args.last(), Some(&skill_prompt(&run)));
    }

    #[test]
    fn leaves_the_model_to_the_cli_when_none_is_set() {
        assert!(!cli_args(&run(None, None)).contains(&"--model".to_string()));
    }

    #[test]
    fn finds_a_cli_outside_the_path() {
        let home = TempFolder::new();
        let claude = home.0.join(CLAUDE_CLI_PATHS[0]);
        fs::create_dir_all(claude.parent().unwrap()).unwrap();
        fs::write(&claude, "").unwrap();

        assert_eq!(
            find_cli(AgentKind::Claude, &home.0),
            claude.to_str().unwrap()
        );
    }

    #[test]
    fn runs_the_cli_in_the_notes_folder() {
        let folder = TempFolder::new();
        let cli = folder.0.join("record-folder");
        fs::write(&cli, "#!/bin/sh\npwd > ran-here\n").unwrap();
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
        let mut run = run(None, None);
        run.folder_path = folder.0.to_string_lossy().into_owned();

        assert_eq!(run_cli(cli.to_str().unwrap(), &run), Ok(()));
        assert!(folder.0.join("ran-here").is_file());
    }

    #[test]
    fn reports_a_cli_that_fails() {
        let mut run = run(None, None);
        run.folder_path = "/".to_string();

        assert!(run_cli("/usr/bin/false", &run).is_err());
    }

    #[test]
    fn reports_a_missing_cli() {
        let mut run = run(None, None);
        run.folder_path = "/".to_string();

        assert!(run_cli("/no/such/cli", &run).is_err());
    }

    /// Starts a real background thread. Run with
    /// `AGENT=codex NOTES=/path SKILL=/path MODEL=name cargo test
    /// start_a_real_thread -- --ignored`
    #[test]
    #[ignore]
    fn start_a_real_thread() {
        let notes = std::env::var("NOTES").unwrap();
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let agent = match std::env::var("AGENT").as_deref() {
            Ok("codex") => AgentKind::Codex,
            _ => AgentKind::Claude,
        };

        let run = SkillRun {
            agent,
            model: std::env::var("MODEL").ok(),
            skill_name: "stream-test".to_string(),
            folder_path: notes.clone(),
            skill_path: std::env::var("SKILL").unwrap(),
            note_path: format!("{notes}/2026-11-02.md"),
            line: 3,
            heading: Some("Don't lose \"this\"".to_string()),
            text: Some("Spaces, & symbols + 100% of a $line".to_string()),
        };

        run_cli(&find_cli(agent, &home), &run).unwrap();
    }
}
