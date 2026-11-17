/**
 * Subclass always-prepared spells (F4, owner ruling R1 2026-11-13, closes
 * carry-over (bb); owner decisions S1–S4 2026-11-17). The pure merge
 * (character/always-prepared.ts) and the fetch layer (subclass-spells.ts),
 * driven through the REAL session lifecycle: only `fs` and the global `fetch`
 * are mocked, as in session-consumers.test.ts.
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";
import { mergeAlwaysPreparedSpells, subclassRequests, type SubclassSpellLists } from "../src/tools/character/always-prepared.js";
import { isShownClassSpell } from "../src/tools/character/spells.js";
import { CLERIC_5_SPELLS } from "./fixtures/character-fixtures.js";

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
  readdirSync: vi.fn(() => []),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

type CharacterModule = typeof import("../src/tools/character.js");
type SubclassSpellsModule = typeof import("../src/tools/subclass-spells.js");
type SessionFetchModule = typeof import("../src/session-fetch.js");

let character: CharacterModule;
let subclassSpells: SubclassSpellsModule;
let sf: SessionFetchModule;
let fetchMock: Mock<(url: string, opts?: RequestInit) => Promise<Response>>;

const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const CHAR_SERVICE = "https://character-service.dndbeyond.com/character/v5";
const ALWAYS_PREPARED = `${CHAR_SERVICE}/game-data/always-prepared-spells`;
const NOTICE = "Subclass always-prepared spells couldn't be loaded from D&D Beyond, so the spell lists may be incomplete.";

// ── Fixtures (the live always-prepared entry shape, trimmed) ─────────────────

const oneAction = { activationTime: 1, activationType: 1 };
const bonusAction = { activationTime: 1, activationType: 3 };
/** One `always-prepared-spells` entry, as D&D Beyond sends it. */
const entry = (id: number, name: string, level: number, extra: Record<string, unknown> = {}) => ({
  id: id * 10, entityTypeId: 435869154, prepared: false, alwaysPrepared: true, usesSpellSlot: true, castAtLevel: null,
  definition: { id, name, level, activation: oneAction, sources: [{ sourceId: 2 }], isHomebrew: false, ...extra },
});
const BLESS = entry(2012, "Bless", 1, { concentration: true });
const CURE_WOUNDS = entry(2063, "Cure Wounds", 1);
const SPIRITUAL_WEAPON = entry(2282, "Spiritual Weapon", 2, { activation: bonusAction });
const GUIDANCE = entry(2132, "Guidance", 0, { concentration: true });

/** A Life Domain 9 cleric (class entry 151440037, subclass 19) and a Fighter 3 with no subclass. */
function lifeCleric(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base = CLERIC_5_SPELLS.data as Record<string, unknown>;
  const [cleric] = base.classes as Record<string, unknown>[];
  const [list] = base.classSpells as Record<string, unknown>[];
  return {
    data: {
      ...base,
      name: "Lifegiver",
      classes: [{ ...cleric, id: 151440037, level: 9, subclassDefinition: { id: 19, name: "Life Domain", sources: [{ sourceId: 2 }] } }],
      classSpells: [{ ...list, characterClassId: 151440037 }],
      ...extra,
    },
  };
}

const lists = (...pairs: Array<[number, Record<string, unknown>[]]>): SubclassSpellLists => new Map(pairs);
const dataOf = (raw: Record<string, unknown>) => raw.data as Record<string, unknown>;
const classSpellsOf = (raw: Record<string, unknown>) => dataOf(raw).classSpells as Array<Record<string, unknown>>;
const names = (spells: unknown) => (spells as Array<{ definition: { name: string } }>).map(s => s.definition.name);

// ── Pure: requests and merge ──────────────────────────────────────────────────

describe("subclassRequests", () => {
  it("subclassRequests lists one request per subclassed class at its level", () => {
    const char = { classes: [
      { id: 151440037, level: 9, definition: { id: 2 }, subclassDefinition: { id: 19 } },
      { id: 2, level: 3, definition: { id: 8 } },
    ] };
    expect(subclassRequests(char)).toEqual([{ characterClassId: 151440037, subclassId: 19, level: 9 }]);
  });
});

