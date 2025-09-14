"use client";

import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CommitsByDate } from "../utils/gitReader";
import type { MarkdownFileMetadata } from "../utils/markdownReader";
import SettingsDialog from "./SettingsDialog";

interface FileReaderHeaderProps {
  folderPath: string;
  onBack: () => void;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  error: string | null;
}

// Navigation component with back button and settings
function HeaderNavigation({
  onBack,
  folderPath,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
}: {
  onBack: () => void;
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <Button onClick={onBack} variant={"ghost"}>
        <ChevronLeft className="size-4" />
      </Button>
      <SettingsDialog
        folderPath={folderPath}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        commitsByDate={commitsByDate}
        commitError={commitError}
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
  onBack,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  error,
}: FileReaderHeaderProps) {
  return (
    <div className="mx-auto w-full max-w-4xl flex-shrink-0 px-2 py-8">
      <HeaderNavigation
        onBack={onBack}
        folderPath={folderPath}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        commitsByDate={commitsByDate}
        commitError={commitError}
      />

      {/* Error Display */}
      {error && <ErrorDisplay error={error} />}
    </div>
  );
}

export default FileReaderHeader;
