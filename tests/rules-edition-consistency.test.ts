import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * rules-edition-consistency.test.ts — drives the real server over an in-memory
 * MCP transport and checks that every tool taking `rules_edition` labels its
 * answer, on both the D&D Beyond path and the Open5e fallback path.
 */

const mocks = vi.hoisted(() => ({
  hasValidSession: vi.fn(() => true),
  sessionFetch: vi.fn(),
  beginAuthenticatedSession: vi.fn(),
  captureSession: vi.fn(() => ({})),
  assertSessionCurrent: vi.fn(),
  invalidationHooks: [] as Array<() => void>,
}));

vi.mock("../src/session-fetch.js", async (orig) => {
  const real = await orig<typeof import("../src/session-fetch.js")>();
  return {
    ...real,
    hasValidSession: mocks.hasValidSession,
    sessionFetch: mocks.sessionFetch,
    beginAuthenticatedSession: mocks.beginAuthenticatedSession,
    captureSession: mocks.captureSession,
    assertSessionCurrent: mocks.assertSessionCurrent,
    // Record each module's invalidation hook so beforeEach can drop module-level state (game config).
    onSessionInvalidated: (cb: () => void) => {
      mocks.invalidationHooks.push(cb);
      return real.onSessionInvalidated(cb);
    },
  };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../src/server.js";
import { SERVER_INSTRUCTIONS, open5eSearchHeader, searchHeader } from "../src/edition.js";
import { clearReferenceCache } from "../src/tools/reference.js";
import { clearMonsterCache } from "../src/tools/monster.js";
import { clearOpen5eCache, type O5Endpoint } from "../src/open5e.js";
import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt, spell } from "./fixtures/spell-service.js";
import { o5Fixture, o5FixtureFetch, o5Record } from "./fixtures/open5e-v2.js";

const TAG = String.raw`\[(?:2024|2014|third-party|homebrew|playtest|edition not stated)\]`;
const RESULT_LINE = /^(?:- \*\*|• )/;
const TAGGED_LINE = new RegExp(String.raw`^(?:- \*\*[^*]+\*\*|• [^[\n]+?) ${TAG}`);
const EXEMPT = /^(?:Error:|No \w[^\n]* (?:found|matching)|[^\n]*\bnot found\b|[^\n]*requires login)/;

// Every tool whose input schema has rules_edition must appear here; Task-3+ phases extend the fixtures.
const FIXTURES: Record<string, (ed: "2024" | "2014") => Record<string, unknown>> = {
  ddb_search_spells: ed => ({ name: "fire", rules_edition: ed }),
  ddb_get_condition: ed => ({ name: "Exhaustion", rules_edition: ed }),
  ddb_get_spell: ed => ({ name: "Fireball", rules_edition: ed }),
  ddb_search_monsters: ed => ({ name: "goblin", rules_edition: ed }),
  ddb_get_monster: ed => ({ name: "Goblin", rules_edition: ed }),
  ddb_search_equipment: ed => ({ name: "longsword", rules_edition: ed }),
  ddb_get_equipment: ed => ({ name: "Longsword", rules_edition: ed }),
  ddb_search_races: ed => ({ name: "human", rules_edition: ed }),
  ddb_search_classes: ed => ({ name: "fighter", rules_edition: ed }),
  ddb_search_backgrounds: ed => ({ name: "acolyte", rules_edition: ed }),
  ddb_search_feats: ed => ({ name: "alert", rules_edition: ed }),
  ddb_search_class_features: ed => ({ name: "action surge", rules_edition: ed }),
  ddb_search_racial_traits: ed => ({ name: "darkvision", rules_edition: ed }),
  ddb_search_site: ed => ({ query: "Fireball", rules_edition: ed }),
  ddb_search_rules: ed => ({ query: "cover", rules_edition: ed }),
  ddb_get_rules: ed => ({ name: "Damage and Healing", rules_edition: ed }),
  ddb_rate_encounter: ed => ({ party: [{ count: 4, level: 3 }], monsters: [{ name: "Goblin" }], rules_edition: ed }),
  ddb_encounter_cr: ed => ({ party: [{ count: 4, level: 3 }], difficulty: ed === "2024" ? "moderate" : "medium", rules_edition: ed }),
  ddb_roll_treasure: ed => ({ monsters: [{ name: "Goblin" }], treasure_type: "individual", rules_edition: ed }),
};

// Text only the intended path can produce, per mode, tool and edition.
const PATH_MARKER: Record<"ddb" | "open5e", Record<string, Partial<Record<"2024" | "2014", string>>>> = {
  ddb: {
    ddb_get_spell: { "2024": "FIREBALL 2024", "2014": "FIREBALL 2014" },
    ddb_get_monster: { "2024": "Monster Manual (2024)", "2014": "Basic Rules (2014)" },
    ddb_get_equipment: { "2024": "LONGSWORD 2024", "2014": "LONGSWORD 2014" },
  },
  open5e: {
    // The two documents' Fireball texts, live 2026-10-20.
    ddb_get_spell: { "2024": "fiery explosion", "2014": "pointing finger" },
    // Under 2024, "Goblin" reaches Goblin Warrior through the rename table; under 2014 the title line is the bare name, then the 2014 rules line.
    ddb_get_monster: { "2024": "Goblin Warrior", "2014": "Goblin\nRules: 2014 · SRD 5.1" },
    // The edition reaches o5GetMonsterStats: "Goblin" is Goblin Warrior under 2024 and Goblin under 2014.
    ddb_rate_encounter: { "2024": "Goblin Warrior [2024]", "2014": "Goblin [2014]" },
    ddb_roll_treasure: { "2024": "Goblin Warrior [2024]", "2014": "Goblin [2014]" },
    // The weapon records have no desc. Only SRD 5.2's Longsword has a Mastery line; under 2014, the title over the 2014 rules line.
    ddb_get_equipment: { "2024": "Mastery: Sap", "2014": "Longsword (Martial Weapon)\nRules: 2014 · SRD 5.1" },
  },
};

// D&D Beyond path: text only a correctly wired rules_edition can produce, so a
// registration in src/server.ts that stops passing it through fails here.
// `absent` is text that must not appear for that edition.
type EditionCheck = { present: string[]; absent?: string[]; resultTag?: boolean };
const hiddenFooter = (ed: "2024" | "2014") => ed === "2024"
  ? '1 2014 version hidden — rules_edition: "2014" shows it.'
  : "1 2024 version hidden — omit rules_edition to show it.";
const dmgRulesLine = (ed: "2024" | "2014") => `Rules: ${ed} · Dungeon Master's Guide (${ed})`;
const TREASURE_NO_2014 = "(no 2014 version exists — 2024 tables used)";
// Open5e path: searches whose first line must be the Open5e header for the requested
// edition, so a fallback that drops rulesEdition fails under 2014.
const O5_HEADER_CHECK = new Set([
  "ddb_search_spells", "ddb_search_monsters", "ddb_search_equipment",
  "ddb_search_races", "ddb_search_classes", "ddb_search_backgrounds", "ddb_search_feats",
]);
// Built from D&D Beyond only (no Open5e path): logged out, they report an error.
const NO_OPEN5E = new Set(["ddb_search_class_features", "ddb_search_racial_traits"]);
const EDITION_CHECK: Record<string, (ed: "2024" | "2014") => EditionCheck> = {
  ddb_search_spells: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_monsters: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_equipment: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_races: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_classes: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_backgrounds: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_feats: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_class_features: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_racial_traits: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_site: ed => ({ present: [hiddenFooter(ed)], resultTag: true }),
  ddb_search_rules: ed => ({ present: [searchHeader({ rulesDoc: ed })], resultTag: true }),
  ddb_get_condition: ed => ({ present: [`Rules: ${ed} · SRD 5.${ed === "2024" ? 2 : 1}`, ed === "2024" ? "You die if your Exhaustion level is 6." : "Level 6: Death"] }),
  ddb_get_rules: ed => ({ present: [`Rules: ${ed} · SRD 5.${ed === "2024" ? 2 : 1}`] }),
  ddb_rate_encounter: ed => ({ present: [dmgRulesLine(ed)] }),
  ddb_encounter_cr: ed => ({ present: [dmgRulesLine(ed)] }),
  ddb_roll_treasure: ed => (ed === "2014" ? { present: [TREASURE_NO_2014] } : { present: [], absent: [TREASURE_NO_2014] }),
};

// ── DDB fixtures ──────────────────────────────────────────────────────────────

function mockResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as unknown as Response;
}

