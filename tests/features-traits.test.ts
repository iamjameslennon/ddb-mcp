import { describe, it, expect } from "vitest";
import {
  buildClassFeatures,
  filterClassFeatures,
  formatClassFeatureLine,
  buildRacialTraits,
  filterRacialTraits,
  formatRacialTraitLine,
  raceKeyOf,
  type OptionalCollection,
  type RacialTraitEntry,
} from "../src/tools/features-traits.js";
import { stripHtml, wrapUntrusted } from "../src/utils.js";
import {
  CLASSES,
  SUBCLASSES_BY_CLASS_ID,
  OPTIONAL_FEATURES_BY_CLASS_ID,
  RACES,
  OPTIONAL_TRAITS_BY_RACE_KEY,
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

describe("racial traits", () => {
  const optByKey = new Map(Object.entries(OPTIONAL_TRAITS_BY_RACE_KEY).map(([k, v]) => [k, v as OptionalCollection]));
  const all = buildRacialTraits(RACES, optByKey);
  const label = (e: RacialTraitEntry) => formatRacialTraitLine(e);

  it("builds raceKey from type and race ids", () => {
    expect(raceKeyOf({ entityRaceTypeId: 5, entityRaceId: 7 })).toBe("5:7");
  });

  it("gives Darkvision 11 one entry each for High Elf and Wood Elf", () => {
    const dv = all.filter((e) => e.id === 11);
    expect(dv.map((e) => e.speciesName)).toEqual(["High Elf", "Wood Elf"]);
    expect(dv.map((e) => label(e).match(/\((High Elf[^)]*|Wood Elf[^)]*)\)/)?.[1])).toEqual([
      "High Elf — subrace of Elf",
      "Wood Elf — subrace of Elf",
    ]);
  });

  it("lists Tiefling 2024 and the homebrew subrace, wrapping only the homebrew line", () => {
    const dv = all.filter((e) => e.id === 13856159);
    expect(dv).toHaveLength(2);
    expect(label(dv.find((e) => e.isHomebrew)!)).toBe(
      "<untrusted_dndbeyond_content>\n- **Darkvision** *(Tiefling — subrace of Tiefling, Homebrew)* — Darkvision snippet\n</untrusted_dndbeyond_content>",
    );
    expect(label(dv.find((e) => !e.isHomebrew)!)).toBe("- **Darkvision** *(Tiefling)* — Darkvision snippet");
  });

  it("keeps separate raceKeys for Human and High Elf", () => {
    expect(all.find((e) => e.id === 64)?.raceKey).toBe("1743923279:1");
    expect(all.find((e) => e.id === 11 && e.speciesName === "High Elf")?.raceKey).toBe("1228963568:1");
  });

  it("includes hidden traits", () => {
    expect(all.find((e) => e.id === 13856108)?.name).toBe("Speed");
    expect(all.find((e) => e.id === 13856114)?.name).toBe("Elven Lineage Spells");
  });

  it("uses the stripped description when the snippet has a template", () => {
    const e = all.find((x) => x.id === 13856114)!;
    expect(e.text).toBe(stripHtml("<p>Elven Lineage Spells description</p>"));
  });

  it("marks Human optional Languages and shows (optional)", () => {
    const e = all.find((x) => x.id === 4566698)!;
    expect(e.kind).toBe("optional");
    expect(label(e)).toContain(" *(optional)*");
    expect(all.find((x) => x.id === 64)?.kind).toBe("standard");
  });

  it("keeps both Goliath Large Form traits", () => {
    const lf = all.filter((e) => e.speciesName === "Goliath" && e.name === "Large Form");
    expect(lf.map((e) => e.id).sort((a, b) => a - b)).toEqual([13856127, 15478362]);
  });

  it("truncates a long trait line at 100 characters", () => {
    const e = all.find((x) => x.id === 13856127)!;
    expect(e.text.length).toBeGreaterThan(120);
    expect(label(e).endsWith(` — ${e.text.slice(0, 100)}...`)).toBe(true);
  });

  it("filters by name and raceName, sorted by species", () => {
    const elves = filterRacialTraits(all, { raceName: "elf" });
    expect(new Set(elves.map((e) => e.speciesName))).toEqual(new Set(["High Elf", "Wood Elf", "Elf"]));
    const dv = filterRacialTraits([...all].reverse(), { name: "darkvision" });
    expect(dv.map((e) => e.speciesName)).toEqual(["Elf", "High Elf", "Tiefling", "Tiefling", "Wood Elf"]);
  });

  it("matches raceName against baseRaceName", () => {
    const r = filterRacialTraits(all, { raceName: "tiefling" });
    expect(r.some((e) => e.isHomebrew)).toBe(true);
  });

  const race = (extra: Record<string, unknown> = {}) => ({
    entityRaceId: 9, entityRaceTypeId: 9, fullName: "Synth", baseRaceName: "Synth",
    isSubRace: false, isLegacy: false, isHomebrew: false,
    sources: [{ sourceId: 111 }],
    racialTraits: [{ definition: { id: 1, name: "Std", snippet: "", description: "<p>d</p>" } }],
    ...extra,
  });

  it("cleans text: strips tags, falls back on blank snippet", () => {
    const r = buildRacialTraits(
      [race({ racialTraits: [
        { definition: { id: 1, name: "Em", snippet: "<em>Bold</em> text", description: "<p>other</p>" } },
        { definition: { id: 2, name: "Blank", snippet: "  ", description: "<p>Desc text</p>" } },
      ] })],
      new Map(),
    );
    expect(r.find((x) => x.name === "Em")?.text).toBe("Bold text");
    expect(r.find((x) => x.name === "Blank")?.text).toBe("Desc text");
  });

  it("drops an optional trait whose id is standard for that species, keeps others", () => {
    const opt = new Map<string, OptionalCollection>([
      ["9:9", { definitionData: [{ id: 1, name: "Dup" }, { id: 2, name: "Other" }], accessTypes: {} }],
    ]);
    const r = buildRacialTraits([race()], opt);
    expect(r.map((e) => [e.id, e.kind])).toEqual([[1, "standard"], [2, "optional"]]);
  });

  it("marks locked optional traits and shows the locked desc", () => {
    const opt = new Map<string, OptionalCollection>([
      ["9:9", { definitionData: [{ id: 2, name: "Lk", snippet: "Has text" }], accessTypes: { "2": 4 } }],
    ]);
    const e = buildRacialTraits([race()], opt).find((x) => x.id === 2)!;
    expect(e.locked).toBe(true);
    expect(label(e)).toBe("- **Lk** *(Synth)* *(optional)* — *locked — not available to this account*");
  });

  it("propagates sources: race's for standard, own for optional", () => {
    const opt = new Map<string, OptionalCollection>([
      ["9:9", { definitionData: [{ id: 2, name: "Op", sources: [{ sourceId: 222 }] }, { id: 3, name: "NoSrc" }], accessTypes: {} }],
    ]);
    const r = buildRacialTraits([race()], opt);
    expect(r.find((x) => x.id === 1)?.sources).toEqual([{ sourceId: 111 }]);
    expect(r.find((x) => x.id === 2)?.sources).toEqual([{ sourceId: 222 }]);
    expect(r.find((x) => x.id === 3)?.sources).toEqual([]);
  });

  it("is independent of input order", () => {
    const rev = <T,>(a: T[]): T[] => [...a].reverse();
    const races = rev(RACES).map((r) => ({ ...r, racialTraits: rev(r.racialTraits) }));
    const entries = rev([...optByKey.entries()]).map(
      ([k, v]) => [k, { ...v, definitionData: rev((v.definitionData ?? []) as unknown[]) }] as [string, OptionalCollection],
    );
    expect(buildRacialTraits(races, new Map(entries))).toEqual(all);
  });

  it("filterRacialTraits does not mutate its input", () => {
    const copy = [...all].reverse();
    const before = [...copy];
    const out = filterRacialTraits(copy, {});
    expect(copy).toEqual(before);
    expect(out).toEqual(all);
  });

  it("skips malformed inputs without throwing", () => {
    const r = buildRacialTraits(
      [null, race({ fullName: undefined }), race({ entityRaceId: "1" }), race({ racialTraits: [{}, { definition: { name: "noid" } }, null] }), race()],
      new Map(),
    );
    expect(r.map((e) => e.id)).toEqual([1]);
  });

  it("skips broken optional collections but keeps the valid parts", () => {
    const cases: [unknown, number[]][] = [
      ["nope", [1]],
      [{ definitionData: "x" }, [1]],
      [{ definitionData: [null, { id: "x", name: "bad" }, { id: 2, name: "Good" }], accessTypes: null }, [1, 2]],
    ];
    cases.forEach(([coll, ids], i) => {
      const r = buildRacialTraits([race({ entityRaceId: 100 + i })], new Map([[`9:${100 + i}`, coll as OptionalCollection]]));
      expect(r.map((e) => e.id)).toEqual(ids);
      expect(r.every((e) => e.raceKey === `9:${100 + i}` && !e.locked)).toBe(true);
    });
  });

  it("matches raceName on baseRaceName when the subrace name lacks it", () => {
    const drow = race({
      entityRaceId: 50, fullName: "Drow", baseRaceName: "Elf", isSubRace: true,
      racialTraits: [{ definition: { id: 77, name: "Sunlight Sensitivity", snippet: "s" } }],
    });
    const r = filterRacialTraits(buildRacialTraits([drow, race()], new Map()), { raceName: "elf" });
    expect(r.map((e) => e.id)).toEqual([77]);
  });

  it("takes an optional trait's race data from the race it is listed under", () => {
    const hb = race({
      entityRaceId: 976786, entityRaceTypeId: 1228963568, fullName: "Tiefling", baseRaceName: "Tiefling",
      isSubRace: true, isHomebrew: true, racialTraits: [],
    });
    const opt = new Map<string, OptionalCollection>([
      ["1228963568:976786", { definitionData: [{ id: 5, name: "Infernal Gift", snippet: "Gift" }], accessTypes: {} }],
    ]);
    const [e] = buildRacialTraits([hb], opt);
    expect(e).toMatchObject({
      kind: "optional", speciesName: "Tiefling", baseRaceName: "Tiefling",
      isSubRace: true, isHomebrew: true, raceKey: "1228963568:976786",
    });
    expect(formatRacialTraitLine(e)).toBe(
      "<untrusted_dndbeyond_content>\n- **Infernal Gift** *(Tiefling — subrace of Tiefling, Homebrew)* *(optional)* — Gift\n</untrusted_dndbeyond_content>",
    );
  });

  it("ignores an optional collection whose race is not in the call", () => {
    const opt = new Map<string, OptionalCollection>([["8:8", { definitionData: [{ id: 2, name: "Orphan" }], accessTypes: {} }]]);
    expect(buildRacialTraits([race()], opt).map((e) => e.id)).toEqual([1]);
  });

  it("keeps the first of duplicate standard ids within one race", () => {
    const r = buildRacialTraits(
      [race({ racialTraits: [
        { definition: { id: 1, name: "First", snippet: "a" } },
        { definition: { id: 1, name: "Second", snippet: "b" } },
      ] })],
      new Map(),
    );
    expect(r.map((e) => e.name)).toEqual(["First"]);
  });
});
