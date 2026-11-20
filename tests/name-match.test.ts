import { describe, it, expect } from "vitest";
import { nameFold, matchesAtWordStart, matchesLooseName, levenshteinDistance, isCloseName, containsFolded, osaDistance } from "../src/name-match.js";

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

describe("isCloseName", () => {
  it.each([
    ["Owlbear", "Owlbare", true],
    ["Beholder", "Beholdr", true],
    ["Adult Red Dragon", "red dragon adult", true],
    ["Living Unseen Servant", "Glorbulon the Unseen Squid-King", false],
    ["Unseen Servant", "Glorbulon the Unseen Squid-King", false],
    // (bu), owner ruling 2026-11-20: 4 characters or fewer, one edit (a swap counts as one).
    ["Lich", "Lihc", true],
    ["Ogre", "Orge", true],
    ["Lich", "Lich", true],
    ["Lion", "Lich", false],
    ["Lich", "Lion", false],
    ["Ooze", "Ogre", false],
    ["Ogre", "Ooze", false],
    ["Imp", "Ape", false],
    ["Imp", "Imps", true],
  ])("isCloseName(%j, %j) is %s", (name, query, expected) => {
    expect(isCloseName(name, query)).toBe(expected);
  });
});

describe("containsFolded", () => {
  it.each([
    ["Eldritch Blast", "eldritch", true],
    ["Eldritch Blast", "bless", false],
    ["Will-o'-Wisp", "will o wisp", true],
    ["Stone’s Endurance", "stones endurance", true],
    ["x", "", false],
    ["x", "  ", false],
  ])("containsFolded(%j, %j) is %s", (name, query, expected) => {
    expect(containsFolded(name, query)).toBe(expected);
  });
});

describe("osaDistance", () => {
  it.each([
    ["lich", "lihc", 1],
    ["ogre", "orge", 1],
    ["lion", "lich", 2],
    ["abc", "abc", 0],
    ["", "ab", 2],
    ["ab", "", 2],
    ["ca", "abc", 3],
  ])("osaDistance(%j, %j) is %i", (a, b, expected) => {
    expect(osaDistance(a, b)).toBe(expected);
  });
});
