import { chromium, Browser, BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";
import {
  invalidateSessionCache, tightenSessionPermissions, SESSION_DIR, SESSION_PATH,
  onSessionInvalidated, captureSession, assertSessionCurrent, SessionChangedError,
  decodeCobaltToken, MalformedCobaltTokenError,
} from "./session-fetch.js";
import { sanitizeSessionStorage, writeSessionFile, type PlaywrightCookie } from "./session-state.js";

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

/**
 * Build the SHARED context's newContext() options, loading the saved
 * storageState when present. (The login context is seeded from a
 * captureSession() snapshot instead: see beginLoginSession.)
 */
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

/** A second ddb_login while one is running. */
export class LoginInProgressError extends Error {
  constructor() {
    super("A login is already in progress. Wait for it to finish before starting another.");
    this.name = "LoginInProgressError";
  }
}

/** Neither the user's Chrome nor the bundled Chromium could be started for sign-in. */
export class LoginLaunchError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Couldn't start Chrome or Chromium for the sign-in window: ${detail}`, { cause });
    this.name = "LoginLaunchError";
  }
}

/**
 * Begin a login: open a fresh, deliberately-owned browser + context (visible
 * window for the OAuth flow). Never reuses the shared — possibly revoked —
 * authenticated context. Serialized: rejects if a login is already running.
 * Captures the generation the login begins under; saveVerifiedSession()
 * re-checks it so a login started before an observed revocation can't recreate
 * the deleted session.
 *
 * The context is seeded from the same captureSession() snapshot, never from a
 * raw read of session.json: only an authenticated, unrevoked snapshot seeds
 * it, and only with its sanitized (dndbeyond.com) cookies. After a logout whose
 * file deletion failed, the snapshot is anonymous ("revoked"), so the revoked
 * cookies can't come back through the login window.
 */
export async function beginLoginSession(): Promise<BrowserContext> {
  if (loginInProgress) throw new LoginInProgressError();
  loginInProgress = true;
  try {
    const snapshot = captureSession();
    activeLoginGeneration = snapshot.generation;
    try {
      loginBrowser = await launchBrowser(false);
    } catch (e) {
      throw new LoginLaunchError(e);
    }
    loginContext = await loginBrowser.newContext(
      snapshot.state.kind === "authenticated"
        ? { ...CONTEXT_OPTIONS, storageState: { cookies: snapshot.state.cookies.map(seedCookie), origins: [] } }
        : CONTEXT_OPTIONS
    );
    return loginContext;
  } catch (e) {
    await endLoginSession().catch(() => { /* best-effort rollback */ });
    throw e;
  }
}

type SeedCookie = Exclude<NonNullable<Parameters<Browser["newContext"]>[0]>["storageState"], string | undefined>["cookies"][number];

/** A snapshot cookie as newContext() takes it (Playwright requires sameSite). */
function seedCookie(cookie: PlaywrightCookie): SeedCookie {
  const sameSite = (cookie as { sameSite?: unknown }).sameSite;
  return {
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
    expires: cookie.expires, httpOnly: cookie.httpOnly, secure: cookie.secure,
    sameSite: sameSite === "Strict" || sameSite === "None" ? sameSite : "Lax",
  };
}

/**
 * Tear down the login's owned browser/context and release the login lock.
 * With `context`, does nothing unless that is the current login's context, so
 * a caller can only end the login it began. The browser is closed even when
 * closing the context throws; the first error is rethrown afterwards.
 */
export async function endLoginSession(context?: BrowserContext): Promise<void> {
  if (context !== undefined && context !== loginContext) return;
  const ctx = loginContext;
  const br = loginBrowser;
  loginContext = null;
  loginBrowser = null;
  activeLoginGeneration = null;
  loginInProgress = false;
  let failure: unknown;
  try {
    if (ctx) await ctx.close();
  } catch (e) {
    failure = e;
  }
  try {
    if (br) await br.close();
  } catch (e) {
    failure ??= e;
  }
  if (failure !== undefined) throw failure;
}

const COBALT_TOKEN_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";

/**
 * Proof that D&D Beyond handed a login context a usable cobalt token. Only
 * verifyLoginContext() makes one, and each is bound to the context it checked,
 * so saveVerifiedSession() can't be handed a forged or borrowed proof.
 */
export interface VerifiedSignIn {
  readonly userId: string;
}
const verifiedContexts = new WeakMap<VerifiedSignIn, BrowserContext>();

/**
 * Ask D&D Beyond whether this login context is signed in: POST the cobalt-token
 * exchange through the context's own request API (it shares the context's
 * cookie jar, so the browser's sign-in is exactly what is checked). Returns a
 * proof when the answer decodes as `mintCobaltToken` decodes it, and null for
 * anything else: `{"token":null}` (anonymous), a non-OK status, or an unusable
 * token. Network and closed-context errors propagate to the caller.
 */
export async function verifyLoginContext(
  context: BrowserContext,
  timeoutMs = 10_000,
): Promise<VerifiedSignIn | null> {
  const resp = await context.request.post(COBALT_TOKEN_URL, {
    timeout: Math.max(1, timeoutMs),
    failOnStatusCode: false,
    headers: { Accept: "application/json" },
  });
  if (!resp.ok()) return null;
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return null;
  }
  let userId: string;
  try {
    ({ userId } = decodeCobaltToken(body));
  } catch (e) {
    if (e instanceof MalformedCobaltTokenError) return null;
    throw e;
  }
  const proof: VerifiedSignIn = Object.freeze({ userId });
  verifiedContexts.set(proof, context);
  return proof;
}

/**
 * Save a login context's session — only with a proof from verifyLoginContext()
 * for this same context, so an anonymous cookie set is never written.
 * `signal` is checked after the async storage read and before the write, so a
 * cancelled ddb_login writes nothing.
 */
export async function saveVerifiedSession(
  context: BrowserContext,
  verified: VerifiedSignIn,
  signal?: AbortSignal,
): Promise<void> {
  if (verifiedContexts.get(verified) !== context) {
    throw new Error("Refusing to save a session that D&D Beyond hasn't verified as signed in.");
  }
  // Login-race guard: if a revocation (or a competing login) advanced the
  // generation since THIS login began, the login is stale — refuse to recreate
  // the just-deleted session. A login begun AFTER the revoke captured the
  // post-revoke generation, so it matches here and is allowed to save.
  assertLoginGenerationCurrent();

  ensureSessionDir();
  // Playwright's storageState is the whole browser profile: a Wizards ID login
  // via Google or Apple leaves that provider's session cookies and localStorage
  // in here. Persist only dndbeyond.com cookies and origin storage. The write
  // itself is atomic (temp file, 0600, rename) — see writeSessionFile. The
  // verification POST went to auth-service.dndbeyond.com, which only ever
  // receives dndbeyond.com cookies, so the sanitized set is the one verified.
  const { storage } = sanitizeSessionStorage(await context.storageState());
  signal?.throwIfAborted();
  // storageState() is async: re-check that no logout landed meanwhile.
  assertLoginGenerationCurrent();
  writeSessionFile(JSON.stringify(storage));
  // Publish the new session as ONE lifecycle transition: advance the generation
  // and notify every consumer hook so old-account caches/browsers are retired.
  // The login's own context (loginContext) is separate and unaffected.
  invalidateSessionCache();
}

function assertLoginGenerationCurrent(): void {
  if (activeLoginGeneration !== null) {
    const current = captureSession().generation;
    if (current !== activeLoginGeneration) {
      throw new SessionChangedError(
        "Login raced a session change (logout/replacement); not recreating the session."
      );
    }
  }
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
