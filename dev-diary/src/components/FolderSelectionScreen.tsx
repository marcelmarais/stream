"use client";

import { load } from "@tauri-apps/plugin-store";
import { useEffect, useState } from "react";
import FolderPicker from "./FolderPicker";

const STORAGE_KEY = "dev-diary-last-selected-folder";
const STORE_FILE = "settings.json";

interface FolderSelectionScreenProps {
  onFolderConfirmed: (folderPath: string) => void;
}

export function FolderSelectionScreen({
  onFolderConfirmed,
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
        }
        console.log("Loaded saved folder from Tauri Store:", savedFolder);
      } catch (error) {
        console.warn("Failed to load saved folder from Tauri Store:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPersistedFolder();
  }, []);

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
      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
        <div className="rounded-lg border border-border bg-card p-6 shadow-md">
          <div className="animate-pulse text-center text-muted-foreground">
            Loading saved settings...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <div className="rounded-lg border border-border bg-card p-6 shadow-md">
        <h1 className="mb-6 text-center font-bold text-3xl text-foreground">
          Dev Diary
        </h1>

        <div className="mb-8 text-center text-muted-foreground">
          <p className="mb-2">Welcome to your development diary reader.</p>
          <p>Select a folder containing your markdown files to get started.</p>
        </div>

        {/* Folder Picker */}
        <div className="mb-6">
          <div className="mb-3 block font-medium text-foreground text-sm">
            Select Directory
          </div>
          <FolderPicker
            onFolderSelected={handleFolderSelected}
            value={selectedFolder}
            buttonText="Choose Directory"
            placeholder="No directory selected"
            className="w-full"
          />
        </div>

        {/* Continue Button */}
        {selectedFolder && (
          <div className="mt-6">
            <div className="mb-4 rounded-md border border-green-500/20 bg-green-500/10 p-3 text-green-700 dark:text-green-400">
              Selected: {selectedFolder}
            </div>
            <button
              type="button"
              onClick={handleContinue}
              className="w-full rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Continue to File Reader
            </button>
          </div>
        )}

        {selectedFolder && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => handleFolderSelected(null)}
              className="text-muted-foreground text-sm hover:text-foreground"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default FolderSelectionScreen;
