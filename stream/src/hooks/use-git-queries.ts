import {
  type QueryClient,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { getConnectedRepos } from "@/components/repo-connector";
import {
  type CommitsByDate,
  createDateRange,
  getGitCommitsForRepos,
  groupCommitsByDate,
} from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";

// Query keys
export const gitKeys = {
  all: ["git"] as const,
  repos: (folderPath: string) => [...gitKeys.all, "repos", folderPath] as const,
  commits: (folderPath: string, dateKey: string) =>
    [...gitKeys.all, "commits", folderPath, dateKey] as const,
};

/**
 * Hook to get connected git repositories for a folder
 */
export function useConnectedRepos(folderPath: string) {
  return useQuery({
    queryKey: gitKeys.repos(folderPath),
    queryFn: async () => {
      const repos = await getConnectedRepos(folderPath);
      return repos;
    },
    enabled: !!folderPath,
    staleTime: 30000, // Consider repos fresh for 30 seconds
  });
}

/**
 * Hook to get commits for a specific date
 * Automatically refetches every 5 seconds
 */
export function useCommitsForDate(
  folderPath: string,
  dateKey: string,
  enabled = true,
) {
  const { data: repos = [] } = useConnectedRepos(folderPath);

  return useQuery({
    queryKey: gitKeys.commits(folderPath, dateKey),
    queryFn: async () => {
      if (repos.length === 0) {
        return {} as CommitsByDate;
      }

      const date = new Date(dateKey);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const range = createDateRange.custom(startOfDay, endOfDay);
      const repoCommits = await getGitCommitsForRepos(repos, range);
      return groupCommitsByDate(repoCommits);
    },
    enabled: enabled && repos.length > 0,
    refetchInterval: 5000, // Auto-refresh every 5 seconds
    staleTime: 0, // Always consider stale so refetchInterval works
  });
}

/**
 * Hook to get commits for multiple dates (based on visible files)
 * Automatically refetches every 5 seconds
 */
export function useCommitsForVisibleFiles(
  folderPath: string,
  visibleFiles: MarkdownFileMetadata[],
) {
  // Extract unique date keys from visible files
  const dateKeys = useMemo(() => {
    return Array.from(
      new Set(
        visibleFiles.map((file) => {
          const dateFromFilename = getDateFromFilename(file.fileName);
          return dateFromFilename || getDateKey(file.createdAt);
        }),
      ),
    );
  }, [visibleFiles]);

  // Use useQueries to fetch commits for all dates in parallel
  const queries = useQueries({
    queries: dateKeys.map((dateKey) => ({
      queryKey: gitKeys.commits(folderPath, dateKey),
      queryFn: async () => {
        const repos = await getConnectedRepos(folderPath);
        if (repos.length === 0) {
          return {} as CommitsByDate;
        }

        const date = new Date(dateKey);
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const range = createDateRange.custom(startOfDay, endOfDay);
        const repoCommits = await getGitCommitsForRepos(repos, range);
        return groupCommitsByDate(repoCommits);
      },
      enabled: dateKeys.length > 0,
      refetchInterval: 5000, // Auto-refresh every 5 seconds
      staleTime: 0, // Always consider stale so refetchInterval works
    })),
  });

  // Merge all commits from different dates
  const commitsByDate = useMemo(() => {
    const merged: CommitsByDate = {};
    for (const query of queries) {
      if (query.data) {
        Object.assign(merged, query.data);
      }
    }
    return merged;
  }, [queries]);

  // Check if any query is loading
  const isLoading = queries.some((q) => q.isLoading);

  // Get first error if any
  const error = queries.find((q) => q.error)?.error;

  return {
    commitsByDate,
    isLoading,
    error,
    dateKeys,
  };
}

/**
 * Hook to prefetch commits for dates that will soon be visible
 */
export function usePrefetchCommitsForDates() {
  const queryClient = useQueryClient();

  return async (folderPath: string, dateKeys: string[]) => {
    // Get repos once
    const repos = await getConnectedRepos(folderPath);
    if (repos.length === 0) return;

    // Filter out dates we already have cached
    const datesToPrefetch = dateKeys.filter((dateKey) => {
      const cached = queryClient.getQueryData(
        gitKeys.commits(folderPath, dateKey),
      );
      return cached === undefined;
    });

    if (datesToPrefetch.length === 0) return;

    // Prefetch all dates in parallel
    await Promise.all(
      datesToPrefetch.map((dateKey) =>
        queryClient.prefetchQuery({
          queryKey: gitKeys.commits(folderPath, dateKey),
          queryFn: async () => {
            const date = new Date(dateKey);
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            const range = createDateRange.custom(startOfDay, endOfDay);
            const repoCommits = await getGitCommitsForRepos(repos, range);
            return groupCommitsByDate(repoCommits);
          },
          staleTime: 5000,
        }),
      ),
    );
  };
}

/**
 * Hook to get a specific date's commits from cache
 */
export function useCommitsForDateFromCache(
  folderPath: string,
  dateKey: string,
): CommitsByDate | undefined {
  const queryClient = useQueryClient();
  return queryClient.getQueryData(gitKeys.commits(folderPath, dateKey));
}

/**
 * Hook to get all loaded commits across all dates from the cache
 * Useful for building filters and aggregations
 */
export function useAllLoadedCommits(folderPath: string): CommitsByDate {
  const queryClient = useQueryClient();
  const queryCache = queryClient.getQueryCache();

  // Get all commit queries for this folder
  const allCommitQueries = queryCache.findAll({
    predicate: (query) => {
      const key = query.queryKey;
      // Match queries that start with ["git", "commits", folderPath]
      return (
        Array.isArray(key) &&
        key.length >= 3 &&
        key[0] === "git" &&
        key[1] === "commits" &&
        key[2] === folderPath
      );
    },
  });

  // Merge all commits from different dates
  const merged: CommitsByDate = {};
  for (const query of allCommitQueries) {
    const data = query.state.data as CommitsByDate | undefined;
    if (data) {
      Object.assign(merged, data);
    }
  }

  return merged;
}

/**
 * Utility function to get commits for a specific date from the query cache
 * Use this in non-React contexts (like Tiptap extensions)
 */
export function getCommitsForDateFromCache(
  queryClient: QueryClient,
  folderPath: string,
  dateKey: string,
): CommitsByDate | undefined {
  return queryClient.getQueryData(gitKeys.commits(folderPath, dateKey));
}
