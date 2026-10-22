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
});
