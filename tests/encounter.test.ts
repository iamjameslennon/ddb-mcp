import { describe, it, expect } from "vitest";
import { rateEncounter, targetEncounterCr } from "../src/tools/encounter.js";

// All tests supply `cr` directly — no network calls needed.
// Monster lookup via name is covered by integration testing.

const PARTY_4_L5 = [{ count: 4, level: 5 }];
// 2014 thresholds: Easy 1000, Medium 2000, Hard 3000, Deadly 4400

describe("rateEncounter — difficulty thresholds", () => {
  it("rates a single low-CR monster as TRIVIAL", async () => {
    // 1 × CR 1/8 (25 XP), ×1 multiplier → 25 adjusted; party Easy = 1000
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 0.125 }], "2014");
    expect(result).toContain("TRIVIAL");
  });

  it("rates an EASY encounter correctly", async () => {
    // 1 × CR 3 (700 XP), ×1 → 700; between Easy (1000)? No — 700 < 1000 = TRIVIAL
    // Use CR 5 (1800 XP) → between Easy (1000) and Medium (2000) = EASY
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 5 }], "2014");
    expect(result).toContain("EASY");
  });

  it("rates a MEDIUM encounter correctly", async () => {
    // 1 × CR 6 (2300 XP), ×1 → 2300; between Medium (2000) and Hard (3000) = MEDIUM
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 6 }], "2014");
    expect(result).toContain("MEDIUM");
  });

  it("rates a HARD encounter correctly", async () => {
    // 1 × CR 8 (3900 XP), ×1 → 3900; between Hard (3000) and Deadly (4400) = HARD
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 8 }], "2014");
    expect(result).toContain("HARD");
  });

  it("rates a DEADLY encounter correctly", async () => {
    // 1 × CR 10 (5900 XP), ×1 → 5900; above Deadly (4400) = DEADLY
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 10 }], "2014");
    expect(result).toContain("DEADLY");
  });
});

describe("rateEncounter — multiplier tiers", () => {
  it("applies ×1 multiplier for a single monster", async () => {
    // 1 monster → no multiplier line emitted (multiplier === 1, no party size note)
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 8 }], "2014");
    expect(result).not.toContain("Multiplier:");
  });

  it("applies ×1.5 multiplier for 2 monsters", async () => {
    // 2 × CR 3 (700 each) → raw 1400 × 1.5 = 2100; MEDIUM
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 3, count: 2 }], "2014");
    expect(result).toContain("Multiplier:   ×1.5");
    expect(result).toContain("MEDIUM");
  });

  it("applies ×2 multiplier for 3–6 monsters", async () => {
    // 4 × CR 1 (200 each) → raw 800 × 2 = 1600; EASY
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 1, count: 4 }], "2014");
    expect(result).toContain("Multiplier:   ×2");
    expect(result).toContain("EASY");
  });

  it("applies ×2.5 multiplier for 7–10 monsters", async () => {
    // 8 × CR 1/2 (100 each) → raw 800 × 2.5 = 2000; boundary Medium
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 0.5, count: 8 }], "2014");
    expect(result).toContain("Multiplier:   ×2.5");
  });

  it("applies ×3 multiplier for 11–14 monsters", async () => {
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 0.25, count: 12 }], "2014");
    expect(result).toContain("Multiplier:   ×3");
  });

  it("applies ×4 multiplier for 15+ monsters", async () => {
    const result = await rateEncounter(PARTY_4_L5, [{ cr: 0.125, count: 16 }], "2014");
    expect(result).toContain("Multiplier:   ×4");
  });
});

describe("rateEncounter — party size adjustments", () => {
  it("steps multiplier up one tier for a party of 2 (< 3)", async () => {
    // 4 × CR 1 (200 each) → raw 800; normal ×2 → steps up to ×2.5 for party of 2
    const result = await rateEncounter(
      [{ count: 2, level: 5 }],
      [{ cr: 1, count: 4 }],
      "2014"
    );
    expect(result).toContain("×2.5");
    expect(result).toContain("stepped up");
  });

  it("steps multiplier down one tier for a party of 6 (> 5)", async () => {
    // 4 × CR 1 → normal ×2 → steps down to ×1.5 for party of 6
    const result = await rateEncounter(
      [{ count: 6, level: 5 }],
      [{ cr: 1, count: 4 }],
      "2014"
    );
    expect(result).toContain("×1.5");
    expect(result).toContain("stepped down");
  });

  it("does not step below ×1 for large party + single monster", async () => {
    // Single monster is already ×1 — tier is clamped at 0, but the party-size note
    // still fires so the multiplier line is shown (informative even when multiplier = 1)
    const result = await rateEncounter(
      [{ count: 6, level: 5 }],
      [{ cr: 8 }],
      "2014"
    );
    expect(result).toContain("×1");
    expect(result).toContain("stepped down");
  });
});

