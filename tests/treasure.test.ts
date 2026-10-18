import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTreasure } from "../src/tools/treasure.js";
import { MAX_TREASURE_OUTPUT_CHARS } from "../src/treasure-limits.js";

vi.mock("../src/tools/monster.js", () => ({
  getMonsterStats: vi.fn(),
}));

import { getMonsterStats, type MonsterStatsResult } from "../src/tools/monster.js";
const mockGetMonsterStats = vi.mocked(getMonsterStats);

const MM_2024 = { ruleset: "2024", book: "Monster Manual (2024)" } as const;
const found = (name: string, crValue: number, xp: number): MonsterStatsResult =>
  ({ status: "found", name, crValue, xp, info: MM_2024 });
const NOT_FOUND: MonsterStatsResult = { status: "not-found" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

// ── 1. Individual CR 0–4 ──────────────────────────────────────────────────────

describe("individual CR 0-4", () => {
  it("returns INDIVIDUAL TREASURE with a Roll 1 ending in gp, no ep", async () => {
    // Math.random → 0.5: each d6 = floor(0.5×6)+1 = 4 → 3d6 = 12 gp
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = await generateTreasure({ cr: 1, treasureType: "individual" });
    expect(result).toContain("INDIVIDUAL TREASURE");
    expect(result).toContain("Roll 1: 12 gp");
    expect(result).not.toContain(" ep");
  });
});

// ── 2. Individual CR 5–10 ─────────────────────────────────────────────────────

describe("individual CR 5-10", () => {
  it("returns gp as multiple of 10", async () => {
    // Math.random → 0.5: each d8 = floor(0.5×8)+1 = 5 → 2d8×10 = 2×5×10 = 100 gp
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = await generateTreasure({ cr: 7, treasureType: "individual" });
    expect(result).toContain("gp");
    expect(result).not.toContain(" ep");
    // 100 gp → divisible by 10
    const match = result.match(/Roll 1: (\d+) gp/);
    expect(match).not.toBeNull();
    expect(Number(match![1]) % 10).toBe(0);
  });
});

// ── 3. Individual CR 11–16 ────────────────────────────────────────────────────

describe("individual CR 11-16", () => {
  it("returns pp not gp", async () => {
    // Math.random → 0.5: each d10 = floor(0.5×10)+1 = 6 → 2d10×10 = 2×6×10 = 120 pp
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = await generateTreasure({ cr: 12, treasureType: "individual" });
    expect(result).toContain("pp");
    expect(result).toContain("Roll 1: 120 pp");
  });
});

// ── 4. Individual CR 17+ ──────────────────────────────────────────────────────

describe("individual CR 17+", () => {
  it("returns pp result", async () => {
    // Math.random → 0.5: each d8 = 5 → 2d8×100 = 2×5×100 = 1,000 pp
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = await generateTreasure({ cr: 20, treasureType: "individual" });
    expect(result).toContain("pp");
    expect(result).toContain("Roll 1: 1,000 pp");
  });
});

// ── 5. Hoard — no character level ────────────────────────────────────────────

describe("hoard without character_level", () => {
  it("contains TREASURE HOARD, COINS, gp, and the no-magic-items prompt", async () => {
    const result = await generateTreasure({ cr: 2, treasureType: "hoard" });
    expect(result).toContain("TREASURE HOARD");
    expect(result).toContain("COINS");
    expect(result).toContain("gp");
    expect(result).toContain("(provide character_level to include magic items)");
    expect(result).not.toContain("MAGIC ITEMS");
  });
});

// ── 6. Hoard CR 2 with character level, itemCount = 0 ────────────────────────

describe("hoard CR 2 with character level — zero items rolled", () => {
  it("shows '0 rolled (no items this hoard)' and no item lines", async () => {
    // Tier 0-4: 2d4×100 gp, then 1d4-1 items.
    // We need 1d4-1 = 0, so the d4 must roll 1 → Math.random must return 0
    // for that specific call. Easier: sequence the calls.
    // Calls order for tier 0-4 hoard:
    //   roll(2,4) for coins → 2 calls
    //   roll(1,4) for items → 1 call (we want this to be 0 → floor(r×4)+1 = 1 → r = 0)
    let callCount = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return 0.5;  // coin dice: d4 → 3 each → 2×3×100 = 600 gp
      return 0;                         // item die: floor(0×4)+1 = 1 → 1-1 = 0 items
    });
    const result = await generateTreasure({ cr: 2, treasureType: "hoard", characterLevel: 3 });
    expect(result).toContain("0 rolled (no items this hoard)");
    expect(result).not.toMatch(/^\s+\d+\.\s/m);
  });
});

