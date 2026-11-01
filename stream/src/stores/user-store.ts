import { create } from "zustand";
import { persist } from "zustand/middleware";
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
  agentsEnabled: boolean;

  // Actions
  setFolderPath: (path: string | null) => void;
  setActiveEditingFile: (file: MarkdownFileMetadata | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setAgentsEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const initialState = {
  folderPath: null,
  activeEditingFile: null,
  settingsOpen: false,
  agentsEnabled: true,
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...initialState,

      setFolderPath: (path) => set({ folderPath: path }),

      setActiveEditingFile: (file) => set({ activeEditingFile: file }),

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setAgentsEnabled: (enabled) => set({ agentsEnabled: enabled }),

      reset: () => set(initialState),
    }),
    {
      name: "user-state",
      partialize: (state) => ({
        folderPath: state.folderPath,
        agentsEnabled: state.agentsEnabled,
      }),
    },
  ),
);
