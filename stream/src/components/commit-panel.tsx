"use client";

import { Tabs } from "@base-ui/react/tabs";
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  ChatCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleNotchIcon,
  EyeIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  type Icon,
  type IconWeight,
  UserCheckIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { usePullRequests } from "@/hooks/use-git-queries";
import type {
  GitCommit,
  PullRequest,
  PullRequestChecks,
  PullRequestReview,
} from "@/ipc/git-reader";
import { isMainBranch } from "@/ipc/git-reader";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/user-store";
import { getDateKey } from "@/utils/date-utils";

const VISIBLE_ROWS = 6;
const VISIBLE_COMMITS = 4;

type RowState = "main" | "open" | "draft" | "branch" | "merged";

interface CommitPanelProps {
  commits: GitCommit[];
  date: Date;
  folderPath: string;
  className?: string;
}

interface Signal {
  icon: Icon;
  label: string;
  className: string;
  weight?: IconWeight;
}

interface WorkRow {
  id: string;
  state: RowState;
  title: string;
  commits: GitCommit[];
  pullRequest?: PullRequest;
}

interface RepoGroup {
  path: string;
  name: string;
  commits: GitCommit[];
  rows: WorkRow[];
}

// Colour and a filled glyph mean it needs you. Everything else stays quiet.
const ROW_SIGNALS: Record<RowState, Signal> = {
  main: {
    icon: GitCommitIcon,
    label: "Committed to main",
    className: "text-muted-foreground",
  },
  open: {
    icon: GitPullRequestIcon,
    label: "Open pull request",
    className: "text-foreground",
  },
  draft: {
    icon: CircleDashedIcon,
    label: "Draft pull request",
    className: "text-muted-foreground",
  },
  branch: {
    icon: GitBranchIcon,
    label: "Branch, no pull request",
    className: "text-muted-foreground",
  },
  merged: {
    icon: GitMergeIcon,
    label: "Merged",
    className: "text-muted-foreground",
    weight: "fill",
  },
};

const REVIEW_SIGNALS: Record<PullRequestReview, Signal> = {
  requested: {
    icon: EyeIcon,
    label: "Your review is requested",
    className: "text-primary",
    weight: "fill",
  },
  changes: {
    icon: ChatCircleDotsIcon,
    label: "Changes requested",
    className: "text-destructive",
    weight: "fill",
  },
  approved: {
    icon: UserCheckIcon,
    label: "Approved",
    className: "text-muted-foreground",
  },
};

const CHECK_SIGNALS: Record<PullRequestChecks, Signal> = {
  fail: {
    icon: XCircleIcon,
    label: "Checks failed",
    className: "text-destructive",
    weight: "fill",
  },
  running: {
    icon: CircleNotchIcon,
    label: "Checks running",
    className: "text-muted-foreground motion-safe:[&>svg]:animate-spin",
  },
  pass: {
    icon: CheckIcon,
    label: "Checks passed",
    className: "text-muted-foreground",
  },
};

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

function getRepoName(repoPath: string): string {
  return repoPath.split("/").pop() || repoPath;
}

function isOpen({ state }: { state: string }): boolean {
  return state === "open" || state === "draft";
}

