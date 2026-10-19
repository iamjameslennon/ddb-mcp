/**
 * session-state.ts — the revocable session lifecycle owner.
 *
 * This module sits BELOW the tool modules and below session-fetch: it owns the
 * one authoritative answer to "which account are we, right now?" and never
 * imports a tool module (import-cycle guard).
 *
 * The security property it exists to enforce: when the on-disk session file is
 * deleted, replaced, or corrupted, the credentials a long-running process has
 * already cached in memory (cookies + cobalt JWT) MUST stop being used at the
 * very next protected operation — even if nobody explicitly called an
 * invalidation function. The disk file is the local authority; the boundary
 * check (re-reading and comparing the file's CONTENT) is the correctness
 * mechanism, not a file watcher and not mtime/size.
 *
 * Model
 * -----
 * - A "generation" is an opaque monotonically-increasing identity token. Two
 *   snapshots share a generation iff they describe the same on-disk authority.
 * - `captureSession()` re-reads the file and returns an immutable snapshot
 *   (authenticated cookies OR anonymous) plus the current generation and an
 *   abort signal that fires when that generation dies.
 * - Any observed change (deletion, unreadability, malformed JSON, or DIFFERENT
 *   content) advances the generation, aborts in-flight work, detaches cached
 *   state, and notifies registered consumers so they can clear their caches.
 * - `assertSessionCurrent(snapshot)` re-reads the file and throws
 *   `SessionChangedError` if the snapshot's generation is no longer current.
 */

import {
  readFileSync, existsSync, chmodSync, rmSync,
  openSync, closeSync, writeFileSync, fchmodSync, renameSync, constants,
} from "fs";
import { isAbsolute, join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

// ── Session-file location (moved here so the lifecycle owner sits at the
// bottom of the dependency graph; session-fetch re-exports these for
// import-compatibility with existing importers e.g. browser.ts). ─────────────

function resolveSessionDir(): string {
  if (process.platform === "win32") {
    // Follow Windows convention (%APPDATA% → ~/AppData/Roaming) instead of
    // dropping a Unix-style ".config" directory in the user's profile. Use
    // `||` (not `??`) so an empty-string APPDATA still falls through to the
    // homedir() default rather than producing a CWD-relative path.
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "ddb-mcp");
  }
  return join(homedir(), ".config", "ddb-mcp");
}

function assertAbsoluteSessionDir(dir: string): string {
  // Refuse to operate on a relative path — that would land the session file
  // (containing DDB auth cookies) somewhere unexpected, e.g. the process CWD
  // if APPDATA is empty/unset on a stripped-down Windows account.
  if (!isAbsolute(dir)) {
    throw new Error(
      `ddb-mcp: refusing to use non-absolute session directory '${dir}'. ` +
      `Check that APPDATA is set to an absolute path.`
    );
  }
  return dir;
}

export const SESSION_DIR = assertAbsoluteSessionDir(resolveSessionDir());
export const SESSION_PATH = join(SESSION_DIR, "session.json");

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // Unix timestamp, -1 means session cookie
  httpOnly: boolean;
  secure: boolean;
}

/**
 * A host is D&D Beyond when it is `dndbeyond.com` or a subdomain of it.
 * A leading dot (Playwright's wildcard cookie domain) is ignored. Lookalike
 * hosts (`notdndbeyond.com`, `dndbeyond.com.evil.example`) are rejected.
 */
