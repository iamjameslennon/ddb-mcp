import { describe, it, expect, vi, beforeEach } from "vitest";

// A session mock with a real generation counter, mirroring session-state.ts:
// captureSession() observes the current generation (firing the invalidation
// hooks when it moved), assertSessionCurrent() throws on a stale snapshot, and
// each authenticated fetch is tagged with the account it was issued under.
const S = vi.hoisted(() => ({ gen: 1, lastSeen: 1, hooks: [] as Array<() => void> }));

vi.mock("../src/session-fetch.js", () => {
  const sessionFetch = vi.fn();
  return {
    hasValidSession: vi.fn(() => true),
    sessionFetch,
    beginAuthenticatedSession: vi.fn(async () => {
      const account = S.gen;
      return { fetch: (url: string) => sessionFetch(url, account) };
    }),
    captureSession: vi.fn(() => {
      if (S.gen !== S.lastSeen) { S.lastSeen = S.gen; S.hooks.forEach(h => h()); }
      return { gen: S.gen };
    }),
    assertSessionCurrent: vi.fn(),
    onSessionInvalidated: vi.fn((cb: () => void) => { S.hooks.push(cb); }),
    anonymousFetch: vi.fn(),
  };
});

vi.mock("../src/open5e.js", () => ({
  o5SearchMonstersSection: vi.fn(async () => ({ header: null, body: "O5 SEARCH RESULT", footer: null, hidden: 0, open5e: true })),
  o5GetMonster: vi.fn(async () => "O5 MONSTER RESULT"),
  o5GetMonsterStats: vi.fn(async () => ({ status: "not-found" })),
}));

import { searchMonsters, getMonster, clearMonsterCache } from "../src/tools/monster.js";
import { sessionFetch, assertSessionCurrent, captureSession } from "../src/session-fetch.js";

const response = (body: unknown) => ({ ok: true, status: 200, statusText: "", json: async () => body }) as unknown as Response;

const CONFIG = {
  data: {
    challengeRatings: [{ id: 3, value: 1, xp: 200, proficiencyBonus: 2 }],
    monsterTypes: [{ id: 16, name: "Undead" }],
    alignments: [],
    senses: [],
    sources: [{ id: 147, name: "MM-2024", description: "Monster Manual", sourceURL: "sources/dnd/mm-2024", sourceCategoryId: 24 }],
  },
};

// Only every tenth entry is CR 1 (id 3; id 4 isn't in the config), so a cr: 1
// search shows matches from every page rather than just the first page's 100.
const monster = (id: number, name: string) => ({
  id, name, alignmentId: 1, sizeId: 4, typeId: 16, armorClass: 10, averageHitPoints: 5,
  challengeRatingId: id % 10 === 1 ? 3 : 4,
  isHomebrew: false, isLegendary: false, isMythic: false, isLegacy: false, sourceId: 147,
  sources: [{ sourceId: 147, pageNumber: 1, sourceType: 1 }],
});

beforeEach(() => {
  S.gen = 1;
  S.lastSeen = 1;
  vi.clearAllMocks();
  clearMonsterCache();
  S.hooks.forEach(h => h());
  vi.mocked(assertSessionCurrent).mockImplementation(((snap: { gen: number }) => {
    if (snap.gen !== S.gen) throw new Error("session changed");
  }) as never);
  // 300 entries across three pages; each entry is named for the account that fetched it.
  vi.mocked(sessionFetch).mockImplementation((async (input: string, account: number) => {
    const url = String(input);
    if (url.includes("api/config/json")) return response(CONFIG);
    const skip = Number(new URL(url).searchParams.get("skip"));
    const data = Array.from({ length: 100 }, (_, i) => monster(skip + i + 1, `Account${account} Ghoul ${skip + i}`));
    return response({ pagination: { total: 300, currentPage: 1, pages: 3 }, data });
  }) as never);
});

describe("paged monster scans and account changes", () => {
  it("discards a scan whose pages straddle an account change, instead of merging two accounts", async () => {
    // Swap accounts right after the first page passes its own boundary check:
    // config is assert #1, the source index is assert #2, page one is assert #3.
    let asserts = 0;
    vi.mocked(assertSessionCurrent).mockImplementation(((snap: { gen: number }) => {
      if (snap.gen !== S.gen) throw new Error("session changed");
      if (++asserts === 3) S.gen = 2;
    }) as never);

    // The scan is abandoned, so the search falls back to Open5e rather than
    // returning a list built from both accounts.
    expect(await searchMonsters({ cr: 1 })).toBe("O5 SEARCH RESULT");
  });

  it("a scan within one account still returns every page", async () => {
    const result = await searchMonsters({ cr: 1 });
    expect(result).toContain("30 shown of 30 matching; checked 300 of 300");
    expect(result).not.toContain("Account2 ");
  });
});