// ── 7. Hoard CR 8 with character level ───────────────────────────────────────

describe("hoard CR 8 with character level", () => {
  it("contains MAGIC ITEMS section with at least one item line", async () => {
    const result = await generateTreasure({ cr: 8, treasureType: "hoard", characterLevel: 7 });
    expect(result).toContain("TREASURE HOARD");
    expect(result).toContain("gp");
    expect(result).toContain("MAGIC ITEMS");
    // At least one numbered item
    expect(result).toMatch(/\d+\. .+\[.+ – .+\]/);
  });
});

// ── 8. Hoard CR 8 coin math ───────────────────────────────────────────────────

describe("hoard CR 8 coin math", () => {
  it("with Math.random=0.5, produces 4,800 gp and TOTAL VALUE ~4,800 gp", async () => {
    // Tier 5-10: 8d10×100 gp → each d10 = floor(0.5×10)+1 = 6 → 8×6×100 = 4,800 gp
    // itemCount: 1d3 → floor(0.5×3)+1 = 2 items
    // Then 2 magic item rolls: d100, category, item each — all Math.random=0.5
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = await generateTreasure({ cr: 8, treasureType: "hoard" });
    expect(result).toContain("4,800 gp");
    expect(result).toContain("~4,800 gp");
  });
});

// ── 9. Magic items — level 1-4 table (d100=54 → common) ─────────────────────

describe("magic items — level 1-4 rarity", () => {
  it("d100 result 54 maps to Common rarity", async () => {
    // Level 1-4 table: 1–54 = common
    // Call sequence for hoard tier 0-4 with character level 1:
    //   coin: roll(2,4) → 2 calls
    //   item count: roll(1,4) → 1 call (need ≥ 1 item: return 0.5 → floor(0.5×4)+1 = 3 → 3-1 = 2 items)
    //   per item: d100 (rarity), category pick, item pick
    // We force d100 to land at 54 → common by returning 0.53 (floor(0.53×100)+1 = 54)
    let callCount = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return 0.5;   // coins
      if (callCount === 3) return 0.5;  // item count: 1d4 → 3 → 3-1 = 2 items
      // For each item: d100 call → 0.53 → 54 (common), then category, then item pick
      return 0.53;
    });
    const result = await generateTreasure({ cr: 2, treasureType: "hoard", characterLevel: 1 });
    expect(result).toContain("Common");
  });
});

// ── 10. Magic items — level 17-20 table (d100=65 → legendary) ───────────────

describe("magic items — level 17-20 rarity", () => {
  it("d100 result 65 maps to Legendary rarity", async () => {
    // Level 17-20 table: 65–100 = legendary
    // Tier 17+ hoard: 6d10×10000 gp (6 calls), then 1d6 items (1 call, return 0.5 → 4 items)
    // Per item: d100 → 0.64 → floor(0.64×100)+1 = 65 (legendary), category, item
    let callCount = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      callCount++;
      if (callCount <= 6) return 0.5;  // coin: 6d10
      if (callCount === 7) return 0.5; // itemCount: 1d6 → 4
      // d100 for rarity: 0.64 → 65 (legendary), then category pick (0.5), item pick (0.5)
      return 0.64;
    });
    const result = await generateTreasure({ cr: 20, treasureType: "hoard", characterLevel: 18 });
    expect(result).toContain("Legendary");
  });
});

// ── 11. Monster resolution — hoard ───────────────────────────────────────────

describe("monster resolution — hoard", () => {
  it("uses highest CR for tier selection", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Ogre", 2, 450))
      .mockResolvedValueOnce(found("Hill Giant", 5, 1800));

    const result = await generateTreasure({
      monsters: [{ name: "Ogre", count: 1 }, { name: "Hill Giant", count: 1 }],
      treasureType: "hoard",
      characterLevel: 5,
    });

    expect(result).toContain("TREASURE HOARD");
    expect(result).toContain("tier 5-10");
    expect(result).toContain("using highest CR");
    expect(result).toContain("CR 5");
  });
});

