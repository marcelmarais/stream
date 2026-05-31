import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { debounce } from "lodash-es";
import { useEffect, useMemo } from "react";
import {
  deleteMarkdownFile,
  ensureMarkdownFileForDate,
  ensureTodayMarkdownFile,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  setFileLocationMetadata,
  writeMarkdownFileContent,
} from "@/ipc/markdown-reader";

export const markdownKeys = {
  all: ["markdown"] as const,
  metadata: (folderPath: string) =>
    [...markdownKeys.all, "metadata", folderPath] as const,
  content: (filePath: string) =>
    [...markdownKeys.all, "content", filePath] as const,
  contents: (filePaths: string[]) =>
    [...markdownKeys.all, "contents", filePaths.join(",")] as const,
};

export function useMarkdownMetadata(folderPath: string) {
  return useQuery({
    queryKey: markdownKeys.metadata(folderPath),
    queryFn: async () =>
      readAllMarkdownFilesMetadata(folderPath, {
        maxFileSize: 5 * 1024 * 1024,
      }),
    enabled: !!folderPath,
    staleTime: 30000,
  });
}

export function useMarkdownFileContent(filePath: string | null) {
  return useQuery({
    queryKey: markdownKeys.content(filePath || ""),
    queryFn: async () => {
      if (!filePath) return null;
      const contentMap = await readMarkdownFilesContentByPaths([filePath]);
      return contentMap.get(filePath) ?? "";
    },
    enabled: !!filePath,
    staleTime: 60000,
    gcTime: 300000,
  });
}

export function useMarkdownFilesContent(filePaths: string[]) {
  return useQuery({
    queryKey: markdownKeys.contents(filePaths),
    queryFn: async () => {
      if (filePaths.length === 0) return new Map<string, string>();
      return readMarkdownFilesContentByPaths(filePaths);
    },
    enabled: filePaths.length > 0,
  });
}

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
      await queryClient.cancelQueries({
        queryKey: markdownKeys.content(filePath),
      });

      const previousContent = queryClient.getQueryData<string>(
        markdownKeys.content(filePath),
      );

      queryClient.setQueryData(markdownKeys.content(filePath), content);

      return { previousContent };
    },
    onError: (_err, { filePath }, context) => {
      if (context?.previousContent !== undefined) {
        queryClient.setQueryData(
          markdownKeys.content(filePath),
          context.previousContent,
        );
      }
    },
  });
}

export function useDebouncedSave(filePath: string, delay = 500) {
  const { mutate } = useSaveMarkdownFile();

  const debouncedSave = useMemo(
    () =>
      debounce((content: string) => {
        mutate({ filePath, content });
      }, delay),
    [filePath, delay, mutate],
  );

  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  return debouncedSave;
}

export function useCreateFileForDate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      folderPath,
      date,
    }: {
      folderPath: string;
      date: Date;
    }) => ensureMarkdownFileForDate(folderPath, date),
    onSuccess: async (result, { folderPath }) => {
      await queryClient.invalidateQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });

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

export function useCreateTodayFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderPath: string) =>
      ensureTodayMarkdownFile(folderPath),
    onSuccess: async (result, folderPath) => {
      await queryClient.invalidateQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });

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

export function useFileContentManager(filePath: string) {
  const queryClient = useQueryClient();
  const { data: content, isLoading } = useMarkdownFileContent(filePath);
  const { mutateAsync: saveFile } = useSaveMarkdownFile();
  const debouncedSave = useDebouncedSave(filePath);

  const updateContentOptimistically = (newContent: string) => {
    queryClient.setQueryData(markdownKeys.content(filePath), newContent);
  };

  const saveContentDebounced = (newContent: string) => {
    debouncedSave(newContent);
  };

  const saveContentImmediate = async (newContent: string) => {
    await saveFile({ filePath, content: newContent });
  };

  return {
    content: content ?? "",
    isLoading,
    updateContentOptimistically,
    saveContentDebounced,
    saveContentImmediate,
  };
}

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

export function useUpdateFileLocation(folderPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      filePath,
      country,
      city,
    }: {
      filePath: string;
      country: string;
      city: string;
    }) => {
      await setFileLocationMetadata(folderPath, filePath, country, city);
      return { filePath, country, city };
    },
    onMutate: async ({ filePath, country, city }) => {
      await queryClient.cancelQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });

      const previousMetadata = queryClient.getQueryData<
        Awaited<ReturnType<typeof readAllMarkdownFilesMetadata>>
      >(markdownKeys.metadata(folderPath));

      queryClient.setQueryData<
        Awaited<ReturnType<typeof readAllMarkdownFilesMetadata>>
      >(markdownKeys.metadata(folderPath), (old) => {
        if (!old) return old;
        return old.map((file) =>
          file.filePath === filePath ? { ...file, country, city } : file,
        );
      });

      return { previousMetadata };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousMetadata) {
        queryClient.setQueryData(
          markdownKeys.metadata(folderPath),
          context.previousMetadata,
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });
    },
  });
}

export function useDeleteMarkdownFile(folderPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filePath: string) => {
      await deleteMarkdownFile(filePath);
      return filePath;
    },
    onSuccess: (filePath) => {
      queryClient.removeQueries({
        queryKey: markdownKeys.content(filePath),
      });
      queryClient.invalidateQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });
    },
  });
}
