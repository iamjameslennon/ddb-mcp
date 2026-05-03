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

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const SESSION_PATH = join(homedir(), ".config", "ddb-mcp", "session.json");

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
 * Load cookies from disk into the in-memory cache (if not already loaded).
 * Throws if the session file does not exist.
 */
function loadSessionCookies(): PlaywrightCookie[] {
  if (cookieCache !== null) return cookieCache;
  if (!existsSync(SESSION_PATH)) {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  const session = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
  cookieCache = session.cookies ?? [];
  return cookieCache!;
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
  // JWT payload is base64url-encoded — decode it to extract the userId claim
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const userId: string =
    payload["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ?? "";
  if (!userId) throw new Error("Could not extract userId from cobalt token");
  const expiresAt: number = payload.exp ?? (now + 3600);
  cobaltTokenCache = { token, userId, expiresAt };
  return { token, userId };
}

/**
 * Make an authenticated fetch request to the DnD Beyond API using cookies
 * from the saved Playwright session — no browser required.
 */
export async function sessionFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const cookieHeader = getCookieHeader(url);

  const resp = await fetch(url, {
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

  return resp;
}
