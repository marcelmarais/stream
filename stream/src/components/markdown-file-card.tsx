import {
  Calendar as CalendarIcon,
  CalendarPlus,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import CommitOverlay from "@/components/commit-overlay";
import type { Footer as FooterComponent } from "@/components/footer";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar, type CalendarDayButton } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useGitCommitsStore } from "@/stores/git-commits-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";
import {
  formatDisplayDate,
  getDateFromFilename,
  getDateKey,
} from "@/utils/date-utils";
import { filterCommits, getCommitsForDate } from "@/utils/git-reader";
import type { MarkdownFileMetadata } from "@/utils/markdown-reader";
import { getTodayMarkdownFileName } from "@/utils/markdown-reader";

export function DateHeader({
  displayDate,
  isFocused,
  onToggleFocus,
}: {
  displayDate: string;
  isFocused: boolean;
  onToggleFocus: () => void;
}) {
  return (
    <Button
      className="group m-0 flex items-center justify-center gap-3 bg-transparent p-0 hover:bg-transparent"
      variant="default"
      onClick={onToggleFocus}
    >
      <h1 className="cursor-pointer font-semibold text-4xl text-muted-foreground/90 transition-colors group-hover:text-muted-foreground">
        {displayDate}
      </h1>
      {isFocused ? (
        <EyeOff className="size-4 text-muted-foreground/50" />
      ) : (
        <Eye className="size-4 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </Button>
  );
}

export function FileName({
  fileName,
  content,
}: {
  fileName: string;
  content: string | undefined;
}) {
  const handleCopyToClipboard = async () => {
    if (!content) {
      toast.error("No content to copy");
      return;
    }
    await navigator.clipboard.writeText(content);
    toast.success("File content copied to clipboard");
  };

  return (
    <div className="group relative flex items-center justify-end bg-transparent">
      {/* Gradient fade effect */}
      <div className="-top-8 pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-40% via-background/30 to-80% to-background" />

      {/* Button content */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopyToClipboard}
        className="relative z-10 flex items-center justify-end gap-2 font-base text-muted-foreground text-sm transition-colors hover:bg-transparent hover:text-primary"
      >
        <Copy className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
        {fileName}
      </Button>
    </div>
  );
}

interface FileCardProps {
  file: MarkdownFileMetadata;
  onToggleFocus?: () => void;
  isFocused?: boolean;
  onEditorFocus?: () => void;
}

export function FileCard({
  file,
  onToggleFocus,
  isFocused = false,
  onEditorFocus,
}: FileCardProps) {
  // Get data from markdown files store
  const loadedContent = useMarkdownFilesStore((state) => state.loadedContent);
  const loadingFiles = useMarkdownFilesStore((state) => state.loadingFiles);
  const updateContent = useMarkdownFilesStore(
    (state) => state.updateContentOptimistically,
  );
  const saveDebounced = useMarkdownFilesStore(
    (state) => state.saveFileContentDebounced,
  );
  const saveImmediate = useMarkdownFilesStore((state) => state.saveFileContent);

  // Get data from git commits store
  const commitsByDate = useGitCommitsStore((state) => state.commitsByDate);
  const commitFilters = useGitCommitsStore((state) => state.commitFilters);

  // Compute locally
  const content = loadedContent.get(file.filePath);
  const isLoading = !content && loadingFiles.has(file.filePath);

  // Get commits for this file's date
  const dateFromFilename = getDateFromFilename(file.fileName);
  const fileDate = dateFromFilename
    ? new Date(dateFromFilename)
    : file.createdAt;
  const allFileCommits = getCommitsForDate(commitsByDate, fileDate);
  const commits = filterCommits(allFileCommits, commitFilters);

  // Calculate display date for the header
  const dateStr = dateFromFilename || getDateKey(file.createdAt);
  const displayDate = formatDisplayDate(dateStr);

  // Handlers
  const handleContentChange = (newContent: string) => {
    updateContent(file.filePath, newContent);
    saveDebounced(file.filePath, newContent);
  };

  const handleSave = async () => {
    const currentContent = loadedContent.get(file.filePath);
    if (currentContent) {
      await saveImmediate(file.filePath, currentContent);
    }
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
    <div>
      <DateHeader
        displayDate={displayDate}
        isFocused={isFocused}
        onToggleFocus={onToggleFocus || (() => {})}
      />
      <div className="p-6">
        <MarkdownEditor
          value={content ?? ""}
          onChange={handleContentChange}
          onSave={handleSave}
          onFocus={onEditorFocus || (() => {})}
          isEditable={!isFocused}
        />

        <FileName fileName={file.fileName} content={content} />
        {commits.length > 0 && (
          <div className="mt-4">
            <CommitOverlay
              commits={commits}
              date={file.createdAt}
              className="w-full"
            />
          </div>
        )}
        <Separator className="mt-12" />
      </div>
    </div>
  );
}

interface FileReaderHeaderProps {
  folderPath: string;
  onScrollToDate: (date: Date) => void;
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

export function HeaderNavigation({
  folderPath,
  onScrollToDate,
}: {
  folderPath: string;
  onScrollToDate: (date: Date) => void;
}) {
  // Get data from stores
  const isLoadingMetadata = useMarkdownFilesStore(
    (state) => state.isLoadingMetadata,
  );
  const allFilesMetadata = useMarkdownFilesStore(
    (state) => state.allFilesMetadata,
  );
  const creatingToday = useMarkdownFilesStore((state) => state.creatingToday);
  const createTodayFile = useMarkdownFilesStore(
    (state) => state.createTodayFile,
  );

  const handleCreateToday = async () => {
    await createTodayFile(folderPath);
  };
  const [calendarOpen, setCalendarOpen] = useState(false);

  const todayFileName = getTodayMarkdownFileName();
  const todayFileExists = allFilesMetadata.some(
    (file) => file.fileName === todayFileName,
  );

  // Get dates that have markdown files (use filename date if available, otherwise fall back to createdAt)
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
    if (date && hasMarkdownFile(date)) {
      onScrollToDate(date);
      setCalendarOpen(false);
    }
  };

  const DayButton = createDayButtonWithDots(hasMarkdownFile);

  return (
    <div className="flex items-center justify-end">
      <ButtonGroup>
        {!todayFileExists && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleCreateToday}
            disabled={isLoadingMetadata || Boolean(creatingToday)}
          >
            <CalendarPlus className="size-4" />
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
              <CalendarIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              onSelect={handleDateSelect}
              disabled={(date) => !hasMarkdownFile(date)}
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
  );
}

// Error display component
function ErrorDisplay({ error }: { error: string }) {
  return (
    <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
      {error}
    </div>
  );
}

// Main header component that combines all sub-components
export function FileReaderHeader({
  folderPath,
  onScrollToDate,
}: FileReaderHeaderProps) {
  // Get error from store
  const error = useMarkdownFilesStore((state) => state.error);

  return (
    <div className="!bg-transparent flex-shrink-0">
      <HeaderNavigation
        folderPath={folderPath}
        onScrollToDate={onScrollToDate}
      />

      {error && <ErrorDisplay error={error} />}
    </div>
  );
}

// Focused file overlay component
interface FocusedFileOverlayProps {
  file: MarkdownFileMetadata;
  onClose: () => void;
  footerComponent: React.ReactElement<typeof FooterComponent>;
  onEditorFocus?: () => void;
}

export function FocusedFileOverlay({
  file,
  onClose,
  footerComponent,
  onEditorFocus,
}: FocusedFileOverlayProps) {
  // Get data from markdown files store
  const loadedContent = useMarkdownFilesStore((state) => state.loadedContent);
  const updateContent = useMarkdownFilesStore(
    (state) => state.updateContentOptimistically,
  );
  const saveDebounced = useMarkdownFilesStore(
    (state) => state.saveFileContentDebounced,
  );
  const saveImmediate = useMarkdownFilesStore((state) => state.saveFileContent);

  // Get data from git commits store
  const commitsByDate = useGitCommitsStore((state) => state.commitsByDate);
  const commitFilters = useGitCommitsStore((state) => state.commitFilters);

  // Compute date and display
  const dateFromFilename = getDateFromFilename(file.fileName);
  const dateStr = dateFromFilename || getDateKey(file.createdAt);
  const displayDate = formatDisplayDate(dateStr);
  const fileDate = dateFromFilename
    ? new Date(dateFromFilename)
    : file.createdAt;

  // Get commits for this file's date
  const allFileCommits = getCommitsForDate(commitsByDate, fileDate);
  const commits = filterCommits(allFileCommits, commitFilters);

  // Get content
  const content = loadedContent.get(file.filePath);

  // Handlers
  const handleContentChange = (newContent: string) => {
    updateContent(file.filePath, newContent);
    saveDebounced(file.filePath, newContent);
  };

  const handleSave = async () => {
    const currentContent = loadedContent.get(file.filePath);
    if (currentContent) {
      await saveImmediate(file.filePath, currentContent);
    }
  };

  return (
    <div className="fade-in fixed inset-0 z-50 flex animate-in flex-col bg-background duration-200">
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-auto px-6 pt-16">
        <DateHeader
          displayDate={displayDate}
          isFocused={true}
          onToggleFocus={onClose}
        />
        <div className="p-6">
          <MarkdownEditor
            value={content ?? ""}
            onChange={handleContentChange}
            onSave={handleSave}
            onFocus={onEditorFocus || (() => {})}
            autoFocus={true}
            isEditable={true}
          />
        </div>
      </div>
      <div className="flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          <FileName fileName={file.fileName} content={content} />
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
