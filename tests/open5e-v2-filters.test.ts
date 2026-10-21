import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOpen5eCache, docKey, loadO5Document, O5_DOC, type O5Endpoint, type O5Record } from "../src/open5e.js";
import { o5Fixture, o5FixtureFetch } from "./fixtures/open5e-v2.js";

const ENDPOINTS: O5Endpoint[] = ["spells", "creatures", "items", "magicitems", "weapons", "armor", "species", "classes", "backgrounds", "feats", "rulesets"];

// The "2024 only" / "2014 only" columns of the recorder's name table, per endpoint.
const ONLY: Record<O5Endpoint, { "2024": string[]; "2014": string[] }> = {
  spells: { "2024": ["Befuddlement", "Shining Smite"], "2014": ["Feeblemind", "Branding Smite"] },
  creatures: { "2024": ["Goblin Warrior", "Goblin Boss", "Allosaurus", "Tough"], "2014": ["Goblin", "Thug", "Orc"] },
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
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  clearOpen5eCache();
  vi.unstubAllGlobals();
});

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
    await loadO5Document("spells", "2024");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockImplementationOnce(o5FixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadO5Document("spells", "2024")).rejects.toThrow("Open5e 503");
    await expect(loadO5Document("spells", "2024")).resolves.toBeInstanceOf(Array);
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
