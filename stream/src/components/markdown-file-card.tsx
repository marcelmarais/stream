import { CheckIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "framer-motion";
import { type ReactNode, useRef, useState } from "react";
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
import { useCopied } from "@/hooks/use-copied";
import { useAgentsForDate, useCommitsForDate } from "@/hooks/use-git-queries";
import {
  useCreateTodayFile,
  useDeleteMarkdownFile,
  useFileContentManager,
  useMarkdownMetadata,
} from "@/hooks/use-markdown-queries";
import { getCommitsForDate } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getTodayMarkdownFileName } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { useStatusStore } from "@/stores/status-store";
import { getDateKey } from "@/utils/date-utils";

const commitMountTransition = { duration: 0.18, ease: "easeOut" } as const;

/** Right-click menu for copying or deleting a note. */
export function NoteMenu({
  content,
  metadata,
  folderPath,
  onDelete,
  children,
}: {
  content: string | undefined;
  metadata: MarkdownFileMetadata;
  folderPath: string;
  onDelete?: () => void;
  children: ReactNode;
}) {
  const fileName = metadata.fileName.split(".")[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { copied, copy } = useCopied();
  const { mutateAsync: deleteFile, isPending: isDeleting } =
    useDeleteMarkdownFile(folderPath);

  const handleCopyToClipboard = async () => {
    const locationLine =
      metadata.country && metadata.city
        ? `${metadata.country}, ${metadata.city}\n\n`
        : "";
    try {
      await copy(`# ${fileName}\n\n${locationLine}${content}`);
    } catch (error) {
      console.error("Failed to copy note:", error);
      useStatusStore.getState().showFailure("Couldn't copy note");
    }
    setMenuOpen(false);
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteFile(metadata.filePath);
      onDelete?.();
    } catch (error) {
      console.error("Failed to delete file:", error);
      useStatusStore.getState().showFailure("Failed to delete file");
    } finally {
      // The dialog's backdrop would blur a failure in the footer
      setDeleteDialogOpen(false);
    }
  };

  return (
    <>
      {/* Stays open while the item shows that the copy worked */}
      <ContextMenu open={menuOpen || copied} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger className="w-full">{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            closeOnClick={false}
            onClick={handleCopyToClipboard}
            disabled={isDeleting || !content}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy content"}
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

  const commits = getCommitsForDate(commitsByDate, file.dateFromFilename);
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
            renderTitle={(title) => (
              <NoteMenu
                content={content}
                metadata={file}
                folderPath={folderPath}
              >
                {title}
              </NoteMenu>
            )}
          />

          <MarkdownEditor
            key={file.filePath}
            filePath={file.filePath}
            folderPath={folderPath}
            value={content}
            onChange={handleContentChange}
            onSave={saveContentImmediate}
            onDiskChange={updateContentOptimistically}
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
  const commits = getCommitsForDate(commitsByDate, file.dateFromFilename);
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
      <div data-tauri-drag-region className="drag h-9 shrink-0" />
      <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-6 w-px bg-rail"
        />
        <article className="min-h-0 flex-1 overflow-auto pt-1 pr-7 pb-6 pl-12">
          <DateHeader
            fileMetadata={file}
            isFocused={true}
            onToggleFocus={onClose}
            folderPath={folderPath}
            renderTitle={(title) => (
              <NoteMenu
                content={content}
                metadata={file}
                folderPath={folderPath}
                onDelete={onClose}
              >
                {title}
              </NoteMenu>
            )}
          />

          <MarkdownEditor
            key={file.filePath}
            filePath={file.filePath}
            folderPath={folderPath}
            value={content}
            onChange={handleContentChange}
            onSave={saveContentImmediate}
            onDiskChange={updateContentOptimistically}
            onFocus={onEditorFocus || (() => {})}
            autoFocus={true}
            isEditable={true}
          />
        </article>

        {/* Docked to the bottom edge, inside the note's margins */}
        <CommitPanel
          commits={commits}
          agents={agents}
          date={file.dateFromFilename}
          folderPath={folderPath}
          className="mr-7 ml-12 shrink-0"
          docked
        />
      </div>
      {footerComponent}
    </motion.div>
  );
}
