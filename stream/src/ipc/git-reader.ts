import { invoke } from "@tauri-apps/api/core";

/**
 * TypeScript interfaces matching Rust structs
 */
export interface GitCommit {
  id: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: number; // Unix timestamp in milliseconds
  date: string; // ISO 8601 date string (YYYY-MM-DD)
  repo_path: string;
  branches: string[]; // Branches that contain this commit
  url?: string; // URL to commit on remote (if available)
}

export interface RepoCommits {
  repo_path: string;
  commits: GitCommit[];
  error?: string;
}

export type PullRequestState = "open" | "draft" | "merged";
export type PullRequestChecks = "pass" | "fail" | "running";
export type PullRequestReview = "requested" | "changes" | "approved";
export type CheckRunStatus = PullRequestChecks | "skipped";

export interface CheckRun {
  name: string;
  status: CheckRunStatus;
}

export interface PullRequest {
  repo_path: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  branch: string;
  additions: number;
  deletions: number;
  comments: number;
  checks: PullRequestChecks | null;
  check_runs: CheckRun[];
  review: PullRequestReview | null;
  merged_at: string | null; // ISO 8601 timestamp
}

export interface DefaultBranch {
  repo_path: string;
  branch: string;
  checks: PullRequestChecks | null;
  check_runs: CheckRun[];
}

export interface PullRequestSnapshot {
  pull_requests: PullRequest[];
  default_branches: DefaultBranch[];
  rate_remaining: number | null; // GitHub API points left this hour
}

export interface UnreadableRepo {
  name: string; // owner/name
  message: string;
}

export type GitHubStatus =
  | {
      state: "connected";
      login: string;
      repo_count: number; // Connected repositories hosted on GitHub
      unreadable_repos: UnreadableRepo[];
      needs_repo_scope: boolean;
    }
  | { state: "gh_missing" }
  | { state: "logged_out" }
  | { state: "token_rejected"; detail: string }
  | { state: "rate_limited"; detail: string }
  | { state: "unreachable"; detail: string }
  | { state: "failed"; detail: string };

export interface DiscoveredRepo {
  path: string;
  display_path: string;
  name: string;
  last_modified: number | null; // Unix timestamp in milliseconds
}

/**
 * Find git repositories on this machine, most recently active first
 */
export async function discoverGitRepos(
  knownRepos: string[],
): Promise<DiscoveredRepo[]> {
  return invoke("discover_git_repos", { knownRepos });
}

/**
 * Date range interface for filtering commits
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Commits grouped by date for easy matching with markdown files
 */
export interface CommitsByDate {
  [dateString: string]: {
    date: string;
    commits: GitCommit[];
    repoCount: number;
  };
}

/**
 * Get git commits for multiple repositories within a date range
 */
export async function getGitCommitsForRepos(
  repoPaths: string[],
  dateRange: DateRange,
): Promise<RepoCommits[]> {
  try {
    const startTimestamp = dateRange.startDate.getTime();
    const endTimestamp = dateRange.endDate.getTime();

    const results: RepoCommits[] = await invoke("get_git_commits_for_repos", {
      repoPaths,
      startTimestamp,
      endTimestamp,
    });

    return results;
  } catch (error) {
    console.error("Error fetching git commits:", error);
    throw new Error(`Failed to fetch git commits: ${error}`);
  }
}

/**
 * Get my pull requests and review requests for repositories hosted on GitHub.
 * Goes through the gh CLI, so it uses whatever account gh is signed in to.
 */
export async function getPullRequests(
  repoPaths: string[],
): Promise<PullRequestSnapshot> {
  return invoke("get_pull_requests", { repoPaths });
}

/**
 * Ask GitHub, through the gh CLI, who is signed in and which repositories
 * that account can read. Never rejects: failures come back as a status.
 */
export async function getGitHubStatus(
  repoPaths: string[],
): Promise<GitHubStatus> {
  return invoke("get_github_status", { repoPaths });
}

/**
 * Group commits by date for easy matching with markdown files
 */
export function groupCommitsByDate(repoCommits: RepoCommits[]): CommitsByDate {
  const commitsByDate: CommitsByDate = {};

  for (const repoCommit of repoCommits) {
    if (repoCommit.error) {
      console.warn(
        `Error from repo ${repoCommit.repo_path}: ${repoCommit.error}`,
      );
      continue;
    }

    for (const commit of repoCommit.commits) {
      const dateKey = commit.date; // Already in YYYY-MM-DD format

      if (!commitsByDate[dateKey]) {
        commitsByDate[dateKey] = {
          date: dateKey,
          commits: [],
          repoCount: 0,
        };
      }

      commitsByDate[dateKey].commits.push(commit);

      // Track unique repositories for this date
      const reposForDate = new Set(
        commitsByDate[dateKey].commits.map((c) => c.repo_path),
      );
      commitsByDate[dateKey].repoCount = reposForDate.size;
    }
  }

  // Sort commits within each date by timestamp (newest first)
  for (const dateData of Object.values(commitsByDate)) {
    dateData.commits.sort((a, b) => b.timestamp - a.timestamp);
  }

  return commitsByDate;
}

/**
 * Get commits for a specific date
 */
export function getCommitsForDate(
  commitsByDate: CommitsByDate,
  date: Date,
): GitCommit[] {
  const dateKey = date.toISOString().split("T")[0]; // YYYY-MM-DD format
  return commitsByDate[dateKey]?.commits || [];
}

/**
 * Check if there are any commits for a specific date
 */
export function hasCommitsForDate(
  commitsByDate: CommitsByDate,
  date: Date,
): boolean {
  const dateKey = date.toISOString().split("T")[0];
  return Boolean(
    commitsByDate[dateKey] && commitsByDate[dateKey].commits.length > 0,
  );
}

/**
 * Get repository statistics for commits
 */
export function getRepoStats(repoCommits: RepoCommits[]): {
  totalRepos: number;
  successfulRepos: number;
  errorRepos: number;
  totalCommits: number;
} {
  const totalRepos = repoCommits.length;
  const errorRepos = repoCommits.filter((r) => r.error).length;
  const successfulRepos = totalRepos - errorRepos;
  const totalCommits = repoCommits
    .filter((r) => !r.error)
    .reduce((sum, r) => sum + r.commits.length, 0);

  return {
    totalRepos,
    successfulRepos,
    errorRepos,
    totalCommits,
  };
}

/**
 * Format commit message for display (truncate if too long)
 */
export function formatCommitMessage(
  message: string,
  maxLength: number = 50,
): string {
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.substring(0, maxLength - 3)}...`;
}

const MAIN_BRANCH_NAMES = [
  "main",
  "master",
  "origin/main",
  "origin/master",
  "develop",
  "origin/develop",
];

export function isMainBranch(branchName: string): boolean {
  return MAIN_BRANCH_NAMES.includes(branchName);
}

/**
 * Create date range helpers
 */
export const createDateRange = {
  /**
   * Creates a date range for the last N days
   */
  lastDays: (days: number): DateRange => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  },

  /**
   * Creates a date range for the current month
   */
  currentMonth: (): DateRange => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  },

  /**
   * Creates a date range from specific start and end dates
   */
  custom: (startDate: Date, endDate: Date): DateRange => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { startDate: start, endDate: end };
  },
};