export function isDndBeyondHost(host: string): boolean {
  let normalized = host.trim().toLowerCase();
  while (normalized.startsWith(".")) normalized = normalized.slice(1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return /^(?:[a-z0-9-]+\.)*dndbeyond\.com$/.test(normalized);
}

function cookieDomain(cookie: unknown): string | null {
  if (!cookie || typeof cookie !== "object") return null;
  const domain = (cookie as { domain?: unknown }).domain;
  return typeof domain === "string" ? domain : null;
}

function originHostname(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const origin = (entry as { origin?: unknown }).origin;
  if (typeof origin !== "string" || origin.length === 0) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

export interface SanitizedSessionStorage {
  /** Persistable storage state. Non-D&D Beyond cookies and origins are gone. */
  storage: Record<string, unknown>;
  cookies: PlaywrightCookie[];
  /** True when the input held credentials or storage this process must not keep. */
  changed: boolean;
}

/**
 * Keep only D&D Beyond cookies and origin storage (localStorage for
 * `*.dndbeyond.com`). A Wizards ID login via Google or Apple otherwise
 * leaves that provider's session cookies in the Playwright storage state.
 */
export function sanitizeSessionStorage(parsed: unknown): SanitizedSessionStorage {
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};

  const cookiesMalformed = "cookies" in source && !Array.isArray(source.cookies);
  const rawCookies = Array.isArray(source.cookies) ? source.cookies : [];
  const cookies = rawCookies.filter((cookie): cookie is PlaywrightCookie => {
    const domain = cookieDomain(cookie);
    return domain !== null && isDndBeyondHost(domain);
  });

  const originsMalformed = "origins" in source && !Array.isArray(source.origins);
  const rawOrigins = Array.isArray(source.origins) ? source.origins : [];
  const origins = rawOrigins.filter((entry) => {
    const host = originHostname(entry);
    return host !== null && isDndBeyondHost(host);
  });

  const changed = cookiesMalformed || originsMalformed
    || cookies.length !== rawCookies.length
    || (Array.isArray(source.origins) && origins.length !== rawOrigins.length);

  const storage: Record<string, unknown> = { ...source, cookies };
  if (Array.isArray(source.origins) || originsMalformed) storage.origins = origins;
  return { storage, cookies, changed };
}

/**
 * Atomically replace the session file. POSIX creates the temp file 0600
 * (O_NOFOLLOW, no umask window); Windows relies on the user-profile ACL.
 * Callers create the parent directory first.
 */
export function writeSessionFile(json: string): void {
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
}

// ── Typed cancellation ────────────────────────────────────────────────────────

/**
 * Thrown when an operation's captured session snapshot is no longer the
 * current authority — the session file was deleted, replaced, or corrupted
 * mid-flight. Callers must treat this as "do not retry with these
 * credentials", never silently replay with whatever the new account is.
 */
export class SessionChangedError extends Error {
  constructor(message = "Session changed; the previous credentials were revoked.") {
    super(message);
    this.name = "SessionChangedError";
  }
}

// ── Snapshot shape ──────────────────────────────────────────────────────────

interface AuthenticatedState {
  readonly kind: "authenticated";
  readonly cookies: readonly PlaywrightCookie[];
}
interface AnonymousState {
  readonly kind: "anonymous";
  /** "missing" | "unreadable" | "malformed" | "revoked" */
  readonly reason: string;
}
export type SessionState = AuthenticatedState | AnonymousState;

export interface SessionSnapshot {
  readonly generation: number;
  readonly state: SessionState;
  /** Aborts (with a SessionChangedError reason) when this generation dies. */
  readonly signal: AbortSignal;
}

// ── Module-lifetime state (intentional singletons for a single-user server) ──

let currentGeneration = 1;
let currentController = new AbortController();

// Comparison material: a hash of the authority bytes. After a scrub that
// removes third-party cookies, this is the cleaned file, not the pre-scrub
// bytes. Kept as a hash so we never store a second plaintext copy.
let lastContentKey: string | null = null;
let lastState: SessionState | null = null;
// Set when a read found third-party credentials but the rewrite failed. The
// next read of those same bytes retries the scrub instead of treating the
// file as a stable authority we can skip parsing.
let unscrubbedKey: string | null = null;

let permissionsTightened = false;
// Set by revokeSession(); blocks new authenticated operations until a fresh
// login clears it (via invalidateSessionCache → clearRevoked).
let revoked = false;

const ANON_KEY = "anon";

/** Callbacks run on every session invalidation (detach state / clear caches). */
export type SessionInvalidatedCallback = () => void | Promise<void>;
const invalidationHooks = new Set<SessionInvalidatedCallback>();

// ── POSIX permission hardening (moved from session-fetch) ────────────────────

/**
 * Best-effort permission hardening for installs that pre-date the 0700/0600
 * defaults. POSIX only — Windows relies on %APPDATA% ACL inheritance.
 */
export function tightenSessionPermissions(): void {
  if (process.platform === "win32") return;
  try { chmodSync(SESSION_DIR, 0o700); } catch { /* best-effort */ }
  try { chmodSync(SESSION_PATH, 0o600); } catch { /* best-effort */ }
}

// ── Authority reading ────────────────────────────────────────────────────────

/**
 * Read the current on-disk authority and derive the session state, reusing the
 * previously-parsed cookies when the file content is byte-for-byte unchanged.
 * This is the boundary check: it runs on EVERY capture / assert, so a deletion
 * or replacement is observed immediately.
 */
function contentKey(content: string | null): string {
  return content == null ? ANON_KEY : "auth:" + createHash("sha256").update(content).digest("hex");
}

function refreshAuthority(): SessionState {
  if (revoked) {
    // A revoke is in progress or in effect: refuse to hand back authority even
    // if the file still momentarily exists (async cleanup window).
    return { kind: "anonymous", reason: "revoked" };
  }

  // Read the raw content. Distinguish missing (no file) from unreadable (I/O
  // error) — both are anonymous, but we still want an equal key so repeated
  // reads in the same anonymous condition don't churn the generation.
  let content: string | null;
  let readable = true;
  try {
    content = existsSync(SESSION_PATH) ? readFileSync(SESSION_PATH, "utf8") : null;
  } catch {
    content = null;
    readable = false;
  }

  const rawKey = contentKey(content);
  const sameBytes = lastContentKey !== null && rawKey === lastContentKey;
  const retryingScrub = unscrubbedKey !== null && rawKey === unscrubbedKey;

  // Unchanged content → reuse the parsed state (skip JSON.parse), but we DID
  // re-read the file, which is the whole point of the boundary check. A file
  // we couldn't scrub is not stable: retry the rewrite before trusting it.
  if (sameBytes && lastState !== null && !retryingScrub) {
    return lastState;
  }

  // The authority changed (or this is the first observation). If we previously
  // held a state, this transition kills the old generation: abort in-flight
  // work, detach caches, notify consumers. A scrub retry of the same bytes
  // is not a new account.
  if (lastContentKey !== null && !sameBytes && !retryingScrub) {
    invalidateSessionState();
  }

  let state: SessionState;
  let key = rawKey;
  let nextUnscrubbed: string | null = null;
  if (content == null) {
    state = { kind: "anonymous", reason: readable ? "missing" : "unreadable" };
  } else {
    try {
      const sanitized = sanitizeSessionStorage(JSON.parse(content) as unknown);
      if (sanitized.changed) {
        const cleaned = JSON.stringify(sanitized.storage);
        try {
          // Drop third-party cookies from disk as well as from memory. Key the
          // bytes we wrote so the next read of the cleaned file is the same
          // generation, not an account change.
          writeSessionFile(cleaned);
          key = contentKey(cleaned);
        } catch {
          // The file still holds the extra credentials. Don't cache that as a
          // clean authority — the next read of these same bytes tries again.
          key = rawKey;
          nextUnscrubbed = rawKey;
        }
      }
      state = { kind: "authenticated", cookies: Object.freeze(sanitized.cookies.slice()) };
    } catch {
      state = { kind: "anonymous", reason: "malformed" };
    }
  }

  if (state.kind === "authenticated" && !permissionsTightened) {
    // Converge legacy installs to 0700/0600 on first credential access.
    tightenSessionPermissions();
    permissionsTightened = true;
  }

  lastContentKey = key;
  unscrubbedKey = nextUnscrubbed;
  lastState = state;
  return state;
}

// ── Public lifecycle API ─────────────────────────────────────────────────────

/**
 * Refresh file authority and return an immutable validated snapshot (or
 * anonymous state), an opaque generation token, and an abort signal.
 */
export function captureSession(): SessionSnapshot {
  const state = refreshAuthority();
  return Object.freeze({
    generation: currentGeneration,
    state,
    signal: currentController.signal,
  });
}

/**
 * Refresh authority and throw SessionChangedError if `snapshot` is obsolete.
 * Call this before dispatching a request, after parsing an async body and
 * before writing to any account-derived cache, and before retries after
 * backoff.
 */
export function assertSessionCurrent(snapshot: SessionSnapshot): void {
  refreshAuthority();
  if (revoked || snapshot.generation !== currentGeneration) {
    throw new SessionChangedError();
  }
}

/**
 * Register a callback that runs on every session invalidation. The callback
 * should synchronously detach/clear in-memory state; if it returns a promise,
 * that promise is treated as tracked asynchronous cleanup and awaited by
 * revokeSession(). Returns an unsubscribe function.
 *
 * Register hooks once per module lifetime.
 */
export function onSessionInvalidated(callback: SessionInvalidatedCallback): () => void {
  invalidationHooks.add(callback);
  return () => { invalidationHooks.delete(callback); };
}

interface InvalidationOutcome {
  cleanups: Promise<void>[];
  syncErrors: unknown[];
}

/** Run all registered hooks, separating sync detachment from async cleanup. */
function fireInvalidationHooks(): InvalidationOutcome {
  const cleanups: Promise<void>[] = [];
  const syncErrors: unknown[] = [];
  for (const cb of [...invalidationHooks]) {
    try {
      const result = cb();
      if (result && typeof (result as PromiseLike<void>).then === "function") {
        cleanups.push(Promise.resolve(result));
      }
    } catch (e) {
      syncErrors.push(e);
    }
  }
  return { cleanups, syncErrors };
}

/** Advance the generation, abort in-flight work, and detach cached state. */
function bumpGeneration(): void {
  currentGeneration += 1;
  const old = currentController;
  currentController = new AbortController();
  lastContentKey = null;
  lastState = null;
  unscrubbedKey = null;
  permissionsTightened = false;
  try {
    old.abort(new SessionChangedError());
  } catch {
    // AbortController.abort never throws in practice; guard defensively.
  }
}

/**
 * Advance generation, abort old work, detach old state, and notify consumers.
 * Fire-and-forget: any asynchronous cleanup a hook returns is tracked so it
 * can't dangle as an unhandled rejection, but is not awaited here.
 */
export function invalidateSessionState(): void {
  bumpGeneration();
  const { cleanups } = fireInvalidationHooks();
  for (const p of cleanups) p.catch(() => { /* swallowed; revoke() awaits explicitly */ });
}

/**
 * Full revocation: block new authenticated operations, invalidate in-memory
 * authority, remove the saved session file, await any registered asynchronous
 * cleanup (e.g. the browser-close hook registered by a later task), then report
 * completion — or throw with the specific cleanup error(s).
 */
export async function revokeSession(): Promise<void> {
  revoked = true;              // block new authenticated ops immediately
  bumpGeneration();           // abort in-flight, detach memory
  const { cleanups, syncErrors } = fireInvalidationHooks();
  const errors: unknown[] = [...syncErrors];

  // Remove the saved session file. `force` swallows ENOENT (already logged out).
  try {
    rmSync(SESSION_PATH, { force: true });
  } catch (e) {
    errors.push(e);
  }

  // Await tracked async cleanup (browser teardown lands here in a later task).
  const settled = await Promise.allSettled(cleanups);
  for (const s of settled) {
    if (s.status === "rejected") errors.push(s.reason);
  }

  if (errors.length > 0) {
    const detail = errors
      .map(e => (e instanceof Error ? e.message : String(e)))
      .join("; ");
    throw new Error(`Session revocation completed with cleanup errors: ${detail}`, {
      cause: errors[0],
    });
  }
}

/**
 * Clear the revoke block. Called by the login/new-session path
 * (invalidateSessionCache) so authentication works again after a revoke.
 */
export function clearRevoked(): void {
  revoked = false;
}

/**
 * Test-only: fully reset lifecycle singletons to a pristine state WITHOUT
 * clearing module-lifetime invalidation hooks (those are re-established only on
 * module load; hook-specific tests use the unsubscribe function instead).
 */
export function __resetSessionStateForTests(): void {
  currentGeneration = 1;
  currentController = new AbortController();
  lastContentKey = null;
  lastState = null;
  unscrubbedKey = null;
  permissionsTightened = false;
  revoked = false;
}
