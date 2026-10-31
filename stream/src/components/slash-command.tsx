"use client";

import { GearIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Button } from "@/components/ui/button";
import { gitKeys } from "@/hooks/use-git-queries";
import { markdownKeys } from "@/hooks/use-markdown-queries";
import { useApiKey } from "@/hooks/use-user-data";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { readMarkdownFilesContentByPaths } from "@/ipc/markdown-reader";
import { useUserStore } from "@/stores/user-store";
import {
  getYesterdayDateString,
  getYesterdayMarkdownFileName,
} from "@/utils/ai";

export interface SlashMenuItem {
  title: string;
  description?: string;
}

interface SlashCommandProps {
  items: SlashMenuItem[];
  command: (item: SlashMenuItem) => void;
}

export interface SlashCommandListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<
  SlashCommandListHandle,
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

interface SlashCommandDataSources {
  getMetadata?: () => MarkdownFileMetadata[];
  getContent?: (filePath: string) => string | undefined;
  getCommitsForDate?: (dateKey: string) => CommitData | undefined;
}

/**
 * Query-cache getters for the data slash commands read
 */
export function useSlashCommandData(): SlashCommandDataSources {
  const queryClient = useQueryClient();
  const folderPath = useUserStore((state) => state.folderPath);

  return {
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
      return queryClient.getQueryData<string>(markdownKeys.content(filePath));
    },
    getCommitsForDate: (dateKey: string) => {
      const repos =
        queryClient.getQueryData<string[]>(gitKeys.repos(folderPath || "")) ||
        [];
      return queryClient.getQueryData(
        gitKeys.commits(folderPath || "", dateKey, repos),
      );
    },
  };
}

/**
 * Get yesterday's note and commits, the input for the todos command
 */
export async function loadYesterdayContext({
  getMetadata,
  getContent,
  getCommitsForDate,
}: SlashCommandDataSources) {
  const yesterdayDateStr = getYesterdayDateString();
  const yesterdayFileName = getYesterdayMarkdownFileName();

  const allFilesMetadata = getMetadata?.() || [];
  const yesterdayFile = allFilesMetadata.find(
    (file) => file.fileName === yesterdayFileName,
  );

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

  const yesterdayData = getCommitsForDate?.(yesterdayDateStr);

  return { markdownContent, commits: yesterdayData?.commits || [] };
}
