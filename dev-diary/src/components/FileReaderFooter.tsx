"use client";

import { FileText, Folder, GitBranch } from "lucide-react";

interface FileReaderFooterProps {
  folderPath: string;
  fileCount: number;
  connectedReposCount: number;
  onSettingsClick: () => void;
}

export function FileReaderFooter({
  folderPath,
  fileCount,
  connectedReposCount,
  onSettingsClick,
}: FileReaderFooterProps) {
  // Extract just the folder name from the full path for display
  const folderName = folderPath.split("/").pop() || folderPath;

  return (
    <div className="flex-shrink-0 border-border border-t bg-muted/30 px-4 py-1 text-muted-foreground text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSettingsClick}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
            title="Click to open settings"
          >
            <Folder className="size-3" />
            <span title={folderPath}>{folderName}</span>
          </button>
          <button
            type="button"
            onClick={onSettingsClick}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
            title="Click to open settings"
          >
            <FileText className="size-3" />
            <span>{fileCount} markdown files</span>
          </button>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSettingsClick}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
            title="Click to open settings"
          >
            <GitBranch className="size-3" />
            <span>{connectedReposCount} connected repos</span>
          </button>
          <div className="text-right">dev-diary</div>
        </div>
      </div>
    </div>
  );
}

export default FileReaderFooter;
