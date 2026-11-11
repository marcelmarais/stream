import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildRows,
  ChecksHover,
  CommitPanel,
  formatRowTime,
  getCheckTarget,
  getReviewVerdicts,
  groupWork,
  quietenColleagueFailure,
} from "@/components/commit-panel";
import { gitKeys, repoFetchQuery } from "@/hooks/use-git-queries";
import type {
  CheckRun,
  DefaultBranch,
  GitCommit,
  PullRequest,
} from "@/ipc/git-reader";
import { getDateKey } from "@/utils/date-utils";

const TODAY = "2026-11-02";
const YESTERDAY = "2026-11-01";
const BRANCH = "feature";
const CHECK_RUNS: CheckRun[] = [{ name: "Lint", status: "pass", url: null }];
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function commit(
  id: string,
  timestamp: number,
  parents: string[] = [],
  branch = BRANCH,
): GitCommit {
  return {
    id,
    message: id,
    author_name: "Marcel",
    author_email: "marcel@example.com",
    timestamp,
    date: TODAY,
    repo_path: "/repo",
    branches: [branch],
    parents,
    is_mine: true,
  };
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    repo_path: "/repo",
    number: 1,
    title: "Add a feature",
    url: "https://github.com/marcelmarais/stream/pull/1",
    state: "open",
    branch: BRANCH,
    additions: 1,
    deletions: 0,
    comments: 0,
    checks: "pass",
    check_runs: CHECK_RUNS,
    review: null,
    reviews: [],
    head_sha: "tip",
    last_commit_at: null,
    merged_at: null,
    is_mine: true,
    ...overrides,
  };
}

function defaultBranch(head_sha: string | null): DefaultBranch {
  return {
    repo_path: "/repo",
    branch: "main",
    checks: "fail",
    check_runs: CHECK_RUNS,
    head_sha,
    last_commit_at: null,
  };
}

function rowFor(
  commits: GitCommit[],
  pullRequests: PullRequest[],
  dateKey = TODAY,
  branch = BRANCH,
  main?: DefaultBranch,
) {
  const row = buildRows(commits, pullRequests, [], main, dateKey, TODAY).find(
    ({ id }) => id === branch,
  );
  if (!row) {
    throw new Error(`No row for ${branch}`);
  }
  return row;
}

function expectChecks(row: ReturnType<typeof rowFor>) {
  expect(row.checks).toBe("pass");
  expect(row.checkRuns).toEqual(CHECK_RUNS);
}

function expectNoChecks(row: ReturnType<typeof rowFor>) {
  expect(row.checks).toBeNull();
  expect(row.checkRuns).toEqual([]);
}

describe("checks on a row", () => {
  it("shows them today when they ran on the row's newest commit", () => {
    const commits = [commit("tip", 2000, ["old"]), commit("old", 1000)];

    expectChecks(rowFor(commits, [pullRequest()]));
  });

  it("shows them on a past day when the branch hasn't moved since", () => {
    expectChecks(rowFor([commit("tip", 1000)], [pullRequest()], YESTERDAY));
  });

  it("hides today's checks from a past day's older commits", () => {
    const row = rowFor([commit("old", 1000)], [pullRequest()], YESTERDAY);

    expectNoChecks(row);
    expect(row.pullRequest?.number).toBe(1);
  });

  it("hides them when local is ahead of what GitHub measured", () => {
    const commits = [commit("local", 2000, ["tip"]), commit("tip", 1000)];

    expectNoChecks(rowFor(commits, [pullRequest()]));
  });

  it("hides them when local is behind what GitHub measured", () => {
    expectNoChecks(rowFor([commit("old", 1000)], [pullRequest()]));
  });

  it("shows live checks on a row with no commits today", () => {
    expectChecks(rowFor([], [pullRequest({ head_sha: "elsewhere" })]));
  });

  it("shows nothing on a past row with no commits", () => {
    const main = defaultBranch("tip");

    expectNoChecks(rowFor([], [], YESTERDAY, "main", main));
  });

  it("applies the same rule to main", () => {
    const onMain = (id: string) => [commit(id, 1000, [], "main")];
    const main = defaultBranch("tip");

    expect(rowFor(onMain("tip"), [], TODAY, "main", main).checks).toBe("fail");
    expectNoChecks(rowFor(onMain("old"), [], TODAY, "main", main));
    expectNoChecks(
      rowFor(onMain("tip"), [], TODAY, "main", defaultBranch(null)),
    );
  });
});

