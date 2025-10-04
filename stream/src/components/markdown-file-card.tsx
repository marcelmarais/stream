import { CalendarPlus, FileText, Folder, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CommitsByDate, GitCommit } from "../utils/git-reader";
import type { MarkdownFileMetadata } from "../utils/markdown-reader";
import CommitOverlay from "./commit-overlay";
import { MarkdownEditor } from "./markdown-editor";
import SettingsDialog from "./settings-dialog";
import { Separator } from "./ui/separator";

export function DateHeader({ displayDate }: { displayDate: string }) {
  return (
    <div className="mx-6 mt-8 first:mt-0">
      <h1 className="font-semibold text-4xl">{displayDate}</h1>
    </div>
  );
}

function FileName({ fileName }: { fileName: string }) {
  return (
    <div className="flex items-center justify-end">
      <h4 className="font-base text-muted-foreground text-sm">{fileName}</h4>
    </div>
  );
}

interface FileCardProps {
  file: MarkdownFileMetadata;
  content?: string;
  isLoading: boolean;
  commits: GitCommit[];
  onContentChange: (filePath: string, content: string) => void;
  onSave: (filePath: string) => void;
}

export function FileCard({
  file,
  content,
  isLoading,
  commits,
  onContentChange,
  onSave,
}: FileCardProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center pt-4 pb-8">
        <div className="text-center">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <div className="text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-6">
      <MarkdownEditor
        value={content ?? ""}
        onChange={(value: string) => onContentChange(file.filePath, value)}
        onSave={() => onSave(file.filePath)}
      />

      <FileName fileName={file.fileName} />
      {commits.length > 0 && (
        <div className="mt-4">
          <CommitOverlay
            commits={commits}
            date={file.createdAt}
            className="w-full"
          />
        </div>
      )}
      <Separator className="mt-12" />
    </div>
  );
}

interface FileReaderFooterProps {
  folderPath: string;
  fileCount: number;
  connectedReposCount: number;
  onSettingsClick: () => void;
  onFolderClick: () => void;
}

export function FileReaderFooter({
  folderPath,
  fileCount,
  connectedReposCount,
  onSettingsClick,
  onFolderClick,
}: FileReaderFooterProps) {
  // Extract just the folder name from the full path for display
  const folderName = folderPath.split("/").pop() || folderPath;

  return (
    <div className="flex-shrink-0 border-border border-t bg-muted/30 px-4 py-1 text-muted-foreground text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onFolderClick}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
            title="Click to go back to folder selection"
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
        </div>
      </div>
    </div>
  );
}

export default FileReaderFooter;

interface FileReaderHeaderProps {
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  error: string | null;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  onCreateToday: () => void | Promise<void>;
  creatingToday?: boolean;
}

// Navigation component with settings only
export function HeaderNavigation({
  folderPath,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  onCreateToday,
  creatingToday,
  settingsOpen,
  onSettingsOpenChange,
}: {
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  onCreateToday: () => void | Promise<void>;
  creatingToday?: boolean;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onCreateToday}
        disabled={isLoadingMetadata || Boolean(creatingToday)}
      >
        <CalendarPlus className="size-4" />
      </Button>
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

// Error display component
function ErrorDisplay({ error }: { error: string }) {
  return (
    <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
      {error}
    </div>
  );
}

// Main header component that combines all sub-components
export function FileReaderHeader({
  folderPath,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  error,
  settingsOpen,
  onSettingsOpenChange,
  onCreateToday,
  creatingToday,
}: FileReaderHeaderProps) {
  return (
    <div className="!bg-transparent flex-shrink-0">
      <HeaderNavigation
        folderPath={folderPath}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        commitsByDate={commitsByDate}
        commitError={commitError}
        onCreateToday={onCreateToday}
        creatingToday={creatingToday}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
      />

      {error && <ErrorDisplay error={error} />}
    </div>
  );
}
