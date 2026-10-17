import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Every hook game-config.ts registers, so tests can fire a session transition.
const S = vi.hoisted(() => ({ hooks: [] as Array<() => void> }));

vi.mock("../src/session-fetch.js", () => ({
  sessionFetch: vi.fn(),
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

import { getGameConfig, getSourceIndex, peekSourceIndex } from "../src/game-config.js";
import { sessionFetch, assertSessionCurrent, captureSession } from "../src/session-fetch.js";

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
    vi.mocked(captureSession).mockReturnValueOnce({ generation: 1 } as never);
    await getGameConfig();
    vi.mocked(captureSession).mockReturnValueOnce({ generation: 2 } as never);
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
