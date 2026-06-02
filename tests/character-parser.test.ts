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

  // BUG #6 (darkvision portion): Gloom Stalker's Umbral Sight should add 30
  // ft to the character's existing darkvision (or grant 30 ft if there is
  // none). DDB encodes it as both a `set-base 30` AND a `sense 30` modifier
  // emitted from the same subclass-feature component. When a character has
  // race-granted darkvision, the website ignores the class set-base (which
  // is lower than the race base) AND adds the sense as an extension —
  // confirmed against Aerin Forrestlimb (68903271) Wood Elf Gloom Stalker 5,
  // website shows 90 ft.
  //
  // Discriminator for additive behaviour: the sense mod's componentId
  // differs from the component owning the highest set-base. When both come
  // from the same component (lone Umbral Sight on a character with no race
  // darkvision), the dual emission is just two encodings of the same value —
  // don't double-count.
  it("Umbral Sight extends race darkvision by 30 (Aerin shape)", () => {
    const aerinShape: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        race: {
          fullName: "Wood Elf",
          baseName: "Elf",
          weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } },
          racialTraits: [],
        },
        customSenses: [],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [{ type: "set-base", subType: "darkvision", fixedValue: 60, value: 60, componentId: 11 }],
          class: [
            { type: "set-base", subType: "darkvision", fixedValue: 30, value: 30, componentId: 718 },
            { type: "sense",    subType: "darkvision", fixedValue: 30, value: 30, componentId: 718 },
          ],
        },
      },
    };
    const out = parseCharacterData(aerinShape, "summary");
    expect(out).toContain("Darkvision 90 ft.");
    expect(out).not.toContain("Darkvision 60 ft.");
  });

  it("lone Umbral Sight without race darkvision grants exactly 30 ft (no double-count)", () => {
    // The set-base 30 and sense 30 from the SAME component are two encodings
    // of the same effective value — must not stack to 60.
    const humanGloomStalker: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        race: {
          fullName: "Human",
          baseName: "Human",
          weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } },
          racialTraits: [],
        },
        customSenses: [],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [],
          class: [
            { type: "set-base", subType: "darkvision", fixedValue: 30, value: 30, componentId: 718 },
            { type: "sense",    subType: "darkvision", fixedValue: 30, value: 30, componentId: 718 },
          ],
        },
      },
    };
    const out = parseCharacterData(humanGloomStalker, "summary");
    expect(out).toContain("Darkvision 30 ft.");
    expect(out).not.toContain("Darkvision 60 ft.");
  });

  it("regression: 2024-style race darkvision via type:sense alone (no set-base)", () => {
    const dwarf2024: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        race: {
          fullName: "Dwarf",
          baseName: "Dwarf",
          weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } },
          racialTraits: [],
        },
        customSenses: [],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [{ type: "sense", subType: "darkvision", fixedValue: 120, value: 120, componentId: 13856097, isGranted: true }],
        },
      },
    };
    const out = parseCharacterData(dwarf2024, "summary");
    expect(out).toContain("Darkvision 120 ft.");
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

// ── Languages granted via characterValues typeId:35 ───────────────────────────
// DDB stores some language grants outside the modifier system in
// `char.characterValues` entries with `typeId: 35`. `valueId` is a
// stringified integer pointing into the rule-data language table
// (id:1=Common, 2=Dwarvish, 3=Elvish, 4=Giant, 5=Gnomish, 6=Goblin,
// 7=Halfling, 8=Orc, 9=Abyssal, 10=Celestial, 11=Draconic, 12=Deep Speech,
// 13=Infernal, 14=Primordial, 15=Sylvan, 16=Undercommon, ...).
// Confirmed via Playwright network trace of the React app — none of these
// languages appear in modifiers or customProficiencies for the affected
// characters; the React app resolves them client-side using rule-data.
//
// Closes the rest of BUG #7 (Halfling Rogue / Elf Fighter Wood / Human
// Paladin).
describe("parseCharacterData — languages from characterValues typeId:35", () => {
  it("resolves typeId:35 entries to language names via the rule-data ID table", () => {
    const withCv: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [
          // Halfling Rogue LF shape — Goblin (valueId "6")
          { typeId: 35, value: 3, valueId: "6", valueTypeId: "906033267", notes: null, contextId: null, contextTypeId: null },
        ],
      },
    };
    const out = parseCharacterData(withCv, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Goblin");
  });

  it("handles multiple language grants in one character (Elf Fighter Wood shape)", () => {
    const withCv: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [
          { typeId: 35, value: 3, valueId: "2", valueTypeId: "906033267" },  // Dwarvish
          { typeId: 35, value: 3, valueId: "7", valueTypeId: "906033267" },  // Halfling
        ],
      },
    };
    const out = parseCharacterData(withCv, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Dwarvish");
    expect(langLine).toContain("Halfling");
  });

  it("ignores characterValues with other typeIds (e.g. AC override typeId:1)", () => {
    const withCv: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [
          { typeId: 1, value: 17 },                              // AC override
          { typeId: 35, value: 3, valueId: "4" },                // Giant (the actual language)
          { typeId: 8, value: "Custom Sword", valueId: "12345" }, // item-scoped (BUG#6 shape)
        ],
      },
    };
    const out = parseCharacterData(withCv, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Giant");
    expect(langLine).not.toContain("17");
    expect(langLine).not.toContain("Custom Sword");
  });

  it("falls back to placeholder for unknown language IDs", () => {
    // valueId 999 isn't in the hardcoded standard-language table — should
    // still appear so users can see something is granted, just with a
    // clearly-marked unresolved name.
    const withCv: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [
          { typeId: 35, value: 3, valueId: "999" },
        ],
      },
    };
    const out = parseCharacterData(withCv, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Language #999");
  });

  it("ignores typeId:35 entries with value <= 0 (not granted)", () => {
    const withCv: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [
          { typeId: 35, value: 0, valueId: "6" },  // Goblin but not granted
        ],
      },
    };
    const out = parseCharacterData(withCv, "summary");
    // FIGHTER_5 has no language mods + no granted typeId 35 → still "None"
    expect(out).toContain("Languages: None");
  });
});

