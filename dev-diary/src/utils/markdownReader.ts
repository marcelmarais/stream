import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";

/**
 * Processes an array of items in batches with limited concurrency
 */
async function processBatched<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const maxConcurrency = 5;
  const batchSize = 25;

  // Process items in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Process batch with concurrency limit
    const batchResults: R[] = [];
    for (let j = 0; j < batch.length; j += maxConcurrency) {
      const concurrentBatch = batch.slice(j, j + maxConcurrency);
      const promises = concurrentBatch.map(processor);
      const concurrentResults = await Promise.all(promises);
      batchResults.push(...concurrentResults);
    }

    results.push(...batchResults);

    // Small delay between batches to prevent system overload
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return results;
}

/**
 * Represents a markdown file with its metadata and content
 */
export interface MarkdownFile {
  /** The full file path */
  filePath: string;
  /** The filename without the directory path */
  fileName: string;
  /** The file creation date */
  createdAt: Date;
  /** The file modification date */
  modifiedAt: Date;
  /** The file content as a string */
  content: string;
  /** The file size in bytes */
  size: number;
}

/**
 * Represents markdown file metadata without content
 */
export interface MarkdownFileMetadata {
  /** The full file path */
  filePath: string;
  /** The filename without the directory path */
  fileName: string;
  /** The file creation date */
  createdAt: Date;
  /** The file modification date */
  modifiedAt: Date;
  /** The file size in bytes */
  size: number;
}

/**
 * Date range interface for filtering files
 */
export interface DateRange {
  /** Start date (inclusive) */
  startDate: Date;
  /** End date (inclusive) */
  endDate: Date;
}

/**
 * Options for reading markdown files
 */
export interface ReadMarkdownOptions {
  /** Maximum file size to read in bytes (default: 10MB) */
  maxFileSize?: number;
}

/**
 * Reads metadata for ALL *.md files in a directory (including subdirectories).
 * This function only reads file metadata, not content, and does not filter by date.
 *
 * @param directoryPath - The path to the directory to search
 * @param options - Additional options for reading files
 * @returns Promise<MarkdownFileMetadata[]> - Array of all markdown file metadata
 */
export async function readAllMarkdownFilesMetadata(
  directoryPath: string,
  options: ReadMarkdownOptions = {},
): Promise<MarkdownFileMetadata[]> {
  const {
    maxFileSize = 10 * 1024 * 1024, // 10MB default
  } = options;

  // Helper function to recursively read directories for metadata only
  async function readDirRecursiveMetadata(
    dirPath: string,
  ): Promise<MarkdownFileMetadata[]> {
    const files: MarkdownFileMetadata[] = [];

    try {
      const entries = await readDir(dirPath);

      // Separate markdown files and directories for parallel processing
      const markdownEntries = entries.filter(
        (entry) => entry.isFile && entry.name?.toLowerCase().endsWith(".md"),
      );

      const directoryEntries = entries.filter((entry) => entry.isDirectory);

      // Get metadata in batches with concurrency limits
      const metadataResults = await processBatched(
        markdownEntries,
        async (entry) => {
          const fullPath = dirPath.endsWith("/")
            ? `${dirPath}${entry.name}`
            : `${dirPath}/${entry.name}`;

          try {
            const fileMetadata = await stat(fullPath);
            return {
              entry,
              fullPath,
              metadata: fileMetadata,
            };
          } catch (error) {
            console.error(`Error getting metadata for ${fullPath}:`, error);
            return null;
          }
        },
      );

      const validMetadata = metadataResults.filter((result) => result !== null);

      // Filter by file size only (no date filtering)
      const filteredFiles = validMetadata
        .filter(({ metadata }) => metadata.size <= maxFileSize)
        .map(({ entry, fullPath, metadata }) => {
          const createdAt = new Date(
            metadata.birthtime || metadata.mtime || Date.now(),
          );
          const modifiedAt = metadata.mtime
            ? new Date(metadata.mtime)
            : createdAt;

          return {
            filePath: fullPath,
            fileName: entry.name,
            createdAt,
            modifiedAt,
            size: metadata.size,
          };
        });

      files.push(...filteredFiles);

      // Process all subdirectories in parallel
      const directoryPromises = directoryEntries.map(async (entry) => {
        const fullPath = dirPath.endsWith("/")
          ? `${dirPath}${entry.name}`
          : `${dirPath}/${entry.name}`;

        try {
          return await readDirRecursiveMetadata(fullPath);
        } catch (error) {
          console.error(`Error reading subdirectory ${fullPath}:`, error);
          return [];
        }
      });

      // Wait for all directory processing to complete
      const directoryResults = await Promise.all(directoryPromises);
      for (const subFiles of directoryResults) {
        files.push(...subFiles);
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }

    return files;
  }

  try {
    const allFiles = await readDirRecursiveMetadata(directoryPath);

    // Sort by creation date (newest first)
    allFiles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return allFiles;
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error);
    throw new Error(
      `Failed to read all markdown files metadata from directory: ${error}`,
    );
  }
}