// ── 12. Monster resolution — individual ──────────────────────────────────────

describe("monster resolution — individual", () => {
  it("rolls once per monster instance, shows separate roll lines", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Goblin", 0.25, 50))
      .mockResolvedValueOnce(found("Hobgoblin", 1, 200));

    const result = await generateTreasure({
      monsters: [{ name: "Goblin", count: 2 }, { name: "Hobgoblin", count: 1 }],
      treasureType: "individual",
    });

    expect(result).toContain("INDIVIDUAL TREASURE");
    expect(result).toContain("3 monsters");
    expect(result).toContain("Roll 1:");
    expect(result).toContain("Roll 2:");
    expect(result).toContain("COINS (combined)");
  });
});

// ── 13. Partial resolution ───────────────────────────────────────────────────

describe("partial resolution", () => {
  it("shows ✗ for unresolved monster but still rolls with resolved one", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Ogre", 2, 450))
      .mockResolvedValueOnce(NOT_FOUND);

    const result = await generateTreasure({
      monsters: [{ name: "Ogre", count: 1 }, { name: "Blarg the Destroyer", count: 1 }],
      treasureType: "hoard",
    });

    expect(result).toContain('✗ "Blarg the Destroyer"');
    expect(result).toContain("✓ Ogre");
    expect(result).toContain("TREASURE HOARD");
    expect(result).toContain("COINS");
  });
});

// ── 14. All unresolved ───────────────────────────────────────────────────────

describe("all unresolved", () => {
  it("returns error without rolling coins", async () => {
    mockGetMonsterStats.mockResolvedValue(NOT_FOUND);

    const result = await generateTreasure({
      monsters: [{ name: "Fake A", count: 1 }, { name: "Fake B", count: 1 }],
      treasureType: "hoard",
    });

    expect(result).toContain("could not resolve all monsters");
    expect(result).not.toContain("COINS");
    expect(result).not.toContain("TOTAL VALUE");
  });
});

// ── 15. Validation errors ─────────────────────────────────────────────────────

describe("validation", () => {
  it("returns error when neither cr nor monsters provided", async () => {
    const result = await generateTreasure({ treasureType: "hoard" });
    expect(result).toContain("Error:");
  });

  it("returns error when both cr and monsters provided", async () => {
    mockGetMonsterStats.mockResolvedValue(found("Goblin", 0.25, 50));
    const result = await generateTreasure({
      cr: 5,
      monsters: [{ name: "Goblin", count: 1 }],
      treasureType: "hoard",
    });
    expect(result).toContain("Error:");
  });
});

// ── 16. Work-budget rejections (rejected before any lookup or roll) ─────────
//
// All just-over-limit values here are small (101, 21 entries, 201 chars) so
// the pre-guard implementation cannot exhaust the test process while these
// are RED.

