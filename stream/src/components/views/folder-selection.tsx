"use client";

import { FolderIcon } from "@phosphor-icons/react";
import { load } from "@tauri-apps/plugin-store";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "stream-last-selected-folder";
const STORE_FILE = "settings.json";

interface FolderSelectionScreenProps {
  onFolderConfirmed: (folderPath: string) => void;
  autoNavigate?: boolean;
}

export function FolderSelectionScreen({
  onFolderConfirmed,
  autoNavigate = true,
}: FolderSelectionScreenProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load persisted folder after component mounts (client-side only)
  useEffect(() => {
    const loadPersistedFolder = async () => {
      try {
        const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
        const savedFolder = await store.get<string>(STORAGE_KEY);
        if (savedFolder) {
          setSelectedFolder(savedFolder);
          // Auto-navigate to the persisted folder only if autoNavigate is true
          if (autoNavigate) {
            onFolderConfirmed(savedFolder);
          }
        }
        console.log("Loaded saved folder from Tauri Store:", savedFolder);
      } catch (error) {
        console.warn("Failed to load saved folder from Tauri Store:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPersistedFolder();
  }, [onFolderConfirmed, autoNavigate]);

  const handleFolderSelected = async (folderPath: string | null) => {
    setSelectedFolder(folderPath);

    // Persist the selected folder to Tauri Store
    try {
      const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
      if (folderPath) {
        await store.set(STORAGE_KEY, folderPath);
      } else {
        await store.delete(STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save folder to Tauri Store:", error);
    }
  };

  const handleContinue = () => {
    if (selectedFolder) {
      onFolderConfirmed(selectedFolder);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* App Title */}
        <div className="space-y-2">
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            stream.
          </h1>
          <p className="text-muted-foreground text-sm">
            Select a folder to get started
          </p>
        </div>

        {/* Folder Selection */}
        <div className="space-y-4">
          {!selectedFolder ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  const { open } = await import("@tauri-apps/plugin-dialog");
                  const folderPath = await open({
                    directory: true,
                    multiple: false,
                  });

                  if (folderPath && typeof folderPath === "string") {
                    handleFolderSelected(folderPath);
                  }
                } catch (error) {
                  console.error("Error opening folder picker:", error);
                }
              }}
              className="w-full rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            >
              Open Folder
            </button>
          ) : (
            <div className="space-y-3">
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const folderPath = await open({
                      directory: true,
                      multiple: false,
                    });

                    if (folderPath && typeof folderPath === "string") {
                      handleFolderSelected(folderPath);
                    }
                  } catch (error) {
                    console.error("Error opening folder picker:", error);
                  }
                }}
                className="h-auto w-full justify-start rounded-md border border-border bg-muted/50 px-3 py-3 text-muted-foreground text-sm transition-colors hover:bg-muted/70 cursor-pointer"
              >
                <div className="flex w-full items-center gap-3">
                  <FolderIcon className="size-5 flex-shrink-0" />
                  <div className="flex flex-1 flex-col items-center">
                    <div
                      className="truncate font-mono text-foreground"
                      title={selectedFolder}
                    >
                      {selectedFolder}
                    </div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      Click to change
                    </div>
                  </div>
                </div>
              </Button>
              <Button onClick={handleContinue} className="w-full">
                Open
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FolderSelectionScreen;
