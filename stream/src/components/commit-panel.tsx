"use client";

import { Tabs } from "@base-ui/react/tabs";
import { CaretRightIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import type { GitCommit } from "@/ipc/git-reader";
import {
  formatCommitAuthor,
  getShortCommitId,
  isMainBranch,
} from "@/ipc/git-reader";
import { cn } from "@/lib/utils";

const VISIBLE_COMMITS = 4;
const VISIBLE_FILES = 6;

interface CommitPanelProps {
  commits: GitCommit[];
  className?: string;
}

interface BranchGroup {
  name: string;
  commits: GitCommit[];
}

interface RepoGroup {
  name: string;
  commits: GitCommit[];
  branches: BranchGroup[];
  fileCount: number;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function countFiles(commits: GitCommit[]): number {
  return new Set(commits.flatMap((commit) => commit.files_changed)).size;
}

// A commit lists every branch containing it, so a merged commit is on main and
// its feature branch. Showing it once, on the feature branch, keeps counts true.
function getCommitBranch(commit: GitCommit): string {
  const branches = commit.branches.map((branch) =>
    branch.replace("origin/", ""),
  );
  return (
    branches.find((branch) => !isMainBranch(branch)) ??
    branches[0] ??
    "no branch"
  );
}

function groupCommits(commits: GitCommit[]): RepoGroup[] {
  const repos = new Map<string, GitCommit[]>();

  for (const commit of [...commits].sort((a, b) => b.timestamp - a.timestamp)) {
    const repoName = commit.repo_path.split("/").pop() || commit.repo_path;
    repos.set(repoName, [...(repos.get(repoName) ?? []), commit]);
  }

  return [...repos].map(([name, repoCommits]) => {
    const branches = new Map<string, GitCommit[]>();

    for (const commit of repoCommits) {
      const branch = getCommitBranch(commit);
      branches.set(branch, [...(branches.get(branch) ?? []), commit]);
    }

    return {
      name,
      commits: repoCommits,
      branches: [...branches].map(([branchName, branchCommits]) => ({
        name: branchName,
        commits: branchCommits,
      })),
      fileCount: countFiles(repoCommits),
    };
  });
}

function getBranchSpan(commits: GitCommit[]): string {
  const latest = formatTime(commits[0].timestamp);
  const earliest = formatTime(commits[commits.length - 1].timestamp);
  return latest === earliest ? latest : `${earliest} to ${latest}`;
}

function getFileHint(commit: GitCommit): string {
  if (commit.files_changed.length === 1) {
    return commit.files_changed[0].split("/").pop() ?? "";
  }
  return pluralise(commit.files_changed.length, "file");
}

function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf("/") + 1;

  return (
    <span className="truncate">
      <span className="text-muted-foreground">{path.slice(0, slash)}</span>
      <span className="text-foreground">{path.slice(slash)}</span>
    </span>
  );
}

function CommitDetail({ commit }: { commit: GitCommit }) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const { files_changed: files, url } = commit;
  const hiddenFiles = files.length - VISIBLE_FILES;
  const visibleFiles = showAllFiles ? files : files.slice(0, VISIBLE_FILES);
  const shortId = getShortCommitId(commit.id);

  return (
    <div className="flex flex-col pt-0.5 pr-2.5 pb-2 pl-[72px] text-[11.5px] leading-[1.6]">
      {visibleFiles.map((file) => (
        <FilePath key={file} path={file} />
      ))}
      {!showAllFiles && hiddenFiles > 0 && (
        <button
          type="button"
          onClick={() => setShowAllFiles(true)}
          className="w-fit text-muted-foreground hover:text-foreground"
        >
          {pluralise(hiddenFiles, "more file")}
        </button>
      )}
      <div className="mt-1 flex justify-between gap-3 text-muted-foreground">
        <span className="truncate">{formatCommitAuthor(commit)}</span>
        {url ? (
          <button
            type="button"
            onClick={() => openUrl(url)}
            className="shrink-0 text-foreground hover:text-primary"
            title="View commit on remote"
          >
            {shortId} ↗
          </button>
        ) : (
          <span className="shrink-0">{shortId}</span>
        )}
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  isOpen,
  onToggle,
}: {
  commit: GitCommit;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn("flex flex-col", isOpen && "bg-well-raised")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="grid h-[25px] w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-2 pr-2.5 pl-6 text-left hover:bg-well-raised"
      >
        <span className="text-muted-foreground">
          {formatTime(commit.timestamp)}
        </span>
        <span
          className={cn(
            "min-w-0 truncate",
            isOpen ? "text-foreground" : "text-body",
          )}
        >
          {commit.message}
        </span>
        <span className="text-muted-foreground">{getFileHint(commit)}</span>
      </button>
      {isOpen && <CommitDetail commit={commit} />}
    </div>
  );
}