describe("mergeAlwaysPreparedSpells", () => {
  it("mergeAlwaysPreparedSpells appends into the matching classSpells entry, marked alwaysPrepared", () => {
    const merged = mergeAlwaysPreparedSpells(lifeCleric(), lists([151440037, [BLESS, CURE_WOUNDS]]));
    const [cs] = classSpellsOf(merged);
    expect(classSpellsOf(merged)).toHaveLength(1);
    expect(names(cs.spells)).toEqual(["Sacred Flame", "Guiding Bolt", "Light", "Bless", "Cure Wounds"]);
    const bless = (cs.spells as Array<Record<string, unknown>>)[3];
    expect(bless).toMatchObject({ alwaysPrepared: true, prepared: false, usesSpellSlot: true });
  });

  it("mergeAlwaysPreparedSpells skips a spell already on the sheet by definition id, in any list or bucket, keeping the sheet entry's own fields", () => {
    const sheetBless = { prepared: false, definition: { ...BLESS.definition } };
    const itemCure = { usesSpellSlot: false, castAtLevel: 3, definition: { ...CURE_WOUNDS.definition } };
    const raw = lifeCleric({
      classes: [
        ...(lifeCleric().data as { classes: unknown[] }).classes,
        { id: 5, level: 1, definition: { name: "Paladin" }, subclassDefinition: null },
      ],
      classSpells: [
        { characterClassId: 151440037, spells: [] },
        { characterClassId: 5, spells: [sheetBless] },
      ],
      spells: { item: [itemCure] },
    });
    const merged = mergeAlwaysPreparedSpells(raw, lists([151440037, [BLESS, CURE_WOUNDS, SPIRITUAL_WEAPON]]));
    const [cleric, paladin] = classSpellsOf(merged);
    expect(names(cleric.spells)).toEqual(["Spiritual Weapon"]);
    expect(paladin.spells).toEqual([sheetBless]);
    expect((dataOf(merged).spells as Record<string, unknown>).item).toEqual([itemCure]);
  });

  it("mergeAlwaysPreparedSpells appends to the 2024 classSpells field when that is the list the parser reads", async () => {
    const { parseCharacterData } = await import("../src/tools/character.js");
    const raw = lifeCleric({ classSpells: [{ characterClassId: 151440037, spells: [], classSpells: [{ prepared: true, definition: GUIDANCE.definition }] }] });
    const merged = mergeAlwaysPreparedSpells(raw, lists([151440037, [BLESS]]));
    const [cs] = classSpellsOf(merged);
    expect(cs.spells).toEqual([]);
    expect(names(cs.classSpells)).toEqual(["Guidance", "Bless"]);
    const out = parseCharacterData(merged, "spells");
    expect(out).toContain("Guidance");
    expect(out).toContain("Bless");
  });

  it("mergeAlwaysPreparedSpells creates the classSpells entry when the class has none, and never mutates its input", () => {
    const raw = lifeCleric({ classSpells: [] });
    const before = JSON.stringify(raw);
    const merged = mergeAlwaysPreparedSpells(raw, lists([151440037, [BLESS]]));
    expect(JSON.stringify(raw)).toBe(before);
    expect(classSpellsOf(merged)).toEqual([{ characterClassId: 151440037, spells: [{ ...BLESS, alwaysPrepared: true }] }]);

    // A bare (no `data`) character JSON is handled the same way.
    const bare = dataOf(lifeCleric({ classSpells: undefined }));
    const bareBefore = JSON.stringify(bare);
    const mergedBare = mergeAlwaysPreparedSpells(bare, lists([151440037, [BLESS]]));
    expect(JSON.stringify(bare)).toBe(bareBefore);
    expect(mergedBare.data).toBeUndefined();
    expect(names((mergedBare.classSpells as Array<Record<string, unknown>>)[0].spells)).toEqual(["Bless"]);
  });

  it("an empty list (every 2024 subclass) changes nothing", () => {
    const raw = lifeCleric();
    expect(mergeAlwaysPreparedSpells(raw, lists([151440037, []]))).toEqual(raw);
  });
});

describe("isShownClassSpell", () => {
  it("isShownClassSpell shows an alwaysPrepared spellbook spell", () => {
    const shield = { prepared: false, definition: { id: 1, name: "Shield", level: 1 } };
    expect(isShownClassSpell(shield, true)).toBe(false);
    expect(isShownClassSpell({ ...shield, alwaysPrepared: true }, true)).toBe(true);
  });
});