describe("treasure work-budget rejections", () => {
  it("rejects excess individual work before monster lookup", async () => {
    const result = await generateTreasure({
      monsters: [{ name: "Goblin", count: 101 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("rejects 20 entries whose aggregate count is 101", async () => {
    const monsters = Array.from({ length: 20 }, (_, i) => ({
      name: `Monster${i}`,
      count: i < 19 ? 5 : 6, // 19*5 + 6 = 101
    }));
    const result = await generateTreasure({ monsters, treasureType: "individual" });
    expect(result).toMatch(/^Error: /);
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("rejects 21 monster entries", async () => {
    const monsters = Array.from({ length: 21 }, (_, i) => ({ name: `Monster${i}`, count: 1 }));
    const result = await generateTreasure({ monsters, treasureType: "individual" });
    expect(result).toMatch(/^Error: /);
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("rejects an overlong monster name", async () => {
    const result = await generateTreasure({
      monsters: [{ name: "X".repeat(201), count: 1 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("rejects zero, negative, fractional, and unsafe-integer counts", async () => {
    // Routed through generateTreasure only because its early guard now
    // exists — these values would be unsafe to loop over otherwise.
    for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await generateTreasure({
        monsters: [{ name: "Goblin", count }],
        treasureType: "individual",
      });
      expect(result).toMatch(/^Error: /);
    }
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("rejects an empty monster list before any lookup", async () => {
    const result = await generateTreasure({ monsters: [], treasureType: "individual" });
    expect(result).toMatch(/^Error: /);
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("rejects duplicate-name aggregate overflow before deduplication", async () => {
    // 60 + 60 = 120 raw rolls requested, even though both entries share a
    // name and would dedupe to a single lookup.
    const result = await generateTreasure({
      monsters: [
        { name: "Goblin", count: 60 },
        { name: "Goblin", count: 60 },
      ],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
    expect(mockGetMonsterStats).not.toHaveBeenCalled();
  });

  it("does not apply the aggregate roll budget to hoard requests", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Goblin", 0.25, 50))
      .mockResolvedValueOnce(found("Hobgoblin", 1, 200));
    const result = await generateTreasure({
      monsters: [
        { name: "Goblin", count: 60 },
        { name: "Hobgoblin", count: 60 },
      ],
      treasureType: "hoard",
    });
    expect(result).toContain("TREASURE HOARD");
    expect(mockGetMonsterStats).toHaveBeenCalledTimes(2);
  });
});

// ── 17. Accepted at-budget requests ──────────────────────────────────────────

describe("treasure at exactly the roll budget", () => {
  it("performs exactly 100 rolls and stays within the output budget", async () => {
    mockGetMonsterStats.mockResolvedValueOnce(found("Goblin", 0.25, 50));
    const result = await generateTreasure({
      monsters: [{ name: "Goblin", count: 100 }],
      treasureType: "individual",
    });
    expect(result).toContain("INDIVIDUAL TREASURE");
    const rollLines = result.match(/Roll \d+:/g) ?? [];
    expect(rollLines.length).toBe(100);
    expect(result.length).toBeLessThanOrEqual(MAX_TREASURE_OUTPUT_CHARS);
  });

  it("accepts mixed entries whose counts sum to exactly 100", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Goblin", 0.25, 50))
      .mockResolvedValueOnce(found("Hobgoblin", 1, 200))
      .mockResolvedValueOnce(found("Bugbear", 1, 200));

    const result = await generateTreasure({
      monsters: [
        { name: "Goblin", count: 40 },
        { name: "Hobgoblin", count: 35 },
        { name: "Bugbear", count: 25 },
      ],
      treasureType: "individual",
    });

    expect(result).toContain("INDIVIDUAL TREASURE");
    const rollLines = result.match(/Roll \d+:/g) ?? [];
    expect(rollLines.length).toBe(100);
    expect(mockGetMonsterStats).toHaveBeenCalledTimes(3);
    expect(result.length).toBeLessThanOrEqual(MAX_TREASURE_OUTPUT_CHARS);
  });
});

// ── 18. Repeated / unresolved names within budget ────────────────────────────

describe("repeated and unresolved names within budget", () => {
  it("resolves once per unique name via lookup, but budgets on raw entry counts", async () => {
    mockGetMonsterStats.mockImplementation(async (name: string) => {
      if (name === "Goblin") return found("Goblin", 0.25, 50);
      return NOT_FOUND;
    });

    const result = await generateTreasure({
      monsters: [
        { name: "Goblin", count: 3 },
        { name: "Goblin", count: 2 },
        { name: "Nonexistent Beast", count: 1 },
      ],
      treasureType: "individual",
    });

    expect(result).toContain("INDIVIDUAL TREASURE");
    expect(result).toContain("Nonexistent Beast");
    expect(mockGetMonsterStats).toHaveBeenCalledTimes(2); // unique names only
    const rollLines = result.match(/Roll \d+:/g) ?? [];
    expect(rollLines.length).toBe(5); // 3 + 2 goblin rolls; unresolved contributes 0
  });
});

// ── 19. Oversized upstream display name cannot defeat the output cap ────────

// ── 20. Forced output truncation (small injected budget) ────────────────────
//
// A maximal *real* request (≤20 entries, ≤100 rolls, ≤200-char names) only
// ever produces ~10-15K characters of output — far under the 32,000-char
// cap — so `result.length <= MAX_TREASURE_OUTPUT_CHARS` alone never proves
// the BoundedAccumulator/omission mechanism actually does anything; it
// would pass even if that mechanism were deleted entirely. generateTreasure()
// accepts a second, options-object parameter with a `maxOutputChars`
// override — test-only, production callers (src/server.ts) never pass it —
// so these tests can force the same accumulator logic to actually omit
// content on a small, cheap fixture instead of a giant real payload.

describe("forced output truncation — individual", () => {
  it("omits roll detail but always keeps full, correct coin totals within budget", async () => {
    mockGetMonsterStats.mockResolvedValueOnce(found("Goblin", 0.25, 50));
    vi.spyOn(Math, "random").mockReturnValue(0.5); // 3d6 -> 4 per die -> 12 gp per roll
    const maxOutputChars = 300;

    const result = await generateTreasure(
      { monsters: [{ name: "Goblin", count: 10 }], treasureType: "individual" },
      { maxOutputChars }
    );

    expect(result.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result).toMatch(/omitted/i);
    expect(result).toContain("COINS (combined)");
    // 10 rolls x 12 gp = 120 gp — the aggregate total must survive truncation intact.
    expect(result).toContain("  120 gp");
    expect(result).toContain("TOTAL VALUE  ~120 gp");
  });
});

describe("forced output truncation — hoard", () => {
  it("omits source/magic-item detail but always keeps full, correct coin totals within budget", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Ancient Red Dragon (Extremely Long Upstream Display Name For Testing Purposes Only)", 20, 25000))
      .mockResolvedValueOnce(found("Adult Blue Dragon (Also A Rather Long Upstream Display Name For Testing)", 16, 15000));
    vi.spyOn(Math, "random").mockReturnValue(0.5); // deterministic coin/item rolls
    const maxOutputChars = 250;

    const result = await generateTreasure(
      {
        monsters: [{ name: "Dragon A", count: 1 }, { name: "Dragon B", count: 1 }],
        treasureType: "hoard",
        characterLevel: 18,
      },
      { maxOutputChars }
    );

    expect(result.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result).toMatch(/omitted/i);
    // Tier 17+: 6d10x10000 gp, each d10 = floor(0.5*10)+1 = 6 -> 6*6*10000 = 360,000 gp.
    // The coin total must survive even though the Source/magic-item detail is dropped.
    expect(result).toContain("360,000 gp");
    expect(result).toContain("TOTAL VALUE  ~360,000 gp");
  });
});

describe("forced output truncation — unresolved monster listing", () => {
  it("omits unresolved-name detail but always keeps the closing message within budget", async () => {
    mockGetMonsterStats.mockResolvedValue(NOT_FOUND);
    const monsters = Array.from({ length: 20 }, (_, i) => ({ name: `Fake Monster Number ${i}`, count: 1 }));
    const maxOutputChars = 200;

    const result = await generateTreasure(
      { monsters, treasureType: "hoard" },
      { maxOutputChars }
    );

    expect(result.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result).toMatch(/omitted/i);
    expect(result).toContain("No treasure rolled");
  });
});

describe("forced output truncation — partial resolution status block", () => {
  it("omits resolution-status detail while still rolling treasure, within budget", async () => {
    mockGetMonsterStats.mockImplementation(async (name: string) => {
      if (name.startsWith("Found")) return found(name, 1, 200);
      return NOT_FOUND;
    });
    const monsters = [
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Found Monster ${i}`, count: 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Missing Monster ${i}`, count: 1 })),
    ];
    const maxOutputChars = 400;

    const result = await generateTreasure(
      { monsters, treasureType: "hoard" },
      { maxOutputChars }
    );

    expect(result.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result).toMatch(/omitted/i);
    expect(result).toContain("TREASURE HOARD");
    expect(result).toContain("TOTAL VALUE");
  });
});

describe("oversized upstream monster name", () => {
  it("truncates a huge resolved name and keeps output within the character budget", async () => {
    const hugeName = "X".repeat(5000);
    mockGetMonsterStats.mockResolvedValueOnce(found(hugeName, 1, 200));

    const result = await generateTreasure({
      monsters: [{ name: "Goblin", count: 2 }],
      treasureType: "individual",
    });

    expect(result.length).toBeLessThanOrEqual(MAX_TREASURE_OUTPUT_CHARS);
    expect(result).not.toContain(hugeName);
  });

  it("truncates a huge resolved name in hoard source descriptions too", async () => {
    const hugeName = "Y".repeat(5000);
    mockGetMonsterStats.mockResolvedValueOnce(found(hugeName, 3, 700));

    const result = await generateTreasure({
      monsters: [{ name: "Ogre", count: 1 }],
      treasureType: "hoard",
    });

    expect(result.length).toBeLessThanOrEqual(MAX_TREASURE_OUTPUT_CHARS);
    expect(result).not.toContain(hugeName);
  });
});

// ── Rules lines, edition tags and ambiguity (rules-edition phase 2) ──────────

const RULES_2024 = "Rules: 2024 · Dungeon Master's Guide (2024)";
const NO_2014 = "(no 2014 version exists — 2024 tables used)";
const AMBIGUOUS_RED_DRAGON: MonsterStatsResult = {
  status: "ambiguous",
  candidates: [{ name: "Red Dragon Wyrmling", crValue: 4, xp: 1100 }, { name: "Young Red Dragon", crValue: 10, xp: 5900 }],
};
const AMBIGUOUS_LINE = '  ✗ Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Young Red Dragon (CR 10) — use the full name.';

describe("rules line", () => {
  it("hoard and individual outputs put the rules line right after their title", async () => {
    const hoard = (await generateTreasure({ cr: 2, treasureType: "hoard" })).split("\n");
    expect(hoard[0]).toMatch(/^TREASURE HOARD — /);
    expect(hoard[1]).toBe(RULES_2024);
    const individual = (await generateTreasure({ cr: 2, treasureType: "individual" })).split("\n");
    expect(individual[0]).toMatch(/^INDIVIDUAL TREASURE — /);
    expect(individual[1]).toBe(RULES_2024);
    expect(individual).not.toContain(NO_2014);
  });

  it("monster-list outputs carry it too, and look monsters up with the requested edition", async () => {
    mockGetMonsterStats.mockResolvedValue(found("Goblin", 0.25, 50));
    const out = (await generateTreasure({ monsters: [{ name: "Goblin", count: 1 }], treasureType: "individual" })).split("\n");
    expect(out[1]).toBe(RULES_2024);
    expect(mockGetMonsterStats).toHaveBeenCalledWith("Goblin", { rulesEdition: "2024" });
  });

  it("rulesEdition 2014 adds the no-2014-tables line and resolves CRs from 2014 stat blocks", async () => {
    mockGetMonsterStats.mockResolvedValue({ status: "found", name: "Goblin", crValue: 0.25, xp: 50, info: { ruleset: "2014", book: "Monster Manual (2014)" } });
    const out = (await generateTreasure({ monsters: [{ name: "Goblin", count: 1 }], treasureType: "hoard", rulesEdition: "2014" })).split("\n");
    expect(out[1]).toBe(RULES_2024);
    expect(out[2]).toBe(NO_2014);
    expect(mockGetMonsterStats).toHaveBeenCalledWith("Goblin", { rulesEdition: "2014" });
    expect(out).toContain("Source: Goblin [2014] (CR 1/4) — using highest CR");
    const direct = (await generateTreasure({ cr: 3, treasureType: "individual", rulesEdition: "2014" })).split("\n");
    expect(direct.slice(1, 3)).toEqual([RULES_2024, NO_2014]);
  });

  it("an all-unresolved request is not-found output and carries no rules line", async () => {
    mockGetMonsterStats.mockResolvedValue(NOT_FOUND);
    const out = await generateTreasure({ monsters: [{ name: "Fake A", count: 1 }], treasureType: "hoard" });
    expect(out).not.toContain("Rules:");
  });
});

describe("edition tags on resolved names", () => {
  it("tags hoard Source segments and individual labels; ✓ status lines are unchanged", async () => {
    mockGetMonsterStats.mockImplementation(async (name: string) => (name === "Goblin" ? found("Goblin", 0.25, 50) : NOT_FOUND));
    const hoard = await generateTreasure({ monsters: [{ name: "Goblin", count: 2 }], treasureType: "hoard" });
    expect(hoard).toContain("Source: 2 × Goblin [2024] (CR 1/4) — using highest CR");
    const individual = await generateTreasure({ monsters: [{ name: "Goblin", count: 2 }, { name: "Nope", count: 1 }], treasureType: "individual" });
    expect(individual).toContain("  Goblin [2024] (CR 1/4) ×2 — 2 rolls on tier 0-4");
    expect(individual).toContain("  ✓ Goblin → CR 1/4");
  });
});

describe("ambiguous monster names", () => {
  it("lists the candidates in the partial-resolution status block", async () => {
    mockGetMonsterStats.mockImplementation(async (name: string) => (name === "Ogre" ? found("Ogre", 2, 450) : AMBIGUOUS_RED_DRAGON));
    const out = await generateTreasure({ monsters: [{ name: "Ogre", count: 1 }, { name: "Red Dragon", count: 1 }], treasureType: "hoard" });
    expect(out.split("\n")).toContain(AMBIGUOUS_LINE);
    expect(out).toContain("✓ Ogre");
    expect(out).toContain("TOTAL VALUE");
  });

  it("lists the candidates when nothing resolved", async () => {
    mockGetMonsterStats.mockResolvedValue(AMBIGUOUS_RED_DRAGON);
    const out = await generateTreasure({ monsters: [{ name: "Red Dragon", count: 1 }], treasureType: "hoard" });
    expect(out.split("\n")).toContain(AMBIGUOUS_LINE);
    expect(out).toContain("No treasure rolled");
    expect(out).not.toContain("not found in DDB or Open5e");
  });
});

describe("rules lines under a tight output budget", () => {
  it("individual: the rules and reason lines survive omissions and the budget holds", async () => {
    mockGetMonsterStats.mockResolvedValue(found("Goblin", 0.25, 50));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const maxOutputChars = 400;
    const out = await generateTreasure(
      { monsters: [{ name: "Goblin", count: 10 }], treasureType: "individual", rulesEdition: "2014" },
      { maxOutputChars }
    );
    expect(out.length).toBeLessThanOrEqual(maxOutputChars);
    expect(out).toMatch(/omitted/i);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^INDIVIDUAL TREASURE — /);
    expect(lines.slice(1, 3)).toEqual([RULES_2024, NO_2014]);
    expect(out).toContain("TOTAL VALUE  ~120 gp");
  });

  it("hoard: the rules and reason lines survive omissions and the budget holds", async () => {
    mockGetMonsterStats
      .mockResolvedValueOnce(found("Ancient Red Dragon (Extremely Long Upstream Display Name For Testing Purposes Only)", 20, 25000))
      .mockResolvedValueOnce(found("Adult Blue Dragon (Also A Rather Long Upstream Display Name For Testing)", 16, 15000));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const maxOutputChars = 330;
    const out = await generateTreasure(
      { monsters: [{ name: "Dragon A", count: 1 }, { name: "Dragon B", count: 1 }], treasureType: "hoard", characterLevel: 18, rulesEdition: "2014" },
      { maxOutputChars }
    );
    expect(out.length).toBeLessThanOrEqual(maxOutputChars);
    expect(out).toMatch(/omitted/i);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^TREASURE HOARD — /);
    expect(lines.slice(1, 3)).toEqual([RULES_2024, NO_2014]);
    expect(out).toContain("TOTAL VALUE  ~360,000 gp");
  });

  it("hoard with a partial-resolution status block: the rules line survives and the budget holds", async () => {
    mockGetMonsterStats.mockImplementation(async (name: string) => (name.startsWith("Found") ? found(name, 1, 200) : NOT_FOUND));
    const monsters = [
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Found Monster ${i}`, count: 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Missing Monster ${i}`, count: 1 })),
    ];
    const maxOutputChars = 400;
    const out = await generateTreasure({ monsters, treasureType: "hoard", rulesEdition: "2014" }, { maxOutputChars });
    expect(out.length).toBeLessThanOrEqual(maxOutputChars);
    expect(out).toMatch(/omitted/i);
    const lines = out.split("\n");
    const title = lines.findIndex(l => l.startsWith("TREASURE HOARD — "));
    expect(title).toBeGreaterThanOrEqual(0);
    expect(lines.slice(title + 1, title + 3)).toEqual([RULES_2024, NO_2014]);
  });
});
