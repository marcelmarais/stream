import { CheckIcon, EyeIcon, EyeSlashIcon, XIcon } from "@phosphor-icons/react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAutoFillLocation,
  useUpdateFileLocation,
} from "@/hooks/use-markdown-queries";
import {
  getNearestEarlierLocation,
  type MarkdownFileMetadata,
  resolveCurrentLocation,
} from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { formatDayTitle, getDateKey } from "@/utils/date-utils";

export function DateHeader({
  isFocused,
  onToggleFocus,
  fileMetadata,
  folderPath,
  renderTitle,
}: {
  isFocused: boolean;
  onToggleFocus: () => void;
  fileMetadata: MarkdownFileMetadata;
  folderPath: string;
  /** Wraps the day title, e.g. in the note's context menu */
  renderTitle: (title: ReactElement) => ReactNode;
}) {
  const dayTitle = formatDayTitle(fileMetadata.dateFromFilename);
  const isToday =
    getDateKey(fileMetadata.dateFromFilename) === getDateKey(new Date());
  const city = fileMetadata.city || "";
  const country = fileMetadata.country || "";
  const [isEditing, setIsEditing] = useState(false);
  const [editCity, setEditCity] = useState(city);
  const [editCountry, setEditCountry] = useState(country);
  const [isDetecting, setIsDetecting] = useState(false);
  const prefillRequest = useRef(0);

  const shownCity = isEditing ? editCity : city;
  const shownCountry = isEditing ? editCountry : country;
  const cityPlaceholder = isDetecting ? "Locating" : "City";
  const countryPlaceholder = isDetecting ? "…" : "Country";

  const cityMirrorRef = useRef<HTMLSpanElement>(null);
  const countryMirrorRef = useRef<HTMLSpanElement>(null);
  const [cityWidthPx, setCityWidthPx] = useState<number>(0);
  const [countryWidthPx, setCountryWidthPx] = useState<number>(0);

  const { mutate: updateLocation, isPending } =
    useUpdateFileLocation(folderPath);

  useAutoFillLocation(
    folderPath,
    fileMetadata.filePath,
    isToday && !city && !country,
  );

  const stopPrefill = () => {
    prefillRequest.current += 1;
    setIsDetecting(false);
  };

  const prefillLocation = async () => {
    prefillRequest.current += 1;
    const request = prefillRequest.current;
    setIsDetecting(true);

    const suggestion = isToday
      ? await resolveCurrentLocation(folderPath)
      : await getNearestEarlierLocation(folderPath, fileMetadata.filePath);

    if (request !== prefillRequest.current) return;
    setIsDetecting(false);

    if (suggestion) {
      setEditCity((current) => current || suggestion.city);
      setEditCountry((current) => current || suggestion.country);
    } else if (isToday) {
      toast.error(
        "Couldn't detect your location. Check Location Services in System Settings.",
      );
    }
  };

  const handleStartEdit = () => {
    setEditCity(city);
    setEditCountry(country);
    setIsEditing(true);

    if (!city && !country) {
      void prefillLocation();
    }
  };

  const handleCancel = () => {
    stopPrefill();
    setIsEditing(false);
    setEditCity(city);
    setEditCountry(country);
  };

  const handleSave = () => {
    const trimmedCity = editCity.trim();
    const trimmedCountry = editCountry.trim();

    if (!trimmedCity || !trimmedCountry) {
      toast.error("Both city and country are required");
      return;
    }

    // Saving unchanged values would turn an automatic location into a manual one.
    if (trimmedCity === city && trimmedCountry === country) {
      handleCancel();
      return;
    }

    stopPrefill();
    updateLocation(
      {
        filePath: fileMetadata.filePath,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: we want to update the widths when the input values change
  const updateMeasuredWidths = useCallback(() => {
    const cityMeasured = (cityMirrorRef.current?.offsetWidth || 0) + 1;
    const countryMeasured = (countryMirrorRef.current?.offsetWidth || 0) + 1;
    setCityWidthPx(cityMeasured);
    setCountryWidthPx(countryMeasured);
  }, [shownCity, shownCountry, cityPlaceholder, countryPlaceholder]);

  useLayoutEffect(() => {
    updateMeasuredWidths();
  }, [updateMeasuredWidths]);

  useEffect(() => {
    const onResize = () => updateMeasuredWidths();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateMeasuredWidths]);

  return (
    <div className="relative mb-4 flex flex-col items-start gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "-left-7 absolute top-3 size-[9px] rounded-[1px]",
          isToday
            ? "bg-primary"
            : "border border-muted-foreground bg-background",
        )}
      />
      {renderTitle(
        <button
          type="button"
          className="group flex w-full items-center gap-3 text-left"
          onClick={onToggleFocus}
        >
          <h1 className="line-clamp-1 min-w-0 font-serif text-[32px] text-heading leading-[1.1] tracking-[-0.01em]">
            {dayTitle}
          </h1>
          {isFocused ? (
            <EyeSlashIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <EyeIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </button>,
      )}
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <div className="relative flex items-center">
          <span
            ref={cityMirrorRef}
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
            {shownCity || cityPlaceholder}
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
            {shownCountry || countryPlaceholder}
          </span>
          <Input
            value={shownCity}
            onChange={(e) => setEditCity(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={!isEditing ? handleStartEdit : undefined}
            placeholder={cityPlaceholder}
            style={{ width: cityWidthPx ? `${cityWidthPx}px` : undefined }}
            className="m-0 h-[18px] min-w-0 cursor-text rounded-none border-none bg-transparent p-0 text-muted-foreground text-xs shadow-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-100 dark:bg-transparent"
            autoFocus={isEditing}
            disabled={isPending}
            readOnly={!isEditing}
          />
          <span>,&nbsp;</span>
          <Input
            value={shownCountry}
            onChange={(e) => setEditCountry(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={!isEditing ? handleStartEdit : undefined}
            placeholder={countryPlaceholder}
            style={{
              width: countryWidthPx ? `${countryWidthPx}px` : undefined,
            }}
            className="m-0 h-[18px] min-w-0 cursor-text rounded-none border-none bg-transparent p-0 text-muted-foreground text-xs shadow-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-100 dark:bg-transparent"
            disabled={isPending}
            readOnly={!isEditing}
          />
        </div>
        {isEditing && (
          <div className="ml-1 flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={handleSave}
              disabled={isPending}
            >
              <CheckIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={handleCancel}
              disabled={isPending}
            >
              <XIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