/**
 * Reads metadata for all *.md files in a directory (including subdirectories) that were created within the given date range.
 * This function only reads file metadata, not content.
 *
 * @param directoryPath - The path to the directory to search
 * @param dateRange - The date range to filter files by creation date
 * @param options - Additional options for reading files
 * @returns Promise<MarkdownFileMetadata[]> - Array of markdown file metadata
 */
export async function readMarkdownFilesMetadata(
  directoryPath: string,
  dateRange: DateRange,
  options: ReadMarkdownOptions = {},
): Promise<MarkdownFileMetadata[]> {
  const {
    maxFileSize = 10 * 1024 * 1024, // 10MB default
  } = options;

  // Helper function to recursively read directories for metadata only
  async function readDirRecursiveMetadata(
    dirPath: string,
  ): Promise<MarkdownFileMetadata[]> {
    const files: MarkdownFileMetadata[] = [];

    try {
      const entries = await readDir(dirPath);

      // Separate markdown files and directories for parallel processing
      const markdownEntries = entries.filter(
        (entry) => entry.isFile && entry.name?.toLowerCase().endsWith(".md"),
      );

      const directoryEntries = entries.filter((entry) => entry.isDirectory);

      // Get metadata in batches with concurrency limits
      const metadataResults = await processBatched(
        markdownEntries,
        async (entry) => {
          const fullPath = dirPath.endsWith("/")
            ? `${dirPath}${entry.name}`
            : `${dirPath}/${entry.name}`;

          try {
            const fileMetadata = await stat(fullPath);
            return {
              entry,
              fullPath,
              metadata: fileMetadata,
            };
          } catch (error) {
            console.error(`Error getting metadata for ${fullPath}:`, error);
            return null;
          }
        },
      );

      const validMetadata = metadataResults.filter((result) => result !== null);

      // Filter by date range and file size
      const filteredFiles = validMetadata
        .filter(({ metadata }) => {
          if (!metadata.birthtime) return false;

          const createdAt = new Date(metadata.birthtime);
          return (
            createdAt >= dateRange.startDate &&
            createdAt <= dateRange.endDate &&
            metadata.size <= maxFileSize
          );
        })
        .map(({ entry, fullPath, metadata }) => {
          const createdAt = new Date(
            metadata.birthtime || metadata.mtime || Date.now(),
          );
          const modifiedAt = metadata.mtime
            ? new Date(metadata.mtime)
            : createdAt;

          return {
            filePath: fullPath,
            fileName: entry.name,
            createdAt,
            modifiedAt,
            size: metadata.size,
          };
        });

      files.push(...filteredFiles);

      // Process all subdirectories in parallel
      const directoryPromises = directoryEntries.map(async (entry) => {
        const fullPath = dirPath.endsWith("/")
          ? `${dirPath}${entry.name}`
          : `${dirPath}/${entry.name}`;

        try {
          return await readDirRecursiveMetadata(fullPath);
        } catch (error) {
          console.error(`Error reading subdirectory ${fullPath}:`, error);
          return [];
        }
      });

      // Wait for all directory processing to complete
      const directoryResults = await Promise.all(directoryPromises);
      for (const subFiles of directoryResults) {
        files.push(...subFiles);
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }

    return files;
  }

  try {
    const allFiles = await readDirRecursiveMetadata(directoryPath);

    // Sort by creation date (newest first)
    allFiles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return allFiles;
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error);
    throw new Error(
      `Failed to read markdown files metadata from directory: ${error}`,
    );
  }
}

/**
 * Filters markdown file metadata by date range.
 *
 * @param filesMetadata - Array of markdown file metadata
 * @param dateRange - The date range to filter by creation date
 * @returns MarkdownFileMetadata[] - Filtered array of markdown file metadata
 */
