"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Tooltip } from "@base-ui/react/tooltip";
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
  MinusIcon,
  UserCheckIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { motion, type Transition, useReducedMotion } from "framer-motion";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AgentStack,
  getAgentStackWidth,
  TOOLTIP_CLOSE_DELAY_MS,
} from "@/components/agent-stack";
import {
  useDefaultBranches,
  useFetchFailure,
  usePullRequests,
} from "@/hooks/use-git-queries";
import type { RunningAgent } from "@/ipc/agents";
import type {
  CheckRun,
  CheckRunStatus,
  DefaultBranch,
  GitCommit,
  PullRequest,
  PullRequestChecks,
  PullRequestReview,
} from "@/ipc/git-reader";
import { isMainBranch, isMineOrRequested } from "@/ipc/git-reader";
import { cn } from "@/lib/utils";
import { getDateKey } from "@/utils/date-utils";

const VISIBLE_ROWS = 6;
const VISIBLE_COMMITS = 4;
const NO_BRANCH = "no branch";
const DEFAULT_MAIN_BRANCH = "main";
const NO_AGENTS: RunningAgent[] = [];
// Larger than any rank, so other people's work sorts below all of mine
const OTHER_PEOPLES_RANK = 6;
// Relative times only change by the minute, so this keeps them close enough
const TIME_TICK_MS = 30000;
const CHANGES_REQUESTED = "CHANGES_REQUESTED";

// Most urgent first, so a failure is never scrolled out of view
const CHECK_RUN_ORDER: CheckRunStatus[] = [
  "fail",
  "running",
  "pass",
  "skipped",
];

// What's blocking comes first
const REVIEW_VERDICTS = [
  { state: CHANGES_REQUESTED, label: "Changes requested by" },
  { state: "APPROVED", label: "Approved by" },
];

// Quick to start and soft to land. Closing is a little faster than opening,
// and the rows fade in behind the rising edge but leave before it falls.
const DOCK_EASE: Transition["ease"] = [0.22, 1, 0.36, 1];
const DOCK_OPEN: Transition = {
  height: { duration: 0.22, ease: DOCK_EASE },
  opacity: { duration: 0.15, delay: 0.055, ease: "linear" },
};
const DOCK_CLOSE: Transition = {
  height: { duration: 0.18, ease: DOCK_EASE },
  opacity: { duration: 0.07, ease: "linear" },
};
const NO_MOTION: Transition = { duration: 0 };

type RowState = "main" | "open" | "draft" | "branch" | "merged";

interface CommitPanelProps {
  commits: GitCommit[];
  agents?: RunningAgent[];
  date: Date;
  folderPath: string;
  className?: string;
  /** Sits on the bottom edge of the window and grows upwards when opened */
  docked?: boolean;
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
  agents: RunningAgent[];
  pullRequest?: PullRequest;
  isMine: boolean;
  checks: PullRequestChecks | null;
  checkRuns: CheckRun[];
  lastCommitTime: number | null;
}

interface RepoGroup {
  path: string;
  name: string;
  commits: GitCommit[];
  agents: RunningAgent[];
  rows: WorkRow[];
}

// Colour and a filled glyph mean it needs you. Everything else stays quiet,
// apart from two deliberate exceptions that say work is done: the green check
// on passing checks and the purple icon on merged work.
const ROW_SIGNALS: Record<RowState, Signal> = {
  main: {
    icon: GitCommitIcon,
    label: "Main branch",
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
    className: "text-merged",
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
    className: "text-primary",
  },
};

const CHECK_RUN_SIGNALS: Record<CheckRunStatus, Signal> = {
  fail: { ...CHECK_SIGNALS.fail, label: "failed" },
  running: { ...CHECK_SIGNALS.running, label: "running" },
  pass: { ...CHECK_SIGNALS.pass, label: "passed" },
  skipped: { icon: MinusIcon, label: "skipped", className: "text-faint" },
};

