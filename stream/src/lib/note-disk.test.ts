import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readMarkdownFilesContentByPaths,
  writeMarkdownFileContent,
} from "@/ipc/markdown-reader";
import {
  followNoteOnDisk,
  forget,
  isWriting,
  knownText,
  type NoteCache,
  notifyDiskChange,
  rebaseText,
  remember,
  takeDiskChange,
  writeGeneration,
  writeNote,
} from "@/lib/note-disk";

vi.mock("@/ipc/markdown-reader", () => ({
  readMarkdownFilesContentByPaths: vi.fn(),
  writeMarkdownFileContent: vi.fn(),
}));

describe("rebaseText", () => {
  it("takes what's on disk when nothing was typed", () => {
    expect(rebaseText("- milk\n", "- milk\n", "- milk\n- eggs\n")).toBe(
      "- milk\n- eggs\n",
    );
  });

  it("keeps typing and the disk's change in different places", () => {
    const base = "# Today\n\nWalked the dog.\n";
    const local = "# Today\n\nWalked the dog. It rained.\n";
    const remote = "# Today\n\n- [ ] call Sam\n\nWalked the dog.\n";

    expect(rebaseText(base, local, remote)).toBe(
      "# Today\n\n- [ ] call Sam\n\nWalked the dog. It rained.\n",
    );
  });

  it("keeps both when both sides insert at the same spot", () => {
    const merged = rebaseText("a\n", "a\nmine\n", "a\ntheirs\n");

    expect(merged).toContain("mine");
    expect(merged).toContain("theirs");
  });

  it("keeps typing in a paragraph the disk deleted", () => {
    const base = "keep\n\ndrop this\n";
    const local = "keep\n\ndrop this, but I was writing here\n";
    const remote = "keep\n";

    expect(rebaseText(base, local, remote)).toContain("but I was writing here");
  });

  it("doesn't double an edit both sides already made", () => {
    expect(rebaseText("a", "ab", "ab")).toBe("ab");
  });
});

function memoryCache(initial?: string): NoteCache & { text?: string } {
  const cache: NoteCache & { text?: string } = {
    text: initial,
    get: () => cache.text,
    set: (text) => {
      cache.text = text;
    },
  };
  return cache;
}

function onDisk(text: string | undefined) {
  vi.mocked(readMarkdownFilesContentByPaths).mockImplementation(
    async (paths) =>
      new Map(text === undefined ? [] : paths.map((path) => [path, text])),
  );
}

describe("writeNote", () => {
  beforeEach(() => {
    vi.mocked(writeMarkdownFileContent).mockReset();
    vi.mocked(readMarkdownFilesContentByPaths).mockReset();
  });

  it("records what it saves, so the watcher sees its own save", async () => {
    remember("/notes/a.md", "");
    onDisk("");

    await writeNote("/notes/a.md", "hello", memoryCache("hello"));

    expect(knownText("/notes/a.md")).toBe("hello");
    expect(writeMarkdownFileContent).toHaveBeenCalledWith(
      "/notes/a.md",
      "hello",
    );
  });

  it("counts as writing until the file is written", async () => {
    let finish = () => {};
    vi.mocked(writeMarkdownFileContent).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    onDisk(undefined);
    const before = writeGeneration("/notes/b.md");

    const write = writeNote("/notes/b.md", "x", memoryCache("x"));
    expect(isWriting("/notes/b.md")).toBe(true);
    expect(writeGeneration("/notes/b.md")).toBe(before + 1);

    await vi.waitFor(() => expect(writeMarkdownFileContent).toHaveBeenCalled());
    finish();
    await write;
    expect(isWriting("/notes/b.md")).toBe(false);
  });

  it("can't bring back a deleted note", async () => {
    forget("/notes/c.md");

    await writeNote("/notes/c.md", "late save", memoryCache("late save"));
    expect(writeMarkdownFileContent).not.toHaveBeenCalled();

    remember("/notes/c.md", "");
    onDisk("");
    await writeNote("/notes/c.md", "new day", memoryCache("new day"));
    expect(writeMarkdownFileContent).toHaveBeenCalledWith(
      "/notes/c.md",
      "new day",
    );
  });

  it("merges a change it hasn't seen yet instead of overwriting it", async () => {
    remember("/notes/e.md", "one\n");
    onDisk("one\nfrom git\n");
    const cache = memoryCache("one, typed\n");

    await writeNote("/notes/e.md", "one, typed\n", cache);

    expect(cache.text).toBe("one, typed\nfrom git\n");
    expect(writeMarkdownFileContent).toHaveBeenCalledTimes(1);
    expect(writeMarkdownFileContent).toHaveBeenCalledWith(
      "/notes/e.md",
      "one, typed\nfrom git\n",
    );
  });
});

describe("takeDiskChange", () => {
  beforeEach(() => {
    vi.mocked(writeMarkdownFileContent).mockReset();
    vi.mocked(readMarkdownFilesContentByPaths).mockReset();
  });

  it("ignores Stream's own save", async () => {
    remember("/notes/f.md", "saved");
    const cache = memoryCache("saved");

    await takeDiskChange("/notes/f.md", "saved", cache);

    expect(cache.text).toBe("saved");
    expect(writeMarkdownFileContent).not.toHaveBeenCalled();
  });

  it("takes the disk's text when nothing was typed", async () => {
    remember("/notes/g.md", "old");
    const cache = memoryCache("old");

    await takeDiskChange("/notes/g.md", "new", cache);

    expect(cache.text).toBe("new");
    expect(knownText("/notes/g.md")).toBe("new");
    expect(writeMarkdownFileContent).not.toHaveBeenCalled();
  });

  it("keeps unsaved typing and saves the merge", async () => {
    remember("/notes/h.md", "a\n");
    const cache = memoryCache("a typed\n");
    onDisk("a\nb\n");

    await takeDiskChange("/notes/h.md", "a\nb\n", cache);

    expect(cache.text).toBe("a typed\nb\n");
    expect(writeMarkdownFileContent).toHaveBeenCalledWith(
      "/notes/h.md",
      "a typed\nb\n",
    );
  });

  it("hands the change to an open editor instead", async () => {
    remember("/notes/i.md", "old");
    const cache = memoryCache("old");
    const listener = vi.fn();
    const stop = followNoteOnDisk("/notes/i.md", listener);

    await takeDiskChange("/notes/i.md", "new", cache);
    stop();

    expect(listener).toHaveBeenCalledWith({ base: "old", remote: "new" });
    expect(cache.text).toBe("old");
  });
});

describe("followNoteOnDisk", () => {
  it("hands changes to the note's editors until they stop listening", () => {
    const listener = vi.fn();
    const stop = followNoteOnDisk("/notes/d.md", listener);
    const change = { base: "a", remote: "b" };

    expect(notifyDiskChange("/notes/d.md", change)).toBe(true);
    expect(listener).toHaveBeenCalledWith(change);

    stop();
    expect(notifyDiskChange("/notes/d.md", change)).toBe(false);
  });
});
