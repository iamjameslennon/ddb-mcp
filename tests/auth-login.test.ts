import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  FakeBrowser, FakeContext, apiResponse, makeJwt, ANONYMOUS_COBALT, COBALT_URL, callLogError,
  type LoginFakeState,
} from "./fixtures/login-fakes.js";

/**
 * auth-login.test.ts — ddb_login's sign-in flow (src/auth.ts), Task 10b (F30, F29).
 *
 * Real browser.ts, session-state and session-fetch; only `playwright` and `fs`
 * are mocked (the browser-session.test.ts style). Sign-in is decided by D&D
 * Beyond's cobalt-token answer through the context's request API, never by the
 * DOM or the URL, within a real 180 s deadline; every way it can end has its
 * own message; and nothing is saved without a verified token.
 */

const state: LoginFakeState = vi.hoisted(() => ({ cobalt: () => { throw new Error("unset"); }, domLoggedIn: false }) as unknown as LoginFakeState);
const pw = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({
  chromium: { launch: pw.launch, executablePath: () => "/fake/chromium" },
}));

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  openSync: vi.fn(() => 3),
  closeSync: vi.fn(),
  fchmodSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

type AuthModule = typeof import("../src/auth.js");
type BrowserModule = typeof import("../src/browser.js");
type SessionStateModule = typeof import("../src/session-state.js");

let auth: AuthModule;
let browser: BrowserModule;
let ss: SessionStateModule;
let lastBrowser: FakeBrowser | null = null;

let sessionFileExists = false;
let sessionFileContent = "";

function sessionJson(cookieValue: string): string {
  return JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: cookieValue, domain: ".dndbeyond.com",
      path: "/", expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  });
}

/** The session-file JSON written so far (the temp-file write before each rename). */
function writtenSessions(): string[] {
  return fsMock.writeFileSync.mock.calls.map(c => c[1]).filter((v): v is string => typeof v === "string");
}

/** Track a promise's outcome without awaiting it, so fake time can be advanced first. */
function track<T>(p: Promise<T>): { readonly result: { ok: true; value: T } | { ok: false; error: Error } | undefined } {
  const box: { result: { ok: true; value: T } | { ok: false; error: Error } | undefined } = { result: undefined };
  p.then(value => { box.result = { ok: true, value }; }, (error: Error) => { box.result = { ok: false, error }; });
  return box;
}

async function startLogin(options?: { signal?: AbortSignal }) {
  const ctx = await browser.beginLoginSession() as unknown as FakeContext;
  const outcome = track(auth.login(ctx as never, options));
  await vi.advanceTimersByTimeAsync(0); // the first check and opening the sign-in page
  return { ctx, outcome };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  state.cobalt = () => apiResponse(ANONYMOUS_COBALT);
  state.domLoggedIn = false;
  state.gotoError = undefined;
  sessionFileExists = false;
  sessionFileContent = "";
  fsMock.existsSync.mockImplementation((p: string) => {
    const s = String(p);
    if (s.endsWith(".tmp")) return false;
    if (s.endsWith("session.json")) return sessionFileExists;
    return true;
  });
  fsMock.readFileSync.mockImplementation(() => sessionFileContent);
  fsMock.openSync.mockReturnValue(3);
  fsMock.rmSync.mockImplementation(() => { sessionFileExists = false; });
  pw.launch.mockImplementation(async () => (lastBrowser = new FakeBrowser(state)));
  vi.resetModules();
  auth = await import("../src/auth.js");
  browser = await import("../src/browser.js");
  ss = await import("../src/session-state.js");
});

afterEach(async () => {
  await browser.endLoginSession().catch(() => {});
  vi.useRealTimers();
});

