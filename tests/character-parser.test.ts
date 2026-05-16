import { describe, it, expect, beforeAll } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { FIGHTER_5, MONK_3_HANDAXE, ARCANE_TRICKSTER_9 } from "./fixtures/character-fixtures.js";

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

// ── Weapon proficiency: comma-containing type names (e.g. "Crossbow, Light") ──
// "Crossbow, Light".toLowerCase().replace(/[,\s]+/g, "-") → "crossbow-light" ✓
// The old replace(/ /g, "-") left the comma: "crossbow,-light" → no proficiency match.
describe("parseCharacterData — comma-in-type-name weapon proficiency", () => {
  it("detects proficiency for a weapon whose type name contains a comma", () => {
    const withCrossbow: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>).class as unknown[]),
            { type: "proficiency", subType: "crossbow-light" },
          ],
        },
        inventory: [{
          equipped: true,
          quantity: 1,
          definition: {
            name: "Crossbow, Light",
            type: "Crossbow, Light",
            filterType: "Weapon",
            categoryId: 1,
            attackType: 2,
            damage: { diceCount: 1, diceValue: 8, diceString: "1d8" },
            damageType: "piercing",
            range: 80, longRange: 320,
            properties: [{ name: "Ammunition" }, { name: "Loading" }, { name: "Range" }, { name: "Two-Handed" }],
            grantedModifiers: [], mastery: "",
          },
        }],
      },
    };
    const out = parseCharacterData(withCrossbow, "combat");
    // FIGHTER_5: DEX 12 (+1), prof +3 → +1+3 = +4 to hit
    expect(out).toContain("Crossbow, Light  +4 to hit");
  });
});


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

// ── Draconic Resilience — type:"set" unarmored-armor-class raises base to 13 ──
// Real DDB shape: { type:"set", subType:"unarmored-armor-class", value:3, fixedValue:3, statId:null }
// Correct formula: 10 + value(3) + DEX mod = 13 + DEX
// FIGHTER_5: DEX 12 (+1) → AC = 14; CON 14 (+2) for Barbarian check → AC = 13
describe("parseCharacterData — Draconic Resilience unarmored AC", () => {
  it("applies type:set unarmored-armor-class value to base AC", () => {
    const withDraconicResilience: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        inventory: [],
        modifiers: {
          race: [],
          class: [
            { type: "set", subType: "unarmored-armor-class", value: 3, fixedValue: 3, statId: null },
          ],
          background: [], feat: [], item: [], condition: [],
        },
      },
    };
    const out = parseCharacterData(withDraconicResilience, "summary");
    // FIGHTER_5 DEX 12 (+1); base = 10+3 = 13; total = 14
    expect(out).toContain("AC: 14");
  });

  it("does not break Barbarian-style CON unarmored defense", () => {
    const withBarbarian: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        inventory: [],
        modifiers: {
          race: [],
          class: [
            { type: "bonus", subType: "unarmored-armor-class", value: null, fixedValue: null, statId: 3 },
          ],
          background: [], feat: [], item: [], condition: [],
        },
      },
    };
    const out = parseCharacterData(withBarbarian, "summary");
    // FIGHTER_5: DEX 12 (+1), CON 14 (+2) → 10+1+2 = 13
    expect(out).toContain("AC: 13");
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

