"use client";

import { FolderIcon } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSelectedFolder, useSetSelectedFolder } from "@/hooks/use-user-data";
import { useUserStore } from "@/stores/user-store";

export default function Home() {
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
      router.push(`/browse?path=${encodedPath}`);
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
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            stream.
          </h1>
          <p className="text-muted-foreground text-sm">
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
              className="w-full rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            >
              Open Folder
            </button>
          ) : (
            <div className="space-y-3">
              <Button
                variant="ghost"
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
                className="h-auto w-full cursor-pointer justify-start rounded-md border border-border bg-muted/50 px-3 py-3 text-muted-foreground text-sm transition-colors hover:bg-muted/70"
              >
                <div className="flex w-full items-center gap-3">
                  <FolderIcon className="size-5 flex-shrink-0" />
                  <div className="flex flex-1 flex-col items-center">
                    <div
                      className="truncate font-mono text-foreground"
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
  );
}
