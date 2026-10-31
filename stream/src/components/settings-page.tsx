"use client";

import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import RepoConnector from "@/components/repo-connector";
import { Titlebar } from "@/components/titlebar-header";
import { Button } from "@/components/ui/button";
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import { useSetSelectedFolder } from "@/hooks/use-user-data";
import { useUserStore } from "@/stores/user-store";

export function SettingsPage({ folderPath }: { folderPath: string }) {
  const router = useRouter();
  const setSettingsOpen = useUserStore((state) => state.setSettingsOpen);
  const setStoredFolderPath = useUserStore((state) => state.setFolderPath);

  const { data: files = [], isLoading } = useMarkdownMetadata(folderPath);
  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);
  const { mutateAsync: fetchRepos, isPending: isFetching } =
    useFetchRepos(folderPath);
  const { mutateAsync: setSelectedFolder } = useSetSelectedFolder();

  const { data: appVersion } = useQuery<string>({
    queryKey: ["appVersion"],
    queryFn: getVersion,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSettingsOpen]);

  const handleChangeFolder = async () => {
    const selected = await open({ directory: true, multiple: false });

    if (typeof selected !== "string") {
      return;
    }

    await setSelectedFolder(selected);
    setStoredFolderPath(selected);
    setSettingsOpen(false);
    router.push(`/browse/timeline?path=${encodeURIComponent(selected)}`);
  };

  const folderName = folderPath.split("/").pop() || folderPath;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      <Titlebar
        isLoading={false}
        onBack={() => setSettingsOpen(false)}
        backLabel="Back to notes"
      />

      <main className="mx-auto mt-9 w-full max-w-2xl flex-1 overflow-y-auto pt-7 pr-7 pb-6 pl-12">
        <h1 className="font-serif text-[32px] text-heading leading-[1.1] tracking-[-0.01em]">
          Settings
        </h1>

        <section className="mt-7 flex flex-col gap-3">
          <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
            Notes folder
          </h2>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-foreground">{folderName}</span>
              <span className="truncate text-muted-foreground text-xs">
                {folderPath}
                {!isLoading && ` · ${files.length} files`}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleChangeFolder}>
              Change folder
            </Button>
          </div>
        </section>

        <section className="mt-7 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
              Git repositories
            </h2>
            {connectedRepos.length > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={async () => await fetchRepos()}
                disabled={isFetching}
              >
                {isFetching ? "Fetching..." : "Fetch all"}
              </button>
            )}
          </div>
          <RepoConnector key={folderPath} markdownDirectory={folderPath} />
        </section>

        {appVersion && (
          <p className="mt-7 text-muted-foreground text-xs">
            stream {appVersion}
          </p>
        )}
      </main>
    </div>
  );
}

export default SettingsPage;
