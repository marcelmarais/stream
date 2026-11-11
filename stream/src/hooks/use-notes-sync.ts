import {
  queryOptions,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { refreshGitData } from "@/hooks/use-git-queries";
import { markdownKeys } from "@/hooks/use-markdown-queries";
import { useWindowFocus } from "@/hooks/use-window-focus";
import {
  getNotesSyncStatus,
  type NotesSyncResult,
  type NotesSyncStatus,
  syncNotes,
} from "@/ipc/notes-sync";
import { createSyncScheduler, onNoteSaved } from "@/lib/notes-sync";
import { useUserStore } from "@/stores/user-store";

const STATUS_POLL_MS = 30 * 1000;
// Commit and push once typing has stopped for this long
const SETTLE_MS = 60 * 1000;
// Pull other machines' notes this often while the window is focused
const PULL_POLL_MS = 5 * 60 * 1000;

export const notesSyncKeys = {
  status: (folderPath: string) => ["notes-sync", "status", folderPath] as const,
  sync: (folderPath: string) => ["notes-sync", "sync", folderPath] as const,
};

export function notesSyncStatusQuery(folderPath: string) {
  return queryOptions({
    queryKey: notesSyncKeys.status(folderPath),
    queryFn: () => getNotesSyncStatus(folderPath),
    enabled: !!folderPath,
    staleTime: 5000,
    retry: false,
  });
}

/** Hook to read the notes folder's sync status. useAutoSync keeps it fresh. */
export function useNotesSyncStatus(folderPath: string) {
  return useQuery(notesSyncStatusQuery(folderPath));
}

export function useSyncNotes(folderPath: string) {
  const queryClient = useQueryClient();

  return useMutation<NotesSyncResult, string>({
    mutationKey: notesSyncKeys.sync(folderPath),
    mutationFn: () =>
      syncNotes(folderPath, useUserStore.getState().githubAccount),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: notesSyncKeys.status(folderPath),
      });
      refreshGitData(queryClient, folderPath);
      // A pull can bring new days. useNoteWatcher updates the open ones.
      queryClient.invalidateQueries({
        queryKey: markdownKeys.metadata(folderPath),
      });
    },
  });
}

/** How the latest sync went, whichever hook started it. */
export function useLatestSync(folderPath: string) {
  const syncs = useMutationState({
    filters: { mutationKey: notesSyncKeys.sync(folderPath) },
    select: (mutation) => mutation.state,
  });
  const latest = syncs.at(-1);
  const lastSuccess = syncs.findLast((sync) => sync.status === "success");

  return {
    syncing: latest?.status === "pending",
    error: latest?.status === "error" ? String(latest.error) : null,
    lastSyncedAt: lastSuccess?.submittedAt ?? null,
  };
}

function canAutoSync(status: NotesSyncStatus | undefined, autoSync: boolean) {
  return autoSync && !!status?.upstream && !status.busy;
}

/**
 * Hook that commits and pushes the notes on its own, and pulls other
 * machines' notes. Mount it once, like usePullRequestPolling.
 */
export function useAutoSync(folderPath: string) {
  const queryClient = useQueryClient();
  const autoSync = useUserStore((state) => state.autoSync);
  const { mutate } = useSyncNotes(folderPath);

  const syncRef = useRef(() => {});
  syncRef.current = () => {
    // Syncs are serialised in Rust too, but queueing a second one is pointless
    if (
      !queryClient.isMutating({ mutationKey: notesSyncKeys.sync(folderPath) })
    ) {
      mutate();
    }
  };
  const [scheduler] = useState(() =>
    createSyncScheduler(() => syncRef.current(), SETTLE_MS),
  );

  const enabledRef = useRef(false);
  const isFocused = useWindowFocus((focused) => {
    if (!enabledRef.current) {
      return;
    }
    if (focused) {
      scheduler.syncNow();
    } else {
      // Notes leave the Mac when you switch away, not a minute later
      scheduler.flush();
    }
  });

  const { data: status } = useQuery({
    ...notesSyncStatusQuery(folderPath),
    refetchInterval: isFocused ? STATUS_POLL_MS : false,
  });
  const enabled = canAutoSync(status, autoSync);
  enabledRef.current = enabled;
  const hasChanges = (status?.changed ?? 0) > 0;

  // Pull once on launch, or when auto-sync is switched on
  useEffect(() => {
    if (enabled) {
      scheduler.syncNow();
    } else {
      scheduler.cancel();
    }
  }, [enabled, scheduler]);

  // Catches changes made outside the editor, by skills or other apps
  useEffect(() => {
    if (enabled && hasChanges) {
      scheduler.changesFound();
    }
  }, [enabled, hasChanges, scheduler]);

  useEffect(
    () =>
      onNoteSaved(() => {
        if (enabledRef.current) {
          scheduler.edited();
        }
        // So the control stops saying "synced" straight away
        const current = queryClient.getQueryData<NotesSyncStatus>(
          notesSyncKeys.status(folderPath),
        );
        if (current?.repo_root && current.changed === 0) {
          queryClient.invalidateQueries({
            queryKey: notesSyncKeys.status(folderPath),
          });
        }
      }),
    [folderPath, queryClient, scheduler],
  );

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }
    const interval = setInterval(scheduler.syncNow, PULL_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, isFocused, scheduler]);

  useEffect(() => () => scheduler.cancel(), [scheduler]);
}
