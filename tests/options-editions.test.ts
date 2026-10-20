import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchHeader, sourceNote } from "../src/edition.js";

/**
 * options-editions.test.ts — rules_edition and source on ddb_search_races /
 * classes / backgrounds / feats. Same fs / fetch mocking as equipment-editions.test.ts.
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

const src = (...ids: number[]) => ids.map(sourceId => ({ sourceId }));

function race(id: number, fullName: string, sources: number[] | undefined, extra: Record<string, unknown> = {}) {
  return {
    entityRaceId: id, entityRaceTypeId: id, fullName, baseName: fullName, baseRaceName: "",
    description: `${fullName} description`, isHomebrew: false, isLegacy: false, isSubRace: false, size: "Medium",
    ...(sources ? { sources: src(...sources) } : {}),
    ...extra,
  };
}

const RACES = [
  race(1, "Human", [1], { isLegacy: true }),
  race(2, "Human", [148]),
  race(3, "Goblin", [15], { isLegacy: true }),
  race(4, "Goblin", [85]),
  race(5, "COPY_OF_Tiefling", undefined, { isHomebrew: true }),
  race(6, "Mystery Folk", undefined),
  race(7, "Elf", [145]),
  race(8, "High Elf", [1], { isSubRace: true, baseRaceName: "Elf", isLegacy: true }),
  race(9, "Wood Elf", [1], { isSubRace: true, baseRaceName: "Elf", isLegacy: true }),
];

function cls(id: number, sources: number[]) {
  return { id, name: "Fighter", description: "Fighter description", hitDice: 10, isHomebrew: false, spellCastingAbilityId: null, sources: src(...sources) };
}
function named(id: number, name: string, sources: number[], extra: Record<string, unknown> = {}) {
  return { id, name, description: `${name} description`, isHomebrew: false, sources: src(...sources), ...extra };
}

const CLASSES = [cls(1, [1]), cls(2, [145])];
const BACKGROUNDS = [
  named(1, "Acolyte", [1]), named(2, "Acolyte", [145]),
  named(3, "Criminal / Spy", [1]), named(4, "Criminal", [145]),
];
const FEATS = [
  named(1, "Alert", [2], { prerequisite: null, snippet: "" }),
  named(2, "Alert", [145], { prerequisite: "Level 4+", snippet: "" }),
];

function install(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { races: RACES, classes: CLASSES, backgrounds: BACKGROUNDS, feats: FEATS, ...overrides };
  fetchMock.mockImplementation(async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    for (const [path, list] of Object.entries(data)) {
      if (url.startsWith(`${GAME_DATA}/${path}`)) return jsonResponse({ data: list });
    }
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  });
}

const entryLines = (text: string) => text.split("\n").filter(l => l.startsWith("- **"));
const HIDDEN_2014 = (n: number) => `${n} 2014 version${n === 1 ? "" : "s"} hidden — rules_edition: "2014" shows ${n === 1 ? "it" : "them"}.`;

describe("ddb_search_classes", () => {
  it("lists the 2024 Fighter and counts the 2014 one", async () => {
    install();
    const text = await reference.searchClasses({ name: "fighter" });
    const lines = text.split("\n");
    expect(lines[0]).toBe(searchHeader({ requested: "2024" }));
    expect(entryLines(text)).toEqual(["- **Fighter** [2024] — Hit Die: d10"]);
    expect(lines.at(-1)).toBe(HIDDEN_2014(1));
    expect(text).not.toContain("Subclasses:");
  });

  it("rules_edition 2014 lists the 2014 Fighter", async () => {
    install();
    const text = await reference.searchClasses({ name: "fighter", rulesEdition: "2014" });
    expect(entryLines(text)).toEqual(["- **Fighter** [2014] — Hit Die: d10"]);
    expect(text.split("\n").at(-1)).toBe('1 2024 version hidden — omit rules_edition to show it.');
    expect(text).not.toContain("Subclasses:");
  });

  it("works with no arguments", async () => {
    install();
    expect(await reference.searchClasses()).toContain("**Class Search** (1 found)");
  });
});

describe("ddb_search_races", () => {
  it("lists one Goblin, naming the chosen book and the other", async () => {
    install();
    const lines = entryLines(await reference.searchRaces({ name: "goblin" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "- **Goblin** [2014] · Mordenkainen Presents: Monsters of the Multiverse [motm] (also in Volo's Guide to Monsters [vgtm] — pass source to choose) — Goblin description",
    );
  });

  it("source vgtm lists the Volo's Goblin", async () => {
    install();
    const text = await reference.searchRaces({ name: "goblin", source: "vgtm" });
    expect(entryLines(text)).toEqual(["- **Goblin** [2014] — Goblin description"]);
  });

  it("the 2024 Elf hides the 2014 subraces; 2014 lists each; naming the subrace finds it", async () => {
    install();
    const def = await reference.searchRaces({ name: "elf" });
    expect(entryLines(def)).toEqual(["- **Elf** [2024] — Elf description"]);
    expect(def.split("\n").at(-1)).toBe(HIDDEN_2014(2));

    const old = await reference.searchRaces({ name: "elf", rulesEdition: "2014" });
    expect(entryLines(old)).toEqual([
      "- **High Elf** [2014] *(Subrace)* — High Elf description",
      "- **Wood Elf** [2014] *(Subrace)* — Wood Elf description",
    ]);
    expect(old.split("\n").at(-1)).toBe('1 2024 version hidden — omit rules_edition to show it.');

    const named = await reference.searchRaces({ name: "high elf" });
    expect(entryLines(named)).toEqual(["- **High Elf** [2014] *(Subrace)* — High Elf description"]);
    expect(named.split("\n").some(l => l.includes("hidden"))).toBe(false);
  });

  it("tags homebrew and unstated entries, and never counts the latter as hidden", async () => {
    install();
    const hb = await reference.searchRaces({ name: "tiefling" });
    expect(entryLines(hb)).toEqual(["- **COPY_OF_Tiefling** [homebrew] — COPY_OF_Tiefling description"]);
    for (const rulesEdition of ["2024", "2014"] as const) {
      const text = await reference.searchRaces({ name: "mystery", rulesEdition });
      expect(entryLines(text)).toEqual(["- **Mystery Folk** [edition not stated] — Mystery Folk description"]);
      expect(text.split("\n").some(l => l.includes("hidden"))).toBe(false);
    }
  });

  it("Human: the 2024 species, one 2014 hidden", async () => {
    install();
    const text = await reference.searchRaces({ name: "human" });
    expect(entryLines(text)).toEqual(["- **Human** [2024] — Human description"]);
    expect(text.split("\n").at(-1)).toBe(HIDDEN_2014(1));
  });
});

describe("ddb_search_backgrounds", () => {
  it("2024 by default, with the renamed pair grouped", async () => {
    install();
    const text = await reference.searchBackgrounds();
    expect(entryLines(text)).toEqual([
      "- **Acolyte** [2024] — Acolyte description",
      "- **Criminal** [2024] — Criminal description",
    ]);
    expect(text.split("\n").at(-1)).toBe(HIDDEN_2014(2));
  });
});

describe("ddb_search_feats", () => {
  it("2024 by default with one hidden", async () => {
    install();
    const text = await reference.searchFeats({ name: "alert" });
    expect(entryLines(text)).toEqual(["- **Alert** [2024] *(Requires: Level 4+)* — Alert description"]);
    expect(text.split("\n").at(-1)).toBe(HIDDEN_2014(1));
  });

  it("a prerequisite filter counts only the other-edition entries that pass it", async () => {
    install();
    const text = await reference.searchFeats({ prerequisite: "level 4" });
    expect(entryLines(text)).toEqual(["- **Alert** [2024] *(Requires: Level 4+)* — Alert description"]);
    expect(text.split("\n").some(l => l.includes("hidden"))).toBe(false);
  });
});

describe("source and failures", () => {
  it("a source of the other edition adds the source note", async () => {
    install();
    const lines = (await reference.searchClasses({ source: "basic-rules-2014" })).split("\n");
    expect(lines[1]).toBe(sourceNote("basic-rules-2014", "2014", "2024"));
  });

  it("an unknown source is an error; an empty result in a book never asks Open5e", async () => {
    install();
    expect(await reference.searchFeats({ source: "nope" })).toContain('Unknown source "nope"');
    expect(await reference.searchFeats({ name: "zzz", source: "phb-2024" }))
      .toBe("No feats found matching the criteria in Player's Handbook (2024).");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("open5e"))).toBe(false);
  });

  it("a load failure falls back to Open5e with the source caveat (403, not 5xx: 5xx is retried)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      return jsonResponse({ count: 0, results: [] });
    });
    const text = await reference.searchBackgrounds({ name: "acolyte", source: "phb-2024" });
    expect(text.endsWith('*Note: source filtering is not available via the Open5e SRD fallback — "phb-2024" was requested but could not be honoured.*')).toBe(true);
  });

  it("an empty list is never cached", async () => {
    install({ feats: [] });
    await reference.searchFeats({});
    await reference.searchFeats({});
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`${GAME_DATA}/feats`))).toHaveLength(2);
  });
});
