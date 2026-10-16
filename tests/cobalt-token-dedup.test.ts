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

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * A cobalt endpoint whose responses are released manually, in dispatch order:
 * `release(i, resp)` answers the i-th POST. Like real fetch, a POST rejects
 * with its signal's reason when the signal aborts — unless `honorAbort` is
 * false, which models a response that is already on its way back so the
 * late-settlement paths can be exercised.
 */
function gatedCobalt({ honorAbort = true } = {}) {
  const gates: Deferred<Response>[] = [];
  const dispatches: Deferred<void>[] = [];
  const slot = <T>(list: Deferred<T>[], i: number) => (list[i] ??= deferred<T>());
  let count = 0;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url !== COBALT_URL) return Promise.resolve(jsonResponse({}));
    const i = count++;
    slot(dispatches, i).resolve();
    const gate = slot(gates, i).promise;
    const signal = init?.signal;
    if (!honorAbort || !signal) return gate;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      void gate.then(resolve);
    });
  });
  return {
    dispatched: (i: number) => slot(dispatches, i).promise,
    release: (i: number, resp: Response) => slot(gates, i).resolve(resp),
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
    vi.useFakeTimers();
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
    // The exchange's timeout timer was cleared when it settled.
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`${N} concurrent getCobaltToken() calls send exactly one POST`, async () => {
    setSessionFile(sessionJson("SECRET_A"));
    const jwt = makeJwt("42");
    fetchMock.mockImplementation(async () => jsonResponse({ token: jwt }));

    const results = await Promise.all(Array.from({ length: N }, () => sf.getCobaltToken()));

    expect(cobaltCalls()).toHaveLength(1);
    for (const r of results) expect(r).toEqual({ token: jwt, userId: "42" });
  });

  it("a revoke mid-exchange rejects every joined caller with SessionChangedError", async () => {
    vi.useFakeTimers();
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
    expect(vi.getTimerCount()).toBe(0);
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
    const cobalt = gatedCobalt({ honorAbort: false });

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
    const cobalt = gatedCobalt({ honorAbort: false });

    const oldCaller = sf.beginAuthenticatedSession();
    await cobalt.dispatched(0);
    setSessionFile(sessionJson("SECRET_B"));
    const newCaller = sf.beginAuthenticatedSession();
    await cobalt.dispatched(1);

    cobalt.release(0, jsonResponse({}, 401));
    // The 401 lands after the swap, so the post-dispatch authority check names
    // the swap before the status is ever looked at.
    await expect(oldCaller).rejects.toBeInstanceOf(sf.SessionChangedError);

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

describe("the starter re-checks authority after the shared exchange, like every joiner", () => {
  it("an account swap AFTER the mint's last check rejects the starter and every joiner", async () => {
    // Flip the file on the first read made by getCobaltTokenForSnapshot itself
    // rather than by the mint inside it: i.e. the first post-settle re-check,
    // whichever caller (starter or joiner) runs it. Every check inside the mint
    // (and every captureSession) sees account A, so the exchange itself
    // succeeds and the swap lands exactly in the hand-out window.
    //
    // The stack-trace gate is guarded so an early flip fails loudly rather than
    // passing for the wrong reason: the body must have been consumed first, the
    // mint must have re-checked authority after the body (its post-parse and
    // pre-cache-write checks), and no mint read may come after the flip.
    const A = sessionJson("SECRET_A");
    const B = sessionJson("SECRET_B");
    let flipped = false;
    let bodyConsumed = false;
    let mintReadsAfterBody = 0;
    let mintReadsAfterFlip = 0;
    const prevLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 200;
    try {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockImplementation(() => {
        const stack = new Error().stack ?? "";
        const inMint = stack.includes("mintCobaltToken");
        if (inMint && flipped) mintReadsAfterFlip += 1;
        if (inMint && bodyConsumed && !flipped) mintReadsAfterBody += 1;
        if (!flipped && bodyConsumed && !inMint && stack.includes("getCobaltTokenForSnapshot")) {
          flipped = true;
        }
        return flipped ? B : A;
      });
      fetchMock.mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => {
          bodyConsumed = true;
          return { token: makeJwt("OLD") };
        },
      }) as unknown as Response);

      const settled = await settleAll(Array.from({ length: 4 }, () => sf.beginAuthenticatedSession()));

      expect(flipped).toBe(true);
      // The mint finished all its post-body checks against account A before
      // the flip, and nothing inside it ran afterwards.
      expect(mintReadsAfterBody).toBeGreaterThanOrEqual(2);
      expect(mintReadsAfterFlip).toBe(0);
      expect(cobaltCalls()).toHaveLength(1);
      for (const s of settled) {
        expect(s.status).toBe("rejected");
        expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.SessionChangedError);
      }
    } finally {
      Error.stackTraceLimit = prevLimit;
    }
  });
});

