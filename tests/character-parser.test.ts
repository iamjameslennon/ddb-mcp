import { describe, it, expect, beforeAll } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";

// ── Minimal Level-5 Fighter fixture ─────────────────────────────────────────
// STR 16 (+3)  DEX 12 (+1)  CON 14 (+2)  INT 10 (+0)  WIS 13 (+1)  CHA 8 (-1)
// Prof bonus: +3  |  maxHP: base(39) + CON(2)×level(5) = 49  |  currentHP: 44
// Walk: 25 ft (Mountain Dwarf)
// Saving throw proficiencies: STR, CON (from class modifiers)
// Skill proficiencies: Athletics (from class modifiers)
// Feats: Great Weapon Master (real) + Action Surge (__DISGUISE_FEAT, filtered)
const FIGHTER_5: Record<string, unknown> = {
  data: {
    name: "Thorin",
    race: {
      fullName: "Mountain Dwarf",
      baseName: "Dwarf",
      weightSpeeds: { normal: { walk: 25, fly: 0, swim: 0, climb: 0, burrow: 0 } },
      racialTraits: [],
    },
    classes: [
      {
        id: 1,
        level: 5,
        hitDiceUsed: 1,
        definition: {
          name: "Fighter",
          hitDice: 10,
          canCastSpells: false,
          spellCastingAbilityId: 0,
          spellRules: {},
        },
        subclassDefinition: null,
        classFeatures: [],
      },
    ],
    background: { definition: { name: "Soldier", featureName: null, featureDescription: null } },
    currentXp: 6500,
    inspiration: false,
    stats: [
      { id: 1, value: 16 },
      { id: 2, value: 12 },
      { id: 3, value: 14 },
      { id: 4, value: 10 },
      { id: 5, value: 13 },
      { id: 6, value: 8 },
    ],
    bonusStats: [
      { id: 1, value: null }, { id: 2, value: null }, { id: 3, value: null },
      { id: 4, value: null }, { id: 5, value: null }, { id: 6, value: null },
    ],
    overrideStats: [
      { id: 1, value: null }, { id: 2, value: null }, { id: 3, value: null },
      { id: 4, value: null }, { id: 5, value: null }, { id: 6, value: null },
    ],
    modifiers: {
      race: [],
      class: [
        { type: "proficiency", subType: "strength-saving-throws" },
        { type: "proficiency", subType: "constitution-saving-throws" },
        { type: "proficiency", subType: "athletics" },
      ],
      background: [],
      feat: [],
      item: [],
      condition: [],
    },
    feats: [
      {
        definition: {
          name: "Great Weapon Master",
          snippet: "On a critical hit or kill, make a bonus attack.",
          categories: [],
        },
      },
      {
        // __DISGUISE_FEAT: should be filtered out of the FEATS section
        definition: {
          name: "Action Surge",
          snippet: "Take an extra action.",
          categories: [{ tagName: "__DISGUISE_FEAT" }],
        },
      },
    ],
    inventory: [],
    spells: {},
    classSpells: [],
    actions: { class: [], race: [], feat: [], background: [] },
    currencies: { pp: 0, gp: 15, ep: 0, sp: 20, cp: 0 },
    baseHitPoints: 39,
    bonusHitPoints: 0,
    removedHitPoints: 5,
    temporaryHitPoints: 0,
    spellSlots: [],
    deathSaves: { successCount: 0, failCount: 0 },
    conditions: [],
  },
};

