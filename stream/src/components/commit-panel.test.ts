import { describe, expect, it } from "vitest";
import { buildRows, groupWork } from "@/components/commit-panel";
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

  it("stay mine if I committed to the branch", () => {
    const mine = commit("tip", 1000);
    const colleagues = { ...mine, is_mine: false };

    expect(rowFor([mine], [theirs]).isMine).toBe(true);
    expect(rowFor([colleagues], [theirs]).isMine).toBe(false);
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
