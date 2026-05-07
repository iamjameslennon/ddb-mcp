import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTreasure } from "../src/tools/treasure.js";

vi.mock("../src/tools/monster.js", () => ({
  getMonsterStats: vi.fn(),
}));

import { getMonsterStats } from "../src/tools/monster.js";
const mockGetMonsterStats = vi.mocked(getMonsterStats);

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
      .mockResolvedValueOnce({ name: "Ogre", crValue: 2, xp: 450 })
      .mockResolvedValueOnce({ name: "Hill Giant", crValue: 5, xp: 1800 });

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
      .mockResolvedValueOnce({ name: "Goblin", crValue: 0.25, xp: 50 })
      .mockResolvedValueOnce({ name: "Hobgoblin", crValue: 1, xp: 200 });

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
      .mockResolvedValueOnce({ name: "Ogre", crValue: 2, xp: 450 })
      .mockResolvedValueOnce(null);

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
    mockGetMonsterStats.mockResolvedValue(null);

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
    mockGetMonsterStats.mockResolvedValue({ name: "Goblin", crValue: 0.25, xp: 50 });
    const result = await generateTreasure({
      cr: 5,
      monsters: [{ name: "Goblin", count: 1 }],
      treasureType: "hoard",
    });
    expect(result).toContain("Error:");
  });
});
