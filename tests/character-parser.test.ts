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

// ── 2014-style character with darkvision via customSenses ────────────────────
// Darkvision is NOT in modifiers (no type:"sense") — it comes from customSenses
// senseId 2 = Darkvision, value = 60 ft.
const FIGHTER_5_2014_DARKVISION: Record<string, unknown> = {
  data: {
    ...((FIGHTER_5.data) as Record<string, unknown>),
    race: {
      fullName: "Hill Dwarf",
      baseName: "Dwarf",
      weightSpeeds: { normal: { walk: 25, fly: 0, swim: 0, climb: 0, burrow: 0 } },
      racialTraits: [],
    },
    customSenses: [{ senseId: 2, value: 60, notes: "" }],
  },
};

describe("parseCharacterData — 2014 darkvision via customSenses", () => {
  it("shows Darkvision from customSenses when no type:sense modifier exists", () => {
    const out = parseCharacterData(FIGHTER_5_2014_DARKVISION);
    expect(out).toContain("Darkvision 60 ft.");
  });

  it("does not show darkvision for a character with no senses", () => {
    const out = parseCharacterData(FIGHTER_5);
    expect(out).not.toContain("Darkvision");
  });

  it("shows Darkvision from a type:set-base race modifier (real 2014 Tiefling/Half-Elf API shape)", () => {
    // Raw API for 2014 characters emits { type: "set-base", subType: "darkvision", value: 60, fixedValue: 60 }
    const tiefling: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        race: {
          fullName: "Tiefling",
          baseName: "Tiefling",
          weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } },
          racialTraits: [],
        },
        customSenses: [],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [{ type: "set-base", subType: "darkvision", value: 60, fixedValue: 60 }],
        },
      },
    };
    const out = parseCharacterData(tiefling);
    expect(out).toContain("Darkvision 60 ft.");
  });

  it("deduplicates: keeps the higher value when same sense appears in multiple sources", () => {
    const both: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        race: {
          fullName: "Hill Dwarf",
          baseName: "Dwarf",
          weightSpeeds: { normal: { walk: 25, fly: 0, swim: 0, climb: 0, burrow: 0 } },
          racialTraits: [],
        },
        customSenses: [{ senseId: 2, value: 60, notes: "" }],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [{ type: "sense", subType: "darkvision", value: 120 }],
        },
      },
    };
    const out = parseCharacterData(both);
    expect(out).toContain("Darkvision 120 ft.");
    expect(out).not.toContain("Darkvision 60 ft.");
    // Should appear exactly once
    expect(out.split("Darkvision").length - 1).toBe(1);
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

// ── Monk with handaxe: Martial Arts DEX-over-STR ─────────────────────────────
// STR 10 (+0)  DEX 16 (+3)  — DEX beats STR
// Level 3 Monk has Martial Arts (level 1 feature)
// Handaxe: simple melee (categoryId=1, attackType=1), Light+Thrown, no Finesse
// Expected: DEX mod (+3) used → hit +5 (DEX+prof), dmg 1d6+3
// Without fix: STR mod (+0) used → hit +2, dmg 1d6
const MONK_3_HANDAXE: Record<string, unknown> = {
  data: {
    name: "Sienna",
    race: {
      fullName: "Wood Elf",
      baseName: "Elf",
      weightSpeeds: { normal: { walk: 35, fly: 0, swim: 0, climb: 0, burrow: 0 } },
      racialTraits: [],
    },
    classes: [
      {
        id: 2,
        level: 3,
        hitDiceUsed: 0,
        definition: {
          name: "Monk",
          hitDice: 8,
          canCastSpells: false,
          spellCastingAbilityId: 0,
          spellRules: {},
        },
        subclassDefinition: null,
        classFeatures: [
          { definition: { name: "Martial Arts", requiredLevel: 1, snippet: "Use DEX for monk weapons." } },
        ],
      },
    ],
    background: { definition: { name: "Outlander", featureName: null, featureDescription: null } },
    currentXp: 900,
    inspiration: false,
    stats: [
      { id: 1, value: 10 }, // STR +0
      { id: 2, value: 16 }, // DEX +3
      { id: 3, value: 14 }, // CON +2
      { id: 4, value: 10 }, // INT +0
      { id: 5, value: 14 }, // WIS +2
      { id: 6, value: 8  }, // CHA -1
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
        { type: "proficiency", subType: "simple-weapons" },
      ],
      background: [],
      feat: [],
      item: [],
      condition: [],
    },
    feats: [],
    inventory: [
      {
        equipped: true,
        quantity: 1,
        definition: {
          name: "Handaxe",
          filterType: "Weapon",
          type: "Handaxe",
          categoryId: 1,    // simple
          attackType: 1,    // melee
          damage: { diceString: "1d6" },
          damageType: "Slashing",
          range: 20,
          longRange: 60,
          mastery: "",
          properties: [{ name: "Light" }, { name: "Thrown" }],
          grantedModifiers: [],
        },
      },
    ],
    spells: {},
    classSpells: [],
    actions: { class: [], race: [], feat: [], background: [] },
    currencies: { pp: 0, gp: 10, ep: 0, sp: 0, cp: 0 },
    baseHitPoints: 24,
    bonusHitPoints: 0,
    removedHitPoints: 0,
    temporaryHitPoints: 0,
    spellSlots: [],
    deathSaves: { successCount: 0, failCount: 0 },
    conditions: [],
    customSenses: [],
  },
};

