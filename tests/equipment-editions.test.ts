import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { open5eSearchHeader, searchHeader, sourceNote } from "../src/edition.js";
import { o5FixtureFetch } from "./fixtures/open5e-v2.js";
import { MASTERY_NAMES } from "../src/tools/weapon-mastery.js";

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

const selectionBug = vi.hoisted(() => ({ on: false }));
vi.mock("../src/tools/edition-search.js", async importOriginal => {
  const real = await importOriginal<typeof import("../src/tools/edition-search.js")>();
  return {
    ...real,
    selectCatalog: ((...args: Parameters<typeof real.selectCatalog>) => {
      if (selectionBug.on) throw new Error("selection bug");
      return real.selectCatalog(...args);
    }) as typeof real.selectCatalog,
    lookupCatalog: ((...args: Parameters<typeof real.lookupCatalog>) => {
      if (selectionBug.on) throw new Error("selection bug");
      return real.lookupCatalog(...args);
    }) as typeof real.lookupCatalog,
  };
});

import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt } from "./fixtures/spell-service.js";

const realFs = await vi.importActual<typeof import("fs")>("fs");

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  selectionBug.on = false;
  fsMock.existsSync.mockReset().mockReturnValue(true);
  const session = JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  });
  // The recorded Open5e documents are read from disk through the real fs.
  fsMock.readFileSync.mockReset().mockImplementation((path: unknown, ...rest: unknown[]) =>
    String(path).includes("/fixtures/open5e-v2/") ? realFs.readFileSync(path as URL, ...(rest as [BufferEncoding])) : session);
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
    if (url.includes("api.open5e.com")) return jsonResponse({}, 503);
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

  it("source basic-rules-2014 lists the reprint, tagged with the book's edition (it is dual-edition)", async () => {
    installItems();
    const lines = (await reference.searchItems({ name: "studded", source: "basic-rules-2014" })).split("\n");
    expect(lines[0]).toMatch(/^Rules: listing entries of every edition in .*Basic Rules/);
    expect(lines[1]).toBe(sourceNote("basic-rules-2014", "2014", "2024"));
    expect(lines[2]).toBe("**Item Search** (1 found)");
    expect(lines).toContain("- **Studded Leather** [2014] — Common Armor");
    expect(lines.some(l => l.includes("hidden"))).toBe(false);
  });

  it("the site-search section flags a hidden-only reply, not a listed one", async () => {
    installItems([item(11, "Longsword", { isLegacy: true, rarity: "Uncommon" }, [1]), item(12, "Longsword", {}, [148])]);
    expect((await reference.searchItemsSection({ name: "longsword", rarity: "uncommon" })).noMatch).toBe(true);
    expect((await reference.searchItemsSection({ name: "longsword" })).noMatch).toBeUndefined();
  });

  it("a filter only the 2014 twin passes: header, a no-match body and the footer counting it, no Open5e", async () => {
    installItems([item(11, "Longsword", { isLegacy: true, rarity: "Uncommon" }, [1]), item(12, "Longsword", {}, [148])]);
    expect(await reference.searchItems({ name: "longsword", rarity: "uncommon" })).toBe(
      `${searchHeader({ requested: "2024" })}\nNo items found matching the criteria.\n1 2014 version hidden — rules_edition: "2014" shows it.`,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("open5e"))).toBe(false);
  });

  it("the rarity filter matches exactly: common excludes Uncommon; a rarity-less item counts as Common", async () => {
    installItems([
      item(20, "Rope", { type: "Adventuring Gear", filterType: "Adventuring Gear" }, [148]),
      item(21, "Bag of Holding", { rarity: "Uncommon", type: "Wondrous Item", filterType: "Wondrous Item" }, [148]),
      item(22, "Potion of Climbing", { rarity: "Common", type: "Potion", filterType: "Potion" }, [148]),
      item(23, "Ten-Foot Pole", { rarity: null, type: "Adventuring Gear", filterType: "Adventuring Gear" }, [148]),
    ]);
    const common = (await reference.searchItems({ rarity: "common" })).split("\n");
    expect(common.filter(l => l.startsWith("- **"))).toEqual([
      "- **Potion of Climbing** [2024] — Common Potion",
      "- **Rope** [2024] — Common Adventuring Gear",
      "- **Ten-Foot Pole** [2024] — Common Adventuring Gear",
    ]);
    const uncommon = (await reference.searchItems({ rarity: "Uncommon" })).split("\n");
    expect(uncommon.filter(l => l.startsWith("- **"))).toEqual(["- **Bag of Holding** [2024] — Uncommon Wondrous Item"]);
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
    const o5 = o5FixtureFetch();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      if (url.includes("open5e")) return o5(url);
      return jsonResponse({});
    });
    const plain = await reference.searchItems({ name: "longsword" });
    expect(plain.split("\n")[0]).toBe(open5eSearchHeader("2024", "unavailable"));
    expect(plain).toContain("• Longsword [2024] (Weapon)");
    const withSource = await reference.searchItems({ name: "longsword", source: "phb-2024" });
    expect(withSource).toContain("• Longsword [2024]");
    expect(withSource.endsWith('*Note: source filtering is not available via the Open5e SRD fallback — "phb-2024" was requested but could not be honoured.*')).toBe(true);
  });

  it("when the load and Open5e both fail, the compendium's own error is thrown", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      if (url.includes("open5e")) throw new Error("open5e down");
      return jsonResponse({});
    });
    await expect(reference.searchItems({ name: "longsword" })).rejects.toThrow("Item compendium fetch failed: 403");
  });
});

