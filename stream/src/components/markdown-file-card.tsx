import { CopyIcon, TrashIcon } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { toast } from "sonner";
import CommitFilter from "@/components/commit-filter";
import CommitPanel from "@/components/commit-panel";
import { DateHeader } from "@/components/date-header";
import { FileCalendar } from "@/components/file-calendar";
import type { Footer as FooterComponent } from "@/components/footer";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
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
import { useAgentsForDate, useCommitsForDate } from "@/hooks/use-git-queries";
import {
  useCreateTodayFile,
  useDeleteMarkdownFile,
  useFileContentManager,
  useMarkdownMetadata,
} from "@/hooks/use-markdown-queries";
import { filterCommitsForDate } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getTodayMarkdownFileName } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { getDateKey } from "@/utils/date-utils";

const commitMountTransition = { duration: 0.18, ease: "easeOut" } as const;

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
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              onClick={handleCopyToClipboard}
              title="Copy note"
              className="hover:text-foreground"
            />
          }
        >
          {metadata.fileName}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={handleCopyToClipboard}
            disabled={isDeleting}
          >
            <CopyIcon />
            Copy content
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={isDeleting}
          >
            <TrashIcon />
            Delete file
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="text-foreground">{metadata.fileName}</span>? This
              action cannot be undone.
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
  isLast: boolean;
}

export function FileCard({
  file,
  folderPath,
  onToggleFocus,
  isFocused = false,
  onEditorFocus,
  isLast = false,
}: FileCardProps) {
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
    {
      autoRefresh: getDateKey(file.dateFromFilename) === getDateKey(new Date()),
    },
  );

  const commits = filterCommitsForDate(commitsByDate, file.dateFromFilename);
  const agents = useAgentsForDate(folderPath, file.dateFromFilename);

  const handleContentChange = (newContent: string) => {
    updateContentOptimistically(newContent);
    saveContentDebounced(newContent);
  };

  return (
    <article className={cn("relative pt-6 pr-7 pb-3 pl-12", isLast && "pb-12")}>
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-6 w-px bg-rail"
      />
      {isLoading ? (
        <div className="py-8 text-muted-foreground">Loading...</div>
      ) : (
        <>
          <DateHeader
            fileMetadata={file}
            isFocused={isFocused}
            onToggleFocus={onToggleFocus}
            folderPath={folderPath}
            fileName={
              <FileName
                content={content}
                metadata={file}
                folderPath={folderPath}
              />
            }
          />

          <MarkdownEditor
            value={content}
            onChange={handleContentChange}
            onSave={saveContentImmediate}
            onFocus={onEditorFocus}
            isEditable={!isFocused}
          />

          <CommitPanel
            commits={commits}
            agents={agents}
            date={file.dateFromFilename}
            folderPath={folderPath}
          />
        </>
      )}
    </article>
  );
}

export function SearchButton({
  showSearch,
  setShowSearch,
}: {
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
}) {
  const dragIntentRef = useRef<{
    dragging: boolean;
    x: number;
    y: number;
  } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragIntentRef.current = {
      dragging: false,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragIntent = dragIntentRef.current;
    if (!dragIntent || dragIntent.dragging) return;

    const deltaX = event.clientX - dragIntent.x;
    const deltaY = event.clientY - dragIntent.y;
    if (Math.hypot(deltaX, deltaY) < 4) return;

    dragIntent.dragging = true;
    event.preventDefault();

    try {
      void getCurrentWindow()
        .startDragging()
        .catch(() => {});
    } catch {
      // Browser previews do not expose the Tauri window API.
    }
  };

  const handlePointerUp = () => {
    window.setTimeout(() => {
      dragIntentRef.current = null;
    }, 0);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (dragIntentRef.current?.dragging) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    setShowSearch(!showSearch);
  };

  return (
    <button
      type="button"
      className="no-drag flex h-6 w-full max-w-[300px] items-center justify-between rounded-sm bg-card px-2 text-muted-foreground hover:text-foreground"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="Search markdown files (Cmd/Ctrl+F)"
    >
      <span>search</span>
      <span className="text-faint">⌘F</span>
    </button>
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
    <div className="no-drag flex shrink-0 items-center gap-3 text-muted-foreground">
      {!todayFileExists && (
        <button
          type="button"
          className="no-drag h-6 hover:text-foreground disabled:opacity-50"
          onClick={async () => await createToday(folderPath)}
          disabled={isLoadingMetadata || Boolean(creatingToday)}
          title="Create today's file"
        >
          today
        </button>
      )}
      <CommitFilter showBadges={false} />
      <FileCalendar folderPath={folderPath} onScrollToDate={onScrollToDate} />
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
  const agents = useAgentsForDate(folderPath, file.dateFromFilename);

  const handleContentChange = (newContent: string) => {
    updateContentOptimistically(newContent);
    saveContentDebounced(newContent);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={commitMountTransition}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-auto">
        <article className="relative min-h-full pt-10 pr-7 pb-3 pl-12">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-6 w-px bg-rail"
          />
          <DateHeader
            fileMetadata={file}
            isFocused={true}
            onToggleFocus={onClose}
            folderPath={folderPath}
            fileName={
              <FileName
                content={content}
                metadata={file}
                folderPath={folderPath}
                onDelete={onClose}
              />
            }
          />

          <MarkdownEditor
            value={content}
            onChange={handleContentChange}
            onSave={saveContentImmediate}
            onFocus={onEditorFocus || (() => {})}
            autoFocus={true}
            isEditable={true}
          />

          <CommitPanel
            commits={commits}
            agents={agents}
            date={file.dateFromFilename}
            folderPath={folderPath}
          />
        </article>
      </div>
      {footerComponent}
    </motion.div>
  );
}
