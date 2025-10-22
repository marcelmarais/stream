"use client";

import { CalendarPlusIcon, FileTextIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Footer } from "@/components/footer";
import {
  FileCard,
  FocusedFileOverlay,
  Header,
} from "@/components/markdown-file-card";
import { Button } from "@/components/ui/button";
import {
  useConnectedRepos,
  usePrefetchCommitsForDates,
} from "@/hooks/use-git-queries";
import { useToggleFocusShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  useCreateTodayFile,
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
  useConnectedRepos(folderPath);
  const [showLoading, setShowLoading] = useState(true);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );

  const activeEditingFile = useUserStore((state) => state.activeEditingFile);
  const setActiveEditingFile = useUserStore(
    (state) => state.setActiveEditingFile,
  );
  useToggleFocusShortcut(activeEditingFile, focusedFile, setFocusedFile);

  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);
  const prefetchFileContents = usePrefetchFileContents();
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
      const isLastFile = index === allFilesMetadata.length - 1;
      if (!file) return null;

      return (
        <FileCard
          file={file}
          folderPath={folderPath}
          onToggleFocus={() =>
            setFocusedFile(
              focusedFile?.filePath === file.filePath ? null : file,
            )
          }
          isFocused={focusedFile?.filePath === file.filePath}
          onEditorFocus={() => setActiveEditingFile(file)}
          showSeparator={!isLastFile}
        />
      );
    },
    [allFilesMetadata, focusedFile, setActiveEditingFile, folderPath],
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
            <Header
              onScrollToDate={handleScrollToDate}
              folderPath={folderPath}
            />
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
            overscan={25}
            className="h-full"
          />
        </div>
      )}

      {!isLoadingMetadata && allFilesMetadata.length === 0 && (
        <EmptyState folderPath={folderPath} />
      )}

      <Footer onFolderClick={onBack} folderPath={folderPath} />

      {focusedFile && (
        <FocusedFileOverlay
          file={focusedFile}
          onClose={() => setFocusedFile(null)}
          onEditorFocus={() => setActiveEditingFile(focusedFile)}
          footerComponent={
            <Footer onFolderClick={onBack} folderPath={folderPath} />
          }
        />
      )}
    </div>
  );
}

function EmptyState({ folderPath }: { folderPath: string }) {
  const { mutate: createToday, isPending: creatingToday } =
    useCreateTodayFile();

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <FileTextIcon
            className="h-10 w-10 text-muted-foreground"
            weight="duotone"
            aria-hidden="true"
          />
        </div>

        <div className="flex max-w-[300px] flex-col gap-2">
          <h3 className="font-semibold text-foreground text-xl">
            No markdown files found
          </h3>
          <p className="text-muted-foreground text-sm">
            No files matching the{" "}
            <code className="bg-muted px-0.5 font-mono text-foreground">
              YYYY-MM-DD.md
            </code>{" "}
            format were found in the selected folder.
          </p>
        </div>

        <Button
          onClick={() => createToday(folderPath)}
          disabled={creatingToday}
          size="lg"
          className="min-w-[140px] gap-2"
        >
          <CalendarPlusIcon className="h-5 w-5" weight="bold" />
          {creatingToday ? "Creating..." : "Create Today"}
        </Button>
      </div>
    </div>
  );
}

export default FileReaderScreen;
