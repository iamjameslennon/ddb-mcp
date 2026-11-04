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

  it("skips a nameless item, homebrew or not", () => {
    expect(limitedUse(sheet([wand(8, "", charge(3), {}, { isHomebrew: true }), wand(81, "", charge(3))]))).toEqual([]);
  });

  it("skips a Consumable item (INVENTORY lists it with its count)", () => {
    expect(limitedUse(sheet([wand(82, "Potion of Healing", charge(1, { resetType: "Consumable" })), wand(83, "Wand of Web", charge(7))])))
      .toEqual(["• Wand of Web   0 used / 7 max   (Dawn)"]);
  });

  it("collapses whitespace in the reset label", () => {
    const w = wand(84, "Staff", charge(3, { resetType: "Other", resetTypeDescription: "  regains\n 1d6   charges\r\n at dusk " }));
    expect(limitedUse(sheet([w]))).toEqual(["• Staff   0 used / 3 max   (regains 1d6 charges at dusk)"]);
  });

  it("does not suppress on a degenerate key: an item with no id or entityTypeId is not matched by an action", () => {
    const action = { id: "a3", entityTypeId: 222216831, componentId: 85, componentTypeId: 0, name: "Odd Action", activation: { activationType: 1 }, limitedUse: { maxUses: 1, numberUsed: 0, resetType: 1 } };
    const noType = wand(85, "Typeless Wand", charge(2), {}, { entityTypeId: undefined });
    const noId = wand(0, "Idless Wand", charge(2));
    expect(limitedUse(sheet([noType, noId], { item: [action] }))).toEqual([
      "• Odd Action   0 used / 1 max   (Short Rest)",
      "• Typeless Wand   0 used / 2 max   (Dawn)",
      "• Idless Wand   0 used / 2 max   (Dawn)",
    ]);
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
      ["Other", "Regains daily", "Regains daily"],
      ["Other", "", "Other"],
      ["", "Regains daily", "Regains daily"],
      [undefined, "Regains daily", "Regains daily"],
      [undefined, "", "Rest"],
      [7, "Regains daily", "Regains daily"],
      [7, "", "Rest"],
    ])("resetType %j with description %j reads (%s)", (resetType, resetTypeDescription, label) => {
      const w = wand(20, "Test Wand", { maxUses: 4, numberUsed: 0, resetType, resetTypeDescription });
      expect(limitedUse(sheet([w]))).toEqual([`• Test Wand   0 used / 4 max   (${label})`]);
    });
  });
});

describe("the Rules header is unchanged by charged items", () => {
  it("lists the charges and leaves the Rules line as it was", () => {
    const rules = (out: string) => out.split("\n").find(l => l.startsWith("Rules:"));
    const charged = sheet([wand(30, "Wand of Web", charge(7))]);
    expect(limitedUse(charged)).toEqual(["• Wand of Web   0 used / 7 max   (Dawn)"]);
    expect(rules(charged)).toBe(rules(sheet([wand(30, "Wand of Web", null)])));
  });
});
