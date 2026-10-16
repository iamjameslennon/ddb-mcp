import { describe, it, expect } from "vitest";
import {
  buildSourceIndex, categoryRuleset, classifyEdition, KNOWN_CATEGORY_IDS,
  normalizeName, createTwinNamer, classFeatureTwinKey, racialTraitTwinKey,
  dedupeById, definitionTiebreak, monsterTiebreak,
  selectByEdition, lookupByName, groupAndSelect,
  type CategoryRecord, type EditionInfo, type EditionMarkers, type Ruleset, type SourceRecord,
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

  it("same-edition duplicates in one group show once and are not counted as hidden", () => {
    const { selected, hidden } = groupAndSelect([e(30, "Zombie", "2024"), e(25, "Zombie", "2024")], "2024", base);
    expect(ids(selected)).toEqual([25]);
    expect(hidden).toBe(0);
  });
});
