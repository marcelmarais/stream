import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { markdownKeys } from "@/hooks/use-markdown-queries";
import { getFilesNeedingRefresh, mockRefreshFile } from "@/ipc/markdown-reader";
import { useRefreshStore } from "@/stores/refresh-store";

/**
 * Hook that listens for the "check-for-refresh" event from Rust
 * and automatically refreshes files that need it.
 *
 * @param folderPath - The base folder path to check for files needing refresh
 * @param enabled - Whether auto-refresh is enabled (default: true)
 */
export function useAutoRefresh(folderPath: string, enabled = true) {
  const queryClient = useQueryClient();
  const {
    startRefreshing,
    finishRefreshing,
    setLastRefreshCheck,
    getRefreshingFile,
  } = useRefreshStore();

  useEffect(() => {
    if (!enabled || !folderPath) return;

    let unlisten: (() => void) | undefined;
    let isProcessing = false;

    const setupListener = async () => {
      // Listen for the check-for-refresh event from Rust
      unlisten = await listen("check-for-refresh", async () => {
        // Prevent concurrent refresh cycles
        if (isProcessing) {
          console.log("Skipping refresh check - previous cycle still running");
          return;
        }

        try {
          isProcessing = true;

          // Update last check timestamp
          setLastRefreshCheck(Date.now());

          // Get files that need refresh
          const filesToRefresh = await getFilesNeedingRefresh(folderPath);

          if (filesToRefresh.length === 0) return;

          // Filter out files already being refreshed (from manual refresh)
          const filesToProcess = filesToRefresh.filter(
            (filePath) => !getRefreshingFile(filePath),
          );

          if (filesToProcess.length === 0) {
            console.log(
              "All files needing refresh are already being refreshed",
            );
            return;
          }

          // Refresh all files in parallel
          await Promise.all(
            filesToProcess.map(async (filePath) => {
              try {
                startRefreshing(filePath);
                await mockRefreshFile(filePath);
                finishRefreshing(filePath);

                // Invalidate queries to update UI with new content
                queryClient.invalidateQueries({
                  queryKey: markdownKeys.content(filePath),
                });
              } catch (error) {
                console.error(`Failed to auto-refresh ${filePath}:`, error);
                finishRefreshing(filePath);
              }
            }),
          );

          // Invalidate structured files list once after all refreshes complete
          queryClient.invalidateQueries({
            queryKey: markdownKeys.structuredFiles(folderPath),
          });
        } catch (error) {
          console.error("Error during auto-refresh check:", error);
        } finally {
          isProcessing = false;
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    folderPath,
    enabled,
    startRefreshing,
    finishRefreshing,
    setLastRefreshCheck,
    getRefreshingFile,
    queryClient,
  ]);
}
