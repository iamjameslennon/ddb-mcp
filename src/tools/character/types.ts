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

// ── Mod discriminated-union shapes (follow-up A) ──────────────────────────────
// Tightened incrementally — one mod-type at a time. Each shape is narrow on
// purpose: only the fields the consumers actually read. Type guards live in
// helpers.ts. See docs/character-refactor.md § "Tighten Mod" for the rationale.

/** `type:"proficiency"` — skill/save/tool/weapon/armor/language proficiency grant. */
export interface ProficiencyMod      { type: "proficiency";      subType: string }
/** `type:"expertise"` — doubles proficiency bonus on the given skill/tool. */
export interface ExpertiseMod        { type: "expertise";        subType: string }
/** `type:"half-proficiency"` — half-prof (Jack of All Trades family). */
export interface HalfProficiencyMod  { type: "half-proficiency"; subType: string }

/**
 * `type:"bonus"` — additive numeric modifier. Most varied mod type in DDB:
 * AC, skill bonuses, ability-score buffs, HP-per-level, initiative, speed,
 * hit/damage. The value is in `value` OR `fixedValue` (use `??` —
 * "whichever is present"), or computed from `statId` (e.g. Gloom Stalker
 * Dread Ambusher adds WIS mod to initiative). `bonusTypes` indicates a
 * dynamic value source (e.g. `[1]` = use the proficiency bonus).
 * `isGranted: false` on a race mod means the player declined the ASI
 * (2024 floating-ASI rule).
 */
export interface BonusMod {
  type: "bonus";
  subType: string;
  value?: number | null;
  fixedValue?: number | null;
  statId?: number | null;
  isGranted?: boolean;
  bonusTypes?: number[];
}

/**
 * `type:"set"` — replaces the base value (e.g. Belt of Giant Strength sets STR
 * to 23, Boots of Striding and Springing set walking speed to 40, Draconic
 * Resilience sets unarmored AC base via `unarmored-armor-class`).
 * `componentId` discriminates dual-encoded set+sense pairs from same-source
 * extensions in the sense calculation.
 */
export interface SetMod {
  type: "set";
  subType: string;
  value?: number | null;
  fixedValue?: number | null;
  statId?: number | null;
  componentId?: number;
}

/**
 * `type:"set-base"` — baseline-establishing set, used by senses (e.g. race
 * darkvision baseline 60 ft.). Functionally identical to `set` for the
 * baseline pass; the distinct type exists because DDB sometimes emits both.
 */
export interface SetBaseMod {
  type: "set-base";
  subType: string;
  value?: number | null;
  fixedValue?: number | null;
  componentId?: number;
}

/**
 * `type:"sense"` — grants or extends a sense (Darkvision, Blindsight, etc.).
 * Pass 2 of the sense calculation uses `componentId` to decide whether the mod
 * is a dual encoding of the baseline (take max) or an extension from a
 * different source (additive — Gloom Stalker Umbral Sight +30 ft on race
 * darkvision 60 ft).
 */
export interface SenseMod {
  type: "sense";
  subType: string;
  value?: number | null;
  componentId?: number;
}

/** `type:"resistance"` — damage resistance grant (e.g. "fire", "cold"). */
export interface ResistanceMod    { type: "resistance";    subType: string }
/** `type:"immunity"` — damage immunity grant (e.g. "poison", "psychic"). */
export interface ImmunityMod      { type: "immunity";      subType: string }
/** `type:"vulnerability"` — damage vulnerability grant. */
export interface VulnerabilityMod { type: "vulnerability"; subType: string }

/**
 * `type:"language"` — language proficiency grant. The standard race/class/feat
 * source for languages. The other two storage mechanisms (custom proficiencies
 * with `type: 3`, and `characterValues` entries with `typeId: 35`) live
 * outside `modifiers` and don't use this interface.
 */
export interface LanguageMod { type: "language"; subType: string }

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
