import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { EDITION_RENAMES, type RenameKind } from "../src/edition-renames.js";

/**
 * rename-kinds.test.ts — decision 5 (carry-over (a)) through the real adapters
 * in src/tools/reference.ts: each catalog twins only with its own kind's rename
 * pairs. Every catalog below holds one 2014/2024 pair of each other kind (Thug
 * and Tough, Acolyte and Priest Acolyte, Donkey (or Mule) and Mule, …), so an
 * adapter given any wrong kind hides a 2014 name or prints a rename line, and
 * the test fails. Same fs / fetch mocking as options-editions.test.ts.
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

import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt, spell } from "./fixtures/spell-service.js";

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

type Pair = readonly [name2014: string, name2024: string];

/** One table pair per kind; the monster kind gets two (Thug/Tough is the feat case, Acolyte/Priest Acolyte the background one). */
const PAIRS: Record<RenameKind, Pair[]> = {
  spell: [["Acid Arrow", "Melf's Acid Arrow"]],
  item: [["Donkey (or Mule)", "Mule"]],
  monster: [["Thug", "Tough"], ["Acolyte", "Priest Acolyte"]],
  subclass: [["School of Evocation", "Evoker"]],
  background: [["Criminal / Spy", "Criminal"]],
};
const KINDS = Object.keys(PAIRS) as RenameKind[];

it("the fixture pairs are real table pairs", () => {
  for (const kind of KINDS) for (const pair of PAIRS[kind]) expect(EDITION_RENAMES[kind]).toContainEqual(pair);
});

/** Every pair of every kind but `own` (for `none`: every kind's). */
const otherPairs = (own: RenameKind | "none"): Pair[] => KINDS.filter(k => k !== own).flatMap(k => PAIRS[k]);

/** A 2014 entry (Legacy, Basic Rules 2014) and a 2024 entry (Player's Handbook 2024) per pair. */
function editions<T>(pairs: Pair[], make: (id: number, name: string, legacy: boolean, sourceId: number) => T): T[] {
  return pairs.flatMap(([name2014, name2024], i) => [make(100 + 2 * i, name2014, true, 1), make(101 + 2 * i, name2024, false, 145)]);
}

const named = (extra: Record<string, unknown>) => (id: number, name: string, isLegacy: boolean, sourceId: number) =>
  ({ id, name, description: `${name} description`, isHomebrew: false, isLegacy, sources: [{ sourceId }], ...extra });

const race = (id: number, fullName: string, isLegacy: boolean, sourceId: number) => ({
  entityRaceId: id, entityRaceTypeId: id, fullName, baseName: fullName, baseRaceName: "",
  description: `${fullName} description`, isHomebrew: false, isLegacy, isSubRace: false, size: "Medium",
  sources: [{ sourceId }],
});

const item = (id: number, name: string, isLegacy: boolean, sourceId: number) => ({
  id, name, type: "Wondrous Item", filterType: "Wondrous Item", rarity: "Common", requiresAttunement: false,
  attunementDescription: "", description: `${name} description`, snippet: "", weight: 0, damage: null,
  properties: null, armorClass: null, magic: false, isHomebrew: false, isLegacy, sources: [{ sourceId }],
});

const wizardSpell = (id: number, name: string, isLegacy: boolean, sourceId: number) =>
  spell(name, 2, { id, isLegacy, sources: [sourceId] });

/** Serves each game-data list by its last path segment; Wizard (class 8) gets the spells. */
/** `subclasses` answers /subclasses?baseClassId=N; the optional-feature collections are empty. */
function install(
  lists: Partial<Record<"races" | "classes" | "backgrounds" | "feats" | "items" | "spells", unknown[]>>,
  subclasses: Record<string, unknown[]> = {},
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(GAME_DATA)) {
      const u = new URL(url);
      const endpoint = u.pathname.split("/").pop() as keyof typeof lists | "subclasses" | "collection";
      if (endpoint === "collection") return jsonResponse({ data: { definitionData: [], accessTypes: {} } });
      if (endpoint === "subclasses") return jsonResponse({ data: subclasses[u.searchParams.get("baseClassId") ?? ""] ?? [] });
      if (endpoint === "spells") return jsonResponse({ data: u.searchParams.get("classId") === "8" ? lists.spells ?? [] : [] });
      return jsonResponse({ data: lists[endpoint] ?? [] });
    }
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  });
}

