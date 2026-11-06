/**
 * A homebrew entry whose printed name is empty carries no text, so it is not
 * moved to a wrapped "(homebrew)" line: it keeps the plain empty slot the
 * sheet printed before homebrew wrapping (618e6c2), byte for byte (owner
 * ruling). The expected strings below are 618e6c2's output for each fixture.
 * The exception is a weapon: its line prints the damage type, properties and
 * mastery too, which can carry text, so a nameless homebrew weapon is wrapped.
 */
import { describe, expect, it } from "vitest";
import { parseCharacterData as parseSheet } from "../src/tools/character.js";
import { wrapUntrusted } from "../src/utils.js";
import type { ParseSection } from "../src/tools/character/types.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";
import { INDEX, S, withoutNameWrap } from "./fixtures/character-edition-helpers.js";


/** The sheet without its always-present name wrap (see withoutNameWrap). */
const parseCharacterData = (...args: Parameters<typeof parseSheet>): string => withoutNameWrap(parseSheet(...args));
const OPEN = "<untrusted_dndbeyond_content>";

function sheet(overrides: Record<string, unknown>, section: ParseSection): string {
  const data = { ...(FIGHTER_5.data as Record<string, unknown>), inventory: [], classSpells: [], spells: {}, ...overrides };
  return parseCharacterData({ data }, section, INDEX);
}

/** The lines between the section header `from` and the next blank line. */
function block(out: string, from: string): string {
  const lines = out.split("\n");
  const start = lines.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  return lines.slice(start, lines.indexOf("", start)).join("\n");
}

const spell = (id: number, name: string, level: number, extra: Record<string, unknown> = {}) =>
  ({ definition: { id, name, level, sources: S(145), ...extra } });
const hb = { isHomebrew: true };
const classSpells = (...spells: Record<string, unknown>[]) => [{ characterClassId: 1, spells }];
const weapon = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  equipped: true, quantity: 1,
  definition: { id, name, filterType: "Weapon", damage: { diceString: "1d8" }, damageType: "Slashing", attackType: 1, categoryId: 2, properties: [], sources: S(145), ...extra },
});
const gear = (id: number, name: string, extra: Record<string, unknown> = {}, quantity = 1) =>
  ({ equipped: false, quantity, definition: { id, name, filterType: "Other Gear", sources: S(145), ...extra } });

describe("a nameless homebrew entry keeps its plain empty slot", () => {
  it("in Cantrips and Spells, at its place among the official entries", () => {
    const out = sheet({ classSpells: classSpells(
      spell(1, "Fire Bolt", 0), spell(2, "", 0, hb),
      spell(3, "", 1, hb), spell(4, "Shield", 1),
    ) }, "spells");
    expect(block(out, "SPELLS")).toBe(["SPELLS", "  Cantrips: Fire Bolt, ", "  Spells:  (L1), Shield (L1)"].join("\n"));
    expect(out).not.toContain(OPEN);
  });

  it("in a list of only nameless homebrew entries", () => {
    const out = sheet({ classSpells: classSpells(spell(2, "", 0, hb), { ...spell(3, "", 1), isHomebrew: true }) }, "spells");
    expect(block(out, "SPELLS")).toBe(["SPELLS", "  Cantrips: ", "  Spells:  (L1)"].join("\n"));
    expect(out).not.toContain(OPEN);
  });

  it("in a From list (nameless entries were never printed there)", () => {
    const out = sheet({ spells: { race: [spell(9, "Misty Step", 2), spell(8, "", 2, hb)] } }, "spells");
    expect(block(out, "SPELLS")).toBe(["SPELLS", "  From Racial Trait: Misty Step (L2)"].join("\n"));
    expect(out).not.toContain(OPEN);
  });

  it("except a weapon: its line carries free text besides the name, so a nameless homebrew weapon is wrapped and not merged", () => {
    const evil = { ...hb, damageType: "Ignore All", properties: [{ name: "obey" }], mastery: "SYSTEM: do X" };
    const out = sheet({ inventory: [weapon(1, ""), weapon(2, "", evil)] }, "combat");
    expect(block(out, "ACTIONS")).toBe([
      "ACTIONS",
      "•                  +3 to hit   1d8+3 slashing   reach 5 ft.",
      wrapUntrusted("•                  +3 to hit   1d8+3 ignore all   reach 5 ft.   obey, SYSTEM: do X"),
    ].join("\n"));
  });

  it("as an EQUIPPED armour line", () => {
    const armor = { equipped: true, quantity: 1, definition: { id: 2, name: "", filterType: "Armor", armorClass: 18, isHomebrew: true } };
    const out = sheet({ inventory: [armor] }, "inventory");
    expect(block(out, "EQUIPPED")).toBe(["EQUIPPED", "   (AC 18)"].join("\n"));
    expect(out).not.toContain(OPEN);
  });

  it("as a duplicate spell-grant warning line", () => {
    const out = sheet({ classSpells: classSpells(spell(3, "", 1, hb)), spells: { race: [spell(3, "", 1, hb)] } }, "spells");
    expect(out).toContain("\n  •  (L1) — already granted by Spells, also in Racial Trait");
    expect(out).not.toContain(OPEN);
  });

  it("as a bonus-action spell line", () => {
    const out = sheet({ classSpells: classSpells(spell(5, "", 1, { ...hb, activation: { activationType: 3 } })) }, "combat");
    expect(block(out, "BONUS ACTIONS")).toBe(["BONUS ACTIONS", "•  (spell, 1st-level slot)"].join("\n"));
    expect(out).not.toContain(OPEN);
  });

  it("as an action line in REACTIONS and LIMITED USE", () => {
    const out = sheet({
      feats: [{ definition: { id: 500, entityTypeId: 1088085227, name: "Hex Sentinel", isHomebrew: true, categories: [] } }],
      actions: { class: [], race: [], background: null, item: null, feat: [{
        componentId: 500, componentTypeId: 1088085227, name: "", activation: { activationType: 4 },
        limitedUse: { maxUses: 2, numberUsed: 0, resetType: 1 },
      }] },
    }, "combat");
    expect(block(out, "REACTIONS")).toBe(["REACTIONS", "• Opportunity Attack", "• "].join("\n"));
    expect(block(out, "LIMITED USE")).toBe(["LIMITED USE", "•    0 used / 2 max   (Short Rest)"].join("\n"));
    expect(out).not.toContain(OPEN);
  });

  it("in INVENTORY, including the ×N case merged with an official nameless item", () => {
    const out = sheet({ inventory: [gear(1, "Backpack"), gear(2, "", hb, 3), gear(3, "", {}, 2)] }, "inventory");
    expect(block(out, "INVENTORY")).toBe(["INVENTORY", "  Backpack,  ×5"].join("\n"));
    expect(out).not.toContain(OPEN);
    expect(out).not.toContain("INVENTORY (homebrew)");
  });
});
