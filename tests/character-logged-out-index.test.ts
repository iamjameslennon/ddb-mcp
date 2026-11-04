import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * End to end, logged out: a character call waits at most 2 s for the public
 * config, then carries on with snapshot labels; the shared config fetch keeps
 * running and the next call is labelled from the live index. Only the network
 * (global fetch) and the filesystem (no session file) are mocked.
 */

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  fchmodSync: vi.fn(),
  renameSync: vi.fn(),
  realpathSync: vi.fn((p: string) => p),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

import { FIGHTER_5 } from "./fixtures/character-fixtures.js";
import { S, variant } from "./fixtures/character-edition-helpers.js";

// A source id newer than the snapshot: unknown until the live config arrives.
const NEW_SOURCE = 99_999;
const CHARACTER = variant(FIGHTER_5, d => { d.feats[0].definition.sources = S(NEW_SOURCE); });
const LIVE_CONFIG = {
  data: {
    challengeRatings: [{ id: 1, value: 1, xp: 200, proficiencyBonus: 2 }],
    monsterTypes: [], alignments: [], senses: [],
    sources: [{ id: NEW_SOURCE, name: "NEW-2024", description: "Brand New Book", sourceURL: "sources/dnd/new-2024", sourceCategoryId: 24 }],
    sourceCategories: [],
  },
};

let configRequests: number;
let settleConfig: () => void;
let configSignal: AbortSignal | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  configRequests = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("character-service")) return new Response(JSON.stringify(CHARACTER), { status: 200 });
    // The public game config hangs until the test lets it through.
    configRequests++;
    configSignal = init?.signal ?? undefined;
    return new Promise<Response>(resolve => {
      settleConfig = () => resolve(new Response(JSON.stringify(LIVE_CONFIG), { status: 200 }));
    });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("parseCharacter (ddb_get_character), logged out", () => {
  it("returns at 2 s with snapshot labels while the config hangs, and the next call is live", async () => {
    const { parseCharacter } = await import("../src/tools/character.js");
    let done = false;
    const first = parseCharacter("12345678", "full").then(v => { done = true; return v; });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await first;
    expect(done).toBe(true);
    expect(out).toContain("Great Weapon Master [edition not stated]");
    expect(configRequests).toBe(1);
    expect(configSignal?.aborted).toBe(false); // the shared fetch keeps running

    settleConfig();
    await vi.advanceTimersByTimeAsync(0);
    // The character JSON is cached for 60 s; only the index is new. Move past it.
    await vi.advanceTimersByTimeAsync(61_000);
    const second = await parseCharacter("12345678", "full");
    expect(second).not.toContain("Great Weapon Master [edition not stated]");
    expect(configRequests).toBe(1); // no second config request, and no failure memo
  });
});

describe("getDefinition (ddb_character_lookup), logged out", () => {
  it("returns at 2 s with snapshot labels while the config hangs, and the next call is live", async () => {
    const { getDefinition } = await import("../src/tools/character.js");
    let done = false;
    const first = getDefinition("12345678", "great weapon").then(v => { done = true; return v; });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toContain("Rules: edition not stated");
    expect(configSignal?.aborted).toBe(false);

    settleConfig();
    await vi.advanceTimersByTimeAsync(0);
    expect(await getDefinition("12345678", "great weapon")).toContain("Rules: 2024 · Brand New Book");
    expect(configRequests).toBe(1);
  });
});
