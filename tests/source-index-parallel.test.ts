import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * A catalog search starts the source index fetch alongside the data load, not
 * after it. Same fs / fetch mocking as options-editions.test.ts.
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

const index = vi.hoisted(() => ({ getSourceIndex: vi.fn() }));
vi.mock("../src/game-config.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/game-config.js")>()),
  getSourceIndex: index.getSourceIndex,
}));

import { COBALT_URL, jsonResponse, makeJwt } from "./fixtures/spell-service.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
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
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the index starts before the load resolves", () => {
  const sites: Array<[string, () => Promise<unknown>]> = [
    ["searchRaces", async () => (await import("../src/tools/reference.js")).searchRaces({ name: "elf" })],
    ["searchSpellsSection", async () => (await import("../src/tools/reference.js")).searchSpellsSection({ name: "fire" })],
    ["getSpell", async () => (await import("../src/tools/reference.js")).getSpell("Fireball")],
    ["getItem", async () => (await import("../src/tools/reference.js")).getItem("Longsword")],
    ["searchOwnedEntries (class features)", async () => (await import("../src/tools/reference.js")).searchClassFeatures({ name: "rage" })],
    ["parseCharacter", async () => (await import("../src/tools/character.js")).parseCharacter("12345678")],
    ["getDefinition", async () => (await import("../src/tools/character.js")).getDefinition("12345678", "sword")],
    ["getParty", async () => (await import("../src/tools/party.js")).getParty("999")],
  ];

  it.each(sites)("%s", async (_name, call) => {
    // Neither the index nor the data request ever resolves.
    index.getSourceIndex.mockReturnValue(new Promise(() => {}));
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === COBALT_URL) return jsonResponse({ token: makeJwt("1"), ttl: 300 });
      return new Promise(() => {});
    });
    void call().catch(() => undefined);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]) !== COBALT_URL)).toBe(true);
    });
    expect(index.getSourceIndex).toHaveBeenCalledTimes(1);
  });
});

describe("a failed load withdraws the index it started (minors C #4)", () => {
  const failing: Array<[string, () => Promise<unknown>]> = [
    ["searchRaces", async () => (await import("../src/tools/reference.js")).searchRaces({ name: "elf" })],
    ["searchSpellsSection", async () => (await import("../src/tools/reference.js")).searchSpellsSection({ name: "fire" })],
    ["getSpell", async () => (await import("../src/tools/reference.js")).getSpell("Fireball")],
    ["getItem", async () => (await import("../src/tools/reference.js")).getItem("Longsword")],
    ["searchOwnedEntries (class features)", async () => (await import("../src/tools/reference.js")).searchClassFeatures({ name: "rage" })],
    ["parseCharacter", async () => (await import("../src/tools/character.js")).parseCharacter("12345678")],
    ["getDefinition", async () => (await import("../src/tools/character.js")).getDefinition("12345678", "sword")],
    ["getParty", async () => (await import("../src/tools/party.js")).getParty("999")],
  ];

  it.each(failing)("%s", async (_name, call) => {
    index.getSourceIndex.mockReturnValue(new Promise(() => {}));
    // The token exchange is refused and every other request is a 404 (no retries): the load fails.
    fetchMock.mockImplementation(async (url: unknown) =>
      new Response("{}", { status: String(url) === COBALT_URL ? 401 : 404 }));
    await call().catch(() => undefined);
    expect(index.getSourceIndex).toHaveBeenCalledTimes(1);
    const signal = (index.getSourceIndex.mock.calls[0][0] as { signal?: AbortSignal } | undefined)?.signal;
    expect(signal?.aborted).toBe(true);
  });
});

describe("a character call caps its logged-out index wait", () => {
  const sites: Array<[string, () => Promise<unknown>, boolean]> = [
    ["parseCharacter", async () => (await import("../src/tools/character.js")).parseCharacter("12345678"), true],
    ["getDefinition", async () => (await import("../src/tools/character.js")).getDefinition("12345678", "sword"), true],
    // getParty needs a login, so it keeps the plain wait.
    ["getParty", async () => (await import("../src/tools/party.js")).getParty("999"), false],
    ["searchRaces", async () => (await import("../src/tools/reference.js")).searchRaces({ name: "elf" }), false],
  ];

  it.each(sites)("%s", async (_name, call, capped) => {
    index.getSourceIndex.mockReturnValue(new Promise(() => {}));
    fetchMock.mockImplementation(async (url: unknown) =>
      new Response("{}", { status: String(url) === COBALT_URL ? 401 : 404 }));
    await call().catch(() => undefined);
    expect(index.getSourceIndex).toHaveBeenCalledTimes(1);
    const opts = index.getSourceIndex.mock.calls[0][0] as { loggedOutWaitMs?: number } | undefined;
    const { LOGGED_OUT_CHARACTER_INDEX_WAIT_MS } = await import("../src/game-config.js");
    expect(opts?.loggedOutWaitMs).toBe(capped ? LOGGED_OUT_CHARACTER_INDEX_WAIT_MS : undefined);
  });
});
