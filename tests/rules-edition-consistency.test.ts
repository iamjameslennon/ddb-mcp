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
import { SERVER_INSTRUCTIONS } from "../src/edition.js";
import { clearReferenceCache } from "../src/tools/reference.js";
import { clearMonsterCache } from "../src/tools/monster.js";
import { clearOpen5eCache } from "../src/open5e.js";
import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt, spell } from "./fixtures/spell-service.js";

const TAG = String.raw`\[(?:2024|2014|third-party|homebrew|playtest|edition not stated)\]`;
const RESULT_LINE = /^(?:- \*\*|• )/;
const TAGGED_LINE = new RegExp(String.raw`^(?:- \*\*[^*]+\*\*|• [^[\n]+?) ${TAG}`);
const EXEMPT = /^(?:Error:|No \w[^\n]* (?:found|matching)|[^\n]*\bnot found\b|[^\n]*requires login)/;

// Every tool whose input schema has rules_edition must appear here; Task-3+ phases extend the fixtures.
const FIXTURES: Record<string, (ed: "2024" | "2014") => Record<string, unknown>> = {
  ddb_search_spells: ed => ({ name: "fire", rules_edition: ed }),
  ddb_get_spell: ed => ({ name: "Fireball", rules_edition: ed }),
  ddb_search_monsters: ed => ({ name: "goblin", rules_edition: ed }),
  ddb_get_monster: ed => ({ name: "Goblin", rules_edition: ed }),
  ddb_rate_encounter: ed => ({ party: [{ count: 4, level: 3 }], monsters: [{ name: "Goblin" }], rules_edition: ed }),
  ddb_encounter_cr: ed => ({ party: [{ count: 4, level: 3 }], difficulty: ed === "2024" ? "moderate" : "medium", rules_edition: ed }),
  ddb_roll_treasure: ed => ({ monsters: [{ name: "Goblin" }], treasure_type: "individual", rules_edition: ed }),
};

// Text only the intended path can produce, per mode, tool and edition.
const PATH_MARKER: Record<"ddb" | "open5e", Record<string, Partial<Record<"2024" | "2014", string>>>> = {
  ddb: {
    ddb_get_spell: { "2024": "FIREBALL 2024", "2014": "FIREBALL 2014" },
    ddb_get_monster: { "2024": "Monster Manual (2024)", "2014": "Basic Rules (2014)" },
  },
  open5e: {
    ddb_get_spell: { "2024": "A bright streak.", "2014": "A bright streak." },
    ddb_get_monster: { "2024": "Slash.", "2014": "Slash." },
  },
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

const SPELLS = [
  spell("Fireball", 3, { id: 301, isLegacy: true, sources: [2], description: "FIREBALL 2014" }),
  spell("Fireball", 3, { id: 401, sources: [145], description: "FIREBALL 2024" }),
];

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
  if (url.startsWith(GAME_DATA)) {
    const endpoint = new URL(url).pathname.split("/").pop();
    const classId = new URL(url).searchParams.get("classId");
    return jsonResponse({ data: endpoint === "spells" && classId === "8" ? SPELLS : [] });
  }
  return mockResponse({}, 404);
}

// ── Open5e fixtures ───────────────────────────────────────────────────────────

const O5_SPELL = {
  name: "Fireball", level_int: 3, school: "Evocation", casting_time: "1 action", range: "150 feet",
  components: "V, S, M", duration: "Instantaneous", requires_concentration: false, ritual: "no",
  desc: "A bright streak.", dnd_class: "Sorcerer, Wizard",
};
const O5_MONSTER = {
  name: "Goblin", size: "Small", type: "humanoid", alignment: "neutral evil", armor_class: 15, hit_points: 7,
  hit_dice: "2d6", speed: { walk: 30 }, strength: 8, dexterity: 14, constitution: 10, intelligence: 10,
  wisdom: 8, charisma: 8, skills: {}, senses: "darkvision 60 ft.", languages: "Common", challenge_rating: "1/4",
  actions: [{ name: "Scimitar", desc: "Slash." }],
};

function o5Fetch(input: unknown): Promise<Response> {
  const url = String(input);
  const results = url.includes("/spells/") ? [O5_SPELL] : url.includes("/monsters/") ? [O5_MONSTER] : [];
  return Promise.resolve(jsonResponse({ count: results.length, next: null, results }));
}

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
    const res = await client.callTool({ name: tool, arguments: FIXTURES[tool](ed) });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(EXEMPT.test(text.split("\n")[0])).toBe(false); // fixtures must exercise a labelled answer
    // Prove which path answered: only the open5e mode may carry the Open5e label.
    if (mode === "ddb") expect(text).not.toContain("Open5e fallback");
    const marker = PATH_MARKER[mode][tool]?.[ed];
    if (marker) expect(text).toContain(marker);
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
