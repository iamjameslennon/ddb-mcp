import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * spell-compendium-endpoints.test.ts
 *
 * character-service's /game-data/spells returns ONLY cantrips for prepared
 * casters (Cleric, Druid, Paladin); their leveled spells come from
 * /game-data/always-known-spells, which returns no cantrips. The compendium
 * must query both for every class. Real session-state / session-fetch; only
 * `fs` and global `fetch` are mocked (same approach as session-consumers).
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

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;
let fetchMock: ReturnType<typeof vi.fn>;

const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const GAME_DATA = "https://character-service.dndbeyond.com/character/v5/game-data";

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
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  } as unknown as Response;
}

function spell(name: string, level: number, description = `${name} description`) {
  return { definition: { name, level, school: "Evocation", description, concentration: false, ritual: false } };
}

type Endpoint = "spells" | "always-known-spells";
type Lists = Partial<Record<Endpoint, Record<string, unknown[]>>>;

/**
 * Model character-service: `lists[endpoint][classId]` is that request's spell
 * array (missing → empty list). `status[endpoint:classId]` overrides the HTTP
 * status; `delay[endpoint:classId]` delays that response by N ms.
 */
function serviceMock(lists: Lists, opts: { status?: Record<string, number>; delay?: Record<string, number> } = {}) {
  return async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(GAME_DATA)) {
      const u = new URL(url);
      const endpoint = u.pathname.split("/").pop() as Endpoint;
      const classId = u.searchParams.get("classId") ?? "";
      const key = `${endpoint}:${classId}`;
      const wait = opts.delay?.[key];
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const status = opts.status?.[key] ?? 200;
      if (status !== 200) return jsonResponse({}, status);
      return jsonResponse({ data: lists[endpoint]?.[classId] ?? [] });
    }
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  };
}

function gameDataUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(GAME_DATA));
}

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

describe("spell compendium queries both class spell-list endpoints", () => {
  it("requests /spells and /always-known-spells for all 8 spellcasting classes at classLevel 20", async () => {
    fetchMock.mockImplementation(serviceMock({ spells: { "8": [spell("Fire Bolt", 0)] } }));

    await reference.searchSpells({});

    const urls = gameDataUrls();
    expect(urls).toHaveLength(16);
    for (const endpoint of ["spells", "always-known-spells"]) {
      for (const classId of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect(urls).toContain(`${GAME_DATA}/${endpoint}?classId=${classId}&classLevel=20&sharingSetting=2`);
      }
    }
  });

  it("includes prepared-caster leveled spells that only /always-known-spells returns", async () => {
    fetchMock.mockImplementation(serviceMock({
      // Live shape: Cleric /spells is cantrips only, Paladin /spells is empty.
      spells: { "2": [spell("Sacred Flame", 0)], "8": [spell("Fire Bolt", 0), spell("Fireball", 3)] },
      "always-known-spells": {
        "2": [spell("Spirit Guardians", 3), spell("Bless", 1)],
        "4": [spell("Divine Smite", 1)],
      },
    }));

    const search = await reference.searchSpells({ limit: 50 });
    for (const name of ["Sacred Flame", "Fire Bolt", "Fireball", "Spirit Guardians", "Bless", "Divine Smite"]) {
      expect(search).toContain(`**${name}**`);
    }
    expect(search).toContain("(6 found)");
    expect(reference.getCompendiumSource()).toBe("ddb-authoritative");

    const got = await reference.getSpell("Spirit Guardians");
    expect(got).toContain("**Spirit Guardians** — Level 3");
    // Found in the DDB compendium, so Open5e must never be consulted.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("open5e"))).toBe(false);
  });

  it("marks the build partial when one always-known-spells request fails, keeping everything else", async () => {
    fetchMock.mockImplementation(serviceMock(
      {
        spells: { "2": [spell("Sacred Flame", 0)] },
        "always-known-spells": { "2": [spell("Bless", 1)], "3": [spell("Moonbeam", 2)] },
      },
      // 403, not 500: it is non-retryable in session-fetch, so it
      // hits the same non-OK → ddb-partial path at once (5xx backoff > 5 s).
      { status: { "always-known-spells:3": 403 } },
    ));

    const search = await reference.searchSpells({ limit: 50 });
    expect(search).toContain("**Sacred Flame**");
    expect(search).toContain("**Bless**");
    expect(search).not.toContain("**Moonbeam**");
    expect(reference.getCompendiumSource()).toBe("ddb-partial");
    expect(search).toContain("Compendium build was incomplete");
  });

  it("merges in a fixed order regardless of which response arrives first", async () => {
    // Same name from three requests. Task order is /spells class 1..8, then
    // /always-known-spells class 1..8, so /spells class 2 must win even though
    // it is the slowest response and /always-known-spells class 1 the fastest.
    fetchMock.mockImplementation(serviceMock(
      {
        spells: { "2": [spell("Cure Wounds", 1, "FROM_SPELLS_CLASS_2")], "5": [spell("Cure Wounds", 1, "FROM_SPELLS_CLASS_5")] },
        "always-known-spells": { "1": [spell("Cure Wounds", 1, "FROM_ALWAYS_KNOWN_CLASS_1")] },
      },
      { delay: { "spells:2": 30, "spells:5": 10 } },
    ));

    const got = await reference.getSpell("Cure Wounds");
    expect(got).toContain("FROM_SPELLS_CLASS_2");
  });

  it("abandons the build at once when the account changes during an always-known-spells request", async () => {
    // /always-known-spells class 3 is held until the account is swapped, so its
    // response lands in the new generation and refFetch throws
    // SessionChangedError. /spells class 1 never answers (and ignores the abort
    // signal): the build only settles if that error is rethrown rather than
    // counted as a failed request, since swallowing it would leave Promise.all
    // waiting on class 1 before the post-batch boundary check could run.
    let dispatched!: () => void;
    const alwaysKnownDispatched = new Promise<void>((r) => { dispatched = r; });
    let releaseAlwaysKnown!: () => void;
    const alwaysKnownGate = new Promise<void>((r) => { releaseAlwaysKnown = r; });
    let releaseHung!: () => void;
    const hung = new Promise<void>((r) => { releaseHung = r; });

    const service = serviceMock({ spells: { "2": [spell("Sacred Flame", 0)] } });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/always-known-spells?classId=3&")) {
        dispatched();
        await alwaysKnownGate;
      } else if (url.includes("/spells?classId=1&")) {
        await hung;
      }
      return service(url);
    });

    const p = reference.searchSpells({ limit: 50 }).catch((e) => `THREW:${(e as Error)?.name}`);
    await alwaysKnownDispatched;
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      cookies: [{
        name: "CobaltSession", value: "SECRET_B", domain: ".dndbeyond.com", path: "/",
        expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
      }],
    }));
    releaseAlwaysKnown();

    const result = await Promise.race([
      p,
      new Promise((r) => setTimeout(() => r("STILL_PENDING"), 200)),
    ]);
    releaseHung();
    expect(result).not.toBe("STILL_PENDING");
    // Account A's lists were neither cached nor served; Open5e carried the call.
    expect(result).not.toContain("Sacred Flame");
    expect(reference.getCompendiumSource()).toBeNull();
  });
});
