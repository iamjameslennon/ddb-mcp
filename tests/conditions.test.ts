import { describe, it, expect } from "vitest";
import { getCondition, CONDITION_NAMES } from "../src/tools/conditions.js";

describe("getCondition", () => {
  it("Exhaustion is the 2024 text by default", () => {
    const out = getCondition("Exhaustion");
    expect(out.split("\n").slice(0, 2)).toEqual(["**Exhaustion**", "Rules: 2024 · SRD 5.2"]);
    expect(out).toContain("You die if your Exhaustion level is 6.");
    expect(out).toContain("the roll is reduced by 2 times your Exhaustion level");
    expect(out).not.toContain("Level 2: Speed halved");
  });

  it("Exhaustion is the six-level table on request", () => {
    const out = getCondition("exhaustion", "2014");
    expect(out.split("\n")[1]).toBe("Rules: 2014 · SRD 5.1");
    expect(out).toContain("Level 6: Death");
  });

  it("every condition exists in both editions, with a rules line", () => {
    expect(CONDITION_NAMES).toHaveLength(15);
    for (const n of CONDITION_NAMES) for (const ed of ["2024", "2014"] as const) {
      expect(getCondition(n, ed).split("\n")[1]).toMatch(/^Rules: (2024 · SRD 5\.2|2014 · SRD 5\.1)$/);
    }
  });

  it("partial names still match, and an unknown name lists the conditions", () => {
    expect(getCondition("exhaust").split("\n")[0]).toBe("**Exhaustion**");
    expect(getCondition("zzz")).toMatch(/^Condition "zzz" not found\.\n\nAvailable conditions: Blinded, /);
  });
});
