import { describe, it, expect } from "vitest";
import { nameFold, matchesAtWordStart, matchesLooseName, levenshteinDistance } from "../src/name-match.js";

describe("nameFold", () => {
  it("folds hyphens, apostrophes and case the way Open5e does", () => {
    expect(nameFold("Adamantine Armor (Chain-Mail)")).toBe("adamantine armor (chain mail)");
    expect(nameFold("Will-o'-Wisp")).toBe("will o wisp");
    expect(nameFold("Will-o’-Wisp")).toBe("will o wisp");
  });
});

describe("matchesAtWordStart", () => {
  it.each([
    ["Goblin Boss", "goblin", true],
    ["Dust Goblin", "goblin", true],
    ["Goblin Warrior (Stranger Things)", "goblin", true],
    ["Hobgoblin", "goblin", false],
    ["Hobgoblin Warrior", "goblin", false],
    ["Adult Red Dragon", "red dragon", true],
    ["Adult Red Dragon", "dragon red", false],
    ["Sword Wraith", "wraith", true],
    ["Will-o'-Wisp", "will o wisp", true],
    ["Will-o’-Wisp", "will-o-wisp", true],
    ["Sorcerer Orc", "orc", true],
    ["Avoral Guardinal", "vorpal", false],
    ["Goblin", "", false],
    ["Goblin", "   ", false],
    ["GOBLIN  BOSS", "goblin boss", true],
  ])("%s / %s -> %s", (name, query, expected) => {
    expect(matchesAtWordStart(name, query)).toBe(expected);
  });
});

describe("matchesLooseName", () => {
  it.each([
    ["Eldritch Blast", "eldrich blast", true],
    ["Dark One’s Blessing", "Dark One's Blessing", true],
    ["Blessing of the Trickster", "trickster blessing", true],
    ["Stone’s Endurance", "stones endurance", true],
    ["Shield", "sheild", true],
    ["Eldritch Blast", "fire bolt", false],
    ["Bless", "blessing of the trickster", false],
    ["Anything", "  ", false],
    ["Backpack", "ki", false],
    ["Ki Points", "ki", true],
    ["Eldritch Blast", "of the", false],
  ])("%s / %s -> %s", (name, query, expected) => {
    expect(matchesLooseName(name, query)).toBe(expected);
  });

  it("levenshteinDistance is exported from here", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});
