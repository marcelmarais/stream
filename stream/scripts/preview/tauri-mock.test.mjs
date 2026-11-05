import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FOLDER, installTauriMock } from "./tauri-mock.mjs";

const LIB_RS = new URL("../../src-tauri/src/lib.rs", import.meta.url);

/** The commands src-tauri registers with `tauri::generate_handler!` */
function registeredCommands() {
  const source = readFileSync(LIB_RS, "utf8");
  const list = /generate_handler!\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return list
    .split(",")
    .map((entry) => entry.trim().split("::").pop())
    .filter(Boolean);
}

function invoke(command, args, options) {
  return window.__TAURI_INTERNALS__.invoke(command, args, options);
}

describe("installTauriMock", () => {
  beforeEach(() => {
    globalThis.window = {};
  });

  it("answers every command the Rust side registers", () => {
    installTauriMock();
    const commands = registeredCommands();

    expect(commands.length).toBeGreaterThan(10);
    expect(
      commands.filter(
        (command) => !window.__STREAM_PREVIEW__.handled.includes(command),
      ),
    ).toEqual([]);
  });

  it("keeps notes written by the app", async () => {
    installTauriMock({ notes: false });
    const path = `${DEFAULT_FOLDER}/2026-01-02.md`;

    expect(await invoke("read_markdown_files_metadata")).toEqual([]);

    await invoke("plugin:fs|write_text_file", new TextEncoder().encode("Hi"), {
      headers: { path: encodeURIComponent(path) },
    });

    expect(
      await invoke("read_markdown_files_content", { filePaths: [path] }),
    ).toEqual({
      [path]: "Hi",
    });
    expect(
      (await invoke("read_markdown_files_metadata")).map((f) => f.file_name),
    ).toEqual(["2026-01-02.md"]);
  });

  it("has no saved folder when folder is null", async () => {
    installTauriMock({ folder: null });
    const rid = await invoke("plugin:store|load", { path: "settings.json" });

    expect(
      await invoke("plugin:store|get", {
        rid,
        key: "stream-last-selected-folder",
      }),
    ).toEqual([undefined, false]);
  });
});
