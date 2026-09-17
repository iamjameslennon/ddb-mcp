import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock fs with stable handles (vi.hoisted) so the same mock functions survive
// vi.resetModules(), letting each test load a pristine session-state singleton.
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("fs", () => fsMock);

type StateModule = typeof import("../src/session-state.js");

async function loadState(): Promise<StateModule> {
  vi.resetModules();
  return import("../src/session-state.js");
}

function makeCookie(overrides: Partial<{ domain: string; expires: number; secure: boolean; name: string; value: string }> = {}) {
  return {
    name: "cobalt-session",
    value: "abc123",
    domain: ".dndbeyond.com",
    path: "/",
    expires: Date.now() / 1000 + 3600,
    httpOnly: true,
    secure: true,
    ...overrides,
  };
}

function setSessionFile(content: string | null): void {
  if (content === null) {
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReset();
    return;
  }
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readFileSync.mockReturnValue(content);
}

function sessionJson(cookies: object[] = [makeCookie()]): string {
  return JSON.stringify({ cookies });
}

let state: StateModule;

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockReset();
  fsMock.existsSync.mockReset();
  state = await loadState();
});

describe("captureSession", () => {
  it("returns anonymous(missing) when no file exists", () => {
    setSessionFile(null);
    const snap = state.captureSession();
    expect(snap.state.kind).toBe("anonymous");
    if (snap.state.kind === "anonymous") expect(snap.state.reason).toBe("missing");
  });

  it("returns an authenticated, frozen snapshot when the file is valid", () => {
    setSessionFile(sessionJson());
    const snap = state.captureSession();
    expect(snap.state.kind).toBe("authenticated");
    if (snap.state.kind === "authenticated") {
      expect(snap.state.cookies).toHaveLength(1);
      expect(Object.isFrozen(snap.state.cookies)).toBe(true);
    }
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("returns anonymous(malformed) on unparseable content", () => {
    setSessionFile("{ this is not json");
    const snap = state.captureSession();
    expect(snap.state.kind).toBe("anonymous");
    if (snap.state.kind === "anonymous") expect(snap.state.reason).toBe("malformed");
  });

  it("returns anonymous(unreadable) when the read throws", () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => { throw new Error("EACCES"); });
    const snap = state.captureSession();
    expect(snap.state.kind).toBe("anonymous");
    if (snap.state.kind === "anonymous") expect(snap.state.reason).toBe("unreadable");
  });
});

describe("boundary re-check & parsed reuse", () => {
  it("re-reads the file on every capture but reuses the parsed state when unchanged", () => {
    setSessionFile(sessionJson());
    const a = state.captureSession();
    const b = state.captureSession();
    const c = state.captureSession();
    // Boundary check: the file is re-read every time.
    expect(fsMock.readFileSync).toHaveBeenCalledTimes(3);
    // Same generation, and the parsed state object is reused (JSON.parse skipped).
    expect(a.generation).toBe(b.generation);
    expect(b.generation).toBe(c.generation);
    expect(a.state).toBe(b.state);
    expect(b.state).toBe(c.state);
  });
});

describe("transition detection", () => {
  it("advances the generation and aborts the old snapshot on deletion", () => {
    setSessionFile(sessionJson());
    const snap1 = state.captureSession();
    expect(snap1.signal.aborted).toBe(false);

    setSessionFile(null);
    const snap2 = state.captureSession();

    expect(snap2.generation).not.toBe(snap1.generation);
    expect(snap1.signal.aborted).toBe(true);
    expect(snap1.signal.reason).toBeInstanceOf(state.SessionChangedError);
  });

  it("detects an EQUAL-LENGTH content change (content compare, not size)", () => {
    const a = sessionJson([makeCookie({ value: "AAAAAA" })]);
    const b = sessionJson([makeCookie({ value: "BBBBBB" })]);
    expect(a.length).toBe(b.length); // same size — mtime/size alone would miss this

    setSessionFile(a);
    const snap1 = state.captureSession();
    setSessionFile(b);
    const snap2 = state.captureSession();

    expect(snap2.generation).not.toBe(snap1.generation);
  });

  it("does not churn the generation while the file is unchanged", () => {
    setSessionFile(null);
    const g1 = state.captureSession().generation;
    const g2 = state.captureSession().generation;
    expect(g1).toBe(g2);
  });
});

describe("assertSessionCurrent", () => {
  it("passes for a current snapshot", () => {
    setSessionFile(sessionJson());
    const snap = state.captureSession();
    expect(() => state.assertSessionCurrent(snap)).not.toThrow();
  });

  it("throws SessionChangedError after the file is deleted", () => {
    setSessionFile(sessionJson());
    const snap = state.captureSession();
    setSessionFile(null);
    expect(() => state.assertSessionCurrent(snap)).toThrow(state.SessionChangedError);
  });

  it("throws SessionChangedError after the file is replaced (different account)", () => {
    setSessionFile(sessionJson([makeCookie({ value: "accountA" })]));
    const snap = state.captureSession();
    setSessionFile(sessionJson([makeCookie({ value: "accountB" })]));
    expect(() => state.assertSessionCurrent(snap)).toThrow(state.SessionChangedError);
  });
});

describe("onSessionInvalidated", () => {
  it("fires registered hooks on invalidation and stops after unsubscribe", () => {
    const hook = vi.fn();
    const unsubscribe = state.onSessionInvalidated(hook);

    state.invalidateSessionState();
    expect(hook).toHaveBeenCalledTimes(1);

    unsubscribe();
    state.invalidateSessionState();
    expect(hook).toHaveBeenCalledTimes(1); // no further calls
  });
});

describe("revokeSession", () => {
  it("removes the saved file, blocks new authority, and awaits async cleanup", async () => {
    setSessionFile(sessionJson());
    state.captureSession(); // warm authority

    const order: string[] = [];
    state.onSessionInvalidated(() => {
      order.push("sync-detach");
      return new Promise<void>((resolve) => setTimeout(() => { order.push("async-cleanup"); resolve(); }, 5));
    });

    await state.revokeSession();

    expect(fsMock.rmSync).toHaveBeenCalledWith(state.SESSION_PATH, { force: true });
    expect(order).toEqual(["sync-detach", "async-cleanup"]);

    // Even though the fs mock still reports the file as present, authority is
    // blocked until a fresh login clears the revoke.
    const snap = state.captureSession();
    expect(snap.state.kind).toBe("anonymous");
    if (snap.state.kind === "anonymous") expect(snap.state.reason).toBe("revoked");
  });

  it("reports a specific cleanup error when an async hook rejects", async () => {
    setSessionFile(sessionJson());
    state.onSessionInvalidated(() => Promise.reject(new Error("browser refused to close")));
    await expect(state.revokeSession()).rejects.toThrow(/browser refused to close/);
  });

  it("resolves cleanly when already logged out (file missing)", async () => {
    setSessionFile(null);
    await expect(state.revokeSession()).resolves.toBeUndefined();
    // force:true means rmSync does not throw on a missing file.
    expect(fsMock.rmSync).toHaveBeenCalledWith(state.SESSION_PATH, { force: true });
  });

  it("clearRevoked re-enables authority (fresh login path)", async () => {
    setSessionFile(sessionJson());
    await state.revokeSession();
    expect(state.captureSession().state.kind).toBe("anonymous");

    state.clearRevoked();
    setSessionFile(sessionJson());
    expect(state.captureSession().state.kind).toBe("authenticated");
  });
});
