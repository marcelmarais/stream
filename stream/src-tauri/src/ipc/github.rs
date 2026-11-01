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

#[derive(Debug)]
struct GitHubRepo {
    path: String,
    owner: String,
    name: String,
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

fn find_gh() -> Option<PathBuf> {
    let on_path = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|dir| dir.join("gh"));

    on_path
        .chain(GH_INSTALL_PATHS.iter().map(PathBuf::from))
        .find(|candidate| candidate.is_file())
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
        "query({variables}) {{\n  rateLimit {{ remaining }}\n{repositories}\n}}\n{PULL_REQUESTS_FRAGMENT}"
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

    let gh = find_gh().ok_or_else(|| "GitHub CLI (gh) is not installed".to_string())?;

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

    let output = tokio::time::timeout(GH_TIMEOUT, command.output())
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
