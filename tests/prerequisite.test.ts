import { describe, it, expect } from "vitest";
import { prerequisiteMatches } from "../src/tools/prerequisite.js";

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
