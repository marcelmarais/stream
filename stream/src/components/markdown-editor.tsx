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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  livePreview,
  type SlashMenuState,
  slashMenu,
} from "@/components/live-preview";
import {
  loadYesterdayContext,
  SlashCommandList,
  type SlashCommandListHandle,
  type SlashMenuItem,
  useSlashCommandData,
} from "@/components/slash-command";
import { cn } from "@/lib/utils";
import { streamYesterdaySummary } from "@/utils/ai";

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

const SLASH_COMMANDS: SlashMenuItem[] = [
  { title: "todos", description: "collect yesterday's open points" },
];

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
  const streamPosRef = useRef<number | null>(null);
  const recentEditsRef = useRef<string[]>([]);
  const slashListRef = useRef<SlashCommandListHandle>(null);
  const callbacksRef = useRef({ onChange, onSave, onFocus });
  const initialRef = useRef({ value, isEditable });
  const [slash, setSlash] = useState<SlashMenuState | null>(null);
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const slashCommandData = useSlashCommandData();

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
          slashMenu(
            setSlash,
            (event) => slashListRef.current?.onKeyDown({ event }) ?? false,
          ),
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

            if (streamPosRef.current !== null) {
              streamPosRef.current = update.changes.mapPos(
                streamPosRef.current,
                1,
              );
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

  const runTodos = async (from: number, to: number) => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const heading = "## todo\n\n";

    const insertAtStream = (text: string) => {
      if (viewRef.current === view && streamPosRef.current !== null) {
        view.dispatch({
          changes: { from: streamPosRef.current, insert: text },
        });
      }
    };

    setIsAIGenerating(true);
    view.dispatch({
      changes: { from, to, insert: heading },
      selection: { anchor: from + heading.length },
    });
    streamPosRef.current = from + heading.length;

    try {
      const { markdownContent, commits } =
        await loadYesterdayContext(slashCommandData);

      let buffer = "";
      let flushTimer: number | null = null;
      const flush = () => {
        if (buffer) {
          insertAtStream(buffer);
          buffer = "";
        }
      };

      await streamYesterdaySummary(markdownContent, commits, (delta) => {
        buffer += delta;
        if (flushTimer === null) {
          flushTimer = window.setTimeout(() => {
            flush();
            flushTimer = null;
          }, 60);
        }
      });

      flush();
      insertAtStream("\n\n");
    } catch (error) {
      console.error("Error executing todos:", error);
      const message =
        error instanceof Error ? error.message : "Failed to generate todos";
      insertAtStream(`❌ Error: ${message}`);
    } finally {
      streamPosRef.current = null;
      setIsAIGenerating(false);
    }
  };

  const slashItems = slash
    ? SLASH_COMMANDS.filter((item) =>
        item.title.toLowerCase().startsWith(slash.query.toLowerCase()),
      )
    : [];

  return (
    <div
      className={cn(
        "relative h-full w-full pb-4",
        isActiveEditing && "min-h-[38vh]",
        isAIGenerating && "animate-pulse",
      )}
    >
      <div ref={containerRef} className="min-h-[inherit]" />

      {slash &&
        createPortal(
          // biome-ignore lint/a11y/noStaticElementInteractions: keeps editor focus while clicking the menu
          <div
            className="fixed z-50"
            style={{ left: slash.left, top: slash.top }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <SlashCommandList
              ref={slashListRef}
              items={slashItems}
              command={() => runTodos(slash.from, slash.to)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
