import { describe, expect, it, vi } from "vitest";

const getMonsterStats = vi.hoisted(() => vi.fn());
vi.mock("../src/tools/monster.js", () => ({ getMonsterStats }));

import { rateEncounter } from "../src/tools/encounter.js";

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