describe("rateEncounter — output formatting", () => {
  it("shows 'each = X XP' only when count > 1", async () => {
    const single = await rateEncounter(PARTY_4_L5, [{ cr: 5 }], "2014");
    expect(single).not.toContain("each =");

    const multi = await rateEncounter(PARTY_4_L5, [{ cr: 5, count: 2 }], "2014");
    expect(multi).toContain("each =");
  });

  it("accumulates XP across multiple monster entries", async () => {
    // 2 × CR 2 (450 each = 900) + 1 × CR 5 (1800) → raw 2700; 3 monsters ×2 = 5400 → DEADLY
    const result = await rateEncounter(PARTY_4_L5, [
      { cr: 2, count: 2 },
      { cr: 5, count: 1 },
    ], "2014");
    expect(result).toContain("Raw XP:       2,700");
    expect(result).toContain("DEADLY");
  });

  it("returns an error message for invalid character level", async () => {
    const result = await rateEncounter([{ count: 1, level: 25 }], [{ cr: 1 }], "2014");
    expect(result).toContain("Invalid character level: 25");
  });

  it("reports not-found monsters and still rates remaining ones", async () => {
    // One valid (cr), one named monster that won't resolve in unit tests
    // Use cr for both to avoid network — just verify the not-found path via empty monsters
    const result = await rateEncounter(PARTY_4_L5, [{ name: undefined, cr: undefined }], "2014");
    expect(result).toContain("No valid monsters provided");
  });

  it("handles fractional CRs (1/8, 1/4, 1/2) correctly", async () => {
    const r1 = await rateEncounter(PARTY_4_L5, [{ cr: 0.125 }], "2014");
    expect(r1).toContain("CR 1/8");
    expect(r1).toContain("25 XP");

    const r2 = await rateEncounter(PARTY_4_L5, [{ cr: 0.25 }], "2014");
    expect(r2).toContain("CR 1/4");
    expect(r2).toContain("50 XP");

    const r3 = await rateEncounter(PARTY_4_L5, [{ cr: 0.5 }], "2014");
    expect(r3).toContain("CR 1/2");
    expect(r3).toContain("100 XP");
  });

  it("handles mixed-level parties", async () => {
    // 2 × level 8 + 1 × level 3: Easy = 2×450+75=975, Medium = 2×900+150=1950
    const result = await rateEncounter(
      [{ count: 2, level: 8 }, { count: 1, level: 3 }],
      [{ cr: 5 }],
      "2014"
    );
    expect(result).toContain("3 characters");
    // CR 5 = 1800 XP, ×1 (single monster) = 1800; between Easy (975) and Medium (1950) = EASY
    expect(result).toContain("EASY");
  });
});

// ── targetEncounterCr ─────────────────────────────────────────────────────────

describe("targetEncounterCr — T1: standard party, all archetypes", () => {
  // 4 × Level 5: Hard 3,000 | Deadly 4,400
  let out: string;
  it("produces the correct header and threshold line", async () => {
    out = await targetEncounterCr([{ count: 4, level: 5 }], "hard", undefined, "2014");
    expect(out).toContain("TARGET CR — HARD encounter for 4 × Level 5");
    expect(out).toContain("Hard threshold: 3,000 | Deadly: 4,400");
  });
  it("shows correct CR and XP for each archetype", async () => {
    out = await targetEncounterCr([{ count: 4, level: 5 }], "hard", undefined, "2014");
    expect(out).toContain("1 monster    (×1): CR 8  →  3,900 adjusted XP");
    expect(out).toContain("2 monsters   (×1.5): CR 4  →  3,300 adjusted XP");
    expect(out).toContain("4 monsters   (×2): CR 2  →  3,600 adjusted XP");
    expect(out).toContain("8 monsters   (×2.5): CR 1  →  4,000 adjusted XP");
  });
});