// ── Languages from char.customProficiencies (type:3) ─────────────────────────
// Player-added languages live in `char.customProficiencies` with `type: 3`.
// (type 1 = skill, type 2 = tool, type 3 = language.) Confirmed against
// Astarion (107164636) whose "Orc" language lives here, not in
// char.modifiers.* as a `type:"language"` entry. The proficiency
// collector previously only walked allMods, so customProficiencies were
// silently dropped.
//
// Addresses the Astarion case in BUG #7. Note: the other 3 characters
// listed in that bug (Halfling Rogue LF / Elf Fighter Wood / Human Paladin)
// have NO data in their JSON for the reported missing languages — neither
// in customProficiencies nor in char.choices nor in char.modifiers. Likely
// the regression report confused "languages the website CAN grant for this
// background" with "languages actually selected on the character".
describe("parseCharacterData — languages from customProficiencies", () => {
  it("adds customProficiencies type:3 entries to the Languages line", () => {
    const withCustomLang: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        customProficiencies: [
          { id: 1, name: "Orc", type: 3, proficiencyLevel: 3 },
          { id: 2, name: "Sylvan", type: 3, proficiencyLevel: 3 },
        ],
      },
    };
    const out = parseCharacterData(withCustomLang, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Orc");
    expect(langLine).toContain("Sylvan");
  });

  it("does NOT add customProficiencies type:1 (skill) or type:2 (tool) to languages", () => {
    const withMixedProfs: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        customProficiencies: [
          { id: 1, name: "Underwater Basket Weaving", type: 1, proficiencyLevel: 3 },
          { id: 2, name: "Theremin", type: 2, proficiencyLevel: 3 },
          { id: 3, name: "Goblin", type: 3, proficiencyLevel: 3 },
        ],
      },
    };
    const out = parseCharacterData(withMixedProfs, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Goblin");
    expect(langLine).not.toContain("Underwater Basket Weaving");
    expect(langLine).not.toContain("Theremin");
  });

  it("stacks customProficiencies languages alongside type:'language' modifier languages", () => {
    const withBoth: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        customProficiencies: [
          { id: 1, name: "Orc", type: 3, proficiencyLevel: 3 },
        ],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [
            { type: "language", subType: "common" },
            { type: "language", subType: "elvish" },
          ],
        },
      },
    };
    const out = parseCharacterData(withBoth, "summary");
    const langLine = out.split("\n").find(l => /Languages:/.test(l)) ?? "";
    expect(langLine).toContain("Common");
    expect(langLine).toContain("Elvish");
    expect(langLine).toContain("Orc");
  });

  it("regression: no customProficiencies still produces the existing output", () => {
    const out = parseCharacterData(FIGHTER_5, "summary");
    // FIGHTER_5 has no language modifiers → "Languages: None"
    expect(out).toContain("Languages: None");
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

// ── Monk Unarmored Movement gate ─────────────────────────────────────────────
// Per PHB: "Your speed increases by 10 feet while you are not wearing armor or
// wielding a shield." The `unarmored-movement` bonus was previously applied
// unconditionally, inflating monk walking speed when they had armor equipped
// (rare but possible — e.g. a multiclass Monk/Fighter who toggles armor on
// in the website builder).
describe("parseCharacterData — Monk Unarmored Movement gate", () => {
  // FIGHTER_5 walk = 25. With Monk L2 unarmored movement +10, gated bonus.
  const baseMonk = (extraInventory: Array<Record<string, unknown>>): Record<string, unknown> => ({
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      inventory: extraInventory,
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>).class as unknown[]),
          { type: "bonus", subType: "unarmored-movement", fixedValue: 10, value: 10 },
        ],
      },
    },
  });

  it("applies unarmored-movement bonus when no armor or shield equipped", () => {
    const out = parseCharacterData(baseMonk([]), "summary");
    // 25 + 10 = 35
    expect(out).toContain("Speed: 35 ft.");
  });

  it("does NOT apply unarmored-movement when body armor is equipped", () => {
    const out = parseCharacterData(baseMonk([
      { equipped: true, definition: { name: "Chain Mail", filterType: "Armor", armorTypeId: 3, armorClass: 16 } },
    ]), "summary");
    // 25 alone — bonus must NOT apply
    expect(out).toContain("Speed: 25 ft.");
  });

  it("does NOT apply unarmored-movement when a shield is equipped", () => {
    const out = parseCharacterData(baseMonk([
      { equipped: true, definition: { name: "Shield", filterType: "Armor", armorTypeId: 4, armorClass: 2 } },
    ]), "summary");
    expect(out).toContain("Speed: 25 ft.");
  });

  it("applies unarmored-movement when armor is in inventory but UNEQUIPPED", () => {
    const out = parseCharacterData(baseMonk([
      { equipped: false, definition: { name: "Chain Mail", filterType: "Armor", armorTypeId: 3, armorClass: 16 } },
    ]), "summary");
    // Bonus applies — only equipped armor blocks it
    expect(out).toContain("Speed: 35 ft.");
  });

  it("applies unarmored-movement when equipped item is not armor (e.g. Backpack)", () => {
    const out = parseCharacterData(baseMonk([
      { equipped: true, definition: { name: "Backpack", filterType: "Other Gear" } },
    ]), "summary");
    expect(out).toContain("Speed: 35 ft.");
  });
});

