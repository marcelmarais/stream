"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Footer } from "@/components/footer";
import {
  FileCard,
  FileReaderHeader,
  FocusedFileOverlay,
} from "@/components/markdown-file-card";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";
import CommitFilter from "../commit-filter";

interface FileReaderScreenProps {
  folderPath: string;
  onBack: () => void;
}

const GIT_COMMIT_REFRESH_INTERVAL = 5000;

export function FileReaderScreen({
  folderPath,
  onBack,
}: FileReaderScreenProps) {
  // Local UI state
  const [showLoading, setShowLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );
  const [activeEditingFile, setActiveEditingFile] =
    useState<MarkdownFileMetadata | null>(null);

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
      const index = allFilesMetadata.findIndex((file) => {
        const dateFromFilename = getDateFromFilename(file.fileName);
        const fileDateStr = dateFromFilename || getDateKey(file.createdAt);
        return fileDateStr === dateStr;
      });

      if (index !== -1 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index,
          align: "start",
          behavior: "auto",
        });
      }
    },
    [allFilesMetadata],
  );

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

  // Add keyboard shortcut for Command + I to focus the active editing file
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Cmd+I (Mac) or Ctrl+I (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === "i") {
        event.preventDefault();
        if (focusedFile && activeEditingFile) {
          setFocusedFile(null);
        }
        if (activeEditingFile && !focusedFile) {
          setFocusedFile(activeEditingFile);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeEditingFile, focusedFile]);

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
      // Get visible files
      const visibleFiles = allFilesMetadata.slice(
        range.startIndex,
        range.endIndex + 1,
      );

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
    [allFilesMetadata, handleLoadFileContent, handleLoadCommitsForVisibleFiles],
  );

  // Render individual item
  const renderItem = useCallback(
    (index: number) => {
      const file = allFilesMetadata[index];
      if (!file) return null;

      return (
        <FileCard
          file={file}
          onToggleFocus={() =>
            setFocusedFile(
              focusedFile?.filePath === file.filePath ? null : file,
            )
          }
          isFocused={focusedFile?.filePath === file.filePath}
          onEditorFocus={() => setActiveEditingFile(file)}
        />
      );
    },
    [allFilesMetadata, focusedFile],
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
      {!isLoadingMetadata && allFilesMetadata.length > 0 && (
        <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 px-6 pt-16">
          <Virtuoso
            ref={virtuosoRef}
            totalCount={allFilesMetadata.length}
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
          onEditorFocus={() => setActiveEditingFile(focusedFile)}
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
