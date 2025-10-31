"use client";

import {
  CalendarPlusIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Footer } from "@/components/footer";
import {
  FileCard,
  FocusedFileOverlay,
  Header,
} from "@/components/markdown-file-card";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/components/ui/button";
import { CalendarView } from "@/components/views/calendar";
import {
  useConnectedRepos,
  usePrefetchCommitsForDates,
} from "@/hooks/use-git-queries";
import {
  useSearchShortcut,
  useToggleFocusShortcut,
} from "@/hooks/use-keyboard-shortcut";
import {
  markdownKeys,
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
  const appWindow = getCurrentWindow();
  const titlebarClasses = [
    "backdrop-blur",
    "bg-background/60",
    "border-b",
    "border-border/50",
    "drag",
    "fixed",
    "h-10",
    "inset-x-0",
    "supports-[backdrop-filter]:bg-background/40",
    "top-0",
    "z-40",
  ].join(" ");
  useConnectedRepos(folderPath);
  const [showLoading, setShowLoading] = useState(true);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );
  const [showSearch, setShowSearch] = useState(false);

  const viewMode = useUserStore((state) => state.viewMode);
  const activeEditingFile = useUserStore((state) => state.activeEditingFile);
  const setActiveEditingFile = useUserStore(
    (state) => state.setActiveEditingFile,
  );
  useToggleFocusShortcut(activeEditingFile, focusedFile, setFocusedFile);
  useSearchShortcut(showSearch, setShowSearch);

  const queryClient = useQueryClient();
  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);
  const prefetchFileContents = usePrefetchFileContents();
  const prefetchCommitsForDates = usePrefetchCommitsForDates();

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const handleScrollToDate = useCallback(
    (date: Date) => {
      const metadata = queryClient.getQueryData<MarkdownFileMetadata[]>(
        markdownKeys.metadata(folderPath),
      );

      if (!metadata) return;

      const dateStr = getDateKey(date);
      const index = metadata.findIndex((file) => {
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
    [folderPath, queryClient],
  );

  const handleFileSelectFromSearch = useCallback(
    (filePath: string) => {
      const metadata = queryClient.getQueryData<MarkdownFileMetadata[]>(
        markdownKeys.metadata(folderPath),
      );

      if (!metadata) return;

      const fileIndex = metadata.findIndex(
        (file) => file.filePath === filePath,
      );

      if (fileIndex !== -1) {
        setShowSearch(false);

        if (virtuosoRef.current) {
          virtuosoRef.current.scrollToIndex({
            index: fileIndex,
            align: "start",
            behavior: "smooth",
          });
        }
      }
    },
    [folderPath, queryClient],
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

  // Render calendar view
  if (viewMode === "calendar") {
    return (
      <div className="flex h-screen flex-col overflow-hidden rounded-lg bg-background">
        <div data-tauri-drag-region className={titlebarClasses}>
          <div className="flex h-full w-full max-w-4xl items-center justify-between gap-2 px-6">
            {!isLoadingMetadata && (
              <div className="flex flex-shrink-0 items-center gap-2">
                <div className="mr-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Close window"
                    className="h-3 w-3 rounded-full bg-red-500"
                    onClick={() => appWindow.close()}
                  />
                  <button
                    type="button"
                    aria-label="Minimize window"
                    className="h-3 w-3 rounded-full bg-yellow-500"
                    onClick={() => appWindow.minimize()}
                  />
                  <button
                    type="button"
                    aria-label="Maximize window"
                    className="h-3 w-3 rounded-full bg-green-500"
                    onClick={() => appWindow.toggleMaximize()}
                  />
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowSearch(!showSearch)}
                  title="Search markdown files (Cmd+F)"
                >
                  <MagnifyingGlassIcon className="h-4 w-4" weight="bold" />
                </Button>
                <CommitFilter />
              </div>
            )}

            {/* Center drag region */}
            <div data-tauri-drag-region className="drag h-full flex-1" />

            <div className="no-drag flex items-center justify-end">
              <Header
                onScrollToDate={handleScrollToDate}
                folderPath={folderPath}
              />
            </div>
          </div>
        </div>

        <div
          className={`absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm transition-opacity duration-500 ${
            showLoading ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
            <div className="text-muted-foreground text-sm">Loading...</div>
          </div>
        </div>

        <div className="mt-12">
          {!isLoadingMetadata && allFilesMetadata.length === 0 ? (
            <EmptyState folderPath={folderPath} />
          ) : (
            !isLoadingMetadata && (
              <CalendarView
                folderPath={folderPath}
                footerComponent={
                  <Footer onFolderClick={onBack} folderPath={folderPath} />
                }
              />
            )
          )}

          <Footer onFolderClick={onBack} folderPath={folderPath} />
        </div>
      </div>
    );
  }

  // Render timeline view (default)
  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-lg bg-background">
      {/* Custom draggable titlebar */}
      <div data-tauri-drag-region className={titlebarClasses}>
        <div className="flex h-full w-full max-w-4xl items-center justify-between gap-2 px-6">
          {!isLoadingMetadata && (
            <div
              data-tauri-drag-region
              className="no-drag flex flex-shrink-0 items-center gap-2"
            >
              {/* macOS-like window controls */}
              <div className="mr-2 flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Close window"
                  className="h-3 w-3 rounded-full bg-red-500"
                  onClick={() => appWindow.close()}
                />
                <button
                  type="button"
                  aria-label="Minimize window"
                  className="h-3 w-3 rounded-full bg-yellow-500"
                  onClick={() => appWindow.minimize()}
                />
                <button
                  type="button"
                  aria-label="Maximize window"
                  className="h-3 w-3 rounded-full bg-green-500"
                  onClick={() => appWindow.toggleMaximize()}
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setShowSearch(!showSearch)}
                title="Search markdown files (Cmd+F)"
              >
                <MagnifyingGlassIcon className="h-4 w-4" weight="bold" />
              </Button>
              <CommitFilter />
            </div>
          )}

          <div data-tauri-drag-region className="drag h-full flex-1" />

          <div className="flex items-center justify-end">
            <Header
              onScrollToDate={handleScrollToDate}
              folderPath={folderPath}
            />
          </div>
        </div>
      </div>

      <div
        className={`absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm transition-opacity duration-500 ${
          showLoading ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <div className="text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>

      {!isLoadingMetadata && allFilesMetadata.length > 0 && (
        <div className="mx-auto mt-12 min-h-0 w-full max-w-4xl flex-1 px-6">
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
        <div className="mt-12">
          <EmptyState folderPath={folderPath} />
        </div>
      )}

      <Footer onFolderClick={onBack} folderPath={folderPath} />

      <SearchBar
        open={showSearch}
        onOpenChange={setShowSearch}
        folderPath={folderPath}
        onFileSelect={handleFileSelectFromSearch}
      />

      {focusedFile && (
        <FocusedFileOverlay
          file={focusedFile}
          folderPath={folderPath}
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