// ── Defense fighting style armor gate (armored-armor-class) ──────────────────
// Per PHB: "While you are wearing armor, you gain a +1 bonus to AC."
// DDB emits the bonus as { type:"bonus", subType:"armored-armor-class", value:1 }
// regardless of whether armor is equipped. The bonus must only apply when
// body armor is actually equipped — a shield alone doesn't count, and an
// unarmored character (or one wearing only a shield) shouldn't get +1.
//
// Generic AC bonuses (subType:"armor-class") from Shield of Faith, Ring of
// Protection, Cloak of Protection, etc. apply unconditionally and must
// still work.
describe("parseCharacterData — Defense fighting style armor gate", () => {
  const withMods = (modList: Array<Record<string, unknown>>, inventory: Array<Record<string, unknown>> = []): Record<string, unknown> => ({
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      inventory,
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>).class as unknown[]),
          ...modList,
        ],
      },
    },
  });

  it("applies armored-armor-class bonus when body armor is equipped", () => {
    const out = parseCharacterData(withMods(
      [{ type: "bonus", subType: "armored-armor-class", fixedValue: 1, value: 1 }],
      [{ equipped: true, definition: { name: "Chain Mail", filterType: "Armor", armorTypeId: 3, armorClass: 16 } }],
    ), "summary");
    // Heavy armor (16) ignores DEX → 16 + 1 (Defense) = 17
    expect(out).toContain("AC: 17");
  });

  it("does NOT apply armored-armor-class bonus when no armor is equipped", () => {
    const out = parseCharacterData(withMods(
      [{ type: "bonus", subType: "armored-armor-class", fixedValue: 1, value: 1 }],
      [],
    ), "summary");
    // 10 + DEX(+1) = 11; Defense must NOT add
    expect(out).toContain("AC: 11");
  });

  it("does NOT apply armored-armor-class bonus with only a shield equipped", () => {
    const out = parseCharacterData(withMods(
      [{ type: "bonus", subType: "armored-armor-class", fixedValue: 1, value: 1 }],
      [{ equipped: true, definition: { name: "Shield", filterType: "Armor", armorTypeId: 4, armorClass: 2 } }],
    ), "summary");
    // 10 + DEX(+1) + shield(2) = 13; Defense does NOT apply (no body armor)
    expect(out).toContain("AC: 13");
  });

  it("regression: generic armor-class bonus (Ring of Protection) applies unarmored", () => {
    const out = parseCharacterData(withMods(
      [{ type: "bonus", subType: "armor-class", fixedValue: 1, value: 1 }],
      [],
    ), "summary");
    // 10 + DEX(+1) + 1 = 12; Ring of Protection style applies regardless of armor
    expect(out).toContain("AC: 12");
  });

  it("regression: generic armor-class bonus stacks with armored-armor-class when armored", () => {
    const out = parseCharacterData(withMods(
      [
        { type: "bonus", subType: "armor-class", fixedValue: 1, value: 1 },           // Ring of Protection
        { type: "bonus", subType: "armored-armor-class", fixedValue: 1, value: 1 },   // Defense fighting style
      ],
      [{ equipped: true, definition: { name: "Chain Mail", filterType: "Armor", armorTypeId: 3, armorClass: 16 } }],
    ), "summary");
    // 16 + 1 (Ring) + 1 (Defense) = 18
    expect(out).toContain("AC: 18");
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

// ── AC override via char.characterValues typeId:1 ───────────────────────────
// DDB stores manual AC overrides in char.characterValues with typeId:1
// (confirmed against Aerin Forrestlimb 68903271, who has equipped Leather
// + DEX +2 = calc 13 but the website shows AC 17 from the override field).
// The override is character-wide (contextId / contextTypeId both null) and
// replaces the entire AC calculation — not added as a bonus.
describe("parseCharacterData — AC override via characterValues", () => {
  it("uses characterValues typeId:1 as AC, replacing the calc", () => {
    const withOverride: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        // FIGHTER_5 would calc to 10 + DEX(1) = 11 unarmored, or 11+1=12 with
        // its default inventory. The override should win regardless.
        characterValues: [
          { typeId: 1, value: 17, notes: null, valueId: null, valueTypeId: null, contextId: null, contextTypeId: null },
        ],
      },
    };
    const out = parseCharacterData(withOverride, "summary");
    expect(out).toContain("AC: 17");
  });

  it("ignores characterValues entries with other typeIds (e.g. item-scoped notes)", () => {
    const withItemValues: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [
          // Item-scoped custom name (typeId 8) — must not affect AC
          { typeId: 8, value: "My Custom Sword", valueId: "12345", valueTypeId: "1439493548" },
          // Item-scoped quantity (typeId 10)
          { typeId: 10, value: 1, valueId: "12345", valueTypeId: "1439493548" },
        ],
      },
    };
    const out = parseCharacterData(withItemValues, "summary");
    // FIGHTER_5 with default inventory: 10 + DEX 1 = 11 (no armor in fixture)
    expect(out).toContain("AC: 11");
  });

  it("regression: AC override of 0 falls back to the calc", () => {
    // Defensive — a literal 0 makes no sense as an AC. Treat like absent.
    const withZeroOverride: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        characterValues: [{ typeId: 1, value: 0 }],
      },
    };
    const out = parseCharacterData(withZeroOverride, "summary");
    expect(out).toContain("AC: 11");
  });

  it("regression: no characterValues array still computes AC normally", () => {
    // FIGHTER_5 baseline: no characterValues at all → AC 11.
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("AC: 11");
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

// ── Ability scores capped at 20 from ASIs / race / feats ──────────────────────
// Per PHB (both 2014 and 2024): "Your ability scores can't go higher than 20
// unless a feature specifically says otherwise." DDB's website applies the
// cap; the parser didn't, producing scores like WIS 21 (+5) where the
// website shows 20 (+5). Same modifier either way, so derived values match,
// but the displayed score was off by 1.
//
// Reproduces BUG #8 from regression-report-2026-05-16.md (Calderax
// Greycastle 14814039 — WIS 18 + 3 separate +1 ASIs from race/Survivalist/
// Ritual Caster = 21, website caps to 20).
//
// `type:"set"` modifiers from items (Belt of Giant Strength etc) and
// `overrideStats` are explicitly designed to exceed 20 — those must
// continue to bypass the cap.
describe("parseCharacterData — ability score 20 cap (PHB)", () => {
  const withWisdomBase = (baseWis: number, bonuses: Array<{ src: string; val: number }>): Record<string, unknown> => ({
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      stats: [
        { id: 1, value: 16 }, { id: 2, value: 12 }, { id: 3, value: 14 },
        { id: 4, value: 10 }, { id: 5, value: baseWis }, { id: 6, value: 8 },
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
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        race: [], background: [], item: [], condition: [],
        feat: bonuses.filter(b => b.src === "feat").map(b => ({ type: "bonus", subType: "wisdom-score", fixedValue: b.val, value: b.val, isGranted: true })),
        class: bonuses.filter(b => b.src === "class").map(b => ({ type: "bonus", subType: "wisdom-score", fixedValue: b.val, value: b.val, isGranted: true })),
      },
    },
  });

  it("caps additive ASI/feat bonuses at 20 (Calderax shape)", () => {
    // base 18 + 1 + 1 + 1 = 21 raw; capped to 20.
    const char = {
      data: {
        ...((withWisdomBase(18, []).data) as Record<string, unknown>),
        modifiers: {
          ...((withWisdomBase(18, []).data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          race: [{ type: "bonus", subType: "wisdom-score", fixedValue: 1, value: 1, isGranted: true }],
          feat: [
            { type: "bonus", subType: "wisdom-score", fixedValue: 1, value: 1, isGranted: true },
            { type: "bonus", subType: "wisdom-score", fixedValue: 1, value: 1, isGranted: true },
          ],
        },
      },
    };
    const out = parseCharacterData(char, "summary");
    expect(out).toContain("WIS 20 (+5)");
    expect(out).not.toContain("WIS 21");
  });

  it("does NOT cap below 20 (scores under cap unchanged)", () => {
    const char = withWisdomBase(13, [{ src: "feat", val: 1 }]);
    const out = parseCharacterData(char, "summary");
    // 13 + 1 = 14
    expect(out).toContain("WIS 14 (+2)");
  });

  it("does NOT cap exactly at 20", () => {
    const char = withWisdomBase(18, [{ src: "feat", val: 2 }]);
    const out = parseCharacterData(char, "summary");
    expect(out).toContain("WIS 20 (+5)");
  });

  it("respects overrideStats above 20 (manual override bypasses cap)", () => {
    const char: Record<string, unknown> = {
      data: {
        ...((withWisdomBase(18, []).data) as Record<string, unknown>),
        overrideStats: [
          { id: 1, value: null }, { id: 2, value: null }, { id: 3, value: null },
          { id: 4, value: null }, { id: 5, value: 24 }, { id: 6, value: null },
        ],
      },
    };
    const out = parseCharacterData(char, "summary");
    expect(out).toContain("WIS 24 (+7)");
  });

  it("respects type:set item modifiers above 20 (Belt of Giant Strength shape)", () => {
    // Belt of Cloud Giant Strength: type:"set" subType:"strength-score" value:27
    const char: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          item: [{ type: "set", subType: "strength-score", fixedValue: 27, value: 27, isGranted: true }],
        },
      },
    };
    const out = parseCharacterData(char, "summary");
    expect(out).toContain("STR 27 (+8)");
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

// ── Remarkable Athlete (Champion 7+) — half-prof on initiative AND STR/DEX/CON skills ─
// DDB does NOT emit a `half-proficiency` modifier for Remarkable Athlete (confirmed
// by inspecting Ethelrede 112314883's raw JSON — zero half-proficiency mods). The
// feature is only present as a class-feature entry with name "Remarkable Athlete"
// and requiredLevel 7. So detection must be by subclass name + level, not by
// modifier presence.
//
// Per the 2014 PHB: Remarkable Athlete adds half your proficiency bonus
// (round up) to STR, DEX, and CON ability checks that don't already include
// your proficiency bonus. Initiative is a DEX check, so it gets the bonus too.
// FIGHTER_5 base, overridden to level 9 Champion:
//   DEX 12 (+1), STR 16 (+3), prof +4, ceil(4/2) = 2
//   Initiative: +1 + 2 = +3
//   Acrobatics (DEX, non-proficient): +1 + 2 = +3
//   Sleight of Hand (DEX, non-proficient): +1 + 2 = +3
//   Stealth (DEX, non-proficient): +1 + 2 = +3
//   Athletics (STR, proficient): +3 + 4 = +7 (no RA — already has prof)
//   Insight (WIS, non-proficient): +1 + 0 = +1 (not STR/DEX/CON, no RA)
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
      // No spurious half-proficiency modifier — real DDB JSON for Champion
      // Fighters does not include one. RA must be detected via subclass.
    },
  };

  it("adds half-proficiency to initiative", () => {
    const out = parseCharacterData(withRA, "summary");
    expect(out).toContain("Initiative: +3");
  });

  it("adds half-proficiency to non-proficient DEX skills", () => {
    const out = parseCharacterData(withRA, "summary");
    expect(out).toContain("Acrobatics (DEX)       +3");
    expect(out).toContain("Sleight of Hand (DEX)  +3");
    expect(out).toContain("Stealth (DEX)          +3");
  });

  it("does NOT double-add half-proficiency to proficient skills", () => {
    const out = parseCharacterData(withRA, "summary");
    // Athletics is proficient (STR +3 + prof +4 = +7), no extra RA bonus
    expect(out).toContain("Athletics (STR)        +7 *");
  });

  it("does NOT apply RA to non-STR/DEX/CON skills", () => {
    const out = parseCharacterData(withRA, "summary");
    // Insight is WIS-based and non-proficient — should be just WIS (+1), no RA
    expect(out).toContain("Insight (WIS)          +1");
    // Arcana is INT-based — should be just INT mod (+0)
    expect(out).toContain("Arcana (INT)           +0");
  });

  it("does NOT apply RA below Champion level 7", () => {
    const champL6: Record<string, unknown> = {
      data: {
        ...((withRA.data) as Record<string, unknown>),
        classes: [{
          ...((withRA.data as Record<string, unknown>).classes as Array<Record<string, unknown>>)[0],
          level: 6,
        }],
      },
    };
    const out = parseCharacterData(champL6, "summary");
    // Prof +3 at L6, no RA → Acrobatics = DEX +1 only
    expect(out).toContain("Acrobatics (DEX)       +1");
    // Initiative is just DEX +1 too
    expect(out).toContain("Initiative: +1");
  });

  it("uses round-up (ceil) for half-prof at odd proficiency bonuses", () => {
    // At Champion L7, prof bonus is +3. ceil(3/2) = 2, floor(3/2) = 1.
    // PHB specifies "round up", so non-prof STR/DEX/CON skills get +2 from RA.
    const champL7: Record<string, unknown> = {
      data: {
        ...((withRA.data) as Record<string, unknown>),
        classes: [{
          ...((withRA.data as Record<string, unknown>).classes as Array<Record<string, unknown>>)[0],
          level: 7,
        }],
      },
    };
    const out = parseCharacterData(champL7, "summary");
    // Acrobatics: DEX (+1) + ceil(3/2)=2 = +3
    expect(out).toContain("Acrobatics (DEX)       +3");
    // Initiative: DEX (+1) + ceil(3/2)=2 = +3 (would be +2 if we used floor)
    expect(out).toContain("Initiative: +3");
  });
});

