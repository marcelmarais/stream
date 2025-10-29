import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  FileTextIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import SettingsDialog from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import { useUserStore } from "@/stores/user-store";

interface FooterProps {
  onFolderClick: () => void;
  folderPath: string;
}

export function Footer({ onFolderClick, folderPath }: FooterProps) {
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
    <div className="flex-shrink-0 border-border border-t bg-muted/30 px-3 py-1 text-muted-foreground text-xs">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="h-auto w-auto text-xs"
          onClick={onFolderClick}
          title="Click to go back to folder selection"
        >
          <FolderIcon className="size-3" />
          <span title={folderPath || undefined}>{folderName}</span>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto gap-1 text-xs"
            disabled
            title="Markdown files"
          >
            <FileTextIcon className="m-0 size-3" />
            <span>{fileCount}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="group h-auto w-auto gap-1 text-xs transition-colors hover:text-foreground"
            disabled={connectedReposCount === 0 || isFetching}
            onClick={async () => await fetchRepos()}
            title={
              connectedReposCount === 0
                ? "No repositories connected"
                : "Click to fetch all repositories"
            }
          >
            {isFetching ? (
              <CircleNotchIcon className="size-3 animate-spin" />
            ) : (
              <>
                <GitBranchIcon className="size-3 group-hover:hidden" />
                <ArrowsClockwiseIcon className="hidden size-3 group-hover:block" />
              </>
            )}
            <span>{connectedReposCount}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto"
            onClick={() => setSettingsOpen(true)}
            title="Open settings"
          >
            <GearIcon className="size-3" />
          </Button>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
