"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { StatusFooter } from "@/components/footer";
import { Titlebar } from "@/components/titlebar-header";
import { Button } from "@/components/ui/button";
import { useSelectedFolder, useSetSelectedFolder } from "@/hooks/use-user-data";
import { useUserStore } from "@/stores/user-store";

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Disable auto-navigate if coming back from browse page
  const autoNavigate = searchParams.get("back") !== "true";

  const [localSelectedFolder, setLocalSelectedFolder] = useState<string | null>(
    null,
  );
  const setFolderPath = useUserStore((state) => state.setFolderPath);

  const { data: persistedFolder, isLoading } = useSelectedFolder();
  const setSelectedFolderMutation = useSetSelectedFolder();

  // Auto-navigate to the persisted folder if available
  useEffect(() => {
    if (!isLoading && persistedFolder && autoNavigate) {
      setLocalSelectedFolder(persistedFolder);
      setFolderPath(persistedFolder);
      // Navigate to browse page with encoded folder path
      const encodedPath = encodeURIComponent(persistedFolder);
      router.push(`/browse/timeline?path=${encodedPath}`);
    } else if (!isLoading && persistedFolder) {
      setLocalSelectedFolder(persistedFolder);
    }
  }, [persistedFolder, isLoading, autoNavigate, setFolderPath, router]);

  const handleFolderSelected = async (folderPath: string) => {
    setLocalSelectedFolder(folderPath);
    await setSelectedFolderMutation.mutateAsync(folderPath);
  };

  const handleContinue = () => {
    if (localSelectedFolder) {
      setFolderPath(localSelectedFolder);
      // Navigate to browse page with encoded folder path
      const encodedPath = encodeURIComponent(localSelectedFolder);
      router.push(`/browse?path=${encodedPath}`);
    }
  };

  const selectedFolder = localSelectedFolder || persistedFolder;

  if (isLoading) {
    return (
      <>
        <Titlebar isLoading={true} />
        <div className="flex min-h-screen items-center justify-center pt-9">
          <div className="animate-pulse text-faint">Loading…</div>
        </div>
      </>
    );
  }

  const pickFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const folderPath = await open({
        directory: true,
        multiple: false,
      });

      if (folderPath && typeof folderPath === "string") {
        handleFolderSelected(folderPath);
      }
    } catch (error) {
      console.error("Error opening folder picker:", error);
    }
  };

  const folderName = selectedFolder?.split("/").pop() || selectedFolder;

  return (
    <>
      <Titlebar isLoading={false} />
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-8 pt-9 pb-16">
        <div className="flex w-full max-w-sm flex-col items-center gap-10 text-center">
          <div className="flex cursor-default select-none flex-col items-center gap-3">
            <h1 className="font-serif text-[48px] text-heading leading-none tracking-[-0.025em]">
              stream<span className="text-primary">.</span>
            </h1>
            <p className="max-w-[32ch] font-sans text-muted-foreground text-prose">
              Daily notes for engineers. Your commits, pull requests and agents
              show up under each day.
            </p>
          </div>

          {!selectedFolder ? (
            <Button onClick={pickFolder} className="h-9 w-full text-[13px]">
              Choose a notes folder
            </Button>
          ) : (
            <div className="flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={pickFolder}
                className="group flex w-full items-center gap-3 rounded-[7px] border border-well-rule bg-well px-4 py-3 text-left transition-colors hover:border-rail"
                title={selectedFolder}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-sans text-[14px] text-foreground">
                    {folderName}
                  </span>
                  <span className="truncate text-faint text-meta">
                    {selectedFolder}
                  </span>
                </span>
                <span className="shrink-0 text-meta text-muted-foreground transition-colors group-hover:text-foreground">
                  change
                </span>
              </button>
              <Button
                onClick={handleContinue}
                className="h-9 w-full text-[13px]"
              >
                Open notes
              </Button>
            </div>
          )}
        </div>
      </div>
      <StatusFooter />
    </>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <>
          <Titlebar isLoading={true} />
          <div className="flex min-h-screen items-center justify-center pt-9">
            <div className="animate-pulse text-faint">Loading…</div>
          </div>
        </>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
