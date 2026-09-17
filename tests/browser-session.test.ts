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

// ── Fake Playwright doubles ───────────────────────────────────────────────────
interface FakeContext {
  _closed: boolean;
  close: ReturnType<typeof vi.fn>;
  storageState: ReturnType<typeof vi.fn>;
  pages: () => unknown[];
  newPage: ReturnType<typeof vi.fn>;
  route: ReturnType<typeof vi.fn>;
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
    if (s.endsWith("session.json.tmp")) return false;
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
    await expect(browser.saveSession(staleCtx)).rejects.toThrow(sf.SessionChangedError);
    expect(fsMock.renameSync).not.toHaveBeenCalled();

    await browser.endLoginSession();

    // A login explicitly started AFTER the revoke may save a new session.
    const freshCtx = await browser.beginLoginSession();
    await browser.saveSession(freshCtx);
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
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
