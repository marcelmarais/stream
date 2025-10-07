"use client";

import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Markdown } from "tiptap-markdown";
import { formatMarkdown } from "@/utils/markdown-formatter";
import { SlashCommand } from "./slash-command";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onGenerateSummary?: () => Promise<string>;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onGenerateSummary,
}: MarkdownEditorProps) {
  const isUpdatingFromProp = useRef(false);
  const isSavingRef = useRef(false);

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
        onGenerateSummary,
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

      isUpdatingFromProp.current = true;
      onChange(formatted);
      editor.commands.setContent(formatted);
      await onSave();
      toast.success("Saved successfully", {
        description: "Markdown formatted and saved",
        duration: 1000,
      });
      isUpdatingFromProp.current = false;

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
    if (editor && !editor.isFocused) {
      // biome-ignore lint/suspicious/noExplicitAny: TipTap markdown storage type not exported
      const storage = editor.storage as any;
      const currentMarkdown = storage.markdown.getMarkdown();
      if (value !== currentMarkdown) {
        isUpdatingFromProp.current = true;
        editor.commands.setContent(value);
        isUpdatingFromProp.current = false;
      }
    }
  }, [value, editor]);

  return (
    <div className="markdown-editor-wrapper pb-12">
      <EditorContent editor={editor} />
    </div>
  );
}
