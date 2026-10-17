import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { CLASSES, RACES } from "./fixtures/features-traits-fixtures.js";

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
      const path = new URL(url).pathname.split("/").pop() ?? "";
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
