"use client";

import { useQueryClient } from "@tanstack/react-query";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
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
      <button
        type="button"
        className="min-w-[220px] rounded-sm border border-input bg-popover px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground"
        onClick={() => setSettingsOpen(true)}
      >
        Add your API key in <span className="underline">settings</span> to use
        AI features
      </button>
    );

  return (
    <div className="z-50 min-w-[320px] rounded-sm border border-input bg-popover">
      {props.items.length > 0 ? (
        props.items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            className={`flex w-full cursor-default select-none gap-3 px-2.5 py-1.5 text-left outline-none ${
              index === selectedIndex ? "bg-accent" : "hover:bg-accent"
            }`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="text-primary">/{item.title}</span>
            {item.description && (
              <span className="text-muted-foreground">{item.description}</span>
            )}
          </button>
        ))
      ) : (
        <div className="px-2.5 py-1.5 text-muted-foreground">
          No slash commands found
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
