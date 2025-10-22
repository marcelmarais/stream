"use client";

import { GearIcon } from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import { Extension, ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Instance as TippyInstance } from "tippy.js";
import tippy from "tippy.js";
import { Button } from "@/components/ui/button";
import { useApiKey } from "@/hooks/use-user-data";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { readMarkdownFilesContentByPaths } from "@/ipc/markdown-reader";
import { useUserStore } from "@/stores/user-store";
import {
  getYesterdayDateString,
  getYesterdayMarkdownFileName,
  streamYesterdaySummary,
} from "@/utils/ai";

interface SlashCommandItem {
  title: string;
  description?: string;
  command: (props: {
    editor: Editor;
    range: { from: number; to: number };
  }) => void;
}

interface SlashCommandProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

const SlashCommandList = forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  SlashCommandProps
>((props, ref) => {
  const setSettingsOpen = useUserStore((state) => state.setSettingsOpen);
  const settingsOpen = useUserStore((state) => state.settingsOpen);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { data: apiKey } = useApiKey();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items.length]);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      props.command(item);
    }
  };

  const upHandler = () => {
    setSelectedIndex(
      (selectedIndex + props.items.length - 1) % props.items.length,
    );
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }

      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }

      if (event.key === "Enter") {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  if (settingsOpen) return null;

  if (!apiKey)
    return (
      <Button
        variant="outline"
        className="min-w-[220px] cursor-pointer gap-2 rounded-xl border bg-popover p-4 text-muted-foreground text-xs"
        onClick={() => setSettingsOpen(true)}
      >
        <GearIcon className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          Configure your API key in{" "}
          <span className="font-semibold underline">settings</span> to use AI
          features
        </span>
      </Button>
    );

  return (
    <div className="z-50 min-w-[220px] rounded-xl border bg-popover p-1 shadow-xl">
      {props.items.length > 0 ? (
        props.items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            className={`relative flex w-full cursor-default select-none items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors ${
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground hover:bg-accent/50 hover:text-accent-foreground"
            }`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="flex flex-col items-start gap-0.5">
              <span className="font-semibold text-xs leading-none">
                {item.title}
              </span>
              {item.description && (
                <span className="text-muted-foreground text-xs leading-none">
                  {item.description}
                </span>
              )}
            </div>
          </button>
        ))
      ) : (
        <div className="flex flex-col gap-2 px-3 py-2 text-muted-foreground">
          <span className="text-xs">No slash commands found</span>
        </div>
      )}
    </div>
  );
});

SlashCommandList.displayName = "SlashCommandList";

interface CommitData {
  commits: Array<{
    id: string;
    message: string;
    author_name: string;
    author_email: string;
    timestamp: number;
    date: string;
    repo_path: string;
    files_changed: string[];
    branches: string[];
  }>;
}

interface SlashCommandOptions {
  onAIGenerationChange?: (isGenerating: boolean) => void;
  getMetadata?: () => MarkdownFileMetadata[];
  getContent?: (filePath: string) => string | undefined;
  getFolderPath?: () => string;
  getCommitsForDate?: (dateKey: string) => CommitData | undefined;
}

/**
 * Get available AI commands based on API key configuration
 */
