import {
  Calendar as CalendarIcon,
  CalendarPlus,
  FileText,
  Folder,
  GitBranch,
  Settings,
} from "lucide-react";
import type { ComponentProps } from "react";
import { useState } from "react";
import CommitOverlay from "@/components/commit-overlay";
import { MarkdownEditor } from "@/components/markdown-editor";
import SettingsDialog from "@/components/settings-dialog";
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
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";
import type { CommitsByDate, GitCommit } from "@/utils/git-reader";
import type { MarkdownFileMetadata } from "@/utils/markdown-reader";
import { getTodayMarkdownFileName } from "@/utils/markdown-reader";

export function DateHeader({ displayDate }: { displayDate: string }) {
  return (
    <div className="mx-6 mt-8 first:mt-0">
      <h1 className="font-semibold text-4xl">{displayDate}</h1>
    </div>
  );
}

function FileName({ fileName }: { fileName: string }) {
  return (
    <div className="flex items-center justify-end">
      <h4 className="font-base text-muted-foreground text-sm">{fileName}</h4>
    </div>
  );
}

interface FileCardProps {
  file: MarkdownFileMetadata;
  content?: string;
  isLoading: boolean;
  commits: GitCommit[];
  onContentChange: (filePath: string, content: string) => void;
  onSave: (filePath: string) => void;
}

export function FileCard({
  file,
  content,
  isLoading,
  commits,
  onContentChange,
  onSave,
}: FileCardProps) {
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
    <div className="p-6">
      <MarkdownEditor
        value={content ?? ""}
        onChange={(value: string) => onContentChange(file.filePath, value)}
        onSave={() => onSave(file.filePath)}
      />

      <FileName fileName={file.fileName} />
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
  );
}

interface FileReaderFooterProps {
  folderPath: string;
  fileCount: number;
  connectedReposCount: number;
  onFolderClick: () => void;
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  commitsByDate: CommitsByDate;
  commitError: string | null;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

export function FileReaderFooter({
  folderPath,
  fileCount,
  connectedReposCount,
  onFolderClick,
  isLoadingMetadata,
  allFilesMetadata,
  commitsByDate,
  commitError,
  settingsOpen,
  onSettingsOpenChange,
}: FileReaderFooterProps) {
  const folderName = folderPath.split("/").pop() || folderPath;

  return (
    <div className="flex-shrink-0 border-border border-t bg-muted/30 px-4 py-1 text-muted-foreground text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto text-xs"
            onClick={onFolderClick}
            title="Click to go back to folder selection"
          >
            <Folder className="size-3" />
            <span title={folderPath}>{folderName}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto text-xs"
            disabled
            title="Click to open settings"
          >
            <FileText className="size-3" />
            <span>
              {fileCount} markdown file{fileCount === 1 ? "" : "s"}
            </span>
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto text-xs"
            disabled
            title="Connected repositories"
          >
            <GitBranch className="size-3" />
            <span>
              {connectedReposCount} repo{connectedReposCount === 1 ? "" : "s"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-1"
            onClick={() => onSettingsOpenChange(true)}
            title="Open settings"
          >
            <Settings className="size-3" />
          </Button>
        </div>
      </div>
      <SettingsDialog
        folderPath={folderPath}
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        commitsByDate={commitsByDate}
        commitError={commitError}
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
      />
    </div>
  );
}

interface FileReaderHeaderProps {
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  error: string | null;
  onCreateToday: () => void | Promise<void>;
  creatingToday?: boolean;
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
  isLoadingMetadata,
  allFilesMetadata,
  onCreateToday,
  creatingToday,
  onScrollToDate,
}: {
  isLoadingMetadata: boolean;
  allFilesMetadata: MarkdownFileMetadata[];
  onCreateToday: () => void | Promise<void>;
  creatingToday?: boolean;
  onScrollToDate: (date: Date) => void;
}) {
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
            onClick={onCreateToday}
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
  isLoadingMetadata,
  allFilesMetadata,
  error,
  onCreateToday,
  creatingToday,
  onScrollToDate,
}: FileReaderHeaderProps) {
  return (
    <div className="!bg-transparent flex-shrink-0">
      <HeaderNavigation
        isLoadingMetadata={isLoadingMetadata}
        allFilesMetadata={allFilesMetadata}
        onCreateToday={onCreateToday}
        creatingToday={creatingToday}
        onScrollToDate={onScrollToDate}
      />

      {error && <ErrorDisplay error={error} />}
    </div>
  );
}