describe("F30: a real 180 s deadline, polled every ~2 s", () => {
  it("is still waiting at 31 s and 179 s, and fails only at 180 s, naming the deadline", async () => {
    const { ctx, outcome } = await startLogin();

    await vi.advanceTimersByTimeAsync(31_000);
    expect(outcome.result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(148_000); // 179 s
    expect(outcome.result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(outcome.result).toMatchObject({ ok: false });
    const error = (outcome.result as { error: Error }).error;
    expect(error).toBeInstanceOf(auth.LoginTimeoutError);
    expect(error.message).toMatch(/^Sign-in wasn't finished within 3 minutes/);
    expect(auth.LOGIN_TIMEOUT_MS).toBe(180_000);
    // Polled about every 2 s, through the context's request API (its cookie jar).
    expect(ctx.request.post.mock.calls.length).toBeGreaterThanOrEqual(85);
    expect(ctx.request.post.mock.calls.length).toBeLessThanOrEqual(95);
    expect(ctx.request.post).toHaveBeenCalledWith(COBALT_URL, expect.anything());
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });

  it("succeeds as soon as D&D Beyond hands out a token, and saves exactly once", async () => {
    let signedIn = false;
    state.cobalt = () => apiResponse(signedIn ? { token: makeJwt("4242") } : ANONYMOUS_COBALT);
    const { ctx, outcome } = await startLogin();

    // The sign-in page is opened for the user.
    expect(ctx.openPages).toHaveLength(1);
    expect(ctx.openPages[0].goto).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.dndbeyond\.com\/(login|sign-in)/), expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(40_000);
    expect(outcome.result).toBeUndefined();
    signedIn = true;
    await vi.advanceTimersByTimeAsync(2_500);

    expect(outcome.result).toEqual({ ok: true, value: "Successfully logged in to D&D Beyond. Session saved to disk." });
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
    const saved = writtenSessions().at(-1)!;
    expect(saved).toContain("SIGNED_IN");
    expect(saved).not.toContain("GOOGLE"); // sanitizeSessionStorage still applies
  });

  it("ignores the URL: landing back on the homepage without a token is not success", async () => {
    const { ctx, outcome } = await startLogin();
    ctx.openPages[0].currentUrl = "https://www.dndbeyond.com/";
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome.result).toBeUndefined();
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });
});

describe("F29: only a verified token means signed in", () => {
  it("does not say 'Already logged in' or save when the anonymous page's DOM looks signed in", async () => {
    // The anonymous homepage has UserNavigation_signInLink__…, which the old
    // heuristic read as signed in; auth-service says {token:null}.
    state.domLoggedIn = true;
    const { ctx, outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(outcome.result).toBeUndefined(); // still waiting for a real sign-in
    expect(fsMock.renameSync).not.toHaveBeenCalled();
    expect(ctx.openPages[0].evaluate).not.toHaveBeenCalled(); // no DOM heuristic at all
  });

  it("says 'Already logged in' only when the first token check passes, saves once, and opens no sign-in page", async () => {
    sessionFileExists = true;
    sessionFileContent = sessionJson("SAVED");
    state.cobalt = () => apiResponse({ token: makeJwt("4242") });
    const { ctx, outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome.result).toEqual({ ok: true, value: "Already logged in. Session is active." });
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
    expect(ctx.openPages.every(p => p.goto.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ["a non-JWT token", { token: "nope" }],
    ["a JWT without a user id", { token: `e30.${Buffer.from("{}").toString("base64url")}.sig` }],
    ["no token field", {}],
  ])("keeps waiting on %s", async (_label, body) => {
    state.cobalt = () => apiResponse(body);
    const { outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(outcome.result).toBeUndefined();
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });

  it("keeps waiting on an auth-service error status or a network error", async () => {
    let call = 0;
    state.cobalt = () => {
      call++;
      if (call % 2) return apiResponse({}, 503);
      throw new Error("apiRequestContext.post: getaddrinfo ENOTFOUND auth-service.dndbeyond.com");
    };
    const { outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(outcome.result).toBeUndefined();
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });
});

describe("real error messages", () => {
  const CLOSED = "The sign-in window was closed before sign-in finished.";

  it("stops at once when the user closes the last window, and polls no more", async () => {
    const { ctx, outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(20_000);
    const polls = ctx.request.post.mock.calls.length;

    await ctx.openPages[0].close();
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome.result).toMatchObject({ ok: false });
    const error = (outcome.result as { error: Error }).error;
    expect(error).toBeInstanceOf(auth.LoginWindowClosedError);
    expect(error.message).toBe(CLOSED);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ctx.request.post.mock.calls.length).toBe(polls);
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });

  it("keeps waiting when a popup (Google sign-in) closes but the main window stays", async () => {
    const { ctx, outcome } = await startLogin();
    const popup = ctx.openPage();
    await vi.advanceTimersByTimeAsync(5_000);
    await popup.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outcome.result).toBeUndefined();
  });

  it("reports a closed window when the popup is the last one left and it closes", async () => {
    const { ctx, outcome } = await startLogin();
    const popup = ctx.openPage();
    await ctx.openPages[0].close();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(outcome.result).toBeUndefined();
    await popup.close();
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.result as { error: Error }).error.message).toBe(CLOSED);
  });

  it.each([
    ["the context closes", (ctx: FakeContext) => ctx.close()],
    ["the browser disconnects", (ctx: FakeContext) => ctx.owner!.close()],
  ])("reports a closed window when %s", async (_label, closeIt) => {
    const { ctx, outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(3_000);
    await closeIt(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.result as { error: Error }).error.message).toBe(CLOSED);
  });

  it("reports a closed window when the token check fails with Playwright's target-closed error", async () => {
    state.cobalt = () => { throw new Error("apiRequestContext.post: Target page, context or browser has been closed"); };
    const { outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.result as { error: Error }).error.message).toBe(CLOSED);
  });

  it("passes any other error's own message through", async () => {
    const ctx = await browser.beginLoginSession() as unknown as FakeContext;
    const origOpen = ctx.openPage.bind(ctx);
    ctx.newPage.mockImplementation(async () => {
      const page = origOpen();
      page.goto.mockRejectedValue(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.dndbeyond.com/login"));
      return page;
    });
    const outcome = track(auth.login(ctx as never));
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.result as { error: Error }).error.message).toMatch(/net::ERR_NAME_NOT_RESOLVED/);
  });

  it("keeps the session-changed text when a logout lands mid-login, and saves nothing", async () => {
    let signedIn = false;
    state.cobalt = () => apiResponse(signedIn ? { token: makeJwt("4242") } : ANONYMOUS_COBALT);
    const { outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(4_000);
    await ss.revokeSession();
    signedIn = true;
    await vi.advanceTimersByTimeAsync(2_500);

    const error = (outcome.result as { error: Error }).error;
    expect(error).toBeInstanceOf(ss.SessionChangedError);
    expect(error.message).toBe("Login raced a session change (logout/replacement); not recreating the session.");
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });
});

describe("client cancellation (4.1 i)", () => {
  it("stops at once on abort and writes nothing", async () => {
    let signedIn = false;
    state.cobalt = () => apiResponse(signedIn ? { token: makeJwt("4242") } : ANONYMOUS_COBALT);
    const abort = new AbortController();
    const { ctx, outcome } = await startLogin({ signal: abort.signal });
    await vi.advanceTimersByTimeAsync(30_000);
    const polls = ctx.request.post.mock.calls.length;

    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.result as { error: Error }).error).toBeInstanceOf(auth.LoginCancelledError);

    signedIn = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.request.post.mock.calls.length).toBe(polls);
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });

  it("does not start when the signal is already aborted", async () => {
    state.cobalt = () => apiResponse({ token: makeJwt("4242") });
    const abort = new AbortController();
    abort.abort();
    const { outcome } = await startLogin({ signal: abort.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect((outcome.result as { error: Error }).error).toBeInstanceOf(auth.LoginCancelledError);
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });
});

