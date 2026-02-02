import {
  CalendarPlusIcon,
  CopyIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import CommitFilter from "@/components/commit-filter";
import CommitOverlay from "@/components/commit-overlay";
import { CreateHabitDialog } from "@/components/create-habit-dialog";
import { DateHeader } from "@/components/date-header";
import { FileCalendar } from "@/components/file-calendar";
import type { Footer as FooterComponent } from "@/components/footer";
import { HabitOverlay } from "@/components/habit-overlay";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useCommitsForDate } from "@/hooks/use-git-queries";
import {
  useCreateTodayFile,
  useDeleteMarkdownFile,
  useFileContentManager,
  useMarkdownMetadata,
} from "@/hooks/use-markdown-queries";
import { filterCommitsForDate } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getTodayMarkdownFileName } from "@/ipc/markdown-reader";
import { useUserStore } from "@/stores/user-store";

export function FileName({
  content,
  metadata,
  folderPath,
  onDelete,
}: {
  content: string | undefined;
  metadata: MarkdownFileMetadata;
  folderPath: string;
  onDelete?: () => void;
}) {
  const fileName = metadata.fileName.split(".")[0];
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { mutateAsync: deleteFile, isPending: isDeleting } =
    useDeleteMarkdownFile(folderPath);

  const handleCopyToClipboard = async () => {
    if (!content) {
      toast.error("No content to copy");
      return;
    }
    const locationLine =
      metadata.country && metadata.city
        ? `${metadata.country}, ${metadata.city}\n\n`
        : "";
    await navigator.clipboard.writeText(
      `# ${fileName}\n\n${locationLine}${content}`,
    );
    toast.success("File content copied to clipboard");
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteFile(metadata.filePath);
      setDeleteDialogOpen(false);
      toast.success("File deleted");
      onDelete?.();
    } catch (error) {
      console.error("Failed to delete file:", error);
      toast.error("Failed to delete file");
    }
  };

  return (
    <>
      <div className="group relative flex items-center justify-end bg-transparent">
        <div className="-top-8 pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-40% via-background/30 to-80% to-background" />

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyToClipboard}
              className="relative z-10 flex items-center justify-end gap-2 font-base text-muted-foreground text-sm transition-colors hover:bg-transparent hover:text-primary"
            >
              <CopyIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              {metadata.fileName}
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={handleCopyToClipboard}
              disabled={isDeleting}
            >
              <CopyIcon className="size-4" />
              Copy content
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon className="size-4 text-destructive" />
              Delete file
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-primary">
                {metadata.fileName}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface FileCardProps {
  file: MarkdownFileMetadata;
  folderPath: string;
  onToggleFocus: () => void;
  isFocused: boolean;
  onEditorFocus: () => void;
  showSeparator: boolean;
}

export function FileCard({
  file,
  folderPath,
  onToggleFocus,
  isFocused = false,
  onEditorFocus,
  showSeparator = true,
}: FileCardProps) {
  const [createHabitOpen, setCreateHabitOpen] = useState(false);
  const activeEditingFile = useUserStore((state) => state.activeEditingFile);
  const isEditorFocused = activeEditingFile?.filePath === file.filePath;

  const {
    content,
    isLoading,
    updateContentOptimistically,
    saveContentDebounced,
    saveContentImmediate,
  } = useFileContentManager(file.filePath);

  const { data: commitsByDate = {} } = useCommitsForDate(
    folderPath,
    file.dateFromFilename,
  );

  const commits = filterCommitsForDate(commitsByDate, file.dateFromFilename);
  const hasCommits = commits.length > 0;

  const handleContentChange = (newContent: string) => {
    updateContentOptimistically(newContent);
    saveContentDebounced(newContent);
  };

  if (isLoading) {
    return (
      <div className="mt-4 flex items-center justify-center pb-8">
        <div className="text-center">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <div className="text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8 px-4">
      <DateHeader
        fileMetadata={file}
        isFocused={isFocused}
        onToggleFocus={onToggleFocus}
        folderPath={folderPath}
      />

      <MarkdownEditor
        value={content}
        onChange={handleContentChange}
        onSave={async () => await saveContentImmediate(content)}
        onFocus={onEditorFocus}
        isEditable={!isFocused}
      />

      <FileName content={content} metadata={file} folderPath={folderPath} />

      <div className="mt-2 mb-4">
        <HabitOverlay
          date={file.dateFromFilename}
          onCreateHabit={() => setCreateHabitOpen(true)}
          isFocused={isEditorFocused}
        />
      </div>

      {hasCommits && (
        <div className="mb-6">
          <CommitOverlay
            commits={commits}
            date={file.createdAt}
            className="w-full"
          />
        </div>
      )}
      {showSeparator && <Separator className="mt-2" />}
      {/* makes the last file look less awkward / squished */}
      {!showSeparator && <div className="pb-10" />}

      <CreateHabitDialog
        open={createHabitOpen}
        onOpenChange={setCreateHabitOpen}
      />
    </div>
  );
}

export function SearchButton({
  showSearch,
  setShowSearch,
}: {
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="no-drag h-8 w-[280px] justify-start gap-2 rounded-md border-border/30 bg-muted/30 px-3 font-normal text-xs backdrop-blur-sm"
      onClick={() => setShowSearch(!showSearch)}
      title="Search markdown files (Cmd/Ctrl+F)"
    >
      <MagnifyingGlassIcon className="size-4" weight="bold" />
      <span className="text-muted-foreground">Search…</span>
    </Button>
  );
}

export function HeaderActions({
  onScrollToDate,
  folderPath,
}: {
  onScrollToDate: (date: Date) => void;
  folderPath: string;
}) {
  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);
  const { mutateAsync: createToday, isPending: creatingToday } =
    useCreateTodayFile();

  const todayFileName = getTodayMarkdownFileName();
  const todayFileExists = allFilesMetadata.some(
    (file) => file.fileName === todayFileName,
  );

  return (
    <ButtonGroup className="no-drag [&_button]:no-drag rounded-md border-border/30 bg-muted/30 backdrop-blur-sm">
      {!todayFileExists && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={async () => await createToday(folderPath)}
          disabled={isLoadingMetadata || Boolean(creatingToday)}
          title="Create today's file"
        >
          <CalendarPlusIcon className="size-4" />
        </Button>
      )}
      <CommitFilter showBadges={false} />
      <FileCalendar folderPath={folderPath} onScrollToDate={onScrollToDate} />
    </ButtonGroup>
  );
}