/** Each name is listed (bolded) and nothing is hidden. */
function expectAllListed(text: string, pairs: Pair[]) {
  for (const [name2014, name2024] of pairs) {
    expect(text).toContain(`**${name2014}**`);
    expect(text).toContain(`**${name2024}**`);
  }
  expect(text).not.toMatch(/version(s)? hidden/);
}

/** The own kind's pair still twins: the 2024 name is listed, the 2014 one hidden. */
function expectOwnTwinned(text: string, [name2014, name2024]: Pair) {
  expect(text).toContain(`**${name2024}**`);
  expect(text).not.toContain(`**${name2014}**`);
  expect(text).toContain(`1 2014 version hidden — rules_edition: "2014" shows it.`);
}

describe("catalogs with no rename pairs (twinNames.none) twin no other kind's names", () => {
  const pairs = otherPairs("none");

  it("feats: a 2014 Thug feat and a 2024 Tough feat are two feats", async () => {
    install({ feats: editions(pairs, named({ prerequisite: null, snippet: "" })) });
    expectAllListed(await reference.searchFeats({}), pairs);
  });

  it("species: a 2014 Acolyte species and a 2024 Priest Acolyte species are two species", async () => {
    install({ races: editions(pairs, race) });
    expectAllListed(await reference.searchRaces({}), pairs);
  });

  it("classes", async () => {
    install({ classes: editions(pairs, named({ hitDice: 10, spellCastingAbilityId: null })) });
    expectAllListed(await reference.searchClasses({}), pairs);
  });
});

describe("catalogs with rename pairs use only their own kind's", () => {
  it("backgrounds: Acolyte and Priest Acolyte stay apart; Criminal / Spy still twins with Criminal", async () => {
    const others = otherPairs("background");
    install({ backgrounds: editions([...others, ...PAIRS.background], named({})) });
    const text = await reference.searchBackgrounds({});
    for (const [name2014, name2024] of others) {
      expect(text).toContain(`**${name2014}**`);
      expect(text).toContain(`**${name2024}**`);
    }
    expectOwnTwinned(text, PAIRS.background[0]);
  });

  it("items (search): Thug and Tough stay apart; Donkey (or Mule) still twins with Mule", async () => {
    const others = otherPairs("item");
    install({ items: editions([...others, ...PAIRS.item], item) });
    const text = await reference.searchItems({});
    for (const [name2014, name2024] of others) {
      expect(text).toContain(`**${name2014}**`);
      expect(text).toContain(`**${name2024}**`);
    }
    expectOwnTwinned(text, PAIRS.item[0]);
  });

  it("items (get): another kind's 2014 name is its own item, with no rename line", async () => {
    const others = otherPairs("item");
    install({ items: editions(others, item) });
    for (const [name2014] of others) {
      const text = await reference.getItem(name2014);
      expect(text.split("\n")[0]).toContain(name2014);
      expect(text).toContain("Rules: 2014");
      expect(text).not.toContain("2014 name:");
    }
  });

  it("spells: Thug and Tough stay apart; Acid Arrow still twins with Melf's Acid Arrow", async () => {
    const others = otherPairs("spell");
    install({ spells: editions([...others, ...PAIRS.spell], wizardSpell) });
    const text = await reference.searchSpells({});
    for (const [name2014, name2024] of others) {
      expect(text).toContain(`**${name2014}**`);
      expect(text).toContain(`**${name2024}**`);
    }
    expectOwnTwinned(text, PAIRS.spell[0]);
  });
});

// ── Nested mode: species twin keys, racial-trait owners, class-feature owners ──

/** A species with one trait; `base` makes it a subrace of that base race. */
const traitRace = (id: number, fullName: string, isLegacy: boolean, sourceId: number, base = "") => ({
  ...race(id, fullName, isLegacy, sourceId),
  baseRaceName: base, isSubRace: base !== "",
  racialTraits: [{ definition: {
    id: 9000 + id, name: "Grit", description: "<p>Grit description</p>", snippet: "Grit snippet",
    displayOrder: 1, requiredLevel: null, sources: [{ sourceId }],
  } }],
});

