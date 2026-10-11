import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before importing the module under test so vitest hoists them.

vi.mock("../src/session-fetch.js", () => {
  const sessionFetch = vi.fn();
  return {
    hasValidSession: vi.fn(() => true),
    sessionFetch,
    beginAuthenticatedSession: vi.fn(async () => ({ fetch: (url: string) => sessionFetch(url) })),
    captureSession: vi.fn(() => ({})),
    assertSessionCurrent: vi.fn(),
    onSessionInvalidated: vi.fn(),
  };
});

vi.mock("../src/open5e.js", () => ({
  o5SearchMonsters: vi.fn(async () => "O5 SEARCH RESULT"),
  o5GetMonster: vi.fn(async () => "O5 MONSTER RESULT"),
}));

import { getMonster, searchMonsters, getMonsterStats, clearMonsterCache } from "../src/tools/monster.js";
import { rateEncounter } from "../src/tools/encounter.js";
import { sessionFetch, hasValidSession, onSessionInvalidated } from "../src/session-fetch.js";
import { o5SearchMonsters, o5GetMonster } from "../src/open5e.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// IDs, source attribution, and categories mirror live monster-service / game
// config responses (Oct 2026). Notably the 2014 Zombie (17077) is filed under
// Basic Rules 2014 (source 1), not Monster Manual 2014 (source 5), and the
// 2024 Zombie lists PHB-2024 / Basic Rules 2024 as reprint sources.

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