// ── Speed bonuses from class/subclass/feat modifiers ─────────────────────────
// DDB encodes class-feature speed bonuses with three different subTypes:
//   • subType:"speed-walking"     — axis-specific (e.g. Scout's Superior Mobility, Ranger's Roving)
//   • subType:"speed"              — generic walking-default (e.g. Barbarian Fast Movement, Mobile feat)
//   • subType:"innate-speed-walking" — race-granted base (already handled)
//
// Reproduces BUG #3 from regression-report-2026-05-16.md (Laena/Xarius/Ehsu
// all reporting 30ft instead of 40ft).
describe("parseCharacterData — speed bonuses from class/feat modifiers", () => {
  // FIGHTER_5 has Mountain Dwarf walking speed 25 ft — use it as the base.
  const withModifier = (modCategory: string, mod: Record<string, unknown>): Record<string, unknown> => ({
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        [modCategory]: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown[]>)[modCategory] ?? []),
          mod,
        ],
      },
    },
  });

  it("applies bonus speed-walking from class (Scout's Superior Mobility shape)", () => {
    const out = parseCharacterData(
      withModifier("class", { type: "bonus", subType: "speed-walking", fixedValue: 10, value: 10 }),
      "summary",
    );
    // 25 + 10 = 35
    expect(out).toContain("Speed: 35 ft.");
  });

  it("applies bonus speed (no axis suffix) as a walking bonus (Barbarian Fast Movement shape)", () => {
    const out = parseCharacterData(
      withModifier("class", { type: "bonus", subType: "speed", fixedValue: 10, value: 10 }),
      "summary",
    );
    expect(out).toContain("Speed: 35 ft.");
  });

  it("applies bonus speed from a feat-sourced modifier (Mobile feat shape)", () => {
    const out = parseCharacterData(
      withModifier("feat", { type: "bonus", subType: "speed", fixedValue: 10, value: 10 }),
      "summary",
    );
    expect(out).toContain("Speed: 35 ft.");
  });

  it("stacks bonus speed-walking and bonus speed", () => {
    // Ehsu's shape: class speed-walking +5 plus feat speed +10
    const data = {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown[]>).class ?? []),
          { type: "bonus", subType: "speed-walking", fixedValue: 5, value: 5 },
        ],
        feat: [
          { type: "bonus", subType: "speed", fixedValue: 10, value: 10 },
        ],
      },
    };
    const out = parseCharacterData({ data }, "summary");
    // 25 + 5 + 10 = 40
    expect(out).toContain("Speed: 40 ft.");
  });

  it("does NOT apply generic 'speed' bonus to non-walking axes", () => {
    // Give the character a fly speed of 30, then add a generic +10 'speed'
    // bonus. The bonus should affect walking (25 + 10 = 35) but NOT flying
    // (which should stay at 30).
    const data = {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      race: {
        ...((FIGHTER_5.data) as Record<string, unknown>).race as Record<string, unknown>,
        weightSpeeds: { normal: { walk: 25, fly: 30, swim: 0, climb: 0, burrow: 0 } },
      },
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown[]>).class ?? []),
          { type: "bonus", subType: "speed", fixedValue: 10, value: 10 },
        ],
      },
    };
    const out = parseCharacterData({ data }, "summary");
    expect(out).toContain("Speed: 35 ft., fly 30 ft.");
  });

  it("applies bonus speed-flying to flying speed only", () => {
    const data = {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      race: {
        ...((FIGHTER_5.data) as Record<string, unknown>).race as Record<string, unknown>,
        weightSpeeds: { normal: { walk: 25, fly: 30, swim: 0, climb: 0, burrow: 0 } },
      },
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown[]>).class ?? []),
          { type: "bonus", subType: "speed-flying", fixedValue: 10, value: 10 },
        ],
      },
    };
    const out = parseCharacterData({ data }, "summary");
    expect(out).toContain("Speed: 25 ft., fly 40 ft.");
  });

  it("regression guard: bonus innate-speed-walking still works", () => {
    // Pre-fix path — race-emitted speed bonuses use this subType.
    const out = parseCharacterData(
      withModifier("race", { type: "bonus", subType: "innate-speed-walking", fixedValue: 5, value: 5, isGranted: true }),
      "summary",
    );
    // 25 + 5 = 30
    expect(out).toContain("Speed: 30 ft.");
  });

  // Tasha's optional class features (Roving etc.) live in char.options.class
  // and emit modifiers with `isGranted: true` even when
  // `preferences.enableOptionalClassFeatures: false`. The DDB website does
  // NOT apply them in that case — confirmed against Ehsu Ferncraig (42519628)
  // whose `class bonus speed-walking +5` from Tasha's Roving is left in the
  // JSON but the website shows 40 ft (only the +10 Mobile feat applies, not
  // the +5 Roving). The discriminator: the modifier's componentId matches an
  // entry in char.classes[].classFeatures only when the feature is actually
  // granted; orphan componentIds belong to deselected optional features.
  it("skips class modifier whose componentId is not in the granted classFeatures list", () => {
    const data = {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      classes: [{
        id: 1,
        level: 5,
        hitDiceUsed: 0,
        definition: { name: "Fighter", hitDice: 10, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {} },
        subclassDefinition: null,
        // The character has ONE granted class feature with id 100.
        classFeatures: [{ definition: { id: 100, name: "Some Granted Feature", requiredLevel: 1 } }],
      }],
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown[]>).class ?? []),
          // Mod from the granted feature (componentId=100) — should apply.
          { type: "bonus", subType: "speed-walking", fixedValue: 10, value: 10, isGranted: true, componentId: 100 },
          // Mod from a Tasha's optional feature that isn't in classFeatures
          // (componentId=999) — should be ignored even though isGranted is true.
          { type: "bonus", subType: "speed-walking", fixedValue: 5, value: 5, isGranted: true, componentId: 999 },
        ],
      },
    };
    const out = parseCharacterData({ data }, "summary");
    // 25 + 10 (granted) = 35; the orphan +5 must NOT be added.
    expect(out).toContain("Speed: 35 ft.");
  });

  it("still applies class modifier with no componentId (fixture / legacy shape)", () => {
    // Hand-built fixtures throughout the test suite don't set componentId.
    // The filter must bypass when componentId is missing so fixtures keep working.
    const out = parseCharacterData(
      withModifier("class", { type: "bonus", subType: "speed-walking", fixedValue: 10, value: 10 }),
      "summary",
    );
    expect(out).toContain("Speed: 35 ft.");
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

// ── JoAT initiative is driven by a separate `subType:"initiative"` modifier ───
// DDB encodes Bard's Jack of All Trades as TWO modifiers (confirmed against
// BillytheBard 40080729):
//   • { type: "half-proficiency", subType: "ability-checks" } — applies to skills
//   • { type: "half-proficiency", subType: "initiative" }     — applies to initiative
// The website applies the initiative bonus only when the `initiative` subType
// is present — the `ability-checks` modifier alone does NOT propagate. This
// matches the previous behaviour of refusing to infer initiative from the
// generic ability-checks flag; the bug was missing the explicit subType.
describe("parseCharacterData — half-proficiency to initiative", () => {
  it("adds floor(prof/2) to initiative when subType:'initiative' half-prof mod is present (JoAT shape)", () => {
    // FIGHTER_5: DEX 12 (+1), level 5, prof +3, floor(3/2)=1 → initiative = +1 + 1 = +2
    const withJoatInit: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            ...((FIGHTER_5.data as Record<string, unknown>).modifiers as Record<string, unknown[]>).class,
            { type: "half-proficiency", subType: "ability-checks" },
            { type: "half-proficiency", subType: "initiative" },
          ],
        },
      },
    };
    const out = parseCharacterData(withJoatInit, "summary");
    expect(out).toContain("Initiative: +2");
  });

  it("does NOT add half-proficiency to initiative when only subType:'ability-checks' is present", () => {
    // ability-checks alone is the skills flag — the website does not infer
    // initiative from it. Confirms the previous (correct) narrow behaviour.
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
    expect(out).toContain("Initiative: +1");
  });

  it("does not apply JoAT when no half-proficiency modifier is present", () => {
    // Baseline FIGHTER_5 has no JoAT modifier → initiative = DEX mod = +1
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("Initiative: +1");
  });

  it("uses round-down (floor) for JoAT — matches PHB and DDB website", () => {
    // FIGHTER_5: level 5, prof +3, floor(3/2)=1, ceil(3/2)=2.
    // JoAT specifies round-down per the 2014 PHB.
    const withJoatInit: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            { type: "half-proficiency", subType: "initiative" },
          ],
        },
      },
    };
    const out = parseCharacterData(withJoatInit, "summary");
    // DEX +1 + floor(3/2)=1 = +2 (NOT +3 which would be ceil)
    expect(out).toContain("Initiative: +2");
  });

  it("does not double-apply when both JoAT and Remarkable Athlete grant half-prof", () => {
    // Synthetic Bard 2 / Champion 7 multiclass (level 9, prof +4):
    // floor(4/2) = ceil(4/2) = 2. Total init = DEX +1 + 2 = +3 (NOT +5).
    const multiclass: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        classes: [{
          id: 1, level: 9, hitDiceUsed: 0,
          definition: { name: "Fighter", hitDice: 10, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {} },
          subclassDefinition: { name: "Champion" },
          classFeatures: [],
        }],
        modifiers: {
          ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
          class: [
            { type: "half-proficiency", subType: "initiative" },
          ],
        },
      },
    };
    const out = parseCharacterData(multiclass, "summary");
    expect(out).toContain("Initiative: +3");
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

