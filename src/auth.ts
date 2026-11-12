import type { BrowserContext, Page } from "playwright";
import { getPage, verifyLoginContext, saveVerifiedSession, type VerifiedSignIn } from "./browser.js";
import { SessionChangedError } from "./session-fetch.js";
import { safeErrorLine } from "./utils.js";

/** How long ddb_login waits for the user to finish signing in (owner ruling 2026-11-11). */
export const LOGIN_TIMEOUT_MS = 180_000;
/** How often D&D Beyond is asked whether the login window is signed in yet. */
export const LOGIN_POLL_INTERVAL_MS = 2_000;
/** How often ddb_login sends notifications/progress while it waits (when asked to). */
export const LOGIN_PROGRESS_INTERVAL_MS = 10_000;
/** Upper bound on one sign-in check request. */
const VERIFY_REQUEST_TIMEOUT_MS = 10_000;
/** 301s to /sign-in?returnUrl=, so the sign-in returns to the main site. */
const SIGN_IN_URL = "https://www.dndbeyond.com/login";

/**
 * The user didn't finish signing in before LOGIN_TIMEOUT_MS. When the last
 * sign-in check itself failed (e.g. auth-service unreachable), its safe first
 * line is named, since then the user may not be the reason (owner ruling
 * 2026-11-12).
 */
export class LoginTimeoutError extends Error {
  constructor(lastCheckFailure?: string | null) {
    const failure = lastCheckFailure ? ` Last check failed: ${lastCheckFailure.replace(/[.\s]+$/, "")}.` : "";
    super(`Sign-in wasn't finished within ${LOGIN_TIMEOUT_MS / 60_000} minutes.${failure} Run ddb_login to try again.`);
    this.name = "LoginTimeoutError";
  }
}

/** Every sign-in window was closed (or the browser went away) before sign-in finished. */
export class LoginWindowClosedError extends Error {
  constructor() {
    super("The sign-in window was closed before sign-in finished.");
    this.name = "LoginWindowClosedError";
  }
}

/** The MCP client cancelled the ddb_login request. */
export class LoginCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled by the client.");
    this.name = "LoginCancelledError";
  }
}

export interface LoginOptions {
  /** The request's cancel signal: aborting it stops the login at once, writing nothing. */
  signal?: AbortSignal;
}

/** Playwright's errors for an operation on a closed page, context or browser. */
function isClosedError(e: unknown): boolean {
  return e instanceof Error
    && /Target page, context or browser has been closed|Target closed|Browser has been closed|browser has disconnected/i.test(e.message);
}

/**
 * Watches what can end a login early: the user closing the last sign-in window,
 * the context closing, the browser disconnecting, and the client's cancel.
 * Every wait in login() is raced against it, so any of these ends the login at
 * once instead of polling on until the deadline.
 */
class LoginWatch {
  private stopReason: Error | null = null;
  private rejectStop!: (e: Error) => void;
  private readonly stopped: Promise<never>;
  private readonly cleanups: Array<() => void> = [];
  private readonly openPages = new Set<Page>();

  constructor(context: BrowserContext, signal?: AbortSignal) {
    this.stopped = new Promise<never>((_resolve, reject) => { this.rejectStop = reject; });
    this.stopped.catch(() => { /* observed through race() */ });

    const onClosed = () => this.stop(new LoginWindowClosedError());
    context.on("close", onClosed);
    this.cleanups.push(() => { context.off("close", onClosed); });
    const browser = context.browser();
    if (browser) {
      browser.on("disconnected", onClosed);
      this.cleanups.push(() => { browser.off("disconnected", onClosed); });
    }
    // Popups (Google sign-in) are pages of the same context: track them too.
    const onPage = (page: Page) => this.track(page);
    context.on("page", onPage);
    this.cleanups.push(() => { context.off("page", onPage); });
    for (const page of context.pages()) this.track(page);

    if (signal) {
      if (signal.aborted) {
        this.stop(new LoginCancelledError());
      } else {
        const onAbort = () => this.stop(new LoginCancelledError());
        signal.addEventListener("abort", onAbort, { once: true });
        this.cleanups.push(() => signal.removeEventListener("abort", onAbort));
      }
    }
  }

