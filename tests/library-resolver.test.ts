import { describe, it, expect } from "vitest";
import { matchBookSlug } from "../src/tools/library.js";

const BOOKS = [
  { title: "Player's Handbook (2024)",        slug: "dnd/phb-2024",  ownership: "Owned" },
  { title: "Dungeon Master's Guide (2024)",    slug: "dnd/dmg-2024",  ownership: "Owned" },
  { title: "Monster Manual (2024)",            slug: "dnd/mm-2024",   ownership: "Owned" },
  { title: "Player's Handbook (2014)",         slug: "dnd/phb",       ownership: "Owned" },
  { title: "Xanathar's Guide to Everything",   slug: "dnd/xgte",      ownership: "Owned" },
];

describe("matchBookSlug", () => {
  it("returns slug as-is when input contains '/' (slug passthrough handled by caller)", () => {
    // resolveBookSlug does the passthrough — matchBookSlug only receives plain titles,
    // but passing a slug-like string should still work if it happens to be an exact title match
    // or fall through to the no-match error. This test documents the boundary.
    expect(() => matchBookSlug(BOOKS, "dnd/phb-2024")).toThrow("No book found");
  });

  it("exact match is case-insensitive", () => {
    expect(matchBookSlug(BOOKS, "monster manual (2024)")).toBe("dnd/mm-2024");
    expect(matchBookSlug(BOOKS, "MONSTER MANUAL (2024)")).toBe("dnd/mm-2024");
  });

  it("returns slug for an unambiguous partial/substring match", () => {
    expect(matchBookSlug(BOOKS, "xanathar")).toBe("dnd/xgte");
    expect(matchBookSlug(BOOKS, "dungeon master")).toBe("dnd/dmg-2024");
  });

  it("throws with both matching titles when input is ambiguous", () => {
    // "player's handbook" matches both the 2014 and 2024 editions
    expect(() => matchBookSlug(BOOKS, "player's handbook")).toThrow("Multiple books match");
    try {
      matchBookSlug(BOOKS, "player's handbook");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("dnd/phb-2024");
      expect(msg).toContain("dnd/phb");
    }
  });

  it("throws listing all books when no match is found", () => {
    expect(() => matchBookSlug(BOOKS, "spelljammer")).toThrow("No book found matching");
    try {
      matchBookSlug(BOOKS, "spelljammer");
    } catch (e) {
      const msg = (e as Error).message;
      // Should list all available books in the error
      expect(msg).toContain("Player's Handbook");
      expect(msg).toContain("Xanathar's Guide");
    }
  });

});
