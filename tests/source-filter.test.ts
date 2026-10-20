import { describe, it, expect } from "vitest";
import { buildSourceIndex } from "../src/edition.js";
import {
  resolveSource, sourceLabel, inSources, entrySourceIds, unknownSourceError, GENERIC_SOURCE_HINT,
} from "../src/source-filter.js";

const index = buildSourceIndex(
  [
    { id: 1, name: "BR", description: "Basic Rules (2014)", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 1 },
    { id: 30, name: "BR2", description: "Basic Rules Extras", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 1 },
    { id: 31, name: "BR3", description: "Basic Rules Appendix", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 1 },
    { id: 145, name: "PHB'24", description: "Player's Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 40 },
  ],
  [{ id: 1, name: "Core Rules" }, { id: 40, name: "5.5e Core Rules" }],
);

describe("resolveSource", () => {
  it("returns every id sharing a slug, with the lowest id's book", () => {
    const r = resolveSource(index, "basic-rules-2014");
    expect(r?.ids).toEqual([1, 30, 31]);
    expect(r?.book).toBe(index.sources.get(1)!.book);
  });
  it("matches slugs case-insensitively and titles", () => {
    expect(resolveSource(index, "PHB-2024")?.ids).toEqual([145]);
    expect(resolveSource(index, "Player's Handbook")?.ids).toEqual([145]);
  });
  it("returns null for an unknown source", () => {
    expect(resolveSource(index, "nope")).toBeNull();
  });
});

describe("named entities in source descriptions", () => {
  const idx = buildSourceIndex(
    [{ id: 7, name: "DMG", description: "Dungeon Master&rsquo;s Guide", sourceURL: "sources/dnd/dmg-2014", sourceCategoryId: 1 }],
    [{ id: 1, name: "Core Rules" }],
  );
  it("resolves a title written with a named entity and labels it decoded", () => {
    expect(resolveSource(idx, "Dungeon Master’s Guide")?.ids).toEqual([7]);
    expect(sourceLabel(idx, 7)).toBe("Dungeon Master’s Guide [dmg-2014]");
  });
});

describe("entry sources", () => {
  it("inSources matches any of the entry's sources", () => {
    expect(inSources({ sources: [{ sourceId: 148 }, { sourceId: 1 }] }, [1])).toBe(true);
    expect(inSources({ sourceId: 5 }, [1])).toBe(false);
  });
  it("entrySourceIds dedupes", () => {
    expect(entrySourceIds({ sourceId: 5, sources: [{ sourceId: 5 }, { sourceId: 7 }] })).toEqual([5, 7]);
  });
});

describe("unknownSourceError", () => {
  it("keeps the monster sentence by default and swaps in a hint", () => {
    expect(unknownSourceError(index, "zzz")).toContain("ddb_search_monsters results");
    const generic = unknownSourceError(index, "zzz", GENERIC_SOURCE_HINT);
    expect(GENERIC_SOURCE_HINT).toBe("Pass a book's short code or title, e.g. phb-2024, xgte or \"Player's Handbook\".");
    expect(generic.endsWith(GENERIC_SOURCE_HINT)).toBe(true);
    expect(generic).not.toContain("monsters");
  });
});
