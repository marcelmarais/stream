"use client";

import type { Editor } from "@tiptap/react";
import { Extension, ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Instance as TippyInstance } from "tippy.js";
import tippy from "tippy.js";
import { readMarkdownFilesContentByPaths } from "@/ipc/markdown-reader";
import { useApiKeyStore } from "@/stores/api-key-store";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const apiKey = useApiKeyStore.getState().apiKey;

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

  if (!apiKey)
    return (
      <div className="z-50 min-w-[220px] rounded-xl border bg-popover p-1 shadow-xl">
        <div className="flex flex-col gap-2 px-3 py-2 text-muted-foreground">
          <span className="text-xs">
            Configure your API key in settings to use AI features
          </span>
        </div>
      </div>
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
              <span className="font-medium leading-none">{item.title}</span>
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

interface SlashCommandOptions {
  onAIGenerationChange?: (isGenerating: boolean) => void;
}

/**
 * Get available AI commands based on API key configuration
 */
function getAICommands(
  onAIGenerationChange?: (isGenerating: boolean) => void,
): SlashCommandItem[] {
  // const apiKey = useApiKeyStore.getState().apiKey;
  // if (!apiKey) {
  //   return [];
  // }

  return [
    {
      title: "todos",
      description: "Collect yesterday's todos & open points",
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

          // Find yesterday's markdown file
          const allFilesMetadata =
            useMarkdownFilesStore.getState().allFilesMetadata;
          const yesterdayFile = allFilesMetadata.find(
            (file) => file.fileName === yesterdayFileName,
          );

          // Get yesterday's markdown content
          let markdownContent = "";
          if (yesterdayFile) {
            const loadedContent =
              useMarkdownFilesStore.getState().loadedContent;
            const cachedContent = loadedContent.get(yesterdayFile.filePath);
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
          const commitsByDate = useGitCommitsStore.getState().commitsByDate;
          const yesterdayCommits =
            commitsByDate[yesterdayDateStr]?.commits || [];

          const { state } = editor;
          const { doc } = state;
          let loadingPos = -1;

          // Locate loading text position
          doc.descendants((node, pos) => {
            if (node.isText && node.text?.includes(loadingText)) {
              loadingPos = pos;
              return false;
            }
            return true;
          });

          // Replace loading with prefix
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

          // Buffer streaming tokens and flush periodically
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

          // Stream the summary
          await streamYesterdaySummary(
            markdownContent,
            yesterdayCommits,
            (delta) => {
              buffer += delta;
              scheduleFlush();
            },
          );

          // Final flush and suffix
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
          const items = getAICommands(this.options.onAIGenerationChange);
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
