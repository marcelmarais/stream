import { debounce } from "lodash";
import { create } from "zustand";
import type { MarkdownFileMetadata } from "@/utils/markdown-reader";
import {
  ensureTodayMarkdownFile,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "@/utils/markdown-reader";

interface MarkdownFilesState {
  // Data
  allFilesMetadata: MarkdownFileMetadata[];
  loadedContent: Map<string, string>;
  loadingFiles: Set<string>;

  // Status
  isLoadingMetadata: boolean;
  error: string | null;
  creatingToday: boolean;

  // Actions
  setAllFilesMetadata: (files: MarkdownFileMetadata[]) => void;
  setLoadedContent: (filePath: string, content: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  // Async actions
  loadMetadata: (folderPath: string) => Promise<void>;
  loadFileContent: (filePath: string) => Promise<void>;
  loadFileContents: (filePaths: string[]) => Promise<void>;
  saveFileContent: (filePath: string, content: string) => Promise<void>;
  saveFileContentDebounced: (filePath: string, content: string) => void;
  createTodayFile: (folderPath: string) => Promise<string | null>;
  refreshMetadata: (folderPath: string) => Promise<void>;

  // Content management
  updateContentOptimistically: (filePath: string, content: string) => void;
}

const initialState = {
  allFilesMetadata: [],
  loadedContent: new Map<string, string>(),
  loadingFiles: new Set<string>(),
  isLoadingMetadata: false,
  error: null,
  creatingToday: false,
};

// Create a debounced save function outside the store
const debouncedSaveMap = new Map<
  string,
  ReturnType<typeof debounce<(content: string) => Promise<void>>>
>();

const getDebouncedSave = (filePath: string) => {
  if (!debouncedSaveMap.has(filePath)) {
    const debouncedFn = debounce(async (content: string) => {
      try {
        await writeMarkdownFileContent(filePath, content);
        console.log(`Debounced save completed for ${filePath}`);
      } catch (error) {
        console.error(`Error in debounced save for ${filePath}:`, error);
        // Update store error state
        useMarkdownFilesStore
          .getState()
          .setError(`Failed to save ${filePath}: ${error}`);
      }
    }, 500);
    debouncedSaveMap.set(filePath, debouncedFn);
  }
  const debouncedFn = debouncedSaveMap.get(filePath);
  if (!debouncedFn) {
    throw new Error(`Failed to get debounced save function for ${filePath}`);
  }
  return debouncedFn;
};

export const useMarkdownFilesStore = create<MarkdownFilesState>((set, get) => ({
  ...initialState,

  // Simple setters
  setAllFilesMetadata: (files) => set({ allFilesMetadata: files }),

  setLoadedContent: (filePath, content) =>
    set((state) => {
      const newMap = new Map(state.loadedContent);
      newMap.set(filePath, content);
      return { loadedContent: newMap };
    }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),

  // Load all metadata for a folder
  loadMetadata: async (folderPath) => {
    set({ isLoadingMetadata: true, error: null });
    try {
      const metadata = await readAllMarkdownFilesMetadata(folderPath, {
        maxFileSize: 5 * 1024 * 1024, // 5MB limit
      });
      set({ allFilesMetadata: metadata, isLoadingMetadata: false });
    } catch (error) {
      console.error("Error loading metadata:", error);
      set({
        error: `Error reading folder metadata: ${error}`,
        isLoadingMetadata: false,
      });
    }
  },

  // Load content for a single file
  loadFileContent: async (filePath) => {
    const state = get();

    // Skip if already loading or loaded
    if (state.loadingFiles.has(filePath) || state.loadedContent.has(filePath)) {
      return;
    }

    // Mark as loading
    set((state) => ({
      loadingFiles: new Set(state.loadingFiles).add(filePath),
    }));

    try {
      const contentMap = await readMarkdownFilesContentByPaths([filePath]);
      const content = contentMap.get(filePath);

      if (content !== undefined) {
        set((state) => {
          const newLoadedContent = new Map(state.loadedContent);
          newLoadedContent.set(filePath, content);
          const newLoadingFiles = new Set(state.loadingFiles);
          newLoadingFiles.delete(filePath);
          return {
            loadedContent: newLoadedContent,
            loadingFiles: newLoadingFiles,
          };
        });
      } else {
        // Remove from loading set even if content not found
        set((state) => {
          const newLoadingFiles = new Set(state.loadingFiles);
          newLoadingFiles.delete(filePath);
          return { loadingFiles: newLoadingFiles };
        });
      }
    } catch (error) {
      console.error(`Error loading content for file ${filePath}:`, error);
      set((state) => {
        const newLoadingFiles = new Set(state.loadingFiles);
        newLoadingFiles.delete(filePath);
        return { loadingFiles: newLoadingFiles };
      });
    }
  },

  // Load content for multiple files
  loadFileContents: async (filePaths) => {
    const state = get();

    // Filter out files that are already loaded or loading
    const filesToLoad = filePaths.filter(
      (path) => !state.loadingFiles.has(path) && !state.loadedContent.has(path),
    );

    if (filesToLoad.length === 0) return;

    // Mark all as loading
    set((state) => {
      const newLoadingFiles = new Set(state.loadingFiles);
      for (const path of filesToLoad) {
        newLoadingFiles.add(path);
      }
      return { loadingFiles: newLoadingFiles };
    });

    try {
      const contentMap = await readMarkdownFilesContentByPaths(filesToLoad);

      set((state) => {
        const newLoadedContent = new Map(state.loadedContent);
        const newLoadingFiles = new Set(state.loadingFiles);

        for (const path of filesToLoad) {
          const content = contentMap.get(path);
          if (content !== undefined) {
            newLoadedContent.set(path, content);
          }
          newLoadingFiles.delete(path);
        }

        return {
          loadedContent: newLoadedContent,
          loadingFiles: newLoadingFiles,
        };
      });
    } catch (error) {
      console.error("Error loading file contents:", error);
      set((state) => {
        const newLoadingFiles = new Set(state.loadingFiles);
        for (const path of filesToLoad) {
          newLoadingFiles.delete(path);
        }
        return { loadingFiles: newLoadingFiles };
      });
    }
  },

  // Immediate save (for Cmd+S)
  saveFileContent: async (filePath, content) => {
    try {
      await writeMarkdownFileContent(filePath, content);
      // Update the loaded content to reflect the saved changes
      set((state) => {
        const newMap = new Map(state.loadedContent);
        newMap.set(filePath, content);
        return { loadedContent: newMap };
      });
    } catch (error) {
      console.error(`Error saving file ${filePath}:`, error);
      throw error; // Re-throw so the caller can handle it
    }
  },

  // Debounced save (for typing)
  saveFileContentDebounced: (filePath, content) => {
    const debouncedSave = getDebouncedSave(filePath);
    debouncedSave(content);
  },

  // Update content optimistically (before save completes)
  updateContentOptimistically: (filePath, content) => {
    set((state) => {
      const newMap = new Map(state.loadedContent);
      newMap.set(filePath, content);
      return { loadedContent: newMap };
    });
  },

  // Create today's markdown file
  createTodayFile: async (folderPath) => {
    set({ creatingToday: true, error: null });
    try {
      const { filePath } = await ensureTodayMarkdownFile(folderPath);

      // Load content for the new file
      const contentMap = await readMarkdownFilesContentByPaths([filePath]);
      const content = contentMap.get(filePath) ?? "";

      set((state) => {
        const newLoadedContent = new Map(state.loadedContent);
        newLoadedContent.set(filePath, content);
        return { loadedContent: newLoadedContent, creatingToday: false };
      });

      // Refresh metadata to include the new file
      await get().refreshMetadata(folderPath);

      return filePath;
    } catch (error) {
      console.error("Failed to create today's file:", error);
      set({
        error: `Failed to create today's file: ${error}`,
        creatingToday: false,
      });
      return null;
    }
  },

  // Refresh metadata (useful after creating/deleting files)
  refreshMetadata: async (folderPath) => {
    set({ isLoadingMetadata: true, error: null });
    try {
      const metadata = await readAllMarkdownFilesMetadata(folderPath, {
        maxFileSize: 5 * 1024 * 1024,
      });
      set({ allFilesMetadata: metadata, isLoadingMetadata: false });
    } catch (error) {
      console.error("Error refreshing metadata:", error);
      set({
        error: `Error reading folder metadata: ${error}`,
        isLoadingMetadata: false,
      });
    }
  },
}));
