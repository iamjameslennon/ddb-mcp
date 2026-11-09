/** The dual-wield off-hand row in BONUS ACTIONS (spec §3 "Off-hand row"). */
import { describe, expect, it } from "vitest";
import { computeCoreStats } from "../src/tools/character/core.js";
import { hasTwoWeaponFightingStyle, offHandItemIds } from "../src/tools/character/weapons.js";
import type { CharData } from "../src/tools/character/types.js";
import { wrapUntrusted } from "../src/utils.js";
import { INDEX } from "./fixtures/character-edition-helpers.js";
import { BASE, block, combat } from "./fixtures/combat-helpers.js";

const stats = (str: number) => [str, 10, 14, 10, 13, 8].map((value, i) => ({ id: i + 1, value }));
const coreOf = (overrides: Record<string, unknown>) =>
  computeCoreStats({ ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides } as unknown as CharData, INDEX);

const magic = { type: "bonus", subType: "magic", value: 1 };
const dagger = (id: number, extra: Record<string, unknown> = {}, defExtra: Record<string, unknown> = {}) => ({
  id, equipped: true, quantity: 1,
  definition: {
    id: 5000, name: "Dagger, +1", type: "Dagger", filterType: "Weapon", categoryId: 1, attackType: 1,
    damage: { diceString: "1d4" }, damageType: "Piercing", properties: [], grantedModifiers: [magic], ...defExtra,
  },
  ...extra,
});
const flag = (valueId: unknown, value = true) => ({ characterValues: [{ typeId: 18, value, valueId }] });
const actionsOf = (out: string) => block(out, "ACTIONS").split("\n").filter(l => l.startsWith("•") && !l.startsWith("• Unarmed"));
const bonusOf = (out: string) => block(out, "BONUS ACTIONS").split("\n").slice(1);
const mod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

describe("off-hand weapon row", () => {
  it("moves a flagged equipped weapon to BONUS ACTIONS without its ability modifier", () => {
    const overrides = { inventory: [dagger(1), dagger(2)], ...flag("2") };
    const core = coreOf(overrides);
    const hit = (l: string) => /(\+\d+) to hit/.exec(l)?.[1];
    expect(core.statMods[0]).toBeGreaterThan(0);
    const out = combat(overrides);
    expect(actionsOf(out)).toHaveLength(1);
    expect(actionsOf(out)[0]).toMatch(/^• Dagger, \+1 /);
    expect(actionsOf(out).join("\n")).not.toContain("×2");
    const off = bonusOf(out)[0];
    expect(hit(off)).toBe(hit(actionsOf(out)[0])); // same to-hit as the main hand
    expect(hit(off)).toBe(mod(core.statMods[0] + 1)); // base sheet: not proficient with daggers
    expect(off).toContain("1d4+1 piercing");
    expect(off.startsWith("• Dagger, +1")).toBe(true);
  });

  it("ignores the flag on an unequipped weapon", () => {
    const out = combat({ inventory: [dagger(1), dagger(2, { equipped: false })], ...flag("2") });
    expect(actionsOf(out)).toHaveLength(1);
    expect(bonusOf(out).join("\n")).not.toContain("Dagger");
  });

  it("adds the ability modifier with the 2024 Two-Weapon Fighting feat", () => {
    const overrides = { inventory: [dagger(1), dagger(2)], ...flag("2"), feats: [{ definition: { name: "Two-Weapon Fighting" } }] };
    const m = coreOf(overrides).statMods[0];
    expect(bonusOf(combat(overrides))[0]).toContain(`1d4${mod(m + 1)} piercing`);
  });

  it("adds the ability modifier with the 2014 options.class Two-Weapon Fighting", () => {
    const overrides = { inventory: [dagger(1), dagger(2)], ...flag("2"), options: { class: [{ definition: { name: "Two-Weapon Fighting" } }] } };
    const m = coreOf(overrides).statMods[0];
    expect(bonusOf(combat(overrides))[0]).toContain(`1d4${mod(m + 1)} piercing`);
  });

  it("applies a negative ability modifier on the off-hand", () => {
    const overrides = { inventory: [dagger(1), dagger(2)], ...flag("2"), stats: stats(8) };
    expect(coreOf(overrides).statMods[0]).toBe(-1);
    expect(bonusOf(combat(overrides))[0]).toContain("1d4 piercing"); // -1 + 1 = 0, no suffix
  });

  it("applies a negative ability modifier below the magic bonus", () => {
    const overrides = { inventory: [dagger(1), dagger(2)], ...flag("2"), stats: stats(6) };
    expect(coreOf(overrides).statMods[0]).toBe(-2);
    expect(bonusOf(combat(overrides))[0]).toContain("1d4-1 piercing");
  });

  it("keeps granted extra dice on the off-hand", () => {
    const fire = { type: "damage", subType: "fire", dice: { diceString: "2d6" } };
    const inv = [dagger(2, {}, { grantedModifiers: [magic, fire] })];
    const off = bonusOf(combat({ inventory: inv, ...flag("2") }))[0];
    expect(off).toContain("1d4+1 piercing + 2d6 fire");
    const main = actionsOf(combat({ inventory: inv }))[0];
    expect(main).toContain("+ 2d6 fire");
  });

  it("keys the off-hand by inventory id, not definition", () => {
    const out = combat({ inventory: [dagger(1), dagger(2)], ...flag("1") });
    expect(actionsOf(out)).toHaveLength(1);
    expect(bonusOf(out)[0]).toContain("Dagger, +1");
    const out2 = combat({ inventory: [dagger(1), dagger(2)], ...flag("2", false) });
    expect(actionsOf(out2)[0]).toContain("×2 Dagger, +1");
    expect(bonusOf(out2).join("\n")).not.toContain("Dagger");
  });

  it("wraps a homebrew off-hand weapon row whole and leaves an official one plain", () => {
    const official = combat({ inventory: [dagger(2)], ...flag("2") });
    const plain = bonusOf(official)[0];
    expect(plain.startsWith("• Dagger, +1")).toBe(true);
    const hb = combat({ inventory: [dagger(2, {}, { isHomebrew: true })], ...flag("2") });
    expect(block(hb, "BONUS ACTIONS")).toContain(wrapUntrusted(plain.replace("[edition not stated]", "[homebrew]")));
    expect(block(official, "BONUS ACTIONS")).not.toContain("<untrusted");
  });

  it("skips a type-18 entry whose valueId is not a number", () => {
    const out = combat({ inventory: [dagger(1), dagger(2)], characterValues: [{ typeId: 18, value: true, valueId: "abc" }, { typeId: 18, value: true }] });
    expect(actionsOf(out)[0]).toContain("×2 Dagger, +1");
    expect(out).not.toMatch(/undefined|NaN/);
    expect([...offHandItemIds({ characterValues: [{ typeId: 18, value: true, valueId: "abc" }, { typeId: 18, value: true, valueId: "7" }] })]).toEqual([7]);
  });

  it("detects the fighting style by name only", () => {
    expect(hasTwoWeaponFightingStyle({})).toBe(false);
    expect(hasTwoWeaponFightingStyle({ feats: [null, { definition: { name: "Defense" } }] })).toBe(false);
  });
});