// ── overrideHitPoints replaces auto-calculated HP ─────────────────────────────
// DDB stores a manual / rolled-low HP override in char.overrideHitPoints.
// When set, it already includes CON mod and any hit-points-per-level features
// baked in — we must NOT add them on top. Bonus HP (from items, Aid spell, etc.)
// in char.bonusHitPoints stacks on top of the override.
//
// Reproduces BUG #5 (Petit Nuage 40193614, MCP 38 vs website 23) and the HP
// part of BUG #6 (Aerin 68903271, MCP 39 vs website 33).
describe("parseCharacterData — overrideHitPoints", () => {
  it("uses overrideHitPoints as max when it is set, ignoring the auto-calc", () => {
    // FIGHTER_5 auto-calc: 39 base + (CON +2 × 5 levels) = 49. With override,
    // we want exactly the override value as max, regardless of base.
    const withOverride: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        overrideHitPoints: 25,
        removedHitPoints: 0,
      },
    };
    const out = parseCharacterData(withOverride, "summary");
    expect(out).toContain("HP: 25/25");
  });

  it("subtracts removedHitPoints from the override-based max", () => {
    const withOverride: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        overrideHitPoints: 25,
        removedHitPoints: 5,
      },
    };
    const out = parseCharacterData(withOverride, "summary");
    expect(out).toContain("HP: 20/25");
  });

  it("stacks bonusHitPoints on top of the override", () => {
    const withOverrideAndBonus: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        overrideHitPoints: 25,
        bonusHitPoints: 5,
        removedHitPoints: 0,
      },
    };
    const out = parseCharacterData(withOverrideAndBonus, "summary");
    expect(out).toContain("HP: 30/30");
  });

  it("regression guard: when overrideHitPoints is null, falls back to auto-calc", () => {
    // FIGHTER_5 has no override and currentHp = 44, maxHp = 49.
    const out = parseCharacterData(FIGHTER_5, "summary");
    expect(out).toContain("HP: 44/49");
  });

  it("regression guard: overrideHitPoints of 0 is treated as 'not overridden'", () => {
    // Safety check — a literal 0 is nonsensical as a max HP. Treat like null.
    const withZeroOverride: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        overrideHitPoints: 0,
      },
    };
    const out = parseCharacterData(withZeroOverride, "summary");
    // Falls back to auto-calc: 39 + 2×5 = 49, removed 5 → 44/49
    expect(out).toContain("HP: 44/49");
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

