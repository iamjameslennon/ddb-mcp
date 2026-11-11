/** Weapon attack and damage bonuses: Archery, Dueling, pact weapon, Firearms (F3, F28, F11, F12; owner ruling R5). */
import { describe, expect, it } from "vitest";
import { computeCoreStats } from "../src/tools/character/core.js";
import type { CharData } from "../src/tools/character/types.js";
import { INDEX } from "./fixtures/character-edition-helpers.js";
import { BASE, CLASS_FEATURE, ITEM, OPTION, block, combat, feature, fighter } from "./fixtures/combat-helpers.js";

const coreOf = (overrides: Record<string, unknown>) =>
  computeCoreStats({ ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides } as unknown as CharData, INDEX);

const modsOf = (extra: Record<string, unknown>[], bucket = "class") => {
  const m = (BASE.modifiers ?? {}) as Record<string, unknown[]>;
  return { ...m, [bucket]: [...(m[bucket] ?? []), ...extra] };
};
const MARTIAL = { type: "proficiency", subType: "martial-weapons" };

const archeryOpt = { componentId: 191, componentTypeId: CLASS_FEATURE, definition: { id: 1, name: "Archery" } };
const archeryMod = { type: "bonus", subType: "ranged-weapon-attacks", value: 2, fixedValue: 2, componentId: 1, componentTypeId: OPTION };
const duelingOpt = { componentId: 191, componentTypeId: CLASS_FEATURE, definition: { id: 3, name: "Dueling" } };
const duelingMod = { type: "damage", subType: "one-handed-melee-attacks", value: 2, fixedValue: 2, componentId: 3, componentTypeId: OPTION };
const style = (requiredLevel = 1) => fighter({ classFeatures: [feature(191, "Fighting Style", { requiredLevel })] });

const weapon = (id: number, name: string, def: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, equipped: true, quantity: 1,
  definition: { id: 9000 + id, entityTypeId: ITEM, name, type: name, filterType: "Weapon", categoryId: 2, properties: [], grantedModifiers: [], ...def },
  ...extra,
});
const longbow = (id = 1, extra: Record<string, unknown> = {}, d: Record<string, unknown> = {}) =>
  weapon(id, "Longbow", { attackType: 2, range: 150, longRange: 600, damage: { diceString: "1d8" }, damageType: "Piercing", ...d }, extra);
const longsword = (id = 2) => weapon(id, "Longsword", { attackType: 1, damage: { diceString: "1d8" }, damageType: "Slashing" });
const battleaxe = (id: number, d: Record<string, unknown> = {}) =>
  weapon(id, "Battleaxe", {
    attackType: 1, damage: { diceString: "1d8" }, damageType: "Slashing",
    properties: [{ name: "Versatile", notes: "1d10" }], ...d,
  });

const handaxe = (id: number) => ({ ...battleaxe(id), definition: { ...battleaxe(id).definition, id: 9999, name: "Handaxe", type: "Handaxe" } });

const row = (out: string, name: string) => block(out, "ACTIONS").split("\n").find(l => l.startsWith(`• ${name}`)) ?? "";
const bonusRows = (out: string) => block(out, "BONUS ACTIONS").split("\n").slice(1);
const hit = (l: string) => /([+-]\d+) to hit/.exec(l)?.[1];
const mod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const archer = (inventory: unknown[], extra: Record<string, unknown> = {}) => ({
  inventory, classes: [style()], options: { class: [archeryOpt] },
  modifiers: modsOf([archeryMod, MARTIAL]), ...extra,
});
const duelist = (inventory: unknown[], extra: Record<string, unknown> = {}) => ({
  inventory, classes: [style()], options: { class: [duelingOpt] },
  modifiers: modsOf([duelingMod, MARTIAL]), ...extra,
});

