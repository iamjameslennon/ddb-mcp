/**
 * Rules-edition phase 5: the character sheet's `Rules:` summary line and its
 * header tags (classes, subclass, species, background).
 */
import { describe, it, expect } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import type { ParseSection } from "../src/tools/character/types.js";
import { ARCANE_TRICKSTER_9, FIGHTER_5, MONK_3_HANDAXE } from "./fixtures/character-fixtures.js";
import { INDEX, S, TAG, bgAndFeat, item, variant } from "./fixtures/character-edition-helpers.js";

const sheet = (c: Record<string, unknown>, s: ParseSection = "full") => parseCharacterData(c, s, INDEX);
const lines = (c: Record<string, unknown>) => sheet(c).split("\n");

const SECTIONS: ParseSection[] = ["summary", "combat", "spells", "inventory", "features", "concentration", "notes", "full"];

describe("character Rules line and header tags", () => {
  it("pure 2024: Rules: 2024 and no inline tags", () => {
    const c = FIGHTER_5;
    expect(lines(c)[1]).toBe("  Thorin");
    expect(lines(c)[2]).toBe("  Rules: 2024");
    expect(sheet(c)).not.toMatch(TAG);
  });

  it("the summary line is on every section", () => {
    for (const s of SECTIONS) expect(sheet(FIGHTER_5, s).split("\n")[2]).toBe("  Rules: 2024");
  });

  it("2024 with a 2014 background and feat", () => {
    const out = sheet(bgAndFeat());
    expect(out).toContain("  Rules: 2024 · 2014 content: Soldier (background), Sharpshooter (feat)");
    expect(out).toContain("  Background: Soldier [2014] | XP: 6500");
  });

  it("mixed multiclass", () => {
    const c = variant(FIGHTER_5, d => {
      d.classes.push({
        id: 9, level: 3,
        definition: { name: "Ranger", hitDice: 10, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {}, sources: S(2) },
        subclassDefinition: null, classFeatures: [],
      });
    });
    const out = sheet(c);
    expect(out).toContain("  Rules: mixed — 2024: Fighter 5 · 2014: Ranger 3");
    expect(out).toContain("  Mountain Dwarf | Fighter 5 / Ranger [2014] 3 | Level 8");
  });

  it("homebrew class: edition not stated", () => {
    const c = variant(FIGHTER_5, d => {
      Object.assign(d.classes[0].definition, { name: "Blood Hunter", isHomebrew: true, sources: [] });
    });
    const out = sheet(c);
    // Action Surge is FIGHTER_5's __DISGUISE_FEAT (sourced 145), classified like a feat (decision 4).
    expect(out).toContain(
      "  Rules: edition not stated · 2024 content: Mountain Dwarf (species), Soldier (background), Great Weapon Master (feat), Action Surge (feat) · homebrew: Blood Hunter 5 (class)",
    );
    expect(out).toContain("  Mountain Dwarf [2024] | Blood Hunter [homebrew] 5 | Level 5");
    expect(out).toContain("  Background: Soldier [2024] | XP: 6500");
  });

  it("a subclass of its class's ruleset is neither tagged nor listed", () => {
    const out = sheet(ARCANE_TRICKSTER_9);
    expect(out).toContain("  Rules: 2024 · 2014 content: Criminal (background)");
    expect(out).toContain("Rogue (Arcane Trickster) 9");
  });

  it("a 2014 subclass under a 2024 class is tagged on its own", () => {
    const c = variant(ARCANE_TRICKSTER_9, d => { d.classes[0].subclassDefinition.sources = S(2); });
    const out = sheet(c);
    expect(out).toContain("Rogue (Arcane Trickster [2014]) 9");
    expect(out).toContain("  Rules: 2024 · 2014 content: Arcane Trickster (subclass), Criminal (background)");
  });

  it("2014 character with a dual-edition weapon", () => {
    const c = MONK_3_HANDAXE;
    expect(lines(c)[2]).toBe("  Rules: 2014");
    expect(lines(c)).toContain("  Wood Elf | Monk 3 | Level 3");
  });

  it("counts spells and items the sheet shows, once each", () => {
    const c = variant(FIGHTER_5, d => {
      d.spells.race = [{ definition: { id: 901, name: "Toll the Dead", level: 0, sources: S(27) } }];
      d.spells.feat = [
        { definition: { id: 901, name: "Toll the Dead", level: 0, sources: S(27) } },
        { definition: { id: 902, name: "Hex", level: 1, sources: S(2) } },
      ];
      d.inventory = [
        item(903, "Bedroll", "Other Gear", { isLegacy: true, sources: S(1, 2) }),
        item(904, "Dagger", "Weapon", { isLegacy: true, sources: S(1) }, false),
        item(905, "Platinum Ring", "Other Gear", { sources: [] }),
      ];
    });
    expect(sheet(c)).toContain("  Rules: 2024 · 2014 content: 2 spells, 1 item · edition not stated: 1 item");
  });

  it("items without an id are counted by name", () => {
    const gear = (name: string) => ({
      equipped: false, quantity: 1,
      definition: { name, filterType: "Other Gear", isLegacy: true, sources: S(1) },
    });
    const c = variant(FIGHTER_5, d => { d.inventory = [gear("Torch"), gear("Torch"), gear("Bedroll")]; });
    expect(sheet(c)).toContain("2014 content: 2 items");
  });

  it("a third-party disguised feat is listed", () => {
    const c = variant(FIGHTER_5, d => {
      d.feats.push({ definition: { name: "Dark Bargain", categories: [{ tagName: "__DISGUISE_FEAT" }], sources: S(193) } });
    });
    expect(sheet(c)).toContain("  Rules: 2024 · third-party: Dark Bargain (feat)");
  });

  it("missing race, background and subclass don't throw", () => {
    const c = variant(FIGHTER_5, d => {
      d.race = null;
      d.background = { definition: null };
    });
    expect(lines(c)[2]).toBe("  Rules: 2024");
  });

  it("the species tag follows the lineage", () => {
    const c = variant(FIGHTER_5, d => {
      d.race = {
        fullName: "Elf", baseName: "Elf", isLegacy: false, sources: S(2),
        weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } }, racialTraits: [],
      };
      d.options = { race: [{ definition: { name: "Wood Elf Lineage" } }] };
    });
    expect(sheet(c)).toContain("  Elf (Wood Elf) [2014] | Fighter 5 | Level 5");
  });

  it("a nameless species, background or subclass object adds no summary item", () => {
    const c = variant(FIGHTER_5, d => {
      d.race = {};
      d.background = { definition: { sources: S(2) } };
      d.classes[0].subclassDefinition = { sources: S(2) };
    });
    const out = sheet(c);
    expect(out).toContain("  Rules: 2024\n");
    expect(out).not.toMatch(/\(species\)|\(background\)|\(subclass\)/);
  });

  it("a nameless spell from a source list is neither counted nor printed", () => {
    const c = variant(FIGHTER_5, d => {
      d.spells = { race: [{ definition: { id: 7, level: 1, sources: S(2) } }] };
    });
    const out = sheet(c);
    expect(out).not.toMatch(/2014 content: .*spell/);
    expect(out).not.toContain("From ");
  });
});