const CONFIG = {
  data: {
    challengeRatings: [
      { id: 3, value: 0.25, xp: 50, proficiencyBonus: 2 },
      { id: 4, value: 0.5, xp: 100, proficiencyBonus: 2 },
      { id: 5, value: 1, xp: 200, proficiencyBonus: 2 },
      { id: 25, value: 20, xp: 25000, proficiencyBonus: 6 },
      { id: 26, value: 21, xp: 33000, proficiencyBonus: 7 },
    ],
    monsterTypes: [{ id: 16, name: "Undead" }, { id: 1, name: "Beast" }, { id: 11, name: "Ooze" }, { id: 8, name: "Humanoid" }],
    alignments: [{ id: 8, name: "Neutral Evil" }],
    senses: [{ id: 2, name: "Darkvision" }],
    sourceCategories: [
      { id: 1, name: "5e Expanded Rules" },
      { id: 24, name: "5.5e Core Rules" },
      { id: 26, name: "5e Core Rules" },
      { id: 38, name: "5.5e Expanded Rules" },
    ],
    sources: [
      { id: 1, name: "BR", description: "Basic Rules (2014)", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 26 },
      { id: 5, name: "MM", description: "Monster Manual (2014)", sourceURL: "sources/dnd/mm-2014", sourceCategoryId: 26 },
      { id: 6, name: "CoS", description: "Curse of Strahd", sourceURL: "sources/dnd/cos", sourceCategoryId: 1 },
      { id: 69, name: "VRGtR", description: "Van Richten’s Guide to Ravenloft", sourceURL: "sources/dnd/vrgtr", sourceCategoryId: 1 },
      { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
      { id: 147, name: "MM-2024", description: "Monster Manual", sourceURL: "sources/dnd/mm-2024", sourceCategoryId: 24 },
      { id: 148, name: "br-2024", description: "D&amp;D Beyond Basic Rules", sourceURL: "sources/dnd/br-2024", sourceCategoryId: 24 },
      // Shares its slug with Basic Rules (2014) — slugs are not unique.
      { id: 209, name: "BG3PC", description: "Baldur’s Gate 3: Premade Characters", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 26 },
      { id: 232, name: "RtHW", description: "Ravenloft: The Horrors Within", sourceURL: "sources/dnd/rthw", sourceCategoryId: 38 },
    ],
  },
};

function monster(overrides: Record<string, unknown>): Record<string, unknown> {
  const sourceId = (overrides.sourceId as number | undefined) ?? 1;
  return {
    id: 1,
    name: "Zombie",
    alignmentId: 8,
    sizeId: 4,
    typeId: 16,
    armorClass: 8,
    armorClassDescription: "",
    averageHitPoints: 22,
    hitPointDice: { diceString: "3d8 + 9" },
    passivePerception: 8,
    challengeRatingId: 3,
    isHomebrew: false,
    isLegendary: false,
    isMythic: false,
    isLegacy: false,
    sourceId,
    sources: [{ sourceId, pageNumber: 1, sourceType: 1 }],
    stats: [{ statId: 1, value: 13 }],
    savingThrows: [],
    senses: [],
    movements: [],
    languageDescription: "",
    languageNote: "",
    skillsHtml: "",
    specialTraitsDescription: "",
    actionsDescription: "",
    reactionsDescription: "",
    legendaryActionsDescription: "",
    mythicActionsDescription: "",
    bonusActionsDescription: "",
    ...overrides,
  };
}

const sources = (...ids: number[]) => ids.map((sourceId, i) => ({ sourceId, pageNumber: null, sourceType: i === 0 ? 1 : 2 }));

const ZOMBIE_2014 = monster({
  id: 17077, isLegacy: true, sourceId: 1, sources: sources(1),
  averageHitPoints: 22, hitPointDice: { diceString: "3d8 + 9" },
  actionsDescription: "<p><em><strong>Slam.</strong> Melee Weapon Attack:</em> +3 to hit. <em>Hit:</em> 4 (1d6 + 1) bludgeoning damage.</p>",
});
const ZOMBIE_2024 = monster({
  id: 4775851, isLegacy: false, sourceId: 147, sources: sources(147, 148, 145),
  averageHitPoints: 15, hitPointDice: { diceString: "2d8 + 6" },
  actionsDescription: "<p><em><strong>Slam.</strong> Melee Attack Roll:</em> +3. <em>Hit:</em> 5 (1d8 + 1) Bludgeoning damage.</p>",
});
// A homebrew "Zombie" with the lowest ID — must never outrank official entries.
const ZOMBIE_HOMEBREW = monster({
  id: 5, isHomebrew: true, sourceId: 147, sources: sources(147),
  averageHitPoints: 99, actionsDescription: "<p>HOMEBREW SLAM</p>",
});
const STRAHD_ZOMBIE = monster({
  id: 17375, name: "Strahd Zombie", sourceId: 6, sources: sources(6),
  averageHitPoints: 30, actionsDescription: "<p><em><strong>Rotting Claw.</strong></em></p>",
});
const ZOMBIE_CLOT_2014 = monster({ id: 70000, name: "Zombie Clot", isLegacy: true, sourceId: 69, sources: sources(69), actionsDescription: "<p>CLOT 2014</p>" });
const ZOMBIE_CLOT_2024 = monster({ id: 90000, name: "Zombie Clot", sourceId: 232, sources: sources(232), actionsDescription: "<p>CLOT 2024</p>" });

// Same non-Legacy name in a core book and an adventure reprint; the adventure
// copy has the lower ID, so only the core-category tie-break picks MM-2024.
const OOZE_CORE = monster({
  id: 800, name: "Psychic Gray Ooze", typeId: 11, sourceId: 147, sources: sources(147),
  challengeRatingId: 5, actionsDescription: "<p>CORE OOZE</p>",
});
const OOZE_ADVENTURE = monster({
  id: 700, name: "Psychic Gray Ooze", typeId: 11, sourceId: 232, sources: sources(232),
  challengeRatingId: 5, actionsDescription: "<p>ADVENTURE OOZE</p>",
});
const OOZE_2014 = monster({
  id: 600, name: "Psychic Gray Ooze", typeId: 11, isLegacy: true, sourceId: 1, sources: sources(1),
  challengeRatingId: 4, actionsDescription: "<p>LEGACY OOZE</p>",
});

const BUGBEAR_2014 = monster({ id: 16820, name: "Bugbear", typeId: 8, isLegacy: true, sourceId: 1, sources: sources(1), actionsDescription: "<p>LEGACY BUGBEAR</p>" });
// Legacy-only tie: an adventure copy with a lower ID, so the Core Rules tie-break decides.
const BUGBEAR_ADVENTURE = monster({ id: 300, name: "Bugbear", typeId: 8, isLegacy: true, sourceId: 6, sources: sources(6), actionsDescription: "<p>ADVENTURE BUGBEAR</p>" });

const BEHOLDER_2014 = monster({ id: 16800, name: "Beholder", isLegacy: true, sourceId: 5, sources: sources(5), actionsDescription: "<p>LEGACY BEHOLDER</p>" });
const BEHOLDER_2024 = monster({ id: 4775000, name: "Beholder", sourceId: 147, sources: sources(147), actionsDescription: "<p>2024 BEHOLDER</p>" });

// Unowned content: the detail endpoint returns accessType 4 with no stats.
const VAMPIRE_SPAWN_COS = monster({ id: 17400, name: "Vampire Spawn", sourceId: 6, sources: sources(6), stats: [], actionsDescription: "" });

// A homebrew entry carrying a book's source ID — its user-authored name must not leak into messages.
const HOMEBREW_IN_BOOK = monster({ id: 9, name: "Zombie <b>Overlord</b> HB", isHomebrew: true, sourceId: 5, sources: sources(5) });

// Paging fixtures: 650 MM-2024 fillers with a CR 20 target after the first
// 100-entry page and a CR 21 target beyond the 600-entry scan cap.
const FILLERS = Array.from({ length: 650 }, (_, i) => monster({
  id: 1_000_000 + i, name: `Filler ${String(i).padStart(3, "0")}`, sourceId: 147, sources: sources(147),
}));
const CR20_TARGET = monster({ id: 2_000_000, name: "Filler Colossus", typeId: 11, sourceId: 147, sources: sources(147), challengeRatingId: 25 });
const CR21_TARGET = monster({ id: 2_000_001, name: "Filler Titan", sourceId: 147, sources: sources(147), challengeRatingId: 26 });

const WOLF_2014 = monster({ id: 100, name: "Wolf", typeId: 1, isLegacy: true, sourceId: 1, sources: sources(1), armorClass: 13, averageHitPoints: 11 });
const WOLF_2024 = monster({ id: 101, name: "Wolf", typeId: 1, sourceId: 147, sources: sources(147), armorClass: 12, averageHitPoints: 11 });

const ALL_MONSTERS = [
  ZOMBIE_2014, ZOMBIE_2024, ZOMBIE_HOMEBREW, STRAHD_ZOMBIE, ZOMBIE_CLOT_2014, ZOMBIE_CLOT_2024,
  OOZE_CORE, OOZE_ADVENTURE, OOZE_2014, BUGBEAR_2014, BUGBEAR_ADVENTURE, WOLF_2014, WOLF_2024,
  BEHOLDER_2014, BEHOLDER_2024, VAMPIRE_SPAWN_COS, HOMEBREW_IN_BOOK,
  ...FILLERS.slice(0, 120), CR20_TARGET, ...FILLERS.slice(120), CR21_TARGET,
];
const UNOWNED_IDS = new Set([VAMPIRE_SPAWN_COS.id]);

// Queries no name contains, for which the live service still ranks the
// intended monster first (verified: "Beholdr" → Beholder, "red dragon adult"
// → Adult Red Dragon). Followed by a lower-ranked unrelated hit.
const FUZZY: Record<string, unknown[]> = {
  beholdr: [BEHOLDER_2014, BEHOLDER_2024, WOLF_2024],
};

// monster.ts registers one invalidation hook at import; it is the only way to
// drop the module-level game-config singleton between tests.
const invalidateMonsterModule = vi.mocked(onSessionInvalidated).mock.calls[0][0] as () => void;

// The live service returns same-query results in a different order between
// requests. Emulate that: `reverseOrder` flips the result order.
let reverseOrder = false;
let configAvailable = true;
let configWithoutSources = false;
let failUnfilteredSearch = false;
const listUrls: string[] = [];

function setupFetch(): void {
  vi.mocked(sessionFetch).mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api/config/json")) {
      if (!configAvailable) return mockResponse({}, 503);
      if (configWithoutSources) return mockResponse({ data: { ...CONFIG.data, sources: undefined } });
      return mockResponse(CONFIG);
    }

    if (url.includes("/v1/Monster?search=")) {
      listUrls.push(url);
      const params = new URL(url).searchParams;
      const term = (params.get("search") ?? "").toLowerCase();
      // The live service silently caps take at 100.
      const take = Math.min(Number(params.get("take") ?? "20"), 100);
      const skip = Number(params.get("skip") ?? "0");
      const wanted = params.getAll("sources").map(Number);
      if (failUnfilteredSearch && !wanted.length) return mockResponse({}, 500);
      let data = ALL_MONSTERS.filter(m => (m.name as string).toLowerCase().includes(term));
      let fuzzy = false;
      if (!data.length && FUZZY[term]) { data = FUZZY[term] as typeof data; fuzzy = true; }
      if (wanted.length) {
        data = data.filter(m => (m.sources as Array<{ sourceId: number }>).some(s => wanted.includes(s.sourceId)));
      }
      if (reverseOrder) {
        // Live, the relevance-ranked top hit stays put across requests; only
        // equal-rank entries (edition twins) swap. Plain matches reorder freely.
        data = fuzzy ? [data[1], data[0], ...data.slice(2)] : [...data].reverse();
      }
      return mockResponse({ pagination: { total: data.length, currentPage: 1, pages: 1 }, data: data.slice(skip, skip + take) });
    }

    const idMatch = url.match(/\/v1\/Monster\/(\d+)/);
    if (idMatch) {
      const found = ALL_MONSTERS.find(m => m.id === Number(idMatch[1]));
      if (found && UNOWNED_IDS.has(found.id as number)) return mockResponse({ accessType: 4, data: found });
      return mockResponse({ accessType: 3, data: found });
    }

    return mockResponse({}, 404);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasValidSession).mockReturnValue(true);
  clearMonsterCache();
  invalidateMonsterModule();
  reverseOrder = false;
  configAvailable = true;
  configWithoutSources = false;
  failUnfilteredSearch = false;
  listUrls.length = 0;
  setupFetch();
});

