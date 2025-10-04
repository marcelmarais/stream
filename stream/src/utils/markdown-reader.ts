import { invoke } from "@tauri-apps/api/core";
import { stat } from "@tauri-apps/plugin-fs";

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
 * Rust-side metadata structure (matches Rust struct)
 */
interface RustMarkdownFileMetadata {
  file_path: string;
  file_name: string;
  created_at: number; // Unix timestamp in milliseconds
  modified_at: number; // Unix timestamp in milliseconds
  size: number;
}

/**
 * Options for reading markdown files
 */
interface ReadMarkdownOptions {
  /** Maximum file size to read in bytes (default: 10MB) */
  maxFileSize?: number;
}

/**
 * Reads metadata for ALL *.md files in a directory (including subdirectories).
 * This function only reads file metadata, not content, and does not filter by date.
 * Uses a fast Rust-based implementation for optimal performance.
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

  try {
    // Use the fast Rust-based implementation
    const rustMetadata: RustMarkdownFileMetadata[] = await invoke(
      "read_markdown_files_metadata",
      {
        directoryPath,
        maxFileSize,
      },
    );

    // Convert Rust metadata to TypeScript format
    const files: MarkdownFileMetadata[] = rustMetadata.map((rustFile) => ({
      filePath: rustFile.file_path,
      fileName: rustFile.file_name,
      createdAt: new Date(rustFile.created_at),
      modifiedAt: new Date(rustFile.modified_at),
      size: rustFile.size,
    }));

    return files;
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error);
    throw new Error(
      `Failed to read all markdown files metadata from directory: ${error}`,
    );
  }
}

/**
 * Reads the content of multiple markdown files by their absolute paths.
 * Returns a Map keyed by file path to content. Files that fail to read
 * are omitted from the resulting Map.
 * Uses a fast Rust-based implementation for optimal performance.
 */
export async function readMarkdownFilesContentByPaths(
  filePaths: string[],
): Promise<Map<string, string>> {
  const markdown_files: Record<string, string> = await invoke(
    "read_markdown_files_content",
    {
      filePaths,
    },
  );

  const map = new Map<string, string>();
  for (const [path, content] of Object.entries(markdown_files)) {
    map.set(path, content);
  }

  return map;
}

/**
 * Writes content to a markdown file at the specified path.
 *
 * @param filePath - The absolute path to the file to write
 * @param content - The content to write to the file
 * @returns Promise<void>
 */
export async function writeMarkdownFileContent(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    // Use Tauri's writeTextFile function to persist the content
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(filePath, content);
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    throw new Error(`Failed to write markdown file: ${error}`);
  }
}

/**
 * Returns today's file name in YYYY-MM-DD.md format using local time.
 */
export function getTodayMarkdownFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}.md`;
}

/**
 * Ensures that a markdown file for today exists at the root of directoryPath.
 * If it doesn't exist, it is created with empty content.
 * Returns the absolute file path and whether it was created.
 */
export async function ensureTodayMarkdownFile(
  directoryPath: string,
): Promise<{ filePath: string; created: boolean }> {
  const fileName = getTodayMarkdownFileName();
  const filePath = directoryPath.endsWith("/")
    ? `${directoryPath}${fileName}`
    : `${directoryPath}/${fileName}`;

  try {
    await stat(filePath);
    return { filePath, created: false };
  } catch {
    // File doesn't exist, create it
    await writeMarkdownFileContent(filePath, "");
    return { filePath, created: true };
  }
}
