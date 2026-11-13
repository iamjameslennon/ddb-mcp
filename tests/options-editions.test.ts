import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { o5FixtureFetch } from "./fixtures/open5e-v2.js";
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
import { o5Response } from "./fixtures/open5e-v2.js";

type ReferenceModule = typeof import("../src/tools/reference.js");
const realFs = await vi.importActual<typeof import("fs")>("fs");
let reference: ReferenceModule;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
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

describe("a filter only the other edition's twin passes (Grappler)", () => {
  const GRAPPLER_2014 = named(10, "Grappler", [2], { prerequisite: "Strength 13 or higher", snippet: "" });
  const GRAPPLER_2024 = named(11, "Grappler", [145], { prerequisite: "Level 4+; Strength or Dexterity 13+", snippet: "" });
  const HEAVY = named(12, "Heavy Armor Master", [145], { prerequisite: "Level 4+; Strength 13+", snippet: "" });
  const open5eCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("open5e"));

  it("alone: the 2024 Grappler is listed (Strength or Dexterity 13+), and its 2014 twin still counts as hidden", async () => {
    install({ feats: [GRAPPLER_2014, GRAPPLER_2024] });
    const text = await reference.searchFeats({ prerequisite: "strength 13" });
    expect(entryLines(text)).toEqual(["- **Grappler** [2024] *(Requires: Level 4+; Strength or Dexterity 13+)* — Grappler description"]);
    expect(text.split("\n").at(-1)).toBe(HIDDEN_2014(1));
    expect(open5eCalls()).toHaveLength(0);
  });

  it("beside another match: both listed, the 2014 Grappler counted", async () => {
    install({ feats: [GRAPPLER_2014, GRAPPLER_2024, HEAVY] });
    const text = await reference.searchFeats({ prerequisite: "strength 13" });
    expect(entryLines(text)).toEqual([
      "- **Grappler** [2024] *(Requires: Level 4+; Strength or Dexterity 13+)* — Grappler description",
      "- **Heavy Armor Master** [2024] *(Requires: Level 4+; Strength 13+)* — Heavy Armor Master description",
    ]);
    expect(text.split("\n").at(-1)).toBe(HIDDEN_2014(1));
  });

  it("abbreviated prerequisites match a full-name query", async () => {
    install({ feats: [named(30, "Quick", [145], { prerequisite: "Str or Dex 13+", snippet: "" })] });
    expect(entryLines(await reference.searchFeats({ prerequisite: "Strength 13" }))).toHaveLength(1);
  });

  it("five identical rows list once with a count, and different names stay apart", async () => {
    const asi = [1, 2, 3, 4, 5].map(i => named(40 + i, "Ability Score Improvement", [145], { prerequisite: null, snippet: "" }));
    install({ feats: [...asi, named(60, "Magic Initiate (Cleric)", [145], { snippet: "" }), named(61, "Magic Initiate (Wizard)", [145], { snippet: "" })] });
    const text = await reference.searchFeats({ source: "phb-2024" });
    const lines = entryLines(text);
    expect(lines.filter(l => l.includes("Ability Score Improvement"))).toEqual(["- **Ability Score Improvement** [2024] — Ability Score Improvement description ×5"]);
    expect(lines.filter(l => l.includes("Magic Initiate"))).toHaveLength(2);
    expect(text).toContain("(3 found)");
  });

  it("clip separates block ends: headings, paragraphs and breaks", async () => {
    install({ backgrounds: [
      named(70, "Soldier", [145], { description: "<p>Ability Scores: Intelligence, Wisdom, Charisma</p><p>Feat: Magic Initiate (Cleric)</p>" }),
      named(71, "Sage", [145], { description: "<h4>Dwarf Traits</h4><p>Darkvision</p>" }),
      named(72, "Monk", [145], { description: "Hit Die: d10<br>Primary Ability" }),
    ] });
    const text = await reference.searchBackgrounds({ source: "phb-2024" });
    expect(text).toContain("— Ability Scores: Intelligence, Wisdom, Charisma Feat: Magic Initiate (Cleric)");
    expect(text).toContain("— Dwarf Traits Darkvision");
    expect(text).toContain("— Hit Die: d10 Primary Ability");
  });

  it("rules_edition 2014 lists the 2014 Grappler; the 2024 twin now passes too, so it is counted", async () => {
    install({ feats: [GRAPPLER_2014, GRAPPLER_2024] });
    const text = await reference.searchFeats({ prerequisite: "strength 13", rulesEdition: "2014" });
    expect(entryLines(text)).toEqual(["- **Grappler** [2014] *(Requires: Strength 13 or higher)* — Grappler description"]);
    expect(text.split("\n").at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
  });
});

describe("noMatch (ddb_search_site)", () => {
  it("species, classes and feats flag a no-match reply, not a listed one", async () => {
    install();
    expect((await reference.searchFeatsSection({ name: "zzz", source: "phb-2024" })).noMatch).toBe(true);
    expect((await reference.searchRacesSection({ name: "zzz" })).noMatch).toBe(true);
    expect((await reference.searchClassesSection({ name: "zzz" })).noMatch).toBe(true);
    expect((await reference.searchClassesSection({ name: "fighter" })).noMatch).toBeUndefined();
  });
});

