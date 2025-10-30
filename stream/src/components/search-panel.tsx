"use client";

import { useState, useMemo, useEffect } from "react";
import { debounce } from "lodash";
import { MagnifyingGlass, X as XIcon, FileText, CircleNotch, ArrowsClockwise } from "@phosphor-icons/react";
import { useSearchMarkdownFiles, useRebuildSearchIndex } from "@/hooks/use-search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface SearchPanelProps {
  folderPath: string;
  onFileSelect?: (filePath: string, lineNumber?: number) => void;
}

export function SearchPanel({ folderPath, onFileSelect }: SearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const debouncedSetQuery = useMemo(
    () => debounce((query: string) => setDebouncedQuery(query), 300),
    [],
  );

  useEffect(() => {
    debouncedSetQuery(searchQuery);
    return () => {
      debouncedSetQuery.cancel();
    };
  }, [searchQuery, debouncedSetQuery]);

  const { data: results, isLoading, error } = useSearchMarkdownFiles(
    folderPath,
    debouncedQuery,
    {
      limit: 100,
    }
  );

  const { mutate: rebuildIndex, isPending: isRebuilding } = useRebuildSearchIndex();

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
    <div className="flex flex-col h-full bg-stone-950">
      {/* Search Header */}
      <div className="p-4 border-b border-stone-800">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <Input
              type="text"
              placeholder="Search markdown files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10 bg-stone-900 border-stone-700 text-stone-100 placeholder:text-stone-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-200"
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
            <ArrowsClockwise className={`h-4 w-4 ${isRebuilding ? "animate-spin" : ""}`} weight="bold" />
          </Button>
        </div>

        {/* Search Stats */}
        {debouncedQuery && results && (
          <div className="flex items-center gap-3 text-xs text-stone-400">
            <span>
              {results.totalResults} {results.totalResults === 1 ? "match" : "matches"}
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

      <ScrollArea className="flex-1 max-h-[calc(100vh-300px)]">
        <div className="p-4 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-stone-400">
              <CircleNotch className="h-6 w-6 animate-spin mr-2" weight="bold" />
              <span>Searching...</span>
            </div>
          )}

          {error && (
            <Card className="p-4 bg-red-950/20 border-red-800">
              <p className="text-sm text-destructive">
                Error: {error instanceof Error ? error.message : "Failed to search"}
              </p>
            </Card>
          )}

          {/* Empty State */}
          {!isLoading && !error && debouncedQuery && results?.totalResults === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-stone-500">
              <MagnifyingGlass className="h-12 w-12 mb-3 opacity-50" weight="duotone" />
              <p className="text-sm">No results found for "{debouncedQuery}"</p>
            </div>
          )}

          {/* Initial State */}
          {!debouncedQuery && (
            <div className="flex flex-col items-center justify-center py-12 text-stone-500">
              <MagnifyingGlass className="h-12 w-12 mb-3 opacity-50" weight="duotone" />
              <p className="text-sm">Start typing to search your markdown files</p>
            </div>
          )}

          {/* Results by File */}
          {!isLoading && results && results.totalResults > 0 && (
            <div className="space-y-4">
              {Object.entries(groupedResults).map(([filePath, matches]) => {
                const fileName = filePath.split("/").pop() || filePath;
                
                return (
                  <Card key={filePath} className="bg-stone-900 border-stone-800">
                    <div className="p-3 border-b border-stone-800">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-stone-400" />
                        <span className="text-sm font-medium text-stone-200 truncate">
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
                          onClick={() => handleFileClick(match.filePath, match.lineNumber)}
                          className="w-full text-left p-3 hover:bg-stone-800/50 transition-colors"
                        >
                          <div className="flex items-start gap-2 mb-1">
                            <Badge 
                              variant="outline" 
                              className="text-xs font-mono border-stone-700"
                            >
                              L{match.lineNumber}
                            </Badge>
                            <Badge 
                              variant="outline" 
                              className="text-xs border-stone-700 text-stone-400"
                            >
                              {match.score.toFixed(2)}
                            </Badge>
                          </div>
                          <p className="text-sm text-stone-300 leading-relaxed">
                            {highlightMatch(
                              match.contextSnippet,
                              match.charStart,
                              match.charEnd
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
        <mark className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">
          {match}
        </mark>
        {after}
      </>
    );
  }
  
  return text;
}