// ── Fetch layer, through the real session lifecycle ──────────────────────────

function makeCookie(value: string) {
  return { name: "CobaltSession", value, domain: ".dndbeyond.com", path: "/", expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true };
}
const sessionJson = (cookieValue: string) => JSON.stringify({ cookies: [makeCookie(cookieValue)] });

function setSessionFile(content: string | null): void {
  if (content === null) {
    fsMock.existsSync.mockReturnValue(false);
    return;
  }
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readFileSync.mockReturnValue(content);
}

function makeJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300, status, statusText: "",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  } as unknown as Response;
}

const charUrl = (id: string) => `${CHAR_SERVICE}/character/${id}?includeCustomItems=true`;
const listCalls = () => fetchMock.mock.calls.filter(c => c[0].startsWith(ALWAYS_PREPARED));
const listParams = (url: string) => {
  const q = new URL(url).searchParams;
  return { classId: Number(q.get("classId")), classLevel: Number(q.get("classLevel")), sharingSetting: q.get("sharingSetting") };
};

type ListAnswer = (params: { classId: number; classLevel: number }, opts?: RequestInit) => Response | Promise<Response>;

/**
 * character-service and auth-service: each character id serves its JSON, the
 * always-prepared endpoint answers through `answer`, the cobalt exchange gives
 * a token for SECRET_A / SECRET_B. Anything else (the game config) is a 404.
 */
function serve(characters: Record<string, Record<string, unknown>>, answer: ListAnswer): void {
  fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url === COBALT_URL) {
      const cookie = ((opts?.headers ?? {}) as Record<string, string>).Cookie ?? "";
      if (cookie.includes("SECRET_A")) return jsonResponse({ token: makeJwt("99") });
      if (cookie.includes("SECRET_B")) return jsonResponse({ token: makeJwt("77") });
      return jsonResponse({}, 401);
    }
    if (url.startsWith(ALWAYS_PREPARED)) return answer(listParams(url), opts);
    for (const [id, raw] of Object.entries(characters)) if (url === charUrl(id)) return jsonResponse(raw);
    return jsonResponse({}, 404);
  });
}

/** Life Domain's level-9 list, by classId (19); any other subclass answers []. */
const lifeList: ListAnswer = ({ classId }) =>
  jsonResponse({ data: classId === 19 ? [BLESS, CURE_WOUNDS, SPIRITUAL_WEAPON] : [] });

