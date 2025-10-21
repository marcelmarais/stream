"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Footer } from "@/components/footer";
import {
  FileCard,
  FileReaderHeader,
  FocusedFileOverlay,
} from "@/components/markdown-file-card";
import {
  useConnectedRepos,
  usePrefetchCommitsForDates,
} from "@/hooks/use-git-queries";
import {
  useMarkdownMetadata,
  usePrefetchFileContents,
} from "@/hooks/use-markdown-queries";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { useUserStore } from "@/stores/user-store";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";
import CommitFilter from "../commit-filter";

interface FileReaderScreenProps {
  folderPath: string;
  onBack: () => void;
}

export function FileReaderScreen({
  folderPath,
  onBack,
}: FileReaderScreenProps) {
  const [showLoading, setShowLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );

  const activeEditingFile = useUserStore((state) => state.activeEditingFile);
  const setActiveEditingFile = useUserStore(
    (state) => state.setActiveEditingFile,
  );

  const {
    data: allFilesMetadata = [],
    isLoading: isLoadingMetadata,
    error: metadataError,
  } = useMarkdownMetadata(folderPath);
  const prefetchFileContents = usePrefetchFileContents();

  useConnectedRepos(folderPath);
  const prefetchCommitsForDates = usePrefetchCommitsForDates();

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

  useEffect(() => {
    const startTime = Date.now();
    setShowLoading(true);

    if (!isLoadingMetadata) {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 200 - elapsed);

      setTimeout(() => {
        setShowLoading(false);
      }, remaining);
    }
  }, [isLoadingMetadata]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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

  const handleRangeChanged = useCallback(
    async (range: { startIndex: number; endIndex: number }) => {
      const visibleFiles = allFilesMetadata.slice(
        range.startIndex,
        range.endIndex + 1,
      );

      const filePaths = visibleFiles.map((file) => file.filePath);
      await prefetchFileContents(filePaths);

      if (visibleFiles.length > 0) {
        const dateKeys = visibleFiles.map((file) => {
          const dateFromFilename = getDateFromFilename(file.fileName);
          return dateFromFilename || getDateKey(file.createdAt);
        });
        await prefetchCommitsForDates(folderPath, dateKeys);
      }
    },
    [
      allFilesMetadata,
      prefetchFileContents,
      prefetchCommitsForDates,
      folderPath,
    ],
  );

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
    [allFilesMetadata, focusedFile, setActiveEditingFile],
  );

  const error = metadataError?.message || null;

  return (
    <div className="flex h-screen flex-col">
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
          {!isLoadingMetadata && (
            <div className="flex-shrink-0">
              <CommitFilter />
            </div>
          )}

          <div className="flex flex-1 justify-end">
            <FileReaderHeader onScrollToDate={handleScrollToDate} />
          </div>
        </div>
      </div>

      {!isLoadingMetadata && allFilesMetadata.length > 0 && (
        <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 px-6 pt-4">
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