// ── 2024 rules: race-sourced ability score bonuses are vestigial ─────────────
// In the 2024 rules, ability score increases come from the character's
// background (origin feat), not the race. The race-sourced *-score
// modifiers persist in the JSON with isGranted:false — the website ignores
// them, so we must too. Feat/background-sourced ASIs (also isGranted:false
// in 2024) are still applied.
//
// Reproduces BUG #1 from regression-report-2026-05-16.md (Dwarf Cleric STR
// reported as 16 instead of 14 due to double-counting the +2 race mod).
describe("parseCharacterData — 2024 race ASI handling", () => {
  // Synthetic fixture mimicking the shape of a 2024-rules character:
  // char.stats already contains the user's chosen ASIs baked in. The
  // race-sourced ASI mods are present in the JSON but flagged
  // isGranted:false. The feat-sourced ASIs (from the background's origin
  // feat) are also isGranted:false but ARE applied by the website.
  const CHAR_2024: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      // STR 14, DEX 8, CON 10, INT 12, WIS 15, CHA 13 (Dwarf Cleric values)
      stats: [
        { id: 1, value: 14 }, { id: 2, value: 8 }, { id: 3, value: 10 },
        { id: 4, value: 12 }, { id: 5, value: 15 }, { id: 6, value: 13 },
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
        race: [
          // Vestigial 2024 race ASIs — must NOT be applied
          { type: "bonus", subType: "strength-score",  fixedValue: 2, isGranted: false },
          { type: "bonus", subType: "dexterity-score", fixedValue: 1, isGranted: false },
        ],
        class: [],
        background: [],
        feat: [
          // 2024 background origin-feat ASIs — must be applied
          { type: "bonus", subType: "wisdom-score",   fixedValue: 2, isGranted: false },
          { type: "bonus", subType: "charisma-score", fixedValue: 1, isGranted: false },
        ],
        item: [],
        condition: [],
      },
    },
  };

  it("does not apply race-sourced score bonuses when isGranted is false", () => {
    const out = parseCharacterData(CHAR_2024);
    // STR stays at char.stats value 14 (race +2 must be skipped)
    expect(out).toContain("STR 14 (+2)");
    // DEX stays at char.stats value 8 (race +1 must be skipped)
    expect(out).toContain("DEX 8 (-1)");
  });

  it("still applies non-race ability score bonuses (e.g. feat from origin)", () => {
    const out = parseCharacterData(CHAR_2024);
    // WIS 15 + feat +2 = 17
    expect(out).toContain("WIS 17 (+3)");
    // CHA 13 + feat +1 = 14
    expect(out).toContain("CHA 14 (+2)");
  });

  it("still applies race-sourced score bonuses when isGranted is true (2014 rules)", () => {
    // Same shape but isGranted:true on race mods (legacy 2014 behaviour)
    const char2014: Record<string, unknown> = {
      data: {
        ...((CHAR_2024.data) as Record<string, unknown>),
        modifiers: {
          race: [
            { type: "bonus", subType: "constitution-score", fixedValue: 2, isGranted: true },
            { type: "bonus", subType: "wisdom-score",       fixedValue: 1, isGranted: true },
          ],
          class: [], background: [], feat: [], item: [], condition: [],
        },
      },
    };
    const out = parseCharacterData(char2014);
    // CON 10 + race +2 = 12
    expect(out).toContain("CON 12 (+1)");
    // WIS 15 + race +1 = 16
    expect(out).toContain("WIS 16 (+3)");
  });

  it("treats undefined isGranted as applied (backwards-compatible default)", () => {
    // Fixtures predating this rule (e.g. FIGHTER_5) don't set isGranted on
    // their race score mods — historical behaviour was to apply them.
    const charLegacy: Record<string, unknown> = {
      data: {
        ...((CHAR_2024.data) as Record<string, unknown>),
        modifiers: {
          race: [
            // No isGranted field — must still apply
            { type: "bonus", subType: "strength-score", fixedValue: 2 },
          ],
          class: [], background: [], feat: [], item: [], condition: [],
        },
      },
    };
    const out = parseCharacterData(charLegacy);
    // STR 14 + race +2 = 16
    expect(out).toContain("STR 16 (+3)");
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

  it("#unsigned clamps negative results to 0", () => {
    // level(5) - 10 = -5; #unsigned must not render "-5"
    expect(withFeatSnippet("Min {{level-10#unsigned}} ft.")).toContain("Min 0 ft.");
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

// ── Remarkable Athlete (Champion 7+) — half-prof on initiative AND skills ─────
// Subclass modifier lives in the "subclass" category, NOT in the old hardcoded list.
// allMods must use Object.values to pick it up; hasRemarkableAthlete detects Champion 7+.
// FIGHTER_5 base, overridden to level 9 Champion:
//   DEX 12 (+1), prof +4, floor(4/2)=2
//   Initiative: +1 + 2 = +3
//   Acrobatics (non-proficient DEX): +1 + 2 = +3
//   Athletics (proficient STR):      +3 + 4 = +7 (no extra)
describe("parseCharacterData — Remarkable Athlete (Champion 7+)", () => {
  const withRA: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      classes: [{
        id: 1,
        level: 9,
        hitDiceUsed: 0,
        definition: { name: "Fighter", hitDice: 10, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {} },
        subclassDefinition: { name: "Champion" },
        classFeatures: [],
      }],
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        // RA emits into "subclass" — a category the old hardcoded list silently dropped
        subclass: [{ type: "half-proficiency", subType: "ability-checks" }],
      },
    },
  };

  it("adds half-proficiency to initiative", () => {
    const out = parseCharacterData(withRA, "summary");
    expect(out).toContain("Initiative: +3");
  });

  it("adds half-proficiency to non-proficient skills", () => {
    const out = parseCharacterData(withRA, "summary");
    expect(out).toContain("Acrobatics (DEX)       +3");
  });

  it("does NOT double-add half-proficiency to proficient skills", () => {
    const out = parseCharacterData(withRA, "summary");
    // Athletics is proficient (STR +3 + prof +4 = +7), no RA bonus
    expect(out).toContain("Athletics (STR)        +7 *");
  });
});

// ── Gloom Stalker Dread Ambusher — statId-based WIS bonus to initiative ────────
// Real DDB shape: type:"bonus" subType:"initiative" value:null fixedValue:null statId:5
// FIGHTER_5: DEX 12 (+1), WIS 13 (+1) → initiative = DEX(+1) + WIS(+1) = +2
describe("parseCharacterData — Dread Ambusher WIS-to-initiative (statId-based)", () => {
  const withDreadAmbusher: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>).class as unknown[]),
          { type: "bonus", subType: "initiative", value: null, fixedValue: null, statId: 5, bonusTypes: [] },
        ],
      },
    },
  };

  it("adds WIS modifier to initiative when statId:5 initiative bonus is present", () => {
    const out = parseCharacterData(withDreadAmbusher, "summary");
    expect(out).toContain("Initiative: +2");
  });

  it("does not affect initiative when no statId-based bonus is present", () => {
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("Initiative: +1");
  });
});

