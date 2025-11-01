import { invoke } from "@tauri-apps/api/core";
import { remove, stat } from "@tauri-apps/plugin-fs";

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
  /** The country where the file was created (from xattrs) */
  country?: string;
  /** The city where the file was created (from xattrs) */
  city?: string;
  /** The date parsed from the filename (YYYY-MM-DD format) */
  dateFromFilename: Date;
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
  country?: string;
  city?: string;
  date_from_filename: number; // Date from filename as Unix timestamp (midnight UTC)
}

/**
 * Options for reading markdown files
 */
interface ReadMarkdownOptions {
  /** Maximum file size to read in bytes (default: 10MB) */
  maxFileSize?: number;
}

/**
 * Reads metadata for markdown files in a directory (including subdirectories).
 * Only reads files that match the naming pattern: YYYY-MM-DD.md (e.g., 2025-10-19.md).
 * Files are sorted by the date in the filename (newest first).
 * This function only reads file metadata, not content.
 * Uses a fast Rust-based implementation for optimal performance.
 *
 * @param directoryPath - The path to the directory to search
 * @param options - Additional options for reading files
 * @returns Promise<MarkdownFileMetadata[]> - Array of markdown file metadata sorted by filename date
 */
export async function readAllMarkdownFilesMetadata(
  directoryPath: string,
  options: ReadMarkdownOptions = {},
): Promise<MarkdownFileMetadata[]> {
  const {
    maxFileSize = 10 * 1024 * 1024, // 10MB default
  } = options;

  try {
    const rustMetadata: RustMarkdownFileMetadata[] = await invoke(
      "read_markdown_files_metadata",
      {
        directoryPath,
        maxFileSize,
      },
    );

    const files: MarkdownFileMetadata[] = rustMetadata.map((rustFile) => ({
      filePath: rustFile.file_path,
      fileName: rustFile.file_name,
      createdAt: new Date(rustFile.created_at),
      modifiedAt: new Date(rustFile.modified_at),
      size: rustFile.size,
      country: rustFile.country,
      city: rustFile.city,
      dateFromFilename: new Date(rustFile.date_from_filename),
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
 * If the file is newly created, it will automatically store the user's current location
 * (country and city) in extended attributes.
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
    let fileExists = true;
    try {
      await stat(filePath);
    } catch {
      fileExists = false;
    }

    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(filePath, content);

    if (!fileExists) {
      const location = await getCurrentLocation();
      if (location) {
        try {
          await setFileLocationMetadata(
            filePath,
            location.country,
            location.city,
          );
        } catch (error) {
          console.warn(
            `Could not set location metadata for ${filePath}:`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    throw new Error(`Failed to write markdown file: ${error}`);
  }
}

/**
 * Returns a file name in YYYY-MM-DD.md format for the given date.
 */
export function getMarkdownFileName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}.md`;
}

/**
 * Returns today's file name in YYYY-MM-DD.md format using local time.
 */
export function getTodayMarkdownFileName(): string {
  return getMarkdownFileName(new Date());
}

/**
 * Ensures that a markdown file for the given date exists at the root of directoryPath.
 * If it doesn't exist, it is created with empty content.
 * Returns the absolute file path and whether it was created.
 */
export async function ensureMarkdownFileForDate(
  directoryPath: string,
  date: Date,
): Promise<{ filePath: string; created: boolean }> {
  const fileName = getMarkdownFileName(date);
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

/**
 * Ensures that a markdown file for today exists at the root of directoryPath.
 * If it doesn't exist, it is created with empty content.
 * Returns the absolute file path and whether it was created.
 */
export async function ensureTodayMarkdownFile(
  directoryPath: string,
): Promise<{ filePath: string; created: boolean }> {
  return ensureMarkdownFileForDate(directoryPath, new Date());
}

/**
 * Gets the current user's location (country and city) via IP geolocation.
 * Uses ipapi.co for geolocation (free, no API key required).
 * Returns undefined if location cannot be determined.
 */
export async function getCurrentLocation(): Promise<
  { country: string; city: string } | undefined
> {
  try {
    const response = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn("Failed to fetch location:", response.statusText);
      return undefined;
    }

    const data = await response.json();
    const country = data.country_name;
    const city = data.city;

    if (
      country &&
      city &&
      country !== "Unknown" &&
      city !== "Unknown" &&
      country.trim() !== "" &&
      city.trim() !== ""
    ) {
      return { country, city };
    }
    console.warn("Location data unavailable or invalid:", { country, city });
    return undefined;
  } catch (error) {
    console.error("Error getting current location:", error);
    return undefined;
  }
}

/**
 * Sets location metadata (country and city) on a file using extended attributes.
 *
 * @param filePath - The absolute path to the file
 * @param country - The country name
 * @param city - The city name
 */
export async function setFileLocationMetadata(
  filePath: string,
  country: string,
  city: string,
): Promise<void> {
  try {
    await invoke("set_file_location_metadata", {
      filePath,
      country,
      city,
    });
  } catch (error) {
    console.error(`Error setting location metadata for ${filePath}:`, error);
    throw new Error(`Failed to set location metadata: ${error}`);
  }
}

/**
 * Deletes a markdown file at the specified path.
 *
 * @param filePath - The absolute path to the file to delete
 * @returns Promise<void>
 */
export async function deleteMarkdownFile(filePath: string): Promise<void> {
  await remove(filePath);
}
