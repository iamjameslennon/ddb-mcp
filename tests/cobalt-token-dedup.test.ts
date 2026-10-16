import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * cobalt-token-dedup.test.ts
 *
 * Concurrent cold-cache callers must share ONE in-flight cobalt-token exchange
 * per session generation (a cold spell-compendium build fires 16 parallel
 * requests). Real session-state / session-fetch; only `fs` and global `fetch`
 * are mocked (same approach as session-lifecycle).
 */

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
type SessionStateModule = typeof import("../src/session-state.js");

let sf: SessionFetchModule;
let ss: SessionStateModule;
let fetchMock: ReturnType<typeof vi.fn>;

const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const N = 16;

function sessionJson(cookieValue: string): string {
  return JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: cookieValue, domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 86400, httpOnly: true, secure: true,
    }],
  });
}

function setSessionFile(content: string): void {
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readFileSync.mockReturnValue(content);
}

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

function cobaltCalls(): { cookie: string }[] {
  return fetchMock.mock.calls
    .filter((c) => c[0] === COBALT_URL)
    .map((c) => ({ cookie: ((c[1] as RequestInit).headers as Record<string, string>).Cookie ?? "" }));
}

/**
 * A cobalt endpoint whose responses are released manually, in dispatch order:
 * `release(i, resp)` answers the i-th POST.
 */
function gatedCobalt() {
  const gates: ((r: Response) => void)[] = [];
  const dispatched: Promise<void>[] = [];
  const signals: (() => void)[] = [];
  for (let i = 0; i < 8; i++) dispatched.push(new Promise<void>((r) => { signals.push(r); }));
  let count = 0;
  fetchMock.mockImplementation((url: string) => {
    if (url !== COBALT_URL) return Promise.resolve(jsonResponse({}));
    const i = count++;
    return new Promise<Response>((r) => {
      gates[i] = r;
      signals[i]();
    });
  });
  return {
    dispatched: (i: number) => dispatched[i],
    release: (i: number, resp: Response) => gates[i](resp),
  };
}

/** Settle every promise, recording rejections instead of throwing. */
function settleAll<T>(ps: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(ps);
}

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockReset();
  fsMock.existsSync.mockReset();
  fsMock.rmSync.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  sf = await import("../src/session-fetch.js");
  ss = await import("../src/session-state.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("concurrent cold-cache callers share one cobalt-token exchange", () => {
  it(`${N} concurrent beginAuthenticatedSession() calls send exactly one POST`, async () => {
    setSessionFile(sessionJson("SECRET_A"));
    const jwt = makeJwt("99");
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: jwt });
      return jsonResponse({});
    });

    const sessions = await Promise.all(
      Array.from({ length: N }, () => sf.beginAuthenticatedSession()),
    );

    expect(cobaltCalls()).toHaveLength(1);
    for (const s of sessions) {
      expect(s.token).toBe(jwt);
      expect(s.userId).toBe("99");
    }
    // The shared token is cached afterwards: a later call sends nothing new.
    await sf.beginAuthenticatedSession();
    expect(cobaltCalls()).toHaveLength(1);
  });

  it(`${N} concurrent getCobaltToken() calls send exactly one POST`, async () => {
    setSessionFile(sessionJson("SECRET_A"));
    const jwt = makeJwt("42");
    fetchMock.mockImplementation(async () => jsonResponse({ token: jwt }));

    const results = await Promise.all(Array.from({ length: N }, () => sf.getCobaltToken()));

    expect(cobaltCalls()).toHaveLength(1);
    for (const r of results) expect(r).toEqual({ token: jwt, userId: "42" });
  });

  it("joiners still re-check authority after the shared exchange resolves", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();

    const callers = Array.from({ length: 4 }, () => sf.getCobaltToken());
    await cobalt.dispatched(0);
    // Revoke while the exchange is in flight, then let it answer successfully.
    await ss.revokeSession();
    cobalt.release(0, jsonResponse({ token: makeJwt("99") }));

    const settled = await settleAll(callers);
    for (const s of settled) {
      expect(s.status).toBe("rejected");
      expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.SessionChangedError);
    }
    expect(cobaltCalls()).toHaveLength(1);
  });
});

describe("failed exchanges reject every joined caller and are not cached", () => {
  it("non-OK status: all callers get CobaltTokenError, then the next call POSTs afresh", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    // 401 is non-retryable, so the failure lands without backoff.
    fetchMock.mockImplementation(async () => jsonResponse({}, 401));

    const settled = await settleAll(Array.from({ length: N }, () => sf.beginAuthenticatedSession()));
    expect(cobaltCalls()).toHaveLength(1);
    for (const s of settled) {
      expect(s.status).toBe("rejected");
      const reason = (s as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(sf.CobaltTokenError);
      expect((reason as InstanceType<typeof sf.CobaltTokenError>).status).toBe(401);
    }

    fetchMock.mockImplementation(async () => jsonResponse({ token: makeJwt("99") }));
    const session = await sf.beginAuthenticatedSession();
    expect(session.userId).toBe("99");
    expect(cobaltCalls()).toHaveLength(2);
  });

  it("malformed body: all callers get MalformedCobaltTokenError, then the next call POSTs afresh", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
    }) as unknown as Response);

    const settled = await settleAll(Array.from({ length: N }, () => sf.getCobaltToken()));
    expect(cobaltCalls()).toHaveLength(1);
    for (const s of settled) {
      expect(s.status).toBe("rejected");
      expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.MalformedCobaltTokenError);
    }

    // A missing token claim is malformed too — and also not cached.
    fetchMock.mockImplementation(async () => jsonResponse({ token: 123 }));
    await expect(sf.getCobaltToken()).rejects.toBeInstanceOf(sf.MalformedCobaltTokenError);
    expect(cobaltCalls()).toHaveLength(2);

    fetchMock.mockImplementation(async () => jsonResponse({ token: makeJwt("99") }));
    await expect(sf.getCobaltToken()).resolves.toMatchObject({ userId: "99" });
    expect(cobaltCalls()).toHaveLength(3);
  });
});

