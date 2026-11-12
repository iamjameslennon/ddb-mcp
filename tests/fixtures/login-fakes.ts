/**
 * Fake Playwright doubles for the ddb_login tests (auth-login, server-login,
 * browser-session). They model only what the login flow touches: pages and
 * their `close` events, a context with `request.post` (the cobalt-token check),
 * `storageState`, `close` and `page`/`close` events, and a browser with
 * `newContext`, `close` and `disconnected`. Timers go through setTimeout, so
 * `vi.useFakeTimers()` drives them.
 */
import { vi, type Mock } from "vitest";

export const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";

type Listener = (...args: unknown[]) => void;

class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>();
  on(event: string, cb: Listener): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, set = new Set());
    set.add(cb);
    return this;
  }
  off(event: string, cb: Listener): this {
    this.listeners.get(event)?.delete(cb);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of [...(this.listeners.get(event) ?? [])]) cb(...args);
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/** An unsigned JWT whose payload carries D&D Beyond's user-id claim. */
export function makeJwt(userId: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp,
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

export interface FakeApiResponse {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
}

/** A Playwright APIResponse double. */
export function apiResponse(body: unknown, status = 200): FakeApiResponse {
  return { ok: () => status >= 200 && status < 300, status: () => status, json: async () => body };
}

/** D&D Beyond's live anonymous answer (2026-11-11). */
export const ANONYMOUS_COBALT = { token: null, ttl: 1800 };

/** How the fake auth-service answers: called once per POST, with the call's index. */
export type CobaltAnswer = (call: number) => FakeApiResponse | Promise<FakeApiResponse>;

export interface LoginFakeState {
  cobalt: CobaltAnswer;
  /** What the (deleted) DOM heuristic would have said; the old code consulted it. */
  domLoggedIn: boolean;
}

export class FakePage extends Emitter {
  closed = false;
  currentUrl = "about:blank";
  readonly goto: Mock;
  readonly evaluate: Mock;
  readonly waitForSelector = vi.fn(async () => null);
  readonly waitForTimeout = vi.fn((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** Playwright semantics: options are the THIRD argument; the default timeout is 30 s. */
  readonly waitForFunction = vi.fn((_fn: unknown, _arg?: unknown, options?: { timeout?: number }) =>
    new Promise((_resolve, reject) => {
      const timeout = options?.timeout ?? 30_000;
      setTimeout(() => reject(Object.assign(
        new Error(`page.waitForFunction: Timeout ${timeout}ms exceeded.`), { name: "TimeoutError" },
      )), timeout);
    }));

  constructor(private readonly ctx: FakeContext, state: LoginFakeState) {
    super();
    this.goto = vi.fn(async (url: string) => { this.currentUrl = url; return null; });
    this.evaluate = vi.fn(async () => state.domLoggedIn);
  }

  url(): string { return this.currentUrl; }
  isClosed(): boolean { return this.closed; }

  /** The user (or the context) closes this window. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ctx.removePage(this);
    this.emit("close", this);
  }
}

export class FakeContext extends Emitter {
  closed = false;
  readonly openPages: FakePage[] = [];
  cobaltCalls = 0;
  readonly request: { post: Mock };
  readonly storageState = vi.fn(async () => ({
    cookies: [
      {
        name: "CobaltSession", value: "SIGNED_IN", domain: ".dndbeyond.com", path: "/",
        expires: Math.floor(Date.now() / 1000) + 86400, httpOnly: true, secure: true, sameSite: "Lax",
      },
      { name: "SID", value: "GOOGLE", domain: ".google.com", path: "/", expires: 1, httpOnly: true, secure: true },
    ],
    origins: [],
  }));
  readonly newPage: Mock;
  readonly close: Mock;

  constructor(readonly owner: FakeBrowser | null, readonly state: LoginFakeState, readonly options: unknown) {
    super();
    this.request = {
      post: vi.fn(async (url: string) => {
        if (this.closed) throw new Error("apiRequestContext.post: Target page, context or browser has been closed");
        if (url !== COBALT_URL) throw new Error(`unexpected POST ${url}`);
        return this.state.cobalt(this.cobaltCalls++);
      }),
    };
    this.newPage = vi.fn(async () => this.openPage());
    this.close = vi.fn(async () => {
      if (this.closed) return;
      for (const p of [...this.openPages]) await p.close();
      this.closed = true;
      this.emit("close", this);
    });
  }

  pages(): FakePage[] { return [...this.openPages]; }
  browser(): FakeBrowser | null { return this.owner; }

  /** Open a window in this context (newPage, or a popup such as Google sign-in). */
  openPage(): FakePage {
    const page = new FakePage(this, this.state);
    this.openPages.push(page);
    this.emit("page", page);
    return page;
  }

  removePage(page: FakePage): void {
    const i = this.openPages.indexOf(page);
    if (i >= 0) this.openPages.splice(i, 1);
  }
}

export class FakeBrowser extends Emitter {
  closed = false;
  readonly contexts: FakeContext[] = [];
  readonly newContext: Mock;
  readonly close: Mock;

  constructor(readonly state: LoginFakeState) {
    super();
    this.newContext = vi.fn(async (options?: unknown) => {
      const ctx = new FakeContext(this, this.state, options);
      this.contexts.push(ctx);
      return ctx;
    });
    this.close = vi.fn(async () => {
      if (this.closed) return;
      for (const c of this.contexts) await c.close();
      this.closed = true;
      this.emit("disconnected", this);
    });
  }
}
