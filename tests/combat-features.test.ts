/**
 * Action features in ACTIONS, feature dice in every action list, and the
 * OTHER block (spec 2026-11-07 §2.4 and §3).
 */
import { describe, expect, it } from "vitest";
import { wrapUntrusted } from "../src/utils.js";
import { isMasteryAction } from "../src/tools/character/actions.js";
import { CLASS_FEATURE, combat, block, ACTION, BONUS, REACTION, SPECIAL, action, limited, actions, feature, fighter } from "./fixtures/combat-helpers.js";

const FEATS = [feature(1, "Channel Divinity"), feature(2, "Bard"), feature(3, "Rogue"), feature(4, "Monk"), feature(5, "Second")];
const sheet = (list: unknown[], bucket = "class", extra: Record<string, unknown> = {}) =>
  combat({ classes: [fighter({ classFeatures: FEATS })], ...actions({ [bucket]: list }), ...extra });
const dice = (diceString: string, extra: Record<string, unknown> = {}) => ({ displayAsAttack: true, dice: { diceString }, ...extra });

describe("action features", () => {
  it("lists an action feature under ACTIONS", () => {
    const out = sheet([action("Channel Divinity", 1, CLASS_FEATURE, ACTION)]);
    expect(block(out, "ACTIONS").split("\n")).toContain("• Channel Divinity");
  });

  it("appends displayAsAttack dice", () => {
    const out = sheet([action("Channel Divinity: Sear Undead", 1, CLASS_FEATURE, ACTION, dice("1d8"))]);
    expect(block(out, "ACTIONS").split("\n")).toContain("• Channel Divinity: Sear Undead   1d8");
  });

  it("prints no dice for an action that adds an ability modifier or is Martial Arts", () => {
    const out = sheet([
      action("Stone's Endurance", 1, CLASS_FEATURE, ACTION, dice("1d12", { abilityModifierStatId: 3 })),
      action("Unarmed Strike", 4, CLASS_FEATURE, BONUS, { displayAsAttack: true, dice: null, value: 1, isMartialArts: true }),
      action("Deflect Missiles", 4, CLASS_FEATURE, REACTION, dice("1d10 + 9", { isMartialArts: true })),
    ]);
    expect(block(out, "ACTIONS").split("\n")).toContain("• Stone's Endurance");
    expect(block(out, "BONUS ACTIONS").split("\n")).toContain("• Unarmed Strike");
    expect(block(out, "REACTIONS").split("\n")).toContain("• Deflect Missiles");
  });

  it("prints no dice without displayAsAttack", () => {
    const out = sheet([action("Channel Divinity: Divine Spark", 1, CLASS_FEATURE, ACTION, { displayAsAttack: null, dice: { diceString: "2d8" } })]);
    expect(block(out, "ACTIONS").split("\n")).toContain("• Channel Divinity: Divine Spark");
  });

  it("appends dice in BONUS ACTIONS too", () => {
    const out = sheet([action("Bardic Inspiration", 2, CLASS_FEATURE, BONUS, dice("1d6"))]);
    expect(block(out, "BONUS ACTIONS").split("\n")).toContain("• Bardic Inspiration   1d6");
  });

  it("prints an OTHER block after REACTIONS and before LIMITED USE", () => {
    const out = sheet([
      action("Sneak Attack", 3, CLASS_FEATURE, SPECIAL, dice("3d6")),
      action("Second Wind", 5, CLASS_FEATURE, BONUS, limited),
    ]);
    expect(block(out, "OTHER")).toBe("OTHER\n• Sneak Attack   3d6");
    expect(out.indexOf("\nOTHER\n")).toBeGreaterThan(out.indexOf("\nREACTIONS\n"));
    expect(out.indexOf("\nOTHER\n")).toBeLessThan(out.indexOf("\nLIMITED USE\n"));
  });

  it("omits OTHER when there are no special actions", () => {
    expect(sheet([action("Channel Divinity", 1, CLASS_FEATURE, ACTION)])).not.toContain("\nOTHER\n");
  });

  it("excludes weapon-mastery actions", () => {
    const out = sheet([action("Vex (Handaxe)", 99, 1088085227, ACTION)], "feat");
    expect(block(out, "ACTIONS")).not.toContain("Vex (Handaxe)");
    expect(isMasteryAction({ name: "Vex (Handaxe)" })).toBe(true);
    expect(isMasteryAction({ name: "Channel Divinity: Turn Undead" })).toBe(false);
    expect(isMasteryAction({ name: "Arms of the Astral Self (Wis.)" })).toBe(false);
  });

  it("wraps a homebrew-granted action feature and OTHER line whole; official stays plain", () => {
    const out = combat({
      classes: [fighter({ classFeatures: [feature(900, "Hex Surge", { isHomebrew: true }), feature(901, "Rally")] })],
      ...actions({ class: [
        action("Hex Surge", 900, CLASS_FEATURE, ACTION, dice("2d6")),
        action("Rally", 901, CLASS_FEATURE, ACTION),
        action("Hex Mark", 900, CLASS_FEATURE, SPECIAL, dice("1d4")),
        action("Wrath", 901, CLASS_FEATURE, SPECIAL),
      ] }),
    });
    expect(block(out, "ACTIONS")).toContain(wrapUntrusted("• Hex Surge   2d6"));
    expect(block(out, "ACTIONS").split("\n")).toContain("• Rally");
    expect(block(out, "OTHER")).toBe(["OTHER", wrapUntrusted("• Hex Mark   1d4"), "• Wrath"].join("\n"));
  });

  it("keeps a limited-use action's LIMITED USE line", () => {
    const out = sheet([action("Channel Divinity", 1, CLASS_FEATURE, ACTION, limited)]);
    expect(block(out, "ACTIONS").split("\n")).toContain("• Channel Divinity");
    expect(block(out, "LIMITED USE")).toContain("• Channel Divinity   0 used / 2 max   (Short Rest)");
  });

  it("wraps an action whose granting feature exists only on subclassDefinition.classFeatures (plain shape)", () => {
    const plain = (id: number, name: string, isHomebrew: boolean) => ({ id, entityTypeId: CLASS_FEATURE, name, requiredLevel: 1, isHomebrew });
    const out = combat({
      classes: [fighter({ subclassDefinition: { id: 77, name: "Oath", classFeatures: [plain(999001, "Hex Wrath", true), plain(999002, "Fair Wrath", false)] } })],
      ...actions({ class: [
        action("Hex Wrath", 999001, CLASS_FEATURE, ACTION), action("Fair Wrath", 999002, CLASS_FEATURE, ACTION),
        action("Hex Wrath", 999001, CLASS_FEATURE, SPECIAL), action("Fair Wrath", 999002, CLASS_FEATURE, SPECIAL),
        action("Hex Wrath", 999001, CLASS_FEATURE, BONUS), action("Fair Wrath", 999002, CLASS_FEATURE, BONUS),
      ] }),
    });
    for (const b of ["ACTIONS", "OTHER", "BONUS ACTIONS"]) {
      const text = block(out, b);
      expect(text).toContain(wrapUntrusted("• Hex Wrath"));
      expect(text.split("\n")).toContain("• Fair Wrath");
    }
  });
});
