"use client";

import { useQueryClient } from "@tanstack/react-query";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "tiptap-markdown";
import { SlashCommand } from "@/components/slash-command";
import { gitKeys } from "@/hooks/use-git-queries";
import { useSaveShortcut } from "@/hooks/use-keyboard-shortcut";
import { markdownKeys } from "@/hooks/use-markdown-queries";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/user-store";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onFocus?: () => void;
  autoFocus?: boolean;
  isEditable: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onFocus,
  autoFocus = false,
  isEditable = true,
}: MarkdownEditorProps) {
  const isUpdatingFromProp = useRef(false);
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const queryClient = useQueryClient();
  const folderPath = useUserStore((state) => state.folderPath);

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
        onAIGenerationChange: setIsAIGenerating,
        getMetadata: () => {
          const queries = queryClient.getQueriesData({
            queryKey: markdownKeys.all,
          });
          for (const [key, data] of queries) {
            if (key[1] === "metadata" && Array.isArray(data)) {
              return data;
            }
          }
          return [];
        },
        getContent: (filePath: string) => {
          return queryClient.getQueryData<string>(
            markdownKeys.content(filePath),
          );
        },
        getCommitsForDate: (dateKey: string) => {
          const repos =
            queryClient.getQueryData<string[]>(
              gitKeys.repos(folderPath || ""),
            ) || [];
          return queryClient.getQueryData(
            gitKeys.commits(folderPath || "", dateKey, repos),
          );
        },
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
    editable: isEditable,
  });

  useSaveShortcut(editor, value, onChange, onSave, isUpdatingFromProp);

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

  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditable);
    }
  }, [editor, isEditable]);

  return (
    <div
      className={cn(
        "relative h-full w-full pb-4",
        isAIGenerating && "animate-pulse",
      )}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
