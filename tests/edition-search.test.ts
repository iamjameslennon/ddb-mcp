import { describe, it, expect } from "vitest";
import { buildSourceIndex, definitionTiebreak, normalizeName, type EditionMarkers } from "../src/edition.js";
import { resolveSource, sourceLabel } from "../src/source-filter.js";
import {
  selectCatalog, lookupCatalog, paginateResults, renderSection, plainSection,
  type CatalogAdapter, type CatalogOwner,
} from "../src/tools/edition-search.js";

// The real snapshot ids and categories of the books these tests name.
const INDEX = buildSourceIndex(
  [
    { id: 1, name: "BR", description: "Basic Rules (2014)", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 26 },
    { id: 15, name: "VGtM", description: "Volo's Guide to Monsters", sourceURL: "sources/dnd/vgtm", sourceCategoryId: 23 },
    { id: 85, name: "MotM", description: "Mordenkainen Presents: Monsters of the Multiverse", sourceURL: "sources/dnd/motm", sourceCategoryId: 1 },
    { id: 145, name: "PHB-2024", description: "Player's Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
    { id: 148, name: "br-2024", description: "D&D Beyond Basic Rules", sourceURL: "sources/dnd/br-2024", sourceCategoryId: 24 },
  ],
  [
    { id: 1, name: "5e Expanded Rules" }, { id: 23, name: "Legacy/Noncore" },
    { id: 24, name: "5.5e Core Rules" }, { id: 26, name: "5e Core Rules" },
  ],
);
const VGTM = sourceLabel(INDEX, 15);
const MOTM = sourceLabel(INDEX, 85);

interface Entry { id: number; name: string; isLegacy?: boolean; isHomebrew?: boolean; sources: Array<{ sourceId: number }> }
const entry = (id: number, name: string, sources: number[], opts: { isLegacy?: boolean; isHomebrew?: boolean } = {}): Entry =>
  ({ id, name, ...opts, sources: sources.map(sourceId => ({ sourceId })) });

/** A flat adapter keyed by the entry's own name, with an optional name filter. */
function flat(query?: string): CatalogAdapter<Entry> & { name: (e: Entry) => string } {
  return {
    markers: e => e,
    twinKey: e => normalizeName(e.name),
    tiebreak: definitionTiebreak,
    compare: (a, b) => a.name.localeCompare(b.name),
    nameMatches: query ? e => normalizeName(e.name).includes(query) : undefined,
    name: e => e.name,
  };
}

const GOBLIN_VGTM = entry(3, "Goblin", [15], { isLegacy: true });
const GOBLIN_MOTM = entry(9, "Goblin", [85]);

describe("sections", () => {
  it("renders the non-null parts joined by newlines", () => {
    expect(renderSection({ header: "H", body: "B", footer: null, hidden: 0 })).toBe("H\nB");
    expect(renderSection({ header: "H", body: "B", footer: "F", hidden: 2 })).toBe("H\nB\nF");
    expect(plainSection("x")).toEqual({ header: null, body: "x", footer: null, hidden: 0 });
  });

  it("paginateResults puts the note right after the heading line", () => {
    expect(paginateResults("Thing", ["a", "b"], s => `- ${s}`)).toBe("**Thing Search** (2 found)\n\n- a\n- b");
    expect(paginateResults("Thing", ["a", "b"], s => `- ${s}`, 30, 0, "NOTE")).toBe("**Thing Search** (2 found)\nNOTE\n- a\n- b");
    expect(paginateResults("Thing", [], s => s)).toBe("");
  });
});

describe("selectCatalog, flat mode", () => {
  it("picks the non-Legacy duplicate and names both books", () => {
    expect(MOTM).toBe("Mordenkainen Presents: Monsters of the Multiverse [motm]");
    const sel = selectCatalog([GOBLIN_VGTM, GOBLIN_MOTM], "2024", flat(), INDEX);
    expect(sel.hits.map(h => h.entry)).toEqual([GOBLIN_MOTM]);
    expect(sel.hits[0].label).toBe(`[2014] · ${MOTM} (also in ${VGTM} — pass source to choose)`);
    expect(sel.hidden).toBe(0);
    expect(sel.note).toBeNull();
    expect(sel.header).toBe('Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: "2014" for 2014 versions.');
  });

  it("two same-edition entries from the same book get no book note", () => {
    const sel = selectCatalog([entry(4, "Goblin", [85]), GOBLIN_MOTM], "2024", flat(), INDEX);
    expect(sel.hits.map(h => h.label)).toEqual(["[2014]"]);
  });

  it("an alternative that fails the filters names no other book", () => {
    const sel = selectCatalog([GOBLIN_VGTM, GOBLIN_MOTM], "2024", { ...flat(), passes: e => e.id === GOBLIN_MOTM.id }, INDEX);
    expect(sel.hits.map(h => h.entry)).toEqual([GOBLIN_MOTM]);
    expect(sel.hits[0].label).toBe("[2014]");
  });

  it("bookNotes: false keeps the tag and drops the book note", () => {
    const sel = selectCatalog([GOBLIN_VGTM, GOBLIN_MOTM], "2024", flat(), INDEX, undefined, { bookNotes: false });
    expect(sel.hits.map(h => h.entry)).toEqual([GOBLIN_MOTM]);
    expect(sel.hits[0].label).toBe("[2014]");
  });

  it("counts a twin group whose requested pick fails the filters as hidden, and lists nothing for it", () => {
    const grappler14 = entry(30, "Grappler", [1], { isLegacy: true });
    const grappler24 = entry(31, "Grappler", [145]);
    const passes = (e: Entry) => e.id === grappler14.id;
    const def = selectCatalog([grappler14, grappler24], "2024", { ...flat(), passes }, INDEX);
    expect(def.hits).toEqual([]);
    expect(def.hidden).toBe(1);
    const old = selectCatalog([grappler14, grappler24], "2014", { ...flat(), passes }, INDEX);
    expect(old.hits.map(h => `${h.entry.name} ${h.label}`)).toEqual(["Grappler [2014]"]);
    expect(old.hidden).toBe(0);
  });

  it("hides the other edition's twin and sorts by compare", () => {
    const sel = selectCatalog(
      [entry(20, "Zeta", [145]), entry(11, "Alpha", [1], { isLegacy: true }), entry(21, "Alpha", [145])],
      "2024", flat(), INDEX,
    );
    expect(sel.hits.map(h => `${h.entry.name} ${h.label}`)).toEqual(["Alpha [2024]", "Zeta [2024]"]);
    expect(sel.hidden).toBe(1);
  });

  it("with a source lists only that book's entries, tagged, with the book header and note", () => {
    const source = resolveSource(INDEX, "vgtm")!;
    const sel = selectCatalog([GOBLIN_VGTM, GOBLIN_MOTM], "2024", flat(), INDEX, source);
    expect(sel.hits.map(h => h.entry)).toEqual([GOBLIN_VGTM]);
    expect(sel.hits[0].label).toBe("[2014]");
    expect(sel.header).toBe("Rules: showing every entry in Volo's Guide to Monsters, each tagged with its edition.");
    expect(sel.note).toBe('(source "vgtm" is a 2014 book — rules_edition "2024" was ignored)');
    expect(sel.hidden).toBe(0);
  });

  it("with a source of the requested edition there is no note", () => {
    const source = resolveSource(INDEX, "vgtm")!;
    expect(selectCatalog([GOBLIN_VGTM], "2014", flat(), INDEX, source).note).toBeNull();
  });
});

describe("lookupCatalog", () => {
  it("returns the pick with its rules, reason and also-in lines", () => {
    const found = lookupCatalog([GOBLIN_VGTM, GOBLIN_MOTM], "Goblin", "2024", flat(), INDEX);
    expect(found?.entry).toBe(GOBLIN_MOTM);
    expect(found?.rulesLines).toEqual([
      "Rules: 2014 · Mordenkainen Presents: Monsters of the Multiverse",
      "(no 2024 version found — 2014 text shown)",
      `(also in ${VGTM} — pass source to choose)`,
    ]);
  });

  it("under a source looks only in the book, drops the reason and adds the source note", () => {
    const found = lookupCatalog([GOBLIN_VGTM, GOBLIN_MOTM], "Goblin", "2024", flat(), INDEX, resolveSource(INDEX, "vgtm")!);
    expect(found?.entry).toBe(GOBLIN_VGTM);
    expect(found?.rulesLines).toEqual([
      "Rules: 2014 · Volo's Guide to Monsters",
      '(source "vgtm" is a 2014 book — rules_edition "2024" was ignored)',
    ]);
  });

  it("uses the shown entry's ruleset for the source note", () => {
    // A reprint: the entry is in a 2014 book but is 2024 text, so rules_edition 2024 was honoured.
    const studded = entry(50, "Studded Leather", [148, 1]);
    const found = lookupCatalog([studded], "Studded Leather", "2024", flat(), INDEX, resolveSource(INDEX, "basic-rules-2014")!);
    expect(found?.rulesLines).toEqual(["Rules: 2024 · D&D Beyond Basic Rules"]);
  });

  it("returns null when nothing matches", () => {
    expect(lookupCatalog([GOBLIN_MOTM], "Dragon", "2024", flat(), INDEX)).toBeNull();
    expect(lookupCatalog([GOBLIN_MOTM], "Goblin", "2024", flat(), INDEX, resolveSource(INDEX, "vgtm")!)).toBeNull();
  });
});

describe("selectCatalog, nested mode by groupKey (species)", () => {
  const ELF = entry(1, "Elf", [145]);
  const HIGH = entry(2, "High Elf", [1], { isLegacy: true });
  const WOOD = entry(3, "Wood Elf", [1], { isLegacy: true });
  const species = (query: string): CatalogAdapter<Entry> => ({ ...flat(query), groupKey: () => "elf" });
  const lines = (sel: ReturnType<typeof selectCatalog<Entry>>) => sel.hits.map(h => `${h.entry.name} ${h.label}`);

  it("the 2024 base race replaces the 2014 subraces under the default", () => {
    const sel = selectCatalog([ELF, HIGH, WOOD], "2024", species("elf"), INDEX);
    expect(lines(sel)).toEqual(["Elf [2024]"]);
    expect(sel.hidden).toBe(2);
  });

  it("2014 lists each 2014 subrace", () => {
    const sel = selectCatalog([ELF, HIGH, WOOD], "2014", species("elf"), INDEX);
    expect(lines(sel)).toEqual(["High Elf [2014]", "Wood Elf [2014]"]);
    expect(sel.hidden).toBe(1);
  });

  it("naming the subrace finds it under either edition", () => {
    const sel = selectCatalog([ELF, HIGH, WOOD], "2024", species("high elf"), INDEX);
    expect(lines(sel)).toEqual(["High Elf [2014]"]);
    expect(sel.hidden).toBe(0);
  });
});

describe("selectCatalog, nested mode by owner (features)", () => {
  interface Feature { id: number; name: string; level: number; owner: CatalogOwner; markers: EditionMarkers }
  const owner = (id: string, tiebreakId: number, sources: number[], opts: { isLegacy?: boolean; isHomebrew?: boolean } = {}): CatalogOwner => ({
    id,
    markers: { ...opts, sources: sources.map(sourceId => ({ sourceId })) },
    tiebreak: { id: tiebreakId, ...opts },
  });
  let nextId = 1000;
  const feature = (o: CatalogOwner, name: string, level: number, markers: EditionMarkers = o.markers): Feature =>
    ({ id: nextId++, name, level, owner: o, markers });

  const F14 = owner("c10", 10, [1]);
  const F24 = owner("c20", 20, [145]);
  const FIGHTER = [
    feature(F14, "Ability Score Improvement", 4),
    feature(F14, "Ability Score Improvement", 8),
    feature(F14, "Ability Score Improvement", 19),
    feature(F14, "Natural Explorer", 1),
    feature(F24, "Ability Score Improvement", 4),
    feature(F24, "8: Ability Score Improvement", 8),
  ];
  const features = (query: string, twinKey = (_f: Feature) => "fighter"): CatalogAdapter<Feature> => ({
    markers: f => f.markers,
    twinKey,
    groupKey: () => "fighter",
    owner: f => f.owner,
    tiebreak: (a, b) => a.id - b.id,
    compare: (a, b) => a.level - b.level || a.name.localeCompare(b.name),
    nameMatches: f => normalizeName(f.name).includes(query),
  });
  const lines = (sel: ReturnType<typeof selectCatalog<Feature>>) => sel.hits.map(h => `${h.entry.name} L${h.entry.level} ${h.label}`);

  it("2024 lists only the 2024 class's matching features and counts the 2014 lines", () => {
    const sel = selectCatalog(FIGHTER, "2024", features("ability score"), INDEX);
    expect(lines(sel)).toEqual(["Ability Score Improvement L4 [2024]", "8: Ability Score Improvement L8 [2024]"]);
    expect(sel.hidden).toBe(3);
  });

  it("2014 lists the 2014 class's matching features", () => {
    const sel = selectCatalog(FIGHTER, "2014", features("ability score"), INDEX);
    expect(lines(sel)).toEqual([
      "Ability Score Improvement L4 [2014]", "Ability Score Improvement L8 [2014]", "Ability Score Improvement L19 [2014]",
    ]);
    expect(sel.hidden).toBe(2);
  });

  it("filters first: a feature only the 2014 class has is listed", () => {
    const sel = selectCatalog(FIGHTER, "2024", features("natural explorer"), INDEX);
    expect(lines(sel)).toEqual(["Natural Explorer L1 [2014]"]);
    expect(sel.hidden).toBe(0);
  });

  it("a non-edition owner in the group is always listed and never counted", () => {
    const brew = owner("hb", 5, [], { isHomebrew: true });
    const all = [...FIGHTER, feature(brew, "Ability Score Improvement", 4)];
    for (const requested of ["2024", "2014"] as const) {
      const sel = selectCatalog(all, requested, features("ability score"), INDEX);
      expect(lines(sel)).toContain("Ability Score Improvement L4 [homebrew]");
      expect(sel.hidden).toBe(requested === "2024" ? 3 : 2);
    }
  });

  it("lists the requested edition's owners first, then the other edition's, then non-edition owners", () => {
    const samurai = owner("c10/s1", 1, [1]);
    const brew = owner("hb", 5, [], { isHomebrew: true });
    const all = [
      feature(samurai, "Fighting Spirit", 3),
      feature(brew, "Riposte", 3),
      feature(F24, "Second Wind", 1),
      feature(F24, "Action Surge", 2),
    ];
    // Each owner is its own group, so nothing is hidden; compare alone would interleave them by level.
    const adapter = { ...features(""), groupKey: (f: Feature) => f.owner.id, twinKey: (f: Feature) => f.owner.id };
    expect(lines(selectCatalog(all, "2024", adapter, INDEX))).toEqual([
      "Second Wind L1 [2024]", "Action Surge L2 [2024]", "Fighting Spirit L3 [2014]", "Riposte L3 [homebrew]",
    ]);
    expect(lines(selectCatalog(all, "2014", adapter, INDEX))).toEqual([
      "Fighting Spirit L3 [2014]", "Second Wind L1 [2024]", "Action Surge L2 [2024]", "Riposte L3 [homebrew]",
    ]);
  });

  it("a duplicated owner lists one book's features with the book note on each line", () => {
    const vgtm = owner("r15", 3, [15], { isLegacy: true });
    const motm = owner("r85", 9, [85]);
    const all = [feature(vgtm, "Fury of the Small", 1), feature(motm, "Fury of the Small", 1)];
    const sel = selectCatalog(all, "2024", { ...features("fury"), twinKey: () => "goblin", groupKey: () => "goblin" }, INDEX);
    expect(sel.hits.map(h => h.entry.owner)).toEqual([motm]);
    expect(sel.hits[0].label).toBe(`[2014] · ${MOTM} (also in ${VGTM} — pass source to choose)`);
    expect(sel.hidden).toBe(0);
    const bare = selectCatalog(all, "2024", { ...features("fury"), twinKey: () => "goblin", groupKey: () => "goblin" }, INDEX, undefined, { bookNotes: false });
    expect(bare.hits.map(h => h.label)).toEqual(["[2014]"]);
  });

  it("an optional feature is selected with its owner and tagged by its own sources", () => {
    const o = owner("c30", 30, [145]);
    const sel = selectCatalog([feature(o, "Optional Thing", 3, { sources: [{ sourceId: 1 }] })], "2024", features("optional"), INDEX);
    expect(lines(sel)).toEqual(["Optional Thing L3 [2014]"]);
  });
});

describe("selectCatalog breaks compare ties with the adapter's tiebreak", () => {
  const names = (sel: { hits: Array<{ entry: Entry; label: string }> }) => sel.hits.map(h => `${h.entry.id} ${h.label}`);

  it("flat mode: official before homebrew, then lowest id, whatever the payload order", () => {
    const all = [
      entry(7, "Tiefling", [], { isHomebrew: true }),
      entry(2, "Tiefling", [], { isHomebrew: true }),
      entry(9, "Tiefling", [145]),
    ];
    expect(names(selectCatalog(all, "2024", flat(), INDEX))).toEqual(["9 [2024]", "2 [homebrew]", "7 [homebrew]"]);
    // Across twin groups too: groups come out in payload order, so only the sort can order them.
    const perEntry = { ...flat(), twinKey: (e: Entry) => String(e.id) };
    expect(names(selectCatalog(all, "2024", perEntry, INDEX))).toEqual(["9 [2024]", "2 [homebrew]", "7 [homebrew]"]);
  });

  it("source mode: non-Legacy before Legacy, then lowest id", () => {
    const all = [entry(3, "Goblin", [85], { isLegacy: true }), entry(9, "Goblin", [85]), entry(5, "Goblin", [85])];
    const sel = selectCatalog(all, "2024", flat(), INDEX, resolveSource(INDEX, "motm")!);
    expect(sel.hits.map(h => h.entry.id)).toEqual([5, 9, 3]);
  });

  it("nested mode by groupKey: an official entry before a same-named homebrew one", () => {
    const species: CatalogAdapter<Entry> = { ...flat("elf"), groupKey: () => "elf" };
    const all = [entry(50, "Elf", [], { isHomebrew: true }), entry(1, "Elf", [145])];
    expect(names(selectCatalog(all, "2024", species, INDEX))).toEqual(["1 [2024]", "50 [homebrew]"]);
  });

  it("nested mode by owner: the ruleset band, then compare, then the tiebreak", () => {
    interface Feature { id: number; name: string; level: number; owner: CatalogOwner }
    const owner = (id: string, tiebreakId: number): CatalogOwner =>
      ({ id, markers: { isHomebrew: true, sources: [] }, tiebreak: { id: tiebreakId, isHomebrew: true } });
    const a = owner("hb1", 1);
    const b = owner("hb2", 2);
    const all: Feature[] = [
      { id: 30, name: "Riposte", level: 3, owner: b },
      { id: 20, name: "Riposte", level: 3, owner: a },
      { id: 10, name: "Parry", level: 3, owner: b },
    ];
    const adapter: CatalogAdapter<Feature> = {
      markers: f => f.owner.markers,
      twinKey: f => f.owner.id,
      groupKey: f => f.owner.id,
      owner: f => f.owner,
      tiebreak: (x, y) => x.id - y.id,
      compare: (x, y) => x.level - y.level || x.name.localeCompare(y.name),
    };
    expect(selectCatalog(all, "2024", adapter, INDEX).hits.map(h => h.entry.id)).toEqual([10, 20, 30]);
  });
});
