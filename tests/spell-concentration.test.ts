import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Concentration precedence (`isConcentrationSpell`): the definition's own
 * boolean, then the same id in the compendium, then the compendium twin for the
 * definition's own edition. The compendium is seeded the only way it is built:
 * from the class spell lists (mocked fetch; real session-state / session-fetch).
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

type ReferenceModule = typeof import("../src/tools/reference.js");
type CharacterModule = typeof import("../src/tools/character.js");
let reference: ReferenceModule;
let character: CharacterModule;

/** Build the compendium from one class list holding `spells`. */
async function seedCompendium(spells: unknown[]): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(serviceMock({ spells: { "8": spells } })));
  await reference.searchSpells({});
}

const NINE = ["Divine Favor", "Spiritual Weapon", "Sleep", "True Strike", "Barkskin",
  "Enthrall", "Forcecage", "Animal Shapes", "Magic Weapon"];

function charWithRaceSpell(definition: Record<string, unknown>): Record<string, unknown> {
  return {
    data: {
      ...(FIGHTER_5.data as Record<string, unknown>),
      classes: [{
        id: 10, level: 5, hitDiceUsed: 0,
        definition: {
          name: "Druid", hitDice: 8, canCastSpells: true, spellCastingAbilityId: 5,
          spellRules: { levelSpellSlots: Array.from({ length: 21 }, (_, l) => l >= 1 ? [3, 2, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]) },
        },
        subclassDefinition: null, classFeatures: [],
      }],
      classSpells: [],
      spells: { race: [{ definition }], class: [], background: [], feat: [], item: [] },
      spellSlots: [],
    },
  };
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
  vi.resetModules();
  reference = await import("../src/tools/reference.js");
  character = await import("../src/tools/character.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("concentration follows the character's own definition", () => {
  it.each(NINE.flatMap(n => [[n, true], [n, false]] as const))(
    "%s: the character's own definition (concentration %s) wins over the other edition", async (name, conc) => {
      // The compendium holds the other edition.
      await seedCompendium([spell(name, 1, { id: 1000, concentration: !conc, isLegacy: true, sources: [2] })]);
      // The parsed character holds the 2024 version as a racial grant.
      const out = character.parseCharacterData(charWithRaceSpell({ id: 2000, name, level: 1, concentration: conc,
        sources: [{ sourceId: 145 }] }), "concentration");
      expect(out.includes(name)).toBe(conc);
    });
});

describe("isConcentrationSpell", () => {
  it("returns the definition's own boolean first", async () => {
    await seedCompendium([spell("Hex", 1, { id: 7, concentration: true })]);
    expect(reference.isConcentrationSpell({ id: 7, name: "Hex", concentration: false })).toBe(false);
  });

  it("without a boolean, the same definition id decides", async () => {
    await seedCompendium([spell("Hex", 1, { id: 7, concentration: true })]);
    expect(reference.isConcentrationSpell({ id: 7, name: "Hex" })).toBe(true);
  });

  it("without a boolean or a known id, the twin group's entry for the definition's own edition decides", async () => {
    await seedCompendium([
      spell("Barkskin", 2, { id: 1, concentration: true, isLegacy: true, sources: [2] }),
      spell("Barkskin", 2, { id: 2, concentration: false, sources: [145] }),
    ]);
    expect(reference.isConcentrationSpell({ name: "Barkskin", isLegacy: true })).toBe(true);
    expect(reference.isConcentrationSpell({ name: "Barkskin", sources: [{ sourceId: 145 }] })).toBe(false);
    expect(reference.isConcentrationSpell({ name: "Barkskin" })).toBe(false); // edition not stated → 2024
  });

  it("groups by the spell namer: another kind's pair (Thug → Tough) is no twin", async () => {
    await seedCompendium([
      spell("Tough", 1, { id: 30, concentration: true }),
      spell("Melf's Acid Arrow", 2, { id: 31, concentration: false }),
    ]);
    expect(reference.isConcentrationSpell({ name: "Thug" })).toBeNull();
    expect(reference.isConcentrationSpell({ name: "Acid Arrow" })).toBe(false);
  });

  it("returns null for an unknown spell with no boolean", () => {
    expect(reference.isConcentrationSpell({ name: "Nope" })).toBeNull();
  });

  it("a parsed character's own spells never answer for another definition", () => {
    character.parseCharacterData({ data: { ...(FIGHTER_5.data as Record<string, unknown>),
      classSpells: [{ spells: [{ definition: { id: 7, name: "Hex", concentration: true } }] }] } }, "spells");
    expect(reference.isConcentrationSpell({ id: 7, name: "Hex" })).toBeNull();
  });
});
