use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use git2::Repository;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;

use crate::ipc::git::get_remote_url;

/// A stuck `gh` must not hold up every later refresh.
const GH_TIMEOUT: Duration = Duration::from_secs(20);

/// Apps launched from Finder don't inherit the shell PATH, so look here too.
const GH_INSTALL_PATHS: [&str; 4] = [
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/opt/local/bin/gh",
    "/usr/bin/gh",
];

/// A slow shell profile must not stall the search for gh.
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// `gh` exits with this when it has no account to use.
const GH_EXIT_LOGGED_OUT: i32 = 4;

/// One request covers every repo, so a refresh costs one call however many
/// repos are connected.
const PULL_REQUESTS_FRAGMENT: &str = r#"
fragment repo on Repository {
  defaultBranchRef {
    name
    target {
      ... on Commit { statusCheckRollup { ...checks } }
    }
  }
  open: pullRequests(states: OPEN, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
    nodes {
      ...pullRequest
      commits(last: 1) {
        nodes {
          commit { statusCheckRollup { ...checks } }
        }
      }
    }
  }
  merged: pullRequests(states: MERGED, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
    nodes { ...pullRequest }
  }
}
fragment pullRequest on PullRequest {
  number title url isDraft headRefName mergedAt additions deletions
  reviewDecision viewerDidAuthor
  comments { totalCount }
  viewerLatestReviewRequest { id }
}
fragment checks on StatusCheckRollup {
  state
  contexts(first: 100) {
    nodes {
      ... on CheckRun { name conclusion }
      ... on StatusContext { context state }
    }
  }
}
"#;

/// One check on a commit
#[derive(Debug, Serialize, PartialEq)]
pub struct CheckRun {
    pub name: String,
    pub status: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PullRequest {
    pub repo_path: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: &'static str,
    pub branch: String,
    pub additions: u64,
    pub deletions: u64,
    pub comments: u64,
    pub checks: Option<&'static str>,
    pub check_runs: Vec<CheckRun>,
    pub review: Option<&'static str>,
    pub merged_at: Option<String>,
    pub is_mine: bool,
}

/// A repo's default branch and the checks on its latest commit
#[derive(Debug, Serialize, PartialEq)]
pub struct DefaultBranch {
    pub repo_path: String,
    pub branch: String,
    pub checks: Option<&'static str>,
    pub check_runs: Vec<CheckRun>,
}

#[derive(Debug, Serialize)]
pub struct PullRequestSnapshot {
    pub pull_requests: Vec<PullRequest>,
    pub default_branches: Vec<DefaultBranch>,
    pub rate_remaining: Option<u64>,
}

/// A connected repo that GitHub wouldn't return to this account
#[derive(Debug, Serialize, PartialEq)]
pub struct UnreadableRepo {
    pub name: String,
    pub message: String,
}

/// The result of asking GitHub, through gh, what this Mac can see
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GitHubStatus {
    Connected {
        login: String,
        repo_count: usize,
        unreadable_repos: Vec<UnreadableRepo>,
        needs_repo_scope: bool,
    },
    GhMissing,
    LoggedOut,
    TokenRejected {
        detail: String,
    },
    RateLimited {
        detail: String,
    },
    Unreachable {
        detail: String,
    },
    Failed {
        detail: String,
    },
}

#[derive(Debug, Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoNode {
    default_branch_ref: Option<BranchRefNode>,
    open: Nodes<PullRequestNode>,
    merged: Nodes<PullRequestNode>,
}