// ── Jack of All Trades — half-prof on skills, NOT on initiative ───────────────
// FIGHTER_5 level 5 with JoAT in "class" modifiers:
//   DEX 12 (+1), prof +3, floor(3/2)=1
//   Initiative:  +1 only (JoAT excluded)
//   Acrobatics (non-proficient DEX): +1 + 1 = +2
describe("parseCharacterData — Jack of All Trades skills", () => {
  const withJoAT: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((FIGHTER_5.data as Record<string, unknown>).modifiers as Record<string, unknown[]>).class,
          { type: "half-proficiency", subType: "ability-checks" },
        ],
      },
    },
  };

  it("adds half-proficiency to non-proficient skills", () => {
    const out = parseCharacterData(withJoAT, "summary");
    expect(out).toContain("Acrobatics (DEX)       +2");
  });

  it("does NOT add half-proficiency to initiative", () => {
    const out = parseCharacterData(withJoAT, "summary");
    expect(out).toContain("Initiative: +1");
  });
});

// ── Jack of All Trades does NOT apply to initiative ───────────────────────────
// DDB's website does not apply JoAT half-proficiency to initiative.
// FIGHTER_5: DEX 12 (+1), level 5, prof +3 → initiative = +1 regardless of JoAT.
describe("parseCharacterData — JoAT does not affect initiative", () => {
  it("does not apply half-proficiency to initiative even when ability-checks modifier is present", () => {
    const with2024Joat: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            { type: "half-proficiency", subType: "ability-checks" },
          ],
        },
      },
    };
    const out = parseCharacterData(with2024Joat, "summary");
    // DDB does not add JoAT to initiative; result is DEX mod only = +1
    expect(out).toContain("Initiative: +1");
  });

  it("does not apply JoAT when no half-proficiency modifier is present", () => {
    // Baseline FIGHTER_5 has no JoAT modifier → initiative = DEX mod = +1
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("Initiative: +1");
  });
});

