"use client";

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldedRanges } from "@codemirror/language";
import { diff } from "@codemirror/merge";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  collapsedHeadings,
  restoreCollapsedHeadings,
} from "@/components/heading-fold";
import { livePreview } from "@/components/live-preview";
import { skillMenu } from "@/components/skill-menu";
import { cn } from "@/lib/utils";
import { useCollapsedHeadingsStore } from "@/stores/collapsed-headings-store";
import { formatMarkdown } from "@/utils/markdown-formatter";

const externalChange = Annotation.define<boolean>();

// Saves and refetches can hand `value` back after newer keystrokes
const MAX_RECENT_EDITS = 100;

interface MarkdownEditorProps {
  filePath: string;
  folderPath: string;
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void | Promise<void>;
  onDiskChange: (value: string) => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  isActiveEditing?: boolean;
  isEditable: boolean;
}

function diffChange(current: string, next: string) {
  const max = Math.min(current.length, next.length);

  let from = 0;
  while (from < max && current[from] === next[from]) {
    from += 1;
  }

  let suffix = 0;
  while (
    suffix < max - from &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    from,
    to: current.length - suffix,
    insert: next.slice(from, next.length - suffix),
  };
}

/**
 * Formats the note as the smallest set of edits, so the caret stays put and
 * one undo reverts it. Returns the text to save.
 */
async function formatDocument(view: EditorView) {
  const original = view.state.doc.toString();
  let formatted: string;

  try {
    formatted = await formatMarkdown(original);
  } catch (error) {
    console.error("Failed to format note:", error);
    toast.error("Couldn't format note");
    return view.state.doc.toString();
  }

  // Typing that landed while Prettier ran wins over formatting
  if (formatted === original || view.state.doc.toString() !== original) {
    return view.state.doc.toString();
  }

  view.dispatch({
    changes: diff(original, formatted).map((change) => ({
      from: change.fromA,
      to: change.toA,
      insert: formatted.slice(change.fromB, change.toB),
    })),
    annotations: isolateHistory.of("full"),
  });

  return formatted;
}

export function MarkdownEditor({
  filePath,
  folderPath,
  value,
  onChange,
  onSave,
  onDiskChange,
  onFocus,
  autoFocus = false,
  isActiveEditing = false,
  isEditable = true,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef(new Compartment());
  const recentEditsRef = useRef<string[]>([]);
  const callbacksRef = useRef({ onChange, onSave, onDiskChange, onFocus });
  const initialRef = useRef({ filePath, folderPath, value, isEditable });

  useEffect(() => {
    callbacksRef.current = { onChange, onSave, onDiskChange, onFocus };
  }, [onChange, onSave, onDiskChange, onFocus]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: initialRef.current.value,
        extensions: [
          history(),
          markdown({ base: markdownLanguage }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: (target) => {
                void formatDocument(target)
                  .then((doc) => callbacksRef.current.onSave(doc))
                  .then(() => {
                    toast.success("Saved successfully", { duration: 1000 });
                  });
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          placeholder("Start typing..."),
          // First, so an open menu takes Tab before list indenting does
          skillMenu({
            filePath: initialRef.current.filePath,
            folderPath: initialRef.current.folderPath,
            onSave: (doc) => callbacksRef.current.onSave(doc),
            onDiskChange: (doc) => callbacksRef.current.onDiskChange(doc),
          }),
          livePreview(),
          editableRef.current.of(
            EditorView.editable.of(initialRef.current.isEditable),
          ),
          EditorView.domEventHandlers({
            focus: () => {
              callbacksRef.current.onFocus?.();
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            if (
              !update.transactions.some((tr) => tr.annotation(externalChange))
            ) {
              const doc = update.state.doc.toString();
              recentEditsRef.current.push(doc);
              recentEditsRef.current.splice(
                0,
                recentEditsRef.current.length - MAX_RECENT_EDITS,
              );
              callbacksRef.current.onChange(doc);
            }
          }),
          EditorView.updateListener.of((update) => {
            // The card behind focus mode must not overwrite the overlay's folds
            if (
              foldedRanges(update.startState) !== foldedRanges(update.state) &&
              update.state.facet(EditorView.editable)
            ) {
              useCollapsedHeadingsStore
                .getState()
                .setCollapsedHeadings(
                  initialRef.current.filePath,
                  collapsedHeadings(update.view.state),
                );
            }
          }),
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const current = view.state.doc.toString();

    if (value === current || recentEditsRef.current.includes(value)) {
      return;
    }

    recentEditsRef.current = [];
    view.dispatch({
      changes: diffChange(current, value),
      annotations: externalChange.of(true),
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    view.dispatch({
      effects: editableRef.current.reconfigure(
        EditorView.editable.of(isEditable),
      ),
    });

    // Runs on mount, and picks up folds changed in focus mode when it closes
    restoreCollapsedHeadings(
      view,
      useCollapsedHeadingsStore.getState().byFile[
        initialRef.current.filePath
      ] ?? [],
    );
  }, [isEditable]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    const timer = setTimeout(() => {
      const view = viewRef.current;

      if (view) {
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "relative h-full w-full pb-4",
        isActiveEditing && "min-h-[38vh]",
      )}
    >
      <div ref={containerRef} className="min-h-[inherit]" />
    </div>
  );
}
