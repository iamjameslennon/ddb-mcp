import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  FakeBrowser, makeJwt, apiResponse, ANONYMOUS_COBALT, type LoginFakeState,
} from "./fixtures/login-fakes.js";

/**
 * server-login.test.ts — the ddb_login registration (Task 10b, F30 §4.1 and
 * §4 item 5), driven through an in-memory MCP client. Only `playwright` and
 * `fs` are mocked; browser.ts, auth.ts and the session lifecycle are real.
 *
 * - A second, concurrent ddb_login answers "already in progress" and leaves the
 *   first login's window alone.
 * - A client cancel closes the window, releases the login lock, writes nothing.
 * - With a progressToken, the call sends notifications/progress about every 10 s.
 * - A browser that won't start is named as Chrome/Chromium.
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
  realpathSync: vi.fn((p: string) => p),
  statSync: vi.fn(),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { server } from "../src/server.js";

let client: Client;
let browsers: FakeBrowser[] = [];
let signedIn = false;

/** A client-side request timeout far beyond any fake time a test advances. */
const NO_CLIENT_TIMEOUT = { timeout: 3_600_000 };

function textOf(result: CallToolResult): string {
  return result.content.map(c => (c.type === "text" ? c.text : "")).join("\n");
}

function track<T>(p: Promise<T>): { readonly result: { ok: true; value: T } | { ok: false; error: Error } | undefined } {
  const box: { result: { ok: true; value: T } | { ok: false; error: Error } | undefined } = { result: undefined };
  p.then(value => { box.result = { ok: true, value }; }, (error: Error) => { box.result = { ok: false, error }; });
  return box;
}

function callLogin(options: Record<string, unknown> = {}) {
  return client.callTool({ name: "ddb_login", arguments: {} }, CallToolResultSchema, { ...NO_CLIENT_TIMEOUT, ...options }) as Promise<CallToolResult>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  browsers = [];
  signedIn = false;
  state.cobalt = () => apiResponse(signedIn ? { token: makeJwt("4242") } : ANONYMOUS_COBALT);
  state.domLoggedIn = false;
  fsMock.existsSync.mockImplementation((p: string) => {
    const s = String(p);
    if (s.endsWith(".tmp") || s.endsWith("session.json")) return false;
    return true;
  });
  fsMock.readFileSync.mockImplementation(() => "");
  fsMock.openSync.mockReturnValue(3);
  pw.launch.mockImplementation(async () => {
    const b = new FakeBrowser(state);
    browsers.push(b);
    return b;
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  // Let any login still running finish so the module-level lock is free.
  signedIn = true;
  await vi.advanceTimersByTimeAsync(5_000);
  await client.close();
  vi.useRealTimers();
});

describe("ddb_login ownership: a concurrent call never closes the running login", () => {
  it("answers 'already in progress' and leaves the first login's window open; the first then completes", async () => {
    const first = track(callLogin());
    await vi.advanceTimersByTimeAsync(4_000);
    expect(browsers).toHaveLength(1);
    const [browserA] = browsers;
    const ctxA = browserA.contexts[0];

    const second = await callLogin();
    expect(second.isError).toBe(true);
    expect(textOf(second)).toMatch(/A login is already in progress/);
    expect(ctxA.close).not.toHaveBeenCalled();
    expect(browserA.close).not.toHaveBeenCalled();
    expect(browsers).toHaveLength(1); // the second call launched nothing

    signedIn = true;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(first.result?.ok).toBe(true);
    const done = (first.result as { value: CallToolResult }).value;
    expect(done.isError).toBeFalsy();
    expect(textOf(done)).toMatch(/^Successfully logged in to D&D Beyond/);
    expect(browserA.close).toHaveBeenCalled(); // closed by its own call, after saving
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1);
  });
});

describe("ddb_login honours the client's cancel (4.1 i)", () => {
  it("closes the window, releases the lock and writes nothing; the next ddb_login can start", async () => {
    const abort = new AbortController();
    const cancelled = track(callLogin({ signal: abort.signal }));
    await vi.advanceTimersByTimeAsync(20_000);
    const [browserA] = browsers;

    abort.abort("client gave up");
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled.result?.ok).toBe(false);
    expect(browserA.contexts[0].close).toHaveBeenCalled();
    expect(browserA.close).toHaveBeenCalled();

    // Signing in now changes nothing for the cancelled call.
    signedIn = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fsMock.renameSync).not.toHaveBeenCalled();

    // The lock is free: a new ddb_login starts and completes.
    const next = await callLogin();
    expect(textOf(next)).toMatch(/^Already logged in/);
    expect(browsers).toHaveLength(2);
  });
});

describe("ddb_login progress pings (4.1 ii)", () => {
  it("sends notifications/progress about every 10 s while waiting, when the request has a progressToken", async () => {
    const progress: Array<{ progress: number; total?: number }> = [];
    const call = track(callLogin({ onprogress: (p: { progress: number; total?: number }) => progress.push(p), resetTimeoutOnProgress: true }));

    await vi.advanceTimersByTimeAsync(35_000);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < progress.length; i++) expect(progress[i].progress).toBeGreaterThan(progress[i - 1].progress);
    expect(progress[0].total).toBe(180);

    signedIn = true;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(call.result?.ok).toBe(true);
    const count = progress.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(progress.length).toBe(count); // no pings after the call ends
  });

  it("keeps the call alive past the SDK's 60 s client default while pings arrive", async () => {
    const call = track(client.callTool(
      { name: "ddb_login", arguments: {} }, CallToolResultSchema,
      { onprogress: () => {}, resetTimeoutOnProgress: true },
    ));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(call.result).toBeUndefined();
    signedIn = true;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(call.result?.ok).toBe(true);
  });
});

describe("ddb_login error replies", () => {
  it("names Chrome/Chromium when no browser can be started", async () => {
    pw.launch.mockRejectedValue(new Error("browserType.launch: Executable doesn't exist at /fake/chromium"));
    const result = await callLogin();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Chrome or Chromium/);
    expect(textOf(result)).toMatch(/Executable doesn't exist/);
  });

  it("says the window was closed, not 'timed out', when the user closes it", async () => {
    const call = track(callLogin());
    await vi.advanceTimersByTimeAsync(10_000);
    await browsers[0].contexts[0].openPages[0].close();
    await vi.advanceTimersByTimeAsync(0);
    const result = (call.result as { value: CallToolResult }).value;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Login failed: The sign-in window was closed before sign-in finished.");
  });

  it("says the 3-minute deadline passed when sign-in isn't finished", async () => {
    const call = track(callLogin());
    await vi.advanceTimersByTimeAsync(181_000);
    const result = (call.result as { value: CallToolResult }).value;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Login failed: Sign-in wasn't finished within 3 minutes/);
    expect(browsers[0].close).toHaveBeenCalled();
  });
});
