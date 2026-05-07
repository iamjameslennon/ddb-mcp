/**
 * encounter.ts — Encounter difficulty rater
 *
 * Supports two rules editions:
 *   2024 XDMG (default): XP budgets, Low/Moderate/High, no multiplier (p.114)
 *   2014 DMG:            XP thresholds, Easy/Medium/Hard/Deadly, multiplier (p.82–83)
 */

import { getMonsterStats } from "./monster.js";

// ── XP thresholds by level (2014 DMG p.82) ────────────────────────────────────
// Tuple: [easy, medium, hard, deadly]

const XP_THRESHOLDS: Record<number, [number, number, number, number]> = {
   1: [    25,    50,    75,    100],
   2: [    50,   100,   150,    200],
   3: [    75,   150,   225,    400],
   4: [   125,   250,   375,    500],
   5: [   250,   500,   750,   1100],
   6: [   300,   600,   900,   1400],
   7: [   350,   750,  1100,   1700],
   8: [   450,   900,  1400,   2100],
   9: [   550,  1100,  1600,   2400],
  10: [   600,  1200,  1900,   2800],
  11: [   800,  1600,  2400,   3600],
  12: [  1000,  2000,  3000,   4500],
  13: [  1100,  2200,  3400,   5100],
  14: [  1250,  2500,  3800,   5700],
  15: [  1400,  2800,  4300,   6400],
  16: [  1600,  3200,  4800,   7200],
  17: [  2000,  3900,  5900,   8800],
  18: [  2100,  4200,  6300,   9500],
  19: [  2400,  4900,  7300,  10900],
  20: [  2800,  5700,  8500,  12700],
};

// ── XP budget per character by level (2024 XDMG p.114) ───────────────────────
// Tuple: [low, moderate, high]

const XP_BUDGET_2024: Record<number, [number, number, number]> = {
   1: [   50,    75,    100],
   2: [  100,   150,    200],
   3: [  150,   225,    400],
   4: [  250,   375,    500],
   5: [  500,   750,   1100],
   6: [  600,  1000,   1400],
   7: [  750,  1300,   1700],
   8: [ 1000,  1700,   2100],
   9: [ 1300,  2000,   2600],
  10: [ 1600,  2300,   3100],
  11: [ 1900,  2900,   4100],
  12: [ 2200,  3700,   4700],
  13: [ 2600,  4200,   5400],
  14: [ 2900,  4900,   6200],
  15: [ 3300,  5400,   7800],
  16: [ 3800,  6100,   9800],
  17: [ 4500,  7200,  11700],
  18: [ 5000,  8700,  14200],
  19: [ 5500, 10700,  17200],
  20: [ 6400, 13200,  22000],
};

// ── CR → XP ───────────────────────────────────────────────────────────────────

const CR_XP: Record<number, number> = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
  1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
  6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000,
  26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
};

// ── 2014 Multiplier (DMG p.83) ────────────────────────────────────────────────

const MULTIPLIER_TIERS = [1, 1.5, 2, 2.5, 3, 4];

function getMultiplierTierIndex(monsterCount: number): number {
  if (monsterCount === 1) return 0;
  if (monsterCount === 2) return 1;
  if (monsterCount <= 6)  return 2;
  if (monsterCount <= 10) return 3;
  if (monsterCount <= 14) return 4;
  return 5;
}

function getMultiplier(monsterCount: number, partySize: number): number {
  let tier = getMultiplierTierIndex(monsterCount);
  if (partySize < 3) tier = Math.min(tier + 1, MULTIPLIER_TIERS.length - 1);
  if (partySize > 5) tier = Math.max(tier - 1, 0);
  return MULTIPLIER_TIERS[tier];
}

// ── CR display helper ─────────────────────────────────────────────────────────

function displayCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25)  return "1/4";
  if (cr === 0.5)   return "1/2";
  return String(cr);
}

// ── CR table as sorted array (for range finding) ──────────────────────────────

const CR_TABLE: Array<[number, number]> = [
  [0, 10], [0.125, 25], [0.25, 50], [0.5, 100],
  [1, 200], [2, 450], [3, 700], [4, 1100], [5, 1800],
  [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900],
  [11, 7200], [12, 8400], [13, 10000], [14, 11500], [15, 13000],
  [16, 15000], [17, 18000], [18, 20000], [19, 22000], [20, 25000],
  [21, 33000], [22, 41000], [23, 50000], [24, 62000], [25, 75000],
  [26, 90000], [27, 105000], [28, 120000], [29, 135000], [30, 155000],
];