describe("Archery", () => {
  it("adds Archery's +2 to ranged weapon attack rolls only", () => {
    const o = archer([longbow(), longsword()]);
    const c = coreOf(o);
    const out = combat(o);
    expect(hit(row(out, "Longbow"))).toBe(mod(c.statMods[1] + c.profBonus + 2));
    expect(row(out, "Longbow")).toContain(`1d8${mod(c.statMods[1])} piercing`);
    expect(hit(row(out, "Longsword"))).toBe(mod(c.statMods[0] + c.profBonus));
  });

  it("ignores Archery when its Fighting Style feature is above the class level", () => {
    const o = archer([longbow()], { classes: [style(99)] });
    const c = coreOf(o);
    expect(hit(row(combat(o), "Longbow"))).toBe(mod(c.statMods[1] + c.profBonus));
  });

  it("adds Archery to a weapon with no damage (Net)", () => {
    const net = weapon(3, "Net", { attackType: 2, range: 5, longRange: 15, damage: null, fixedDamage: 0, damageType: null });
    const o = archer([net]);
    const c = coreOf(o);
    expect(hit(row(combat(o), "Net"))).toBe(mod(c.statMods[1] + c.profBonus + 2));
  });
});

describe("Dueling (owner ruling R5)", () => {
  it("adds Dueling's +2 to the one-handed damage of a melee weapon, not to the versatile die", () => {
    const o = duelist([battleaxe(1)]);
    const s = coreOf(o).statMods[0];
    expect(row(combat(o), "Battleaxe")).toContain(`1d8${mod(s + 2)} slashing (1d10${mod(s)} two-handed)`);
  });

  it("does not add Dueling to a Two-Handed weapon or a ranged weapon", () => {
    const greatsword = weapon(4, "Greatsword", { attackType: 1, damage: { diceString: "2d6" }, damageType: "Slashing", properties: [{ name: "Heavy" }, { name: "Two-Handed" }] });
    const o = duelist([greatsword, longbow()]);
    const c = coreOf(o);
    const out = combat(o);
    expect(row(out, "Greatsword")).toContain(`2d6${mod(c.statMods[0])} slashing`);
    expect(row(out, "Longbow")).toContain(`1d8${mod(c.statMods[1])} piercing`);
  });

  it("adds Dueling to every one-handed melee row when no off-hand is flagged", () => {
    const o = duelist([battleaxe(1), handaxe(2)]);
    const s = coreOf(o).statMods[0];
    const out = combat(o);
    expect(row(out, "Battleaxe")).toContain(`1d8${mod(s + 2)} slashing (1d10${mod(s)} two-handed)`);
    expect(row(out, "Handaxe")).toContain(`1d8${mod(s + 2)} slashing (1d10${mod(s)} two-handed)`);
  });

  it("adds no Dueling to any row when an off-hand weapon is flagged", () => {
    const o = duelist([battleaxe(1), handaxe(2)], { characterValues: [{ typeId: 18, value: true, valueId: "2" }] });
    const s = coreOf(o).statMods[0];
    const out = combat(o);
    expect(row(out, "Battleaxe")).toContain(`1d8${mod(s)} slashing`);
    expect(row(out, "Battleaxe")).not.toContain(`1d8${mod(s + 2)}`);
    expect(bonusRows(out).join("\n")).not.toContain(`${mod(s + 2)}`);
    expect(bonusRows(out)[0]).toContain("Handaxe");
  });

  it("adds Dueling to the flat bonus only, not to a magic weapon's extra dice", () => {
    const giant = battleaxe(1, {
      name: "Giant Slayer Battleaxe",
      grantedModifiers: [
        { type: "bonus", subType: "magic", value: 1 },
        { type: "damage", subType: "additional", dice: { diceString: "2d6" }, restriction: "against giants" },
      ],
    });
    const o = duelist([giant]);
    const s = coreOf(o).statMods[0];
    expect(row(combat(o), "Giant Slayer Battleaxe")).toContain(`1d8${mod(s + 1 + 2)} slashing (1d10${mod(s + 1)} two-handed) + 2d6 slashing (against giants)`);
  });
});

