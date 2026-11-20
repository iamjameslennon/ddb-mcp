/**
 * Carry-over (bm): the granting-entity and visibility code moved out of
 * actions.ts into granting.ts, the duplicated slug helpers folded into
 * helpers.slugOf, and the levelSpellSlots row read into slots.levelSlotRow.
 * These tests pin the shared helpers' behaviour and keep src/ free of
 * value-import cycles (the move removed actions.ts ↔ weapons.ts; the two
 * older ones, edition.ts ↔ name-match.ts and tools/character.ts ↔
 * character/definition.ts, went on 2026-11-20, "Ready carry-overs 2026-11-20").
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { slugOf } from "../src/tools/character/helpers.js";
import { levelSlotRow } from "../src/tools/character/slots.js";
import { SKILLS } from "../src/tools/character/stats.js";
import type { ClassEntry } from "../src/tools/character/types.js";

const CHARACTER = fileURLToPath(new URL("../src/tools/character", import.meta.url));
const SRC = fileURLToPath(new URL("../src", import.meta.url));

describe("slugOf", () => {
  it("lowercases and joins runs of other characters with one dash, trimmed at both ends", () => {
    expect(slugOf("Fire Bolt")).toBe("fire-bolt");
    expect(slugOf("Crossbow, Heavy")).toBe("crossbow-heavy");
    expect(slugOf("  -Magical  Sleep- ")).toBe("magical-sleep");
    expect(slugOf("")).toBe("");
  });

  it("keeps an apostrophe as a separator by default (spell and defense names)", () => {
    expect(slugOf("Tasha's Hideous Laughter")).toBe("tasha-s-hideous-laughter");
  });

  it("drops ' and ’ first with dropApostrophes (proficiency, language and skill names)", () => {
    expect(slugOf("Thieves' Tools", true)).toBe("thieves-tools");
    expect(slugOf("Navigator’s Tools", true)).toBe("navigators-tools");
    expect(slugOf("Sleight of Hand", true)).toBe("sleight-of-hand");
  });

  it("matches the skill formula it replaced for every skill in stats.ts", () => {
    expect(SKILLS.length).toBeGreaterThan(0);
    for (const [s] of SKILLS) expect(slugOf(s, true)).toBe(s.toLowerCase().replace(/ /g, "-").replace(/'/g, ""));
  });
});

describe("levelSlotRow", () => {
  const cls = (levelSpellSlots: unknown, level: unknown): ClassEntry =>
    ({ level, definition: { spellRules: { levelSpellSlots } } }) as unknown as ClassEntry;

  it("returns the row at the class level", () => {
    expect(levelSlotRow(cls([[0], [2, 0], [3, 1]], 2))).toEqual([3, 1]);
  });

  it("returns [] for a missing table, a missing row or a non-array row", () => {
    expect(levelSlotRow(cls(undefined, 1))).toEqual([]);
    expect(levelSlotRow(cls([[0]], 5))).toEqual([]);
    expect(levelSlotRow(cls([[0], { 0: 2 }], 1))).toEqual([]);
    expect(levelSlotRow({} as ClassEntry)).toEqual([]);
  });
});

/**
 * The relative specifiers a source file imports or re-exports as values:
 * `import … from`, `export … from` and side-effect `import "…"`, at a line
 * start or after a `;` (two statements on one line). Type-only
 * ones (`import type`, `export type`) are erased, so they can't form a
 * runtime cycle. Bare specifiers (packages) are not returned.
 */
function valueImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:^|;)[ \t]*(?:import|export)\s+(type\s+)?(?:[^;"]*?\sfrom\s+)?"(\.[^"]+)"/gm)) {
    if (!m[1]) out.push(m[2]!);
  }
  return out;
}

describe("valueImports (the cycle check's parser)", () => {
  it("finds value imports, re-exports and side-effect imports, multi-line ones included", () => {
    const src = [
      'import { a } from "./a.js";',
      'import {\n  b,\n  type B,\n} from "../b.js";',
      'import "./side.js";',
      'export { c } from "./c.js";',
      'export * from "./d.js";',
      'import { e } from "vitest";',
      'import { f } from "./f.js"; import "./g.js";',
    ].join("\n");
    expect(valueImports(src)).toEqual(["./a.js", "../b.js", "./side.js", "./c.js", "./d.js", "./f.js", "./g.js"]);
  });

  it("skips type-only imports and re-exports", () => {
    expect(valueImports('import type { T } from "./t.js";\nexport type { U } from "./u.js";')).toEqual([]);
  });
});

describe("module boundaries", () => {
  /** Value-import edges from each .ts file under `root` (a relative import leaving it is listed but never walked). */
  function importGraph(root = CHARACTER): Map<string, string[]> {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith(".ts")) files.push(join(dir, e.name));
      }
    };
    walk(root);
    return new Map(files.map(f => [
      f,
      valueImports(readFileSync(f, "utf8")).map(spec => resolve(dirname(f), spec.replace(/\.js$/, ".ts"))),
    ]));
  }

  /** Every value-import cycle under `root`, as "a.ts -> b.ts -> a.ts" paths relative to it. */
  function cyclesUnder(root: string): string[] {
    const graph = importGraph(root);
    const done = new Set<string>();
    const path: string[] = [];
    const cycles: string[] = [];
    const visit = (f: string): void => {
      if (path.includes(f)) {
        cycles.push([...path.slice(path.indexOf(f)), f].map(p => relative(root, p)).join(" -> "));
        return;
      }
      if (done.has(f) || !graph.has(f)) return;
      path.push(f);
      for (const d of graph.get(f)!) visit(d);
      path.pop();
      done.add(f);
    };
    for (const f of graph.keys()) visit(f);
    return cycles;
  }

  it("has no value-import cycle in src/tools/character/", () => {
    expect(cyclesUnder(CHARACTER)).toEqual([]);
  });

  it("has no value-import cycle anywhere in src/", () => {
    expect(cyclesUnder(SRC)).toEqual([]);
  });

  it("sees the src/ graph: name-match.ts imports nothing relative; definition.ts imports character.ts, not the reverse", () => {
    const graph = importGraph(SRC);
    const deps = (f: string) => (graph.get(join(SRC, f)) ?? []).map(p => relative(SRC, p));
    expect(deps("name-match.ts")).toEqual([]);
    expect(deps("edition.ts")).toContain("name-match.ts");
    expect(deps("tools/character/definition.ts")).toContain("tools/character.ts");
    expect(deps("tools/character.ts")).not.toContain("tools/character/definition.ts");
  });

  it("sees the graph: actions.ts imports granting.ts and weapons.ts, weapons.ts doesn't import actions.ts", () => {
    const graph = importGraph();
    const deps = (f: string) => (graph.get(join(CHARACTER, f)) ?? []).map(p => relative(CHARACTER, p));
    expect(deps("actions.ts")).toEqual(expect.arrayContaining(["granting.ts", "weapons.ts"]));
    expect(deps("weapons.ts")).toContain("granting.ts");
    expect(deps("weapons.ts")).not.toContain("actions.ts");
  });
});
