import { describe, it, expect } from "vitest";
import {
  buildSourceIndex, categoryRuleset, classifyEdition, KNOWN_CATEGORY_IDS,
  type CategoryRecord, type EditionMarkers, type SourceRecord,
} from "../src/edition.js";

// ── Fixture source index ──────────────────────────────────────────────────────
// Real IDs, names and categories from the live game config (2026-10-16), except
// 800–804, which are invented to cover an unstated category, an unknown
// category, missing descriptions and a missing category.

const SOURCES: SourceRecord[] = [
  { id: 1, name: "BR", description: "Basic Rules (2014)", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 26 },
  { id: 2, name: "PHB", description: "Player’s Handbook (2014)", sourceURL: "sources/dnd/phb-2014", sourceCategoryId: 26 },
  { id: 3, name: "DMG", description: "Dungeon Master’s Guide (2014)", sourceURL: "sources/dnd/dmg-2014", sourceCategoryId: 26 },
  { id: 5, name: "MM", description: "Monster Manual (2014)", sourceURL: "sources/dnd/mm-2014", sourceCategoryId: 26 },
  { id: 6, name: "CoS", description: "Curse of Strahd", sourceURL: "sources/dnd/cos", sourceCategoryId: 1 },
  { id: 15, name: "VGtM", description: "Volo's Guide to Monsters", sourceURL: "sources/dnd/vgtm", sourceCategoryId: 23 },
  { id: 27, name: "XGtE", description: "Xanathar's Guide to Everything", sourceURL: "sources/dnd/xgte", sourceCategoryId: 1 },
  { id: 31, name: "CR", description: "Critical Role", sourceURL: "sources/dnd/cr", sourceCategoryId: 2 },
  { id: 100, name: "UA", description: "Unearthed Arcana", sourceURL: "sources/dnd/ua", sourceCategoryId: 3 },
  { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
  { id: 146, name: "DMG-2024", description: "Dungeon Master&#8217;s Guide", sourceURL: "sources/dnd/dmg-2024", sourceCategoryId: 24 },
  { id: 147, name: "MM-2024", description: "Monster Manual", sourceURL: "sources/dnd/mm-2024", sourceCategoryId: 24 },
  { id: 148, name: "br-2024", description: "D&amp;D Beyond Basic Rules", sourceURL: "sources/dnd/br-2024", sourceCategoryId: 24 },
  { id: 193, name: "TCMP1", description: "The Crooked Moon Part One: Player Options &amp; Campaign Setting", sourceURL: "sources/dnd/tcmp1", sourceCategoryId: 34 },
  { id: 205, name: "FRHoF", description: "Forgotten Realms: Heroes of Faerûn", sourceURL: "sources/dnd/frhof", sourceCategoryId: 38 },
  { id: 800, name: "EB", description: "Eberron: Rising from the Last War", sourceURL: "sources/dnd/erlw", sourceCategoryId: 8 },
  { id: 801, name: "NEW", description: "Brand New Book", sourceURL: null, sourceCategoryId: 99 },
  { id: 802, name: "NoDesc-2024", description: null, sourceURL: null, sourceCategoryId: 24 },
  { id: 803, name: "NoCat", description: "Uncategorised Book", sourceURL: null, sourceCategoryId: null },
  { id: 804, name: "NoDesc-EB", description: null, sourceURL: null, sourceCategoryId: 8 },
];

const CATEGORIES: CategoryRecord[] = [
  { id: 1, name: "5e Expanded Rules" },
  { id: 2, name: "Critical Role" },
  { id: 3, name: "Playtest" },
  { id: 8, name: "Eberron" },
  { id: 23, name: "Legacy/Noncore" },
  { id: 24, name: "5.5e Core Rules" },
  { id: 26, name: "5e Core Rules" },
  { id: 34, name: "Avantris Entertainment" },
  { id: 38, name: "5.5e Expanded Rules" },
];

const INDEX = buildSourceIndex(SOURCES, CATEGORIES);
const classify = (entry: EditionMarkers) => classifyEdition(entry, INDEX);
const from = (...ids: number[]) => ids.map(sourceId => ({ sourceId }));

// ── Category table (spec: "Category table") ──────────────────────────────────

const CATEGORY_TABLE: Record<string, number[]> = {
  "2024": [24, 38],
  "2014": [26, 1, 23],
  playtest: [3],
  "third-party": [2, 18, 19, 20, 21, 22, 25, 27, 29, 30, 31, 32, 33, 34, 36, 37, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 52],
  unstated: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 28, 35, 46],
};