// Someone else's failure is worth seeing, but it isn't mine to fix
const QUIET_FAILURE: Pick<Signal, "className" | "weight"> = {
  className: "text-muted-foreground",
  weight: "regular",
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

// Today's rows say how long ago, because that's what changes. On a past day
// that would only grow, so they say when.
export function formatRowTime(
  timestamp: number,
  now: number,
  isToday: boolean,
): string {
  if (!isToday) {
    return formatTime(timestamp);
  }

  const minutes = Math.floor((now - timestamp) / 60000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function getFailedChecks(checkRuns: CheckRun[]): CheckRun[] {
  return checkRuns.filter(({ status }) => status === "fail");
}

function getCheckSummary(checkRuns: CheckRun[]): string {
  return CHECK_RUN_ORDER.flatMap((status) => {
    const count = checkRuns.filter((run) => run.status === status).length;
    return count > 0 ? `${count} ${CHECK_RUN_SIGNALS[status].label}` : [];
  }).join(", ");
}

// Where a click on the check icon goes. A failure's own logs beat the list of
// checks, which beats a check that didn't fail.
export function getCheckTarget(
  checkRuns: CheckRun[],
  pullRequest: PullRequest | undefined,
): string | null {
  return (
    getFailedChecks(checkRuns).find(({ url }) => url)?.url ??
    (pullRequest && `${pullRequest.url}/checks`) ??
    checkRuns.find(({ url }) => url)?.url ??
    null
  );
}

export function quietenColleagueFailure(
  signal: Signal,
  status: CheckRunStatus,
  pullRequest: PullRequest | undefined,
): Signal {
  return status === "fail" && pullRequest && !isMineOrRequested(pullRequest)
    ? { ...signal, ...QUIET_FAILURE }
    : signal;
}

// Requested changes only need me on my own pull request
export function getReviewVerdicts({ is_mine, reviews }: PullRequest): {
  text: string;
  needsMe: boolean;
}[] {
  return REVIEW_VERDICTS.flatMap(({ state, label }) => {
    const logins = reviews
      .filter((review) => review.state === state)
      .map(({ login }) => login);

    return logins.length > 0
      ? {
          text: `${label} ${logins.join(", ")}`,
          needsMe: is_mine && state === CHANGES_REQUESTED,
        }
      : [];
  });
}

function getRepoName(repoPath: string): string {
  return repoPath.split("/").pop() || repoPath;
}

function needsAttention({ checks, review }: PullRequest): boolean {
  return checks === "fail" || review === "changes" || review === "requested";
}

// A commit lists every branch containing it, so a merged commit is on main and
// its feature branch. Showing it once, on the feature branch, keeps counts true.
function getCommitBranch(commit: GitCommit): string {
  const branches = getLocalBranches(commit);
  return (
    branches.find((branch) => !isMainBranch(branch)) ?? branches[0] ?? NO_BRANCH
  );
}

function getLocalBranches(commit: GitCommit): string[] {
  return commit.branches.map((branch) => branch.replace("origin/", ""));
}

// The day's work is the only sign of what a repo calls its main branch
function getMainBranch(commits: GitCommit[], agents: RunningAgent[]): string {
  const seen = [
    ...commits.flatMap(getLocalBranches),
    ...agents.flatMap(({ branch }) => branch ?? []),
  ];
  return seen.find(isMainBranch) ?? DEFAULT_MAIN_BRANCH;
}

function getBranchState(branch: string, commits: GitCommit[]): RowState {
  if (isMainBranch(branch)) {
    return "main";
  }
  const isMerged =
    commits.length > 0 &&
    commits.every((commit) => commit.branches.some(isMainBranch));
  return isMerged ? "merged" : "branch";
}

// It's mine if I wrote the pull request or committed to the branch. Either way,
// an agent on this Mac means I'm working on it now.
function isMyWork(
  commits: GitCommit[],
  agents: RunningAgent[],
  pullRequest: PullRequest | undefined,
): boolean {
  return (
    agents.length > 0 ||
    Boolean(pullRequest?.is_mine) ||
    commits.some(({ is_mine }) => is_mine)
  );
}

function getRowRank({ state, agents, pullRequest, isMine }: WorkRow): number {
  if (state === "main") {
    return 0;
  }
  const rank =
    agents.length > 0 || (pullRequest && needsAttention(pullRequest))
      ? 1
      : ["open", "draft", "branch", "merged"].indexOf(state) + 2;
  return isMine ? rank : rank + OTHER_PEOPLES_RANK;
}

// Open pull requests are live state, so they sit on today even with no commits.
// Merged ones sit on the day they landed. Other people's never stand alone.
function belongsToDay(
  pullRequest: PullRequest,
  dateKey: string,
  todayKey: string,
): boolean {
  if (!isMineOrRequested(pullRequest)) {
    return false;
  }
  if (pullRequest.merged_at) {
    return getDateKey(new Date(pullRequest.merged_at)) === dateKey;
  }
  return dateKey === todayKey;
}

// Commit times stop at the second, so a rebased stack can share one. Parents
// still say which came last. Lines that tie can't be separated, so neither wins.
function getNewestCommit(commits: GitCommit[]): GitCommit | undefined {
  const parents = new Set(commits.flatMap((commit) => commit.parents));
  const tips = commits.filter(({ id }) => !parents.has(id));
  const newestTime = Math.max(...tips.map(({ timestamp }) => timestamp));
  const newest = tips.filter(({ timestamp }) => timestamp === newestTime);

  return newest.length === 1 ? newest[0] : undefined;
}

// Checks describe one commit, so a row only shows them if it leads with that
// commit. A row with no commits has only the present to describe.
function getRowChecks(
  checked: PullRequest | DefaultBranch | undefined,
  commits: GitCommit[],
  dateKey: string,
  todayKey: string,
): Pick<WorkRow, "checks" | "checkRuns"> {
  const isCurrent =
    commits.length > 0
      ? checked && getNewestCommit(commits)?.id === checked.head_sha
      : dateKey === todayKey;

  return isCurrent && checked
    ? { checks: checked.checks, checkRuns: checked.check_runs }
    : { checks: null, checkRuns: [] };
}

// A row with no commits has only GitHub's word for it, which on a past day must
// come from that day, because a clock time reads as one.
function getLastCommitTime(
  checked: PullRequest | DefaultBranch | undefined,
  commits: GitCommit[],
  dateKey: string,
  todayKey: string,
): number | null {
  if (commits.length > 0) {
    return Math.max(...commits.map(({ timestamp }) => timestamp));
  }
  if (!checked?.last_commit_at) {
    return null;
  }

  const lastCommit = new Date(checked.last_commit_at);
  return dateKey === todayKey || getDateKey(lastCommit) === dateKey
    ? lastCommit.getTime()
    : null;
}

export function buildRows(
  commits: GitCommit[],
  pullRequests: PullRequest[],
  agents: RunningAgent[],
  defaultBranch: DefaultBranch | undefined,
  dateKey: string,
  todayKey: string,
): WorkRow[] {
  const mainBranch = defaultBranch?.branch ?? getMainBranch(commits, agents);

  // Main always heads the list, even when nothing landed on it directly
  const branches = new Map<string, GitCommit[]>([[mainBranch, []]]);
  const rows = new Map<string, WorkRow>();

  for (const commit of commits) {
    const branch = getCommitBranch(commit);
    branches.set(branch, [...(branches.get(branch) ?? []), commit]);
  }

  // An agent can be working on a branch with nothing committed yet
  for (const agent of agents) {
    const branch = agent.branch ?? NO_BRANCH;
    branches.set(branch, branches.get(branch) ?? []);
  }

  for (const [branch, branchCommits] of branches) {
    const isMain = branch === mainBranch;
    const pullRequest = isMain
      ? undefined
      : pullRequests.find((pr) => pr.branch === branch);
    const branchAgents = agents.filter(
      (agent) => (agent.branch ?? NO_BRANCH) === branch,
    );
    const checked = isMain ? defaultBranch : pullRequest;
    rows.set(branch, {
      id: branch,
      state: isMain
        ? "main"
        : (pullRequest?.state ?? getBranchState(branch, branchCommits)),
      title: pullRequest?.title ?? branch,
      commits: branchCommits,
      agents: branchAgents,
      pullRequest,
      isMine: isMyWork(branchCommits, branchAgents, pullRequest),
      ...getRowChecks(checked, branchCommits, dateKey, todayKey),
      lastCommitTime: getLastCommitTime(
        checked,
        branchCommits,
        dateKey,
        todayKey,
      ),
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
        agents: [],
        pullRequest,
        isMine: pullRequest.is_mine,
        ...getRowChecks(pullRequest, [], dateKey, todayKey),
        lastCommitTime: getLastCommitTime(pullRequest, [], dateKey, todayKey),
      });
    }
  }

  return [...rows.values()].sort((a, b) => getRowRank(a) - getRowRank(b));
}

export function groupWork(
  commits: GitCommit[],
  pullRequests: PullRequest[],
  agents: RunningAgent[],
  defaultBranches: DefaultBranch[],
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

  for (const agent of agents) {
    repos.set(agent.repo_path, repos.get(agent.repo_path) ?? []);
  }

  return [...repos].map(([path, repoCommits]) => {
    const repoAgents = agents.filter((agent) => agent.repo_path === path);

    return {
      path,
      name: getRepoName(path),
      commits: repoCommits,
      agents: repoAgents,
      rows: buildRows(
        repoCommits,
        pullRequests.filter((pr) => pr.repo_path === path),
        repoAgents,
        defaultBranches.find((branch) => branch.repo_path === path),
        dateKey,
        todayKey,
      ),
    };
  });
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

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, TIME_TICK_MS);
    // Timers stall behind a hidden window, so catch up on coming back
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return now;
}

function CheckName({ name, url }: Pick<CheckRun, "name" | "url">) {
  if (!url) {
    return (
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openUrl(url)}
      className="min-w-0 truncate text-left underline-offset-2 hover:underline"
      title={name}
    >
      {name}
    </button>
  );
}

export function ChecksHover({
  checks,
  checkRuns,
  pullRequest,
  onClick,
}: {
  checks: PullRequestChecks;
  checkRuns: CheckRun[];
  pullRequest?: PullRequest;
  onClick?: () => void;
}) {
  const {
    icon: Glyph,
    label,
    className,
    weight,
  } = quietenColleagueFailure(CHECK_SIGNALS[checks], checks, pullRequest);
  const summary = getCheckSummary(checkRuns);
  const byUrgency = [...checkRuns].sort(
    (a, b) =>
      CHECK_RUN_ORDER.indexOf(a.status) - CHECK_RUN_ORDER.indexOf(b.status),
  );

  return (
    <Tooltip.Provider delay={150} closeDelay={TOOLTIP_CLOSE_DELAY_MS}>
      <Tooltip.Root>
        {/* With nowhere to go it's a signal, not a button that does nothing */}
        <Tooltip.Trigger
          render={onClick ? undefined : <span role="img" />}
          aria-label={`${label}: ${summary}`}
          onClick={onClick}
          className={cn(
            "absolute top-0 right-[52px] flex h-[27px] w-[22px] items-center justify-center",
            className,
          )}
        >
          <Glyph className="size-3.5" weight={weight} aria-hidden="true" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          {/* Beside the icon, so it never covers the next row's icon */}
          <Tooltip.Positioner
            side="left"
            align="end"
            sideOffset={4}
            className="isolate z-[70]"
          >
            <Tooltip.Popup className="flex w-[280px] flex-col gap-1 rounded-[3px] border border-well-rule bg-popover px-[9px] py-[7px] font-mono text-[11.5px] leading-[1.4] shadow-md">
              <span className="text-balance font-medium text-foreground">
                {summary}
              </span>
              {/* Scrollbars are hidden, so a cut-off row is the sign of more */}
              <ul className="max-h-[70px] overflow-y-auto overscroll-contain">
                {byUrgency.map(({ name, status, url }, index) => {
                  const signal = quietenColleagueFailure(
                    CHECK_RUN_SIGNALS[status],
                    status,
                    pullRequest,
                  );

                  return (
                    <li
                      key={`${index}-${name}`}
                      className={cn(
                        "flex h-5 items-center gap-1.5",
                        status === "fail"
                          ? signal.className
                          : "text-muted-foreground",
                      )}
                    >
                      <SignalIcon signal={signal} />
                      <CheckName name={name} url={url} />
                    </li>
                  );
                })}
              </ul>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/** Fades in over the time on a row, so showing it moves nothing. */
function OpenPullRequest({ number, url }: Pick<PullRequest, "number" | "url">) {
  const label = `View pull request #${number} on GitHub`;

  return (
    <button
      type="button"
      onClick={() => openUrl(url)}
      aria-label={label}
      title={label}
      className="absolute top-0 right-0 flex h-[27px] w-12 items-center justify-end pr-2.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 motion-reduce:transition-none"
    >
      <ArrowSquareOutIcon className="size-3.5" aria-hidden="true" />
    </button>
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
        className="shrink-0 text-foreground hover:text-primary"
        title="View pull request on GitHub"
      >
        #{number}
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

function ReviewLine({ pullRequest }: { pullRequest: PullRequest }) {
  const verdicts = getReviewVerdicts(pullRequest);

  if (verdicts.length === 0) {
    return null;
  }

  return (
    <p className="text-muted-foreground">
      {verdicts.map(({ text, needsMe }, index) => (
        <Fragment key={text}>
          {index > 0 && " · "}
          <span className={cn(needsMe && "text-destructive")}>{text}</span>
        </Fragment>
      ))}
    </p>
  );
}

function FailedChecks({
  checkRuns,
  pullRequest,
}: {
  checkRuns: CheckRun[];
  pullRequest?: PullRequest;
}) {
  const { className, weight } = quietenColleagueFailure(
    CHECK_RUN_SIGNALS.fail,
    "fail",
    pullRequest,
  );

  return (
    <div className="flex flex-col">
      {getFailedChecks(checkRuns).map(({ name, url }, index) => (
        <span
          key={`${index}-${name}`}
          className={cn("flex items-center gap-1", className)}
        >
          <XCircleIcon
            className="size-3.5 shrink-0"
            weight={weight}
            aria-hidden="true"
          />
          <CheckName name={name} url={url} />
        </span>
      ))}
    </div>
  );
}

function CommitDisclosure({ commits }: { commits: GitCommit[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <CaretRightIcon
          className={cn("size-3", isOpen && "rotate-90")}
          aria-hidden="true"
        />
        {pluralise(commits.length, "commit")}
      </button>
      {isOpen && <CommitLog commits={commits} />}
    </div>
  );
}

function RowDetail({ row }: { row: WorkRow }) {
  const { checkRuns, commits, pullRequest } = row;
  const hasFailedChecks = getFailedChecks(checkRuns).length > 0;

  return (
    <div className="flex flex-col gap-1.5 pt-0.5 pr-2.5 pb-2.5 pl-8 text-[11.5px] leading-[1.6]">
      {pullRequest && <PullRequestMeta pullRequest={pullRequest} />}
      {pullRequest && <ReviewLine pullRequest={pullRequest} />}
      {hasFailedChecks && (
        <FailedChecks checkRuns={checkRuns} pullRequest={pullRequest} />
      )}
      {/* On its own a disclosure would be one more click to reach the only thing here */}
      {commits.length > 0 &&
        (pullRequest || hasFailedChecks ? (
          <CommitDisclosure commits={commits} />
        ) : (
          <CommitLog commits={commits} />
        ))}
    </div>
  );
}

function RowItem({
  row,
  time,
  isExpanded,
  onToggle,
}: {
  row: WorkRow;
  time: string | null;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { agents, checkRuns, checks, commits, pullRequest, state, title } = row;
  const review = pullRequest?.review;
  const hasDetail =
    commits.length > 0 ||
    getFailedChecks(checkRuns).length > 0 ||
    Boolean(pullRequest);
  const hasCheckList = Boolean(checks) && checkRuns.length > 0;
  const checkTarget = getCheckTarget(checkRuns, pullRequest);
  const toggleRow = hasDetail ? onToggle : undefined;

  return (
    <div
      className={cn(
        "flex flex-col",
        isExpanded && "bg-well-raised",
        hasDetail && "hover:bg-well-raised",
      )}
    >
      <div className="group/row relative">
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasDetail}
          aria-expanded={isExpanded}
          className="grid h-[27px] w-full grid-cols-[14px_minmax(0,1fr)_14px_14px_38px] items-center gap-x-2 px-2.5 text-left"
        >
          <SignalIcon signal={ROW_SIGNALS[state]} />
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                isExpanded ? "text-foreground" : "text-body",
              )}
            >
              {title}
            </span>
            {agents.length > 0 && (
              <span
                aria-hidden="true"
                className="shrink-0"
                style={{ width: getAgentStackWidth(agents.length) }}
              />
            )}
          </span>
          <SignalIcon signal={review ? REVIEW_SIGNALS[review] : null} />
          <SignalIcon
            signal={
              checks && !hasCheckList
                ? quietenColleagueFailure(
                    CHECK_SIGNALS[checks],
                    checks,
                    pullRequest,
                  )
                : null
            }
          />
          <span
            className={cn(
              "text-right text-muted-foreground",
              pullRequest &&
                "transition-opacity duration-150 group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0 motion-reduce:transition-none",
            )}
            title={
              commits.length > 0
                ? pluralise(commits.length, "commit")
                : undefined
            }
          >
            {time}
          </span>
        </button>
        {/* Buttons can't nest, so these sit over gaps left in the row */}
        {checks && hasCheckList && (
          <ChecksHover
            checks={checks}
            checkRuns={checkRuns}
            pullRequest={pullRequest}
            onClick={checkTarget ? () => openUrl(checkTarget) : toggleRow}
          />
        )}
        {agents.length > 0 && (
          <AgentStack
            agents={agents}
            size={14}
            className="absolute top-0 right-[100px] h-[27px]"
          />
        )}
        {pullRequest && (
          <OpenPullRequest number={pullRequest.number} url={pullRequest.url} />
        )}
      </div>
      {isExpanded && <RowDetail row={row} />}
    </div>
  );
}

function RepoRows({
  rows,
  date,
  openRowId,
  onToggleRow,
}: {
  rows: WorkRow[];
  date: Date;
  openRowId: string | null;
  onToggleRow: (rowId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const now = useNow();
  const isToday = getDateKey(date) === getDateKey(new Date(now));
  const hidden = rows.length - VISIBLE_ROWS;
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <>
      {visible.map((row) => (
        <RowItem
          key={row.id}
          row={row}
          time={
            row.lastCommitTime === null
              ? null
              : formatRowTime(row.lastCommitTime, now, isToday)
          }
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

/** The docked panel's rows. It grows to fit them, and keeps them on screen while it closes. */
function DockBody({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // Measured rather than "auto", so switching repos or opening a row resizes smoothly
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() =>
      setContentHeight(content.offsetHeight),
    );
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  let transition = open ? DOCK_OPEN : DOCK_CLOSE;
  if (reduceMotion) {
    transition = NO_MOTION;
  }

  return (
    <motion.div
      initial={false}
      animate={{ height: open ? contentHeight : 0, opacity: open ? 1 : 0 }}
      transition={transition}
      inert={!open}
      className="overflow-hidden"
    >
      <div
        ref={contentRef}
        className="flex flex-col border-well-rule border-t pt-1 pb-1.5"
      >
        {children}
      </div>
    </motion.div>
  );
}

export function CommitPanel({
  commits,
  agents = NO_AGENTS,
  date,
  folderPath,
  className,
  docked = false,
}: CommitPanelProps) {
  const pullRequests = usePullRequests(folderPath);
  const defaultBranches = useDefaultBranches(folderPath);
  const fetchFailure = useFetchFailure(folderPath);

  const repos = useMemo(
    () => groupWork(commits, pullRequests, agents, defaultBranches, date),
    [agents, commits, date, defaultBranches, pullRequests],
  );

  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  // The last repo opened, which the dock keeps showing as it closes
  const [shownRepo, setShownRepo] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const repo = repos.find(({ path }) => path === activeRepo);
  const shown = repos.find(({ path }) => path === shownRepo);
  const isPanelOpen = Boolean(repo);

  const toggleRepo = (path: string) => {
    if (path === activeRepo) {
      setActiveRepo(null);
      return;
    }
    setActiveRepo(path);
    setShownRepo(path);
    setOpenRowId(null);
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
        className={cn(
          "flex flex-col overflow-hidden border border-well-rule bg-well text-xs leading-[1.4]",
          docked ? "rounded-t-[3px] border-b-0" : "rounded-[3px]",
        )}
      >
        <div className="flex h-[30px] items-stretch">
          <Tabs.List
            aria-label="Repositories"
            className="flex min-w-0 items-stretch overflow-x-auto"
          >
            {repos.map(
              ({ path, name, commits: repoCommits, agents: repoAgents }) => (
                <div
                  key={path}
                  className={cn(
                    "relative flex shrink-0 items-stretch border-well-rule border-r",
                    !docked &&
                      path === activeRepo &&
                      "shadow-[inset_0_-2px_0_var(--primary)]",
                  )}
                >
                  {docked && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        path === activeRepo ? "scale-x-100" : "scale-x-0",
                      )}
                    />
                  )}
                  <Tabs.Tab
                    value={path}
                    onClick={() => toggleRepo(path)}
                    className={cn(
                      "flex items-center gap-[7px] px-[11px] font-medium",
                      docked && "transition-colors duration-150",
                      repoAgents.length > 0 && "pr-1",
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
                  {repoAgents.length > 0 && (
                    <AgentStack
                      agents={repoAgents}
                      moving={path !== activeRepo}
                      size={15}
                      className={cn(
                        "pr-1.5",
                        path === activeRepo && "opacity-60",
                      )}
                    />
                  )}
                </div>
              ),
            )}
          </Tabs.List>
          {fetchFailure && (
            <span
              title={fetchFailure}
              className="ml-auto flex shrink-0 items-center px-[11px] text-muted-foreground"
            >
              Fetch failed
            </span>
          )}
        </div>
        {docked ? (
          <DockBody open={isPanelOpen}>
            {shown && (
              <RepoRows
                key={shown.path}
                rows={shown.rows}
                date={date}
                openRowId={openRowId}
                onToggleRow={toggleRow}
              />
            )}
          </DockBody>
        ) : (
          repos.map(({ path, rows }) => (
            <Tabs.Panel
              key={path}
              value={path}
              className="flex flex-col border-well-rule border-t pt-1 pb-1.5"
            >
              <RepoRows
                rows={rows}
                date={date}
                openRowId={openRowId}
                onToggleRow={toggleRow}
              />
            </Tabs.Panel>
          ))
        )}
      </Tabs.Root>
    </div>
  );
}

export default CommitPanel;
