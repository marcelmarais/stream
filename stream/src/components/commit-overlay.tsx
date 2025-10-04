"use client";

import { FolderGit } from "lucide-react";
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
import type { GitCommit } from "../utils/git-reader";
import { formatCommitAuthor, getShortCommitId } from "../utils/git-reader";

interface CommitOverlayProps {
  commits: GitCommit[];
  date: Date;
  className?: string;
}

interface RepoCardProps {
  repoName: string;
  commits: GitCommit[];
}

function RepoCard({ repoName, commits }: RepoCardProps) {
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

  return (
    <Card className="bg-background/60 p-1">
      <Accordion
        type="single"
        collapsible
        value={expanded}
        onValueChange={(val) => setExpanded(val)}
      >
        <AccordionItem value="repo" className="border-0">
          <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=closed]>div>span:last-child]:text-muted-foreground [&[data-state=open]>div>span:last-child]:text-muted-foreground">
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderGit className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{repoName}</span>
                <Badge variant="secondary" className="text-xs">
                  {commits.length} commit{commits.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <span className="mr-2 text-muted-foreground text-xs">
                {expanded === "repo" ? "Hide details" : "Show details"}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {commits.map((commit) => {
                  const time = new Date(commit.timestamp).toLocaleTimeString();
                  return (
                    <div
                      key={commit.id}
                      className="group rounded-md border bg-card/50 p-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-muted-foreground text-xs">
                            {getShortCommitId(commit.id)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {time}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {commit.branches.map((branch) => {
                              const cleanBranch = branch.replace("origin/", "");
                              const isMainBranch = [
                                "main",
                                "master",
                                "develop",
                              ].includes(cleanBranch);
                              return (
                                <Badge
                                  key={branch}
                                  variant={
                                    isMainBranch ? "default" : "secondary"
                                  }
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  {cleanBranch}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {formatCommitAuthor(commit)}
                        </span>
                      </div>
                      <div className="text-foreground text-sm">
                        {commit.message}
                      </div>
                      {commit.files_changed.length > 0 && (
                        <div className="mt-2">
                          <div className="mb-1 text-muted-foreground text-xs">
                            Files
                          </div>
                          <ScrollArea className="w-full">
                            <div className="flex flex-wrap gap-1.5">
                              {(() => {
                                const isExpanded = expandedFiles.has(commit.id);
                                const filesToShow = isExpanded
                                  ? commit.files_changed
                                  : commit.files_changed.slice(0, 3);
                                const remainingCount =
                                  commit.files_changed.length - 3;

                                return (
                                  <>
                                    {filesToShow.map((file) => (
                                      <Badge
                                        key={file}
                                        variant="outline"
                                        className="px-1.5 py-0 font-normal text-[10px]"
                                      >
                                        {file}
                                      </Badge>
                                    ))}
                                    {!isExpanded && remainingCount > 0 && (
                                      <Badge
                                        variant="secondary"
                                        className="cursor-pointer px-1.5 py-0 text-[10px] hover:bg-secondary/80"
                                        onClick={() =>
                                          toggleFileExpansion(commit.id)
                                        }
                                      >
                                        +{remainingCount} others
                                      </Badge>
                                    )}
                                    {isExpanded &&
                                      commit.files_changed.length > 3 && (
                                        <Badge
                                          variant="secondary"
                                          className="cursor-pointer px-1.5 py-0 text-[10px] hover:bg-secondary/80"
                                          onClick={() =>
                                            toggleFileExpansion(commit.id)
                                          }
                                        >
                                          Show less
                                        </Badge>
                                      )}
                                  </>
                                );
                              })()}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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

  // Group commits by repository
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
