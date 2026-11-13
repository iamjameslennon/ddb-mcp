import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSourceIndex } from "../src/edition.js";
import { SNAPSHOT_CATEGORIES, SNAPSHOT_SOURCES } from "../src/source-snapshot.js";
import { resolveSource } from "../src/source-filter.js";
import { INDEX } from "./fixtures/character-edition-helpers.js";
import { buildFixture } from "./fixtures/library-rsc.js";

const mocks = vi.hoisted(() => ({
  sessionFetch: vi.fn(),
  hasValidSession: vi.fn(() => true),
  getSourceIndex: vi.fn(),
  generation: { n: 1 },
  hooks: [] as Array<() => void>,
  SessionChangedError: class SessionChangedError extends Error {
    constructor() { super("Session changed; the previous credentials were revoked."); this.name = "SessionChangedError"; }
  },
}));
vi.mock("../src/session-fetch.js", () => ({
  sessionFetch: mocks.sessionFetch,
  hasValidSession: mocks.hasValidSession,
  captureSession: () => ({ generation: mocks.generation.n }),
  assertSessionCurrent: (snap: { generation: number }) => {
    if (snap.generation !== mocks.generation.n) throw new mocks.SessionChangedError();
  },
  SessionChangedError: mocks.SessionChangedError,
  onSessionInvalidated: (cb: () => void) => { mocks.hooks.push(cb); },
}));
vi.mock("../src/game-config.js", () => ({ getSourceIndex: mocks.getSourceIndex }));

