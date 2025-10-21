import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CommitFilters } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";

/**
 * Global user state store for UI preferences and current context
 * Server state (data fetching) is handled by Tanstack Query
 */
interface UserState {
  // Current context
  folderPath: string | null;
  activeEditingFile: MarkdownFileMetadata | null;

  // Filters
  commitFilters: CommitFilters;

  // Actions
  setFolderPath: (path: string | null) => void;
  setActiveEditingFile: (file: MarkdownFileMetadata | null) => void;
  setCommitFilters: (filters: CommitFilters) => void;
  reset: () => void;
}

const initialState = {
  folderPath: null,
  activeEditingFile: null,
  commitFilters: {
    authors: [],
    repos: [],
    searchTerm: "",
  },
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...initialState,

      setFolderPath: (path) => set({ folderPath: path }),

      setActiveEditingFile: (file) => set({ activeEditingFile: file }),

      setCommitFilters: (filters) => set({ commitFilters: filters }),

      reset: () => set(initialState),
    }),
    {
      name: "user-state",
      partialize: (state) => ({
        // Only persist folder path, not active editing file or filters
        folderPath: state.folderPath,
      }),
    },
  ),
);

// Legacy export for backward compatibility during migration
export const useGitCommitsStore = useUserStore;
