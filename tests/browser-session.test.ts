import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * browser-session.test.ts
 *
 * Exercises the browser/login lifecycle in browser.ts against the REAL
 * session-state / session-fetch lifecycle (only `fs` and `playwright` are
 * mocked — never session-state). Covers: pending context creation bound to a
 * generation, delayed browser-close not touching newly created handles, a
 * deletion during login refusing to recreate the session, and two competing
 * logins.
 */

// ── Playwright mock (no real Chromium) ────────────────────────────────────────
const pw = vi.hoisted(() => ({
  launch: vi.fn(),
}));
vi.mock("playwright", () => ({
  chromium: {
    launch: pw.launch,
    executablePath: () => "/fake/chromium",
  },
}));

// ── fs mock (stable handles survive resetModules) ─────────────────────────────
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
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

type BrowserModule = typeof import("../src/browser.js");
type SessionFetchModule = typeof import("../src/session-fetch.js");
type SessionStateModule = typeof import("../src/session-state.js");

let browser: BrowserModule;
let sf: SessionFetchModule;
let state: SessionStateModule;

let sessionFileExists = false;
let sessionFileContent = "";

function setSessionFile(content: string | null): void {
  if (content === null) {
    sessionFileExists = false;
    sessionFileContent = "";
    return;
  }
  sessionFileExists = true;
  sessionFileContent = content;
}

function sessionJson(cookieValue: string): string {
  return JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: cookieValue, domain: ".dndbeyond.com",
      path: "/", expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  });
}

/** Force the boundary check to run so a file change fires the invalidation hooks. */
function observeTransition(): void {
  sf.hasValidSession();
}

function makeJwt(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `e30.${payload}.sig`;
}

/** Verify `ctx` (as ddb_login does) and save it: the only save path there is. */
async function verifyAndSave(ctx: unknown): Promise<void> {
  const proof = await browser.verifyLoginContext(ctx as never);
  if (!proof) throw new Error("fake context did not verify");
  await browser.saveVerifiedSession(ctx as never, proof);
}

// ── Fake Playwright doubles ───────────────────────────────────────────────────
interface FakeContext {
  _closed: boolean;
  close: ReturnType<typeof vi.fn>;
  storageState: ReturnType<typeof vi.fn>;
  pages: () => unknown[];
  newPage: ReturnType<typeof vi.fn>;
  route: ReturnType<typeof vi.fn>;
  request: { post: ReturnType<typeof vi.fn> };
}
interface FakeBrowser {
  _closed: boolean;
  close: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
  contexts: FakeContext[];
}

function makeContext(): FakeContext {
  const ctx: FakeContext = {
    _closed: false,
    close: vi.fn(async () => { ctx._closed = true; }),
    storageState: vi.fn(async () => ({ cookies: [] })),
    pages: () => [],
    newPage: vi.fn(async () => ({})),
    route: vi.fn(async () => {}),
    // auth-service hands this context a valid cobalt token (a signed-in jar).
    request: {
      post: vi.fn(async () => ({ ok: () => true, status: () => 200, json: async () => ({ token: makeJwt("4242") }) })),
    },
  };
  return ctx;
}

function makeBrowser(): FakeBrowser {
  const b: FakeBrowser = {
    _closed: false,
    contexts: [],
    close: vi.fn(async () => { b._closed = true; }),
    newContext: vi.fn(async () => { const c = makeContext(); b.contexts.push(c); return c; }),
  };
  return b;
}

