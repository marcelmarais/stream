import { invoke } from "@tauri-apps/api/core";

/**
 * Represents a single search match in a markdown file
 */
export interface SearchMatch {
  /** The full path to the file containing the match */
  filePath: string;
  /** The line number where the match was found (1-indexed) */
  lineNumber: number;
  /** Character offset where the match starts in the line */
  charStart: number;
  /** Character offset where the match ends in the line */
  charEnd: number;
  /** Context snippet around the match for preview */
  contextSnippet: string;
  /** BM25 relevance score */
  score: number;
}

/**
 * Rust-side search match structure (matches Rust struct)
 */
interface RustSearchMatch {
  file_path: string;
  line_number: number;
  char_start: number;
  char_end: number;
  context_snippet: string;
  score: number;
}

/**
 * Search results containing matches and metadata
 */
export interface SearchResults {
  /** Array of search matches */
  matches: SearchMatch[];
  /** Total number of results found */
  totalResults: number;
  /** Time taken to perform the search in milliseconds */
  searchTimeMs: number;
}

/**
 * Rust-side search results structure
 */
interface RustSearchResults {
  matches: RustSearchMatch[];
  total_results: number;
  search_time_ms: number;
}

/**
 * Search through markdown files in a folder using BM25 algorithm.
 * The index is automatically synced with file changes.
 *
 * @param folderPath - Path to the folder containing markdown files
 * @param query - Search query string
 * @param limit - Maximum number of results to return (default: 100)
 * @returns Promise<SearchResults> - Search results with matches and metadata
 */
export async function searchMarkdownFiles(
  folderPath: string,
  query: string,
  limit?: number,
): Promise<SearchResults> {
  if (!query.trim()) {
    return {
      matches: [],
      totalResults: 0,
      searchTimeMs: 0,
    };
  }

  try {
    const rustResults: RustSearchResults = await invoke(
      "search_markdown_files",
      {
        folderPath,
        query: query.trim(),
        limit,
      },
    );

    // Convert from Rust snake_case to TypeScript camelCase
    const matches: SearchMatch[] = rustResults.matches.map((rustMatch) => ({
      filePath: rustMatch.file_path,
      lineNumber: rustMatch.line_number,
      charStart: rustMatch.char_start,
      charEnd: rustMatch.char_end,
      contextSnippet: rustMatch.context_snippet,
      score: rustMatch.score,
    }));

    return {
      matches,
      totalResults: rustResults.total_results,
      searchTimeMs: rustResults.search_time_ms,
    };
  } catch (error) {
    console.error("Error searching markdown files:", error);
    throw new Error(`Failed to search markdown files: ${error}`);
  }
}

/**
 * Rebuild the search index from scratch.
 * This forces a complete reindex of all markdown files.
 * Useful for recovery or debugging.
 *
 * @param folderPath - Path to the folder containing markdown files
 * @returns Promise<void>
 */
export async function rebuildSearchIndex(folderPath: string): Promise<void> {
  try {
    await invoke("rebuild_search_index", {
      folderPath,
    });
  } catch (error) {
    console.error("Error rebuilding search index:", error);
    throw new Error(`Failed to rebuild search index: ${error}`);
  }
}

