import { FileText, Folder, GitBranch, Settings } from "lucide-react";
import SettingsDialog from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import type { CommitsByDate } from "@/utils/git-reader";
import type { MarkdownFileMetadata } from "@/utils/markdown-reader";

interface FooterProps {
  folderPath: string;
  fileCount: number;
  connectedReposCount: number;
  onFolderClick: () => void;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

export function Footer({
  folderPath,
  fileCount,
  connectedReposCount,
  onFolderClick,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  settingsOpen,
  onSettingsOpenChange,
}: FooterProps) {
  const folderName = folderPath.split("/").pop() || folderPath;

  return (
    <div className="flex-shrink-0 border-border border-t bg-muted/30 px-4 py-1 text-muted-foreground text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto text-xs"
            onClick={onFolderClick}
            title="Click to go back to folder selection"
          >
            <Folder className="size-3" />
            <span title={folderPath}>{folderName}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-1"
            onClick={() => onSettingsOpenChange(true)}
            title="Open settings"
          >
            <Settings className="size-3" />
          </Button>
        </div>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto text-xs"
            disabled
            title="Markdown files"
          >
            <FileText className="size-3" />
            {fileCount}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto text-xs"
            disabled
            title="Connected repositories"
          >
            <GitBranch className="size-3" />
            {connectedReposCount}
          </Button>
        </div>
      </div>
      <SettingsDialog
        folderPath={folderPath}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        commitsByDate={commitsByDate}
        commitError={commitError}
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
      />
    </div>
  );
}
