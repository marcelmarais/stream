"use client";

import type { Editor } from "@tiptap/react";
import { Extension, ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Instance as TippyInstance } from "tippy.js";
import tippy from "tippy.js";

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

  return (
    <div className="z-50 min-w-[220px] rounded-lg border bg-popover p-1 shadow-lg">
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
        <div className="px-3 py-2 text-muted-foreground text-sm">
          No results
        </div>
      )}
    </div>
  );
});

SlashCommandList.displayName = "SlashCommandList";

export interface AICommand {
  title: string;
  description: string;
  execute: () => Promise<string>;
  insertionTemplate?: (result: string) => string;
}

interface SlashCommandOptions {
  aiCommands?: AICommand[];
  onAIGenerationChange?: (isGenerating: boolean) => void;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      aiCommands: [],
      onAIGenerationChange: undefined,
    };
  },

  addProseMirrorPlugins() {
    const aiCommands = this.options.aiCommands || [];
    const onAIGenerationChange = this.options.onAIGenerationChange;

    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        items: ({ query }) => {
          const items: SlashCommandItem[] = [
            // Add AI commands dynamically
            ...aiCommands.map((aiCommand) => ({
              title: aiCommand.title,
              description: aiCommand.description,
              command: async ({
                editor,
                range,
              }: {
                editor: Editor;
                range: { from: number; to: number };
              }) => {
                const loadingText = `Generating ${aiCommand.title}...`;

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
                  const result = await aiCommand.execute();
                  const { state } = editor;
                  const { doc } = state;
                  let loadingPos = -1;

                  // Find the loading text position
                  doc.descendants((node, pos) => {
                    if (node.isText && node.text?.includes(loadingText)) {
                      loadingPos = pos;
                      return false;
                    }
                    return true;
                  });

                  if (loadingPos !== -1) {
                    const insertContent = aiCommand.insertionTemplate
                      ? aiCommand.insertionTemplate(result)
                      : result;

                    editor
                      .chain()
                      .focus()
                      .deleteRange({
                        from: loadingPos,
                        to: loadingPos + loadingText.length,
                      })
                      .insertContent(insertContent)
                      .run();
                  }

                  // Notify that AI generation has completed successfully
                  onAIGenerationChange?.(false);
                } catch (error) {
                  console.error(`Error executing ${aiCommand.title}:`, error);
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
                        : `Failed to generate ${aiCommand.title}`;
                    editor
                      .chain()
                      .focus()
                      .deleteRange({
                        from: loadingPos,
                        to: loadingPos + loadingText.length,
                      })
                      .insertContent(`❌ Error: ${errorMessage}`)
                      .run();
                  }

                  // Notify that AI generation has completed (with error)
                  onAIGenerationChange?.(false);
                }
              },
            })),
            {
              title: "today",
              description: "Insert today's date",
              command: ({ editor, range }) => {
                const today = new Date().toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                });
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent(today)
                  .run();
              },
            },
          ];

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
