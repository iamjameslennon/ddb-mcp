/** Spell rows in ACTIONS (spec §2 item 3) and item bonuses to spell attack and save DC (spec §2.5). */
import { describe, expect, it } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { computeCoreStats } from "../src/tools/character/core.js";
import { isActiveItemMod } from "../src/tools/character/item-gate.js";
import { cantripDice, castLevel, leveledDice, lowestSharedSlot, pactSlotLevel } from "../src/tools/character/spell-attacks.js";
import { classSpellcastingAbilityId, spellAttackAndDc, spellBonuses } from "../src/tools/character/spells.js";
import type { CharData } from "../src/tools/character/types.js";
import { wrapUntrusted } from "../src/utils.js";
import { INDEX, S, withoutNameWrap } from "./fixtures/character-edition-helpers.js";
import { BASE, FEAT, ITEM, block } from "./fixtures/combat-helpers.js";

// ── Live spell definitions (trimmed; character JSON fetched 2026-11-07) ──────
const scaled = (...entries: Array<[number, string, string?]>) => ({
  higherLevelDefinitions: entries.map(([level, diceString, details = ""]) => {
    const [count, value] = diceString.split("d").map(Number);
    return { level, typeId: 15, dice: { diceCount: count, diceValue: value, diceMultiplier: null, fixedValue: 0, diceString }, value: null, details };
  }),
});
const die = (diceString: string | null) => {
  if (diceString == null) return { diceCount: null, diceValue: null, diceMultiplier: null, fixedValue: null, diceString: null };
  const [count, value] = diceString.split("d").map(Number);
  return { diceCount: count, diceValue: value, diceMultiplier: null, fixedValue: null, diceString };
};
const damage = (subType: string, base: string | null, atHigherLevels: unknown = { higherLevelDefinitions: [] }, restriction = "") =>
  ({ type: "damage", subType, die: die(base), restriction, atHigherLevels });
const CANTRIP_SCALE = (d: number, details?: string) => scaled([5, `2d${d}`, details], [11, `3d${d}`, details], [17, `4d${d}`, details]);
const ranged = (rangeValue: number) => ({ origin: "Ranged", rangeValue, aoeType: null, aoeValue: null });
let nextId = 9000;
const spellDef = (name: string, level: number, extra: Record<string, unknown>) => ({
  id: nextId++, name, level, attackType: null, saveDcAbilityId: null, activation: { activationTime: 1, activationType: 1 },
  range: ranged(60), atHigherLevels: { higherLevelDefinitions: [] }, modifiers: [], ritual: false, sources: S(145), ...extra,
});

