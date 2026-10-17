import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CLASSES, RACES, SUBCLASSES_BY_CLASS_ID, OPTIONAL_FEATURES_BY_CLASS_ID, OPTIONAL_TRAITS_BY_RACE_KEY,
} from "./fixtures/features-traits-fixtures.js";
import { buildClassFeatures, buildRacialTraits } from "../src/tools/features-traits.js";

/**
 * class-features-racial-traits.test.ts
 *
 * /game-data/classes and /game-data/races are loaded through one shared list
 * loader. Real session-state / session-fetch; only `fs` and global `fetch`
 * are mocked (same approach as spell-compendium-endpoints.test.ts).
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

/** Route game-data URLs by pathname; `overrides` replaces a path's `data`. */
function serviceMock(overrides: Record<string, unknown> = {}) {
  return async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(GAME_DATA)) {
      const u = new URL(url);
      const path = u.pathname.split("/").pop() ?? "";
      if (path === "subclasses") {
        return jsonResponse({ data: SUBCLASSES_BY_CLASS_ID[u.searchParams.get("baseClassId") ?? ""] ?? [] });
      }
      if (u.pathname.endsWith("/class-feature/collection")) {
        return jsonResponse({ data: OPTIONAL_FEATURES_BY_CLASS_ID[u.searchParams.get("classId") ?? ""] ?? { definitionData: [] } });
      }
      if (u.pathname.endsWith("/racial-trait/collection")) {
        const key = `${u.searchParams.get("entityRaceTypeId")}:${u.searchParams.get("entityRaceId")}`;
        return jsonResponse({ data: OPTIONAL_TRAITS_BY_RACE_KEY[key] ?? { definitionData: [] } });
      }
      if (path in overrides) return jsonResponse({ data: overrides[path] });
      if (path === "classes") return jsonResponse({ data: CLASSES });
      if (path === "races") return jsonResponse({ data: RACES });
      return jsonResponse({ data: [] });
    }
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  };
}

function requestsTo(path: string): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => new URL(u).pathname === `/character/v5/game-data/${path}`);
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

const EXPECTED = {
  classesAll: "**Class Search** (2 found)\n\n- **Fighter** — Hit Die: d10\n  Fighter description\n- **Fighter** — Hit Die: d10\n  Fighter description — long placeholder text, padded past the 120-character cut-off so the truncation path is exercised i...",
  // Equals classesAll: both fixture classes are named "Fighter", so "fight" matches both.
  classesFight: "**Class Search** (2 found)\n\n- **Fighter** — Hit Die: d10\n  Fighter description\n- **Fighter** — Hit Die: d10\n  Fighter description — long placeholder text, padded past the 120-character cut-off so the truncation path is exercised i...",
  racesAll: "**Race Search** (7 found)\n\n- **Elf** — Elf description\n- **Goliath** — Goliath description — long placeholder text, padded past the 120-character cut-off so the truncation...\n- **High Elf** *(Subrace, Legacy)* — High Elf description\n- **Human** *(Legacy)* — Human description\n- **Tiefling** — Tiefling description\n- **Tiefling** *(Subrace, Homebrew)* — Tiefling description\n- **Wood Elf** *(Subrace, Legacy)* — Wood Elf description",
  racesElf: "**Race Search** (3 found)\n\n- **Elf** — Elf description\n- **High Elf** *(Subrace, Legacy)* — High Elf description\n- **Wood Elf** *(Subrace, Legacy)* — Wood Elf description",
};

describe("searchClasses / searchRaces output (characterization)", () => {
  beforeEach(() => { fetchMock.mockImplementation(serviceMock()); });
  it("classes, unfiltered", async () => { expect(await reference.searchClasses()).toBe(EXPECTED.classesAll); });
  it("classes, name filter", async () => { expect(await reference.searchClasses("fight")).toBe(EXPECTED.classesFight); });
  it("races, unfiltered", async () => { expect(await reference.searchRaces()).toBe(EXPECTED.racesAll); });
  it("races, name filter", async () => { expect(await reference.searchRaces("elf")).toBe(EXPECTED.racesElf); });
});

