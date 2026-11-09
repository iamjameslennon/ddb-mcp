/**
 * Shared character fixtures for parser tests.
 *
 * Lives outside any *.test.ts file so that importing it does NOT cause vitest
 * to re-execute the describe/it blocks of an unrelated test file. (That was
 * the bug discovered when character-snapshot.test.ts imported from
 * character-parser.test.ts directly — vitest re-registered all 73 tests.)
 */

// ── Minimal Level-5 Fighter ─────────────────────────────────────────────────
// STR 16 (+3)  DEX 12 (+1)  CON 14 (+2)  INT 10 (+0)  WIS 13 (+1)  CHA 8 (-1)
// Prof bonus: +3  |  maxHP: base(39) + CON(2)×level(5) = 49  |  currentHP: 44
// Walk: 25 ft (Mountain Dwarf)
// Saving throw proficiencies: STR, CON (from class modifiers)
// Skill proficiencies: Athletics (from class modifiers)
// Feats: Great Weapon Master (real) + Action Surge (__DISGUISE_FEAT, filtered)
// Rules: pure 2024 — species, class, background and both feats cite PHB 2024 (145)
export const FIGHTER_5: Record<string, unknown> = {
  data: {
    name: "Thorin",
    race: {
      fullName: "Mountain Dwarf",
      baseName: "Dwarf",
      sources: [{ sourceId: 145 }],
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
          sources: [{ sourceId: 145 }],
        },
        subclassDefinition: null,
        classFeatures: [],
      },
    ],
    background: { definition: { name: "Soldier", featureName: null, featureDescription: null, sources: [{ sourceId: 145 }] } },
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
          sources: [{ sourceId: 145 }],
        },
      },
      {
        // __DISGUISE_FEAT: should be filtered out of the FEATS section
        definition: {
          name: "Action Surge",
          snippet: "Take an extra action.",
          categories: [{ tagName: "__DISGUISE_FEAT" }],
          sources: [{ sourceId: 145 }],
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

// ── Level-3 Wood Elf Monk wielding a Handaxe ─────────────────────────────────
// Tests Martial Arts: monk weapons (simple melee + shortsword) use DEX when
// DEX > STR. Handaxe is simple melee, so should use DEX 16 (+3) over STR 10 (+0).
// Rules: 2014 — Legacy species, PHB 2014 (2) class and background; the Handaxe
// cites both Basic Rules (148, 1), so it takes the character's edition.
export const MONK_3_HANDAXE: Record<string, unknown> = {
  data: {
    name: "Sienna",
    race: {
      fullName: "Wood Elf",
      baseName: "Elf",
      isLegacy: true,
      sources: [{ sourceId: 2 }],
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
          sources: [{ sourceId: 2 }],
        },
        subclassDefinition: null,
        classFeatures: [
          { definition: { name: "Martial Arts", requiredLevel: 1, snippet: "Use DEX for monk weapons." }, levelScale: { dice: { diceString: "1d4" } } },
        ],
      },
    ],
    background: { definition: { name: "Outlander", featureName: null, featureDescription: null, sources: [{ sourceId: 2 }] } },
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
          sources: [{ sourceId: 148 }, { sourceId: 1 }],
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

// ── Level-9 Rogue / Arcane Trickster ─────────────────────────────────────────
// Subclass-source spellcasting: base Rogue.canCastSpells = false, but
// Arcane Trickster subclass.canCastSpells = true. Tests the subclass-driven
// spellcasting path.
// Rules: 2024 (PHB 2024 species, class and subclass) with a 2014 (PHB 2014)
// background.
export const ARCANE_TRICKSTER_9: Record<string, unknown> = {
  data: {
    name: "Lyra",
    race: {
      fullName: "Human",
      baseName: "Human",
      sources: [{ sourceId: 145 }],
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
          sources: [{ sourceId: 145 }],
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
          sources: [{ sourceId: 145 }],
        },
        classFeatures: [],
      },
    ],
    background: { definition: { name: "Criminal", featureName: null, featureDescription: null, sources: [{ sourceId: 2 }] } },
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

// ── Level-5 Cleric with action spells ────────────────────────────────────────
// WIS 18 (+4), prof +3: Spell Attack +7, Save DC 15. Class list: Sacred Flame
// (damaging save cantrip), Guiding Bolt (prepared attack spell) and Light
// (utility cantrip, no ACTIONS row); Fire Bolt from a racial trait with its
// own ability (INT 10). Spell definitions trimmed from live D&D Beyond JSON
// (2026-11-07). Rules: pure 2024.
const cantripScale = (size: number) => ({
  higherLevelDefinitions: [5, 11, 17].map((level, i) => ({
    level, typeId: 15, value: null, details: "",
    dice: { diceCount: i + 2, diceValue: size, diceMultiplier: null, fixedValue: 0, diceString: `${i + 2}d${size}` },
  })),
});
const spellDie = (count: number, size: number) => ({ diceCount: count, diceValue: size, diceMultiplier: null, fixedValue: null, diceString: `${count}d${size}` });
const oneAction = { activationTime: 1, activationType: 1 };
const noHigherLevels = { higherLevelDefinitions: [] };

export const CLERIC_5_SPELLS: Record<string, unknown> = {
  data: {
    name: "Mira",
    race: {
      fullName: "High Elf",
      baseName: "Elf",
      sources: [{ sourceId: 145 }],
      weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } },
      racialTraits: [],
    },
    classes: [
      {
        id: 7,
        level: 5,
        hitDiceUsed: 0,
        isStartingClass: true,
        definition: {
          name: "Cleric",
          hitDice: 8,
          canCastSpells: true,
          spellCastingAbilityId: 5,    // WIS
          sources: [{ sourceId: 145 }],
          spellRules: {
            levelSpellSlots: Array.from({ length: 21 }, (_, lvl) =>
              lvl >= 5 ? [4, 3, 2, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]
            ),
          },
        },
        subclassDefinition: null,
        classFeatures: [],
      },
    ],
    background: { definition: { name: "Acolyte", featureName: null, featureDescription: null, sources: [{ sourceId: 145 }] } },
    currentXp: 6500,
    inspiration: false,
    stats: [
      { id: 1, value: 10 }, // STR
      { id: 2, value: 12 }, // DEX
      { id: 3, value: 14 }, // CON
      { id: 4, value: 10 }, // INT
      { id: 5, value: 18 }, // WIS +4
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
    spells: {
      race: [
        {
          spellCastingAbilityId: 4,    // INT, the racial trait's own ability
          castAtLevel: null,
          definition: {
            id: 2103, name: "Fire Bolt", level: 0, attackType: 2, saveDcAbilityId: null, activation: oneAction,
            range: { origin: "Ranged", rangeValue: 120, aoeType: null, aoeValue: null },
            scaleType: "characterlevel", atHigherLevels: noHigherLevels, sources: [{ sourceId: 145 }],
            modifiers: [{ type: "damage", subType: "fire", die: spellDie(1, 10), restriction: "", atHigherLevels: cantripScale(10) }],
          },
        },
      ],
    },
    classSpells: [
      {
        characterClassId: 7,
        spells: [
          {
            prepared: true,
            castAtLevel: null,
            definition: {
              id: 2236, name: "Sacred Flame", level: 0, attackType: null, saveDcAbilityId: 2, activation: oneAction,
              range: { origin: "Ranged", rangeValue: 60, aoeType: null, aoeValue: null },
              scaleType: "characterlevel", atHigherLevels: noHigherLevels, sources: [{ sourceId: 145 }],
              modifiers: [{ type: "damage", subType: "radiant", die: spellDie(1, 8), restriction: "", atHigherLevels: cantripScale(8) }],
            },
          },
          {
            prepared: true,
            castAtLevel: null,
            definition: {
              id: 2133, name: "Guiding Bolt", level: 1, attackType: 2, saveDcAbilityId: null, activation: oneAction,
              range: { origin: "Ranged", rangeValue: 120, aoeType: null, aoeValue: null },
              scaleType: "spellscale", atHigherLevels: noHigherLevels, sources: [{ sourceId: 145 }],
              modifiers: [{
                type: "damage", subType: "radiant", die: spellDie(4, 6), restriction: "",
                atHigherLevels: { higherLevelDefinitions: [{ level: 1, typeId: 15, value: null, details: "", dice: { diceCount: 1, diceValue: 6, diceMultiplier: null, fixedValue: 0, diceString: "1d6" } }] },
              }],
            },
          },
          {
            prepared: true,
            castAtLevel: null,
            definition: {
              id: 2173, name: "Light", level: 0, attackType: null, saveDcAbilityId: 2, activation: oneAction,
              range: { origin: "Touch", rangeValue: 0, aoeType: null, aoeValue: null },
              scaleType: null, atHigherLevels: noHigherLevels, sources: [{ sourceId: 145 }], modifiers: [],
            },
          },
        ],
      },
    ],
    actions: { class: [], race: [], feat: [], background: [] },
    currencies: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    baseHitPoints: 33,
    bonusHitPoints: 0,
    removedHitPoints: 0,
    temporaryHitPoints: 0,
    spellSlots: [],
    deathSaves: { successCount: 0, failCount: 0 },
    conditions: [],
    customSenses: [],
  },
};