// ── 2014 Half-Elf: chosen +1 ability bonuses ─────────────────────────────────
// The 2014 Half-Elf grants +2 CHA (fixed) plus +1 to two ability scores of
// the player's choice. DDB emits BOTH the fixed +2 and the two chosen +1s as
// `modifiers.race` entries, but the chosen ones carry `isGranted: false` —
// the same flag DDB uses on 2024-rule race ASIs (which the website moves to
// the background origin feat and our parser correctly ignores). Discriminator:
// for 2014 Half-Elf the player has explicit `choices.race` entries with
// optionValue in 3520..3525 (STR..CHA) pointing at the same race component.
// Confirmed against Ael Varris (166265317), Lysander (162797600),
// Shadowheart (107609898), and Danyr (39715128) — all four were missing one
// or two +1 race bonuses before this fix.
describe("parseCharacterData — 2014 Half-Elf chosen ability bonuses", () => {
  const FIGHTER_BASE = (FIGHTER_5.data) as Record<string, unknown>;
  // FIGHTER_5 base stats: STR 16, DEX 12, CON 14, INT 10, WIS 13, CHA 8.
  // Apply Half-Elf shape: +2 CHA (fixed), player picks +1 STR + +1 INT.
  // Expected: STR 17 (+3), INT 11 (+0), CHA 10 (+0). Others unchanged.
  const halfElfShape: Record<string, unknown> = {
    data: {
      ...FIGHTER_BASE,
      race: { fullName: "Half-Elf", baseName: "Elf", weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } }, racialTraits: [] },
      modifiers: {
        ...(FIGHTER_BASE.modifiers as Record<string, unknown>),
        race: [
          { type: "bonus", subType: "charisma-score",     fixedValue: 2, value: 2, isGranted: true,  componentId: 93 },
          { type: "bonus", subType: "strength-score",     fixedValue: 1, value: 1, isGranted: false, componentId: 93 },
          { type: "bonus", subType: "intelligence-score", fixedValue: 1, value: 1, isGranted: false, componentId: 93 },
        ],
      },
      choices: {
        race: [
          { type: 2, componentId: 93, optionValue: 3520, label: "Choose an Ability Score" }, // STR
          { type: 2, componentId: 93, optionValue: 3523, label: "Choose an Ability Score" }, // INT
        ],
      },
    },
  };

  it("applies the fixed +2 CHA AND both player-chosen +1 ability bonuses", () => {
    const out = parseCharacterData(halfElfShape);
    expect(out).toContain("STR 17 (+3)"); // 16 + 1 chosen
    expect(out).toContain("DEX 12 (+1)"); // unchanged
    expect(out).toContain("CON 14 (+2)"); // unchanged
    expect(out).toContain("INT 11 (+0)"); // 10 + 1 chosen
    expect(out).toContain("WIS 13 (+1)"); // unchanged
    expect(out).toContain("CHA 10 (+0)"); // 8 + 2 fixed
  });

  it("still ignores 2024-style race ASIs that have no matching player pick", () => {
    // Same shape as a Half-Elf, BUT no choices.race entries → the +1 mods
    // are a 2024-style declined emission and should remain skipped.
    const twentyTwentyFourShape: Record<string, unknown> = {
      data: {
        ...FIGHTER_BASE,
        race: { fullName: "Aasimar", baseName: "Aasimar", weightSpeeds: { normal: { walk: 30 } }, racialTraits: [] },
        modifiers: {
          ...(FIGHTER_BASE.modifiers as Record<string, unknown>),
          race: [
            { type: "bonus", subType: "strength-score",     fixedValue: 1, value: 1, isGranted: false, componentId: 999 },
            { type: "bonus", subType: "intelligence-score", fixedValue: 1, value: 1, isGranted: false, componentId: 999 },
          ],
        },
        choices: { race: [] },
      },
    };
    const out = parseCharacterData(twentyTwentyFourShape);
    expect(out).toContain("STR 16 (+3)"); // unchanged (declined)
    expect(out).toContain("INT 10 (+0)"); // unchanged (declined)
  });

  it("supports duplicate ability picks (Danyr case: STR chosen twice)", () => {
    // Half-Elf can in principle stack two picks on the same ability; DDB
    // saves whatever the player chose. Danyr (39715128) picked STR twice.
    const stackedShape: Record<string, unknown> = {
      data: {
        ...FIGHTER_BASE,
        race: { fullName: "Half-Elf", baseName: "Elf", weightSpeeds: { normal: { walk: 30 } }, racialTraits: [] },
        modifiers: {
          ...(FIGHTER_BASE.modifiers as Record<string, unknown>),
          race: [
            { type: "bonus", subType: "charisma-score", fixedValue: 2, value: 2, isGranted: true,  componentId: 93 },
            { type: "bonus", subType: "strength-score", fixedValue: 1, value: 1, isGranted: false, componentId: 93 },
            { type: "bonus", subType: "strength-score", fixedValue: 1, value: 1, isGranted: false, componentId: 93 },
          ],
        },
        choices: {
          race: [
            { type: 2, componentId: 93, optionValue: 3520, label: "Choose an Ability Score" }, // STR
            { type: 2, componentId: 93, optionValue: 3520, label: "Choose an Ability Score" }, // STR again
          ],
        },
      },
    };
    const out = parseCharacterData(stackedShape);
    expect(out).toContain("STR 18 (+4)"); // 16 + 1 + 1
  });
});

