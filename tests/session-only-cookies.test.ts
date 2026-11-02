import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * A session file holding only session cookies (or expired persistent ones):
 * hasValidSession() is false, so monster lookups run anonymously. The game
 * config must be fetched the same way, with no Cookie header (minors C #10).
 * Real session-state and session-fetch over a mocked fs and global fetch.
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
  readdirSync: vi.fn(() => []),
  realpathSync: vi.fn((p: string) => p),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

const CONFIG_URL = "https://www.dndbeyond.com/api/config/json";
const CONFIG = { data: { challengeRatings: [{ id: 1, value: 1, xp: 200, proficiencyBonus: 2 }], monsterTypes: [], alignments: [], senses: [] } };

let fetchMock: ReturnType<typeof vi.fn>;

function sessionFile(cookies: Array<{ expires: number }>): string {
  return JSON.stringify({
    cookies: cookies.map((c, i) => ({
      name: `C${i}`, value: `SECRET_${i}`, domain: ".dndbeyond.com", path: "/", httpOnly: true, secure: true, ...c,
    })),
  });
}

function headersOf(call: unknown[]): Record<string, string> {
  return ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReset().mockReturnValue(true);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(CONFIG), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the game config follows the monster asker's rule", () => {
  it.each([
    ["session cookies only", [{ expires: -1 }]],
    ["expired persistent cookies", [{ expires: Date.now() / 1000 - 60 }, { expires: -1 }]],
  ])("%s: the config is fetched with no Cookie header", async (_label, cookies) => {
    fsMock.readFileSync.mockReset().mockReturnValue(sessionFile(cookies));
    const { getGameConfig, getSourceIndex } = await import("../src/game-config.js");
    const { hasValidSession } = await import("../src/session-fetch.js");
    expect(hasValidSession()).toBe(false);
    expect(await getGameConfig()).toMatchObject({ challengeRatings: CONFIG.data.challengeRatings });
    await getSourceIndex();
    const configCalls = fetchMock.mock.calls.filter(c => String(c[0]) === CONFIG_URL);
    expect(configCalls.length).toBeGreaterThan(0);
    for (const call of configCalls) {
      const headers = headersOf(call);
      expect(Object.keys(headers).map(k => k.toLowerCase())).not.toContain("cookie");
      expect(JSON.stringify(headers)).not.toContain("SECRET_");
    }
  });

  it("a valid session still sends its cookies to the config endpoint, as before", async () => {
    fsMock.readFileSync.mockReset().mockReturnValue(sessionFile([{ expires: Date.now() / 1000 + 3600 }]));
    const { getGameConfig } = await import("../src/game-config.js");
    await getGameConfig();
    const call = fetchMock.mock.calls.find(c => String(c[0]) === CONFIG_URL)!;
    expect(headersOf(call).Cookie).toContain("SECRET_0");
  });

  it("no session file: no config request at all, as before", async () => {
    fsMock.existsSync.mockReset().mockReturnValue(false);
    const { getGameConfig } = await import("../src/game-config.js");
    expect(await getGameConfig()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
