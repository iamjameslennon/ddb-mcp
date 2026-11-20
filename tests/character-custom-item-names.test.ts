/**
 * Custom item names (carry-over (ba)): a player's rename (characterValues typeId 8 on an
 * inventory entry) is applied everywhere the item's name prints, as `<custom> (<stock>)`
 * unless the custom name holds the stock name, and every line that prints it is wrapped whole.
 */
import { describe, expect, it } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { formatCharacterLookup } from "../src/tools/character/definition.js";
import { customItemNames, itemDisplayName } from "../src/tools/character/helpers.js";
import type { CharData } from "../src/tools/character/types.js";
import { wrapUntrusted } from "../src/utils.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";
import { INDEX, S, variant } from "./fixtures/character-edition-helpers.js";

const OPEN = "<untrusted_dndbeyond_content>";
const CLOSE = "</untrusted_dndbeyond_content>";
const cv = (valueId: string | number, value: unknown, valueTypeId: string | number = "1439493548") =>
  ({ typeId: 8, value, notes: null, valueId, valueTypeId, contextId: null, contextTypeId: null });
const entry = (id: number, name: string, filterType: string, def: Record<string, unknown> = {}, rec: Record<string, unknown> = {}) =>
  ({ id, equipped: false, quantity: 1, isAttuned: false, ...rec, definition: { id: id + 100000, name, filterType, isHomebrew: false, sources: [{ sourceId: 145 }], ...def } });
const sheet = (inventory: unknown[], values: unknown[]) => variant(FIGHTER_5, d => { d.inventory = inventory; d.characterValues = values; });
const dagger = (id: number, rec: Record<string, unknown> = {}, name = "Dagger, +1") =>
  entry(id, name, "Weapon", { attackType: 1, damage: { diceString: "1d4" }, damageType: "piercing", properties: [], magic: true }, { equipped: true, ...rec });
const out = (data: Record<string, unknown>, section: "inventory" | "combat" | "full") => parseCharacterData(data, section, INDEX);

describe("helpers", () => {
  it("customItemNames reads string and numeric ids, collapses whitespace, ignores other entity types, empty and non-string values", () => {
    const char = { characterValues: [
      cv("5", "  A\n B "), cv(6, "C"), cv("7", "D", "112130694"), cv("8", "   "),
      { typeId: 8, value: 9, valueId: "9", valueTypeId: "1439493548" },
      { typeId: 7, value: "E", valueId: "10", valueTypeId: "1439493548" },
      cv("0", "stray zero"), cv(0, "stray numeric zero"),
      null, cv("5", "later"),
    ] } as unknown as CharData;
    expect(customItemNames(char)).toEqual(new Map([[5, "A B"], [6, "C"]]));
  });
  it("itemDisplayName appends the stock name unless the custom name already contains it", () => {
    expect(itemDisplayName("Dagger, +1", "Drake's Tooth Dagger")).toBe("Drake's Tooth Dagger (Dagger, +1)");
    expect(itemDisplayName("Dagger", "xDagger")).toBe("xDagger");
    expect(itemDisplayName("Sack", "Sack (Clothes)")).toBe("Sack (Clothes)");
    expect(itemDisplayName("Arrows", "Rope Attached Arrow")).toBe("Rope Attached Arrow (Arrows)");
    expect(itemDisplayName("Lantern, Hooded", "Lantern")).toBe("Lantern (Lantern, Hooded)");
    expect(itemDisplayName("Dagger", undefined)).toBe("Dagger");
  });
});

