/**
 * Screenshots of Stream's frontend in Chromium, backed by the fake Tauri IPC in
 * tauri-mock.mjs. Runs anywhere Node and Chromium do, including Linux sandboxes
 * where the app itself can't build. See AGENTS.md for when and how to use it.
 *
 *   pnpm screenshots                       every scene into .screenshots/
 *   pnpm screenshots --only search,home    some scenes
 *   pnpm screenshots --out .screenshots/before
 *   pnpm screenshots --list                what each scene shows
 *   pnpm screenshots --open                a browser window to click around in
 *
 * Starts `next dev` on port 3000 if nothing is serving there, and stops it
 * when done. Dev assets are pinned to :3000 in next.config.ts.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { DEFAULT_FOLDER, installTauriMock } from "./tauri-mock.mjs";

const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));
const BASE_URL = "http://localhost:3000";
const TIMELINE = `/browse/timeline?path=${encodeURIComponent(DEFAULT_FOLDER)}`;
const WINDOW = { width: 600, height: 800 }; // tauri.conf.json's default window
const SERVER_TIMEOUT_MS = 90_000;
// Where Claude Code's cloud sandboxes keep a preinstalled Chromium
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";

/**
 * Each scene opens `url` (the timeline by default) with the given mock options,
 * waits for `ready`, then runs `run` before the screenshot is taken.
 */
const SCENES = {
  timeline: {
    about: "Today's note in the default window",
  },
  "timeline-wide": {
    about: "Today's note in a wide window",
    viewport: { width: 1180, height: 820 },
  },
  "past-days": {
    about: "Scrolled into yesterday, with the pointer on it",
    run: async (page) => {
      await page.mouse.move(300, 400);
      await page.mouse.wheel(0, 760);
      await page.waitForTimeout(600);
    },
  },
  "past-recede": {
    about: "Pointer on today, so yesterday below it steps back",
    run: async (page) => {
      await page.mouse.move(300, 300);
      await page.mouse.wheel(0, 480);
      await page.waitForTimeout(300);
      await page.mouse.move(300, 160);
      await page.waitForTimeout(600);
    },
  },
  "git-panel": {
    about: "Today's stream repo open, with a pull request expanded",
    run: async (page) => {
      await page
        .getByRole("tab", { name: /stream/ })
        .first()
        .click();
      await page
        .getByText("Sync the notes folder with git from the footer")
        .first()
        .click();
      await page
        .getByRole("tab", { name: /stream/ })
        .first()
        .scrollIntoViewIfNeeded();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
    },
  },
  focus: {
    about: "Focus mode, with the docked panel open on the website repo",
    run: async (page) => {
      await page.locator("article h1").first().click();
      await page
        .getByRole("tab", { name: /website/ })
        .last()
        .click();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(500);
    },
  },
  search: {
    about: "⌘F search for “the”",
    run: async (page) => {
      await page.keyboard.press("ControlOrMeta+f");
      await page.keyboard.type("the");
      await page.waitForTimeout(600);
    },
  },
  settings: {
    about: "Settings, top",
    viewport: { width: 600, height: 1000 },
    run: openSettings,
  },
  "settings-bottom": {
    about: "Settings, scrolled to agents and skills",
    viewport: { width: 600, height: 1000 },
    run: async (page) => {
      await openSettings(page);
      await page.locator("main").evaluate((main) => {
        main.scrollTop = main.scrollHeight;
      });
      await page.waitForTimeout(300);
    },
  },
  "github-missing": {
    about: "Settings when the GitHub CLI isn't installed",
    viewport: { width: 600, height: 1000 },
    mock: { github: "gh_missing" },
    run: async (page) => {
      await openSettings(page);
      await page
        .getByRole("heading", { name: "GitHub" })
        .evaluate((heading) => {
          // Clear of the titlebar's fade
          const main = heading.closest("main");
          main.scrollTop = heading.offsetTop - main.offsetTop - 32;
        });
      await page.waitForTimeout(300);
    },
  },
  calendar: {
    about: "The calendar popover",
    run: async (page) => {
      await page
        .getByRole("button", { name: /calendar/i })
        .first()
        .click();
      await page.waitForTimeout(400);
    },
  },
  "skill-menu": {
    about: "Typing / on a new line to pick a skill",
    run: async (page) => {
      await page
        .locator(".cm-line", { hasText: "Book the train" })
        .first()
        .click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("/");
      await page.waitForTimeout(600);
    },
  },
  "note-menu": {
    about: "Right-clicking a day's title",
    run: async (page) => {
      await page.locator("article h1").first().click({ button: "right" });
      await page.waitForTimeout(300);
    },
  },
  "agent-tooltip": {
    about: "Hovering an agent that's waiting for you",
    run: async (page) => {
      await page.getByRole("button", { name: /Codex/ }).first().hover();
      await page.waitForTimeout(600);
    },
  },
  update: {
    about: "The footer offering an update",
    mock: { update: "0.3.0" },
  },
  home: {
    about: "Home, with a folder already chosen",
    url: "/?back=true",
    ready: "h1",
  },
  welcome: {
    about: "Home on first launch, before choosing a folder",
    url: "/",
    ready: "h1",
    mock: { folder: null },
  },
  empty: {
    about: "A notes folder with no notes yet",
    mock: { notes: false },
    ready: "h2",
  },
};

