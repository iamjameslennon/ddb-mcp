import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  existsSync, mkdirSync, openSync, closeSync, writeFileSync, fchmodSync,
  renameSync, constants,
} from "fs";
import { invalidateSessionCache, SESSION_DIR, SESSION_PATH } from "./session-fetch.js";

export { SESSION_DIR, SESSION_PATH };

let browserInstance: Browser | null = null;
let browserHeadless: boolean | null = null;
let contextInstance: BrowserContext | null = null;

export async function getBrowser(headless = true): Promise<Browser> {
  // If a browser is already running with a different headless setting, close it
  // first so ddb_login always gets a visible window even if headless tools ran before.
  if (browserInstance && browserHeadless !== headless) {
    await closeBrowser();
  }
  if (browserInstance) return browserInstance;
  const args = ["--disable-blink-features=AutomationControlled"];
  // Sandbox should stay enabled. Only disable it in constrained container
  // environments (e.g. CI/Docker) where the kernel doesn't support it.
  if (process.env["DDB_NO_SANDBOX"] === "1") args.push("--no-sandbox");
  browserInstance = await chromium.launch({ headless, args });
  browserHeadless = headless;
  return browserInstance;
}

export async function getContext(browser: Browser): Promise<BrowserContext> {
  if (contextInstance) return contextInstance;

  if (!existsSync(SESSION_DIR)) {
    // mode is honored on POSIX (0700) and silently ignored on Windows, where
    // %APPDATA%\ddb-mcp inherits the user-profile ACL instead.
    mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  }

  const contextOptions = {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  };
  contextInstance = await browser.newContext(
    existsSync(SESSION_PATH) ? { ...contextOptions, storageState: SESSION_PATH } : contextOptions
  );

  return contextInstance;
}

export async function saveSession(context: BrowserContext): Promise<void> {
  if (!existsSync(SESSION_DIR)) {
    // See note in getContext() — mode is a POSIX-only hint.
    mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  }
  // Capture state in memory and write it atomically:
  //   (1) write to a tempfile in the same directory, then renameSync into
  //       place — readers always see either the previous file or the new one,
  //       never a truncated mid-write file;
  //   (2) on POSIX, open with O_NOFOLLOW + mode 0600 so a planted symlink at
  //       the tempfile path can't redirect the write and the file is created
  //       0600 from the start (no umask race window).
  // Windows has no O_NOFOLLOW; rely on user-profile ACL inheritance for the
  // parent %APPDATA% directory.
  const state = await context.storageState();
  const json = JSON.stringify(state);
  const tmpPath = `${SESSION_PATH}.tmp`;
  if (process.platform === "win32") {
    writeFileSync(tmpPath, json, "utf8");
  } else {
    const flags = constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW;
    const fd = openSync(tmpPath, flags, 0o600);
    try {
      // Force 0600 even if a prior crashed run left tmpPath behind (the mode
      // arg to open() is only honored when the file is freshly created).
      fchmodSync(fd, 0o600);
      writeFileSync(fd, json, "utf8");
    } finally {
      closeSync(fd);
    }
  }
  renameSync(tmpPath, SESSION_PATH);
  // Invalidate the in-memory cookie/token cache so the next request reads the new session.
  invalidateSessionCache();
}

export async function getPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  if (pages.length > 0) return pages[0];
  return context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (contextInstance) {
    await contextInstance.close();
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
  browserHeadless = null;
}
