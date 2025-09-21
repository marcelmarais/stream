"use client";

import { debounce } from "lodash";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  type CommitFilters,
  type CommitsByDate,
  createDateRange,
  filterCommits,
  getCommitsForDate,
  getGitCommitsForRepos,
  groupCommitsByDate,
} from "../utils/gitReader";
import {
  ensureTodayMarkdownFile,
  type MarkdownFileMetadata,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "../utils/markdownReader";
import CommitFilter from "./CommitFilter";
import { DateHeader, FileCard } from "./FileReaderComponents";
import FileReaderFooter from "./FileReaderFooter";
import FileReaderHeader from "./FileReaderHeader";
import { getConnectedRepos } from "./RepoConnector";

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

// Create grouped items from files metadata - moved outside component for stability
function createGroupedItems(files: MarkdownFileMetadata[]): VirtualizedItem[] {
  // Group files by date
  const filesByDate = new Map<string, MarkdownFileMetadata[]>();

  files.forEach((file) => {
    const dateStr = getDateKeyFromDate(file.createdAt);
    if (!filesByDate.has(dateStr)) {
      filesByDate.set(dateStr, []);
    }
    filesByDate.get(dateStr)?.push(file);
  });

  // Sort dates in descending order (newest first)
  const sortedDates = Array.from(filesByDate.keys()).sort((a, b) =>
    b.localeCompare(a),
  );

  // Create flattened list with headers and files
  const items: VirtualizedItem[] = [];
  let fileIndex = 0;

  sortedDates.forEach((dateStr) => {
    const filesForDate = filesByDate.get(dateStr);
    if (!filesForDate) return;

    // Format date for display
    const displayDate = formatDisplayDateFromKey(dateStr);

    // Add date header
    items.push({
      type: "header",
      date: dateStr,
      displayDate,
    });

    // Add files for this date
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

// Simplified - virtualization handles efficient loading

// Helpers
function getDateKeyFromDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDisplayDateFromKey(dateStr: string): string {
  const date = new Date(dateStr);
  return date
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .replace(", ", " — ")
    .toLowerCase();
}

export function FileReaderScreen({
  folderPath,
  onBack,
}: FileReaderScreenProps) {
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [allFilesMetadata, setAllFilesMetadata] = useState<
    MarkdownFileMetadata[]
  >([]);
  const [groupedItems, setGroupedItems] = useState<VirtualizedItem[]>([]);
  const [loadedContent, setLoadedContent] = useState<Map<string, string>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [commitsByDate, setCommitsByDate] = useState<CommitsByDate>({});
  const [commitError, setCommitError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const [connectedReposCount, setConnectedReposCount] = useState<number>(0);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [commitFilters, setCommitFilters] = useState<CommitFilters>({
    authors: [],
    repos: [],
    searchTerm: "",
  });
  const [creatingToday, setCreatingToday] = useState<boolean>(false);

  // Keep a ref of commitsByDate to avoid stale closures in async code
  const commitsByDateRef = useRef<CommitsByDate>({});
  useEffect(() => {
    commitsByDateRef.current = commitsByDate;
  }, [commitsByDate]);

  // Create debounced save function
  const debouncedSave = useCallback(
    debounce(async (filePath: string, content: string) => {
      setSaveErrors((prev) => {
        const newMap = new Map(prev);
        newMap.delete(filePath);
        return newMap;
      });

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
        setSaveErrors((prev) => {
          const newMap = new Map(prev);
          newMap.set(filePath, `Failed to save: ${error}`);
          return newMap;
        });
      }
    }, 500),
    [],
  );

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

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
      debouncedSave(filePath, newContent);
    },
    [debouncedSave],
  );

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

  // Load git commits for currently visible files only
  const loadCommitsForVisibleFiles = useCallback(
    async (visibleFiles: MarkdownFileMetadata[]) => {
      if (visibleFiles.length === 0) return;

      try {
        const connectedRepos = await getConnectedRepos(folderPath);
        setConnectedReposCount(connectedRepos.length);
        if (connectedRepos.length === 0) return;

        // Unique date keys for visible files
        const visibleDates = Array.from(
          new Set(
            visibleFiles.map((file) => getDateKeyFromDate(file.createdAt)),
          ),
        );

        // Filter out dates we already have
        const datesToLoad = visibleDates.filter(
          (dateStr) => !commitsByDateRef.current[dateStr],
        );

        if (datesToLoad.length === 0) return;

        // Build date ranges
        const dateRanges = datesToLoad.map((dateStr) => {
          const date = new Date(dateStr);
          const startOfDay = new Date(date);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);
          return {
            dateStr,
            range: createDateRange.custom(startOfDay, endOfDay),
          };
        });

        // Fetch in parallel
        const results = await Promise.all(
          dateRanges.map(async ({ range }) => {
            try {
              const repoCommits = await getGitCommitsForRepos(
                connectedRepos,
                range,
              );
              return groupCommitsByDate(repoCommits);
            } catch (error) {
              console.error("Error loading commits for date range:", error);
              return {} as CommitsByDate;
            }
          }),
        );

        const merged: CommitsByDate = {};
        for (const partial of results) {
          for (const [key, value] of Object.entries(partial)) {
            merged[key] = value;
          }
        }

        if (Object.keys(merged).length > 0) {
          setCommitsByDate((prev) => ({ ...prev, ...merged }));
        }
      } catch (error) {
        console.error("Error loading commits for visible files:", error);
        setCommitError(`Failed to load git commits: ${error}`);
      }
    },
    [folderPath],
  );

  // Load metadata when component mounts
  useEffect(() => {
    const loadMetadata = async () => {
      setIsLoadingMetadata(true);
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
        try {
          const connectedRepos = await getConnectedRepos(folderPath);
          setConnectedReposCount(connectedRepos.length);
        } catch (repoError) {
          console.error("Error loading connected repos:", repoError);
          setConnectedReposCount(0);
        }
      } catch (err) {
        setError(`Error reading folder metadata: ${err}`);
      } finally {
        setIsLoadingMetadata(false);
      }
    };

    loadMetadata();
  }, [folderPath]);

  // Load git commits for initially visible files when metadata is loaded
  useEffect(() => {
    if (!isLoadingMetadata && allFilesMetadata.length > 0) {
      // Load commits for the first few files
      const initialFiles = allFilesMetadata.slice(0, 10);
      loadCommitsForVisibleFiles(initialFiles);
    }
  }, [isLoadingMetadata, allFilesMetadata, loadCommitsForVisibleFiles]);

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
        loadCommitsForVisibleFiles(visibleFiles);
      }
    },
    [groupedItems, loadedContent, loadFileContent, loadCommitsForVisibleFiles],
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
      const saveError = saveErrors.get(file.filePath);

      // Get commits for this file's creation date and apply filters
      const allFileCommits = getCommitsForDate(commitsByDate, file.createdAt);
      const fileCommits = filterCommits(allFileCommits, commitFilters);

      return (
        <FileCard
          file={file}
          content={content}
          isLoading={isLoading}
          saveError={saveError}
          commits={fileCommits}
          onContentChange={handleContentChange}
        />
      );
    },
    [
      groupedItems,
      loadedContent,
      loadingFiles,
      saveErrors,
      commitsByDate,
      commitFilters,
      handleContentChange,
    ],
  );

  return (
    <div className="flex h-screen flex-col">
      <div className="mx-auto w-full max-w-4xl px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          {/* Filter controls on the left */}
          {!isLoadingMetadata && (
            <div className="flex-shrink-0">
              <CommitFilter
                commits={Object.values(commitsByDate).flatMap(
                  (dateData) => dateData.commits,
                )}
                filters={commitFilters}
                onFiltersChange={setCommitFilters}
              />
            </div>
          )}

          {/* Settings button on the right */}
          <div className="flex flex-1 justify-end">
            <FileReaderHeader
              folderPath={folderPath}
              isLoadingMetadata={isLoadingMetadata}
              allFilesMetadata={allFilesMetadata}
              commitsByDate={commitsByDate}
              commitError={commitError}
              error={error}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
              onCreateToday={handleCreateToday}
              creatingToday={creatingToday}
            />
          </div>
        </div>
      </div>

      {/* Virtualized List */}
      {!isLoadingMetadata && groupedItems.length > 0 && (
        <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 pt-6">
          <Virtuoso
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

      {/* Footer */}
      <FileReaderFooter
        folderPath={folderPath}
        fileCount={allFilesMetadata.length}
        connectedReposCount={connectedReposCount}
        onSettingsClick={handleOpenSettings}
        onFolderClick={onBack}
      />
    </div>
  );
}

export default FileReaderScreen;
