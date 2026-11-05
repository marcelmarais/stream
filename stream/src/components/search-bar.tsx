"use client";

import React, { useMemo, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { useSearchMarkdownFiles } from "@/hooks/use-search";
import { cleanSnippet } from "@/lib/search-snippet";
import { cn } from "@/lib/utils";
import { formatDayTitle, getDateFromFilename } from "@/utils/date-utils";

/** "Thursday 5 November", with the year when it isn't this one */
function formatFileHeading(fileName: string): string {
  const dateKey = getDateFromFilename(fileName);
  if (!dateKey) {
    return fileName;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const title = formatDayTitle(date);
  return year === new Date().getFullYear() ? title : `${title} ${year}`;
}

interface SearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPath: string;
  onFileSelect?: (filePath: string, lineNumber?: number) => void;
}

export function SearchBar({
  open,
  onOpenChange,
  folderPath,
  onFileSelect,
}: SearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: results,
    isLoading,
    error,
  } = useSearchMarkdownFiles(folderPath, searchQuery, {
    limit: 250,
  });

  const deferredResults = React.useDeferredValue(results);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const handleFileClick = (filePath: string, lineNumber: number) => {
    onFileSelect?.(filePath, lineNumber);
    onOpenChange(false);
    setSearchQuery("");
  };

  const groupedResults = useMemo(() => {
    if (!deferredResults?.matches) return {};

    const groups: Record<string, typeof deferredResults.matches> = {};
    for (const match of deferredResults.matches) {
      if (!groups[match.filePath]) {
        groups[match.filePath] = [];
      }
      groups[match.filePath].push(match);
    }
    return groups;
  }, [deferredResults?.matches]);

  const fileCount = Object.keys(groupedResults).length;
  const isStale = results !== deferredResults;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Markdown Files"
      description="Search through your markdown files"
      className="shadow-2xl shadow-black/40 sm:max-w-xl"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search notes"
          value={searchQuery}
          onValueChange={setSearchQuery}
        />

        {searchQuery && deferredResults && (
          <div
            className={cn(
              "flex h-7 items-center gap-1.5 border-b px-3.5 text-faint text-meta",
              isStale && "opacity-50",
            )}
          >
            <span>
              {deferredResults.totalResults}{" "}
              {deferredResults.totalResults === 1 ? "result" : "results"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{deferredResults.searchTimeMs}ms</span>
          </div>
        )}

        <CommandList
          ref={scrollRef}
          className={cn(
            "h-[380px] max-h-[60vh] py-1 transition-opacity duration-200",
            isStale && "opacity-60",
          )}
        >
          {isLoading && (
            <div className="flex h-full items-center justify-center font-sans text-faint text-prose">
              Searching…
            </div>
          )}

          {!isLoading &&
            !error &&
            searchQuery &&
            deferredResults?.totalResults === 0 && (
              <CommandEmpty className="font-sans text-faint text-prose">
                Nothing matches “{searchQuery}”
              </CommandEmpty>
            )}

          {!searchQuery && !isLoading && (
            <div className="flex h-full items-center justify-center font-sans text-faint text-prose">
              Search every note as you type
            </div>
          )}

          {!isLoading &&
            deferredResults &&
            deferredResults.totalResults > 0 &&
            Object.entries(groupedResults).map(([filePath, matches]) => {
              const fileName = filePath.split("/").pop() || filePath;

              return (
                <CommandGroup
                  key={filePath}
                  className="px-1.5 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1"
                  heading={
                    <div className="flex w-full items-baseline justify-between gap-3">
                      <button
                        type="button"
                        className="truncate font-medium font-sans text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() =>
                          handleFileClick(filePath, matches[0].lineNumber)
                        }
                        title={fileName}
                      >
                        {formatFileHeading(fileName)}
                      </button>
                      {matches.length > 1 && (
                        <span className="text-faint text-meta">
                          {matches.length}
                        </span>
                      )}
                    </div>
                  }
                >
                  {matches.map((match, idx) => (
                    <MatchItem
                      key={`${match.filePath}-${match.lineNumber}-${idx}`}
                      match={match}
                      idx={idx}
                      onClick={() =>
                        handleFileClick(match.filePath, match.lineNumber)
                      }
                    />
                  ))}
                </CommandGroup>
              );
            })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

const MatchItem = React.memo(
  ({
    match,
    idx,
    onClick,
  }: {
    match: {
      filePath: string;
      lineNumber: number;
      contextSnippet: string;
      matchRanges: Array<[number, number]>;
    };
    idx: number;
    onClick: () => void;
  }) => {
    return (
      <CommandItem
        key={`${match.filePath}-${match.lineNumber}-${idx}`}
        value={`${match.filePath}-${match.lineNumber}-${idx}`}
        onSelect={onClick}
        className="rounded-[5px] px-2 py-1.5"
      >
        <span className="line-clamp-2 min-w-0 font-sans text-[14px] text-body leading-[1.5]">
          {highlightMatch(match.contextSnippet, match.matchRanges)}
        </span>
      </CommandItem>
    );
  },
);
MatchItem.displayName = "MatchItem";

function highlightMatch(snippet: string, matchRanges: Array<[number, number]>) {
  const { text, ranges } = cleanSnippet(snippet, matchRanges ?? []);

  if (ranges.length === 0) {
    return text;
  }

  const sortedRanges = [...ranges].sort((a, b) => a[0] - b[0]);

  const parts: Array<React.ReactNode> = [];
  let lastEnd = 0;

  for (let i = 0; i < sortedRanges.length; i++) {
    const [start, end] = sortedRanges[i];

    // Validate range
    const isValidRange =
      start >= 0 &&
      end >= 0 &&
      start < text.length &&
      end <= text.length &&
      start < end;

    if (!isValidRange) {
      continue;
    }

    // Add text before this match
    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }

    parts.push(
      <mark
        key={`match-${i}`}
        className="rounded-[2px] bg-primary/20 text-heading shadow-[inset_0_-1.5px_0_var(--primary)]"
      >
        {text.slice(start, end)}
      </mark>,
    );

    lastEnd = end;
  }

  // Add remaining text after last match
  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return <>{parts}</>;
}
