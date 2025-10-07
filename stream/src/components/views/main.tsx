"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Footer } from "@/components/footer";
import {
  DateHeader,
  FileCard,
  FileReaderHeader,
  FocusedFileOverlay,
} from "@/components/markdown-file-card";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";
import {
  generateYesterdaySummary,
  getYesterdayDateString,
  getYesterdayMarkdownFileName,
} from "@/utils/ai-summary";
import {
  formatDisplayDate,
  getDateFromFilename,
  getDateKey,
} from "@/utils/date-utils";
import {
  type MarkdownFileMetadata,
  readMarkdownFilesContentByPaths,
} from "@/utils/markdown-reader";
import CommitFilter from "../commit-filter";

interface FileReaderScreenProps {
  folderPath: string;
  onBack: () => void;
}

// Types for grouped items
interface DateHeaderItem {
  type: "header";
  date: string;
  displayDate: string;
}

interface FileItem {
  type: "file";
  file: MarkdownFileMetadata;
  originalIndex: number;
}

type VirtualizedItem = DateHeaderItem | FileItem;

const GIT_COMMIT_REFRESH_INTERVAL = 5000;

function createGroupedItems(files: MarkdownFileMetadata[]): VirtualizedItem[] {
  const filesByDate = new Map<string, MarkdownFileMetadata[]>();

  files.forEach((file) => {
    // Try to get date from filename first, fall back to creation date
    const dateFromFilename = getDateFromFilename(file.fileName);
    const dateStr = dateFromFilename || getDateKey(file.createdAt);

    if (!filesByDate.has(dateStr)) {
      filesByDate.set(dateStr, []);
    }
    filesByDate.get(dateStr)?.push(file);
  });

  const sortedDates = Array.from(filesByDate.keys()).sort((a, b) =>
    b.localeCompare(a),
  );

  const items: VirtualizedItem[] = [];
  let fileIndex = 0;

  sortedDates.forEach((dateStr) => {
    const filesForDate = filesByDate.get(dateStr);
    if (!filesForDate) return;

    const displayDate = formatDisplayDate(dateStr);

    items.push({
      type: "header",
      date: dateStr,
      displayDate,
    });

    filesForDate.forEach((file) => {
      items.push({
        type: "file",
        file,
        originalIndex: fileIndex++,
      });
    });
  });

  return items;
}

