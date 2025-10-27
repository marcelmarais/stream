import {
  CalendarDotsIcon,
  CalendarPlusIcon,
  CopyIcon,
} from "@phosphor-icons/react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import CommitOverlay from "@/components/commit-overlay";
import { DateHeader } from "@/components/date-header";
import type { Footer as FooterComponent } from "@/components/footer";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar, type CalendarDayButton } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useCommitsForDate } from "@/hooks/use-git-queries";
import {
  useCreateFileForDate,
  useCreateTodayFile,
  useFileContentManager,
  useMarkdownMetadata,
} from "@/hooks/use-markdown-queries";
import { filterCommitsForDate } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getTodayMarkdownFileName } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";

export function FileName({
  content,
  metadata,
}: {
  content: string | undefined;
  metadata: MarkdownFileMetadata;
}) {
  const fileName = metadata.fileName.split(".")[0];
  const handleCopyToClipboard = async () => {
    if (!content) {
      toast.error("No content to copy");
      return;
    }
    await navigator.clipboard.writeText(
      `# ${fileName}\n\n${metadata.country}, ${metadata.city}\n\n${content}`,
    );
    toast.success("File content copied to clipboard");
  };

  return (
    <div className="group relative flex items-center justify-end bg-transparent">
      <div className="-top-8 pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-40% via-background/30 to-80% to-background" />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopyToClipboard}
        className="relative z-10 flex items-center justify-end gap-2 font-base text-muted-foreground text-sm transition-colors hover:bg-transparent hover:text-primary"
      >
        <CopyIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
        {metadata.fileName}
      </Button>
    </div>
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
      autoRefresh: true,
    },
  );

  const commits = filterCommitsForDate(commitsByDate, file.dateFromFilename);

  const handleContentChange = (newContent: string) => {
    updateContentOptimistically(newContent);
    saveContentDebounced(newContent);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center pt-4 pb-8">
        <div className="text-center">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <div className="text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>
    );
  }
  return (
    <div className="px-4 pt-8">
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

      <FileName content={content} metadata={file} />
      {commits.length > 0 && (
        <div className="mt-2">
          <CommitOverlay
            commits={commits}
            date={file.createdAt}
            className="w-full"
          />
        </div>
      )}
      {showSeparator && <Separator className="mt-12" />}
    </div>
  );
}

function CustomDayButton({
  day,
  modifiers,
  hasFile,
  ...props
}: ComponentProps<typeof CalendarDayButton> & { hasFile: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative h-9 w-9 p-0 font-normal",
        modifiers.selected &&
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        modifiers.today && "bg-accent text-accent-foreground",
      )}
      {...props}
    >
      <span>{day.date.getDate()}</span>
      {hasFile && (
        <span className="-translate-x-1/2 absolute bottom-1 left-1/2 h-1 w-1 rounded-full bg-primary" />
      )}
    </Button>
  );
}

function createDayButtonWithDots(hasMarkdownFile: (date: Date) => boolean) {
  return (props: ComponentProps<typeof CalendarDayButton>) => {
    const hasFile = hasMarkdownFile(props.day.date);
    return <CustomDayButton {...props} hasFile={hasFile} />;
  };
}

export function Header({
  onScrollToDate,
  folderPath,
}: {
  onScrollToDate: (date: Date) => void;
  folderPath: string;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);
  const { mutateAsync: createToday, isPending: creatingToday } =
    useCreateTodayFile();
  const { mutateAsync: createFileForDate, isPending: creatingFile } =
    useCreateFileForDate();

  const todayFileName = getTodayMarkdownFileName();
  const todayFileExists = allFilesMetadata.some(
    (file) => file.fileName === todayFileName,
  );

  const datesWithFiles = new Set(
    allFilesMetadata.map((file) => {
      const dateFromFilename = getDateFromFilename(file.fileName);
      if (dateFromFilename) {
        return dateFromFilename;
      }

      return getDateKey(new Date(file.createdAt));
    }),
  );

  const hasMarkdownFile = (date: Date) => {
    const key = getDateKey(date);
    return datesWithFiles.has(key);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;

    if (hasMarkdownFile(date)) {
      onScrollToDate(date);
      setCalendarOpen(false);
      return;
    }

    setSelectedDate(date);
    setDialogOpen(true);
    setCalendarOpen(false);
  };

  const handleCreateFile = async () => {
    if (!selectedDate) return;

    try {
      await createFileForDate({ folderPath, date: selectedDate });
      setDialogOpen(false);

      // Give query time to refetch, then scroll
      setTimeout(() => onScrollToDate(selectedDate), 300);
    } catch (error) {
      console.error("Failed to create file:", error);
    }
  };

  const DayButton = createDayButtonWithDots(hasMarkdownFile);

  return (
    <div className="!bg-transparent flex-shrink-0">
      <div className="flex items-center justify-end">
        <ButtonGroup>
          {!todayFileExists && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => await createToday(folderPath)}
              disabled={isLoadingMetadata || Boolean(creatingToday)}
            >
              <CalendarPlusIcon className="size-4" />
            </Button>
          )}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isLoadingMetadata}
              >
                <CalendarDotsIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                onSelect={handleDateSelect}
                defaultMonth={new Date()}
                captionLayout="dropdown"
                components={{
                  DayButton,
                }}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </ButtonGroup>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create file for this date?</DialogTitle>
            <DialogDescription>
              {selectedDate && (
                <>
                  Would you like to create a file for{" "}
                  {selectedDate.toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  ?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={creatingFile}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateFile}
              disabled={creatingFile}
            >
              {creatingFile ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    { autoRefresh: true },
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
          <FileName content={content} metadata={file} />
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
    </div>
  );
}
