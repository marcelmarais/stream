"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
    return <div className="h-6 w-full animate-pulse bg-muted" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {connectedRepos.length > 0 ? (
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {connectedRepos.map((repo) => (
            <div
              key={repo}
              className="flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-foreground">
                  {repo.split("/").pop()}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {repo}
                </div>
              </div>
              <Button
                onClick={() => handleRemoveRepo(repo)}
                variant="ghost"
                size="xs"
                className="shrink-0 text-destructive hover:text-destructive"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Connect repositories to see your commits under each day
        </p>
      )}
      <Button
        onClick={handleAddRepo}
        disabled={isAddingRepo}
        variant="outline"
        size="sm"
        className="w-fit"
      >
        {isAddingRepo ? "Connecting..." : "Connect repository"}
      </Button>
    </div>
  );
}

export default RepoConnector;