describe("the shared exchange is bounded by COBALT_TOKEN_TIMEOUT_MS", () => {
  it("a stalled POST rejects every joined caller with a readable timeout, then the next call mints afresh", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();

    const settled = settleAll(Array.from({ length: N }, () => sf.beginAuthenticatedSession()));
    await cobalt.dispatched(0);

    let done = false;
    void settled.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(sf.COBALT_TOKEN_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const results = await settled;
    expect(cobaltCalls()).toHaveLength(1);
    for (const s of results) {
      expect(s.status).toBe("rejected");
      const reason = (s as PromiseRejectedResult).reason as Error;
      expect(reason).toBeInstanceOf(sf.CobaltTokenTimeoutError);
      expect(reason.message).toBe(
        `cobalt-token request timed out after ${sf.COBALT_TOKEN_TIMEOUT_MS / 1000} s`,
      );
    }

    expect(vi.getTimerCount()).toBe(0);

    // Pending was cleared: the next call sends a fresh POST and succeeds.
    const next = sf.beginAuthenticatedSession();
    await cobalt.dispatched(1);
    expect(cobaltCalls()).toHaveLength(2);
    cobalt.release(1, jsonResponse({ token: makeJwt("99") }));
    await expect(next).resolves.toMatchObject({ userId: "99" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the timeout covers the whole retry sequence, not each attempt", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();
    cobalt.release(0, jsonResponse({}, 503)); // first attempt: retryable

    const outcome = sf.getCobaltToken().then(() => "resolved", (e: unknown) => e);
    await cobalt.dispatched(0);
    // 1 s backoff, then the retry stalls.
    await vi.advanceTimersByTimeAsync(1000);
    await cobalt.dispatched(1);

    let done = false;
    void outcome.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(sf.COBALT_TOKEN_TIMEOUT_MS - 1000 - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(sf.CobaltTokenTimeoutError);
  });

  it("a revoke during the retry backoff rejects every joined caller promptly with SessionChangedError", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();
    cobalt.release(0, jsonResponse({}, 503)); // retryable → 1 s backoff

    const settled = settleAll(Array.from({ length: 4 }, () => sf.getCobaltToken()));
    await cobalt.dispatched(0);
    await vi.advanceTimersByTimeAsync(0); // into the backoff sleep

    let done = false;
    void settled.then(() => { done = true; });
    await ss.revokeSession();
    // No timer time passes: only the abort may wake the sleeping retry loop.
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);

    for (const s of await settled) {
      expect(s.status).toBe("rejected");
      expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.SessionChangedError);
    }
    expect(cobaltCalls()).toHaveLength(1);
    // Neither the exchange timeout nor the cut-short backoff sleep lingers.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a body read that honours the abort rejects every joined caller at the deadline", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    let posts = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      posts += 1;
      if (posts > 1) return jsonResponse({ token: makeJwt("99") });
      // Headers arrive, then the body stalls until the signal aborts — as
      // undici's body read does.
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: () => new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      } as unknown as Response;
    });

    const settled = settleAll(Array.from({ length: 4 }, () => sf.getCobaltToken()));
    await vi.advanceTimersByTimeAsync(sf.COBALT_TOKEN_TIMEOUT_MS);

    for (const s of await settled) {
      expect(s.status).toBe("rejected");
      expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.CobaltTokenTimeoutError);
    }
    expect(vi.getTimerCount()).toBe(0);

    await expect(sf.getCobaltToken()).resolves.toMatchObject({ userId: "99" });
    expect(cobaltCalls()).toHaveLength(2);
  });

  it("the deadline releases the pending slot even if the exchange never settles", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    let posts = 0;
    fetchMock.mockImplementation(async () => {
      posts += 1;
      if (posts > 1) return jsonResponse({ token: makeJwt("99") });
      // A body read that ignores the abort entirely and never settles.
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: () => new Promise(() => {}),
      } as unknown as Response;
    });

    // These callers stay stuck on the dead exchange forever; they never
    // reject, so they leave no unhandled rejection behind.
    const stuck = Array.from({ length: 2 }, () => sf.getCobaltToken());
    void stuck;
    await vi.advanceTimersByTimeAsync(sf.COBALT_TOKEN_TIMEOUT_MS);

    const next = sf.getCobaltToken();
    await vi.advanceTimersByTimeAsync(0);
    expect(cobaltCalls()).toHaveLength(2);
    await expect(next).resolves.toMatchObject({ userId: "99" });
  });
});

