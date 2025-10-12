import { useMemo } from "react";
import type { AICommand } from "@/components/slash-command";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";
import {
  getYesterdayDateString,
  getYesterdayMarkdownFileName,
  streamYesterdaySummary,
} from "@/utils/ai";
import { readMarkdownFilesContentByPaths } from "@/utils/markdown-reader";

export function useAICommands(): AICommand[] {
  const allFilesMetadata = useMarkdownFilesStore(
    (state) => state.allFilesMetadata,
  );

  return useMemo(
    () => [
      {
        title: "todos",
        description: "Collect yesterday's todos & open points",
        executeStream: async (onToken) => {
          try {
            // Get yesterday's date and filename
            const yesterdayDateStr = getYesterdayDateString();
            const yesterdayFileName = getYesterdayMarkdownFileName();

            // Find yesterday's markdown file
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

            // Stream the summary
            await streamYesterdaySummary(
              markdownContent,
              yesterdayCommits,
              onToken,
            );
          } catch (error) {
            console.error("Error in streamSummary:", error);
            throw error;
          }
        },
        streamingPrefix: "## todo\n\n",
        streamingSuffix: "\n\n",
      },
      // Future AI commands can be added here
    ],
    [allFilesMetadata],
  );
}
