import {
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  MapPinIcon,
  PenIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateFileLocation } from "@/hooks/use-markdown-queries";
import type { MarkdownFileMetadata } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/utils/date-utils";

export function DateHeader({
  isFocused,
  onToggleFocus,
  fileMetadata,
  folderPath,
}: {
  isFocused: boolean;
  onToggleFocus: () => void;
  fileMetadata: MarkdownFileMetadata;
  folderPath: string;
}) {
  const displayDate = formatDisplayDate(fileMetadata.dateFromFilename);
  const city = fileMetadata.city || "";
  const country = fileMetadata.country || "";
  const [isEditing, setIsEditing] = useState(false);
  const [editCity, setEditCity] = useState(city);
  const [editCountry, setEditCountry] = useState(country);

  const cityMirrorRef = useRef<HTMLSpanElement>(null);
  const countryMirrorRef = useRef<HTMLSpanElement>(null);
  const [cityWidthPx, setCityWidthPx] = useState<number>(0);
  const [countryWidthPx, setCountryWidthPx] = useState<number>(0);

  const { mutate: updateLocation, isPending } =
    useUpdateFileLocation(folderPath);

  const handleStartEdit = () => {
    setEditCity(city);
    setEditCountry(country);
    setIsEditing(true);
  };

  const handleCancel = () => {
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
    const cityMeasured = (cityMirrorRef.current?.offsetWidth || 0) - 2;
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
        <h1 className="m-0 line-clamp-1 min-w-0 flex-shrink-0 cursor-pointer text-left font-semibold text-3xl text-muted-foreground/90 transition-colors group-hover:text-muted-foreground sm:text-4xl">
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
