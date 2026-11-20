/**
 * Proficiency, expertise and ability-score modifiers granted by an inventory
 * item apply only while the item is active (equipped, and attuned when its
 * definition requires attunement). G1 (proficiencies) and G2 (ability scores)
 * of the 2026-11-19 fix wave; the Task 3 speed gate is the model.
 */
import { describe, expect, it } from "vitest";
import { parseCharacterData as parseSheet } from "../src/tools/character.js";
import { INDEX, variant, withoutNameWrap } from "./fixtures/character-edition-helpers.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";
import { BASE, ITEM, block } from "./fixtures/combat-helpers.js";

const ITEM_ID = 9500;
/** An item carrying `mods` on the item bucket, with the given equip/attune state. */
const gated = (mods: Record<string, unknown>[], state: { equipped: boolean; canAttune?: boolean; isAttuned?: boolean }) => ({
  inventory: [{
    id: 77, equipped: state.equipped, isAttuned: state.isAttuned ?? false, quantity: 1,
    definition: { id: ITEM_ID, entityTypeId: ITEM, name: "Test Trinket", filterType: "Wondrous item", canAttune: state.canAttune ?? false, grantedModifiers: [] },
  }],
  modifiers: { ...(BASE.modifiers as object), item: mods.map(m => ({ componentId: ITEM_ID, componentTypeId: ITEM, ...m })) },
});
const STATES = {
  unequipped: { equipped: false },
  "equipped, needs attunement, not attuned": { equipped: true, canAttune: true, isAttuned: false },
  "unequipped but attuned": { equipped: false, canAttune: true, isAttuned: true },
} as const;
const ACTIVE = [
  ["equipped", { equipped: true }],
  ["equipped and attuned", { equipped: true, canAttune: true, isAttuned: true }],
] as const;

const sheet = (overrides: Record<string, unknown>, section: "combat" | "full" = "full"): string =>
  withoutNameWrap(parseSheet({ data: { ...BASE, classSpells: [], spells: {}, ...overrides } }, section, INDEX));

describe("item proficiency modifiers (G1)", () => {
  const pistol = {
    id: 9, equipped: true, quantity: 1,
    definition: {
      id: 9009, entityTypeId: ITEM, name: "Pistol", type: "Pistol", filterType: "Weapon", categoryId: 2, attackType: 2, range: 60, longRange: 240,
      damage: { diceString: "1d10" }, damageType: "Piercing", properties: [{ name: "Ammunition (Firearms)" }], grantedModifiers: [],
    },
  };
  const firearms = { type: "proficiency", subType: "firearms", entityTypeId: 660121713, friendlySubtypeName: "Firearms" };
  const withPistol = (state: Parameters<typeof gated>[1]) => {
    const g = gated([firearms], state);
    return { ...g, inventory: [...g.inventory, pistol] };
  };
  const pistolHit = (o: Record<string, unknown>): string | undefined =>
    /([+-]\d+) to hit/.exec(block(sheet(o, "combat"), "ACTIONS").split("\n").find(l => l.startsWith("• Pistol")) ?? "")?.[1];
  const weaponsLine = (out: string) => out.split("\n").find(l => l.startsWith("  Weapons:")) ?? "";

  it.each(Object.entries(STATES))("a firearms proficiency from an item that is %s gives no proficiency on the attack and is not listed", (_n, state) => {
    const o = withPistol(state);
    const plain = { inventory: [pistol] };
    expect(pistolHit(o)).toBe(pistolHit(plain));
    expect(weaponsLine(sheet(o))).not.toContain("Firearms");
  });

  it.each(ACTIVE)("a firearms proficiency from an item that is %s applies and is listed", (_n, state) => {
    const o = withPistol(state);
    const plain = { inventory: [pistol] };
    expect(Number(pistolHit(o))).toBeGreaterThan(Number(pistolHit(plain)));
    expect(weaponsLine(sheet(o))).toContain("Firearms");
  });

  it.each(Object.entries(STATES))("a skill proficiency, expertise and saving-throw proficiency from an item that is %s is ignored", (_n, state) => {
    const mods = [
      { type: "proficiency", subType: "stealth" },
      { type: "expertise", subType: "athletics" },
      { type: "proficiency", subType: "wisdom-saving-throws" },
      { type: "half-proficiency", subType: "ability-checks" },
    ];
    expect(sheet({ ...gated(mods, state) })).toBe(sheet({ inventory: gated(mods, state).inventory }));
  });

  it("an active item's skill proficiency, expertise and saving-throw proficiency apply", () => {
    const mods = [
      { type: "proficiency", subType: "stealth" },
      { type: "expertise", subType: "athletics" },
      { type: "proficiency", subType: "wisdom-saving-throws" },
    ];
    const out = sheet(gated(mods, { equipped: true }));
    expect(out).toMatch(/Stealth \(DEX\)\s+[+-]\d+ \*/);
    expect(out).toMatch(/Athletics \(STR\)\s+[+-]\d+ \*\*/);
    expect(out).toMatch(/WIS [+-]\d+\*/);
  });
});

