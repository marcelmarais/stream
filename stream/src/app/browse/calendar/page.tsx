"use client";

import { CalendarPlusIcon, FileTextIcon } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Footer } from "@/components/footer";
import { SearchBar } from "@/components/search-bar";
import { TitlebarHeader } from "@/components/titlebar-header";
import { Button } from "@/components/ui/button";
import { CalendarView } from "@/components/views/calendar";
import { useConnectedRepos } from "@/hooks/use-git-queries";
import { useSearchShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  useCreateTodayFile,
  useMarkdownMetadata,
} from "@/hooks/use-markdown-queries";

export default function CalendarPage() {
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

    const decodedPath = decodeURIComponent(pathParam);
    setFolderPath(decodedPath);
    setIsLoading(false);
  }, [searchParams, router]);

  if (isLoading || !folderPath) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen">
      <CalendarPageView folderPath={folderPath} />
    </div>
  );
}

interface CalendarPageViewProps {
  folderPath: string;
}

function CalendarPageView({ folderPath }: CalendarPageViewProps) {
  useConnectedRepos(folderPath);
  const [showLoading, setShowLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);

  useSearchShortcut(showSearch, setShowSearch);

  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);

  const handleScrollToDate = () => {
    // Calendar view specific scroll handling can be implemented here
    // For now, this is a placeholder
  };

  const handleFileSelectFromSearch = () => {
    // Calendar view specific file selection can be implemented here
    setShowSearch(false);
  };

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
    <div className="flex h-screen flex-col overflow-hidden rounded-lg bg-background">
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

      <div className="mt-12">
        {!isLoadingMetadata && allFilesMetadata.length === 0 ? (
          <EmptyState folderPath={folderPath} />
        ) : (
          !isLoadingMetadata && (
            <CalendarView
              folderPath={folderPath}
              footerComponent={<Footer folderPath={folderPath} />}
            />
          )
        )}

        <Footer folderPath={folderPath} />
      </div>

      <SearchBar
        open={showSearch}
        onOpenChange={setShowSearch}
        folderPath={folderPath}
        onFileSelect={handleFileSelectFromSearch}
      />
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