describe("parseCharacterData", () => {
  let result: string;

  beforeAll(() => {
    result = parseCharacterData(FIGHTER_5);
  });

  it("includes character name, race, and class in header", () => {
    expect(result).toContain("Thorin");
    expect(result).toContain("Mountain Dwarf");
    expect(result).toContain("Fighter 5");
    expect(result).toContain("Level 5");
  });

  it("calculates hit points correctly (base + CON_mod × level, minus removed)", () => {
    // maxHp = 39 + (2 × 5) = 49;  currentHp = 49 − 5 = 44
    expect(result).toContain("HP: 44/49");
  });

  it("shows all ability scores with correct modifiers", () => {
    expect(result).toContain("STR 16 (+3)");
    expect(result).toContain("DEX 12 (+1)");
    expect(result).toContain("CON 14 (+2)");
    expect(result).toContain("INT 10 (+0)");
    expect(result).toContain("WIS 13 (+1)");
    expect(result).toContain("CHA 8 (-1)");
  });

  it("shows correct proficiency bonus for level 5", () => {
    expect(result).toContain("Prof Bonus: +3");
  });

  it("marks saving throw proficiencies correctly", () => {
    // The saves line is: "  STR +6*   DEX +1   CON +5*   ..."
    expect(result).toContain("STR +6*");
    expect(result).toContain("CON +5*");
    // DEX has no proficiency — should be "+1" without asterisk
    expect(result).toContain("DEX +1");
    expect(result).not.toContain("DEX +1*");
  });

  it("shows Athletics with proficiency bonus applied", () => {
    // STR mod(+3) + prof(+3) = +6, proficient → marked with *
    const athleticsLine = result.split("\n").find((l) => l.includes("Athletics"));
    expect(athleticsLine).toBeDefined();
    expect(athleticsLine).toContain("+6");
    expect(athleticsLine).toContain("*");
  });

  it("calculates passive perception correctly", () => {
    // 10 + WIS mod(+1) + no proficiency = 11
    expect(result).toContain("Passive Perception: 11");
  });

  it("filters __DISGUISE_FEAT feats out of the FEATS section", () => {
    // Only 1 real feat (Great Weapon Master)
    expect(result).toContain("FEATS (1)");
    expect(result).toContain("Great Weapon Master");
    // Action Surge must appear in OTHER FEATURES, not counted as a feat
    const featsStart = result.indexOf("FEATS (1)");
    const otherFeaturesStart = result.indexOf("OTHER FEATURES");
    const textBetween = result.slice(featsStart, otherFeaturesStart);
    expect(textBetween).not.toContain("Action Surge");
    expect(result).toContain("OTHER FEATURES");
    expect(result.slice(otherFeaturesStart)).toContain("Action Surge");
  });

  it("shows non-zero currencies", () => {
    expect(result).toContain("15gp");
    expect(result).toContain("20sp");
    // Zero-value coins are suppressed
    expect(result).not.toMatch(/\b0pp\b/);
    expect(result).not.toMatch(/\b0ep\b/);
  });

  it("shows walk speed for Mountain Dwarf", () => {
    expect(result).toContain("25 ft.");
  });

  it("shows hit dice with used count", () => {
    // 5 total, 1 used → 4 remaining
    expect(result).toContain("5d10 (4 remaining)");
  });

  it("shows background", () => {
    expect(result).toContain("Soldier");
  });
});

describe("parseCharacterData — sections param", () => {
  it("summary section includes vitals and ability scores", () => {
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("Thorin");
    expect(out).toContain("STR 16 (+3)");
    expect(out).toContain("Prof Bonus: +3");
  });

  it("summary section excludes SPELLS and INVENTORY blocks", () => {
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).not.toContain("SPELLS");
    expect(out).not.toContain("INVENTORY");
  });

  it("combat section includes ACTIONS", () => {
    const out = parseCharacterData(FIGHTER_5, "combat");
    expect(out).toContain("ACTIONS");
  });

  it("spells section excludes INVENTORY", () => {
    const out = parseCharacterData(FIGHTER_5, "spells");
    expect(out).not.toContain("INVENTORY");
  });

  it("full section (default) contains all major blocks", () => {
    const full = parseCharacterData(FIGHTER_5, "full");
    const def  = parseCharacterData(FIGHTER_5);
    // full and default produce identical output
    expect(full).toBe(def);
  });
});
