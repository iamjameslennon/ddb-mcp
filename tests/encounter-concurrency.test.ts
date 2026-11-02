import { describe, expect, it, vi } from "vitest";

const getMonsterStats = vi.hoisted(() => vi.fn());
vi.mock("../src/tools/monster.js", () => ({ getMonsterStats }));

import { rateEncounter } from "../src/tools/encounter.js";
import { generateTreasure } from "../src/tools/treasure.js";

const found = (name: string, crValue: number, xp: number) => ({ status: "found", name, crValue, xp, info: { ruleset: "2024", book: null } });

describe("rateEncounter monster lookups", () => {
  it("resolves distinct names concurrently, and the output keeps input order", async () => {
    const releases = new Map<string, () => void>();
    getMonsterStats.mockImplementation((name: string) => new Promise(res => {
      releases.set(name, () => res(name === "Wolf" ? found("Wolf", 0.25, 50) : found("Ogre", 2, 450)));
    }));
    const pending = rateEncounter([{ count: 4, level: 5 }], [{ name: "Ogre" }, { name: "Wolf" }, { name: "Ogre", count: 2 }], "2024");
    await vi.waitFor(() => expect(releases.size).toBe(2)); // both lookups pending before either settles
    expect(getMonsterStats).toHaveBeenCalledTimes(2);
    releases.get("Wolf")!(); // settle out of input order
    releases.get("Ogre")!();
    const out = await pending;
    expect(out.indexOf("Ogre")).toBeGreaterThan(-1);
    expect(out.indexOf("Ogre")).toBeLessThan(out.indexOf("Wolf"));
    expect(out).toContain("2 × Ogre");
  });
});

/** Every lookup stays pending until released; tracks the most in flight at once. */
function gatedLookups() {
  const pending: Array<{ name: string; release: () => void }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  getMonsterStats.mockReset();
  getMonsterStats.mockImplementation((name: string) => new Promise(res => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    pending.push({ name, release: () => { inFlight--; res(found(name, 1, 200)); } });
  }));
  return { pending, max: () => maxInFlight };
}

async function drain(gate: ReturnType<typeof gatedLookups>, total: number): Promise<void> {
  for (let released = 0; released < total; released++) {
    await vi.waitFor(() => expect(gate.pending.length).toBeGreaterThan(0));
    gate.pending.shift()!.release();
  }
}

const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];

describe("bounded lookup concurrency (minors C #5)", () => {
  it("rateEncounter has at most 4 lookups in flight, and keeps input order", async () => {
    const gate = gatedLookups();
    const out = rateEncounter([{ count: 4, level: 5 }], NAMES.map(name => ({ name })), "2024");
    await vi.waitFor(() => expect(gate.pending.length).toBeGreaterThanOrEqual(4));
    await new Promise(r => setTimeout(r, 10));
    expect(getMonsterStats).toHaveBeenCalledTimes(4);
    await drain(gate, NAMES.length);
    const text = await out;
    expect(gate.max()).toBe(4);
    expect(getMonsterStats).toHaveBeenCalledTimes(NAMES.length);
    const at = NAMES.map(n => text.indexOf(`1 × ${n}`));
    expect(at.every(i => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("generateTreasure has at most 4 lookups in flight, and keeps input order", async () => {
    const gate = gatedLookups();
    const out = generateTreasure({ monsters: NAMES.map(name => ({ name, count: 1 })), treasureType: "individual" });
    await vi.waitFor(() => expect(gate.pending.length).toBeGreaterThanOrEqual(4));
    await new Promise(r => setTimeout(r, 10));
    expect(getMonsterStats).toHaveBeenCalledTimes(4);
    await drain(gate, NAMES.length);
    const text = await out;
    expect(gate.max()).toBe(4);
    const at = NAMES.map(n => text.indexOf(n));
    expect(at.every(i => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