async function loadModules(): Promise<void> {
  vi.resetModules();
  character = await import("../src/tools/character.js");
  subclassSpells = await import("../src/tools/subclass-spells.js");
  sf = await import("../src/session-fetch.js");
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

/** The lines from section header `from` to the next blank line. */
function block(out: string, from: string): string {
  const lines = out.split("\n");
  const start = lines.findIndex(l => l.trim().startsWith(from));
  expect(start, `no ${from} in:\n${out}`).toBeGreaterThan(-1);
  const end = lines.indexOf("", start);
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.readFileSync.mockReset();
  fsMock.existsSync.mockReset();
  fetchMock = vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
  setSessionFile(null);
  await loadModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseCharacter with subclass always-prepared spells", () => {
  it("parseCharacter lists Life Domain spells for a Life 9 cleric in spells, concentration and combat", async () => {
    serve({ "1": lifeCleric() }, lifeList);
    const full = await character.parseCharacter("1", "full");
    const spells = await character.parseCharacter("1", "spells");
    const conc = await character.parseCharacter("1", "concentration");
    const combat = await character.parseCharacter("1", "combat");

    expect(listCalls()).toHaveLength(1);
    expect(listParams(listCalls()[0][0])).toEqual({ classId: 19, classLevel: 9, sharingSetting: "2" });
    expect(spells).toMatch(/Bless/);
    expect(spells).toMatch(/Cure Wounds/);
    expect(spells).toMatch(/Spiritual Weapon/);
    expect(block(conc, "Level 1")).toMatch(/Bless/);
    expect(block(combat, "BONUS ACTIONS")).toContain("• Spiritual Weapon (spell, 2nd-level slot)");
    expect(full).not.toContain(NOTICE);
  });

  it("ddb_character_lookup finds a merged spell", async () => {
    serve({ "1": lifeCleric() }, lifeList);
    const out = await character.getDefinition("1", "Spiritual Weapon");
    expect(out).toContain("Spiritual Weapon");
    expect(out).not.toMatch(/^No definition found/);
  });

  it("one failed subclass request leaves the other subclass merged and adds the notice", async () => {
    const base = dataOf(lifeCleric());
    const raw = { data: {
      ...base,
      classes: [
        ...(base.classes as unknown[]),
        { id: 300, level: 3, isStartingClass: false, hitDiceUsed: 0, classFeatures: [],
          definition: { name: "Paladin", hitDice: 10, canCastSpells: true, spellCastingAbilityId: 6, sources: [{ sourceId: 2 }] },
          subclassDefinition: { id: 61, name: "Oath of Devotion", sources: [{ sourceId: 2 }] } },
      ],
    } };
    serve({ "2": raw }, ({ classId }) => classId === 61
      ? jsonResponse({ data: [entry(2235, "Sanctuary", 1), entry(2241, "Protection from Evil and Good", 1)] })
      : jsonResponse({}, 404));

    const out = await character.parseCharacter("2", "spells");
    expect(out.startsWith(`⚠️ ${NOTICE}\n\n`)).toBe(true);
    expect(out).toContain("Sanctuary");
    expect(out).not.toContain("Bless");
  });

  it("a failed always-prepared request still parses, adds the notice, and is retried next call", async () => {
    let failing = true;
    serve({ "1": lifeCleric() }, params => failing ? jsonResponse({}, 404) : lifeList(params));

    const first = await character.parseCharacter("1", "spells");
    expect(first.startsWith(`⚠️ ${NOTICE}`)).toBe(true);
    expect(first).toContain("Guiding Bolt");
    expect(first).not.toContain("Bless");

    failing = false;
    const second = await character.parseCharacter("1", "spells");
    expect(second).not.toContain(NOTICE);
    expect(second).toContain("Bless");
    expect(listCalls()).toHaveLength(2);

    // Now cached: a third call sends no request.
    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(2);
  });

  it.each([
    ["not JSON", () => ({ ...jsonResponse(null), json: async () => { throw new SyntaxError("Unexpected token <"); } }) as unknown as Response],
    ["no data array", () => jsonResponse({ data: { spells: [] } })],
    ["an entry without a definition", () => jsonResponse({ data: [{ id: 1 }] })],
  ])("a malformed reply (%s) is a failure: notice, nothing merged, not cached", async (_label, reply) => {
    serve({ "1": lifeCleric() }, () => reply());
    const first = await character.parseCharacter("1", "spells");
    expect(first.startsWith(`⚠️ ${NOTICE}`)).toBe(true);
    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(2);
  });

  it("an empty list is a real answer: no notice, and cached", async () => {
    serve({ "1": lifeCleric() }, () => jsonResponse({ data: [] }));
    const first = await character.parseCharacter("1", "spells");
    expect(first).not.toContain(NOTICE);
    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(1);
  });

  it("a request that outlasts the 10 s deadline counts as failed: notice, not cached, slot freed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let stall = true;
    serve({ "1": lifeCleric() }, (params, opts) => stall
      // Never answers; only the deadline's abort ends it.
      ? new Promise<Response>((_, reject) => opts?.signal?.addEventListener("abort", () => reject(opts.signal!.reason)))
      : lifeList(params));

    expect(subclassSpells.SUBCLASS_SPELLS_TIMEOUT_MS).toBe(10_000);
    const pending = character.parseCharacter("1", "spells");
    await vi.advanceTimersByTimeAsync(subclassSpells.SUBCLASS_SPELLS_TIMEOUT_MS);
    const first = await pending;
    expect(first.startsWith(`⚠️ ${NOTICE}`)).toBe(true);
    expect(first).toContain("Guiding Bolt");

    stall = false;
    const second = await character.parseCharacter("1", "spells");
    expect(second).toContain("Bless");
    expect(listCalls()).toHaveLength(2);
  });

  it("concurrent cold callers share one request", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    serve({ "1": lifeCleric() }, async params => { await gate; return lifeList(params); });
    const both = Promise.all([character.parseCharacter("1", "spells"), character.parseCharacter("1", "spells")]);
    await vi.waitFor(() => expect(listCalls()).toHaveLength(1));
    release();
    const [a, b] = await both;
    expect(a).toContain("Bless");
    expect(b).toContain("Bless");
    expect(listCalls()).toHaveLength(1);
  });

  it("a homebrew merged spell is wrapped; an official one is plain", async () => {
    const brew = entry(990001, "Radiant Brewbolt", 1, { isHomebrew: true, sources: [] });
    serve({ "1": lifeCleric() }, () => jsonResponse({ data: [BLESS, brew] }));
    const out = await character.parseCharacter("1", "spells");
    const lines = out.split("\n");
    const at = (name: string) => lines.findIndex(l => l.includes(name));
    expect(lines[at("Radiant Brewbolt") - 1]).toBe("<untrusted_dndbeyond_content>");
    expect(lines[at("Radiant Brewbolt") + 1]).toBe("</untrusted_dndbeyond_content>");
    expect(lines[at("Bless") - 1]).not.toBe("<untrusted_dndbeyond_content>");
    expect(lines[at("Bless") + 1]).not.toBe("</untrusted_dndbeyond_content>");
  });

  it("ddb_get_character_raw returns D&D Beyond's JSON unchanged", async () => {
    const raw = lifeCleric();
    serve({ "1": raw }, lifeList);
    const { json } = await character.getCharacterRaw("1");
    expect(json).toBe(`<untrusted_dndbeyond_content>\n${JSON.stringify(raw)}\n</untrusted_dndbeyond_content>`);
    expect(listCalls()).toHaveLength(0);
  });

  it("a character with no subclass sends no always-prepared request", async () => {
    serve({ "1": CLERIC_5_SPELLS }, lifeList);
    const out = await character.parseCharacter("1", "spells");
    expect(out).not.toContain(NOTICE);
    expect(listCalls()).toHaveLength(0);
  });
});