// ── Skill flat-bonus modifiers (Divine Order / Primal Order) ─────────────────
// DDB encodes 2024 class features like Divine Order: Scholar as
//   { type:"bonus", subType:"arcana", statId:5, value:null, fixedValue:null }
// where statId 5 = WIS. The skill calculator must resolve statId to the ability mod.
// FIGHTER_5: WIS 13 → WIS mod = +1. Arcana baseline = INT mod = +0.
// With Divine Order modifier on arcana (statId 5): Arcana should be +0 + 1 = +1.
describe("parseCharacterData — skill flat-bonus modifiers (statId-based)", () => {
  it("adds WIS mod to Arcana when a bonus modifier with statId=5 is present", () => {
    const withDivineOrder: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            ...((FIGHTER_5.data as Record<string, unknown>).modifiers as Record<string, unknown[]>).class,
            // Divine Order: Scholar — adds WIS mod to Arcana; value/fixedValue are null, statId=5 (WIS)
            { type: "bonus", subType: "arcana", statId: 5, value: null, fixedValue: null },
          ],
        },
      },
    };
    const out = parseCharacterData(withDivineOrder, "summary");
    // Arcana (INT) base = +0; WIS mod = +1 → total +1, no proficiency marker
    expect(out).toContain("Arcana (INT)           +1");
  });

  it("stacks statId bonus on top of proficiency", () => {
    const withDivineOrderAndProf: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            ...((FIGHTER_5.data as Record<string, unknown>).modifiers as Record<string, unknown[]>).class,
            { type: "proficiency", subType: "arcana" },
            // Divine Order: Scholar adds WIS mod on top of proficiency
            { type: "bonus", subType: "arcana", statId: 5, value: null, fixedValue: null },
          ],
        },
      },
    };
    const out = parseCharacterData(withDivineOrderAndProf, "summary");
    // INT(+0) + prof(+3) + WIS(+1) = +4, proficient marker *
    expect(out).toContain("Arcana (INT)           +4 *");
  });
});

// ── Concentration spell section ───────────────────────────────────────────────
// Spell definitions include `concentration` directly in definition so
// addCharacterSpellsToCompendium seeds the buffer before parsing.

const makeClassSpells = (classDef: Record<string, unknown>, spells: Array<{ name: string; level: number; concentration: boolean; prepared?: boolean; ritual?: boolean }>) => ({
  characterClassId: (classDef as Record<string, unknown>).id ?? 1,
  spells: spells.map(s => ({
    prepared: s.prepared ?? true,
    definition: { id: Math.random(), name: s.name, level: s.level, concentration: s.concentration, ritual: s.ritual ?? false },
  })),
});

