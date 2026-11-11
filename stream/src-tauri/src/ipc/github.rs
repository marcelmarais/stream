use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
const INSTALL_DIRS: [&str; 4] = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
];

/// A slow shell profile must not stall the search for an executable.
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// `gh` exits with this when it has no account to use.
const GH_EXIT_LOGGED_OUT: i32 = 4;

/// Stream only reads github.com remotes, so only this host's accounts matter.
const GITHUB_HOST: &str = "github.com";

/// One request covers every repo, so a refresh costs one call however many
/// repos are connected.
const PULL_REQUESTS_FRAGMENT: &str = r#"
fragment repo on Repository {
  defaultBranchRef {
    name
    target {
      ... on Commit { oid committedDate statusCheckRollup { ...checks } }
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
  number title url isDraft headRefName headRefOid isCrossRepository mergedAt
  additions deletions reviewDecision viewerDidAuthor
  comments { totalCount }
  viewerLatestReviewRequest { id }
  latestOpinionatedReviews(first: 20) {
    nodes { state author { login } }
  }
  commits(last: 1) {
    nodes {
      commit { oid committedDate }
    }
  }
}
fragment checks on StatusCheckRollup {
  state
  contexts(first: 100) {
    nodes {
      ... on CheckRun { name conclusion detailsUrl }
      ... on StatusContext { context state targetUrl }
    }
  }
}
"#;

/// One check on a commit
#[derive(Debug, Serialize, PartialEq)]
pub struct CheckRun {
    pub name: String,
    pub status: &'static str,
    pub url: Option<String>,
}

/// One person's latest verdict on a pull request
#[derive(Debug, Serialize, PartialEq)]
pub struct Review {
    pub login: String,
    pub state: String,
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
    pub reviews: Vec<Review>,
    pub head_sha: String,
    pub last_commit_at: Option<String>,
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
    pub head_sha: Option<String>,
    pub last_commit_at: Option<String>,
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

/// An account gh is signed in to on github.com
#[derive(Debug, Serialize, PartialEq)]
pub struct GitHubAccount {
    pub login: String,
    pub active: bool, // The one gh uses when Stream hasn't been given one
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
    /// The account Stream was told to use isn't one gh has any more
    AccountMissing {
        login: String,
        detail: String,
    },
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
    head_ref_oid: String,
    is_cross_repository: bool,
    merged_at: Option<String>,
    additions: u64,
    deletions: u64,
    review_decision: Option<String>,
    viewer_did_author: bool,
    comments: TotalCount,
    viewer_latest_review_request: Option<Value>,
    latest_opinionated_reviews: Option<Nodes<ReviewNode>>,
    commits: Option<Nodes<CommitNode>>,
}

#[derive(Debug, Deserialize)]
struct ReviewNode {
    state: String,
    author: Option<AuthorNode>,
}

#[derive(Debug, Deserialize)]
struct AuthorNode {
    login: String,
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
    oid: String,
    committed_date: String,
    status_check_rollup: Option<CheckRollup>,
}

#[derive(Debug, Deserialize)]
struct CheckRollup {
    state: String,
    contexts: Nodes<CheckNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckNode {
    name: Option<String>,
    conclusion: Option<String>,
    details_url: Option<String>,
    context: Option<String>,
    state: Option<String>,
    target_url: Option<String>,
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

#[derive(Debug, Deserialize)]
struct AuthStatus {
    hosts: HashMap<String, Vec<AccountNode>>,
}

#[derive(Debug, Deserialize)]
struct AccountNode {
    login: String,
    #[serde(default)]
    active: bool,
}

/// The account Stream was told to use, as the token gh holds for it. Each
/// command is handed the token, which leaves gh's own active account alone: a
/// terminal can be on another one, and switching there changes nothing here.
#[derive(Clone)]
pub(crate) struct GitHubAuth {
    gh: PathBuf,
    token: String,
}

impl GitHubAuth {
    /// Errors with what gh said, which is that it has no such account.
    async fn for_account(gh: &Path, login: &str) -> Result<Self, String> {
        let mut command = Command::new(gh);
        command
            .args(["auth", "token", "--hostname", GITHUB_HOST, "--user", login])
            .stdin(Stdio::null())
            .kill_on_drop(true);

        let output = tokio::time::timeout(GH_TIMEOUT, command.output())
            .await
            .map_err(|_| "Timed out waiting for gh".to_string())?
            .map_err(|e| format!("Failed to run gh: {}", e))?;
        let token = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if !output.status.success() || token.is_empty() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        Ok(Self {
            gh: gh.to_path_buf(),
            token,
        })
    }

    /// For git, where a missing account is no reason to fail: None leaves git
    /// to its own credentials, and the GitHub status says what's wrong.
    pub(crate) async fn find(account: Option<&str>) -> Option<Self> {
        let gh = find_executable("gh").await?;
        Self::for_account(&gh, account?).await.ok()
    }

    fn sign_in_gh(&self, command: &mut Command) {
        command.env("GH_TOKEN", &self.token);
    }

    /// What gh reads from GH_TOKEN, for commands that run gh on their own
    pub(crate) fn token(&self) -> &str {
        &self.token
    }

    /// Makes git answer github.com's password prompt with this account,
    /// whatever credential helpers are configured. Call it before adding the
    /// subcommand. SSH remotes never ask, so they keep using their key.
    pub(crate) fn sign_in_git(&self, command: &mut Command) {
        let gh = self.gh.to_string_lossy().replace('\'', r"'\''");
        command
            // An empty helper drops the configured ones, the keychain included
            .args(["-c", &format!("credential.https://{GITHUB_HOST}.helper=")])
            .args([
                "-c",
                &format!("credential.https://{GITHUB_HOST}.helper=!'{gh}' auth git-credential"),
            ])
            .env("GH_TOKEN", &self.token);
    }
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

pub(crate) async fn find_executable(name: &str) -> Option<PathBuf> {
    let on_path = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|dir| dir.join(name));

    match on_path
        .chain(INSTALL_DIRS.iter().map(|dir| Path::new(dir).join(name)))
        .find(|candidate| candidate.is_file())
    {
        Some(path) => Some(path),
        None => find_in_shell(name).await,
    }
}

/// Version managers such as mise or asdf only put tools on the PATH of a real
/// shell, so ask one before saying a tool isn't installed.
async fn find_in_shell(name: &str) -> Option<PathBuf> {
    let mut command = Command::new(std::env::var_os("SHELL")?);
    command
        .arg("-ilc")
        .arg(format!("command -v {name}"))
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
                        url: check.details_url.or(check.target_url),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_default_branch(repo_path: &str, node: BranchRefNode) -> DefaultBranch {
    let (head_sha, last_commit_at, rollup) = match node.target {
        Some(commit) => (
            Some(commit.oid),
            Some(commit.committed_date),
            commit.status_check_rollup,
        ),
        None => (None, None, None),
    };

    DefaultBranch {
        repo_path: repo_path.to_string(),
        branch: node.name,
        checks: rollup.as_ref().and_then(|rollup| map_checks(&rollup.state)),
        check_runs: map_check_runs(rollup),
        head_sha,
        last_commit_at,
    }
}

fn map_reviews(reviews: Option<Nodes<ReviewNode>>) -> Vec<Review> {
    reviews
        .map(|reviews| {
            reviews
                .nodes
                .into_iter()
                .filter_map(|review| {
                    // Deleted accounts come back without an author
                    Some(Review {
                        login: review.author?.login,
                        state: review.state,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_pull_request(repo_path: &str, node: PullRequestNode) -> Option<PullRequest> {
    let is_requested = node.viewer_latest_review_request.is_some() && !node.viewer_did_author;
    let is_relevant = node.viewer_did_author || is_requested;

    // Someone else's pull request is only here to name its branch, and a fork's
    // branch isn't one of this repo's, even when the names match.
    if !is_relevant && node.is_cross_repository {
        return None;
    }

    // Checks are only for head_sha if they were read from that exact commit
    let head_commit = node
        .commits
        .and_then(|commits| commits.nodes.into_iter().next())
        .map(|node| node.commit)
        .filter(|commit| commit.oid == node.head_ref_oid);
    let (last_commit_at, rollup) = match head_commit {
        Some(commit) => (Some(commit.committed_date), commit.status_check_rollup),
        None => (None, None),
    };

    let review = if is_requested {
        Some("requested")
    } else if !node.viewer_did_author {
        // Their review state is theirs to act on, and `reviews` still has it
        None
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
        reviews: map_reviews(node.latest_opinionated_reviews),
        head_sha: node.head_ref_oid,
        last_commit_at,
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

fn parse_accounts(stdout: &[u8]) -> Vec<GitHubAccount> {
    serde_json::from_slice::<AuthStatus>(stdout)
        .ok()
        .and_then(|mut status| status.hosts.remove(GITHUB_HOST))
        .unwrap_or_default()
        .into_iter()
        .map(|account| GitHubAccount {
            login: account.login,
            active: account.active,
        })
        .collect()
}

/// Every account gh is signed in to. Empty when gh is missing, signed out or
/// too old to list them as JSON, and get_github_status says which.
#[tauri::command]
pub(crate) async fn list_github_accounts() -> Vec<GitHubAccount> {
    let Some(gh) = find_executable("gh").await else {
        return Vec::new();
    };

    let mut command = Command::new(gh);
    command
        .args(["auth", "status", "--json", "hosts"])
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .kill_on_drop(true);

    match tokio::time::timeout(GH_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => parse_accounts(&output.stdout),
        _ => Vec::new(),
    }
}

fn graphql_command(gh: PathBuf, auth: Option<&GitHubAuth>, repos: &[GitHubRepo]) -> Command {
    let mut command = Command::new(gh);
    if let Some(auth) = auth {
        auth.sign_in_gh(&mut command);
    }
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
/// that refresh works too. Without an account, gh uses its active one.
#[tauri::command]
pub(crate) async fn get_github_status(
    repo_paths: Vec<String>,
    github_account: Option<String>,
) -> GitHubStatus {
    let Some(gh) = find_executable("gh").await else {
        return GitHubStatus::GhMissing;
    };

    let auth = match github_account {
        Some(login) => match GitHubAuth::for_account(&gh, &login).await {
            Ok(auth) => Some(auth),
            Err(detail) => return GitHubStatus::AccountMissing { login, detail },
        },
        None => None,
    };

    let repos = github_repos(&repo_paths);
    let mut command = graphql_command(gh, auth.as_ref(), &repos);
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
    github_account: Option<String>,
) -> Result<PullRequestSnapshot, String> {
    let repos = github_repos(&repo_paths);
    if repos.is_empty() {
        return Ok(PullRequestSnapshot {
            pull_requests: Vec::new(),
            default_branches: Vec::new(),
            rate_remaining: None,
        });
    }

    let gh = find_executable("gh")
        .await
        .ok_or_else(|| "GitHub CLI (gh) is not installed".to_string())?;

    let auth = match github_account {
        Some(login) => Some(GitHubAuth::for_account(&gh, &login).await?),
        None => None,
    };

    let output = tokio::time::timeout(
        GH_TIMEOUT,
        graphql_command(gh, auth.as_ref(), &repos).output(),
    )
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
            "headRefOid": "abc123",
            "isCrossRepository": false,
            "mergedAt": null,
            "additions": 3,
            "deletions": 1,
            "reviewDecision": null,
            "viewerDidAuthor": true,
            "comments": { "totalCount": 2 },
            "viewerLatestReviewRequest": null,
        })
    }

    /// The head commit of `pull_request`, with these checks on it
    fn head_commit(checks: Value) -> Value {
        json!({
            "nodes": [{
                "commit": {
                    "oid": "abc123",
                    "committedDate": "2026-11-01T09:00:00Z",
                    "statusCheckRollup": checks,
                },
            }],
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
        assert_eq!(
            serde_json::to_value(GitHubStatus::AccountMissing {
                login: "marcel-work".to_string(),
                detail: "no oauth token found".to_string(),
            })
            .unwrap(),
            json!({
                "state": "account_missing",
                "login": "marcel-work",
                "detail": "no oauth token found",
            })
        );
    }

    #[test]
    fn lists_every_github_com_account_and_which_is_active() {
        let stdout = json!({
            "hosts": {
                "github.com": [
                    { "state": "success", "active": true, "login": "marcelmarais" },
                    { "state": "error", "active": false, "login": "marcel-work" },
                ],
                "github.example.com": [
                    { "state": "success", "active": true, "login": "enterprise" },
                ],
            }
        })
        .to_string();

        assert_eq!(
            parse_accounts(stdout.as_bytes()),
            vec![
                GitHubAccount {
                    login: "marcelmarais".to_string(),
                    active: true,
                },
                GitHubAccount {
                    login: "marcel-work".to_string(),
                    active: false,
                },
            ]
        );
    }

    #[test]
    fn no_accounts_when_gh_is_signed_out_or_too_old_for_json() {
        assert!(parse_accounts(br#"{"hosts":{}}"#).is_empty());
        assert!(parse_accounts(b"unknown flag: --json").is_empty());
    }

    fn auth() -> GitHubAuth {
        GitHubAuth {
            gh: PathBuf::from("/opt/it's here/gh"),
            token: "secret".to_string(),
        }
    }

    fn env_of<'a>(command: &'a Command, name: &str) -> Option<&'a std::ffi::OsStr> {
        command
            .as_std()
            .get_envs()
            .find_map(|(key, value)| (key == name).then_some(value)?)
    }

    #[test]
    fn a_chosen_account_reaches_gh_as_its_token() {
        let chosen = graphql_command(PathBuf::from("gh"), Some(&auth()), &[]);
        let active = graphql_command(PathBuf::from("gh"), None, &[]);

        assert_eq!(env_of(&chosen, "GH_TOKEN"), Some("secret".as_ref()));
        assert_eq!(env_of(&active, "GH_TOKEN"), None);
    }

    #[test]
    fn a_chosen_account_replaces_gits_credential_helpers_for_github() {
        let mut command = Command::new("git");
        auth().sign_in_git(&mut command);
        command.arg("fetch");

        let args: Vec<_> = command.as_std().get_args().collect();
        assert_eq!(
            args,
            [
                "-c",
                "credential.https://github.com.helper=",
                "-c",
                r"credential.https://github.com.helper=!'/opt/it'\''s here/gh' auth git-credential",
                "fetch",
            ]
        );
        assert_eq!(env_of(&command, "GH_TOKEN"), Some("secret".as_ref()));
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
    fn keeps_other_peoples_pull_requests_but_flags_only_mine_and_requested() {
        let mut colleague = pull_request(2);
        colleague["viewerDidAuthor"] = json!(false);
        colleague["reviewDecision"] = json!("CHANGES_REQUESTED");

        let mut requested = pull_request(3);
        requested["viewerDidAuthor"] = json!(false);
        requested["viewerLatestReviewRequest"] = json!({ "id": "abc" });

        let snapshot = parse_snapshot(
            &response(vec![pull_request(1), colleague, requested], vec![]),
            &[repo("/repo")],
        )
        .unwrap();

        let numbers: Vec<u64> = snapshot.pull_requests.iter().map(|pr| pr.number).collect();
        assert_eq!(numbers, vec![1, 2, 3]);
        assert!(snapshot.pull_requests[0].is_mine);
        assert!(!snapshot.pull_requests[1].is_mine);
        assert_eq!(snapshot.pull_requests[1].review, None);
        assert_eq!(snapshot.pull_requests[2].review, Some("requested"));
        assert!(!snapshot.pull_requests[2].is_mine);
        assert_eq!(snapshot.rate_remaining, Some(4200));
    }

    #[test]
    fn someone_elses_fork_has_no_branch_here_to_join() {
        let mut fork = pull_request(2);
        fork["viewerDidAuthor"] = json!(false);
        fork["isCrossRepository"] = json!(true);

        let mut my_fork = pull_request(3);
        my_fork["isCrossRepository"] = json!(true);

        let snapshot =
            parse_snapshot(&response(vec![fork, my_fork], vec![]), &[repo("/repo")]).unwrap();

        let numbers: Vec<u64> = snapshot.pull_requests.iter().map(|pr| pr.number).collect();
        assert_eq!(numbers, vec![3]);
    }

    #[test]
    fn checks_on_any_commit_but_the_head_are_dropped() {
        let checks = json!({
            "state": "SUCCESS",
            "contexts": { "nodes": [{ "name": "Lint", "conclusion": "SUCCESS" }] },
        });

        let mut on_head = pull_request(1);
        on_head["commits"] = head_commit(checks.clone());

        let mut on_older = pull_request(2);
        on_older["headRefOid"] = json!("def456");
        on_older["commits"] = head_commit(checks);

        let snapshot =
            parse_snapshot(&response(vec![on_head, on_older], vec![]), &[repo("/repo")]).unwrap();

        let on_head = &snapshot.pull_requests[0];
        assert_eq!(on_head.head_sha, "abc123");
        assert_eq!(
            on_head.last_commit_at.as_deref(),
            Some("2026-11-01T09:00:00Z")
        );
        assert_eq!(on_head.checks, Some("pass"));

        let on_older = &snapshot.pull_requests[1];
        assert_eq!(on_older.head_sha, "def456");
        assert_eq!(on_older.last_commit_at, None);
        assert_eq!(on_older.checks, None);
        assert!(on_older.check_runs.is_empty());
    }

    #[test]
    fn merged_pull_requests_keep_their_head_but_no_checks() {
        let mut merged = pull_request(1);
        merged["mergedAt"] = json!("2026-11-01T10:00:00Z");
        merged["commits"] = json!({
            "nodes": [{
                "commit": { "oid": "abc123", "committedDate": "2026-11-01T09:00:00Z" },
            }],
        });

        let snapshot = parse_snapshot(&response(vec![], vec![merged]), &[repo("/repo")]).unwrap();

        assert_eq!(snapshot.pull_requests[0].head_sha, "abc123");
        assert_eq!(
            snapshot.pull_requests[0].last_commit_at.as_deref(),
            Some("2026-11-01T09:00:00Z")
        );
        assert_eq!(snapshot.pull_requests[0].checks, None);
    }

    #[test]
    fn reads_each_reviewer_and_skips_deleted_accounts() {
        let mut reviewed = pull_request(1);
        reviewed["latestOpinionatedReviews"] = json!({
            "nodes": [
                { "state": "APPROVED", "author": { "login": "colleague" } },
                { "state": "CHANGES_REQUESTED", "author": null },
            ],
        });

        let snapshot = parse_snapshot(&response(vec![reviewed], vec![]), &[repo("/repo")]).unwrap();

        assert_eq!(
            snapshot.pull_requests[0].reviews,
            vec![Review {
                login: "colleague".to_string(),
                state: "APPROVED".to_string(),
            }]
        );
    }

    #[test]
    fn reads_each_check_and_merged_state() {
        let mut failing = pull_request(1);
        failing["commits"] = head_commit(json!({
            "state": "FAILURE",
            "contexts": {
                "nodes": [
                    { "name": "Lint", "conclusion": "SUCCESS", "detailsUrl": "https://ci/lint" },
                    { "name": "Build macOS App", "conclusion": "FAILURE" },
                    { "context": "ci/legacy", "state": "ERROR", "targetUrl": "https://ci/legacy" },
                    { "name": "Deploy", "conclusion": "CANCELLED" },
                    { "name": "Build Windows App", "conclusion": "SKIPPED" },
                    { "name": "Test", "conclusion": null },
                    { "context": "ci/queue", "state": "PENDING" },
                ],
            },
        }));

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
        let check_runs = &snapshot.pull_requests[0].check_runs;
        assert_eq!(check_runs[0].url.as_deref(), Some("https://ci/lint"));
        assert_eq!(check_runs[1].url, None);
        assert_eq!(check_runs[2].url.as_deref(), Some("https://ci/legacy"));
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
                            "oid": "abc123",
                            "committedDate": "2026-11-01T09:00:00Z",
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
                        url: None,
                    },
                    CheckRun {
                        name: "Lint".to_string(),
                        status: "fail",
                        url: None,
                    },
                ],
                head_sha: Some("abc123".to_string()),
                last_commit_at: Some("2026-11-01T09:00:00Z".to_string()),
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
                        "target": {
                            "oid": "abc123",
                            "committedDate": "2026-11-01T09:00:00Z",
                            "statusCheckRollup": null,
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

    /// Runs the real query, so GitHub gets to reject it. Run with
    /// `REPOS=/path:/path cargo test read_real_repos -- --ignored --nocapture`,
    /// adding `GITHUB_ACCOUNT=login` to read them as that account
    #[test]
    #[ignore]
    fn read_real_repos() {
        let repos = std::env::var("REPOS").unwrap();
        let repos = repos.split(':').map(str::to_string).collect();

        let account = std::env::var("GITHUB_ACCOUNT").ok();

        let snapshot = tauri::async_runtime::block_on(get_pull_requests(repos, account)).unwrap();

        println!("{}", serde_json::to_string(&snapshot).unwrap());
    }

    /// Lists the accounts the real gh is signed in to. Run with
    /// `cargo test list_real_accounts -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn list_real_accounts() {
        let accounts = tauri::async_runtime::block_on(list_github_accounts());

        println!("{accounts:?}");
        assert!(!accounts.is_empty());
    }
}
