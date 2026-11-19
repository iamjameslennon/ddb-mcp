import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NOT_LOGGED_IN_SUFFIX } from "../src/edition.js";

/**
 * F13: logged out, a catalog tool's Open5e fallback says to log in instead of
 * claiming D&D Beyond is unavailable. The same fallback with a valid session and
 * a real outage keeps "D&D Beyond unavailable".
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

import { COBALT_URL, GAME_DATA, jsonResponse, serviceMock, spell } from "./fixtures/spell-service.js";
import { o5FixtureFetch } from "./fixtures/open5e-v2.js";

const o5 = o5FixtureFetch();
const realFs = await vi.importActual<typeof import("fs")>("fs");

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;

const LOGGED_OUT = "Open5e fallback — not logged in; ddb_login shows D&D Beyond's version";
const UNAVAILABLE = "Open5e fallback — D&D Beyond unavailable";

/** after-logout: signed in as in "outage", then ddb_logout (revokeSession) with the file gone. */
type Mode = "no-session" | "anonymous-cookies" | "outage" | "after-logout";

async function setUp(mode: Mode) {
  const session = JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  });
  fsMock.existsSync.mockReset().mockReturnValue(mode !== "no-session");
  fsMock.readFileSync.mockReset().mockImplementation((path: unknown, ...rest: unknown[]) =>
    String(path).includes("/fixtures/open5e-v2/") ? realFs.readFileSync(path as URL, ...(rest as [BufferEncoding])) : session);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === COBALT_URL) return jsonResponse(mode === "anonymous-cookies" ? { token: null } : { token: "unused" });
    if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403); // a refused request while signed in
    return o5(url);
  }));
  vi.resetModules();
  reference = await import("../src/tools/reference.js");
  if (mode === "after-logout") {
    await (await import("../src/session-state.js")).revokeSession();
    fsMock.existsSync.mockReturnValue(false);
  }
}

/** A tool's reply as the client sees it: its text, or the error it threw. */
async function reply(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (e) {
    return `threw ${(e as Error).name}: ${(e as Error).message}`;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logged out, the catalog tools' Open5e fallbacks say to log in (F13)", () => {
  beforeEach(() => setUp("no-session"));

  it("ddb_get_spell's reply says not logged in", async () => {
    const text = await reference.getSpell("Fireball");
    expect(text).toContain(LOGGED_OUT);
    expect(text).not.toContain("D&D Beyond unavailable");
  });

  it("ddb_get_equipment's reply says not logged in", async () => {
    const text = await reference.getItem("Longsword");
    expect(text).toContain(LOGGED_OUT);
    expect(text).not.toContain("D&D Beyond unavailable");
  });

  const searches: [string, () => Promise<string>][] = [
    ["search_spells", () => reference.searchSpells({ name: "fire" })],
    ["search_equipment", () => reference.searchItems({ name: "sword" })],
    ["search_feats", () => reference.searchFeats({ name: "alert" })],
    ["search_races", () => reference.searchRaces({ name: "elf" })],
    ["search_classes", () => reference.searchClasses({ name: "wizard" })],
    ["search_backgrounds", () => reference.searchBackgrounds({ name: "acolyte" })],
  ];
  it.each(searches)("%s says not logged in", async (_name, run) => {
    const text = await run();
    expect(text).toContain(LOGGED_OUT);
    expect(text).not.toContain("D&D Beyond unavailable");
  });

  it("a no-match search names the login, not an outage", async () => {
    const text = await reference.searchSpells({ name: "zzzxqv" });
    expect(text).toContain(`No spells found matching the criteria${NOT_LOGGED_IN_SUFFIX}.`);
    expect(text).not.toContain("SRD only");
  });
});

describe("saved cookies that are not signed in count as logged out", () => {
  beforeEach(() => setUp("anonymous-cookies"));

  it("a spell lookup says not logged in", async () => {
    const text = await reference.getSpell("Fireball");
    expect(text).toContain(LOGGED_OUT);
  });

  it("an equipment search says not logged in", async () => {
    expect(await reference.searchItems({ name: "sword" })).toContain(LOGGED_OUT);
  });
});

describe("an outage while logged in", () => {
  beforeEach(() => setUp("outage"));

  it("still says D&D Beyond unavailable", async () => {
    const text = await reference.getSpell("Fireball");
    expect(text).toContain(UNAVAILABLE);
    expect(text).not.toContain("not logged in");
    expect(await reference.searchSpells({ name: "fire" })).toContain(UNAVAILABLE);
    expect(await reference.getItem("Longsword")).toContain(UNAVAILABLE);
  });
});

describe("after ddb_logout, the catalog tools fall back like a fresh logged-out server (F4)", () => {
  it("ddb_get_spell says not logged in", async () => {
    await setUp("after-logout");
    const text = await reply(() => reference.getSpell("Fireball"));
    expect(text).toContain(LOGGED_OUT);
    expect(text).not.toContain("Session changed");
  });

  it("ddb_search_spells says not logged in", async () => {
    await setUp("after-logout");
    const text = await reply(() => reference.searchSpells({ level: 3, school: "evocation", limit: 5 }));
    expect(text).toContain(LOGGED_OUT);
    expect(text).not.toContain("Session changed");
  });

  it("class features and racial traits reply as with no session", async () => {
    // Neither has an Open5e path: the reply is the no-session one, not a session change.
    const features = () => reference.searchClassFeatures({ name: "rage" });
    const traits = () => reference.searchRacialTraits({ name: "darkvision" });
    await setUp("no-session");
    const expected = [await reply(features), await reply(traits)];
    await setUp("after-logout");
    const actual = [await reply(features), await reply(traits)];
    expect(actual).toEqual(expected);
    for (const text of actual) expect(text).toContain("ddb_login");
    for (const text of actual) expect(text).not.toContain("Session changed");
  });

  it("a warmed authenticated spell compendium is not served after ddb_logout (T5)", async () => {
    await setUp("outage");
    vi.stubGlobal("fetch", vi.fn(serviceMock({ spells: { "8": [spell("Fireball", 3)] } })));
    const warm = await reference.getSpell("Fireball");
    expect(warm).toContain("Fireball");
    expect(warm).not.toContain("Open5e");
    await (await import("../src/session-state.js")).revokeSession();
    fsMock.existsSync.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => o5(url)));
    const text = await reply(() => reference.getSpell("Fireball"));
    expect(text).toContain(LOGGED_OUT);
    expect(text).not.toContain("Session changed");
  });

  it("signing back in builds from D&D Beyond again", async () => {
    await setUp("after-logout");
    expect(await reply(() => reference.getSpell("Fireball"))).toContain(LOGGED_OUT);
    // What ddb_login's saveVerifiedSession does: a session file again, then
    // invalidateSessionCache() (lifts the revoke, new generation).
    fsMock.existsSync.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn(serviceMock({ spells: { "8": [spell("Fireball", 3)] } })));
    (await import("../src/session-fetch.js")).invalidateSessionCache();
    const text = await reference.getSpell("Fireball");
    expect(text).toContain("Fireball");
    expect(text).not.toContain("Open5e");
  });
});