#[derive(Debug, Deserialize)]
struct BranchRefNode {
    name: String,
    target: Option<Commit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestNode {
    number: u64,
    title: String,
    url: String,
    is_draft: bool,
    head_ref_name: String,
    merged_at: Option<String>,
    additions: u64,
    deletions: u64,
    review_decision: Option<String>,
    viewer_did_author: bool,
    comments: TotalCount,
    viewer_latest_review_request: Option<Value>,
    commits: Option<Nodes<CommitNode>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TotalCount {
    total_count: u64,
}

#[derive(Debug, Deserialize)]
struct CommitNode {
    commit: Commit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    status_check_rollup: Option<CheckRollup>,
}

#[derive(Debug, Deserialize)]
struct CheckRollup {
    state: String,
    contexts: Nodes<CheckNode>,
}

#[derive(Debug, Deserialize)]
struct CheckNode {
    name: Option<String>,
    conclusion: Option<String>,
    context: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    path: Vec<Value>,
    message: String,
}

#[derive(Debug)]
struct GitHubRepo {
    path: String,
    owner: String,
    name: String,
}

/// What `gh api --include` printed: the status line and headers, then the body
#[derive(Debug, PartialEq)]
struct GhResponse<'a> {
    http_status: Option<u16>,
    scopes: Option<Vec<String>>,
    body: &'a [u8],
}

fn parse_github_remote(remote_url: &str) -> Option<(String, String)> {
    let path = [
        "git@github.com:",
        "ssh://git@github.com/",
        "https://github.com/",
    ]
    .iter()
    .find_map(|prefix| remote_url.strip_prefix(prefix))?;

    let path = path.trim_end_matches('/');
    let (owner, name) = path.strip_suffix(".git").unwrap_or(path).split_once('/')?;

    if owner.is_empty() || name.is_empty() {
        return None;
    }

    Some((owner.to_string(), name.to_string()))
}

async fn find_gh() -> Option<PathBuf> {
    let on_path = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|dir| dir.join("gh"));

    match on_path
        .chain(GH_INSTALL_PATHS.iter().map(PathBuf::from))
        .find(|candidate| candidate.is_file())
    {
        Some(gh) => Some(gh),
        None => find_gh_in_shell().await,
    }
}

