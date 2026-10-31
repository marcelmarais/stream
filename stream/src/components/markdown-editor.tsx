"use client";

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { livePreview } from "@/components/live-preview";
import { cn } from "@/lib/utils";

const externalChange = Annotation.define<boolean>();

// Saves and refetches can hand `value` back after newer keystrokes
const MAX_RECENT_EDITS = 100;

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void | Promise<void>;
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

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onFocus,
  autoFocus = false,
  isActiveEditing = false,
  isEditable = true,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef(new Compartment());
  const recentEditsRef = useRef<string[]>([]);
  const callbacksRef = useRef({ onChange, onSave, onFocus });
  const initialRef = useRef({ value, isEditable });

  useEffect(() => {
    callbacksRef.current = { onChange, onSave, onFocus };
  }, [onChange, onSave, onFocus]);

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
                void Promise.resolve(
                  callbacksRef.current.onSave(target.state.doc.toString()),
                ).then(() => {
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
    viewRef.current?.dispatch({
      effects: editableRef.current.reconfigure(
        EditorView.editable.of(isEditable),
      ),
    });
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