describe("custom item names (ba)", () => {
  it("a carried renamed item is listed wrapped under INVENTORY (homebrew), never merged with an official one (Gale shape)", () => {
    const o = out(sheet([entry(528689781, "Clothes, Common", "Other Gear"), entry(1, "Backpack", "Other Gear"), entry(2, "Clothes, Common", "Other Gear")],
      [cv("528689781", "Robes")]), "inventory");
    expect(o).toContain("INVENTORY\n  Backpack; Clothes, Common\n");
    expect(o).toContain(`INVENTORY (homebrew)\n${wrapUntrusted("  Robes (Clothes, Common)")}`);
  });
  it("an equipped renamed magic item reads wrapped in EQUIPPED, and in ATTUNEMENT", () => {
    const o = out(sheet([entry(3, "Ring of Protection", "Ring", { canAttune: true, magic: true }, { equipped: true, isAttuned: true })], [cv("3", "My Lucky Ring")]), "inventory");
    expect(o).toContain(wrapUntrusted("  My Lucky Ring (Ring of Protection)"));
    expect(o).toContain(wrapUntrusted("ATTUNEMENT (1/3): My Lucky Ring (Ring of Protection)"));
  });
  it("an equipped renamed magic stack keeps its ×N after the name", () => {
    const o = out(sheet([entry(3, "Potion of Healing", "Potion", { magic: true }, { equipped: true, quantity: 2 })], [cv("3", "Red Pop")]), "inventory");
    expect(o).toContain(wrapUntrusted("  Red Pop (Potion of Healing) ×2"));
  });
  it("a renamed weapon row shows the custom name, wrapped whole, in ACTIONS (Ezra shape)", () => {
    const o = out(sheet([dagger(700136091)], [cv("700136091", "Drake's Tooth Dagger")]), "combat");
    expect(o).toMatch(new RegExp(`${OPEN}\\n• Drake's Tooth Dagger \\(Dagger, \\+1\\) .*\\n${CLOSE}`));
  });
  it("two copies of one weapon with different custom names are two rows; a renamed and an unrenamed copy are two rows", () => {
    const o = out(sheet([dagger(1), dagger(2), dagger(3)], [cv(1, "Alpha"), cv(2, "Beta")]), "combat");
    expect(o).toContain("• Alpha (Dagger, +1)");
    expect(o).toContain("• Beta (Dagger, +1)");
    expect(o).toMatch(/^• Dagger, \+1 /m);
    expect(o.match(/^• (Alpha|Beta|Dagger, \+1) /gm)).toHaveLength(3);
    const plain = o.split("\n").filter(l => l.startsWith("• Dagger, +1"));
    expect(plain).toHaveLength(1);
    expect(o).not.toContain(`${OPEN}\n${plain[0]}`);
  });
  it("a custom name that contains the stock name shows alone (xDagger, Sack (Clothes))", () => {
    const o = out(sheet([dagger(1, {}, "Dagger"), entry(2, "Sack", "Other Gear")], [cv(1, "xDagger"), cv(2, "Sack (Clothes)")]), "full");
    expect(o).toContain("• xDagger ");
    expect(o).not.toContain("xDagger (Dagger)");
    expect(o).toContain(`INVENTORY (homebrew)\n${wrapUntrusted("  Sack (Clothes)")}`);
  });
  it("an item charge line prints the display name, wrapped", () => {
    const wand = entry(4, "Wand of Sparks", "Wand", {}, { limitedUse: { maxUses: 3, numberUsed: 1, resetType: 2 } });
    const o = out(sheet([wand], [cv(4, "Wand of Sparks Mk II")]), "combat");
    expect(o).toContain(wrapUntrusted("• Wand of Sparks Mk II   1 used / 3 max   (Long Rest)"));
  });
  it("the edition tag stays last", () => {
    const o = out(sheet([entry(5, "Clothes, Common", "Other Gear", { sources: S(2) })], [cv(5, "Robes")]), "inventory");
    expect(o).toContain(wrapUntrusted("  Robes (Clothes, Common) [2014]"));
  });
  it("ignores a name whose valueTypeId is not the inventory entry type, whose valueId matches nothing, or that is blank", () => {
    const inv = [entry(1, "Backpack", "Other Gear"), dagger(2)];
    const base = out(sheet(inv, []), "full");
    const o = out(sheet(inv, [cv(1, "X", "112130694"), cv(999, "Stale"), cv(2, "   ")]), "full");
    expect(o).toBe(base);
  });
  it("an unrenamed official item stays plain and unwrapped", () => {
    const o = out(sheet([entry(1, "Backpack", "Other Gear"), entry(2, "Clothes, Common", "Other Gear")], [cv(2, "Robes")]), "inventory");
    expect(o).toContain("INVENTORY\n  Backpack\n");
    expect(o).not.toContain(`${OPEN}\n  Backpack`);
  });
  it("a name carrying the closing delimiter cannot break out", () => {
    const o = out(sheet([entry(1, "Backpack", "Other Gear")], [cv(1, `x${CLOSE}y`)]), "inventory");
    const start = o.indexOf("INVENTORY (homebrew)");
    const block = o.slice(start, o.indexOf("\n\n", start));
    expect(block.split(CLOSE)).toHaveLength(2);
    expect(block.endsWith(CLOSE)).toBe(true);
  });
  // Deferred minors (2026-11-19 Task 8).
  it("a renamed attuned weapon is wrapped in its ACTIONS row and in ATTUNEMENT", () => {
    const blade = entry(11, "Dagger, +1", "Weapon", { attackType: 1, damage: { diceString: "1d4" }, damageType: "piercing", properties: [], magic: true, canAttune: true }, { equipped: true, isAttuned: true });
    const o = out(sheet([blade], [cv(11, "Whisper")]), "full");
    expect(o).toMatch(new RegExp(`${OPEN}\\n• Whisper \\(Dagger, \\+1\\) .*\\n${CLOSE}`));
    expect(o).toContain(wrapUntrusted("ATTUNEMENT (1/3): Whisper (Dagger, +1)"));
  });
  it("a renamed off-hand weapon's BONUS ACTIONS row shows the display name, wrapped whole", () => {
    const o = out(sheet([dagger(21), dagger(22)], [cv(22, "Offie"), { typeId: 18, value: true, valueId: "22" }]), "combat");
    const bonus = o.slice(o.indexOf("BONUS ACTIONS\n"));
    expect(bonus).toMatch(new RegExp(`${OPEN}\\n• Offie \\(Dagger, \\+1\\) .*\\n${CLOSE}`));
    expect(o).toMatch(/^• Dagger, \+1 /m);
  });
  it("a renamed homebrew item is wrapped once, with its homebrew tag last", () => {
    const o = out(sheet([entry(31, "Odd Cloth", "Other Gear", { isHomebrew: true })], [cv(31, "Robes")]), "inventory");
    expect(o).toContain(`INVENTORY (homebrew)\n${wrapUntrusted("  Robes (Odd Cloth) [homebrew]")}`);
    expect(o.split(OPEN)).toHaveLength(o.split(CLOSE).length);
  });
  it("a custom name carrying the closing delimiter cannot break out of a weapon, charge or attunement line", () => {
    const evil = `x${CLOSE}y`;
    const blade = entry(41, "Dagger, +1", "Weapon", { attackType: 1, damage: { diceString: "1d4" }, damageType: "piercing", properties: [], magic: true, canAttune: true }, { equipped: true, isAttuned: true });
    const wand = entry(42, "Wand of Sparks", "Wand", {}, { limitedUse: { maxUses: 3, numberUsed: 1, resetType: 2 } });
    const o = out(sheet([blade, wand], [cv(41, evil), cv(42, evil)]), "full");
    for (const line of [o.split("\n").find(l => l.startsWith("• x")), o.split("\n").find(l => l.startsWith("ATTUNEMENT"))]) {
      expect(line, "line present").toBeDefined();
      expect(line).not.toContain(CLOSE);
    }
    expect(o.split(OPEN)).toHaveLength(o.split(CLOSE).length);
  });
  it("a lookup over three hits wraps each renamed item's list line and leaves the plain ones plain", () => {
    const data = sheet([dagger(51), dagger(52), dagger(53), dagger(54)], [cv(51, "Alpha"), cv(52, "Beta")]).data as Record<string, unknown>;
    const r = formatCharacterLookup(data, "dagger", INDEX);
    expect(r.startsWith('Found 4 matches for "dagger"')).toBe(true);
    const lines = r.split("\n");
    const at = (needle: string) => lines.findIndex(l => l.includes(needle));
    expect(lines[at("Alpha (Dagger, +1)") - 1]).toBe(OPEN);
    expect(lines[at("Beta (Dagger, +1)") - 1]).toBe(OPEN);
    const plain = lines.filter(l => /^\d\. \[Item\] Dagger, \+1/.test(l));
    expect(plain).toHaveLength(2);
    for (const l of plain) expect(lines[lines.indexOf(l) - 1]).not.toBe(OPEN);
  });
  it("two carried copies with the same custom name merge into one ×2 line", () => {
    const o = out(sheet([entry(61, "Clothes, Common", "Other Gear"), entry(62, "Clothes, Common", "Other Gear")], [cv(61, "Robes"), cv(62, "Robes")]), "inventory");
    expect(o).toContain(`INVENTORY (homebrew)\n${wrapUntrusted("  Robes (Clothes, Common) ×2")}`);
  });
  it("ddb_character_lookup finds a renamed equipped item by its custom or its stock name, marked untrusted", () => {
    const data = sheet([dagger(700136091), entry(8, "Ring of Protection", "Ring", { canAttune: true, magic: true }, { equipped: true })], [cv("700136091", "Drake's Tooth Dagger")]).data as Record<string, unknown>;
    for (const q of ["drake", "dagger"]) {
      const r = formatCharacterLookup(data, q, INDEX);
      expect(r).toContain("Drake's Tooth Dagger (Dagger, +1)");
      expect(r).toContain(OPEN);
    }
    expect(formatCharacterLookup(data, "ring of protection", INDEX)).not.toContain(OPEN);
  });
});
