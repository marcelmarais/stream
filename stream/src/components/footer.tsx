import {
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  CircleNotchIcon,
  FileTextIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
  ListBulletsIcon,
} from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SettingsDialog from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import { useUserStore } from "@/stores/user-store";

interface FooterProps {
  folderPath: string;
}

export function Footer({ folderPath }: FooterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const settingsOpen = useUserStore((state) => state.settingsOpen);
  const setSettingsOpen = useUserStore((state) => state.setSettingsOpen);
  const setViewMode = useUserStore((state) => state.setViewMode);

  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);
  const { data: allFilesMetadata = [] } = useMarkdownMetadata(folderPath);
  const { mutateAsync: fetchRepos, isPending: isFetching } =
    useFetchRepos(folderPath);

  const fileCount = allFilesMetadata.length;
  const connectedReposCount = connectedRepos.length;

  const folderName = folderPath?.split("/").pop() || folderPath || "";

  // Determine current view mode from pathname
  const currentViewMode = pathname.includes("/timeline")
    ? "timeline"
    : pathname.includes("/calendar")
      ? "calendar"
      : "timeline";

  const handleViewModeChange = (newViewMode: "timeline" | "calendar") => {
    // Update store preference
    setViewMode(newViewMode);

    // Navigate to new route
    const pathParam = searchParams.get("path");
    if (pathParam) {
      router.push(`/browse/${newViewMode}?path=${pathParam}`);
    }
  };

  return (
    <div className="flex-shrink-0 border-border border-t bg-muted/30 px-3 py-1 text-muted-foreground text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto text-xs"
            onClick={() => router.push("/?back=true")}
            title="Click to go back to folder selection"
          >
            <FolderIcon className="size-3" />
            <span title={folderPath || undefined}>{folderName}</span>
          </Button>
          <ButtonGroup className="border-muted-foreground/20 border-l pl-2">
            <Button
              variant={currentViewMode === "timeline" ? "secondary" : "ghost"}
              size="icon"
              className="h-auto w-auto rounded-l-full border px-2 py-0.5"
              onClick={() => handleViewModeChange("timeline")}
              title="Timeline view"
            >
              <ListBulletsIcon className="size-3" weight="bold" />
            </Button>
            <Button
              variant={currentViewMode === "calendar" ? "secondary" : "ghost"}
              size="icon"
              className="h-auto w-auto rounded-r-full border px-2 py-0.5"
              onClick={() => handleViewModeChange("calendar")}
              title="Calendar view"
            >
              <CalendarBlankIcon className="size-3" weight="bold" />
            </Button>
          </ButtonGroup>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto gap-1 text-xs"
            disabled
            title="Markdown files"
          >
            <FileTextIcon className="m-0 size-3" />
            <span>{fileCount}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="group h-auto w-auto gap-1 text-xs transition-colors hover:text-foreground"
            disabled={connectedReposCount === 0 || isFetching}
            onClick={async () => await fetchRepos()}
            title={
              connectedReposCount === 0
                ? "No repositories connected"
                : "Click to fetch all repositories"
            }
          >
            {isFetching ? (
              <CircleNotchIcon className="size-3 animate-spin" />
            ) : (
              <>
                <GitBranchIcon className="size-3 group-hover:hidden" />
                <ArrowsClockwiseIcon className="hidden size-3 group-hover:block" />
              </>
            )}
            <span>{connectedReposCount}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-auto w-auto"
            onClick={() => setSettingsOpen(true)}
            title="Open settings"
          >
            <GearIcon className="size-3" />
          </Button>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
