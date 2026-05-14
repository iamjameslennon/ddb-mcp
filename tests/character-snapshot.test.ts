/**
 * Holistic snapshot tests for parseCharacterData.
 *
 * Layer 2 of the refactor regression strategy (see docs/character-refactor.md).
 * The 156 unit tests in character-parser.test.ts assert on specific values
 * (HP, AC, skill lines). These snapshots catch *holistic* drift — section
 * ordering, blank-line spacing, header dashes, accidentally re-emitted blocks
 * — that targeted assertions don't notice.
 *
 * On intentional output changes:
 *   npx vitest run tests/character-snapshot.test.ts -u
 * Then review the .snap diff in the PR carefully.
 */
import { describe, it, expect } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { FIGHTER_5, MONK_3_HANDAXE, ARCANE_TRICKSTER_9 } from "./fixtures/character-fixtures.js";

describe("parseCharacterData snapshots", () => {
  it("FIGHTER_5 — full output", () => {
    expect(parseCharacterData(FIGHTER_5, "full")).toMatchSnapshot();
  });

  it("FIGHTER_5 — summary section only", () => {
    expect(parseCharacterData(FIGHTER_5, "summary")).toMatchSnapshot();
  });

  it("MONK_3_HANDAXE — full output", () => {
    expect(parseCharacterData(MONK_3_HANDAXE, "full")).toMatchSnapshot();
  });

  it("ARCANE_TRICKSTER_9 — full output", () => {
    expect(parseCharacterData(ARCANE_TRICKSTER_9, "full")).toMatchSnapshot();
  });

  it("ARCANE_TRICKSTER_9 — spells section only", () => {
    expect(parseCharacterData(ARCANE_TRICKSTER_9, "spells")).toMatchSnapshot();
  });
});
