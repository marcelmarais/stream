import { UpdateStatus } from "@/components/auto-updater";
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
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
  const { data: allFilesMetadata = [] } = useMarkdownMetadata(folderPath);
  const { mutateAsync: fetchRepos, isPending: isFetching } =
    useFetchRepos(folderPath);

  const fileCount = allFilesMetadata.length;
  const connectedReposCount = connectedRepos.length;

  const folderName = folderPath?.split("/").pop() || folderPath || "";

  return (
    <div className="@container z-50 flex h-6 shrink-0 items-center gap-3.5 border-t bg-background px-3 text-[11.5px] text-muted-foreground">
      {/* News matters more than the counts when the window is narrow */}
      <div className="flex min-w-0 shrink-[100] items-center gap-3.5">
        <button
          type="button"
          className="truncate text-foreground"
          onClick={() => setSettingsOpen(true)}
          title={folderPath}
        >
          {folderName}
        </button>
        <span className={cn("shrink-0", hasNews && "@max-2xl:hidden")}>
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
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
