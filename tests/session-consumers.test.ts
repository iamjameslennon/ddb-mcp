import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * session-consumers.test.ts
 *
 * Drives the REAL session-state / session-fetch lifecycle (only `fs` and the
 * global `fetch` are mocked) through the account-derived consumer caches in
 * character.ts, campaign.ts, reference.ts and monster.ts. Per the Task 4 brief:
 * "A test that mocks out the entire session helper is insufficient evidence for
 * the cross-module revocation contract." So we never stub session-state — we
 * flip the on-disk session file and assert the invalidation hooks actually fire
 * and clear the caches end to end.
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

// ── Consumer + lifecycle module surface (re-imported fresh per test) ──────────
type CharacterModule = typeof import("../src/tools/character.js");
type ReferenceModule = typeof import("../src/tools/reference.js");
type MonsterModule = typeof import("../src/tools/monster.js");
type CampaignModule = typeof import("../src/tools/campaign.js");
type SessionFetchModule = typeof import("../src/session-fetch.js");

let character: CharacterModule;
let reference: ReferenceModule;
let monster: MonsterModule;
let campaign: CampaignModule;
let sf: SessionFetchModule;
let fetchMock: ReturnType<typeof vi.fn>;

const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const CHAR_SERVICE = "https://character-service.dndbeyond.com";
const MONSTER_SERVICE = "https://monster-service.dndbeyond.com";

function makeCookie(value: string) {
  return {
    name: "CobaltSession",
    value,
    domain: ".dndbeyond.com",
    path: "/",
    expires: Date.now() / 1000 + 3600,
    httpOnly: true,
    secure: true,
  };
}

function sessionJson(cookieValue: string): string {
  return JSON.stringify({ cookies: [makeCookie(cookieValue)] });
}

function setSessionFile(content: string | null): void {
  if (content === null) {
    fsMock.existsSync.mockReturnValue(false);
    return;
  }
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readFileSync.mockReturnValue(content);
}

