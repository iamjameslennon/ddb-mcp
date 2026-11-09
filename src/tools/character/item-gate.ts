/**
 * Whether a modifier granted by an inventory item applies: the item must be
 * active (equipped, and attuned when its definition requires attunement).
 *
 * `core.allMods` applies no such gate (it includes unequipped items'
 * modifiers), so callers that must not count an inactive item's modifier
 * (spell attack/DC bonuses, spell damage bonuses, save advantages) use this.
 */

import { num, obj } from "./helpers.js";
import type { InventoryItem, Mod } from "./types.js";

/** One inventory copy is active: equipped, and attuned when its definition has `canAttune: true`. */
const isActiveCopy = (item: InventoryItem): boolean =>
  item.equipped === true && (obj(item.definition).canAttune !== true || item.isAttuned === true);

/**
 * Whether `m` applies. An item modifier's componentId / componentTypeId are
 * its item's `definition.id` / `definition.entityTypeId` (live 2026-11-07: 49
 * of 49 resolve). A character can own several copies of one definition, so
 * the modifier applies when any matching copy is active. A modifier that
 * matches no inventory copy is not from an item, and always applies. A
 * modifier without both ids can't name an item.
 */
export function isActiveItemMod(m: Mod, inventory: readonly InventoryItem[]): boolean {
  const id = num(obj(m).componentId);
  const typeId = num(obj(m).componentTypeId);
  if (!id || !typeId) return true;
  const copies = inventory.filter(i => {
    const def = obj(obj(i).definition);
    return num(def.id) === id && num(def.entityTypeId) === typeId;
  });
  return copies.length === 0 || copies.some(i => isActiveCopy(obj(i)));
}
