import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import { useUserStore } from "@/stores/user-store";

interface FooterProps {
  folderPath: string;
}

export function Footer({ folderPath }: FooterProps) {
  const setSettingsOpen = useUserStore((state) => state.setSettingsOpen);

  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);
  const { data: allFilesMetadata = [] } = useMarkdownMetadata(folderPath);
  const { mutateAsync: fetchRepos, isPending: isFetching } =
    useFetchRepos(folderPath);

  const fileCount = allFilesMetadata.length;
  const connectedReposCount = connectedRepos.length;

  const folderName = folderPath?.split("/").pop() || folderPath || "";

  return (
    <div className="z-50 flex h-6 shrink-0 items-center justify-between border-t bg-background px-3 text-[11.5px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3.5">
        <button
          type="button"
          className="truncate text-foreground"
          onClick={() => setSettingsOpen(true)}
          title={folderPath}
        >
          {folderName}
        </button>
        <span className="shrink-0">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
        <button
          type="button"
          className="shrink-0 hover:text-foreground disabled:pointer-events-none"
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
      <button
        type="button"
        className="shrink-0 hover:text-foreground"
        onClick={() => setSettingsOpen(true)}
        title="Open settings"
      >
        settings
      </button>
    </div>
  );
}
