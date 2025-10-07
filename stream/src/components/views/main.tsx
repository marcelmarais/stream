"use client";

import { debounce } from "lodash";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import CommitOverlay from "@/components/commit-overlay";
import { Footer } from "@/components/footer";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  DateHeader,
  FileCard,
  FileName,
  FileReaderHeader,
} from "@/components/markdown-file-card";
import { useGitCommitsStore } from "@/stores/git-commits-store";
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
import { filterCommits, getCommitsForDate } from "@/utils/git-reader";
import {
  ensureTodayMarkdownFile,
  type MarkdownFileMetadata,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
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
  // File/content state (keep local for now)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [showLoading, setShowLoading] = useState(true);
  const [allFilesMetadata, setAllFilesMetadata] = useState<
    MarkdownFileMetadata[]
  >([]);
  const [groupedItems, setGroupedItems] = useState<VirtualizedItem[]>([]);
  const [loadedContent, setLoadedContent] = useState<Map<string, string>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [creatingToday, setCreatingToday] = useState<boolean>(false);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );

  // Git commits state from store
  const commitsByDate = useGitCommitsStore((state) => state.commitsByDate);
  const commitFilters = useGitCommitsStore((state) => state.commitFilters);
  const loadConnectedReposCount = useGitCommitsStore(
    (state) => state.loadConnectedReposCount,
  );
  const loadCommitsForVisibleFiles = useGitCommitsStore(
    (state) => state.loadCommitsForVisibleFiles,
  );
  const refreshAllCommits = useGitCommitsStore(
    (state) => state.refreshAllCommits,
  );

  // Keep a ref of commitsByDate to avoid stale closures in async code
  const commitsByDateRef = useRef(commitsByDate);
  useEffect(() => {
    commitsByDateRef.current = commitsByDate;
  }, [commitsByDate]);

  // Virtuoso ref for scrolling
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Create debounced save function
  const debouncedSave = useCallback(
    debounce(async (filePath: string, content: string) => {
      try {
        await writeMarkdownFileContent(filePath, content);
        // Update the loaded content to reflect the saved changes
        setLoadedContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(filePath, content);
          return newMap;
        });
      } catch (error) {
        console.error(`Error saving file ${filePath}:`, error);
      }
    }, 500),
    [],
  );

  // Create immediate save function for Cmd+S
  const handleImmediateSave = useCallback(
    async (filePath: string) => {
      const content = loadedContent.get(filePath);
      if (!content) return;

      try {
        await writeMarkdownFileContent(filePath, content);
        // Update the loaded content to reflect the saved changes
        setLoadedContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(filePath, content);
          return newMap;
        });
      } catch (error) {
        console.error(`Error saving file ${filePath}:`, error);
        throw error; // Re-throw so the editor can show the error
      }
    },
    [loadedContent],
  );

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

  const refreshMetadata = useCallback(async () => {
    setIsLoadingMetadata(true);
    setError(null);
    try {
      const metadata = await readAllMarkdownFilesMetadata(folderPath, {
        maxFileSize: 5 * 1024 * 1024,
      });
      setAllFilesMetadata(metadata);
      const grouped = createGroupedItems(metadata);
      setGroupedItems(grouped);
    } catch (err) {
      setError(`Error reading folder metadata: ${err}`);
    } finally {
      setIsLoadingMetadata(false);
    }
  }, [folderPath]);

  const handleCreateToday = useCallback(async () => {
    if (!folderPath) return;
    setCreatingToday(true);
    try {
      const { filePath } = await ensureTodayMarkdownFile(folderPath);
      // Load content for the new file into cache so it renders immediately
      const contentMap = await readMarkdownFilesContentByPaths([filePath]);
      const content = contentMap.get(filePath) ?? "";
      setLoadedContent((prev) => {
        const map = new Map(prev);
        map.set(filePath, content);
        return map;
      });
      await refreshMetadata();
    } catch (e) {
      console.error("Failed to create today's file:", e);
      setError(`Failed to create today's file: ${e}`);
    } finally {
      setCreatingToday(false);
    }
  }, [folderPath, refreshMetadata]);

  // Handle content changes during editing
  const handleContentChange = useCallback(
    (filePath: string, newContent: string) => {
      // Update state immediately for responsive editing
      setLoadedContent((prev) => {
        const newMap = new Map(prev);
        newMap.set(filePath, newContent);
        return newMap;
      });
      // Debounce the actual file save
      debouncedSave(filePath, newContent);
    },
    [debouncedSave],
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
  }, [allFilesMetadata, loadedContent, commitsByDate]);

  // Load content for files that aren't loaded yet
  const loadFileContent = useCallback(
    async (filePath: string) => {
      if (loadingFiles.has(filePath) || loadedContent.has(filePath)) {
        return;
      }

      setLoadingFiles((prev) => new Set(prev).add(filePath));

      try {
        const contentMap = await readMarkdownFilesContentByPaths([filePath]);
        const content = contentMap.get(filePath);

        if (content !== undefined) {
          setLoadedContent((prev) => {
            const newMap = new Map(prev);
            newMap.set(filePath, content);
            return newMap;
          });
        }
      } catch (err) {
        console.error(`Error loading content for file ${filePath}:`, err);
      } finally {
        setLoadingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(filePath);
          return newSet;
        });
      }
    },
    [loadingFiles, loadedContent],
  );

  // Wrap store actions to match component needs
  const handleLoadCommitsForVisibleFiles = useCallback(
    async (visibleFiles: MarkdownFileMetadata[]) => {
      await loadCommitsForVisibleFiles(folderPath, visibleFiles);
    },
    [folderPath, loadCommitsForVisibleFiles],
  );

  const handleRefreshAllCommits = useCallback(async () => {
    const loadedDates = Object.keys(commitsByDateRef.current);
    await refreshAllCommits(folderPath, loadedDates);
  }, [folderPath, refreshAllCommits]);

  // Load metadata when component mounts
  useEffect(() => {
    const loadMetadata = async () => {
      const startTime = Date.now();
      setIsLoadingMetadata(true);
      setShowLoading(true);
      setError(null);
      setLoadedContent(new Map());

      try {
        const metadata = await readAllMarkdownFilesMetadata(folderPath, {
          maxFileSize: 5 * 1024 * 1024, // 5MB limit
        });

        setAllFilesMetadata(metadata);

        // Create grouped items
        const grouped = createGroupedItems(metadata);
        setGroupedItems(grouped);

        // Load connected repos count
        await loadConnectedReposCount(folderPath);
      } catch (err) {
        setError(`Error reading folder metadata: ${err}`);
      } finally {
        setIsLoadingMetadata(false);

        // Ensure loading screen shows for at least 1 second
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 200 - elapsed);

        setTimeout(() => {
          setShowLoading(false);
        }, remaining);
      }
    };

    loadMetadata();
  }, [folderPath, loadConnectedReposCount]);

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
    if (Object.keys(commitsByDate).length === 0) return;

    const intervalId = setInterval(() => {
      handleRefreshAllCommits();
    }, GIT_COMMIT_REFRESH_INTERVAL);

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [commitsByDate, handleRefreshAllCommits]);

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
      visibleFiles.forEach((file) => {
        if (!loadedContent.has(file.filePath)) {
          loadFileContent(file.filePath);
        }
      });

      // Load git commits for visible files
      if (visibleFiles.length > 0) {
        handleLoadCommitsForVisibleFiles(visibleFiles);
      }
    },
    [
      groupedItems,
      loadedContent,
      loadFileContent,
      handleLoadCommitsForVisibleFiles,
    ],
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
      const content = loadedContent.get(file.filePath);
      const isLoading = !content && loadingFiles.has(file.filePath);

      // Get commits for this file's date (use filename date if available)
      const dateFromFilename = getDateFromFilename(file.fileName);
      const fileDate = dateFromFilename
        ? new Date(dateFromFilename)
        : file.createdAt;
      const allFileCommits = getCommitsForDate(commitsByDate, fileDate);
      const fileCommits = filterCommits(allFileCommits, commitFilters);

      return (
        <FileCard
          file={file}
          content={content}
          isLoading={isLoading}
          commits={fileCommits}
          onContentChange={handleContentChange}
          onSave={handleImmediateSave}
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
    [
      groupedItems,
      loadedContent,
      loadingFiles,
      commitsByDate,
      commitFilters,
      handleContentChange,
      handleImmediateSave,
      focusedFile,
      handleGenerateSummary,
    ],
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
              isLoadingMetadata={isLoadingMetadata}
              allFilesMetadata={allFilesMetadata}
              error={error}
              onCreateToday={handleCreateToday}
              creatingToday={creatingToday}
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
        fileCount={allFilesMetadata.length}
        onFolderClick={onBack}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
      />

      {focusedFile &&
        (() => {
          const dateFromFilename = getDateFromFilename(focusedFile.fileName);
          const dateStr = dateFromFilename || getDateKey(focusedFile.createdAt);
          const displayDate = formatDisplayDate(dateStr);
          const fileDate = dateFromFilename
            ? new Date(dateFromFilename)
            : focusedFile.createdAt;
          const allFileCommits = getCommitsForDate(commitsByDate, fileDate);
          const fileCommits = filterCommits(allFileCommits, commitFilters);

          return (
            <div className="fade-in fixed inset-0 z-50 flex animate-in flex-col bg-background duration-200">
              <div className="mx-auto w-full max-w-4xl flex-1 overflow-auto px-6 pt-30">
                <DateHeader displayDate={displayDate} />
                <div className="p-6">
                  <MarkdownEditor
                    value={loadedContent.get(focusedFile.filePath) ?? ""}
                    onChange={(value: string) =>
                      handleContentChange(focusedFile.filePath, value)
                    }
                    onSave={() => handleImmediateSave(focusedFile.filePath)}
                    onGenerateSummary={handleGenerateSummary}
                  />
                </div>
              </div>
              <div className="flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="mx-auto w-full max-w-4xl px-6 py-6">
                  <FileName
                    fileName={focusedFile.fileName}
                    isFocused={true}
                    onToggleFocus={() => setFocusedFile(null)}
                  />
                  {fileCommits.length > 0 && (
                    <div className="mt-4">
                      <CommitOverlay
                        commits={fileCommits}
                        date={focusedFile.createdAt}
                        className="overflow-y-scroll"
                      />
                    </div>
                  )}
                </div>
              </div>
              <Footer
                folderPath={folderPath}
                fileCount={allFilesMetadata.length}
                onFolderClick={onBack}
                isLoadingMetadata={isLoadingMetadata}
                allFilesMetadata={allFilesMetadata}
                settingsOpen={settingsOpen}
                onSettingsOpenChange={setSettingsOpen}
              />
            </div>
          );
        })()}
    </div>
  );
}

export default FileReaderScreen;
