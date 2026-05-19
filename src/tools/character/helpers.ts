/**
 * Primitive helpers shared across the character module.
 *
 * Phase 1 of the character.ts refactor — see docs/character-refactor.md.
 * No business logic — pure type/string/number utilities.
 */

import type { Mod, ProficiencyMod, ExpertiseMod, HalfProficiencyMod, BonusMod, SetMod, SetBaseMod, SenseMod, ResistanceMod, ImmunityMod, VulnerabilityMod, LanguageMod } from "./types.js";

export const str = (v: unknown): string => (v != null ? String(v) : "");
export const num = (v: unknown): number => (typeof v === "number" ? v : 0);
export const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const obj = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>) : {};

export const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
export const modOf = (score: number): number => Math.floor((score - 10) / 2);
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Lightweight HTML strip + whitespace collapse. Used for character snippets
 * (one-line summaries). For full HTML stripping with entity decoding, see
 * `stripHtml` in `src/utils.ts`.
 */
export const stripHtml = (s: string): string =>
  s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Returns true if the feat has the given category tagName. */
export const hasTag = (feat: Mod, tag: string): boolean =>
  arr<Record<string, unknown>>(obj(feat.definition).categories).some(c => c.tagName === tag);

// ── Mod type guards (follow-up A) ─────────────────────────────────────────────
// Narrow `Mod` (Record<string, unknown>) to the discriminated shapes in
// `types.ts`. Each guard checks `type` and the fields the consumer reads, so
// downstream code sees `subType: string` directly without a `str()` wrapper.

export const isProficiencyMod = (m: Mod): m is Mod & ProficiencyMod =>
  m.type === "proficiency" && typeof m.subType === "string";

export const isExpertiseMod = (m: Mod): m is Mod & ExpertiseMod =>
  m.type === "expertise" && typeof m.subType === "string";

export const isHalfProficiencyMod = (m: Mod): m is Mod & HalfProficiencyMod =>
  m.type === "half-proficiency" && typeof m.subType === "string";

export const isBonusMod = (m: Mod): m is Mod & BonusMod =>
  m.type === "bonus" && typeof m.subType === "string";

export const isSetMod = (m: Mod): m is Mod & SetMod =>
  m.type === "set" && typeof m.subType === "string";

export const isSetBaseMod = (m: Mod): m is Mod & SetBaseMod =>
  m.type === "set-base" && typeof m.subType === "string";

export const isSenseMod = (m: Mod): m is Mod & SenseMod =>
  m.type === "sense" && typeof m.subType === "string";

export const isResistanceMod = (m: Mod): m is Mod & ResistanceMod =>
  m.type === "resistance" && typeof m.subType === "string";

export const isImmunityMod = (m: Mod): m is Mod & ImmunityMod =>
  m.type === "immunity" && typeof m.subType === "string";

export const isVulnerabilityMod = (m: Mod): m is Mod & VulnerabilityMod =>
  m.type === "vulnerability" && typeof m.subType === "string";

export const isLanguageMod = (m: Mod): m is Mod & LanguageMod =>
  m.type === "language" && typeof m.subType === "string";

/**
 * True if any class entry is a Champion Fighter at level 7+ — the
 * threshold at which the Remarkable Athlete feature kicks in. DDB does
 * NOT emit a `half-proficiency` modifier for Remarkable Athlete (the way
 * it does for Bard's Jack of All Trades), so this predicate is the only
 * way to detect the feature reliably. Used by:
 *   - vitals.ts: adds half prof to initiative
 *   - stats.ts:  adds half prof to non-proficient STR/DEX/CON skills
 *
 * Detection accepts both shapes DDB has used for subclassDefinition
 * (`{ name: "..." }` and `{ definition: { name: "..." } }`).
 */
export function hasRemarkableAthlete(classes: ReadonlyArray<Record<string, unknown>>): boolean {
  return classes.some(cls => {
    const sub = obj(cls.subclassDefinition);
    const subName = str(obj(sub.definition ?? cls.subclassDefinition).name || sub.name);
    return /champion/i.test(subName) && num(cls.level) >= 7;
  });
}

/** Display labels for the six ability scores, in canonical order. */
export const statNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

/** Internal slugs for the six ability scores, in canonical order (matches statNames). */
export const statKeys = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

/**
 * Levenshtein edit distance between two strings. Used by character-name
 * fuzzy resolution (character.ts) and definition-query matching
 * (definition.ts).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}