// Legacy Header component for backwards compatibility
export function Header({
  onScrollToDate,
  folderPath,
  showSearch,
  setShowSearch,
}: {
  onScrollToDate?: (date: Date) => void;
  folderPath: string;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
}) {
  return (
    <div className="!bg-transparent flex w-full items-center justify-end gap-2">
      <SearchButton showSearch={showSearch} setShowSearch={setShowSearch} />
      {onScrollToDate && (
        <HeaderActions
          onScrollToDate={onScrollToDate}
          folderPath={folderPath}
        />
      )}
    </div>
  );
}

interface FocusedFileOverlayProps {
  file: MarkdownFileMetadata;
  folderPath: string;
  onClose: () => void;
  footerComponent: React.ReactElement<typeof FooterComponent>;
  onEditorFocus?: () => void;
}

export function FocusedFileOverlay({
  file,
  onClose,
  footerComponent,
  onEditorFocus,
  folderPath,
}: FocusedFileOverlayProps) {
  const [createHabitOpen, setCreateHabitOpen] = useState(false);

  const {
    content,
    updateContentOptimistically,
    saveContentDebounced,
    saveContentImmediate,
  } = useFileContentManager(file.filePath);

  const { data: commitsByDate = {} } = useCommitsForDate(
    folderPath || "",
    file.dateFromFilename,
    { autoRefresh: true }, // Only auto-refresh when expanded/focused
  );
  const commits = filterCommitsForDate(commitsByDate, file.dateFromFilename);

  const handleContentChange = (newContent: string) => {
    updateContentOptimistically(newContent);
    saveContentDebounced(newContent);
  };

  const handleSave = async () => {
    await saveContentImmediate(content);
  };

  return (
    <div className="fade-in fixed inset-0 z-50 flex animate-in flex-col bg-background duration-200">
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-auto px-10 pt-16">
        <DateHeader
          fileMetadata={file}
          isFocused={true}
          onToggleFocus={onClose}
          folderPath={folderPath}
        />

        <MarkdownEditor
          value={content}
          onChange={handleContentChange}
          onSave={handleSave}
          onFocus={onEditorFocus || (() => {})}
          autoFocus={true}
          isEditable={true}
        />
      </div>
      <div className="flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          <FileName
            content={content}
            metadata={file}
            folderPath={folderPath}
            onDelete={onClose}
          />

          <div className="mt-4">
            <HabitOverlay
              date={file.dateFromFilename}
              onCreateHabit={() => setCreateHabitOpen(true)}
              isFocused={true}
            />
          </div>

          {commits.length > 0 && (
            <div className="mt-4">
              <CommitOverlay
                commits={commits}
                date={file.createdAt}
                className="overflow-y-scroll"
              />
            </div>
          )}
        </div>
      </div>
      {footerComponent}

      <CreateHabitDialog
        open={createHabitOpen}
        onOpenChange={setCreateHabitOpen}
      />
    </div>
  );
}