function getAICommands(
  onAIGenerationChange?: (isGenerating: boolean) => void,
  getMetadata?: () => MarkdownFileMetadata[],
  getContent?: (filePath: string) => string | undefined,
  getCommitsForDate?: (dateKey: string) => CommitData | undefined,
): SlashCommandItem[] {
  return [
    {
      title: "todos",
      description: "collect yesterday's open points",
      command: async ({
        editor,
        range,
      }: {
        editor: Editor;
        range: { from: number; to: number };
      }) => {
        const loadingText = "Generating todos...";

        // Notify that AI generation has started
        onAIGenerationChange?.(true);

        // Show loading indicator
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(loadingText)
          .run();

        try {
          // Get yesterday's date and filename
          const yesterdayDateStr = getYesterdayDateString();
          const yesterdayFileName = getYesterdayMarkdownFileName();

          // Get metadata from the getter function
          const allFilesMetadata = getMetadata?.() || [];
          const yesterdayFile = allFilesMetadata.find(
            (file) => file.fileName === yesterdayFileName,
          );

          // Get yesterday's markdown content
          let markdownContent = "";
          if (yesterdayFile) {
            const cachedContent = getContent?.(yesterdayFile.filePath);
            if (cachedContent !== undefined) {
              markdownContent = cachedContent;
            } else {
              const contentMap = await readMarkdownFilesContentByPaths([
                yesterdayFile.filePath,
              ]);
              markdownContent = contentMap.get(yesterdayFile.filePath) ?? "";
            }
          }

          // Get yesterday's commits
          const yesterdayData = getCommitsForDate?.(yesterdayDateStr);
          const yesterdayCommits = yesterdayData?.commits || [];

          const { state } = editor;
          const { doc } = state;
          let loadingPos = -1;

          doc.descendants((node, pos) => {
            if (node.isText && node.text?.includes(loadingText)) {
              loadingPos = pos;
              return false;
            }
            return true;
          });

          if (loadingPos !== -1) {
            editor
              .chain()
              .focus()
              .deleteRange({
                from: loadingPos,
                to: loadingPos + loadingText.length,
              })
              .insertContent("## todo\n\n")
              .run();
          }

          let buffer = "";
          let flushTimer: number | null = null;
          const flush = () => {
            if (!buffer) return;
            editor.chain().focus().insertContent(buffer).run();
            buffer = "";
          };
          const scheduleFlush = () => {
            if (flushTimer !== null) return;
            flushTimer = window.setTimeout(() => {
              flush();
              flushTimer = null;
            }, 60);
          };

          await streamYesterdaySummary(
            markdownContent,
            yesterdayCommits,
            (delta) => {
              buffer += delta;
              scheduleFlush();
            },
          );

          flush();
          editor.chain().focus().insertContent("\n\n").run();

          // Notify completion
          onAIGenerationChange?.(false);
        } catch (error) {
          console.error("Error executing todos:", error);
          const { state } = editor;
          const { doc } = state;
          let loadingPos = -1;

          doc.descendants((node, pos) => {
            if (node.isText && node.text?.includes(loadingText)) {
              loadingPos = pos;
              return false;
            }
            return true;
          });

          if (loadingPos !== -1) {
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to generate todos";
            editor
              .chain()
              .focus()
              .deleteRange({
                from: loadingPos,
                to: loadingPos + loadingText.length,
              })
              .insertContent(`❌ Error: ${errorMessage}`)
              .run();
          } else {
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to generate todos";
            editor
              .chain()
              .focus()
              .insertContent(`\n\n❌ Error: ${errorMessage}`)
              .run();
          }

          onAIGenerationChange?.(false);
        }
      },
    },
  ];
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onAIGenerationChange: undefined,
      getMetadata: undefined,
      getContent: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        items: ({ query }) => {
          const items = getAICommands(
            this.options.onAIGenerationChange,
            this.options.getMetadata,
            this.options.getContent,
            this.options.getCommitsForDate,
          );
          return items.filter((item) =>
            item.title.toLowerCase().startsWith(query.toLowerCase()),
          );
        },
        render: () => {
          let component: ReactRenderer<
            { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
            SlashCommandProps
          >;
          let popup: TippyInstance[];

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                animation: "shift-away",
                duration: [200, 150],
                inertia: true,
                maxWidth: "none",
                arrow: false,
                theme: "slash-command",
              });
            },
            onUpdate(props) {
              component.updateProps(props);

              if (!props.clientRect) {
                return;
              }

              popup[0].setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },
            onKeyDown(props) {
              if (props.event.key === "Escape") {
                popup[0].hide();
                return true;
              }

              return component.ref?.onKeyDown(props) ?? false;
            },
            onExit() {
              popup[0].destroy();
              component.destroy();
            },
          };
        },
      } as SuggestionOptions),
    ];
  },
});
