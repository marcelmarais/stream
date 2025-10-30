import { invoke } from "@tauri-apps/api/core";

/**
 * Represents a single search match in a markdown file
 */
export interface SearchMatch {
  /** The full path to the file containing the match */
  filePath: string;
  /** The line number where the match was found (1-indexed) */
  lineNumber: number;
  /** Array of [start, end] UTF-16 positions for all matched terms in the snippet */
  matchRanges: Array<[number, number]>;
  /** Context snippet around the match for preview */
  contextSnippet: string;
  /** Relevance score (based on number of matches) */
  score: number;
}

/**
 * Rust-side search match structure (matches Rust struct)
 */
interface RustSearchMatch {
  file_path: string;
  line_number: number;
  match_ranges: Array<[number, number]>;
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
 * Search through markdown files in a folder with prefix matching support.
 * Always searches the current state of files (no indexing required).
 *
 * @param folderPath - Path to the folder containing markdown files
 * @param query - Search query string (last term uses prefix matching for type-ahead)
 * @param limit - Maximum number of results to return (default: 100)
 * @param sortByDate - Sort results by date in filename (newest first) (default: false)
 * @returns Promise<SearchResults> - Search results with matches and metadata
 */
export async function searchMarkdownFiles(
  folderPath: string,
  query: string,
  limit?: number,
  sortByDate?: boolean,
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
        sortByDate,
      },
    );

    // Convert from Rust snake_case to TypeScript camelCase
    const matches: SearchMatch[] = rustResults.matches.map((rustMatch) => ({
      filePath: rustMatch.file_path,
      lineNumber: rustMatch.line_number,
      matchRanges: rustMatch.match_ranges,
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
 * Note: This is a no-op for the grep-based search (no index required).
 * Kept for API compatibility.
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
