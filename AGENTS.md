# Agents

## Releasing

Always release locally from this Mac. Never use the GitHub Actions `Release`
workflow, because it's too slow.

From a clean `main` that matches `origin/main`, in the primary checkout rather
than a worktree:

```bash
cd stream
pnpm release patch
```

The script builds, signs and notarizes the app, then publishes it. Use
`pnpm release patch --dry-run` to do everything except commit, tag and publish.

## Previewing the UI

Stream is a Mac app, and `pnpm tauri dev` won't run in most Linux sandboxes,
which lack the WebKitGTK libraries Tauri needs there. Its frontend runs in any
Chromium, though, as long as something answers its Tauri calls.
`stream/scripts/preview/tauri-mock.mjs` does: it's a fake backend with a week of
notes, commits, pull requests, checks and running agents, all dated relative to
today. Use it to look at UI changes anywhere `pnpm tauri dev` can't run.

```bash
cd stream
pnpm install
pnpm screenshots
```

That saves every scene to `stream/.screenshots/` (ignored by git) at 2x, in the
app's default 600×800 window. It starts `next dev` on port 3000 if nothing is
serving there, and stops it afterwards. A cold run takes about a minute.

```bash
pnpm screenshots --list
pnpm screenshots --only search,settings --out .screenshots/after
pnpm screenshots --open
```

`--open` shows a browser window on the fake data to click around in, on a
machine with a screen.

When you change the UI:

- Shoot the scenes you'll touch before you start (`--out .screenshots/before`)
  and again after, then open the PNGs and look. A run that succeeds only means
  nothing crashed.
- For a new screen or state, add a scene to `SCENES` in `screenshots.mjs`
  rather than writing a one-off Playwright script. Scenes take mock options:
  `folder: null` (first launch), `notes: false` (empty folder),
  `github: "gh_missing"` (or any other GitHub status), `update: "0.3.0"` and
  `agents: false`.
- When the app calls a new Tauri command or plugin, add a handler to
  `tauri-mock.mjs`. `pnpm test` fails if a command registered in
  `src-tauri/src/lib.rs` has no handler, and a screenshot run lists any call
  the mock didn't answer.
- It's Chromium, not WKWebView. Caret, selection, IME and scrolling behave
  differently, so editor behaviour still needs `pnpm tauri dev` on a Mac. Say
  which of the two you checked.
- If styles look stale after a `git stash`, branch switch or rebase with the
  dev server running, stop it and `rm -rf stream/.next`. Turbopack can miss
  files that change underneath it.
- Claude Code's cloud sandboxes have Chromium preinstalled at
  `/opt/pw-browsers`, so don't run `playwright install` there. Elsewhere, run
  `pnpm exec playwright install chromium` once, set `CHROMIUM_PATH`, or let the
  script fall back to an installed Chrome.
