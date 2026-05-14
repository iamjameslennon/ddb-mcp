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

/** Display labels for the six ability scores, in canonical order. */
export const statNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

/** Internal slugs for the six ability scores, in canonical order (matches statNames). */
export const statKeys = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
