import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchHeader, sourceNote } from "../src/edition.js";

/**
 * equipment-editions.test.ts — rules_edition and source on ddb_get_equipment /
 * ddb_search_equipment. Same fs / fetch mocking as spell-editions.test.ts.
 */

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  fchmodSync: vi.fn(),
  renameSync: vi.fn(),
  realpathSync: vi.fn((p: string) => p),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt } from "./fixtures/spell-service.js";

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReset().mockReturnValue(true);
  fsMock.readFileSync.mockReset().mockReturnValue(JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  }));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  reference = await import("../src/tools/reference.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function item(id: number, name: string, extra: Record<string, unknown> = {}, sources?: number[]) {
  return {
    id, name, type: "Weapon", filterType: "Weapon", rarity: "Common", requiresAttunement: false,
    attunementDescription: "", description: `${name} ${id}`, snippet: "", weight: 0, damage: null,
    properties: null, armorClass: null, magic: false,
    ...(sources ? { sources: sources.map(sourceId => ({ sourceId })) } : {}),
    ...extra,
  };
}

const ITEMS = [
  item(10, "Studded Leather", { isLegacy: false, type: "Armor", filterType: "Armor" }, [148, 1]),
  item(11, "Longsword", { isLegacy: true }, [1]),
  item(12, "Longsword", {}, [148]),
  item(13, "Handy Haversack", { isLegacy: true, type: "Wondrous Item", filterType: "Wondrous Item" }, [3]),
  item(14, "Heward's Handy Haversack", { type: "Wondrous Item", filterType: "Wondrous Item" }, [146]),
  item(15, "Moon Blade", { isHomebrew: true }),
];

function installItems(items: unknown[] = ITEMS) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(`${GAME_DATA}/items`)) return jsonResponse({ data: items });
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  });
}

describe("ddb_get_equipment rules_edition", () => {
  it("Studded Leather ([br-2024, BR], not Legacy) is 2024", async () => {
    installItems();
    const text = await reference.getItem("Studded Leather");
    expect(text.split("\n")[1]).toBe("Rules: 2024 · D&D Beyond Basic Rules");
  });

  it("Longsword: 2024 by default, 2014 on request", async () => {
    installItems();
    expect((await reference.getItem("Longsword")).split("\n")[1]).toMatch(/^Rules: 2024/);
    expect((await reference.getItem("Longsword", "2014")).split("\n")[1]).toMatch(/^Rules: 2014/);
  });

  it("a 2014 name reaches its renamed 2024 twin with a rename line", async () => {
    installItems();
    const lines = (await reference.getItem("Handy Haversack")).split("\n");
    expect(lines[0]).toContain("Heward's Handy Haversack");
    expect(lines).toContain("(2014 name: Handy Haversack · 2024 name: Heward's Handy Haversack)");
  });

  it("a miss under a source never asks Open5e", async () => {
    installItems();
    expect(await reference.getItem("Zzz", "2024", "phb-2024")).toBe('Item "Zzz" not found in Player\'s Handbook (2024).');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("open5e"))).toBe(false);
  });
});

describe("ddb_search_equipment rules_edition and source", () => {
  it("search: header, tags, hidden footer", async () => {
    installItems();
    const lines = (await reference.searchItems({ name: "longsword" })).split("\n");
    expect(lines[0]).toBe(searchHeader({ requested: "2024" }));
    expect(lines).toContain("- **Longsword** [2024] — Common Weapon");
    expect(lines.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it("a query for the 2014 name lists the 2024 twin and counts the hide", async () => {
    installItems();
    const lines = (await reference.searchItems({ name: "handy haversack" })).split("\n");
    expect(lines.filter(l => l.startsWith("- **"))).toEqual(["- **Heward's Handy Haversack** [2024] — Common Wondrous Item"]);
    expect(lines.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it("source basic-rules-2014 lists the reprint, tagged by its own classification", async () => {
    installItems();
    const lines = (await reference.searchItems({ name: "studded", source: "basic-rules-2014" })).split("\n");
    expect(lines[0]).toMatch(/^Rules: showing every entry in .*Basic Rules/);
    expect(lines[1]).toBe(sourceNote("basic-rules-2014", "2014", "2024"));
    expect(lines[2]).toBe("**Item Search** (1 found)");
    expect(lines).toContain("- **Studded Leather** [2024] — Common Armor");
    expect(lines.some(l => l.includes("hidden"))).toBe(false);
  });

  it("a filter only the 2014 twin passes: header, a no-match body and the footer counting it, no Open5e", async () => {
    installItems([item(11, "Longsword", { isLegacy: true, rarity: "Uncommon" }, [1]), item(12, "Longsword", {}, [148])]);
    expect(await reference.searchItems({ name: "longsword", rarity: "uncommon" })).toBe(
      `${searchHeader({ requested: "2024" })}\nNo items found matching the criteria.\n1 2014 version hidden — rules_edition: "2014" shows it.`,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("open5e"))).toBe(false);
  });

  it("homebrew with no sources is tagged [homebrew]", async () => {
    installItems();
    expect(await reference.searchItems({ name: "moon" })).toContain("- **Moon Blade** [homebrew] — Common Weapon");
  });

  it("an unknown source is an error", async () => {
    installItems();
    expect(await reference.searchItems({ source: "nope" })).toContain('Unknown source "nope"');
  });

  it("an empty result in a book says so and never asks Open5e", async () => {
    installItems();
    expect(await reference.searchItems({ name: "zzz", source: "phb-2024" }))
      .toBe("No items found matching the criteria in Player's Handbook (2024).");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("open5e"))).toBe(false);
  });

  it("a load failure falls back to labelled Open5e, with the source caveat when a source was given", async () => {
    // 403, not 500: a 5xx is retried with backoff, which only slows the test down.
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      if (url.includes("open5e")) {
        return jsonResponse({ count: 1, results: [{ name: "Longsword", type: "Weapon", rarity: "common", desc: "Sharp." }] });
      }
      return jsonResponse({});
    });
    const plain = await reference.searchItems({ name: "longsword" });
    expect(plain.split("\n")[0]).toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)");
    const withSource = await reference.searchItems({ name: "longsword", source: "phb-2024" });
    expect(withSource).toContain("Longsword");
    expect(withSource.endsWith('*Note: source filtering is not available via the Open5e SRD fallback — "phb-2024" was requested but could not be honoured.*')).toBe(true);
  });
});
