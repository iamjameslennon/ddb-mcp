import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSourceIndex } from "../src/edition.js";
import { INDEX } from "./fixtures/character-edition-helpers.js";
import { buildFixture } from "./fixtures/library-rsc.js";

const mocks = vi.hoisted(() => ({
  sessionFetch: vi.fn(),
  hasValidSession: vi.fn(() => true),
  getSourceIndex: vi.fn(),
  generation: { n: 1 },
  hooks: [] as Array<() => void>,
}));
vi.mock("../src/session-fetch.js", () => ({
  sessionFetch: mocks.sessionFetch,
  hasValidSession: mocks.hasValidSession,
  captureSession: () => ({ generation: mocks.generation.n }),
  onSessionInvalidated: (cb: () => void) => { mocks.hooks.push(cb); },
}));
vi.mock("../src/game-config.js", () => ({ getSourceIndex: mocks.getSourceIndex }));

import { librarySourceId, libraryBookInfo, tagLibraryBooks, listLibrary, readBook } from "../src/tools/library.js";

describe("librarySourceId", () => {
  it("joins by the slug's last segment", () => {
    expect(librarySourceId({ slug: "dnd/phb-2024", title: null }, INDEX)).toBe(145);
  });
  it("a shared slug prefers the source with an edition", () => {
    expect(librarySourceId({ slug: "dnd/basic-rules-2014", title: null }, INDEX)).toBe(1);
  });
  it("a shared slug with no edition takes the lowest id", () => {
    expect(librarySourceId({ slug: "dnd/ddbd", title: null }, INDEX)).toBe(272);
  });
  it("falls back to the title on the description", () => {
    expect(librarySourceId({ slug: "dnd/not-a-source", title: "Xanathar's Guide to Everything" }, INDEX)).toBe(27);
  });
  it("falls back to the title on the book label", () => {
    expect(librarySourceId({ slug: "", title: "Player's Handbook (2024)" }, INDEX)).toBe(145);
  });
  it("an empty slug never matches an empty sourceURL", () => {
    expect(librarySourceId({ slug: "", title: null }, INDEX)).toBeNull();
  });
  it("an empty slug falls through to the title", () => {
    expect(librarySourceId({ slug: "", title: "Player's Handbook (2014)" }, INDEX)).toBe(2);
  });
  it("a title matching both editions is not guessed", () => {
    const idx = buildSourceIndex([
      { id: 1, name: "A", description: "Dragon Book", sourceURL: null, sourceCategoryId: 24 },
      { id: 2, name: "B", description: "Dragon Book", sourceURL: null, sourceCategoryId: 26 },
    ], []);
    const book = { slug: "", title: "Dragon Book" };
    expect(librarySourceId(book, idx)).toBeNull();
    expect(libraryBookInfo(book, idx)).toEqual({ ruleset: "unstated", book: null });
  });
  it("a slug step whose sources disagree on edition falls through to the title step", () => {
    const idx = buildSourceIndex([
      { id: 1, name: "A", description: "Alpha", sourceURL: "https://www.dndbeyond.com/sources/dnd/shared", sourceCategoryId: 26 },
      { id: 2, name: "B", description: "Beta", sourceURL: "https://www.dndbeyond.com/sources/dnd/shared", sourceCategoryId: 24 },
      { id: 3, name: "C", description: "Gamma Tome", sourceURL: null, sourceCategoryId: 24 },
    ], []);
    expect(librarySourceId({ slug: "dnd/shared", title: "Gamma Tome" }, idx)).toBe(3);
  });
  it("a chapter path joins on its book segment", () => {
    expect(librarySourceId({ slug: "dnd/phb-2024/creating-a-character", title: null }, INDEX)).toBe(145);
  });
  it("the rightmost segment with candidates decides, even over an earlier match", () => {
    const idx = buildSourceIndex([
      { id: 1, name: "A", description: "Alpha", sourceURL: "https://www.dndbeyond.com/sources/dnd/outer", sourceCategoryId: 26 },
      { id: 2, name: "B", description: "Beta", sourceURL: "https://www.dndbeyond.com/sources/dnd/inner", sourceCategoryId: 24 },
    ], []);
    expect(librarySourceId({ slug: "outer/inner/chapter", title: null }, idx)).toBe(2);
  });
  it("a disagreeing rightmost segment stops the walk", () => {
    const mk = (extra: Array<Record<string, unknown>> = []) => buildSourceIndex([
      { id: 1, name: "A", description: "Alpha", sourceURL: "https://www.dndbeyond.com/sources/dnd/shared", sourceCategoryId: 26 },
      { id: 2, name: "B", description: "Beta", sourceURL: "https://www.dndbeyond.com/sources/dnd/shared", sourceCategoryId: 24 },
      { id: 3, name: "C", description: "Gamma", sourceURL: "https://www.dndbeyond.com/sources/dnd/phb-x", sourceCategoryId: 24 },
      ...extra,
    ] as never, []);
    expect(librarySourceId({ slug: "dnd/phb-x/shared", title: null }, mk())).toBeNull();
    const idx = mk([{ id: 4, name: "D", description: "Delta Tome", sourceURL: null, sourceCategoryId: 24 }]);
    expect(librarySourceId({ slug: "dnd/phb-x/shared", title: "Delta Tome" }, idx)).toBe(4);
  });
  it("no join", () => {
    expect(librarySourceId({ slug: "dnd/nope", title: "Nope" }, INDEX)).toBeNull();
  });
});