export function FileReaderScreen({
  folderPath,
  onBack,
}: FileReaderScreenProps) {
  // Local UI state
  const [showLoading, setShowLoading] = useState(true);
  const [groupedItems, setGroupedItems] = useState<VirtualizedItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );

  // Markdown files state from store
  const allFilesMetadata = useMarkdownFilesStore(
    (state) => state.allFilesMetadata,
  );
  const isLoadingMetadata = useMarkdownFilesStore(
    (state) => state.isLoadingMetadata,
  );
  const error = useMarkdownFilesStore((state) => state.error);

  // Markdown files actions from store
  const loadMetadata = useMarkdownFilesStore((state) => state.loadMetadata);
  const loadFileContent = useMarkdownFilesStore(
    (state) => state.loadFileContent,
  );

  // Git commits state from store
  const loadConnectedReposCount = useGitCommitsStore(
    (state) => state.loadConnectedReposCount,
  );
  const loadCommitsForVisibleFiles = useGitCommitsStore(
    (state) => state.loadCommitsForVisibleFiles,
  );
  const refreshAllCommits = useGitCommitsStore(
    (state) => state.refreshAllCommits,
  );

  // Virtuoso ref for scrolling
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const handleScrollToDate = useCallback(
    (date: Date) => {
      const dateStr = getDateKey(date);
      const index = groupedItems.findIndex(
        (item) => item.type === "header" && item.date === dateStr,
      );

      if (index !== -1 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index,
          align: "start",
          behavior: "auto",
        });
      }
    },
    [groupedItems],
  );

  // Generate AI summary of yesterday's activities
  const handleGenerateSummary = useCallback(async (): Promise<string> => {
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
        const loadedContent = useMarkdownFilesStore.getState().loadedContent;
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
      const yesterdayCommits = commitsByDate[yesterdayDateStr]?.commits || [];

      // Generate the summary
      const summary = await generateYesterdaySummary(
        markdownContent,
        yesterdayCommits,
      );

      return summary;
    } catch (error) {
      console.error("Error in handleGenerateSummary:", error);
      throw error;
    }
  }, [allFilesMetadata]);

  // Wrap store action for easier use in component
  const handleLoadFileContent = useCallback(
    async (filePath: string) => {
      await loadFileContent(filePath);
    },
    [loadFileContent],
  );

  // Wrap store actions to match component needs
  const handleLoadCommitsForVisibleFiles = useCallback(
    async (visibleFiles: MarkdownFileMetadata[]) => {
      await loadCommitsForVisibleFiles(folderPath, visibleFiles);
    },
    [folderPath, loadCommitsForVisibleFiles],
  );

  const handleRefreshAllCommits = useCallback(async () => {
    const commitsByDate = useGitCommitsStore.getState().commitsByDate;
    const loadedDates = Object.keys(commitsByDate);
    await refreshAllCommits(folderPath, loadedDates);
  }, [folderPath, refreshAllCommits]);

  // Load metadata when component mounts
  useEffect(() => {
    const loadData = async () => {
      const startTime = Date.now();
      setShowLoading(true);

      try {
        // Load markdown files metadata
        await loadMetadata(folderPath);

        // Get metadata and create grouped items
        const metadata = useMarkdownFilesStore.getState().allFilesMetadata;
        const grouped = createGroupedItems(metadata);
        setGroupedItems(grouped);

        // Load connected repos count
        await loadConnectedReposCount(folderPath);
      } finally {
        // Ensure loading screen shows for at least 200ms
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 200 - elapsed);

        setTimeout(() => {
          setShowLoading(false);
        }, remaining);
      }
    };

    loadData();
  }, [folderPath, loadMetadata, loadConnectedReposCount]);

  // Load git commits for initially visible files when metadata is loaded
  useEffect(() => {
    if (!isLoadingMetadata && allFilesMetadata.length > 0) {
      // Load commits for the first few files
      const initialFiles = allFilesMetadata.slice(0, 10);
      handleLoadCommitsForVisibleFiles(initialFiles);
    }
  }, [isLoadingMetadata, allFilesMetadata, handleLoadCommitsForVisibleFiles]);

  // Set up automatic git commit refresh
  useEffect(() => {
    // Only start refreshing if we have loaded some commits
    const commitsByDate = useGitCommitsStore.getState().commitsByDate;
    if (Object.keys(commitsByDate).length === 0) return;

    const intervalId = setInterval(() => {
      handleRefreshAllCommits();
    }, GIT_COMMIT_REFRESH_INTERVAL);

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [handleRefreshAllCommits]);

  // Handle range changes for virtualized list
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      // Get visible items and extract files
      const visibleItems = groupedItems.slice(
        range.startIndex,
        range.endIndex + 1,
      );
      const visibleFiles = visibleItems
        .filter((item): item is FileItem => item.type === "file")
        .map((item) => item.file);

      // Load content for visible files that aren't loaded yet
      const loadedContent = useMarkdownFilesStore.getState().loadedContent;
      visibleFiles.forEach((file) => {
        if (!loadedContent.has(file.filePath)) {
          handleLoadFileContent(file.filePath);
        }
      });

      // Load git commits for visible files
      if (visibleFiles.length > 0) {
        handleLoadCommitsForVisibleFiles(visibleFiles);
      }
    },
    [groupedItems, handleLoadFileContent, handleLoadCommitsForVisibleFiles],
  );

  // Render individual item (header or file)
  const renderItem = useCallback(
    (index: number) => {
      const item = groupedItems[index];
      if (!item) return null;

      // Render date header
      if (item.type === "header") {
        return <DateHeader displayDate={item.displayDate} />;
      }

      // Render file item
      const { file } = item;

      return (
        <FileCard
          file={file}
          onToggleFocus={() =>
            setFocusedFile(
              focusedFile?.filePath === file.filePath ? null : file,
            )
          }
          isFocused={focusedFile?.filePath === file.filePath}
          onGenerateSummary={handleGenerateSummary}
        />
      );
    },
    [groupedItems, focusedFile, handleGenerateSummary],
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Full-screen loading overlay */}
      <div
        className={`absolute inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-500 ${
          showLoading ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <div className="text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          {/* Filter controls on the left */}
          {!isLoadingMetadata && (
            <div className="flex-shrink-0">
              <CommitFilter />
            </div>
          )}

          {/* Navigation buttons on the right */}
          <div className="flex flex-1 justify-end">
            <FileReaderHeader
              folderPath={folderPath}
              onScrollToDate={handleScrollToDate}
            />
          </div>
        </div>
      </div>

      {/* Virtualized List */}
      {!isLoadingMetadata && groupedItems.length > 0 && (
        <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 px-6 pt-16">
          <Virtuoso
            ref={virtuosoRef}
            totalCount={groupedItems.length}
            itemContent={renderItem}
            rangeChanged={handleRangeChanged}
            overscan={2}
            className="h-full"
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoadingMetadata && allFilesMetadata.length === 0 && !error && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="mb-2 font-medium text-lg">
              No markdown files found
            </div>
            <div className="text-sm">
              No .md files were found in the selected folder
            </div>
          </div>
        </div>
      )}

      <Footer
        folderPath={folderPath}
        onFolderClick={onBack}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
      />

      {focusedFile && (
        <FocusedFileOverlay
          file={focusedFile}
          onClose={() => setFocusedFile(null)}
          onGenerateSummary={handleGenerateSummary}
          footerComponent={
            <Footer
              folderPath={folderPath}
              onFolderClick={onBack}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
            />
          }
        />
      )}
    </div>
  );
}

export default FileReaderScreen;
