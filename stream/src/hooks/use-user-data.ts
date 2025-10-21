import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { load } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import {
  getApiKey as getApiKeyIPC,
  removeApiKey as removeApiKeyIPC,
  setApiKey as setApiKeyIPC,
} from "@/ipc/settings";

const FOLDER_STORAGE_KEY = "stream-last-selected-folder";
const FOLDER_STORE_FILE = "settings.json";

export const userDataKeys = {
  all: ["userData"] as const,
  apiKey: () => [...userDataKeys.all, "apiKey"] as const,
  selectedFolder: () => [...userDataKeys.all, "selectedFolder"] as const,
};

/**
 * Hook to get the stored API key
 */
export function useApiKey() {
  return useQuery({
    queryKey: userDataKeys.apiKey(),
    queryFn: async () => {
      const key = await getApiKeyIPC();
      return key;
    },
    staleTime: 60000, // Consider fresh for 1 minute
  });
}

/**
 * Hook to save/update the API key
 */
export function useSetApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (apiKey: string) => {
      if (!apiKey.trim()) {
        throw new Error("Please enter an API key");
      }
      await setApiKeyIPC(apiKey.trim());
      return apiKey.trim();
    },
    onSuccess: (apiKey) => {
      queryClient.setQueryData(userDataKeys.apiKey(), apiKey);
      toast.success("API key saved successfully");
    },
    onError: (error: Error) => {
      console.error("Error saving API key:", error);
      toast.error(error.message || "Failed to save API key");
    },
  });
}

/**
 * Hook to remove the API key
 */
export function useRemoveApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await removeApiKeyIPC();
    },
    onSuccess: () => {
      queryClient.setQueryData(userDataKeys.apiKey(), null);
      toast.success("API key removed");
    },
    onError: (error: Error) => {
      console.error("Error removing API key:", error);
      toast.error("Failed to remove API key");
    },
  });
}

/**
 * Helper function to get selected folder from store
 */
async function getSelectedFolder(): Promise<string | null> {
  try {
    const store = await load(FOLDER_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    const savedFolder = await store.get<string>(FOLDER_STORAGE_KEY);
    return savedFolder || null;
  } catch (error) {
    console.warn("Failed to get selected folder:", error);
    return null;
  }
}

/**
 * Helper function to save selected folder to store
 */
async function saveSelectedFolder(folderPath: string): Promise<void> {
  try {
    const store = await load(FOLDER_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    await store.set(FOLDER_STORAGE_KEY, folderPath);
  } catch (error) {
    console.error("Failed to save selected folder:", error);
    throw error;
  }
}

/**
 * Helper function to remove selected folder from store
 */
async function removeSelectedFolder(): Promise<void> {
  try {
    const store = await load(FOLDER_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    await store.delete(FOLDER_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to remove selected folder:", error);
    throw error;
  }
}

/**
 * Hook to get the selected folder
 */
export function useSelectedFolder() {
  return useQuery({
    queryKey: userDataKeys.selectedFolder(),
    queryFn: getSelectedFolder,
    staleTime: 60000, // Consider fresh for 1 minute
  });
}

/**
 * Hook to set/update the selected folder
 */
export function useSetSelectedFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      await saveSelectedFolder(folderPath);
      return folderPath;
    },
    onSuccess: (folderPath) => {
      queryClient.setQueryData(userDataKeys.selectedFolder(), folderPath);
    },
    onError: (error: Error) => {
      console.error("Error saving selected folder:", error);
      toast.error("Failed to save selected folder");
    },
  });
}

/**
 * Hook to clear the selected folder
 */
export function useClearSelectedFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeSelectedFolder,
    onSuccess: () => {
      queryClient.setQueryData(userDataKeys.selectedFolder(), null);
    },
    onError: (error: Error) => {
      console.error("Error clearing selected folder:", error);
      toast.error("Failed to clear selected folder");
    },
  });
}
