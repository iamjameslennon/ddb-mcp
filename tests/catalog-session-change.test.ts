import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Task 12b: an account change during a catalog load surfaces as
 * SessionChangedError instead of falling back to Open5e (fetchCharacter's rule:
 * "an account change must surface, never be papered over"). A plain outage
 * still falls back.
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

import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt } from "./fixtures/spell-service.js";
import { o5FixtureFetch } from "./fixtures/open5e-v2.js";

const o5 = o5FixtureFetch();
const realFs = await vi.importActual<typeof import("fs")>("fs");

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;
let sf: typeof import("../src/session-fetch.js");

const session = (value: string) => JSON.stringify({
  cookies: [{
    name: "CobaltSession", value, domain: ".dndbeyond.com", path: "/",
    expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
  }],
});

/** swap: the first game-data request replaces the signed-in account. */
async function setUp(swap: boolean) {
  let current = session("SECRET_A");
  fsMock.existsSync.mockReset().mockReturnValue(true);
  fsMock.readFileSync.mockReset().mockImplementation((path: unknown, ...rest: unknown[]) =>
    String(path).includes("/fixtures/open5e-v2/") ? realFs.readFileSync(path as URL, ...(rest as [BufferEncoding])) : current);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(GAME_DATA)) {
      if (swap) current = session("SECRET_B");
      return jsonResponse({}, 403);
    }
    return o5(url);
  }));
  vi.resetModules();
  sf = await import("../src/session-fetch.js");
  reference = await import("../src/tools/reference.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a session change during a catalog load surfaces", () => {
  beforeEach(() => setUp(true));

  it("getSpell rejects with SessionChangedError, no Open5e fallback", async () => {
    await expect(reference.getSpell("Fireball")).rejects.toBeInstanceOf(sf.SessionChangedError);
  });
  it("searchSpells rejects with SessionChangedError", async () => {
    await expect(reference.searchSpells({ name: "fire" })).rejects.toBeInstanceOf(sf.SessionChangedError);
  });
  it("getItem rejects with SessionChangedError", async () => {
    await expect(reference.getItem("Longsword")).rejects.toBeInstanceOf(sf.SessionChangedError);
  });
  it("a list search (feats) rejects with SessionChangedError", async () => {
    await expect(reference.searchFeats({ name: "alert" })).rejects.toBeInstanceOf(sf.SessionChangedError);
  });
});

describe("a plain outage still falls back to Open5e", () => {
  beforeEach(() => setUp(false));

  it("getSpell and searchFeats answer from Open5e", async () => {
    expect(await reference.getSpell("Fireball")).toContain("Open5e fallback");
    expect(await reference.searchFeats({ name: "alert" })).toContain("Open5e fallback");
  });
});
