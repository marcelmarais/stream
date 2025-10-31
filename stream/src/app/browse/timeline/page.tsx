"use client";

import { CalendarPlusIcon, FileTextIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Footer } from "@/components/footer";
import { FileCard, FocusedFileOverlay } from "@/components/markdown-file-card";
import { SearchBar } from "@/components/search-bar";
import { TitlebarHeader } from "@/components/titlebar-header";
import { Button } from "@/components/ui/button";
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

export default function TimelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [folderPath, setFolderPath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const pathParam = searchParams.get("path");

    if (!pathParam) {
      router.push("/");
      return;
    }

    try {
      const decodedPath = decodeURIComponent(pathParam);
      setFolderPath(decodedPath);
      setIsLoading(false);
    } catch (error) {
      console.error("Error decoding folder path:", error);
      router.push("/");
    }
  }, [searchParams, router]);

  if (isLoading || !folderPath) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return <TimelineView folderPath={folderPath} />;
}

function TimelineView({ folderPath }: { folderPath: string }) {
  useConnectedRepos(folderPath);
  const [showLoading, setShowLoading] = useState(true);
  const [focusedFile, setFocusedFile] = useState<MarkdownFileMetadata | null>(
    null,
  );
  const [showSearch, setShowSearch] = useState(false);

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

  return (
    <>
      <TitlebarHeader
        isLoadingMetadata={isLoadingMetadata}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        handleScrollToDate={handleScrollToDate}
        folderPath={folderPath}
      />

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

      <Footer folderPath={folderPath} />

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
          footerComponent={<Footer folderPath={folderPath} />}
        />
      )}
    </>
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