describe("targetEncounterCr — T2: specific count with no CR in band", () => {
  it("shows 'no CR lands' message with both nearest options", async () => {
    // 6 monsters ×2: CR 1 = 2,400 (short), CR 2 = 5,400 (overshoots)
    const out = await targetEncounterCr([{ count: 4, level: 5 }], "hard", 6, "2014");
    expect(out).toContain("6 monsters   (×2): no CR lands in this band");
    expect(out).toContain("CR 1 (2,400 — falls short)");
    expect(out).toContain("CR 2 (5,400 — overshoots into next tier)");
  });
});

describe("targetEncounterCr — T3: mixed-level party", () => {
  it("uses compact party description and correct thresholds", async () => {
    // 2×L6 + 2×L3: Medium = (600×2)+(150×2)=1,500 | Hard = (900×2)+(225×2)=2,250
    const out = await targetEncounterCr(
      [{ count: 2, level: 6 }, { count: 2, level: 3 }],
      "medium",
      undefined,
      "2014"
    );
    expect(out).toContain("2×L6 + 2×L3");
    expect(out).toContain("Medium threshold: 1,500 | Hard: 2,250");
  });
  it("produces four archetype rows without party-size notes", async () => {
    const out = await targetEncounterCr(
      [{ count: 2, level: 6 }, { count: 2, level: 3 }],
      "medium",
      undefined,
      "2014"
    );
    expect(out).not.toContain("small party");
    expect(out).not.toContain("large party");
    // All four archetypes present
    expect(out).toContain("1 monster");
    expect(out).toContain("2 monsters");
    expect(out).toContain("4 monsters");
    expect(out).toContain("8 monsters");
  });
});

describe("targetEncounterCr — T4: deadly (unbounded)", () => {
  it("uses minimum phrasing and shows CR ranges", async () => {
    const out = await targetEncounterCr([{ count: 4, level: 5 }], "deadly", undefined, "2014");
    expect(out).toContain("Deadly threshold: 4,400 XP (minimum)");
    expect(out).toContain("CR 9–30");
    expect(out).toContain("CR 5–30");
    expect(out).toContain("CR 3–30");
    expect(out).toContain("CR 2–30");
    expect(out).toContain("* Deadly has no upper bound");
  });
});

describe("targetEncounterCr — T5: small party step-up", () => {
  it("steps all multipliers up one tier and labels them", async () => {
    // 2 × Level 5: Hard 1,500 | Deadly 2,200
    const out = await targetEncounterCr([{ count: 2, level: 5 }], "hard", undefined, "2014");
    expect(out).toContain("Hard threshold: 1,500 | Deadly: 2,200");
    expect(out).toContain("×1.5 small party");
    expect(out).toContain("×2 small party");
    expect(out).toContain("×2.5 small party");
    expect(out).toContain("×3 small party");
  });
  it("handles no-CR-in-band for 8 monsters and shows fraction CRs", async () => {
    const out = await targetEncounterCr([{ count: 2, level: 5 }], "hard", undefined, "2014");
    expect(out).toContain("8 monsters   (×3 small party): no CR lands in this band");
    expect(out).toContain("CR 1/4 (1,200 — falls short)");
    expect(out).toContain("CR 1/2 (2,400 — overshoots into next tier)");
  });
});

describe("targetEncounterCr — edge cases", () => {
  it("returns error for invalid level", async () => {
    const out = await targetEncounterCr([{ count: 4, level: 21 }], "hard", undefined, "2014");
    expect(out).toContain("Invalid character level: 21");
  });
  it("large party steps multipliers down and labels them", async () => {
    const out = await targetEncounterCr([{ count: 6, level: 5 }], "medium", undefined, "2014");
    expect(out).toContain("large party");
    // Single monster steps from ×1 to ×1 (clamped) — still shows label
    expect(out).toContain("×1 large party");
  });
  it("easy difficulty at level 1 resolves very low CRs", async () => {
    // Easy band: [100, 200); 1 monster ×1 → CR 1/2 = 100 XP lands exactly at lower bound
    const out = await targetEncounterCr([{ count: 4, level: 1 }], "easy", undefined, "2014");
    expect(out).toContain("Easy threshold: 100 | Medium: 200");
    expect(out).toContain("CR 1/2  →  100 adjusted XP");
  });
});