function BranchSection({
  branch,
  isLatest,
  openCommitId,
  onToggleCommit,
}: {
  branch: BranchGroup;
  isLatest: boolean;
  openCommitId: string | null;
  onToggleCommit: (commitId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = branch.commits.length - VISIBLE_COMMITS;
  const commits = showAll
    ? branch.commits
    : branch.commits.slice(0, VISIBLE_COMMITS);

  return (
    <div className="flex flex-col">
      <div className="grid h-[27px] grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-x-2 px-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            isLatest ? "bg-primary" : "bg-muted-foreground",
          )}
        />
        <span className="truncate font-semibold text-foreground">
          {branch.name}
        </span>
        <span className="text-muted-foreground">
          {getBranchSpan(branch.commits)}
        </span>
      </div>
      {commits.map((commit) => (
        <CommitRow
          key={commit.id}
          commit={commit}
          isOpen={commit.id === openCommitId}
          onToggle={() => onToggleCommit(commit.id)}
        />
      ))}
      {!showAll && hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="h-[25px] pl-[72px] text-left text-muted-foreground hover:text-foreground"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

export function CommitPanel({ commits, className }: CommitPanelProps) {
  const repos = useMemo(() => groupCommits(commits), [commits]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [lastRepo, setLastRepo] = useState<string | null>(null);
  const [openCommitId, setOpenCommitId] = useState<string | null>(null);

  const repo = repos.find(({ name }) => name === activeRepo);
  const isOpen = Boolean(repo);

  const toggleRepo = (name: string) => {
    setActiveRepo(name === activeRepo ? null : name);
    setLastRepo(name);
    setOpenCommitId(null);
  };

  const togglePanel = () => {
    setActiveRepo(isOpen ? null : (lastRepo ?? repos[0]?.name ?? null));
  };

  const toggleCommit = (commitId: string) => {
    setOpenCommitId(commitId === openCommitId ? null : commitId);
  };

  if (repos.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden="true"
        className="-left-6 absolute top-[15px] h-px w-6 bg-rail"
      />
      <Tabs.Root
        value={repo?.name ?? null}
        className="flex flex-col overflow-hidden rounded-[3px] border border-well-rule bg-well text-xs leading-[1.4]"
      >
        <div className="flex h-[30px] items-stretch">
          <Tabs.List
            aria-label="Repositories"
            className="flex min-w-0 items-stretch overflow-x-auto"
          >
            {repos.map(({ name, commits: repoCommits }) => (
              <Tabs.Tab
                key={name}
                value={name}
                onClick={() => toggleRepo(name)}
                className={cn(
                  "flex shrink-0 items-center gap-[7px] border-well-rule border-r px-[11px] font-medium",
                  name === activeRepo &&
                    "shadow-[inset_0_-2px_0_var(--primary)]",
                  isOpen && name !== activeRepo
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                <span>{name}</span>
                <span className="font-normal text-muted-foreground">
                  {repoCommits.length}
                </span>
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <button
            type="button"
            onClick={togglePanel}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Close commits" : "Open commits"}
            className="ml-auto flex shrink-0 items-center gap-2 px-2.5 text-muted-foreground hover:text-foreground"
          >
            <span>
              {pluralise(repo?.fileCount ?? countFiles(commits), "file")}
            </span>
            <CaretRightIcon
              className={cn("size-3", isOpen && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        </div>
        {repos.map(({ name, branches }) => (
          <Tabs.Panel
            key={name}
            value={name}
            className="flex flex-col gap-1 border-well-rule border-t pt-1 pb-1.5"
          >
            {branches.map((branch, index) => (
              <BranchSection
                key={branch.name}
                branch={branch}
                isLatest={index === 0}
                openCommitId={openCommitId}
                onToggleCommit={toggleCommit}
              />
            ))}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

export default CommitPanel;
