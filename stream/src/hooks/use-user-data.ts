import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clearSelectedFolder,
  getSelectedFolder,
  setSelectedFolder,
} from "@/ipc/selected-folder";
import {
  getApiKey as getApiKeyIPC,
  removeApiKey as removeApiKeyIPC,
  setApiKey as setApiKeyIPC,
} from "@/ipc/settings";

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
      await setSelectedFolder(folderPath);
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
    mutationFn: clearSelectedFolder,
    onSuccess: () => {
      queryClient.setQueryData(userDataKeys.selectedFolder(), null);
    },
    onError: (error: Error) => {
      console.error("Error clearing selected folder:", error);
      toast.error("Failed to clear selected folder");
    },
  });
}
