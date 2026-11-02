import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { useEffect, useMemo, useRef, useState } from "react";
import { listRunningAgents, type RunningAgent } from "@/ipc/agents";
import {
  type CommitsByDate,
  createDateRange,
  type DefaultBranch,
  discoverGitRepos,
  type GitHubStatus,
  getBranchTips,
  getGitCommitsForRepos,
  getGitHubStatus,
  getPullRequests,
  groupCommitsByDate,
  isMineOrRequested,
  type PullRequest,
  type PullRequestSnapshot,
} from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { useUserStore } from "@/stores/user-store";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";

const REPO_MAPPINGS_STORE_FILE = "repo-mappings.json";
const AGENT_POLL_INTERVAL_MS = 3000;
const FINISHED_AGENT_LINGER_MS = 5 * 60 * 1000;
const NO_AGENTS: RunningAgent[] = [];

const PULL_REQUEST_POLL_MS = 60000;
// Checks finish within minutes, so follow them more closely while they run
const PULL_REQUEST_ACTIVE_POLL_MS = 20000;
// While the window is in the background, gh is failing or the rate limit is low
const PULL_REQUEST_IDLE_POLL_MS = 300000;
// Coming back to the window refreshes anything older than this
const PULL_REQUEST_STALE_MS = 15000;
const LOW_RATE_LIMIT = 500;

// Local refs go stale without this, and only git can move them
const FETCH_POLL_MS = 5 * 60 * 1000;
// Coming back to the window fetches if the last fetch is older than this
const FETCH_STALE_MS = 2 * 60 * 1000;
const BRANCH_TIP_POLL_MS = 10000;

const NO_PULL_REQUESTS: PullRequest[] = [];
const NO_DEFAULT_BRANCHES: DefaultBranch[] = [];

export interface FetchResult {
  repo_path: string;
  success: boolean;
  message: string;
}

export const gitKeys = {
  all: ["git"] as const,
  repos: (folderPath: string) => [...gitKeys.all, "repos", folderPath] as const,
  discovered: (folderPath: string) =>
    [...gitKeys.all, "discovered", folderPath] as const,
  allCommits: (folderPath: string) =>
    [...gitKeys.all, "commits", folderPath] as const,
  commits: (folderPath: string, dateKey: string, repos: string[]) =>
    [...gitKeys.allCommits(folderPath), dateKey, repos] as const,
  pullRequests: (folderPath: string) =>
    [...gitKeys.all, "pull-requests", folderPath] as const,
  githubStatus: (folderPath: string) =>
    [...gitKeys.all, "github-status", folderPath] as const,
  agents: (repos: string[]) => [...gitKeys.all, "agents", repos] as const,
  fetch: (folderPath: string) => [...gitKeys.all, "fetch", folderPath] as const,
  branchTips: (repos: string[]) =>
    [...gitKeys.all, "branch-tips", repos] as const,
};

function pullRequestQuery(folderPath: string, repos: string[]) {
  return queryOptions({
    queryKey: [...gitKeys.pullRequests(folderPath), repos] as const,
    queryFn: () => getPullRequests(repos),
    staleTime: PULL_REQUEST_STALE_MS,
    retry: false,
  });
}

function refreshGitData(queryClient: QueryClient, folderPath: string) {
  queryClient.invalidateQueries({ queryKey: gitKeys.allCommits(folderPath) });
  queryClient.invalidateQueries({
    queryKey: gitKeys.pullRequests(folderPath),
  });
}

// A query rather than a mutation, so there's one run at a time however it was
// started, and every panel can read how the latest one went.
export function repoFetchQuery(folderPath: string, repos: string[]) {
  return queryOptions({
    queryKey: [...gitKeys.fetch(folderPath), repos] as const,
    queryFn: async ({ client }) => {
      const results: FetchResult[] = await invoke("fetch_repos", {
        repoPaths: repos,
      });
      refreshGitData(client, folderPath);
      return results;
    },
    staleTime: FETCH_STALE_MS,
    retry: false,
  });
}

/**
 * What git said about each repo that failed, or null if the fetch went fine
 */
export function getFetchFailure(
  results: FetchResult[] | undefined,
  error: Error | null,
): string | null {
  if (error) {
    return String(error);
  }

  const failed = (results ?? []).filter(({ success }) => !success);

  return failed.length > 0
    ? failed
        .map(
          ({ repo_path, message }) =>
            `${repo_path.split("/").pop()}: ${message}`,
        )
        .join("\n")
    : null;
}

