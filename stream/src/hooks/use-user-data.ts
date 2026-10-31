import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clearSelectedFolder,
  getSelectedFolder,
  setSelectedFolder,
} from "@/ipc/selected-folder";

export const userDataKeys = {
  all: ["userData"] as const,
  selectedFolder: () => [...userDataKeys.all, "selectedFolder"] as const,
};

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