// ── CR range finder ───────────────────────────────────────────────────────────

interface CrRangeResult {
  inBand: Array<{ cr: number; adjustedXp: number }>;
  below: { cr: number; adjustedXp: number } | null;
  above: { cr: number; adjustedXp: number } | null;
}

function findCrRange(
  lowerThreshold: number,
  upperThreshold: number | null,
  count: number,
  multiplier: number
): CrRangeResult {
  const inBand: Array<{ cr: number; adjustedXp: number }> = [];
  let below: { cr: number; adjustedXp: number } | null = null;
  let above: { cr: number; adjustedXp: number } | null = null;

  for (const [cr, xp] of CR_TABLE) {
    const adjustedXp = Math.round(xp * count * multiplier);
    const inLower = adjustedXp >= lowerThreshold;
    const inUpper = upperThreshold === null || adjustedXp < upperThreshold;

    if (inLower && inUpper) {
      inBand.push({ cr, adjustedXp });
    } else if (!inLower) {
      below = { cr, adjustedXp };
    } else if (!inUpper && above === null) {
      above = { cr, adjustedXp };
    }
  }

  return { inBand, below, above };
}

// ── 2014 archetype row formatter ──────────────────────────────────────────────

function formatArchetypeRow(
  count: number,
  multiplier: number,
  multiplierNote: string,
  range: CrRangeResult,
  upperThreshold: number | null
): string {
  const label = `${count} monster${count !== 1 ? "s" : ""}`;
  const multLabel = `×${multiplier}${multiplierNote}`;
  const prefix = `  ${label.padEnd(12)} (${multLabel}):`;

  if (range.inBand.length === 0) {
    const belowStr = range.below
      ? `CR ${displayCr(range.below.cr)} (${range.below.adjustedXp.toLocaleString()} — falls short)`
      : null;
    const aboveStr = range.above
      ? `CR ${displayCr(range.above.cr)} (${range.above.adjustedXp.toLocaleString()} — overshoots${upperThreshold ? " into next tier" : ""})`
      : null;
    const options = [belowStr, aboveStr].filter(Boolean).join(" or ");
    return `${prefix} no CR lands in this band — nearest: ${options}`;
  }

  if (range.inBand.length === 1) {
    const { cr, adjustedXp } = range.inBand[0];
    return `${prefix} CR ${displayCr(cr)}  →  ${adjustedXp.toLocaleString()} adjusted XP`;
  }

  const first = range.inBand[0];
  const last = range.inBand[range.inBand.length - 1];
  return `${prefix} CR ${displayCr(first.cr)}–${displayCr(last.cr)}  →  ${first.adjustedXp.toLocaleString()}–${last.adjustedXp.toLocaleString()} adjusted XP`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MonsterInput {
  name?: string;
  cr?: number;
  count?: number;
}

export interface PartyGroup {
  count: number;
  level: number;
}

export type Difficulty2014 = "easy" | "medium" | "hard" | "deadly";
export type Difficulty2024 = "low" | "moderate" | "high";
export type Difficulty = Difficulty2014 | Difficulty2024;

// ── rateEncounter ─────────────────────────────────────────────────────────────

export async function rateEncounter(
  party: PartyGroup[],
  monsters: MonsterInput[],
  rulesEdition: "2024" | "2014" = "2024"
): Promise<string> {

  // 1. Party budget / threshold
  let budgetLow = 0, budgetMod = 0, budgetHigh = 0;
  let partyEasy = 0, partyMedium = 0, partyHard = 0, partyDeadly = 0;
  let partySize = 0;
  const partyLines: string[] = [];

  for (const group of party) {
    if (rulesEdition === "2024") {
      const budget = XP_BUDGET_2024[group.level];
      if (!budget) return `Invalid character level: ${group.level}. Must be 1–20.`;
      const [l, m, h] = budget;
      budgetLow += l * group.count;
      budgetMod += m * group.count;
      budgetHigh += h * group.count;
      partySize += group.count;
      const label = group.count === 1 ? `1 × Level ${group.level}` : `${group.count} × Level ${group.level}`;
      partyLines.push(`  ${label} (Low ${(l * group.count).toLocaleString()} | Moderate ${(m * group.count).toLocaleString()} | High ${(h * group.count).toLocaleString()})`);
    } else {
      const thresholds = XP_THRESHOLDS[group.level];
      if (!thresholds) return `Invalid character level: ${group.level}. Must be 1–20.`;
      const [e, m, h, d] = thresholds;
      partyEasy   += e * group.count;
      partyMedium += m * group.count;
      partyHard   += h * group.count;
      partyDeadly += d * group.count;
      partySize   += group.count;
      const label = group.count === 1 ? `1 × Level ${group.level}` : `${group.count} × Level ${group.level}`;
      partyLines.push(`  ${label} (Easy ${(e * group.count).toLocaleString()} | Medium ${(m * group.count).toLocaleString()} | Hard ${(h * group.count).toLocaleString()} | Deadly ${(d * group.count).toLocaleString()})`);
    }
  }

  // 2. Resolve monsters (identical for both editions)
  let totalRawXp = 0;
  let totalMonsterCount = 0;
  const monsterLines: string[] = [];
  const notFound: string[] = [];

  for (const m of monsters) {
    const count = m.count ?? 1;

    let resolvedName: string;
    let crValue: number;
    let xpEach: number;

    if (m.cr !== undefined) {
      resolvedName = m.name ?? `CR ${displayCr(m.cr)} creature`;
      crValue = m.cr;
      const crKey = Object.keys(CR_XP).map(Number).reduce((prev, curr) =>
        Math.abs(curr - m.cr!) < Math.abs(prev - m.cr!) ? curr : prev
      );
      xpEach = CR_XP[crKey] ?? 0;
    } else if (m.name) {
      const stats = await getMonsterStats(m.name);
      if (!stats) {
        notFound.push(m.name);
        continue;
      }
      resolvedName = stats.name;
      crValue = stats.crValue;
      xpEach = stats.xp;
    } else {
      continue;
    }

    totalMonsterCount += count;
    totalRawXp += xpEach * count;
    const crStr = displayCr(crValue);
    const countLabel = count === 1 ? `1 × ${resolvedName}` : `${count} × ${resolvedName}`;
    monsterLines.push(
      count === 1
        ? `  ${countLabel} (CR ${crStr}, ${xpEach.toLocaleString()} XP)`
        : `  ${countLabel} (CR ${crStr}, ${xpEach.toLocaleString()} XP each = ${(xpEach * count).toLocaleString()} XP)`
    );
  }

  if (totalMonsterCount === 0) {
    return "No valid monsters provided. Check names or supply cr values directly.";
  }

  // 3/4. Difficulty + output
  if (rulesEdition === "2024") {
    let difficulty: string;
    let explanation: string;

    if (totalRawXp < budgetLow) {
      difficulty = "TRIVIAL";
      explanation = `below Low threshold of ${budgetLow.toLocaleString()}`;
    } else if (totalRawXp < budgetMod) {
      difficulty = "LOW";
      explanation = `above Low (${budgetLow.toLocaleString()}), below Moderate (${budgetMod.toLocaleString()})`;
    } else if (totalRawXp < budgetHigh) {
      difficulty = "MODERATE";
      explanation = `above Moderate (${budgetMod.toLocaleString()}), below High (${budgetHigh.toLocaleString()})`;
    } else {
      difficulty = "HIGH";
      explanation = `at or above High threshold of ${budgetHigh.toLocaleString()}`;
    }

    const lines = [
      `ENCOUNTER DIFFICULTY: ${difficulty} (2024 XDMG)`,
      ``,
      `PARTY (${partySize} character${partySize !== 1 ? "s" : ""})`,
      ...partyLines,
      `  Budgets → Low ${budgetLow.toLocaleString()} | Moderate ${budgetMod.toLocaleString()} | High ${budgetHigh.toLocaleString()}`,
      ``,
      `MONSTERS`,
      ...monsterLines,
      ``,
      `Total XP: ${totalRawXp.toLocaleString()}`,
      ``,
      `Result: ${difficulty} — ${explanation}`,
    ];

    if (notFound.length) {
      lines.push(``, `⚠ Not found in compendium (supply cr manually): ${notFound.join(", ")}`);
    }
    return lines.join("\n");

  } else {
    // 2014 DMG path
    const multiplier = getMultiplier(totalMonsterCount, partySize);
    const adjustedXp = Math.round(totalRawXp * multiplier);

    let difficulty: string;
    let explanation: string;

    if (adjustedXp < partyEasy) {
      difficulty = "TRIVIAL";
      explanation = `below Easy threshold of ${partyEasy.toLocaleString()}`;
    } else if (adjustedXp < partyMedium) {
      difficulty = "EASY";
      explanation = `above Easy (${partyEasy.toLocaleString()}), below Medium (${partyMedium.toLocaleString()})`;
    } else if (adjustedXp < partyHard) {
      difficulty = "MEDIUM";
      explanation = `above Medium (${partyMedium.toLocaleString()}), below Hard (${partyHard.toLocaleString()})`;
    } else if (adjustedXp < partyDeadly) {
      difficulty = "HARD";
      explanation = `above Hard (${partyHard.toLocaleString()}), below Deadly (${partyDeadly.toLocaleString()})`;
    } else {
      difficulty = "DEADLY";
      explanation = `at or above Deadly threshold of ${partyDeadly.toLocaleString()}`;
    }

    const multiplierNote = partySize < 3
      ? ` (stepped up — party fewer than 3)`
      : partySize > 5
      ? ` (stepped down — party larger than 5)`
      : "";

    const lines = [
      `ENCOUNTER DIFFICULTY: ${difficulty}`,
      ``,
      `PARTY (${partySize} character${partySize !== 1 ? "s" : ""})`,
      ...partyLines,
      `  Totals → Easy ${partyEasy.toLocaleString()} | Medium ${partyMedium.toLocaleString()} | Hard ${partyHard.toLocaleString()} | Deadly ${partyDeadly.toLocaleString()}`,
      ``,
      `MONSTERS`,
      ...monsterLines,
      ``,
      `Raw XP:       ${totalRawXp.toLocaleString()}`,
      ...(multiplier !== 1 || multiplierNote
        ? [`Multiplier:   ×${multiplier} (${totalMonsterCount} monster${totalMonsterCount !== 1 ? "s" : ""}${multiplierNote})`]
        : []
      ),
      `Adjusted XP:  ${adjustedXp.toLocaleString()}`,
      ``,
      `Result: ${difficulty} — ${explanation}`,
    ];

    if (notFound.length) {
      lines.push(``, `⚠ Not found in compendium (supply cr manually): ${notFound.join(", ")}`);
    }
    return lines.join("\n");
  }
}

// ── targetEncounterCr ─────────────────────────────────────────────────────────

export async function targetEncounterCr(
  party: PartyGroup[],
  difficulty: Difficulty,
  monsterCount?: number,
  rulesEdition: "2024" | "2014" = "2024"
): Promise<string> {

  const valid2014 = ["easy", "medium", "hard", "deadly"];
  const valid2024 = ["low", "moderate", "high"];

  if (rulesEdition === "2024" && !valid2024.includes(difficulty)) {
    return `Error: use 'low', 'moderate', or 'high' for 2024 rules (got '${difficulty}'). For 2014 rules, set rules_edition to '2014'.`;
  }
  if (rulesEdition === "2014" && !valid2014.includes(difficulty)) {
    return `Error: use 'easy', 'medium', 'hard', or 'deadly' for 2014 rules (got '${difficulty}'). For 2024 rules, set rules_edition to '2024'.`;
  }

  // Party budget / threshold
  let budgetLow = 0, budgetMod = 0, budgetHigh = 0;
  let partyEasy = 0, partyMedium = 0, partyHard = 0, partyDeadly = 0;
  let partySize = 0;

  for (const group of party) {
    if (rulesEdition === "2024") {
      const budget = XP_BUDGET_2024[group.level];
      if (!budget) return `Invalid character level: ${group.level}. Must be 1–20.`;
      const [l, m, h] = budget;
      budgetLow  += l * group.count;
      budgetMod  += m * group.count;
      budgetHigh += h * group.count;
      partySize  += group.count;
    } else {
      const thresholds = XP_THRESHOLDS[group.level];
      if (!thresholds) return `Invalid character level: ${group.level}. Must be 1–20.`;
      const [e, m, h, d] = thresholds;
      partyEasy   += e * group.count;
      partyMedium += m * group.count;
      partyHard   += h * group.count;
      partyDeadly += d * group.count;
      partySize   += group.count;
    }
  }

  const partyDesc = party.length === 1
    ? `${party[0].count} × Level ${party[0].level}`
    : party.map(g => `${g.count}×L${g.level}`).join(" + ");

  const ARCHETYPES = monsterCount ? [monsterCount] : [1, 2, 4, 8];

  if (rulesEdition === "2024") {
    const bands2024: Record<Difficulty2024, [number, number | null]> = {
      low:      [budgetLow,  budgetMod],
      moderate: [budgetMod,  budgetHigh],
      high:     [budgetHigh, null],
    };
    const [lowerThreshold, upperThreshold] = bands2024[difficulty as Difficulty2024];

    const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

    const thresholdLine = difficulty === "high"
      ? `High threshold: ${budgetHigh.toLocaleString()} XP (minimum)`
      : `${diffLabel} threshold: ${lowerThreshold.toLocaleString()} | ${
          difficulty === "moderate" ? "High" : "Moderate"
        }: ${(upperThreshold ?? 0).toLocaleString()}`;

    const rows: string[] = [];
    for (const count of ARCHETYPES) {
      const range = findCrRange(lowerThreshold, upperThreshold, count, 1);
      const label = `${count} monster${count !== 1 ? "s" : ""}`;
      const prefix = `  ${label.padEnd(12)}:`;

      let row: string;
      if (range.inBand.length === 0) {
        const belowStr = range.below
          ? `CR ${displayCr(range.below.cr)} (${range.below.adjustedXp.toLocaleString()} — falls short)`
          : null;
        const aboveStr = range.above
          ? `CR ${displayCr(range.above.cr)} (${range.above.adjustedXp.toLocaleString()} — overshoots${upperThreshold ? " into next tier" : ""})`
          : null;
        const options = [belowStr, aboveStr].filter(Boolean).join(" or ");
        row = `${prefix} no CR lands in this band — nearest: ${options}`;
      } else if (range.inBand.length === 1) {
        const { cr, adjustedXp } = range.inBand[0];
        row = `${prefix} CR ${displayCr(cr)}  →  ${adjustedXp.toLocaleString()} XP`;
      } else {
        const first = range.inBand[0];
        const last = range.inBand[range.inBand.length - 1];
        row = `${prefix} CR ${displayCr(first.cr)}–${displayCr(last.cr)}  →  ${first.adjustedXp.toLocaleString()}–${last.adjustedXp.toLocaleString()} XP`;
      }
      rows.push(row);
    }

    const lines = [
      `TARGET CR — ${diffLabel.toUpperCase()} encounter for ${partyDesc} (2024 XDMG)`,
      thresholdLine,
      ``,
      ...rows,
    ];
    if (difficulty === "high") {
      lines.push(``, `* High has no upper bound — higher CR = more dangerous.`);
    }
    return lines.join("\n");

  } else {
    // 2014 DMG path — unchanged logic
    const bands: Record<Difficulty2014, [number, number | null]> = {
      easy:   [partyEasy,   partyMedium],
      medium: [partyMedium, partyHard],
      hard:   [partyHard,   partyDeadly],
      deadly: [partyDeadly, null],
    };
    const [lowerThreshold, upperThreshold] = bands[difficulty as Difficulty2014];

    const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

    const thresholdLine = difficulty === "deadly"
      ? `Deadly threshold: ${partyDeadly.toLocaleString()} XP (minimum)`
      : `${diffLabel} threshold: ${lowerThreshold.toLocaleString()} | ${
          difficulty === "hard" ? "Deadly" :
          difficulty === "medium" ? "Hard" : "Medium"
        }: ${(upperThreshold ?? 0).toLocaleString()}`;

    const rows: string[] = [];
    for (const count of ARCHETYPES) {
      let tierIndex = getMultiplierTierIndex(count);
      let multiplierNote = "";
      if (partySize < 3) {
        tierIndex = Math.min(tierIndex + 1, MULTIPLIER_TIERS.length - 1);
        multiplierNote = " small party";
      } else if (partySize > 5) {
        tierIndex = Math.max(tierIndex - 1, 0);
        multiplierNote = " large party";
      }
      const multiplier = MULTIPLIER_TIERS[tierIndex];
      const range = findCrRange(lowerThreshold, upperThreshold, count, multiplier);
      rows.push(formatArchetypeRow(count, multiplier, multiplierNote, range, upperThreshold));
    }

    const lines = [
      `TARGET CR — ${diffLabel.toUpperCase()} encounter for ${partyDesc}`,
      thresholdLine,
      ``,
      ...rows,
    ];

    if (difficulty === "deadly") {
      lines.push(``, `* Deadly has no upper bound — higher CR = more deadly.`);
    }
    return lines.join("\n");
  }
}
