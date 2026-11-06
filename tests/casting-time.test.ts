import { describe, it, expect } from "vitest";
import { castingTimeText } from "../src/tools/casting-time.js";

const at = (activationTime: number, activationType: number) => ({ activationTime, activationType });

describe("castingTimeText", () => {
  it("prints actions and bonus actions", () => {
    expect(castingTimeText(at(1, 1))).toBe("1 Action");
    expect(castingTimeText(at(1, 3))).toBe("1 Bonus Action");
  });

  it("appends the reaction trigger when there is one", () => {
    const trigger = "which you take when you are hit by an attack or targeted by the magic missile spell";
    expect(castingTimeText(at(1, 4), trigger)).toBe(`1 Reaction, ${trigger}`);
    expect(castingTimeText(at(1, 4), "")).toBe("1 Reaction");
  });

  it("prints minutes and hours, plural when N is not 1", () => {
    expect(castingTimeText(at(1, 6))).toBe("1 Minute");
    expect(castingTimeText(at(10, 6))).toBe("10 Minutes");
    expect(castingTimeText(at(1, 7))).toBe("1 Hour");
    expect(castingTimeText(at(8, 7))).toBe("8 Hours");
  });

  it("prints No Action and Special without a number", () => {
    expect(castingTimeText(at(1, 2))).toBe("No Action");
    expect(castingTimeText(at(1, 5))).toBe("Special");
    expect(castingTimeText(at(1, 8))).toBe("Special");
  });

  it("keeps an unknown type visible", () => {
    expect(castingTimeText(at(1, 9))).toBe("1 (activation type 9)");
  });

  it("defaults sanely when fields are missing", () => {
    expect(castingTimeText(undefined)).toBe("1 Action");
    expect(castingTimeText({ activationType: 6 })).toBe("1 Minute");
    expect(castingTimeText(at(0, 6))).toBe("1 Minute");
  });
});
