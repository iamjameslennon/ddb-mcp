/**
 * D&D Beyond keeps an item's charges on the inventory entry's `limitedUse`
 * (live 2026-11-04: a Wand of Web has maxUses 7, resetType "Dawn", and no
 * `char.actions.item` entry). LIMITED USE lists every carried item with
 * maxUses > 0 after the action lines, in inventory order.
 */
import { describe, expect, it } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { wrapUntrusted } from "../src/utils.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";
import { INDEX, S, variant } from "./fixtures/character-edition-helpers.js";

const ITEM_TYPE = 112130694;

function charge(maxUses: number, extra: Record<string, unknown> = {}) {
  return { maxUses, numberUsed: 0, resetType: "Dawn", resetTypeDescription: "", ...extra };
}
function wand(id: number, name: string, limitedUse: unknown, extra: Record<string, unknown> = {}, def: Record<string, unknown> = {}) {
  return { equipped: false, isAttuned: false, quantity: 1, limitedUse,
    definition: { id, entityTypeId: ITEM_TYPE, name, filterType: "Wand", sources: S(145), limitedUse: null, ...def }, ...extra };
}
function sheet(inventory: unknown[], actions: Record<string, unknown[]> | null = null): string {
  const data = variant(FIGHTER_5, d => {
    d.inventory = inventory;
    if (actions) d.actions = { class: [], race: [], feat: [], background: null, item: null, ...actions };
  });
  return parseCharacterData(data, "combat", INDEX);
}
function limitedUse(out: string): string[] {
  const lines = out.split("\n");
  const start = lines.indexOf("LIMITED USE");
  if (start < 0) return [];
  return lines.slice(start + 1, lines.indexOf("", start));
}

describe("charged items in LIMITED USE", () => {
  it("lists an official charged item that is not equipped or attuned", () => {
    expect(limitedUse(sheet([wand(1, "Wand of Web", charge(7))]))).toEqual(["• Wand of Web   0 used / 7 max   (Dawn)"]);
  });

  it("lists an item that needs attunement and is not attuned, and shows the used count", () => {
    const staff = wand(2, "Staff of Power", charge(10, { numberUsed: 3 }), { isAttuned: false }, { canAttune: true });
    expect(limitedUse(sheet([staff]))).toEqual(["• Staff of Power   3 used / 10 max   (Dawn)"]);
  });

  it("two same-named items of different editions are two lines, told apart by the tag", () => {
    const out = limitedUse(sheet([
      wand(3, "Wand of Web", charge(7)),
      wand(4, "Wand of Web", charge(7), {}, { sources: S(2) }),
    ]));
    expect(out).toEqual(["• Wand of Web   0 used / 7 max   (Dawn)", "• Wand of Web [2014]   0 used / 7 max   (Dawn)"]);
  });

  it("does not merge duplicates of one definition: each entry keeps its own charges", () => {
    const out = limitedUse(sheet([wand(5, "Wand of Web", charge(7, { numberUsed: 2 })), wand(5, "Wand of Web", charge(7))]));
    expect(out).toEqual(["• Wand of Web   2 used / 7 max   (Dawn)", "• Wand of Web   0 used / 7 max   (Dawn)"]);
  });

  it("wraps a homebrew item's line whole; an official one stays plain", () => {
    const out = limitedUse(sheet([
      wand(6, "Hex Wand", charge(3), {}, { isHomebrew: true }),
      wand(7, "Wand of Web", charge(7)),
    ]));
    expect(out.join("\n")).toBe([wrapUntrusted("• Hex Wand [homebrew]   0 used / 3 max   (Dawn)"), "• Wand of Web   0 used / 7 max   (Dawn)"].join("\n"));
  });

  it("a nameless homebrew item's line stays plain", () => {
    const out = limitedUse(sheet([wand(8, "", charge(3), {}, { isHomebrew: true })]));
    expect(out.join("\n")).not.toContain("<untrusted");
  });

  it("omits an item with no limitedUse, null limitedUse, or maxUses 0", () => {
    const none = wand(9, "Rope", null) as Record<string, unknown>;
    delete none.limitedUse;
    const out = sheet([none, wand(10, "Torch", null), wand(11, "Empty Wand", charge(0))]);
    expect(limitedUse(out)).toEqual([]);
  });

  it("falls back to the definition's limitedUse when the entry has none", () => {
    const w = wand(12, "Rod of Rest", null, {}, { limitedUse: charge(2, { resetType: 2 }) });
    expect(limitedUse(sheet([w]))).toEqual(["• Rod of Rest   0 used / 2 max   (Long Rest)"]);
  });

  it("prints item lines after the action lines", () => {
    const action = { id: "a1", entityTypeId: 222216831, componentId: 900, componentTypeId: 12168134, name: "Second Wind", activation: { activationType: 3 }, limitedUse: { maxUses: 1, numberUsed: 0, resetType: 1 } };
    const out = limitedUse(sheet([wand(13, "Wand of Web", charge(7))], { class: [action] }));
    expect(out).toEqual(["• Second Wind   0 used / 1 max   (Short Rest)", "• Wand of Web   0 used / 7 max   (Dawn)"]);
  });

  it("prints an item once when it also has an action entry with its own limitedUse (the action wins)", () => {
    const action = { id: "a2", entityTypeId: 222216831, componentId: 14, componentTypeId: ITEM_TYPE, name: "Wand of Web (action)", activation: { activationType: 1 }, limitedUse: { maxUses: 7, numberUsed: 1, resetType: 1 } };
    const out = limitedUse(sheet([wand(14, "Wand of Web", charge(7, { numberUsed: 1 })), wand(15, "Other Wand", charge(2))], { item: [action] }));
    expect(out).toEqual(["• Wand of Web (action)   1 used / 7 max   (Short Rest)", "• Other Wand   0 used / 2 max   (Dawn)"]);
  });

  describe("reset label", () => {
    it.each([
      [1, "", "Short Rest"],
      [2, "", "Long Rest"],
      ["Dawn", "x", "Dawn"],
      ["Consumable", "", "Consumable"],
      [7, "Regains daily", "Regains daily"],
      [7, "", "Rest"],
      [undefined, "", "Rest"],
    ])("resetType %j with description %j reads (%s)", (resetType, resetTypeDescription, label) => {
      const w = wand(20, "Test Wand", { maxUses: 4, numberUsed: 0, resetType, resetTypeDescription });
      expect(limitedUse(sheet([w]))).toEqual([`• Test Wand   0 used / 4 max   (${label})`]);
    });
  });
});

describe("the Rules header is unchanged by charged items", () => {
  it("counts the item once, as before", () => {
    const rules = (out: string) => out.split("\n").find(l => l.startsWith("Rules:"));
    expect(rules(sheet([wand(30, "Wand of Web", charge(7))]))).toBe(rules(sheet([wand(30, "Wand of Web", null)])));
  });
});
