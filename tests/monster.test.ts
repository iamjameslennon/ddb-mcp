import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before importing the module under test so vitest hoists them.

vi.mock("../src/session-fetch.js", () => ({
  hasValidSession: vi.fn(() => true),
  getCobaltToken: vi.fn(async () => ({ token: "tok", userId: "99" })),
  sessionFetch: vi.fn(),
}));

import { getMonster, searchMonsters, getMonsterStats, clearMonsterCache } from "../src/tools/monster.js";
import { sessionFetch } from "../src/session-fetch.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Trimmed from a real take=20 `/v1/Monster?search=Zombie` response, keeping
// both editions plus a source-exclusive entry (Strahd Zombie, CoS-only).

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
    challengeRatings: [{ id: 3, value: 0.25, xp: 50, proficiencyBonus: 2 }],
    monsterTypes: [{ id: 16, name: "Undead" }, { id: 1, name: "Beast" }],
    alignments: [{ id: 8, name: "Neutral Evil" }],
    senses: [{ id: 2, name: "Darkvision" }],
    sources: [
      { id: 5, name: "MM", description: "Monster Manual (2014)", sourceURL: "sources/dnd/mm-2014" },
      { id: 147, name: "MM-2024", description: "Monster Manual", sourceURL: "sources/dnd/mm-2024" },
      { id: 6, name: "CoS", description: "Curse of Strahd", sourceURL: "sources/dnd/cos" },
    ],
  },
};

function monster(overrides: Record<string, unknown>): Record<string, unknown> {
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
    isLegacy: true,
    sourceId: 5,
    sources: [{ sourceId: 5, pageNumber: 161, sourceType: 1 }],
    stats: [],
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

const ZOMBIE_2014 = monster({
  id: 17077,
  isLegacy: true,
  sourceId: 5,
  sources: [{ sourceId: 5, pageNumber: 161, sourceType: 1 }],
  averageHitPoints: 22,
  hitPointDice: { diceString: "3d8 + 9" },
  actionsDescription:
    "<p><em><strong>Slam.</strong> Melee Weapon Attack:</em> +3 to hit, reach 5 ft., one target. <em>Hit:</em> 4 (1d6 + 1) bludgeoning damage.</p>",
});

const ZOMBIE_2024 = monster({
  id: 4775851,
  isLegacy: false,
  sourceId: 147,
  sources: [
    { sourceId: 147, pageNumber: 346, sourceType: 1 },
    { sourceId: 145, pageNumber: null, sourceType: 2 },
  ],
  averageHitPoints: 15,
  hitPointDice: { diceString: "2d8 + 6" },
  actionsDescription:
    "<p><em><strong>Slam.</strong> Melee Attack Roll:</em> +3, reach 5 ft. <em>Hit:</em> 5 (1d8 + 1) Bludgeoning damage.</p>",
});

const STRAHD_ZOMBIE = monster({
  id: 17375,
  name: "Strahd Zombie",
  isLegacy: false,
  sourceId: 6,
  sources: [{ sourceId: 6, pageNumber: 241, sourceType: 1 }],
  averageHitPoints: 34,
  actionsDescription: "<p><em><strong>Rotting Claw.</strong></em></p>",
});

const WOLF_2014 = monster({
  id: 100, name: "Wolf", typeId: 1, isLegacy: true, sourceId: 5,
  sources: [{ sourceId: 5, pageNumber: 1, sourceType: 1 }],
  armorClass: 13, averageHitPoints: 11,
});

const WOLF_2024 = monster({
  id: 101, name: "Wolf", typeId: 1, isLegacy: false, sourceId: 147,
  sources: [{ sourceId: 147, pageNumber: 1, sourceType: 1 }],
  armorClass: 12, averageHitPoints: 11,
});

const ZOMBIE_LIST = [ZOMBIE_2014, ZOMBIE_2024, STRAHD_ZOMBIE];
const WOLF_LIST = [WOLF_2014, WOLF_2024];
const ALL_MONSTERS = [...ZOMBIE_LIST, ...WOLF_LIST];

function setupFetch(): void {
  vi.mocked(sessionFetch).mockImplementation(async (url: string) => {
    if (url.includes("api/config/json")) return mockResponse(CONFIG);

    if (url.includes("/v1/Monster?search=")) {
      const term = decodeURIComponent(url.match(/search=([^&]*)/)?.[1] ?? "").toLowerCase();
      let data: unknown[] = [];
      if (term.includes("zombie")) data = ZOMBIE_LIST;
      else if (term.includes("wolf")) data = WOLF_LIST;
      return mockResponse({ pagination: { total: data.length, currentPage: 1, pages: 1 }, data });
    }

    const idMatch = url.match(/\/v1\/Monster\/(\d+)/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      const found = ALL_MONSTERS.find(m => m.id === id);
      return mockResponse({ accessType: 3, data: found });
    }

    return mockResponse({}, 404);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("monster source filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMonsterCache();
    setupFetch();
  });

  it('getMonster("Zombie") with no source prefers the 2024 entry', async () => {
    const result = await getMonster("Zombie");
    expect(result).toContain("15");
    expect(result).toContain("Melee Attack Roll: +3");
    expect(result).toContain("1d8 + 1");
  });

  it('getMonster("Zombie", "mm-2014") returns the Legacy entry', async () => {
    const result = await getMonster("Zombie", "mm-2014");
    expect(result).toContain("22");
    expect(result).toContain("Melee Weapon Attack");
  });

  it('getMonster("Zombie", "mm-2024") returns HP 15', async () => {
    const result = await getMonster("Zombie", "mm-2024");
    expect(result).toContain("15");
  });

  it('getMonster("Strahd Zombie", "cos") resolves the CoS-only creature', async () => {
    const result = await getMonster("Strahd Zombie", "cos");
    expect(result).toContain("Strahd Zombie");
    expect(result).toContain("Rotting Claw");
  });

  it("a source matching no candidate errors and lists the available sources, without a silent fallback", async () => {
    const result = await getMonster("Zombie", "phb-2024");
    expect(result).toContain('No "Zombie" entry found in source "phb-2024"');
    expect(result).toContain("Monster Manual (2014)");
    expect(result).toContain("Monster Manual");
  });

  it("searchMonsters distinguishes same-named Wolf entries by source", async () => {
    const result = await searchMonsters({ name: "Wolf" });
    const lines = result.split("\n").filter(l => l.startsWith("- **Wolf"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toBe(lines[1]);
    expect(result).toContain("Legacy");
    expect(result).toContain("Monster Manual (2014)");
    expect(result).toContain("Monster Manual");
  });

  it("getMonsterStats picks the same (2024) entry getMonster would", async () => {
    const stats = await getMonsterStats("Zombie");
    expect(stats).not.toBeNull();
    expect(stats?.crValue).toBe(0.25);
    expect(stats?.name).toBe("Zombie");
  });

  it("cache: calls differing only by source do not collide", async () => {
    const r2024 = await getMonster("Zombie", "mm-2024");
    const r2014 = await getMonster("Zombie", "mm-2014");
    expect(r2024).toContain("15");
    expect(r2014).toContain("22");

    // Re-fetching in the opposite order must not return a stale cross-source result.
    clearMonsterCache();
    const r2014Again = await getMonster("Zombie", "mm-2014");
    const r2024Again = await getMonster("Zombie", "mm-2024");
    expect(r2014Again).toContain("22");
    expect(r2024Again).toContain("15");
  });
});
