import {
  FileTextIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import SettingsDialog from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { useConnectedRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";

interface FooterProps {
  folderPath: string;
  onFolderClick: () => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

export function Footer({
  folderPath,
  onFolderClick,
  settingsOpen,
  onSettingsOpenChange,
}: FooterProps) {
  // Get data from queries
  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);
  const { data: allFilesMetadata = [] } = useMarkdownMetadata(folderPath);
  const fileCount = allFilesMetadata.length;
  const connectedReposCount = connectedRepos.length;

  const folderName = folderPath.split("/").pop() || folderPath;

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
          <span title={folderPath}>{folderName}</span>
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
            className="h-auto w-auto gap-1 text-xs"
            disabled
            title="Connected repositories"
          >
            <GitBranchIcon className="size-3" />
            <span>{connectedReposCount}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto"
            onClick={() => onSettingsOpenChange(true)}
            title="Open settings"
          >
            <GearIcon className="size-3" />
          </Button>
        </div>
      </div>
      <SettingsDialog
        folderPath={folderPath}
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
      />
    </div>
  );
}
