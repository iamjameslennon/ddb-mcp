/**
 * Subclass always-prepared spells (F4, owner ruling R1 2026-11-13, closes
 * carry-over (bb)). D&D Beyond's character JSON leaves out the spells a
 * subclass always has prepared (a Life Domain cleric's Bless, a Grave Domain
 * cleric's Vampiric Touch); the website reads them from
 * `game-data/always-prepared-spells`. `subclass-spells.ts` fetches those lists
 * and this pure module merges them into a copy of the character JSON, so the
 * parser lists them like any other class spell.
 */

import { num, obj, records } from "./helpers.js";
import type { CharData } from "./types.js";

/** Always-prepared spell entries per class, keyed by the `classes[]` entry's `id`. */
export type SubclassSpellLists = Map<number, Record<string, unknown>[]>;

/** One always-prepared request: the subclass and its class level, for the class entry it belongs to. */
export interface SubclassSpellRequest {
  characterClassId: number;
  subclassId: number;
  level: number;
}

/** One request per class entry with a subclass (`subclassDefinition.id`), at that class's level. */
export function subclassRequests(char: CharData): SubclassSpellRequest[] {
  const out: SubclassSpellRequest[] = [];
  for (const c of records(char.classes)) {
    const subclassId = obj(c.subclassDefinition).id;
    if (typeof subclassId !== "number" || typeof c.id !== "number") continue;
    out.push({ characterClassId: c.id, subclassId, level: num(c.level) });
  }
  return out;
}

/**
 * A new character JSON (`raw.data` or bare) with each list appended to its
 * class's `classSpells` entry, each appended spell marked `alwaysPrepared`.
 * The input is never mutated.
 *
 * The target entry is the one `classSpellLists` (spells.ts) resolves to that
 * class; when there is none, `{characterClassId, spells: []}` is added. A spell
 * goes into the field `classSpellLists` reads for the entry: `spells` when it
 * is non-empty (or both are empty), else the 2024 `classSpells` field.
 *
 * A listed spell whose definition id is already on the sheet (in any class
 * list, either field, or any `spells` bucket) is skipped: the sheet's entry,
 * with its own `prepared`, `usesSpellSlot` and casting data, wins.
 */
export function mergeAlwaysPreparedSpells(raw: Record<string, unknown>, lists: SubclassSpellLists): Record<string, unknown> {
  const hasData = raw.data != null && typeof raw.data === "object" && !Array.isArray(raw.data);
  const char: CharData = { ...(hasData ? obj(raw.data) : raw) };
  if (lists.size === 0) return hasData ? { ...raw, data: char } : char;

  const classes = records(char.classes);
  const classSpells: Record<string, unknown>[] = records(char.classSpells).map(cs => ({ ...cs }));
  const seen = new Set<number>();
  const note = (s: Record<string, unknown>) => {
    const id = obj(s.definition).id;
    if (typeof id === "number") seen.add(id);
  };
  for (const cs of classSpells) {
    records(cs.spells).forEach(note);
    records(cs.classSpells).forEach(note);
  }
  for (const bucket of Object.values(obj(char.spells))) records(bucket).forEach(note);

  // The class `classSpellLists` resolves an entry to: the first class matching
  // its characterClassId, id or classId.
  const resolvedClassId = (cs: Record<string, unknown>): unknown =>
    classes.find(c => c.id === cs.characterClassId || c.id === cs.id || c.id === cs.classId)?.id;

  let changed = false;
  for (const [characterClassId, spells] of lists) {
    const added: Record<string, unknown>[] = [];
    for (const s of spells) {
      const id = obj(s.definition).id;
      if (typeof id === "number" && seen.has(id)) continue;
      if (typeof id === "number") seen.add(id);
      added.push({ ...s, alwaysPrepared: true });
    }
    // Nothing new (every 2024 subclass answers []): leave the class as it is.
    if (added.length === 0) continue;
    let entry = classSpells.find(cs => resolvedClassId(cs) === characterClassId);
    if (!entry) {
      entry = { characterClassId, spells: [] };
      classSpells.push(entry);
    }
    const field = records(entry.spells).length > 0 || records(entry.classSpells).length === 0 ? "spells" : "classSpells";
    entry[field] = [...(Array.isArray(entry[field]) ? (entry[field] as unknown[]) : []), ...added];
    changed = true;
  }

  if (changed) char.classSpells = classSpells;
  return hasData ? { ...raw, data: char } : char;
}
