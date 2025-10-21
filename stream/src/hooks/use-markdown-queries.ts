import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { debounce } from "lodash";
import { useMemo } from "react";
import {
  ensureTodayMarkdownFile,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "@/ipc/markdown-reader";

// Query keys
export const markdownKeys = {
  all: ["markdown"] as const,
  metadata: (folderPath: string) =>
    [...markdownKeys.all, "metadata", folderPath] as const,
  content: (filePath: string) =>
    [...markdownKeys.all, "content", filePath] as const,
  contents: (filePaths: string[]) =>
    [...markdownKeys.all, "contents", filePaths.join(",")] as const,
};

/**
 * Hook to load metadata for all markdown files in a folder
 */
export function useMarkdownMetadata(folderPath: string) {
  return useQuery({
    queryKey: markdownKeys.metadata(folderPath),
    queryFn: async () => {
      const metadata = await readAllMarkdownFilesMetadata(folderPath, {
        maxFileSize: 5 * 1024 * 1024, // 5MB limit
      });
      return metadata;
    },
    enabled: !!folderPath,
  });
}

/**
 * Hook to load content for a single file
 */
export function useMarkdownFileContent(filePath: string | null) {
  return useQuery({
    queryKey: markdownKeys.content(filePath || ""),
    queryFn: async () => {
      if (!filePath) return null;
      const contentMap = await readMarkdownFilesContentByPaths([filePath]);
      return contentMap.get(filePath) ?? "";
    },
    enabled: !!filePath,
  });
}

/**
 * Hook to load content for multiple files
 */
export function useMarkdownFilesContent(filePaths: string[]) {
  return useQuery({
    queryKey: markdownKeys.contents(filePaths),
    queryFn: async () => {
      if (filePaths.length === 0) return new Map<string, string>();
      const contentMap = await readMarkdownFilesContentByPaths(filePaths);
      return contentMap;
    },
    enabled: filePaths.length > 0,
  });
}

/**
 * Hook to save file content with optimistic updates
 */
export function useSaveMarkdownFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      filePath,
      content,
    }: {
      filePath: string;
      content: string;
    }) => {
      await writeMarkdownFileContent(filePath, content);
    },
    onMutate: async ({ filePath, content }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: markdownKeys.content(filePath),
      });

      // Snapshot the previous value
      const previousContent = queryClient.getQueryData<string>(
        markdownKeys.content(filePath),
      );

      // Optimistically update to the new value
      queryClient.setQueryData(markdownKeys.content(filePath), content);

      return { previousContent };
    },
    onError: (_err, { filePath }, context) => {
      // Rollback on error
      if (context?.previousContent !== undefined) {
        queryClient.setQueryData(
          markdownKeys.content(filePath),
          context.previousContent,
        );
      }
    },
    onSettled: (_data, _error, { filePath }) => {
      // Refetch after success or error
      queryClient.invalidateQueries({
        queryKey: markdownKeys.content(filePath),
      });
    },
  });
}

/**
 * Hook to get a debounced save function for a specific file
 */
export function useDebouncedSave(filePath: string, delay = 500) {
  const { mutate } = useSaveMarkdownFile();

  const debouncedSave = useMemo(
    () =>
      debounce((content: string) => {
        mutate({ filePath, content });
      }, delay),
    [filePath, delay, mutate],
  );

  return debouncedSave;
}

/**
 * Hook to create today's markdown file
 */
export function useCreateTodayFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      const result = await ensureTodayMarkdownFile(folderPath);
      return result;
    },
    onSuccess: async (result, folderPath) => {
      // Invalidate metadata to refresh the file list
      await queryClient.invalidateQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });

      // Pre-load the content for the new file
      if (result.filePath) {
        const contentMap = await readMarkdownFilesContentByPaths([
          result.filePath,
        ]);
        const content = contentMap.get(result.filePath) ?? "";
        queryClient.setQueryData(
          markdownKeys.content(result.filePath),
          content,
        );
      }
    },
  });
}

/**
 * Hook to get or load content for a file with optimistic updates
 */
export function useFileContentManager(filePath: string) {
  const queryClient = useQueryClient();
  const { data: content, isLoading } = useMarkdownFileContent(filePath);
  const { mutate: saveFile } = useSaveMarkdownFile();
  const debouncedSave = useDebouncedSave(filePath);

  const updateContentOptimistically = (newContent: string) => {
    queryClient.setQueryData(markdownKeys.content(filePath), newContent);
  };

  const saveContentDebounced = (newContent: string) => {
    debouncedSave(newContent);
  };

  const saveContentImmediate = async (newContent: string) => {
    saveFile({ filePath, content: newContent });
  };

  return {
    content: content ?? "",
    isLoading,
    updateContentOptimistically,
    saveContentDebounced,
    saveContentImmediate,
  };
}

/**
 * Hook to prefetch content for multiple files
 */
export function usePrefetchFileContents() {
  const queryClient = useQueryClient();

  return async (filePaths: string[]) => {
    const filesToLoad = filePaths.filter(
      (path) => !queryClient.getQueryData(markdownKeys.content(path)),
    );

    if (filesToLoad.length === 0) return;

    const contentMap = await queryClient.fetchQuery({
      queryKey: markdownKeys.contents(filesToLoad),
      queryFn: () => readMarkdownFilesContentByPaths(filesToLoad),
    });

    for (const [path, content] of contentMap.entries()) {
      queryClient.setQueryData(markdownKeys.content(path), content);
    }
  };
}