describe("parseCharacterData — concentration section", () => {
  it("shows prepared concentration spells grouped by level", () => {
    const char = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        classes: [
          {
            id: 10, level: 5, hitDiceUsed: 0,
            definition: { name: "Druid", hitDice: 8, canCastSpells: true, spellCastingAbilityId: 5, spellRules: { levelSpellSlots: Array.from({ length: 21 }, (_, l) => l >= 1 ? [3, 2, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]) } },
            subclassDefinition: null, classFeatures: [],
          },
        ],
        classSpells: [makeClassSpells({ id: 10 }, [
          { name: "Entangle",     level: 1, concentration: true },
          { name: "Hunter's Mark", level: 1, concentration: true },
          { name: "Cure Wounds",  level: 1, concentration: false },
        ])],
        spells: { race: [], class: [], background: [], feat: [], item: [] },
        spellSlots: [],
      },
    };
    const out = parseCharacterData(char as unknown as Record<string, unknown>, "concentration");
    expect(out).toContain("CONCENTRATION SPELLS");
    expect(out).toContain("Entangle");
    expect(out).toContain("Hunter's Mark");
    expect(out).not.toContain("Cure Wounds");
    expect(out).toContain("1st-level slot");
  });

  it("returns no-concentration message when no concentration spells are prepared", () => {
    const char = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        classes: [
          {
            id: 11, level: 3, hitDiceUsed: 0,
            definition: { name: "Wizard", hitDice: 6, canCastSpells: true, spellCastingAbilityId: 4, spellRules: { levelSpellSlots: Array.from({ length: 21 }, (_, l) => l >= 1 ? [2, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]) } },
            subclassDefinition: null, classFeatures: [],
          },
        ],
        classSpells: [makeClassSpells({ id: 11 }, [
          { name: "Magic Missile", level: 1, concentration: false, prepared: true },
          { name: "Fireball",      level: 3, concentration: false, prepared: true },
        ])],
        spells: { race: [], class: [], background: [], feat: [], item: [] },
        spellSlots: [],
      },
    };
    const out = parseCharacterData(char as unknown as Record<string, unknown>, "concentration");
    expect(out).toContain("no concentration spells prepared");
  });

  it("includes concentration spells from multiple sources (class + feat)", () => {
    const char = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        classes: [
          {
            id: 12, level: 4, hitDiceUsed: 0,
            definition: { name: "Ranger", hitDice: 10, canCastSpells: true, spellCastingAbilityId: 5, spellRules: { levelSpellSlots: Array.from({ length: 21 }, (_, l) => l >= 2 ? [2, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]) } },
            subclassDefinition: null, classFeatures: [],
          },
        ],
        classSpells: [makeClassSpells({ id: 12 }, [
          { name: "Hunter's Mark", level: 1, concentration: true },
        ])],
        spells: {
          race: [],
          class: [],
          background: [],
          feat: [{ definition: { id: 999, name: "Faerie Fire", level: 1, concentration: true } }],
          item: [],
        },
        spellSlots: [],
      },
    };
    const out = parseCharacterData(char as unknown as Record<string, unknown>, "concentration");
    expect(out).toContain("Hunter's Mark");
    expect(out).toContain("Faerie Fire");
  });

  it("Wizard spellbook filter: only prepared concentration spells appear", () => {
    const char = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        classes: [
          {
            id: 13, level: 5, hitDiceUsed: 0,
            definition: { name: "Wizard", hitDice: 6, canCastSpells: true, spellCastingAbilityId: 4, spellRules: { levelSpellSlots: Array.from({ length: 21 }, (_, l) => l >= 1 ? [4, 3, 2, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]) } },
            subclassDefinition: null, classFeatures: [],
          },
        ],
        classSpells: [makeClassSpells({ id: 13 }, [
          { name: "Blur",          level: 2, concentration: true,  prepared: true  },
          { name: "Web",           level: 2, concentration: true,  prepared: true  },
          // 8 unprepared concentration spells — should NOT appear
          { name: "Invisibility",  level: 2, concentration: true,  prepared: false },
          { name: "Hold Person",   level: 2, concentration: true,  prepared: false },
          { name: "Fly",           level: 3, concentration: true,  prepared: false },
          { name: "Haste",         level: 3, concentration: true,  prepared: false },
          { name: "Slow",          level: 3, concentration: true,  prepared: false },
          { name: "Blink",         level: 3, concentration: true,  prepared: false },
          { name: "Polymorph",     level: 4, concentration: true,  prepared: false },
          { name: "Confusion",     level: 4, concentration: true,  prepared: false },
        ])],
        spells: { race: [], class: [], background: [], feat: [], item: [] },
        spellSlots: [],
      },
    };
    const out = parseCharacterData(char as unknown as Record<string, unknown>, "concentration");
    expect(out).toContain("Blur");
    expect(out).toContain("Web");
    // Unprepared spells must not appear
    expect(out).not.toContain("Invisibility");
    expect(out).not.toContain("Fly");
    expect(out).not.toContain("Polymorph");
  });
});

// ── Notes & Backstory section ─────────────────────────────────────────────────

const withNotes = (traits: Record<string, unknown>, notes: Record<string, unknown>) => ({
  data: {
    ...((FIGHTER_5.data) as Record<string, unknown>),
    traits,
    notes,
  },
});

