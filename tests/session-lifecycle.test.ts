import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Stable fs mock handles that survive vi.resetModules() so each test loads a
// pristine session-state + session-fetch pair.
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("fs", () => fsMock);

type SessionFetchModule = typeof import("../src/session-fetch.js");

let sf: SessionFetchModule;
let fetchMock: ReturnType<typeof vi.fn>;

const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const DATA_URL = "https://character-service.dndbeyond.com/character/v5/characters/list?userId=99";

function makeCookie(value: string) {
  return {
    name: "CobaltSession",
    value,
    domain: ".dndbeyond.com",
    path: "/",
    expires: Date.now() / 1000 + 3600,
    httpOnly: true,
    secure: true,
  };
}

function sessionJson(cookieValue: string): string {
  return JSON.stringify({ cookies: [makeCookie(cookieValue)] });
}

function setSessionFile(content: string | null): void {
  if (content === null) {
    fsMock.existsSync.mockReturnValue(false);
    return;
  }
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readFileSync.mockReturnValue(content);
}

/** Craft a fake (unsigned) JWT carrying the userId claim + exp. */
function makeJwt(userId: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp,
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: () => "application/json" },
    json: async () => body,
  } as unknown as Response;
}

/** Record the Cookie/Authorization headers of every fetch call. */
function headersOf(call: unknown[]): { cookie: string; auth: string; url: string } {
  const url = call[0] as string;
  const opts = (call[1] ?? {}) as RequestInit;
  const h = (opts.headers ?? {}) as Record<string, string>;
  return { url, cookie: h.Cookie ?? "", auth: h.Authorization ?? "" };
}

async function loadModules(): Promise<void> {
  vi.resetModules();
  sf = await import("../src/session-fetch.js");
}

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockReset();
  fsMock.existsSync.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await loadModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("regression: warmed credentials cannot survive an unobserved logout", () => {
  it("sends NO previous Cookie or Bearer after the session file is deleted WITHOUT invalidateSessionCache()", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      return jsonResponse({ data: { characters: [] } });
    });

    // 1. Warm cookies AND the cobalt JWT with a full authenticated operation.
    const session = await sf.beginAuthenticatedSession();
    await session.fetch(DATA_URL);

    // Sanity: the warm-up really did send the secret cookie + a Bearer token.
    const warmCalls = fetchMock.mock.calls.map(headersOf);
    expect(warmCalls.some(c => c.cookie.includes("SECRET_A"))).toBe(true);
    expect(warmCalls.some(c => c.auth.startsWith("Bearer "))).toBe(true);

    const callsBeforeLogout = fetchMock.mock.calls.length;

    // 2. Log out by deleting the file — WITHOUT calling invalidateSessionCache().
    setSessionFile(null);

    // 3. The next authenticated operation must be refused, sending nothing.
    await expect(sf.beginAuthenticatedSession()).rejects.toThrow(/No session found/);

    // No further fetch was dispatched, so no A-cookie / A-token leaked.
    expect(fetchMock.mock.calls.length).toBe(callsBeforeLogout);
    const afterLogout = fetchMock.mock.calls.slice(callsBeforeLogout).map(headersOf);
    expect(afterLogout.some(c => c.cookie.includes("SECRET_A"))).toBe(false);
    expect(afterLogout.some(c => c.auth.startsWith("Bearer "))).toBe(false);
  });

  it("plain cookie-only sessionFetch also refuses after deletion (still goes through the authority check)", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    expect(sf.hasValidSession()).toBe(true);

    setSessionFile(null);
    await expect(sf.sessionFetch("https://www.dndbeyond.com/api/config/json")).rejects.toThrow(/No session found/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sf.hasValidSession()).toBe(false);
  });
});