describe("parseCharacterData — Monk Martial Arts DEX for monk weapons", () => {
  let result: string;

  beforeAll(() => {
    result = parseCharacterData(MONK_3_HANDAXE, "combat");
  });

  it("uses DEX (+3) not STR (+0) for handaxe attack bonus", () => {
    // prof(+2) + DEX(+3) = +5
    const handaxeLine = result.split("\n").find(l => l.includes("Handaxe"));
    expect(handaxeLine).toBeDefined();
    expect(handaxeLine).toContain("+5 to hit");
  });

  it("uses DEX (+3) not STR (+0) for handaxe damage bonus", () => {
    const handaxeLine = result.split("\n").find(l => l.includes("Handaxe"));
    expect(handaxeLine).toContain("1d6+3");
  });

  it("does not apply monk-weapon DEX to a character without Martial Arts", () => {
    // Same stats/inventory as MONK_3 but classFeatures is empty → no Martial Arts
    // DEX(+3) > STR(+0) but without Martial Arts the weapon uses STR
    // prof(+2) + STR(+0) = +2 to hit, 1d6+0 damage
    const noMartialArts = {
      data: {
        ...((MONK_3_HANDAXE.data) as Record<string, unknown>),
        classes: [
          {
            id: 2, level: 3, hitDiceUsed: 0,
            definition: { name: "Monk", hitDice: 8, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {} },
            subclassDefinition: null,
            classFeatures: [], // Martial Arts feature removed
          },
        ],
      },
    };
    const out = parseCharacterData(noMartialArts, "combat");
    const handaxeLine = out.split("\n").find(l => l.includes("Handaxe"));
    expect(handaxeLine).toBeDefined();
    // STR(+0) + prof(+2) = +2 to hit, damage 1d6 (no bonus)
    expect(handaxeLine).toContain("+2 to hit");
    expect(handaxeLine).toContain("1d6 ");
    expect(handaxeLine).not.toContain("1d6+3");
  });
});

// ── Arcane Trickster: subclass spellcasting ───────────────────────────────────
// Rogue 9 / Arcane Trickster — canCastSpells is on subclassDefinition, not definition
// INT 16 (+3), prof +4 (level 9)
// Spell attack: +3 + 4 = +7   Save DC: 8 + 3 + 4 = 15
// The base Rogue class has canCastSpells: false — the bug silently skips this entry
const ARCANE_TRICKSTER_9: Record<string, unknown> = {
  data: {
    name: "Lyra",
    race: {
      fullName: "Human",
      baseName: "Human",
      weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } },
      racialTraits: [],
    },
    classes: [
      {
        id: 3,
        level: 9,
        hitDiceUsed: 0,
        definition: {
          name: "Rogue",
          hitDice: 8,
          canCastSpells: false,        // base Rogue does NOT cast
          spellCastingAbilityId: 0,
          spellRules: {
            // Arcane Trickster gets 1/3 caster slots; simplified table for test
            levelSpellSlots: Array.from({ length: 21 }, (_, lvl) =>
              lvl >= 3 ? [2, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]
            ),
          },
        },
        subclassDefinition: {
          name: "Arcane Trickster",
          canCastSpells: true,         // subclass IS the source of spellcasting
          spellCastingAbilityId: 4,    // INT
        },
        classFeatures: [],
      },
    ],
    background: { definition: { name: "Criminal", featureName: null, featureDescription: null } },
    currentXp: 0,
    inspiration: false,
    stats: [
      { id: 1, value: 10 }, // STR
      { id: 2, value: 14 }, // DEX
      { id: 3, value: 12 }, // CON
      { id: 4, value: 16 }, // INT +3
      { id: 5, value: 10 }, // WIS
      { id: 6, value: 8  }, // CHA
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
      race: [], class: [], background: [], feat: [], item: [], condition: [],
    },
    feats: [],
    inventory: [],
    spells: {},
    classSpells: [],
    actions: { class: [], race: [], feat: [], background: [] },
    currencies: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    baseHitPoints: 54,
    bonusHitPoints: 0,
    removedHitPoints: 0,
    temporaryHitPoints: 0,
    spellSlots: [],
    deathSaves: { successCount: 0, failCount: 0 },
    conditions: [],
    customSenses: [],
  },
};