describe("tagLibraryBooks", () => {
  it("tags each listed book", () => {
    const tagged = tagLibraryBooks([
      { title: "Player's Handbook (2024)", slug: "dnd/phb-2024", ownership: "Owned" },
      { title: "Xanathar's Guide to Everything", slug: "dnd/xgte", ownership: "Owned" },
      { title: "Nope", slug: "dnd/nope", ownership: "Owned" },
    ], INDEX);
    expect(tagged.map(b => b.edition)).toEqual(["[2024]", "[2014]", "[edition not stated]"]);
  });
});

const LIBRARY_RE = /\/library\?/;
function route(sources: Array<Record<string, unknown>>, libraryStatus = 200) {
  mocks.sessionFetch.mockImplementation(async (url: unknown) => {
    const u = String(url);
    if (LIBRARY_RE.test(u)) {
      return libraryStatus === 200
        ? new Response(buildFixture(sources), { status: 200 })
        : new Response("err", { status: libraryStatus, statusText: "Server Error" });
    }
    if (u.includes("/sources/")) return new Response("<html><article><p>Text</p></article></html>", { status: 200 });
    return new Response("", { status: 404 });
  });
}
const PHB = { name: "Player's Handbook (2024)", relativePath: "/sources/dnd/phb-2024", isOwned: true };
const libCalls = () => mocks.sessionFetch.mock.calls.filter(c => LIBRARY_RE.test(String(c[0])));

describe("library tools", () => {
  beforeEach(() => {
    mocks.sessionFetch.mockReset();
    mocks.hasValidSession.mockReturnValue(true);
    mocks.getSourceIndex.mockReset().mockImplementation(async () => INDEX);
    mocks.hooks.forEach(h => h());
  });

  it("readBook resolves a title without tagging the library", async () => {
    route([{ name: "Xanathar's Guide to Everything", relativePath: "/sources/not-a-source", isOwned: true }]);
    await readBook("xanathar");
    expect(mocks.getSourceIndex).toHaveBeenCalledTimes(1);
  });
  it("two reads of an unjoined slug fetch the library page once", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    await readBook("dnd/old-phb");
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(1);
  });
  it("a session change drops the library cache", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    await readBook("dnd/old-phb");
    mocks.generation.n += 1;
    mocks.hooks.forEach(h => h());
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(2);
  });
  it("a failed library fetch is not cached", async () => {
    route([], 500);
    await readBook("dnd/old-phb");
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    const out = await readBook("dnd/old-phb");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
  });

  it("readBook puts a rules line under the title", async () => {
    route([PHB]);
    const out = await readBook("dnd/phb-2024");
    expect(out.startsWith("# dnd/phb-2024\nRules: 2024 · Player's Handbook (2024)\nURL: https://www.dndbeyond.com/sources/dnd/phb-2024\n\n")).toBe(true);
  });
  it("readBook by title uses the library title as fallback", async () => {
    route([{ name: "Xanathar's Guide to Everything", relativePath: "/sources/not-a-source", isOwned: true }]);
    const out = await readBook("xanathar");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Xanathar's Guide to Everything");
  });
  it("readBook by slug falls back to the library title when the slug doesn't join", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    const out = await readBook("dnd/old-phb");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
  });
  it("readBook with a chapter path labels the book", async () => {
    route([PHB]);
    const out = await readBook("dnd/phb-2024/creating-a-character");
    expect(out.split("\n")[1]).toBe("Rules: 2024 · Player's Handbook (2024)");
  });
  it("readBook title fallback matches a chapter path's book by prefix", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    const out = await readBook("dnd/old-phb/chapter-1");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
  });
  it("readBook fallback: the longest matching slug wins", async () => {
    route([
      { name: "Xanathar's Guide to Everything", relativePath: "/sources/dnd/old", isOwned: true },
      { name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old/phb", isOwned: true },
    ]);
    const out = await readBook("dnd/old/phb/ch-1");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
  });
  it("readBook fallback: a prefix must end at a path boundary", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-ph", isOwned: true }]);
    const out = await readBook("dnd/old-phb/ch-1");
    expect(out.split("\n")[1]).toBe("Rules: edition not stated");
  });
  it("readBook fallback: a book with an empty slug is skipped", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/elsewhere/phb", isOwned: true }]);
    const out = await readBook("dnd/nope/ch-1");
    expect(out.split("\n")[1]).toBe("Rules: edition not stated");
  });
  it("readBook by slug skips the library when the slug joins", async () => {
    route([PHB]);
    await readBook("dnd/phb-2024");
    expect(libCalls()).toHaveLength(0);
  });
  it("readBook by slug survives a failed library fetch", async () => {
    route([], 500);
    const out = await readBook("dnd/old-phb");
    expect(out.split("\n")[1]).toBe("Rules: edition not stated");
    expect(out).toContain("Text");
  });
  it("listLibrary adds an edition to each book", async () => {
    route([PHB]);
    expect(JSON.parse(await listLibrary()).books[0].edition).toBe("[2024]");
  });
});
