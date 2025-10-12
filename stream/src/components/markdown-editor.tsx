"use client";

import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Markdown } from "tiptap-markdown";
import { SlashCommand } from "@/components/slash-command";
import { useAICommands } from "@/hooks/use-ai-commands";
import { formatMarkdown } from "@/utils/markdown-formatter";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onFocus?: () => void;
  autoFocus?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onFocus,
  autoFocus = false,
}: MarkdownEditorProps) {
  const isUpdatingFromProp = useRef(false);
  const isSavingRef = useRef(false);

  // Get AI commands configuration
  const aiCommands = useAICommands();

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Typography,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      Placeholder.configure({
        placeholder: "Start typing...",
      }),
      SlashCommand.configure({
        aiCommands,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none dark:prose-invert focus:outline-none prose-obsidian tiptap",
      },
    },
    onUpdate: ({ editor }) => {
      if (!isUpdatingFromProp.current) {
        // biome-ignore lint/suspicious/noExplicitAny: TipTap markdown storage type not exported
        const storage = editor.storage as any;
        const markdown = storage.markdown.getMarkdown();
        onChange(markdown);
      }
    },
    onFocus: () => {
      onFocus?.();
    },
  });

  useEffect(() => {
    const handleSaveAndFormat = async () => {
      if (isSavingRef.current || !editor) return;

      isSavingRef.current = true;

      const result = await formatMarkdown(value);
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
      onChange(formatted);
      isUpdatingFromProp.current = false;

      await onSave();
      toast.success("Saved successfully", {
        description: "Markdown formatted and saved",
        duration: 1000,
      });

      isSavingRef.current = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Cmd+S (Mac) or Ctrl+S (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        handleSaveAndFormat();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, value, onChange, onSave]);

  useEffect(() => {
    if (editor) {
      // biome-ignore lint/suspicious/noExplicitAny: TipTap markdown storage type not exported
      const storage = editor.storage as any;
      const currentMarkdown = storage.markdown.getMarkdown();
      // Only update if the value is different and we're not already updating
      // Allow updates when focused if they're coming from external sources (like formatting)
      if (value !== currentMarkdown && !isUpdatingFromProp.current) {
        // If editor is focused, we need to preserve cursor position
        const { from, to } = editor.state.selection;
        isUpdatingFromProp.current = true;
        editor.commands.setContent(value);
        // Try to restore cursor position if editor was focused
        if (editor.isFocused) {
          const newDocSize = editor.state.doc.content.size;
          const safeFrom = Math.min(from, newDocSize);
          const safeTo = Math.min(to, newDocSize);
          editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
        }
        isUpdatingFromProp.current = false;
      }
    }
  }, [value, editor]);

  useEffect(() => {
    if (autoFocus && editor) {
      const timer = setTimeout(() => {
        editor.commands.focus("end");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, editor]);

  return (
    <div className="markdown-editor-wrapper pb-12">
      <EditorContent editor={editor} />
    </div>
  );
}
