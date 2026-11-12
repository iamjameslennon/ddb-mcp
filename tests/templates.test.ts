import { describe, it, expect } from "vitest";
import { makeResolveTemplates, describeTemplates } from "../src/tools/character/templates.js";

const ctx = { profBonus: 2, totalLevel: 1, statMods: [3, 1, 2, 0, 1, -1], statTotals: [16, 12, 14, 10, 12, 8] };
const resolve = makeResolveTemplates(ctx);
const r = (t: string, cl?: number) => resolve(t, cl);

describe("makeResolveTemplates", () => {
  it("evaluates the D&D Beyond template grammar", () => {
    expect(r("increases by {{2*characterlevel}}.")).toBe("increases by 2.");
    expect(r("{{characterlevel*2}}")).toBe("2");
    expect(r("{{proficiency#signed}}")).toBe("+2");
    expect(r("{{modifier:cha@min:1#unsigned}}")).toBe("1");
    expect(r("DC {{savedc:wis}}")).toBe("DC 11");
    expect(r("{{spellattack:str}}")).toBe("5");
    expect(r("{{(classlevel/2)@roundup}}", 5)).toBe("3");
    expect(r("{{(classlevel/2)@rounddown}}", 5)).toBe("2");
    expect(r("{{10+modifier:dex+modifier:con#unsigned}}")).toBe("13");
    expect(r("{{abilityscore:str}}")).toBe("16");
    expect(r("{{scalevalue}}")).toBe("?");
    expect(r("{{modifier:cha}}")).toBe("-1");
    expect(r("{{1+}}")).toBe("?");
  });
});

describe("describeTemplates", () => {
  it("turns templates into plain phrases", () => {
    expect(describeTemplates("add {{proficiency#signed}} to the roll")).toBe("add your Proficiency Bonus to the roll");
    expect(describeTemplates("by {{2*characterlevel}}")).toBe("by twice your character level");
    expect(describeTemplates("{{3*classlevel}}")).toBe("3 × your class level");
    expect(describeTemplates("{{modifier:cha}}")).toBe("your Charisma modifier");
    expect(describeTemplates("{{(modifier:cha+classlevel)@min:1}}")).toBe("a value based on your character");
  });
});
