import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  existsSync, mkdirSync, openSync, closeSync, writeFileSync, fchmodSync,
  renameSync, constants,
} from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";
import { invalidateSessionCache, tightenSessionPermissions, SESSION_DIR, SESSION_PATH } from "./session-fetch.js";

export { SESSION_DIR, SESSION_PATH };

function ensureSessionDir(): void {
  if (!existsSync(SESSION_DIR)) {
    // mode is honored on POSIX (0700) and silently ignored on Windows, where
    // %APPDATA%\ddb-mcp inherits the user-profile ACL instead.
    mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    return;
  }
  // Dir already exists — it may pre-date the 0700 default; tighten it.
  tightenSessionPermissions();
}

let browserInstance: Browser | null = null;
let browserHeadless: boolean | null = null;
let contextInstance: BrowserContext | null = null;

// Singleton Promise so concurrent getBrowser() callers share one install run.
// Cleared on failure so subsequent calls can retry.
let chromiumInstallPromise: Promise<void> | null = null;

async function ensureChromiumInstalled(): Promise<void> {
  if (chromiumInstallPromise) return chromiumInstallPromise;

  // chromium.executablePath() returns the *expected* path; if the binary is
  // not there, we need to fetch it. Wrapped in try because some Playwright
  // versions throw on this call when no browsers are registered yet.
  let executablePath = "";
  try { executablePath = chromium.executablePath(); } catch { /* fall through to install */ }
  if (executablePath && existsSync(executablePath)) return;

  chromiumInstallPromise = (async () => {
    process.stderr.write("[ddb-mcp] Chromium not found — downloading (~140 MB, one-time)…\n");
    // Resolve Playwright's CLI relative to *this* module (not CWD), so the
    // install works whether the server was launched via npx, a global install,
    // or a local clone. Note: Playwright's `exports` map doesn't expose
    // `cli.js`, so we resolve `package.json` (which IS exported) and walk
    // sideways. process.execPath ensures we use the same Node binary.
    const require = createRequire(import.meta.url);
    const cliPath = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    await new Promise<void>((resolve, reject) => {
      // stdout → parent stderr: critical because the MCP server uses stdout
      // for JSON-RPC frames; leaking install progress into stdout would break
      // the client connection.
      const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.pipe(process.stderr);
      child.stderr?.pipe(process.stderr);
      child.on("error", reject);
      child.on("exit", code => {
        if (code === 0) {
          process.stderr.write("[ddb-mcp] Chromium installed.\n");
          resolve();
        } else {
          reject(new Error(
            `Chromium install failed (exit ${code}). ` +
            `Network or sandbox issue? Run \`npx playwright install chromium\` manually to retry.`
          ));
        }
      });
    });
  })();
  // Allow retry on failure — clear the cached promise so the next caller
  // doesn't immediately re-fail against the same rejected Promise.
  chromiumInstallPromise.catch(() => { chromiumInstallPromise = null; });
  return chromiumInstallPromise;
}

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

  // Prefer the user's installed Chrome (channel:'chrome') — zero download,
  // same Chromium engine, identical Playwright API. Fall back to the bundled
  // Chromium (lazy-fetched on first miss) when Chrome isn't present.
  // Escape hatch: DDB_USE_BUNDLED_CHROMIUM=1 forces the bundled path, useful
  // if a user's system Chrome is broken or too old.
  if (process.env["DDB_USE_BUNDLED_CHROMIUM"] !== "1") {
    try {
      browserInstance = await chromium.launch({ headless, channel: "chrome", args });
      browserHeadless = headless;
      return browserInstance;
    } catch {
      // Chrome not installed at a standard path — fall through to bundled Chromium.
    }
  }

  // Lazy Chromium provisioning: fetched on first use (during ddb_login) so
  // package install stays fast and the ~140 MB download happens at a moment
  // the user expects work to happen and we can surface progress.
  await ensureChromiumInstalled();
  browserInstance = await chromium.launch({ headless, args });
  browserHeadless = headless;
  return browserInstance;
}

export async function getContext(browser: Browser): Promise<BrowserContext> {
  if (contextInstance) return contextInstance;

  ensureSessionDir();

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
  ensureSessionDir();
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