describe("parseCharacterData — Arcane Trickster subclass spellcasting", () => {
  let result: string;

  beforeAll(() => {
    result = parseCharacterData(ARCANE_TRICKSTER_9, "spells");
  });

  it("includes a SPELLCASTING section for the Arcane Trickster subclass", () => {
    expect(result).toContain("SPELLCASTING");
    expect(result).toContain("Arcane Trickster");
  });

  it("shows INT as the spellcasting ability", () => {
    // The spellcasting line contains "Spell Attack:" — use that to avoid matching the header
    const castingLine = result.split("\n").find(l => l.includes("Spell Attack:") && l.includes("Arcane Trickster"));
    expect(castingLine).toBeDefined();
    expect(castingLine).toContain("INT");
  });

  it("calculates spell attack and save DC from INT mod (+3) and prof (+4)", () => {
    // spell attack: INT(+3) + prof(+4) = +7   save DC: 8 + 3 + 4 = 15
    const castingLine = result.split("\n").find(l => l.includes("Spell Attack:") && l.includes("Arcane Trickster"));
    expect(castingLine).toBeDefined();
    expect(castingLine).toContain("+7");
    expect(castingLine).toContain("15");
  });
});

// ── Amulet of Health: type:"set" score modifier ───────────────────────────────
// Base CON 12 (+1). Amulet of Health sets constitution-score to 19 via a
// type:"set" item modifier. The fix should floor CON at 19 (set wins over base).
// At level 5, prof +3. CON mod with Amulet = +4 → maxHp = 39 + 4×5 = 59, current = 59−5 = 54
const FIGHTER_5_AMULET: Record<string, unknown> = {
  data: {
    ...((FIGHTER_5.data) as Record<string, unknown>),
    // Override CON to 12 so without the item it would be +1 not +2
    stats: [
      { id: 1, value: 16 }, // STR
      { id: 2, value: 12 }, // DEX
      { id: 3, value: 12 }, // CON — base 12 (+1), amulet sets it to 19 (+4)
      { id: 4, value: 10 }, // INT
      { id: 5, value: 13 }, // WIS
      { id: 6, value: 8  }, // CHA
    ],
    modifiers: {
      ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
      item: [
        { type: "set", subType: "constitution-score", fixedValue: 19 },
      ],
    },
  },
};

describe("parseCharacterData — Amulet of Health type:set score modifier", () => {
  let result: string;

  beforeAll(() => {
    result = parseCharacterData(FIGHTER_5_AMULET);
  });

  it("displays CON as 19 when set modifier exceeds base score", () => {
    expect(result).toContain("CON 19");
  });

  it("applies the +4 CON modifier from the set score", () => {
    expect(result).toContain("CON 19 (+4)");
  });

  it("does not raise a score that is already higher than the set value", () => {
    // STR is 16 — a hypothetical set to 19 should raise it, but here STR has no set modifier
    // so it stays at 16 (+3)
    expect(result).toContain("STR 16 (+3)");
  });
});

