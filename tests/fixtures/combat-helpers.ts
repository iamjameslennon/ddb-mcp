/**
 * Shared fixtures for the combat-section tests: entity-type ids, the Fighter 5
 * base sheet, and builders for actions, class features and the combat output.
 */
import { expect } from "vitest";
import { parseCharacterData as parseSheet } from "../../src/tools/character.js";
import { FIGHTER_5 } from "./character-fixtures.js";
import { INDEX, withoutNameWrap } from "./character-edition-helpers.js";

/** The sheet without its always-present name wrap (see withoutNameWrap). */
const parseCharacterData = (...args: Parameters<typeof parseSheet>): string => withoutNameWrap(parseSheet(...args));

export const CLASS_FEATURE = 12168134;
export const RACIAL_TRAIT = 1960452172;
export const FEAT = 1088085227;
export const OPTION = 258900837;
export const RACE_OPTION = 306912077;
export const BACKGROUND = 1669830167;
export const ITEM = 112130694;

export const BASE = FIGHTER_5.data as Record<string, unknown>;
export const FIGHTER = (BASE.classes as Record<string, unknown>[])[0];

export function combat(overrides: Record<string, unknown>): string {
  const data = { ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides };
  return parseCharacterData({ data }, "combat", INDEX);
}

/** The lines between the section header `from` and the next blank line. */
export function block(out: string, from: string): string {
  const lines = out.split("\n");
  const start = lines.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  return lines.slice(start, lines.indexOf("", start)).join("\n");
}

export const ACTION = 1;
export const BONUS = 3;
export const REACTION = 4;
export const SPECIAL = 8;
export const action = (name: string, componentId: number, componentTypeId: number, activationType: number, extra: Record<string, unknown> = {}) =>
  ({ id: `${componentId}${name.length}`, entityTypeId: 222216831, componentId, componentTypeId, name, activation: { activationType }, limitedUse: null, ...extra });
export const limited = { limitedUse: { maxUses: 2, numberUsed: 0, resetType: 1 } };
export const actions = (buckets: Record<string, unknown[]>) => ({ actions: { class: [], race: [], feat: [], background: null, item: null, ...buckets } });
export const feature = (id: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ definition: { id, entityTypeId: CLASS_FEATURE, name, requiredLevel: 1, ...extra } });
export const fighter = (extra: Record<string, unknown>) => ({ ...FIGHTER, ...extra });