describe("item ability-score modifiers (G2)", () => {
  const strOf = (out: string): number => Number(/STR (\d+) \(/.exec(out)?.[1]);
  const conOf = (out: string): number => Number(/CON (\d+) \(/.exec(out)?.[1]);
  const belt = { type: "set", subType: "strength-score", fixedValue: 21, value: 21 };
  const ring = { type: "bonus", subType: "strength-score", fixedValue: 2 };
  const base = strOf(sheet({ inventory: [] }));

  it("the baseline STR is below 19, so the tests can tell", () => {
    expect(base).toBeLessThan(19);
  });

  it.each(Object.entries(STATES))("a set strength-score from an item that is %s leaves the base score", (_n, state) => {
    expect(strOf(sheet(gated([belt], state)))).toBe(base);
  });

  it.each(Object.entries(STATES))("a bonus strength-score from an item that is %s leaves the base score", (_n, state) => {
    expect(strOf(sheet(gated([ring], state)))).toBe(base);
  });

  it("an equipped and attuned Belt sets STR to 21", () => {
    expect(strOf(sheet(gated([belt], { equipped: true, canAttune: true, isAttuned: true })))).toBe(21);
  });

  it("an equipped item's bonus strength-score adds", () => {
    expect(strOf(sheet(gated([ring], { equipped: true })))).toBe(base + 2);
  });

  it("an equipped and attuned Amulet of Health (set constitution-score 19) still gives CON 19", () => {
    const amulet = { type: "set", subType: "constitution-score", fixedValue: 19, value: 19 };
    expect(conOf(sheet(gated([amulet], { equipped: true, canAttune: true, isAttuned: true })))).toBe(19);
  });
});

describe("item half-proficiency to initiative (G1)", () => {
  const joat = { type: "half-proficiency", subType: "initiative", entityTypeId: 660121713 };
  const initOf = (o: Record<string, unknown>): number => Number(/Initiative: ([+-]\d+)/.exec(sheet(o, "combat"))?.[1]);
  const plain = initOf({ inventory: [] });

  it.each(Object.entries(STATES))("a half-proficiency to initiative from an item that is %s changes nothing", (_n, state) => {
    expect(initOf(gated([joat], state))).toBe(plain);
  });

  it.each(ACTIVE)("a half-proficiency to initiative from an item that is %s adds half the proficiency bonus, rounded down", (_n, state) => {
    expect(initOf(gated([joat], state))).toBe(plain + 1); // proficiency bonus +3 at level 5, floor(3/2) = 1
  });
});

describe("global save bonus (bc, owner ruling 2026-11-19)", () => {
  // The SAVING THROWS line as numbers, so the tests do not depend on the fixture's proficiencies.
  const saves = (data: Record<string, unknown>): Record<string, number> => {
    const lines = parseSheet(data, "summary", INDEX).split("\n");
    const line = lines[lines.findIndex(l => l === "SAVING THROWS") + 1] ?? "";
    return Object.fromEntries([...line.matchAll(/\b(STR|DEX|CON|INT|WIS|CHA) ([+-]\d+)/g)].map(m => [m[1], Number(m[2])]));
  };
  const clean = saves(FIGHTER_5);
  const RING = { id: 9001, entityTypeId: 112130694, name: "Ring of Protection", filterType: "Ring", canAttune: true, magic: true, sources: [{ sourceId: 145 }] };
  const ring = (state: { equipped?: boolean; isAttuned?: boolean; canAttune?: boolean } = {}) => variant(FIGHTER_5, d => {
    const { canAttune, ...rest } = state;
    d.inventory = [...(d.inventory ?? []), {
      id: 9001, equipped: true, isAttuned: true, quantity: 1, ...rest,
      definition: { ...RING, canAttune: canAttune ?? true },
    }];
    d.modifiers.item = [...(d.modifiers.item ?? []), { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, componentId: 9001, componentTypeId: 112130694 }];
  });
  const plusOne = (): Record<string, number> => Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v + 1]));

  it("an equipped, attuned item's save bonus counts on every save", () => {
    expect(saves(ring())).toEqual(plusOne());
  });

  it("an unequipped item's save bonus does not count", () => {
    expect(saves(ring({ equipped: false }))).toEqual(clean);
  });

  it("an equipped item that needs attunement and is not attuned does not count", () => {
    expect(saves(ring({ isAttuned: false }))).toEqual(clean);
  });

  it("an equipped item that needs no attunement counts", () => {
    expect(saves(ring({ canAttune: false, isAttuned: false }))).toEqual(plusOne());
  });

  const classMod = (bucket: "class" | "subclass", componentTypeId: number, componentId: number, classFeatures: unknown[], options: unknown[] = []) => variant(FIGHTER_5, d => {
    d.classes[0].classFeatures = [...(d.classes[0].classFeatures ?? []), ...classFeatures];
    d.options = { ...(d.options ?? {}), class: [...(d.options?.class ?? []), ...options] };
    d.modifiers[bucket] = [...(d.modifiers[bucket] ?? []), { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, componentId, componentTypeId }];
  });
  const cf = (id: number, requiredLevel: number) => ({ definition: { id, entityTypeId: 12168134, name: `F${id}`, requiredLevel } });

  it("a class-bucket save bonus of a feature above the class level is skipped", () => {
    expect(saves(classMod("class", 12168134, 900, [cf(900, 20)]))).toEqual(clean);
  });

  it("a class-bucket save bonus of a feature at or below the class level counts", () => {
    expect(saves(classMod("class", 12168134, 900, [cf(900, 1)]))).toEqual(plusOne());
  });

  it("a subclass-bucket save bonus follows the class rule", () => {
    expect(saves(classMod("subclass", 12168134, 900, [cf(900, 20)]))).toEqual(clean);
    expect(saves(classMod("subclass", 12168134, 900, [cf(900, 1)]))).toEqual(plusOne());
  });

  it("an option's save bonus follows its parent feature: hidden skips, visible counts", () => {
    const option = { componentId: 900, componentTypeId: 12168134, definition: { id: 901, entityTypeId: 258900837 } };
    const mod = { componentTypeId: 258900837, componentId: 901 };
    const hidden = variant(FIGHTER_5, d => {
      d.classes[0].classFeatures = [...(d.classes[0].classFeatures ?? []), cf(900, 20)];
      d.options = { ...(d.options ?? {}), class: [...(d.options?.class ?? []), option] };
      d.modifiers.class = [...(d.modifiers.class ?? []), { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, ...mod }];
    });
    expect(saves(hidden)).toEqual(clean);
    const visible = variant(hidden, d => { d.classes[0].classFeatures[d.classes[0].classFeatures.length - 1] = cf(900, 1); });
    expect(saves(visible)).toEqual(plusOne());
  });

  it("a null entry in a modifier list does not throw", () => {
    const data = variant(FIGHTER_5, d => { d.modifiers.class = [...(d.modifiers.class ?? []), null, { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, componentId: 1, componentTypeId: 1 }]; });
    expect(() => saves(data)).not.toThrow();
    expect(saves(data)).toEqual(plusOne());
  });

  it("a non-item modifier (race, feat) still counts", () => {
    const data = variant(FIGHTER_5, d => {
      d.modifiers.feat = [...(d.modifiers.feat ?? []), { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, componentId: 1, componentTypeId: 1 }];
    });
    expect(saves(data)).toEqual(plusOne());
  });

  it("a proficient save gets the proficiency bonus once, and the global bonus adds on top with the * marker kept", () => {
    const line = parseSheet(ring(), "summary", INDEX).split("\n").find(l => /\bSTR [+-]\d+\*/.test(l)) ?? "";
    expect(line).toMatch(/STR [+-]\d+\*/);
    expect(saves(ring())["STR"]).toBe(clean["STR"] + 1);
  });
});

