"use client";

import { PackageIcon } from "@phosphor-icons/react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

export function AutoUpdater() {
  const toastIdRef = useRef<string | number | undefined>(undefined);

  const downloadAndInstall = useCallback(async () => {
    try {
      const update = await check();

      if (!update) {
        toast.error("No update available");
        return;
      }

      console.log("Starting background update installation...");

      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            console.log("Download started");
            break;
          case "Progress":
            console.log(
              `Download progress: ${event.data.chunkLength} bytes received`,
            );
            break;
          case "Finished":
            console.log("Download finished");
            break;
        }
      });

      toast.success("Update installed! Restarting app...", {
        position: "bottom-left",
        className: "text-xs",
      });

      // Relaunch the app after a short delay
      setTimeout(async () => {
        await relaunch();
      }, 1500);
    } catch (error) {
      console.error("Failed to download and install update:", error);
      toast.error("Failed to install update. Please try again.", {
        position: "bottom-left",
        className: "text-xs",
      });
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    try {
      const update = await check();

      if (update) {
        console.log(
          `Update available: ${update.version} (current: ${update.currentVersion})`,
        );

        toastIdRef.current = toast(`New version ${update.version} available`, {
          duration: Number.POSITIVE_INFINITY,
          icon: <PackageIcon className="h-4 w-4" />,
          position: "bottom-left",
          className: "text-xs",
          dismissible: true,
          closeButton: true,
          action: {
            label: "Install",
            onClick: () => {
              downloadAndInstall();
            },
          },
        });
      } else {
        console.log("No updates available");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    }
  }, [downloadAndInstall]);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  return null;
}