async function openSettings(page) {
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await page.waitForTimeout(600);
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: ".screenshots" },
      scale: { type: "string", default: "2" },
      only: { type: "string" },
      list: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  return values;
}

async function isServing() {
  try {
    const response = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(2000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Starts `next dev` unless something already serves the app. */
async function ensureServer() {
  if (await isServing()) {
    return null;
  }

  console.log("Starting next dev on :3000…");
  const server = spawn(
    "pnpm",
    ["exec", "next", "dev", "--turbopack", "--port", "3000"],
    {
      cwd: APP_DIR,
      stdio: "ignore",
      detached: true,
    },
  );

  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServing()) {
      return server;
    }
    if (server.exitCode !== null) {
      throw new Error("next dev exited. Is port 3000 taken?");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopServer(server);
  throw new Error("next dev didn't start within 90s");
}

function stopServer(server) {
  if (!server) return;
  try {
    process.kill(-server.pid); // The whole group, so next's workers go too
  } catch {
    server.kill();
  }
}

/** Playwright's own Chromium, then the sandbox's, then an installed Chrome. */
async function launchBrowser(headless) {
  const attempts = [
    process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH },
    {},
    existsSync(SANDBOX_CHROMIUM) && { executablePath: SANDBOX_CHROMIUM },
    { channel: "chrome" },
  ].filter(Boolean);

  let lastError;
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless, ...attempt });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Couldn't start Chromium. Run \`pnpm exec playwright install chromium\` or set CHROMIUM_PATH.\n${lastError?.message ?? ""}`,
  );
}

/**
 * Stand-ins for macOS's close, minimise and zoom buttons, where
 * trafficLightPosition in tauri.conf.json puts them, so titlebar layouts can
 * be checked against them.
 */
function drawWindowButtons() {
  const buttons = document.createElement("div");
  buttons.setAttribute("aria-hidden", "true");
  buttons.style.cssText =
    "position:fixed;top:11px;left:13px;z-index:2147483647;display:flex;gap:8px;pointer-events:none";
  for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
    const button = document.createElement("span");
    button.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color}`;
    buttons.append(button);
  }
  document.body.append(buttons);
}

async function openPage(browser, scene, scale, problems) {
  const context = await browser.newContext({
    viewport: scene.viewport ?? WINDOW,
    deviceScaleFactor: scale,
    reducedMotion: "reduce",
  });
  await context.addInitScript(installTauriMock, scene.mock ?? {});
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  page.on("pageerror", (error) => problems.add(`page error: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[preview] unhandled")) {
      problems.add(
        `${text.split(" ").slice(0, 3).join(" ")} (add it to tauri-mock.mjs)`,
      );
    }
  });

  // The first visit to a route compiles it, which can take a while
  await page.goto(`${BASE_URL}${scene.url ?? TIMELINE}`, { timeout: 90_000 });
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await page.evaluate(drawWindowButtons);
  await page
    .locator(scene.ready ?? "article .cm-content")
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Commits, pull requests and agents arrive just after the notes
  await page.waitForTimeout(800);

  return { context, page };
}

async function main() {
  const options = parseOptions();

  if (options.help || options.list) {
    if (options.help) {
      console.log(
        "Usage: pnpm screenshots [--only a,b] [--out dir] [--scale n] [--list] [--open]\n",
      );
    }
    for (const [name, { about }] of Object.entries(SCENES)) {
      console.log(`${name.padEnd(16)} ${about}`);
    }
    return;
  }

  const names = options.only
    ? options.only.split(",").map((name) => name.trim())
    : Object.keys(SCENES);
  const unknown = names.filter((name) => !SCENES[name]);
  if (unknown.length > 0) {
    throw new Error(`Unknown scene: ${unknown.join(", ")}. Try --list.`);
  }

  const server = await ensureServer();
  const problems = new Set();

  try {
    if (options.open) {
      const browser = await launchBrowser(false);
      await openPage(browser, { viewport: WINDOW }, 1, problems);
      console.log(
        "Opened the timeline on fake data. Close the window to stop.",
      );
      await new Promise((resolve) => browser.on("disconnected", resolve));
      return;
    }

    const outDir = path.resolve(APP_DIR, options.out);
    mkdirSync(outDir, { recursive: true });
    const browser = await launchBrowser(true);
    let failed = 0;

    for (const name of names) {
      const scene = SCENES[name];
      let context;
      try {
        const opened = await openPage(
          browser,
          scene,
          Number(options.scale),
          problems,
        );
        context = opened.context;
        await scene.run?.(opened.page);
        const file = path.join(outDir, `${name}.png`);
        await opened.page.screenshot({ path: file });
        console.log(`✓ ${path.relative(process.cwd(), file)}`);
      } catch (error) {
        failed += 1;
        console.error(`✗ ${name}: ${error.message.split("\n")[0]}`);
      } finally {
        await context?.close();
      }
    }

    await browser.close();

    for (const problem of problems) {
      console.warn(`! ${problem}`);
    }
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
