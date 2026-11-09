import { diff } from "@codemirror/merge";
import { ChangeSet, Text } from "@codemirror/state";
import {
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "@/ipc/markdown-reader";
import { noteSaved } from "@/lib/notes-sync";

/**
 * What each note held when Stream last read or wrote it. A note on disk that
 * differs from this was changed by something else: a pull, another app, an
 * agent. Comparing text, not timing, is what tells Stream's own saves apart.
 */
const known = new Map<string, string>();
const deleted = new Set<string>();
const inFlight = new Map<string, number>();
const generations = new Map<string, number>();

export function remember(filePath: string, text: string) {
  known.set(filePath, text);
  deleted.delete(filePath);
}

export function knownText(filePath: string): string | undefined {
  return known.get(filePath);
}

/** After a delete, so a save still waiting to fire can't bring the note back. */
export function forget(filePath: string) {
  known.delete(filePath);
  deleted.add(filePath);
}

export function isWriting(filePath: string) {
  return (inFlight.get(filePath) ?? 0) > 0;
}

/** Changes whenever a write starts, so a read that overlapped one is dropped. */
export function writeGeneration(filePath: string) {
  return generations.get(filePath) ?? 0;
}

/** Reads notes into the editor's world, recording them as what's on disk. */
export async function readNotes(filePaths: string[]) {
  const contents = await readMarkdownFilesContentByPaths(filePaths);

  for (const [filePath, text] of contents) {
    remember(filePath, text);
  }

  return contents;
}

/**
 * Saves a note, unless something else changed it since Stream last looked.
 * The watcher would report that change, but a save landing first would
 * overwrite it unseen. Returns the note's text on disk when it didn't write.
 */
async function writeIfUnchanged(
  filePath: string,
  text: string,
): Promise<string | undefined> {
  if (deleted.has(filePath)) {
    return undefined;
  }

  generations.set(filePath, writeGeneration(filePath) + 1);
  inFlight.set(filePath, (inFlight.get(filePath) ?? 0) + 1);

  try {
    const expected = known.get(filePath);

    if (expected !== undefined) {
      const contents = await readMarkdownFilesContentByPaths([filePath]);
      const onDisk = contents.get(filePath);

      if (onDisk !== undefined && onDisk !== expected && onDisk !== text) {
        return onDisk;
      }
    }

    remember(filePath, text);
    await writeMarkdownFileContent(filePath, text);
    return undefined;
  } finally {
    const left = (inFlight.get(filePath) ?? 1) - 1;
    if (left > 0) {
      inFlight.set(filePath, left);
    } else {
      inFlight.delete(filePath);
    }
  }
}

/** Where a note's text lives outside the editor, the React Query cache. */
export interface NoteCache {
  get: () => string | null | undefined;
  set: (text: string) => void;
}

export async function writeNote(
  filePath: string,
  text: string,
  cache: NoteCache,
) {
  const onDisk = await writeIfUnchanged(filePath, text);

  if (onDisk !== undefined) {
    await takeDiskChange(filePath, onDisk, cache);
  }
}

/**
 * Brings a note's text on disk into Stream. An open editor merges it into
 * what's on screen. Otherwise the cache takes it, and text typed but not yet
 * saved is kept and saved on top.
 */
export async function takeDiskChange(
  filePath: string,
  remote: string,
  cache: NoteCache,
) {
  const previous = known.get(filePath);

  // Stream's own save, or nothing new
  if (remote === previous) {
    return;
  }

  const cached = cache.get();
  const base = previous ?? (typeof cached === "string" ? cached : remote);
  remember(filePath, remote);

  if (notifyDiskChange(filePath, { base, remote })) {
    return;
  }

  // Never shown, so it's read fresh when it is
  if (typeof cached !== "string") {
    return;
  }

  if (cached === base) {
    cache.set(remote);
    return;
  }

  const merged = rebaseText(base, cached, remote);
  cache.set(merged);

  if (merged !== remote) {
    await writeNote(filePath, merged, cache);
    noteSaved();
  }
}

function changesBetween(from: string, to: string) {
  return ChangeSet.of(
    diff(from, to).map((change) => ({
      from: change.fromA,
      to: change.toA,
      insert: to.slice(change.fromB, change.toB),
    })),
    from.length,
  );
}

/**
 * The changes that bring what's now on disk into `local`, keeping whatever was
 * typed since `base` was saved. Both sides survive, even where they overlap.
 */
export function rebaseChanges(base: string, local: string, remote: string) {
  if (remote === local) {
    return ChangeSet.empty(local.length);
  }

  return changesBetween(base, remote).map(changesBetween(base, local));
}

export function rebaseText(base: string, local: string, remote: string) {
  return rebaseChanges(base, local, remote)
    .apply(Text.of(local.split("\n")))
    .toString();
}

export interface DiskChange {
  base: string;
  remote: string;
}

type DiskListener = (change: DiskChange) => void;
const listeners = new Map<string, Set<DiskListener>>();

/** Open editors take changes themselves, so a keystroke can't land in between. */
export function followNoteOnDisk(
  filePath: string,
  listener: DiskListener,
): () => void {
  const forPath = listeners.get(filePath) ?? new Set();
  forPath.add(listener);
  listeners.set(filePath, forPath);

  return () => {
    forPath.delete(listener);
    if (forPath.size === 0) {
      listeners.delete(filePath);
    }
  };
}

/** Returns whether an open editor took the change. */
export function notifyDiskChange(filePath: string, change: DiskChange) {
  const forPath = listeners.get(filePath);

  for (const listener of forPath ?? []) {
    listener(change);
  }

  return (forPath?.size ?? 0) > 0;
}
