import { beforeEach, describe, expect, it, vi } from "vitest";

const getMonsterStats = vi.hoisted(() => vi.fn());
vi.mock("../src/tools/monster.js", () => ({ getMonsterStats }));

import { rateEncounter } from "../src/tools/encounter.js";

const goblin = { status: "found", name: "Goblin", crValue: 0.25, xp: 50, info: { ruleset: "2024", book: null } };
const dragons = { status: "ambiguous", candidates: [{ name: "Red Dragon Wyrmling", crValue: 4 }, { name: "Adult Red Dragon", crValue: 17 }] };
const notFound = { status: "not-found" };

const PARTY = [{ count: 3, level: 5 }, { count: 1, level: 3 }];
const PARTY_4 = [{ count: 4, level: 5 }];

beforeEach(() => {
  getMonsterStats.mockReset();
  getMonsterStats.mockImplementation(async (name: string) =>
    name === "Goblin" ? goblin : name === "Red Dragon" ? dragons : notFound);
});

describe("rateEncounter with uncounted monsters", () => {
  it("2024: headline says INCOMPLETE and the warning sits under the Rules line", async () => {
    const out = await rateEncounter(PARTY, [{ name: "Red Dragon" }, { name: "Goblin", count: 4 }], "2024");
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^ENCOUNTER DIFFICULTY: INCOMPLETE — 1 monster\(s\) not counted \(the rest rate [A-Z]+\) \(2024 XDMG\)$/);
    expect(lines[1]).toMatch(/^Rules:/);
    expect(lines[2]).toBe("");
    expect(lines[3]).toMatch(/^⚠ /);
    expect(out.indexOf("⚠")).toBeLessThan(out.indexOf("PARTY"));
    expect(out.match(/⚠/g)).toHaveLength(1);
    expect(out).not.toContain("\n\n\n");
    expect(lines.at(-1)).toMatch(/^Result: /);
  });

  it("2014: same input, Multiplier line says excludes 1 not counted", async () => {
    const out = await rateEncounter(PARTY, [{ name: "Red Dragon" }, { name: "Goblin", count: 4 }], "2014");
    expect(out.split("\n")[0]).toMatch(/^ENCOUNTER DIFFICULTY: INCOMPLETE — 1 monster\(s\) not counted \(the rest rate [A-Z]+\)$/);
    expect(out).toContain("excludes 1 not counted)");
    expect(out.indexOf("⚠")).toBeLessThan(out.indexOf("PARTY"));
    expect(out.match(/⚠/g)).toHaveLength(1);
    expect(out).not.toContain("\n\n\n");
  });

  it("2014: Multiplier line is printed at x1 when something is uncounted", async () => {
    const out = await rateEncounter(PARTY_4, [{ name: "Goblin" }, { name: "Nope" }], "2014");
    expect(out).toContain("Multiplier:   ×1 (1 monster; excludes 1 not counted)");
  });

  it("2014: stepped up, flat list with exclusions", async () => {
    const out = await rateEncounter([{ count: 2, level: 5 }], [{ cr: 1, count: 2 }, { name: "Nope" }], "2014");
    expect(out).toContain("Multiplier:   ×2 (2 monsters, stepped up — party fewer than 3; excludes 1 not counted)");
  });

  it("2014: stepped up, flat list without exclusions", async () => {
    const out = await rateEncounter([{ count: 2, level: 5 }], [{ cr: 1, count: 2 }], "2014");
    expect(out).toContain("Multiplier:   ×2 (2 monsters, stepped up — party fewer than 3)");
  });

  it("2014: stepped down, flat list with and without exclusions", async () => {
    const party = [{ count: 6, level: 5 }];
    const plain = await rateEncounter(party, [{ cr: 1, count: 4 }], "2014");
    expect(plain).toContain("Multiplier:   ×1.5 (4 monsters, stepped down — party larger than 5)");
    const withNf = await rateEncounter(party, [{ cr: 1, count: 4 }, { name: "Nope" }], "2014");
    expect(withNf).toContain("Multiplier:   ×1.5 (4 monsters, stepped down — party larger than 5; excludes 1 not counted)");
  });

  it("counts m.count for each uncounted entry, mixed with a cr-supplied monster", async () => {
    const out = await rateEncounter(PARTY_4, [{ name: "Nope", count: 3 }, { cr: 1 }], "2024");
    expect(out.split("\n")[0]).toContain("INCOMPLETE — 3 monster(s) not counted");
  });

  it("an entry with neither name nor cr stays silently skipped", async () => {
    const out = await rateEncounter(PARTY_4, [{ cr: 1 }, {}], "2024");
    expect(out).not.toContain("INCOMPLETE");
  });

  it("only uncounted monsters: the existing No valid monsters reply", async () => {
    const out = await rateEncounter(PARTY_4, [{ name: "Nope" }], "2024");
    expect(out).toMatch(/^No valid monsters provided\./);
    expect(out).not.toContain("INCOMPLETE");
  });
});