describe("commits in the same second", () => {
  it("finds the tip of a rebased stack whichever way it's sorted", () => {
    const stack = [
      commit("base", 1000),
      commit("middle", 1000, ["base"]),
      commit("tip", 1000, ["middle"]),
    ];

    expectChecks(rowFor(stack, [pullRequest()]));
    expectChecks(rowFor([...stack].reverse(), [pullRequest()]));
  });

  it("doesn't mistake an unpushed child for the commit that was measured", () => {
    const commits = [commit("tip", 1000), commit("local", 1000, ["tip"])];

    expectNoChecks(rowFor(commits, [pullRequest()]));
  });

  it("follows parents over a clock that ran backwards", () => {
    const commits = [commit("local", 1000, ["tip"]), commit("tip", 2000)];

    expectNoChecks(rowFor(commits, [pullRequest()]));
  });

  it("shows nothing when two lines tie, since either could be newest", () => {
    const commits = [commit("tip", 1000), commit("amended", 1000)];

    expectNoChecks(rowFor(commits, [pullRequest()]));
  });
});

describe("other people's pull requests", () => {
  const theirs = pullRequest({ is_mine: false });

  it("label their branch", () => {
    const row = rowFor([commit("tip", 1000)], [theirs]);

    expect(row.state).toBe("open");
    expect(row.title).toBe("Add a feature");
    expect(row.pullRequest).toBe(theirs);
    expectChecks(row);
  });

  it("stay theirs even if I committed to the branch", () => {
    const mine = commit("tip", 1000);
    const colleagues = { ...mine, is_mine: false };

    expect(rowFor([mine], [theirs]).isMine).toBe(false);
    expect(rowFor([colleagues], [theirs]).isMine).toBe(false);
    expect(rowFor([colleagues], [pullRequest()]).isMine).toBe(true);
  });

  it("never create a row of their own", () => {
    const rows = buildRows([], [theirs], [], undefined, TODAY, TODAY);

    expect(rows.map(({ id }) => id)).toEqual(["main"]);
  });

  it("never create a repo tab", () => {
    const today = new Date();

    expect(groupWork([], [theirs], [], [], today)).toEqual([]);
  });

  it("never create a merged row on the day they landed", () => {
    const merged = pullRequest({
      is_mine: false,
      state: "merged",
      merged_at: new Date().toISOString(),
    });
    const today = getDateKey(new Date());

    expect(
      buildRows([], [merged], [], undefined, today, today).map(({ id }) => id),
    ).toEqual(["main"]);
  });

  it("still appear when my review is requested", () => {
    const requested = pullRequest({ is_mine: false, review: "requested" });
    const [repo] = groupWork([], [requested], [], [], new Date());

    expect(repo.rows.map(({ id }) => id)).toContain(BRANCH);
  });

  it("don't take over the main row", () => {
    const row = rowFor(
      [commit("tip", 1000, [], "main")],
      [pullRequest({ branch: "main", is_mine: false, title: "From a fork" })],
      TODAY,
      "main",
      defaultBranch("tip"),
    );

    expect(row.title).toBe("main");
    expect(row.pullRequest).toBeUndefined();
  });
});