function needsAttention({ checks, review }: PullRequest): boolean {
  return checks === "fail" || review === "changes" || review === "requested";
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

function getBranchState(branch: string, commits: GitCommit[]): RowState {
  if (isMainBranch(branch)) {
    return "main";
  }
  const isMerged = commits.every((commit) =>
    commit.branches.some(isMainBranch),
  );
  return isMerged ? "merged" : "branch";
}

function getRowRank({ state, pullRequest }: WorkRow): number {
  if (state === "main") {
    return 0;
  }
  if (pullRequest && needsAttention(pullRequest)) {
    return 1;
  }
  return ["open", "draft", "branch", "merged"].indexOf(state) + 2;
}

// Open pull requests are live state, so they sit on today even with no commits.
// Merged ones sit on the day they landed.
function belongsToDay(
  pullRequest: PullRequest,
  dateKey: string,
  todayKey: string,
): boolean {
  if (pullRequest.merged_at) {
    return getDateKey(new Date(pullRequest.merged_at)) === dateKey;
  }
  return dateKey === todayKey;
}

function buildRows(
  commits: GitCommit[],
  pullRequests: PullRequest[],
  dateKey: string,
  todayKey: string,
): WorkRow[] {
  const branches = new Map<string, GitCommit[]>();
  const rows = new Map<string, WorkRow>();

  for (const commit of commits) {
    const branch = getCommitBranch(commit);
    branches.set(branch, [...(branches.get(branch) ?? []), commit]);
  }

  for (const [branch, branchCommits] of branches) {
    const pullRequest = pullRequests.find((pr) => pr.branch === branch);
    rows.set(branch, {
      id: branch,
      state: pullRequest?.state ?? getBranchState(branch, branchCommits),
      title: pullRequest?.title ?? branch,
      commits: branchCommits,
      pullRequest,
    });
  }

  for (const pullRequest of pullRequests) {
    if (
      !rows.has(pullRequest.branch) &&
      belongsToDay(pullRequest, dateKey, todayKey)
    ) {
      rows.set(pullRequest.branch, {
        id: pullRequest.branch,
        state: pullRequest.state,
        title: pullRequest.title,
        commits: [],
        pullRequest,
      });
    }
  }

  return [...rows.values()].sort((a, b) => getRowRank(a) - getRowRank(b));
}

function groupWork(
  commits: GitCommit[],
  pullRequests: PullRequest[],
  date: Date,
): RepoGroup[] {
  const dateKey = getDateKey(date);
  const todayKey = getDateKey(new Date());
  const repos = new Map<string, GitCommit[]>();

  for (const commit of [...commits].sort((a, b) => b.timestamp - a.timestamp)) {
    repos.set(commit.repo_path, [
      ...(repos.get(commit.repo_path) ?? []),
      commit,
    ]);
  }

  for (const pullRequest of pullRequests) {
    if (
      !repos.has(pullRequest.repo_path) &&
      belongsToDay(pullRequest, dateKey, todayKey)
    ) {
      repos.set(pullRequest.repo_path, []);
    }
  }

  return [...repos].map(([path, repoCommits]) => ({
    path,
    name: getRepoName(path),
    commits: repoCommits,
    rows: buildRows(
      repoCommits,
      pullRequests.filter((pr) => pr.repo_path === path),
      dateKey,
      todayKey,
    ),
  }));
}

function getSummary(rows: WorkRow[]): string {
  const openCount = rows.filter(isOpen).length;
  const commitCount = rows.reduce((sum, row) => sum + row.commits.length, 0);

  return [
    openCount > 0 && `${openCount} open`,
    commitCount > 0 && pluralise(commitCount, "commit"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function SignalIcon({ signal }: { signal: Signal | null }) {
  if (!signal) {
    return <span />;
  }

  const { icon: Glyph, label, className, weight } = signal;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex", className)}
    >
      <Glyph className="size-3.5" weight={weight} aria-hidden="true" />
    </span>
  );
}

function PullRequestMeta({ pullRequest }: { pullRequest: PullRequest }) {
  const { additions, branch, comments, deletions, number, url } = pullRequest;

  return (
    <div className="flex items-center justify-between gap-3 text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 items-center gap-1">
          <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{branch}</span>
        </span>
        <span className="shrink-0">
          +{additions} −{deletions}
        </span>
        {comments > 0 && (
          <span className="flex shrink-0 items-center gap-1" title="Comments">
            <ChatCircleIcon className="size-3.5" aria-hidden="true" />
            {comments}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => openUrl(url)}
        className="flex shrink-0 items-center gap-1 text-foreground hover:text-primary"
        title="View pull request on GitHub"
      >
        #{number}
        <ArrowSquareOutIcon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function CommitLog({ commits }: { commits: GitCommit[] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = commits.length - VISIBLE_COMMITS;
  const visible = showAll ? commits : commits.slice(0, VISIBLE_COMMITS);

  return (
    <div className="flex flex-col">
      {visible.map(({ id, message, timestamp, url }) => (
        <button
          key={id}
          type="button"
          disabled={!url}
          onClick={() => url && openUrl(url)}
          className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2 text-left enabled:hover:text-foreground"
          title={url ? "View commit on remote" : undefined}
        >
          <span className="text-muted-foreground">{formatTime(timestamp)}</span>
          <span className="truncate">{message}</span>
        </button>
      ))}
      {!showAll && hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-fit text-muted-foreground hover:text-foreground"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

function RowDetail({ row }: { row: WorkRow }) {
  const { commits, pullRequest } = row;

  return (
    <div className="flex flex-col gap-1.5 pt-0.5 pr-2.5 pb-2.5 pl-8 text-[11.5px] leading-[1.6]">
      {pullRequest && <PullRequestMeta pullRequest={pullRequest} />}
      {pullRequest?.failed_checks.map((check) => (
        <span key={check} className="flex items-center gap-1 text-destructive">
          <XCircleIcon className="size-3.5" weight="fill" aria-hidden="true" />
          {check}
        </span>
      ))}
      {commits.length > 0 && <CommitLog commits={commits} />}
    </div>
  );
}

function RowItem({
  row,
  isExpanded,
  onToggle,
}: {
  row: WorkRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { commits, pullRequest, state, title } = row;
  const review = pullRequest?.review;
  const checks = pullRequest?.state === "merged" ? null : pullRequest?.checks;

  return (
    <div className={cn("flex flex-col", isExpanded && "bg-well-raised")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="grid h-[27px] w-full grid-cols-[14px_minmax(0,1fr)_14px_14px_38px] items-center gap-x-2 px-2.5 text-left hover:bg-well-raised"
      >
        <SignalIcon signal={ROW_SIGNALS[state]} />
        <span
          className={cn(
            "min-w-0 truncate",
            isExpanded ? "text-foreground" : "text-body",
          )}
        >
          {title}
        </span>
        <SignalIcon signal={review ? REVIEW_SIGNALS[review] : null} />
        <SignalIcon signal={checks ? CHECK_SIGNALS[checks] : null} />
        <span
          className="flex items-center justify-end gap-1 text-muted-foreground"
          title={
            commits.length > 0 ? pluralise(commits.length, "commit") : undefined
          }
        >
          {commits.length > 0 && (
            <>
              <GitCommitIcon className="size-3.5" aria-hidden="true" />
              {commits.length}
            </>
          )}
        </span>
      </button>
      {isExpanded && <RowDetail row={row} />}
    </div>
  );
}

function RepoRows({
  rows,
  openRowId,
  onToggleRow,
}: {
  rows: WorkRow[];
  openRowId: string | null;
  onToggleRow: (rowId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = rows.length - VISIBLE_ROWS;
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <>
      {visible.map((row) => (
        <RowItem
          key={row.id}
          row={row}
          isExpanded={row.id === openRowId}
          onToggle={() => onToggleRow(row.id)}
        />
      ))}
      {!showAll && hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="h-[25px] pl-8 text-left text-muted-foreground hover:text-foreground"
        >
          Show {hidden} more
        </button>
      )}
    </>
  );
}

export function CommitPanel({
  commits,
  date,
  folderPath,
  className,
}: CommitPanelProps) {
  const pullRequests = usePullRequests(folderPath);
  const repoFilter = useUserStore((state) => state.commitFilters.repos);

  const repos = useMemo(() => {
    const visiblePullRequests = pullRequests.filter(
      ({ repo_path }) =>
        repoFilter.length === 0 || repoFilter.includes(getRepoName(repo_path)),
    );
    return groupWork(commits, visiblePullRequests, date);
  }, [commits, date, pullRequests, repoFilter]);

  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [lastRepo, setLastRepo] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const repo = repos.find(({ path }) => path === activeRepo);
  const isPanelOpen = Boolean(repo);

  const toggleRepo = (path: string) => {
    setActiveRepo(path === activeRepo ? null : path);
    setLastRepo(path);
    setOpenRowId(null);
  };

  const togglePanel = () => {
    setActiveRepo(isPanelOpen ? null : (lastRepo ?? repos[0]?.path ?? null));
  };

  const toggleRow = (rowId: string) => {
    setOpenRowId(rowId === openRowId ? null : rowId);
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
        value={repo?.path ?? null}
        className="flex flex-col overflow-hidden rounded-[3px] border border-well-rule bg-well text-xs leading-[1.4]"
      >
        <div className="flex h-[30px] items-stretch">
          <Tabs.List
            aria-label="Repositories"
            className="flex min-w-0 items-stretch overflow-x-auto"
          >
            {repos.map(({ path, name, commits: repoCommits }) => (
              <Tabs.Tab
                key={path}
                value={path}
                onClick={() => toggleRepo(path)}
                className={cn(
                  "flex shrink-0 items-center gap-[7px] border-well-rule border-r px-[11px] font-medium",
                  path === activeRepo &&
                    "shadow-[inset_0_-2px_0_var(--primary)]",
                  isPanelOpen && path !== activeRepo
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                <span>{name}</span>
                {repoCommits.length > 0 && (
                  <span className="font-normal text-muted-foreground">
                    {repoCommits.length}
                  </span>
                )}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <button
            type="button"
            onClick={togglePanel}
            aria-expanded={isPanelOpen}
            aria-label={isPanelOpen ? "Close work" : "Open work"}
            className="ml-auto flex shrink-0 items-center gap-2 px-2.5 text-muted-foreground hover:text-foreground"
          >
            <span>
              {getSummary(repo?.rows ?? repos.flatMap(({ rows }) => rows))}
            </span>
            <CaretRightIcon
              className={cn("size-3", isPanelOpen && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        </div>
        {repos.map(({ path, rows }) => (
          <Tabs.Panel
            key={path}
            value={path}
            className="flex flex-col border-well-rule border-t pt-1 pb-1.5"
          >
            <RepoRows
              rows={rows}
              openRowId={openRowId}
              onToggleRow={toggleRow}
            />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

export default CommitPanel;
