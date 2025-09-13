"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

interface FolderPickerProps {
  onFolderSelected?: (folderPath: string | null) => void;
  value?: string | null;
  className?: string;
  buttonText?: string;
  placeholder?: string;
}

export function FolderPicker({
  onFolderSelected,
  value = null,
  className = "",
  buttonText = "Select Folder",
  placeholder = "No folder selected",
}: FolderPickerProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(value);
  const [isLoading, setIsLoading] = useState(false);

  // Sync internal state with value prop
  useEffect(() => {
    setSelectedFolder(value);
  }, [value]);

  const handleFolderPick = async () => {
    try {
      setIsLoading(true);

      // Open folder picker dialog
      const folderPath = await open({
        directory: true,
        multiple: false,
      });

      if (folderPath && typeof folderPath === "string") {
        setSelectedFolder(folderPath);
        onFolderSelected?.(folderPath);
      } else {
        // User cancelled the dialog
        onFolderSelected?.(null);
      }
    } catch (error) {
      console.error("Error opening folder picker:", error);
      onFolderSelected?.(null);
    } finally {
      setIsLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedFolder(null);
    onFolderSelected?.(null);
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleFolderPick}
          disabled={isLoading}
          className="rounded-md bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Opening..." : buttonText}
        </button>

        {selectedFolder && (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md bg-gray-500 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-600"
          >
            Clear
          </button>
        )}
      </div>

      <div className="min-h-[2.5rem] rounded-md border border-gray-300 bg-gray-50 p-3">
        {selectedFolder ? (
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-sm">📁</span>
            <span className="break-all font-mono text-gray-700 text-sm">
              {selectedFolder}
            </span>
          </div>
        ) : (
          <span className="text-gray-500 text-sm italic">{placeholder}</span>
        )}
      </div>
    </div>
  );
}

export default FolderPicker;