describe("categoryRuleset", () => {
  const rows = Object.entries(CATEGORY_TABLE).flatMap(([ruleset, ids]) => ids.map(id => [id, ruleset] as const));
  it.each(rows)("category %i → %s", (id, ruleset) => {
    expect(categoryRuleset(id)).toBe(ruleset);
  });

  it("treats a category the table doesn't list as unstated, never third-party", () => {
    expect(categoryRuleset(99)).toBe("unstated");
    expect(categoryRuleset(4)).toBe("unstated");
    expect(categoryRuleset(null)).toBe("unstated");
    expect(categoryRuleset(undefined)).toBe("unstated");
  });

  it("KNOWN_CATEGORY_IDS is exactly the table", () => {
    expect([...KNOWN_CATEGORY_IDS].sort((a, b) => a - b))
      .toEqual(Object.values(CATEGORY_TABLE).flat().sort((a, b) => a - b));
  });
});

// ── Source index book names (spec: "The book name") ──────────────────────────

describe("buildSourceIndex", () => {
  const book = (id: number) => INDEX.sources.get(id)?.book;

  it("decodes entities and folds curly apostrophes", () => {
    expect(book(148)).toBe("D&D Beyond Basic Rules");
    expect(book(193)).toBe("The Crooked Moon Part One: Player Options & Campaign Setting");
    expect(book(27)).toBe("Xanathar's Guide to Everything");
  });

  it("appends its own year only when the other edition has a same-described book", () => {
    expect(book(145)).toBe("Player's Handbook (2024)");
    expect(book(146)).toBe("Dungeon Master's Guide (2024)");
    expect(book(147)).toBe("Monster Manual (2024)");
    expect(book(2)).toBe("Player's Handbook (2014)");
    expect(book(205)).toBe("Forgotten Realms: Heroes of Faerûn");
  });

  it("falls back to the short name when there is no description", () => {
    expect(book(802)).toBe("NoDesc-2024");
    // Rule 3 labels with "the first such source", so a description-less 2024 book still shows its short name.
    expect(classify({ sources: from(802) })).toEqual({ ruleset: "2024", book: "NoDesc-2024" });
  });

  it("leaves an empty label empty, never a year-only label", () => {
    const local = buildSourceIndex([
      { id: 901, name: "", description: null, sourceURL: null, sourceCategoryId: 24 },
      { id: 902, name: "", description: null, sourceURL: null, sourceCategoryId: 26 },
    ], []);
    expect(local.sources.get(901)?.book).toBe("");
    expect(local.sources.get(902)?.book).toBe("");
  });

  it("keeps the raw fields and the category list", () => {
    expect(INDEX.sources.get(145)).toEqual({
      categoryId: 24, name: "PHB-2024", description: "Player’s Handbook",
      sourceURL: "sources/dnd/phb-2024", book: "Player's Handbook (2024)",
    });
    expect(INDEX.sources.get(803)?.categoryId).toBeNull();
    expect(INDEX.categories.get(24)).toBe("5.5e Core Rules");
  });
});

// ── Classification (spec: "Classification (classifyEdition)") ───────────────