/// Version managers such as mise or asdf only put gh on the PATH of a real
/// shell, so ask one before saying gh isn't installed.
async fn find_gh_in_shell() -> Option<PathBuf> {
    let mut command = Command::new(std::env::var_os("SHELL")?);
    command
        .args(["-ilc", "command -v gh"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    let output = tokio::time::timeout(SHELL_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;

    parse_shell_path(&output.stdout)
}

// Shell profiles can print anything before the command runs
fn parse_shell_path(stdout: &[u8]) -> Option<PathBuf> {
    String::from_utf8_lossy(stdout)
        .lines()
        .last()
        .map(|line| PathBuf::from(line.trim()))
        .filter(|path| path.is_file())
}

fn github_repos(repo_paths: &[String]) -> Vec<GitHubRepo> {
    repo_paths
        .iter()
        .filter_map(|path| {
            let repo = Repository::open(path).ok()?;
            let (owner, name) = parse_github_remote(&get_remote_url(&repo)?)?;
            Some(GitHubRepo {
                path: path.clone(),
                owner,
                name,
            })
        })
        .collect()
}

fn build_query(repo_count: usize) -> String {
    if repo_count == 0 {
        return "query {\n  viewer { login }\n  rateLimit { remaining }\n}".to_string();
    }

    let variables = (0..repo_count)
        .map(|index| format!("$owner{index}: String!, $name{index}: String!"))
        .collect::<Vec<_>>()
        .join(", ");
    let repositories = (0..repo_count)
        .map(|index| {
            format!("r{index}: repository(owner: $owner{index}, name: $name{index}) {{ ...repo }}")
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "query({variables}) {{\n  viewer {{ login }}\n  rateLimit {{ remaining }}\n{repositories}\n}}\n{PULL_REQUESTS_FRAGMENT}"
    )
}

fn map_checks(state: &str) -> Option<&'static str> {
    match state {
        "SUCCESS" => Some("pass"),
        "FAILURE" | "ERROR" => Some("fail"),
        "PENDING" | "EXPECTED" => Some("running"),
        _ => None,
    }
}

// A check run has no conclusion until it finishes
fn map_check_status(check: &CheckNode) -> &'static str {
    match check.conclusion.as_deref().or(check.state.as_deref()) {
        Some("SUCCESS") => "pass",
        Some("SKIPPED" | "NEUTRAL") => "skipped",
        Some(
            "FAILURE" | "ERROR" | "TIMED_OUT" | "STARTUP_FAILURE" | "CANCELLED" | "ACTION_REQUIRED",
        ) => "fail",
        _ => "running",
    }
}

fn map_check_runs(rollup: Option<CheckRollup>) -> Vec<CheckRun> {
    rollup
        .map(|rollup| {
            rollup
                .contexts
                .nodes
                .into_iter()
                .filter_map(|check| {
                    let status = map_check_status(&check);
                    Some(CheckRun {
                        name: check.name.or(check.context)?,
                        status,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_default_branch(repo_path: &str, node: BranchRefNode) -> DefaultBranch {
    let rollup = node.target.and_then(|commit| commit.status_check_rollup);

    DefaultBranch {
        repo_path: repo_path.to_string(),
        branch: node.name,
        checks: rollup.as_ref().and_then(|rollup| map_checks(&rollup.state)),
        check_runs: map_check_runs(rollup),
    }
}

fn map_pull_request(repo_path: &str, node: PullRequestNode) -> Option<PullRequest> {
    let is_requested = node.viewer_latest_review_request.is_some() && !node.viewer_did_author;
    if !node.viewer_did_author && !is_requested {
        return None;
    }

    let rollup = node
        .commits
        .and_then(|commits| commits.nodes.into_iter().next())
        .and_then(|node| node.commit.status_check_rollup);

    let review = if is_requested {
        Some("requested")
    } else {
        match node.review_decision.as_deref() {
            Some("CHANGES_REQUESTED") => Some("changes"),
            Some("APPROVED") => Some("approved"),
            _ => None,
        }
    };

    let state = if node.merged_at.is_some() {
        "merged"
    } else if node.is_draft {
        "draft"
    } else {
        "open"
    };

    Some(PullRequest {
        repo_path: repo_path.to_string(),
        number: node.number,
        title: node.title,
        url: node.url,
        state,
        branch: node.head_ref_name,
        additions: node.additions,
        deletions: node.deletions,
        comments: node.comments.total_count,
        checks: rollup.as_ref().and_then(|rollup| map_checks(&rollup.state)),
        check_runs: map_check_runs(rollup),
        review,
        merged_at: node.merged_at,
        is_mine: node.viewer_did_author,
    })
}

fn parse_snapshot(stdout: &[u8], repos: &[GitHubRepo]) -> Result<PullRequestSnapshot, String> {
    let response: Value =
        serde_json::from_slice(stdout).map_err(|e| format!("Unexpected gh output: {}", e))?;

    let data: HashMap<String, Value> = response
        .get("data")
        .cloned()
        .filter(|data| data.is_object())
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| format!("Unexpected gh output: {}", e))?
        .ok_or_else(|| "gh returned no data".to_string())?;

    let rate_remaining = data
        .get("rateLimit")
        .and_then(|rate_limit| rate_limit.get("remaining"))
        .and_then(Value::as_u64);

    let mut pull_requests = Vec::new();
    let mut default_branches = Vec::new();

    for (index, repo) in repos.iter().enumerate() {
        // A deleted or inaccessible repo comes back null without failing the others.
        let Some(node) = data
            .get(&format!("r{index}"))
            .filter(|node| !node.is_null())
        else {
            continue;
        };
        let node: RepoNode = serde_json::from_value(node.clone())
            .map_err(|e| format!("Unexpected gh output: {}", e))?;

        default_branches.extend(
            node.default_branch_ref
                .map(|branch| map_default_branch(&repo.path, branch)),
        );
        pull_requests.extend(
            node.open
                .nodes
                .into_iter()
                .chain(node.merged.nodes)
                .filter_map(|pull_request| map_pull_request(&repo.path, pull_request)),
        );
    }

    Ok(PullRequestSnapshot {
        pull_requests,
        default_branches,
        rate_remaining,
    })
}

fn parse_gh_response(stdout: &[u8]) -> GhResponse<'_> {
    // gh ends the status line with a bare \n and each header with \r\n
    let (head, body) = match stdout.windows(3).position(|bytes| bytes == b"\n\r\n") {
        Some(index) => (&stdout[..index], &stdout[index + 3..]),
        None => (stdout, &[][..]),
    };
    let head = String::from_utf8_lossy(head);
    let mut lines = head.lines();

    let http_status = lines
        .next()
        .filter(|line| line.starts_with("HTTP/"))
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse().ok());

    // Only classic and OAuth tokens have scopes; fine-grained ones omit the header.
    let scopes = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("x-oauth-scopes").then(|| {
            value
                .split(',')
                .map(|scope| scope.trim().to_string())
                .filter(|scope| !scope.is_empty())
                .collect()
        })
    });

    GhResponse {
        http_status,
        scopes,
        body,
    }
}

fn map_unreadable_repos(
    data: &Value,
    errors: &[GraphQlError],
    repos: &[GitHubRepo],
) -> Vec<UnreadableRepo> {
    repos
        .iter()
        .enumerate()
        .filter_map(|(index, repo)| {
            let alias = format!("r{index}");
            let error = errors
                .iter()
                .find(|error| error.path.first().and_then(Value::as_str) == Some(alias.as_str()));
            let is_missing = data.get(&alias).is_none_or(Value::is_null);

            (is_missing || error.is_some()).then(|| UnreadableRepo {
                name: format!("{}/{}", repo.owner, repo.name),
                message: error
                    .map(|error| error.message.clone())
                    .unwrap_or_else(|| "GitHub didn't return this repository.".to_string()),
            })
        })
        .collect()
}

fn map_github_status(
    exit_code: Option<i32>,
    stdout: &[u8],
    stderr: &str,
    repos: &[GitHubRepo],
) -> GitHubStatus {
    let detail = stderr.trim().to_string();

    if exit_code == Some(GH_EXIT_LOGGED_OUT) {
        return GitHubStatus::LoggedOut;
    }

    let response = parse_gh_response(stdout);
    let Some(http_status) = response.http_status else {
        return GitHubStatus::Unreachable { detail };
    };
    if http_status == 401 {
        return GitHubStatus::TokenRejected { detail };
    }

    let body: Value = serde_json::from_slice(response.body).unwrap_or(Value::Null);
    let errors: Vec<GraphQlError> = body
        .get("errors")
        .cloned()
        .and_then(|errors| serde_json::from_value(errors).ok())
        .unwrap_or_default();

    let has_error = |kind: &str| {
        errors
            .iter()
            .any(|error| error.kind.as_deref() == Some(kind))
    };

    if has_error("RATE_LIMITED")
        || http_status == 429
        || detail.to_lowercase().contains("rate limit")
    {
        return GitHubStatus::RateLimited { detail };
    }

    let data = body.get("data").unwrap_or(&Value::Null);
    let Some(login) = data
        .get("viewer")
        .and_then(|viewer| viewer.get("login"))
        .and_then(Value::as_str)
    else {
        return GitHubStatus::Failed { detail };
    };

    let unreadable_repos = map_unreadable_repos(data, &errors, repos);
    let lacks_repo_scope = response
        .scopes
        .is_some_and(|scopes| !scopes.iter().any(|scope| scope == "repo"));

    GitHubStatus::Connected {
        login: login.to_string(),
        repo_count: repos.len(),
        needs_repo_scope: has_error("INSUFFICIENT_SCOPES")
            || (lacks_repo_scope && !unreadable_repos.is_empty()),
        unreadable_repos,
    }
}

fn graphql_command(gh: PathBuf, repos: &[GitHubRepo]) -> Command {
    let mut command = Command::new(gh);
    command
        .args(["api", "graphql", "-f"])
        .arg(format!("query={}", build_query(repos.len())))
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .kill_on_drop(true);

    for (index, repo) in repos.iter().enumerate() {
        command
            .arg("-f")
            .arg(format!("owner{index}={}", repo.owner))
            .arg("-f")
            .arg(format!("name{index}={}", repo.name));
    }

    command
}

/// Runs the same query as the pull request refresh, so a working status means
/// that refresh works too.
#[tauri::command]
pub(crate) async fn get_github_status(repo_paths: Vec<String>) -> GitHubStatus {
    let Some(gh) = find_gh().await else {
        return GitHubStatus::GhMissing;
    };

    let repos = github_repos(&repo_paths);
    let mut command = graphql_command(gh, &repos);
    command.arg("--include");

    match tokio::time::timeout(GH_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => map_github_status(
            output.status.code(),
            &output.stdout,
            &String::from_utf8_lossy(&output.stderr),
            &repos,
        ),
        Ok(Err(error)) => GitHubStatus::Failed {
            detail: format!("Failed to run gh: {}", error),
        },
        Err(_) => GitHubStatus::Unreachable {
            detail: "Timed out waiting for gh".to_string(),
        },
    }
}

#[tauri::command]
pub(crate) async fn get_pull_requests(
    repo_paths: Vec<String>,
) -> Result<PullRequestSnapshot, String> {
    let repos = github_repos(&repo_paths);
    if repos.is_empty() {
        return Ok(PullRequestSnapshot {
            pull_requests: Vec::new(),
            default_branches: Vec::new(),
            rate_remaining: None,
        });
    }

    let gh = find_gh()
        .await
        .ok_or_else(|| "GitHub CLI (gh) is not installed".to_string())?;

    let output = tokio::time::timeout(GH_TIMEOUT, graphql_command(gh, &repos).output())
        .await
        .map_err(|_| "Timed out waiting for gh".to_string())?
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    // gh exits non-zero on partial errors, such as one missing repo, but still
    // prints the data for the others.
    parse_snapshot(&output.stdout, &repos).map_err(|error| {
        if output.status.success() {
            return error;
        }
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn repo(path: &str) -> GitHubRepo {
        GitHubRepo {
            path: path.to_string(),
            owner: "marcelmarais".to_string(),
            name: "stream".to_string(),
        }
    }

    fn pull_request(number: u64) -> Value {
        json!({
            "number": number,
            "title": "Add a GitHub view",
            "url": "https://github.com/marcelmarais/stream/pull/1",
            "isDraft": false,
            "headRefName": "github-panel",
            "mergedAt": null,
            "additions": 3,
            "deletions": 1,
            "reviewDecision": null,
            "viewerDidAuthor": true,
            "comments": { "totalCount": 2 },
            "viewerLatestReviewRequest": null,
        })
    }

    fn response(open: Vec<Value>, merged: Vec<Value>) -> Vec<u8> {
        json!({
            "data": {
                "rateLimit": { "remaining": 4200 },
                "r0": { "open": { "nodes": open }, "merged": { "nodes": merged } },
            }
        })
        .to_string()
        .into_bytes()
    }

    fn included(status_line: &str, headers: &[&str], body: Value) -> Vec<u8> {
        let headers: String = headers
            .iter()
            .map(|header| format!("{header}\r\n"))
            .collect();

        format!("{status_line}\n{headers}\r\n{body}").into_bytes()
    }

    fn viewer(extra: Value) -> Value {
        let mut data = json!({ "viewer": { "login": "marcelmarais" } });
        data.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        json!({ "data": data })
    }

    #[test]
    fn parses_github_remotes_only() {
        let expected = Some(("marcelmarais".to_string(), "stream".to_string()));

        assert_eq!(
            parse_github_remote("git@github.com:marcelmarais/stream.git"),
            expected
        );
        assert_eq!(
            parse_github_remote("https://github.com/marcelmarais/stream"),
            expected
        );
        assert_eq!(
            parse_github_remote("ssh://git@github.com/marcelmarais/stream.git/"),
            expected
        );
        assert_eq!(
            parse_github_remote("git@gitlab.com:marcel/stream.git"),
            None
        );
    }

    #[test]
    fn query_has_one_repository_per_repo() {
        let query = build_query(2);

        assert!(query.contains("r0: repository(owner: $owner0, name: $name0)"));
        assert!(query.contains("r1: repository(owner: $owner1, name: $name1)"));
        assert!(query.contains("$name1: String!"));
    }

    #[test]
    fn query_without_repos_only_asks_who_is_signed_in() {
        let query = build_query(0);

        assert!(query.contains("viewer { login }"));
        assert!(!query.contains("fragment"));
        assert!(!query.contains("query("));
    }

    #[test]
    fn reads_the_status_and_scopes_from_included_headers() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &["Server: GitHub.com", "X-Oauth-Scopes: gist, read:org, repo"],
            json!({ "data": {} }),
        );

        let response = parse_gh_response(&stdout);

        assert_eq!(response.http_status, Some(200));
        assert_eq!(
            response.scopes,
            Some(vec![
                "gist".to_string(),
                "read:org".to_string(),
                "repo".to_string(),
            ])
        );
        assert_eq!(response.body, br#"{"data":{}}"#);
    }

    #[test]
    fn fine_grained_tokens_have_no_scopes_to_read() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &["Server: GitHub.com"],
            json!({ "data": {} }),
        );

        assert_eq!(parse_gh_response(&stdout).scopes, None);
    }

    #[test]
    fn empty_output_has_no_http_status() {
        assert_eq!(parse_gh_response(b"").http_status, None);
    }

    #[test]
    fn a_working_account_is_connected() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &["X-Oauth-Scopes: repo"],
            viewer(json!({ "r0": { "open": { "nodes": [] } } })),
        );

        assert_eq!(
            map_github_status(Some(0), &stdout, "", &[repo("/repo")]),
            GitHubStatus::Connected {
                login: "marcelmarais".to_string(),
                repo_count: 1,
                unreadable_repos: Vec::new(),
                needs_repo_scope: false,
            }
        );
    }

    #[test]
    fn exit_code_four_means_logged_out() {
        assert_eq!(
            map_github_status(Some(4), b"", "please run: gh auth login", &[]),
            GitHubStatus::LoggedOut
        );
    }

    #[test]
    fn a_401_means_the_token_was_rejected() {
        let stdout = included(
            "HTTP/2.0 401 Unauthorized",
            &[],
            json!({ "message": "Bad credentials" }),
        );

        assert_eq!(
            map_github_status(Some(1), &stdout, "gh: Bad credentials (HTTP 401)\n", &[]),
            GitHubStatus::TokenRejected {
                detail: "gh: Bad credentials (HTTP 401)".to_string(),
            }
        );
    }

    #[test]
    fn no_response_means_github_is_unreachable() {
        let stderr = "Post \"https://api.github.com/graphql\": dial tcp: connection refused";

        assert_eq!(
            map_github_status(Some(1), b"", stderr, &[]),
            GitHubStatus::Unreachable {
                detail: stderr.to_string(),
            }
        );
    }

    #[test]
    fn rate_limits_show_up_in_graphql_and_rest_responses() {
        let graphql = included(
            "HTTP/2.0 200 OK",
            &[],
            json!({ "errors": [{ "type": "RATE_LIMITED", "message": "API rate limit exceeded" }] }),
        );
        let rest = included("HTTP/2.0 403 Forbidden", &[], json!({ "message": "nope" }));

        assert!(matches!(
            map_github_status(Some(1), &graphql, "", &[]),
            GitHubStatus::RateLimited { .. }
        ));
        assert!(matches!(
            map_github_status(
                Some(1),
                &rest,
                "gh: API rate limit exceeded (HTTP 403)",
                &[]
            ),
            GitHubStatus::RateLimited { .. }
        ));
    }

    #[test]
    fn other_http_failures_keep_what_gh_said() {
        let stdout = included(
            "HTTP/2.0 502 Bad Gateway",
            &[],
            json!({ "message": "oops" }),
        );

        assert_eq!(
            map_github_status(Some(1), &stdout, "gh: oops (HTTP 502)", &[]),
            GitHubStatus::Failed {
                detail: "gh: oops (HTTP 502)".to_string(),
            }
        );
    }

    #[test]
    fn a_repo_github_wont_return_is_named_with_its_error() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &["X-Oauth-Scopes: repo"],
            json!({
                "data": { "viewer": { "login": "marcelmarais" }, "r0": null },
                "errors": [{
                    "type": "NOT_FOUND",
                    "path": ["r0"],
                    "message": "Could not resolve to a Repository",
                }],
            }),
        );

        assert_eq!(
            map_github_status(Some(1), &stdout, "", &[repo("/repo")]),
            GitHubStatus::Connected {
                login: "marcelmarais".to_string(),
                repo_count: 1,
                unreadable_repos: vec![UnreadableRepo {
                    name: "marcelmarais/stream".to_string(),
                    message: "Could not resolve to a Repository".to_string(),
                }],
                needs_repo_scope: false,
            }
        );
    }

    #[test]
    fn a_missing_repo_on_a_token_without_repo_scope_needs_that_scope() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &["X-Oauth-Scopes: read:org"],
            viewer(json!({ "r0": null })),
        );

        let status = map_github_status(Some(1), &stdout, "", &[repo("/repo")]);

        assert!(matches!(
            status,
            GitHubStatus::Connected {
                needs_repo_scope: true,
                ..
            }
        ));
    }

    #[test]
    fn no_repo_scope_is_fine_when_every_repo_came_back() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &["X-Oauth-Scopes: read:org"],
            viewer(json!({ "r0": { "open": { "nodes": [] } } })),
        );

        let status = map_github_status(Some(0), &stdout, "", &[repo("/repo")]);

        assert!(matches!(
            status,
            GitHubStatus::Connected {
                needs_repo_scope: false,
                ..
            }
        ));
    }

    #[test]
    fn insufficient_scopes_inside_a_repo_flags_it_and_asks_for_the_scope() {
        let stdout = included(
            "HTTP/2.0 200 OK",
            &[],
            json!({
                "data": { "viewer": { "login": "marcelmarais" }, "r0": { "open": null } },
                "errors": [{
                    "type": "INSUFFICIENT_SCOPES",
                    "path": ["r0", "open"],
                    "message": "Your token has not been granted the required scopes",
                }],
            }),
        );

        let GitHubStatus::Connected {
            unreadable_repos,
            needs_repo_scope,
            ..
        } = map_github_status(Some(1), &stdout, "", &[repo("/repo")])
        else {
            panic!("expected a connected status");
        };

        assert_eq!(unreadable_repos.len(), 1);
        assert!(needs_repo_scope);
    }

    #[test]
    fn serializes_the_state_as_a_tag() {
        assert_eq!(
            serde_json::to_value(GitHubStatus::GhMissing).unwrap(),
            json!({ "state": "gh_missing" })
        );
        assert_eq!(
            serde_json::to_value(GitHubStatus::Unreachable {
                detail: "offline".to_string(),
            })
            .unwrap(),
            json!({ "state": "unreachable", "detail": "offline" })
        );
    }

    #[test]
    fn takes_the_path_from_the_last_line_of_a_noisy_shell() {
        let gh = std::env::current_exe().unwrap();
        let stdout = format!("Welcome back!\n{}\n", gh.display());

        assert_eq!(parse_shell_path(stdout.as_bytes()), Some(gh));
        assert_eq!(parse_shell_path(b"gh: aliased to hub\n"), None);
        assert_eq!(parse_shell_path(b""), None);
    }

    #[test]
    fn keeps_only_my_pull_requests_and_review_requests() {
        let mut dependabot = pull_request(2);
        dependabot["viewerDidAuthor"] = json!(false);

        let mut requested = pull_request(3);
        requested["viewerDidAuthor"] = json!(false);
        requested["viewerLatestReviewRequest"] = json!({ "id": "abc" });

        let snapshot = parse_snapshot(
            &response(vec![pull_request(1), dependabot, requested], vec![]),
            &[repo("/repo")],
        )
        .unwrap();

        let numbers: Vec<u64> = snapshot.pull_requests.iter().map(|pr| pr.number).collect();
        assert_eq!(numbers, vec![1, 3]);
        assert_eq!(snapshot.pull_requests[1].review, Some("requested"));
        assert!(snapshot.pull_requests[0].is_mine);
        assert!(!snapshot.pull_requests[1].is_mine);
        assert_eq!(snapshot.rate_remaining, Some(4200));
    }

    #[test]
    fn reads_each_check_and_merged_state() {
        let mut failing = pull_request(1);
        failing["commits"] = json!({
            "nodes": [{
                "commit": {
                    "statusCheckRollup": {
                        "state": "FAILURE",
                        "contexts": {
                            "nodes": [
                                { "name": "Lint", "conclusion": "SUCCESS" },
                                { "name": "Build macOS App", "conclusion": "FAILURE" },
                                { "context": "ci/legacy", "state": "ERROR" },
                                { "name": "Deploy", "conclusion": "CANCELLED" },
                                { "name": "Build Windows App", "conclusion": "SKIPPED" },
                                { "name": "Test", "conclusion": null },
                                { "context": "ci/queue", "state": "PENDING" },
                            ],
                        },
                    },
                },
            }],
        });

        let mut merged = pull_request(2);
        merged["mergedAt"] = json!("2026-11-01T10:00:00Z");

        let snapshot =
            parse_snapshot(&response(vec![failing], vec![merged]), &[repo("/repo")]).unwrap();

        assert_eq!(snapshot.pull_requests[0].checks, Some("fail"));
        let statuses: Vec<(&str, &str)> = snapshot.pull_requests[0]
            .check_runs
            .iter()
            .map(|check| (check.name.as_str(), check.status))
            .collect();
        assert_eq!(
            statuses,
            vec![
                ("Lint", "pass"),
                ("Build macOS App", "fail"),
                ("ci/legacy", "fail"),
                ("Deploy", "fail"),
                ("Build Windows App", "skipped"),
                ("Test", "running"),
                ("ci/queue", "running"),
            ]
        );
        assert_eq!(snapshot.pull_requests[1].state, "merged");
    }

    #[test]
    fn reads_checks_on_the_default_branch() {
        let stdout = json!({
            "data": {
                "r0": {
                    "defaultBranchRef": {
                        "name": "trunk",
                        "target": {
                            "statusCheckRollup": {
                                "state": "FAILURE",
                                "contexts": {
                                    "nodes": [
                                        { "name": "Build", "conclusion": "SUCCESS" },
                                        { "name": "Lint", "conclusion": "FAILURE" },
                                    ],
                                },
                            },
                        },
                    },
                    "open": { "nodes": [] },
                    "merged": { "nodes": [] },
                },
            }
        })
        .to_string()
        .into_bytes();

        let snapshot = parse_snapshot(&stdout, &[repo("/repo")]).unwrap();

        assert_eq!(
            snapshot.default_branches,
            vec![DefaultBranch {
                repo_path: "/repo".to_string(),
                branch: "trunk".to_string(),
                checks: Some("fail"),
                check_runs: vec![
                    CheckRun {
                        name: "Build".to_string(),
                        status: "pass",
                    },
                    CheckRun {
                        name: "Lint".to_string(),
                        status: "fail",
                    },
                ],
            }]
        );
    }

    #[test]
    fn a_default_branch_without_ci_has_no_checks() {
        let stdout = json!({
            "data": {
                "r0": {
                    "defaultBranchRef": {
                        "name": "main",
                        "target": { "statusCheckRollup": null },
                    },
                    "open": { "nodes": [] },
                    "merged": { "nodes": [] },
                },
            }
        })
        .to_string()
        .into_bytes();

        let snapshot = parse_snapshot(&stdout, &[repo("/repo")]).unwrap();

        assert_eq!(snapshot.default_branches[0].checks, None);
        assert!(snapshot.default_branches[0].check_runs.is_empty());
    }

    #[test]
    fn an_empty_repo_has_no_default_branch() {
        let snapshot = parse_snapshot(&response(vec![], vec![]), &[repo("/repo")]).unwrap();

        assert!(snapshot.default_branches.is_empty());
    }

    #[test]
    fn skips_repos_that_came_back_null() {
        let stdout = json!({ "data": { "rateLimit": { "remaining": 1 }, "r0": null } })
            .to_string()
            .into_bytes();

        let snapshot = parse_snapshot(&stdout, &[repo("/repo")]).unwrap();

        assert!(snapshot.pull_requests.is_empty());
    }
}
