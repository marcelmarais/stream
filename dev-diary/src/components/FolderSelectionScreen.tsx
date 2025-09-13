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
        <div className="rounded-lg bg-white p-6 shadow-md">
          <div className="animate-pulse text-center text-gray-600">
            Loading saved settings...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-6 text-center font-bold text-3xl text-gray-800">
          Dev Diary
        </h1>

        <div className="mb-8 text-center text-gray-600">
          <p className="mb-2">Welcome to your development diary reader.</p>
          <p>Select a folder containing your markdown files to get started.</p>
        </div>

        {/* Folder Picker */}
        <div className="mb-6">
          <div className="mb-3 block font-medium text-gray-700 text-sm">
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
            <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-green-700">
              Selected: {selectedFolder}
            </div>
            <button
              type="button"
              onClick={handleContinue}
              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="text-gray-500 text-sm hover:text-gray-700"
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
