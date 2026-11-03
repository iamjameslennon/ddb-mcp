import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOpen5eCache, clearOpen5eCreatures, docKey, loadO5Document, o5GetEquipment, o5SearchItems,
  O5_DOC, O5_DOCUMENT_DEADLINE_MS, O5_FAILURE_TTL_MS, type O5Endpoint, type O5Record,
} from "../src/open5e.js";
import { o5Fixture, o5FixtureFetch, o5Response } from "./fixtures/open5e-v2.js";

const ENDPOINTS: O5Endpoint[] = ["spells", "creatures", "items", "magicitems", "weapons", "armor", "species", "classes", "backgrounds", "feats", "rulesets"];

// The "2024 only" / "2014 only" columns of the recorder's name table, per endpoint.
const ONLY: Record<O5Endpoint, { "2024": string[]; "2014": string[] }> = {
  spells: { "2024": ["Befuddlement", "Shining Smite"], "2014": ["Feeblemind", "Branding Smite"] },
  creatures: { "2024": ["Goblin Warrior", "Goblin Boss", "Allosaurus", "Tough"], "2014": ["Goblin", "Thug", "Orc", "Half-Red Dragon Veteran"] },
  items: { "2024": ["Rope", "Antitoxin", "Alchemist's Fire"], "2014": ["Abacus", "Rope, hempen (50 feet)"] },
  magicitems: { "2024": ["Ammunition (+1)", "Flame Tongue Longsword"], "2014": ["Armor of Resistance (Hide)"] },
  weapons: { "2024": ["Musket"], "2014": ["Net"] },
  armor: { "2024": ["Chain Mail", "Hide Armor", "Shield"], "2014": ["Chain mail", "Hide"] },
  species: { "2024": ["Goliath"], "2014": ["High Elf"] },
  classes: { "2024": ["Evoker"], "2014": ["School of Evocation"] },
  backgrounds: { "2024": ["Sage"], "2014": [] },
  feats: { "2024": ["Alert"], "2014": [] },
  rulesets: { "2024": ["Combat", "D20 Tests", "Social Interaction"], "2014": ["Attacking", "Cover", "Madness"] },
};

const spellsUrl = "https://api.open5e.com/v2/spells/?document__key__in=srd-2024&limit=1000";
const rec = (name: string): O5Record => ({ key: name, name, document: { key: "srd-2024" } });
const json = (body: unknown, status = 200): Response => o5Response(JSON.stringify(body), { status });

beforeEach(() => {
  clearOpen5eCache();
  vi.unstubAllGlobals();
});

afterEach(() => { vi.useRealTimers(); });

