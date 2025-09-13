"use client";

import { useState } from "react";
import type { GitCommit } from "../utils/gitReader";
import {
  formatCommitAuthor,
  formatCommitMessage,
  getShortCommitId,
} from "../utils/gitReader";

interface CommitOverlayProps {
  commits: GitCommit[];
  date: Date;
  className?: string;
}

export function CommitOverlay({
  commits,
  date,
  className = "",
}: CommitOverlayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

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

  const repoCount = Object.keys(commitsByRepo).length;
  const totalCommits = commits.length;

  return (
    <div
      className={`rounded-lg border border-blue-200 bg-blue-50 p-3 ${className}`}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-blue-600 text-sm">🔄</span>
          <h4 className="font-medium text-blue-800 text-sm">
            Git Activity - {date.toLocaleDateString()}
          </h4>
          <span className="rounded-full bg-blue-200 px-2 py-1 text-blue-700 text-xs">
            {totalCommits} commit{totalCommits !== 1 ? "s" : ""} from{" "}
            {repoCount} repo{repoCount !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-blue-600 text-xs hover:text-blue-800"
        >
          {isExpanded ? "Hide" : "Show"} Details
        </button>
      </div>

      {/* Compact Summary (always visible) */}
      {!isExpanded && (
        <div className="space-y-1">
          {Object.entries(commitsByRepo)
            .slice(0, 2)
            .map(([repoName, repoCommits]) => (
              <div key={repoName} className="text-blue-700 text-xs">
                📁 <span className="font-medium">{repoName}</span>:{" "}
                {repoCommits.length} commit{repoCommits.length !== 1 ? "s" : ""}
                {repoCommits.length > 0 && (
                  <span className="ml-2 text-blue-600">
                    "{formatCommitMessage(repoCommits[0].message, 30)}"
                    {repoCommits[0].branches.length > 0 && (
                      <span className="ml-1 rounded bg-blue-100 px-1 py-0.5 text-blue-700 text-xs">
                        {repoCommits[0].branches[0].replace("origin/", "")}
                      </span>
                    )}
                  </span>
                )}
              </div>
            ))}
          {repoCount > 2 && (
            <div className="text-blue-600 text-xs">
              +{repoCount - 2} more repositories...
            </div>
          )}
        </div>
      )}

      {/* Detailed View */}
      {isExpanded && (
        <div className="space-y-3">
          {Object.entries(commitsByRepo).map(([repoName, repoCommits]) => (
            <div
              key={repoName}
              className="rounded-md border border-blue-300 bg-white p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-blue-600 text-sm">📁</span>
                <h5 className="font-medium text-blue-800 text-sm">
                  {repoName}
                </h5>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700 text-xs">
                  {repoCommits.length} commit
                  {repoCommits.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="space-y-2">
                {repoCommits.map((commit) => (
                  <div
                    key={commit.id}
                    className="rounded border border-gray-200 bg-gray-50 p-2"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-600 text-xs">
                          {getShortCommitId(commit.id)}
                        </span>
                        <span className="text-gray-500 text-xs">
                          {new Date(commit.timestamp).toLocaleTimeString()}
                        </span>
                        {/* Branch indicators */}
                        <div className="flex gap-1">
                          {commit.branches.map((branch) => {
                            const cleanBranch = branch.replace("origin/", "");
                            const isMainBranch = ["main", "master", "develop"].includes(cleanBranch);
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
                      <span className="text-gray-600 text-xs">
                        {formatCommitAuthor(commit)}
                      </span>
                    </div>

                    <div className="mb-2 text-gray-800 text-sm">
                      {commit.message}
                    </div>

                    {commit.files_changed.length > 0 && (
                      <div className="text-gray-600 text-xs">
                        <span className="font-medium">Files:</span>{" "}
                        {commit.files_changed.length > 3 ? (
                          <>
                            {commit.files_changed.slice(0, 3).join(", ")}
                            <span className="text-gray-500">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CommitOverlay;
