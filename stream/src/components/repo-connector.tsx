"use client";

import {
  CircleNotchIcon,
  FolderIcon,
  FolderPlusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useAddRepo,
  useConnectedRepos,
  useRemoveRepo,
} from "@/hooks/use-git-queries";

export interface RepoMapping {
  markdownDirectory: string;
  codeDirectories: string[];
}

interface RepoConnectorProps {
  markdownDirectory: string;
}

export function RepoConnector({ markdownDirectory }: RepoConnectorProps) {
  const [isAddingRepo, setIsAddingRepo] = useState(false);

  const { data: connectedRepos = [], isLoading } =
    useConnectedRepos(markdownDirectory);
  const addRepoMutation = useAddRepo(markdownDirectory);
  const removeRepoMutation = useRemoveRepo(markdownDirectory);

  const handleAddRepo = async () => {
    setIsAddingRepo(true);

    const folderPath = await open({
      directory: true,
      multiple: false,
      title: "Select Code Repository",
    });

    if (folderPath && typeof folderPath === "string") {
      await addRepoMutation.mutateAsync(folderPath);
    }
    setIsAddingRepo(false);
  };

  const handleRemoveRepo = async (repoPath: string) => {
    try {
      await removeRepoMutation.mutateAsync(repoPath);
    } catch (error) {
      console.error("Error removing repository:", error);
      toast.error("Failed to remove repository");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {connectedRepos.length > 0 ? (
        <div className="space-y-2">
          <ScrollArea className="mb-4 max-h-64 overflow-y-scroll">
            <div className="space-y-1">
              {connectedRepos.map((repo, index) => (
                <Fragment key={repo}>
                  <div className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-muted/50">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm">
                          {repo.split("/").pop()}
                        </div>
                        <div className="truncate text-muted-foreground text-xs">
                          {repo}
                        </div>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleRemoveRepo(repo)}
                      variant="ghost"
                      size="sm"
                      className="ml-2 shrink-0 text-destructive text-xs hover:bg-destructive/10 hover:text-destructive"
                    >
                      Remove
                    </Button>
                  </div>
                  {index !== connectedRepos.length - 1 && <Separator />}
                </Fragment>
              ))}
            </div>
          </ScrollArea>

          <div className="flex justify-center">
            <Button
              onClick={handleAddRepo}
              disabled={isAddingRepo}
              variant="outline"
              size="sm"
              className="cursor-pointer rounded-full"
            >
              {isAddingRepo ? (
                <CircleNotchIcon className="size-3 animate-spin" />
              ) : (
                <PlusIcon className="size-3" />
              )}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleAddRepo}
          disabled={isAddingRepo}
          className="mb-4 w-full cursor-pointer rounded-lg border border-muted-foreground/25 border-dashed py-15 text-center transition-colors hover:border-muted-foreground/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <div className="flex flex-col items-center">
            {isAddingRepo ? (
              <CircleNotchIcon className="mx-auto size-8 animate-spin text-muted-foreground/50" />
            ) : (
              <FolderPlusIcon className="mx-auto size-8 text-muted-foreground" />
            )}
            <div className="mt-3 text-muted-foreground text-sm">
              No Git repositories connected
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              Connect repositories to link your markdown notes with your commits
            </div>
          </div>
        </Button>
      )}
    </div>
  );
}

export default RepoConnector;