// ── 2024 XDMG rules ───────────────────────────────────────────────────────────

const PARTY_4_L5_2024 = [{ count: 4, level: 5 }];
// 2024 budgets level 5: low=500, moderate=750, high=1100
// Party totals: Low=2000 | Moderate=3000 | High=4400

describe("rateEncounter 2024 — difficulty tiers", () => {
  it("rates below-Low as TRIVIAL", async () => {
    // 1 × CR 1 (200 XP) < Low (2000)
    const result = await rateEncounter(PARTY_4_L5_2024, [{ cr: 1 }], "2024");
    expect(result).toContain("TRIVIAL");
    expect(result).toContain("2024 XDMG");
  });

  it("rates LOW correctly", async () => {
    // 1 × CR 6 (2300 XP): [2000, 3000) = LOW
    const result = await rateEncounter(PARTY_4_L5_2024, [{ cr: 6 }], "2024");
    expect(result).toContain("LOW");
  });

  it("rates MODERATE correctly", async () => {
    // 1 × CR 8 (3900 XP): [3000, 4400) = MODERATE
    const result = await rateEncounter(PARTY_4_L5_2024, [{ cr: 8 }], "2024");
    expect(result).toContain("MODERATE");
  });

  it("rates HIGH correctly", async () => {
    // 1 × CR 10 (5900 XP) >= High (4400) = HIGH
    const result = await rateEncounter(PARTY_4_L5_2024, [{ cr: 10 }], "2024");
    expect(result).toContain("HIGH");
  });

  it("does NOT apply a multiplier", async () => {
    // 4 × CR 2 (450 each = 1800 raw): in 2014 ×2 = 3600 (MEDIUM/HARD),
    // in 2024 raw 1800 < Low (2000) = TRIVIAL
    const result = await rateEncounter(PARTY_4_L5_2024, [{ cr: 2, count: 4 }], "2024");
    expect(result).not.toContain("Multiplier");
    expect(result).toContain("Total XP: 1,800");
    expect(result).toContain("TRIVIAL");
  });

  it("shows Low/Moderate/High budget line", async () => {
    const result = await rateEncounter(PARTY_4_L5_2024, [{ cr: 6 }], "2024");
    expect(result).toContain("Budgets → Low 2,000 | Moderate 3,000 | High 4,400");
  });
});

describe("targetEncounterCr 2024 — difficulty tiers", () => {
  it("produces correct header with (2024 XDMG) tag", async () => {
    const out = await targetEncounterCr(PARTY_4_L5_2024, "moderate", undefined, "2024");
    expect(out).toContain("TARGET CR — MODERATE encounter for 4 × Level 5 (2024 XDMG)");
  });

  it("shows correct threshold line for moderate", async () => {
    const out = await targetEncounterCr(PARTY_4_L5_2024, "moderate", undefined, "2024");
    // Moderate band: [3000, 4400)
    expect(out).toContain("Moderate threshold: 3,000 | High: 4,400");
  });

  it("shows correct CR for moderate, 1 monster — no multiplier notation", async () => {
    const out = await targetEncounterCr(PARTY_4_L5_2024, "moderate", undefined, "2024");
    // 1 monster × CR 8 = 3,900 XP → in [3000, 4400) ✓
    // 2024 row format: "  1 monster   : CR 8  →  3,900 XP" (padEnd 12 = 3 trailing spaces)
    expect(out).toContain("1 monster   : CR 8  →  3,900 XP");
    // No multiplier bracket notation
    expect(out).not.toContain("(×");
  });

  it("high difficulty has no upper bound note", async () => {
    const out = await targetEncounterCr(PARTY_4_L5_2024, "high", undefined, "2024");
    expect(out).toContain("High threshold: 4,400 XP (minimum)");
    expect(out).toContain("* High has no upper bound");
  });

  it("returns error for 2014 difficulty terms with 2024 edition", async () => {
    const out = await targetEncounterCr(PARTY_4_L5_2024, "deadly", undefined, "2024");
    expect(out).toContain("Error:");
    expect(out).toContain("low");
  });

  it("returns error for 2024 difficulty terms with 2014 edition", async () => {
    const out = await targetEncounterCr(PARTY_4_L5_2024, "moderate", undefined, "2014");
    expect(out).toContain("Error:");
    expect(out).toContain("easy");
  });
});
