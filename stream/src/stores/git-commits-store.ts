import { create } from "zustand";
import type { CommitFilters } from "@/ipc/git-reader";

/**
 * Simplified store for git commit UI state (filters only)
 * Data fetching is now handled by Tanstack Query in use-git-queries.ts
 */
interface GitCommitsState {
  // Filters (UI state)
  commitFilters: CommitFilters;

  // Actions
  setCommitFilters: (filters: CommitFilters) => void;
  reset: () => void;
}

const initialState = {
  commitFilters: {
    authors: [],
    repos: [],
    searchTerm: "",
  },
};

export const useGitCommitsStore = create<GitCommitsState>((set) => ({
  ...initialState,

  setCommitFilters: (filters) => set({ commitFilters: filters }),

  reset: () => set(initialState),
}));
