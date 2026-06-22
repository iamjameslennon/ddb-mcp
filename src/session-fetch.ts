/**
 * session-fetch.ts
 *
 * Reads the Playwright-saved session cookies from disk and injects them into
 * native Node fetch calls, so API requests can be made without launching a
 * browser at all.
 *
 * The session is created once by `ddb_login` (which still needs a browser for
 * the OAuth flow) and then reused for all subsequent API calls.
 */

import { readFileSync, existsSync, chmodSync } from "fs";
import { isAbsolute, join } from "path";
import { homedir } from "os";

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

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // Unix timestamp, -1 means session cookie
  httpOnly: boolean;
  secure: boolean;
}

// ── In-memory caches ──────────────────────────────────────────────────────────
// Module-level singleton state — intentional for a single-user MCP server.
// A new process gets a fresh cache; invalidateSessionCache() resets between logins.
// Session cookies are loaded once from disk and cached for the process lifetime.
// The cache is invalidated by invalidateSessionCache() which is called by
// saveSession() in browser.ts whenever a new session file is written.
let cookieCache: PlaywrightCookie[] | null = null;

// Cobalt JWT — short-lived but reusable across requests until near-expiry.
let cobaltTokenCache: { token: string; userId: string; expiresAt: number } | null = null;

/**
 * Invalidate all in-memory caches. Must be called whenever the session file
 * is overwritten (i.e. after a successful login / saveSession call).
 */
export function invalidateSessionCache(): void {
  cookieCache = null;
  cobaltTokenCache = null;
}

/**
 * Best-effort permission hardening for installs that pre-date the 0700/0600
 * defaults: mkdirSync's `mode` and open()'s create-mode only apply when the
 * directory/file is first created, so a session dir created by an old release
 * keeps its original (typically 0755) mode forever. POSIX only — Windows
 * relies on %APPDATA% ACL inheritance instead of POSIX modes.
 */
export function tightenSessionPermissions(): void {
  if (process.platform === "win32") return;
  // Each chmod is independently best-effort — a failure (ENOENT before first
  // login, EPERM on an unusual setup) must never break session access.
  try { chmodSync(SESSION_DIR, 0o700); } catch { /* best-effort */ }
  try { chmodSync(SESSION_PATH, 0o600); } catch { /* best-effort */ }
}

/**
 * Load cookies from disk into the in-memory cache (if not already loaded).
 * Throws if the session file does not exist.
 */
function loadSessionCookies(): PlaywrightCookie[] {
  if (cookieCache !== null) return cookieCache;
  if (!existsSync(SESSION_PATH)) {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  // Runs at most once per process (the cookie cache short-circuits above) —
  // converges legacy installs to 0700/0600 on first credential access.
  tightenSessionPermissions();
  const session = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
  const loaded = session.cookies ?? [];
  cookieCache = loaded;
  return loaded;
}

/**
 * Build the Cookie header for a given URL from the cached session cookies,
 * filtering to non-expired cookies that apply to the URL's hostname.
 */
function getCookieHeader(url: string): string {
  const cookies = loadSessionCookies(); // throws if no session file
  const now = Date.now() / 1000;
  const { hostname } = new URL(url);

  const relevant = cookies.filter((c) => {
    // Playwright stores domain with leading dot for subdomain-wildcard cookies
    const domain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const domainMatches = hostname === domain || hostname.endsWith("." + domain);
    const notExpired = c.expires < 0 || c.expires > now;
    // Only forward cookies the server marked secure — we always use HTTPS.
    return domainMatches && notExpired && c.secure;
  });

  return relevant.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Check whether we have a valid (non-expired) session on disk.
 */
export function hasValidSession(): boolean {
  if (!existsSync(SESSION_PATH)) return false;
  try {
    const cookies = loadSessionCookies();
    const now = Date.now() / 1000;
    // Consider valid if at least one non-session, non-expired DnD Beyond cookie exists
    return cookies.some(
      (c) =>
        c.domain.includes("dndbeyond.com") &&
        c.expires > now &&
        c.secure
    );
  } catch {
    return false;
  }
}

/**
 * Exchange session cookies for a short-lived cobalt JWT and return its decoded
 * payload. The token contains the userId needed for character/campaign list APIs.
 * The result is cached until 60 s before the token's exp claim.
 */
export async function getCobaltToken(): Promise<{ token: string; userId: string }> {
  const now = Date.now() / 1000;
  if (cobaltTokenCache && cobaltTokenCache.expiresAt > now + 60) {
    return { token: cobaltTokenCache.token, userId: cobaltTokenCache.userId };
  }

  const resp = await sessionFetch("https://auth-service.dndbeyond.com/v1/cobalt-token", {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`cobalt-token request failed: ${resp.status}`);
  const { token } = await resp.json() as { token: string };
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
  cobaltTokenCache = { token, userId, expiresAt };
  return { token, userId };
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const NON_RETRYABLE_STATUS_CODES = new Set([401, 403, 404]);

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
 * Make an authenticated fetch request to the DnD Beyond API using cookies
 * from the saved Playwright session — no browser required.
 */
export async function sessionFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const cookieHeader = getCookieHeader(url);

  return fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...options.headers,
      // Cookie must come last so callers can't accidentally override it
      Cookie: cookieHeader,
    },
  });
}
