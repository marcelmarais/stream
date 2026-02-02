import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import type { Habit } from "@/ipc/habit-reader";

export type RefreshInterval =
  | "none"
  | "minutely"
  | "hourly"
  | "daily"
  | "weekly";

export interface LocationMeta {
  country: string;
  city: string;
  /**
   * Where this value came from, e.g.:
   * - "auto:ipapi"
   * - "manual"
   */
  source?: string;
  updatedAt?: number;
}

export interface RefreshMeta {
  interval?: RefreshInterval;
  lastRefreshedAt?: number;
}

export interface FileMeta {
  location?: LocationMeta;
  description?: string;
  refresh?: RefreshMeta;
  /**
   * Reserved for future per-file features (tags, mood, etc).
   * Keep it JSON-serializable.
   */
  extra?: Record<string, unknown>;
}

export interface StreamMeta {
  schemaVersion: 1;
  updatedAt: number;
  globals?: {
    lastLocation?: LocationMeta;
  };
  files: Record<string, FileMeta>;
  habits: {
    items: Habit[];
    extra?: Record<string, unknown>;
  };
  extra?: Record<string, unknown>;
}

const META_FILENAME = "meta.json";

function nowMs(): number {
  return Date.now();
}

function normalizeFolderPath(folderPath: string): string {
  return folderPath.endsWith("/") ? folderPath.slice(0, -1) : folderPath;
}

export function getMetaFilePath(folderPath: string): string {
  const base = normalizeFolderPath(folderPath);
  return `${base}/${META_FILENAME}`;
}

export function getMetaKeyForFilePath(
  folderPath: string,
  filePath: string,
): string {
  const base = `${normalizeFolderPath(folderPath)}/`;
  if (filePath.startsWith(base)) {
    return filePath.slice(base.length);
  }
  return filePath;
}

function createDefaultMeta(): StreamMeta {
  return {
    schemaVersion: 1,
    updatedAt: nowMs(),
    files: {},
    habits: { items: [] },
  };
}

const metaWriteLocks = new Map<string, Promise<void>>();

async function withMetaWriteLock<T>(
  folderPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = normalizeFolderPath(folderPath);
  const prev = metaWriteLocks.get(key) || Promise.resolve();

  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  metaWriteLocks.set(
    key,
    prev.then(() => next),
  );

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (metaWriteLocks.get(key) === next) {
      metaWriteLocks.delete(key);
    }
  }
}

export async function readMeta(folderPath: string): Promise<StreamMeta> {
  const filePath = getMetaFilePath(folderPath);
  const fileExists = await exists(filePath);
  if (!fileExists) return createDefaultMeta();

  try {
    const content = await readTextFile(filePath);
    const parsed = JSON.parse(content) as Partial<StreamMeta> | null;

    if (!parsed || parsed.schemaVersion !== 1) {
      return createDefaultMeta();
    }

    return {
      schemaVersion: 1,
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : nowMs(),
      globals: parsed.globals,
      files:
        parsed.files && typeof parsed.files === "object" ? parsed.files : {},
      habits:
        parsed.habits && typeof parsed.habits === "object"
          ? {
              items: Array.isArray(parsed.habits.items)
                ? parsed.habits.items
                : [],
              extra: parsed.habits.extra,
            }
          : { items: [] },
      extra: parsed.extra,
    };
  } catch (error) {
    console.error("Failed to read meta.json:", error);
    return createDefaultMeta();
  }
}

export async function writeMeta(
  folderPath: string,
  meta: StreamMeta,
): Promise<void> {
  const filePath = getMetaFilePath(folderPath);
  const content = JSON.stringify(meta, null, 2);
  await writeTextFile(filePath, content);
}

export async function updateMeta(
  folderPath: string,
  updater: (current: StreamMeta) => StreamMeta,
): Promise<StreamMeta> {
  return withMetaWriteLock(folderPath, async () => {
    const current = await readMeta(folderPath);
    const next = updater(current);
    const stamped: StreamMeta = {
      ...next,
      schemaVersion: 1,
      updatedAt: nowMs(),
      files: next.files || {},
      habits: next.habits || { items: [] },
    };
    await writeMeta(folderPath, stamped);
    return stamped;
  });
}

export async function setFileLocation(
  folderPath: string,
  filePath: string,
  location: { country: string; city: string; source?: string },
): Promise<void> {
  const key = getMetaKeyForFilePath(folderPath, filePath);
  await updateMeta(folderPath, (current) => {
    const existing = current.files[key] || {};
    const nextLocation: LocationMeta = {
      country: location.country,
      city: location.city,
      source: location.source,
      updatedAt: nowMs(),
    };
    return {
      ...current,
      globals: { ...current.globals, lastLocation: nextLocation },
      files: {
        ...current.files,
        [key]: {
          ...existing,
          location: nextLocation,
        },
      },
    };
  });
}

export async function setFileDescriptionMeta(
  folderPath: string,
  filePath: string,
  description: string,
): Promise<void> {
  const key = getMetaKeyForFilePath(folderPath, filePath);
  await updateMeta(folderPath, (current) => {
    const existing = current.files[key] || {};
    return {
      ...current,
      files: {
        ...current.files,
        [key]: { ...existing, description },
      },
    };
  });
}

export async function setFileRefreshIntervalMeta(
  folderPath: string,
  filePath: string,
  interval: RefreshInterval,
): Promise<void> {
  const key = getMetaKeyForFilePath(folderPath, filePath);
  await updateMeta(folderPath, (current) => {
    const existing = current.files[key] || {};
    return {
      ...current,
      files: {
        ...current.files,
        [key]: {
          ...existing,
          refresh: { ...existing.refresh, interval },
        },
      },
    };
  });
}

export async function markFileRefreshedMeta(
  folderPath: string,
  filePath: string,
): Promise<void> {
  const key = getMetaKeyForFilePath(folderPath, filePath);
  await updateMeta(folderPath, (current) => {
    const existing = current.files[key] || {};
    return {
      ...current,
      files: {
        ...current.files,
        [key]: {
          ...existing,
          refresh: { ...existing.refresh, lastRefreshedAt: nowMs() },
        },
      },
    };
  });
}