async function loadModules(): Promise<void> {
  vi.resetModules();
  browser = await import("../src/browser.js");
  sf = await import("../src/session-fetch.js");
  state = await import("../src/session-state.js");
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessionFileExists = false;
  sessionFileContent = "";
  fsMock.existsSync.mockImplementation((p: string) => {
    const s = String(p);
    if (s.endsWith(".tmp")) return false;
    if (s.endsWith("session.json")) return sessionFileExists;
    return true; // the session directory always "exists"
  });
  fsMock.readFileSync.mockImplementation(() => sessionFileContent);
  fsMock.openSync.mockReturnValue(3);
  pw.launch.mockImplementation(async () => makeBrowser());
  await loadModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getContext binds a pending creation to its opening generation", () => {
  it("abandons and closes a context whose account changed while newContext() was in flight", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    const fakeBrowser = makeBrowser();
    const pendingCtx = makeContext();
    let releaseNewContext!: () => void;
    fakeBrowser.newContext = vi.fn(
      () => new Promise<FakeContext>((r) => { releaseNewContext = () => r(pendingCtx); })
    );

    const p = browser.getContext(fakeBrowser as never).catch((e) => e);

    // Account changes while newContext() is still pending.
    setSessionFile(sessionJson("SECRET_B"));
    observeTransition();

    releaseNewContext();
    const res = await p;

    expect(res).toBeInstanceOf(sf.SessionChangedError);
    // The context created for the old generation was closed, not installed.
    expect(pendingCtx.close).toHaveBeenCalled();
  });
});

describe("delayed browser close never touches newly created handles", () => {
  it("closes the OLD captured context on transition and leaves the NEW one open", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    const browser1 = makeBrowser();
    const ctx1 = await browser.getContext(browser1 as never) as unknown as FakeContext;

    // Make the OLD context's close hang so we can install a new context before
    // the old cleanup completes.
    let releaseOldClose!: () => void;
    ctx1.close = vi.fn(() => new Promise<void>((r) => { releaseOldClose = r; }));

    // Transition: the browser hook synchronously detaches globals and starts
    // closing the captured old handles (fire-and-forget on this path).
    setSessionFile(sessionJson("SECRET_B"));
    observeTransition();
    expect(ctx1.close).toHaveBeenCalledTimes(1);

    // A new context is created under the new generation BEFORE the old close ends.
    const browser2 = makeBrowser();
    const ctx2 = await browser.getContext(browser2 as never) as unknown as FakeContext;
    expect(ctx2).not.toBe(ctx1);

    // Old cleanup completes now — it must not close the new handles.
    releaseOldClose();
    await Promise.resolve();
    expect(ctx2.close).not.toHaveBeenCalled();

    // The current shared context is still ctx2 (same generation ⇒ reused).
    const ctx2again = await browser.getContext(browser2 as never) as unknown as FakeContext;
    expect(ctx2again).toBe(ctx2);
  });

  it("surfaces a browser-close hook error through revokeSession()", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    const browser1 = makeBrowser();
    const ctx1 = await browser.getContext(browser1 as never) as unknown as FakeContext;
    ctx1.close = vi.fn(async () => { throw new Error("browser refused to close"); });

    await expect(state.revokeSession()).rejects.toThrow(/browser refused to close/);
  });
});

describe("login cannot recreate a session revoked while it was in flight", () => {
  it("refuses the stale login's save, then lets a fresh login save", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    const staleCtx = await browser.beginLoginSession();

    // A revocation lands while the login is in progress.
    await state.revokeSession();

    // The stale login must NOT recreate the deleted session.
    await expect(verifyAndSave(staleCtx)).rejects.toThrow(sf.SessionChangedError);
    expect(fsMock.renameSync).not.toHaveBeenCalled();

    await browser.endLoginSession();

    // A login explicitly started AFTER the revoke may save a new session.
    const freshCtx = await browser.beginLoginSession();
    await verifyAndSave(freshCtx);
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
    await browser.endLoginSession();
  });
});