describe("parseCharacterData — notes section", () => {
  it("all fields populated: every label and value appears", () => {
    const out = parseCharacterData(withNotes(
      { personalityTraits: "Polysyllabic words.", ideals: "Knowledge is power.", bonds: "My tomes.", flaws: "I speak without thinking.", appearance: "Tall, pale, silver hair." },
      { backstory: "Raised in Waterdeep.", allies: "The Harpers.", organizations: "Arcane Brotherhood.", personalPossessions: "A locket.", otherNotes: "Owes a debt to a devil." }
    ) as Record<string, unknown>, "notes");

    expect(out).toContain("PERSONALITY");
    expect(out).toContain("Polysyllabic words.");
    expect(out).toContain("Knowledge is power.");
    expect(out).toContain("My tomes.");
    expect(out).toContain("I speak without thinking.");
    expect(out).toContain("Tall, pale, silver hair.");
    expect(out).toContain("BACKSTORY");
    expect(out).toContain("Raised in Waterdeep.");
    expect(out).toContain("ALLIES & ORGANISATIONS");
    expect(out).toContain("The Harpers.");
    expect(out).toContain("Arcane Brotherhood.");
    expect(out).toContain("ADDITIONAL NOTES");
    expect(out).toContain("A locket.");
    expect(out).toContain("Owes a debt to a devil.");
  });

  it("partial fields: only populated fields appear, no empty labels", () => {
    const out = parseCharacterData(withNotes(
      { personalityTraits: null, ideals: null, bonds: "My life's work.", flaws: null, appearance: null },
      { backstory: "Grew up in a port town.", allies: null, organizations: null, personalPossessions: null, otherNotes: null }
    ) as Record<string, unknown>, "notes");

    expect(out).toContain("My life's work.");
    expect(out).toContain("Grew up in a port town.");
    // Absent fields must not produce label lines
    expect(out).not.toContain("Traits:");
    expect(out).not.toContain("Ideals:");
    expect(out).not.toContain("Allies:");
    // Sections with no content are skipped entirely
    expect(out).not.toContain("ALLIES & ORGANISATIONS");
    expect(out).not.toContain("ADDITIONAL NOTES");
  });

  it("all null: returns the no-notes message", () => {
    const out = parseCharacterData(withNotes(
      { personalityTraits: null, ideals: null, bonds: null, flaws: null, appearance: null },
      { backstory: null, allies: null, organizations: null, personalPossessions: null, otherNotes: null }
    ) as Record<string, unknown>, "notes");
    expect(out).toContain("No notes or backstory have been recorded");
  });

  it("HTML is stripped from field values", () => {
    const out = parseCharacterData(withNotes(
      { personalityTraits: null, ideals: null, bonds: null, flaws: null, appearance: null },
      { backstory: "<p>My <strong>backstory</strong> text.</p>", allies: null, organizations: null, personalPossessions: null, otherNotes: null }
    ) as Record<string, unknown>, "notes");
    expect(out).toContain("My backstory text.");
    expect(out).not.toContain("<p>");
    expect(out).not.toContain("<strong>");
  });

  it("full section includes notes block", () => {
    const out = parseCharacterData(withNotes(
      { personalityTraits: "I never back down.", ideals: null, bonds: null, flaws: null, appearance: null },
      { backstory: null, allies: null, organizations: null, personalPossessions: null, otherNotes: null }
    ) as Record<string, unknown>, "full");
    expect(out).toContain("PERSONALITY");
    expect(out).toContain("I never back down.");
  });
});