describe("always-prepared lists and the session", () => {
  it("logged in, the lists go out with the account's token, bound to the character's session", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    serve({ "1": lifeCleric() }, lifeList);
    const out = await character.parseCharacter("1", "spells");
    expect(out).toContain("Bless");
    const [, opts] = listCalls()[0];
    const headers = (opts?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${makeJwt("99")}`);
    expect(headers.Cookie).toContain("SECRET_A");
  });

  it("logged out, the lists go out anonymously", async () => {
    serve({ "1": lifeCleric() }, lifeList);
    await character.parseCharacter("1", "spells");
    const headers = (listCalls()[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
  });

  it("when the token exchange fails, the lists go out anonymously, with only the character's notice, and aren't cached", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setSessionFile(sessionJson("SECRET_UNKNOWN"));
    serve({ "1": lifeCleric() }, lifeList);
    const out = await character.parseCharacter("1", "spells");
    expect(out).toContain("Bless");
    expect(out).toMatch(/rejected the saved session/);
    expect(out).not.toContain(NOTICE);
    const headers = (listCalls()[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(2);
  });

  it("a token lookup that stalls counts against the 10 s deadline: notice, character still parsed", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setSessionFile(sessionJson("SECRET_A"));
    let cobaltCalls = 0;
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === COBALT_URL) {
        // The character's exchange is refused; the lists' retry never answers.
        if (++cobaltCalls === 1) return jsonResponse({}, 401);
        return new Promise<Response>((_, reject) => opts?.signal?.addEventListener("abort", () => reject(opts.signal!.reason)));
      }
      if (url === charUrl("1")) return jsonResponse(lifeCleric());
      if (url.startsWith(ALWAYS_PREPARED)) return lifeList(listParams(url), opts);
      return jsonResponse({}, 404);
    });
    const pending = character.parseCharacter("1", "spells");
    await vi.advanceTimersByTimeAsync(subclassSpells.SUBCLASS_SPELLS_TIMEOUT_MS);
    const out = await pending;
    expect(out).toMatch(/rejected the saved session/);
    expect(out).toContain(NOTICE);
    expect(out).toContain("Guiding Bolt");
    expect(listCalls()).toHaveLength(0);
  });

  it("a session change between the character fetch and the lists fetch rejects with SessionChangedError and caches nothing", async () => {
    // Logged out, the character fetch itself has no session to re-check, so a
    // login landing while its body is read is first seen by the lists fetch.
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === charUrl("1")) {
        return { ...jsonResponse(null), json: async () => { setSessionFile(sessionJson("SECRET_A")); return lifeCleric(); } } as unknown as Response;
      }
      if (url.startsWith(ALWAYS_PREPARED)) return lifeList(listParams(url), opts);
      if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
      return jsonResponse({}, 404);
    });
    const err = await rejection(character.parseCharacter("1", "spells"));
    expect(err).toBeInstanceOf(sf.SessionChangedError);

    // Nothing was cached: account A's next call fetches its own list.
    serve({ "1": lifeCleric() }, lifeList);
    const before = listCalls().length;
    const out = await character.parseCharacter("1", "spells");
    expect(out).toContain("Bless");
    expect(listCalls().length).toBe(before + 1);
    expect(((listCalls().at(-1)![1]?.headers ?? {}) as Record<string, string>).Authorization).toBe(`Bearer ${makeJwt("99")}`);
  });

  it("a session change after the character fetch is refused even when the lists come from the cache", async () => {
    serve({ "1": lifeCleric() }, lifeList);
    await character.parseCharacter("1", "spells");
    // Character 2 (the same class) is read while a login lands; its lists need no request.
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === charUrl("2")) {
        return { ...jsonResponse(null), json: async () => { setSessionFile(sessionJson("SECRET_A")); return lifeCleric(); } } as unknown as Response;
      }
      if (url.startsWith(ALWAYS_PREPARED)) return lifeList(listParams(url), opts);
      return jsonResponse({}, 404);
    });
    const err = await rejection(character.parseCharacter("2", "spells"));
    expect(err).toBeInstanceOf(sf.SessionChangedError);
    expect(listCalls()).toHaveLength(1);
  });

  it("an account change during the lists fetch rejects with SessionChangedError and caches nothing", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    let swap = true;
    serve({ "1": lifeCleric() }, params => {
      if (swap) setSessionFile(sessionJson("SECRET_B"));
      return lifeList(params);
    });
    const err = await rejection(character.parseCharacter("1", "spells"));
    expect(err).toBeInstanceOf(sf.SessionChangedError);

    swap = false;
    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(2);
    expect((listCalls()[1][1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${makeJwt("77")}`);
  });

  it("a session change drops the cached lists", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    serve({ "1": lifeCleric() }, lifeList);
    await character.parseCharacter("1", "spells");
    setSessionFile(sessionJson("SECRET_B"));
    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(2);
  });
});

