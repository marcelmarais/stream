"use client";

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect } from "react";
import { useStatusStore } from "@/stores/status-store";

const RESTART_DELAY_MS = 1500;

async function installUpdate(version: string) {
  const { setUpdate } = useStatusStore.getState();
  setUpdate({ phase: "installing", version });

  try {
    const update = await check();

    if (!update) {
      throw new Error("No update available");
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

    setUpdate({ phase: "restarting", version });

    await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
    await relaunch();
  } catch (error) {
    console.error("Failed to download and install update:", error);
    setUpdate({ phase: "failed", version });
  }
}

/** Has no dismiss, because a skipped prompt means no more updates. */
export function UpdateStatus() {
  const update = useStatusStore((state) => state.update);

  if (!update) {
    return null;
  }

  const { phase, version } = update;

  if (phase === "installing") {
    return <span className="shrink-0">Installing {version}…</span>;
  }

  if (phase === "restarting") {
    return <span className="shrink-0">Restarting…</span>;
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {phase === "failed" ? (
        <span className="text-destructive">Update failed</span>
      ) : (
        <span>New version {version}</span>
      )}
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className="text-primary hover:underline"
        onClick={() => installUpdate(version)}
      >
        {phase === "failed" ? "Retry" : "Install"}
      </button>
    </span>
  );
}

export function AutoUpdater() {
  const setUpdate = useStatusStore((state) => state.setUpdate);

  const checkForUpdates = useCallback(async () => {
    try {
      const update = await check();

      if (update) {
        console.log(
          `Update available: ${update.version} (current: ${update.currentVersion})`,
        );

        setUpdate({ phase: "available", version: update.version });
      } else {
        console.log("No updates available");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    }
  }, [setUpdate]);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  return null;
}
