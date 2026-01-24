import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  type CommitsByDate,
  createDateRange,
  getGitCommitsForRepos,
  groupCommitsByDate,
} from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";

const REPO_MAPPINGS_STORE_FILE = "repo-mappings.json";

export interface FetchResult {
  repo_path: string;
  success: boolean;
  message: string;
}

export const gitKeys = {
  all: ["git"] as const,
  repos: (folderPath: string) => [...gitKeys.all, "repos", folderPath] as const,
  commits: (folderPath: string, dateKey: string, repos: string[]) =>
    [...gitKeys.all, "commits", folderPath, dateKey, repos] as const,
};

/**
 * Helper function to get connected repos from store
 */
export async function getConnectedRepos(
  markdownDirectory: string,
): Promise<string[]> {
  try {
    const store = await load(REPO_MAPPINGS_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });

    const mappings = await store.get<Record<string, string[]>>("mappings");
    return mappings?.[markdownDirectory] || [];
  } catch (error) {
    console.warn("Failed to get connected repos:", error);
    return [];
  }
}

/**
 * Helper function to save repo mappings to store
 */
async function saveRepoMappings(
  markdownDirectory: string,
  repos: string[],
): Promise<void> {
  try {
    const store = await load(REPO_MAPPINGS_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });

    const existingMappings =
      (await store.get<Record<string, string[]>>("mappings")) || {};

    if (repos.length === 0) {
      delete existingMappings[markdownDirectory];
    } else {
      existingMappings[markdownDirectory] = repos;
    }

    await store.set("mappings", existingMappings);
    console.log("Saved repo mappings:", existingMappings);
  } catch (error) {
    console.error("Failed to save repo mappings:", error);
    throw error;
  }
}

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
 * Hook to add a repository to the connected repos list
 */
export function useAddRepo(folderPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (repoPath: string) => {
      const currentRepos = await getConnectedRepos(folderPath);

      if (currentRepos.includes(repoPath)) {
        return currentRepos;
      }

      const updatedRepos = [...currentRepos, repoPath];
      await saveRepoMappings(folderPath, updatedRepos);
      return updatedRepos;
    },
    onSuccess: (updatedRepos) => {
      queryClient.setQueryData(gitKeys.repos(folderPath), updatedRepos);
    },
  });
}

/**
 * Hook to remove a repository from the connected repos list
 */
export function useRemoveRepo(folderPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (repoPath: string) => {
      const currentRepos = await getConnectedRepos(folderPath);
      const updatedRepos = currentRepos.filter((repo) => repo !== repoPath);
      await saveRepoMappings(folderPath, updatedRepos);
      return updatedRepos;
    },
    onSuccess: (updatedRepos) => {
      queryClient.setQueryData(gitKeys.repos(folderPath), updatedRepos);
    },
  });
}

/**
 * Hook to fetch (git fetch) all connected repositories
 */
export function useFetchRepos(folderPath: string) {
  const queryClient = useQueryClient();
  const { data: repos = [] } = useConnectedRepos(folderPath);

  return useMutation({
    mutationFn: async () => {
      if (repos.length === 0) {
        return [];
      }
      const results: FetchResult[] = await invoke("fetch_repos", {
        repoPaths: repos,
      });
      return results;
    },
    onSuccess: (results) => {
      results.forEach((result) => {
        if (result.success) {
          toast.success(
            `${result.repo_path.split("/").pop()}: ${result.message}`,
          );
        } else {
          toast.error(
            `${result.repo_path.split("/").pop()}: ${result.message}`,
          );
        }
      });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === "git" &&
            key[1] === "commits" &&
            key[2] === folderPath
          );
        },
      });
    },
    onError: (error) => {
      console.error("Error fetching repositories:", error);
      toast.error(`Failed to fetch repositories: ${error}`);
    },
  });
}

/**
 * Hook to get commits for a specific date
 * Uses longer staleTime to avoid refetching during scroll
 * Set autoRefresh for focused/expanded cards only
 */
export function useCommitsForDate(
  folderPath: string,
  date: Date,
  options?: { enabled?: boolean; autoRefresh?: boolean },
) {
  const { enabled = true, autoRefresh = false } = options || {};
  const { data: repos = [] } = useConnectedRepos(folderPath);

  return useQuery({
    queryKey: gitKeys.commits(folderPath, getDateKey(date), repos),
    queryFn: async () => {
      if (repos.length === 0) {
        return {} as CommitsByDate;
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const range = createDateRange.custom(startOfDay, endOfDay);
      const repoCommits = await getGitCommitsForRepos(repos, range);
      return groupCommitsByDate(repoCommits);
    },
    enabled: enabled && repos.length > 0,
    refetchInterval: autoRefresh ? 10000 : false, // Only refresh focused cards, every 10s
    staleTime: 60000, // Consider fresh for 1 minute to avoid refetch storms during scroll
    gcTime: 300000, // Keep in cache for 5 minutes
  });
}

/**
 * Hook to get commits for multiple dates (based on visible files)
 * Uses staleTime to prevent refetch storms during rapid scroll
 */
export function useCommitsForVisibleFiles(
  folderPath: string,
  visibleFiles: MarkdownFileMetadata[],
) {
  const { data: repos = [] } = useConnectedRepos(folderPath);

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

  const queries = useQueries({
    queries: dateKeys.map((dateKey) => ({
      queryKey: gitKeys.commits(folderPath, dateKey, repos),
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
      enabled: dateKeys.length > 0 && repos.length > 0,
      staleTime: 60000, // Consider fresh for 1 minute
      gcTime: 300000, // Keep in cache for 5 minutes
    })),
  });

  const commitsByDate = useMemo(() => {
    const merged: CommitsByDate = {};
    for (const query of queries) {
      if (query.data) {
        Object.assign(merged, query.data);
      }
    }
    return merged;
  }, [queries]);

  const isLoading = queries.some((q) => q.isLoading);
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
    const repos = queryClient.getQueryData<string[]>(gitKeys.repos(folderPath));
    if (!repos || repos.length === 0) return;

    const datesToPrefetch = dateKeys.filter((dateKey) => {
      const cached = queryClient.getQueryData(
        gitKeys.commits(folderPath, dateKey, repos),
      );
      return cached === undefined;
    });

    if (datesToPrefetch.length === 0) return;

    await Promise.all(
      datesToPrefetch.map((dateKey) =>
        queryClient.prefetchQuery({
          queryKey: gitKeys.commits(folderPath, dateKey, repos),
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
 * Hook to get all loaded commits across all dates from the cache
 * Useful for building filters and aggregations
 */
export function useAllLoadedCommits(folderPath: string): CommitsByDate {
  const queryClient = useQueryClient();
  const queryCache = queryClient.getQueryCache();

  const allCommitQueries = queryCache.findAll({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        Array.isArray(key) &&
        key.length >= 4 &&
        key[0] === "git" &&
        key[1] === "commits" &&
        key[2] === folderPath
      );
    },
  });

  const merged: CommitsByDate = {};
  for (const query of allCommitQueries) {
    const data = query.state.data as CommitsByDate | undefined;
    if (data) {
      Object.assign(merged, data);
    }
  }

  return merged;
}
