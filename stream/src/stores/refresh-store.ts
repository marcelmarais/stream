import { create } from "zustand";

export interface RefreshingFile {
  filePath: string;
  fileName: string;
  startedAt: number;
}

interface RefreshState {
  refreshingFiles: RefreshingFile[];
  lastRefreshCheck: number | null;

  // Actions
  startRefreshing: (filePath: string) => void;
  finishRefreshing: (filePath: string) => void;
  setLastRefreshCheck: (timestamp: number) => void;
  getRefreshingFile: (filePath: string) => RefreshingFile | undefined;
}

export const useRefreshStore = create<RefreshState>((set, get) => ({
  refreshingFiles: [],
  lastRefreshCheck: null,

  startRefreshing: (filePath) => {
    const fileName = filePath.split("/").pop() || filePath;
    set((state) => {
      // Don't add if already refreshing
      if (state.refreshingFiles.some((file) => file.filePath === filePath)) {
        return state;
      }
      return {
        refreshingFiles: [
          ...state.refreshingFiles,
          { filePath, fileName, startedAt: Date.now() },
        ],
      };
    });
  },

  finishRefreshing: (filePath) => {
    set((state) => ({
      refreshingFiles: state.refreshingFiles.filter(
        (file) => file.filePath !== filePath,
      ),
    }));
  },

  setLastRefreshCheck: (timestamp) => {
    set({ lastRefreshCheck: timestamp });
  },

  getRefreshingFile: (filePath) => {
    return get().refreshingFiles.find((file) => file.filePath === filePath);
  },
}));
