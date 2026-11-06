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
 *
 * Homebrew items are other players' text: an EQUIPPED line is wrapped whole,
 * and homebrew carried items leave the INVENTORY line for a wrapped list under
 * an `INVENTORY (homebrew)` header (never merged with an official item).
 */

import { wrapIfHomebrew, wrapUntrusted } from "../../utils.js";
import { num, obj, shownHomebrew, str } from "./helpers.js";
import type { CharData, CoreStats, ListEntry } from "./types.js";

export interface Inventory {
  equippedNonWeapons: ListEntry[]; // [{ text: "Leather Armor (AC 11)", homebrew: false }, …]
  inventoryLine: string;           // "Backpack, Rations ×5, Torch ×3" (official items)
  homebrewInventoryLine: string;   // the homebrew carried items, same form; "" when none
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
  const { char, inventory, editions } = core;
  const equippedNonWeapons: ListEntry[] = [];
  const carriedItems = new Map<string, number>();
  const homebrewItems = new Map<string, number>();
  let attuned = 0;
  for (const i of inventory) {
    const def = obj(i.definition);
    const iName = editions.named(str(def.name), def);
    const filterType = str(def.filterType);
    const qty = num(i.quantity) || 1;
    const homebrew = shownHomebrew(i, iName);
    if (i.isAttuned) attuned++;
    if (i.equipped && filterType === "Armor") {
      const ac2 = num(def.armorClass);
      equippedNonWeapons.push({ text: `${iName}${ac2 ? ` (AC ${ac2})` : ""}`, homebrew });
    } else if (filterType !== "Weapon") {
      const items = homebrew ? homebrewItems : carriedItems;
      const key = homebrew ? iName.trim() : iName;
      items.set(key, (items.get(key) ?? 0) + qty);
    }
  }
  const line = (items: Map<string, number>) => [...items.entries()]
    .map(([n, q]) => q > 1 ? `${n} ×${q}` : n)
    .join(", ");
  return {
    equippedNonWeapons,
    inventoryLine: line(carriedItems),
    homebrewInventoryLine: line(homebrewItems),
    attuned,
    currencyLine: buildCurrencyLine(char),
  };
}

export function formatInventoryBlock(inv: Inventory): string[] {
  return [
    ...(inv.equippedNonWeapons.length
      ? [`EQUIPPED`, ...inv.equippedNonWeapons.map(e => wrapIfHomebrew(`  ${e.text}`, e.homebrew)), ``]
      : []),
    ...(inv.inventoryLine ? [`INVENTORY`, `  ${inv.inventoryLine}`] : []),
    ...(inv.homebrewInventoryLine ? [`INVENTORY (homebrew)`, wrapUntrusted(`  ${inv.homebrewInventoryLine}`)] : []),
    ...(inv.inventoryLine || inv.homebrewInventoryLine ? [``] : []),
    `ATTUNEMENT: ${inv.attuned}/3 slots used`,
    ``,
    `CURRENCY: ${inv.currencyLine}`,
  ];
}