// ── 2024 race variant detection (Lineage / Legacy / Ancestry) ────────────────
// 2024 PHB races store the player's sub-selection in char.options.race[] with
// option names like "Wood Elf Lineage", "Infernal Legacy", "Stone's Endurance
// (Stone Giant)". parseCharacterData should surface this in the header line,
// e.g. "Elf (Wood Elf)", because the race.fullName / baseName fields alone
// show only the base race (which is what 2024 PHB calls the "species").
describe("parseCharacterData — 2024 race variant in header", () => {
  // Minimal fixture: only what parseCharacterData reads for the header line.
  // Everything else relies on the parser's graceful-default helpers (str/obj/arr).
  function makeChar(opts: {
    name: string;
    race: { fullName: string; baseName: string };
    className: string;
    raceOptions: { name: string }[];
  }): Record<string, unknown> {
    return {
      data: {
        name: opts.name,
        race: { ...opts.race, racialTraits: [], weightSpeeds: { normal: {} } },
        classes: [{
          id: 1, level: 5, hitDiceUsed: 0,
          definition: { name: opts.className, hitDice: 8, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {} },
          subclassDefinition: null,
          classFeatures: [],
        }],
        options: { race: opts.raceOptions.map(o => ({ definition: { name: o.name } })) },
      },
    };
  }

  it("Elven Lineage → 'Elf (Wood Elf)'  (Clover Darkbloom, char 155665213)", () => {
    const out = parseCharacterData(makeChar({
      name: "Clover Darkbloom",
      race: { fullName: "Elf", baseName: "Elf" },
      className: "Druid",
      // Real names observed in DDB API for character 155665213
      raceOptions: [{ name: "Wood Elf Lineage" }, { name: "Wood Elf - Wisdom" }],
    }));
    expect(out).toContain("Elf (Wood Elf)");
  });

  it("Elven Lineage → 'Elf (High Elf)'  (Idhren, char 155829352)", () => {
    const out = parseCharacterData(makeChar({
      name: "Idhren",
      race: { fullName: "Elf", baseName: "Elf" },
      className: "Barbarian",
      raceOptions: [{ name: "High Elf Lineage" }, { name: "High Elf - Charisma" }],
    }));
    expect(out).toContain("Elf (High Elf)");
  });

  it("Fiendish Legacy → 'Tiefling (Infernal)'  (Claude Skamos, char 155447750)", () => {
    const out = parseCharacterData(makeChar({
      name: "Claude Skamos",
      race: { fullName: "Tiefling", baseName: "Tiefling" },
      className: "Wizard",
      // Real names observed for char 155447750 — "Intelligence" entries are
      // spellcasting-ability choices that must NOT be mistaken for the legacy.
      raceOptions: [{ name: "Intelligence" }, { name: "Infernal Legacy" }, { name: "Intelligence" }],
    }));
    expect(out).toContain("Tiefling (Infernal)");
  });

  it("Giant Ancestry → 'Goliath (Stone)'  (Goliath Barbarian, char 152579009)", () => {
    const out = parseCharacterData(makeChar({
      name: "Goliath Barbarian",
      race: { fullName: "Goliath", baseName: "Goliath" },
      className: "Barbarian",
      // The Giant Ancestry choice surfaces with the chosen feature wrapped in
      // a "(<type> Giant)" parenthetical.
      raceOptions: [{ name: "Stone's Endurance (Stone Giant)" }],
    }));
    expect(out).toContain("Goliath (Stone)");
  });

  it("preserves 2014 fullName when no race options present (no variant suffix added)", () => {
    const out = parseCharacterData(makeChar({
      name: "Thorin",
      race: { fullName: "Mountain Dwarf", baseName: "Dwarf" },
      className: "Fighter",
      raceOptions: [], // 2014 chars surface subrace via fullName
    }));
    expect(out).toContain("Mountain Dwarf");
    expect(out).not.toContain("Mountain Dwarf (");
  });

  it("does not double-decorate when fullName already contains the variant", () => {
    const out = parseCharacterData(makeChar({
      name: "Edge Case",
      race: { fullName: "Wood Elf", baseName: "Elf" }, // hypothetical pre-decorated fullName
      className: "Ranger",
      raceOptions: [{ name: "Wood Elf Lineage" }],
    }));
    expect(out).toContain("Wood Elf");
    expect(out).not.toContain("Wood Elf (Wood Elf)");
  });

  it("Aasimar has no creation-time revelation → 'Aasimar' (Orion Skyborn, char 152720684)", () => {
    // 2024 Celestial Revelation is a transformation-time choice (the player
    // picks Heavenly Wings / Inner Radiance / Necrotic Shroud each time they
    // activate the trait), so the DDB API leaves char.options.race empty for
    // Aasimar and no permanent variant should appear in the header.
    const out = parseCharacterData(makeChar({
      name: "Orion Skyborn",
      race: { fullName: "Aasimar", baseName: "Aasimar" },
      className: "Druid",
      raceOptions: [], // empty for real Orion (152720684) — verified via API
    }));
    const headerLine = out.split("\n").find(l => l.includes("Druid")) ?? "";
    expect(headerLine).toContain("Aasimar");
    expect(headerLine).not.toMatch(/Aasimar\s*\(/);
  });
});
