import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * spell-determinism.test.ts
 *
 * Stateless-safe invariant (owner decision 2026-11-27): a spell search answers
 * the same whether or not a character was parsed earlier in the process. The
 * compendium is built only from the class spell lists; a parsed character's
 * classSpells never reach it. Real session-state / session-fetch; only `fs`
 * and global `fetch` are mocked (as in spell-compendium-endpoints).
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

import { serviceMock, spell } from "./fixtures/spell-service.js";
import { FIGHTER_5 } from "./fixtures/character-fixtures.js";

const LISTS = { spells: { "8": [spell("Fire Bolt", 0), spell("Magic Missile", 1)] } };

/** A character whose classSpells hold a spell that no class list returns. */
const CHARACTER_WITH_HEX = {
  data: {
    ...(FIGHTER_5.data as Record<string, unknown>),
    classSpells: [{ characterClassId: 1, spells: [
      { prepared: true, definition: { id: 2317, name: "Hex", level: 1, school: "Enchantment",
        description: "Hex description", concentration: true, ritual: false } },
    ] }],
  },
};

type ReferenceModule = typeof import("../src/tools/reference.js");
type CharacterModule = typeof import("../src/tools/character.js");

async function freshModules(): Promise<{ reference: ReferenceModule; character: CharacterModule }> {
  vi.resetModules();
  const reference = await import("../src/tools/reference.js");
  const character = await import("../src/tools/character.js");
  return { reference, character };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReset().mockReturnValue(true);
  fsMock.readFileSync.mockReset().mockReturnValue(JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  }));
  vi.stubGlobal("fetch", vi.fn(serviceMock(LISTS)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spell search does not depend on an earlier character parse", () => {
  it("a parse before the first search adds nothing to it", async () => {
    const alone = await (await freshModules()).reference.searchSpells({});

    const { reference, character } = await freshModules();
    character.parseCharacterData(CHARACTER_WITH_HEX, "spells");
    const afterParse = await reference.searchSpells({});

    expect(afterParse).toBe(alone);
    expect(afterParse).not.toContain("Hex");
  });

  it("a parse after the compendium is built adds nothing to it", async () => {
    const { reference, character } = await freshModules();
    const before = await reference.searchSpells({});
    character.parseCharacterData(CHARACTER_WITH_HEX, "spells");
    const after = await reference.searchSpells({});

    expect(after).toBe(before);
    expect(await reference.getSpell("Hex")).not.toMatch(/^\*\*Hex\*\*|Hex description/);
  });
});
