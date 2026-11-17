import { describe, it, expect } from "vitest";
import { formatCharacterLookup } from "../src/tools/character/definition.js";
import { actionParents } from "../src/tools/character/actions.js";
import type { CharData, ClassEntry } from "../src/tools/character/types.js";
import { wrapUntrusted } from "../src/utils.js";
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

  it("a query that matched four entries still prints the Found 4 matches list, loose matches included", () => {
    const sp = (id: number, name: string) => ({ definition: { id, name, level: 0, school: "Evocation", sources: S(2) } });
    const char = variant(FIGHTER_5, d => { d.spells = { race: [
      sp(1, "Eldritch Blast"), sp(2, "Eldritch Blast Focus"), sp(3, "Eldritch Blasts"), sp(4, "Blast Eldritch"),
      sp(5, "Eldritch Knight"), sp(6, "Fire Bolt"),
    ] }; }).data as Record<string, unknown>;
    const out = formatCharacterLookup(char, "eldritch blast", INDEX);
    expect(out.startsWith('Found 4 matches for "eldritch blast". Be more specific, or here are the matches:\n\n')).toBe(true);
    for (const n of ["Eldritch Blast [2014]", "Eldritch Blast Focus", "Eldritch Blasts", "Blast Eldritch"]) expect(out).toContain(n);
    expect(out).not.toContain("Eldritch Knight");
    expect(out).not.toContain("Fire Bolt");
  });

  it("an exact name match comes first; the rest keep their order (exact-first, carry-over (bv))", () => {
    const sp = (id: number, name: string) => ({ definition: { id, name, level: 1, school: "Evocation", sources: S(2) } });
    const two = variant(FIGHTER_5, d => { d.spells = { race: [sp(1, "Eldritch Blast"), sp(2, "Bless")] }; }).data as Record<string, unknown>;
    const out = formatCharacterLookup(two, "bless", INDEX);
    expect(out.startsWith("[Spell]\nBless (Level 1 Evocation)\n")).toBe(true);
    expect(out.indexOf("Eldritch Blast")).toBeGreaterThan(out.indexOf("Bless ("));
    const five = variant(FIGHTER_5, d => { d.spells = { race: [
      sp(1, "Eldritch Blast"), sp(2, "Blessed Strikes"), sp(3, "BLESS"), sp(4, "Blast Bless"), sp(5, "Bless’"),
    ] }; }).data as Record<string, unknown>;
    const list = formatCharacterLookup(five, "Bless", INDEX);
    expect(list.startsWith('Found 5 matches for "Bless". Be more specific, or here are the matches:\n\n')).toBe(true);
    expect(list.split("\n").slice(2).map(l => l.replace(/ \[2014\].*$/, ""))).toEqual([
      "1. [Spell] BLESS", "2. [Spell] Bless’", "3. [Spell] Eldritch Blast", "4. [Spell] Blessed Strikes", "5. [Spell] Blast Bless",
    ]);
  });

  it("a minute-long spell prints its casting time in minutes", () => {
    const char = variant(FIGHTER_5, d => { d.spells = { race: [
      { definition: { id: 5, name: "Identify", level: 1, school: "Divination", sources: S(145),
        activation: { activationTime: 1, activationType: 6 } } },
    ] }; }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "identify", INDEX)).toContain("Casting Time: 1 Minute");
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

  // ── Weapon mastery on a 2014-shown item (owner ruling 2026-11-06) ─────────
  // The live shape (Rapier, 2026-11-06): paragraphs joined by \r\n, the mastery in its own container.
  const MASTERY_DESC = "<p>Proficiency with a Rapier allows you to add your proficiency bonus.</p>\r\n<div class=\"mastery-container\"><hr />\r\n"
    + "<p>This weapon has the following mastery property. To use this property, you must have a feature that lets you use it.</p>\r\n"
    + "<p><strong><em>Vex.</em></strong> If you hit a creature with this weapon, you have Advantage on your next attack.</p>\r\n</div>";
  const rapier = (sources: Array<{ sourceId: number }>) => ({ equipped: true, quantity: 1, definition: {
    id: 9001, name: "Rapier", type: "Rapier", rarity: "Common", filterType: "Weapon", weight: 2,
    properties: [{ name: "Finesse" }, { name: "Vex" }], description: MASTERY_DESC, sources,
  } });

  it("a 2014 lookup drops the 2024 mastery paragraph", () => {
    const char = variant(MONK_3_HANDAXE, d => { d.inventory = [rapier(S(2))]; }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "rapier", INDEX)).toBe(
      "[Item]\nRapier (Rapier, Common)\nRules: 2014 · Player's Handbook (2014)\nWeight: 2 lb\n\nProficiency with a Rapier allows you to add your proficiency bonus.");
  });

  it("a 2024 lookup keeps the mastery paragraph", () => {
    const char = variant(FIGHTER_5, d => { d.inventory = [rapier(S(145))]; }).data as Record<string, unknown>;
    const out = formatCharacterLookup(char, "rapier", INDEX);
    expect(out).toContain("Rules: 2024 · Player's Handbook (2024)");
    expect(out).toContain("This weapon has the following mastery property.");
    expect(out).toContain("Vex. If you hit a creature");
  });

  it("a dual-edition weapon shown as 2014 on a 2014 sheet drops the mastery paragraph", () => {
    const char = variant(MONK_3_HANDAXE, d => { d.inventory[0].definition.description = MASTERY_DESC; }).data as Record<string, unknown>;
    const out = formatCharacterLookup(char, "handaxe", INDEX);
    expect(out).toContain("Rules: 2014 · Basic Rules (2014)");
    expect(out).toContain("Proficiency with a Rapier");
    expect(out).not.toContain("mastery");
    expect(out).not.toContain("Vex");
  });

  // ── Custom items (owner ruling 2026-11-06) ───────────────────────────────
  const filigreed = { equipped: true, quantity: 1, definition: {
    id: 9002, name: "Filigreed Longsword ", type: "Longsword", rarity: "Common", filterType: "Weapon",
    description: "<p>Fine work.</p>", isCustomItem: true, isHomebrew: false, sources: [],
  } };

  it("a custom item is trimmed, reads Rules: custom item, and stays wrapped", () => {
    const char = variant(FIGHTER_5, d => { d.inventory = [filigreed]; }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "filigreed", INDEX)).toBe(
      `[Item]\n${wrapUntrusted("Filigreed Longsword (Longsword, Common)\nRules: custom item\n\nFine work.")}`);
  });

  it("a custom item in a list of matches is trimmed", () => {
    const char = variant(FIGHTER_5, d => {
      d.inventory = [1, 2, 3, 4].map(n => ({ ...filigreed, definition: { ...filigreed.definition, id: 9010 + n, name: `Filigreed ${n} ` } }));
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "filigreed", INDEX)).toMatch(/\n1\. \[Item\] Filigreed 1[ (]/);
  });

  // Owner ruling 2026-11-07: as on the sheet, a custom item's list line carries no edition tag.
  it("a custom item's list line carries no edition tag and stays wrapped", () => {
    const char = variant(FIGHTER_5, d => {
      d.inventory = [1, 2, 3, 4].map(n => ({ ...filigreed, definition: { ...filigreed.definition, id: 9010 + n, name: `Filigreed ${n}` } }));
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "filigreed", INDEX)).toContain(wrapUntrusted("1. [Item] Filigreed 1 (Longsword, Common)"));
  });
  // ── Class vs subclass features (F2, owner ruling R4) ──────────────────────
  // ARCANE_TRICKSTER_9-shaped (Ezra 127373542): D&D Beyond's subclass list also lists the
  // base class features, plain and without classId; classes[].classFeatures carries classId.
  const trickster = (feature355: Record<string, unknown> = { classId: 46 }) => variant(FIGHTER_5, d => {
    d.classes[0] = {
      id: 1, level: 9, hitDiceUsed: 0,
      definition: { id: 12, name: "Rogue", hitDice: 8, sources: S(2) },
      subclassDefinition: { id: 46, name: "Arcane Trickster", sources: S(2), classFeatures: [
        { id: 343, name: "Sneak Attack", requiredLevel: 1 }, { id: 355, name: "Mage Hand Legerdemain", requiredLevel: 3 },
      ] },
      classFeatures: [
        { definition: { id: 343, name: "Sneak Attack", classId: 12, requiredLevel: 1, description: "Extra damage." } },
        { definition: { id: 355, name: "Mage Hand Legerdemain", requiredLevel: 3, description: "Invisible hand.", ...feature355 } },
      ],
    };
  }).data as Record<string, unknown>;

  it("a base class feature on a subclassed character is a Class Feature (F2)", () => {
    expect(formatCharacterLookup(trickster(), "Sneak Attack", INDEX)).toBe(
      "[Class Feature]\nSneak Attack (Rogue, Level 1)\nRules: 2014 · Player's Handbook (2014)\n\nExtra damage.");
    expect(formatCharacterLookup(trickster(), "Mage Hand Legerdemain", INDEX)).toBe(
      "[Subclass Feature]\nMage Hand Legerdemain (Rogue / Arcane Trickster, Level 3)\nRules: 2014 · Player's Handbook (2014)\n\nInvisible hand.");
  });

  it("a feature with no classId still uses subclass-list membership", () => {
    expect(formatCharacterLookup(trickster({}), "Mage Hand Legerdemain", INDEX).split("\n").slice(0, 2)).toEqual(
      ["[Subclass Feature]", "Mage Hand Legerdemain (Rogue / Arcane Trickster, Level 3)"]);
    // A classId of 0 counts as absent.
    expect(formatCharacterLookup(trickster({ classId: 0 }), "Mage Hand Legerdemain", INDEX).split("\n")[0]).toBe("[Subclass Feature]");
  });

  // ── Actions found through the entry that grants them (F1) ─────────────────
  const FEAT_TYPE = 1088085227;
  const TRAIT_TYPE = 1960452172;
  const RACE_OPTION_TYPE = 306912077;
  const CLASS_OPTION_TYPE = 258900837;
  const CLASS_FEATURE_TYPE = 12168134;
  const act = (name: string, componentId: number, componentTypeId: number, activationType = 1, extra: Record<string, unknown> = {}) =>
    ({ name, componentId, componentTypeId, activation: { activationType }, ...extra });
  const healer = { definition: { id: 1789152, entityTypeId: FEAT_TYPE, name: "Healer", description: "You can heal.", sources: S(145), categories: [] } };
  const parents = (char: Record<string, unknown>) =>
    actionParents(char as unknown as CharData, (char.classes ?? []) as unknown as ClassEntry[]);

  it("an action name finds its feat (F1)", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [act("Battle Medic", 1789152, FEAT_TYPE)] };
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "battle medic", INDEX)).toBe(
      "[Feat]\nHealer\nRules: 2024 · Player's Handbook (2024)\nFound through the action \"Battle Medic\", which this entry grants.\n\nYou can heal.");
  });

  it("an action granted through a race option finds the racial trait", () => {
    const char = variant(FIGHTER_5, d => {
      d.race.racialTraits = [{ definition: { id: 13856126, entityTypeId: TRAIT_TYPE, name: "Giant Ancestry", description: "Giant blood." } }];
      d.options = { race: [{ componentId: 13856126, componentTypeId: TRAIT_TYPE,
        definition: { id: 3727539, entityTypeId: RACE_OPTION_TYPE, name: "Stone’s Endurance (Stone Giant)" } }] };
      d.actions = { race: [act("Stone’s Endurance (Stone Giant)", 3727539, RACE_OPTION_TYPE, 4)] };
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "stones endurance", INDEX)).toBe(
      "[Racial Trait]\nGiant Ancestry (Mountain Dwarf)\nRules: 2024 · Player's Handbook (2024)\n"
      + "Found through the action \"Stone’s Endurance (Stone Giant)\", which this entry grants.\n\nGiant blood.");
  });

  it("an action granted through a chain of options finds the entry at its root", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.options = { feat: [
        { componentId: 1789152, componentTypeId: FEAT_TYPE, definition: { id: 61, entityTypeId: CLASS_OPTION_TYPE, name: "Outer" } },
      ], class: [
        { componentId: 61, componentTypeId: CLASS_OPTION_TYPE, definition: { id: 62, entityTypeId: CLASS_OPTION_TYPE, name: "Inner" } },
      ] };
      d.actions = { feat: [act("Mending Touch", 62, CLASS_OPTION_TYPE, 3)] };
    }).data as Record<string, unknown>;
    expect(parents(char)).toEqual([{ action: "Mending Touch", parent: "Healer", kind: "feat", homebrew: false }]);
    expect(formatCharacterLookup(char, "mending touch", INDEX).split("\n").slice(0, 4)).toEqual(
      ["[Feat]", "Healer", "Rules: 2024 · Player's Handbook (2024)", "Found through the action \"Mending Touch\", which this entry grants."]);
  });

  it("a hidden action is not found", () => {
    // A class action of a feature above the class level (the sheet hides it).
    const hidden = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.classes[0].classFeatures = [{ definition: { id: 500, entityTypeId: CLASS_FEATURE_TYPE, name: "Indomitable", requiredLevel: 9 } }];
      d.actions = { class: [act("Unyielding", 500, CLASS_FEATURE_TYPE)] };
    }).data as Record<string, unknown>;
    expect(parents(hidden)).toEqual([]);
    expect(formatCharacterLookup(hidden, "unyielding", INDEX)).toMatch(/^No definition found matching "unyielding"/);
    // The sheet's own rule (owner decision A6): activation types 1/3/4/8, no weapon-mastery action.
    const unshown = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [act("Long Rite", 1789152, FEAT_TYPE, 6), act("Vex (Rapier)", 1789152, FEAT_TYPE, 1)] };
    }).data as Record<string, unknown>;
    expect(parents(unshown)).toEqual([]);
    expect(formatCharacterLookup(unshown, "long rite", INDEX)).toMatch(/^No definition found/);
    expect(formatCharacterLookup(unshown, "vex", INDEX)).toMatch(/^No definition found/);
    // Bonus actions, reactions and Special (OTHER) actions are shown, so they are found.
    const shown = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [act("Quick Aid", 1789152, FEAT_TYPE, 3), act("Ward Aid", 1789152, FEAT_TYPE, 4), act("Odd Aid", 1789152, FEAT_TYPE, 8)] };
    }).data as Record<string, unknown>;
    expect(parents(shown).map(p => p.action)).toEqual(["Quick Aid", "Ward Aid", "Odd Aid"]);
  });

  it("an action the sheet lists only under LIMITED USE is found, whatever its activation type (fix round)", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [
        act("Long Rite", 1789152, FEAT_TYPE, 6, { limitedUse: { maxUses: 2, numberUsed: 0, resetType: 2 } }),
        act("Quiet Rite", 1789152, FEAT_TYPE, 6, { limitedUse: { maxUses: 0 } }),
      ] };
    }).data as Record<string, unknown>;
    expect(parents(char).map(p => p.action)).toEqual(["Long Rite"]);
    expect(formatCharacterLookup(char, "long rite", INDEX).split("\n").slice(0, 4)).toEqual(
      ["[Feat]", "Healer", "Rules: 2024 · Player's Handbook (2024)", "Found through the action \"Long Rite\", which this entry grants."]);
    expect(formatCharacterLookup(char, "quiet rite", INDEX)).toMatch(/^No definition found/);
  });

  it("an action name matches without typo tolerance; entry names keep the loose rule (fix round)", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [act("Reactive Spell", 1789152, FEAT_TYPE, 4)] };
    }).data as Record<string, unknown>;
    // "speed" is within the loose rule's edit distance of "spell", but not a substring.
    expect(formatCharacterLookup(char, "speed", INDEX)).toMatch(/^No definition found/);
    expect(formatCharacterLookup(char, "reactive spells", INDEX)).toMatch(/^No definition found/);
    expect(formatCharacterLookup(char, "reactive", INDEX)).toContain('Found through the action "Reactive Spell"');
    // Folded as entry names are: hyphens and apostrophes.
    expect(formatCharacterLookup(char, "Reactive-Spell", INDEX)).toContain("Found through");
    // An entry's own name still matches loosely ("heeler" → Healer).
    expect(formatCharacterLookup(char, "heeler", INDEX).split("\n")[0]).toBe("[Feat]");
  });

  it("an action name matches at a word start: \"age\" misses \"Piercer: Reroll Damage\" (fix round, owner decision 2026-11-17)", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [{ definition: { id: 1789153, entityTypeId: FEAT_TYPE, name: "Piercer", description: "Pierce.", sources: S(145), categories: [] } }, healer];
      d.race.racialTraits = [{ definition: { id: 13856126, entityTypeId: TRAIT_TYPE, name: "Giant Ancestry", description: "Giant blood." } }];
      d.options = { race: [{ componentId: 13856126, componentTypeId: TRAIT_TYPE,
        definition: { id: 3727539, entityTypeId: RACE_OPTION_TYPE, name: "Stone’s Endurance (Stone Giant)" } }] };
      d.actions = {
        feat: [act("Piercer: Reroll Damage", 1789153, FEAT_TYPE, 8), act("Battle Medic", 1789152, FEAT_TYPE)],
        race: [act("Stone’s Endurance (Stone Giant)", 3727539, RACE_OPTION_TYPE, 4)],
      };
    }).data as Record<string, unknown>;
    expect(formatCharacterLookup(char, "age", INDEX)).toMatch(/^No definition found matching "age"/);
    expect(formatCharacterLookup(char, "damage", INDEX)).toContain('Found through the action "Piercer: Reroll Damage"');
    expect(formatCharacterLookup(char, "battle medic", INDEX)).toContain('Found through the action "Battle Medic"');
    expect(formatCharacterLookup(char, "stones endurance", INDEX)).toContain('Found through the action "Stone’s Endurance (Stone Giant)"');
    expect(formatCharacterLookup(char, "endurance", INDEX)).toContain("Found through");
  });

  it("only the granting entry's kind gets the via line: an item named like the racial trait does not (fix round)", () => {
    const char = variant(FIGHTER_5, d => {
      d.race.racialTraits = [{ definition: { id: 13856126, entityTypeId: TRAIT_TYPE, name: "Giant Ancestry", description: "Giant blood." } }];
      d.inventory = [{ equipped: true, quantity: 1, definition: { id: 9100, entityTypeId: 2103445194, name: "Giant Ancestry", type: "Trinket", rarity: "Common", sources: S(145) } }];
      d.options = { race: [{ componentId: 13856126, componentTypeId: TRAIT_TYPE,
        definition: { id: 3727539, entityTypeId: RACE_OPTION_TYPE, name: "Stone’s Endurance (Stone Giant)" } }] };
      d.actions = { race: [act("Stone’s Endurance (Stone Giant)", 3727539, RACE_OPTION_TYPE, 4)] };
    }).data as Record<string, unknown>;
    expect(parents(char)).toEqual([{ action: "Stone’s Endurance (Stone Giant)", parent: "Giant Ancestry", kind: "racial-trait", homebrew: false }]);
    const out = formatCharacterLookup(char, "stones endurance", INDEX);
    expect(out.startsWith("[Racial Trait]\nGiant Ancestry (Mountain Dwarf)\n")).toBe(true);
    expect(out).not.toContain("[Item]");
    expect(out.match(/which this entry grants/g)).toHaveLength(1);
  });

  it("an option cycle ends without a hit and without hanging", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.options = { feat: [
        { componentId: 72, componentTypeId: CLASS_OPTION_TYPE, definition: { id: 71, entityTypeId: CLASS_OPTION_TYPE, name: "Loop A" } },
        { componentId: 71, componentTypeId: CLASS_OPTION_TYPE, definition: { id: 72, entityTypeId: CLASS_OPTION_TYPE, name: "Loop B" } },
      ] };
      d.actions = { feat: [act("Loop Strike", 71, CLASS_OPTION_TYPE)] };
    }).data as Record<string, unknown>;
    expect(parents(char)).toEqual([]);
    expect(formatCharacterLookup(char, "loop strike", INDEX)).toMatch(/^No definition found matching "loop strike"/);
  });

  it("an action named like its own parent, or whose parent is already a hit, adds nothing", () => {
    const char = trickster();
    (char as { actions?: unknown }).actions = { class: [act("Sneak Attack", 343, CLASS_FEATURE_TYPE, 8)] };
    expect(parents(char)).toEqual([]);
    expect(formatCharacterLookup(char, "sneak attack", INDEX)).not.toContain("Found through");
    const both = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [act("Healer's Touch", 1789152, FEAT_TYPE)] };
    }).data as Record<string, unknown>;
    // "heal" finds the feat by its own name; the action adds no second copy.
    expect(formatCharacterLookup(both, "heal", INDEX)).toBe(
      "[Feat]\nHealer\nRules: 2024 · Player's Handbook (2024)\n\nYou can heal.");
  });

  it("a through-action hit in a list of more than three names its action (owner decision A5)", () => {
    const char = variant(FIGHTER_5, d => {
      d.feats = [healer];
      d.actions = { feat: [act("Medic Aid", 1789152, FEAT_TYPE)] };
      d.spells = { race: [1, 2, 3].map(n => ({ definition: { id: n, name: `Medic Spell ${n}`, level: 1, school: "Evocation", sources: S(145) } })) };
    }).data as Record<string, unknown>;
    const out = formatCharacterLookup(char, "medic", INDEX);
    expect(out.startsWith('Found 4 matches for "medic".')).toBe(true);
    expect(out).toContain('\n4. [Feat] Healer [2024] (through "Medic Aid")');
    expect(out).not.toContain("untrusted_dndbeyond_content");
  });
});
