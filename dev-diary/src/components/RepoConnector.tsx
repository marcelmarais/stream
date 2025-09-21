"use client";

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import {
  CheckCircle2,
  CircleAlert,
  Folder,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  className?: string;
}

export function RepoConnector({
  markdownDirectory,
  className = "",
}: RepoConnectorProps) {
  const [connectedRepos, setConnectedRepos] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const [showConnector, setShowConnector] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchResults, setFetchResults] = useState<FetchResult[]>([]);
  const [showFetchResults, setShowFetchResults] = useState(false);

  // Load existing repo mappings for this markdown directory
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

  const handleClearAllRepos = async () => {
    setConnectedRepos([]);
    await saveRepoMappings([]);
  };

  const handleFetchRepos = async () => {
    if (connectedRepos.length === 0) return;

    setIsFetching(true);
    setFetchResults([]);
    setShowFetchResults(true);

    try {
      const results: FetchResult[] = await invoke("fetch_repos", {
        repoPaths: connectedRepos,
      });

      setFetchResults(results);

      // Auto-hide results after 10 seconds if all successful
      const allSuccessful = results.every((r) => r.success);
      if (allSuccessful) {
        setTimeout(() => {
          setShowFetchResults(false);
        }, 10000);
      }
    } catch (error) {
      console.error("Error fetching repositories:", error);
      setFetchResults([
        {
          repo_path: "Error",
          success: false,
          message: `Failed to fetch repositories: ${error}`,
        },
      ]);
    } finally {
      setIsFetching(false);
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            <CardTitle className="font-medium text-sm">
              Connected Code Repositories
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Loading repositories…
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-6 w-full animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-muted-foreground" />
          <CardTitle className="font-medium text-sm">
            Connected Code Repositories
          </CardTitle>
          {connectedRepos.length > 0 ? (
            <Badge variant="secondary">{connectedRepos.length}</Badge>
          ) : null}
        </div>
        <CardDescription className="text-xs">
          Link code repositories to this markdown folder
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConnector(!showConnector)}
          >
            {showConnector ? "Hide" : "Manage"}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Summary (when collapsed) */}
        {connectedRepos.length > 0 && !showConnector ? (
          <div className="space-y-2">
            {connectedRepos.slice(0, 2).map((repo) => (
              <div
                key={repo}
                className="flex items-center gap-2 text-muted-foreground text-sm"
              >
                <span className="text-muted-foreground">📁</span>
                <span>{repo.split("/").pop()}</span>
              </div>
            ))}
            {connectedRepos.length > 2 ? (
              <div className="text-muted-foreground text-sm">
                +{connectedRepos.length - 2} more repositories
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Empty (when collapsed) */}
        {connectedRepos.length === 0 && !showConnector ? (
          <div className="py-4 text-center">
            <div className="text-muted-foreground text-sm">
              No code repositories connected
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              Click "Manage" to connect repositories
            </div>
          </div>
        ) : null}

        {/* Full interface (when expanded) */}
        {showConnector ? (
          <div className="space-y-6">
            {/* Primary Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleAddRepo} disabled={isAddingRepo} size="sm">
                {isAddingRepo ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Plus className="size-4" />
                    Connect Repository
                  </>
                )}
              </Button>

              {connectedRepos.length > 0 ? (
                <>
                  <Button
                    onClick={handleFetchRepos}
                    disabled={isFetching}
                    variant="secondary"
                    size="sm"
                  >
                    {isFetching ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Fetching…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-4" />
                        Git Fetch All
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={handleClearAllRepos}
                    variant="destructive"
                    size="sm"
                  >
                    <Trash2 className="size-4" />
                    Clear All
                  </Button>
                </>
              ) : null}
            </div>

            {/* Fetch Results */}
            {showFetchResults && fetchResults.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">Fetch results</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFetchResults(false)}
                  >
                    Hide
                  </Button>
                </div>
                <ScrollArea className="max-h-48 rounded-md border">
                  <div className="space-y-2 p-4">
                    {fetchResults.map((result) => (
                      <div
                        key={result.repo_path}
                        className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3"
                      >
                        {result.success ? (
                          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <CircleAlert className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm">
                            {result.repo_path.split("/").pop()}
                          </div>
                          <div className="mt-0.5 text-muted-foreground text-xs">
                            {result.message}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {/* Connected Repositories */}
            {connectedRepos.length > 0 ? (
              <div className="space-y-2">
                <div className="font-medium text-sm">
                  Connected repositories
                </div>
                <ScrollArea className="max-h-64 overflow-y-scroll rounded-md border">
                  <div className="space-y-2 p-4">
                    {connectedRepos.map((repo) => (
                      <div
                        key={repo}
                        className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Folder className="size-4 shrink-0 text-muted-foreground" />
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
                          className="ml-2 shrink-0 text-destructive"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {/* Empty State */}
            {connectedRepos.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <div className="text-muted-foreground text-sm">
                  No code repositories connected
                </div>
                <div className="mt-1 text-muted-foreground text-xs">
                  Connect repositories to link your markdown notes with your
                  code
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Visual separator when expanded and content exists */}
        {showConnector &&
        (connectedRepos.length > 0 || fetchResults.length > 0) ? (
          <Separator />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default RepoConnector;

// Utility functions for external use
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
