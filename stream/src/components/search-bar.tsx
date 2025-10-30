"use client";

import {
  CircleNotchIcon,
  DotIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
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
    limit: 100, // Reduced from 1000 - faster rendering, still plenty of results
  });

  // Defer the results to prevent blocking the input
  const deferredResults = React.useDeferredValue(results);

  // Reset scroll position when query changes
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
      className="max-w-3xl"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search markdown files..."
        value={searchQuery}
        onValueChange={setSearchQuery}
        className="border-0"
      />

      {/* Search Stats */}
      <div
        className={cn(
          "flex h-8 items-center px-4",
          searchQuery && deferredResults && "border-b",
        )}
      >
        {searchQuery && deferredResults && (
          <div className="flex items-center text-muted-foreground text-xs">
            <span className={cn(isStale && "opacity-50")}>
              {deferredResults.totalResults}{" "}
              {deferredResults.totalResults === 1 ? "match" : "matches"}
            </span>
            <DotIcon className="h-6 w-6" />
            <span className={cn(isStale && "opacity-50")}>
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
            <DotIcon className="h-6 w-6" />
            <span className={cn(isStale && "opacity-50")}>
              {deferredResults.searchTimeMs}ms
            </span>
            {isStale && (
              <>
                <DotIcon className="h-6 w-6" />
                <CircleNotchIcon
                  className="h-3 w-3 animate-spin"
                  weight="bold"
                />
              </>
            )}
          </div>
        )}
      </div>

      <CommandList
        ref={scrollRef}
        className={cn(
          "h-[400px] max-h-[70vh] transition-opacity duration-200",
          isStale && "opacity-60",
        )}
      >
        {isLoading && (
          <div className="flex h-[400px] items-center justify-center text-muted-foreground">
            <CircleNotchIcon
              className="mr-2 h-5 w-5 animate-spin"
              weight="bold"
            />
            <span>Searching...</span>
          </div>
        )}

        {!isLoading &&
          !error &&
          searchQuery &&
          deferredResults?.totalResults === 0 && (
            <CommandEmpty>
              <div className="flex h-[350px] flex-col items-center justify-center gap-3">
                <MagnifyingGlassIcon
                  className="h-10 w-10 text-muted-foreground opacity-50"
                  weight="duotone"
                />
                <p className="text-muted-foreground text-sm">
                  No results found for "{searchQuery}"
                </p>
              </div>
            </CommandEmpty>
          )}

        {!searchQuery && !isLoading && (
          <div className="flex h-[350px] flex-col items-center justify-center gap-3">
            <MagnifyingGlassIcon
              className="h-10 w-10 text-muted-foreground opacity-50"
              weight="duotone"
            />
            <p className="text-muted-foreground text-sm">
              Start typing to search your markdown files
            </p>
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
                  <div className="flex items-center gap-2">
                    <FileTextIcon className="h-4 w-4" />
                    <span className="truncate">{fileName}</span>
                    {matches.length > 1 && (
                      <Badge
                        variant="secondary"
                        className="ml-auto font-normal text-xs"
                      >
                        {matches.length}
                      </Badge>
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
    </CommandDialog>
  );
}

/**
 * Memoized match item component to prevent unnecessary re-renders
 */
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
        className="flex flex-col items-start gap-2 py-3"
      >
        <p className="text-sm leading-relaxed">
          {highlightMatch(match.contextSnippet, match.matchRanges)}
        </p>
      </CommandItem>
    );
  },
);
MatchItem.displayName = "MatchItem";

/**
 * Highlight multiple matched text ranges in the context snippet
 */
function highlightMatch(text: string, ranges: Array<[number, number]>) {
  if (!ranges || ranges.length === 0) {
    return text;
  }

  // Sort ranges by start position
  const sortedRanges = [...ranges].sort((a, b) => a[0] - b[0]);

  const parts: Array<React.ReactNode> = [];
  let lastEnd = 0;

  for (let i = 0; i < sortedRanges.length; i++) {
    const [start, end] = sortedRanges[i];

    // Validate range
    if (start >= text.length || end > text.length || start >= end) {
      continue;
    }

    // Add text before this match
    if (start > lastEnd) {
      parts.push(text.slice(lastEnd, start));
    }

    // Add highlighted match
    parts.push(
      <mark
        key={`match-${i}`}
        className="rounded bg-yellow-500/30 px-0.5 text-yellow-200"
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
