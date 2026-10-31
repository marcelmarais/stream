import { useEffect } from "react";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";

/**
 * Hook that handles Cmd/Ctrl+O to toggle focused file overlay
 */
export function useToggleFocusShortcut(
  activeEditingFile: MarkdownFileMetadata | null,
  focusedFile: MarkdownFileMetadata | null,
  setFocusedFile: (file: MarkdownFileMetadata | null) => void,
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "o") {
        event.preventDefault();
        if (focusedFile && activeEditingFile) {
          setFocusedFile(null);
        }
        if (activeEditingFile && !focusedFile) {
          setFocusedFile(activeEditingFile);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeEditingFile, focusedFile, setFocusedFile]);
}

/**
 * Hook that handles Cmd/Ctrl+F to toggle search panel
 */
export function useSearchShortcut(
  showSearch: boolean,
  setShowSearch: (show: boolean) => void,
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        event.preventDefault();
        setShowSearch(!showSearch);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSearch, setShowSearch]);
}