describe("classifyEdition", () => {
  it("rule 1: homebrew wins over everything, with no book", () => {
    expect(classify({ isHomebrew: true, isLegacy: true, sources: from(145) })).toEqual({ ruleset: "homebrew", book: null });
  });

  it("rule 2: Legacy is 2014 even with a 2024 reprint attached; book is the first 2014-category source", () => {
    expect(classify({ isLegacy: true, sources: from(145, 2) })).toEqual({ ruleset: "2014", book: "Player's Handbook (2014)" });
  });

  it("rule 2: Legacy with no 2014-category source takes the first source with a known description, else null", () => {
    expect(classify({ isLegacy: true, sources: from(12345, 31) })).toEqual({ ruleset: "2014", book: "Critical Role" });
    expect(classify({ isLegacy: true, sources: from(802, 31) })).toEqual({ ruleset: "2014", book: "Critical Role" });
    expect(classify({ isLegacy: true, sources: from(802) })).toEqual({ ruleset: "2014", book: null });
    expect(classify({ isLegacy: true, sources: from(12345) })).toEqual({ ruleset: "2014", book: null });
    expect(classify({ isLegacy: true })).toEqual({ ruleset: "2014", book: null });
  });

  it("rule 3: any 2024-category source makes a non-Legacy definition 2024 (Studded Leather)", () => {
    expect(classify({ isLegacy: false, sources: from(148, 1) })).toEqual({ ruleset: "2024", book: "D&D Beyond Basic Rules" });
  });

  it("rule 3 beats rule 4 whatever the order, and sourceId counts as a source", () => {
    expect(classify({ sourceId: 5, sources: from(147) })).toEqual({ ruleset: "2024", book: "Monster Manual (2024)" });
    expect(classify({ sourceId: 147, sources: [] })).toEqual({ ruleset: "2024", book: "Monster Manual (2024)" });
    expect(classify({ sources: from(205) })).toEqual({ ruleset: "2024", book: "Forgotten Realms: Heroes of Faerûn" });
  });

  it("rule 4: 2014 categories — core, expanded and Legacy/Noncore", () => {
    expect(classify({ sources: from(1) })).toEqual({ ruleset: "2014", book: "Basic Rules (2014)" });
    expect(classify({ isLegacy: false, sources: from(27) })).toEqual({ ruleset: "2014", book: "Xanathar's Guide to Everything" });
    expect(classify({ sources: from(15) })).toEqual({ ruleset: "2014", book: "Volo's Guide to Monsters" });
  });

  it("rule 5: playtest beats third-party", () => {
    expect(classify({ sources: from(100) })).toEqual({ ruleset: "playtest", book: "Unearthed Arcana" });
    expect(classify({ sources: from(31, 100) })).toEqual({ ruleset: "playtest", book: "Unearthed Arcana" });
  });

  it("rule 6: third-party publishers", () => {
    expect(classify({ sources: from(193) })).toEqual({
      ruleset: "third-party", book: "The Crooked Moon Part One: Player Options & Campaign Setting",
    });
    expect(classify({ sources: from(31) })).toEqual({ ruleset: "third-party", book: "Critical Role" });
  });

  it("rule 7: unstated categories, unknown categories, unknown IDs, no sources", () => {
    expect(classify({ sources: from(800) })).toEqual({ ruleset: "unstated", book: "Eberron: Rising from the Last War" });
    expect(classify({ sources: from(801) })).toEqual({ ruleset: "unstated", book: "Brand New Book" });
    expect(classify({ sources: from(803) })).toEqual({ ruleset: "unstated", book: "Uncategorised Book" });
    expect(classify({ sources: from(12345) })).toEqual({ ruleset: "unstated", book: null });
    expect(classify({ sources: from(804) })).toEqual({ ruleset: "unstated", book: null });
    expect(classify({ sources: from(804, 800) })).toEqual({ ruleset: "unstated", book: "Eberron: Rising from the Last War" });
    expect(classify({})).toEqual({ ruleset: "unstated", book: null });
  });

  it("tolerates null markers and null source IDs without duplicating books", () => {
    expect(classify({ isHomebrew: null, isLegacy: null, sourceId: null, sources: null })).toEqual({ ruleset: "unstated", book: null });
    expect(classify({ sources: [{ sourceId: null }, { sourceId: 2 }] })).toEqual({ ruleset: "2014", book: "Player's Handbook (2014)" });
    expect(classify({ sourceId: 800, sources: from(800, 800) })).toEqual({ ruleset: "unstated", book: "Eberron: Rising from the Last War" });
    expect(classify({ sources: [null, { sourceId: 2 }] } as unknown as EditionMarkers)).toEqual({ ruleset: "2014", book: "Player's Handbook (2014)" });
    expect(classify({ sources: [undefined] } as unknown as EditionMarkers)).toEqual({ ruleset: "unstated", book: null });
  });

  it("verified live source IDs (spec: named cases)", () => {
    expect(classify({ sources: from(1) }).ruleset).toBe("2014");          // BR
    expect(classify({ sources: from(145) }).ruleset).toBe("2024");        // PHB-2024
    expect(classify({ sources: from(148, 1) }).ruleset).toBe("2024");     // br-2024 + BR
    expect(classify({ sources: from(193) }).ruleset).toBe("third-party"); // TCMP1
  });
});
