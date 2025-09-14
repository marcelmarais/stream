"use client";

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CommitsByDate } from "../utils/gitReader";
import type { MarkdownFileMetadata } from "../utils/markdownReader";
import RepoConnector from "./RepoConnector";

interface SettingsDialogProps {
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Folder path display component
function FolderInfo({ folderPath }: { folderPath: string }) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-foreground">Current Folder</h3>
      <div className="text-muted-foreground text-sm">
        Reading from:{" "}
        <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
          {folderPath}
        </code>
      </div>
    </div>
  );
}

// Status information component
function StatusInfo({
  fileCount,
  commitsByDate,
  commitError,
}: {
  fileCount: number;
  commitsByDate: CommitsByDate;
  commitError: string | null;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-foreground">Status Information</h3>
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">
          📄 Found {fileCount} markdown files
        </div>

        {/* Git Commits Status */}
        {Object.keys(commitsByDate).length > 0 && (
          <div className="text-blue-600 text-sm dark:text-blue-400">
            🔄 Found commits for {Object.keys(commitsByDate).length} days
            (loaded on-demand)
          </div>
        )}

        {commitError && (
          <div className="rounded-md border border-orange-500/20 bg-orange-500/10 p-2 text-orange-700 text-sm dark:text-orange-400">
            ⚠️ {commitError}
          </div>
        )}
      </div>
    </div>
  );
}

// Loading state component
function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <div className="font-medium text-lg text-primary">
          Reading folder metadata...
        </div>
        <div className="mt-2 text-muted-foreground text-sm">
          Please wait while we scan for markdown files
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({
  folderPath,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  open,
  onOpenChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings className="h-4 w-4" />
          <span className="sr-only">Open settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings & Information</DialogTitle>
          <DialogDescription>
            Manage your folder settings and connected repositories
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Folder Information */}
          <FolderInfo folderPath={folderPath} />

          {/* Status Information */}
          {isLoadingMetadata ? (
            <LoadingState />
          ) : (
            <StatusInfo
              fileCount={allFilesMetadata.length}
              commitsByDate={commitsByDate}
              commitError={commitError}
            />
          )}

          {/* Repository Connector */}
          <div className="space-y-2">
            <h3 className="font-medium text-foreground">
              Repository Management
            </h3>
            <RepoConnector
              markdownDirectory={folderPath}
              className="border-0 bg-transparent p-0 shadow-none"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
