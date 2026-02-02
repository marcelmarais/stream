import { CalendarDotsIcon } from "@phosphor-icons/react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
  useCreateFileForDate,
  useMarkdownMetadata,
} from "@/hooks/use-markdown-queries";
import { cn } from "@/lib/utils";
import { getDateFromFilename, getDateKey } from "@/utils/date-utils";

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
        modifiers.today && "bg-accent",
      )}
      {...props}
    >
      <span className={cn(!hasFile && "text-muted-foreground opacity-40")}>
        {day.date.getDate()}
      </span>
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

interface FileCalendarProps {
  folderPath: string;
  onScrollToDate: (date: Date) => void;
}

export function FileCalendar({
  folderPath,
  onScrollToDate,
}: FileCalendarProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath);
  const { mutateAsync: createFileForDate, isPending: creatingFile } =
    useCreateFileForDate();

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

  const handleJumpToToday = () => {
    const today = new Date();

    if (hasMarkdownFile(today)) {
      onScrollToDate(today);
      setCalendarOpen(false);
    } else {
      setSelectedDate(today);
      setDialogOpen(true);
      setCalendarOpen(false);
    }
  };

  const DayButton = createDayButtonWithDots(hasMarkdownFile);

  return (
    <>
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isLoadingMetadata}
            title="Open calendar"
            className="no-drag h-8 w-8 p-0"
          >
            <CalendarDotsIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="mt-2 w-auto p-0" align="end">
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
          <div className="border-t p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleJumpToToday}
              className="w-full justify-center"
            >
              Today
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDate &&
              getDateKey(selectedDate) === getDateKey(new Date())
                ? "Create today's file?"
                : "Create file for this date?"}
            </DialogTitle>
            <DialogDescription>
              {selectedDate &&
                (getDateKey(selectedDate) === getDateKey(new Date()) ? (
                  "No file exists for today. Would you like to create one?"
                ) : (
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
                ))}
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
    </>
  );
}
