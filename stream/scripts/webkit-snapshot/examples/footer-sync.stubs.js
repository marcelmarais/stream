// Worked example: the footer's sync control in every state. Pair it with a
// temporary route that renders <Footer folderPath="/brain/<state>" /> per state.
const base = {
  repo_root: "/brain",
  branch: "main",
  upstream: "origin/main",
  changed: 0,
  ahead: 0,
  behind: 0,
  busy: false,
};
const states = {
  synced: {},
  changes: { changed: 3 },
  ahead: { ahead: 2 },
  local: { upstream: null, branch: "drafts" },
  rebase: { busy: true, changed: 1 },
  failed: { ahead: 1 },
};

window.__TAURI_STUBS__ = {
  get_notes_sync_status: ({ folderPath }) => ({
    ...base,
    ...states[folderPath.split("/").pop()],
  }),
  sync_notes: ({ folderPath }) =>
    folderPath.endsWith("failed")
      ? Promise.reject("Couldn't rebase onto origin/main: conflict in a.md.")
      : new Promise(() => {}), // Never settles, so the control says syncing…
};
