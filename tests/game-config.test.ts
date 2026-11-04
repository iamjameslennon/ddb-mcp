import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Every hook game-config.ts registers, so tests can fire a session transition.
const S = vi.hoisted(() => ({ hooks: [] as Array<() => void> }));

vi.mock("../src/session-fetch.js", () => ({
  sessionFetch: vi.fn(),
  anonymousFetch: vi.fn(),
  hasValidSession: vi.fn(() => true),
  captureSession: vi.fn(() => ({})),
  assertSessionCurrent: vi.fn(),
  onSessionInvalidated: vi.fn((cb: () => void) => { S.hooks.push(cb); }),
}));

// A tiny snapshot, so these tests don't depend on the generated file's contents.
vi.mock("../src/source-snapshot.js", () => ({
  SNAPSHOT_DATE: "2026-10-16",
  SNAPSHOT_CATEGORIES: [
    { id: 1, name: "5e Expanded Rules" },
    { id: 24, name: "5.5e Core Rules" },
    { id: 26, name: "5e Core Rules" },
  ],
  SNAPSHOT_SOURCES: [
    { id: 2, name: "PHB", description: "Player’s Handbook (2014)", sourceURL: "sources/dnd/phb-2014", sourceCategoryId: 26 },
    { id: 27, name: "XGtE", description: "Old Title", sourceURL: "sources/dnd/xgte", sourceCategoryId: 1 },
    { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
  ],
}));

import { getGameConfig, clearGameConfig, getPublicGameConfig, clearPublicGameConfig, getSourceIndex, peekSourceIndex, CONFIG_FETCH_TIMEOUT_MS, LOGGED_OUT_CHARACTER_INDEX_WAIT_MS } from "../src/game-config.js";
import { sessionFetch, anonymousFetch, assertSessionCurrent, captureSession, hasValidSession } from "../src/session-fetch.js";
import { classifyEdition } from "../src/edition.js";
import { resolveSource } from "../src/source-filter.js";

const response = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as unknown as Response;

const LIVE = {
  challengeRatings: [{ id: 1, value: 1, xp: 200, proficiencyBonus: 2 }],
  monsterTypes: [], alignments: [], senses: [],
  sources: [
    { id: 27, name: "XGtE", description: "Xanathar’s Guide to Everything", sourceURL: "sources/dnd/xgte", sourceCategoryId: 1 },
    // Live omits the category: the snapshot's must fill it.
    { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024" },
    { id: 300, name: "NEW-2024", description: "Brand New Book", sourceURL: "sources/dnd/new-2024", sourceCategoryId: 38 },
  ],
  sourceCategories: [{ id: 38, name: "5.5e Expanded Rules" }],
};

let configResponse: () => Response;

beforeEach(() => {
  vi.clearAllMocks();
  S.hooks.forEach(hook => hook());
  configResponse = () => response({ data: LIVE });
  vi.mocked(sessionFetch).mockImplementation(async () => configResponse());
  vi.mocked(assertSessionCurrent).mockImplementation(() => undefined);
});

describe("getSourceIndex", () => {
  it("uses the snapshot alone when the live config fetch fails", async () => {
    configResponse = () => response({}, 503);
    const index = await getSourceIndex();
    expect(index.sources.get(145)).toMatchObject({ categoryId: 24, book: "Player's Handbook (2024)" });
    expect(index.sources.get(27)?.book).toBe("Old Title");
    expect(index.sources.has(300)).toBe(false);
    expect(index.categories.get(24)).toBe("5.5e Core Rules");
  });

  it("uses the snapshot alone when the fetch throws", async () => {
    vi.mocked(sessionFetch).mockRejectedValue(new Error("network down"));
    const index = await getSourceIndex();
    expect(index.sources.get(2)?.book).toBe("Player's Handbook (2014)");
    expect(index.sources.has(300)).toBe(false);
  });

  it("merges the live config over the snapshot, field by field", async () => {
    const index = await getSourceIndex();
    expect(index.sources.get(27)?.book).toBe("Xanathar's Guide to Everything");     // live wins
    expect(index.sources.get(300)).toMatchObject({ categoryId: 38, book: "Brand New Book" }); // live-only
    expect(index.sources.get(145)?.categoryId).toBe(24);                             // snapshot fills the gap
    expect(index.sources.get(2)?.book).toBe("Player's Handbook (2014)");             // snapshot-only
    expect(index.categories.get(38)).toBe("5.5e Expanded Rules");
    expect(index.categories.get(26)).toBe("5e Core Rules");
  });

  it("uses snapshot sources when the live config has no source list", async () => {
    configResponse = () => response({ data: { ...LIVE, sources: undefined, sourceCategories: undefined } });
    const index = await getSourceIndex();
    expect(index.sources.get(145)?.book).toBe("Player's Handbook (2024)");
    expect(index.sources.has(300)).toBe(false);
  });

  it("degrades to the snapshot when the live source list is malformed", async () => {
    configResponse = () => response({ data: { ...LIVE, sources: [null, { id: 300 }], sourceCategories: "oops" } });
    const index = await getSourceIndex();
    expect(index.sources.get(145)?.book).toBe("Player's Handbook (2024)");
    configResponse = () => response({ data: { ...LIVE, sources: { not: "an array" } } });
    S.hooks.forEach(hook => hook());
    expect((await getSourceIndex()).sources.get(145)?.categoryId).toBe(24);
  });

  it("builds one index per config", async () => {
    const a = await getSourceIndex();
    const b = await getSourceIndex();
    expect(b).toBe(a);
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("does not keep a snapshot-only index once the live config recovers", async () => {
    configResponse = () => response({}, 503);
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
    // The failure is remembered for 60 s, so recovery shows up once that passes.
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(60_000);
      configResponse = () => response({ data: LIVE });
      expect((await getSourceIndex()).sources.has(300)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the cached config and index on a session transition", async () => {
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    configResponse = () => response({}, 503);
    expect((await getSourceIndex()).sources.has(300)).toBe(true); // still cached
    S.hooks.forEach(hook => hook());
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
    expect(await getGameConfig()).toBeNull();
  });

  it("never caches a config fetched across an account change", async () => {
    vi.mocked(assertSessionCurrent).mockImplementationOnce(() => { throw new Error("session changed"); });
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });
});

describe("getSourceIndex merge hardening", () => {
  it("F1: a live category with no name keeps the snapshot's name", async () => {
    configResponse = () => response({ data: { ...LIVE, sourceCategories: [{ id: 24 }] } });
    const index = await getSourceIndex();
    expect(index.categories.get(24)).toBe("5.5e Core Rules");
  });

  it("F4: bad live source entries are skipped one at a time, not all-or-nothing", async () => {
    configResponse = () => response({
      data: {
        ...LIVE,
        sources: [
          null,
          { id: 300, name: "NEW-2024", description: "Brand New Book", sourceURL: null, sourceCategoryId: 38 },
          {},
          42,
        ],
      },
    });
    const index = await getSourceIndex();
    expect(index.sources.get(300)).toMatchObject({ categoryId: 38, book: "Brand New Book" });
    expect(index.sources.get(145)?.book).toBe("Player's Handbook (2024)");
    expect(index.sources.has(undefined as unknown as number)).toBe(false);
  });

  it("F3: an index built across a session change is returned but not cached", async () => {
    // First assert is getGameConfig's (before it caches the config); second is getSourceIndex's own.
    vi.mocked(assertSessionCurrent)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error("session changed"); });
    const first = await getSourceIndex();
    expect(first.sources.has(300)).toBe(true);
    const second = await getSourceIndex();
    expect(second).not.toBe(first);
    expect(second.sources.has(300)).toBe(true);
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });
});

describe("peekSourceIndex", () => {
  it("returns the snapshot index before any fetch, without fetching", () => {
    const index = peekSourceIndex();
    expect(index.sources.has(300)).toBe(false);
    expect(index.sources.get(145)?.categoryId).toBe(24);
    expect(sessionFetch).not.toHaveBeenCalled();
    expect(peekSourceIndex()).toBe(index); // memoized
  });

  it("returns the merged index once getSourceIndex() has built one", async () => {
    const built = await getSourceIndex();
    expect(peekSourceIndex()).toBe(built);
    expect(peekSourceIndex().sources.has(300)).toBe(true);
  });

  it("returns the snapshot index again after a session transition", async () => {
    await getSourceIndex();
    S.hooks.forEach(hook => hook());
    expect(peekSourceIndex().sources.has(300)).toBe(false);
  });
});

describe("getGameConfig failure cache", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("remembers a 503 for 60 s: no second fetch, null", async () => {
    configResponse = () => response({}, 503);
    expect(await getGameConfig()).toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_000);
    expect(await getGameConfig()).toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches again at 60 s", async () => {
    configResponse = () => response({}, 503);
    await getGameConfig();
    vi.advanceTimersByTime(60_000);
    await getGameConfig();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("remembers a missing challengeRatings and a thrown fetch too", async () => {
    configResponse = () => response({ data: {} });
    expect(await getGameConfig()).toBeNull();
    await getGameConfig();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    S.hooks.forEach(hook => hook());
    vi.mocked(sessionFetch).mockRejectedValue(new Error("network down"));
    await getGameConfig();
    await getGameConfig();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("is cleared by the session-transition hook", async () => {
    configResponse = () => response({}, 503);
    await getGameConfig();
    S.hooks.forEach(hook => hook());
    configResponse = () => response({ data: LIVE });
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("records nothing when the failure settles after a session change", async () => {
    configResponse = () => response({}, 503);
    vi.mocked(assertSessionCurrent).mockImplementationOnce(() => { throw new Error("session changed"); });
    expect(await getGameConfig()).toBeNull();
    configResponse = () => response({ data: LIVE });
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("does not apply a failure record from an older generation", async () => {
    configResponse = () => response({}, 503);
    // Two captures per call: getGameConfig's own, and the fetch's boundary check before it sends.
    vi.mocked(captureSession).mockReturnValueOnce({ generation: 1 } as never).mockReturnValueOnce({ generation: 1 } as never);
    await getGameConfig();
    vi.mocked(captureSession).mockReturnValueOnce({ generation: 2 } as never).mockReturnValueOnce({ generation: 2 } as never);
    configResponse = () => response({ data: LIVE });
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("caches a success after the TTL as before", async () => {
    configResponse = () => response({}, 503);
    await getGameConfig();
    vi.advanceTimersByTime(60_000);
    configResponse = () => response({ data: LIVE });
    expect(await getGameConfig()).not.toBeNull();
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });
});

describe("getGameConfig shares one in-flight fetch per session generation", () => {
  // A controllable session: captureSession stamps the current generation and
  // assertSessionCurrent throws once it has moved on, as session-state does.
  let generation = 1;
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  // Lets the deferred fetch start (the shared fetch begins a microtask later).
  const flush = () => new Promise<void>(r => setTimeout(r, 0));

  beforeEach(() => {
    generation = 1;
    vi.mocked(captureSession).mockImplementation(() => ({ generation }) as never);
    vi.mocked(assertSessionCurrent).mockImplementation((s: unknown) => {
      if ((s as { generation: number }).generation !== generation) throw new Error("session changed");
    });
  });
  afterEach(() => {
    vi.mocked(captureSession).mockImplementation(() => ({}) as never);
  });

  it("N concurrent cold getGameConfig() / getSourceIndex() calls send one config request", async () => {
    const fetch = deferred<Response>();
    vi.mocked(sessionFetch).mockImplementation(() => fetch.promise);
    const configs = Array.from({ length: 5 }, () => getGameConfig());
    const indexes = Array.from({ length: 3 }, () => getSourceIndex());
    await flush();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    fetch.resolve(response({ data: LIVE }));
    const got = await Promise.all(configs);
    expect(got.every(c => c !== null && c === got[0])).toBe(true);
    expect(got[0]?.challengeRatings).toEqual(LIVE.challengeRatings);
    const built = await Promise.all(indexes);
    expect(built.every(i => i === built[0] && i.sources.has(300))).toBe(true);
    expect(await getGameConfig()).toBe(got[0]); // cached
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("a newer generation starts its own fetch, and the old one's result is never cached for it", async () => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    vi.mocked(sessionFetch).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const a = getGameConfig();
    await flush();
    generation = 2;
    S.hooks.forEach(hook => hook());
    const b = getGameConfig();
    await flush();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    old.resolve(response({ data: LIVE }));
    expect(await a).toBeNull(); // fetched under the old session: neither returned nor cached
    const FRESH = { ...LIVE, challengeRatings: [{ id: 2, value: 2, xp: 450, proficiencyBonus: 2 }] };
    fresh.resolve(response({ data: FRESH }));
    expect((await b)?.challengeRatings).toEqual(FRESH.challengeRatings);
    expect((await getGameConfig())?.challengeRatings).toEqual(FRESH.challengeRatings);
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("compares generations before joining, and an old fetch settling clears only its own entry", async () => {
    // No invalidation hook fires here: the generation check alone keeps gen 2 out.
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    vi.mocked(sessionFetch).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const a = getGameConfig();
    await flush();
    generation = 2;
    const b = getGameConfig();
    await flush();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    old.resolve(response({ data: LIVE }));
    expect(await a).toBeNull();
    // The old settlement must not have dropped generation 2's pending fetch.
    const c = getGameConfig();
    await flush();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    fresh.resolve(response({ data: LIVE }));
    const [gotB, gotC] = await Promise.all([b, c]);
    expect(gotB).not.toBeNull();
    expect(gotC).toBe(gotB);
  });

  it("the invalidation hook drops the pending fetch", async () => {
    const first = deferred<Response>();
    const FRESH = { ...LIVE, challengeRatings: [{ id: 2, value: 2, xp: 450, proficiencyBonus: 2 }] };
    vi.mocked(sessionFetch)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => response({ data: FRESH }));
    const a = getGameConfig();
    await flush();
    S.hooks.forEach(hook => hook()); // same generation number: only the hook can keep b out
    const b = getGameConfig();
    await flush();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    first.resolve(response({ data: LIVE }));
    // Same generation, so each fetch's own result stands: b got its own, not a's.
    const [gotA, gotB] = await Promise.all([a, b]);
    expect(gotA?.challengeRatings).toEqual(LIVE.challengeRatings);
    expect(gotB?.challengeRatings).toEqual(FRESH.challengeRatings);
  });

  it("a session change between publishing the fetch and running it sends no request for the old call", async () => {
    const a = getGameConfig();
    generation = 2; // before the deferred fetch runs
    expect(await a).toBeNull();
    expect(sessionFetch).not.toHaveBeenCalled();
    // The new generation fetches for itself.
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("a fetch that rejects resolves every caller to null and frees the slot for a fresh fetch", async () => {
    // The third capture is the fetch's own boundary check: make it throw, past the fetch's try.
    let captures = 0;
    vi.mocked(captureSession).mockImplementation(() => {
      if (++captures === 3) throw new Error("session file unreadable");
      return { generation } as never;
    });
    const [a, b] = await Promise.all([getGameConfig(), getGameConfig()]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(sessionFetch).not.toHaveBeenCalled();
    // Not stuck on the rejected fetch, and not recorded as a failure: the next call fetches.
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("a failure is shared by every joiner and recorded once in the 60 s failure cache", async () => {
    vi.useFakeTimers();
    try {
      const fetch = deferred<Response>();
      vi.mocked(sessionFetch).mockImplementationOnce(() => fetch.promise);
      const calls = Array.from({ length: 4 }, () => getGameConfig());
      await vi.advanceTimersByTimeAsync(0);
      expect(sessionFetch).toHaveBeenCalledTimes(1);
      fetch.resolve(response({}, 503));
      expect(await Promise.all(calls)).toEqual([null, null, null, null]);
      vi.advanceTimersByTime(59_000);
      expect(await getGameConfig()).toBeNull();
      expect(sessionFetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000);
      expect(await getGameConfig()).not.toBeNull();
      expect(sessionFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a thrown fetch is shared too, and getGameConfig never rejects", async () => {
    const fetch = deferred<Response>();
    vi.mocked(sessionFetch).mockImplementationOnce(() => fetch.promise);
    const calls = [getGameConfig(), getSourceIndex(), getGameConfig()];
    await flush();
    fetch.reject(new Error("network down"));
    const [c1, index, c2] = await Promise.all(calls);
    expect(c1).toBeNull();
    expect(c2).toBeNull();
    expect((index as Awaited<ReturnType<typeof getSourceIndex>>).sources.has(300)).toBe(false);
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });
});

describe("getSourceIndex never rejects", () => {
  it("falls back to the snapshot index when the live step throws", async () => {
    vi.mocked(captureSession).mockImplementationOnce(() => { throw new Error("session file unreadable"); });
    const index = await getSourceIndex();
    expect(index).toBe(peekSourceIndex());
    expect(index.sources.get(2)?.book).toBe("Player's Handbook (2014)");
  });
});

describe("getGameConfig deadline", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A fetch that stays pending until `settle` is called. */
  function stall() {
    let settle!: (r: Response) => void;
    const calls: Array<RequestInit | undefined> = [];
    vi.mocked(sessionFetch).mockImplementation((_url, init) => {
      calls.push(init);
      return new Promise<Response>(resolve => { settle = resolve; });
    });
    return { settle: (r: Response) => settle(r), calls };
  }

  it("a stalled config fetch resolves null at the deadline and frees the slot", async () => {
    stall();
    const callers = [getGameConfig(), getGameConfig()];
    await vi.advanceTimersByTimeAsync(CONFIG_FETCH_TIMEOUT_MS - 1);
    let settled = false;
    void Promise.all(callers).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.all(callers)).toEqual([null, null]);
    // Remembered like any failure: no new request inside the failure window.
    expect(await getGameConfig()).toBeNull();
    expect(vi.mocked(sessionFetch)).toHaveBeenCalledTimes(1);
    // Slot released: after the memo expires a new fetch starts and can succeed.
    await vi.advanceTimersByTimeAsync(60_000);
    vi.mocked(sessionFetch).mockImplementation(async () => configResponse());
    expect(await getGameConfig()).not.toBeNull();
    expect(vi.mocked(sessionFetch)).toHaveBeenCalledTimes(2);
  });

  it("the stalled fetch's late settlement records nothing", async () => {
    const { settle, calls } = stall();
    const first = getGameConfig();
    await vi.advanceTimersByTimeAsync(CONFIG_FETCH_TIMEOUT_MS);
    expect(await first).toBeNull();
    expect((calls[0]?.signal as AbortSignal).aborted).toBe(true);
    settle(response({ data: LIVE }));
    await vi.advanceTimersByTimeAsync(0);
    // The late success is not cached: still inside the failure memo, so null.
    expect(await getGameConfig()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    vi.mocked(sessionFetch).mockImplementation(async () => response({}, 503));
    expect(await getGameConfig()).toBeNull();
    expect(vi.mocked(sessionFetch)).toHaveBeenCalledTimes(2);
  });
});

describe("the deadline after a session change", () => {
  let generation = 1;
  beforeEach(() => {
    vi.useFakeTimers();
    generation = 1;
    vi.mocked(captureSession).mockImplementation(() => ({ generation }) as never);
    vi.mocked(assertSessionCurrent).mockImplementation((s: unknown) => {
      if ((s as { generation: number }).generation !== generation) throw new Error("session changed");
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(captureSession).mockImplementation(() => ({}) as never);
  });

  it("records nothing and leaves the newer generation's slot alone", async () => {
    vi.mocked(sessionFetch).mockImplementation(() => new Promise<Response>(() => {}));
    const old = getGameConfig();
    await vi.advanceTimersByTimeAsync(5_000);
    generation = 2;
    S.hooks.forEach(hook => hook());
    let fresh: Promise<unknown> = getGameConfig();
    let freshSettled = false;
    void fresh.then(() => { freshSettled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    // The old fetch's deadline (t = 10 s) fires; the new one's (t = 15 s) has not.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(freshSettled).toBe(false);
    // The newer slot still holds: a joiner sends no third request.
    fresh = getGameConfig();
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await fresh).toBeNull();
    expect(await old).toBeNull();
  });
});

describe("getPublicGameConfig (logged-out monster lookups)", () => {
  afterEach(() => vi.useRealTimers());

  it("fetches the config with no credentials, once, and leaves getGameConfig's cache alone", async () => {
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: LIVE }));
    const [a, b] = await Promise.all([getPublicGameConfig(), getPublicGameConfig()]);
    expect(a).toMatchObject({ challengeRatings: LIVE.challengeRatings });
    expect(b).toBe(a);
    expect(await getPublicGameConfig()).toBe(a);
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(anonymousFetch).mock.calls[0][0]).toBe("https://www.dndbeyond.com/api/config/json");
    expect(sessionFetch).not.toHaveBeenCalled();
    // The source index other tools use still comes from the session-bound config.
    vi.mocked(sessionFetch).mockRejectedValue(new Error("No session found."));
    expect((await getSourceIndex()).sources.get(300)).toBeUndefined();
  });

  it("a failure is null, remembered for 60 s, then retried", async () => {
    vi.useFakeTimers();
    vi.mocked(anonymousFetch).mockResolvedValue(response({}, 503));
    expect(await getPublicGameConfig()).toBeNull();
    expect(await getPublicGameConfig()).toBeNull();
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: LIVE }));
    expect(await getPublicGameConfig()).not.toBeNull();
    expect(anonymousFetch).toHaveBeenCalledTimes(2);
  });

  it("a thrown fetch or a config without challengeRatings is null too", async () => {
    vi.mocked(anonymousFetch).mockRejectedValue(new Error("down"));
    expect(await getPublicGameConfig()).toBeNull();
    S.hooks.forEach(hook => hook());
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: { monsterTypes: [] } }));
    expect(await getPublicGameConfig()).toBeNull();
  });

  it("clearPublicGameConfig (ddb_clear_cache) drops the cache and the failure memo", async () => {
    vi.mocked(anonymousFetch).mockResolvedValue(response({}, 503));
    expect(await getPublicGameConfig()).toBeNull();
    clearPublicGameConfig();
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: LIVE }));
    const cfg = await getPublicGameConfig();
    expect(cfg).not.toBeNull();
    expect(anonymousFetch).toHaveBeenCalledTimes(2);
    clearPublicGameConfig();
    await getPublicGameConfig();
    expect(anonymousFetch).toHaveBeenCalledTimes(3);
  });

  it("is dropped by the session-transition hook", async () => {
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: LIVE }));
    await getPublicGameConfig();
    S.hooks.forEach(hook => hook());
    await getPublicGameConfig();
    expect(anonymousFetch).toHaveBeenCalledTimes(2);
  });

  it("a stalled fetch resolves null at the config deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(anonymousFetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const pending = getPublicGameConfig();
    await vi.advanceTimersByTimeAsync(CONFIG_FETCH_TIMEOUT_MS);
    expect(await pending).toBeNull();
  });
});

describe("logged out, the source index comes from the public config (ag)", () => {
  beforeEach(() => {
    vi.mocked(hasValidSession).mockReturnValue(false);
    // As the real session-fetch behaves with no session: sessionFetch refuses.
    vi.mocked(sessionFetch).mockRejectedValue(new Error("No session found."));
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: LIVE }));
  });
  afterEach(() => vi.mocked(hasValidSession).mockReturnValue(true));

  it("labels a source newer than the snapshot with its live book and category", async () => {
    const index = await getSourceIndex();
    expect(index.sources.get(300)?.categoryId).toBe(38);
    expect(classifyEdition({ sourceId: 300 }, index)).toEqual({ ruleset: "2024", book: "Brand New Book" });
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
    expect(sessionFetch).not.toHaveBeenCalled();
  });

  it("resolves a source naming that new book", async () => {
    const index = await getSourceIndex();
    expect(resolveSource(index, "new-2024")).toEqual({ query: "new-2024", ids: [300], book: "Brand New Book" });
  });

  it("shares the public config fetch and its cache with getPublicGameConfig", async () => {
    const [index, config] = await Promise.all([getSourceIndex(), getPublicGameConfig()]);
    expect(index.sources.has(300)).toBe(true);
    expect(config).not.toBeNull();
    expect(await getSourceIndex()).toBe(index); // cached against the same config object
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
  });

  it("the public config failing leaves the snapshot index, without rejecting", async () => {
    vi.mocked(anonymousFetch).mockResolvedValue(response({}, 503));
    const index = await getSourceIndex();
    expect(index.sources.has(300)).toBe(false);
    expect(index.sources.get(145)?.categoryId).toBe(24);
    vi.mocked(anonymousFetch).mockRejectedValue(new Error("down"));
    clearPublicGameConfig();
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
  });

  it("an already-aborted signal gets the snapshot index and starts no fetch", async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await getSourceIndex({ signal: ctl.signal })).toBe(peekSourceIndex());
    expect(anonymousFetch).not.toHaveBeenCalled();
  });

  it("a signal aborted mid-fetch resolves at once; the shared fetch is left to finish", async () => {
    let settle!: (r: Response) => void;
    let seen: AbortSignal | undefined;
    vi.mocked(anonymousFetch).mockImplementationOnce((_url, init) => new Promise<Response>(r => {
      seen = init?.signal ?? undefined;
      settle = r;
    }));
    const ctl = new AbortController();
    const index = getSourceIndex({ signal: ctl.signal });
    await vi.waitFor(() => expect(anonymousFetch).toHaveBeenCalledTimes(1));
    ctl.abort();
    expect(await index).toBe(peekSourceIndex());
    expect((await index).sources.has(300)).toBe(false);
    expect(seen?.aborted).toBe(false);
    // The fetch finishes and is cached: the next caller sends nothing.
    settle(response({ data: LIVE }));
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
  });

  it("a valid session still builds the index from the session-bound config", async () => {
    vi.mocked(hasValidSession).mockReturnValue(true);
    vi.mocked(sessionFetch).mockImplementation(async () => configResponse());
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    expect(anonymousFetch).not.toHaveBeenCalled();
  });
});

