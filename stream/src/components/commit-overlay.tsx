"use client";

import {
  ArrowSquareOutIcon,
  GitBranchIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GitCommit } from "@/ipc/git-reader";
import {
  formatCommitAuthor,
  getShortCommitId,
  isMainBranch,
} from "@/ipc/git-reader";

interface CommitOverlayProps {
  commits: GitCommit[];
  date: Date;
  className?: string;
}

interface RepoCardProps {
  repoName: string;
  commits: GitCommit[];
}

interface BranchGroupProps {
  branchName: string;
  commits: GitCommit[];
}

function groupCommitsByBranch(
  commits: GitCommit[],
): Record<string, GitCommit[]> {
  const byBranch: Record<string, GitCommit[]> = {};

  for (const commit of commits) {
    for (const branch of commit.branches) {
      const cleanBranch = branch.replace("origin/", "");
      if (!byBranch[cleanBranch]) {
        byBranch[cleanBranch] = [];
      }
      if (!byBranch[cleanBranch].some((c) => c.id === commit.id)) {
        byBranch[cleanBranch].push(commit);
      }
    }
  }

  return byBranch;
}

function sortBranchNames(branches: string[]): string[] {
  return branches.sort((a, b) => {
    const aIsMain = isMainBranch(a);
    const bIsMain = isMainBranch(b);
    if (aIsMain && !bIsMain) return -1;
    if (!aIsMain && bIsMain) return 1;
    return a.localeCompare(b);
  });
}

function truncateFilePath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 2) return filePath;
  return `.../${parts.slice(-2).join("/")}`;
}

function BranchGroup({ branchName, commits }: BranchGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFileExpansion = (commitId: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(commitId)) {
        newSet.delete(commitId);
      } else {
        newSet.add(commitId);
      }
      return newSet;
    });
  };

  const sortedCommits = [...commits].sort((a, b) => b.timestamp - a.timestamp);
  const firstCommit = sortedCommits[0];
  const remainingCommits = sortedCommits.slice(1);

  return (
    <div className="rounded-md border bg-card/30">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        className="flex h-auto w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{branchName}</span>
          <Badge
            variant={isMainBranch(branchName) ? "default" : "secondary"}
            className="px-1.5 py-0 text-[10px]"
          >
            {commits.length}
          </Badge>
        </div>
        {remainingCommits.length > 0 &&
          (expanded ? (
            <MinusIcon className="h-2 w-2 text-muted-foreground" />
          ) : (
            <PlusIcon className="h-2 w-2 text-muted-foreground" />
          ))}
      </Button>

      <div className="px-3 py-2">
        <CommitItem
          commit={firstCommit}
          expandedFiles={expandedFiles}
          toggleFileExpansion={toggleFileExpansion}
          compact={!expanded}
        />
      </div>

      {expanded && remainingCommits.length > 0 && (
        <div className="border-t">
          {remainingCommits.map((commit) => (
            <div key={commit.id} className="border-b px-3 py-2 last:border-b-0">
              <CommitItem
                commit={commit}
                expandedFiles={expandedFiles}
                toggleFileExpansion={toggleFileExpansion}
                compact={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CommitItemProps {
  commit: GitCommit;
  expandedFiles: Set<string>;
  toggleFileExpansion: (commitId: string) => void;
  compact?: boolean;
}

function CommitItem({
  commit,
  expandedFiles,
  toggleFileExpansion,
  compact = false,
}: CommitItemProps) {
  const time = new Date(commit.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const url = commit.url;

  return (
    <div className="group">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-muted-foreground text-xs leading-none">{time}</span>

          <span
            className={`min-w-0 text-foreground text-xs leading-none ${compact ? "truncate" : ""}`}
          >
            {commit.message}
          </span>
          {url ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openUrl(url);
              }}
              className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-mono text-muted-foreground text-xs leading-none transition-colors hover:text-foreground"
              title="View commit on remote"
            >
              <span className="leading-none">{getShortCommitId(commit.id)}</span>
              <ArrowSquareOutIcon className="h-3 w-3" weight="regular" />
            </button>
          ) : (
            <span className="shrink-0 font-mono text-muted-foreground text-xs leading-none">
              {getShortCommitId(commit.id)}
            </span>
          )}
        </div>
        <span className="shrink-0 text-muted-foreground text-xs leading-none">
          {formatCommitAuthor(commit)}
        </span>
      </div>

      {!compact && commit.files_changed.length > 0 && (
        <div className="mt-2.5">
          <div className="flex flex-wrap gap-1">
            {(() => {
              const isExpanded = expandedFiles.has(commit.id);
              const filesToShow = isExpanded
                ? commit.files_changed
                : commit.files_changed.slice(0, 3);
              const remainingCount = commit.files_changed.length - 3;

              return (
                <>
                  {filesToShow.map((file) => (
                    <Badge
                      key={file}
                      variant="outline"
                      className="px-1.5 py-0 font-normal text-[10px] text-muted-foreground"
                    >
                      {truncateFilePath(file)}
                    </Badge>
                  ))}
                  {!isExpanded && remainingCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="cursor-pointer px-1.5 py-0 text-[10px] hover:bg-secondary/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFileExpansion(commit.id);
                      }}
                    >
                      +{remainingCount} more
                    </Badge>
                  )}
                  {isExpanded && commit.files_changed.length > 3 && (
                    <Badge
                      variant="secondary"
                      className="cursor-pointer px-1.5 py-0 text-[10px] hover:bg-secondary/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFileExpansion(commit.id);
                      }}
                    >
                      less
                    </Badge>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function RepoCard({ repoName, commits }: RepoCardProps) {
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  const commitsByBranch = groupCommitsByBranch(commits);
  const sortedBranches = sortBranchNames(Object.keys(commitsByBranch));

  return (
    <Card className="bg-background/60 p-1">
      <Accordion
        type="single"
        collapsible
        value={expanded}
        onValueChange={(val) => setExpanded(val)}
      >
        <AccordionItem value="repo" className="border-0">
          <AccordionTrigger className="px-4 py-2 hover:no-underline [&[data-state=closed]>div>span:last-child]:text-muted-foreground [&[data-state=open]>div>span:last-child]:text-muted-foreground">
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranchIcon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{repoName}</span>
                <Badge variant="secondary" className="text-xs">
                  {commits.length} commit{commits.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <span className="text-muted-foreground text-xs">
                {expanded === "repo" ? "Hide details" : "Show details"}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <CardContent className="p-2 pt-0">
              <ScrollArea className="h-[250px]">
                <div className="space-y-2 pr-3">
                  {sortedBranches.map((branchName) => (
                    <BranchGroup
                      key={branchName}
                      branchName={branchName}
                      commits={commitsByBranch[branchName]}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

export function CommitOverlay({ commits, className = "" }: CommitOverlayProps) {
  if (commits.length === 0) {
    return null;
  }

  const commitsByRepo = commits.reduce(
    (acc, commit) => {
      const repoName = commit.repo_path.split("/").pop() || commit.repo_path;
      if (!acc[repoName]) {
        acc[repoName] = [];
      }
      acc[repoName].push(commit);
      return acc;
    },
    {} as Record<string, GitCommit[]>,
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {Object.entries(commitsByRepo).map(([repoName, repoCommits]) => (
        <RepoCard key={repoName} repoName={repoName} commits={repoCommits} />
      ))}
    </div>
  );
}

export default CommitOverlay;