const FIRE_BOLT = spellDef("Fire Bolt", 0, { attackType: 2, range: ranged(120), scaleType: "characterlevel", modifiers: [damage("fire", "1d10", CANTRIP_SCALE(10))] });
const SACRED_FLAME = spellDef("Sacred Flame", 0, { saveDcAbilityId: 2, scaleType: "characterlevel", modifiers: [damage("radiant", "1d8", CANTRIP_SCALE(8))] });
const ELDRITCH_BLAST = spellDef("Eldritch Blast", 0, {
  attackType: 2, range: ranged(120), scaleType: "characterlevel",
  atHigherLevels: { higherLevelDefinitions: [5, 11, 17].map((level, i) => ({ level, typeId: 16, dice: null, value: i + 1, details: "Beams" })) },
  modifiers: [damage("force", "1d10")],
});
const WITCH_BOLT = spellDef("Witch Bolt", 1, { attackType: 2, range: ranged(30), scaleType: "spellscale", modifiers: [damage("lightning", "1d12", scaled([1, "1d12"]))] });
const GUIDING_BOLT = spellDef("Guiding Bolt", 1, {
  attackType: 2, range: ranged(120), scaleType: "spellscale",
  modifiers: [damage("radiant", "4d6", scaled([1, "1d6"])), { type: "advantage", subType: "spell-attacks", die: die(null), restriction: "Against Target On Hit" }],
});
const TOLL_NOTE = "The die type becomes a d12 if the target is missing any of its hit points.";
const TOLL_THE_DEAD = spellDef("Toll the Dead", 0, { saveDcAbilityId: 5, scaleType: "characterlevel", modifiers: [damage("necrotic", "1d8", CANTRIP_SCALE(8, TOLL_NOTE), TOLL_NOTE)] });
const ICE_KNIFE = spellDef("Ice Knife", 1, {
  attackType: 2, saveDcAbilityId: 2, range: { origin: "Ranged", rangeValue: 60, aoeType: "Sphere", aoeValue: 5 }, scaleType: "spellscale",
  modifiers: [damage("piercing", "1d10", { higherLevelDefinitions: [] }, "On Hit"), damage("cold", "2d6", scaled([1, "1d6"]), "On Dexterity Save Fail")],
});
const ORB_TYPES = ["acid", "cold", "fire", "lightning", "poison", "thunder"];
const CHROMATIC_ORB = spellDef("Chromatic Orb", 1, {
  attackType: 2, range: ranged(90), scaleType: "spellscale",
  modifiers: ORB_TYPES.map(t => damage(t, "3d8", scaled([1, "1d8"]), "Choose acid, cold, fire, lightning, poison, or thunder")),
});
const GREEN_FLAME_BLADE = spellDef("Green-Flame Blade", 0, {
  attackType: 1, range: { origin: "Self", rangeValue: null, aoeType: "Sphere", aoeValue: 5 }, scaleType: "characterlevel",
  modifiers: [damage("fire", null, scaled([5, "1d8"], [11, "2d8"], [17, "3d8"])), damage("fire", null, scaled([5, "1d8"], [11, "2d8"], [17, "3d8"]), "To Second Target")],
});
const SCORCHING_RAY = spellDef("Scorching Ray", 2, {
  attackType: 2, range: ranged(120), scaleType: "spellscale",
  atHigherLevels: { higherLevelDefinitions: [{ level: 1, typeId: 16, dice: null, value: 1, details: "Rays" }] },
  modifiers: [damage("fire", "2d6", { higherLevelDefinitions: [] }, "3 Rays")],
});
const LIGHT = spellDef("Light", 0, { range: { origin: "Touch", rangeValue: 0 } });
const GUIDANCE = spellDef("Guidance", 0, { range: { origin: "Touch", rangeValue: 0 } });
const FIREBALL = spellDef("Fireball", 3, { saveDcAbilityId: 2, range: ranged(150), modifiers: [damage("fire", "8d6", scaled([1, "1d6"]))] });
const HEALING_WORD = spellDef("Healing Word", 1, { activation: { activationTime: 1, activationType: 3 }, range: ranged(60) });

// ── Sheet builders ────────────────────────────────────────────────────────────
const NONE = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const slotTable = (rows: Record<number, number[]>) => Array.from({ length: 21 }, (_, lvl) => rows[lvl] ?? NONE);
const WARLOCK_SLOTS = slotTable({ 1: [1, 0, 0, 0, 0, 0, 0, 0, 0], 5: [0, 0, 2, 0, 0, 0, 0, 0, 0], 9: [0, 0, 0, 0, 2, 0, 0, 0, 0] });
const FULL_SLOTS = slotTable({ 1: [2, 0, 0, 0, 0, 0, 0, 0, 0], 5: [4, 3, 2, 0, 0, 0, 0, 0, 0], 12: [4, 3, 3, 3, 2, 1, 0, 0, 0] });
const cls = (id: number, name: string, level: number, abilityId: number, extra: Record<string, unknown> = {}, defExtra: Record<string, unknown> = {}) => ({
  id, level, hitDiceUsed: 0, isStartingClass: id === 1,
  definition: {
    name, hitDice: 8, canCastSpells: true, spellCastingAbilityId: abilityId, sources: S(145),
    spellRules: { levelSpellSlots: name === "Warlock" ? WARLOCK_SLOTS : FULL_SLOTS }, ...defExtra,
  },
  subclassDefinition: null, classFeatures: [], ...extra,
});
const known = (definition: unknown, extra: Record<string, unknown> = {}) => ({ prepared: true, castAtLevel: null, definition, ...extra });
const list = (classId: number, ...spells: unknown[]) => ({ characterClassId: classId, spells });
const stats = (scores: Partial<Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>>) =>
  (["str", "dex", "con", "int", "wis", "cha"] as const).map((k, i) => ({ id: i + 1, value: scores[k] ?? 10 }));

const sheetData = (overrides: Record<string, unknown>) =>
  ({ ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides }) as Record<string, unknown>;
const sheet = (overrides: Record<string, unknown>, section: "combat" | "full" | "spells" = "combat") =>
  withoutNameWrap(parseCharacterData({ data: sheetData(overrides) }, section, INDEX));
