/**
 * How a spell is cast: the slot it uses. `spellCastLabel` serves the
 * CONCENTRATION SPELLS block and the bonus-action / reaction spell lines; the
 * ACTIONS spell rows (spell-attacks.ts) share only `castLevel`, and still print
 * `(cantrip | Nth level)`. Pure helpers over the character's class entries;
 * this module imports neither spells.ts nor spell-attacks.ts.
 */

import { num, obj, str } from "./helpers.js";
import type { ClassEntry } from "./types.js";

type Rec = Record<string, unknown>;

const SLOT_ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
export const slotOrdinal = (lvl: number): string => SLOT_ORDINAL[lvl] ?? `${lvl}th`;

const levelRow = (cls: ClassEntry): unknown[] => {
  const table = obj(obj(cls.definition).spellRules).levelSpellSlots;
  const row = Array.isArray(table) ? table[num(cls.level)] : undefined;
  return Array.isArray(row) ? row : [];
};
/** The entry's `castAtLevel` when it is an integer above 0, else 0. */
const fixedCastLevel = (entry: Rec): number => {
  const fixed = entry.castAtLevel;
  return typeof fixed === "number" && Number.isInteger(fixed) && fixed > 0 ? fixed : 0;
};
const isWarlock = (cls: ClassEntry): boolean => str(obj(cls.definition).name) === "Warlock";

/** A Warlock's pact slot level: the highest slot level with slots in its levelSpellSlots row. 0 for any other class. */
export function pactSlotLevel(cls: ClassEntry): number {
  if (!isWarlock(cls)) return 0;
  const row = levelRow(cls);
  for (let i = row.length - 1; i >= 0; i--) if (num(row[i]) > 0) return i + 1;
  return 0;
}

/**
 * The lowest slot level at or above `spellLevel` that a spellcasting class
 * other than Warlock has slots of (the same `canCastSpells` gate as the SPELL
 * SLOTS block); 0 when there is none.
 */
export function lowestSharedSlot(classes: readonly ClassEntry[], spellLevel: number): number {
  let lowest = 0;
  for (const cls of classes) {
    if (isWarlock(cls)) continue;
    if (obj(cls.definition).canCastSpells !== true && obj(cls.subclassDefinition).canCastSpells !== true) continue;
    const row = levelRow(cls);
    for (let slot = Math.max(spellLevel, 1); slot <= row.length; slot++) {
      if (num(row[slot - 1]) > 0) {
        if (!lowest || slot < lowest) lowest = slot;
        break;
      }
    }
  }
  return lowest;
}

/**
 * The level a leveled spell is cast at: the entry's `castAtLevel` (racial
 * Hellish Rebuke at 2); for a Warlock class-list spell, the lower of the pact
 * slot level and the lowest shared slot; otherwise the spell's own level.
 */
export function castLevel(entry: Rec, spellLevel: number, isWarlockList: boolean, classes: readonly ClassEntry[]): number {
  const fixed = fixedCastLevel(entry);
  if (fixed) return fixed;
  if (!isWarlockList) return spellLevel;
  const pact = Math.max(0, ...classes.map(pactSlotLevel));
  const options = [pact, lowestSharedSlot(classes, spellLevel)].filter(l => l >= spellLevel && l > 0);
  return options.length ? Math.min(...options) : spellLevel;
}

/**
 * How a spell is cast, as one label: "cantrip" for level 0; for a spell that
 * uses no slot (`usesSpellSlot === false`) "no slot", or "from item" in the
 * item bucket, prefixed with "<Nth> level, " when the entry fixes its cast
 * level (`castAtLevel`; owner ruling R5, 2026-11-17); otherwise
 * "<Nth>-level slot" at the level `castLevel` finds (the pact slot for a
 * Warlock class-list spell).
 */
export function spellCastLabel(
  entry: Rec,
  opts: { isWarlockList: boolean; bucket?: string },
  classes: readonly ClassEntry[],
): string {
  const level = num(obj(entry.definition).level);
  if (level === 0) return "cantrip";
  if (entry.usesSpellSlot === false) {
    const how = opts.bucket === "item" ? "from item" : "no slot";
    const fixed = fixedCastLevel(entry);
    return fixed ? `${slotOrdinal(fixed)} level, ${how}` : how;
  }
  return `${slotOrdinal(castLevel(entry, level, opts.isWarlockList, classes))}-level slot`;
}