describe("saveVerifiedSession keeps only D&D Beyond cookies and storage", () => {
  it("drops Google, Apple and lookalike cookies and origins before writing", async () => {
    const ctx = await browser.beginLoginSession() as unknown as FakeContext;
    ctx.storageState.mockResolvedValue({
      cookies: [
        {
          name: "CobaltSession", value: "SECRET", domain: ".dndbeyond.com", path: "/",
          expires: 1, httpOnly: true, secure: true, sameSite: "Lax",
        },
        {
          name: "CobaltSession", value: "ALSO", domain: "auth-service.dndbeyond.com", path: "/",
          expires: 1, httpOnly: true, secure: true,
        },
        { name: "SID", value: "GOOGLE", domain: ".google.com", path: "/", expires: 1, httpOnly: true, secure: true },
        { name: "aid", value: "APPLE", domain: ".apple.com", path: "/", expires: 1, httpOnly: true, secure: true },
        { name: "wiz", value: "WIZ", domain: "signin.wizards.com", path: "/", expires: 1, httpOnly: true, secure: true },
        { name: "x", value: "EVIL", domain: "dndbeyond.com.evil.example", path: "/", expires: 1, httpOnly: true, secure: true },
      ],
      origins: [
        { origin: "https://accounts.google.com", localStorage: [{ name: "t", value: "G" }] },
        { origin: "https://appleid.apple.com", localStorage: [{ name: "t", value: "A" }] },
        { origin: "https://www.dndbeyond.com", localStorage: [{ name: "theme", value: "dark" }] },
      ],
    });

    await verifyAndSave(ctx);

    const written = fsMock.writeFileSync.mock.calls.map(c => c[1]).find(v => typeof v === "string") as string;
    const saved = JSON.parse(written) as {
      cookies: Array<{ domain: string; value: string; sameSite?: string }>;
      origins: Array<{ origin: string }>;
    };
    expect(saved.cookies.map(c => c.domain)).toEqual([".dndbeyond.com", "auth-service.dndbeyond.com"]);
    expect(saved.cookies[0].sameSite).toBe("Lax");
    expect(saved.origins.map(o => o.origin)).toEqual(["https://www.dndbeyond.com"]);
    expect(written).not.toContain("GOOGLE");
    expect(written).not.toContain("APPLE");
    expect(written).not.toContain("WIZ");
    expect(written).not.toContain("EVIL");
    await browser.endLoginSession();
  });
});

describe("concurrent logins are serialized", () => {
  it("rejects a second login while one is in progress, and hands out a fresh context afterward", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    const ctxA = await browser.beginLoginSession();
    await expect(browser.beginLoginSession()).rejects.toThrow(/already in progress/);

    await browser.endLoginSession();

    const ctxB = await browser.beginLoginSession();
    expect(ctxB).not.toBe(ctxA); // no old handle reused
    await browser.endLoginSession();
  });
});