describe.each(ENDPOINTS)("%s", endpoint => {
  it.each(["2024", "2014"] as const)("scopes the request to the %s document and sends no other filter", async ed => {
    const fetchMock = vi.fn(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await loadO5Document(endpoint, ed);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe(`/v2/${endpoint}/`);
    expect([...url.searchParams.keys()].sort()).toEqual(["document__key__in", "limit"]);
    expect(url.searchParams.get("document__key__in")).toBe(O5_DOC[ed]);
  });

  it.each(["2024", "2014"] as const)("keeps only %s records when the response mixes documents", async ed => {
    const mixed = [...o5Fixture("srd-2024", endpoint), ...o5Fixture("srd-2014", endpoint)];
    vi.stubGlobal("fetch", vi.fn(o5FixtureFetch({ [`${O5_DOC[ed]}/${endpoint}`]: mixed })));
    const got = await loadO5Document(endpoint, ed);
    expect(got.every(r => docKey(r) === O5_DOC[ed])).toBe(true);
    const own = o5Fixture(O5_DOC[ed], endpoint).map(r => r.name);
    expect(got.length).toBeGreaterThan(0);
    expect(got.map(r => r.name)).toEqual(expect.arrayContaining(own));
    for (const n of ONLY[endpoint][ed]) expect(got.map(r => r.name)).toContain(n);
    for (const n of ONLY[endpoint][ed === "2024" ? "2014" : "2024"]) expect(got.map(r => r.name)).not.toContain(n);
  });
});

describe("spells loader", () => {
  it("follows next until it is null", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ count: 3, next: `${spellsUrl}&page=2`, previous: null, results: [rec("A"), rec("B")] }))
      .mockResolvedValueOnce(json({ count: 3, next: null, previous: null, results: [rec("C")] }));
    vi.stubGlobal("fetch", fetchMock);
    const got = await loadO5Document("spells", "2024");
    expect(got.map(r => r.name)).toEqual(["A", "B", "C"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${spellsUrl}&page=2`);
  });

  it("throws when next repeats a URL already fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json({ count: 1, next: spellsUrl, results: [rec("A")] })));
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("paging loop");
  });

  it("throws when next leaves api.open5e.com, fetching nothing from it, and remembers the failure", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ count: 2, next: "https://evil.example/v2/spells/?page=2", results: [rec("A")] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("paging left");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("paging left"); // remembered: no refetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearOpen5eCache(); // a failure is memoized for 60 s; a clear makes the retry real
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("paging left");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["https://api.open5e.com.evil/v2/spells/?page=2", "http://api.open5e.com/v2/spells/?page=2", "https://api.open5e.com@evil.example/v2/spells/?page=2"])(
    "rejects the lookalike next URL %s, fetching nothing from it", async next => {
      const fetchMock = vi.fn().mockImplementation(async () => json({ count: 2, next, results: [rec("A")] }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(loadO5Document("spells", "2024")).rejects.toThrow("paging left");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

  it("throws past 20 pages, and remembers the failure", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? 1);
      return json({ count: 99, next: `${spellsUrl}&page=${page + 1}`, results: [rec(`P${page}`)] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("20 pages");
    expect(fetchMock).toHaveBeenCalledTimes(20);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("20 pages"); // remembered: no refetch
    expect(fetchMock).toHaveBeenCalledTimes(20);
    clearOpen5eCache();
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("20 pages");
    expect(fetchMock).toHaveBeenCalledTimes(40);
  });

  it("treats a missing next as the last page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ count: 1, results: [rec("A")] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadO5Document("spells", "2024")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches a document for the hour and shares one in-flight fetch", async () => {
    const fetchMock = vi.fn(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([loadO5Document("spells", "2024"), loadO5Document("spells", "2024")]);
    const again = await loadO5Document("spells", "2024");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again).toEqual(o5Fixture("srd-2024", "spells"));
  });

  it("keys the cache by full URL, so the editions stay separate", async () => {
    const fetchMock = vi.fn(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    const a = await loadO5Document("spells", "2024");
    const b = await loadO5Document("spells", "2014");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every(r => docKey(r) === "srd-2024")).toBe(true);
    expect(b.every(r => docKey(r) === "srd-2014")).toBe(true);
    expect(await loadO5Document("spells", "2024")).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a clear during an in-flight fetch is not undone when it resolves", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const stub = o5FixtureFetch();
    const fetchMock = vi.fn(async (input: unknown) => { await gate; return stub(input); });
    vi.stubGlobal("fetch", fetchMock);
    const first = loadO5Document("spells", "2024");
    clearOpen5eCache();
    release();
    await first;
    await loadO5Document("spells", "2024");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure as data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockImplementationOnce(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("Open5e 503");
    clearOpen5eCache();
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes an abort signal", async () => {
    const fetchMock = vi.fn(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await loadO5Document("spells", "2024");
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("docKey reads object and string documents", () => {
    expect(docKey({ document: { key: "srd-2024" } })).toBe("srd-2024");
    expect(docKey({ document: "srd-2014" })).toBe("srd-2014");
  });
});

describe("failure memo, deadline and response checks", () => {
  const spellsFail = () => json({}, 503);

  it("a failed document is remembered for 60 s, then retried", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(spellsFail()).mockImplementation(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("Open5e 503");
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("Open5e 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // another document is unaffected by the memo
    await expect(loadO5Document("spells", "2014")).resolves.not.toHaveLength(0);
    vi.advanceTimersByTime(O5_FAILURE_TTL_MS - 1);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("Open5e 503");
    vi.advanceTimersByTime(1);
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clearOpen5eCache drops remembered failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(spellsFail()).mockImplementation(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("Open5e 503");
    clearOpen5eCache();
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a fetch superseded by a clear remembers no failure", async () => {
    let fail!: () => void;
    const gate = new Promise<void>(r => { fail = r; });
    const fetchMock = vi.fn().mockImplementationOnce(async () => { await gate; return spellsFail(); }).mockImplementation(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    const first = loadO5Document("spells", "2024");
    const settled = expect(first).rejects.toThrow("Open5e 503");
    clearOpen5eCache();
    fail();
    await settled;
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers all reject on one shared failure, then the next call retries after the memo", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(spellsFail()).mockImplementation(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.allSettled([1, 2, 3].map(() => loadO5Document("spells", "2024")));
    expect(results.map(r => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(O5_FAILURE_TTL_MS);
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a paged response is document-filtered", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ count: 4, next: `${spellsUrl}&page=2`, results: [rec("A"), { key: "x", name: "X", document: { key: "srd-2014" } }] }))
      .mockResolvedValueOnce(json({ count: 4, next: null, results: [rec("B"), { key: "y", name: "Y", document: { key: "other" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadO5Document("spells", "2024")).map(r => r.name)).toEqual(["A", "B"]);
  });

  it("an empty 200 is not cached and fails the call", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ count: 0, next: null, results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("no records");
    clearOpen5eCache();
    fetchMock.mockImplementation(o5FixtureFetch());
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
  });

  it("count above the records collected fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ count: 5, next: null, results: [rec("A"), rec("B")] })));
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("2 of 5 records");
  });

  it("the count check uses raw records, so a response that ignored the document filter still loads", async () => {
    const other = { key: "x", name: "X", document: { key: "srd-2014" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ count: 3, next: null, results: [rec("A"), other, other] })));
    expect((await loadO5Document("spells", "2024")).map(r => r.name)).toEqual(["A"]);
  });

  it("a response with no url fails, is not cached, and the failure is remembered", async () => {
    const bare = () => new Response(JSON.stringify({ count: 1, next: null, results: [rec("A")] }), { status: 200 });
    const fetchMock = vi.fn().mockImplementation(async () => bare());
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("no final url");
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("no final url");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a redirect to another origin fails", async () => {
    const redirected = new Response(JSON.stringify({ count: 1, next: null, results: [rec("A")] }), { status: 200 });
    Object.defineProperty(redirected, "url", { value: "https://evil.example/v2/spells/" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirected));
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("redirected off");
  });

  it("a page of only other-document records fails, is not cached, and the failure is remembered", async () => {
    const other = { key: "x", name: "X", document: { key: "srd-2014" } };
    const fetchMock = vi.fn().mockResolvedValue(json({ count: 1, next: null, results: [other] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("no srd-2024 records: /v2/spells/");
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("no srd-2024 records"); // remembered, not cached as []
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearOpen5eCache();
    fetchMock.mockImplementation(o5FixtureFetch());
    await expect(loadO5Document("spells", "2024")).resolves.toEqual(o5Fixture("srd-2024", "spells"));
  });

  it("a fixture whose count exceeds its records fails the load", async () => {
    vi.stubGlobal("fetch", vi.fn(o5FixtureFetch({}, { "srd-2024/spells": 339 })));
    await expect(loadO5Document("spells", "2024")).rejects.toThrow(/of 339 records/);
  });

  it("the document deadline spans pages: page 1 takes 15 s, page 2 stalls, and the load fails at 30 s from the start", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(res => { setTimeout(() => res(json({ count: 2, next: `${spellsUrl}&page=2`, results: [rec("A")] })), 15_000); }))
      .mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
        init.signal.addEventListener("abort", () => rej(init.signal.reason));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = expect(loadO5Document("spells", "2024")).rejects.toThrow(`passed ${O5_DOCUMENT_DEADLINE_MS} ms`);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // page 2 alone would only hit its own 20 s request timeout at t=35 s; the document deadline fires first, at t=30 s
    await vi.advanceTimersByTimeAsync(O5_DOCUMENT_DEADLINE_MS - 15_000);
    await outcome;
  });
});

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, endpoint: O5Endpoint) =>
  fetchMock.mock.calls.filter(c => String(c[0]).includes(`/v2/${endpoint}/`)).length;

describe("clearOpen5eCreatures (minors C #13: ddb_clear_cache monsters)", () => {
  it("drops both creature documents' failure memos, leaving other endpoints' memos alone", async () => {
    const fetchMock = vi.fn(async () => json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("creatures", "2024")).rejects.toThrow();
    await expect(loadO5Document("creatures", "2014")).rejects.toThrow();
    await expect(loadO5Document("spells", "2024")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    clearOpen5eCreatures();
    fetchMock.mockImplementation(o5FixtureFetch() as never);
    expect((await loadO5Document("creatures", "2024")).length).toBeGreaterThan(0);
    expect((await loadO5Document("creatures", "2014")).length).toBeGreaterThan(0);
    expect(callsTo(fetchMock, "creatures")).toBe(4);
    // The spells failure is still remembered: no new request.
    await expect(loadO5Document("spells", "2024")).rejects.toThrow();
    expect(callsTo(fetchMock, "spells")).toBe(1);
  });

  it("drops cached creature records but keeps cached spells", async () => {
    const fetchMock = vi.fn(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await loadO5Document("creatures", "2024");
    await loadO5Document("spells", "2024");
    clearOpen5eCreatures();
    await loadO5Document("creatures", "2024");
    await loadO5Document("spells", "2024");
    expect(callsTo(fetchMock, "creatures")).toBe(2);
    expect(callsTo(fetchMock, "spells")).toBe(1);
  });

  it("a creature fetch in flight during the clear writes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const serve = o5FixtureFetch();
    const fetchMock = vi.fn(async (input: unknown) => { await gate; return serve(input); });
    vi.stubGlobal("fetch", fetchMock);
    const first = loadO5Document("creatures", "2024");
    clearOpen5eCreatures();
    release();
    expect((await first).length).toBeGreaterThan(0);
    await loadO5Document("creatures", "2024");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the equipment split (minors C #14, #15)", () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Fixtures, except the given endpoints answer 503. */
  function failing(...endpoints: O5Endpoint[]) {
    const serve = o5FixtureFetch();
    return vi.fn(async (input: unknown) =>
      endpoints.some(e => String(input).includes(`/v2/${e}/`)) ? json({}, 503) : serve(input));
  }

  it("a search answers when weapons or armor fail to load; a get still fails", async () => {
    const fetchMock = failing("weapons", "armor");
    vi.stubGlobal("fetch", fetchMock);
    const out = await o5SearchItems({ name: "Potion of Healing" }, "unavailable");
    expect(out).toContain("Potion of Healing");
    await expect(o5GetEquipment("Potion of Healing", "2024", "unavailable")).rejects.toThrow();
  });

  it("a split from a partial load is not cached: the next search tries weapons again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = failing("weapons");
    vi.stubGlobal("fetch", fetchMock);
    await o5SearchItems({ name: "Potion" }, "unavailable");
    expect(callsTo(fetchMock, "weapons")).toBe(2);
    // Past the failure memo, weapons recover.
    vi.setSystemTime(Date.now() + O5_FAILURE_TTL_MS + 1);
    fetchMock.mockImplementation(o5FixtureFetch() as never);
    await o5SearchItems({ name: "Potion" }, "unavailable");
    expect(callsTo(fetchMock, "weapons")).toBe(4);
    // Now complete, the split is cached: a third search loads no weapons.
    await o5SearchItems({ name: "Potion" }, "unavailable");
    expect(callsTo(fetchMock, "weapons")).toBe(4);
  });

  it("a split computed while a clear runs is not cached", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const serve = o5FixtureFetch();
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes("/v2/weapons/")) await gate;
      return serve(input);
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = o5SearchItems({ name: "Potion" }, "unavailable");
    await vi.waitFor(() => expect(callsTo(fetchMock, "weapons")).toBe(2));
    clearOpen5eCache();
    release();
    await first;
    // Warm the documents a search needs, then search: a cached (stale) split would load no weapons.
    for (const doc of ["srd-2024", "srd-2014"]) {
      await loadO5Document("magicitems", doc === "srd-2024" ? "2024" : "2014");
      await loadO5Document("items", doc === "srd-2024" ? "2024" : "2014");
    }
    const before = callsTo(fetchMock, "weapons");
    await o5SearchItems({ name: "Potion" }, "unavailable");
    expect(callsTo(fetchMock, "weapons")).toBe(before + 2);
  });

  it("concurrent cold searches share one computation", async () => {
    const fetchMock = vi.fn(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([o5SearchItems({ name: "Potion" }, "unavailable"), o5SearchItems({ name: "Rope" }, "unavailable")]);
    expect(callsTo(fetchMock, "weapons")).toBe(2);
    expect(fetchMock.mock.calls.every(c => [...ENDPOINTS].some(e => String(c[0]).includes(`/v2/${e}/`)))).toBe(true);
  });
});