describe("an in-flight exchange never crosses a generation boundary", () => {
  /**
   * Shared scenario: generation-1 callers wait on POST #0; `transition()`
   * changes the session; a new-generation caller must issue POST #1 rather
   * than join #0. POST #0 then answers (successfully) while #1 is still
   * pending — its callers reject, and its settlement must neither clear #1's
   * pending entry (a further new-generation caller still joins #1) nor write
   * the token cache.
   */
  async function runTransition(transition: () => void | Promise<void>, newCookie: string) {
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();

    const oldCallers = Array.from({ length: 4 }, () => sf.beginAuthenticatedSession());
    await cobalt.dispatched(0);

    await transition();

    const newCaller = sf.beginAuthenticatedSession();
    await cobalt.dispatched(1);
    expect(cobaltCalls()).toHaveLength(2);
    expect(cobaltCalls()[1].cookie).toContain(newCookie);

    // The old exchange answers with the OLD account's token.
    cobalt.release(0, jsonResponse({ token: makeJwt("OLD") }));
    const oldSettled = await settleAll(oldCallers);
    for (const s of oldSettled) {
      expect(s.status).toBe("rejected");
      expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.SessionChangedError);
    }

    // A later new-generation caller joins POST #1: the old settlement did not
    // clear the newer pending entry.
    const lateCaller = sf.beginAuthenticatedSession();
    await Promise.resolve();
    expect(cobaltCalls()).toHaveLength(2);
    cobalt.release(1, jsonResponse({ token: makeJwt("NEW") }));

    const [a, b] = await Promise.all([newCaller, lateCaller]);
    expect(a.userId).toBe("NEW");
    expect(b.userId).toBe("NEW");
    expect(cobaltCalls()).toHaveLength(2);

    // The cache holds the NEW token, never the old exchange's.
    const again = await sf.getCobaltToken();
    expect(again.userId).toBe("NEW");
    expect(cobaltCalls()).toHaveLength(2);
  }

  it("account swap on disk", async () => {
    await runTransition(() => setSessionFile(sessionJson("SECRET_B")), "SECRET_B");
  });

  it("invalidateSessionCache() (fresh login with the same cookie)", async () => {
    await runTransition(() => sf.invalidateSessionCache(), "SECRET_A");
  });

  it("revokeSession() followed by a fresh login", async () => {
    await runTransition(async () => {
      await ss.revokeSession();
      setSessionFile(sessionJson("SECRET_C"));
      sf.invalidateSessionCache();
    }, "SECRET_C");
  });

  it("an old exchange that FAILS after the transition does not disturb the new one", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();

    const oldCaller = sf.beginAuthenticatedSession();
    await cobalt.dispatched(0);
    setSessionFile(sessionJson("SECRET_B"));
    const newCaller = sf.beginAuthenticatedSession();
    await cobalt.dispatched(1);

    cobalt.release(0, jsonResponse({}, 401));
    await expect(oldCaller).rejects.toThrow();

    const lateCaller = sf.beginAuthenticatedSession();
    await Promise.resolve();
    expect(cobaltCalls()).toHaveLength(2);
    cobalt.release(1, jsonResponse({ token: makeJwt("NEW") }));
    await expect(Promise.all([newCaller, lateCaller])).resolves.toHaveLength(2);
    expect(cobaltCalls()).toHaveLength(2);
  });
});

describe("near-expiry refresh is deduplicated too", () => {
  it(`${N} concurrent callers inside the 60 s refresh window trigger exactly one refresh`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    setSessionFile(sessionJson("SECRET_A"));

    let minted = 0;
    fetchMock.mockImplementation(async () => {
      minted += 1;
      return jsonResponse({ token: makeJwt(`U${minted}`) });
    });

    const first = await sf.getCobaltToken();
    expect(first.userId).toBe("U1");
    expect(cobaltCalls()).toHaveLength(1);

    // Move to 30 s before the token's exp: inside the 60 s refresh margin.
    vi.setSystemTime(new Date("2026-10-16T12:59:30Z"));
    const refreshed = await Promise.all(Array.from({ length: N }, () => sf.beginAuthenticatedSession()));

    expect(cobaltCalls()).toHaveLength(2);
    for (const s of refreshed) expect(s.userId).toBe("U2");
  });
});
