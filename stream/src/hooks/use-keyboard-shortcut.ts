import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { formatMarkdown } from "@/utils/markdown-formatter";

/**
 * Hook that debounces a value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook that handles Cmd/Ctrl+S to save and format markdown
 */
export function useSaveShortcut(
  editor: Editor | null,
  value: string,
  onChange: (value: string) => void,
  onSave: () => void | Promise<void>,
  isUpdatingFromProp: React.MutableRefObject<boolean>,
) {
  const isSavingRef = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [value, onChange, onSave]);

  useEffect(() => {
    const handleSaveAndFormat = async () => {
      if (isSavingRef.current || !editor || !editor.isFocused) return;

      isSavingRef.current = true;

      const result = await formatMarkdown(valueRef.current);
      const formatted = result.formatted;

      if (!formatted) {
        isSavingRef.current = false;
        return;
      }

      // Update the editor content directly, preserving cursor position
      const { from, to } = editor.state.selection;

      isUpdatingFromProp.current = true;
      editor.commands.setContent(formatted);

      // Restore cursor position
      const newDocSize = editor.state.doc.content.size;
      const safeFrom = Math.min(from, newDocSize);
      const safeTo = Math.min(to, newDocSize);
      editor.commands.setTextSelection({ from: safeFrom, to: safeTo });

      // Update the store
      onChangeRef.current(formatted);
      isUpdatingFromProp.current = false;

      await onSaveRef.current();
      toast.success("Saved successfully", {
        description: "Markdown formatted and saved",
        duration: 1000,
      });

      isSavingRef.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        handleSaveAndFormat();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, isUpdatingFromProp]);
}

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