const coreOf = (overrides: Record<string, unknown>) => computeCoreStats(sheetData(overrides) as unknown as CharData, INDEX);
/** Expected spell attack and DC for an ability, from the shared computation. */
const nums = (overrides: Record<string, unknown>, abilityId: number) => {
  const core = coreOf(overrides);
  return spellAttackAndDc(abilityId, core.statMods, core.profBonus, spellBonuses(core))!;
};
const spellRows = (out: string) => block(out, "ACTIONS").split("\n").filter(l => /\((?:cantrip|\d\w\w level)\)/.test(l));
const rowFor = (out: string, name: string) => spellRows(out).find(l => l.startsWith(`• ${name} `));
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

const wizard = (level: number, spells: unknown[], extra: Record<string, unknown> = {}) => ({
  classes: [cls(1, "Wizard", level, 4)], classSpells: [list(1, ...spells)], stats: stats({ int: 16, dex: 14 }), ...extra,
});
const cleric = (level: number, spells: unknown[], extra: Record<string, unknown> = {}) => ({
  classes: [cls(1, "Cleric", level, 5)], classSpells: [list(1, ...spells)], stats: stats({ wis: 18 }), ...extra,
});
const warlock = (level: number, spells: unknown[], extra: Record<string, unknown> = {}) => ({
  classes: [cls(1, "Warlock", level, 6)], classSpells: [list(1, ...spells)], stats: stats({ cha: 18 }), ...extra,
});

// ── Pure functions ────────────────────────────────────────────────────────────
describe("spell row dice and cast levels", () => {
  const fireBoltMod = FIRE_BOLT.modifiers[0] as Record<string, unknown>;

  it("scales cantrip dice by total level", () => {
    expect([0, 1, 5, 11, 17, 20].map(l => cantripDice(fireBoltMod, l))).toEqual(["1d10", "1d10", "2d10", "3d10", "4d10", "4d10"]);
  });

  it("picks the highest reached scaling entry whatever its order", () => {
    const shuffled = damage("fire", "1d8", scaled([17, "4d8"], [11, "3d8"], [5, "2d8"]));
    expect(cantripDice(shuffled, 12)).toBe("3d8");
  });

  it("returns null for a cantrip modifier with no die and no reached scaling", () => {
    expect(cantripDice(GREEN_FLAME_BLADE.modifiers[0] as Record<string, unknown>, 4)).toBeNull();
    expect(cantripDice(GREEN_FLAME_BLADE.modifiers[0] as Record<string, unknown>, 5)).toBe("1d8");
  });

  it("upcasts leveled dice only for a same-die per-level increment", () => {
    expect(leveledDice(WITCH_BOLT.modifiers[0] as Record<string, unknown>, 1, 5)).toBe("5d12");
    expect(leveledDice(GUIDING_BOLT.modifiers[0] as Record<string, unknown>, 1, 1)).toBe("4d6");
    expect(leveledDice(damage("fire", "1d12", scaled([1, "1d8"])), 1, 3)).toBeNull();
    expect(leveledDice(damage("fire", "1d12", scaled([2, "1d12"])), 1, 3)).toBeNull();
    expect(leveledDice(damage("fire", "1d12", { higherLevelDefinitions: [] }), 1, 3)).toBeNull();
  });

  it("reads the Warlock pact slot level", () => {
    expect(pactSlotLevel(cls(1, "Warlock", 9, 6))).toBe(5);
    expect(pactSlotLevel(cls(1, "Cleric", 9, 5))).toBe(0);
  });

  it("finds the lowest shared slot, ignoring Warlock and non-casters", () => {
    const classes = [cls(1, "Warlock", 9, 6), cls(2, "Cleric", 1, 5)];
    expect(lowestSharedSlot(classes, 1)).toBe(1);
    expect(lowestSharedSlot(classes, 2)).toBe(0);
    expect(lowestSharedSlot([cls(1, "Warlock", 9, 6)], 1)).toBe(0);
    expect(lowestSharedSlot([cls(1, "Fighter", 5, 0, {}, { canCastSpells: false })], 1)).toBe(0);
  });

  it("casts at castAtLevel, the pact slot, the lower shared slot, or the spell's level", () => {
    const warlock9 = [cls(1, "Warlock", 9, 6)];
    const multi = [cls(1, "Warlock", 9, 6), cls(2, "Cleric", 1, 5)];
    expect(castLevel(known(WITCH_BOLT), 1, true, warlock9)).toBe(5);
    expect(castLevel(known(WITCH_BOLT), 1, true, multi)).toBe(1);
    expect(leveledDice(WITCH_BOLT.modifiers[0] as Record<string, unknown>, 1, castLevel(known(WITCH_BOLT), 1, true, multi))).toBe("1d12");
    expect(castLevel(known(GUIDING_BOLT), 1, false, multi)).toBe(1);
    expect(castLevel(known(WITCH_BOLT, { castAtLevel: 2 }), 1, false, multi)).toBe(2);
  });

  it("reads each class's spellcasting ability only from a definition that casts", () => {
    expect(classSpellcastingAbilityId(cls(1, "Cleric", 5, 5))).toBe(5);
    const trickster = cls(1, "Rogue", 9, 0, { subclassDefinition: { name: "Arcane Trickster", canCastSpells: true, spellCastingAbilityId: 4 } }, { canCastSpells: false });
    expect(classSpellcastingAbilityId(trickster)).toBe(4);
    const openHand = cls(1, "Monk", 5, 0, { subclassDefinition: { name: "Way of the Open Hand", canCastSpells: false, spellCastingAbilityId: 5 } }, { canCastSpells: false });
    expect(classSpellcastingAbilityId(openHand)).toBe(0);
  });

  it("computes attack and DC only for an ability id of 1 to 6", () => {
    const mods = [0, 1, 2, 3, 4, 5];
    expect(spellAttackAndDc(5, mods, 3, { attack: 1, dc: 2 })).toEqual({ attack: 8, dc: 17 });
    expect(spellAttackAndDc(0, mods, 3, { attack: 0, dc: 0 })).toBeNull();
    expect(spellAttackAndDc(7, mods, 3, { attack: 0, dc: 0 })).toBeNull();
  });

  it("gates item modifiers on an active copy", () => {
    const m = { type: "bonus", subType: "spell-attacks", value: 2, componentId: 77, componentTypeId: ITEM };
    const copy = (equipped: boolean, isAttuned: boolean, canAttune = true) => ({ equipped, isAttuned, definition: { id: 77, entityTypeId: ITEM, canAttune } });
    expect(isActiveItemMod(m, [])).toBe(true);
    expect(isActiveItemMod(m, [copy(true, true)])).toBe(true);
    expect(isActiveItemMod(m, [copy(false, true)])).toBe(false);
    expect(isActiveItemMod(m, [copy(true, false)])).toBe(false);
    expect(isActiveItemMod(m, [copy(true, false, false)])).toBe(true);
    expect(isActiveItemMod(m, [copy(false, false), copy(true, true)])).toBe(true);
    expect(isActiveItemMod(m, [copy(false, true), copy(false, true)])).toBe(false);
    // Same id, other entity type: not this item.
    expect(isActiveItemMod({ ...m, componentTypeId: FEAT }, [copy(false, false)])).toBe(true);
  });
});