describe("clearing the always-prepared cache", () => {
  it("clearSubclassSpellCache mid-fetch leaves nothing cached", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let hold = true;
    serve({ "1": lifeCleric() }, async params => { if (hold) await gate; return lifeList(params); });
    const pending = character.parseCharacter("1", "spells");
    await vi.waitFor(() => expect(listCalls()).toHaveLength(1));
    subclassSpells.clearSubclassSpellCache();
    hold = false;
    release();
    expect(await pending).toContain("Bless");

    await character.parseCharacter("1", "spells");
    expect(listCalls()).toHaveLength(2);
  });

  it.each(["characters", "all"] as const)("ddb_clear_cache %s clears it", async (cache) => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { server } = await import("../src/server.js");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      serve({ "1": lifeCleric() }, lifeList);
      await character.parseCharacter("1", "spells");
      await character.parseCharacter("1", "spells");
      expect(listCalls()).toHaveLength(1);

      const reply = await client.callTool({ name: "ddb_clear_cache", arguments: { cache } });
      expect(JSON.stringify(reply.content)).toContain("subclass always-prepared spells");
      await character.parseCharacter("1", "spells");
      expect(listCalls()).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it("ddb_clear_cache spells and monsters leave it alone", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { server } = await import("../src/server.js");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      serve({ "1": lifeCleric() }, lifeList);
      await character.parseCharacter("1", "spells");
      for (const cache of ["spells", "monsters"]) await client.callTool({ name: "ddb_clear_cache", arguments: { cache } });
      await character.parseCharacter("1", "spells");
      expect(listCalls()).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});
