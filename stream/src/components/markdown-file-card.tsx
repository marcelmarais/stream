import {
  CalendarDotsIcon,
  CalendarPlusIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  MapPinIcon,
  PenIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import CommitOverlay from "@/components/commit-overlay";
import type { Footer as FooterComponent } from "@/components/footer";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar, type CalendarDayButton } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useCommitsForDate } from "@/hooks/use-git-queries";
import {
  useCreateTodayFile,
  useFileContentManager,
  useMarkdownMetadata,
  useUpdateFileLocation,
} from "@/hooks/use-markdown-queries";
import { getCommitsForDate } from "@/ipc/git-reader";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { getTodayMarkdownFileName } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/user-store";
import {
  formatDisplayDate,
  getDateFromFilename,
  getDateKey,
} from "@/utils/date-utils";

export function DateHeader({
  displayDate,
  isFocused,
  onToggleFocus,
  country,
  city,
  filePath,
  folderPath,
}: {
  displayDate: string;
  isFocused: boolean;
  onToggleFocus: () => void;
  country?: string;
  city?: string;
  filePath: string;
  folderPath: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editCity, setEditCity] = useState(city || "");
  const [editCountry, setEditCountry] = useState(country || "");

  const cityMirrorRef = useRef<HTMLSpanElement>(null);
  const countryMirrorRef = useRef<HTMLSpanElement>(null);
  const [cityWidthPx, setCityWidthPx] = useState<number>(0);
  const [countryWidthPx, setCountryWidthPx] = useState<number>(0);

  const { mutate: updateLocation, isPending } =
    useUpdateFileLocation(folderPath);

  const handleStartEdit = () => {
    setEditCity(city || "");
    setEditCountry(country || "");
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditCity(city || "");
    setEditCountry(country || "");
  };

  const handleSave = () => {
    const trimmedCity = editCity.trim();
    const trimmedCountry = editCountry.trim();

    if (!trimmedCity || !trimmedCountry) {
      toast.error("Both city and country are required");
      return;
    }

    updateLocation(
      {
        filePath,
        country: trimmedCountry,
        city: trimmedCity,
      },
      {
        onSuccess: () => {
          setIsEditing(false);
          toast.success("Location updated");
        },
        onError: () => {
          toast.error("Failed to update location");
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  const updateMeasuredWidths = useCallback(() => {
    const cityMeasured = (cityMirrorRef.current?.offsetWidth || 0) - 2; // small buffer for caret
    const countryMeasured = (countryMirrorRef.current?.offsetWidth || 0) + 2;
    setCityWidthPx(cityMeasured);
    setCountryWidthPx(countryMeasured);
  }, [editCity, editCountry, isEditing]);

  useLayoutEffect(() => {
    updateMeasuredWidths();
  }, [updateMeasuredWidths]);

  useEffect(() => {
    const onResize = () => updateMeasuredWidths();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateMeasuredWidths]);

  return (
    <div className="flex flex-col items-start gap-2.5 pb-2">
      <button
        type="button"
        className="group flex w-full items-center justify-start gap-3 bg-transparent p-0 hover:bg-transparent"
        onClick={onToggleFocus}
      >
        <h1 className="m-0 line-clamp-1 min-w-0 flex-shrink-0 cursor-pointer text-left font-semibold text-4xl text-muted-foreground/90 transition-colors group-hover:text-muted-foreground">
          {displayDate}
        </h1>
        {isFocused ? (
          <EyeSlashIcon className="size-4 text-muted-foreground/50" />
        ) : (
          <EyeIcon className="size-4 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>
      <div className="group flex items-center justify-start gap-1">
        <MapPinIcon
          className={cn(
            "size-3.5 flex-shrink-0 text-muted-foreground/60 group-hover:hidden",
            isEditing && "hidden",
          )}
        />
        <PenIcon
          className={cn(
            "hidden size-3.5 flex-shrink-0 text-muted-foreground/60 group-hover:block",
            isEditing && "block",
          )}
        />
        <div className="relative flex items-center text-sm">
          {/* Hidden mirrors to measure text width precisely */}
          <span
            ref={cityMirrorRef}
            aria-hidden
            style={{
              // Match input typography for accurate measurement
              position: "absolute",
              zIndex: -1,
              visibility: "hidden",
              whiteSpace: "pre",
              font: "inherit",
              padding: 0,
              border: 0,
            }}
          >
            {`${editCity || "City"} `}
          </span>
          <span
            ref={countryMirrorRef}
            aria-hidden
            style={{
              position: "absolute",
              zIndex: -1,
              visibility: "hidden",
              whiteSpace: "pre",
              font: "inherit",
              padding: 0,
              border: 0,
            }}
          >
            {`${editCountry || "Country"} `}
          </span>
          <Input
            value={editCity}
            onChange={(e) => setEditCity(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={!isEditing ? handleStartEdit : undefined}
            placeholder="City"
            style={{ width: cityWidthPx ? `${cityWidthPx}px` : undefined }}
            className="m-0 h-6 min-w-0 cursor-text border-none bg-transparent p-0 text-muted-foreground/60 text-sm shadow-none transition-colors placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-100 dark:bg-transparent"
            autoFocus={isEditing}
            disabled={isPending}
            readOnly={!isEditing}
          />
          <span className="text-muted-foreground/60 text-sm">,&nbsp;</span>
          <Input
            value={editCountry}
            onChange={(e) => setEditCountry(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={!isEditing ? handleStartEdit : undefined}
            placeholder="Country"
            style={{
              width: countryWidthPx ? `${countryWidthPx}px` : undefined,
            }}
            className="m-0 h-6 min-w-0 cursor-text border-none bg-transparent p-0 text-muted-foreground/60 text-sm shadow-none transition-colors placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-100 dark:bg-transparent"
            disabled={isPending}
            readOnly={!isEditing}
          />
        </div>
        {isEditing && (
          <div className="ml-1 flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/60"
              onClick={handleSave}
              disabled={isPending}
            >
              <CheckIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/60"
              onClick={handleCancel}
              disabled={isPending}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

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

  const dateKey = getDateKey(file.dateFromFilename);
  const { data: commitsByDate = {} } = useCommitsForDate(folderPath, dateKey, {
    autoRefresh: true,
  });

  const commits = getCommitsForDate(commitsByDate, file.dateFromFilename);

  const displayDate = formatDisplayDate(file.dateFromFilename);

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
        displayDate={displayDate}
        isFocused={isFocused}
        onToggleFocus={onToggleFocus}
        country={file.country}
        city={file.city}
        filePath={file.filePath}
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
  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);
  const { mutateAsync: createToday, isPending: creatingToday } =
    useCreateTodayFile();

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
    if (date && hasMarkdownFile(date)) {
      onScrollToDate(date);
      setCalendarOpen(false);
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
    </div>
  );
}

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
  const {
    content,
    updateContentOptimistically,
    saveContentDebounced,
    saveContentImmediate,
  } = useFileContentManager(file.filePath);

  const folderPath = useUserStore((state) => state.folderPath);
  const displayDate = formatDisplayDate(file.dateFromFilename);

  const dateKey = getDateKey(file.dateFromFilename);
  const { data: commitsByDate = {} } = useCommitsForDate(
    folderPath || "",
    dateKey,
    { autoRefresh: true },
  );

  const commits = getCommitsForDate(commitsByDate, file.dateFromFilename);

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
          displayDate={displayDate}
          isFocused={true}
          onToggleFocus={onClose}
          country={file.country}
          city={file.city}
          filePath={file.filePath}
          folderPath={folderPath || ""}
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