// ── Sheet output ──────────────────────────────────────────────────────────────
describe("spell rows in ACTIONS", () => {
  it("prints an attack cantrip row", () => {
    const o = wizard(5, [known(FIRE_BOLT)]);
    const { attack } = nums(o, 4);
    expect(attack).toBe(6); // INT 16 (+3) + prof 3
    const row = rowFor(sheet(o), "Fire Bolt");
    expect(row).toBe(`• ${"Fire Bolt (cantrip)".padEnd(26)} +6 to hit   2d10 fire   range 120 ft.`);
    expect(sheet(o, "spells")).toContain(`Spell Attack: ${signed(attack)}`);
  });

  it("prints a damaging save cantrip row", () => {
    const o = cleric(5, [known(SACRED_FLAME)]);
    const { dc } = nums(o, 5);
    expect(dc).toBe(15);
    expect(rowFor(sheet(o), "Sacred Flame")).toBe(`• ${"Sacred Flame (cantrip)".padEnd(26)} DC ${dc} DEX   2d8 radiant   range 60 ft.`);
  });

  it("prints Eldritch Blast with beams and Agonizing Blast", () => {
    const agonizing = { type: "eldritch-blast", subType: "bonus-damage", statId: 6, value: null, fixedValue: null, componentId: 133, componentTypeId: 258900837 };
    const o = warlock(9, [known(ELDRITCH_BLAST)], { modifiers: { ...(BASE.modifiers as object), class: [agonizing] } });
    expect(coreOf(o).statMods[5]).toBe(4);
    const { attack } = nums(o, 6);
    expect(rowFor(sheet(o), "Eldritch Blast")).toBe(`• ${"Eldritch Blast (cantrip)".padEnd(26)} ${signed(attack)} to hit   2 beams × 1d10+4 force   range 120 ft.`);
  });

  it("casts a Warlock spell at the pact slot level", () => {
    expect(rowFor(sheet(warlock(9, [known(WITCH_BOLT)])), "Witch Bolt")).toContain("   5d12 lightning   range 30 ft.");
  });

  it("appends a scaling note at every level", () => {
    for (const level of [1, 5]) {
      const row = rowFor(sheet(cleric(level, [known(TOLL_THE_DEAD)])), "Toll the Dead");
      expect(row?.endsWith(`   (${TOLL_NOTE})`)).toBe(true);
    }
    expect(rowFor(sheet(cleric(1, [known(TOLL_THE_DEAD)])), "Toll the Dead")).toContain("1d8 necrotic");
    expect(rowFor(sheet(cleric(5, [known(TOLL_THE_DEAD)])), "Toll the Dead")).toContain("2d8 necrotic");
  });

  it("adds Potent Spellcasting to class cantrips", () => {
    const potent = { type: "bonus", subType: "cleric-cantrip-damage", statId: 5, value: null, fixedValue: null, componentId: 4496847, componentTypeId: 258900837 };
    const racial = { ...FIRE_BOLT, id: 9901 };
    const o = cleric(12, [known(SACRED_FLAME)], {
      stats: stats({ wis: 20 }),
      modifiers: { ...(BASE.modifiers as object), class: [potent] },
      spells: { race: [known(racial, { spellCastingAbilityId: 4 })] },
    });
    expect(coreOf(o).statMods[4]).toBe(5);
    const out = sheet(o);
    expect(rowFor(out, "Sacred Flame")).toContain("   3d8+5 radiant   ");
    expect(rowFor(out, "Fire Bolt")).toContain("   3d10 fire   ");
  });

  it("prints no beam prefix at one beam", () => {
    const row = rowFor(sheet(warlock(1, [known(ELDRITCH_BLAST)])), "Eldritch Blast");
    expect(row).toContain("   1d10 force   ");
    expect(row).not.toContain("beams");
  });

  it("reads any typeId-16 count", () => {
    const rays = spellDef("Ray Burst", 0, {
      attackType: 2, range: ranged(60),
      atHigherLevels: { higherLevelDefinitions: [{ level: 5, typeId: 16, dice: null, value: 1, details: "Rays" }] },
      modifiers: [damage("fire", "2d4")],
    });
    expect(rowFor(sheet(wizard(5, [known(rays)])), "Ray Burst")).toContain("   2 rays × 2d4 fire   ");
    expect(rowFor(sheet(wizard(4, [known(rays)])), "Ray Burst")).toContain("   2d4 fire   ");
  });

  it("reads a count from a damage restriction", () => {
    // Live Scorching Ray: restriction "3 Rays" plus a slot-scaled "Rays" entry at level 1.
    expect(rowFor(sheet(wizard(5, [known(SCORCHING_RAY)])), "Scorching Ray")).toContain("   3 rays × 2d6 fire   ");
  });

  it("prints range from the range object", () => {
    const at = (range: unknown) => spellDef("Zap", 0, { attackType: 2, range, modifiers: [damage("lightning", "1d8")] });
    const r = (range: unknown) => rowFor(sheet(wizard(1, [known(at(range))])), "Zap")!;
    expect(r({ origin: "Ranged", rangeValue: 60 }).endsWith("   range 60 ft.")).toBe(true);
    expect(r({ origin: "Touch", rangeValue: 0 }).endsWith("   touch")).toBe(true);
    expect(r({ origin: "Self" }).endsWith("   self")).toBe(true);
    expect(r({ origin: "Ranged", rangeValue: 0 }).endsWith("1d8 lightning")).toBe(true);
    expect(r(null).endsWith("1d8 lightning")).toBe(true);
    for (const range of [{ origin: "Ranged", rangeValue: 0 }, { origin: "Touch", rangeValue: 0 }]) expect(r(range)).not.toContain("range 0 ft.");
  });

  it("prints no to-hit/DC for an ability id of 0", () => {
    const o = { classes: [cls(1, "Fighter", 5, 0, {}, { canCastSpells: false })], classSpells: [list(1, known(FIRE_BOLT), known(SACRED_FLAME))] };
    const out = sheet(o);
    expect(rowFor(out, "Fire Bolt")).toBe(`• ${"Fire Bolt (cantrip)".padEnd(26)} 2d10 fire   range 120 ft.`);
    expect(rowFor(out, "Sacred Flame")).toBe(`• ${"Sacred Flame (cantrip)".padEnd(26)} 2d8 radiant   range 60 ft.`);
    expect(out).not.toMatch(/NaN|undefined/);
  });

  it("prints both to-hit and DC", () => {
    const o = wizard(5, [known(ICE_KNIFE)]);
    const { attack, dc } = nums(o, 4);
    expect(rowFor(sheet(o), "Ice Knife")).toBe(`• ${"Ice Knife (1st level)".padEnd(26)} ${signed(attack)} to hit / DC ${dc} DEX   1d10 piercing + 2d6 cold   range 60 ft.`);
  });

  it("does not treat a non-casting subclass as a caster", () => {
    const monk = cls(1, "Monk", 5, 0, { subclassDefinition: { name: "Way of the Open Hand", canCastSpells: false, spellCastingAbilityId: 5 } }, { canCastSpells: false });
    const o = { classes: [monk], classSpells: [list(1)] };
    expect(sheet(o, "full")).not.toContain("SPELLCASTING");
    expect(spellRows(sheet(o))).toEqual([]);
  });

  it("merges same-dice damage types", () => {
    expect(rowFor(sheet(wizard(5, [known(CHROMATIC_ORB)])), "Chromatic Orb")).toContain(`   3d8 ${ORB_TYPES.join("/")}   range 90 ft.`);
  });

  it("joins different components", () => {
    expect(rowFor(sheet(wizard(5, [known(ICE_KNIFE)])), "Ice Knife")).toContain("   1d10 piercing + 2d6 cold   ");
  });

  it("prints Green-Flame Blade as a weapon attack", () => {
    const at5 = rowFor(sheet(wizard(5, [known(GREEN_FLAME_BLADE)])), "Green-Flame Blade");
    expect(at5).toBe(`• ${"Green-Flame Blade (cantrip)".padEnd(26)} melee weapon attack   + 1d8 fire   self`);
    expect(at5).not.toContain("fire/fire");
    const at1 = rowFor(sheet(wizard(1, [known(GREEN_FLAME_BLADE)])), "Green-Flame Blade");
    expect(at1).toBe(`• ${"Green-Flame Blade (cantrip)".padEnd(26)} melee weapon attack   self`);
  });

  it("omits utility cantrips, leveled save spells and non-action spells", () => {
    const out = sheet(cleric(5, [known(LIGHT), known(GUIDANCE), known(FIREBALL), known(HEALING_WORD), known(SACRED_FLAME)]));
    const actions = block(out, "ACTIONS");
    for (const name of ["Light", "Guidance", "Fireball", "Healing Word"]) expect(actions).not.toContain(`${name} (`);
    expect(spellRows(out)).toHaveLength(1);
  });

  it("keeps the bonus-action spell line unchanged", () => {
    const out = sheet(cleric(5, [known(HEALING_WORD)]));
    expect(block(out, "BONUS ACTIONS")).toContain("• Healing Word (spell, 1st-level slot)");
  });

  it("gates spellbook spells", () => {
    expect(rowFor(sheet(wizard(5, [known(CHROMATIC_ORB, { prepared: false })])), "Chromatic Orb")).toBeUndefined();
    expect(rowFor(sheet(wizard(5, [known(CHROMATIC_ORB, { prepared: true })])), "Chromatic Orb")).toBeDefined();
    expect(rowFor(sheet(warlock(5, [known(WITCH_BOLT, { prepared: false })])), "Witch Bolt")).toBeDefined();
  });

  it("uses each class's own ability when multiclassed", () => {
    const o = {
      classes: [cls(1, "Cleric", 3, 5), cls(2, "Warlock", 2, 6)],
      classSpells: [list(1, known(SACRED_FLAME)), list(2, known(ELDRITCH_BLAST))],
      stats: stats({ wis: 18, cha: 12 }),
    };
    const wis = nums(o, 5);
    const cha = nums(o, 6);
    expect(wis.dc).not.toBe(cha.dc);
    const out = sheet(o);
    expect(rowFor(out, "Sacred Flame")).toContain(` DC ${wis.dc} DEX   `);
    expect(rowFor(out, "Eldritch Blast")).toContain(` ${signed(cha.attack)} to hit   `);
  });

  it("prints a spell granted twice once", () => {
    const o = wizard(5, [known(FIRE_BOLT)], { spells: { race: [known(FIRE_BOLT, { spellCastingAbilityId: 6 })] } });
    expect(spellRows(sheet(o)).filter(l => l.includes("Fire Bolt"))).toHaveLength(1);
    expect(rowFor(sheet(o), "Fire Bolt")).toContain(`${signed(nums(o, 4).attack)} to hit`);
  });

  it("wraps a homebrew spell row whole; an official one stays plain", () => {
    const brew = { ...FIRE_BOLT, id: 9902, name: "Hex Bolt", isHomebrew: true };
    const official = { ...FIRE_BOLT, isHomebrew: false };
    const out = sheet(wizard(5, [known(brew), known(official)]));
    const lines = block(out, "ACTIONS").split("\n");
    // The [homebrew] tag comes from editions.named, as on the SPELLS lines.
    const brewRow = "• Hex Bolt [homebrew] (cantrip) +6 to hit   2d10 fire   range 120 ft.";
    expect(out).toContain(wrapUntrusted(brewRow));
    const plain = lines.find(l => l.startsWith("• Fire Bolt ("));
    expect(plain).toBe(`• ${"Fire Bolt (cantrip)".padEnd(26)} +6 to hit   2d10 fire   range 120 ft.`);
    expect(out.split(wrapUntrusted(brewRow)).join("")).not.toContain("untrusted");
  });

  it("prints base cantrip dice at totalLevel 0", () => {
    const o = { classes: [], spells: { race: [known(FIRE_BOLT, { spellCastingAbilityId: 4 })] } };
    expect(coreOf(o).totalLevel).toBe(0);
    const out = sheet(o);
    // A classless sheet states no edition, so the spell carries its own tag.
    expect(rowFor(out, "Fire Bolt [2024]")).toContain("   1d10 fire   range 120 ft.");
    expect(out).not.toMatch(/NaN|undefined/);
  });

  it("skips spells without a definition and damage modifiers with a null die", () => {
    const partial = spellDef("Odd Bolt", 1, { attackType: 2, modifiers: [damage("fire", null), damage("cold", "2d6")] });
    const o = wizard(5, [null, { prepared: true }, { prepared: true, definition: null }, known(partial), known(FIRE_BOLT)], {
      spells: { race: [null, { spellCastingAbilityId: 4 }], feat: [{ definition: "x" }] },
    });
    const out = sheet(o, "full");
    expect(rowFor(out, "Odd Bolt")).toContain("   2d6 cold   ");
    expect(rowFor(out, "Odd Bolt")).not.toContain("fire");
    expect(rowFor(out, "Fire Bolt")).toBeDefined();
    expect(out).not.toMatch(/NaN|undefined/);
  });

  it("prints a non-class spell with its own ability, a spells.class null with the single caster's", () => {
    const racial = { ...SACRED_FLAME, id: 9903 };
    const o = wizard(5, [], {
      stats: stats({ int: 16, wis: 14, cha: 12 }),
      spells: { race: [known(racial, { spellCastingAbilityId: 6 })], class: [known(GUIDING_BOLT, { spellCastingAbilityId: null })] },
    });
    const out = sheet(o);
    expect(rowFor(out, "Sacred Flame")).toContain(` DC ${nums(o, 6).dc} DEX   `);
    expect(rowFor(out, "Guiding Bolt")).toContain(` ${signed(nums(o, 4).attack)} to hit   `);
  });

  it("prints no to-hit for a spells.class null with two casters, or another bucket's null", () => {
    const o = {
      classes: [cls(1, "Cleric", 3, 5), cls(2, "Wizard", 2, 4)],
      spells: { class: [known(GUIDING_BOLT, { spellCastingAbilityId: null })], feat: [known(FIRE_BOLT, { spellCastingAbilityId: null })] },
    };
    const out = sheet(o);
    expect(rowFor(out, "Guiding Bolt")).toBe(`• ${"Guiding Bolt (1st level)".padEnd(26)} 4d6 radiant   range 120 ft.`);
    expect(rowFor(out, "Fire Bolt")).toBe(`• ${"Fire Bolt (cantrip)".padEnd(26)} 2d10 fire   range 120 ft.`);
  });

  it("casts a castAtLevel spell at that level, and states the slot for an unsupported shape", () => {
    const racialBolt = { ...WITCH_BOLT, id: 9904 };
    const o = { classes: [cls(1, "Cleric", 5, 5)], spells: { race: [known(racialBolt, { spellCastingAbilityId: 6, castAtLevel: 2 })] } };
    expect(rowFor(sheet(o), "Witch Bolt")).toContain("   2d12 lightning   ");
    const odd = { ...FIREBALL, id: 9905, name: "Odd Lance", attackType: 2, saveDcAbilityId: null, modifiers: [damage("fire", "2d6", scaled([2, "1d6"]))] };
    const o2 = { classes: [cls(1, "Cleric", 5, 5)], spells: { race: [known(odd, { spellCastingAbilityId: 6, castAtLevel: 4 })] } };
    expect(rowFor(sheet(o2), "Odd Lance")).toContain("   2d6 fire (at 4th-level slot: see spell)   ");
  });
});

