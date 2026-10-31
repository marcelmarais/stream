"use client";

import { XIcon } from "@phosphor-icons/react";
import { useCallback, useId, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllLoadedCommits } from "@/hooks/use-git-queries";
import { formatCommitAuthor } from "@/ipc/git-reader";
import { useUserStore } from "@/stores/user-store";

export function CommitFilter({ showBadges = true }: { showBadges?: boolean }) {
  const folderPath = useUserStore((state) => state.folderPath);
  const filters = useUserStore((state) => state.commitFilters);
  const setFilters = useUserStore((state) => state.setCommitFilters);

  const commitsByDate = useAllLoadedCommits(folderPath || "");
  const searchId = useId();
  const authorSelectId = useId();
  const repoSelectId = useId();

  const commits = useMemo(
    () => Object.values(commitsByDate).flatMap((dateData) => dateData.commits),
    [commitsByDate],
  );

  const { uniqueAuthors, uniqueRepos } = useMemo(() => {
    const authorsSet = new Set<string>();
    const reposSet = new Set<string>();

    commits.forEach((commit) => {
      const author = formatCommitAuthor(commit);
      if (author && author !== "Unknown") {
        authorsSet.add(author);
      }

      const repoName = commit.repo_path.split("/").pop() || commit.repo_path;
      reposSet.add(repoName);
    });

    return {
      uniqueAuthors: Array.from(authorsSet).sort(),
      uniqueRepos: Array.from(reposSet).sort(),
    };
  }, [commits]);

  // Handle adding/removing authors
  const handleAuthorChange = useCallback(
    (author: string) => {
      const newAuthors = filters.authors.includes(author)
        ? filters.authors.filter((a) => a !== author)
        : [...filters.authors, author];

      setFilters({
        ...filters,
        authors: newAuthors,
      });
    },
    [filters, setFilters],
  );

  const handleRepoChange = useCallback(
    (repo: string) => {
      const newRepos = filters.repos.includes(repo)
        ? filters.repos.filter((r) => r !== repo)
        : [...filters.repos, repo];

      setFilters({
        ...filters,
        repos: newRepos,
      });
    },
    [filters, setFilters],
  );

  const handleSearchChange = useCallback(
    (searchTerm: string) => {
      setFilters({
        ...filters,
        searchTerm,
      });
    },
    [filters, setFilters],
  );

  const handleClearFilters = useCallback(() => {
    setFilters({
      authors: [],
      repos: [],
      searchTerm: "",
    });
  }, [setFilters]);

  // Check if any filters are active
  const hasActiveFilters =
    filters.authors.length > 0 ||
    filters.repos.length > 0 ||
    filters.searchTerm.length > 0;

  if (commits.length === 0) {
    return (
      <button type="button" className="no-drag h-6 opacity-50" disabled>
        filter
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="no-drag relative h-6 hover:text-foreground"
              title="Filter commits"
            />
          }
        >
          filter
          {hasActiveFilters && (
            <span className="-right-1.5 absolute top-1 size-1 bg-primary" />
          )}
        </PopoverTrigger>
        <PopoverContent className="z-[70] w-80 gap-3" align="end">
          {/* Header */}
          <div>
            <h3 className="font-semibold text-foreground">Filter commits</h3>
          </div>

          {/* Search Input */}
          <div>
            <label
              htmlFor={searchId}
              className="mb-1.5 block text-muted-foreground text-xs"
            >
              Search
            </label>
            <Input
              id={searchId}
              type="text"
              placeholder="messages, authors or repos"
              value={filters.searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full text-xs"
            />
          </div>

          <div className="space-y-4">
            {/* Author Filter */}
            <div>
              <label
                htmlFor={authorSelectId}
                className="mb-1.5 block text-muted-foreground text-xs"
              >
                Author
              </label>
              <Select
                onValueChange={(author) => {
                  if (typeof author === "string") handleAuthorChange(author);
                }}
              >
                <SelectTrigger id={authorSelectId} className="w-full">
                  <SelectValue placeholder="Select author" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  {uniqueAuthors.map((author) => (
                    <SelectItem
                      key={author}
                      value={author}
                      disabled={filters.authors.includes(author)}
                    >
                      {author}
                      {filters.authors.includes(author) && " ✓"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Selected Authors */}
              {filters.authors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {filters.authors.map((author) => (
                    <Badge
                      key={author}
                      variant="secondary"
                      className="flex items-center gap-1 text-xs"
                    >
                      {author}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAuthorChange(author)}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        <XIcon className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Repository Filter */}
            <div>
              <label
                htmlFor={repoSelectId}
                className="mb-1.5 block text-muted-foreground text-xs"
              >
                Repository
              </label>
              <Select
                onValueChange={(repo) => {
                  if (typeof repo === "string") handleRepoChange(repo);
                }}
              >
                <SelectTrigger id={repoSelectId} className="w-full">
                  <SelectValue placeholder="Select repository" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueRepos.map((repo) => (
                    <SelectItem
                      key={repo}
                      value={repo}
                      disabled={filters.repos.includes(repo)}
                    >
                      {repo}
                      {filters.repos.includes(repo) && " ✓"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Selected Repos */}
              {filters.repos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {filters.repos.map((repo) => (
                    <Badge
                      key={repo}
                      variant="secondary"
                      className="flex items-center gap-1 text-xs"
                    >
                      {repo}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRepoChange(repo)}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        <XIcon className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Clear all filters button */}
          {hasActiveFilters && (
            <div className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="w-full"
              >
                Clear filters
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Active Filter Badges */}
      {showBadges && hasActiveFilters && (
        <div className="flex flex-wrap gap-2">
          {filters.authors.map((author) => (
            <Badge
              key={author}
              variant="default"
              className="flex items-center gap-1 text-xs"
            >
              Author: {author}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAuthorChange(author)}
                className="h-auto p-0 hover:bg-transparent"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
          {filters.repos.map((repo) => (
            <Badge
              key={repo}
              variant="default"
              className="flex items-center gap-1 text-xs"
            >
              Repo: {repo}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRepoChange(repo)}
                className="h-auto p-0 hover:bg-transparent"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
          {filters.searchTerm && (
            <Badge
              variant="default"
              className="flex items-center gap-1 text-xs"
            >
              Search: "{filters.searchTerm}"
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSearchChange("")}
                className="h-auto p-0 hover:bg-transparent"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export default CommitFilter;
