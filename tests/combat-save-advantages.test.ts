/** Save-advantage lines under SAVING THROWS (spec §1). */
import { describe, expect, it } from "vitest";
import { parseCharacterData as parseSheet } from "../src/tools/character.js";
import { wrapUntrusted } from "../src/utils.js";
import { INDEX, item, withoutNameWrap } from "./fixtures/character-edition-helpers.js";
import { BASE, CLASS_FEATURE, ITEM, OPTION, RACIAL_TRAIT, feature, fighter } from "./fixtures/combat-helpers.js";

const NONE = { race: [], class: [], background: [], item: [], feat: [], condition: [] };
const mod = (subType: string, restriction: string, extra: Record<string, unknown> = {}, type = "advantage") =>
  ({ type, subType, restriction, ...extra });
const race = (extra: Record<string, unknown> = {}) => ({ ...(BASE.race as object), ...extra });
const sheet = (overrides: Record<string, unknown>, section: "summary" | "combat" | "full" = "combat"): string =>
  withoutNameWrap(parseSheet({ data: { ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides } }, section, INDEX));
const withMods = (buckets: Record<string, unknown[]>, rest: Record<string, unknown> = {}) =>
  sheet({ modifiers: { ...(BASE.modifiers as object), ...buckets }, ...rest });
/** The advantage lines, each wrapped one kept as its whole untrusted block. */
const lines = (out: string) => {
  const found: string[] = [];
  const rows = out.split("\n");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].startsWith("<untrusted") && /^ {2}(Advantage|Disadvantage)/.test(rows[i + 1] ?? "")) { found.push(rows.slice(i, i + 3).join("\n")); i += 2; }
    else if (/^ {2}(Advantage|Disadvantage)/.test(rows[i])) found.push(rows[i]);
  }
  return found;
};