// ── Default selection ─────────────────────────────────────────────────────────

describe.each([false, true])("default selection (reversed API order: %s)", (reversed) => {
  beforeEach(() => { reverseOrder = reversed; });

  it('getMonster("Zombie") picks the official 2024 entry', async () => {
    const result = await getMonster("Zombie");
    expect(result).toContain("**Hit Points** 15 (2d8 + 6)");
    expect(result).toContain("1d8 + 1");
    expect(result).not.toContain("HOMEBREW");
  });

  it("prefers a 2024 adventure entry over the Legacy one", async () => {
    expect(await getMonster("Zombie Clot")).toContain("CLOT 2024");
  });

  it("among non-Legacy entries, prefers the Core Rules book over an adventure reprint", async () => {
    expect(await getMonster("Psychic Gray Ooze")).toContain("CORE OOZE");
  });

  it("falls back to Legacy when that is the only edition, still preferring the Core Rules copy", async () => {
    expect(await getMonster("Bugbear")).toContain("LEGACY BUGBEAR");
  });

  it("when no name contains the query, uses DDB's top hit's name, then ranks that name's entries", async () => {
    const result = await getMonster("Beholdr");
    expect(result).toContain("2024 BEHOLDER");
    expect(o5GetMonster).not.toHaveBeenCalled();
  });

  it("getMonsterStats picks the same entry getMonster would, and the Legacy one when asked", async () => {
    expect(await getMonsterStats("Psychic Gray Ooze")).toEqual({ name: "Psychic Gray Ooze", crValue: 1, xp: 200 });
    expect(await getMonsterStats("Psychic Gray Ooze", { preferLegacy: true })).toEqual({ name: "Psychic Gray Ooze", crValue: 0.5, xp: 100 });
  });
});

