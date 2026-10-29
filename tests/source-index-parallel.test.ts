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

describe("catalog searches", () => {
  it("a catalog search starts the source index and the load together", async () => {
    // The index never resolves; the load's data request never resolves either.
    index.getSourceIndex.mockReturnValue(new Promise(() => {}));
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === COBALT_URL) return jsonResponse({ token: makeJwt("1"), ttl: 300 });
      return new Promise(() => {});
    });
    const reference = await import("../src/tools/reference.js");
    void reference.searchRaces({ name: "elf" });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]) !== COBALT_URL)).toBe(true);
    });
    // Both are pending: the load has sent its data request and the index was started.
    expect(index.getSourceIndex).toHaveBeenCalledTimes(1);
  });
});
