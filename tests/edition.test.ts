import { describe, it, expect } from "vitest";
import {
  buildSourceIndex, categoryRuleset, classifyEdition, KNOWN_CATEGORY_IDS,
  normalizeName, createTwinNamer, classFeatureTwinKey, racialTraitTwinKey,
  dedupeById, definitionTiebreak, monsterTiebreak,
  selectByEdition, lookupByName, groupAndSelect,
  rulesLine, renameLine, sourceNote, editionTag, searchHeader, searchFooter, ambiguityMessage,
  characterMainEdition, characterTag, characterRulesLine,
  type CategoryRecord, type CharacterEditionEntry, type CharacterEntryKind,
  type EditionInfo, type EditionMarkers, type Ruleset, type SourceRecord,
} from "../src/edition.js";
import { EDITION_RENAMES } from "../src/edition-renames.js";

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

// ── Twin names ────────────────────────────────────────────────────────────────

describe("twin names", () => {
  const twin = createTwinNamer([["Acid Arrow", "Melf’s Acid Arrow"]]);

  it("normalizes case, curly apostrophes and whitespace", () => {
    expect(normalizeName("  Melf’s   ACID\tArrow ")).toBe("melf's acid arrow");
  });

  it("maps a 2014 name to the normalized 2024 name; the 2024 side is canonical", () => {
    expect(twin("  ACID   arrow ")).toBe("melf's acid arrow");
    expect(twin("Melf's Acid Arrow")).toBe("melf's acid arrow");
    expect(twin("Fireball")).toBe("fireball");
  });

  it("keys class features and racial traits by owner + name", () => {
    expect(classFeatureTwinKey("Paladin", "Extra Attack", twin)).not.toBe(classFeatureTwinKey("Fighter", "Extra Attack", twin));
    expect(classFeatureTwinKey(" fighter", "EXTRA  attack", twin)).toBe("fighter/extra attack");
    expect(racialTraitTwinKey("Elf", "Darkvision", twin)).not.toBe(racialTraitTwinKey("Dwarf", "Darkvision", twin));
    expect(racialTraitTwinKey("Elf", "Fey Ancestry", twin)).toBe("elf/fey ancestry");
  });
});

describe("EDITION_RENAMES table", () => {
  const pairs = EDITION_RENAMES.map(([a, b]) => [normalizeName(a), normalizeName(b)] as const);

  it("maps each 2014 name once", () => {
    expect(new Set(pairs.map(([a]) => a)).size).toBe(pairs.length);
  });

  it("never maps a name to itself", () => {
    for (const [a, b] of pairs) expect(a).not.toBe(b);
  });

  it("has no chains: no 2024 name is also a 2014 name", () => {
    const olds = new Set(pairs.map(([a]) => a));
    for (const [, b] of pairs) expect(olds.has(b)).toBe(false);
  });
});

// ── Selection fixtures ────────────────────────────────────────────────────────

type E = { id: number; name: string; r: Ruleset; isHomebrew?: boolean; conc?: boolean };
const e = (id: number, name: string, r: Ruleset, extra: Partial<E> = {}): E => ({ id, name, r, ...extra });
const infoOf = (c: E): EditionInfo => ({ ruleset: c.r, book: null });
const ids = (xs: Array<{ entry: E }>) => xs.map(x => x.entry.id);

describe("tiebreaks", () => {
  it("dedupes by definition id, keeping the first", () => {
    expect(dedupeById([e(1, "A", "2024"), e(2, "B", "2024"), e(1, "A again", "2024")]).map(x => x.name)).toEqual(["A", "B"]);
  });

  it("definitions: official before homebrew, then lowest id", () => {
    const sorted = [e(9, "X", "2024", { isHomebrew: true }), e(7, "X", "2024"), e(3, "X", "2024")].sort(definitionTiebreak);
    expect(sorted.map(x => x.id)).toEqual([3, 7, 9]);
  });

  it("monsters: official → Core Rules book → lowest id", () => {
    const tiebreak = monsterTiebreak(INDEX);
    const monsters = [
      { id: 3, sourceId: 147, isHomebrew: true },
      { id: 9, sourceId: 6 },      // Curse of Strahd — not a Core Rules category
      { id: 20, sourceId: 147 },   // MM-2024 — "5.5e Core Rules"
      { id: 12, sourceId: 5 },     // MM 2014 — "5e Core Rules"
      { id: 1, sourceId: null },
    ];
    expect([...monsters].sort(tiebreak).map(m => m.id)).toEqual([12, 20, 1, 9, 3]);
  });
});

