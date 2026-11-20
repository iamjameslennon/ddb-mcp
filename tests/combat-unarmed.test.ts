/** The Unarmed Strike row in ACTIONS (spec §2 item 2). */
import { describe, expect, it } from "vitest";
import { computeCoreStats } from "../src/tools/character/core.js";
import type { CharData } from "../src/tools/character/types.js";
import { wrapUntrusted } from "../src/utils.js";
import { INDEX } from "./fixtures/character-edition-helpers.js";
import { BASE, BONUS, CLASS_FEATURE, FIGHTER, action, actions, block, combat, fighter } from "./fixtures/combat-helpers.js";

const stats = (str: number, dex: number) => [str, dex, 14, 10, 13, 8].map((value, i) => ({ id: i + 1, value }));
const row = (out: string) => block(out, "ACTIONS").split("\n").filter(l => l.startsWith("• Unarmed Strike"));
const coreOf = (overrides: Record<string, unknown>) =>
  computeCoreStats({ ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides } as unknown as CharData, INDEX);

const MARTIAL_ARTS_ID = 777001;
const monk = (dieOn: "wrapper" | "definition" | "none", str: number, dex: number, defExtra: Record<string, unknown> = {}) => {
  const def = { id: MARTIAL_ARTS_ID, entityTypeId: CLASS_FEATURE, name: "Martial Arts", requiredLevel: 1, ...defExtra, ...(dieOn === "definition" ? { levelScale: { dice: { diceString: "1d6" } } } : {}) };
  const wrapper = { definition: def, ...(dieOn === "wrapper" ? { levelScale: { dice: { diceString: "1d6" } } } : {}) };
  return {
    classes: [fighter({ definition: { ...(FIGHTER.definition as object), name: "Monk" }, classFeatures: [wrapper] })],
    stats: stats(str, dex),
  };
};

