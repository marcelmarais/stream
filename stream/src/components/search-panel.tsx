"use client";

import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  DotIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  useRebuildSearchIndex,
  useSearchMarkdownFiles,
} from "@/hooks/use-search";
import { cn } from "@/lib/utils";

interface SearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPath: string;
  onFileSelect?: (filePath: string, lineNumber?: number) => void;
}

export function SearchPanel({
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
    limit: 100,
  });

  const { mutate: rebuildIndex, isPending: isRebuilding } =
    useRebuildSearchIndex();

  const handleFileClick = (filePath: string, lineNumber: number) => {
    onFileSelect?.(filePath, lineNumber);
    onOpenChange(false);
    setSearchQuery("");
  };

  const handleRebuildIndex = () => {
    rebuildIndex(folderPath);
  };

  // Group results by file
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
      <div className={cn("flex h-8 items-center px-4", searchQuery && results && "border-b")}>
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

      <CommandList className="h-[400px] max-h-[70vh]">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <CircleNotchIcon
              className="mr-2 h-5 w-5 animate-spin"
              weight="bold"
            />
            <span>Searching...</span>
          </div>
        )}

        {error && (
          <div className="px-4 py-8">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
              <p className="text-destructive text-sm">
                Error:{" "}
                {error instanceof Error ? error.message : "Failed to search"}
              </p>
            </div>
          </div>
        )}

        {!isLoading && !error && searchQuery && results?.totalResults === 0 && (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-3 py-6">
              <MagnifyingGlassIcon
                className="h-12 w-12 text-muted-foreground opacity-50"
                weight="duotone"
              />
              <p className="text-muted-foreground text-sm">
                No results found for "{searchQuery}"
              </p>
            </div>
          </CommandEmpty>
        )}

        {!searchQuery && !isLoading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <MagnifyingGlassIcon
              className="h-12 w-12 text-muted-foreground opacity-50"
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
                    {matches.length > 1 && <Badge
                      variant="secondary"
                      className="ml-auto font-normal text-xs"
                    >
                      {matches.length}
                    </Badge>}
                  </div>
                }
              >
                {matches.map((match, idx) => (
                  <CommandItem
                    key={`${match.filePath}-${match.lineNumber}-${idx}`}
                    onSelect={() =>
                      handleFileClick(match.filePath, match.lineNumber)
                    }
                    className="flex flex-col items-start gap-2 py-3"
                  >
                    <p className="text-sm leading-relaxed">
                      {highlightMatch(
                        match.contextSnippet,
                        match.charStart,
                        match.charEnd,
                      )}
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
 * Highlight the matched text in the context snippet
 */
function highlightMatch(text: string, start: number, end: number) {
  // If the match positions are within the snippet
  if (start < text.length && end <= text.length && start < end) {
    const before = text.slice(0, start);
    const match = text.slice(start, end);
    const after = text.slice(end);

    return (
      <>
        {before}
        <mark className="rounded bg-yellow-500/30 px-0.5 text-yellow-200">
          {match}
        </mark>
        {after}
      </>
    );
  }

  return text;
}
