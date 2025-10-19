import {
  FileTextIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import SettingsDialog from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";

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
  // Get data from stores
  const connectedReposCount = useGitCommitsStore(
    (state) => state.connectedReposCount,
  );
  const fileCount = useMarkdownFilesStore(
    (state) => state.allFilesMetadata.length,
  );

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
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto text-xs"
            disabled
            title="Markdown files"
          >
            <FileTextIcon className="size-3" />
            {fileCount}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto text-xs"
            disabled
            title="Connected repositories"
          >
            <GitBranchIcon className="size-3" />
            {connectedReposCount}
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
