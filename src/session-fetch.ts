/**
 * session-fetch.ts
 *
 * Reads the Playwright-saved session cookies from disk and injects them into
 * native Node fetch calls, so API requests can be made without launching a
 * browser at all.
 *
 * The session is created once by `ddb_login` (which still needs a browser for
 * the OAuth flow) and then reused for all subsequent API calls.
 *
 * Authority & revocation
 * ----------------------
 * The lifecycle owner is `session-state.ts`. This module never trusts a cached
 * cookie set or JWT on its own: every credential access (cookie header build,
 * cobalt-token lookup, authenticated fetch) is bound to a `SessionSnapshot`
 * captured from `session-state`, and re-checks the on-disk authority before
 * dispatch, before writing the token cache, and before handing a response back.
 * A deleted / replaced / corrupted session file therefore stops the old
 * account's credentials at the next protected operation — no explicit
 * invalidation call required.
 */

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  SESSION_PATH,
  captureSession,
  assertSessionCurrent,
  invalidateSessionState,
  onSessionInvalidated,
  clearRevoked,
  type SessionSnapshot,
  type PlaywrightCookie,
} from "./session-state.js";

// Re-export the session-file location + permission helper + typed error so
// existing importers (browser.ts, tools, tests) keep working unchanged. The
// lifecycle primitives (onSessionInvalidated / captureSession /
// assertSessionCurrent) are re-exported too so consumer + browser modules bind
// their account-derived state to a generation through this single import
// surface rather than reaching into session-state directly.
export {
  SESSION_DIR,
  SESSION_PATH,
  tightenSessionPermissions,
  SessionChangedError,
  onSessionInvalidated,
  captureSession,
  assertSessionCurrent,
  type SessionSnapshot,
} from "./session-state.js";

// One-time Windows migration notice. Releases up to v2.6.4 wrote the session
// to ~/.config/ddb-mcp/session.json on every platform; from v2.6.5 Windows
// uses %APPDATA%. Surface a warning so a Windows user upgrading isn't left
// silently logged-out with an orphan credential file on disk.
if (process.platform === "win32") {
  try {
    const legacyPath = join(homedir(), ".config", "ddb-mcp", "session.json");
    if (existsSync(legacyPath) && !existsSync(SESSION_PATH)) {
      process.stderr.write(
        `[ddb-mcp] Legacy session detected at ${legacyPath}. The session file ` +
        `now lives at ${SESSION_PATH}. Re-run ddb_login to authenticate at the ` +
        `new location, then delete the legacy file.\n`
      );
    }
  } catch {
    // Best-effort notice — never let migration probing break startup.
  }
}

// ── In-memory token cache ─────────────────────────────────────────────────────
// Module-level singleton state — intentional for a single-user MCP server.
// The cobalt JWT is short-lived but reusable across requests until near-expiry.
// It is stamped with the generation it was minted under so it can never be
// reused after a session transition, and it is cleared by the invalidation hook
// below on every lifecycle invalidation.
let cobaltTokenCache:
  | { token: string; userId: string; expiresAt: number; generation: number }
  | null = null;

// Detach our cached credentials on every session invalidation (transition,
// login, or revoke). Registered once per module lifetime.
onSessionInvalidated(() => {
  cobaltTokenCache = null;
});

/**
 * Invalidate all in-memory caches. Called on login (saveSession in browser.ts)
 * whenever a new session file is written. Delegates to the lifecycle owner so
 * every consumer's invalidation hook fires and the generation advances.
 */