const CONFIG = {
  data: {
    challengeRatings: [
      { id: 3, value: 0.25, xp: 50, proficiencyBonus: 2 },
      { id: 4, value: 0.5, xp: 100, proficiencyBonus: 2 },
    ],
    monsterTypes: [{ id: 8, name: "Humanoid" }],
    alignments: [{ id: 8, name: "Neutral Evil" }],
    senses: [],
    creatureSizes: [{ id: 3, name: "Small" }],
    languages: [{ id: 1, name: "Common" }],
    sourceCategories: [{ id: 24, name: "5.5e Core Rules" }, { id: 26, name: "5e Core Rules" }],
    sources: [
      { id: 1, name: "BR", description: "Basic Rules (2014)", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 26 },
      { id: 2, name: "PHB", description: "Player's Handbook (2014)", sourceURL: "sources/dnd/phb-2014", sourceCategoryId: 26 },
      { id: 145, name: "PHB-2024", description: "Player's Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
      { id: 147, name: "MM-2024", description: "Monster Manual", sourceURL: "sources/dnd/mm-2024", sourceCategoryId: 24 },
    ],
  },
};

function goblin(id: number, isLegacy: boolean, sourceId: number): Record<string, unknown> {
  return {
    id, name: "Goblin", alignmentId: 8, sizeId: 3, typeId: 8, armorClass: 15, armorClassDescription: "",
    averageHitPoints: 7, hitPointDice: { diceString: "2d6" }, passivePerception: 9, challengeRatingId: 3,
    isHomebrew: false, isLegendary: false, isMythic: false, isLegacy, sourceId,
    sources: [{ sourceId, pageNumber: 1, sourceType: 1 }],
    stats: [{ statId: 1, value: 8 }], savingThrows: [], senses: [], movements: [], languages: [],
    languageDescription: "", languageNote: "", skillsHtml: "", specialTraitsDescription: "",
    actionsDescription: "<p><strong>Scimitar.</strong> Slash.</p>", reactionsDescription: "",
    legendaryActionsDescription: "", mythicActionsDescription: "", bonusActionsDescription: "",
  };
}
const GOBLINS = [goblin(1001, true, 1), goblin(2001, false, 147)];

function longsword(id: number, isLegacy: boolean, sourceId: number, description: string): Record<string, unknown> {
  return {
    id, name: "Longsword", type: "Weapon", filterType: "Weapon", rarity: "Common", requiresAttunement: false,
    attunementDescription: "", description, snippet: "", weight: 3, damage: null, properties: null,
    armorClass: null, magic: false, isLegacy, sources: [{ sourceId }],
  };
}
const LONGSWORDS = [longsword(11, true, 2, "LONGSWORD 2014"), longsword(12, false, 145, "LONGSWORD 2024")];

const SPELLS = [
  spell("Fireball", 3, { id: 301, isLegacy: true, sources: [2], description: "FIREBALL 2014" }),
  spell("Fireball", 3, { id: 401, sources: [145], description: "FIREBALL 2024" }),
];

// One entry per edition for each option list: the 2014 one is Legacy in the Basic Rules, the 2024 one in the PHB (2024).
function option(id: number, name: string, legacy: boolean, sourceId: number): Record<string, unknown> {
  return {
    id, entityRaceId: id, entityRaceTypeId: id, name, fullName: name, baseName: name, baseRaceName: name,
    description: `${name} description`, isHomebrew: false, isLegacy: legacy, isSubRace: false, hitDice: 10,
    prerequisite: null, snippet: "", sources: [{ sourceId }],
  };
}
// Classes carry one base feature and races one trait each, for the class-feature and racial-trait searches.
const OPTIONS: Record<string, Array<Record<string, unknown>>> = {
  races: [option(1, "Human", true, 1), option(2, "Human", false, 145)]
    .map(r => ({ ...r, racialTraits: [{ definition: { id: Number(r.id) * 10, name: "Darkvision", snippet: "See in the dark." } }] })),
  classes: [option(1, "Fighter", true, 1), option(2, "Fighter", false, 145)]
    .map(c => ({ ...c, classFeatures: [{ id: Number(c.id) * 10, name: "Action Surge", requiredLevel: 2, summary: "One more action." }] })),
  backgrounds: [option(1, "Acolyte", true, 1), option(2, "Acolyte", false, 145)],
  feats: [option(1, "Alert", true, 1), option(2, "Alert", false, 145)],
};

async function route(input: unknown): Promise<Response> {
  const url = String(input);
  if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
  if (url.includes("api/config/json")) return mockResponse(CONFIG);
  if (url.includes("/v1/Monster?search=")) {
    const params = new URL(url).searchParams;
    const term = (params.get("search") ?? "").toLowerCase();
    const data = GOBLINS.filter(m => (m.name as string).toLowerCase().includes(term));
    // The live list carries { "<id>": accessType }; 1 = available to the account.
    const accessType = Object.fromEntries(data.map(m => [String(m.id), 1]));
    return mockResponse({ accessType, pagination: { total: data.length, currentPage: 1, pages: 1 }, data });
  }
  const idMatch = url.match(/\/v1\/Monster\/(\d+)/);
  if (idMatch) return mockResponse({ accessType: 1, data: GOBLINS.find(m => m.id === Number(idMatch[1])) });
  if (url.startsWith(`${GAME_DATA}/items`)) return jsonResponse({ data: LONGSWORDS });
  if (url.startsWith(GAME_DATA)) {
    // Both optional-feature endpoints end in /collection: route them on the full path.
    if (/\/(class-feature|racial-trait)\/collection$/.test(new URL(url).pathname)) {
      return jsonResponse({ data: { definitionData: [], accessTypes: {} } });
    }
    const endpoint = new URL(url).pathname.split("/").pop();
    const classId = new URL(url).searchParams.get("classId");
    if (endpoint && endpoint in OPTIONS) return jsonResponse({ data: OPTIONS[endpoint] });
    return jsonResponse({ data: endpoint === "spells" && classId === "8" ? SPELLS : [] });
  }
  return mockResponse({}, 404);
}

// ── Open5e fixtures ───────────────────────────────────────────────────────────

/** A recorded record cloned under a new name (and key), in the same document. */
function o5Clone(doc: "srd-2024" | "srd-2014", endpoint: O5Endpoint, name: string, cloneName: string): Record<string, unknown> {
  const r = o5Record<Record<string, unknown>>(doc, endpoint, name);
  return { ...r, key: `${String(r.key)}-variant`, name: cloneName };
}

// A single hit renders a detail block with no result line, so each option search gets a
// second record matching its query, in the document that answers it. Alert is in SRD 5.2 only.
const O5_OVERRIDES: Record<string, unknown[]> = Object.fromEntries(([
  ["srd-2024", "species", "Human"], ["srd-2014", "species", "Human"],
  ["srd-2024", "classes", "Fighter"], ["srd-2014", "classes", "Fighter"],
  ["srd-2024", "backgrounds", "Acolyte"], ["srd-2014", "backgrounds", "Acolyte"],
  ["srd-2024", "feats", "Alert"],
] as const).map(([doc, endpoint, name]) =>
  [`${doc}/${endpoint}`, [...o5Fixture(doc, endpoint), o5Clone(doc, endpoint, name, `${name} (Variant)`)]]));

/** Every Open5e endpoint comes from the recorded v2 documents. */
const o5Fetch = o5FixtureFetch(O5_OVERRIDES);

// ── Harness ───────────────────────────────────────────────────────────────────

let client: Client;

beforeEach(async () => {
  clearReferenceCache();
  clearMonsterCache();
  clearOpen5eCache();
  for (const hook of mocks.invalidationHooks) hook();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function useMode(mode: "ddb" | "open5e"): void {
  vi.stubGlobal("fetch", vi.fn(o5Fetch));
  if (mode === "ddb") {
    mocks.hasValidSession.mockReturnValue(true);
    mocks.sessionFetch.mockImplementation(route);
    mocks.beginAuthenticatedSession.mockImplementation(async () => ({ fetch: (u: unknown) => route(u) }));
  } else {
    mocks.hasValidSession.mockReturnValue(false);
    mocks.sessionFetch.mockRejectedValue(new Error("not logged in"));
    mocks.beginAuthenticatedSession.mockRejectedValue(new Error("not logged in"));
  }
}

it("every tool with rules_edition has fixtures, and vice versa", async () => {
  const { tools } = await client.listTools();
  const withParam = tools.filter(t => "rules_edition" in ((t.inputSchema.properties ?? {}) as object)).map(t => t.name).sort();
  expect(withParam).toEqual(Object.keys(FIXTURES).sort());
});

it("the server instructions tell the client about the labels", async () => {
  expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
});

describe.each(["ddb", "open5e"] as const)("labels (%s path)", mode => {
  beforeEach(() => useMode(mode));

  it.each(Object.keys(FIXTURES).flatMap(t => [[t, "2024"], [t, "2014"]] as const))("%s (%s)", async (tool, ed) => {
    const noOpen5e = mode === "open5e" && NO_OPEN5E.has(tool);
    // The server logs the expected error to stderr; keep test output clean.
    const stderr = noOpen5e ? vi.spyOn(process.stderr, "write").mockReturnValue(true) : null;
    const res = await client.callTool({ name: tool, arguments: FIXTURES[tool](ed) });
    stderr?.mockRestore();
    const text = (res.content as Array<{ text: string }>)[0].text;
    if (noOpen5e) {
      expect(res.isError).toBe(true);
      return;
    }
    expect(EXEMPT.test(text.split("\n")[0])).toBe(false); // fixtures must exercise a labelled answer
    // Prove which path answered: only the open5e mode may carry the Open5e label.
    if (mode === "ddb") expect(text).not.toContain("Open5e fallback");
    const marker = PATH_MARKER[mode][tool]?.[ed];
    if (marker) expect(text).toContain(marker);
    if (mode === "open5e" && O5_HEADER_CHECK.has(tool)) expect(text.split("\n")[0]).toBe(open5eSearchHeader(ed, "unavailable"));
    const check = mode === "ddb" ? EDITION_CHECK[tool]?.(ed) : undefined;
    if (check) {
      for (const s of check.present) expect(text).toContain(s);
      for (const s of check.absent ?? []) expect(text).not.toContain(s);
      if (check.resultTag) {
        for (const l of text.split("\n").filter(l => RESULT_LINE.test(l))) expect(l).toContain(`[${ed}]`);
      }
    }
    // The combined reply carries the Rules line once, not once per category.
    if (mode === "ddb" && tool === "ddb_search_site") expect(text.match(/^Rules: /gm)).toHaveLength(1);
    if (tool.startsWith("ddb_search_")) {
      const results = text.split("\n").filter(l => RESULT_LINE.test(l));
      expect(results.length).toBeGreaterThan(0);
      for (const l of results) expect(l).toMatch(TAGGED_LINE);
    } else {
      expect(text).toMatch(/^Rules: /m);
    }
  });
});

it("error and not-found answers are exempt", () => {
  expect(EXEMPT.test('Spell "Zzz" not found in the compendium. Try ddb_search_spells with a partial name.')).toBe(true);
  expect(EXEMPT.test("No spells found matching the criteria.")).toBe(true);
});
