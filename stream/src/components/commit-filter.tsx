"use client";

import { SlidersHorizontalIcon, XIcon } from "@phosphor-icons/react";
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
      <div className="flex items-center gap-2 text-muted-foreground">
        <Button variant="ghost" size="sm" className="no-drag h-8 w-8 p-0" disabled>
          <SlidersHorizontalIcon className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="no-drag relative h-8 w-8 p-0" title="Filter commits">
            <SlidersHorizontalIcon className="h-4 w-4" />
            {hasActiveFilters && (
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="mt-2 w-96 space-y-4" align="end">
          {/* Header */}
          <div>
            <h3 className="font-medium text-sm">Filter Commits</h3>
          </div>

          {/* Search Input */}
          <div>
            <label
              htmlFor={searchId}
              className="mb-2 block font-medium text-xs"
            >
              Search
            </label>
            <Input
              id={searchId}
              type="text"
              placeholder="Search messages, authors, or repos..."
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
                className="mb-2 block font-medium text-xs"
              >
                Author ({uniqueAuthors.length} available)
              </label>
              <Select onValueChange={handleAuthorChange}>
                <SelectTrigger id={authorSelectId} className="w-full">
                  <SelectValue placeholder="Select author..." />
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
                className="mb-2 block font-medium text-xs"
              >
                Repository ({uniqueRepos.length} available)
              </label>
              <Select onValueChange={handleRepoChange}>
                <SelectTrigger id={repoSelectId} className="w-full">
                  <SelectValue placeholder="Select repository..." />
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
            <div className="border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="w-full"
              >
                Clear All Filters
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