export function filterMarkdownFilesByDateRange(
  filesMetadata: MarkdownFileMetadata[],
  dateRange: DateRange,
): MarkdownFileMetadata[] {
  return filesMetadata.filter((file) => {
    return (
      file.createdAt >= dateRange.startDate &&
      file.createdAt <= dateRange.endDate
    );
  });
}

/**
 * Reads content for markdown files based on their metadata.
 *
 * @param filesMetadata - Array of markdown file metadata
 * @returns Promise<MarkdownFile[]> - Array of markdown files with their content and metadata
 */
export async function readMarkdownFilesContent(
  filesMetadata: MarkdownFileMetadata[],
): Promise<MarkdownFile[]> {
  // Read content for files in batches
  const fileResults = await processBatched(
    filesMetadata,
    async (fileMetadata) => {
      try {
        // Read file content
        const content = await readTextFile(fileMetadata.filePath);

        return {
          filePath: fileMetadata.filePath,
          fileName: fileMetadata.fileName,
          createdAt: fileMetadata.createdAt,
          modifiedAt: fileMetadata.modifiedAt,
          content,
          size: fileMetadata.size,
        };
      } catch (error) {
        console.error(
          `Error reading content of ${fileMetadata.filePath}:`,
          error,
        );
        return null;
      }
    },
  );

  // Filter out failed reads and return valid files
  return fileResults.filter((file): file is MarkdownFile => file !== null);
}

/**
 * Reads all *.md files in a directory (including subdirectories) that were created within the given date range.
 * Always includes file content and searches recursively through subdirectories.
 *
 * @param directoryPath - The path to the directory to search
 * @param dateRange - The date range to filter files by creation date
 * @param options - Additional options for reading files
 * @returns Promise<MarkdownFile[]> - Array of markdown files with their content and metadata
 */
export async function readMarkdownFilesByDateRange(
  directoryPath: string,
  dateRange: DateRange,
  options: ReadMarkdownOptions = {},
): Promise<MarkdownFile[]> {
  try {
    // Step 1: Get metadata for all matching files
    const filesMetadata = await readMarkdownFilesMetadata(
      directoryPath,
      dateRange,
      options,
    );

    // Step 2: Read content for the files
    const filesWithContent = await readMarkdownFilesContent(filesMetadata);

    return filesWithContent;
  } catch (error) {
    console.error(`Error reading markdown files from ${directoryPath}:`, error);
    throw new Error(`Failed to read markdown files from directory: ${error}`);
  }
}

/**
 * Helper function to create a date range for common time periods
 */
export const createDateRange = {
  /**
   * Creates a date range for the last N days
   */
  lastDays: (days: number): DateRange => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  },

  /**
   * Creates a date range for the current month
   */
  currentMonth: (): DateRange => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  },

  /**
   * Creates a date range for a specific month and year
   */
  specificMonth: (year: number, month: number): DateRange => {
    const startDate = new Date(year, month - 1, 1); // month is 0-indexed
    const endDate = new Date(year, month, 0); // Last day of the month
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  },

  /**
   * Creates a date range from specific start and end dates
   */
  custom: (startDate: Date, endDate: Date): DateRange => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { startDate: start, endDate: end };
  },
};

/**
 * Helper function to format file information for display
 */
export function formatMarkdownFileInfo(file: MarkdownFile): string {
  const sizeKB = (file.size / 1024).toFixed(1);
  return `${file.fileName} (${sizeKB}KB) - Created: ${file.createdAt.toLocaleDateString()}`;
}

/**
 * Reads the content of a single markdown file by its absolute path.
 */
export async function readMarkdownFileContent(
  filePath: string,
): Promise<string> {
  return readTextFile(filePath);
}

/**
 * Reads the content of multiple markdown files by their absolute paths.
 * Returns a Map keyed by file path to content. Files that fail to read
 * are omitted from the resulting Map.
 */
export async function readMarkdownFilesContentByPaths(
  filePaths: string[],
): Promise<Map<string, string>> {
  const results = await processBatched(filePaths, async (path) => {
    try {
      const content = await readTextFile(path);
      return { path, content } as const;
    } catch (error) {
      console.error(`Error reading content of ${path}:`, error);
      return null;
    }
  });

  const map = new Map<string, string>();
  for (const result of results) {
    if (result) {
      map.set(result.path, result.content);
    }
  }
  return map;
}