it("rateEncounter with 2014 rules uses the Legacy CR; 2024 rules use the 2024 CR", async () => {
  const party = [{ count: 4, level: 1 }];
  expect(await rateEncounter(party, [{ name: "Psychic Gray Ooze" }], "2014")).toContain("CR 1/2");
  expect(await rateEncounter(party, [{ name: "Psychic Gray Ooze" }], "2024")).toContain("CR 1");
});

// ── getMonster with source ────────────────────────────────────────────────────

describe("getMonster source filter", () => {
  it("filters server-side with every ID the slug resolves to", async () => {
    const result = await getMonster("Zombie", "basic-rules-2014");
    expect(result).toContain("**Hit Points** 22 (3d8 + 9)");
    expect(listUrls[0]).toContain("&sources=1&sources=209");
  });

  it("accepts the short name or full title as well as the slug", async () => {
    expect(await getMonster("Zombie", "BR")).toContain("**Hit Points** 22");
    expect(await getMonster("Zombie", "Basic Rules (2014)")).toContain("**Hit Points** 22");
    expect(await getMonster("Zombie", "MM-2024")).toContain("**Hit Points** 15");
  });

  it("matches reprint sources, not just the primary book", async () => {
    expect(await getMonster("Zombie", "phb-2024")).toContain("**Hit Points** 15");
    expect(await getMonster("Zombie", "D&D Beyond Basic Rules")).toContain("**Hit Points** 15");
  });

  it("resolves a source-exclusive creature", async () => {
    const result = await getMonster("Strahd Zombie", "cos");
    expect(result).toContain("Rotting Claw");
  });

  it("a book without the monster errors with the books that have it — no Open5e or other-edition fallback", async () => {
    const result = await getMonster("Zombie", "mm-2014");
    expect(result).toContain('No "Zombie" entry found in source "mm-2014"');
    expect(result).toContain("Monster Manual [mm-2024]");
    expect(result).toContain("Basic Rules (2014) [basic-rules-2014]");
    expect(result).not.toContain("**Hit Points**");
    expect(o5GetMonster).not.toHaveBeenCalled();
  });

  it("requires an exact name within a source, offering near names instead of substituting one", async () => {
    const result = await getMonster("Zombie", "cos");
    expect(result).toContain('No "Zombie" entry found in source "cos"');
    expect(result).toContain("Similar names in that source: Strahd Zombie");
    expect(result).not.toContain("Rotting Claw");
  });

  it("does not let homebrew names into the similar-names hint", async () => {
    const result = await getMonster("Zombie", "mm-2014");
    expect(result).not.toContain("Overlord");
  });

  it("still reports the missing book when the follow-up all-sources search fails", async () => {
    failUnfilteredSearch = true;
    const result = await getMonster("Zombie", "mm-2014");
    expect(result).toContain('No "Zombie" entry found in source "mm-2014"');
    expect(o5GetMonster).not.toHaveBeenCalled();
  });

  it("unowned content in the requested book returns DDB's restricted block, not an Open5e substitute", async () => {
    const result = await getMonster("Vampire Spawn", "cos");
    expect(result).toContain("# Vampire Spawn");
    expect(result).toContain("requires ownership");
    expect(o5GetMonster).not.toHaveBeenCalled();
  });

  it("unowned content without a source still falls back to Open5e", async () => {
    expect(await getMonster("Vampire Spawn")).toBe("O5 MONSTER RESULT");
  });

  it("a config with no sources list is treated as unavailable, not as an unknown source", async () => {
    configWithoutSources = true;
    const result = await getMonster("Zombie", "mm-2024");
    expect(result).not.toContain("Unknown source");
    expect(result).toContain("O5 MONSTER RESULT");
    expect(result).toContain("could not be honoured");
  });

  it("an unknown source errors with suggestions before any monster request", async () => {
    const result = await getMonster("Zombie", "strahd");
    expect(result).toContain('Unknown source "strahd"');
    expect(result).toContain("Curse of Strahd [cos]");
    expect(listUrls).toHaveLength(0);
    expect(o5GetMonster).not.toHaveBeenCalled();
  });

  it("an unknown source with no near match points at the bracketed short codes", async () => {
    const result = await getMonster("Zombie", "zzz");
    expect(result).toContain('Unknown source "zzz"');
    expect(result).toContain("short code");
  });

  it("calls differing only by source do not share a cache entry", async () => {
    expect(await getMonster("Zombie", "mm-2024")).toContain("**Hit Points** 15");
    expect(await getMonster("Zombie", "basic-rules-2014")).toContain("**Hit Points** 22");
    expect(await getMonster("Zombie", "mm-2024")).toContain("**Hit Points** 15");
  });

  it("falls back to Open5e with a caveat when DDB's source list is unavailable", async () => {
    configAvailable = false;
    const result = await getMonster("Zombie", "mm-2024");
    expect(result).toContain("O5 MONSTER RESULT");
    expect(result).toContain('"mm-2024" was requested but could not be honoured');
  });

  it("falls back to Open5e with a caveat when logged out", async () => {
    vi.mocked(hasValidSession).mockReturnValue(false);
    const result = await getMonster("Zombie", "mm-2024");
    expect(result).toContain("O5 MONSTER RESULT");
    expect(result).toContain("could not be honoured");
  });
});