describe("item and other bonuses to spell attack and save DC", () => {
  const ROD = 4769;
  const rod = (extra: Record<string, unknown>, canAttune = true) =>
    ({ id: 1, quantity: 1, equipped: true, isAttuned: true, definition: { id: ROD, entityTypeId: ITEM, name: "Rod of the Pact", filterType: "Other", canAttune, sources: S(145) }, ...extra });
  const itemMods = [
    { type: "bonus", subType: "spell-attacks", value: 2, fixedValue: 2, componentId: ROD, componentTypeId: ITEM },
    { type: "bonus", subType: "spell-save-dc", value: 1, fixedValue: 1, componentId: ROD, componentTypeId: ITEM },
  ];
  const withItems = (inventory: unknown[]) => wizard(5, [known(FIRE_BOLT)], { inventory, modifiers: { ...(BASE.modifiers as object), item: itemMods } });
  const spellLine = (o: Record<string, unknown>) => sheet(o, "spells").split("\n").find(l => l.includes("Spell Attack:"))!;
  const base = nums(wizard(5, [known(FIRE_BOLT)]), 4);

  it("adds active item bonuses to spell attack and DC, in SPELLS and in the rows", () => {
    const o = withItems([rod({})]);
    expect(spellBonuses(coreOf(o))).toEqual({ attack: 2, dc: 1 });
    expect(spellLine(o)).toContain(`Spell Attack: ${signed(base.attack + 2)}  Save DC: ${base.dc + 1}`);
    expect(rowFor(sheet(o), "Fire Bolt")).toContain(` ${signed(base.attack + 2)} to hit   `);
    expect(spellLine(withItems([rod({ equipped: false })]))).toContain(`Spell Attack: ${signed(base.attack)}  Save DC: ${base.dc}`);
    expect(rowFor(sheet(withItems([rod({ equipped: false })])), "Fire Bolt")).toContain(` ${signed(base.attack)} to hit   `);
    expect(spellLine(withItems([rod({ isAttuned: false })]))).toContain(`Spell Attack: ${signed(base.attack)}  Save DC: ${base.dc}`);
    expect(spellLine(withItems([rod({ isAttuned: false }, false)]))).toContain(`Spell Attack: ${signed(base.attack + 2)}  Save DC: ${base.dc + 1}`);
  });

  it("counts an item bonus when any copy is active", () => {
    const both = withItems([rod({ id: 1, equipped: false }), rod({ id: 2 })]);
    expect(spellLine(both)).toContain(`Spell Attack: ${signed(base.attack + 2)}`);
    const neither = withItems([rod({ id: 1, equipped: false }), rod({ id: 2, equipped: false })]);
    expect(spellLine(neither)).toContain(`Spell Attack: ${signed(base.attack)}`);
  });

  it("counts a non-item spell-attacks bonus", () => {
    const feat = { type: "bonus", subType: "spell-attacks", value: 1, componentId: 55, componentTypeId: FEAT };
    const o = wizard(5, [known(FIRE_BOLT)], { modifiers: { ...(BASE.modifiers as object), feat: [feat] } });
    expect(spellLine(o)).toContain(`Spell Attack: ${signed(base.attack + 1)}  Save DC: ${base.dc}`);
    expect(rowFor(sheet(o), "Fire Bolt")).toContain(` ${signed(base.attack + 1)} to hit   `);
  });

  it("counts an item-granted spell damage bonus only while the item is active", () => {
    const agonizing = { type: "eldritch-blast", subType: "bonus-damage", statId: 6, componentId: ROD, componentTypeId: ITEM };
    const o = (equipped: boolean) => warlock(5, [known(ELDRITCH_BLAST)], { inventory: [rod({ equipped })], modifiers: { ...(BASE.modifiers as object), item: [agonizing] } });
    expect(rowFor(sheet(o(true)), "Eldritch Blast")).toContain("2 beams × 1d10+4 force");
    expect(rowFor(sheet(o(false)), "Eldritch Blast")).toContain("2 beams × 1d10 force");
  });
});
