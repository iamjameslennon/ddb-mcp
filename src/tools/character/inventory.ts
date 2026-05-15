/**
 * Inventory domain — equipped armor, carried (non-weapon) items, attunement
 * count, and currency. Owns the inventory block.
 *
 * Phase 8 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Weapons are intentionally excluded — they're surfaced in the ACTIONS
 * block (Phase 6a). Equipped armor is shown separately with its AC value;
 * everything else non-weapon is rolled into a single comma-separated
 * INVENTORY line with ×N consolidation.
 */

import { num, obj, str } from "./helpers.js";
import type { CharData, CoreStats } from "./types.js";

export interface Inventory {
  equippedNonWeapons: string[];   // ["Leather Armor (AC 11)", "Shield (AC 2)"]
  inventoryLine: string;           // "Backpack, Rations ×5, Torch ×3"
  attuned: number;                 // count of attuned items
  currencyLine: string;            // "100gp, 5sp" or "none"
}

function buildCurrencyLine(char: CharData): string {
  const currencies = obj(char.currencies);
  return ["pp", "gp", "ep", "sp", "cp"]
    .map(c => `${num(currencies[c])}${c}`)
    .filter(c => !c.startsWith("0"))
    .join(", ") || "none";
}

export function computeInventory(core: CoreStats): Inventory {
  const { char, inventory } = core;
  const equippedNonWeapons: string[] = [];
  const carriedItems = new Map<string, number>();
  let attuned = 0;
  for (const i of inventory) {
    const def = obj(i.definition);
    const iName = str(def.name);
    const filterType = str(def.filterType);
    const qty = num(i.quantity) || 1;
    if (i.isAttuned) attuned++;
    if (i.equipped && filterType === "Armor") {
      const ac2 = num(def.armorClass);
      equippedNonWeapons.push(`${iName}${ac2 ? ` (AC ${ac2})` : ""}`);
    } else if (filterType !== "Weapon") {
      carriedItems.set(iName, (carriedItems.get(iName) ?? 0) + qty);
    }
  }
  const inventoryLine = [...carriedItems.entries()]
    .map(([n, q]) => q > 1 ? `${n} ×${q}` : n)
    .join(", ");
  return {
    equippedNonWeapons,
    inventoryLine,
    attuned,
    currencyLine: buildCurrencyLine(char),
  };
}

export function formatInventoryBlock(inv: Inventory): string[] {
  return [
    ...(inv.equippedNonWeapons.length
      ? [`EQUIPPED`, ...inv.equippedNonWeapons.map(e => `  ${e}`), ``]
      : []),
    ...(inv.inventoryLine ? [`INVENTORY`, `  ${inv.inventoryLine}`, ``] : []),
    `ATTUNEMENT: ${inv.attuned}/3 slots used`,
    ``,
    `CURRENCY: ${inv.currencyLine}`,
  ];
}
