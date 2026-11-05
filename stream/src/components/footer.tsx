import { UpdateStatus } from "@/components/auto-updater";
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import {
  useLatestSync,
  useNotesSyncStatus,
  useSyncNotes,
} from "@/hooks/use-notes-sync";
import { getSyncLabel } from "@/lib/notes-sync";
import { cn } from "@/lib/utils";
import { useStatusStore } from "@/stores/status-store";
import { useUserStore } from "@/stores/user-store";

interface FooterProps {
  folderPath: string;
}

function useHasNews() {
  return useStatusStore((state) =>
    Boolean(
      state.failure || state.finished || state.running.length || state.update,
    ),
  );
}

function StatusLine() {
  const failure = useStatusStore((state) => state.failure);
  const dismissFailure = useStatusStore((state) => state.dismissFailure);
  const finished = useStatusStore((state) => state.finished);
  const running = useStatusStore((state) => state.running);

  const runningLabel =
    running.length > 1 ? `Running ${running.length} skills` : running[0]?.label;

  return (
    <output className="flex min-w-0 flex-auto items-center gap-3.5 overflow-hidden">
      {failure && (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-destructive" title={failure}>
            {failure}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="shrink-0 hover:text-foreground"
            onClick={dismissFailure}
          >
            Dismiss
          </button>
        </span>
      )}
      {(finished || runningLabel) && (
        <span
          className="shrink-[10] truncate"
          title={running.map((skill) => skill.label).join("\n")}
        >
          {finished ?? runningLabel}
        </span>
      )}
    </output>
  );
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Commits the notes, pulls with rebase and pushes, on a click. */
function SyncControl({
  folderPath,
  className,
}: {
  folderPath: string;
  className?: string;
}) {
  const { data: status } = useNotesSyncStatus(folderPath);
  const { mutate: sync } = useSyncNotes(folderPath);
  const { syncing, error, lastSyncedAt } = useLatestSync(folderPath);
  const showFailure = useStatusStore((state) => state.showFailure);
  const notify = useStatusStore((state) => state.notify);

  const label = getSyncLabel(status, { syncing, failed: !!error });
  if (!status || !label) {
    return null;
  }

  const title = [
    status.upstream
      ? `${status.branch ?? "detached"} → ${status.upstream}`
      : `${status.branch ?? "detached"} has no upstream`,
    error ?? (lastSyncedAt && `Last synced at ${formatTime(lastSyncedAt)}`),
    status.busy ? "Finish the rebase in a terminal" : "Click to sync",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 hover:text-foreground disabled:pointer-events-none",
        error && "text-destructive",
        className,
      )}
      disabled={syncing || status.busy}
      title={title}
      onClick={() =>
        sync(undefined, {
          onSuccess: ({ committed, pushed }) =>
            notify(committed || pushed ? "Synced" : "Up to date"),
          onError: (message) => showFailure(String(message)),
        })
      }
    >
      {label}
    </button>
  );
}

/** Home has no folder to describe, so it only appears when there's news. */
export function StatusFooter() {
  const hasNews = useHasNews();

  if (!hasNews) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex h-6 items-center gap-3.5 border-t bg-background px-3 text-[11.5px] text-muted-foreground">
      <StatusLine />
      <UpdateStatus />
    </div>
  );
}

export function Footer({ folderPath }: FooterProps) {
  const hasNews = useHasNews();
  const settingsOpen = useUserStore((state) => state.settingsOpen);
  const setSettingsOpen = useUserStore((state) => state.setSettingsOpen);

  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);
  const { mutateAsync: fetchRepos, isPending: isFetching } =
    useFetchRepos(folderPath);

  const connectedReposCount = connectedRepos.length;

  const folderName = folderPath?.split("/").pop() || folderPath || "";

  return (
    <div className="@container z-50 flex h-6 shrink-0 items-center gap-3.5 border-t bg-background px-3 text-[11.5px] text-muted-foreground">
      {/* News matters more than the counts when the window is narrow */}
      <div className="flex min-w-0 shrink-[100] items-center gap-3.5 overflow-hidden">
        <button
          type="button"
          className="truncate text-foreground"
          onClick={() => setSettingsOpen(true)}
          title={folderPath}
        >
          {folderName}
        </button>
        <SyncControl
          folderPath={folderPath}
          className={cn(hasNews && "@max-2xl:hidden")}
        />
        <button
          type="button"
          className={cn(
            "shrink-0 hover:text-foreground disabled:pointer-events-none",
            hasNews && "@max-2xl:hidden",
          )}
          disabled={connectedReposCount === 0 || isFetching}
          onClick={async () => await fetchRepos()}
          title={
            connectedReposCount === 0
              ? "No repositories connected"
              : "Click to fetch all repositories"
          }
        >
          {isFetching
            ? "fetching…"
            : `${connectedReposCount} ${connectedReposCount === 1 ? "repo" : "repos"}`}
        </button>
      </div>
      <StatusLine />
      <UpdateStatus />
      <button
        type="button"
        className="shrink-0 hover:text-foreground"
        onClick={() => setSettingsOpen(!settingsOpen)}
        title={settingsOpen ? "Close settings" : "Open settings"}
      >
        settings
      </button>
    </div>
  );
}
