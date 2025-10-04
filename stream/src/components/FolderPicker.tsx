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
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Opening..." : buttonText}
        </button>

        {selectedFolder && (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md bg-secondary px-3 py-2 text-secondary-foreground text-sm transition-colors hover:bg-secondary/80"
          >
            Clear
          </button>
        )}
      </div>

      <div className="min-h-[2.5rem] rounded-md border border-border bg-muted p-3">
        {selectedFolder ? (
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-sm dark:text-green-400">
              📁
            </span>
            <span className="break-all font-mono text-foreground text-sm">
              {selectedFolder}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm italic">
            {placeholder}
          </span>
        )}
      </div>
    </div>
  );
}

export default FolderPicker;
