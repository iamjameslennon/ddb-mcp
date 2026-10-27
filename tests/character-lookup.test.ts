import { describe, it, expect } from "vitest";
import { formatCharacterLookup } from "../src/tools/character/definition.js";
import { FIGHTER_5, MONK_3_HANDAXE } from "./fixtures/character-fixtures.js";
import { INDEX, S, variant } from "./fixtures/character-edition-helpers.js";

describe("formatCharacterLookup", () => {
  it("a single hit carries the entry's rules line under its title", () => {
    expect(formatCharacterLookup(FIGHTER_5.data as Record<string, unknown>, "great weapon", INDEX)).toBe(
      "[Feat]\nGreat Weapon Master\nRules: 2024 · Player's Handbook (2024)\n\nOn a critical hit or kill, make a bonus attack.");
  });

  it("a dual-edition item shows the character's main edition and its book", () => {
    expect(formatCharacterLookup(MONK_3_HANDAXE.data as Record<string, unknown>, "handaxe", INDEX).split("\n").slice(0, 3)).toEqual(
      ["[Item]", "Handaxe (Handaxe, Common)", "Rules: 2014 · Basic Rules (2014)"]);
  });

  it("a class feature takes its class's ruleset", () => {
    expect(formatCharacterLookup(MONK_3_HANDAXE.data as Record<string, unknown>, "martial arts", INDEX).split("\n").slice(0, 3)).toEqual(
      ["[Class Feature]", "Martial Arts (Monk, Level 1)", "Rules: 2014 · Player's Handbook (2014)"]);
  });

  it("a list of more than three hits tags each line after the name", () => {
    const char = variant(FIGHTER_5, d => { d.spells = { race: [
      { definition: { id: 1, name: "Fire Bolt", level: 0, school: "Evocation", sources: S(2) } },
      { definition: { id: 2, name: "Fireball", level: 3, school: "Evocation", sources: S(145) } },
      { definition: { id: 3, name: "Fire Shield", level: 4, school: "Evocation", isHomebrew: true } },
      { definition: { id: 4, name: "Wall of Fire", level: 4, school: "Evocation", sources: [] } },
    ] }; }).data as Record<string, unknown>;
    const out = formatCharacterLookup(char, "fire", INDEX);
    expect(out).toContain("1. [Spell] Fire Bolt [2014] (Cantrip Evocation)");
    expect(out).toContain("2. [Spell] Fireball [2024] (Level 3 Evocation)");
    expect(out).toContain("3. [Spell] Fire Shield [homebrew] (Level 4 Evocation)");
    expect(out).toContain("4. [Spell] Wall of Fire [edition not stated] (Level 4 Evocation)");
  });

  it("no hit keeps the existing not-found text", () => {
    expect(formatCharacterLookup(FIGHTER_5.data as Record<string, unknown>, "zzzz", INDEX)).toMatch(/^No definition found matching "zzzz"/);
  });

  it("a spell named only on the entry keeps its name in list and full hits", () => {
    const entry = { name: "Fireball", definition: { level: 3, school: "Evocation", sources: S(145) } };
    const four = variant(FIGHTER_5, d => { d.spells = { race: [
      entry,
      ...[2, 3, 4].map(n => ({ definition: { id: n, name: `Fireball ${n}`, level: 3, school: "Evocation", sources: S(145) } })),
    ] }; }).data as Record<string, unknown>;
    expect(formatCharacterLookup(four, "fireball", INDEX)).toContain("1. [Spell] Fireball [2024] (Level 3 Evocation)");
    const one = variant(FIGHTER_5, d => { d.spells = { race: [entry] }; }).data as Record<string, unknown>;
    expect(formatCharacterLookup(one, "fireball", INDEX).split("\n")[1]).toBe("Fireball (Level 3 Evocation)");
  });

  it("finds class spells stored under classSpells (2024 format)", () => {
    const char = variant(FIGHTER_5, d => { d.classSpells = [{ characterClassId: 1, classSpells: [
      { definition: { id: 77, name: "Shield", level: 1, school: "Abjuration", sources: S(145) } },
    ] }]; }).data as Record<string, unknown>;
    const out = formatCharacterLookup(char, "shield", INDEX);
    expect(out.startsWith("[Spell]\nShield (Level 1 Abjuration)\nRules: 2024")).toBe(true);
    expect(out).not.toContain("===");
  });

  it("a subclass feature takes the subclass definition's ruleset", () => {
    const char = variant(FIGHTER_5, d => {
      d.classes[0].subclassDefinition = { name: "Champion", sources: S(2), classFeatures: [
        { definition: { name: "Improved Critical", requiredLevel: 3, snippet: "Crit on 19." } },
      ] };
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "improved critical", INDEX).split("\n").slice(0, 3)).toEqual(
      ["[Subclass Feature]", expect.stringContaining("Improved Critical"), "Rules: 2014 · Player's Handbook (2014)"]);
  });

  it("a racial trait takes the species' ruleset", () => {
    const char = variant(FIGHTER_5, d => {
      d.race.sources = S(2);
      d.race.racialTraits = [{ definition: { name: "Darkvision", snippet: "See in the dark." } }];
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "darkvision", INDEX).split("\n")[2]).toBe("Rules: 2014 · Player's Handbook (2014)");
  });

  it("a background feature takes the background's ruleset", () => {
    const char = variant(FIGHTER_5, d => {
      d.background.definition.featureName = "Military Rank";
      d.background.definition.featureDescription = "Soldiers defer.";
      d.background.definition.sources = S(2);
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "military rank", INDEX).split("\n").slice(0, 3)).toEqual(
      ["[Background Feature]", "Military Rank (Soldier)", "Rules: 2014 · Player's Handbook (2014)"]);
  });

  it("missing race and background do not throw", () => {
    const char = variant(FIGHTER_5, d => { d.race = null; d.background = { definition: null }; }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "zzzz", INDEX)).toMatch(/^No definition found matching "zzzz"/);
  });

  it("a homebrew full hit reads Rules: homebrew (edition not stated)", () => {
    const char = variant(FIGHTER_5, d => { d.feats.push({ definition: { name: "Zany Trick", snippet: "Zany.", isHomebrew: true } }); }).data as Record<string, unknown>;
    // The homebrew block is delimited as untrusted, rules line included.
    expect(formatCharacterLookup(char, "zany", INDEX).split("\n").slice(0, 4)).toEqual(
      ["[Feat]", "<untrusted_dndbeyond_content>", "Zany Trick", "Rules: homebrew (edition not stated)"]);
  });
});