// ── activationType 4 class actions appear in REACTIONS ────────────────────────
// Verified against live API: Uncanny Dodge, Deflect Missiles, Slow Fall all have
// activation.activationType === 4 in char.actions.class.
describe("parseCharacterData — class reaction features in REACTIONS section", () => {
  it("includes activationType 4 class actions in REACTIONS", () => {
    const withReaction: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        actions: {
          class: [
            { name: "Uncanny Dodge", activation: { activationType: 4 } },
          ],
          race: [], feat: [], background: [],
        },
      },
    };
    const out = parseCharacterData(withReaction, "combat");
    expect(out).toContain("REACTIONS");
    expect(out).toContain("Uncanny Dodge");
    const reactionsStart = out.indexOf("REACTIONS");
    const nextSection = out.indexOf("\n\n", reactionsStart);
    const reactionsBlock = out.slice(reactionsStart, nextSection > -1 ? nextSection : undefined);
    expect(reactionsBlock).toContain("Uncanny Dodge");
  });

  it("Opportunity Attack is always present alongside class reactions", () => {
    const withReaction: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        actions: {
          class: [
            { name: "Deflect Missiles", activation: { activationType: 4 } },
          ],
          race: [], feat: [], background: [],
        },
      },
    };
    const out = parseCharacterData(withReaction, "combat");
    const reactionsStart = out.indexOf("REACTIONS");
    const nextSection = out.indexOf("\n\n", reactionsStart);
    const reactionsBlock = out.slice(reactionsStart, nextSection > -1 ? nextSection : undefined);
    expect(reactionsBlock).toContain("Opportunity Attack");
    expect(reactionsBlock).toContain("Deflect Missiles");
  });

  it("does not include activationType 4 actions in ACTIONS or BONUS ACTIONS blocks", () => {
    const withReaction: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        actions: {
          class: [
            { name: "Slow Fall", activation: { activationType: 4 } },
          ],
          race: [], feat: [], background: [],
        },
      },
    };
    const out = parseCharacterData(withReaction, "combat");
    const reactionsStart = out.indexOf("REACTIONS");
    const actionsStart = out.indexOf("ACTIONS");
    const bonusStart = out.indexOf("BONUS ACTIONS");
    // Should not appear before the REACTIONS header
    if (actionsStart > -1 && actionsStart < reactionsStart)
      expect(out.slice(actionsStart, reactionsStart)).not.toContain("Slow Fall");
    if (bonusStart > -1 && bonusStart < reactionsStart)
      expect(out.slice(bonusStart, reactionsStart)).not.toContain("Slow Fall");
  });
});

// ── __INITIAL_ASI feats are dropped entirely ──────────────────────────────────
// 2024 backgrounds store their Ability Score Improvement as a feat tagged
// __INITIAL_ASI (e.g. "Sage Ability Score Improvements"). These are already
// reflected in ABILITY SCORES and must not appear in FEATS or OTHER FEATURES.
describe("parseCharacterData — __INITIAL_ASI feats excluded from FEATS", () => {
  it("does not count __INITIAL_ASI toward FEATS total", () => {
    const with2024Bg: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        feats: [
          // 1 real feat
          { definition: { name: "Great Weapon Master", snippet: "On a critical hit or kill, make a bonus attack.", categories: [] } },
          // 2024 background ASI — must be excluded
          { definition: { name: "Sage Ability Score Improvements", snippet: "", categories: [{ tagName: "__INITIAL_ASI" }] } },
        ],
      },
    };
    const out = parseCharacterData(with2024Bg);
    // Only the real feat should be counted
    expect(out).toContain("FEATS (1)");
    expect(out).not.toContain("Sage Ability Score Improvements");
  });

  it("does not show __INITIAL_ASI in OTHER FEATURES either", () => {
    const with2024Bg: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        feats: [
          {
            definition: {
              name: "Criminal Ability Score Improvements",
              snippet: "",
              categories: [{ tagName: "__INITIAL_ASI" }],
            },
          },
        ],
      },
    };
    const out = parseCharacterData(with2024Bg);
    expect(out).not.toContain("Criminal Ability Score Improvements");
  });
});

