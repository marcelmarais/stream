import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesSyncStatus } from "@/ipc/notes-sync";
import {
  createSyncScheduler,
  getSyncLabel,
  noteSaved,
  onNoteSaved,
} from "@/lib/notes-sync";

const SETTLE_MS = 60_000;

const SYNCED: NotesSyncStatus = {
  repo_root: "/brain",
  branch: "main",
  upstream: "origin/main",
  changed: 0,
  ahead: 0,
  behind: 0,
  busy: false,
};

const IDLE = { syncing: false, failed: false };

describe("getSyncLabel", () => {
  it("hides the control outside a repo or before the status loads", () => {
    expect(getSyncLabel(undefined, IDLE)).toBeNull();
    expect(getSyncLabel({ ...SYNCED, repo_root: null }, IDLE)).toBeNull();
  });

  it("says synced when there's nothing to do", () => {
    expect(getSyncLabel(SYNCED, IDLE)).toBe("synced");
  });

  it("counts uncommitted changes before commits to push", () => {
    expect(getSyncLabel({ ...SYNCED, changed: 1, ahead: 2 }, IDLE)).toBe(
      "1 change",
    );
    expect(getSyncLabel({ ...SYNCED, changed: 3 }, IDLE)).toBe("3 changes");
  });

  it("shows commits to push, then commits to pull", () => {
    expect(getSyncLabel({ ...SYNCED, ahead: 2, behind: 1 }, IDLE)).toBe("↑2");
    expect(getSyncLabel({ ...SYNCED, behind: 1 }, IDLE)).toBe("↓1");
  });

  it("says local only without an upstream", () => {
    expect(getSyncLabel({ ...SYNCED, upstream: null }, IDLE)).toBe(
      "local only",
    );
  });

  it("puts syncing, a rebase and a failure ahead of the counts", () => {
    const changed = { ...SYNCED, changed: 2 };

    expect(getSyncLabel(changed, { syncing: true, failed: true })).toBe(
      "syncing…",
    );
    expect(
      getSyncLabel({ ...changed, busy: true }, { ...IDLE, failed: true }),
    ).toBe("rebase in progress");
    expect(getSyncLabel(changed, { ...IDLE, failed: true })).toBe(
      "sync failed",
    );
  });
});

describe("createSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs once typing has stopped for the settle period", () => {
    const sync = vi.fn();
    const scheduler = createSyncScheduler(sync, SETTLE_MS);

    scheduler.edited();
    vi.advanceTimersByTime(SETTLE_MS - 1000);
    scheduler.edited();
    vi.advanceTimersByTime(SETTLE_MS - 1000);

    expect(sync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(sync).toHaveBeenCalledOnce();
  });

  it("doesn't let polling put a sync off forever", () => {
    const sync = vi.fn();
    const scheduler = createSyncScheduler(sync, SETTLE_MS);

    scheduler.changesFound();
    vi.advanceTimersByTime(30_000);
    scheduler.changesFound();
    vi.advanceTimersByTime(30_000);

    expect(sync).toHaveBeenCalledOnce();
  });

  it("syncs a pending change straight away on flush, and nothing otherwise", () => {
    const sync = vi.fn();
    const scheduler = createSyncScheduler(sync, SETTLE_MS);

    scheduler.flush();
    expect(sync).not.toHaveBeenCalled();

    scheduler.edited();
    scheduler.flush();
    vi.advanceTimersByTime(SETTLE_MS);

    expect(sync).toHaveBeenCalledOnce();
  });

  it("drops a pending sync when cancelled", () => {
    const sync = vi.fn();
    const scheduler = createSyncScheduler(sync, SETTLE_MS);

    scheduler.edited();
    scheduler.cancel();
    vi.advanceTimersByTime(SETTLE_MS);

    expect(sync).not.toHaveBeenCalled();
  });

  it("replaces a pending sync when syncing now", () => {
    const sync = vi.fn();
    const scheduler = createSyncScheduler(sync, SETTLE_MS);

    scheduler.edited();
    scheduler.syncNow();
    vi.advanceTimersByTime(SETTLE_MS);

    expect(sync).toHaveBeenCalledOnce();
  });
});

describe("onNoteSaved", () => {
  it("tells listeners about saves until they stop listening", () => {
    const listener = vi.fn();
    const stop = onNoteSaved(listener);

    noteSaved();
    stop();
    noteSaved();

    expect(listener).toHaveBeenCalledOnce();
  });
});