describe("never save without a verified token", () => {
  it("saveVerifiedSession refuses a forged or unverified proof", async () => {
    const ctx = await browser.beginLoginSession();
    await expect(browser.saveVerifiedSession(ctx, {} as never)).rejects.toThrow(/verified/i);
    await expect(browser.saveVerifiedSession(ctx, { userId: "4242" } as never)).rejects.toThrow(/verified/i);
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });

  it("verifyLoginContext returns null for {token:null}, and a proof only for that context", async () => {
    const ctxA = await browser.beginLoginSession();
    expect(await browser.verifyLoginContext(ctxA)).toBeNull();

    state.cobalt = () => apiResponse({ token: makeJwt("4242") });
    const proof = await browser.verifyLoginContext(ctxA);
    expect(proof).not.toBeNull();
    expect(proof!.userId).toBe("4242");

    // A proof is bound to the context it checked.
    const other = await lastBrowser!.newContext();
    await expect(browser.saveVerifiedSession(other as never, proof!)).rejects.toThrow(/verified/i);
    expect(fsMock.renameSync).not.toHaveBeenCalled();

    await browser.saveVerifiedSession(ctxA, proof!);
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
  });

  it("the save path no longer exports an unverified saveSession", () => {
    expect((browser as Record<string, unknown>).saveSession).toBeUndefined();
  });
});