describe("shared game-data list loader", () => {
  it("requests /game-data/classes once across two searches", async () => {
    fetchMock.mockImplementation(serviceMock());
    await reference.searchClasses();
    await reference.searchClasses();
    expect(requestsTo("classes")).toHaveLength(1);
  });

  it("does not cache an empty list", async () => {
    fetchMock.mockImplementation(serviceMock({ classes: [] }));
    await reference.searchClasses();
    await reference.searchClasses();
    expect(requestsTo("classes")).toHaveLength(2);
  });

  it("does not cache a non-array data payload", async () => {
    fetchMock.mockImplementation(serviceMock({ classes: {} }));
    await reference.searchClasses();
    await reference.searchClasses();
    expect(requestsTo("classes")).toHaveLength(2);
  });

  it("refetches after an empty list, then serves from cache", async () => {
    const real = serviceMock();
    let first = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (first && new URL(url).pathname.endsWith("/game-data/classes")) {
        first = false;
        return jsonResponse({ data: [] });
      }
      return real(url);
    });
    await reference.searchClasses();
    await reference.searchClasses();
    const third = await reference.searchClasses();
    expect(requestsTo("classes")).toHaveLength(2);
    expect(third).toBe(EXPECTED.classesAll);
  });
});

// ── Class-feature and racial-trait loaders ───────────────────────────────────

const CF_UNAVAILABLE = "Class feature data is unavailable from D&D Beyond right now: it returned no class features. Try again later, or run ddb_login if your session has expired.";
const RT_UNAVAILABLE = "Racial trait data is unavailable from D&D Beyond right now: it returned no racial traits. Try again later, or run ddb_login if your session has expired.";
const CF_PARTIAL = "> ⚠ Some subclass or optional-feature lists failed to load from D&D Beyond, so results may be incomplete. Run `ddb_clear_cache` to retry.";
const RT_PARTIAL = "> ⚠ Some optional-trait lists failed to load from D&D Beyond, so results may be incomplete. Run `ddb_clear_cache` to retry.";

const FULL_CLASS_ENTRIES = buildClassFeatures(
  CLASSES,
  new Map(Object.entries(SUBCLASSES_BY_CLASS_ID).map(([k, v]) => [Number(k), v])),
  new Map(Object.entries(OPTIONAL_FEATURES_BY_CLASS_ID).map(([k, v]) => [Number(k), v as never])),
);

/** Wrap the routed service so matching URLs return a canned response instead. */
function withOverride(match: (url: string) => boolean, respond: () => Response | Promise<Response>) {
  const real = serviceMock();
  fetchMock.mockImplementation(async (url: string) => (match(url) ? respond() : real(url)));
}

function gameDataRequests(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(GAME_DATA));
}

