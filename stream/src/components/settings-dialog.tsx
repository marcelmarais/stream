"use client";

import { FolderOpen, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import RepoConnector from "@/components/repo-connector";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CommitsByDate } from "@/utils/git-reader";
import type { MarkdownFileMetadata } from "@/utils/markdown-reader";

interface SettingsDialogProps {
  folderPath: string;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function OverviewCard({
  folderPath,
  fileCount,
  isLoading,
}: {
  folderPath: string;
  fileCount: number;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="size-5" />
          Overview
        </CardTitle>
        <CardDescription>Folder information and statistics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm">Reading from:</div>
          <code className="block break-all rounded-md bg-muted px-0.5 py-1 font-mono text-xs">
            {folderPath}
          </code>
        </div>
        <div className="flex items-center gap-2 pt-2 text-muted-foreground">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              <span>Scanning for markdown files...</span>
            </div>
          ) : (
            <>
              <span className="font-semibold text-foreground text-xs">
                {fileCount}
              </span>
              <span className="text-muted-foreground text-xs">
                markdown files found
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsDialog({
  folderPath,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate: _commitsByDate,
  commitError: _commitError,
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const [fetchReposFn, setFetchReposFn] = useState<
    (() => Promise<void>) | null
  >(null);
  const [isFetching, setIsFetching] = useState(false);

  const handleFetchRepos = async () => {
    if (fetchReposFn) {
      setIsFetching(true);
      await fetchReposFn();
      setIsFetching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-[90vw] overflow-y-scroll lg:max-w-[50vw]">
        <DialogHeader className="pb-6">
          <DialogTitle className="text-2xl">Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <OverviewCard
            folderPath={folderPath}
            fileCount={allFilesMetadata.length}
            isLoading={isLoadingMetadata}
          />

          <Card className="pb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-5" />
                Connect Git Repositories
              </CardTitle>
              <CardDescription>
                Show your commits with your notes
              </CardDescription>
              {fetchReposFn && (
                <CardAction>
                  <Button
                    onClick={handleFetchRepos}
                    disabled={isFetching}
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Git fetch all repositories"
                  >
                    {isFetching ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              <RepoConnector
                key={folderPath}
                markdownDirectory={folderPath}
                onFetchRepos={(fn) => setFetchReposFn(() => fn)}
              />
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