describe("fix round 1: errors never carry the call log (cookies) to stderr or the reply", () => {
  it("logs and reports only the first line of a failed check, and names the last failure at the deadline", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      state.cobalt = () => { throw callLogError("connect ECONNREFUSED 127.0.0.1:9", "LEAKED_COOKIE_SECRET"); };
      const { outcome } = await startLogin();
      await vi.advanceTimersByTimeAsync(181_000);

      const error = (outcome.result as { error: Error }).error;
      expect(error).toBeInstanceOf(auth.LoginTimeoutError);
      expect(error.message).toBe(
        "Sign-in wasn't finished within 3 minutes. Last check failed: connect ECONNREFUSED 127.0.0.1:9. Run ddb_login to try again.",
      );
      const logged = stderr.mock.calls.map(c => String(c[0])).join("");
      expect(logged).toContain("connect ECONNREFUSED 127.0.0.1:9");
      expect(logged).not.toContain("LEAKED_COOKIE_SECRET");
      expect(logged).not.toContain("Call log");
      expect(logged).not.toContain("\u001b");
    } finally {
      stderr.mockRestore();
    }
  });

  it("names no failure at the deadline when the last check answered (even if earlier ones failed)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      let call = 0;
      state.cobalt = () => {
        if (call++ < 5) throw callLogError("connect ECONNREFUSED 127.0.0.1:9", "LEAKED_COOKIE_SECRET");
        return apiResponse(ANONYMOUS_COBALT);
      };
      const { outcome } = await startLogin();
      await vi.advanceTimersByTimeAsync(181_000);
      expect((outcome.result as { error: Error }).error.message)
        .toBe("Sign-in wasn't finished within 3 minutes. Run ddb_login to try again.");
    } finally {
      stderr.mockRestore();
    }
  });

  it("caps each check's request timeout at 10 s and at the time left", async () => {
    const { ctx, outcome } = await startLogin();
    await vi.advanceTimersByTimeAsync(181_000);
    expect(outcome.result?.ok).toBe(false);
    const timeouts = ctx.request.post.mock.calls.map(c => (c[1] as { timeout: number }).timeout);
    expect(timeouts[0]).toBe(10_000);
    expect(Math.max(...timeouts)).toBeLessThanOrEqual(10_000);
    expect(timeouts.at(-1)).toBeLessThanOrEqual(2_000); // the check at 178 s has 2 s left
    expect(Math.min(...timeouts)).toBeGreaterThan(0);
  });
});
