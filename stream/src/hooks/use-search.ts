import { useMutation, useQuery } from "@tanstack/react-query";
import {
  rebuildSearchIndex,
  type SearchResults,
  searchMarkdownFiles,
} from "@/ipc/search";

// Query keys
export const searchKeys = {
  all: ["search"] as const,
  results: (folderPath: string, query: string) =>
    [...searchKeys.all, "results", folderPath, query] as const,
};

/**
 * Hook to search markdown files
 */
export function useSearchMarkdownFiles(
  folderPath: string,
  query: string,
  options?: {
    limit?: number;
    enabled?: boolean;
  },
) {
  return useQuery({
    queryKey: searchKeys.results(folderPath, query),
    queryFn: async () => {
      if (!query.trim()) {
        return {
          matches: [],
          totalResults: 0,
          searchTimeMs: 0,
        } as SearchResults;
      }
      return await searchMarkdownFiles(folderPath, query, options?.limit);
    },
    enabled: options?.enabled !== false && !!folderPath && !!query.trim(),
    // Keep results for 5 minutes
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to rebuild search index
 */
export function useRebuildSearchIndex() {
  return useMutation({
    mutationFn: async (folderPath: string) => {
      await rebuildSearchIndex(folderPath);
    },
  });
}
