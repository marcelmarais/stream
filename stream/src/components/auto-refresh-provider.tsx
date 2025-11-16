"use client";

import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useUserStore } from "@/stores/user-store";

/**
 * Global auto-refresh provider that listens for refresh events
 * and automatically refreshes files that need it.
 * Works across all pages as long as a folder path is set.
 */
export function AutoRefreshProvider() {
  const folderPath = useUserStore((state) => state.folderPath);

  // Enable auto-refresh when a folder path is set
  useAutoRefresh(folderPath || "", !!folderPath);

  return null;
}

