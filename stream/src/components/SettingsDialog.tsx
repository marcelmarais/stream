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
    <div className="space-y-3">
      <h3 className="font-semibold text-foreground text-lg">Current Folder</h3>
      <div className="text-muted-foreground">
        <div className="mb-2 text-sm">Reading from:</div>
        <code className="block break-all rounded-md bg-background px-3 py-2 font-mono text-sm">
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
    <div className="space-y-3">
      <h3 className="font-semibold text-foreground text-lg">
        Status Information
      </h3>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-medium">{fileCount}</span>
          <span>markdown files found</span>
        </div>

        {/* Git Commits Status */}
        {Object.keys(commitsByDate).length > 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="font-medium">
              {Object.keys(commitsByDate).length}
            </span>
            <span>days with commits (loaded on-demand)</span>
          </div>
        )}

        {commitError && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive text-sm">
            <div className="mb-1 font-medium">Git Error</div>
            <div>{commitError}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Loading state component
function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="space-y-4 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-foreground" />
        <div>
          <div className="font-semibold text-foreground text-lg">
            Reading folder metadata...
          </div>
          <div className="mt-2 text-muted-foreground">
            Please wait while we scan for markdown files
          </div>
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
      <DialogContent className="max-h-[85vh] min-w-[66vw] overflow-y-scroll">
        <DialogHeader className="pb-6">
          <DialogTitle className="text-xl">Settings & Information</DialogTitle>
          <DialogDescription className="text-base">
            Manage your folder settings and connected repositories
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8">
          {/* Folder Information */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <FolderInfo folderPath={folderPath} />
          </div>

          {/* Status Information */}
          <div className="rounded-lg border bg-muted/30 p-4">
            {isLoadingMetadata ? (
              <LoadingState />
            ) : (
              <StatusInfo
                fileCount={allFilesMetadata.length}
                commitsByDate={commitsByDate}
                commitError={commitError}
              />
            )}
          </div>

          {/* Repository Connector */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-lg">
                Repository Management
              </h3>
            </div>
            <RepoConnector markdownDirectory={folderPath} className="" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