describe("the item compendium keeps every item type (carry-over (e))", () => {
  // Live 2026-10-23: item ids repeat across entityTypeIds (ammunition, weapons, armour).
  const shared = (entityTypeId: number, name: string, type: string, definitionKey?: string) =>
    item(3, name, { entityTypeId, type, filterType: type, ...(definitionKey ? { definitionKey } : {}) }, [148, 1]);

  it("the item compendium keeps items that share an id across entity types", async () => {
    installItems([
      shared(2103445194, "Crossbow Bolts", "Ammunition"),
      shared(1782728300, "Dagger", "Weapon"),
      shared(701257905, "Studded Leather", "Armor"),
      item(900, "Glamoured Studded Leather", { type: "Armor", filterType: "Armor", rarity: "Rare", magic: true }, [146]),
    ]);
    expect((await reference.getItem("Studded Leather")).split("\n")[0]).toBe("**Studded Leather** — Armor, Common");
    expect((await reference.getItem("Dagger")).split("\n")[0]).toBe("**Dagger** — Weapon, Common");
    expect((await reference.getItem("Crossbow Bolts")).split("\n")[0]).toBe("**Crossbow Bolts** — Ammunition, Common");
  });

  it("without definitionKey or entityTypeId, items sharing an id stay apart by name and type", async () => {
    installItems([
      item(3, "Dagger", {}, [148, 1]),
      item(3, "Studded Leather", { type: "Armor", filterType: "Armor" }, [148, 1]),
      item(3, "Dagger", {}, [148, 1]),
    ]);
    const lines = (await reference.searchItems({})).split("\n").filter(l => l.startsWith("- **"));
    expect(lines).toEqual(["- **Dagger** [2024] — Common Weapon", "- **Studded Leather** [2024] — Common Armor"]);
  });

  it("the last-resort key keeps items that differ only in rarity or magic (minors B item 5a)", async () => {
    installItems([
      item(3, "Sword Blade", { type: "Weapon", filterType: "Weapon", rarity: "Common" }, [148, 1]),
      item(3, "Sword Blade", { type: "Weapon", filterType: "Weapon", rarity: "Rare", magic: true }, [148, 1]),
    ]);
    // A source lists every entry in the book, so the compendium's two entries both show.
    const lines = (await reference.searchItems({ source: "basic-rules-2014" })).split("\n").filter(l => l.startsWith("- **"));
    expect(lines).toHaveLength(2);
  });

  it("an empty-string definitionKey is absent: distinct items carrying one both survive", async () => {
    installItems([
      shared(1782728300, "Dagger", "Weapon", ""),
      shared(701257905, "Studded Leather", "Armor", ""),
    ].map(i => ({ ...i, definitionKey: "" })));
    const lines = (await reference.searchItems({})).split("\n").filter(l => l.startsWith("- **"));
    expect(lines).toEqual(["- **Dagger** [2024] — Common Weapon", "- **Studded Leather** [2024] — Common Armor"]);
  });

  it("dedupes by definitionKey when the payload carries one", async () => {
    installItems([
      shared(1782728300, "Dagger", "Weapon", "1782728300:3"),
      shared(1782728300, "Dagger", "Weapon", "1782728300:3"),
      shared(701257905, "Studded Leather", "Armor", "701257905:3"),
    ]);
    const lines = (await reference.searchItems({})).split("\n").filter(l => l.startsWith("- **"));
    expect(lines).toEqual(["- **Dagger** [2024] — Common Weapon", "- **Studded Leather** [2024] — Common Armor"]);
  });
});

