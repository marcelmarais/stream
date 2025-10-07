import { create } from "zustand";
import { getConnectedRepos } from "@/components/repo-connector";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";
import type { CommitFilters, CommitsByDate } from "@/utils/git-reader";
import {
  createDateRange,
  getGitCommitsForRepos,
  groupCommitsByDate,
} from "@/utils/git-reader";
import type { MarkdownFileMetadata } from "@/utils/markdown-reader";

interface GitCommitsState {
  // Data
  commitsByDate: CommitsByDate;
  connectedReposCount: number;

  // Filters
  commitFilters: CommitFilters;

  // Status
  error: string | null;
  isLoading: boolean;

  // Actions
  setCommitsByDate: (commits: CommitsByDate) => void;
  mergeCommitsByDate: (commits: CommitsByDate) => void;
  setCommitFilters: (filters: CommitFilters) => void;
  setConnectedReposCount: (count: number) => void;
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  reset: () => void;

  // Async actions
  loadConnectedReposCount: (folderPath: string) => Promise<void>;
  loadCommitsForVisibleFiles: (
    folderPath: string,
    visibleFiles: MarkdownFileMetadata[],
  ) => Promise<void>;
  refreshAllCommits: (
    folderPath: string,
    loadedDates: string[],
  ) => Promise<void>;
}

const initialState = {
  commitsByDate: {},
  connectedReposCount: 0,
  commitFilters: {
    authors: [],
    repos: [],
    searchTerm: "",
  },
  error: null,
  isLoading: false,
};

export const useGitCommitsStore = create<GitCommitsState>((set) => ({
  ...initialState,

  // Actions
  setCommitsByDate: (commits) => set({ commitsByDate: commits }),

  mergeCommitsByDate: (newCommits) =>
    set((state) => ({
      commitsByDate: { ...state.commitsByDate, ...newCommits },
    })),

  setCommitFilters: (filters) => set({ commitFilters: filters }),

  setConnectedReposCount: (count) => set({ connectedReposCount: count }),

  setError: (error) => set({ error }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  reset: () => set(initialState),

  // Async actions
  loadConnectedReposCount: async (folderPath) => {
    try {
      const connectedRepos = await getConnectedRepos(folderPath);
      set({ connectedReposCount: connectedRepos.length });
    } catch (error) {
      console.error("Error loading connected repos:", error);
      set({ connectedReposCount: 0 });
    }
  },

  loadCommitsForVisibleFiles: async (folderPath, visibleFiles) => {
    if (visibleFiles.length === 0) return;

    try {
      const connectedRepos = await getConnectedRepos(folderPath);
      set({ connectedReposCount: connectedRepos.length });

      if (connectedRepos.length === 0) return;

      // Get current state
      const currentState = useGitCommitsStore.getState();
      const currentCommitsByDate = currentState.commitsByDate;

      // Unique date keys for visible files (use filename date if available)
      const visibleDates = Array.from(
        new Set(
          visibleFiles.map((file) => {
            const dateFromFilename = getDateFromFilename(file.fileName);
            return dateFromFilename || getDateKey(file.createdAt);
          }),
        ),
      );

      // Filter out dates we already have
      const datesToLoad = visibleDates.filter(
        (dateStr) => !currentCommitsByDate[dateStr],
      );

      if (datesToLoad.length === 0) return;

      // Build date ranges
      const dateRanges = datesToLoad.map((dateStr) => {
        const date = new Date(dateStr);
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        return {
          dateStr,
          range: createDateRange.custom(startOfDay, endOfDay),
        };
      });

      // Fetch in parallel
      const results = await Promise.all(
        dateRanges.map(async ({ range }) => {
          try {
            const repoCommits = await getGitCommitsForRepos(
              connectedRepos,
              range,
            );
            return groupCommitsByDate(repoCommits);
          } catch (error) {
            console.error("Error loading commits for date range:", error);
            return {} as CommitsByDate;
          }
        }),
      );

      const merged: CommitsByDate = {};
      for (const partial of results) {
        for (const [key, value] of Object.entries(partial)) {
          merged[key] = value;
        }
      }

      if (Object.keys(merged).length > 0) {
        set((state) => ({
          commitsByDate: { ...state.commitsByDate, ...merged },
        }));
      }
    } catch (error) {
      console.error("Error loading commits for visible files:", error);
      set({ error: `Failed to load git commits: ${error}` });
    }
  },

  refreshAllCommits: async (folderPath, loadedDates) => {
    if (loadedDates.length === 0) return;

    try {
      const connectedRepos = await getConnectedRepos(folderPath);
      if (connectedRepos.length === 0) return;

      // Build date ranges for all loaded dates
      const dateRanges = loadedDates.map((dateStr) => {
        const date = new Date(dateStr);
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        return {
          dateStr,
          range: createDateRange.custom(startOfDay, endOfDay),
        };
      });

      // Fetch in parallel
      const results = await Promise.all(
        dateRanges.map(async ({ range }) => {
          try {
            const repoCommits = await getGitCommitsForRepos(
              connectedRepos,
              range,
            );
            return groupCommitsByDate(repoCommits);
          } catch (error) {
            console.error("Error refreshing commits for date range:", error);
            return {} as CommitsByDate;
          }
        }),
      );

      const merged: CommitsByDate = {};
      for (const partial of results) {
        for (const [key, value] of Object.entries(partial)) {
          merged[key] = value;
        }
      }

      if (Object.keys(merged).length > 0) {
        set((state) => ({
          commitsByDate: { ...state.commitsByDate, ...merged },
        }));
      }
    } catch (error) {
      console.error("Error refreshing commits:", error);
    }
  },
}));