  /** Count `page` as an open sign-in window; closing the last one ends the login. */
  track(page: Page): void {
    if (this.openPages.has(page) || page.isClosed()) return;
    this.openPages.add(page);
    const onClose = () => {
      this.openPages.delete(page);
      if (this.openPages.size === 0) this.stop(new LoginWindowClosedError());
    };
    page.on("close", onClose);
    this.cleanups.push(() => { page.off("close", onClose); });
  }

  get reason(): Error | null {
    return this.stopReason;
  }

  /** `op`, unless the login is stopped first. */
  race<T>(op: Promise<T>): Promise<T> {
    if (this.stopReason) {
      op.catch(() => { /* superseded by the stop */ });
      return Promise.reject(this.stopReason);
    }
    return Promise.race([op, this.stopped]);
  }

  sleep(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
    this.cleanups.push(() => clearTimeout(timer));
    return this.race(done);
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  private stop(reason: Error): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.rejectStop(reason);
  }
}

/**
 * Sign in to D&D Beyond in the login context's visible window.
 *
 * Signed in is decided by D&D Beyond, never by the page: every ~2 s the
 * context's own cookies are offered to the cobalt-token exchange, and only a
 * token that decodes (as for every other tool) counts. The session is saved
 * only with that proof. The whole login, the first check included, is bounded
 * by LOGIN_TIMEOUT_MS; closing the last window or cancelling the request ends
 * it at once, with nothing written.
 */
export async function login(context: BrowserContext, options: LoginOptions = {}): Promise<string> {
  const { signal } = options;
  const watch = new LoginWatch(context, signal);
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  // The safe first line of the most recent check's error; null once a check
  // gets an answer. Never the raw message: Playwright's call log in it lists
  // the request's cookie header.
  let lastCheckFailure: string | null = null;
  let lastLogged: string | null = null;

  /** One sign-in check. A failed request is logged (once per distinct error) and read as "not yet". */
  const checkSignIn = async (): Promise<VerifiedSignIn | null> => {
    try {
      const verified = await verifyLoginContext(context, Math.min(VERIFY_REQUEST_TIMEOUT_MS, deadline - Date.now()));
      lastCheckFailure = null;
      return verified;
    } catch (e) {
      if (isClosedError(e)) throw e;
      lastCheckFailure = safeErrorLine(e);
      if (lastCheckFailure !== lastLogged) {
        lastLogged = lastCheckFailure;
        process.stderr.write(`[ddb-mcp] ddb_login: sign-in check failed, retrying: ${lastCheckFailure}\n`);
      }
      return null;
    }
  };

  try {
    // Already signed in (the context starts from the current saved session)?
    const existing = await watch.race(checkSignIn());
    if (existing) {
      // Not raced: once the storage is read the write is synchronous, and a
      // cancel is checked (through `signal`) just before it.
      await saveVerifiedSession(context, existing, signal);
      return "Already logged in. Session is active.";
    }

    // The window is non-headless, so the user can complete login manually.
    console.error("[ddb-mcp] Opening D&D Beyond login page. Please complete login in the browser window.");
    const page = await watch.race(getPage(context));
    watch.track(page);
    await watch.race(page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }));

    // Whatever the provider (Wizards ID, Google popup, Apple) and whatever URL
    // the window ends on, D&D Beyond's token answer is the only signal.
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new LoginTimeoutError(lastCheckFailure);
      await watch.sleep(Math.min(LOGIN_POLL_INTERVAL_MS, remaining));
      if (Date.now() >= deadline) throw new LoginTimeoutError(lastCheckFailure);
      const verified = await watch.race(checkSignIn());
      if (verified) {
        await saveVerifiedSession(context, verified, signal);
        return "Successfully logged in to D&D Beyond. Session saved to disk.";
      }
    }
  } catch (e) {
    throw explainLoginError(e, watch.reason, signal);
  } finally {
    watch.dispose();
  }
}

/** The error ddb_login reports: one per way a login can end. */
function explainLoginError(e: unknown, stopReason: Error | null, signal?: AbortSignal): unknown {
  if (signal?.aborted) return stopReason instanceof LoginCancelledError ? stopReason : new LoginCancelledError();
  if (e instanceof LoginTimeoutError || e instanceof SessionChangedError) return e;
  if (stopReason) return stopReason;
  if (isClosedError(e)) return new LoginWindowClosedError();
  return e;
}