describe("item weapon-attack bonuses", () => {
  const ring = (equipped: boolean) => ({ id: 50, equipped, quantity: 1, definition: { id: 5555, entityTypeId: ITEM, name: "Ring of Archery", filterType: "Wondrous item" } });
  const itemMod = (extra: Record<string, unknown> = {}) => ({ type: "bonus", subType: "ranged-weapon-attacks", value: 1, componentId: 5555, componentTypeId: ITEM, ...extra });
  const sheet = (equipped: boolean, extra: Record<string, unknown> = {}) =>
    ({ inventory: [longbow(), ring(equipped)], modifiers: modsOf([itemMod(extra), MARTIAL], "item") });

  it("applies an equipped item's weapon-attack bonus and ignores an unequipped one's", () => {
    const c = coreOf(sheet(true));
    const base = c.statMods[1] + c.profBonus;
    expect(hit(row(combat(sheet(true)), "Longbow"))).toBe(mod(base + 1));
    expect(hit(row(combat(sheet(false)), "Longbow"))).toBe(mod(base));
  });

  it("skips a weapon-attack modifier that carries a restriction", () => {
    const o = sheet(true, { restriction: "against undead" });
    const c = coreOf(o);
    expect(hit(row(combat(o), "Longbow"))).toBe(mod(c.statMods[1] + c.profBonus));
  });
});

describe("pact weapon", () => {
  const sword = (id: number, def: Record<string, unknown> = {}) =>
    weapon(id, "Shortsword", { attackType: 1, damage: { diceString: "1d6" }, damageType: "Piercing", properties: [{ name: "Finesse" }, { name: "Light" }], ...def });
  const pact = { characterValues: [{ typeId: 28, value: true, valueId: "636554434" }] };

  it("gives proficiency with the pact weapon", () => {
    const magic = { grantedModifiers: [{ type: "bonus", subType: "magic", value: 1 }] };
    const flagged = sword(636554434, { id: 7001, ...magic });
    const other = sword(7, { id: 7002, name: "Shortsword", ...magic, categoryId: 2 });
    const o = { inventory: [flagged, other], ...pact };
    const c = coreOf(o);
    const rows = block(combat(o), "ACTIONS").split("\n").filter(l => l.startsWith("•") && l.includes("Shortsword"));
    const best = Math.max(c.statMods[0], c.statMods[1]);
    expect(rows.map(hit).sort()).toEqual([mod(best + c.profBonus + 1), mod(best + 1)].sort());
  });

  it("does not merge a pact-flagged weapon with an unflagged copy of the same name", () => {
    const o = { inventory: [sword(636554434), sword(8)], ...pact };
    const c = coreOf(o);
    const rows = block(combat(o), "ACTIONS").split("\n").filter(l => l.startsWith("•") && l.includes("Shortsword"));
    expect(rows).toHaveLength(2);
    expect(rows.join("\n")).not.toContain("×2");
    const best = Math.max(c.statMods[0], c.statMods[1]);
    expect(rows.map(hit).sort()).toEqual([mod(best + c.profBonus), mod(best)].sort());
  });
});

describe("Firearms proficiency", () => {
  const pistol = weapon(9, "Pistol", {
    attackType: 2, range: 60, longRange: 240, damage: { diceString: "1d10" }, damageType: "Piercing",
    properties: [{ name: "Ammunition (Firearms)" }, { name: "Loading" }],
  });
  it("applies Firearms proficiency to a weapon with the Ammunition (Firearms) property", () => {
    const withMod = { inventory: [pistol], modifiers: modsOf([{ type: "proficiency", subType: "firearms", entityTypeId: 660121713 }]) };
    const c = coreOf(withMod);
    expect(hit(row(combat(withMod), "Pistol"))).toBe(mod(c.statMods[1] + c.profBonus));
    expect(hit(row(combat({ inventory: [pistol] }), "Pistol"))).toBe(mod(c.statMods[1]));
  });
});
