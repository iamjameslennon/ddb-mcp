/**
 * Shared types for the character module.
 *
 * Phase 1 of the character.ts refactor — see docs/character-refactor.md.
 *
 * `Mod`, `ClassEntry`, `InventoryItem`, `CharData` are all currently aliased
 * to `Record<string, unknown>`. They will be tightened to proper shapes
 * post-refactor (see follow-up A in the refactor doc) — the aliases exist so
 * future tightening is a one-place change instead of a sweep.
 */

export type CharData = Record<string, unknown>;
export type Mod = Record<string, unknown>;
export type ClassEntry = Record<string, unknown>;
export type InventoryItem = Record<string, unknown>;

export type ParseSection =
  | "summary" | "combat" | "spells" | "inventory"
  | "features" | "concentration" | "notes" | "full";

/**
 * The shared context object passed to every per-domain computer module.
 *
 * Computed once by `computeCoreStats(char)` (Phase 2) and threaded through
 * vitals/stats/spells/etc. Avoids each module re-deriving statMods,
 * profBonus, allMods, etc.
 */
export interface CoreStats {
  readonly char: CharData;
  readonly allMods: readonly Mod[];
  readonly statTotals: readonly number[];   // length 6: STR..CHA scores
  readonly statMods: readonly number[];     // length 6: STR..CHA modifiers
  readonly profBonus: number;
  readonly totalLevel: number;
  readonly classes: readonly ClassEntry[];
  readonly inventory: readonly InventoryItem[];
  readonly resolveTemplates: (text: string, classLevel?: number) => string;
}
