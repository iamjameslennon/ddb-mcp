import { describe, it, expect } from "vitest";
import { prerequisiteMatches, ddbPrerequisiteText, ddbPrerequisiteMatches } from "../src/tools/prerequisite.js";

describe("prerequisiteMatches", () => {
  it("matches abbreviations, any order and partial words", () => {
    expect(prerequisiteMatches("Str or Dex 13+", "Strength 13")).toBe(true);
    expect(prerequisiteMatches("Level 4+; Strength or Dexterity 13+", "strength 13")).toBe(true);
    expect(prerequisiteMatches("Strength 13 or higher", "Strength 13")).toBe(true);
    expect(prerequisiteMatches("Dexterity 13 or higher", "Strength 13")).toBe(false);
    expect(prerequisiteMatches("Level 4+", "spellcasting")).toBe(false);
    expect(prerequisiteMatches("Spellcasting or Pact Magic Feature", "spell")).toBe(true);
    expect(prerequisiteMatches("Str or Dex 13+", "13 strength")).toBe(true);
  });

  it("an empty query matches; an empty or null prerequisite fails a real query", () => {
    expect(prerequisiteMatches("Level 4+", "")).toBe(true);
    expect(prerequisiteMatches("", "level")).toBe(false);
    expect(prerequisiteMatches(null, "level")).toBe(false);
  });
});

describe("ddbPrerequisiteText / ddbPrerequisiteMatches", () => {
  const g = (description: string, mappings: Array<Record<string, unknown>> = [], hidePrerequisite = false) =>
    ({ description, hidePrerequisite, prerequisiteMappings: mappings });
  const STR = { type: "ability-score", subType: "strength", value: 13, friendlySubTypeName: "Strength" };
  const DEX = { type: "ability-score", subType: "dexterity", value: 13, friendlySubTypeName: "Dexterity" };
  const LVL4 = { type: "level", subType: "character-level", value: 4, friendlySubTypeName: "Level" };
  const GRAPPLER = [g("Level 4+, Strength", [LVL4, STR]), g("or Dexterity 13+", [DEX])];
  const ASI = [g("Level 4+", [LVL4])];

  it("joins a continuation group with a space", () => {
    expect(ddbPrerequisiteText(GRAPPLER)).toBe("Level 4+, Strength or Dexterity 13+");
    expect(ddbPrerequisiteText([g("Level 4+"), g("Strength 13+")])).toBe("Level 4+; Strength 13+");
    expect(ddbPrerequisiteText(null)).toBe("");
    expect(ddbPrerequisiteText([])).toBe("");
  });

  it("summarises class-feature groups", () => {
    const fs = Array.from({ length: 15 }, (_, i) => g(`Fighter Fighting Style ${i}`, [{ type: "class-feature", subType: "fighter-fighting-style" }]));
    expect(ddbPrerequisiteText(fs)).toBe("a Fighting Style feature");
    const sc = [g("Bard Spellcasting", [{ type: "class-feature", subType: "bard-spellcasting" }]), g("Warlock Pact Magic", [{ type: "class-feature", subType: "warlock-pact-magic" }])];
    expect(ddbPrerequisiteText(sc)).toBe("the Spellcasting or Pact Magic feature");
  });

  it("a group with no mappings falls to its description instead of the class-feature summary", () => {
    const mixed = [g("Fighter Fighting Style 1", [{ type: "class-feature", subType: "fighter-fighting-style" }]), g("Some note")];
    expect(ddbPrerequisiteText(mixed)).toBe("Fighter Fighting Style 1; Some note");
  });

  it("a hidden group stays off the text but still matches", () => {
    const hidden = [g("Secret Strength 15", [{ type: "ability-score", subType: "strength", value: 15, friendlySubTypeName: "Strength" }], true)];
    expect(ddbPrerequisiteText(hidden)).toBe("");
    expect(ddbPrerequisiteMatches(hidden, "strength 15")).toBe(true);
    expect(ddbPrerequisiteText([...hidden, g("Level 4+")])).toBe("Level 4+");
  });

  it("matches per group, with mapping phrases", () => {
    for (const q of ["strength 13", "dexterity 13", "level 4", "Strength or Dexterity"]) expect(ddbPrerequisiteMatches(GRAPPLER, q)).toBe(true);
    expect(ddbPrerequisiteMatches(ASI, "level 4")).toBe(true);
    expect(ddbPrerequisiteMatches(ASI, "strength 13")).toBe(false);
    expect(ddbPrerequisiteMatches(ASI, "")).toBe(true);
    expect(ddbPrerequisiteMatches(null, "level")).toBe(false);
  });

  it("a query can't join words from two OR groups", () => {
    const groups = [g("Strength 13", [STR]), g("Level 19+", [{ type: "level", value: 19, friendlySubTypeName: "Level" }])];
    expect(ddbPrerequisiteMatches(groups, "strength 19")).toBe(false);
  });

  it("skips null groups, null mappings and a non-array prerequisites", () => {
    const bad = [null, g("Level 4+", [null as never, LVL4])] as never;
    expect(ddbPrerequisiteText(bad)).toBe("Level 4+");
    expect(ddbPrerequisiteMatches(bad, "level 4")).toBe(true);
    expect(ddbPrerequisiteText("oops" as never)).toBe("");
    expect(ddbPrerequisiteMatches({} as never, "level")).toBe(false);
    expect(ddbPrerequisiteText([{ description: "x", prerequisiteMappings: "bad" as never }])).toBe("x");
  });

  it("finds the fighting-style subType in any mapping of a group", () => {
    const grp = g("Fighter Fighting Style 1", [{ type: "class-feature", subType: "fighter" }, { type: "class-feature", subType: "fighter-fighting-style" }]);
    expect(ddbPrerequisiteText([grp])).toBe("a Fighting Style feature");
  });

  it("a bare 'or' group joins with a space", () => {
    expect(ddbPrerequisiteText([g("Level 4+, Strength"), g(" or "), g("Dexterity 13+")])).toBe("Level 4+, Strength or Dexterity 13+");
  });
});