describe("a failed exchange still reports a session change as such", () => {
  it("a timeout after an unobserved account swap rejects with SessionChangedError, not the timeout", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    const cobalt = gatedCobalt();

    const settled = settleAll(Array.from({ length: 4 }, () => sf.getCobaltToken()));
    await cobalt.dispatched(0);
    // Swap the account on disk WITHOUT anything reading it: the lifecycle
    // signal stays un-aborted, so the stalled POST ends by timing out.
    setSessionFile(sessionJson("SECRET_B"));
    await vi.advanceTimersByTimeAsync(sf.COBALT_TOKEN_TIMEOUT_MS);

    for (const s of await settled) {
      expect(s.status).toBe("rejected");
      expect((s as PromiseRejectedResult).reason).toBeInstanceOf(sf.SessionChangedError);
    }
  });
});

describe("a starter whose snapshot dies inside the mint never strands a newer caller", () => {
  it("a caller started in the same tick under the new generation mints its own token", async () => {
    // The starter captures account A; every later read sees account B, so the
    // mint's first authority check invalidates the starter's generation. The
    // next caller (same tick, generation B) must not inherit that dead exchange.
    // Two guards cover this — the entry is published before the mint runs, and
    // joiners compare generations — so this kills only the pair, by design.
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync
      .mockReturnValueOnce(sessionJson("SECRET_A"))
      .mockReturnValue(sessionJson("SECRET_B"));
    fetchMock.mockImplementation(async () => jsonResponse({ token: makeJwt("NEW") }));

    const starter = sf.beginAuthenticatedSession();
    const next = sf.beginAuthenticatedSession();

    await expect(starter).rejects.toBeInstanceOf(sf.SessionChangedError);
    await expect(next).resolves.toMatchObject({ userId: "NEW" });
    expect(cobaltCalls()).toHaveLength(1);
    expect(cobaltCalls()[0].cookie).toContain("SECRET_B");
  });
});

describe("retry backoff is abort-aware for every snapshot-bound fetch", () => {
  it("a caller abort during backoff rejects sessionFetch promptly with the abort reason", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async () => jsonResponse({}, 503));
    const controller = new AbortController();
    const reason = new Error("caller gave up");

    const outcome = sf.sessionFetch("https://www.dndbeyond.com/api/config/json", { signal: controller.signal })
      .then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0); // first 503 → into the 1 s backoff

    let done = false;
    void outcome.then(() => { done = true; });
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(await outcome).toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