describe("searchClassFeatures", () => {
  beforeEach(() => { fetchMock.mockImplementation(serviceMock()); });

  it("fans out to subclasses and class-feature collections for every class", async () => {
    const out = await reference.searchClassFeatures({ name: "action surge" });
    expect(requestsTo("classes")).toHaveLength(1);
    expect(requestsTo("subclasses").sort()).toEqual([
      `${GAME_DATA}/subclasses?baseClassId=10`,
      `${GAME_DATA}/subclasses?baseClassId=2190879`,
    ].sort());
    expect(requestsTo("class-feature/collection").sort()).toEqual([
      `${GAME_DATA}/class-feature/collection?classId=10`,
      `${GAME_DATA}/class-feature/collection?classId=2190879`,
    ].sort());
    expect(out.split("**Action Surge** — Fighter level 2")).toHaveLength(3);
  });

  it("never requests a collection endpoint without its query string", async () => {
    await reference.searchClassFeatures({});
    await reference.searchRacialTraits({});
    for (const u of gameDataRequests()) {
      expect(u).not.toMatch(/\/(class-feature|racial-trait)\/collection$/);
    }
    expect(requestsTo("racial-trait/collection").length).toBeGreaterThan(0);
  });

  it("serves a second call from cache with one cobalt exchange", async () => {
    await reference.searchClassFeatures({ name: "action surge" });
    const before = gameDataRequests().length;
    await reference.searchClassFeatures({ name: "second wind" });
    expect(gameDataRequests()).toHaveLength(before);
    expect(fetchMock.mock.calls.filter((c) => c[0] === COBALT_URL)).toHaveLength(1);
  });

  it("rejects with the unavailable message on an empty class list, and does not cache it", async () => {
    fetchMock.mockImplementation(serviceMock({ classes: [] }));
    await expect(reference.searchClassFeatures({})).rejects.toThrow(CF_UNAVAILABLE);
    await expect(reference.searchClassFeatures({})).rejects.toThrow(CF_UNAVAILABLE);
    expect(requestsTo("classes")).toHaveLength(2);
  });

  it("rejects with the HTTP variant when /classes is not OK", async () => {
    withOverride((u) => new URL(u).pathname.endsWith("/game-data/classes"), () => jsonResponse({}, 403));
    await expect(reference.searchClassFeatures({})).rejects.toThrow(
      "Class feature data is unavailable from D&D Beyond right now (HTTP 403). Try again later, or run ddb_login if your session has expired.",
    );
  });

  it("reports no matches with the searched count", async () => {
    const out = await reference.searchClassFeatures({ name: "zzz" });
    expect(FULL_CLASS_ENTRIES.length).toBeGreaterThan(0);
    expect(out).toBe(`No class features found matching name "zzz" (searched ${FULL_CLASS_ENTRIES.length} class features).`);
  });

  it("joins every criterion in the no-match message", async () => {
    const out = await reference.searchClassFeatures({ name: "zzz", className: "fighter", level: 3 });
    expect(out).toBe(`No class features found matching name "zzz", class "fighter", level 3 (searched ${FULL_CLASS_ENTRIES.length} class features).`);
  });

  it("a 403 on one subclasses request is partial: note, base features, short TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      withOverride((u) => u.includes("/subclasses?baseClassId=10"), () => jsonResponse({}, 403));
      const out = await reference.searchClassFeatures({ name: "action surge" });
      expect(out.startsWith(`${CF_PARTIAL}\n\n`)).toBe(true);
      expect(out).toContain("**Action Surge** — Fighter level 2");

      const before = requestsTo("subclasses").length;
      await reference.searchClassFeatures({ name: "action surge" });
      expect(requestsTo("subclasses")).toHaveLength(before); // cached

      vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
      await reference.searchClassFeatures({ name: "action surge" });
      expect(requestsTo("subclasses").length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a cached partial build still shows the partial note, without re-requesting", async () => {
    withOverride((u) => u.includes("/subclasses?baseClassId=10"), () => jsonResponse({}, 403));
    await reference.searchClassFeatures({});
    const before = gameDataRequests().length;
    const second = await reference.searchClassFeatures({ name: "action surge" });
    expect(gameDataRequests()).toHaveLength(before);
    expect(second.startsWith(CF_PARTIAL)).toBe(true);
  });

  it("prepends the partial note to a no-matches reply", async () => {
    withOverride((u) => u.includes("/subclasses?baseClassId=10"), () => jsonResponse({}, 403));
    const out = await reference.searchClassFeatures({ name: "zzz" });
    expect(out.startsWith(`${CF_PARTIAL}\n\n`)).toBe(true);
    expect(out).toContain('No class features found matching name "zzz" (searched ');
  });

  it("a 404 on a class-feature collection counts as partial, not a throw", async () => {
    withOverride((u) => u.includes("/class-feature/collection?classId=10"), () => jsonResponse({}, 404));
    const out = await reference.searchClassFeatures({ name: "action surge" });
    expect(out.startsWith(CF_PARTIAL)).toBe(true);
    expect(out).toContain("**Action Surge** — Fighter level 2");
  });

  it("a collection with data: null is partial", async () => {
    withOverride((u) => u.includes("/class-feature/collection?classId=10"), () => jsonResponse({ data: null }));
    const out = await reference.searchClassFeatures({ name: "action surge" });
    expect(out.startsWith(CF_PARTIAL)).toBe(true);
  });

  it("a collection with data: {} (no definitionData) is partial", async () => {
    withOverride((u) => u.includes("/class-feature/collection?classId=10"), () => jsonResponse({ data: {} }));
    const out = await reference.searchClassFeatures({ name: "action surge" });
    expect(out.startsWith(CF_PARTIAL)).toBe(true);
  });

  it("a subclasses response with data: {} is partial", async () => {
    withOverride((u) => u.includes("/subclasses?baseClassId=10"), () => jsonResponse({ data: {} }));
    const out = await reference.searchClassFeatures({ name: "action surge" });
    expect(out.startsWith(CF_PARTIAL)).toBe(true);
  });

  it("abandons the build when the account changes mid-fan-out, and caches nothing", async () => {
    let dispatched!: () => void;
    const held = new Promise<void>((r) => { dispatched = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let releaseHung!: () => void;
    const hung = new Promise<void>((r) => { releaseHung = r; });
    const service = serviceMock();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/class-feature/collection?classId=10")) {
        dispatched();
        await gate;
      } else if (url.includes("/subclasses?baseClassId=2190879")) {
        await hung;
      }
      return service(url);
    });

    const p = reference.searchClassFeatures({}).then(() => "RESOLVED", (e) => `THREW:${(e as Error).name}`);
    await held;
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      cookies: [{
        name: "CobaltSession", value: "SECRET_B", domain: ".dndbeyond.com", path: "/",
        expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
      }],
    }));
    release();
    const result = await Promise.race([p, new Promise((r) => setTimeout(() => r("STILL_PENDING"), 200))]);
    releaseHung();
    expect(result).toBe("THREW:SessionChangedError");

    fetchMock.mockImplementation(serviceMock());
    const classesBefore = requestsTo("classes").length;
    await reference.searchClassFeatures({});
    expect(requestsTo("classes").length).toBe(classesBefore + 1); // nothing was cached
  });

  it("with no session, rejects with a login hint rather than unavailable or none-found", async () => {
    fsMock.existsSync.mockReturnValue(false);
    const err = await reference.searchClassFeatures({}).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(err!.message).toContain("ddb_login");
    expect(err!.message).not.toContain("unavailable");
    expect(err!.message).not.toContain("No class features found");
  });

  it("re-requests /classes after the account changes between calls", async () => {
    await reference.searchClassFeatures({});
    fsMock.readFileSync.mockReturnValue(JSON.stringify({
      cookies: [{
        name: "CobaltSession", value: "SECRET_B", domain: ".dndbeyond.com", path: "/",
        expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
      }],
    }));
    await reference.searchClassFeatures({});
    expect(requestsTo("classes")).toHaveLength(2);
  });

  it("shares the /classes fetch with searchClasses and leaves its output unchanged", async () => {
    await reference.searchClassFeatures({});
    const out = await reference.searchClasses();
    expect(requestsTo("classes")).toHaveLength(1);
    expect(out).toBe(EXPECTED.classesAll);
  });
});

