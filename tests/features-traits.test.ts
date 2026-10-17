import { describe, it, expect } from "vitest";
import {
  buildClassFeatures,
  filterClassFeatures,
  formatClassFeatureLine,
  type OptionalCollection,
} from "../src/tools/features-traits.js";
import { wrapUntrusted } from "../src/utils.js";
import {
  CLASSES,
  SUBCLASSES_BY_CLASS_ID,
  OPTIONAL_FEATURES_BY_CLASS_ID,
} from "./fixtures/features-traits-fixtures.js";

function toMap<T>(rec: Record<string, unknown>): Map<number, T> {
  return new Map(Object.entries(rec).map(([k, v]) => [Number(k), v as T]));
}

const subs = toMap<unknown[]>(SUBCLASSES_BY_CLASS_ID);
const opts = toMap<OptionalCollection>(OPTIONAL_FEATURES_BY_CLASS_ID);
const build = (classes: unknown[] = CLASSES) => buildClassFeatures(classes, subs, opts);

describe("buildClassFeatures", () => {
  const all = build();

  it("keeps Action Surge once per Fighter", () => {
    const surges = all.filter((e) => e.name === "Action Surge");
    expect(surges.map((e) => e.classId).sort((a, b) => a - b)).toEqual([10, 2190879]);
    for (const s of surges) {
      expect(s.kind).toBe("class");
      expect(s.requiredLevel).toBe(2);
    }
  });

  it("uses the summary for class 10 Action Surge", () => {
    const e = all.find((x) => x.name === "Action Surge" && x.classId === 10);
    expect(e?.text).toBe("Action Surge summary");
  });

  it("marks Champion's Improved Critical as a subclass feature", () => {
    const e = all.find((x) => x.name === "Improved Critical" && x.subclassName === "Champion");
    expect(e?.kind).toBe("subclass");
  });

  it("drops subclass features that repeat a parent base id (both Champions)", () => {
    for (const classId of [10, 2190879]) {
      const champ = all.filter((x) => x.classId === classId && x.subclassName === "Champion");
      expect(champ.length).toBeGreaterThan(0);
      expect(champ.some((x) => x.name === "Second Wind" || x.name === "Action Surge")).toBe(false);
    }
  });

  it("keeps every Ability Score Improvement repeat", () => {
    expect(all.filter((e) => e.classId === 10 && e.name === "Ability Score Improvement")).toHaveLength(7);
    expect(all.filter((e) => e.classId === 10 && e.name === "Extra Attack")).toHaveLength(3);
    const f24 = all.filter((e) => e.classId === 2190879 && e.kind === "class");
    expect(f24.filter((e) => /Ability Score Improvement/.test(e.name))).toHaveLength(6);
  });

  it("flags a locked optional feature and renders the locked line", () => {
    const e = all.find((x) => x.name === "Martial Versatility");
    expect(e?.kind).toBe("optional");
    expect(e?.locked).toBe(true);
    expect(formatClassFeatureLine(e!).endsWith("\n  *locked — not available to this account*")).toBe(true);
  });

  it("uses the snippet for an unlocked optional feature", () => {
    const e = all.find((x) => x.name === "Synthetic Option");
    expect(e?.locked).toBe(false);
    expect(e?.text).toBe("Synthetic Option snippet");
  });

  it("is independent of input class order", () => {
    expect(build([...CLASSES].reverse())).toEqual(all);
  });

  it("skips records without a name, or class records without a numeric id, without throwing", () => {
    const broken = [
      { id: 1, name: "Broken", classFeatures: [{ id: 5, requiredLevel: 1 }, { id: 6, name: "Ok" }] },
      { name: "NoId", classFeatures: [{ id: 7, name: "Orphan" }] },
      null,
    ];
    const r = buildClassFeatures(broken, new Map(), new Map());
    expect(r.map((e) => e.name)).toEqual(["Ok"]);
  });

  it("ignores optional collections without definitionData", () => {
    const r = buildClassFeatures(
      CLASSES,
      new Map(),
      new Map<number, OptionalCollection>([[10, "bad" as unknown as OptionalCollection]]),
    );
    expect(r.some((e) => e.kind === "optional")).toBe(false);
  });
});

describe("filterClassFeatures", () => {
  const all = build();

  it("filters className against class or subclass name", () => {
    const r = filterClassFeatures(all, { className: "champion" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.subclassName === "Champion")).toBe(true);
  });

  it("sorts name matches by class id", () => {
    const r = filterClassFeatures(all, { name: "action surge" });
    expect(r.map((e) => e.classId)).toEqual([10, 2190879]);
  });

  it("filters by exact level", () => {
    const r = filterClassFeatures(all, { level: 2 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.requiredLevel === 2)).toBe(true);
  });
});

describe("formatClassFeatureLine", () => {
  const all = build();

  it("wraps homebrew lines and only those", () => {
    const e = all.find((x) => x.name === "Riposte Flourish")!;
    expect(formatClassFeatureLine(e)).toBe(
      wrapUntrusted("- **Riposte Flourish** — Fighter (Homebrew Duelist) level 3\n  Riposte Flourish description"),
    );
    const base = all.find((x) => x.name === "Second Wind" && x.classId === 10)!;
    expect(formatClassFeatureLine(base)).not.toContain("untrusted_dndbeyond_content");
  });

  it("truncates long descriptions to 100 characters plus ellipsis", () => {
    const e = all.find((x) => x.name === "Remarkable Athlete" && x.subclassName === "Champion" && x.classId === 10)!;
    expect(e.text.length).toBeGreaterThan(120);
    expect(formatClassFeatureLine(e).split("\n  ")[1]).toBe(`${e.text.slice(0, 100)}...`);
  });

  it("marks optional entries", () => {
    const e = all.find((x) => x.name === "Synthetic Option")!;
    expect(formatClassFeatureLine(e)).toBe(
      "- **Synthetic Option** — Fighter level 4, optional\n  Synthetic Option snippet",
    );
  });
});
