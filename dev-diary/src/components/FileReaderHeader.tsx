"use client";

import type { CommitsByDate } from "../utils/gitReader";
import type { MarkdownFileMetadata } from "../utils/markdownReader";
import SettingsDialog from "./SettingsDialog";

interface FileReaderHeaderProps {
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  error: string | null;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

// Navigation component with settings only
function HeaderNavigation({
  folderPath,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  settingsOpen,
  onSettingsOpenChange,
}: {
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-end">
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
}: FileReaderHeaderProps) {
  return (
    <div className="!bg-transparent flex-shrink-0">
      <HeaderNavigation
        folderPath={folderPath}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        commitsByDate={commitsByDate}
        commitError={commitError}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
      />

      {/* Error Display */}
      {error && <ErrorDisplay error={error} />}
    </div>
  );
}

export default FileReaderHeader;