describe("searchRacialTraits", () => {
  beforeEach(() => { fetchMock.mockImplementation(serviceMock()); });

  it("requests the optional-trait collection with both race parameters", async () => {
    const out = await reference.searchRacialTraits({ name: "darkvision" });
    expect(requestsTo("racial-trait/collection")).toContain(
      `${GAME_DATA}/racial-trait/collection?entityRaceId=1&entityRaceTypeId=1743923279`,
    );
    expect(out).toContain("Darkvision");
    expect(out).not.toContain("No racial traits found");
  });

  it("rejects with the unavailable message when races come back empty", async () => {
    fetchMock.mockImplementation(serviceMock({ races: [] }));
    await expect(reference.searchRacialTraits({})).rejects.toThrow(RT_UNAVAILABLE);
  });

  it("rejects with the HTTP variant when /races is not OK", async () => {
    withOverride((u) => new URL(u).pathname.endsWith("/game-data/races"), () => jsonResponse({}, 403));
    await expect(reference.searchRacialTraits({})).rejects.toThrow(
      "Racial trait data is unavailable from D&D Beyond right now (HTTP 403). Try again later, or run ddb_login if your session has expired.",
    );
  });

  it("reports no matches with the searched count and criteria", async () => {
    const entries = buildRacialTraits(RACES, new Map(Object.entries(OPTIONAL_TRAITS_BY_RACE_KEY).map(([k, v]) => [k, v as never])));
    const out = await reference.searchRacialTraits({ name: "zzz", raceName: "elf" });
    expect(entries.length).toBeGreaterThan(0);
    expect(out).toBe(`No racial traits found matching name "zzz", race "elf" (searched ${entries.length} racial traits).`);
  });

  it("a failed optional-trait list is partial and caches briefly", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      withOverride((u) => u.includes("/racial-trait/collection?entityRaceId=1&entityRaceTypeId=1743923279"), () => jsonResponse({}, 403));
      const out = await reference.searchRacialTraits({ name: "darkvision" });
      expect(out.startsWith(`${RT_PARTIAL}\n\n`)).toBe(true);

      const before = requestsTo("racial-trait/collection").length;
      const again = await reference.searchRacialTraits({ name: "darkvision" });
      expect(requestsTo("racial-trait/collection")).toHaveLength(before); // cached
      expect(again.startsWith(RT_PARTIAL)).toBe(true);

      vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
      await reference.searchRacialTraits({ name: "darkvision" });
      expect(requestsTo("racial-trait/collection").length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no session, rejects with a login hint rather than unavailable or none-found", async () => {
    fsMock.existsSync.mockReturnValue(false);
    const err = await reference.searchRacialTraits({}).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(err!.message).toContain("ddb_login");
    expect(err!.message).not.toContain("unavailable");
    expect(err!.message).not.toContain("No racial traits found");
  });

  it("an optional-trait response with data: {} is partial", async () => {
    withOverride((u) => u.includes("/racial-trait/collection?entityRaceId=1&entityRaceTypeId=1743923279"), () => jsonResponse({ data: {} }));
    const out = await reference.searchRacialTraits({ name: "darkvision" });
    expect(out.startsWith(RT_PARTIAL)).toBe(true);
  });
});
