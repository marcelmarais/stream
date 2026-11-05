import type { NotesSyncStatus } from "@/ipc/notes-sync";

type Listener = () => void;
const savedListeners = new Set<Listener>();

/** Tells auto-sync a note was just written, so it waits for typing to stop. */
export function noteSaved() {
  for (const listener of savedListeners) {
    listener();
  }
}

export function onNoteSaved(listener: Listener): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

export interface SyncScheduler {
  /** A save restarts the quiet period, so a sync waits until typing stops. */
  edited: () => void;
  /**
   * Polling found changes. This only starts a quiet period if none is pending:
   * restarting it on a poll shorter than the period would put syncing off forever.
   */
  changesFound: () => void;
  /** Syncs now if a sync is pending, as when the window loses focus. */
  flush: () => void;
  syncNow: () => void;
  cancel: () => void;
}

export function createSyncScheduler(
  sync: () => void,
  settleMs: number,
): SyncScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const syncNow = () => {
    cancel();
    sync();
  };

  return {
    edited: () => {
      cancel();
      timer = setTimeout(syncNow, settleMs);
    },
    changesFound: () => {
      timer ??= setTimeout(syncNow, settleMs);
    },
    flush: () => {
      if (timer !== undefined) {
        syncNow();
      }
    },
    syncNow,
    cancel,
  };
}

interface SyncState {
  syncing: boolean;
  failed: boolean;
}

/** What the footer's sync control says. Null hides it. */
export function getSyncLabel(
  status: NotesSyncStatus | undefined,
  { syncing, failed }: SyncState,
): string | null {
  if (!status?.repo_root) {
    return null;
  }
  if (syncing) {
    return "syncing…";
  }
  if (status.busy) {
    return "rebase in progress";
  }
  if (failed) {
    return "sync failed";
  }
  if (status.changed > 0) {
    return `${status.changed} ${status.changed === 1 ? "change" : "changes"}`;
  }
  if (!status.upstream) {
    return "local only";
  }
  if (status.ahead > 0) {
    return `↑${status.ahead}`;
  }
  if (status.behind > 0) {
    return `↓${status.behind}`;
  }
  return "synced";
}
