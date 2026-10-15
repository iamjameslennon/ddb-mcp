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

/**
 * Model character-service as it really behaves: the cobalt-token exchange is
 * keyed by the session cookie (SECRET_A → user 99, SECRET_B → user 77), and the
 * character endpoint authorizes ONLY by Bearer token — cookies are ignored, so a
 * cookie-only request is answered exactly like an anonymous one. `respond`
 * receives "A"/"B" for the account whose token was sent, or null when none was.
 */
function characterServiceMock(
  charUrl: string,
  respond: (who: "A" | "B" | null) => Response | Promise<Response>
) {
  const tokenA = makeJwt("99");
  const tokenB = makeJwt("77");
  return async (url: string, opts?: RequestInit) => {
    const call = [url, opts];
    if (url === COBALT_URL) {
      const cookie = cookieOf(call);
      if (cookie.includes("SECRET_A")) return jsonResponse({ token: tokenA });
      if (cookie.includes("SECRET_B")) return jsonResponse({ token: tokenB });
      return jsonResponse({}, 401);
    }
    if (url === charUrl) {
      const auth = authOf(call);
      return respond(auth === `Bearer ${tokenA}` ? "A" : auth === `Bearer ${tokenB}` ? "B" : null);
    }
    return jsonResponse({});
  };
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
    fetchMock.mockImplementation(characterServiceMock(charUrl, (who) =>
      jsonResponse({ data: { name: who ? `PRIVATE_${who}` : "PUBLIC" } })
    ));
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
    // Resolves once getCharacter is awaiting the body — i.e. past the token
    // exchange AND every pre-parse authority check (snapshotFetch re-checks
    // after the response arrives, so "request dispatched" is too early: a swap
    // there is caught before the parse and never reaches the cache guard).
    let parseStarted!: () => void;
    const awaitingBody = new Promise<void>((r) => { parseStarted = r; });
    fetchMock.mockImplementation(characterServiceMock(charUrl, () =>
      ({
        ok: true, status: 200, statusText: "", headers: { get: () => "application/json" },
        json: () => { parseStarted(); return body; },
      } as unknown as Response)
    ));

    const pending = character.getCharacter("55").catch((e) => e);
    // Replace the account while the body is in flight, then release account A's
    // body: only the post-parse guard stands between it and the cache.
    await awaitingBody;
    setSessionFile(sessionJson("SECRET_B"));
    releaseBody({ data: { name: "PRIVATE_A" } });

    const result = await pending;
    expect(result).toBeInstanceOf(sf.SessionChangedError);

    // Nothing was cached: a fresh read for account B fetches anew (PRIVATE_B).
    fetchMock.mockImplementation(characterServiceMock(charUrl, (who) =>
      jsonResponse({ data: { name: who ? `PRIVATE_${who}` : "PUBLIC" } })
    ));
    const second = await character.getCharacter("55");
    expect(second).toContain("PRIVATE_B");
    expect(second).not.toContain("PRIVATE_A");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Character: authenticated fetches carry the cobalt Bearer token (character-
// service ignores cookies), bound to the same snapshot as the cookies.
// ─────────────────────────────────────────────────────────────────────────────
describe("character fetch authenticates with a snapshot-bound Bearer token", () => {
  const charUrl = `${CHAR_SERVICE}/character/v5/character/77?includeCustomItems=true`;
  const charCalls = () => fetchMock.mock.calls.filter((c) => c[0] === charUrl);

  function privateCharacterMock() {
    // A private character: only its owner's (account A's) token gets a 200.
    fetchMock.mockImplementation(characterServiceMock(charUrl, (who) =>
      who === "A" ? jsonResponse({ data: { name: "PRIVATE_A" } }) : jsonResponse({}, 403)
    ));
  }

  it("sends Authorization: Bearer with the same account's cookies when logged in", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    privateCharacterMock();

    expect(await character.getCharacter("77")).toContain("PRIVATE_A");

    expect(charCalls()).toHaveLength(1);
    const call = charCalls()[0];
    // PRIVATE_A above is only served for account A's token; check it was a Bearer.
    expect(authOf(call)).toMatch(/^Bearer /);
    expect(cookieOf(call)).toContain("SECRET_A");
  });

  it("sends neither Authorization nor Cookie when anonymous", async () => {
    setSessionFile(null);
    fetchMock.mockImplementation(characterServiceMock(charUrl, () => jsonResponse({ data: { name: "PUBLIC" } })));

    expect(await character.getCharacter("77")).toContain("PUBLIC");

    expect(fetchMock.mock.calls.some((c) => c[0] === COBALT_URL)).toBe(false);
    expect(charCalls()).toHaveLength(1);
    expect(authOf(charCalls()[0])).toBe("");
    expect(cookieOf(charCalls()[0])).toBe("");
  });

  it("falls back to an anonymous request when the token exchange fails, so public characters still load", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({}, 401);
      if (url === charUrl) return jsonResponse({ data: { name: "PUBLIC" } });
      return jsonResponse({});
    });

    expect(await character.getCharacter("77")).toContain("PUBLIC");
    expect(authOf(charCalls()[0])).toBe("");
  });

  it("says to re-login when auth-service rejects the session (401) and the character then needs auth", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({}, 401);
      if (url === charUrl) return jsonResponse({}, 403);
      return jsonResponse({});
    });

    const err = await character.getCharacter("77").catch((e) => e as Error);
    expect(err.message).toMatch(/rejected the saved session \(cobalt-token request failed: 401\).*run ddb_login again/);
    expect(err.message).not.toMatch(/is private/);
  });

  it("says to retry, not re-login, when auth-service is unreachable (network error)", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) throw new TypeError("fetch failed");
      if (url === charUrl) return jsonResponse({}, 403);
      return jsonResponse({});
    });

    const err = await character.getCharacter("77").catch((e) => e as Error);
    expect(err.message).toMatch(/auth service could not be reached \(fetch failed\).*Try again in a moment/);
    expect(err.message).not.toMatch(/ddb_login/);
  });

  it("says to retry, not re-login, when auth-service keeps returning 5xx after retries", async () => {
    vi.useFakeTimers();
    setSessionFile(sessionJson("SECRET_A"));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === COBALT_URL) return jsonResponse({}, 503);
      if (url === charUrl) return jsonResponse({}, 403);
      return jsonResponse({});
    });

    const pending = character.getCharacter("77").catch((e) => e as Error);
    await vi.runAllTimersAsync(); // skip fetchWithRetry's backoff sleeps
    const err = await pending;
    expect(fetchMock.mock.calls.filter((c) => c[0] === COBALT_URL)).toHaveLength(4);
    expect(err.message).toMatch(/auth service could not be reached \(cobalt-token request failed: 503\).*Try again in a moment/);
    expect(err.message).not.toMatch(/ddb_login/);
  });

  it("refuses the request when the account changes during the token exchange", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    privateCharacterMock();
    const realImpl = fetchMock.getMockImplementation()!;

    // Hold account A's token exchange open, swap to account B, then release it.
    let releaseCobalt!: () => void;
    const cobaltGate = new Promise<void>((r) => { releaseCobalt = r; });
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === COBALT_URL) await cobaltGate;
      return realImpl(url, opts);
    });

    const pending = character.getCharacter("77").catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    setSessionFile(sessionJson("SECRET_B"));
    releaseCobalt();

    expect(await pending).toBeInstanceOf(sf.SessionChangedError);
    expect(charCalls()).toHaveLength(0);
  });

  it("never sends account A's token with account B's cookies when the account changes after the token is issued", async () => {
    // The swap lands AFTER the token exchange has fully returned and BEFORE the
    // character request is dispatched — the window a separate getCobaltToken()
    // + sessionFetch() pair leaves open, since sessionFetch would capture a
    // fresh (account B) snapshot and attach B's cookies next to A's token.
    privateCharacterMock();
    const realImpl = fetchMock.getMockImplementation()!;
    let tokenIssued = false;
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      const resp = await realImpl(url, opts);
      if (url !== COBALT_URL) return resp;
      return { ...resp, json: async () => { const b = await resp.json(); tokenIssued = true; return b; } } as Response;
    });

    // Flip the on-disk session on the first authority read made outside every
    // token-exchange frame once the token has been issued — i.e. the first read
    // after beginAuthenticatedSession() (or getCobaltToken()) has returned.
    const sessionA = sessionJson("SECRET_A");
    const sessionB = sessionJson("SECRET_B");
    let swapped = false;
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => {
      if (!swapped && tokenIssued) {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = Infinity;
        const stack = new Error().stack ?? "";
        Error.stackTraceLimit = limit;
        if (!/getCobaltToken|beginAuthenticatedSession/.test(stack)) swapped = true;
      }
      return swapped ? sessionB : sessionA;
    });

    const result = await character.getCharacter("77").catch((e) => e);

    expect(swapped).toBe(true); // the window was actually exercised
    expect(result).toBeInstanceOf(sf.SessionChangedError);
    const mixed = charCalls().filter((c) => /^Bearer /.test(authOf(c)) && cookieOf(c).includes("SECRET_B"));
    expect(mixed).toHaveLength(0);
  });

  it("is 403 for a private character when only cookies are sent (why the Bearer token is needed)", async () => {
    // Guards the mock itself: if character-service honoured cookies, this
    // whole block would prove nothing.
    privateCharacterMock();
    const resp = await fetchMock(charUrl, { headers: { Cookie: "CobaltSession=SECRET_A" } });
    expect(resp.status).toBe(403);
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