describe("cached stat blocks and account changes", () => {
  it("does not serve the previous account's cached stat block after an account change", async () => {
    // One list entry; the detail endpoint answers with the account that asked.
    vi.mocked(sessionFetch).mockImplementation((async (input: string, account: number) => {
      const url = String(input);
      if (url.includes("api/config/json")) return response(CONFIG);
      if (url.includes("/v1/Monster?")) return response({ pagination: { total: 1, currentPage: 1, pages: 1 }, data: [monster(7, "Lich")] });
      return response({ accessType: 3, data: { ...monster(7, "Lich"), actionsDescription: `<p>Account${account} actions</p>` } });
    }) as never);
    expect(await getMonster("Lich")).toContain("Account1 actions");

    // Second lookup: config, source index and list come from cache; the
    // account changes right after the list lookup's boundary check (the call's
    // only assert before the stat block's cache read).
    let asserts = 0;
    vi.mocked(assertSessionCurrent).mockImplementation(((snap: { gen: number }) => {
      if (snap.gen !== S.gen) throw new Error("session changed");
      if (++asserts === 1) S.gen = 2;
    }) as never);
    const second = await getMonster("Lich");
    expect(second).not.toContain("Account1 actions");
    expect(second).toContain("Account2 actions");
  });
});

describe("cached monster lists and account changes", () => {
  it("re-fetches the list after an account change instead of reading the cached one", async () => {
    // Each account's list holds a different entry; the detail echoes the id it was asked for.
    vi.mocked(sessionFetch).mockImplementation((async (input: string, account: number) => {
      const url = String(input);
      if (url.includes("api/config/json")) return response(CONFIG);
      if (url.includes("/v1/Monster?")) return response({ pagination: { total: 1, currentPage: 1, pages: 1 }, data: [monster(account === 1 ? 7 : 8, "Lich")] });
      const id = Number(url.split("/").pop());
      return response({ accessType: 3, data: { ...monster(id, "Lich"), actionsDescription: `<p>Entry ${id}</p>` } });
    }) as never);
    expect(await getMonster("Lich")).toContain("Entry 7");

    // The account changes right after this call's config and source-index
    // lookups (captures #1–3: config, index, the index's config), so the list
    // lookup is the first to observe it.
    let captures = 0;
    vi.mocked(captureSession).mockImplementation((() => {
      if (S.gen !== S.lastSeen) { S.lastSeen = S.gen; S.hooks.forEach(h => h()); }
      const snap = { gen: S.gen };
      if (++captures === 3) S.gen = 2;
      return snap;
    }) as never);
    expect(await getMonster("Lich")).toContain("Entry 8");
  });
});

describe("the available-sources hint and account changes", () => {
  // The book filter (sources=6, Curse of Strahd) finds no Lich; the unfiltered
  // list, which the hint reads, files each account's Lich under a different book.
  beforeEach(() => {
    vi.mocked(sessionFetch).mockImplementation((async (input: string, account: number) => {
      const url = String(input);
      if (url.includes("api/config/json")) return response(CONFIG);
      if (url.includes("sources=")) return response({ pagination: { total: 0, currentPage: 1, pages: 1 }, data: [] });
      const sourceId = account === 1 ? 147 : 145;
      return response({ pagination: { total: 1, currentPage: 1, pages: 1 }, data: [{ ...monster(7, "Lich"), sourceId, sources: [{ sourceId, pageNumber: 1, sourceType: 1 }] }] });
    }) as never);
  });

  /** Switch accounts right after the call's own list passed its last boundary check (assert #4: config, index, list, merge). */
  function swapAfterFourthAssert(): void {
    let asserts = 0;
    vi.mocked(assertSessionCurrent).mockImplementation(((snap: { gen: number }) => {
      if (snap.gen !== S.gen) throw new Error("session changed");
      if (++asserts === 4) S.gen = 2;
    }) as never);
  }

  it("names the caller's account's book when nothing changes", async () => {
    expect(await getMonster("Lich", { source: "cos" })).toContain('Available sources for "Lich": Monster Manual [mm-2024].');
  });

  it("availableSourcesFor uses the caller's session snapshot", async () => {
    swapAfterFourthAssert();
    const get = await getMonster("Lich", { source: "cos" });
    expect(get).toContain('No "Lich" entry found in source "cos".');
    expect(get).not.toContain("Player’s Handbook");
    expect(get).not.toContain("Available sources");

    S.gen = 1; S.lastSeen = 1; clearMonsterCache(); S.hooks.forEach(h => h());
    swapAfterFourthAssert();
    const search = await searchMonsters({ name: "Lich", source: "cos" });
    expect(search).toContain("No monsters matching the search criteria in Curse of Strahd");
    expect(search).not.toContain("Player’s Handbook");
    expect(search).not.toContain("appears in");
  });
});
