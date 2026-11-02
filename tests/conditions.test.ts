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

  it("every condition exists in both editions, with its own edition's rules line", () => {
    expect(CONDITION_NAMES).toHaveLength(15);
    for (const n of CONDITION_NAMES) for (const ed of ["2024", "2014"] as const) {
      const out = getCondition(n, ed);
      expect(out.split("\n")[0]).toBe(`**${n}**`);
      expect(out.split("\n")[1]).toBe(`Rules: ${ed} · SRD 5.${ed === "2024" ? 2 : 1}`);
    }
  });

  it("each edition shows its own table's text (Grappled differs between them)", () => {
    const g2024 = getCondition("Grappled", "2024");
    const g2014 = getCondition("Grappled", "2014");
    expect(g2024).toContain("While you have the Grappled condition, you experience the following effects.");
    expect(g2024).toContain("• Movable. The grappler can drag or carry you");
    expect(g2024).not.toContain("A grappled creature's speed becomes 0");
    expect(g2014).toContain("A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.");
    expect(g2014).not.toContain("While you have the Grappled condition");
  });

  it("an inherited object key or a blank name is not found, not a crash or a partial match", () => {
    for (const name of ["constructor", "__proto__", "toString", "  ", ""]) {
      for (const ed of ["2024", "2014"] as const) {
        expect(getCondition(name, ed)).toMatch(/^Condition ".*" not found\.\n\nAvailable conditions: Blinded, /s);
      }
    }
  });

  it("partial names still match, and an unknown name lists the conditions", () => {
    expect(getCondition("exhaust").split("\n")[0]).toBe("**Exhaustion**");
    expect(getCondition("zzz")).toMatch(/^Condition "zzz" not found\.\n\nAvailable conditions: Blinded, /);
  });

  it("an ambiguous partial lists the candidates in table order", () => {
    for (const ed of ["2024", "2014"] as const) {
      const out = getCondition("ed", ed);
      const prefix = 'Condition "ed" is ambiguous: ';
      expect(out.startsWith(prefix)).toBe(true);
      expect(out.endsWith(" — use the full name.")).toBe(true);
      const names = out.slice(prefix.length, -" — use the full name.".length).split(", ");
      expect(names.length).toBeGreaterThan(1);
      for (const n of names) expect(n.toLowerCase()).toContain("ed");
      expect(names).toContain("Charmed");
      expect(names).toEqual(CONDITION_NAMES.filter(n => n.toLowerCase().includes("ed")));
    }
  });

  it("a unique partial still resolves; exact keys win; blank and constructor are not found", () => {
    expect(getCondition("exhaus").split("\n")[0]).toBe("**Exhaustion**");
    expect(getCondition("Stunned").split("\n")[0]).toBe("**Stunned**");
    expect(getCondition("").startsWith('Condition "" not found.')).toBe(true);
    expect(getCondition("constructor")).toContain("not found");
  });
});