import { LIBRARY_NOTE_WAIT_MS, isFreeBookSlug, unownedSourceNote, librarySourceId, libraryBookInfo, tagLibraryBooks, listLibrary, readBook, clearLibraryCache, notOwnedMessage } from "../src/tools/library.js";

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
  it("a description with &rsquo; and a hex entity joins its plain-apostrophe title (carry-over af)", () => {
    const idx = buildSourceIndex([
      { id: 1, name: "A", description: "Player&rsquo;s Handbook", sourceURL: null, sourceCategoryId: 24 },
      { id: 2, name: "B", description: "Xanathar&#x2019;s Guide", sourceURL: null, sourceCategoryId: 26 },
    ], []);
    expect(librarySourceId({ slug: "", title: "Player's Handbook" }, idx)).toBe(1);
    expect(librarySourceId({ slug: "", title: "Xanathar's Guide" }, idx)).toBe(2);
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
  it("the invalidation hook alone drops the library cache", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    await readBook("dnd/old-phb");
    mocks.hooks.forEach(h => h());
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(2);
  });
  it("a new generation alone misses the library cache", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    await readBook("dnd/old-phb");
    mocks.generation.n += 1;
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(2);
    mocks.generation.n -= 1;
  });
  it("an empty parse is not cached", async () => {
    route([]);
    await expect(readBook("xanathar")).rejects.toThrow(/No book found/);
    route([{ name: "Xanathar's Guide to Everything", relativePath: "/sources/not-a-source", isOwned: true }]);
    const out = await readBook("xanathar");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Xanathar's Guide to Everything");
    expect(libCalls()).toHaveLength(2);
  });
  it("an account switch while the page is in flight throws and caches nothing under the old key", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const book = { name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true };
    mocks.sessionFetch.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (LIBRARY_RE.test(u)) { await gate; return new Response(buildFixture([book]), { status: 200 }); }
      return new Response("<html><article><p>Text</p></article></html>", { status: 200 });
    });
    const inflight = readBook("dnd/old-phb");
    const joiner = readBook("dnd/old-phb");
    const settled = Promise.allSettled([inflight, joiner]);
    await new Promise(r => setTimeout(r, 0));
    mocks.generation.n += 1;
    release();
    const results = await settled;
    expect(results.map(r => r.status)).toEqual(["rejected", "rejected"]);
    expect(String((results[0] as PromiseRejectedResult).reason)).toMatch(/session changed/i);
    mocks.generation.n -= 1; // back to the old key: it must hold nothing
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(2);
  });
  it("an empty parse after a session change also throws", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    mocks.sessionFetch.mockImplementation(async () => { await gate; return new Response(buildFixture([]), { status: 200 }); });
    const inflight = readBook("xanathar");
    await new Promise(r => setTimeout(r, 0));
    mocks.generation.n += 1;
    release();
    await expect(inflight).rejects.toThrow(/session changed/i);
    mocks.generation.n -= 1;
  });
  it("a clear mid-fetch leaves nothing cached", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const book = { name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true };
    mocks.sessionFetch.mockImplementation(async (url: unknown) => {
      if (LIBRARY_RE.test(String(url))) { await gate; return new Response(buildFixture([book]), { status: 200 }); }
      return new Response("<html><article><p>Text</p></article></html>", { status: 200 });
    });
    const inflight = readBook("dnd/old-phb");
    await new Promise(r => setTimeout(r, 0));
    clearLibraryCache();
    release();
    await inflight;
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(2);
  });
  it("an older entry settling last does not overwrite the newer one", async () => {
    const gates: Array<() => void> = [];
    const v = (title: string) => ({ name: title, relativePath: "/sources/dnd/old-phb", isOwned: true });
    const pages = [[v("Old Title (2014)")], [v("Player's Handbook (2014)")]];
    let n = 0;
    mocks.sessionFetch.mockImplementation(async (url: unknown) => {
      if (LIBRARY_RE.test(String(url))) {
        const i = n++;
        await new Promise<void>(r => { gates[i] = r; });
        return new Response(buildFixture(pages[i]), { status: 200 });
      }
      return new Response("<html><article><p>Text</p></article></html>", { status: 200 });
    });
    const first = readBook("dnd/old-phb");
    await new Promise(r => setTimeout(r, 0));
    clearLibraryCache(); // the first entry is now stale
    const second = readBook("dnd/old-phb");
    await new Promise(r => setTimeout(r, 0));
    gates[1]();
    await second;
    gates[0]();
    await first;
    // The cache holds the newer page, not the older one that settled last.
    const out = await readBook("dnd/old-phb");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
    expect(libCalls()).toHaveLength(2);
  });
  it("concurrent cold reads in one generation share one library fetch", async () => {
    route([{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }]);
    await Promise.all([readBook("dnd/old-phb"), readBook("dnd/old-phb"), readBook("dnd/old-phb")]);
    expect(libCalls()).toHaveLength(1);
  });
  it("a newer generation does not join an older generation's fetch", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const book = { name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true };
    mocks.sessionFetch.mockImplementation(async (url: unknown) => {
      if (LIBRARY_RE.test(String(url))) { if (libCalls().length === 1) await gate; return new Response(buildFixture([book]), { status: 200 }); }
      return new Response("<html><article><p>Text</p></article></html>", { status: 200 });
    });
    const first = readBook("dnd/old-phb");
    await new Promise(r => setTimeout(r, 0));
    mocks.generation.n += 1;
    mocks.hooks.forEach(h => h());
    await readBook("dnd/old-phb");
    expect(libCalls()).toHaveLength(2);
    release();
    await expect(first).rejects.toThrow(/session/i); // the older fetch finished after the switch
    mocks.generation.n -= 1;
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
  it("readBook by slug of an owned book fetches the library once to confirm ownership (F27)", async () => {
    route([PHB]);
    await readBook("dnd/phb-2024");
    expect(libCalls()).toHaveLength(1);
  });
  it("readBook by slug of a free book never needs the library", async () => {
    route([PHB]);
    await readBook("dnd/br-2024");
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

describe("libraryBookInfo: Critical Role books (B12)", () => {
  const idx = buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES);
  it("Frozen Sick is 2014, TCSR stays third-party", () => {
    expect(libraryBookInfo({ slug: "sources/dnd/wa", title: "Frozen Sick" }, idx).ruleset).toBe("2014");
    expect(libraryBookInfo({ slug: "sources/dnd/tcsr", title: "Tal'Dorei Campaign Setting Reborn" }, idx).ruleset).toBe("third-party");
  });
});

describe("unownedSourceNote (F17)", () => {
  const NOTE = (book: string) => `> Note: this account doesn't own ${book}, so D&D Beyond shows only its free entries — this list is not the whole book.`;
  const note = (q: string) => unownedSourceNote(resolveSource(INDEX, q)!, INDEX);

  beforeEach(() => {
    mocks.sessionFetch.mockReset();
    mocks.hasValidSession.mockReturnValue(true);
    mocks.getSourceIndex.mockReset().mockImplementation(async () => INDEX);
    mocks.hooks.forEach(h => h());
  });

  it("isFreeBookSlug matches the last slug segment", () => {
    expect(isFreeBookSlug("basic-rules-2014")).toBe(true);
    expect(isFreeBookSlug("sources/dnd/br-2024")).toBe(true);
    expect(isFreeBookSlug("dnd/phb-2024")).toBe(false);
    expect(isFreeBookSlug("ee")).toBe(true);
  });
  it("an unowned book gets the note", async () => {
    route([PHB]);
    expect(await note("xgte")).toBe(NOTE("Xanathar's Guide to Everything"));
  });
  it("EEPC (no sourceURL, free live 2026-11-12) gets none, without fetching the library", async () => {
    route([PHB]);
    expect(await note("ee")).toBeNull();
    expect(libCalls()).toHaveLength(0);
  });
  it("an owned book gets none", async () => {
    route([PHB]);
    expect(await note("phb-2024")).toBeNull();
  });
  it("a free book gets none, without fetching the library", async () => {
    route([PHB]);
    expect(await note("br-2024")).toBeNull();
    expect(await note("basic-rules-2014")).toBeNull();
    expect(libCalls()).toHaveLength(0);
  });
  it("a failed library fetch gives none", async () => {
    route([], 500);
    expect(await note("xgte")).toBeNull();
  });
  it("an empty library parse gives none", async () => {
    route([]);
    expect(await note("xgte")).toBeNull();
  });
  it("logged out gives none, without fetching", async () => {
    mocks.hasValidSession.mockReturnValue(false);
    route([PHB]);
    expect(await note("xgte")).toBeNull();
    expect(libCalls()).toHaveLength(0);
  });
  it("a session change propagates", async () => {
    mocks.sessionFetch.mockImplementation(async () => { mocks.generation.n++; return new Response(buildFixture([PHB]), { status: 200 }); });
    await expect(note("xgte")).rejects.toThrow("Session changed");
  });

  describe("deadline (M-4)", () => {
    afterEach(() => { vi.useRealTimers(); });
    /** A library page that answers only after `ms`. */
    const slowLibrary = (ms: number, status = 200) => mocks.sessionFetch.mockImplementation((url: unknown) => {
      if (!LIBRARY_RE.test(String(url))) throw new Error(`unexpected ${String(url)}`);
      return new Promise<Response>(resolve => setTimeout(() => resolve(status === 200
        ? new Response(buildFixture([PHB]), { status })
        : new Response("err", { status, statusText: "Server Error" })), ms));
    });

    it("gives none at the deadline when the library is slow, and the search goes on", async () => {
      vi.useFakeTimers();
      slowLibrary(60_000);
      let settled: string | null | undefined;
      const p = note("xgte").then(v => { settled = v; });
      await vi.advanceTimersByTimeAsync(LIBRARY_NOTE_WAIT_MS - 1);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled).toBeNull();
    });

    it("leaves the shared fetch running: once it lands, the next search gets the note from the cache", async () => {
      vi.useFakeTimers();
      slowLibrary(LIBRARY_NOTE_WAIT_MS + 1_000);
      const first = note("xgte");
      await vi.advanceTimersByTimeAsync(LIBRARY_NOTE_WAIT_MS);
      expect(await first).toBeNull();
      // A second search while the page is still in flight joins it rather than fetching again.
      const second = note("xgte");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await second).toBe(NOTE("Xanathar's Guide to Everything"));
      expect(await note("xgte")).toBe(NOTE("Xanathar's Guide to Everything"));
      expect(libCalls()).toHaveLength(1);
    });

    it("an answer inside the deadline still gives the note, and a failure after it gives none and caches nothing", async () => {
      vi.useFakeTimers();
      slowLibrary(LIBRARY_NOTE_WAIT_MS - 1);
      const ok = note("xgte");
      await vi.advanceTimersByTimeAsync(LIBRARY_NOTE_WAIT_MS - 1);
      expect(await ok).toBe(NOTE("Xanathar's Guide to Everything"));

      mocks.hooks.forEach(h => h());
      slowLibrary(LIBRARY_NOTE_WAIT_MS + 1_000, 500);
      const late = note("xgte");
      await vi.advanceTimersByTimeAsync(LIBRARY_NOTE_WAIT_MS + 1_000);
      expect(await late).toBeNull();
      slowLibrary(0);
      const again = note("xgte");
      await vi.advanceTimersByTimeAsync(0);
      expect(await again).toBe(NOTE("Xanathar's Guide to Everything"));
      expect(libCalls()).toHaveLength(3);
    });
  });
});

