import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CommitFilters } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";

/**
 * Global user state store for UI preferences and current context
 * Server state is handled by Tanstack Query
 */
interface UserState {
  // Current context
  folderPath: string | null;
  activeEditingFile: MarkdownFileMetadata | null;

  // UI state
  settingsOpen: boolean;
  viewMode: "timeline" | "calendar";

  // Filters
  commitFilters: CommitFilters;

  // Actions
  setFolderPath: (path: string | null) => void;
  setActiveEditingFile: (file: MarkdownFileMetadata | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setViewMode: (mode: "timeline" | "calendar") => void;
  setCommitFilters: (filters: CommitFilters) => void;
  reset: () => void;
}

const initialState = {
  folderPath: null,
  activeEditingFile: null,
  settingsOpen: false,
  viewMode: "timeline" as const,
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

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setViewMode: (mode) => set({ viewMode: mode }),

      setCommitFilters: (filters) => set({ commitFilters: filters }),

      reset: () => set(initialState),
    }),
    {
      name: "user-state",
      partialize: (state) => ({
        folderPath: state.folderPath,
        viewMode: state.viewMode,
      }),
    },
  ),
);