describe("Unarmed Strike row", () => {
  it("prints one Unarmed Strike row in ACTIONS", () => {
    const core = coreOf({});
    const mod = core.statMods[0];
    const expected = `• ${"Unarmed Strike".padEnd(16)} +${mod + core.profBonus} to hit   ${Math.max(0, 1 + mod)} bludgeoning   reach 5 ft.`;
    expect(row(combat({}))).toEqual([expected]);
  });

  it("floors damage at 0 for a negative STR modifier", () => {
    const overrides = { stats: stats(8, 12) };
    expect(coreOf(overrides).statMods[0]).toBe(-1);
    const [line] = row(combat(overrides));
    expect(line).toBe(`• ${"Unarmed Strike".padEnd(16)} +${-1 + coreOf(overrides).profBonus} to hit   0 bludgeoning   reach 5 ft.`);
    expect(line).toBe("• Unarmed Strike   +2 to hit   0 bludgeoning   reach 5 ft.");
  });

  it("uses the Martial Arts die and the better of STR/DEX", () => {
    const overrides = monk("wrapper", 10, 16);
    const core = coreOf(overrides);
    expect(core.statMods[1]).toBeGreaterThan(core.statMods[0]);
    expect(row(combat(overrides))).toEqual([
      `• ${"Unarmed Strike".padEnd(16)} +${core.statMods[1] + core.profBonus} to hit   1d6+${core.statMods[1]} bludgeoning   reach 5 ft.`,
    ]);
  });

  it("ignores a levelScale on the definition", () => {
    const overrides = monk("definition", 10, 16);
    const core = coreOf(overrides);
    expect(row(combat(overrides))).toEqual([
      `• ${"Unarmed Strike".padEnd(16)} +${core.statMods[1] + core.profBonus} to hit   ${1 + core.statMods[1]} bludgeoning   reach 5 ft.`,
    ]);
  });

  it("prints no +0", () => {
    const overrides = monk("wrapper", 10, 10);
    expect(coreOf(overrides).statMods.slice(0, 2)).toEqual([0, 0]);
    const [line] = row(combat(overrides));
    expect(line).toContain("   1d6 bludgeoning");
    expect(line).not.toContain("+0 bludgeoning");
    expect(line).not.toContain("1d6+0");
  });

  it("keeps D&D Beyond's monk Unarmed Strike bonus actions", () => {
    const out = combat({
      ...monk("wrapper", 10, 16),
      ...actions({ class: [
        action("Unarmed Strike", MARTIAL_ARTS_ID, CLASS_FEATURE, BONUS, { isMartialArts: true }),
        action("Unarmed Strike (Dex.)", MARTIAL_ARTS_ID, CLASS_FEATURE, BONUS, { isMartialArts: true }),
      ] }),
    });
    const bonus = block(out, "BONUS ACTIONS");
    expect(bonus).toContain("• Unarmed Strike\n");
    expect(bonus).toContain("• Unarmed Strike (Dex.)");
    expect(row(out)).toHaveLength(1);
  });

  it("prints a row on a level-0 sheet", () => {
    // An empty `classes` now gets the F12 not-ready line, so the level-0 sheet has one class entry at level 0.
    const out = combat({ classes: [{ definition: { id: 1, name: "Fighter" }, level: 0 }] });
    expect(row(out)).toEqual(["• Unarmed Strike   +4 to hit   4 bludgeoning   reach 5 ft."]);
    expect(out).not.toContain("NaN");
  });

  it("ignores a Martial Arts feature above its class level", () => {
    const overrides = monk("wrapper", 10, 16, { requiredLevel: 6 });
    const core = coreOf(overrides);
    expect(row(combat(overrides))).toEqual([
      `• ${"Unarmed Strike".padEnd(16)} +${core.statMods[0] + core.profBonus} to hit   ${1 + core.statMods[0]} bludgeoning   reach 5 ft.`,
    ]);
  });

  it("counts an explicit Martial Arts requiredLevel 0 as level 0, not 1", () => {
    const base = monk("wrapper", 10, 16, { requiredLevel: 0 });
    const overrides = { ...base, classes: [{ ...base.classes[0], level: 0 }] };
    const core = coreOf(overrides);
    expect(row(combat(overrides))).toEqual([
      `• ${"Unarmed Strike".padEnd(16)} +${core.statMods[1] + core.profBonus} to hit   1d6+${core.statMods[1]} bludgeoning   reach 5 ft.`,
    ]);
  });

  it("wraps the whole row when the Martial Arts feature is homebrew", () => {
    const overrides = monk("wrapper", 10, 16, { isHomebrew: true });
    const core = coreOf(overrides);
    const out = combat(overrides);
    const line = `• ${"Unarmed Strike".padEnd(16)} +${core.statMods[1] + core.profBonus} to hit   1d6+${core.statMods[1]} bludgeoning   reach 5 ft.`;
    expect(block(out, "ACTIONS")).toContain(wrapUntrusted(line));
  });

  it("a Martial Arts feature without a level scale still uses the better of STR/DEX (bl)", () => {
    const overrides = monk("none", 8, 16);
    const core = coreOf(overrides);
    expect(core.statMods.slice(0, 2)).toEqual([-1, 3]);
    expect(row(combat(overrides))).toEqual([`• ${"Unarmed Strike".padEnd(16)} +${3 + core.profBonus} to hit   4 bludgeoning   reach 5 ft.`]);
  });

  it("invents no Martial Arts die without a level scale: the damage is 1 + the better modifier, with no die", () => {
    const out = row(combat(monk("none", 8, 16)))[0];
    expect(out).not.toMatch(/\d+d\d+/);
    expect(out).toMatch(/ 4 bludgeoning /);
  });

  it("a martial-arts modifier counts as Martial Arts too, for to-hit and damage", () => {
    const overrides = { stats: stats(8, 16), modifiers: { ...(BASE.modifiers as object), class: [{ type: "bonus", subType: "martial-arts", componentId: 0 }] } };
    const core = coreOf(overrides);
    expect(row(combat(overrides))).toEqual([`• ${"Unarmed Strike".padEnd(16)} +${3 + core.profBonus} to hit   4 bludgeoning   reach 5 ft.`]);
  });

  // Deferred minors (2026-11-19 Task 7).
  it("with STR equal to DEX and no die, the row reads that shared modifier", () => {
    const overrides = monk("none", 14, 14);
    const core = coreOf(overrides);
    expect(row(combat(overrides))).toEqual([`• ${"Unarmed Strike".padEnd(16)} +${2 + core.profBonus} to hit   3 bludgeoning   reach 5 ft.`]);
  });

  it.each([0, null])("a Martial Arts feature with requiredLevel %j counts on a level-5 monk, with or without a die", required => {
    expect(row(combat(monk("wrapper", 8, 16, { requiredLevel: required })))[0]).toContain("1d6+3 bludgeoning");
    expect(row(combat(monk("none", 8, 16, { requiredLevel: required })))[0]).toContain(" 4 bludgeoning");
  });

  it("an item's martial-arts modifier counts only while the item is equipped (and attuned when it needs attunement)", () => {
    const ITEM = { id: 880001, entityTypeId: 1112899 };
    const sheet = (item: Record<string, unknown>) => ({
      stats: stats(8, 16),
      inventory: [{ id: 1, quantity: 1, equipped: false, isAttuned: false, ...item, definition: { ...ITEM, name: "Gloves", filterType: "Wondrous item", ...(item.definition as object) } }],
      modifiers: { ...(BASE.modifiers as object), item: [{ type: "bonus", subType: "martial-arts", componentId: ITEM.id, componentTypeId: ITEM.entityTypeId }] },
    });
    expect(row(combat(sheet({})))[0]).toContain("0 bludgeoning"); // unequipped: STR -1
    expect(row(combat(sheet({ equipped: true })))[0]).toContain("4 bludgeoning");
    expect(row(combat(sheet({ equipped: true, definition: { canAttune: true } })))[0]).toContain("0 bludgeoning");
    expect(row(combat(sheet({ equipped: true, isAttuned: true, definition: { canAttune: true } })))[0]).toContain("4 bludgeoning");
  });

  it("a Martial Arts feature above the class level does not count", () => {
    expect(row(combat(monk("none", 8, 16, { requiredLevel: 9 })))[0]).toContain("0 bludgeoning");   // STR -1: floored at 0
  });

  it("a non-monk keeps STR", () => {
    expect(row(combat({ stats: stats(8, 16) }))[0]).toBe("• Unarmed Strike   +2 to hit   0 bludgeoning   reach 5 ft.");
  });
});