describe("inline tags", () => {
  it("feat lines", () => {
    const out = sheet(bgAndFeat());
    expect(out).toContain("• Sharpshooter [2014]: Long shots.");
    expect(out).toContain("• Great Weapon Master: On a critical hit or kill, make a bonus attack.");
  });

  it("disguised feats in OTHER FEATURES", () => {
    const c = variant(FIGHTER_5, d => {
      d.feats.push({ definition: { name: "Dark Bargain", categories: [{ tagName: "__DISGUISE_FEAT" }], sources: S(193) } });
    });
    const out = sheet(c);
    expect(out).toContain("• Dark Bargain [third-party]");
    expect(out).toMatch(/^• Action Surge$/m);
  });

  const spellChar = (extraRace: unknown[] = []) => variant(ARCANE_TRICKSTER_9, d => {
    d.classSpells = [{ characterClassId: 3, spells: [
      { definition: { id: 911, name: "Fire Bolt", level: 0, sources: S(2) } },
      { definition: { id: 912, name: "Shield", level: 1, sources: S(145) } },
    ] }];
    d.spells = { ...d.spells, race: [{ definition: { id: 913, name: "Toll the Dead", level: 0, sources: S(27) } }, ...extraRace] };
  });

  it("class spells and granted spells", () => {
    const out = sheet(spellChar());
    expect(out).toContain("  Cantrips: Fire Bolt [2014]");
    expect(out).toContain("  Spells: Shield (L1)");
    expect(out).toContain("  From Racial Trait: Toll the Dead [2014]");
  });

  it("duplicate warning keeps the tag", () => {
    const out = sheet(spellChar([{ definition: { id: 911, name: "Fire Bolt", level: 0, sources: S(2) } }]));
    expect(out).toContain("  • Fire Bolt [2014] — already granted by Spells, also in Racial Trait");
  });

  it("concentration block", () => {
    const c = variant(FIGHTER_5, d => {
      d.spells = { feat: [{ definition: { id: 914, name: "Hex", level: 1, concentration: true, sources: S(2) } }] };
    });
    expect(sheet(c, "concentration")).toContain("    • Hex [2014] [1st-level slot]");
  });

  it("inventory and equipped armour", () => {
    const c = variant(FIGHTER_5, d => {
      d.inventory = [
        item(903, "Bedroll", "Other Gear", { isLegacy: true, sources: S(1, 2) }),
        item(905, "Platinum Ring", "Other Gear", { sources: [] }),
        item(906, "Studded Leather", "Armor", { isLegacy: true, sources: S(1), armorClass: 12 }, true),
      ];
    });
    const out = sheet(c);
    expect(out).toContain("  Studded Leather [2014] (AC 12)");
    expect(out).toContain("  Bedroll [2014], Platinum Ring [edition not stated]");
  });

  it("weapon line pads the tag with the name", () => {
    const c = variant(FIGHTER_5, d => {
      d.inventory = [{ equipped: true, quantity: 1, definition: {
        id: 907, name: "Longsword", filterType: "Weapon", isLegacy: true, sources: S(1), categoryId: 2,
        attackType: 1, damage: { diceString: "1d8" }, damageType: "Slashing", properties: [], grantedModifiers: [],
      } }];
    });
    expect(sheet(c)).toMatch(/^• Longsword \[2014\] [+-]\d+ to hit/m);
  });

  it("dual-edition weapon on a 2014 character is untagged", () => {
    const out = sheet(MONK_3_HANDAXE);
    expect(out).toMatch(/^• Handaxe +\+5 to hit/m);
    expect(out).not.toMatch(TAG);
  });
});
