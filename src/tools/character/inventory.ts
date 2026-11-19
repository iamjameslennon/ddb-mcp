/**
 * Inventory domain — equipped armor, carried (non-weapon) items, attunement
 * count, and currency. Owns the inventory block.
 *
 * Phase 8 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Weapons are intentionally excluded — they're surfaced in the ACTIONS
 * block (Phase 6a), as are equipped non-armor items with a weapon behaviour
 * (staffs; an attuned one still shows on the attunement line). Equipped armor is shown separately with its AC value;
 * everything else non-weapon is rolled into a single `; `-separated
 * INVENTORY line (item names hold commas, e.g. `Clothes, Common`) with ×N consolidation.
 *
 * Homebrew items are other players' text: an EQUIPPED line is wrapped whole,
 * and homebrew carried items leave the INVENTORY line for a wrapped list under
 * an `INVENTORY (homebrew)` header (never merged with an official item).
 */

import { wrapIfHomebrew, wrapUntrusted } from "../../utils.js";
import { weaponDefinition } from "./weapons.js";
import { num, obj, shownHomebrew, str } from "./helpers.js";
import type { CharData, CoreStats, ListEntry } from "./types.js";

export interface Inventory {
  equippedNonWeapons: ListEntry[]; // [{ text: "Leather Armor (AC 11)", homebrew: false }, …]
  inventoryLine: string;           // "Backpack; Rations ×5; Torch ×3" (official items)
  homebrewInventoryLine: string;   // the homebrew carried items, same form; "" when none
  attunedItems: ListEntry[];       // every attuned item (weapons included), inventory order
  currencyLine: string;            // "100gp, 5sp" or "none"
}

function buildCurrencyLine(char: CharData): string {
  const currencies = obj(char.currencies);
  return ["pp", "gp", "ep", "sp", "cp"]
    .map(c => `${num(currencies[c])}${c}`)
    .filter(c => !c.startsWith("0"))
    .join(", ") || "none";
}

// D&D Beyond's `quantity` counts pieces and `definition.bundleSize` is the pieces per bundle (F11), so an item
// whose name states that size ("Caltrops (bag of 20)", qty 100) counts in bundles. The name may carry a trailing
// edition/homebrew tag (`named()`), which the pattern steps over; the tag stays where it is.
const BUNDLE_NAME = /\(\s*(?:[a-z]+\s+)?of\s+([\d,]+)\s*\)(?:\s*\[[^\]]*\])*\s*$/i;

export function bundleEntry(name: string, quantity: number, bundleSize: number): string {
  const written = BUNDLE_NAME.exec(name)?.[1];
  const n = written === undefined ? NaN : Number(written.replace(/,/g, ""));
  if (bundleSize > 1 && n === bundleSize) {
    if (quantity % n === 0) {
      const k = quantity / n;
      return k === 1 ? name : `${name} ×${k}`;
    }
    return `${name} — ${quantity} of ${written}`;
  }
  return quantity > 1 ? `${name} ×${quantity}` : name;
}

export function computeInventory(core: CoreStats): Inventory {
  const { char, inventory, editions } = core;
  const equippedNonWeapons: ListEntry[] = [];
  const carriedItems = new Map<string, { qty: number; bundleSize: number }>();
  const homebrewItems = new Map<string, { qty: number; bundleSize: number }>();
  const attunedItems: ListEntry[] = [];
  for (const i of inventory) {
    const def = obj(i.definition);
    const iName = editions.named(str(def.name).trim(), def);
    const filterType = str(def.filterType);
    // An equipped item that attacks (a Weapon, or a staff with a weapon behaviour) shows in ACTIONS, not here.
    // Armor with a weapon behaviour keeps its EQUIPPED line (AC) and also gets its ACTIONS row (owner decision 2026-11-17).
    const attacksFromActions = i.equipped === true && filterType !== "Armor" && weaponDefinition(def) !== null;
    const qty = num(i.quantity) || 1;
    const homebrew = shownHomebrew(i, iName);
    if (i.isAttuned) attunedItems.push({ text: iName, homebrew });
    if (attacksFromActions) continue;
    if (i.equipped && filterType === "Armor") {
      const ac2 = num(def.armorClass);
      equippedNonWeapons.push({ text: `${iName}${ac2 ? ` (AC ${ac2})` : ""}`, homebrew });
    } else if (i.equipped && filterType !== "Weapon" && (def.magic === true || def.canAttune === true)) {
      equippedNonWeapons.push({ text: iName, homebrew });
    } else if (filterType !== "Weapon") {
      const items = homebrew ? homebrewItems : carriedItems;
      const seen = items.get(iName);
      items.set(iName, { qty: (seen?.qty ?? 0) + qty, bundleSize: seen?.bundleSize ?? num(def.bundleSize) });
    }
  }
  const line = (items: Map<string, { qty: number; bundleSize: number }>) => [...items.entries()]
    .map(([n, { qty: q, bundleSize }]) => bundleEntry(n, q, bundleSize))
    .join("; ");
  return {
    equippedNonWeapons,
    inventoryLine: line(carriedItems),
    homebrewInventoryLine: line(homebrewItems),
    attunedItems,
    currencyLine: buildCurrencyLine(char),
  };
}

function attunementLine(items: ListEntry[]): string {
  const text = `ATTUNEMENT (${items.length}/3): ${items.map(e => e.text).join("; ") || "none"}`;
  return wrapIfHomebrew(text, items.some(e => e.homebrew));
}

export function formatInventoryBlock(inv: Inventory): string[] {
  return [
    ...(inv.equippedNonWeapons.length
      ? [`EQUIPPED`, ...inv.equippedNonWeapons.map(e => wrapIfHomebrew(`  ${e.text}`, e.homebrew)), ``]
      : []),
    ...(inv.inventoryLine ? [`INVENTORY`, `  ${inv.inventoryLine}`] : []),
    ...(inv.homebrewInventoryLine ? [`INVENTORY (homebrew)`, wrapUntrusted(`  ${inv.homebrewInventoryLine}`)] : []),
    ...(inv.inventoryLine || inv.homebrewInventoryLine ? [``] : []),
    attunementLine(inv.attunedItems),
    ``,
    `CURRENCY: ${inv.currencyLine}`,
    ``,
  ];
}
