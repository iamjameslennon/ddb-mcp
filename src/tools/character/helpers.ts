/**
 * Primitive helpers shared across the character module.
 *
 * Phase 1 of the character.ts refactor — see docs/character-refactor.md.
 * No business logic — pure type/string/number utilities.
 */

import type { Mod } from "./types.js";

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