export function getPullRequestPollInterval(
  snapshot: PullRequestSnapshot | undefined,
  hasFailed: boolean,
  isWindowFocused: boolean,
): number {
  const isRateLimitLow =
    snapshot?.rate_remaining != null &&
    snapshot.rate_remaining < LOW_RATE_LIMIT;

  if (!isWindowFocused || hasFailed || isRateLimitLow) {
    return PULL_REQUEST_IDLE_POLL_MS;
  }

  const checked = [
    ...(snapshot?.pull_requests ?? []).filter(isMineOrRequested),
    ...(snapshot?.default_branches ?? []),
  ];

  return checked.some(({ checks }) => checks === "running")
    ? PULL_REQUEST_ACTIVE_POLL_MS
    : PULL_REQUEST_POLL_MS;
}

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
 * Hook to find repositories on this machine. The scan takes milliseconds, so
 * it runs every time rather than keeping an index that could go stale.
 */
export function useDiscoveredRepos(folderPath: string) {
  return useQuery({
    queryKey: gitKeys.discovered(folderPath),
    queryFn: async () => discoverGitRepos(await getConnectedRepos(folderPath)),
    staleTime: 0,
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
      queryClient.invalidateQueries({
        queryKey: gitKeys.discovered(folderPath),
      });
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
 * Hook to fetch (git fetch) all connected repositories now. If a background
 * fetch is running, this waits for it instead of starting another.
 */
export function useFetchRepos(folderPath: string) {
  const queryClient = useQueryClient();
  const { data: repos = [] } = useConnectedRepos(folderPath);

  return useMutation({
    mutationFn: async () => {
      if (repos.length === 0) {
        return [];
      }
      return queryClient.fetchQuery({
        ...repoFetchQuery(folderPath, repos),
        staleTime: 0,
      });
    },
    onError: (error) => {
      console.error("Error fetching repositories:", error);
    },
  });
}

/**
 * Hook that keeps local refs current without anyone clicking. Mount it once,
 * for the same reason as usePullRequestPolling.
 */
function useBackgroundFetch(
  folderPath: string,
  repos: string[],
  isWindowFocused: boolean,
) {
  useQuery({
    ...repoFetchQuery(folderPath, repos),
    enabled: repos.length > 0,
    refetchInterval: isWindowFocused ? FETCH_POLL_MS : false,
  });
}

/**
 * Hook to read how the latest fetch went. Like usePullRequests it never fetches.
 */
export function useFetchFailure(folderPath: string): string | null {
  const { data: repos = [] } = useConnectedRepos(folderPath);
  const { data, error } = useQuery({
    ...repoFetchQuery(folderPath, repos),
    enabled: false,
  });

  return getFetchFailure(data, error);
}

/**
 * Hook that refreshes as soon as a commit or push moves a branch, rather than
 * leaving the row without checks until the next poll.
 */
function useBranchTipRefresh(
  folderPath: string,
  repos: string[],
  isWindowFocused: boolean,
) {
  const queryClient = useQueryClient();
  const { data: tips } = useQuery({
    queryKey: gitKeys.branchTips(repos),
    queryFn: () => getBranchTips(repos),
    enabled: repos.length > 0,
    staleTime: 0,
    retry: false,
    refetchInterval: isWindowFocused ? BRANCH_TIP_POLL_MS : false,
  });
  const seenTips = useRef(tips);

  // Structural sharing keeps the same array until a tip really changes
  useEffect(() => {
    if (seenTips.current && tips !== seenTips.current) {
      refreshGitData(queryClient, folderPath);
    }
    seenTips.current = tips;
  }, [folderPath, queryClient, tips]);
}

/**
 * Hook that keeps pull requests fresh. Mount it once: every refetchInterval runs
 * its own timer, so one per day card would multiply the calls to GitHub.
 */
export function usePullRequestPolling(folderPath: string) {
  const queryClient = useQueryClient();
  const { data: repos = [] } = useConnectedRepos(folderPath);
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  useQuery({
    ...pullRequestQuery(folderPath, repos),
    enabled: repos.length > 0,
    refetchInterval: (query) =>
      getPullRequestPollInterval(
        query.state.data,
        query.state.status === "error",
        isWindowFocused,
      ),
  });
  useBackgroundFetch(folderPath, repos, isWindowFocused);
  useBranchTipRefresh(folderPath, repos, isWindowFocused);

  useEffect(() => {
    let stopListening: (() => void) | undefined;
    let isCancelled = false;

    const startListening = async () => {
      const unlisten = await getCurrentWindow().onFocusChanged(
        ({ payload: isFocused }) => {
          setIsWindowFocused(isFocused);

          if (isFocused) {
            queryClient.refetchQueries({
              queryKey: gitKeys.fetch(folderPath),
              stale: true,
            });
            queryClient.refetchQueries({
              queryKey: gitKeys.pullRequests(folderPath),
              stale: true,
            });
            // Settings may be open while gh is fixed in a terminal
            queryClient.refetchQueries({
              queryKey: gitKeys.githubStatus(folderPath),
              type: "active",
            });
          }
        },
      );

      if (isCancelled) {
        unlisten();
      } else {
        stopListening = unlisten;
      }
    };

    try {
      void startListening().catch(() => {});
    } catch {
      // Browser previews do not expose the Tauri window API.
    }

    return () => {
      isCancelled = true;
      stopListening?.();
    };
  }, [folderPath, queryClient]);
}

/**
 * Hook to read pull requests from the cache. It never fetches, so mounting one
 * per day card costs nothing: usePullRequestPolling does the fetching.
 */
export function usePullRequests(folderPath: string): PullRequest[] {
  const { data: repos = [] } = useConnectedRepos(folderPath);
  const { data } = useQuery({
    ...pullRequestQuery(folderPath, repos),
    enabled: false,
  });

  return data?.pull_requests ?? NO_PULL_REQUESTS;
}

/**
 * Hook to read each repo's default branch and its checks from the same cache
 */
export function useDefaultBranches(folderPath: string): DefaultBranch[] {
  const { data: repos = [] } = useConnectedRepos(folderPath);
  const { data } = useQuery({
    ...pullRequestQuery(folderPath, repos),
    enabled: false,
  });

  return data?.default_branches ?? NO_DEFAULT_BRANCHES;
}

/**
 * Hook to check the GitHub connection for as long as it's mounted. Rechecking
 * refreshes pull requests too, which back off for minutes after a failure.
 */
export function useGitHubStatus(folderPath: string) {
  const queryClient = useQueryClient();
  const { data: repos } = useConnectedRepos(folderPath);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: [...gitKeys.githubStatus(folderPath), repos] as const,
    queryFn: () => getGitHubStatus(repos ?? []),
    enabled: repos !== undefined,
    staleTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const status: GitHubStatus | undefined =
    data ?? (error ? { state: "failed", detail: String(error) } : undefined);

  const recheck = () => {
    refetch();
    queryClient.invalidateQueries({
      queryKey: gitKeys.pullRequests(folderPath),
    });
  };

  return { status, isChecking: isFetching, recheck };
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
 * An agent leaves the running list the moment it finishes, so hold on to it for
 * a while to keep its chat a click away. Polling pauses while the window is
 * hidden, so the wait runs from when the app noticed, not when the agent stopped.
 */
export function keepFinishedAgents(
  running: RunningAgent[],
  previous: RunningAgent[],
  now: number,
): RunningAgent[] {
  const runningIds = new Set(running.map(({ id }) => id));
  const finished = previous
    .filter(({ id }) => !runningIds.has(id))
    .map((agent) => ({
      ...agent,
      status: "finished" as const,
      finished_at: agent.finished_at ?? now,
    }))
    .filter(({ finished_at }) => now - finished_at < FINISHED_AGENT_LINGER_MS);

  return [...running, ...finished];
}

/**
 * Hook to get the agents running in connected repositories, plus any that
 * finished in the last few minutes. Polling stops with the setting, and while
 * the window is hidden.
 */
export function useRunningAgents(
  folderPath: string,
  options?: { enabled?: boolean },
) {
  const { enabled = true } = options || {};
  const queryClient = useQueryClient();
  const agentsEnabled = useUserStore((state) => state.agentsEnabled);
  const { data: repos = [] } = useConnectedRepos(folderPath);
  const isActive = enabled && agentsEnabled && repos.length > 0;
  const queryKey = gitKeys.agents(repos);

  const { data = NO_AGENTS } = useQuery({
    queryKey,
    queryFn: async () =>
      keepFinishedAgents(
        await listRunningAgents(repos),
        queryClient.getQueryData<RunningAgent[]>(queryKey) ?? NO_AGENTS,
        Date.now(),
      ),
    enabled: isActive,
    refetchInterval: AGENT_POLL_INTERVAL_MS,
  });

  return isActive ? data : NO_AGENTS;
}

/**
 * Agents are happening now, so they only belong on today's note
 */
export function useAgentsForDate(folderPath: string, date: Date) {
  return useRunningAgents(folderPath, {
    enabled: getDateKey(date) === getDateKey(new Date()),
  });
}
