import { invoke } from "@tauri-apps/api/core";
import { remove, stat } from "@tauri-apps/plugin-fs";
import {
  getMetaKeyForFilePath,
  isTrustedLocation,
  readMeta,
  setFileLocation,
} from "@/ipc/meta";

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
  /** The country associated with this file (from meta.json) */
  country?: string;
  /** The city associated with this file (from meta.json) */
  city?: string;
  /** The date parsed from the filename (YYYY-MM-DD format) */
  dateFromFilename: Date;
}

interface RustMarkdownFileMetadata {
  file_path: string;
  file_name: string;
  created_at: number;
  modified_at: number;
  size: number;
  country?: string;
  city?: string;
  date_from_filename: number;
}

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
 */
export async function readAllMarkdownFilesMetadata(
  directoryPath: string,
  options: ReadMarkdownOptions = {},
): Promise<MarkdownFileMetadata[]> {
  const { maxFileSize = 10 * 1024 * 1024 } = options;

  try {
    const rustMetadata: RustMarkdownFileMetadata[] = await invoke(
      "read_markdown_files_metadata",
      {
        directoryPath,
        maxFileSize,
      },
    );

    const filesFromRust: MarkdownFileMetadata[] = rustMetadata.map(
      (rustFile) => ({
        filePath: rustFile.file_path,
        fileName: rustFile.file_name,
        createdAt: new Date(rustFile.created_at),
        modifiedAt: new Date(rustFile.modified_at),
        size: rustFile.size,
        country: rustFile.country,
        city: rustFile.city,
        dateFromFilename: new Date(rustFile.date_from_filename),
      }),
    );

    const meta = await readMeta(directoryPath);
    const base = directoryPath.endsWith("/")
      ? directoryPath
      : `${directoryPath}/`;

    return filesFromRust.map((file) => {
      const key = file.filePath.startsWith(base)
        ? file.filePath.slice(base.length)
        : file.filePath;
      const location = meta.files[key]?.location;
      if (!location) return file;
      return { ...file, country: location.country, city: location.city };
    });
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
  const markdownFiles: Record<string, string> = await invoke(
    "read_markdown_files_content",
    {
      filePaths,
    },
  );

  const map = new Map<string, string>();
  for (const [path, content] of Object.entries(markdownFiles)) {
    map.set(path, content);
  }

  return map;
}

/**
 * Writes content to a markdown file at the specified path.
 */
export async function writeMarkdownFileContent(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(filePath, content);
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
 * Gets the current user's location (country and city) from macOS location
 * services. Returns undefined if location cannot be determined.
 */
export async function getCurrentLocation(): Promise<
  { country: string; city: string } | undefined
> {
  try {
    return await invoke("detect_location");
  } catch (error) {
    console.warn("Could not detect location:", error);
    return undefined;
  }
}

/**
 * Gets where the user is now, falling back to their last trusted location.
 */
export async function resolveCurrentLocation(
  folderPath: string,
): Promise<{ country: string; city: string; source: string } | undefined> {
  const detected = await getCurrentLocation();
  if (detected) return { ...detected, source: "auto:corelocation" };

  const last = (await readMeta(folderPath)).globals?.lastLocation;
  if (!last || !isTrustedLocation(last)) return undefined;

  return {
    country: last.country,
    city: last.city,
    source: "auto:lastLocation",
  };
}

/**
 * Stores the current location for a file unless it already has one.
 * Returns whether a location could be determined.
 */
export async function fillFileLocation(
  folderPath: string,
  filePath: string,
): Promise<boolean> {
  const location = await resolveCurrentLocation(folderPath);
  if (!location) return false;

  await setFileLocation(folderPath, filePath, location, { onlyIfEmpty: true });
  return true;
}

/**
 * Gets the location of the closest earlier note, as a suggestion for a past
 * day. Skips IP lookups from older versions, which are often the wrong city.
 */
export async function getNearestEarlierLocation(
  folderPath: string,
  filePath: string,
): Promise<{ country: string; city: string } | undefined> {
  const meta = await readMeta(folderPath);
  const fileKey = getMetaKeyForFilePath(folderPath, filePath);

  const nearestKey = Object.keys(meta.files)
    .filter((key) => {
      const location = meta.files[key]?.location;
      return key < fileKey && location && location.source !== "auto:ip";
    })
    .sort()
    .at(-1);

  return nearestKey ? meta.files[nearestKey]?.location : undefined;
}

/**
 * Sets location metadata (country and city) for a file in meta.json.
 */
export async function setFileLocationMetadata(
  folderPath: string,
  filePath: string,
  country: string,
  city: string,
  source: string = "manual",
): Promise<void> {
  try {
    await setFileLocation(folderPath, filePath, { country, city, source });
  } catch (error) {
    console.error(`Error setting location metadata for ${filePath}:`, error);
    throw new Error(`Failed to set location metadata: ${error}`);
  }
}

/**
 * Deletes a markdown file at the specified path.
 */
export async function deleteMarkdownFile(filePath: string): Promise<void> {
  await remove(filePath);
}
