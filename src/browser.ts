import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  existsSync, mkdirSync, openSync, closeSync, writeFileSync, fchmodSync,
  renameSync, constants,
} from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";
import {
  invalidateSessionCache, tightenSessionPermissions, SESSION_DIR, SESSION_PATH,
  onSessionInvalidated, captureSession, assertSessionCurrent, SessionChangedError,
} from "./session-fetch.js";

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

// ── Shared (headless, navigate/interact/get_page) browser handles ─────────────
// Bound to the generation they were opened under so a session transition
// retires them and callers rebuild against the current account.
let browserInstance: Browser | null = null;
let browserHeadless: boolean | null = null;
let contextInstance: BrowserContext | null = null;
let contextGeneration: number | null = null;

// ── Login handles ─────────────────────────────────────────────────────────────
// Deliberately SEPARATE from the shared browser: a login publishes a session
// transition, and that transition must retire only the OLD shared state — never
// the login's own fresh context. Login is serialized: a second concurrent
// attempt is rejected rather than racing the first.
let loginBrowser: Browser | null = null;
let loginContext: BrowserContext | null = null;
let loginInProgress = false;
let activeLoginGeneration: number | null = null;

const CONTEXT_OPTIONS = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
};

/** Build newContext() options, loading the saved storageState when present. */
function buildContextOptions(): Parameters<Browser["newContext"]>[0] {
  return existsSync(SESSION_PATH)
    ? { ...CONTEXT_OPTIONS, storageState: SESSION_PATH }
    : CONTEXT_OPTIONS;
}

// Retire the SHARED authenticated browser on every session transition. Capture
// the specific handles to close in this closure — never reference the live
// globals at close time, or delayed cleanup could null/close a newly created
// (next-generation) browser. The login handles are intentionally untouched.
onSessionInvalidated(() => {
  const oldContext = contextInstance;
  const oldBrowser = browserInstance;
  // Synchronous detachment: no post-transition caller can reuse account A's
  // shared context/browser.
  contextInstance = null;
  browserInstance = null;
  browserHeadless = null;
  contextGeneration = null;
  if (!oldContext && !oldBrowser) return;
  // Tracked async cleanup. revokeSession() awaits and REPORTS any error;
  // invalidateSessionState() swallows the rejection on the non-revoke path but
  // still runs the close. We deliberately don't catch here, so a real revoke
  // surfaces a "browser refused to close" failure through revokeSession().
  return (async () => {
    if (oldContext) await oldContext.close();
    if (oldBrowser) await oldBrowser.close();
  })();
});

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

/**
 * Launch a fresh Chromium/Chrome. Prefer the user's installed Chrome
 * (channel:'chrome') — zero download; fall back to the bundled Chromium
 * (lazy-fetched on first miss). Not a singleton — callers own the returned
 * Browser.
 */
async function launchBrowser(headless: boolean): Promise<Browser> {
  const args = ["--disable-blink-features=AutomationControlled"];
  // Sandbox should stay enabled. Only disable it in constrained container
  // environments (e.g. CI/Docker) where the kernel doesn't support it.
  if (process.env["DDB_NO_SANDBOX"] === "1") args.push("--no-sandbox");

  // Escape hatch: DDB_USE_BUNDLED_CHROMIUM=1 forces the bundled path, useful
  // if a user's system Chrome is broken or too old.
  if (process.env["DDB_USE_BUNDLED_CHROMIUM"] !== "1") {
    try {
      return await chromium.launch({ headless, channel: "chrome", args });
    } catch {
      // Chrome not installed at a standard path — fall through to bundled Chromium.
    }
  }

  // Lazy Chromium provisioning: fetched on first use so package install stays
  // fast and the ~140 MB download happens when the user expects work.
  await ensureChromiumInstalled();
  return chromium.launch({ headless, args });
}

export async function getBrowser(headless = true): Promise<Browser> {
  // If a browser is already running with a different headless setting, close it
  // first so a caller always gets the window mode it asked for.
  if (browserInstance && browserHeadless !== headless) {
    await closeBrowser();
  }
  if (browserInstance) return browserInstance;

  browserInstance = await launchBrowser(headless);
  browserHeadless = headless;
  return browserInstance;
}

export async function getContext(browser: Browser): Promise<BrowserContext> {
  // Refresh on-disk authority first: a pending logout/replacement fires the
  // invalidation hook, which detaches contextInstance so we never hand back a
  // context bound to the revoked account.
  const snapshot = captureSession();
  if (contextInstance && contextGeneration === snapshot.generation) {
    return contextInstance;
  }
  // A leftover context from an older generation (defensive — the hook nulls it).
  if (contextInstance) {
    const stale = contextInstance;
    contextInstance = null;
    contextGeneration = null;
    void stale.close().catch(() => { /* best-effort */ });
  }

  ensureSessionDir();
  const created = await browser.newContext(buildContextOptions());

  // Bind the pending creation to its opening generation: if the account changed
  // while newContext() was in flight, abandon this context rather than install
  // it under the new generation.
  try {
    assertSessionCurrent(snapshot);
  } catch (e) {
    await created.close().catch(() => { /* best-effort */ });
    throw e;
  }
  contextInstance = created;
  contextGeneration = snapshot.generation;
  return created;
}

/**
 * Begin a login: open a fresh, deliberately-owned browser + context (visible
 * window for the OAuth flow). Never reuses the shared — possibly revoked —
 * authenticated context. Serialized: rejects if a login is already running.
 * Captures the generation the login begins under; saveSession() re-checks it so
 * a login started before an observed revocation can't recreate the deleted
 * session.
 */
export async function beginLoginSession(): Promise<BrowserContext> {
  if (loginInProgress) {
    throw new Error(
      "A login is already in progress. Wait for it to finish before starting another."
    );
  }
  loginInProgress = true;
  try {
    activeLoginGeneration = captureSession().generation;
    loginBrowser = await launchBrowser(false);
    loginContext = await loginBrowser.newContext(buildContextOptions());
    return loginContext;
  } catch (e) {
    await endLoginSession().catch(() => { /* best-effort rollback */ });
    throw e;
  }
}

/** Tear down the login's owned browser/context and release the login lock. */
export async function endLoginSession(): Promise<void> {
  const ctx = loginContext;
  const br = loginBrowser;
  loginContext = null;
  loginBrowser = null;
  activeLoginGeneration = null;
  loginInProgress = false;
  if (ctx) await ctx.close();
  if (br) await br.close();
}

export async function saveSession(context: BrowserContext): Promise<void> {
  // Login-race guard: if a revocation (or a competing login) advanced the
  // generation since THIS login began, the login is stale — refuse to recreate
  // the just-deleted session. A login begun AFTER the revoke captured the
  // post-revoke generation, so it matches here and is allowed to save.
  if (activeLoginGeneration !== null) {
    const current = captureSession().generation;
    if (current !== activeLoginGeneration) {
      throw new SessionChangedError(
        "Login raced a session change (logout/replacement); not recreating the session."
      );
    }
  }

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
  // Publish the new session as ONE lifecycle transition: advance the generation
  // and notify every consumer hook so old-account caches/browsers are retired.
  // The login's own context (loginContext) is separate and unaffected.
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
    contextGeneration = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
  browserHeadless = null;
}
