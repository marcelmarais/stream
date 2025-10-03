"use client";

import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Start typing...",
  className,
}: MarkdownEditorProps) {
  const isUpdatingFromProp = useRef(false);

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

export default MarkdownEditor;