describe("selectByEdition (spec: selection table)", () => {
  const S24 = e(1, "Sleep", "2024");
  const S14 = e(2, "Sleep", "2014");

  it.each([
    ["2024", [S24, S14], 1, undefined],
    ["2024", [S24], 1, undefined],
    ["2024", [S14], 2, "no-2024-version"],
    ["2014", [S24, S14], 2, undefined],
    ["2014", [S14], 2, undefined],
    ["2014", [S24], 1, "no-2014-version"],
  ] as const)("requested %s from %j → id %i, reason %s", (requested, group, id, reason) => {
    const picked = selectByEdition(group, requested, infoOf, definitionTiebreak);
    expect(picked?.entry.id).toBe(id);
    expect(picked?.reason).toBe(reason);
  });

  it("an edition entry beats a non-edition one, whatever the ids", () => {
    expect(selectByEdition([e(1, "Fireball", "homebrew", { isHomebrew: true }), e(5, "Fireball", "2014")], "2024", infoOf, definitionTiebreak))
      .toEqual({ entry: e(5, "Fireball", "2014"), reason: "no-2024-version" });
  });

  it("a group with no edition entries yields its first non-edition entry by tiebreak", () => {
    const picked = selectByEdition([e(1, "Hex Blade", "homebrew", { isHomebrew: true }), e(9, "Hex Blade", "third-party")], "2014", infoOf, definitionTiebreak);
    expect(picked).toEqual({ entry: e(9, "Hex Blade", "third-party") });
  });

  it("two same-edition entries resolve by tiebreak", () => {
    expect(selectByEdition([e(7, "Zombie", "2024"), e(3, "Zombie", "2024")], "2024", infoOf, definitionTiebreak)?.entry.id).toBe(3);
  });

  it("an edition entry beats a homebrew one under the other edition too", () => {
    expect(selectByEdition([e(1, "Fireball", "2024"), e(5, "Fireball", "homebrew", { isHomebrew: true })], "2014", infoOf, definitionTiebreak))
      .toEqual({ entry: e(1, "Fireball", "2024"), reason: "no-2014-version" });
  });

  it("an empty group yields null", () => {
    expect(selectByEdition([], "2024", infoOf, definitionTiebreak)).toBeNull();
  });
});

// ── Single lookups (spec: gather algorithm) ───────────────────────────────────

