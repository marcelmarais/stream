import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { exists, type WatchEvent, watch } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo } from "react";
import { markdownKeys, noteCache } from "@/hooks/use-markdown-queries";
import { useWindowFocus } from "@/hooks/use-window-focus";
import {
  type MarkdownFileMetadata,
  readMarkdownFilesContentByPaths,
} from "@/ipc/markdown-reader";
import { getMetaFilePath } from "@/ipc/meta";
import {
  forget,
  isWriting,
  takeDiskChange,
  writeGeneration,
} from "@/lib/note-disk";

// Long enough for git to finish writing a file, short enough to feel live
const WATCH_DELAY_MS = 200;

// Matches DATE_FILENAME_REGEX in src-tauri/src/ipc/markdown.rs
const NOTE_FILENAME = /(^|\/)\d{4}-\d{2}-\d{2}\.md$/;

function isNote(path: string) {
  return NOTE_FILENAME.test(path) && !path.includes("/.git/");
}

function cachedNotePaths(queryClient: QueryClient) {
  return queryClient
    .getQueriesData<string | null>({
      queryKey: [...markdownKeys.all, "content"],
    })
    .filter(([, content]) => typeof content === "string")
    .map(([queryKey]) => String(queryKey[2]))
    .filter(Boolean);
}

/** Re-reads notes that changed on disk and brings each change in. */
export async function checkNotes(
  queryClient: QueryClient,
  folderPath: string,
  filePaths: string[],
) {
  // A write in flight sends an event of its own once it lands
  const paths = filePaths.filter((filePath) => !isWriting(filePath));

  if (paths.length === 0) {
    return;
  }

  const generations = new Map(
    paths.map((path) => [path, writeGeneration(path)]),
  );
  const contents = await readMarkdownFilesContentByPaths(paths);
  const metadataKey = markdownKeys.metadata(folderPath);
  const metadata =
    queryClient.getQueryData<MarkdownFileMetadata[]>(metadataKey);
  let filesChanged = false;

  for (const filePath of paths) {
    // Stream saved it while it was being read, so the read may be half a file
    if (
      isWriting(filePath) ||
      writeGeneration(filePath) !== generations.get(filePath)
    ) {
      continue;
    }

    const remote = contents.get(filePath);

    if (remote === undefined) {
      // A second look, as git can replace a file rather than rewrite it
      if (!(await exists(filePath).catch(() => true))) {
        forget(filePath);
        filesChanged = true;
      }
      continue;
    }

    if (metadata && !metadata.some((file) => file.filePath === filePath)) {
      filesChanged = true;
    }

    await takeDiskChange(filePath, remote, noteCache(queryClient, filePath));
  }

  if (filesChanged) {
    await queryClient.invalidateQueries({ queryKey: metadataKey });
  }
}

/**
 * Runs one check at a time, in order. Paths that change during a check are
 * gathered for the next, so an older read can't land after a newer one.
 */
export function createNoteChecker(check: (paths: string[]) => Promise<void>) {
  let pending = new Set<string>();
  let running = false;

  const run = async () => {
    running = true;

    while (pending.size > 0) {
      const paths = [...pending];
      pending = new Set();

      try {
        await check(paths);
      } catch (error) {
        console.warn("Couldn't check notes on disk:", error);
      }
    }

    running = false;
  };

  return (paths: string[]) => {
    for (const path of paths) {
      pending.add(path);
    }

    if (!running && pending.size > 0) {
      void run();
    }
  };
}

/**
 * Hook that keeps notes in step with the folder on disk, as git pulls, other
 * apps and agents change them. Mount it once, like useAutoSync.
 */
export function useNoteWatcher(folderPath: string) {
  const queryClient = useQueryClient();
  const checkNotesSoon = useMemo(
    () =>
      createNoteChecker((paths) => checkNotes(queryClient, folderPath, paths)),
    [folderPath, queryClient],
  );

  useEffect(() => {
    if (!folderPath) {
      return;
    }

    const metaPath = getMetaFilePath(folderPath);
    let stopWatching: (() => void) | undefined;
    let isCancelled = false;

    const onEvent = (event: WatchEvent) => {
      if (typeof event.type === "object" && "access" in event.type) {
        return;
      }

      // A location set on another Mac
      if (event.paths.includes(metaPath)) {
        void queryClient.invalidateQueries({
          queryKey: markdownKeys.metadata(folderPath),
        });
      }

      checkNotesSoon(event.paths.filter(isNote));
    };

    try {
      void watch(folderPath, onEvent, {
        recursive: true,
        delayMs: WATCH_DELAY_MS,
      })
        .then((unwatch) => {
          if (isCancelled) {
            unwatch();
          } else {
            stopWatching = unwatch;
          }
        })
        .catch((error) => {
          console.warn("Couldn't watch the notes folder:", error);
        });
    } catch {
      // Browser previews without the fs plugin
    }

    return () => {
      isCancelled = true;
      stopWatching?.();
    };
  }, [checkNotesSoon, folderPath, queryClient]);

  // Catches anything the watcher missed while the Mac was asleep
  useWindowFocus((focused) => {
    if (focused) {
      checkNotesSoon(cachedNotePaths(queryClient));
    }
  });
}