describe("global ability-check bonus (parked 2026-11-19, the (bc) rule applied to checks)", () => {
  // Skill bonuses and passives as numbers, so the tests do not depend on the fixture's proficiencies.
  const checks = (data: Record<string, unknown>): Record<string, number> => {
    const sheet = parseSheet(data, "summary", INDEX);
    const skills = [...sheet.matchAll(/^ {2}([A-Z][A-Za-z' ]+?) \((?:STR|DEX|CON|INT|WIS|CHA)\)\s+([+-]\d+)/gm)].map(m => [m[1], Number(m[2])]);
    const passives = [...sheet.matchAll(/Passive (Perception|Investigation|Insight): (\d+)/g)].map(m => [`Passive ${m[1]}`, Number(m[2])]);
    return Object.fromEntries([...skills, ...passives]);
  };
  const clean = checks(FIGHTER_5);
  const plusOne = (): Record<string, number> => Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v + 1]));
  const STONE = { id: 9002, entityTypeId: 112130694, name: "Stone of Good Luck (Luckstone)", filterType: "Wondrous item", canAttune: true, magic: true, sources: [{ sourceId: 145 }] };
  const stone = (state: { equipped?: boolean; isAttuned?: boolean; canAttune?: boolean } = {}) => variant(FIGHTER_5, d => {
    const { canAttune, ...rest } = state;
    d.inventory = [...(d.inventory ?? []), {
      id: 9002, equipped: true, isAttuned: true, quantity: 1, ...rest,
      definition: { ...STONE, canAttune: canAttune ?? true },
    }];
    d.modifiers.item = [...(d.modifiers.item ?? []), { type: "bonus", subType: "ability-checks", value: 1, fixedValue: 1, componentId: 9002, componentTypeId: 112130694 }];
  });

  it("the fixture prints all 18 skills and the three passives", () => {
    expect(Object.keys(clean)).toHaveLength(21);
  });

  it("an equipped, attuned item's bonus counts on every skill and passive", () => {
    expect(checks(stone())).toEqual(plusOne());
  });

  it("an unequipped item's bonus does not count", () => {
    expect(checks(stone({ equipped: false }))).toEqual(clean);
  });

  it("an equipped item that needs attunement and is not attuned does not count", () => {
    expect(checks(stone({ isAttuned: false }))).toEqual(clean);
  });

  it("an equipped item that needs no attunement counts", () => {
    expect(checks(stone({ canAttune: false, isAttuned: false }))).toEqual(plusOne());
  });

  const cf = (id: number, requiredLevel: number) => ({ definition: { id, entityTypeId: 12168134, name: `F${id}`, requiredLevel } });
  const classMod = (bucket: "class" | "subclass", requiredLevel: number) => variant(FIGHTER_5, d => {
    d.classes[0].classFeatures = [...(d.classes[0].classFeatures ?? []), cf(900, requiredLevel)];
    d.modifiers[bucket] = [...(d.modifiers[bucket] ?? []), { type: "bonus", subType: "ability-checks", value: 1, fixedValue: 1, componentId: 900, componentTypeId: 12168134 }];
  });

  it("a class-bucket bonus of a feature above the class level is skipped; at or below it counts", () => {
    expect(checks(classMod("class", 20))).toEqual(clean);
    expect(checks(classMod("class", 1))).toEqual(plusOne());
  });

  it("a subclass-bucket bonus follows the class rule", () => {
    expect(checks(classMod("subclass", 20))).toEqual(clean);
    expect(checks(classMod("subclass", 1))).toEqual(plusOne());
  });

  it("an option's bonus follows its parent feature: hidden skips, visible counts", () => {
    const option = { componentId: 900, componentTypeId: 12168134, definition: { id: 901, entityTypeId: 258900837 } };
    const hidden = variant(FIGHTER_5, d => {
      d.classes[0].classFeatures = [...(d.classes[0].classFeatures ?? []), cf(900, 20)];
      d.options = { ...(d.options ?? {}), class: [...(d.options?.class ?? []), option] };
      d.modifiers.class = [...(d.modifiers.class ?? []), { type: "bonus", subType: "ability-checks", value: 1, fixedValue: 1, componentId: 901, componentTypeId: 258900837 }];
    });
    expect(checks(hidden)).toEqual(clean);
    const visible = variant(hidden, d => { d.classes[0].classFeatures[d.classes[0].classFeatures.length - 1] = cf(900, 1); });
    expect(checks(visible)).toEqual(plusOne());
  });

  it("a race or feat bonus always counts, and a null entry in a list does not throw", () => {
    for (const bucket of ["race", "feat"] as const) {
      const data = variant(FIGHTER_5, d => {
        d.modifiers[bucket] = [...(d.modifiers[bucket] ?? []), null, { type: "bonus", subType: "ability-checks", value: 1, fixedValue: 1, componentId: 1, componentTypeId: 1 }];
      });
      expect(checks(data), bucket).toEqual(plusOne());
    }
  });
});