describe("a logged-out character waits at most LOGGED_OUT_CHARACTER_INDEX_WAIT_MS for the index", () => {
  const WAIT = LOGGED_OUT_CHARACTER_INDEX_WAIT_MS;
  let settle!: (r: Response) => void;
  let seen: AbortSignal | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(hasValidSession).mockReturnValue(false);
    vi.mocked(sessionFetch).mockRejectedValue(new Error("No session found."));
    vi.mocked(anonymousFetch).mockImplementation((_url, init) => new Promise<Response>(r => {
      seen = init?.signal ?? undefined;
      settle = r;
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.mocked(hasValidSession).mockReturnValue(true); });

  it("is 2 s, well inside the 10 s fetch deadline", () => {
    expect(WAIT).toBe(2_000);
    expect(WAIT).toBeLessThan(CONFIG_FETCH_TIMEOUT_MS);
  });

  it("falls back to the snapshot index after the wait, while the public config hangs", async () => {
    let done = false;
    const p = getSourceIndex({ loggedOutWaitMs: WAIT }).then(i => { done = true; return i; });
    await vi.advanceTimersByTimeAsync(WAIT - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const index = await p;
    expect(done).toBe(true);
    expect(index).toBe(peekSourceIndex());
    expect(index.sources.has(300)).toBe(false);
  });

  it("leaves the shared fetch running, then the next call gets the live index with no new request", async () => {
    const p = getSourceIndex({ loggedOutWaitMs: WAIT });
    await vi.advanceTimersByTimeAsync(WAIT);
    await p;
    expect(seen?.aborted).toBe(false);
    settle(response({ data: LIVE }));
    await vi.advanceTimersByTimeAsync(0);
    expect((await getSourceIndex({ loggedOutWaitMs: WAIT })).sources.has(300)).toBe(true);
    expect(peekSourceIndex().sources.has(300)).toBe(true);
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
  });

  it("records no failure memo: the next call joins the same fetch rather than being refused", async () => {
    const p = getSourceIndex({ loggedOutWaitMs: WAIT });
    await vi.advanceTimersByTimeAsync(WAIT);
    await p;
    // A memo would make this null at once without joining; it joins and waits.
    let done = false;
    const second = getSourceIndex({ loggedOutWaitMs: WAIT }).then(i => { done = true; return i; });
    await vi.advanceTimersByTimeAsync(WAIT - 1);
    expect(done).toBe(false);
    settle(response({ data: LIVE }));
    expect((await second).sources.has(300)).toBe(true);
    expect(anonymousFetch).toHaveBeenCalledTimes(1);
  });

  it("an index that arrives within the wait is used, and the timer is cleared", async () => {
    const p = getSourceIndex({ loggedOutWaitMs: WAIT });
    await vi.advanceTimersByTimeAsync(500);
    settle(response({ data: LIVE }));
    expect((await p).sources.has(300)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an abort of the caller's own signal still wins", async () => {
    const ctl = new AbortController();
    const p = getSourceIndex({ signal: ctl.signal, loggedOutWaitMs: WAIT });
    await vi.advanceTimersByTimeAsync(10);
    ctl.abort();
    expect(await p).toBe(peekSourceIndex());
    expect(vi.getTimerCount()).toBe(1); // only the shared fetch's own deadline: the 2 s wait timer is cleared
  });

  it("a long-lived signal reused across capped calls does not accumulate abort listeners", async () => {
    const ctl = new AbortController();
    let live = 0;
    const add = vi.spyOn(ctl.signal, "addEventListener").mockImplementation(() => { live++; });
    const remove = vi.spyOn(ctl.signal, "removeEventListener").mockImplementation(() => { live--; });
    for (let i = 0; i < 3; i++) {
      const p = getSourceIndex({ signal: ctl.signal, loggedOutWaitMs: WAIT });
      await vi.advanceTimersByTimeAsync(WAIT);
      await p;
    }
    expect(add).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(live).toBe(0);
  });

  it("with a valid session the option is ignored: it waits up to the 10 s deadline", async () => {
    vi.mocked(hasValidSession).mockReturnValue(true);
    let seenSession = false;
    vi.mocked(sessionFetch).mockImplementation(() => { seenSession = true; return new Promise<Response>(() => {}); });
    let done = false;
    const p = getSourceIndex({ loggedOutWaitMs: WAIT }).then(i => { done = true; return i; });
    await vi.advanceTimersByTimeAsync(WAIT * 3);
    expect(seenSession).toBe(true);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(CONFIG_FETCH_TIMEOUT_MS);
    expect(await p).toBe(peekSourceIndex());
    expect(done).toBe(true);
  });
});

describe("a fetch that settles after a clear does not repopulate the source index", () => {
  afterEach(() => vi.mocked(hasValidSession).mockReturnValue(true));

  it("session-bound path", async () => {
    let settle!: (r: Response) => void;
    vi.mocked(sessionFetch).mockImplementationOnce(() => new Promise<Response>(r => { settle = r; }));
    const pending = getSourceIndex();
    await vi.waitFor(() => expect(sessionFetch).toHaveBeenCalledTimes(1));
    clearGameConfig();
    settle(response({ data: LIVE }));
    expect((await pending).sources.has(300)).toBe(true); // its own caller still gets the index
    expect(peekSourceIndex().sources.has(300)).toBe(false); // but nothing was cached
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    expect(sessionFetch).toHaveBeenCalledTimes(2); // rebuilt from a fresh fetch
  });

  it("public path", async () => {
    vi.mocked(hasValidSession).mockReturnValue(false);
    let settle!: (r: Response) => void;
    vi.mocked(anonymousFetch).mockImplementationOnce(() => new Promise<Response>(r => { settle = r; }));
    const pending = getSourceIndex();
    await vi.waitFor(() => expect(anonymousFetch).toHaveBeenCalledTimes(1));
    clearGameConfig();
    clearPublicGameConfig(); // as ddb_clear_cache does
    settle(response({ data: LIVE }));
    expect((await pending).sources.has(300)).toBe(true);
    expect(peekSourceIndex().sources.has(300)).toBe(false);
    vi.mocked(anonymousFetch).mockResolvedValue(response({ data: LIVE }));
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    expect(anonymousFetch).toHaveBeenCalledTimes(2);
  });
});

describe("clearGameConfig (ddb_clear_cache)", () => {
  it("drops the cached config and the failure memo, so the next call fetches at once", async () => {
    configResponse = () => response({}, 503);
    expect(await getGameConfig()).toBeNull();
    expect(await getGameConfig()).toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    clearGameConfig();
    configResponse = () => response({ data: LIVE });
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
    clearGameConfig();
    await getGameConfig();
    expect(sessionFetch).toHaveBeenCalledTimes(3);
  });

  it("a fetch that settles after the clear writes nothing: no cache, no memo", async () => {
    let settle!: (r: Response) => void;
    vi.mocked(sessionFetch).mockImplementationOnce(() => new Promise<Response>(r => { settle = r; }));
    const pending = getGameConfig();
    await Promise.resolve(); await Promise.resolve();
    clearGameConfig();
    settle(response({ data: LIVE }));
    expect(await pending).not.toBeNull();
    // The late success was not cached: the next call fetches again.
    await getGameConfig();
    expect(sessionFetch).toHaveBeenCalledTimes(2);

    clearGameConfig();
    vi.mocked(sessionFetch).mockClear();
    vi.mocked(sessionFetch).mockImplementationOnce(() => new Promise<Response>(r => { settle = r; }));
    const failing = getGameConfig();
    await Promise.resolve(); await Promise.resolve();
    clearGameConfig();
    settle(response({}, 503));
    expect(await failing).toBeNull();
    // The late failure was not remembered either.
    vi.mocked(sessionFetch).mockImplementation(async () => response({ data: LIVE }));
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });
});

describe("a caller that withdraws (minors C #4: a failed load never reads its index)", () => {
  it("withdrawn before the request goes out: no config request, no failure memo", async () => {
    const ctl = new AbortController();
    const pending = getGameConfig({ signal: ctl.signal });
    ctl.abort();
    expect(await pending).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    expect(sessionFetch).not.toHaveBeenCalled();
    // Nothing remembered: the next caller fetches at once.
    expect(await getGameConfig()).toMatchObject({ challengeRatings: LIVE.challengeRatings });
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("withdrawn mid-request: the request is aborted, not retried, and no failure is remembered", async () => {
    let seen: AbortSignal | undefined;
    vi.mocked(sessionFetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      seen = init?.signal ?? undefined;
      seen?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const ctl = new AbortController();
    const index = getSourceIndex({ signal: ctl.signal });
    await vi.waitFor(() => expect(sessionFetch).toHaveBeenCalledTimes(1));
    ctl.abort();
    expect((await index).sources.has(300)).toBe(false); // the snapshot index
    expect(seen?.aborted).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    expect(sessionFetch).toHaveBeenCalledTimes(1);
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("another caller still waiting keeps the shared fetch alive", async () => {
    const ctl = new AbortController();
    const withdrawn = getGameConfig({ signal: ctl.signal });
    const kept = getGameConfig();
    ctl.abort();
    expect(await withdrawn).toBeNull();
    expect(await kept).toMatchObject({ challengeRatings: LIVE.challengeRatings });
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("a caller that never withdraws gets the config as before", async () => {
    const ctl = new AbortController();
    expect(await getGameConfig({ signal: ctl.signal })).toMatchObject({ challengeRatings: LIVE.challengeRatings });
    ctl.abort(); // after settling: no effect
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });
});

describe("a cancelled fetch that already saw a failure keeps the memo (fix round 1)", () => {
  /** sessionFetch that reports one attempt's response, then waits in retry backoff until aborted. */
  function failingThenWaiting(status: number | "network") {
    vi.mocked(sessionFetch).mockImplementationOnce(((_url: string, init?: RequestInit, hooks?: { onResponse?: (r: Response) => void }) =>
      new Promise((_resolve, reject) => {
        if (status !== "network") hooks?.onResponse?.(response({}, status));
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as never);
  }

  it("a 503 seen before the cancel is remembered for 60 s: the next call sends nothing", async () => {
    failingThenWaiting(503);
    const ctl = new AbortController();
    const pending = getGameConfig({ signal: ctl.signal });
    await vi.waitFor(() => expect(sessionFetch).toHaveBeenCalledTimes(1));
    ctl.abort();
    expect(await pending).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    expect(await getGameConfig()).toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("a 503 followed by a 200 before the cancel records nothing: the next call fetches again", async () => {
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    vi.mocked(sessionFetch).mockImplementationOnce((async (_url: string, _init?: RequestInit, hooks?: { onResponse?: (r: Response) => void }) => {
      hooks?.onResponse?.(response({}, 503));
      hooks?.onResponse?.(response({ data: LIVE }));
      await held; // the 200 is in, but its result is not used yet
      return response({ data: LIVE });
    }) as never);
    const ctl = new AbortController();
    const pending = getGameConfig({ signal: ctl.signal });
    await vi.waitFor(() => expect(sessionFetch).toHaveBeenCalledTimes(1));
    ctl.abort();
    release();
    expect(await pending).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("a cancel before any response records nothing", async () => {
    failingThenWaiting("network");
    const ctl = new AbortController();
    const pending = getGameConfig({ signal: ctl.signal });
    await vi.waitFor(() => expect(sessionFetch).toHaveBeenCalledTimes(1));
    ctl.abort();
    expect(await pending).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    expect(await getGameConfig()).not.toBeNull();
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });
});