// ── resolveTemplates — expression evaluation ──────────────────────────────────
// FIGHTER_5: level 5, prof +3. Template tokens are injected via a feat snippet
// so we can assert the resolved text in the parsed output.
describe("parseCharacterData — resolveTemplates expression evaluation", () => {
  const withFeatSnippet = (snippet: string) => parseCharacterData({
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      feats: [{ definition: { name: "TestFeat", snippet, categories: [] } }],
    },
  });

  it("resolves {{characterlevel*2}} to twice the total level", () => {
    // level 5 → 5 * 2 = 10
    expect(withFeatSnippet("HP increases by {{characterlevel*2}}.")).toContain("HP increases by 10.");
  });

  it("resolves {{proficiency#signed}} with + prefix", () => {
    // prof +3 at level 5
    expect(withFeatSnippet("Bonus {{proficiency#signed}} to checks.")).toContain("Bonus +3 to checks.");
  });

  it("resolves {{classlevel*5#unsigned}} as plain number", () => {
    // level 5 → 5 * 5 = 25 (no sign prefix for #unsigned)
    expect(withFeatSnippet("Reduce by {{classlevel*5#unsigned}} ft.")).toContain("Reduce by 25 ft.");
  });

  it("resolves {{unknown}} to ?", () => {
    expect(withFeatSnippet("Value is {{unknown}}.")).toContain("Value is ?.");
  });
});

// ── char.spells cross-source deduplication and duplicate warnings ─────────────
describe("parseCharacterData — cross-source spell deduplication", () => {
  const makeSpell = (id: number, name: string, level: number) => ({
    definition: { id, name, level },
  });

  it("shows each spell once and emits no warning when there are no duplicates", () => {
    const out = parseCharacterData({
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        spells: {
          class: [makeSpell(1001, "Fireball", 3)],
          feat:  [makeSpell(1002, "Mage Hand", 0)],
          race: [], background: [], item: [],
        },
      },
    }, "spells");
    expect(out).toContain("From Class Feature: Fireball (L3)");
    expect(out).toContain("From Feat: Mage Hand");
    expect(out).not.toContain("⚠");
    // Each spell appears exactly once
    expect(out.split("Fireball").length - 1).toBe(1);
  });

  it("deduplicates same spell id across sources and emits a warning naming both", () => {
    // Find Familiar (id 1003) granted by both class and feat
    const out = parseCharacterData({
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        spells: {
          class: [makeSpell(1003, "Find Familiar", 1)],
          feat:  [makeSpell(1003, "Find Familiar", 1)],
          race: [], background: [], item: [],
        },
      },
    }, "spells");
    // Spell appears only under the first source (class)
    expect(out).toContain("From Class Feature: Find Familiar (L1)");
    expect(out).not.toContain("From Feat: Find Familiar");
    // Warning is present and names both sources
    expect(out).toContain("⚠ Duplicate spell grants detected");
    expect(out).toContain("Find Familiar (L1) — already granted by Class Feature, also in Feat");
  });

  it("warns when classSpells and char.spells.class share the same spell ID", () => {
    // Speak with Animals (id 123) prepared via classSpells AND auto-granted via class feature
    const out = parseCharacterData({
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        classSpells: [{
          characterClassId: 1,
          spells: [{ definition: { id: 123, name: "Speak with Animals", level: 1 } }],
        }],
        spells: {
          class: [makeSpell(123, "Speak with Animals", 1)],
          race: [], background: [], feat: [], item: [],
        },
      },
    }, "spells");
    expect(out).toContain("⚠ Duplicate spell grants detected");
    expect(out).toContain("Speak with Animals (L1) — already granted by Spells, also in Class Feature");
    // The spell should appear only once in the Spells: line, not again under From Class Feature:
    expect(out).not.toContain("From Class Feature: Speak with Animals");
  });
});

// ── Jack of All Trades via "ability-checks" (2024 Bard path) ─────────────────
// 2014 API: half-proficiency/initiative + half-proficiency/ability-checks
// 2024 API: half-proficiency/ability-checks only — the old check missed this
// FIGHTER_5: DEX 12 (+1), level 5, prof +3 → JoAT adds floor(3/2)=1 → initiative +2
describe("parseCharacterData — JoAT initiative via ability-checks modifier", () => {
  it("applies half-proficiency to initiative when only ability-checks modifier is present", () => {
    const with2024Joat: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            // 2024-style JoAT: only ability-checks, no initiative subType
            { type: "half-proficiency", subType: "ability-checks" },
          ],
        },
      },
    };
    const out = parseCharacterData(with2024Joat, "summary");
    // DEX(+1) + floor(prof+3 / 2)=1 = +2
    expect(out).toContain("Initiative: +2");
  });

  it("does not apply JoAT when no half-proficiency modifier is present", () => {
    // Baseline FIGHTER_5 has no JoAT modifier → initiative = DEX mod = +1
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("Initiative: +1");
  });
});
