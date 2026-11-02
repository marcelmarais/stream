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
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Titlebar isLoading={false} />
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8 pt-9">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="cursor-default select-none font-serif text-[32px] text-heading">
              stream.
            </h1>
            <p className="cursor-default select-none text-muted-foreground">
              Select a folder to get started
            </p>
          </div>

          <div className="space-y-4">
            {!selectedFolder ? (
              <button
                type="button"
                onClick={async () => {
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
                }}
                className="h-8 w-full rounded-sm bg-primary px-3 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/80"
              >
                Open Folder
              </button>
            ) : (
              <div className="space-y-3">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const { open } = await import(
                        "@tauri-apps/plugin-dialog"
                      );
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
                  }}
                  className="h-auto w-full justify-start border-well-rule bg-well px-3 py-2.5 text-muted-foreground"
                >
                  <div className="flex w-full min-w-0 items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col items-center">
                      <div
                        className="max-w-full truncate text-foreground"
                        title={selectedFolder}
                      >
                        {selectedFolder}
                      </div>
                      <div className="mt-1 text-muted-foreground text-xs">
                        Click to change
                      </div>
                    </div>
                  </div>
                </Button>
                <Button onClick={handleContinue} className="w-full">
                  Open
                </Button>
              </div>
            )}
          </div>
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
            <div className="animate-pulse text-muted-foreground">
              Loading...
            </div>
          </div>
        </>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