// ── F27: reading a book the account doesn't own ─────────────────────────────
describe("readBook of an unowned book (F27)", () => {
  const XGTE = { name: "Xanathar's Guide to Everything", relativePath: "/sources/dnd/xgte", isOwned: true };
  const OWNED = [{ title: "Xanathar's Guide to Everything", slug: "dnd/xgte" }];
  const pageCalls = () => mocks.sessionFetch.mock.calls.filter(c => String(c[0]).includes("/sources/"));
  beforeEach(() => {
    mocks.sessionFetch.mockReset();
    mocks.hasValidSession.mockReturnValue(true);
    mocks.getSourceIndex.mockReset().mockImplementation(async () => INDEX);
    mocks.hooks.forEach(h => h());
    route([XGTE]);
  });
  const expected = (title: string) => notOwnedMessage(title, OWNED);

  it("the message format", () => {
    expect(expected("Player's Handbook (2024)")).toBe(
      "You don't own Player's Handbook (2024) on D&D Beyond, so its text can't be read here. Books you can read:\n  • Xanathar's Guide to Everything (dnd/xgte)");
  });
  it("by slug: says so and fetches no page", async () => {
    const out = await readBook("dnd/phb-2024", "playing-the-game");
    expect(out).toBe(expected("Player's Handbook (2024)"));
    expect(pageCalls()).toHaveLength(0);
  });
  it("by title with a straight apostrophe: the 2024 book", async () => {
    expect(await readBook("Player's Handbook")).toBe(expected("Player's Handbook (2024)"));
    expect(pageCalls()).toHaveLength(0);
  });
  it("a free book is fetched although the library lacks it", async () => {
    const out = await readBook("dnd/br-2024");
    expect(out).toContain("URL: https://www.dndbeyond.com/sources/dnd/br-2024");
  });
  it("a slug unknown to the index is fetched as today", async () => {
    expect(await readBook("dnd/no-such-book")).toContain("sources/dnd/no-such-book");
  });
  it("an owned book is fetched", async () => {
    expect(await readBook("dnd/xgte")).toContain("sources/dnd/xgte");
  });
  it("library outage, by slug: fetched", async () => {
    mocks.sessionFetch.mockImplementation(async (url: unknown) =>
      LIBRARY_RE.test(String(url)) ? Promise.reject(new Error("boom")) : new Response("<html><article><p>Text</p></article></html>", { status: 200 }));
    expect(await readBook("dnd/phb-2024")).toContain("sources/dnd/phb-2024");
  });
  it("library outage, by title: resolved through the source index and fetched", async () => {
    mocks.sessionFetch.mockImplementation(async (url: unknown) =>
      LIBRARY_RE.test(String(url)) ? new Response("err", { status: 500, statusText: "x" }) : new Response("<html><article><p>Text</p></article></html>", { status: 200 }));
    expect(await readBook("Player's Handbook")).toContain("sources/dnd/phb-2024");
  });
  it("a session change still propagates", async () => {
    mocks.sessionFetch.mockImplementation(async (url: unknown) => {
      if (LIBRARY_RE.test(String(url))) { mocks.generation.n += 1; return new Response(buildFixture([XGTE]), { status: 200 }); }
      return new Response("", { status: 404 });
    });
    await expect(readBook("dnd/phb-2024")).rejects.toThrow(/session changed/i);
    mocks.generation.n -= 1;
  });
  it("a vague title hitting several different books is no match, not a not-owned message", async () => {
    await expect(readBook("Monster")).rejects.toThrow(/No book found/);
    expect(pageCalls()).toHaveLength(0);
  });
  it("library outage, by a vague title: still the fetch error, no guess", async () => {
    mocks.sessionFetch.mockImplementation(async (url: unknown) =>
      LIBRARY_RE.test(String(url)) ? new Response("err", { status: 500, statusText: "x" }) : new Response("<html></html>", { status: 200 }));
    await expect(readBook("Monster")).rejects.toThrow(/Library fetch failed/);
  });
  it("a title in neither the library nor the index keeps today's error", async () => {
    await expect(readBook("spelljammer zzz")).rejects.toThrow(/No book found/);
  });
});
