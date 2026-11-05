# Agents

Stream is a Tauri app: a Next.js static export in `stream/src` running in
macOS's WKWebView, with Rust commands in `stream/src-tauri/src/ipc`. Every
command below runs from `stream/`.

## Testing a change

Work from cheapest to most expensive, and say in your summary which of these
you ran and what they didn't cover.

1. **Logic:** keep it in pure functions and test them with vitest (`pnpm test`).
   `src/lib/notes-sync.test.ts` shows labels and timer scheduling tested with
   fake timers.
2. **Rust and git:** `cargo test` in `src-tauri`. Git behaviour is tested
   against real git in temp directories, not mocks. `notes_sync.rs` sets up a
   bare origin and clones it; give each clone `user.name`, `user.email` and
   `commit.gpgsign false`.
3. **Real data, read-only:** ignored tests run the real code against Marcel's
   folders without changing them:
   `FOLDER=... cargo test status_of_real_folder -- --ignored --nocapture` and
   `REPOS=... cargo test fetch_real_repos -- --ignored --nocapture`. Never point
   anything that commits, pushes or writes at `~/Home/brain` from a test.
4. **UI:** snapshot it in WebKit, as described in the next section.
5. **Before committing:** run `pnpm check`, `pnpm type-check`, `pnpm test` and
   `cargo test`. Format Rust with `rustfmt --edition 2021 <file>` on the files
   you changed. Don't run `cargo fmt`, which rewrites the whole crate.

## Checking the UI

Chromium, including the browser pane, doesn't prove layout, because Stream
ships on WKWebView. You can't screenshot `pnpm tauri dev` either: it runs a bare
binary that screen capture can't see, and the shell has no screen recording
permission. Instead, `pnpm snapshot` renders the real components in a hidden
WKWebView on this Mac, with Tauri's IPC stubbed so the real hooks run. It needs
Xcode's `swiftc` and compiles itself on first use. There is no Linux setup. On
a machine without macOS, stop at steps 1–3 above and say the UI wasn't checked.

1. **Add a temporary route** at `src/app/verify-<name>/page.tsx`. It must be a
   `"use client"` page that renders the components you changed in every state
   worth seeing, each wrapped in a `data-state` attribute so `--run` can find
   it. Don't start the folder name with `_`: Next treats those folders as
   private, so the route 404s.
2. **Stub the IPC** in a file that sets `window.__TAURI_STUBS__`, mapping each
   command to a value or a function of its arguments. Copy
   `scripts/webkit-snapshot/examples/footer-sync.stubs.js` to start. Command
   names are the `invoke(...)` strings in `src/ipc/*.ts`. The app version, the
   updater, the store and events are already stubbed in
   `scripts/webkit-snapshot/tauri-stub.js`. A stub that never settles shows a
   pending state, and a rejection shows an error.
3. **Start the dev server** with `pnpm dev` in the background. It must be on
   port 3000, because `next.config.ts` hardcodes the dev asset prefix there and
   any other port renders a blank page.
4. **Snapshot it:**

   ```bash
   pnpm snapshot --url http://localhost:3000/verify-<name> --out /tmp/x.png --stub my.stubs.js --width 900 --height 600 --run 'return window.__tauriStub.missing'
   ```

   `--run` is the body of an async function: it can click things, `await`, and
   `return` values, which print as JSON. Return `window.__tauriStub.missing` to
   list commands you haven't stubbed. Console errors and warnings print after
   the result. The PNG is at 2x scale; read it, then send it to Marcel.
5. **Clean up:** delete the route and stop the server. If `pnpm type-check`
   then complains about the deleted route in `.next/types`, delete `.next`.

Traps:
- **Hidden page:** the page is hidden, so `requestAnimationFrame` is paused and
  timers are throttled. CodeMirror tooltips, popovers and anything animated
  need `--visible`, which shows the window at 1% opacity.
- **Transitions:** the tool turns CSS transitions off, because a hidden page
  freezes them at their first frame.
- **Hover:** `:hover` only follows a real held `mouseDown`. Base UI tooltips
  open from synthetic `pointerenter` and `mouseenter` events dispatched in
  `--run`.
- **Focus:** fire the focus and blur listeners with
  `window.__tauriStub.emit("tauri://focus")` or `emit("tauri://blur")`.
- **Fresh state:** each run uses a fresh data store, so persisted settings start
  at their defaults.
- **Dev overlay:** an "N Issues" badge in the corner means a `console.error`
  fired, usually from an unstubbed command. Read the console lines.

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

If publishing fails after the tag is pushed (for example GitHub's
"ReleaseAsset.name already exists"), the release stays a draft. The updater
never sees a draft, so nothing is broken. Don't rerun the script: it would bump
the version again. Finish the draft by hand:

1. Compare `gh release view vX.Y.Z --json assets` with the five files the
   script stages: `latest.json`, `stream_aarch64.app.tar.gz` and its `.sig`,
   `stream_X.Y.Z_aarch64.dmg`, and `stream-latest-macos-arm64.dmg`.
2. Check that any `.sig` already uploaded matches
   `src-tauri/target/release/bundle/macos/stream.app.tar.gz.sig`.
3. Copy the missing files from `src-tauri/target/release/bundle` under those
   names and add them with `gh release upload`.
4. Publish with `gh release edit vX.Y.Z --draft=false --latest`.
5. Check that
   `https://github.com/marcelmarais/stream/releases/latest/download/latest.json`
   reports the new version.
