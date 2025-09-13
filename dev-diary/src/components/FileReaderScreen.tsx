"use client";

import { debounce } from "lodash";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  type MarkdownFileMetadata,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "../utils/markdownReader";

interface FileReaderScreenProps {
  folderPath: string;
  onBack: () => void;
}

// Configuration for virtualized list
const PAGE_SIZE = 10; // Files per page
const MAX_PAGES_IN_MEMORY = 5; // Maximum pages to keep in memory

export function FileReaderScreen({
  folderPath,
  onBack,
}: FileReaderScreenProps) {
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [allFilesMetadata, setAllFilesMetadata] = useState<
    MarkdownFileMetadata[]
  >([]);
  const [loadedContent, setLoadedContent] = useState<Map<string, string>>(
    new Map(),
  );
  const [loadingPages, setLoadingPages] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [savingFiles, setSavingFiles] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  // Track which pages are currently loaded
  const loadedPagesRef = useRef<Set<number>>(new Set());

  // Ref for the textarea to handle auto-sizing
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleCancelEdit = useCallback(() => {
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

  // Calculate which page a file index belongs to
  const getPageForIndex = useCallback(
    (index: number) => Math.floor(index / PAGE_SIZE),
    [],
  );

  // Get files for a specific page
  const getFilesForPage = useCallback(
    (page: number) => {
      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      return allFilesMetadata.slice(start, end);
    },
    [allFilesMetadata],
  );

  // Load content for a specific page
  const loadPageContent = useCallback(
    async (page: number) => {
      if (loadingPages.has(page) || loadedPagesRef.current.has(page)) {
        return;
      }

      setLoadingPages((prev) => new Set(prev).add(page));

      try {
        const pageFiles = getFilesForPage(page);
        const filePaths = pageFiles.map((f) => f.filePath);

        if (filePaths.length === 0) return;

        const contentMap = await readMarkdownFilesContentByPaths(filePaths);

        setLoadedContent((prev) => {
          const newMap = new Map(prev);
          contentMap.forEach((content, path) => {
            newMap.set(path, content);
          });
          return newMap;
        });

        loadedPagesRef.current.add(page);
      } catch (err) {
        console.error(`Error loading content for page ${page}:`, err);
      } finally {
        setLoadingPages((prev) => {
          const newSet = new Set(prev);
          newSet.delete(page);
          return newSet;
        });
      }
    },
    [loadingPages, getFilesForPage],
  );

  // Evict old pages when we have too many loaded
  const evictOldPages = useCallback(
    (currentVisiblePage: number) => {
      const loadedPages = Array.from(loadedPagesRef.current);

      if (loadedPages.length <= MAX_PAGES_IN_MEMORY) return;

      // Sort by distance from current page, keep closest pages
      const sortedPages = loadedPages.sort(
        (a, b) =>
          Math.abs(a - currentVisiblePage) - Math.abs(b - currentVisiblePage),
      );

      const pagesToEvict = sortedPages.slice(MAX_PAGES_IN_MEMORY);

      if (pagesToEvict.length > 0) {
        setLoadedContent((prev) => {
          const newMap = new Map(prev);

          pagesToEvict.forEach((page) => {
            const pageFiles = getFilesForPage(page);
            pageFiles.forEach((file) => {
              newMap.delete(file.filePath);
            });
            loadedPagesRef.current.delete(page);
          });

          return newMap;
        });
      }
    },
    [getFilesForPage],
  );

  // Load metadata when component mounts
  useEffect(() => {
    const loadMetadata = async () => {
      setIsLoadingMetadata(true);
      setError(null);
      setLoadedContent(new Map());
      loadedPagesRef.current.clear();

      try {
        const metadata = await readAllMarkdownFilesMetadata(folderPath, {
          maxFileSize: 5 * 1024 * 1024, // 5MB limit
        });

        setAllFilesMetadata(metadata);

        // Load first page immediately
        if (metadata.length > 0) {
          // Load first page content directly to avoid dependency cycle
          const firstPageFiles = metadata.slice(0, PAGE_SIZE);
          const filePaths = firstPageFiles.map((f) => f.filePath);

          if (filePaths.length > 0) {
            try {
              const contentMap =
                await readMarkdownFilesContentByPaths(filePaths);
              setLoadedContent(contentMap);
              loadedPagesRef.current.add(0);
            } catch (err) {
              console.error("Error loading first page content:", err);
            }
          }
        }
      } catch (err) {
        setError(`Error reading folder metadata: ${err}`);
      } finally {
        setIsLoadingMetadata(false);
      }
    };

    loadMetadata();
  }, [folderPath]);

  // Handle range changes for virtualized list
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      const startPage = getPageForIndex(range.startIndex);
      const endPage = getPageForIndex(range.endIndex);

      // Load pages around the visible range
      const pagesToLoad = [];
      for (let page = Math.max(0, startPage - 1); page <= endPage + 1; page++) {
        pagesToLoad.push(page);
      }

      // Load pages that aren't already loaded or loading
      pagesToLoad.forEach((page) => {
        if (!loadedPagesRef.current.has(page) && !loadingPages.has(page)) {
          loadPageContent(page);
        }
      });

      // Evict old pages if needed
      const currentPage = Math.floor((startPage + endPage) / 2);
      evictOldPages(currentPage);
    },
    [getPageForIndex, loadPageContent, loadingPages, evictOldPages],
  );

  // Render individual file item
  const renderFileItem = useCallback(
    (index: number) => {
      const file = allFilesMetadata[index];
      if (!file) return null;

      const content = loadedContent.get(file.filePath);
      const isLoading = !content && loadingPages.has(getPageForIndex(index));
      const isEditing = editingFile === file.filePath;
      const saveError = saveErrors.get(file.filePath);

      return (
        <div className="mx-6 mb-6 rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 border-gray-200 border-b pb-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-800 text-lg">
                {file.fileName}
              </h4>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-gray-500 text-sm">
              <span>
                Created: {file.createdAt.toLocaleDateString()} at{" "}
                {file.createdAt.toLocaleTimeString()}
              </span>
              <span>Size: {(file.size / 1024).toFixed(1)}KB</span>
            </div>
            <div className="mt-1 text-gray-400 text-xs">{file.filePath}</div>
            {saveError && (
              <div className="mt-2 rounded-md border border-red-300 bg-red-100 p-2 text-red-700 text-sm">
                {saveError}
              </div>
            )}
          </div>

          <div className="h-auto rounded-md border bg-gray-50 p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"></div>
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
      allFilesMetadata,
      loadedContent,
      loadingPages,
      getPageForIndex,
      editingFile,
      editingContent,
      saveErrors,
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
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
                <div className="font-medium text-blue-700 text-lg">
                  Reading folder metadata...
                </div>
                <div className="mt-2 text-gray-600 text-sm">
                  Please wait while we scan for markdown files
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4 text-gray-600 text-sm">
              Found {allFilesMetadata.length} markdown files
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-4 rounded-md border border-red-300 bg-red-100 p-3 text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Virtualized List */}
      {!isLoadingMetadata && allFilesMetadata.length > 0 && (
        <div className="mx-auto w-full max-w-4xl flex-1">
          <Virtuoso
            totalCount={allFilesMetadata.length}
            itemContent={renderFileItem}
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