describe("lookupByName", () => {
  const twin = createTwinNamer([["Acid Arrow", "Melf's Acid Arrow"]]);
  const SPELLS = [
    e(1, "Acid Arrow", "2014"),
    e(2, "Melf's Acid Arrow", "2024"),
    e(3, "Sleep", "2014"),
    e(4, "Sleep", "2024"),
    e(5, "Toll the Dead", "2014"),
    e(6, "Fireball", "2024"),
    e(7, "Fireball", "2014"),
    e(8, "Fireball", "homebrew", { isHomebrew: true }),
  ];
  const opts = { name: (c: E) => c.name, info: infoOf, tiebreak: definitionTiebreak, twinName: twin };
  const find = (q: string, requested: "2024" | "2014" = "2024", extra = {}) => lookupByName(SPELLS, q, requested, { ...opts, ...extra });

  it("exact: 2024 by default, 2014 on request", () => {
    expect(find("sleep")).toEqual({ entry: SPELLS[3] });
    expect(find("Sleep", "2014")).toEqual({ entry: SPELLS[2] });
  });

  it("exact: an official edition entry beats a same-named homebrew one", () => {
    expect(find("Fireball")?.entry.id).toBe(6);
  });

  it("2014-only entry under the default carries the reason", () => {
    expect(find("Toll the Dead")).toEqual({ entry: SPELLS[4], reason: "no-2024-version" });
  });

  it("exact via the rename table reaches the 2024 group and reports the rename", () => {
    expect(find("acid arrow")).toEqual({ entry: SPELLS[1], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
    expect(find("Acid Arrow", "2014")).toEqual({ entry: SPELLS[0] });
    expect(find("Melf's Acid Arrow", "2014")).toEqual({ entry: SPELLS[0], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
  });

  it("normalizes curly apostrophes and stray whitespace in the query", () => {
    expect(find("  melf’s   acid arrow ")).toEqual({ entry: SPELLS[1] });
  });

  it("partial: first match in array order, then its whole group", () => {
    expect(find("toll")).toEqual({ entry: SPELLS[4], reason: "no-2024-version" });
    expect(find("fire")?.entry.id).toBe(6);
    expect(find("acid arr")).toEqual({ entry: SPELLS[1], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
  });

  it("uses the tool's own partial-match order when given", () => {
    const fuzzy = { partialMatch: (all: readonly E[]) => all.find(c => c.id === 3) };
    expect(find("slep", "2024", fuzzy)).toEqual({ entry: SPELLS[3] });
    expect(find("slep", "2014", fuzzy)).toEqual({ entry: SPELLS[2] });
  });

  it("R1a: a query matching no entry takes the table's 2024 spelling for the 2014 side", () => {
    const lone = [e(2, "Melf's Acid Arrow", "2024")];
    expect(lookupByName(lone, "  ACID   arrow ", "2024", opts))
      .toEqual({ entry: lone[0], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
  });

  it("R1b: the mirror takes the table's spelling for the 2024 side, with the reason kept", () => {
    const lone = [e(1, "Acid Arrow", "2014")];
    expect(lookupByName(lone, "Melf’s ACID arrow", "2014", opts))
      .toEqual({ entry: lone[0], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
    expect(lookupByName(lone, "Melf’s ACID arrow", "2024", opts))
      .toEqual({ entry: lone[0], reason: "no-2024-version", renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
  });

  it("R1c: without a spell lookup, the fallback is the cleaned query with its casing kept", () => {
    const plain = (n: string) => createTwinNamer([["Acid Arrow", "Melf's Acid Arrow"]])(n);
    const lone = [e(2, "Melf's Acid Arrow", "2024")];
    expect(lookupByName(lone, "  acid   arrow ", "2024", { ...opts, twinName: plain }))
      .toEqual({ entry: lone[0], renamed: { name2014: "acid arrow", name2024: "Melf's Acid Arrow" } });
    expect(lookupByName(lone, "  ACID   arrow ", "2024", { ...opts, twinName: plain })?.renamed?.name2014).toBe("ACID arrow");
  });

  it("R2: two homebrew entries in a rename pair never get a rename line", () => {
    const homebrew = [e(21, "Acid Arrow", "homebrew", { isHomebrew: true }), e(22, "Melf's Acid Arrow", "homebrew", { isHomebrew: true })];
    const picked = lookupByName(homebrew, "Melf's Acid Arrow", "2024", opts);
    expect(picked?.entry.id).toBe(21);
    expect(picked).not.toHaveProperty("renamed");
  });

  it("an empty or unmatched query yields null", () => {
    expect(find("")).toBeNull();
    expect(find("   ")).toBeNull();
    expect(find("Wish")).toBeNull();
  });
});

// ── Searches (spec: search pipeline) ──────────────────────────────────────────

describe("groupAndSelect", () => {
  const twin = createTwinNamer([["Feeblemind", "Befuddlement"]]);
  const ALL = [
    e(10, "Barkskin", "2014", { conc: true }),
    e(11, "Barkskin", "2024", { conc: false }),
    e(12, "Bless", "2014", { conc: true }),
    e(13, "Bless", "2024", { conc: true }),
    e(14, "Toll the Dead", "2014", { conc: false }),
    e(15, "Feeblemind", "2014", { conc: false }),
    e(16, "Befuddlement", "2024", { conc: false }),
    e(17, "Bless", "homebrew", { isHomebrew: true, conc: true }),
    e(18, "Moonbeam", "2024", { conc: true }),
  ];
  const base = { info: infoOf, twinKey: (c: E) => twin(c.name), tiebreak: definitionTiebreak };
  const search = (requested: "2024" | "2014", extra: { nameMatches?: (c: E) => boolean; passes?: (c: E) => boolean } = {}) =>
    groupAndSelect(ALL, requested, { ...base, ...extra });

  it("default: one 2024 entry per twin group, non-edition entries kept, other edition counted", () => {
    const { selected, hidden } = search("2024");
    expect(ids(selected)).toEqual([11, 13, 17, 14, 16, 18]);
    expect(hidden).toBe(3);
    expect(selected.find(s => s.entry.id === 14)).toMatchObject({ reason: "no-2024-version", info: { ruleset: "2014" } });
  });

  it("2014 requested: the mirror image", () => {
    const { selected, hidden } = search("2014");
    expect(ids(selected)).toEqual([10, 12, 17, 14, 15, 18]);
    expect(hidden).toBe(3);
    expect(selected.find(s => s.entry.id === 18)?.reason).toBe("no-2014-version");
  });

  it("name filter matches a group when any member matches (feeble → Befuddlement)", () => {
    const { selected, hidden } = search("2024", { nameMatches: c => normalizeName(c.name).includes("feeble") });
    expect(ids(selected)).toEqual([16]);
    expect(hidden).toBe(1);
  });

  it("a twin counts as hidden even when only the other member matches the name: switching editions shows it", () => {
    // "befud" matches only 2024 Befuddlement, yet rules_edition "2014" would list
    // Feeblemind for this query (the group matches), so the footer is truthful.
    expect(search("2024", { nameMatches: c => normalizeName(c.name).includes("befud") })).toMatchObject({ hidden: 1 });
    expect(ids(search("2014", { nameMatches: c => normalizeName(c.name).includes("befud") }).selected)).toEqual([15]);
  });

  it("attribute filters apply to the selected entry; a 2014-only match is still hidden and not counted", () => {
    const { selected, hidden } = search("2024", { passes: c => c.conc === true });
    expect(ids(selected)).toEqual([13, 17, 18]); // 2024 Barkskin isn't concentration → whole group dropped
    expect(hidden).toBe(1);                       // only 2014 Bless: it passes and its group survived
  });

  it("hidden counts only other-edition entries that pass the filters", () => {
    const { selected, hidden } = search("2014", { passes: c => c.conc === true });
    expect(ids(selected)).toEqual([10, 12, 17, 18]);
    expect(hidden).toBe(1); // 2024 Bless; 2024 Barkskin fails the filter
  });

  it("homebrew/third-party are never hidden and never counted", () => {
    const only = [e(19, "Blood Curse", "homebrew", { isHomebrew: true }), e(20, "Blood Curse", "third-party")];
    for (const requested of ["2024", "2014"] as const) {
      const { selected, hidden } = groupAndSelect(only, requested, base);
      expect(ids(selected)).toEqual([20, 19]);
      expect(hidden).toBe(0);
    }
  });

  it("R-f: a homebrew entry is still emitted when its group's edition pick fails the attribute filter", () => {
    const set = [e(40, "Hex", "2024", { conc: false }), e(41, "Hex", "homebrew", { isHomebrew: true, conc: true })];
    const { selected, hidden } = groupAndSelect(set, "2024", { ...base, passes: c => c.conc === true });
    expect(ids(selected)).toEqual([41]);
    expect(hidden).toBe(0);
  });

  it("same-edition duplicates in one group show once and are not counted as hidden", () => {
    const { selected, hidden } = groupAndSelect([e(30, "Zombie", "2024"), e(25, "Zombie", "2024")], "2024", base);
    expect(ids(selected)).toEqual([25]);
    expect(hidden).toBe(0);
  });
});

// ── Labels (spec: "Label formats") ────────────────────────────────────────────

const info = (ruleset: Ruleset, book: string | null = null): EditionInfo => ({ ruleset, book });

describe("rulesLine", () => {
  it.each([
    [info("2024", "Player's Handbook (2024)"), "Rules: 2024 · Player's Handbook (2024)"],
    [info("2014", "Xanathar's Guide to Everything"), "Rules: 2014 · Xanathar's Guide to Everything"],
    [info("2024"), "Rules: 2024"],
    [info("third-party", "Critical Role"), "Rules: third-party · Critical Role (edition not stated)"],
    [info("third-party"), "Rules: third-party (edition not stated)"],
    [info("homebrew"), "Rules: homebrew (edition not stated)"],
    [info("homebrew", "ignored"), "Rules: homebrew (edition not stated)"],
    [info("playtest", "Unearthed Arcana"), "Rules: playtest · Unearthed Arcana"],
    [info("unstated", "Eberron: Rising from the Last War"), "Rules: edition not stated · Eberron: Rising from the Last War"],
    [info("unstated"), "Rules: edition not stated"],
  ])("%j → %s", (i, expected) => {
    expect(rulesLine(i)).toBe(expected);
  });

  it("Open5e: the SRD replaces the book, with the fallback reason", () => {
    expect(rulesLine(info("2024", "x"), { open5e: "unavailable" })).toBe("Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)");
    expect(rulesLine(info("2024"), { open5e: "not-found" })).toBe("Rules: 2024 · SRD 5.2 (Open5e fallback — not found on D&D Beyond)");
    expect(rulesLine(info("2014"), { open5e: "unavailable" })).toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)");
    expect(rulesLine(info("2014"), { open5e: "not-found" })).toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)");
    expect(rulesLine(info("2024"), { open5e: "primary" })).toBe("Rules: 2024 · SRD 5.2");
    expect(rulesLine(info("2014"), { open5e: "primary" })).toBe("Rules: 2014 · SRD 5.1");
  });

  it("Open5e origin is ignored for a non-edition ruleset", () => {
    expect(rulesLine(info("homebrew"), { open5e: "primary" })).toBe("Rules: homebrew (edition not stated)");
  });

  it("Open5e origin is dropped for every non-edition ruleset, whatever the origin", () => {
    const cases: Array<[EditionInfo, string]> = [
      [info("homebrew"), "Rules: homebrew (edition not stated)"],
      [info("playtest", "Unearthed Arcana"), "Rules: playtest · Unearthed Arcana"],
      [info("third-party", "Critical Role"), "Rules: third-party · Critical Role (edition not stated)"],
      [info("unstated", "Eberron: Rising from the Last War"), "Rules: edition not stated · Eberron: Rising from the Last War"],
    ];
    for (const [i, expected] of cases) {
      expect(rulesLine(i, { open5e: "unavailable" })).toBe(expected);
      expect(rulesLine(i, { open5e: "not-found" })).toBe(expected);
      expect(rulesLine(i)).toBe(expected);
    }
  });

  it("appends the reason on the next line", () => {
    const xge = info("2014", "Xanathar's Guide to Everything");
    expect(rulesLine(xge, { reason: "no-2024-version" })).toBe("Rules: 2014 · Xanathar's Guide to Everything\n(no 2024 version exists — 2014 text shown)");
    expect(rulesLine(info("2024", "Player's Handbook (2024)"), { reason: "no-2014-version" })).toBe("Rules: 2024 · Player's Handbook (2024)\n(no 2014 version exists — 2024 text shown)");
    expect(rulesLine(info("2014"), { open5e: "primary", reason: "rules-miss-2024" })).toBe("Rules: 2014 · SRD 5.1\n(no matching 2024 rules section — 2014 text shown)");
    expect(rulesLine(info("2024"), { open5e: "primary", reason: "rules-miss-2014" })).toBe("Rules: 2024 · SRD 5.2\n(no matching 2014 rules section — 2024 text shown)");
    expect(rulesLine(info("2024", "Dungeon Master's Guide (2024)"), { reason: "treasure-no-2014" })).toBe("Rules: 2024 · Dungeon Master's Guide (2024)\n(no 2014 version exists — 2024 tables used)");
  });
});

describe("other single-lookup lines", () => {
  it("renameLine", () => {
    expect(renameLine("Acid Arrow", "Melf's Acid Arrow")).toBe("(2014 name: Acid Arrow · 2024 name: Melf's Acid Arrow)");
  });

  it("sourceNote: only when the book's edition differs from the request", () => {
    expect(sourceNote("mm-2024", "2024", "2014")).toBe(`(source "mm-2024" is a 2024 book — rules_edition "2014" was ignored)`);
    expect(sourceNote("mm-2014", "2014", "2024")).toBe(`(source "mm-2014" is a 2014 book — rules_edition "2024" was ignored)`);
    expect(sourceNote("mm-2024", "2024", "2024")).toBeNull();
    expect(sourceNote("mm-2014", "2014", "2014")).toBeNull();
  });

  it("ambiguityMessage", () => {
    expect(ambiguityMessage("Red Dragon", [
      { name: "Red Dragon Wyrmling", cr: "4" },
      { name: "Young Red Dragon", cr: "10" },
      { name: "Adult Red Dragon", cr: "17" },
      { name: "Ancient Red Dragon", cr: "24" },
    ])).toBe(`Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Young Red Dragon (CR 10), Adult Red Dragon (CR 17), Ancient Red Dragon (CR 24) — use the full name.`);
  });
});

describe("search labels", () => {
  it.each([
    ["2024", "[2024]"], ["2014", "[2014]"], ["third-party", "[third-party]"],
    ["homebrew", "[homebrew]"], ["playtest", "[playtest]"], ["unstated", "[edition not stated]"],
  ] as const)("editionTag %s → %s", (ruleset, tag) => {
    expect(editionTag(info(ruleset, "any book"))).toBe(tag);
  });

  it("searchHeader", () => {
    expect(searchHeader({ requested: "2024" })).toBe(`Rules: 2024 by default — 2014 entries appear only where no 2024 version exists. Use rules_edition: "2014" for 2014 versions.`);
    expect(searchHeader({ requested: "2014" })).toBe("Rules: 2014 requested — 2024 entries appear only where no 2014 version exists.");
    expect(searchHeader({ sourceBook: "Monster Manual (2024)" })).toBe("Rules: showing every entry in Monster Manual (2024), each tagged with its edition.");
    expect(searchHeader({ rulesDoc: "2024" })).toBe("Rules: sections from SRD 5.2 (2024).");
    expect(searchHeader({ rulesDoc: "2014" })).toBe("Rules: sections from SRD 5.1 (2014).");
  });

  it("searchFooter", () => {
    expect(searchFooter("2024", 14)).toBe(`14 2014 versions hidden — rules_edition: "2014" shows them.`);
    expect(searchFooter("2024", 1)).toBe(`1 2014 version hidden — rules_edition: "2014" shows it.`);
    expect(searchFooter("2014", 3)).toBe("3 2024 versions hidden — omit rules_edition to show them.");
    expect(searchFooter("2014", 1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
    expect(searchFooter("2024", 0)).toBeNull();
    expect(searchFooter("2014", 0)).toBeNull();
  });
});

// ── Character summary (spec: "Characters") ────────────────────────────────────

describe("character edition labels", () => {
  const ent = (name: string, kind: CharacterEntryKind, ruleset: Ruleset, level?: number): CharacterEditionEntry =>
    ({ name, kind, level, info: info(ruleset) });

  it("pure 2024", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Sage", "background", "2024"), ent("Alert", "feat", "2024")];
    expect(characterMainEdition(entries)).toEqual({ main: "2024", mixed: false });
    expect(characterRulesLine(entries)).toBe("Rules: 2024");
  });

  it("2024 with a 2014 background and feat", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Criminal / Spy", "background", "2014"), ent("Sharpshooter", "feat", "2014")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · 2014 content: Criminal / Spy (background), Sharpshooter (feat)");
  });

  it("all-2014 classes make a 2014 character", () => {
    const entries = [ent("Fighter", "class", "2014", 3), ent("Wizard", "class", "2014", 2), ent("Alert", "feat", "2024")];
    expect(characterMainEdition(entries)).toEqual({ main: "2014", mixed: false });
    expect(characterRulesLine(entries)).toBe("Rules: 2014 · 2024 content: Alert (feat)");
  });

  it("mixed-edition multiclass: 2024 is the main edition for tagging", () => {
    const entries = [
      ent("Bard", "class", "2024", 5), ent("Cleric", "class", "2024", 1), ent("Ranger", "class", "2014", 3),
      ent("Sage", "background", "2024"), ent("Sharpshooter", "feat", "2014"),
    ];
    expect(characterMainEdition(entries)).toEqual({ main: "2024", mixed: true });
    expect(characterRulesLine(entries)).toBe("Rules: mixed — 2024: Bard 5, Cleric 1 · 2014: Ranger 3 · 2014 content: Sharpshooter (feat)");
  });

  it("mixed even when the 2014 class is the higher level: 2024 stays the main edition", () => {
    const entries = [ent("Ranger", "class", "2014", 5), ent("Bard", "class", "2024", 1)];
    expect(characterMainEdition(entries)).toEqual({ main: "2024", mixed: true });
    expect(characterRulesLine(entries)).toBe("Rules: mixed — 2024: Bard 1 · 2014: Ranger 5");
  });

  it("non-edition entries get their own groups", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Blood Hunter", "class", "homebrew", 2), ent("Firearm Specialist", "feat", "third-party")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · homebrew: Blood Hunter 2 (class) · third-party: Firearm Specialist (feat)");
  });

  it("a subclass with a different ruleset is listed on its own", () => {
    const entries = [ent("Ranger", "class", "2024", 5), ent("Gloom Stalker", "subclass", "2014")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · 2014 content: Gloom Stalker (subclass)");
  });

  it("no 2014/2024 class: edition not stated, every other group listed", () => {
    const entries = [ent("Blood Hunter", "class", "homebrew", 5), ent("Alert", "feat", "2024"), ent("Mystery", "item", "unstated")];
    expect(characterMainEdition(entries)).toEqual({ main: "unstated", mixed: false });
    expect(characterRulesLine(entries)).toBe("Rules: edition not stated · 2024 content: Alert (feat) · homebrew: Blood Hunter 5 (class)");
  });

  it("unstated entries under an edition get the 'edition not stated' group", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Mystery Trinket", "item", "unstated")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · edition not stated: Mystery Trinket (item)");
  });

  it("characterTag: tag entries that differ from the main edition; non-edition always", () => {
    expect(characterTag(info("2024"), "2024")).toBeNull();
    expect(characterTag(info("2014"), "2024")).toBe("[2014]");
    expect(characterTag(info("homebrew"), "2024")).toBe("[homebrew]");
    expect(characterTag(info("2024"), "unstated")).toBe("[2024]");
    expect(characterTag(info("unstated"), "unstated")).toBe("[edition not stated]");
  });

  it("characterTag: symmetric cases and non-edition tags against a 2014 main edition", () => {
    expect(characterTag(info("2014"), "2014")).toBeNull();
    expect(characterTag(info("playtest"), "2024")).toBe("[playtest]");
    expect(characterTag(info("third-party"), "2014")).toBe("[third-party]");
    expect(characterTag(info("unstated"), "2024")).toBe("[edition not stated]");
  });

  it("empty entry list: edition not stated, nothing listed", () => {
    expect(characterMainEdition([])).toEqual({ main: "unstated", mixed: false });
    expect(characterRulesLine([])).toBe("Rules: edition not stated");
  });

  it("mixed character with a homebrew class: homebrew class listed in its own group", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Ranger", "class", "2014", 3), ent("Blood Hunter", "class", "homebrew", 2)];
    expect(characterRulesLine(entries)).toBe("Rules: mixed — 2024: Bard 5 · 2014: Ranger 3 · homebrew: Blood Hunter 2 (class)");
  });

  it("class without a level: head is plain edition, no number", () => {
    const entries = [ent("Fighter", "class", "2014"), ent("Alert", "feat", "2024")];
    expect(characterRulesLine(entries)).toBe("Rules: 2014 · 2024 content: Alert (feat)");
  });
});
