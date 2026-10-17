import { describe, it, expect, beforeEach } from "vitest";
import { addCharacterSpellsToCompendium, clearReferenceCache, isConcentrationSpell } from "../src/tools/reference.js";
import { parseCharacterData } from "../src/tools/character.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";

const NINE = ["Divine Favor", "Spiritual Weapon", "Sleep", "True Strike", "Barkskin",
  "Enthrall", "Forcecage", "Animal Shapes", "Magic Weapon"];

function charWithRaceSpell(definition: Record<string, unknown>): Record<string, unknown> {
  return {
    data: {
      ...(FIGHTER_5.data as Record<string, unknown>),
      classes: [{
        id: 10, level: 5, hitDiceUsed: 0,
        definition: {
          name: "Druid", hitDice: 8, canCastSpells: true, spellCastingAbilityId: 5,
          spellRules: { levelSpellSlots: Array.from({ length: 21 }, (_, l) => l >= 1 ? [3, 2, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]) },
        },
        subclassDefinition: null, classFeatures: [],
      }],
      classSpells: [],
      spells: { race: [{ definition }], class: [], background: [], feat: [], item: [] },
      spellSlots: [],
    },
  };
}

beforeEach(() => clearReferenceCache());

describe("concentration follows the character's own definition", () => {
  it.each(NINE.flatMap(n => [[n, true], [n, false]] as const))(
    "%s: the character's own definition (concentration %s) wins over the other edition", (name, conc) => {
      // Seed the other edition from a different character's classSpells.
      addCharacterSpellsToCompendium({ classSpells: [{ spells: [{ definition:
        { id: 1000, name, level: 1, concentration: !conc, isLegacy: true, sources: [{ sourceId: 2 }] } }] }] });
      // The parsed character holds the 2024 version as a racial grant (not in classSpells).
      const out = parseCharacterData(charWithRaceSpell({ id: 2000, name, level: 1, concentration: conc,
        sources: [{ sourceId: 145 }] }), "concentration");
      expect(out.includes(name)).toBe(conc);
    });
});

describe("isConcentrationSpell", () => {
  it("returns the definition's own boolean first", () => {
    addCharacterSpellsToCompendium({ classSpells: [{ spells: [{ definition: { id: 7, name: "Hex", concentration: true } }] }] });
    expect(isConcentrationSpell({ id: 7, name: "Hex", concentration: false })).toBe(false);
  });

  it("without a boolean, the same definition id decides", () => {
    addCharacterSpellsToCompendium({ classSpells: [{ spells: [{ definition: { id: 7, name: "Hex", concentration: true } }] }] });
    expect(isConcentrationSpell({ id: 7, name: "Hex" })).toBe(true);
  });

  it("without a boolean or a known id, the twin group's entry for the definition's own edition decides", () => {
    addCharacterSpellsToCompendium({ classSpells: [{ spells: [
      { definition: { id: 1, name: "Barkskin", concentration: true, isLegacy: true, sources: [{ sourceId: 2 }] } },
      { definition: { id: 2, name: "Barkskin", concentration: false, sources: [{ sourceId: 145 }] } },
    ] }] });
    expect(isConcentrationSpell({ name: "Barkskin", isLegacy: true })).toBe(true);
    expect(isConcentrationSpell({ name: "Barkskin", sources: [{ sourceId: 145 }] })).toBe(false);
    expect(isConcentrationSpell({ name: "Barkskin" })).toBe(false); // edition not stated → 2024
  });

  it("returns null for an unknown spell with no boolean", () => {
    expect(isConcentrationSpell({ name: "Nope" })).toBeNull();
  });

  it("ignores buffer entries with no numeric id", () => {
    addCharacterSpellsToCompendium({ classSpells: [{ spells: [{ definition: { name: "Idless", concentration: true } }] }] });
    expect(isConcentrationSpell({ name: "Idless" })).toBeNull();
  });
});
