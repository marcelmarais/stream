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
    limit: 1000,
  });

  // Reset scroll position when query changes
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const handleFileClick = (filePath: string, lineNumber: number) => {
    onFileSelect?.(filePath, lineNumber);
    onOpenChange(false);
    setSearchQuery("");
  };

  const groupedResults = useMemo(() => {
    if (!results?.matches) return {};

    const groups: Record<string, typeof results.matches> = {};
    for (const match of results.matches) {
      if (!groups[match.filePath]) {
        groups[match.filePath] = [];
      }
      groups[match.filePath].push(match);
    }
    return groups;
  }, [results?.matches]);

  const fileCount = Object.keys(groupedResults).length;

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
          searchQuery && results && "border-b",
        )}
      >
        {searchQuery && results && (
          <div className="flex items-center text-muted-foreground text-xs">
            <span>
              {results.totalResults}{" "}
              {results.totalResults === 1 ? "match" : "matches"}
            </span>
            <DotIcon className="h-6 w-6" />
            <span>
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
            <DotIcon className="h-6 w-6" />
            <span>{results.searchTimeMs}ms</span>
          </div>
        )}
      </div>

      <CommandList ref={scrollRef} className="h-[400px] max-h-[70vh]">
        {isLoading && (
          <div className="flex h-[400px] items-center justify-center text-muted-foreground">
            <CircleNotchIcon
              className="mr-2 h-5 w-5 animate-spin"
              weight="bold"
            />
            <span>Searching...</span>
          </div>
        )}

        {!isLoading && !error && searchQuery && results?.totalResults === 0 && (
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
          results &&
          results.totalResults > 0 &&
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
                  <CommandItem
                    key={`${match.filePath}-${match.lineNumber}-${idx}`}
                    value={`${match.filePath}-${match.lineNumber}-${idx}`}
                    onSelect={() =>
                      handleFileClick(match.filePath, match.lineNumber)
                    }
                    className="flex flex-col items-start gap-2 py-3"
                  >
                    <p className="text-sm leading-relaxed">
                      {highlightMatch(match.contextSnippet, match.matchRanges)}
                    </p>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
      </CommandList>
    </CommandDialog>
  );
}

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
