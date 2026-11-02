import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FetchResult,
  getFetchFailure,
  getPullRequestPollInterval,
  gitKeys,
  repoFetchQuery,
} from "@/hooks/use-git-queries";
import type { PullRequest } from "@/ipc/git-reader";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// TanStack skips its timers on a server, which is what it takes Node for
vi.hoisted(() => {
  vi.stubGlobal("window", globalThis);
});

const FOLDER = "/notes";
const REPOS = ["/repos/stream"];
const FETCHED: FetchResult[] = [
  { repo_path: "/repos/stream", success: true, message: "Fetched" },
];

function failed(repo_path: string, message: string): FetchResult {
  return { repo_path, success: false, message };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("repoFetchQuery", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("never runs two fetches at once", async () => {
    const running = deferred<FetchResult[]>();
    vi.mocked(invoke).mockReturnValue(running.promise);
    const client = new QueryClient();
    const query = { ...repoFetchQuery(FOLDER, REPOS), staleTime: 0 };

    const first = client.fetchQuery(query);
    const second = client.fetchQuery(query);
    running.resolve(FETCHED);

    await expect(first).resolves.toEqual(FETCHED);
    await expect(second).resolves.toEqual(FETCHED);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("fetches again once the last one has finished", async () => {
    vi.mocked(invoke).mockResolvedValue(FETCHED);
    const client = new QueryClient();
    const query = { ...repoFetchQuery(FOLDER, REPOS), staleTime: 0 };

    await client.fetchQuery(query);
    await client.fetchQuery(query);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("refreshes commits and pull requests afterwards", async () => {
    vi.mocked(invoke).mockResolvedValue(FETCHED);
    const client = new QueryClient();
    const commits = gitKeys.commits(FOLDER, "2026-11-02", REPOS);
    const pullRequests = [...gitKeys.pullRequests(FOLDER), REPOS];
    const otherFolder = gitKeys.commits("/other", "2026-11-02", REPOS);
    client.setQueryData(commits, {});
    client.setQueryData(pullRequests, {});
    client.setQueryData(otherFolder, {});

    await client.fetchQuery(repoFetchQuery(FOLDER, REPOS));

    const isInvalidated = (queryKey: readonly unknown[]) =>
      client.getQueryState(queryKey)?.isInvalidated;
    expect(isInvalidated(commits)).toBe(true);
    expect(isInvalidated(pullRequests)).toBe(true);
    expect(isInvalidated(otherFolder)).toBe(false);
  });
});

describe("fetching when the window regains focus", () => {
  const MINUTE = 60000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(FETCHED);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits until the last fetch is over two minutes old", async () => {
    const client = new QueryClient();
    const query = repoFetchQuery(FOLDER, REPOS);
    const background = new QueryObserver(client, query);
    // Every panel reads the same query, and mustn't change when it goes stale
    const panel = new QueryObserver(client, { ...query, enabled: false });
    const unsubscribe = [
      background.subscribe(() => {}),
      panel.subscribe(() => {}),
    ];
    const focus = () =>
      client.refetchQueries({ queryKey: gitKeys.fetch(FOLDER), stale: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MINUTE);
    await focus();
    expect(invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MINUTE + 1);
    await focus();
    expect(invoke).toHaveBeenCalledTimes(2);

    for (const stop of unsubscribe) {
      stop();
    }
  });
});

describe("getFetchFailure", () => {
  it("is quiet when every repo fetched", () => {
    expect(getFetchFailure(FETCHED, null)).toBeNull();
    expect(getFetchFailure(undefined, null)).toBeNull();
  });

  it("names each repo that failed with what git said", () => {
    const results = [
      ...FETCHED,
      failed("/repos/brain", "fatal: Authentication failed"),
      failed("/repos/timeline", "fatal: unable to access"),
    ];

    expect(getFetchFailure(results, null)).toBe(
      "brain: fatal: Authentication failed\ntimeline: fatal: unable to access",
    );
  });

  it("reports a fetch that couldn't run at all", () => {
    const failure = getFetchFailure(FETCHED, new Error("IPC went away"));

    expect(failure).toContain("IPC went away");
  });
});

describe("getPullRequestPollInterval", () => {
  const running = {
    checks: "running",
    is_mine: true,
    review: null,
  } as PullRequest;

  function snapshotOf(pull_requests: PullRequest[]) {
    return { pull_requests, default_branches: [], rate_remaining: null };
  }

  it("polls faster while my checks run", () => {
    const snapshot = snapshotOf([running]);

    expect(getPullRequestPollInterval(snapshot, false, true)).toBe(20000);
  });

  it("doesn't speed up for someone else's checks", () => {
    const snapshot = snapshotOf([{ ...running, is_mine: false }]);

    expect(getPullRequestPollInterval(snapshot, false, true)).toBe(60000);
  });

  it("does for a pull request waiting on my review", () => {
    const snapshot = snapshotOf([
      { ...running, is_mine: false, review: "requested" },
    ]);

    expect(getPullRequestPollInterval(snapshot, false, true)).toBe(20000);
  });
});
