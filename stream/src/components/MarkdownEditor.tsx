"use client";

import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Markdown } from "tiptap-markdown";
import { formatMarkdown } from "@/utils/markdownFormatter";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void | Promise<void>;
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder = "Start typing...",
  className,
}: MarkdownEditorProps) {
  const isUpdatingFromProp = useRef(false);
  const isSavingRef = useRef(false);

  // Handle save and format
  // biome-ignore lint/correctness/useExhaustiveDependencies: editor is accessed from closure and is stable
  const handleSaveAndFormat = useCallback(async () => {
    if (isSavingRef.current) return;

    isSavingRef.current = true;

    try {
      // Format the markdown
      const result = await formatMarkdown(value);

      if (result.success && result.formatted) {
        // Update editor with formatted content immediately
        if (result.formatted !== value && editor) {
          isUpdatingFromProp.current = true;
          // Update parent state
          onChange(result.formatted);
          // Directly update editor content (don't wait for useEffect)
          editor.commands.setContent(result.formatted);
          isUpdatingFromProp.current = false;
        }

        // Save the file
        if (onSave) {
          await onSave();
          toast.success("Saved successfully", {
            description: "Markdown formatted and saved",
          });
        } else {
          toast.success("Formatted successfully", {
            description: "Markdown has been formatted",
          });
        }
      } else {
        toast.error("Format failed", {
          description: result.error || "Unknown error",
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error("Save failed", {
        description: errorMessage,
      });
    } finally {
      isSavingRef.current = false;
    }
  }, [value, onSave, onChange]);

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
        placeholder,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none dark:prose-invert focus:outline-none prose-obsidian tiptap",
      },
      handleKeyDown: (_view, event) => {
        // Handle Cmd+S (Mac) or Ctrl+S (Windows/Linux)
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          handleSaveAndFormat();
          return true;
        }
        return false;
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

  // Update editor content when value prop changes externally
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
    <div className={`markdown-editor-wrapper pb-12 ${className || ""}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
