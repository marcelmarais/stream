/**
 * A fake Tauri backend, so the frontend runs in a plain browser with realistic
 * data: a week of notes, commits, pull requests, checks and running agents.
 *
 * Playwright injects `installTauriMock` with `context.addInitScript(fn, options)`,
 * which serialises the function, so it must not touch anything outside its own
 * body. Notes live in memory, so typing, saving and creating notes work until
 * the page reloads.
 *
 * Add a handler here whenever the app starts calling a new command or plugin.
 * `tauri-mock.test.mjs` fails if a command registered in src-tauri has none,
 * and unhandled calls log `[preview] unhandled <command>`.
 */

export const DEFAULT_FOLDER = "/Users/demo/notes";

/**
 * @typedef {object} MockOptions
 * @property {string | null} [folder] The saved notes folder. Null shows the welcome screen.
 * @property {boolean} [notes] False starts with an empty folder.
 * @property {string} [github] A GitHubStatus state, e.g. "connected" or "gh_missing".
 * @property {string[]} [githubAccounts] The accounts gh is signed in to, the active one first.
 * @property {boolean} [agents] False hides the running agents.
 * @property {string | null} [update] A version to offer as an update.
 */

/** @param {MockOptions} [options] */
export function installTauriMock(options = {}) {
  const {
    folder = "/Users/demo/notes",
    notes = true,
    github = "connected",
    githubAccounts = ["demo"],
    agents: showAgents = true,
    update = null,
  } = options;
  const notesFolder = folder ?? "/Users/demo/notes";
  const repos = {
    stream: "/Users/demo/code/stream",
    website: "/Users/demo/code/website",
  };

  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const daysAgo = (days) => {
    const date = new Date(midnight);
    date.setDate(date.getDate() - days);
    return date;
  };
  const dateKey = (date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  const at = (days, hours, minutes) => {
    const date = daysAgo(days);
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  };
  const minutesAgo = (minutes) => now - minutes * 60000;

  // ---- Notes -------------------------------------------------------------

  const NOTES = [
    {
      daysAgo: 0,
      city: "Cape Town",
      country: "South Africa",
      text: [
        "## Focus",
        "",
        "- [x] Ship the footer sync control",
        "- [ ] Review Sam's search index PR",
        "- [ ] Write up the agent status design for Friday",
        "",
        "## Notes",
        "",
        "Paired with Priya on the rebase flow. The status line should only speak when something changed, **never** a toast.",
        "",
        "- Rate limit drops to ~400 while checks run, so only poll at 20s while `running`",
        "- Show the branch's last commit time instead of the PR's",
        "    - needs `last_commit_at` from the GraphQL query",
        "- https://github.com/marcelmarais/stream/pull/212",
        "",
        "## Later",
        "",
        "Book the train to Cape Town for the 14th",
      ],
    },
    {
      daysAgo: 1,
      city: "Cape Town",
      country: "South Africa",
      text: [
        "## Standup",
        "",
        "- Finished the commit panel refactor",
        "- Blocked on notarisation, Apple's queue is slow today",
        "",
        "## Reading",
        "",
        "[Designing calm technology](https://calmtech.com/) has a good section on peripheral attention that maps onto the timeline.",
        "",
        "> The right amount of technology is the minimum needed to solve the problem.",
        "",
        "## Todo",
        "",
        "- [x] Fix `getCommitBranch` for merged commits",
        "- [x] Tests for fetch-on-focus",
        "- [ ] ~~Move toasts to sonner~~ dropped, footer instead",
      ],
    },
    {
      daysAgo: 2,
      city: "Stellenbosch",
      country: "South Africa",
      text: [
        "# Planning",
        "",
        "Quarter goals, roughly:",
        "",
        "1. Agents feel native, not bolted on",
        "2. Search is instant on 2k notes",
        "3. Settings fits on one screen",
        "",
        "### Open questions",
        "",
        "- Should folded headings sync across devices?",
        "- Per-repo colours? Probably not.",
      ],
    },
    {
      daysAgo: 3,
      city: "Cape Town",
      country: "South Africa",
      text: [
        "Quiet day, mostly reviews.",
        "",
        "- Reviewed #208 and #209",
        "- Lunch with Jo, who's moving to the infra team",
      ],
    },
    {
      daysAgo: 6,
      city: "Cape Town",
      country: "South Africa",
      text: [
        "## Retro",
        "",
        "What went well: shipping skills behind `/`. What didn't: three releases in a day.",
      ],
    },
  ];

  /** Path to text, standing in for the notes folder on disk */
  const files = new Map();
  /** Path to { city, country }, standing in for meta.json */
  const locations = new Map();

  if (notes) {
    for (const note of NOTES) {
      const path = `${notesFolder}/${dateKey(daysAgo(note.daysAgo))}.md`;
      files.set(path, note.text.join("\n"));
      locations.set(path, { city: note.city, country: note.country });
    }
  }

  const NOTE_NAME = /(\d{4})-(\d{2})-(\d{2})\.md$/;

  const listNotes = () =>
    [...files.keys()]
      .filter((path) => path.startsWith(`${notesFolder}/`))
      .flatMap((path) => {
        const match = NOTE_NAME.exec(path);
        if (!match) return [];
        const day = new Date(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
        ).getTime();
        return [
          {
            file_path: path,
            file_name: path.split("/").pop(),
            created_at: day,
            modified_at: day,
            size: files.get(path).length,
            date_from_filename: day,
            ...locations.get(path),
          },
        ];
      })
      .sort((a, b) => b.date_from_filename - a.date_from_filename);

  const missing = (path) => new Error(`No such file or directory: ${path}`);

  // ---- Git, GitHub and agents ----------------------------------------------

  let commitNumber = 0;
  const commit = (repo, timestamp, message, branches) => {
    commitNumber += 1;
    return {
      id: `c0ffee${String(commitNumber).padStart(4, "0")}`,
      message,
      author_name: "Demo",
      author_email: "demo@example.com",
      timestamp,
      date: dateKey(new Date(timestamp)),
      repo_path: repo,
      branches,
      parents: [],
      url: `https://github.com/demo/${repo.split("/").pop()}/commit/${commitNumber}`,
      is_mine: true,
    };
  };

  const commits = [
    commit(
      repos.stream,
      minutesAgo(12),
      "Quieten the status line while syncing",
      ["footer-sync"],
    ),
    commit(repos.stream, minutesAgo(48), "Show sync state in the footer", [
      "footer-sync",
    ]),
    commit(
      repos.stream,
      minutesAgo(95),
      "Commit, pull and push from one control",
      ["footer-sync"],
    ),
    commit(repos.stream, minutesAgo(180), "Release v0.2.24", ["main"]),
    commit(
      repos.stream,
      minutesAgo(240),
      "Fetch on focus when the last fetch is stale",
      ["main"],
    ),
    commit(repos.website, minutesAgo(26), "Tighten pricing table spacing", [
      "pricing-page",
    ]),
    commit(repos.website, minutesAgo(120), "Add annual toggle", [
      "pricing-page",
    ]),
    commit(repos.stream, at(1, 16, 42), "Group commits by branch", [
      "main",
      "commit-panel",
    ]),
    commit(repos.stream, at(1, 14, 5), "Rank rows that need you first", [
      "main",
      "commit-panel",
    ]),
    commit(repos.stream, at(1, 11, 20), "Drop sonner", ["main"]),
    commit(repos.website, at(1, 10, 2), "Fix the og image", ["main"]),
    commit(repos.stream, at(2, 15, 30), "Plan the quarter", ["main"]),
    commit(repos.stream, at(3, 12, 10), "Bump dependencies", ["main"]),
  ];
  const headOf = (message) => commits.find((c) => c.message === message).id;

  const check = (name, status) => ({
    name,
    status,
    url: "https://github.com/demo/stream/actions",
  });

  const snapshot = {
    pull_requests: [
      {
        repo_path: repos.stream,
        number: 214,
        title: "Sync the notes folder with git from the footer",
        url: "https://github.com/demo/stream/pull/214",
        state: "open",
        branch: "footer-sync",
        additions: 182,
        deletions: 41,
        comments: 3,
        checks: "pass",
        check_runs: [
          check("check", "pass"),
          check("type-check", "pass"),
          check("cargo test", "pass"),
        ],
        review: "approved",
        reviews: [{ login: "priya", state: "APPROVED" }],
        head_sha: headOf("Quieten the status line while syncing"),
        last_commit_at: new Date(minutesAgo(12)).toISOString(),
        merged_at: null,
        is_mine: true,
      },
      {
        repo_path: repos.stream,
        number: 211,
        title: "Index notes incrementally on save",
        url: "https://github.com/demo/stream/pull/211",
        state: "open",
        branch: "search-index",
        additions: 420,
        deletions: 88,
        comments: 7,
        checks: "running",
        check_runs: [check("check", "pass"), check("cargo test", "running")],
        review: "requested",
        reviews: [],
        head_sha: "someone-elses-commit",
        last_commit_at: new Date(minutesAgo(70)).toISOString(),
        merged_at: null,
        is_mine: false,
      },
      {
        repo_path: repos.website,
        number: 57,
        title: "New pricing page",
        url: "https://github.com/demo/website/pull/57",
        state: "draft",
        branch: "pricing-page",
        additions: 96,
        deletions: 12,
        comments: 0,
        checks: "fail",
        check_runs: [check("build", "fail"), check("lint", "pass")],
        review: null,
        reviews: [],
        head_sha: headOf("Tighten pricing table spacing"),
        last_commit_at: new Date(minutesAgo(26)).toISOString(),
        merged_at: null,
        is_mine: true,
      },
    ],
    default_branches: [
      {
        repo_path: repos.stream,
        branch: "main",
        checks: "pass",
        check_runs: [check("check", "pass")],
        head_sha: headOf("Release v0.2.24"),
        last_commit_at: new Date(minutesAgo(180)).toISOString(),
      },
    ],
    rate_remaining: 4800,
  };

  const agents = showAgents
    ? [
        {
          id: "agent-claude",
          kind: "claude",
          status: "working",
          title: "Quieten the status line",
          repo_path: repos.stream,
          branch: "footer-sync",
          since: minutesAgo(7),
          activity: "Running pnpm type-check",
          chat: null,
        },
        {
          id: "agent-codex",
          kind: "codex",
          status: "waiting",
          title: "Fix the pricing build",
          repo_path: repos.website,
          branch: "pricing-page",
          since: minutesAgo(20),
          activity: "Approve running next build?",
          chat: null,
        },
      ]
    : [];

  const GITHUB_STATES = {
    connected: {
      state: "connected",
      login: "demo",
      repo_count: 2,
      unreadable_repos: [],
      needs_repo_scope: false,
    },
    gh_missing: { state: "gh_missing" },
    logged_out: { state: "logged_out" },
    token_rejected: {
      state: "token_rejected",
      detail: "HTTP 401: Bad credentials",
    },
    rate_limited: { state: "rate_limited", detail: "API rate limit exceeded" },
    unreachable: {
      state: "unreachable",
      detail: "could not resolve api.github.com",
    },
    failed: { state: "failed", detail: "gh: unknown error" },
  };

  // A chosen account is who gh answers as, unless gh no longer has it
  const getGitHubStatus = (githubAccount) => {
    const status = GITHUB_STATES[github] ?? GITHUB_STATES.connected;

    if (!githubAccount || status.state !== "connected") {
      return status;
    }

    return githubAccounts.includes(githubAccount)
      ? { ...status, login: githubAccount }
      : {
          state: "account_missing",
          login: githubAccount,
          detail: `no oauth token found for github.com account ${githubAccount}`,
        };
  };

  // ---- Stores (tauri-plugin-store) ------------------------------------------

  const stores = {
    "settings.json": folder ? { "stream-last-selected-folder": folder } : {},
    "repo-mappings.json": {
      mappings: { [notesFolder]: [repos.stream, repos.website] },
    },
  };
  const storeByRid = new Map();
  let nextId = 1;

  // Channels and listeners hand Tauri a callback id; keep the callbacks so the
  // mock can talk back, as the fs watcher does
  const callbacks = new Map();
  const watchers = new Map();

  const openStore = ({ path }) => {
    const rid = nextId++;
    stores[path] ??= {};
    storeByRid.set(rid, stores[path]);
    return rid;
  };

  // ---- Handlers -------------------------------------------------------------

  const handlers = {
    // Stream's own commands, as registered in src-tauri/src/lib.rs
    read_markdown_files_metadata: () => listNotes(),
    read_markdown_files_content: ({ filePaths }) =>
      Object.fromEntries(
        filePaths.filter((p) => files.has(p)).map((p) => [p, files.get(p)]),
      ),
    get_git_commits_for_repos: ({ repoPaths, startTimestamp, endTimestamp }) =>
      repoPaths.map((repo_path) => ({
        repo_path,
        commits: commits.filter(
          (c) =>
            c.repo_path === repo_path &&
            c.timestamp >= startTimestamp &&
            c.timestamp <= endTimestamp,
        ),
      })),
    fetch_repos: ({ repoPaths }) =>
      repoPaths.map((repo_path) => ({ repo_path, success: true, message: "" })),
    get_branch_tips: () => commits.map((c) => c.id),
    get_pull_requests: () => snapshot,
    get_github_status: ({ githubAccount }) => getGitHubStatus(githubAccount),
    list_github_accounts: () =>
      ["gh_missing", "logged_out"].includes(github)
        ? []
        : githubAccounts.map((login, index) => ({
            login,
            active: index === 0,
          })),
    discover_git_repos: () => [
      {
        path: repos.stream,
        display_path: "~/code/stream",
        name: "stream",
        last_modified: minutesAgo(10),
      },
      {
        path: repos.website,
        display_path: "~/code/website",
        name: "website",
        last_modified: minutesAgo(60),
      },
      {
        path: "/Users/demo/code/dotfiles",
        display_path: "~/code/dotfiles",
        name: "dotfiles",
        last_modified: minutesAgo(5 * 1440),
      },
      {
        path: "/Users/demo/code/advent",
        display_path: "~/code/advent",
        name: "advent",
        last_modified: minutesAgo(40 * 1440),
      },
    ],
    get_notes_sync_status: () => ({
      repo_root: notesFolder,
      branch: "main",
      upstream: "origin/main",
      changed: 2,
      ahead: 0,
      behind: 0,
      busy: false,
    }),
    sync_notes: () => ({ committed: true, pulled: false, pushed: true }),
    list_running_agents: () => agents,
    open_agent_chat: () => null,
    list_skills: () => [
      {
        name: "standup",
        description:
          "Summarise yesterday's note and commits into a standup update",
        path: `${notesFolder}/Skills/standup.md`,
      },
      {
        name: "todos",
        description: "Collect open tasks from the last week",
        path: `${notesFolder}/Skills/todos.md`,
      },
      {
        name: "review",
        description: "Review the pull request linked on this line",
        path: `${notesFolder}/Skills/review/SKILL.md`,
      },
    ],
    start_skill_thread: () =>
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    detect_location: () => ({ city: "Cape Town", country: "South Africa" }),
    set_file_location_metadata: () => null,
    search_markdown_files: ({ query }) => {
      const needle = query.toLowerCase();
      const matches = listNotes().flatMap(({ file_path }) =>
        files
          .get(file_path)
          .split("\n")
          .flatMap((line, index) => {
            const start = line.toLowerCase().indexOf(needle);
            return start === -1
              ? []
              : [
                  {
                    file_path,
                    line_number: index + 1,
                    match_ranges: [[start, start + needle.length]],
                    context_snippet: line,
                    score: 1,
                  },
                ];
          }),
      );
      return { matches, total_results: matches.length, search_time_ms: 3 };
    },
    rebuild_search_index: () => null,

    // Plugins
    "plugin:app|version": () => "0.0.0-preview",
    "plugin:dialog|open": () => notesFolder,
    "plugin:event|listen": () => nextId++,
    "plugin:event|unlisten": () => null,
    "plugin:fs|exists": ({ path }) => files.has(path),
    "plugin:fs|read_text_file": ({ path }) => {
      if (!files.has(path)) throw missing(path);
      return [...new TextEncoder().encode(files.get(path))];
    },
    "plugin:fs|write_text_file": (data, invokeOptions) => {
      const path = decodeURIComponent(invokeOptions?.headers?.path ?? "");
      files.set(path, new TextDecoder().decode(data));
      return null;
    },
    "plugin:fs|remove": ({ path }) => {
      files.delete(path);
      return null;
    },
    "plugin:fs|watch": ({ paths, onEvent }) => {
      const rid = nextId++;
      // A channel numbers its messages from 0 and drops any out of turn
      watchers.set(rid, { paths, channel: onEvent?.id ?? onEvent, index: 0 });
      return rid;
    },
    "plugin:fs|unwatch": ({ rid }) => {
      watchers.delete(rid);
      return null;
    },
    "plugin:resources|close": ({ rid }) => {
      watchers.delete(rid);
      storeByRid.delete(rid);
      return null;
    },
    "plugin:fs|stat": ({ path }) => {
      if (!files.has(path)) throw missing(path);
      return {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: files.get(path).length,
        mtime: now,
        atime: now,
        birthtime: now,
        readonly: false,
      };
    },
    "plugin:opener|open_url": () => null,
    "plugin:opener|open_path": () => null,
    "plugin:opener|reveal_item_in_dir": () => null,
    "plugin:process|restart": () => null,
    "plugin:store|load": openStore,
    "plugin:store|get_store": openStore,
    "plugin:store|get": ({ rid, key }) => {
      const store = storeByRid.get(rid) ?? {};
      return [store[key], key in store];
    },
    "plugin:store|set": ({ rid, key, value }) => {
      storeByRid.get(rid)[key] = value;
      return null;
    },
    "plugin:store|delete": ({ rid, key }) => {
      const store = storeByRid.get(rid) ?? {};
      const had = key in store;
      delete store[key];
      return had;
    },
    "plugin:store|save": () => null,
    "plugin:updater|check": () =>
      update
        ? {
            rid: nextId++,
            currentVersion: "0.0.0-preview",
            version: update,
            date: new Date(now).toISOString(),
            body: "",
            rawJson: {},
          }
        : null,
    "plugin:window|start_dragging": () => null,
  };

  /** Changes a note the way git or another app would, and tells watchers. */
  const changeOnDisk = (path, text) => {
    if (text === null) {
      files.delete(path);
    } else {
      files.set(path, text);
    }
    const type =
      text === null
        ? { remove: { kind: "file" } }
        : { modify: { kind: "data", mode: "content" } };
    for (const watcher of watchers.values()) {
      if (watcher.paths.some((watched) => path.startsWith(watched))) {
        callbacks.get(watcher.channel)?.({
          index: watcher.index++,
          message: { type, paths: [path], attrs: {} },
        });
      }
    }
  };

  window.__STREAM_PREVIEW__ = {
    handled: Object.keys(handlers),
    unhandled: [],
    notePath: (days = 0) => `${notesFolder}/${dateKey(daysAgo(days))}.md`,
    readNote: (path) => files.get(path),
    changeOnDisk,
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    plugins: {},
    transformCallback: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id) => {
      callbacks.delete(id);
    },
    convertFileSrc: (path) => path,
    invoke: async (command, args = {}, invokeOptions) => {
      const handler = handlers[command];
      if (!handler) {
        window.__STREAM_PREVIEW__.unhandled.push(command);
        console.warn(`[preview] unhandled ${command}`, args);
        return null;
      }
      return handler(args, invokeOptions);
    },
  };
}