describe("save advantage lines", () => {
  it("prints an all-saves advantage with its condition", () => {
    const out = withMods({ race: [mod("saving-throws", "against being charmed")] });
    expect(lines(out)).toEqual(["  Advantage (all saves): against being charmed"]);
    const i = out.split("\n");
    expect(i[i.indexOf("  Advantage (all saves): against being charmed") + 1]).toBe("  (* proficient)");
  });

  it("merges per-ability mods sharing a restriction", () => {
    const out = withMods({ race: ["intelligence", "wisdom", "charisma"].map(a => mod(`${a}-saving-throws`, "Against Magic")) });
    expect(lines(out)).toEqual(["  Advantage (INT, WIS, CHA): Against Magic"]);
  });

  it("names the granting trait when the restriction is empty", () => {
    const trait = { definition: { id: 13856121, entityTypeId: RACIAL_TRAIT, name: " Gnomish Cunning " } };
    const out = withMods(
      { race: ["charisma", "intelligence", "wisdom"].map(a => mod(`${a}-saving-throws`, "", { componentId: 13856121, componentTypeId: RACIAL_TRAIT })) },
      { race: race({ racialTraits: [trait] }) });
    expect(lines(out)).toEqual(["  Advantage (INT, WIS, CHA): Gnomish Cunning"]);
  });

  it("prints a bare line when the restriction is empty and the entity is unknown", () => {
    const out = withMods({ race: [mod("dexterity-saving-throws", "", { componentId: 1, componentTypeId: 2 })] });
    expect(lines(out)).toEqual(["  Advantage (DEX)"]);
  });

  it("trims the restriction", () => {
    const out = withMods({ race: [mod("dexterity-saving-throws", " unless you are Incapacitated.")] });
    expect(lines(out)).toEqual(["  Advantage (DEX): unless you are Incapacitated."]);
  });

  it("prints disadvantage too", () => {
    const out = withMods({ race: [mod("strength-saving-throws", "in sunlight", {}, "disadvantage")] });
    expect(lines(out)).toEqual(["  Disadvantage (STR): in sunlight"]);
  });

  it("gates item mods", () => {
    const def = (extra: Record<string, unknown> = {}) => ({ id: 777, entityTypeId: ITEM, canAttune: true, ...extra });
    const itemMod = mod("saving-throws", "against spells", { componentId: 777, componentTypeId: ITEM });
    const copy = (equipped: boolean, isAttuned: boolean) => ({ equipped, isAttuned, quantity: 1, definition: def() });
    const run = (inventory: unknown[]) => lines(withMods({ item: [itemMod] }, { inventory }));
    const want = ["  Advantage (all saves): against spells"];
    expect(run([copy(false, false)])).toEqual([]);
    expect(run([copy(true, false)])).toEqual([]);
    expect(run([copy(true, true)])).toEqual(want);
    expect(run([copy(false, false), copy(true, true)])).toEqual(want);
    expect(run([item(777, "Cloak", "Wondrous item", { entityTypeId: ITEM }, true)])).toEqual(want);
  });

  it("prints the same lines in summary, combat and full", () => {
    const overrides = { modifiers: { ...(BASE.modifiers as object), race: [mod("saving-throws", "against being charmed")] } };
    for (const s of ["summary", "combat", "full"] as const) {
      expect(lines(sheet(overrides, s))).toEqual(["  Advantage (all saves): against being charmed"]);
    }
  });

  it("wraps a homebrew trait's line whole; an official one stays plain", () => {
    const run = (isHomebrew: boolean) => lines(withMods(
      { race: [mod("saving-throws", "against fear", { componentId: 5, componentTypeId: RACIAL_TRAIT })] },
      { race: race({ racialTraits: [{ definition: { id: 5, entityTypeId: RACIAL_TRAIT, name: "Brave", isHomebrew } }] }) }));
    expect(run(true)).toEqual([wrapUntrusted("  Advantage (all saves): against fear")]);
    expect(run(false)).toEqual(["  Advantage (all saves): against fear"]);
  });

  it("wraps a line whose granting entity is unresolved when its bucket holds homebrew", () => {
    const out = withMods(
      { race: [mod("saving-throws", "against fear", { componentId: 999, componentTypeId: 1 })] },
      { race: race({ isHomebrew: true }) });
    expect(lines(out)).toEqual([wrapUntrusted("  Advantage (all saves): against fear")]);
  });

  it("wraps a subclass-bucket line whose entity is unresolved when the subclass is homebrew; an official one stays plain", () => {
    const run = (isHomebrew: boolean) => lines(withMods(
      { subclass: [mod("saving-throws", "INJECTED TEXT", { componentId: 424242, componentTypeId: 77777 })] },
      { classes: [fighter({ subclassDefinition: { id: 77, name: "Hexblade Knight", isHomebrew, classFeatures: [] } })] }));
    expect(run(true)).toEqual([wrapUntrusted("  Advantage (all saves): INJECTED TEXT")]);
    expect(run(false)).toEqual(["  Advantage (all saves): INJECTED TEXT"]);
  });

  describe("class-bucket visibility (spec anti-goal: no features the character lacks)", () => {
    const wisMod = (componentId: number, componentTypeId = CLASS_FEATURE) =>
      mod("wisdom-saving-throws", "", { componentId, componentTypeId });

    it("skips a mod from a class feature above the class level", () => {
      const classes = [fighter({ classFeatures: [feature(2, "Level 17 Thing", { requiredLevel: 17 })] })];
      expect(lines(withMods({ class: [wisMod(2)] }, { classes }))).toEqual([]);
      expect(lines(withMods({ subclass: [wisMod(2)] }, { classes }))).toEqual([]);
    });

    it("keeps a mod from a reached class feature", () => {
      const classes = [fighter({ classFeatures: [feature(2, "Level 3 Thing", { requiredLevel: 3 })] })];
      expect(lines(withMods({ class: [wisMod(2)] }, { classes }))).toEqual(["  Advantage (WIS): Level 3 Thing"]);
    });

    it("keeps a mod from a chosen optional class feature and skips an unchosen one", () => {
      const m = { class: [mod("wisdom-saving-throws", "against fear", { componentId: 3035892, componentTypeId: CLASS_FEATURE })] };
      expect(lines(withMods(m))).toEqual([]);
      expect(lines(withMods(m, { optionalClassFeatures: [{ classFeatureId: 3035892 }] }))).toEqual(["  Advantage (WIS): against fear"]);
    });

    it("skips a mod from an option under an unchosen class feature", () => {
      const options = { class: [{ componentId: 3035679, componentTypeId: CLASS_FEATURE, definition: { id: 1306486, entityTypeId: OPTION, name: "Tireless" } }] };
      const m = { class: [wisMod(1306486, OPTION)] };
      expect(lines(withMods(m, { options }))).toEqual([]);
      const classes = [fighter({ classFeatures: [feature(3035679, "Deft Explorer")] })];
      expect(lines(withMods(m, { options, classes }))).toEqual(["  Advantage (WIS): Tireless"]);
    });

    it("leaves other buckets unfiltered", () => {
      expect(lines(withMods({ race: [wisMod(2)] }))).toEqual(["  Advantage (WIS)"]);
    });
  });

  it("adds nothing when there are no advantage mods", () => {
    const out = withMods(NONE);
    expect(lines(out)).toEqual([]);
    const i = out.split("\n");
    expect(i[i.indexOf("SAVING THROWS") + 2]).toBe("  (* proficient)");
  });
});
