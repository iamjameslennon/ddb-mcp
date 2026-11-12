/** Chosen class options on the sheet and in lookup (F4; owner rulings R1, R6). */
import { describe, expect, it } from "vitest";
import { parseCharacterData } from "../src/tools/character.js";
import { formatCharacterLookup } from "../src/tools/character/definition.js";
import { wrapUntrusted } from "../src/utils.js";
import { INDEX } from "./fixtures/character-edition-helpers.js";
import { BASE, CLASS_FEATURE, FIGHTER, feature, fighter } from "./fixtures/combat-helpers.js";

const opt = (parent: number, id: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ componentId: parent, componentTypeId: CLASS_FEATURE, definition: { id, name, description: `<p>${name} text.</p>`, ...extra } });
const sheet = (overrides: Record<string, unknown>) =>
  parseCharacterData({ data: { ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides } }, "features", INDEX);
const lookup = (overrides: Record<string, unknown>, q: string) =>
  formatCharacterLookup({ ...BASE, inventory: [], classSpells: [], spells: {}, ...overrides }, q, INDEX);
const style = (requiredLevel = 1) => fighter({ classFeatures: [feature(191, "Fighting Style", { requiredLevel })] });
const warlock = (extra: Record<string, unknown> = {}) => fighter({
  level: 5,
  definition: { ...(FIGHTER.definition as Record<string, unknown>), name: "Warlock", sourceId: 1, sources: [{ sourceId: 1 }] },
  classFeatures: [feature(400, "Eldritch Invocations", { requiredLevel: 2 }), feature(401, "Pact Boon", { requiredLevel: 3 })],
  ...extra,
});
const invocations = [
  opt(400, 11, "Agonizing Blast"), opt(400, 12, "Devil’s Sight"), opt(401, 13, "Pact of the Blade"),
];

describe("chosen class options on the sheet (R1)", () => {
  it("prints an option on its parent feature line", () => {
    expect(sheet({ classes: [style()], options: { class: [opt(191, 1, "Archery")] } }))
      .toContain("• Fighting Style (Fighter 1): Archery");
  });

  it("lists several options, one line per parent", () => {
    const out = sheet({ classes: [warlock()], options: { class: invocations } });
    expect(out).toContain("• Eldritch Invocations (Warlock 2): Agonizing Blast, Devil’s Sight");
    expect(out).toContain("• Pact Boon (Warlock 3): Pact of the Blade");
  });

  it("leaves out an option whose feature is above the class level", () => {
    const o = { classes: [style(99)], options: { class: [opt(191, 1, "Archery")] } };
    expect(sheet(o)).not.toContain("Archery");
    expect(lookup(o, "Archery")).toMatch(/^No definition found/);
    // Its bonus is gated the same way: see "ignores Archery when its Fighting Style feature is above the class level"
    // in combat-weapon-bonuses.test.ts.
  });

  it("wraps the whole line for a homebrew option and leaves an official one plain", () => {
    const hb = sheet({ classes: [style()], options: { class: [opt(191, 1, "Archery", { isHomebrew: true })] } });
    expect(hb).toContain(wrapUntrusted("• Fighting Style (Fighter 1): Archery"));
    const official = sheet({ classes: [style()], options: { class: [opt(191, 1, "Archery", { isHomebrew: false })] } });
    expect(official).toContain("• Fighting Style (Fighter 1): Archery");
    expect(official).not.toContain("untrusted_dndbeyond_content>\n• Fighting Style");
  });

  it("adds nothing for an option under a feature the sheet does not print", () => {
    const out = sheet({ classes: [style()], options: { class: [opt(999, 5, "Canny")] } });
    expect(out).not.toContain("Canny");
  });

  it("ignores options that are not class options", () => {
    const out = sheet({ classes: [style()], options: { race: [opt(191, 1, "Archery")], feat: [] } });
    expect(out).not.toContain("Archery");
  });
});

describe("chosen class options in lookup (R1, R6)", () => {
  const w = { classes: [warlock()], options: { class: invocations } };

  it("resolves an option by name under its parent and class", () => {
    const out = lookup(w, "Agonizing Blast");
    expect(out.startsWith("[Class Option]\nAgonizing Blast (Eldritch Invocations, Warlock)\n")).toBe(true);
  });

  it("uses the option's own source for its Rules line", () => {
    const out = lookup({ classes: [warlock()], options: { class: [opt(400, 21, "Eldritch Smite", { sourceId: 27 })] } }, "Eldritch Smite");
    expect(out.split("\n")[2]).toBe("Rules: 2014 · Xanathar's Guide to Everything");
  });

  it("falls back to the owning class's line when the option has no source", () => {
    const cls = lookup(w, "Eldritch Invocations").split("\n")[2];
    expect(lookup(w, "Agonizing Blast").split("\n")[2]).toBe(cls);
  });

  it("a parent feature hit ends with its chosen options", () => {
    const out = lookup({ classes: [style()], options: { class: [opt(191, 1, "Archery")] } }, "Fighting Style");
    expect(out).toMatch(/\n\nChosen: Archery$/);
  });

  it("wraps a homebrew option hit and leaves an official one plain", () => {
    const hb = lookup({ classes: [style()], options: { class: [opt(191, 1, "Archery", { isHomebrew: true })] } }, "Archery");
    expect(hb).toContain("<untrusted_dndbeyond_content>");
    const ok = lookup({ classes: [style()], options: { class: [opt(191, 1, "Archery")] } }, "Archery");
    expect(ok).not.toContain("untrusted_dndbeyond_content");
  });

  it("finds an option under an optional class feature though the sheet prints nothing", () => {
    const o = { classes: [style()], optionalClassFeatures: [{ classFeatureId: 999 }], options: { class: [opt(999, 5, "Canny")] } };
    expect(lookup(o, "Canny")).toContain("[Class Option]");
    expect(sheet(o)).not.toContain("Canny");
  });
});