describe("the order of rows", () => {
  let number = 0;
  const mine = (branch: string, time: number) =>
    commit(`${branch}-${time}`, time, [], branch);
  const theirs = (branch: string, time: number) => ({
    ...mine(branch, time),
    is_mine: false,
  });
  const pr = (branch: string, overrides: Partial<PullRequest> = {}) => {
    number += 1;
    return pullRequest({ branch, number, head_sha: branch, ...overrides });
  };
  const orderOf = (commits: GitCommit[], pullRequests: PullRequest[]) =>
    buildRows(commits, pullRequests, [], undefined, TODAY, TODAY).map(
      ({ id }) => id,
    );

  it("puts my pull requests first, then colleagues', then what's done", () => {
    const commits = [
      theirs("their-branch", 9000),
      theirs("their-draft", 8000),
      theirs("their-open", 7000),
      mine("my-branch", 6000),
      mine("my-merged", 5000),
      mine("my-draft", 4000),
      mine("my-open", 3000),
      theirs("their-merged", 2000),
      mine("main", 1000),
    ];
    const pullRequests = [
      pr("their-merged", { is_mine: false, state: "merged" }),
      pr("their-draft", { is_mine: false, state: "draft" }),
      pr("my-merged", { state: "merged" }),
      pr("their-open", { is_mine: false }),
      pr("my-draft", { state: "draft" }),
      pr("my-open"),
    ];

    expect(orderOf(commits, pullRequests)).toEqual([
      "main",
      "my-open",
      "my-draft",
      "my-branch",
      "their-open",
      "their-draft",
      "my-merged",
      "their-branch",
      "their-merged",
    ]);
  });

  it("puts the newest commit first within a group", () => {
    const commits = [
      theirs("their-old", 1000),
      mine("my-old", 2000),
      theirs("their-new", 3000),
      mine("my-new", 4000),
    ];
    const pullRequests = [
      pr("my-old"),
      pr("their-old", { is_mine: false }),
      pr("their-new", { is_mine: false }),
      pr("my-new"),
    ];

    expect(orderOf(commits, pullRequests)).toEqual([
      "main",
      "my-new",
      "my-old",
      "their-new",
      "their-old",
    ]);
  });

  it("goes by the pull request's last commit when the day has none", () => {
    const at = (time: number) => new Date(time).toISOString();
    const pullRequests = [
      pr("older", { last_commit_at: at(1000) }),
      pr("newer", { last_commit_at: at(2000) }),
    ];

    expect(orderOf([], pullRequests)).toEqual(["main", "newer", "older"]);
  });

  it("leads each group with what needs me", () => {
    const commits = [
      mine("passing", 4000),
      mine("failing", 3000),
      theirs("their-failing", 2000),
      theirs("their-requested", 1000),
    ];
    const pullRequests = [
      pr("passing"),
      pr("failing", { checks: "fail" }),
      pr("their-failing", { is_mine: false, checks: "fail" }),
      pr("their-requested", { is_mine: false, review: "requested" }),
    ];

    expect(orderOf(commits, pullRequests)).toEqual([
      "main",
      "failing",
      "passing",
      "their-requested",
      "their-failing",
    ]);
  });

  it("keeps a failing draft of mine below my open pull requests", () => {
    const commits = [mine("draft", 2000), mine("open", 1000)];
    const pullRequests = [
      pr("draft", { state: "draft", checks: "fail" }),
      pr("open"),
    ];

    expect(orderOf(commits, pullRequests)).toEqual(["main", "open", "draft"]);
  });

  it("counts a branch with no pull request as mine once I commit to it", () => {
    const commits = [
      theirs("shared", 3000),
      mine("shared", 2000),
      theirs("their-open", 1000),
    ];

    expect(orderOf(commits, [pr("their-open", { is_mine: false })])).toEqual([
      "main",
      "shared",
      "their-open",
    ]);
  });
});