describe("species twin keys use no pairs", () => {
  it("a named search for Tough does not bring in a 2014 Thug species (the name filter)", async () => {
    install({ races: [race(100, "Thug", true, 1), race(101, "Tough", false, 145)] });
    const text = await reference.searchRaces({ name: "Tough" });
    expect(text).toContain("**Tough**");
    expect(text).not.toContain("**Thug**");
  });

  it("two 2024 subraces of one base race named Thug and Tough are both listed (the subgroup split)", async () => {
    install({ races: [race(100, "Folk", false, 145), traitRace(101, "Thug", false, 145, "Folk"), traitRace(102, "Tough", false, 145, "Folk")] });
    const text = await reference.searchRaces({});
    expect(text).toContain("**Thug**");
    expect(text).toContain("**Tough**");
  });
});

describe("racial traits pick species with no pairs", () => {
  it("a 2014 Acolyte species' traits stay beside a 2024 Priest Acolyte's (the edition group)", async () => {
    install({ races: [traitRace(100, "Acolyte", true, 1), traitRace(101, "Priest Acolyte", false, 145)] });
    const text = await reference.searchRacialTraits({ name: "grit" });
    expect(text).toContain("*(Acolyte)*");
    expect(text).toContain("*(Priest Acolyte)*");
    expect(text).not.toMatch(/version(s)? hidden/);
  });

  it("2024 Criminal / Spy and Criminal subraces of one base race both keep their traits (the background pair is not a species pair)", async () => {
    install({ races: [traitRace(100, "Criminal / Spy", false, 145, "Folk"), traitRace(101, "Criminal", false, 145, "Folk")] });
    const text = await reference.searchRacialTraits({ name: "grit" });
    expect(text).toContain("*(Criminal / Spy — subrace of Folk)*");
    expect(text).toContain("*(Criminal — subrace of Folk)*");
  });

  it("2024 Thug and Tough subraces of one base race both keep their traits (the subgroup split)", async () => {
    install({ races: [traitRace(101, "Thug", false, 145, "Folk"), traitRace(102, "Tough", false, 145, "Folk")] });
    const text = await reference.searchRacialTraits({ name: "grit" });
    expect(text).toContain("*(Thug — subrace of Folk)*");
    expect(text).toContain("*(Tough — subrace of Folk)*");
  });
});

describe("class-feature owners use the subclass pairs only", () => {
  const feature = (id: number, name: string) => ({ id, name, description: `<p>${name} description</p>`, summary: null, requiredLevel: 3, displayOrder: 1 });
  const cls = (id: number, name: string, sourceId: number) => ({
    id, name, description: `<p>${name} description</p>`, hitDice: 8, isHomebrew: false,
    spellCastingAbilityId: null, subclassDefinition: null, parentClassId: null, sources: [{ sourceId }], classFeatures: [],
  });
  const subclass = (id: number, name: string, parentClassId: number, sourceId: number, featureName: string) => ({
    id, name, parentClassId, isHomebrew: false, sources: [{ sourceId }], classFeatures: [feature(id * 10, featureName)],
  });
  const CLASSES = [cls(10, "Fighter", 1), cls(2190879, "Fighter", 145), cls(8, "Wizard", 1), cls(2190886, "Wizard", 145)];
  const SUBCLASSES = {
    // A 2014 "Thug" and a 2024 "Tough" subclass (the monster pair): two owners
    "10": [subclass(900301, "Thug", 10, 1, "Grit")],
    "2190879": [subclass(900302, "Tough", 2190879, 145, "Grit")],
    // The subclass pair: one owner, the 2014 one hidden
    "8": [subclass(26, "School of Evocation", 8, 1, "Sculpt Spells")],
    "2190886": [subclass(2190998, "Evoker", 2190886, 145, "Sculpt Spells")],
  };

  it("a 2014 Thug subclass is not the 2024 Tough subclass", async () => {
    install({ classes: CLASSES }, SUBCLASSES);
    const text = await reference.searchClassFeatures({ name: "grit" });
    expect(text).toContain("— Fighter (Thug)");
    expect(text).toContain("— Fighter (Tough)");
    expect(text).not.toMatch(/version(s)? hidden/);
  });

  it("School of Evocation still twins with Evoker", async () => {
    install({ classes: CLASSES }, SUBCLASSES);
    const text = await reference.searchClassFeatures({ name: "sculpt" });
    expect(text).toContain("— Wizard (Evoker)");
    expect(text).not.toContain("(School of Evocation)");
    expect(text).toContain(`1 2014 version hidden — rules_edition: "2014" shows it.`);
  });
});
