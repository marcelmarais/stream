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
  files_changed: string[];
  branches: string[]; // Branches that contain this commit
}

export interface RepoCommits {
  repo_path: string;
  commits: GitCommit[];
  error?: string;
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

/**
 * Format commit author for display
 */
export function formatCommitAuthor(commit: GitCommit): string {
  return commit.author_name || commit.author_email || "Unknown";
}

/**
 * Get short commit ID (first 7 characters)
 */
export function getShortCommitId(commitId: string): string {
  return commitId.substring(0, 7);
}

/**
 * Filter commits based on author, repository, and search criteria
 */
export interface CommitFilters {
  authors: string[];
  repos: string[];
  searchTerm: string;
}

export function filterCommits(
  commits: GitCommit[],
  filters: CommitFilters,
): GitCommit[] {
  if (
    filters.authors.length === 0 &&
    filters.repos.length === 0 &&
    filters.searchTerm.length === 0
  ) {
    return commits;
  }

  return commits.filter((commit) => {
    // Author filter
    if (filters.authors.length > 0) {
      const author = formatCommitAuthor(commit);
      if (!filters.authors.includes(author)) {
        return false;
      }
    }

    // Repo filter
    if (filters.repos.length > 0) {
      const repoName = commit.repo_path.split("/").pop() || commit.repo_path;
      if (!filters.repos.includes(repoName)) {
        return false;
      }
    }

    // Search term filter
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const messageMatch = commit.message.toLowerCase().includes(searchLower);
      const authorMatch = formatCommitAuthor(commit)
        .toLowerCase()
        .includes(searchLower);
      const repoMatch = commit.repo_path.toLowerCase().includes(searchLower);

      if (!messageMatch && !authorMatch && !repoMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Apply filters to commitsByDate structure
 */
export function filterCommitsByDate(
  commitsByDate: CommitsByDate,
  filters: CommitFilters,
): CommitsByDate {
  if (
    filters.authors.length === 0 &&
    filters.repos.length === 0 &&
    filters.searchTerm.length === 0
  ) {
    return commitsByDate;
  }

  const filtered: CommitsByDate = {};

  Object.entries(commitsByDate).forEach(([dateKey, dateData]) => {
    const filteredCommits = filterCommits(dateData.commits, filters);

    if (filteredCommits.length > 0) {
      // Recalculate repo count for filtered commits
      const reposForDate = new Set(filteredCommits.map((c) => c.repo_path));

      filtered[dateKey] = {
        date: dateData.date,
        commits: filteredCommits,
        repoCount: reposForDate.size,
      };
    }
  });

  return filtered;
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
