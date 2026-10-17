import { describe, it, expect } from "vitest";
import {
  buildClassFeatures,
  filterClassFeatures,
  formatClassFeatureLine,
  type OptionalCollection,
} from "../src/tools/features-traits.js";
import { stripHtml, wrapUntrusted } from "../src/utils.js";
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

  it("is independent of input order at every level", () => {
    const rev = <T>(a: readonly T[]): T[] => [...a].reverse();
    const classes = rev(CLASSES).map((c) => ({ ...c, classFeatures: rev(c.classFeatures) }));
    const subMap = new Map(
      rev([...subs]).map(([k, list]) => [
        k,
        rev(list).map((s) => {
          const sub = s as { classFeatures: unknown[] };
          return { ...sub, classFeatures: rev(sub.classFeatures) };
        }),
      ]),
    );
    const optMap = new Map(
      rev([...opts]).map(([k, c]) => [k, { ...c, definitionData: rev(c.definitionData ?? []) }]),
    );
    expect(buildClassFeatures(classes, subMap, optMap)).toEqual(all);
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

describe("buildClassFeatures rules (synthetic inputs)", () => {
  const cls = (over: Record<string, unknown> = {}) => ({
    id: 1,
    name: "Testclass",
    isHomebrew: false,
    sources: [{ sourceId: 5 }],
    classFeatures: [{ id: 100, name: "Base One", requiredLevel: 1, displayOrder: 1, summary: "s", description: "<p>d</p>" }],
    ...over,
  });
  const opt = (defs: unknown[], accessTypes?: Record<string, number>) =>
    new Map<number, OptionalCollection>([[1, { definitionData: defs, accessTypes }]]);
  const none = new Map<number, unknown[]>();

  it("renders a locked optional entry with only the locked line", () => {
    const [e] = buildClassFeatures(
      [cls()],
      none,
      opt([{ id: 7, name: "Locked", requiredLevel: 2, snippet: "snip", description: "<p>desc</p>" }], { "7": 4 }),
    ).filter((x) => x.kind === "optional");
    expect(formatClassFeatureLine(e).split("\n")[1]).toBe("  *locked — not available to this account*");
  });

  it("drops an optional entry that repeats a base id and keeps others", () => {
    const r = buildClassFeatures(
      [cls()],
      none,
      opt([
        { id: 100, name: "Dup", snippet: "x" },
        { id: 101, name: "Fresh", snippet: "x" },
      ]),
    );
    expect(r.filter((x) => x.kind === "optional").map((x) => x.name)).toEqual(["Fresh"]);
  });

  it("falls back to the description when the snippet holds a template", () => {
    const [e] = buildClassFeatures(
      [cls()],
      none,
      opt([{ id: 8, name: "Tmpl", snippet: "Deals {{modifier:str}}", description: "<p>Plain <b>text</b></p>" }]),
    ).filter((x) => x.kind === "optional");
    expect(e.text).toBe(stripHtml("<p>Plain <b>text</b></p>"));
    expect(e.text).toBe("Plain text");
  });

  it("treats missing accessTypes as unlocked", () => {
    const [e] = buildClassFeatures([cls()], none, opt([{ id: 9, name: "Free", snippet: "x" }])).filter(
      (x) => x.kind === "optional",
    );
    expect(e.locked).toBe(false);
  });

  it("formats a null requiredLevel as ?", () => {
    const [e] = buildClassFeatures([cls({ classFeatures: [{ id: 3, name: "NoLevel", requiredLevel: null }] })], none, new Map());
    expect(formatClassFeatureLine(e)).toBe("- **NoLevel** — Testclass level ?");
  });

  it("propagates sources from class, subclass and optional entry", () => {
    const all = build();
    const base = all.find((x) => x.name === "Second Wind" && x.classId === 10)!;
    const sub = all.find((x) => x.name === "Improved Critical" && x.subclassName === "Champion")!;
    const o = all.find((x) => x.name === "Synthetic Option")!;
    expect(base.sources).toEqual([{ sourceId: 1 }]);
    expect(sub.sources).toEqual([{ sourceId: 1 }]);
    expect(o.sources).toEqual([{ sourceId: 67 }]);
    const r = buildClassFeatures(
      [cls()],
      new Map([[1, [{ id: 2, name: "Sub", sources: [{ sourceId: 9 }], classFeatures: [{ id: 200, name: "SF" }] }]]]),
      new Map(),
    );
    expect(r.find((x) => x.name === "Base One")?.sources).toEqual([{ sourceId: 5 }]);
    expect(r.find((x) => x.name === "SF")?.sources).toEqual([{ sourceId: 9 }]);
  });

  it("marks optional entries under a homebrew class as homebrew and wraps the line", () => {
    const [e] = buildClassFeatures([cls({ isHomebrew: true })], none, opt([{ id: 11, name: "HB", requiredLevel: 1, snippet: "x" }])).filter(
      (x) => x.kind === "optional",
    );
    expect(e.isHomebrew).toBe(true);
    expect(formatClassFeatureLine(e)).toBe(wrapUntrusted("- **HB** — Testclass level 1, optional\n  x"));
  });

  it("does not mutate the input when filtering", () => {
    const input = build();
    const before = input.map((e) => `${e.classId}:${e.kind}:${e.id}`);
    filterClassFeatures(input, { name: "a" });
    expect(input.map((e) => `${e.classId}:${e.kind}:${e.id}`)).toEqual(before);
  });

  it("strips and trims summary and snippet text", () => {
    const r = buildClassFeatures(
      [cls({ classFeatures: [{ id: 4, name: "Blank", summary: "   ", description: "<p>Desc text</p>" }] })],
      none,
      opt([{ id: 12, name: "Em", snippet: "<em>Bold</em> text", description: "<p>other</p>" }]),
    );
    expect(r.find((x) => x.name === "Blank")?.text).toBe("Desc text");
    expect(r.find((x) => x.name === "Em")?.text).toBe("Bold text");
  });

  it("omits the description line when the text is empty", () => {
    const [e] = buildClassFeatures([cls({ classFeatures: [{ id: 4, name: "Empty", requiredLevel: 1, summary: " ", description: "" }] })], none, new Map());
    expect(formatClassFeatureLine(e)).toBe("- **Empty** — Testclass level 1");
  });

  it("breaks ties between same-named subclasses by subclassId", () => {
    const feat = { id: 50, name: "Same", requiredLevel: 3, displayOrder: 1 };
    const mk = (id: number) => ({ id, name: "Twin", classFeatures: [feat] });
    for (const order of [[20, 10], [10, 20]]) {
      const r = buildClassFeatures([cls()], new Map([[1, order.map(mk)]]), new Map());
      expect(r.filter((x) => x.kind === "subclass").map((x) => x.subclassId)).toEqual([10, 20]);
    }
  });
});
