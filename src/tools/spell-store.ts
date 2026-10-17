/**
 * spell-store.ts — id-keyed spell storage. One name can be several
 * definitions (a 2014 and a 2024 version), so spells are keyed by definition
 * id and grouped by twin name; choosing between editions is the caller's job.
 */

import { twinName } from "../edition.js";

export interface SpellDefinition {
  id: number;
  name: string;
  level: number;
  school: string;
  description: string;
  snippet?: string;
  concentration: boolean;
  ritual: boolean;
  isLegacy?: boolean | null;
  isHomebrew?: boolean | null;
  sources?: Array<{ sourceId: number }> | null;
  components?: number[];
  componentsDescription?: string;
  activation?: { activationTime: number; activationType: number };
  range?: { origin: string; rangeValue?: number; aoeType?: string; aoeValue?: number };
  duration?: { durationInterval?: number; durationUnit?: string; durationType?: string };
}

export interface DdbSpell {
  definition: SpellDefinition;
}

export interface SpellStore {
  byId: Map<number, DdbSpell>;
  /** `twinName(definition.name)` → definition ids, in insertion order. */
  byTwin: Map<string, number[]>;
}

export function createSpellStore(): SpellStore {
  return { byId: new Map(), byTwin: new Map() };
}

/**
 * Add each entry that has a definition object with a finite numeric id and a
 * non-empty string name. The first occurrence of an id wins. Returns how many
 * entries were dropped for a missing definition, id or name (duplicates of an
 * id already stored are not drops).
 */
export function addSpells(store: SpellStore, spells: Iterable<unknown>): number {
  let dropped = 0;
  for (const entry of spells) {
    const def = entry && typeof entry === "object"
      ? (entry as { definition?: unknown }).definition
      : undefined;
    if (!def || typeof def !== "object") { dropped++; continue; }
    const { id, name } = def as { id?: unknown; name?: unknown };
    if (typeof id !== "number" || !Number.isFinite(id) || typeof name !== "string" || name === "") {
      dropped++;
      continue;
    }
    if (store.byId.has(id)) continue;
    store.byId.set(id, entry as DdbSpell);
    const key = twinName(name);
    const ids = store.byTwin.get(key);
    if (ids) ids.push(id); else store.byTwin.set(key, [id]);
  }
  return dropped;
}

/** Every spell in insertion order. */
export function spellList(store: SpellStore): DdbSpell[] {
  return [...store.byId.values()];
}
