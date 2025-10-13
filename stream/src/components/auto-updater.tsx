"use client";

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AutoUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string>("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const checkForUpdates = useCallback(async () => {
    try {
      const update = await check();

      if (update) {
        console.log(
          `Update available: ${update.version} (current: ${update.currentVersion})`,
        );
        setUpdateVersion(update.version);
        setUpdateAvailable(true);
      } else {
        console.log("No updates available");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    }
  }, []);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  async function downloadAndInstall() {
    try {
      setIsDownloading(true);
      const update = await check();

      if (!update?.available) {
        toast.error("No update available");
        setIsDownloading(false);
        return;
      }

      toast.info("Downloading update...");

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            console.log("Download started");
            contentLength = event.data.contentLength || 0;
            setDownloadProgress(0);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              const progress = (downloaded / contentLength) * 100;
              setDownloadProgress(progress);
              console.log(`Download progress: ${progress.toFixed(2)}%`);
            }
            break;
          case "Finished":
            console.log("Download finished");
            setDownloadProgress(100);
            break;
        }
      });

      toast.success("Update installed! Restarting app...");

      // Relaunch the app after a short delay
      setTimeout(async () => {
        await relaunch();
      }, 1000);
    } catch (error) {
      console.error("Failed to download and install update:", error);
      toast.error("Failed to install update. Please try again.");
      setIsDownloading(false);
    }
  }

  function dismissUpdate() {
    setUpdateAvailable(false);
  }

  return (
    <Dialog open={updateAvailable} onOpenChange={setUpdateAvailable}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Available</DialogTitle>
          <DialogDescription>
            A new version ({updateVersion}) is available. Would you like to
            download and install it now?
          </DialogDescription>
        </DialogHeader>

        {isDownloading && (
          <div className="py-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="mt-2 text-center text-sm text-stone-500">
              {downloadProgress < 100
                ? `Downloading... ${downloadProgress.toFixed(0)}%`
                : "Installing..."}
            </p>
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={dismissUpdate}
            disabled={isDownloading}
          >
            Later
          </Button>
          <Button onClick={downloadAndInstall} disabled={isDownloading}>
            {isDownloading ? "Installing..." : "Update Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