describe("bookNotes: false (ddb_search_site)", () => {
  it("keeps the tag and drops the book note", async () => {
    install();
    const section = await reference.searchRacesSection({ name: "goblin", bookNotes: false });
    expect(entryLines(section.body)).toEqual(["- **Goblin** [2014] — Goblin description"]);
    expect(section.body).not.toContain("pass source to choose");
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

  it("when the load and Open5e both fail, the reply says both failed, with the source caveat", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      if (url.includes("open5e")) throw new Error("open5e down");
      return jsonResponse({});
    });
    expect(await reference.searchBackgrounds({ name: "acolyte" }))
      .toBe("Backgrounds unavailable — D&D Beyond and Open5e both failed.");
    expect(await reference.searchFeats({ name: "alert", source: "phb-2024" })).toBe(
      'Feats unavailable — D&D Beyond and Open5e both failed.\n\n*Note: source filtering is not available via the Open5e SRD fallback — "phb-2024" was requested but could not be honoured.*',
    );
  });

  it("an empty Open5e document is a failed load, so the reply says both failed", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      return jsonResponse({ count: 0, results: [] });
    });
    expect(await reference.searchBackgrounds({ name: "acolyte" }))
      .toBe("Backgrounds unavailable — D&D Beyond and Open5e both failed.");
  });

  it("a no-match feat search reaches the Open5e fallback with prerequisite, limit and offset", async () => {
    install({ feats: [] });
    // The suite mocks fs, so the recorded fixtures can't be read: two inline 2024 feats.
    const o5Feat = (name: string, prerequisite: string | null, doc = "srd-2024") => ({
      key: `${doc}_${name.toLowerCase()}`, name, type: "GENERAL", desc: "", benefits: [],
      has_prerequisite: !!prerequisite, prerequisite, document: { key: doc },
    });
    const feats = (url: string) => (url.includes("srd-2024")
      ? [o5Feat("Alert", null), o5Feat("Grappler", "Prerequisite: Level 4+, Strength or Dexterity 13+")]
      : [o5Feat("Grappler", null, "srd-2014")]);
    const ddb = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) => (url.includes("api.open5e.com")
      ? o5Response(JSON.stringify({ count: feats(url).length, next: null, previous: null, results: feats(url) }), { status: 200 }, url)
      : ddb(url)));
    const text = await reference.searchFeats({ prerequisite: "strength" });
    expect(text).toContain("Grappler");
    expect(text).not.toContain("Alert");
    // F21: the same word-based matcher as the D&D Beyond path.
    const f21 = await reference.searchFeats({ prerequisite: "strength 13" });
    expect(f21).toContain("Grappler");
    expect(f21).not.toContain("Alert");
    expect(await reference.searchFeats({ limit: 1 })).toContain("showing 1–1");
    expect(await reference.searchFeats({ offset: 999 })).toContain("offset 999 is past the end");
  });

  it("an empty list is never cached", async () => {
    install({ feats: [] });
    await reference.searchFeats({});
    await reference.searchFeats({});
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`${GAME_DATA}/feats`))).toHaveLength(2);
  });
});

describe("no-name searches that match nothing", () => {
  it("say 'matching the criteria', never 'undefined'", async () => {
    install({ races: [], classes: [], backgrounds: [], feats: [] });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.open5e.com")) return o5Response("down", { status: 500 }, url);
      return jsonResponse({ token: makeJwt("99"), data: [] });
    });
    for (const text of [await reference.searchRaces(), await reference.searchClasses(), await reference.searchBackgrounds()]) {
      expect(text).toContain('matching the criteria');
      expect(text).not.toContain("undefined");
    }
  });

  it("keep the name when one was given", async () => {
    install({ races: [], classes: [], backgrounds: [] });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.open5e.com")) return o5Response("down", { status: 500 }, url);
      return jsonResponse({ token: makeJwt("99"), data: [] });
    });
    expect(await reference.searchRaces({ name: "zzz" })).toContain('matching "zzz"');
  });
});

describe("species with one entityRaceId and different entityRaceTypeId", () => {
  const A = race(5, "Twin Folk", [148], { entityRaceId: 5, entityRaceTypeId: 2, description: "TYPE TWO" });
  const B = race(5, "Twin Folk", [148], { entityRaceId: 5, entityRaceTypeId: 1, description: "TYPE ONE" });

  it("order the same whatever the input order", async () => {
    install({ races: [A, B] });
    const forward = await reference.searchRaces({ name: "twin" });
    reference.clearReferenceCache();
    install({ races: [B, A] });
    const backward = await reference.searchRaces({ name: "twin" });
    expect(entryLines(forward)).toEqual(entryLines(backward));
    expect(forward).toBe(backward);
    expect(forward).toContain("TYPE ONE");
  });
});

describe("br-2024 redirect and honest no-match wording (R4, F18, F19, F22)", () => {
  it.each([
    ["races", () => reference.searchRaces({ source: "br-2024" })],
    ["classes", () => reference.searchClasses({ source: "br-2024" })],
    ["backgrounds", () => reference.searchBackgrounds({ source: "br-2024" })],
    ["feats", () => reference.searchFeats({ source: "br-2024" })],
  ])("%s with source br-2024 redirects to phb-2024", async (plural, call) => {
    install();
    expect(await call()).toBe(`D&D Beyond files the Basic Rules (2024) ${plural} under the Player's Handbook (2024), so source "br-2024" matches none. Use source: "phb-2024" — on an account that doesn't own the Player's Handbook, that lists just the free (Basic Rules) ${plural}.`);
  });

  it.each([
    ["races", () => reference.searchRaces({ name: "zzz" })],
    ["classes", () => reference.searchClasses({ name: "zzz" })],
    ["backgrounds", () => reference.searchBackgrounds({ name: "zzz" })],
    ["feats", () => reference.searchFeats({ name: "zzz" })],
  ])("a %s search nobody matches says D&D Beyond and the SRD were both searched", async (plural, call) => {
    install();
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    const o5 = o5FixtureFetch();
    fetchMock.mockImplementation(async (url: string) => (url.includes("open5e") ? o5(url) : base(url)));
    expect(await call()).toBe(`No ${plural} found on D&D Beyond or in the SRD.`);
  });
});
