/**
 * A null (or non-object) entry in feats, racialTraits, inventory or a class's
 * classFeatures is malformed D&D Beyond data. Every sheet section and the
 * ddb_character_lookup tool skip it: the output is the same as without it.
 */
import { describe, expect, it } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { formatCharacterLookup } from "../src/tools/character/definition.js";
import type { ParseSection } from "../src/tools/character/types.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";
import { INDEX, S, variant } from "./fixtures/character-edition-helpers.js";

const SECTIONS: ParseSection[] = ["summary", "combat", "spells", "inventory", "features", "notes", "concentration", "full"];
const BAD: unknown[] = [null, undefined, 7, "x", [], true];

/** A fighter with one well-formed entry in each of the four arrays (and the subclass's). */
function populated(shape: "2014" | "2024"): Record<string, unknown> {
  return variant(FIGHTER_5, d => {
    d.race.racialTraits = [{ definition: { id: 11, name: "Dwarven Resilience", snippet: "Poison resistance.", sources: S(145), activation: { activationType: 4 } } }];
    d.classes[0].classFeatures = [{ definition: { id: 21, name: "Second Wind", requiredLevel: 1, snippet: "Heal 1d10+5.", sources: S(145) } }];
    d.classes[0].subclassDefinition = { id: 31, name: "Champion", sources: S(145), classFeatures: [
      { id: 41, name: "Improved Critical", requiredLevel: 3, snippet: "Crit on 19." },
    ] };
    d.inventory = [
      { equipped: true, quantity: 1, definition: { id: 51, name: "Longsword", filterType: "Weapon", damage: { diceString: "1d8" }, damageType: "Slashing", attackType: 1, categoryId: 2, properties: [], sources: S(145) } },
      { equipped: true, quantity: 1, definition: { id: 52, name: "Chain Mail", filterType: "Armor", armorClass: 16, armorTypeId: 3, sources: S(145) } },
      { equipped: false, quantity: 2, definition: { id: 53, name: "Torch", filterType: "Other Gear", sources: S(145) } },
    ];
    if (shape === "2024") {
      // 2024 sheets: no `race` object (the lineage is in options), spells under classSpells[].classSpells.
      d.race = null;
      d.options = { race: [{ definition: { id: 61, name: "Dwarf", sources: S(145) } }] };
      d.classSpells = [{ characterClassId: 1, classSpells: [] }];
    }
  });
}

/** `base` with `bad` spliced in around the real entries of all four arrays. */
function withBad(base: Record<string, unknown>, bad: unknown): Record<string, unknown> {
  return variant(base, d => {
    const pad = <T>(list: T[] | undefined): unknown[] => [bad, ...(list ?? []), bad];
    d.feats = pad(d.feats);
    if (d.race) d.race.racialTraits = pad(d.race.racialTraits);
    d.inventory = pad(d.inventory);
    d.classes[0].classFeatures = pad(d.classes[0].classFeatures);
    d.classes[0].subclassDefinition.classFeatures = pad(d.classes[0].subclassDefinition.classFeatures);
  });
}

const data = (c: Record<string, unknown>) => c.data as Record<string, unknown>;

describe.each(["2014", "2024"] as const)("a null or non-object entry in the %s shape", shape => {
  const clean = populated(shape);

  describe.each(BAD.map(b => [String(b === undefined ? "undefined" : JSON.stringify(b)), b] as const))("%s", (_label, bad) => {
    const dirty = withBad(clean, bad);

    it.each(SECTIONS)("the %s section renders as if the entry were absent", section => {
      expect(parseCharacterData(dirty, section, INDEX)).toBe(parseCharacterData(clean, section, INDEX));
    });

    it.each(["resilience", "second wind", "improved critical", "longsword", "torch", "great weapon", "dwarf", "e"])(
      "ddb_character_lookup %j renders as if the entry were absent", query => {
        expect(formatCharacterLookup(data(dirty), query, INDEX)).toBe(formatCharacterLookup(data(clean), query, INDEX));
      });
  });
});