// ── Multiclass: save proficiencies come only from the starting class ────────
// PHB Multiclass table: only your *first* class grants saving-throw
// proficiencies. Additional classes contribute armor/weapons/tools/skills only.
// DDB hoists every class's save-prof modifiers into `modifiers.class` regardless;
// we need to drop the non-starting-class ones in `computeCoreStats`.
// Confirmed against Xarius Wo Tan (58640338) — Barbarian 5 / Rogue 5 starting
// as Barbarian. Website shows proficiency in STR + CON only; the parser was
// also marking DEX + INT (Rogue's saves) as proficient.
describe("parseCharacterData — multiclass save proficiencies", () => {
  // Build a Fighter 5 / Rogue 1 multiclass starting as Fighter. The save profs
  // are tagged with componentIds matching each class's "Proficiencies" feature
  // id so the source-of-grant is traceable (same shape DDB emits).
  const FIGHTER_BASE = (FIGHTER_5.data) as Record<string, unknown>;
  const multiclass: Record<string, unknown> = {
    data: {
      ...FIGHTER_BASE,
      classes: [
        // Starting class (Fighter) — STR + CON save profs should survive.
        {
          ...((FIGHTER_BASE.classes as Array<Record<string, unknown>>)[0]),
          isStartingClass: true,
          classFeatures: [{ definition: { id: 100, name: "Proficiencies" } }],
        },
        // Non-starting class (Rogue 1) — DEX + INT save profs MUST be dropped.
        {
          id: 999,
          level: 1,
          hitDiceUsed: 0,
          definition: { id: 12, name: "Rogue", hitDice: 8, canCastSpells: false, spellRules: {} },
          subclassDefinition: null,
          classFeatures: [{ definition: { id: 200, name: "Proficiencies" } }],
          isStartingClass: false,
        },
      ],
      modifiers: {
        ...(FIGHTER_BASE.modifiers as Record<string, unknown>),
        class: [
          // Starting-class grants
          { type: "proficiency", subType: "strength-saving-throws",     componentId: 100 },
          { type: "proficiency", subType: "constitution-saving-throws", componentId: 100 },
          { type: "proficiency", subType: "athletics",                  componentId: 100 },
          // Non-starting-class grants — saves dropped, others kept
          { type: "proficiency", subType: "dexterity-saving-throws",    componentId: 200 },
          { type: "proficiency", subType: "intelligence-saving-throws", componentId: 200 },
          { type: "proficiency", subType: "thieves-tools",              componentId: 200 },
        ],
      },
    },
  };

  it("keeps starting-class save proficiencies (STR, CON)", () => {
    // FIGHTER_5: STR 16 (+3), CON 14 (+2). Total level 6, profBonus 3.
    const out = parseCharacterData(multiclass);
    expect(out).toContain("STR +6*"); // 3 + 3
    expect(out).toContain("CON +5*"); // 2 + 3
  });

  it("does NOT apply non-starting-class save proficiencies (DEX, INT)", () => {
    const out = parseCharacterData(multiclass);
    // DEX 12 (+1), INT 10 (+0). Without the bug they should NOT have the * marker.
    expect(out).toMatch(/DEX \+1(?!\*)/);
    expect(out).not.toContain("DEX +4*"); // would be +4 if proficient
    expect(out).toMatch(/INT \+0(?!\*)/);
    expect(out).not.toContain("INT +3*"); // would be +3 if proficient
  });

  it("still keeps non-save proficiencies from non-starting classes (e.g. tools)", () => {
    // Multiclass Rogue does grant Thieves' Tools per the PHB table — verify
    // we're filtering ONLY save profs, not all class proficiencies.
    const out = parseCharacterData(multiclass);
    expect(out).toMatch(/Tools?:.*Thieves tools/i);
  });
});