export function invalidateSessionCache(): void {
  cobaltTokenCache = null;
  clearRevoked();            // a fresh login lifts any prior revoke block
  invalidateSessionState();  // advance generation + notify all hooks
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Build the Cookie header for a given URL from a snapshot's cookies, filtering
 * to non-expired, secure cookies that apply to the URL's hostname.
 */
function buildCookieHeader(cookies: readonly PlaywrightCookie[], url: string): string {
  const now = Date.now() / 1000;
  const { hostname } = new URL(url);

  const relevant = cookies.filter((c) => {
    // Playwright stores domain with leading dot for subdomain-wildcard cookies.
    const domain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const domainMatches = hostname === domain || hostname.endsWith("." + domain);
    const notExpired = c.expires < 0 || c.expires > now;
    // Only forward cookies the server marked secure — we always use HTTPS.
    return domainMatches && notExpired && c.secure;
  });

  return relevant.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Check whether we have a valid (non-expired) session on disk. Re-reads the
 * current authority each call (via captureSession) so a logout/deletion is
 * observed immediately.
 */
export function hasValidSession(): boolean {
  const snapshot = captureSession();
  if (snapshot.state.kind !== "authenticated") return false;
  const now = Date.now() / 1000;
  // Consider valid if at least one non-session, non-expired DnD Beyond cookie exists.
  return snapshot.state.cookies.some(
    (c) => c.domain.includes("dndbeyond.com") && c.expires > now && c.secure
  );
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const NON_RETRYABLE_STATUS_CODES = new Set([401, 403, 404]);

/** Merge the lifecycle abort signal with any caller-supplied signal. */
function mergeSignals(lifecycle: AbortSignal, caller?: AbortSignal | null): AbortSignal {
  if (!caller) return lifecycle;
  return AbortSignal.any([lifecycle, caller]);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  snapshot: SessionSnapshot,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Authority check immediately before every dispatch — including the retry
    // after a backoff sleep, so a mid-flight account change can't be replayed.
    assertSessionCurrent(snapshot);

    const resp = await fetch(url, options);

    if (resp.ok || NON_RETRYABLE_STATUS_CODES.has(resp.status)) {
      return resp;
    }

    if (RETRYABLE_STATUS_CODES.has(resp.status)) {
      if (attempt === maxRetries) return resp;
      const delay = baseDelayMs * Math.pow(2, attempt);
      process.stderr.write(`[ddb-mcp] ${resp.status} from ${url} — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})\n`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    return resp;
  }
  throw new Error("Unreachable");
}

/**
 * The single snapshot-bound fetch primitive. Builds the Cookie header (and an
 * optional Bearer header) from ONE snapshot, checks authority immediately
 * before dispatch, re-checks before each retry, and re-checks again before
 * returning the response — so a response fetched with account A's credentials
 * is never handed back into account B's generation.
 */
async function snapshotFetch(
  snapshot: SessionSnapshot,
  url: string,
  options: RequestInit,
  bearer?: string
): Promise<Response> {
  if (snapshot.state.kind !== "authenticated") {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  const cookieHeader = buildCookieHeader(snapshot.state.cookies, url);
  const signal = mergeSignals(snapshot.signal, options.signal ?? null);

  const resp = await fetchWithRetry(
    url,
    {
      ...options,
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...options.headers,
        // Bearer (if any) and Cookie come last so callers can't override them.
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        Cookie: cookieHeader,
      },
    },
    snapshot
  );

  // Final authority check before publishing the result into the caller's flow.
  assertSessionCurrent(snapshot);
  return resp;
}

/**
 * Exchange a snapshot's cookies for a short-lived cobalt JWT. The token is
 * cached until 60 s before its exp claim AND stamped with the generation it was
 * minted under. A late response from an obsolete snapshot is rejected AFTER the
 * async body parse and BEFORE the cache write, so it can never resurrect old
 * authority.
 */
async function getCobaltTokenForSnapshot(
  snapshot: SessionSnapshot
): Promise<{ token: string; userId: string }> {
  const now = Date.now() / 1000;
  if (
    cobaltTokenCache &&
    cobaltTokenCache.generation === snapshot.generation &&
    cobaltTokenCache.expiresAt > now + 60
  ) {
    // Account-derived cache hit → re-verify current authority before reuse.
    assertSessionCurrent(snapshot);
    return { token: cobaltTokenCache.token, userId: cobaltTokenCache.userId };
  }

  const resp = await snapshotFetch(
    snapshot,
    "https://auth-service.dndbeyond.com/v1/cobalt-token",
    { method: "POST" }
  );
  if (!resp.ok) throw new Error(`cobalt-token request failed: ${resp.status}`);
  const { token } = (await resp.json()) as { token: string };

  // The response body parse is async: an account change could have landed
  // while it was in flight. Reject BEFORE decoding/caching so a stale token is
  // never written into the (new) generation's cache.
  assertSessionCurrent(snapshot);

  // JWT payload is base64url-encoded — decode it to extract the userId claim.
  // We deliberately don't verify the JWT signature: the token came from
  // auth-service.dndbeyond.com over HTTPS (the only trust anchor we have for
  // this server), and we only consume it by passing it straight back to DDB
  // APIs — DDB verifies the signature server-side. We're using the payload
  // purely to read our own userId for subsequent API calls.
  const parts = token.split(".");
  if (parts.length < 3) throw new Error("cobalt-token response is not a valid JWT");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (e) {
    throw new Error("Failed to decode cobalt token payload: " + (e instanceof Error ? e.message : String(e)));
  }
  const userId: string =
    payload["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ?? "";
  if (!userId) throw new Error("Could not extract userId from cobalt token");
  const expiresAt: number = payload.exp ?? (now + 3600);

  // Re-check once more immediately before the cache write (the decode above is
  // synchronous, but keep the invariant explicit and cheap).
  assertSessionCurrent(snapshot);
  cobaltTokenCache = { token, userId, expiresAt, generation: snapshot.generation };
  return { token, userId };
}

/**
 * An authenticated session bound to a single captured snapshot. `userId` and
 * `token` come from that snapshot's account; `fetch` dispatches Bearer+cookie
 * requests bound to the same snapshot. The account-ID lookup and the request(s)
 * therefore always share one authority.
 */
export interface AuthenticatedSession {
  readonly token: string;
  readonly userId: string;
  readonly generation: number;
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

/**
 * The single authenticated-fetch entry point. Captures ONE session, obtains its
 * JWT + account id from that same snapshot, and returns a `fetch` bound to it.
 * Throws if there is no valid session. Throws `SessionChangedError` (via the
 * bound fetch / token lookup) if the session changes mid-operation — never
 * silently replays with another account's credentials.
 */
export async function beginAuthenticatedSession(): Promise<AuthenticatedSession> {
  const snapshot = captureSession();
  if (snapshot.state.kind !== "authenticated") {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  const { token, userId } = await getCobaltTokenForSnapshot(snapshot);
  return {
    token,
    userId,
    generation: snapshot.generation,
    fetch: (url: string, options: RequestInit = {}) => snapshotFetch(snapshot, url, options, token),
  };
}

/**
 * Backwards-compatible standalone cobalt-token accessor. Captures a fresh
 * snapshot each call. Prefer `beginAuthenticatedSession()` where the token and
 * the subsequent request must share one snapshot.
 */
export async function getCobaltToken(): Promise<{ token: string; userId: string }> {
  const snapshot = captureSession();
  if (snapshot.state.kind !== "authenticated") {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  return getCobaltTokenForSnapshot(snapshot);
}

/**
 * Plain cookie-only authenticated fetch (no Bearer token) — for endpoints that
 * only need session cookies (game config, library pages, public character JSON
 * for the logged-in owner). Still goes through the authority check: it captures
 * a fresh snapshot, refuses when anonymous, and binds the request to it.
 */
export async function sessionFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const snapshot = captureSession();
  if (snapshot.state.kind !== "authenticated") {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  return snapshotFetch(snapshot, url, options);
}
