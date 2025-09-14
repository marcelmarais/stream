"use client";

import { FolderGit } from "lucide-react";
import { useState } from "react";
import type { GitCommit } from "../utils/gitReader";
import { formatCommitAuthor, getShortCommitId } from "../utils/gitReader";

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
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
      {/* Repo Header with compact info and toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderGit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="font-medium text-blue-800 text-sm dark:text-blue-200">
            {repoName}
          </span>
          <span className="rounded-full bg-blue-500/20 px-2 py-1 text-blue-700 text-xs dark:text-blue-300">
            {commits.length} commit{commits.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-blue-600 text-xs hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          {isExpanded ? "Hide" : "Show"} Details
        </button>
      </div>

      {/* Expanded commit details */}
      {isExpanded && (
        <div className="mt-3 space-y-2">
          {commits.map((commit) => (
            <div
              key={commit.id}
              className="rounded border border-border bg-muted p-2"
            >
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground text-xs">
                    {getShortCommitId(commit.id)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(commit.timestamp).toLocaleTimeString()}
                  </span>
                  {/* Branch indicators */}
                  <div className="flex gap-1">
                    {commit.branches.map((branch) => {
                      const cleanBranch = branch.replace("origin/", "");
                      const isMainBranch = [
                        "main",
                        "master",
                        "develop",
                      ].includes(cleanBranch);
                      return (
                        <span
                          key={branch}
                          className={`rounded px-1 py-0.5 text-xs ${
                            isMainBranch
                              ? "bg-green-100 text-green-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {cleanBranch}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatCommitAuthor(commit)}
                </span>
              </div>

              <div className="mb-2 text-foreground text-sm">
                {commit.message}
              </div>

              {commit.files_changed.length > 0 && (
                <div className="text-muted-foreground text-xs">
                  <span className="font-medium">Files:</span>{" "}
                  {commit.files_changed.length > 3 ? (
                    <>
                      {commit.files_changed.slice(0, 3).join(", ")}
                      <span className="text-muted-foreground">
                        {" "}
                        +{commit.files_changed.length - 3} more
                      </span>
                    </>
                  ) : (
                    commit.files_changed.join(", ")
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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
    <div className={`space-y-2 ${className}`}>
      {Object.entries(commitsByRepo).map(([repoName, repoCommits]) => (
        <RepoCard key={repoName} repoName={repoName} commits={repoCommits} />
      ))}
    </div>
  );
}

export default CommitOverlay;
