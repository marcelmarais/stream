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
import { cn } from "@/lib/utils";

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
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="search notes"
          value={searchQuery}
          onValueChange={setSearchQuery}
        />

        {searchQuery && deferredResults && (
          <div
            className={cn(
              "flex h-7 items-center gap-1.5 border-b px-3 text-muted-foreground text-xs",
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
            "h-[360px] max-h-[60vh] transition-opacity duration-200",
            isStale && "opacity-60",
          )}
        >
          {isLoading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Searching...
            </div>
          )}

          {!isLoading &&
            !error &&
            searchQuery &&
            deferredResults?.totalResults === 0 && (
              <CommandEmpty>No results for "{searchQuery}"</CommandEmpty>
            )}

          {!searchQuery && !isLoading && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Start typing to search your notes
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
                  heading={
                    <div className="flex w-full items-center justify-between text-muted-foreground">
                      <button
                        type="button"
                        className="truncate hover:text-foreground"
                        onClick={() =>
                          handleFileClick(filePath, matches[0].lineNumber)
                        }
                      >
                        {fileName}
                      </button>
                      {matches.length > 1 && <span>{matches.length}</span>}
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
        className="px-2 py-1.5"
      >
        <span className="min-w-0 font-sans text-[13.5px] text-body leading-snug">
          {highlightMatch(match.contextSnippet, match.matchRanges)}
        </span>
      </CommandItem>
    );
  },
);
MatchItem.displayName = "MatchItem";

function highlightMatch(text: string, ranges: Array<[number, number]>) {
  if (!ranges || ranges.length === 0) {
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
      <mark key={`match-${i}`} className="bg-primary text-primary-foreground">
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
