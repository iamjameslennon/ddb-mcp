import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.mock is auto-hoisted by Vitest before any imports are resolved.
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
}));

import { existsSync, readFileSync, chmodSync } from "fs";
import { hasValidSession, invalidateSessionCache, SESSION_DIR, SESSION_PATH } from "../src/session-fetch.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = readFileSync as unknown as { mockReturnValue: (v: string) => void };

function makeCookie(overrides: Partial<{
  domain: string; expires: number; secure: boolean;
}> = {}) {
  return {
    name: "cobalt-session",
    value: "abc123",
    domain: ".dndbeyond.com",
    path: "/",
    expires: Date.now() / 1000 + 3600, // valid for 1 hour
    httpOnly: true,
    secure: true,
    ...overrides,
  };
}

function setSessionFile(cookies: object[]): void {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify({ cookies }));
}

describe("hasValidSession", () => {
  beforeEach(() => {
    // Reset in-memory cache and mock call counts between tests
    invalidateSessionCache();
    vi.clearAllMocks();
  });

  it("returns false when session file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(hasValidSession()).toBe(false);
  });

  it("returns false when the session has no DDB cookies", () => {
    setSessionFile([makeCookie({ domain: ".google.com" })]);
    expect(hasValidSession()).toBe(false);
  });

  it("returns false when all DDB cookies are expired", () => {
    setSessionFile([makeCookie({ expires: Date.now() / 1000 - 3600 })]);
    expect(hasValidSession()).toBe(false);
  });

  it("returns false when DDB cookies are not marked secure", () => {
    setSessionFile([makeCookie({ secure: false })]);
    expect(hasValidSession()).toBe(false);
  });

  it("returns true when a valid, secure, non-expired DDB cookie exists", () => {
    setSessionFile([makeCookie()]);
    expect(hasValidSession()).toBe(true);
  });

  it("reads session file only once across multiple calls (in-memory cache)", () => {
    setSessionFile([makeCookie()]);
    hasValidSession();
    hasValidSession();
    hasValidSession();
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);
  });

  it("re-reads session file after invalidateSessionCache()", () => {
    setSessionFile([makeCookie()]);
    hasValidSession();
    invalidateSessionCache();
    setSessionFile([makeCookie()]); // reset mocks since clearAllMocks was not called
    hasValidSession();
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(2);
  });

  it("returns false after invalidateSessionCache() when file no longer exists", () => {
    setSessionFile([makeCookie()]);
    expect(hasValidSession()).toBe(true);

    invalidateSessionCache();
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    expect(hasValidSession()).toBe(false);
  });

  // tightenSessionPermissions is POSIX-only — on Windows the dir relies on
  // %APPDATA% ACL inheritance and no chmod is attempted.
  it.skipIf(process.platform === "win32")(
    "tightens session dir/file permissions on first read (legacy installs)",
    () => {
      setSessionFile([makeCookie()]);
      hasValidSession();
      expect(vi.mocked(chmodSync)).toHaveBeenCalledWith(SESSION_DIR, 0o700);
      expect(vi.mocked(chmodSync)).toHaveBeenCalledWith(SESSION_PATH, 0o600);

      // Cached reads must not re-stat the disk
      vi.clearAllMocks();
      hasValidSession();
      expect(vi.mocked(chmodSync)).not.toHaveBeenCalled();
    }
  );
});