describe("the time on a row", () => {
  const NOW = new Date(2026, 10, 2, 15, 30).getTime();

  it("counts up from under a minute today", () => {
    const ago = (duration: number) => formatRowTime(NOW - duration, NOW, true);

    expect(ago(59 * 1000)).toBe("<1m");
    expect(ago(MINUTE)).toBe("1m");
    expect(ago(59 * MINUTE)).toBe("59m");
    expect(ago(HOUR)).toBe("1h");
    expect(ago(23 * HOUR)).toBe("23h");
    expect(ago(DAY)).toBe("1d");
    expect(ago(5 * DAY)).toBe("5d");
  });

  it("doesn't go negative when a commit's clock ran ahead", () => {
    expect(formatRowTime(NOW + HOUR, NOW, true)).toBe("<1m");
  });

  it("shows the clock on a past day", () => {
    const morning = new Date(2026, 10, 1, 9, 5).getTime();

    expect(formatRowTime(morning, NOW, false)).toBe("09:05");
  });

  it("comes from the row's newest commit", () => {
    const commits = [commit("old", 1000), commit("tip", 3000, ["old"])];
    const row = rowFor(commits, [
      pullRequest({ last_commit_at: "2026-10-01T10:00:00Z" }),
    ]);

    expect(row.lastCommitTime).toBe(3000);
  });

  it("falls back on the pull request with no commits today", () => {
    const lastCommitAt = "2026-10-30T10:00:00Z";
    const row = rowFor([], [pullRequest({ last_commit_at: lastCommitAt })]);

    expect(row.lastCommitTime).toBe(Date.parse(lastCommitAt));
  });

  it("falls back on the default branch with no commits today", () => {
    const lastCommitAt = "2026-10-30T10:00:00Z";
    const main = { ...defaultBranch(null), last_commit_at: lastCommitAt };

    expect(rowFor([], [], TODAY, "main", main).lastCommitTime).toBe(
      Date.parse(lastCommitAt),
    );
  });

  it("doesn't pass another day's commit off as a past day's clock time", () => {
    const main = {
      ...defaultBranch(null),
      last_commit_at: new Date(2026, 10, 2, 10).toISOString(),
    };

    expect(rowFor([], [], YESTERDAY, "main", main).lastCommitTime).toBeNull();
  });

  it("keeps the fallback on the past day it happened", () => {
    const landed = new Date(2026, 10, 1, 10).toISOString();
    const main = { ...defaultBranch(null), last_commit_at: landed };

    expect(rowFor([], [], YESTERDAY, "main", main).lastCommitTime).toBe(
      Date.parse(landed),
    );
  });

  it("is empty when nothing says when", () => {
    expect(rowFor([], [pullRequest()]).lastCommitTime).toBeNull();
  });
});

describe("where the check icon goes", () => {
  const failed = (name: string, url: string | null): CheckRun => ({
    name,
    status: "fail",
    url,
  });
  const passed: CheckRun = { name: "Lint", status: "pass", url: "lint-url" };

  it("prefers the first failure's own logs", () => {
    const runs = [passed, failed("Test", "test-url"), failed("Build", "b-url")];

    expect(getCheckTarget(runs, pullRequest())).toBe("test-url");
  });

  it("skips a failure with no logs", () => {
    const runs = [failed("Test", null), failed("Build", "build-url")];

    expect(getCheckTarget(runs, pullRequest())).toBe("build-url");
  });

  it("goes to the pull request's checks page next", () => {
    const runs = [failed("Test", null), passed];

    expect(getCheckTarget(runs, pullRequest())).toBe(
      "https://github.com/marcelmarais/stream/pull/1/checks",
    );
  });

  it("falls back on any run with a url when there's no pull request", () => {
    expect(getCheckTarget([failed("Test", null), passed], undefined)).toBe(
      "lint-url",
    );
  });

  it("is empty when nothing can be opened", () => {
    expect(getCheckTarget([failed("Test", null)], undefined)).toBeNull();
    expect(getCheckTarget(CHECK_RUNS, undefined)).toBeNull();
  });
});

