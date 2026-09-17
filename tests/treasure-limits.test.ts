import { describe, it, expect } from "vitest";
import {
  validateTreasureBudget,
  MAX_TREASURE_ENTRIES,
  MAX_MONSTER_COUNT,
  MAX_INDIVIDUAL_ROLLS,
  MAX_MONSTER_NAME_CHARS,
} from "../src/treasure-limits.js";

// This suite exercises the validator in isolation, independent of
// generateTreasure() / getMonsterStats(). It establishes schema/runtime
// agreement: the same limits enforced here must also be enforced by the
// Zod schema in src/index.ts and by generateTreasure()'s early guard.
//
// All just-over-limit values here are small (101, 21 entries, 201 chars)
// so this suite is safe to run against any implementation, including one
// that has not yet added budget checks.

describe("validateTreasureBudget — rejections", () => {
  it("rejects 101 monsters of a single type (individual)", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: 101 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
    expect(result).toContain("101");
    expect(result).toContain(String(MAX_MONSTER_COUNT));
  });

  it("rejects 101 monsters of a single type (hoard) — per-entry limit applies to hoards too", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: 101 }],
      treasureType: "hoard",
    });
    expect(result).toMatch(/^Error: /);
    expect(result).toContain(String(MAX_MONSTER_COUNT));
  });

  it("rejects 20 entries whose aggregate count is 101 (individual)", () => {
    const monsters = Array.from({ length: 20 }, (_, i) => ({
      name: `Monster${i}`,
      count: i < 19 ? 5 : 6, // 19*5 + 6 = 101
    }));
    const result = validateTreasureBudget({ monsters, treasureType: "individual" });
    expect(result).toMatch(/^Error: /);
    expect(result).toContain("101");
    expect(result).toContain(String(MAX_INDIVIDUAL_ROLLS));
  });

  it("accepts 20 entries whose aggregate count is 101 for hoard — aggregate budget does not apply to hoards", () => {
    const monsters = Array.from({ length: 20 }, (_, i) => ({
      name: `Monster${i}`,
      count: i < 19 ? 5 : 6,
    }));
    const result = validateTreasureBudget({ monsters, treasureType: "hoard" });
    expect(result).toBeNull();
  });

  it("rejects 21 monster entries", () => {
    const monsters = Array.from({ length: 21 }, (_, i) => ({ name: `Monster${i}`, count: 1 }));
    const result = validateTreasureBudget({ monsters, treasureType: "individual" });
    expect(result).toMatch(/^Error: /);
    expect(result).toContain("21");
    expect(result).toContain(String(MAX_TREASURE_ENTRIES));
  });

  it("rejects an overlong monster name (201 characters)", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "X".repeat(201), count: 1 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
    expect(result).toContain(String(MAX_MONSTER_NAME_CHARS));
  });

  it("accepts a name at exactly the character limit", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "X".repeat(MAX_MONSTER_NAME_CHARS), count: 1 }],
      treasureType: "individual",
    });
    expect(result).toBeNull();
  });

  it("rejects a zero count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: 0 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
  });

  it("rejects a negative count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: -1 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
  });

  it("rejects a fractional count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: 1.5 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
  });

  it("rejects an unsafe-integer count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: Number.MAX_SAFE_INTEGER + 1 }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
  });

  it("rejects Infinity as a count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: Infinity }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
  });

  it("rejects NaN as a count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: NaN }],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
  });

  it("rejects duplicate-name aggregate overflow computed before deduplication", () => {
    // Same name twice: a naive implementation that deduplicates by name
    // before budgeting would see only one "Goblin" entry and miss that
    // 120 total rolls were requested.
    const result = validateTreasureBudget({
      monsters: [
        { name: "Goblin", count: 60 },
        { name: "Goblin", count: 60 },
      ],
      treasureType: "individual",
    });
    expect(result).toMatch(/^Error: /);
    expect(result).toContain("120");
  });

  it("returns an error that states how to reduce the request", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: 101 }],
      treasureType: "individual",
    });
    // Not just "what's wrong" — also "what to do about it".
    expect(result).toMatch(/reduce|fewer|combine|split/i);
  });
});

describe("validateTreasureBudget — acceptance / boundaries", () => {
  it("accepts exactly 20 entries", () => {
    const monsters = Array.from({ length: MAX_TREASURE_ENTRIES }, (_, i) => ({
      name: `Monster${i}`,
      count: 1,
    }));
    const result = validateTreasureBudget({ monsters, treasureType: "individual" });
    expect(result).toBeNull();
  });

  it("accepts exactly 100 aggregate rolls for individual treasure", () => {
    const monsters = Array.from({ length: 20 }, () => ({ name: "Goblin", count: 5 })); // 20*5=100
    const result = validateTreasureBudget({ monsters, treasureType: "individual" });
    expect(result).toBeNull();
  });

  it("accepts exactly 100 for a single monster count (the per-entry boundary)", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: MAX_MONSTER_COUNT }],
      treasureType: "individual",
    });
    expect(result).toBeNull();
  });

  it("accepts an empty monster list (handled elsewhere by generateTreasure's exclusivity check)", () => {
    const result = validateTreasureBudget({ monsters: [], treasureType: "individual" });
    expect(result).toBeNull();
  });

  it("accepts a request with no monsters field (direct-CR path)", () => {
    const result = validateTreasureBudget({ treasureType: "hoard" });
    expect(result).toBeNull();
  });

  it("does not clamp — a rejected request's error never silently reduces the count", () => {
    const result = validateTreasureBudget({
      monsters: [{ name: "Goblin", count: 101 }],
      treasureType: "individual",
    });
    expect(result).not.toBeNull();
    // The error is a string describing the problem, not a modified request.
    expect(typeof result).toBe("string");
  });
});
