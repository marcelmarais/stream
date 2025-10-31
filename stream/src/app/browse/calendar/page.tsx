"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Footer } from "@/components/footer";
import { SearchBar } from "@/components/search-bar";
import { TitlebarHeader } from "@/components/titlebar-header";
import { useConnectedRepos } from "@/hooks/use-git-queries";
import { useSearchShortcut } from "@/hooks/use-keyboard-shortcut";

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

  return <CalendarPageView folderPath={folderPath} />;
}

interface CalendarPageViewProps {
  folderPath: string;
}

function CalendarPageView({ folderPath }: CalendarPageViewProps) {
  useConnectedRepos(folderPath);
  const [showSearch, setShowSearch] = useState(false);

  useSearchShortcut(showSearch, setShowSearch);

  const handleScrollToDate = () => {
    // Placeholder for future functionality
  };

  const handleFileSelectFromSearch = () => {
    setShowSearch(false);
  };

  return (
    <>
      <TitlebarHeader
        isLoading={false}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        handleScrollToDate={handleScrollToDate}
        folderPath={folderPath}
      />

      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="text-center">
            <h2 className="mb-2 font-semibold text-2xl text-foreground">
              Feature Available Soon
            </h2>
            <p className="text-muted-foreground text-sm">
              This feature is currently in development
            </p>
          </div>
        </div>
      </div>

      <Footer folderPath={folderPath} />

      <SearchBar
        open={showSearch}
        onOpenChange={setShowSearch}
        folderPath={folderPath}
        onFileSelect={handleFileSelectFromSearch}
      />
    </>
  );
}