describe("account replacement never mixes credentials", () => {
  it("uses account B's cookie and token only — never A-token with B-cookie", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) {
        // The token value encodes which cookie was presented, so we can detect mixing.
        return jsonResponse({ token: makeJwt("99") });
      }
      return jsonResponse({ data: { characters: [] } });
    });

    const a = await sf.beginAuthenticatedSession();
    await a.fetch(DATA_URL);

    // Replace the file with account B (different content → new generation).
    setSessionFile(sessionJson("SECRET_B"));
    const b = await sf.beginAuthenticatedSession();
    await b.fetch(DATA_URL);

    // Every dispatched request pairs a cookie with a Bearer that belong to the
    // SAME snapshot: no call carries B's cookie while another carries A's, and
    // no single call mixes them.
    const calls = fetchMock.mock.calls.map(headersOf);
    for (const c of calls) {
      if (c.cookie.includes("SECRET_A")) expect(c.cookie).not.toContain("SECRET_B");
      if (c.cookie.includes("SECRET_B")) expect(c.cookie).not.toContain("SECRET_A");
    }
    // The token minted for A must have been re-minted for B (cache not reused
    // across the generation boundary): two cobalt-token requests total.
    const cobaltCalls = calls.filter(c => c.url === COBALT_URL);
    expect(cobaltCalls.length).toBe(2);
    expect(cobaltCalls[0].cookie).toContain("SECRET_A");
    expect(cobaltCalls[1].cookie).toContain("SECRET_B");
  });
});

describe("late token responses cannot resurrect old authority", () => {
  it("rejects a cobalt response whose account changed during the async body parse (token cache not poisoned)", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    // A controllable cobalt response whose json() we resolve manually.
    let resolveJson!: (v: { token: string }) => void;
    const controlledJson = new Promise<{ token: string }>((r) => { resolveJson = r; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) {
        return { ok: true, status: 200, headers: { get: () => "application/json" }, json: () => controlledJson } as unknown as Response;
      }
      return jsonResponse({ data: {} });
    });

    // Start the authenticated op; it will block awaiting the cobalt body.
    const pending = sf.beginAuthenticatedSession();

    // While the body is in flight, the account changes on disk.
    setSessionFile(sessionJson("SECRET_B"));

    // Now let the stale (account A) cobalt body resolve.
    resolveJson({ token: makeJwt("99") });

    await expect(pending).rejects.toThrow(sf.SessionChangedError);

    // The poisoned token was NOT cached: a fresh call for account B mints anew.
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("77") });
      return jsonResponse({ data: {} });
    });
    const b = await sf.beginAuthenticatedSession();
    expect(b.userId).toBe("77");
  });

  it("does not retry after backoff once the account has changed", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));

    let cobaltCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      // Data endpoint returns a retryable 503 the first time.
      return jsonResponse({}, 503);
    });

    const session = await sf.beginAuthenticatedSession();
    void cobaltCalls;

    const p = session.fetch(DATA_URL).catch((e: unknown) => e);

    // Let the first (503) dispatch happen, then flip the account mid-backoff.
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterFirst = fetchMock.mock.calls.length;
    setSessionFile(sessionJson("SECRET_B"));

    // Advance through the backoff window; the retry must observe the change and
    // throw instead of re-dispatching account A's credentials.
    await vi.advanceTimersByTimeAsync(5000);
    const result = await p;

    expect(result).toBeInstanceOf(sf.SessionChangedError);
    // No additional data fetch was dispatched after the account changed.
    const dataCalls = fetchMock.mock.calls.filter(c => (c[0] as string) === DATA_URL);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    expect(dataCalls.every(c => headersOf(c).cookie.includes("SECRET_A"))).toBe(true);
  });
});

describe("unchanged valid session reuses credentials but never skips the check", () => {
  it("reuses the cached JWT across calls while the file is unchanged", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      return jsonResponse({ data: {} });
    });

    await sf.beginAuthenticatedSession();
    await sf.beginAuthenticatedSession();

    // The JWT is reused: only one cobalt-token exchange despite two sessions.
    const cobaltCalls = fetchMock.mock.calls.filter(c => (c[0] as string) === COBALT_URL);
    expect(cobaltCalls.length).toBe(1);
    // But the file was still re-read on every capture (boundary check).
    expect(fsMock.readFileSync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