describe("dual-edition items take the requested edition (decision 4)", () => {
  const LONGSWORD = item(12, "Longsword", { isLegacy: false }, [148, 1]);

  it("a dual-edition item under rules_edition 2014 is the 2014 version", async () => {
    installItems([LONGSWORD]);
    const as2014 = (await reference.getItem("Longsword", "2014")).split("\n");
    expect(as2014[1]).toBe("Rules: 2014 · Basic Rules (2014)");
    expect(as2014[2]).not.toMatch(/^\(/);
    const as2024 = (await reference.getItem("Longsword", "2024")).split("\n");
    expect(as2024[1]).toBe("Rules: 2024 · D&D Beyond Basic Rules");
    expect(as2024[2]).not.toMatch(/^\(/);
  });

  it("a 2014 equipment search tags dual items [2014]", async () => {
    installItems([LONGSWORD]);
    const text = await reference.searchItems({ name: "longsword", rulesEdition: "2014" });
    expect(text).toContain("- **Longsword** [2014] — Common Weapon");
    expect(text).not.toContain("hidden");
  });

  it("a source search classifies a dual item by the book's edition", async () => {
    installItems([LONGSWORD]);
    expect(await reference.searchItems({ name: "longsword", source: "basic-rules-2014" }))
      .toContain("- **Longsword** [2014] — Common Weapon");
    expect(await reference.searchItems({ name: "longsword", source: "br-2024", rulesEdition: "2014" }))
      .toContain("- **Longsword** [2024] — Common Weapon");
    const got = (await reference.getItem("Longsword", "2024", "basic-rules-2014")).split("\n");
    expect(got.slice(1, 3)).toEqual(["Rules: 2014 · Basic Rules (2014)", sourceNote("basic-rules-2014", "2014", "2024")]);
  });

  it("a non-dual 2014 item beats a dual one: Efficient Quiver under 2014 is the Legacy printing (option B)", async () => {
    // Live 2026-10-23 records, trimmed. The rename table twins the two names.
    const efficient = item(4628, "Efficient Quiver",
      { isLegacy: true, type: "Wondrous item", filterType: "Wondrous item", rarity: "Uncommon", magic: true }, [1, 2]);
    const ehlonna = item(5367, "Quiver of Ehlonna",
      { isLegacy: false, type: "Wondrous item", filterType: "Wondrous item", rarity: "Uncommon", magic: true }, [146, 148, 3, 66, 103, 79]);
    installItems([efficient, ehlonna]);
    const got = (await reference.getItem("Efficient Quiver", "2014")).split("\n");
    expect(got.slice(0, 3)).toEqual(["**Efficient Quiver** — Wondrous item, Uncommon", "Rules: 2014 · Basic Rules (2014)", ""]);
    const s2014 = (await reference.searchItems({ name: "quiver", rulesEdition: "2014" })).split("\n");
    expect(s2014.filter(l => l.startsWith("- **"))).toEqual(["- **Efficient Quiver** [2014] — Uncommon Wondrous item"]);
    expect(s2014.at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
    expect((await reference.getItem("Efficient Quiver")).split("\n")[0]).toBe("**Quiver of Ehlonna** — Wondrous item, Uncommon");
  });

  // Live 2026-10-23 records, trimmed. The rename table twins the two names.
  const EFFICIENT = item(4628, "Efficient Quiver",
    { isLegacy: true, type: "Wondrous item", filterType: "Wondrous item", rarity: "Uncommon", magic: true }, [1, 2]);
  const EHLONNA = item(5367, "Quiver of Ehlonna",
    { isLegacy: false, type: "Wondrous item", filterType: "Wondrous item", rarity: "Uncommon", magic: true }, [146, 148, 3, 66, 103, 79]);

  it("B within the book: in a 2014 book without the Legacy twin, the dual item is that book's 2014 version", async () => {
    installItems([EFFICIENT, EHLONNA]);
    const lines = (await reference.searchItems({ name: "quiver", rulesEdition: "2014", source: "dmg-2014" })).split("\n");
    expect(lines.filter(l => l.startsWith("- **"))).toEqual(["- **Quiver of Ehlonna** [2014] — Uncommon Wondrous item"]);
    const got = (await reference.getItem("Quiver of Ehlonna", "2014", "dmg-2014")).split("\n");
    expect(got.slice(0, 3)).toEqual(["**Quiver of Ehlonna** — Wondrous item, Uncommon", "Rules: 2014 · Dungeon Master's Guide (2014)", ""]);
  });

  it("B counts only entries that pass the filters: a Legacy twin the rarity filter rejects leaves the dual item listed", async () => {
    installItems([
      item(11422918, "Robe of the Archmagi", { isLegacy: true, rarity: "Legendary", type: "Wondrous item", filterType: "Wondrous item" }, [3, 1]),
      item(4742, "Robe of the Archmagi", { rarity: "Very Rare", type: "Wondrous item", filterType: "Wondrous item" }, [146, 1, 148]),
    ]);
    for (const rulesEdition of ["2014", "2024"] as const) {
      const lines = (await reference.searchItems({ name: "robe", rarity: "very rare", rulesEdition })).split("\n");
      expect(lines.filter(l => l.startsWith("- **"))).toEqual([`- **Robe of the Archmagi** [${rulesEdition}] — Very Rare Wondrous item`]);
      expect(lines.some(l => l.includes("hidden"))).toBe(false);
    }
    // Unfiltered, the Legacy twin is the 2014 version, as before.
    const all2014 = (await reference.searchItems({ name: "robe", rulesEdition: "2014" })).split("\n");
    expect(all2014.filter(l => l.startsWith("- **"))).toEqual(["- **Robe of the Archmagi** [2014] — Legendary Wondrous item"]);
    expect(all2014.at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
  });

  it("ddb_search_site's item section inherits the dual rule", async () => {
    installItems([LONGSWORD]);
    const { search } = await import("../src/tools/search.js");
    const text = await search("longsword", "items", "2014");
    expect(text).toContain("- **Longsword** [2014] — Common Weapon");
    expect(text).not.toContain("hidden");
  });

  it("a Legacy or homebrew item is not dual", async () => {
    installItems([
      item(30, "Old Sword", { isLegacy: true }, [148, 1]),
      item(31, "Brew Sword", { isHomebrew: true }, [148, 1]),
    ]);
    expect((await reference.getItem("Old Sword", "2024")).split("\n")[1]).toBe("Rules: 2014 · Basic Rules (2014)");
    const lines = (await reference.searchItems({ name: "sword", rulesEdition: "2024" })).split("\n");
    expect(lines).toContain("- **Old Sword** [2014] — Common Weapon");
    expect(lines.some(l => l.includes("**Brew Sword** [homebrew]"))).toBe(true);
  });
});

describe("a selection bug is not a load failure", () => {
  it("searchItems and getItem reject with the bug and never ask Open5e", async () => {
    installItems();
    selectionBug.on = true;
    await expect(reference.searchItems({ name: "longsword" })).rejects.toThrow("selection bug");
    await expect(reference.getItem("Longsword")).rejects.toThrow("selection bug");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("open5e"))).toBe(false);
  });
});

describe("ddb_get_equipment weapon mastery by shown edition", () => {
  const MASTERY_PARA = "This weapon has the following mastery property. To use this property, you must have a feature that lets you use it.";
  const longbow = (sources: number[]) => item(20, "Longbow", {
    description: `<p>A bow.</p>\r\n<p>${MASTERY_PARA}</p>\r\n<p><strong>Slow.</strong> Reduce Speed by 10 feet.</p>`,
    properties: ["Ammunition", "Heavy", "Range", "Two-Handed", "Slow"].map(name => ({ name })),
  }, sources);

  it("a 2014 reply drops the mastery name and paragraph", async () => {
    installItems([longbow([2])]);
    const text = await reference.getItem("Longbow", "2014");
    expect(text).toContain("Properties: Ammunition, Heavy, Range, Two-Handed\n");
    expect(text).not.toContain("Slow.");
    expect(text).not.toContain("mastery property");
    expect(text.endsWith("A bow.")).toBe(true);
  });

  it("a 2024 reply keeps both", async () => {
    installItems([longbow([148])]);
    const text = await reference.getItem("Longbow", "2024");
    expect(text).toContain("Properties: Ammunition, Heavy, Range, Two-Handed, Slow");
    expect(text).toContain("Slow. Reduce Speed");
    expect(text).toContain("mastery property");
  });

  it("a dual-edition definition shown as 2014 drops both", async () => {
    installItems([longbow([148, 2])]);
    const text = await reference.getItem("Longbow", "2014");
    expect(text.split("\n")[1]).toMatch(/^Rules: 2014/);
    expect(text).toContain("Properties: Ammunition, Heavy, Range, Two-Handed\n");
    expect(text).not.toContain("Slow.");
    expect(text).not.toContain("mastery property");
  });

  it("MASTERY_NAMES is exactly the eight 2024 masteries", () => {
    expect([...MASTERY_NAMES].sort()).toEqual(["Cleave", "Graze", "Nick", "Push", "Sap", "Slow", "Topple", "Vex"]);
  });
});

describe("honest not-found wording and the br-2024 exception (R4, F18, F19)", () => {
  it("a missing item names both places searched", async () => {
    installItems();
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    const o5 = o5FixtureFetch();
    fetchMock.mockImplementation(async (url: string) => (url.includes("open5e") ? o5(url) : base(url)));
    expect(await reference.getItem("Zzzz")).toBe(
      `Item "Zzzz" not found on D&D Beyond or in the SRD. It may be misspelled, or in a book this account doesn't own (D&D Beyond shows only free content and owned books). Try ddb_search_equipment with a partial name.`);
    expect(await reference.searchItems({ name: "zzzz" })).toBe("No items found matching the criteria on D&D Beyond or in the SRD.");
  });

  it("items never redirect br-2024: they carry source 148", async () => {
    installItems([item(12, "Longsword", { isLegacy: false }, [148, 1])]);
    const out = await reference.searchItems({ source: "br-2024", name: "longsword" });
    expect(out).not.toContain("D&D Beyond files the Basic Rules");
    expect(out).toContain("- **Longsword** [2024] — Common Weapon");
  });
});