describe("the check signal", () => {
  const signal = {
    icon: () => null,
    label: "Checks failed",
    className: "text-destructive",
    weight: "fill",
  } as unknown as Parameters<typeof quietenColleagueFailure>[0];
  const theirs = pullRequest({ is_mine: false });

  it("stays red on my pull request and my branches", () => {
    expect(quietenColleagueFailure(signal, "fail", pullRequest())).toBe(signal);
    expect(quietenColleagueFailure(signal, "fail", undefined)).toBe(signal);
  });

  it("stays red when my review is requested", () => {
    const requested = pullRequest({ is_mine: false, review: "requested" });

    expect(quietenColleagueFailure(signal, "fail", requested)).toBe(signal);
  });

  it("goes muted and unfilled on a colleague's failure", () => {
    expect(quietenColleagueFailure(signal, "fail", theirs)).toMatchObject({
      className: "text-muted-foreground",
      weight: "regular",
      label: "Checks failed",
    });
  });

  it("leaves a colleague's other checks alone", () => {
    expect(quietenColleagueFailure(signal, "pass", theirs)).toBe(signal);
  });

  it("is a button only when clicking it does something", () => {
    const hover = (onClick?: () => void) =>
      renderToStaticMarkup(
        createElement(ChecksHover, {
          checks: "pass",
          checkRuns: CHECK_RUNS,
          onClick,
        }),
      );

    expect(hover(() => {})).toContain("<button");
    expect(hover()).not.toContain("<button");
    expect(hover()).toContain('role="img"');
  });
});

describe("the review line", () => {
  const review = (login: string, state: string) => ({ login, state });

  it("names everyone who approved", () => {
    const reviews = [review("alex", "APPROVED"), review("sam", "APPROVED")];

    expect(getReviewVerdicts(pullRequest({ reviews }))).toEqual([
      { text: "Approved by alex, sam", needsMe: false },
    ]);
  });

  it("flags changes requested on my pull request", () => {
    const reviews = [review("alex", "CHANGES_REQUESTED")];

    expect(getReviewVerdicts(pullRequest({ reviews }))).toEqual([
      { text: "Changes requested by alex", needsMe: true },
    ]);
  });

  it("stays muted on someone else's pull request", () => {
    const reviews = [review("alex", "CHANGES_REQUESTED")];

    expect(getReviewVerdicts(pullRequest({ is_mine: false, reviews }))).toEqual(
      [{ text: "Changes requested by alex", needsMe: false }],
    );
  });

  it("puts what's blocking before approvals", () => {
    const reviews = [
      review("sam", "APPROVED"),
      review("alex", "CHANGES_REQUESTED"),
    ];

    expect(
      getReviewVerdicts(pullRequest({ reviews })).map(({ text }) => text),
    ).toEqual(["Changes requested by alex", "Approved by sam"]);
  });

  it("is empty without a verdict", () => {
    expect(getReviewVerdicts(pullRequest())).toEqual([]);
    expect(
      getReviewVerdicts(pullRequest({ reviews: [review("sam", "DISMISSED")] })),
    ).toEqual([]);
  });
});

describe("the fetch-failed note", () => {
  const FOLDER = "/notes";
  const REPOS = ["/repo"];

  function renderPanel(results: unknown) {
    const client = new QueryClient();
    client.setQueryData(gitKeys.repos(FOLDER), REPOS);
    client.setQueryData(
      repoFetchQuery(FOLDER, REPOS, { repos: null, notes: null }).queryKey,
      results as [],
    );

    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(CommitPanel, {
          commits: [commit("tip", 1000)],
          date: new Date(),
          folderPath: FOLDER,
        }),
      ),
    );
  }

  it("shows git's error as its title when the latest fetch failed", () => {
    const html = renderPanel([
      {
        repo_path: "/repo",
        success: false,
        message: "fatal: Authentication failed",
      },
    ]);

    expect(html).toContain("Fetch failed");
    expect(html).toContain('title="repo: fatal: Authentication failed"');
  });

  it("stays away when the latest fetch worked", () => {
    const html = renderPanel([
      { repo_path: "/repo", success: true, message: "Fetched" },
    ]);

    expect(html).not.toContain("Fetch failed");
  });
});
