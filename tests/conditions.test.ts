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

  it("2014 Exhaustion includes stacking and removal", () => {
    const out = getCondition("exhaustion", "2014");
    expect(out).toContain("as well as all lower levels");
    expect(out).toContain("Finishing a long rest reduces a creature's exhaustion level by 1");
    expect(out).toContain("being raised from the dead reduces a creature's exhaustion level by 1");
  });

  it("2014 Grappled keeps the thunderwave sentence", () => {
    expect(getCondition("grappled", "2014")).toContain("such as when a creature is hurled away by the thunderwave spell");
  });

  it("every 2014 condition prints description, effects, then notes", () => {
    for (const n of CONDITION_NAMES) {
      const lines = getCondition(n, "2014").split("\n");
      expect(lines.slice(0, 3)).toEqual([`**${n}**`, "Rules: 2014 · SRD 5.1", ""]);
      expect(lines[3]).toBeTruthy();
      expect(lines[3]).not.toMatch(/^• /);
      const rest = lines.slice(4);
      const firstPlain = rest.findIndex(l => l !== "" && !l.startsWith("• "));
      // After the bullets, everything is a blank line then a plain paragraph.
      if (firstPlain >= 0) {
        for (const l of rest.slice(0, firstPlain)) expect(l === "" || l.startsWith("• ")).toBe(true);
        expect(rest[firstPlain - 1]).toBe("");
        expect(rest.slice(firstPlain).filter(l => l.startsWith("• "))).toEqual([]);
      }
    }
    const exhaustion = getCondition("exhaustion", "2014").split("\n");
    expect(exhaustion.filter(l => l.startsWith("• Level "))).toHaveLength(6);
    expect(exhaustion.at(-1)).toContain("Also, being raised from the dead");
    expect(getCondition("Poisoned", "2014")).not.toMatch(/\n\n.*\n\n/);
  });

  it("2014 Invisible and Paralyzed carry the full SRD 5.1 text", () => {
    expect(getCondition("invisible", "2014")).toContain("For the purpose of hiding, the creature is heavily obscured.");
    expect(getCondition("paralyzed", "2014")).toContain("within 5 feet of the creature.");
    expect(getCondition("petrified", "2014")).toContain("a poison or disease already in its system is suspended, not neutralized.");
  });
});
