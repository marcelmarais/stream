"use client";

import { debounce } from "lodash";
import { useCallback, useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  type CommitsByDate,
  createDateRange,
  getCommitsForDate,
  getGitCommitsForRepos,
  groupCommitsByDate,
} from "../utils/gitReader";
import {
  type MarkdownFileMetadata,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "../utils/markdownReader";
import CommitOverlay from "./CommitOverlay";
import RepoConnector, { getConnectedRepos } from "./RepoConnector";

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
    const dateStr = file.createdAt.toISOString().split("T")[0];
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
    const date = new Date(dateStr);
    const displayDate = date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

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
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [_savingFiles, setSavingFiles] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [commitsByDate, setCommitsByDate] = useState<CommitsByDate>({});
  const [commitError, setCommitError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  // Create debounced save function
  const debouncedSave = useCallback(
    debounce(async (filePath: string, content: string) => {
      setSavingFiles((prev) => new Set(prev).add(filePath));
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
      } finally {
        setSavingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(filePath);
          return newSet;
        });
      }
    }, 500),
    [],
  );

  const handleEditFile = useCallback(
    (filePath: string, currentContent: string) => {
      setEditingFile(filePath);
      setEditingContent(currentContent);
    },
    [],
  );

  const _handleCancelEdit = useCallback(() => {
    setEditingFile(null);
    setEditingContent("");
  }, []);

  // Handle content changes during editing
  const handleContentChange = useCallback(
    (filePath: string, newContent: string) => {
      setEditingContent(newContent);
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
        if (connectedRepos.length === 0) return;

        // Get unique dates from visible files
        const visibleDates = Array.from(
          new Set(
            visibleFiles.map(
              (file) => file.createdAt.toISOString().split("T")[0],
            ),
          ),
        );

        // Only load commits for dates we don't already have
        const datesToLoad = visibleDates.filter(
          (dateStr) => !commitsByDate[dateStr],
        );

        if (datesToLoad.length === 0) return;

        console.log(
          `Loading commits for ${datesToLoad.length} new dates:`,
          datesToLoad,
        );

        // Create date ranges for each date we need
        const dateRanges = datesToLoad.map((dateStr) => {
          const date = new Date(dateStr);
          const startOfDay = new Date(date);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);
          return createDateRange.custom(startOfDay, endOfDay);
        });

        // Load commits for each date range
        const allNewCommits: CommitsByDate = {};

        for (const dateRange of dateRanges) {
          try {
            const repoCommits = await getGitCommitsForRepos(
              connectedRepos,
              dateRange,
            );
            const groupedCommits = groupCommitsByDate(repoCommits);

            // Merge new commits with existing ones
            Object.assign(allNewCommits, groupedCommits);
          } catch (error) {
            console.error(`Error loading commits for date range:`, error);
          }
        }

        // Update state with new commits (merge with existing)
        setCommitsByDate((prev) => ({ ...prev, ...allNewCommits }));

        console.log(
          `Loaded commits for ${Object.keys(allNewCommits).length} new days`,
        );
      } catch (error) {
        console.error("Error loading commits for visible files:", error);
        setCommitError(`Failed to load git commits: ${error}`);
      }
    },
    [folderPath, commitsByDate],
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
        return (
          <div className="mx-6 mt-8 mb-4 first:mt-0">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="font-semibold text-blue-900 text-xl">
                {item.displayDate}
              </h3>
            </div>
          </div>
        );
      }

      // Render file item
      const { file } = item;
      const content = loadedContent.get(file.filePath);
      const isLoading = !content && loadingFiles.has(file.filePath);
      const isEditing = editingFile === file.filePath;
      const saveError = saveErrors.get(file.filePath);

      // Get commits for this file's creation date
      const fileCommits = getCommitsForDate(commitsByDate, file.createdAt);

      return (
        <div className="mx-6 mb-6 rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 border-gray-200 border-b pb-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-800 text-lg">
                {file.fileName}
              </h4>
            </div>
            {saveError && (
              <div className="mt-2 rounded-md border border-red-300 bg-red-100 p-2 text-red-700 text-sm">
                {saveError}
              </div>
            )}
          </div>

          {/* Git Commits Overlay */}
          {fileCommits.length > 0 && (
            <div className="mt-4">
              <CommitOverlay
                commits={fileCommits}
                date={file.createdAt}
                className="w-full"
              />
            </div>
          )}

          <div className="h-auto rounded-md border bg-gray-50 p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  <div className="text-gray-600 text-sm">
                    Loading content...
                  </div>
                </div>
              </div>
            ) : content ? (
              isEditing ? (
                <textarea
                  value={editingContent}
                  onChange={(e) =>
                    handleContentChange(file.filePath, e.target.value)
                  }
                  className="h-80 w-full resize-none text-left text-gray-800 text-sm focus:outline-none"
                  placeholder="Enter your markdown content..."
                />
              ) : (
                <button
                  type="button"
                  onClick={() => handleEditFile(file.filePath, content)}
                  className="-m-2 cursor-pointer rounded p-2 transition-colors hover:bg-gray-100"
                >
                  <div className="w-full whitespace-pre-wrap text-left text-gray-800 text-sm">
                    {content}
                  </div>
                </button>
              )
            ) : (
              <div className="text-gray-500 text-sm italic">
                Content not available
              </div>
            )}
          </div>
        </div>
      );
    },
    [
      groupedItems,
      loadedContent,
      loadingFiles,
      editingFile,
      editingContent,
      saveErrors,
      commitsByDate,
      handleEditFile,
      handleContentChange,
    ],
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="mx-auto w-full max-w-4xl flex-shrink-0 p-6">
        <div className="rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="rounded-md bg-gray-100 px-4 py-2 text-gray-700 text-sm transition-colors hover:bg-gray-200"
            >
              ← Back to Folder Selection
            </button>
          </div>

          <div className="mb-4 text-gray-600 text-sm">
            Reading from:{" "}
            <code className="rounded bg-gray-100 px-2 py-1">{folderPath}</code>
          </div>

          {/* Status Display */}
          {isLoadingMetadata ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
                <div className="font-medium text-blue-700 text-lg">
                  Reading folder metadata...
                </div>
                <div className="mt-2 text-gray-600 text-sm">
                  Please wait while we scan for markdown files
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4 space-y-2">
              <div className="text-gray-600 text-sm">
                Found {allFilesMetadata.length} markdown files
              </div>

              {/* Git Commits Status */}
              {Object.keys(commitsByDate).length > 0 && (
                <div className="text-blue-600 text-sm">
                  🔄 Found commits for {Object.keys(commitsByDate).length} days
                  (loaded on-demand)
                </div>
              )}

              {commitError && (
                <div className="text-orange-600 text-sm">⚠️ {commitError}</div>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-4 rounded-md border border-red-300 bg-red-100 p-3 text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Repository Connector */}
        <div className="mt-4">
          <RepoConnector markdownDirectory={folderPath} className="w-full" />
        </div>
      </div>

      {/* Virtualized List */}
      {!isLoadingMetadata && groupedItems.length > 0 && (
        <div className="mx-auto w-full max-w-4xl flex-1">
          <Virtuoso
            totalCount={groupedItems.length}
            itemContent={renderItem}
            rangeChanged={handleRangeChanged}
            overscan={2}
            style={{ height: "100%" }}
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoadingMetadata && allFilesMetadata.length === 0 && !error && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="mb-2 font-medium text-lg">
              No markdown files found
            </div>
            <div className="text-sm">
              No .md files were found in the selected folder
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileReaderScreen;
