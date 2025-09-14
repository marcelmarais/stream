"use client";

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useState } from "react";

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
      <div className={`rounded-lg bg-white p-4 shadow-sm ${className}`}>
        <div className="animate-pulse text-center text-gray-600 text-sm">
          Loading connected repositories...
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg bg-white p-4 shadow-sm ${className}`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-gray-700 text-sm">🔗</span>
          <h3 className="font-medium text-gray-800 text-sm">
            Connected Code Repositories
          </h3>
          {connectedRepos.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700 text-xs">
              {connectedRepos.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowConnector(!showConnector)}
          className="text-gray-500 text-xs hover:text-gray-700"
        >
          {showConnector ? "Hide" : "Manage"}
        </button>
      </div>

      {/* Connected Repos Summary (always visible) */}
      {connectedRepos.length > 0 && !showConnector && (
        <div className="space-y-1">
          {connectedRepos.slice(0, 2).map((repo) => (
            <div key={repo} className="text-gray-600 text-xs">
              📁 {repo.split("/").pop()}
            </div>
          ))}
          {connectedRepos.length > 2 && (
            <div className="text-gray-500 text-xs">
              +{connectedRepos.length - 2} more...
            </div>
          )}
        </div>
      )}

      {/* No repos connected message */}
      {connectedRepos.length === 0 && !showConnector && (
        <div className="text-gray-500 text-xs italic">
          No code repositories connected
        </div>
      )}

      {/* Full Connector Interface */}
      {showConnector && (
        <div className="space-y-4">
          {/* Add Repository Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddRepo}
              disabled={isAddingRepo}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAddingRepo ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                  Adding...
                </>
              ) : (
                <>
                  <span>+</span>
                  Connect Repository
                </>
              )}
            </button>

            {connectedRepos.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleFetchRepos}
                  disabled={isFetching}
                  className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isFetching ? (
                    <>
                      <div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      Git Fetch All
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleClearAllRepos}
                  className="rounded-md bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600"
                >
                  Clear All
                </button>
              </>
            )}
          </div>

          {/* Fetch Results */}
          {showFetchResults && fetchResults.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-700 text-sm">
                  Fetch Results:
                </div>
                <button
                  type="button"
                  onClick={() => setShowFetchResults(false)}
                  className="text-gray-500 text-xs hover:text-gray-700"
                >
                  Hide
                </button>
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {fetchResults.map((result) => (
                  <div
                    key={result.repo_path}
                    className={`rounded-md border p-2 text-xs ${
                      result.success
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    <div className="font-medium">
                      {result.repo_path.split("/").pop()}
                    </div>
                    <div className="mt-1">{result.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connected Repositories List */}
          {connectedRepos.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium text-gray-700 text-sm">
                Connected Repositories:
              </div>
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {connectedRepos.map((repo) => (
                  <div
                    key={repo}
                    className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="text-green-600 text-sm">📁</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-gray-800 text-sm">
                          {repo.split("/").pop()}
                        </div>
                        <div className="truncate font-mono text-gray-500 text-xs">
                          {repo}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveRepo(repo)}
                      className="ml-2 flex-shrink-0 rounded-md bg-red-500 px-2 py-1 text-white text-xs transition-colors hover:bg-red-600"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {connectedRepos.length === 0 && (
            <div className="rounded-md border-2 border-gray-300 border-dashed p-6 text-center">
              <div className="text-gray-400 text-sm">
                No code repositories connected
              </div>
              <div className="mt-1 text-gray-400 text-xs">
                Connect repositories to link your markdown notes with your code
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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
