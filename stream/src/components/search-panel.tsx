"use client";

import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useRebuildSearchIndex,
  useSearchMarkdownFiles,
} from "@/hooks/use-search";

interface SearchPanelProps {
  folderPath: string;
  onFileSelect?: (filePath: string, lineNumber?: number) => void;
}

export function SearchPanel({ folderPath, onFileSelect }: SearchPanelProps) {
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

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleFileClick = (filePath: string, lineNumber: number) => {
    onFileSelect?.(filePath, lineNumber);
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
    <div className="flex h-full flex-col bg-stone-950">
      {/* Search Header */}
      <div className="border-stone-800 border-b p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-stone-400" />
            <Input
              type="text"
              placeholder="Search markdown files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-stone-700 bg-stone-900 pr-10 pl-10 text-stone-100 placeholder:text-stone-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="-translate-y-1/2 absolute top-1/2 right-3 text-stone-400 hover:text-stone-200"
              >
                <XIcon className="h-4 w-4" weight="bold" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRebuildIndex}
            disabled={isRebuilding}
            className="border-stone-700 bg-stone-900 hover:bg-stone-800"
            title="Rebuild search index"
          >
            <ArrowsClockwiseIcon
              className={`h-4 w-4 ${isRebuilding ? "animate-spin" : ""}`}
              weight="bold"
            />
          </Button>
        </div>

        {/* Search Stats */}
        {searchQuery && results && (
          <div className="flex items-center gap-3 text-stone-400 text-xs">
            <span>
              {results.totalResults}{" "}
              {results.totalResults === 1 ? "match" : "matches"}
            </span>
            <span>•</span>
            <span>
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
            <span>•</span>
            <span>{results.searchTimeMs}ms</span>
          </div>
        )}
      </div>

      <ScrollArea className="max-h-[calc(100vh-300px)] flex-1">
        <div className="space-y-4 p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-stone-400">
              <CircleNotchIcon
                className="mr-2 h-6 w-6 animate-spin"
                weight="bold"
              />
              <span>Searching...</span>
            </div>
          )}

          {error && (
            <Card className="border-red-800 bg-red-950/20 p-4">
              <p className="text-destructive text-sm">
                Error:{" "}
                {error instanceof Error ? error.message : "Failed to search"}
              </p>
            </Card>
          )}

          {/* Empty State */}
          {!isLoading &&
            !error &&
            searchQuery &&
            results?.totalResults === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-stone-500">
                <MagnifyingGlassIcon
                  className="mb-3 h-12 w-12 opacity-50"
                  weight="duotone"
                />
                <p className="text-sm">No results found for "{searchQuery}"</p>
              </div>
            )}

          {/* Initial State */}
          {!searchQuery && (
            <div className="flex flex-col items-center justify-center py-12 text-stone-500">
              <MagnifyingGlassIcon
                className="mb-3 h-12 w-12 opacity-50"
                weight="duotone"
              />
              <p className="text-sm">
                Start typing to search your markdown files
              </p>
            </div>
          )}

          {/* Results by File */}
          {!isLoading && results && results.totalResults > 0 && (
            <div className="space-y-4">
              {Object.entries(groupedResults).map(([filePath, matches]) => {
                const fileName = filePath.split("/").pop() || filePath;

                return (
                  <Card
                    key={filePath}
                    className="border-stone-800 bg-stone-900"
                  >
                    <div className="border-stone-800 border-b p-3">
                      <div className="flex items-center gap-2">
                        <FileTextIcon className="h-4 w-4 text-stone-400" />
                        <span className="truncate font-medium text-sm text-stone-200">
                          {fileName}
                        </span>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {matches.length}
                        </Badge>
                      </div>
                    </div>
                    <div className="divide-y divide-stone-800">
                      {matches.map((match, idx) => (
                        <button
                          type="button"
                          key={`${match.filePath}-${match.lineNumber}-${idx}`}
                          onClick={() =>
                            handleFileClick(match.filePath, match.lineNumber)
                          }
                          className="w-full p-3 text-left transition-colors hover:bg-stone-800/50"
                        >
                          <div className="mb-1 flex items-start gap-2">
                            <Badge
                              variant="outline"
                              className="border-stone-700 font-mono text-xs"
                            >
                              L{match.lineNumber}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="border-stone-700 text-stone-400 text-xs"
                            >
                              {match.score.toFixed(2)}
                            </Badge>
                          </div>
                          <p className="text-sm text-stone-300 leading-relaxed">
                            {highlightMatch(
                              match.contextSnippet,
                              match.charStart,
                              match.charEnd,
                            )}
                          </p>
                        </button>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
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
