"use client";

import {
  CircleNotchIcon,
  FolderIcon,
  FolderPlusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const REPO_MAPPINGS_STORE_FILE = "repo-mappings.json";

export interface RepoMapping {
  markdownDirectory: string;
  codeDirectories: string[];
}

export interface FetchResult {
  repo_path: string;
  success: boolean;
  message: string;
}

interface RepoConnectorProps {
  markdownDirectory: string;
  onFetchRepos?: (fetchFn: () => Promise<void>) => void;
}

export function RepoConnector({
  markdownDirectory,
  onFetchRepos,
}: RepoConnectorProps) {
  const [connectedRepos, setConnectedRepos] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingRepo, setIsAddingRepo] = useState(false);

  useEffect(() => {
    const loadRepoMappings = async () => {
      try {
        const store = await load(REPO_MAPPINGS_STORE_FILE, {
          autoSave: true,
          defaults: {},
        });

        const mappings = await store.get<Record<string, string[]>>("mappings");
        const repos = mappings?.[markdownDirectory] || [];
        setConnectedRepos(repos);
      } catch (error) {
        console.warn("Failed to load repo mappings:", error);
        setConnectedRepos([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadRepoMappings();
  }, [markdownDirectory]);

  // Save repo mappings to persistent store
  const saveRepoMappings = useCallback(
    async (repos: string[]) => {
      try {
        const store = await load(REPO_MAPPINGS_STORE_FILE, {
          autoSave: true,
          defaults: {},
        });

        const existingMappings =
          (await store.get<Record<string, string[]>>("mappings")) || {};

        if (repos.length === 0) {
          delete existingMappings[markdownDirectory];
        } else {
          existingMappings[markdownDirectory] = repos;
        }

        await store.set("mappings", existingMappings);
        console.log("Saved repo mappings:", existingMappings);
      } catch (error) {
        console.error("Failed to save repo mappings:", error);
      }
    },
    [markdownDirectory],
  );

  const handleAddRepo = async () => {
    try {
      setIsAddingRepo(true);

      const folderPath = await open({
        directory: true,
        multiple: false,
        title: "Select Code Repository",
      });

      if (folderPath && typeof folderPath === "string") {
        // Check if repo is already connected
        if (!connectedRepos.includes(folderPath)) {
          const updatedRepos = [...connectedRepos, folderPath];
          setConnectedRepos(updatedRepos);
          await saveRepoMappings(updatedRepos);
        }
      }
    } catch (error) {
      console.error("Error selecting repository:", error);
    } finally {
      setIsAddingRepo(false);
    }
  };

  const handleRemoveRepo = async (repoPath: string) => {
    const updatedRepos = connectedRepos.filter((repo) => repo !== repoPath);
    setConnectedRepos(updatedRepos);
    await saveRepoMappings(updatedRepos);
  };

  const handleFetchRepos = useCallback(async () => {
    if (connectedRepos.length === 0) return;

    try {
      const results: FetchResult[] = await invoke("fetch_repos", {
        repoPaths: connectedRepos,
      });

      // Show toasts for each result
      results.forEach((result) => {
        if (result.success) {
          toast.success(
            `${result.repo_path.split("/").pop()}: ${result.message}`,
          );
        } else {
          toast.error(
            `${result.repo_path.split("/").pop()}: ${result.message}`,
          );
        }
      });
    } catch (error) {
      console.error("Error fetching repositories:", error);
      toast.error(`Failed to fetch repositories: ${error}`);
    }
  }, [connectedRepos]);

  // Expose fetch function to parent
  useEffect(() => {
    if (onFetchRepos && connectedRepos.length > 0) {
      onFetchRepos(handleFetchRepos);
    }
  }, [onFetchRepos, handleFetchRepos, connectedRepos]);

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
                      className="ml-2 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
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

export async function getConnectedRepos(
  markdownDirectory: string,
): Promise<string[]> {
  try {
    const store = await load(REPO_MAPPINGS_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });

    const mappings = await store.get<Record<string, string[]>>("mappings");
    return mappings?.[markdownDirectory] || [];
  } catch (error) {
    console.warn("Failed to get connected repos:", error);
    return [];
  }
}

export async function getAllRepoMappings(): Promise<Record<string, string[]>> {
  try {
    const store = await load(REPO_MAPPINGS_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });

    const mappings = await store.get<Record<string, string[]>>("mappings");
    return mappings || {};
  } catch (error) {
    console.warn("Failed to get all repo mappings:", error);
    return {};
  }
}