function makeJwt(userId: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp,
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function jsonResponse(body: unknown, status = 200, contentType = "application/json"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

/** Extract the Cookie header of a fetch call (native fetch signature). */
function cookieOf(call: unknown[]): string {
  const opts = (call[1] ?? {}) as RequestInit;
  const h = (opts.headers ?? {}) as Record<string, string>;
  return h.Cookie ?? "";
}
function authOf(call: unknown[]): string {
  const opts = (call[1] ?? {}) as RequestInit;
  const h = (opts.headers ?? {}) as Record<string, string>;
  return h.Authorization ?? "";
}

async function loadModules(): Promise<void> {
  vi.resetModules();
  // Import all consumers from ONE post-reset module graph so their module-load
  // invalidation hooks register against the same fresh session-state singleton.
  character = await import("../src/tools/character.js");
  reference = await import("../src/tools/reference.js");
  monster = await import("../src/tools/monster.js");
  campaign = await import("../src/tools/campaign.js");
  sf = await import("../src/session-fetch.js");
}

/**
 * Force the on-disk boundary check to run (as any real authenticated op would),
 * so a session-file change since the last observation fires the registered
 * invalidation hooks. This is how tests drive a REAL transition without stubbing
 * session-state.
 */
function observeTransition(): void {
  sf.hasValidSession();
}

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockReset();
  fsMock.existsSync.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await loadModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION 1 — warm PRIVATE character cache must not survive a logout that
// nobody explicitly reported (the early cache return once preceded the auth
// check).
// ─────────────────────────────────────────────────────────────────────────────
describe("warm private character cache does not survive a session transition", () => {
  const charUrl = `${CHAR_SERVICE}/character/v5/character/123?includeCustomItems=true`;

  function characterFetch() {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const cookie = ((opts?.headers ?? {}) as Record<string, string>).Cookie ?? "";
      if (url === charUrl) {
        if (cookie.includes("SECRET_A")) return jsonResponse({ data: { name: "PRIVATE_A" } });
        if (cookie.includes("SECRET_B")) return jsonResponse({ data: { name: "PRIVATE_B" } });
        return jsonResponse({ data: { name: "PUBLIC" } });
      }
      return jsonResponse({});
    });
  }

  it("returns fresh (non-private-A) data after the session file is deleted", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    characterFetch();

    const first = await character.getCharacter("123");
    expect(first).toContain("PRIVATE_A");

    // Log out by deleting the file — WITHOUT calling any invalidate function.
    setSessionFile(null);

    const second = await character.getCharacter("123");
    expect(second).not.toContain("PRIVATE_A");
    expect(second).toContain("PUBLIC");
  });

  it("returns account B's data (never cached A) after account replacement", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    characterFetch();

    const a = await character.getCharacter("123");
    expect(a).toContain("PRIVATE_A");

    setSessionFile(sessionJson("SECRET_B"));
    const b = await character.getCharacter("123");
    expect(b).toContain("PRIVATE_B");
    expect(b).not.toContain("PRIVATE_A");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION 2 — a compendium build must ABANDON entirely when the account
// changes mid-batch, never caching old-account (or mixed) class spell lists.
// ─────────────────────────────────────────────────────────────────────────────
describe("spell compendium abandons the whole build on a mid-batch account change", () => {
  it("does not cache account A's class lists when the account is replaced during a body parse", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    // One class list (classId=1) has a DEFERRED body — the other seven resolve
    // immediately with account A's spells and are merged into the in-progress
    // build. We flip the account on disk only while class 1's body is pending,
    // so nothing observes the change until the batch is done — precisely the
    // "merge old results into a new-account compendium" path.
    let releaseDeferred!: (v: unknown) => void;
    const deferredBody = new Promise((r) => { releaseDeferred = r; });

    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.includes("/game-data/spells")) {
        const classId = new URL(url).searchParams.get("classId");
        if (classId === "1") {
          return {
            ok: true, status: 200, statusText: "",
            headers: { get: () => "application/json" },
            json: () => deferredBody,
          } as unknown as Response;
        }
        return jsonResponse({ data: [{ definition: { name: `SpellA${classId}`, level: 1, school: "Evocation" } }] });
      }
      if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
      return jsonResponse({});
    });

    const p = reference.searchSpells({ name: "spell" }).catch((e) => `THREW:${(e as Error)?.name}`);

    // Let the seven immediate class lists resolve into the build.
    await new Promise((r) => setTimeout(r, 0));

    // Replace the account, then release class 1's stale (account A) body.
    setSessionFile(sessionJson("SECRET_B"));
    releaseDeferred({ data: [{ definition: { name: "SpellA1", level: 1, school: "Evocation" } }] });
    await p;

    // The build spanned the A→B boundary, so it must have been abandoned and
    // NOT cached — provenance stays null (Open5e fallback carries the call).
    expect(reference.getCompendiumSource()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Character: a delayed body parse across an account change is not cached.
// ─────────────────────────────────────────────────────────────────────────────
describe("character delayed body parse cannot cache A into B", () => {
  const charUrl = `${CHAR_SERVICE}/character/v5/character/55?includeCustomItems=true`;

  it("throws SessionChangedError and caches nothing when the account changes mid-parse", async () => {
    setSessionFile(sessionJson("SECRET_A"));

    let releaseBody!: (v: unknown) => void;
    const body = new Promise((r) => { releaseBody = r; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === charUrl) {
        return { ok: true, status: 200, statusText: "", headers: { get: () => "application/json" }, json: () => body } as unknown as Response;
      }
      return jsonResponse({ data: { name: "PUBLIC" } });
    });

    const pending = character.getCharacter("55").catch((e) => e);
    // Replace the account while the body is in flight, then release account A's body.
    setSessionFile(sessionJson("SECRET_B"));
    releaseBody({ data: { name: "PRIVATE_A" } });

    const result = await pending;
    expect(result).toBeInstanceOf(sf.SessionChangedError);

    // Nothing was cached: a fresh read for account B fetches anew (PRIVATE_B).
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const cookie = ((opts?.headers ?? {}) as Record<string, string>).Cookie ?? "";
      if (url === charUrl) return jsonResponse({ data: { name: cookie.includes("SECRET_B") ? "PRIVATE_B" : "PRIVATE_A" } });
      return jsonResponse({});
    });
    const second = await character.getCharacter("55");
    expect(second).toContain("PRIVATE_B");
    expect(second).not.toContain("PRIVATE_A");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Campaign: warm private membership + the restored direct Bearer assertion.
// ─────────────────────────────────────────────────────────────────────────────
describe("campaign cache across deletion and replacement", () => {
  function campaignFetchMock() {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const cookie = ((opts?.headers ?? {}) as Record<string, string>).Cookie ?? "";
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt(cookie.includes("SECRET_B") ? "77" : "99") });
      if (url.includes("/campaign/stt/user-campaigns")) {
        const name = cookie.includes("SECRET_B") ? "CampB" : "CampA";
        return jsonResponse({ status: "success", data: [{ id: 1, name, dmUsername: "dm", dmId: 1, playerCount: 1, dateCreated: "2024" }] });
      }
      return jsonResponse({});
    });
  }

  it("carries an Authorization: Bearer header on the campaign request (real stack)", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    campaignFetchMock();

    await campaign.listMyCampaigns();

    const campaignCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/user-campaigns"));
    expect(campaignCall).toBeDefined();
    expect(authOf(campaignCall!)).toMatch(/^Bearer /);
    expect(cookieOf(campaignCall!)).toContain("SECRET_A");
  });

  it("clears the campaign list on logout (no stale return)", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    campaignFetchMock();

    expect(await campaign.listMyCampaigns()).toContain("CampA");

    setSessionFile(null);
    observeTransition();
    await expect(campaign.listMyCampaigns()).rejects.toThrow(/Not logged in/);
  });

  it("never returns account A's campaigns after account replacement", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    campaignFetchMock();
    expect(await campaign.listMyCampaigns()).toContain("CampA");

    setSessionFile(sessionJson("SECRET_B"));
    const b = await campaign.listMyCampaigns();
    expect(b).toContain("CampB");
    expect(b).not.toContain("CampA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Monster + game config caches.
// ─────────────────────────────────────────────────────────────────────────────
describe("monster cache across a session transition", () => {
  const CONFIG_URL = "https://www.dndbeyond.com/api/config/json";
  const config = {
    challengeRatings: [{ id: 1, value: 1, xp: 200, proficiencyBonus: 2 }],
    monsterTypes: [{ id: 1, name: "Humanoid" }],
    alignments: [{ id: 1, name: "Neutral" }],
    senses: [],
  };
  function monsterEntry(name: string) {
    return {
      id: 1, name, alignmentId: 1, sizeId: 4, typeId: 1, armorClass: 15,
      armorClassDescription: "", averageHitPoints: 7, hitPointDice: null,
      passivePerception: 10, challengeRatingId: 1, isHomebrew: false,
      isLegendary: false, isMythic: false, stats: [], savingThrows: [],
      senses: [], movements: [], languageDescription: "", languageNote: "",
      skillsHtml: "", specialTraitsDescription: "", actionsDescription: "",
      reactionsDescription: "", legendaryActionsDescription: "",
      mythicActionsDescription: "", bonusActionsDescription: "",
    };
  }
  function monsterFetchMock() {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const cookie = ((opts?.headers ?? {}) as Record<string, string>).Cookie ?? "";
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url === CONFIG_URL) return jsonResponse({ data: config });
      if (url.includes(`${MONSTER_SERVICE}/v1/Monster?search=`)) {
        const name = cookie.includes("SECRET_B") ? "GoblinB" : "GoblinA";
        return jsonResponse({ pagination: { total: 1, currentPage: 1, pages: 1 }, data: [monsterEntry(name)] });
      }
      if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
      return jsonResponse({});
    });
  }

  it("re-fetches (never serves account A's cached monster) after replacement", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    monsterFetchMock();

    const a = await monster.searchMonsters({ name: "goblin" });
    expect(a).toContain("GoblinA");

    setSessionFile(sessionJson("SECRET_B"));
    const b = await monster.searchMonsters({ name: "goblin" });
    expect(b).toContain("GoblinB");
    expect(b).not.toContain("GoblinA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item compendium + character-seeded spell buffer + ddb_clear_cache behaviour.
// ─────────────────────────────────────────────────────────────────────────────
describe("item compendium + character-seeded spell buffer", () => {
  function itemFetchMock() {
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const cookie = ((opts?.headers ?? {}) as Record<string, string>).Cookie ?? "";
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      if (url.includes("/game-data/items")) {
        const name = cookie.includes("SECRET_B") ? "ItemB" : "ItemA";
        return jsonResponse({ data: [{ id: 1, name, type: "Wondrous", filterType: "Wondrous", rarity: "Rare", requiresAttunement: false, attunementDescription: "", description: "d", snippet: "", weight: 0, damage: null, properties: null, armorClass: null, magic: true }] });
      }
      if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
      return jsonResponse({});
    });
  }

  it("clears the warm item cache on replacement (no ItemA leak)", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    itemFetchMock();

    expect(await reference.searchItems({ name: "item" })).toContain("ItemA");

    setSessionFile(sessionJson("SECRET_B"));
    const b = await reference.searchItems({ name: "item" });
    expect(b).toContain("ItemB");
    expect(b).not.toContain("ItemA");
  });

  it("drops the character-seeded spell buffer on a session transition", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    observeTransition(); // establish account A as the observed baseline
    reference.addCharacterSpellsToCompendium({
      classSpells: [{ spells: [{ definition: { name: "Hex", concentration: true } }] }],
    });
    expect(reference.isConcentrationSpell("Hex")).toBe(true);

    setSessionFile(null);
    observeTransition();
    // Hook cleared the buffer: the character-sourced spell is gone.
    expect(reference.isConcentrationSpell("Hex")).toBeNull();
  });

  it("clearReferenceCache() also wipes the character spell buffer and item compendium (ddb_clear_cache)", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    itemFetchMock();

    // Seed both the item compendium and the character spell buffer.
    await reference.searchItems({ name: "item" });
    reference.addCharacterSpellsToCompendium({
      classSpells: [{ spells: [{ definition: { name: "Bless", concentration: true } }] }],
    });
    expect(reference.isConcentrationSpell("Bless")).toBe(true);

    reference.clearReferenceCache();

    // Buffer cleared: spell is gone.
    expect(reference.isConcentrationSpell("Bless")).toBeNull();
    // Item compendium cleared: the next search re-fetches (fetch count grows).
    const before = fetchMock.mock.calls.length;
    await reference.searchItems({ name: "item" });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