describe("endLoginSession", () => {
  it("still closes the login browser when closing its context throws, and frees the lock", async () => {
    const ctx = await browser.beginLoginSession() as unknown as FakeContext;
    const loginBrowser = await pw.launch.mock.results[0].value as FakeBrowser;
    ctx.close.mockRejectedValue(new Error("context refused to close"));

    await expect(browser.endLoginSession()).rejects.toThrow(/context refused to close/);
    expect(loginBrowser.close).toHaveBeenCalledTimes(1);

    const next = await browser.beginLoginSession();
    expect(next).not.toBe(ctx);
    await browser.endLoginSession();
  });

  it("with a context argument, closes only that login's handles", async () => {
    const ctx = await browser.beginLoginSession() as unknown as FakeContext;
    const stranger = makeContext();
    await browser.endLoginSession(stranger as never);
    expect(ctx.close).not.toHaveBeenCalled();
    await expect(browser.beginLoginSession()).rejects.toThrow(/already in progress/);

    await browser.endLoginSession(ctx as never);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe("the login context is seeded from a captureSession() snapshot (Future design rule)", () => {
  it("seeds nothing after a revoke whose file deletion failed (the file is still there)", async () => {
    setSessionFile(sessionJson("REVOKED_SECRET"));
    observeTransition();
    fsMock.rmSync.mockImplementation(() => { throw new Error("EPERM: operation not permitted"); });
    await expect(state.revokeSession()).rejects.toThrow(/EPERM/);
    expect(sessionFileExists).toBe(true);

    await browser.beginLoginSession();
    const loginBrowser = await pw.launch.mock.results[0].value as FakeBrowser;
    const options = loginBrowser.newContext.mock.calls[0][0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("storageState");
    expect(JSON.stringify(options)).not.toContain("REVOKED_SECRET");
    await browser.endLoginSession();
  });

  it("seeds no storage state when there is no session", async () => {
    await browser.beginLoginSession();
    const loginBrowser = await pw.launch.mock.results[0].value as FakeBrowser;
    expect(loginBrowser.newContext.mock.calls[0][0]).not.toHaveProperty("storageState");
    await browser.endLoginSession();
  });

  it("seeds exactly the snapshot's sanitized cookies, never a path to the file", async () => {
    setSessionFile(JSON.stringify({
      cookies: [
        JSON.parse(sessionJson("SAVED_SECRET")).cookies[0],
        { name: "SID", value: "GOOGLE", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true },
      ],
    }));
    await browser.beginLoginSession();
    const loginBrowser = await pw.launch.mock.results[0].value as FakeBrowser;
    const options = loginBrowser.newContext.mock.calls[0][0] as { storageState?: unknown };
    expect(typeof options.storageState).toBe("object");
    const seeded = options.storageState as { cookies: Array<{ value: string; domain: string }> };
    expect(seeded.cookies.map(c => [c.domain, c.value])).toEqual([[".dndbeyond.com", "SAVED_SECRET"]]);
    await browser.endLoginSession();
  });
});

describe("fix round 1: saveVerifiedSession fails closed outside the active login", () => {
  it("refuses a valid proof once no login is active", async () => {
    const ctx = await browser.beginLoginSession();
    const proof = await browser.verifyLoginContext(ctx);
    expect(proof).not.toBeNull();
    await browser.endLoginSession();

    await expect(browser.saveVerifiedSession(ctx, proof!)).rejects.toThrow(/active login/);
    expect(fsMock.renameSync).not.toHaveBeenCalled();
  });

  it("refuses a valid proof for a context that isn't the active login's", async () => {
    await browser.beginLoginSession();
    const other = makeContext();
    const proof = await browser.verifyLoginContext(other as never);
    expect(proof).not.toBeNull();

    await expect(browser.saveVerifiedSession(other as never, proof!)).rejects.toThrow(/active login/);
    expect(fsMock.renameSync).not.toHaveBeenCalled();
    await browser.endLoginSession();
  });
});

describe("fix round 1: the shared context is seeded from a captureSession() snapshot, not the file", () => {
  it("seeds nothing after a revoke whose file deletion failed (the file is still there)", async () => {
    setSessionFile(sessionJson("REVOKED_SECRET"));
    observeTransition();
    fsMock.rmSync.mockImplementation(() => { throw new Error("EPERM: operation not permitted"); });
    await expect(state.revokeSession()).rejects.toThrow(/EPERM/);
    expect(sessionFileExists).toBe(true);

    const shared = makeBrowser();
    // While revoked, getContext() still refuses afterwards (SessionChangedError,
    // unchanged); what matters here is that the context never held the cookies.
    await expect(browser.getContext(shared as never)).rejects.toThrow(sf.SessionChangedError);
    const options = shared.newContext.mock.calls[0][0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("storageState");
    expect(JSON.stringify(options)).not.toContain("REVOKED_SECRET");
  });

  it("seeds no storage state when there is no session", async () => {
    const shared = makeBrowser();
    await browser.getContext(shared as never);
    expect(shared.newContext.mock.calls[0][0]).not.toHaveProperty("storageState");
  });

  it("seeds exactly the snapshot's cookies, as an object, never a path", async () => {
    // (A file holding third-party cookies would be rewritten by the scrub, which
    // this fs mock doesn't model; the login seeding test covers the filter.)
    setSessionFile(sessionJson("SAVED_SECRET"));
    const shared = makeBrowser();
    await browser.getContext(shared as never);
    const options = shared.newContext.mock.calls[0][0] as { storageState?: unknown };
    expect(typeof options.storageState).toBe("object");
    const seeded = options.storageState as { cookies: Array<{ value: string; domain: string }> };
    expect(seeded.cookies.map(c => [c.domain, c.value])).toEqual([[".dndbeyond.com", "SAVED_SECRET"]]);
  });
});
