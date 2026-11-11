import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentKind } from "@/ipc/agents";
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
  autoSync: boolean; // Commit, pull and push the notes on their own
  skillAgent: AgentKind;
  skillModels: Record<AgentKind, string>; // Empty uses the agent's own default
  githubAccount: string | null; // Null follows whichever account is active in gh

  // Actions
  setFolderPath: (path: string | null) => void;
  setActiveEditingFile: (file: MarkdownFileMetadata | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setAgentsEnabled: (enabled: boolean) => void;
  setAutoSync: (enabled: boolean) => void;
  setSkillAgent: (agent: AgentKind) => void;
  setSkillModel: (agent: AgentKind, model: string) => void;
  setGitHubAccount: (login: string | null) => void;
  reset: () => void;
}

const initialState = {
  folderPath: null,
  activeEditingFile: null,
  settingsOpen: false,
  agentsEnabled: true,
  autoSync: true,
  skillAgent: "claude" as AgentKind,
  skillModels: { claude: "", codex: "" },
  githubAccount: null as string | null,
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...initialState,

      setFolderPath: (path) => set({ folderPath: path }),

      setActiveEditingFile: (file) => set({ activeEditingFile: file }),

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setAgentsEnabled: (enabled) => set({ agentsEnabled: enabled }),

      setAutoSync: (enabled) => set({ autoSync: enabled }),

      setSkillAgent: (agent) => set({ skillAgent: agent }),

      setSkillModel: (agent, model) =>
        set((state) => ({
          skillModels: { ...state.skillModels, [agent]: model },
        })),

      setGitHubAccount: (login) => set({ githubAccount: login }),

      reset: () => set(initialState),
    }),
    {
      name: "user-state",
      partialize: (state) => ({
        folderPath: state.folderPath,
        agentsEnabled: state.agentsEnabled,
        autoSync: state.autoSync,
        skillAgent: state.skillAgent,
        skillModels: state.skillModels,
        githubAccount: state.githubAccount,
      }),
    },
  ),
);
