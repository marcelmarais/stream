"use client";

import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  DotOutlineIcon,
  GitBranchIcon,
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
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
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
  const isExpanded = expanded === "branch";

  const allCommitsForTimeline = isExpanded ? sortedCommits : [firstCommit];

  return (
    <Accordion
      type="single"
      collapsible
      value={expanded}
      onValueChange={setExpanded}
      className="rounded-md border bg-card/30"
    >
      <AccordionItem value="branch" className="border-0">
        <AccordionTrigger className="flex h-auto w-full items-center justify-between px-3 py-2.5 hover:bg-muted/50 hover:no-underline [&>svg]:hidden">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{branchName}</span>
          </div>
          {remainingCommits.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-xs">
                {isExpanded ? "less" : `${remainingCommits.length} more`}
              </span>
              <CaretDownIcon
                className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                weight="bold"
              />
            </div>
          )}
        </AccordionTrigger>

        <div className="px-3 pt-1 pb-2">
          {allCommitsForTimeline.map((commit, index) => (
            <CommitItem
              key={commit.id}
              commit={commit}
              expandedFiles={expandedFiles}
              toggleFileExpansion={toggleFileExpansion}
              compact={!isExpanded}
              isLast={index === allCommitsForTimeline.length - 1}
            />
          ))}
        </div>

        {remainingCommits.length > 0 && <AccordionContent className="hidden" />}
      </AccordionItem>
    </Accordion>
  );
}

interface CommitItemProps {
  commit: GitCommit;
  expandedFiles: Set<string>;
  toggleFileExpansion: (commitId: string) => void;
  compact?: boolean;
  isLast?: boolean;
}

function CommitItem({
  commit,
  expandedFiles,
  toggleFileExpansion,
  compact = false,
  isLast = false,
}: CommitItemProps) {
  const time = new Date(commit.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const url = commit.url;

  return (
    <div className="group relative flex gap-3 pl-5">
      {/* Timeline dot */}
      <div className="absolute top-1 left-0 h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/40 bg-background" />
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute top-4 bottom-0 left-[4.5px] w-px bg-muted-foreground/20" />
      )}

      <div className="flex-1 space-y-1.5 pb-4">
        {/* Row 1: Time + Message */}
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-muted-foreground text-xs">{time}</span>
          <span
            className={`min-w-0 text-foreground text-xs leading-snug ${compact ? "truncate" : ""}`}
          >
            {commit.message}
          </span>
        </div>

        {/* Row 2: Author + Commit ID */}
        <div className="flex items-center gap-0.5 text-muted-foreground text-xs">
          <span>{formatCommitAuthor(commit)}</span>
          <DotOutlineIcon
            className="h-3 w-3 text-muted-foreground/40"
            weight="fill"
          />
          {url ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openUrl(url);
              }}
              className="inline-flex cursor-pointer items-center gap-0.5 font-mono transition-colors hover:text-foreground"
              title="View commit on remote"
            >
              <span>{getShortCommitId(commit.id)}</span>
              <ArrowSquareOutIcon className="h-3 w-3" weight="regular" />
            </button>
          ) : (
            <span className="font-mono">{getShortCommitId(commit.id)}</span>
          )}
        </div>

        {/* Row 3: File badges */}
        {!compact && commit.files_changed.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
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
                      className="px-1.5 py-0.5 font-normal text-[10px] text-muted-foreground"
                    >
                      {truncateFilePath(file)}
                    </Badge>
                  ))}
                  {!isExpanded && remainingCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="cursor-pointer px-1.5 py-0.5 text-[10px] hover:bg-secondary/80"
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
                      className="cursor-pointer px-1.5 py-0.5 text-[10px] hover:bg-secondary/80"
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
        )}
      </div>
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