// ── Global ability-checks / saving-throws bonuses ────────────────────────────
// Stone of Good Luck (Luckstone) and similar items grant
//   { type:"bonus", subType:"ability-checks", value:1 }
//   { type:"bonus", subType:"saving-throws", value:1 }
// These are GLOBAL — they apply to every save and every skill / passive,
// stacking on top of proficiency / per-skill bonuses. Confirmed against
// Xarius Wo Tan (58640338) attuned to a Luckstone — the DDB website's stat
// block was +1 across the board vs the parser's output before this fix.
describe("parseCharacterData — global bonus modifiers (Luckstone)", () => {
  const withLuckstone: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        item: [
          { type: "bonus", subType: "ability-checks", value: 1, fixedValue: 1 },
          { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1 },
        ],
      },
    },
  };

  it("adds the global saving-throws bonus to every save (proficient and not)", () => {
    // FIGHTER_5: STR 16 (+3), DEX 12 (+1), CON 14 (+2), INT 10, WIS 13 (+1), CHA 8 (-1)
    // Profbonus 3. Proficient saves: STR, CON.
    const out = parseCharacterData(withLuckstone);
    expect(out).toContain("STR +7*"); // 3 + 3 (prof) + 1 (luck)
    expect(out).toContain("DEX +2");  // 1 + 1
    expect(out).toContain("CON +6*"); // 2 + 3 (prof) + 1
    expect(out).toContain("INT +1");  // 0 + 1
    expect(out).toContain("WIS +2");  // 1 + 1
    expect(out).toContain("CHA +0");  // -1 + 1
  });

  it("adds the global ability-checks bonus to every skill and to passives", () => {
    const out = parseCharacterData(withLuckstone);
    // Athletics: STR (+3) + prof (3) + luck (1) = +7
    expect(out).toMatch(/Athletics\s+\(STR\)\s+\+7\s\*/);
    // Acrobatics: DEX (+1) + luck (1) = +2 (no prof)
    expect(out).toMatch(/Acrobatics\s+\(DEX\)\s+\+2(?!\s\*)/);
    // Perception: WIS (+1) + luck (1) = +2 → passive 12
    expect(out).toContain("Passive Perception: 12");
    expect(out).toContain("Passive Investigation: 11"); // INT 0 + 1
    expect(out).toContain("Passive Insight: 12");        // WIS 1 + 1
  });
});