// ── searchMonsters ────────────────────────────────────────────────────────────

describe("searchMonsters", () => {
  it("labels each entry with its source and a Legacy tag", async () => {
    const result = await searchMonsters({ name: "Wolf" });
    const lines = result.split("\n").filter(l => l.startsWith("- **Wolf"));
    expect(lines).toHaveLength(2);
    expect(result).toMatch(/\*\*Wolf\*\* \[Legacy\] — Basic Rules \(2014\) \[basic-rules-2014\]/);
    expect(result).toMatch(/\*\*Wolf\*\* — Monster Manual \[mm-2024\]/);
  });

  it("filters by source server-side, including source-only searches", async () => {
    const result = await searchMonsters({ source: "cos" });
    expect(result).toContain("Strahd Zombie");
    expect(result).not.toContain("**Zombie**");
    expect(result).toContain("3 total matched by name and source");
    expect(listUrls[0]).toContain("take=100&sources=6");
  });

  it("no match in the requested book reports where the name does appear — no Open5e fallback", async () => {
    const result = await searchMonsters({ name: "Wolf", source: "cos" });
    expect(result).toContain("No monsters matching the search criteria in Curse of Strahd [cos]");
    expect(result).toContain('"Wolf" appears in:');
    expect(result).toContain("Monster Manual [mm-2024]");
    expect(o5SearchMonsters).not.toHaveBeenCalled();
  });

  it("an unknown source errors instead of returning unfiltered results", async () => {
    const result = await searchMonsters({ name: "Wolf", source: "nope-1999" });
    expect(result).toContain('Unknown source "nope-1999"');
    expect(result).not.toContain("**Wolf**");
    expect(o5SearchMonsters).not.toHaveBeenCalled();
  });

  it("labels a reprint with the requested book when its primary source differs", async () => {
    const result = await searchMonsters({ name: "Zombie", source: "phb-2024" });
    expect(result).toContain("**Zombie** — Monster Manual [mm-2024], reprinted in Player’s Handbook [phb-2024]");
  });

  it("pages past the first 100 entries while CR/type/size filters are active", async () => {
    const result = await searchMonsters({ source: "mm-2024", cr: 20 });
    expect(result).toContain("Filler Colossus");
    expect(listUrls.some(u => u.includes("skip=100"))).toBe(true);
  });

  it("builds the header from the filtered count, not the server total", async () => {
    const result = await searchMonsters({ source: "mm-2024", cr: 20 });
    expect(result).toContain("1 shown of 1 matching");
    expect(result).not.toMatch(/1 shown, \d+ total matched/);
  });

  it("says honestly when the scan cap stopped short of the full result set", async () => {
    const result = await searchMonsters({ source: "mm-2024", cr: 21 });
    expect(result).toContain("No monsters matching the search criteria in Monster Manual [mm-2024]");
    expect(result).toMatch(/checked the first 600 of \d+ entries/);
    expect(o5SearchMonsters).not.toHaveBeenCalled();
  });

  it("flags a partial scan in the header when some entries matched", async () => {
    const result = await searchMonsters({ source: "mm-2024", type: "ooze" });
    expect(result).toContain("Filler Colossus");
    expect(result).toMatch(/Only the first 600 of \d+ were checked/);
  });

  it("a config with no sources list falls back to Open5e with a caveat", async () => {
    configWithoutSources = true;
    const result = await searchMonsters({ name: "Wolf", source: "mm-2024" });
    expect(result).toContain("O5 SEARCH RESULT");
    expect(result).toContain("could not be honoured");
  });

  it("without a source, an empty DDB result still falls back to Open5e", async () => {
    const result = await searchMonsters({ name: "Tarrasque" });
    expect(result).toBe("O5 SEARCH RESULT");
  });

  it("logged out with a source, the Open5e result carries a caveat", async () => {
    vi.mocked(hasValidSession).mockReturnValue(false);
    const result = await searchMonsters({ name: "Wolf", source: "mm-2024" });
    expect(result).toContain("O5 SEARCH RESULT");
    expect(result).toContain("could not be honoured");
  });
});
