import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { formatMarkdown } from "@/utils/markdown-formatter";

/**
 * Hook that handles Cmd/Ctrl+S to save and format markdown
 */
export function useSaveShortcut(
  editor: Editor | null,
  value: string,
  onChange: (value: string) => void,
  onSave: (value: string) => void | Promise<void>,
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

      try {
        // biome-ignore lint/suspicious/noExplicitAny: TipTap markdown storage type not exported
        const storage = editor.storage as any;
        const currentMarkdown = storage.markdown.getMarkdown();
        const result = await formatMarkdown(
          typeof currentMarkdown === "string"
            ? currentMarkdown
            : valueRef.current,
        );
        const formatted = result.formatted;

        if (!formatted) {
          return;
        }

        // Update the editor content directly, preserving cursor position
        const { from, to } = editor.state.selection;

        isUpdatingFromProp.current = true;
        editor.commands.setContent(formatted, { emitUpdate: false });

        // Restore cursor position
        const newDocSize = editor.state.doc.content.size;
        const safeFrom = Math.min(from, newDocSize);
        const safeTo = Math.min(to, newDocSize);
        editor.commands.setTextSelection({ from: safeFrom, to: safeTo });

        // Update the store
        onChangeRef.current(formatted);
        isUpdatingFromProp.current = false;

        await onSaveRef.current(formatted);
        toast.success("Saved successfully", {
          description: "Markdown formatted and saved",
          duration: 1000,
        });
      } finally {
        isUpdatingFromProp.current = false;
        isSavingRef.current = false;
      }
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
