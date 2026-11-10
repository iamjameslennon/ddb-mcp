import { describe, it, expect } from "vitest";
import { nameFold, matchesAtWordStart } from "../src/name-match.js";

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
