import { useMemo } from "react";
import type { AICommand } from "@/components/slash-command";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";
import {
  generateYesterdaySummary,
  getYesterdayDateString,
  getYesterdayMarkdownFileName,
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
        execute: async (): Promise<string> => {
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
              // Check if content is already loaded
              const loadedContent =
                useMarkdownFilesStore.getState().loadedContent;
              const cachedContent = loadedContent.get(yesterdayFile.filePath);
              if (cachedContent !== undefined) {
                markdownContent = cachedContent;
              } else {
                // Load the content
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

            // Generate the summary
            const summary = await generateYesterdaySummary(
              markdownContent,
              yesterdayCommits,
            );

            return summary;
          } catch (error) {
            console.error("Error in generateSummary:", error);
            throw error;
          }
        },
        insertionTemplate: (result) => `## todo\n\n${result}\n\n`,
      },
      // Future AI commands can be added here
    ],
    [allFilesMetadata],
  );
}
