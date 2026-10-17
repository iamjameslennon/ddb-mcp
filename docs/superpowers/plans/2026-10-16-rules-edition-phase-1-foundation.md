# Rules Edition — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure edition module (classification, twin selection, every label string), the game-config/source-index module with an offline snapshot, the rename table and its generator script — with **no change to any tool's output**.

**Architecture:** `src/edition.ts` is pure and stateless. It classifies a D&D Beyond definition into a ruleset from its `isHomebrew`/`isLegacy`/source markers, using a source index the caller passes in. It also groups 2014/2024 twins and picks one, and it owns every user-facing edition string. `src/game-config.ts` takes over `getGameConfig()` (and its session-invalidation hook) from `src/tools/monster.ts`, and adds `getSourceIndex()`, which merges the live config's source list over a generated snapshot (`src/source-snapshot.ts`). `scripts/dump-edition-renames.mts` regenerates that snapshot and proposes 2014→2024 rename pairs for `src/edition-renames.ts`.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Node ≥22, `tsx` for scripts.

**Spec:** [docs/superpowers/specs/2026-10-16-rules-edition-design.md](../specs/2026-10-16-rules-edition-design.md). Read its **Principle**, **Vocabulary and labels**, and **The edition module** sections before starting. Where this plan and the spec disagree on a *signature*, this plan wins (the spec allows phase 1 to change signatures). Where they disagree on *behaviour or wording*, the spec wins. Stop and ask.

**Scope:** Phase 1 only. Phases 2–5 each get their own plan, written after this one lands, against the real `src/edition.ts`.

## Global Constraints

- **No tool behaviour changes.** No file under `src/tools/` changes except `src/tools/monster.ts`, and that change only moves `getGameConfig` out. No change to `src/index.ts`, and no `rules_edition` param yet.
- **Label wording lives only in `src/edition.ts`.** Every string is pinned by an exact-match test in `tests/edition.test.ts`.
- **`src/edition.ts` imports only `./utils.js` and `./edition-renames.js`.** It must never import a tool module, `session-fetch`, `session-state`, `game-config`, or `source-snapshot`, and it never fetches.
- **`src/game-config.ts` keeps `getGameConfig()`'s boundary behaviour exactly:** `captureSession()` before the early cache return, and `assertSessionCurrent(snapshot)` before caching. It registers its own `onSessionInvalidated` hook, which clears both the config and the index caches.
- **Unknown categories classify `unstated`, never `third-party`.**
- **No new dependencies, no persisted caches.** `@types/node` stays `^22`. Do not touch `package.json` / `package-lock.json`.
- **Param name, when later phases add it:** `rules_edition: "2024" | "2014"`, default `"2024"`. Phase 1 only exports the `RulesEdition` type.
- Before every commit: `npm run typecheck && npm run lint && npm test` all green. One commit per task, straight to `main` (owner's standing preference; do not push unless asked). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These inputs are implied by the spec but easy to miss. Each one has its test in the task that owns the code:

1. **Book names with HTML entities, curly apostrophes and missing years.** The live config has `"D&amp;D Beyond Basic Rules"`, `"Player’s Handbook"` (2024, no year) and `"Player’s Handbook (2014)"`. Labels must read `D&D Beyond Basic Rules` and `Player's Handbook (2024)`, with a straight apostrophe and a year only where a namesake exists in the other edition. Owned by Task 1.
2. **Malformed markers:** `sources: null`, `sourceId: null`, a `sources[]` element with a null `sourceId`, and duplicate IDs across `sourceId`/`sources[]` must classify without throwing and never duplicate a book. Owned by Task 1.
3. **A partially usable live config:** no `sources` key, or a live source without `sourceCategoryId`. The snapshot must fill the gaps, and a failed fetch must never be cached as the index. Owned by Task 5.
4. **Messy name queries:** stray whitespace and curly apostrophes must match, and an empty or whitespace-only query must return `null` rather than matching every name. Owned by Task 2.
5. **Rename-table growth:** a chained pair (A→B plus B→C), a duplicated 2014 name, or a self-map must fail a test before it silently merges unrelated groups. Owned by Task 2.

## Signatures that differ from the spec's sketch

Phase-2+ planners: these are the real phase-1 interfaces.

| Spec sketch | Phase 1 |
|---|---|
| `SourceIndex` (opaque) | `{ sources: ReadonlyMap<number, IndexedSource>; categories: ReadonlyMap<number, string> }`, built by `buildSourceIndex(sources, categories)` |
| `groupAndSelect(all, requested, info, twinKey, tiebreak)` | `groupAndSelect(all, requested, { info, twinKey, tiebreak, nameMatches?, passes? })`, which runs pipeline steps 1–5 itself |
| `selected: Array<{ entry, reason?, group }>` | `SearchSelection<T>` is `{ entry, reason?, info }`, with no `group`. Add it in phase 2 if `ddb_search_site` or the monster `source` path needs it |
| "gather algorithm" (prose) | `lookupByName(all, query, requested, { name, info, tiebreak, partialMatch?, twinName? })`, which returns the selection plus `renamed?: { name2014, name2024 }` |
| `sourceNote(...): string` | returns `string \| null` (`null` when the book's edition equals the request) |
| `rulesLine(info, { reason, open5e })` | the same, with the types exported as `RulesLineReason` / `Open5eOrigin` |
| `characterRulesLine(input: CharacterEditionSummary)` | `characterRulesLine(entries: CharacterEditionEntry[])`, plus `characterMainEdition(entries)` and `characterTag(info, main)` |
| (tiebreaks, prose) | `definitionTiebreak`, `dedupeById`, `monsterTiebreak(index)` |
| twin keys (table) | `twinName`, `normalizeName`, `createTwinNamer(pairs)`, `classFeatureTwinKey`, `racialTraitTwinKey` |

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/edition.ts` | Create (Tasks 1–3) | Types, category table, source index, classification (T1); twin names, tiebreaks, selection, lookup, search grouping (T2); all label strings (T3) |
| `src/edition-renames.ts` | Create (T1, empty), fill (T6) | `EDITION_RENAMES`: verified `[name2014, name2024]` pairs with evidence comments |
| `scripts/dump-edition-renames.mts` | Create (T4) | Regenerate `src/source-snapshot.ts`, report unplaced categories, propose rename pairs |
| `src/source-snapshot.ts` | Generated (T4, refreshed T6) | `SNAPSHOT_DATE`, `SNAPSHOT_CATEGORIES`, `SNAPSHOT_SOURCES` |
| `src/game-config.ts` | Create (T5) | `getGameConfig()` (moved), its types and invalidation hook; `getSourceIndex()` |
| `src/tools/monster.ts` | Modify (T5) | Import `getGameConfig`/types from `../game-config.js`; drop the moved code |
| `tests/edition.test.ts` | Create (T1), extend (T2–T4) | Unit tests for everything in `edition.ts` plus a snapshot sanity check |
| `tests/game-config.test.ts` | Create (T5) | Snapshot fallback, merge, invalidation, no caching of failures |
| `tests/monster.test.ts` | Modify (T5) | Run every registered invalidation hook, not just `mock.calls[0]` |
| `CLAUDE.md` | Modify (T4, T5, T6) | Refresh note, module table, caching layers, Next steps |

---

### Task 1: Ruleset types, category table, source index, classification

**Files:**
- Create: `src/edition.ts`
- Create: `src/edition-renames.ts`
- Test: `tests/edition.test.ts`

**Interfaces:**
- Consumes: `stripHtml(s: string | null | undefined): string` from `src/utils.ts`.
- Produces:
  - `type RulesEdition = "2024" | "2014"`
  - `type Ruleset = RulesEdition | "third-party" | "homebrew" | "playtest" | "unstated"`
  - `interface EditionInfo { ruleset: Ruleset; book: string | null }`
  - `type EditionReason = "no-2024-version" | "no-2014-version"`
  - `interface SourceRecord { id: number; name: string; description: string | null; sourceURL: string | null; sourceCategoryId: number | null }`
  - `interface CategoryRecord { id: number; name: string }`
  - `interface IndexedSource { categoryId: number | null; name: string; description: string | null; sourceURL: string | null; book: string }`
  - `interface SourceIndex { sources: ReadonlyMap<number, IndexedSource>; categories: ReadonlyMap<number, string> }`
  - `interface EditionMarkers { isHomebrew?: boolean | null; isLegacy?: boolean | null; sourceId?: number | null; sources?: ReadonlyArray<{ sourceId?: number | null }> | null }`
  - `const KNOWN_CATEGORY_IDS: ReadonlySet<number>`
  - `categoryRuleset(categoryId: number | null | undefined): Ruleset`
  - `isEdition(r: Ruleset): r is RulesEdition`
  - `buildSourceIndex(sources: readonly SourceRecord[], categories: readonly CategoryRecord[]): SourceIndex`
  - `classifyEdition(entry: EditionMarkers, index: SourceIndex): EditionInfo`
  - `EDITION_RENAMES: ReadonlyArray<readonly [name2014: string, name2024: string]>`, empty for now, from `src/edition-renames.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/edition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildSourceIndex, categoryRuleset, classifyEdition, KNOWN_CATEGORY_IDS,
  type CategoryRecord, type EditionMarkers, type SourceRecord,
} from "../src/edition.js";

// ── Fixture source index ──────────────────────────────────────────────────────
// Real IDs, names and categories from the live game config (2026-10-16), except
// 800–804, which are invented to cover an unstated category, an unknown
// category, missing descriptions and a missing category.

const SOURCES: SourceRecord[] = [
  { id: 1, name: "BR", description: "Basic Rules (2014)", sourceURL: "sources/dnd/basic-rules-2014", sourceCategoryId: 26 },
  { id: 2, name: "PHB", description: "Player’s Handbook (2014)", sourceURL: "sources/dnd/phb-2014", sourceCategoryId: 26 },
  { id: 3, name: "DMG", description: "Dungeon Master’s Guide (2014)", sourceURL: "sources/dnd/dmg-2014", sourceCategoryId: 26 },
  { id: 5, name: "MM", description: "Monster Manual (2014)", sourceURL: "sources/dnd/mm-2014", sourceCategoryId: 26 },
  { id: 6, name: "CoS", description: "Curse of Strahd", sourceURL: "sources/dnd/cos", sourceCategoryId: 1 },
  { id: 15, name: "VGtM", description: "Volo's Guide to Monsters", sourceURL: "sources/dnd/vgtm", sourceCategoryId: 23 },
  { id: 27, name: "XGtE", description: "Xanathar's Guide to Everything", sourceURL: "sources/dnd/xgte", sourceCategoryId: 1 },
  { id: 31, name: "CR", description: "Critical Role", sourceURL: "sources/dnd/cr", sourceCategoryId: 2 },
  { id: 100, name: "UA", description: "Unearthed Arcana", sourceURL: "sources/dnd/ua", sourceCategoryId: 3 },
  { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
  { id: 146, name: "DMG-2024", description: "Dungeon Master&#8217;s Guide", sourceURL: "sources/dnd/dmg-2024", sourceCategoryId: 24 },
  { id: 147, name: "MM-2024", description: "Monster Manual", sourceURL: "sources/dnd/mm-2024", sourceCategoryId: 24 },
  { id: 148, name: "br-2024", description: "D&amp;D Beyond Basic Rules", sourceURL: "sources/dnd/br-2024", sourceCategoryId: 24 },
  { id: 193, name: "TCMP1", description: "The Crooked Moon Part One: Player Options &amp; Campaign Setting", sourceURL: "sources/dnd/tcmp1", sourceCategoryId: 34 },
  { id: 205, name: "FRHoF", description: "Forgotten Realms: Heroes of Faerûn", sourceURL: "sources/dnd/frhof", sourceCategoryId: 38 },
  { id: 800, name: "EB", description: "Eberron: Rising from the Last War", sourceURL: "sources/dnd/erlw", sourceCategoryId: 8 },
  { id: 801, name: "NEW", description: "Brand New Book", sourceURL: null, sourceCategoryId: 99 },
  { id: 802, name: "NoDesc-2024", description: null, sourceURL: null, sourceCategoryId: 24 },
  { id: 803, name: "NoCat", description: "Uncategorised Book", sourceURL: null, sourceCategoryId: null },
  { id: 804, name: "NoDesc-EB", description: null, sourceURL: null, sourceCategoryId: 8 },
];

const CATEGORIES: CategoryRecord[] = [
  { id: 1, name: "5e Expanded Rules" },
  { id: 2, name: "Critical Role" },
  { id: 3, name: "Playtest" },
  { id: 8, name: "Eberron" },
  { id: 23, name: "Legacy/Noncore" },
  { id: 24, name: "5.5e Core Rules" },
  { id: 26, name: "5e Core Rules" },
  { id: 34, name: "Avantris Entertainment" },
  { id: 38, name: "5.5e Expanded Rules" },
];

const INDEX = buildSourceIndex(SOURCES, CATEGORIES);
const classify = (entry: EditionMarkers) => classifyEdition(entry, INDEX);
const from = (...ids: number[]) => ids.map(sourceId => ({ sourceId }));

// ── Category table (spec: "Category table") ──────────────────────────────────

const CATEGORY_TABLE: Record<string, number[]> = {
  "2024": [24, 38],
  "2014": [26, 1, 23],
  playtest: [3],
  "third-party": [2, 18, 19, 20, 21, 22, 25, 27, 29, 30, 31, 32, 33, 34, 36, 37, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 52],
  unstated: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 28, 35, 46],
};

describe("categoryRuleset", () => {
  const rows = Object.entries(CATEGORY_TABLE).flatMap(([ruleset, ids]) => ids.map(id => [id, ruleset] as const));
  it.each(rows)("category %i → %s", (id, ruleset) => {
    expect(categoryRuleset(id)).toBe(ruleset);
  });

  it("treats a category the table doesn't list as unstated, never third-party", () => {
    expect(categoryRuleset(99)).toBe("unstated");
    expect(categoryRuleset(4)).toBe("unstated");
    expect(categoryRuleset(null)).toBe("unstated");
    expect(categoryRuleset(undefined)).toBe("unstated");
  });

  it("KNOWN_CATEGORY_IDS is exactly the table", () => {
    expect([...KNOWN_CATEGORY_IDS].sort((a, b) => a - b))
      .toEqual(Object.values(CATEGORY_TABLE).flat().sort((a, b) => a - b));
  });
});

// ── Source index book names (spec: "The book name") ──────────────────────────

describe("buildSourceIndex", () => {
  const book = (id: number) => INDEX.sources.get(id)?.book;

  it("decodes entities and folds curly apostrophes", () => {
    expect(book(148)).toBe("D&D Beyond Basic Rules");
    expect(book(193)).toBe("The Crooked Moon Part One: Player Options & Campaign Setting");
    expect(book(27)).toBe("Xanathar's Guide to Everything");
  });

  it("appends its own year only when the other edition has a same-described book", () => {
    expect(book(145)).toBe("Player's Handbook (2024)");
    expect(book(146)).toBe("Dungeon Master's Guide (2024)");
    expect(book(147)).toBe("Monster Manual (2024)");
    expect(book(2)).toBe("Player's Handbook (2014)");
    expect(book(205)).toBe("Forgotten Realms: Heroes of Faerûn");
  });

  it("falls back to the short name when there is no description", () => {
    expect(book(802)).toBe("NoDesc-2024");
    // Rule 3 labels with "the first such source", so a description-less 2024 book still shows its short name.
    expect(classify({ sources: from(802) })).toEqual({ ruleset: "2024", book: "NoDesc-2024" });
  });

  it("keeps the raw fields and the category list", () => {
    expect(INDEX.sources.get(145)).toEqual({
      categoryId: 24, name: "PHB-2024", description: "Player’s Handbook",
      sourceURL: "sources/dnd/phb-2024", book: "Player's Handbook (2024)",
    });
    expect(INDEX.sources.get(803)?.categoryId).toBeNull();
    expect(INDEX.categories.get(24)).toBe("5.5e Core Rules");
  });
});

// ── Classification (spec: "Classification (classifyEdition)") ───────────────

describe("classifyEdition", () => {
  it("rule 1: homebrew wins over everything, with no book", () => {
    expect(classify({ isHomebrew: true, isLegacy: true, sources: from(145) })).toEqual({ ruleset: "homebrew", book: null });
  });

  it("rule 2: Legacy is 2014 even with a 2024 reprint attached; book is the first 2014-category source", () => {
    expect(classify({ isLegacy: true, sources: from(145, 2) })).toEqual({ ruleset: "2014", book: "Player's Handbook (2014)" });
  });

  it("rule 2: Legacy with no 2014-category source takes the first source with a known description, else null", () => {
    expect(classify({ isLegacy: true, sources: from(12345, 31) })).toEqual({ ruleset: "2014", book: "Critical Role" });
    expect(classify({ isLegacy: true, sources: from(802, 31) })).toEqual({ ruleset: "2014", book: "Critical Role" });
    expect(classify({ isLegacy: true, sources: from(802) })).toEqual({ ruleset: "2014", book: null });
    expect(classify({ isLegacy: true, sources: from(12345) })).toEqual({ ruleset: "2014", book: null });
    expect(classify({ isLegacy: true })).toEqual({ ruleset: "2014", book: null });
  });

  it("rule 3: any 2024-category source makes a non-Legacy definition 2024 (Studded Leather)", () => {
    expect(classify({ isLegacy: false, sources: from(148, 1) })).toEqual({ ruleset: "2024", book: "D&D Beyond Basic Rules" });
  });

  it("rule 3 beats rule 4 whatever the order, and sourceId counts as a source", () => {
    expect(classify({ sourceId: 5, sources: from(147) })).toEqual({ ruleset: "2024", book: "Monster Manual (2024)" });
    expect(classify({ sourceId: 147, sources: [] })).toEqual({ ruleset: "2024", book: "Monster Manual (2024)" });
    expect(classify({ sources: from(205) })).toEqual({ ruleset: "2024", book: "Forgotten Realms: Heroes of Faerûn" });
  });

  it("rule 4: 2014 categories — core, expanded and Legacy/Noncore", () => {
    expect(classify({ sources: from(1) })).toEqual({ ruleset: "2014", book: "Basic Rules (2014)" });
    expect(classify({ isLegacy: false, sources: from(27) })).toEqual({ ruleset: "2014", book: "Xanathar's Guide to Everything" });
    expect(classify({ sources: from(15) })).toEqual({ ruleset: "2014", book: "Volo's Guide to Monsters" });
  });

  it("rule 5: playtest beats third-party", () => {
    expect(classify({ sources: from(100) })).toEqual({ ruleset: "playtest", book: "Unearthed Arcana" });
    expect(classify({ sources: from(31, 100) })).toEqual({ ruleset: "playtest", book: "Unearthed Arcana" });
  });

  it("rule 6: third-party publishers", () => {
    expect(classify({ sources: from(193) })).toEqual({
      ruleset: "third-party", book: "The Crooked Moon Part One: Player Options & Campaign Setting",
    });
    expect(classify({ sources: from(31) })).toEqual({ ruleset: "third-party", book: "Critical Role" });
  });

  it("rule 7: unstated categories, unknown categories, unknown IDs, no sources", () => {
    expect(classify({ sources: from(800) })).toEqual({ ruleset: "unstated", book: "Eberron: Rising from the Last War" });
    expect(classify({ sources: from(801) })).toEqual({ ruleset: "unstated", book: "Brand New Book" });
    expect(classify({ sources: from(803) })).toEqual({ ruleset: "unstated", book: "Uncategorised Book" });
    expect(classify({ sources: from(12345) })).toEqual({ ruleset: "unstated", book: null });
    expect(classify({ sources: from(804) })).toEqual({ ruleset: "unstated", book: null });
    expect(classify({ sources: from(804, 800) })).toEqual({ ruleset: "unstated", book: "Eberron: Rising from the Last War" });
    expect(classify({})).toEqual({ ruleset: "unstated", book: null });
  });

  it("tolerates null markers and null source IDs without duplicating books", () => {
    expect(classify({ isHomebrew: null, isLegacy: null, sourceId: null, sources: null })).toEqual({ ruleset: "unstated", book: null });
    expect(classify({ sources: [{ sourceId: null }, { sourceId: 2 }] })).toEqual({ ruleset: "2014", book: "Player's Handbook (2014)" });
    expect(classify({ sourceId: 800, sources: from(800, 800) })).toEqual({ ruleset: "unstated", book: "Eberron: Rising from the Last War" });
  });

  it("verified live source IDs (spec: named cases)", () => {
    expect(classify({ sources: from(1) }).ruleset).toBe("2014");          // BR
    expect(classify({ sources: from(145) }).ruleset).toBe("2024");        // PHB-2024
    expect(classify({ sources: from(148, 1) }).ruleset).toBe("2024");     // br-2024 + BR
    expect(classify({ sources: from(193) }).ruleset).toBe("third-party"); // TCMP1
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/edition.test.ts`
Expected: FAIL, with `Failed to resolve import "../src/edition.js"` (or `Cannot find module`).

- [ ] **Step 3: Create the empty rename table**

Create `src/edition-renames.ts`:

```ts
/**
 * 2014 → 2024 name changes, for content D&D Beyond reissued under a new name
 * (the spec's unverified example: the 2014 Basic Rules' "Acid Arrow" and the
 * 2024 "Melf's Acid Arrow"). `twinName()` in edition.ts maps each 2014 name to
 * its 2024 name so both land in one twin group. The 2024 side is canonical.
 *
 * Only pairs verified by reading both descriptions belong here: same thing,
 * same level/rarity/CR, text clearly a revision. Each pair carries its evidence
 * in a comment. Propose candidates with `npx tsx scripts/dump-edition-renames.mts`
 * (needs ddb_login). tests/edition.test.ts rejects chains, duplicates and
 * self-maps.
 */
export const EDITION_RENAMES: ReadonlyArray<readonly [name2014: string, name2024: string]> = [
];
```

- [ ] **Step 4: Write `src/edition.ts` (part 1)**

Create `src/edition.ts`:

```ts
/**
 * edition.ts — which ruleset a piece of D&D Beyond content belongs to (2024,
 * 2014, third-party, homebrew, playtest, or unstated), how to choose between
 * 2014/2024 twins, and every user-facing edition label.
 *
 * Pure and stateless: never fetches, never imports a tool module. Callers pass
 * the source index in (see game-config.ts → getSourceIndex). No tool builds its
 * own edition text; every string comes from here, pinned by
 * tests/edition.test.ts. Design: docs/superpowers/specs/2026-10-16-rules-edition-design.md.
 */

import { stripHtml } from "./utils.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RulesEdition = "2024" | "2014";
export type Ruleset = RulesEdition | "third-party" | "homebrew" | "playtest" | "unstated";
export interface EditionInfo { ruleset: Ruleset; book: string | null }
export type EditionReason = "no-2024-version" | "no-2014-version";

/** A game-config source in its raw (fetched or snapshotted) shape. */
export interface SourceRecord {
  id: number;
  name: string;
  description: string | null;
  sourceURL: string | null;
  sourceCategoryId: number | null;
}

export interface CategoryRecord { id: number; name: string }

/** A source as classification sees it: the raw fields plus its display name. */
export interface IndexedSource {
  categoryId: number | null;
  name: string;
  description: string | null;
  sourceURL: string | null;
  /** Label text, e.g. "Player's Handbook (2024)". */
  book: string;
}

export interface SourceIndex {
  sources: ReadonlyMap<number, IndexedSource>;
  /** Category ID → name, HTML stripped. */
  categories: ReadonlyMap<number, string>;
}

/** The edition markers a D&D Beyond definition may carry. Every field is optional. */
export interface EditionMarkers {
  isHomebrew?: boolean | null;
  isLegacy?: boolean | null;
  sourceId?: number | null;
  sources?: ReadonlyArray<{ sourceId?: number | null }> | null;
}

export function isEdition(r: Ruleset): r is RulesEdition {
  return r === "2024" || r === "2014";
}

// ── Category table ────────────────────────────────────────────────────────────
// D&D Beyond sourceCategoryId → ruleset, live 2026-10-16. A category missing
// from this table is "unstated": we never claim content isn't WotC's without
// knowing. scripts/dump-edition-renames.mts reports categories to place here.

const CATEGORY_TABLE: ReadonlyArray<readonly [Ruleset, readonly number[]]> = [
  ["2024", [24, 38]],                // 5.5e Core Rules, 5.5e Expanded Rules
  ["2014", [26, 1, 23]],             // 5e Core Rules, 5e Expanded Rules, Legacy/Noncore
  ["playtest", [3]],                 // Playtest (Unearthed Arcana)
  ["third-party", [2, 18, 19, 20, 21, 22, 25, 27, 29, 30, 31, 32, 33, 34, 36, 37, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 50, 51, 52]],
  // D&D Beyond, Magic: The Gathering, Eberron, Archived, Rick and Morty,
  // Runeterra, Noncore D&D, Adventurers League, Dragonlance, Minecraft, Hidden
  // Sources, Planescape, Internal, Core Rules, D&D Beyond Drops.
  ["unstated", [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 28, 35, 46]],
];

const CATEGORY_RULESET = new Map<number, Ruleset>(
  CATEGORY_TABLE.flatMap(([ruleset, ids]) => ids.map(id => [id, ruleset] as const)),
);

/** Every category ID the table places, including those it places as "unstated". */
export const KNOWN_CATEGORY_IDS: ReadonlySet<number> = new Set(CATEGORY_RULESET.keys());

export function categoryRuleset(categoryId: number | null | undefined): Ruleset {
  return (categoryId != null ? CATEGORY_RULESET.get(categoryId) : undefined) ?? "unstated";
}

// ── Source index ──────────────────────────────────────────────────────────────

const YEAR_SUFFIX = /\s*\(\d{4}\)\s*$/;

/** HTML entities decoded, curly apostrophes folded to "'", whitespace collapsed. */
function decodeBookName(s: string | null): string {
  return stripHtml(s).replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/**
 * Index sources by ID with their label text. A book's label is its decoded
 * description (else its short name). When the description has no year but a
 * same-described book exists in the other edition's categories, its own
 * category's year is appended: "Player's Handbook" → "Player's Handbook (2024)".
 */
export function buildSourceIndex(sources: readonly SourceRecord[], categories: readonly CategoryRecord[]): SourceIndex {
  const decoded = sources.map(s => ({
    s,
    book: decodeBookName(s.description) || decodeBookName(s.name),
    ruleset: categoryRuleset(s.sourceCategoryId),
  }));
  const stem = (book: string) => book.replace(YEAR_SUFFIX, "").toLowerCase();
  const index = new Map<number, IndexedSource>();
  for (const { s, book, ruleset } of decoded) {
    let label = book;
    if (isEdition(ruleset) && !YEAR_SUFFIX.test(book)) {
      const other: RulesEdition = ruleset === "2024" ? "2014" : "2024";
      if (decoded.some(d => d.ruleset === other && stem(d.book) === stem(book))) label = `${book} (${ruleset})`;
    }
    index.set(s.id, {
      categoryId: s.sourceCategoryId ?? null,
      name: s.name,
      description: s.description,
      sourceURL: s.sourceURL,
      book: label,
    });
  }
  return {
    sources: index,
    categories: new Map(categories.map(c => [c.id, decodeBookName(c.name)])),
  };
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classify one definition. The first matching rule wins:
 * 1. isHomebrew → homebrew (no book)
 * 2. isLegacy → 2014 (book: first 2014-category source, else first source with a known description)
 * 3. any 2024-category source → 2024
 * 4. any 2014-category source → 2014
 * 5. any playtest-category source → playtest
 * 6. any third-party-category source → third-party
 * 7. otherwise → unstated (book: first source with a known description, else null)
 *
 * Reprint policy: D&D Beyond makes a new definition when 2024 changes an entry
 * and marks the old one Legacy; it attaches a 2024 book to an existing
 * definition only when the text is valid for both editions (Studded Leather).
 * So a non-Legacy definition with any 2024 source is current 2024 text, and
 * isLegacy always wins.
 */
export function classifyEdition(entry: EditionMarkers, index: SourceIndex): EditionInfo {
  if (entry.isHomebrew === true) return { ruleset: "homebrew", book: null };

  const ids: number[] = [];
  for (const id of [entry.sourceId, ...(entry.sources ?? []).map(s => s.sourceId)]) {
    if (typeof id === "number" && !ids.includes(id)) ids.push(id);
  }
  const known = ids
    .map(id => index.sources.get(id))
    .filter((s): s is IndexedSource => s !== undefined);
  const firstIn = (ruleset: Ruleset) => known.find(s => categoryRuleset(s.categoryId) === ruleset);
  const firstDescribed = () => known.find(s => s.description != null && s.description.trim() !== "")?.book ?? null;

  if (entry.isLegacy === true) {
    return { ruleset: "2014", book: firstIn("2014")?.book ?? firstDescribed() };
  }
  for (const ruleset of ["2024", "2014", "playtest", "third-party"] as const) {
    const s = firstIn(ruleset);
    if (s) return { ruleset, book: s.book };
  }
  return { ruleset: "unstated", book: firstDescribed() };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/edition.test.ts`
Expected: PASS (every test in the file).

- [ ] **Step 6: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/edition.ts src/edition-renames.ts tests/edition.test.ts
git commit -m "feat(edition): classify D&D Beyond content by ruleset

Adds src/edition.ts (category table, source index with book labels,
classifyEdition) and an empty rename table. No tool output changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Twin names, tiebreaks, selection, lookup and search grouping

**Files:**
- Modify: `src/edition.ts` (add an import and append sections)
- Test: `tests/edition.test.ts` (replace the import block, then append)

**Interfaces:**
- Consumes (Task 1): `RulesEdition`, `Ruleset`, `EditionInfo`, `EditionReason`, `SourceIndex`, `isEdition`, and `EDITION_RENAMES` from `src/edition-renames.ts`.
- Produces:
  - `normalizeName(name: string): string`: lowercase, `‘’`→`'`, collapse whitespace, trim
  - `createTwinNamer(pairs: ReadonlyArray<readonly [string, string]>): (name: string) => string`
  - `twinName(name: string): string`: `createTwinNamer(EDITION_RENAMES)`
  - `classFeatureTwinKey(className: string, featureName: string, namer?: (n: string) => string): string`
  - `racialTraitTwinKey(speciesName: string, traitName: string, namer?: (n: string) => string): string`
  - `dedupeById<T extends { id: number }>(entries: readonly T[]): T[]`
  - `definitionTiebreak(a: TiebreakFields, b: TiebreakFields): number`, where `TiebreakFields = { id: number; isHomebrew?: boolean | null }`
  - `monsterTiebreak(index: SourceIndex): (a: MonsterTiebreakFields, b: MonsterTiebreakFields) => number`, where `MonsterTiebreakFields = TiebreakFields & { sourceId?: number | null }`
  - `interface Selection<T> { entry: T; reason?: EditionReason }`
  - `selectByEdition<T>(group: readonly T[], requested: RulesEdition, info: (c: T) => EditionInfo, tiebreak: (a: T, b: T) => number): Selection<T> | null`
  - `interface LookupOptions<T> { name: (c: T) => string; info: (c: T) => EditionInfo; tiebreak: (a: T, b: T) => number; partialMatch?: (all: readonly T[], normalizedQuery: string) => T | undefined; twinName?: (name: string) => string }`
  - `interface LookupResult<T> extends Selection<T> { renamed?: { name2014: string; name2024: string } }`
  - `lookupByName<T>(all: readonly T[], query: string, requested: RulesEdition, opts: LookupOptions<T>): LookupResult<T> | null`
  - `interface SearchOptions<T> { info; twinKey: (c: T) => string; tiebreak; nameMatches?: (c: T) => boolean; passes?: (c: T) => boolean }`
  - `interface SearchSelection<T> extends Selection<T> { info: EditionInfo }`
  - `groupAndSelect<T>(all: readonly T[], requested: RulesEdition, opts: SearchOptions<T>): { selected: SearchSelection<T>[]; hidden: number }`

- [ ] **Step 1: Write the failing tests**

In `tests/edition.test.ts`, replace the `../src/edition.js` import block with:

```ts
import {
  buildSourceIndex, categoryRuleset, classifyEdition, KNOWN_CATEGORY_IDS,
  normalizeName, createTwinNamer, classFeatureTwinKey, racialTraitTwinKey,
  dedupeById, definitionTiebreak, monsterTiebreak,
  selectByEdition, lookupByName, groupAndSelect,
  type CategoryRecord, type EditionInfo, type EditionMarkers, type Ruleset, type SourceRecord,
} from "../src/edition.js";
import { EDITION_RENAMES } from "../src/edition-renames.js";
```

Append:

```ts
// ── Twin names ────────────────────────────────────────────────────────────────

describe("twin names", () => {
  const twin = createTwinNamer([["Acid Arrow", "Melf’s Acid Arrow"]]);

  it("normalizes case, curly apostrophes and whitespace", () => {
    expect(normalizeName("  Melf’s   ACID\tArrow ")).toBe("melf's acid arrow");
  });

  it("maps a 2014 name to the normalized 2024 name; the 2024 side is canonical", () => {
    expect(twin("  ACID   arrow ")).toBe("melf's acid arrow");
    expect(twin("Melf's Acid Arrow")).toBe("melf's acid arrow");
    expect(twin("Fireball")).toBe("fireball");
  });

  it("keys class features and racial traits by owner + name", () => {
    expect(classFeatureTwinKey("Paladin", "Extra Attack", twin)).not.toBe(classFeatureTwinKey("Fighter", "Extra Attack", twin));
    expect(classFeatureTwinKey(" fighter", "EXTRA  attack", twin)).toBe("fighter/extra attack");
    expect(racialTraitTwinKey("Elf", "Darkvision", twin)).not.toBe(racialTraitTwinKey("Dwarf", "Darkvision", twin));
    expect(racialTraitTwinKey("Elf", "Fey Ancestry", twin)).toBe("elf/fey ancestry");
  });
});

describe("EDITION_RENAMES table", () => {
  const pairs = EDITION_RENAMES.map(([a, b]) => [normalizeName(a), normalizeName(b)] as const);

  it("maps each 2014 name once", () => {
    expect(new Set(pairs.map(([a]) => a)).size).toBe(pairs.length);
  });

  it("never maps a name to itself", () => {
    for (const [a, b] of pairs) expect(a).not.toBe(b);
  });

  it("has no chains: no 2024 name is also a 2014 name", () => {
    const olds = new Set(pairs.map(([a]) => a));
    for (const [, b] of pairs) expect(olds.has(b)).toBe(false);
  });
});

// ── Selection fixtures ────────────────────────────────────────────────────────

type E = { id: number; name: string; r: Ruleset; isHomebrew?: boolean; conc?: boolean };
const e = (id: number, name: string, r: Ruleset, extra: Partial<E> = {}): E => ({ id, name, r, ...extra });
const infoOf = (c: E): EditionInfo => ({ ruleset: c.r, book: null });
const ids = (xs: Array<{ entry: E }>) => xs.map(x => x.entry.id);

describe("tiebreaks", () => {
  it("dedupes by definition id, keeping the first", () => {
    expect(dedupeById([e(1, "A", "2024"), e(2, "B", "2024"), e(1, "A again", "2024")]).map(x => x.name)).toEqual(["A", "B"]);
  });

  it("definitions: official before homebrew, then lowest id", () => {
    const sorted = [e(9, "X", "2024", { isHomebrew: true }), e(7, "X", "2024"), e(3, "X", "2024")].sort(definitionTiebreak);
    expect(sorted.map(x => x.id)).toEqual([3, 7, 9]);
  });

  it("monsters: official → Core Rules book → lowest id", () => {
    const tiebreak = monsterTiebreak(INDEX);
    const monsters = [
      { id: 3, sourceId: 147, isHomebrew: true },
      { id: 9, sourceId: 6 },      // Curse of Strahd — not a Core Rules category
      { id: 20, sourceId: 147 },   // MM-2024 — "5.5e Core Rules"
      { id: 12, sourceId: 5 },     // MM 2014 — "5e Core Rules"
      { id: 1, sourceId: null },
    ];
    expect([...monsters].sort(tiebreak).map(m => m.id)).toEqual([12, 20, 1, 9, 3]);
  });
});

describe("selectByEdition (spec: selection table)", () => {
  const S24 = e(1, "Sleep", "2024");
  const S14 = e(2, "Sleep", "2014");

  it.each([
    ["2024", [S24, S14], 1, undefined],
    ["2024", [S24], 1, undefined],
    ["2024", [S14], 2, "no-2024-version"],
    ["2014", [S24, S14], 2, undefined],
    ["2014", [S14], 2, undefined],
    ["2014", [S24], 1, "no-2014-version"],
  ] as const)("requested %s from %j → id %i, reason %s", (requested, group, id, reason) => {
    const picked = selectByEdition(group, requested, infoOf, definitionTiebreak);
    expect(picked?.entry.id).toBe(id);
    expect(picked?.reason).toBe(reason);
  });

  it("an edition entry beats a non-edition one, whatever the ids", () => {
    expect(selectByEdition([e(1, "Fireball", "homebrew", { isHomebrew: true }), e(5, "Fireball", "2014")], "2024", infoOf, definitionTiebreak))
      .toEqual({ entry: e(5, "Fireball", "2014"), reason: "no-2024-version" });
  });

  it("a group with no edition entries yields its first non-edition entry by tiebreak", () => {
    const picked = selectByEdition([e(1, "Hex Blade", "homebrew", { isHomebrew: true }), e(9, "Hex Blade", "third-party")], "2014", infoOf, definitionTiebreak);
    expect(picked).toEqual({ entry: e(9, "Hex Blade", "third-party") });
  });

  it("two same-edition entries resolve by tiebreak", () => {
    expect(selectByEdition([e(7, "Zombie", "2024"), e(3, "Zombie", "2024")], "2024", infoOf, definitionTiebreak)?.entry.id).toBe(3);
  });

  it("an empty group yields null", () => {
    expect(selectByEdition([], "2024", infoOf, definitionTiebreak)).toBeNull();
  });
});

// ── Single lookups (spec: gather algorithm) ───────────────────────────────────

describe("lookupByName", () => {
  const twin = createTwinNamer([["Acid Arrow", "Melf's Acid Arrow"]]);
  const SPELLS = [
    e(1, "Acid Arrow", "2014"),
    e(2, "Melf's Acid Arrow", "2024"),
    e(3, "Sleep", "2014"),
    e(4, "Sleep", "2024"),
    e(5, "Toll the Dead", "2014"),
    e(6, "Fireball", "2024"),
    e(7, "Fireball", "2014"),
    e(8, "Fireball", "homebrew", { isHomebrew: true }),
  ];
  const opts = { name: (c: E) => c.name, info: infoOf, tiebreak: definitionTiebreak, twinName: twin };
  const find = (q: string, requested: "2024" | "2014" = "2024", extra = {}) => lookupByName(SPELLS, q, requested, { ...opts, ...extra });

  it("exact: 2024 by default, 2014 on request", () => {
    expect(find("sleep")).toEqual({ entry: SPELLS[3] });
    expect(find("Sleep", "2014")).toEqual({ entry: SPELLS[2] });
  });

  it("exact: an official edition entry beats a same-named homebrew one", () => {
    expect(find("Fireball")?.entry.id).toBe(6);
  });

  it("2014-only entry under the default carries the reason", () => {
    expect(find("Toll the Dead")).toEqual({ entry: SPELLS[4], reason: "no-2024-version" });
  });

  it("exact via the rename table reaches the 2024 group and reports the rename", () => {
    expect(find("acid arrow")).toEqual({ entry: SPELLS[1], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
    expect(find("Acid Arrow", "2014")).toEqual({ entry: SPELLS[0] });
    expect(find("Melf's Acid Arrow", "2014")).toEqual({ entry: SPELLS[0], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
  });

  it("normalizes curly apostrophes and stray whitespace in the query", () => {
    expect(find("  melf’s   acid arrow ")).toEqual({ entry: SPELLS[1] });
  });

  it("partial: first match in array order, then its whole group", () => {
    expect(find("toll")).toEqual({ entry: SPELLS[4], reason: "no-2024-version" });
    expect(find("fire")?.entry.id).toBe(6);
    expect(find("acid arr")).toEqual({ entry: SPELLS[1], renamed: { name2014: "Acid Arrow", name2024: "Melf's Acid Arrow" } });
  });

  it("uses the tool's own partial-match order when given", () => {
    const fuzzy = { partialMatch: (all: readonly E[]) => all.find(c => c.id === 3) };
    expect(find("slep", "2024", fuzzy)).toEqual({ entry: SPELLS[3] });
    expect(find("slep", "2014", fuzzy)).toEqual({ entry: SPELLS[2] });
  });

  it("an empty or unmatched query yields null", () => {
    expect(find("")).toBeNull();
    expect(find("   ")).toBeNull();
    expect(find("Wish")).toBeNull();
  });
});

// ── Searches (spec: search pipeline) ──────────────────────────────────────────

describe("groupAndSelect", () => {
  const twin = createTwinNamer([["Feeblemind", "Befuddlement"]]);
  const ALL = [
    e(10, "Barkskin", "2014", { conc: true }),
    e(11, "Barkskin", "2024", { conc: false }),
    e(12, "Bless", "2014", { conc: true }),
    e(13, "Bless", "2024", { conc: true }),
    e(14, "Toll the Dead", "2014", { conc: false }),
    e(15, "Feeblemind", "2014", { conc: false }),
    e(16, "Befuddlement", "2024", { conc: false }),
    e(17, "Bless", "homebrew", { isHomebrew: true, conc: true }),
    e(18, "Moonbeam", "2024", { conc: true }),
  ];
  const base = { info: infoOf, twinKey: (c: E) => twin(c.name), tiebreak: definitionTiebreak };
  const search = (requested: "2024" | "2014", extra: { nameMatches?: (c: E) => boolean; passes?: (c: E) => boolean } = {}) =>
    groupAndSelect(ALL, requested, { ...base, ...extra });

  it("default: one 2024 entry per twin group, non-edition entries kept, other edition counted", () => {
    const { selected, hidden } = search("2024");
    expect(ids(selected)).toEqual([11, 13, 17, 14, 16, 18]);
    expect(hidden).toBe(3);
    expect(selected.find(s => s.entry.id === 14)).toMatchObject({ reason: "no-2024-version", info: { ruleset: "2014" } });
  });

  it("2014 requested: the mirror image", () => {
    const { selected, hidden } = search("2014");
    expect(ids(selected)).toEqual([10, 12, 17, 14, 15, 18]);
    expect(hidden).toBe(3);
    expect(selected.find(s => s.entry.id === 18)?.reason).toBe("no-2014-version");
  });

  it("name filter matches a group when any member matches (feeble → Befuddlement)", () => {
    const { selected, hidden } = search("2024", { nameMatches: c => normalizeName(c.name).includes("feeble") });
    expect(ids(selected)).toEqual([16]);
    expect(hidden).toBe(1);
  });

  it("a twin counts as hidden even when only the other member matches the name: switching editions shows it", () => {
    // "befud" matches only 2024 Befuddlement, yet rules_edition "2014" would list
    // Feeblemind for this query (the group matches), so the footer is truthful.
    expect(search("2024", { nameMatches: c => normalizeName(c.name).includes("befud") })).toMatchObject({ hidden: 1 });
    expect(ids(search("2014", { nameMatches: c => normalizeName(c.name).includes("befud") }).selected)).toEqual([15]);
  });

  it("attribute filters apply to the selected entry; a 2014-only match is still hidden and not counted", () => {
    const { selected, hidden } = search("2024", { passes: c => c.conc === true });
    expect(ids(selected)).toEqual([13, 17, 18]); // 2024 Barkskin isn't concentration → whole group dropped
    expect(hidden).toBe(1);                       // only 2014 Bless: it passes and its group survived
  });

  it("hidden counts only other-edition entries that pass the filters", () => {
    const { selected, hidden } = search("2014", { passes: c => c.conc === true });
    expect(ids(selected)).toEqual([10, 12, 17, 18]);
    expect(hidden).toBe(1); // 2024 Bless; 2024 Barkskin fails the filter
  });

  it("homebrew/third-party are never hidden and never counted", () => {
    const only = [e(19, "Blood Curse", "homebrew", { isHomebrew: true }), e(20, "Blood Curse", "third-party")];
    for (const requested of ["2024", "2014"] as const) {
      const { selected, hidden } = groupAndSelect(only, requested, base);
      expect(ids(selected)).toEqual([20, 19]);
      expect(hidden).toBe(0);
    }
  });

  it("same-edition duplicates in one group show once and are not counted as hidden", () => {
    const { selected, hidden } = groupAndSelect([e(30, "Zombie", "2024"), e(25, "Zombie", "2024")], "2024", base);
    expect(ids(selected)).toEqual([25]);
    expect(hidden).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/edition.test.ts`
Expected: FAIL. Vitest reports that `normalizeName` (and the other new imports) is not exported / `is not a function`. The Task 1 tests are collected in the same file, so the whole file fails to load until Step 3.

- [ ] **Step 3: Implement**

In `src/edition.ts`, add this import below the `stripHtml` import:

```ts
import { EDITION_RENAMES } from "./edition-renames.js";
```

Append to `src/edition.ts`:

```ts
// ── Twin names ────────────────────────────────────────────────────────────────

/** Lowercase, curly apostrophes folded to "'", whitespace collapsed, trimmed. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/** A twin-name function over a rename table: normalizes, then maps a 2014 name to its 2024 name. */
export function createTwinNamer(pairs: ReadonlyArray<readonly [string, string]>): (name: string) => string {
  const renames = new Map(pairs.map(([name2014, name2024]) => [normalizeName(name2014), normalizeName(name2024)]));
  return name => {
    const n = normalizeName(name);
    return renames.get(n) ?? n;
  };
}

/** The twin key for spells, items, monsters, feats, backgrounds, species and classes. */
export const twinName = createTwinNamer(EDITION_RENAMES);

/** Class features twin only within one class: Paladin's Extra Attack is not Fighter's. */
export function classFeatureTwinKey(className: string, featureName: string, namer = twinName): string {
  return `${namer(className)}/${namer(featureName)}`;
}

/** Racial traits twin only within one species. */
export function racialTraitTwinKey(speciesName: string, traitName: string, namer = twinName): string {
  return `${namer(speciesName)}/${namer(traitName)}`;
}

// ── Tiebreaks ─────────────────────────────────────────────────────────────────

export interface TiebreakFields { id: number; isHomebrew?: boolean | null }
export interface MonsterTiebreakFields extends TiebreakFields { sourceId?: number | null }

/** First occurrence of each definition id (one spell arrives from several class lists). */
export function dedupeById<T extends { id: number }>(entries: readonly T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Every non-monster type: official before homebrew, then lowest definition id. Dedupe by id first. */
export function definitionTiebreak(a: TiebreakFields, b: TiebreakFields): number {
  return (a.isHomebrew ? 1 : 0) - (b.isHomebrew ? 1 : 0) || a.id - b.id;
}

/**
 * Monsters (#58's order, minus the edition key): official → a Core Rules
 * book (category name matches /core rules/, as monster.ts resolves it) → lowest id.
 */
export function monsterTiebreak(index: SourceIndex): (a: MonsterTiebreakFields, b: MonsterTiebreakFields) => number {
  const isCore = (m: MonsterTiebreakFields) => {
    const cat = m.sourceId != null ? index.sources.get(m.sourceId)?.categoryId : null;
    return cat != null && /core\s*rules/i.test(index.categories.get(cat) ?? "");
  };
  return (a, b) =>
    (a.isHomebrew ? 1 : 0) - (b.isHomebrew ? 1 : 0)
    || (isCore(a) ? 0 : 1) - (isCore(b) ? 0 : 1)
    || a.id - b.id;
}

// ── Selection ─────────────────────────────────────────────────────────────────

export interface Selection<T> { entry: T; reason?: EditionReason }

/**
 * Pick one entry from a twin group. The requested edition wins; failing that,
 * the other edition with a reason. Non-edition entries (third-party, homebrew,
 * playtest, unstated) are never compared against editions; a group with
 * none of either edition yields its first entry by tiebreak.
 */
export function selectByEdition<T>(
  group: readonly T[],
  requested: RulesEdition,
  info: (c: T) => EditionInfo,
  tiebreak: (a: T, b: T) => number,
): Selection<T> | null {
  if (!group.length) return null;
  const sorted = [...group].sort(tiebreak);
  const first = (edition: RulesEdition) => sorted.find(c => info(c).ruleset === edition);
  const wanted = first(requested);
  if (wanted) return { entry: wanted };
  const other = first(requested === "2024" ? "2014" : "2024");
  if (other) return { entry: other, reason: requested === "2024" ? "no-2024-version" : "no-2014-version" };
  return { entry: sorted[0] };
}

export interface LookupOptions<T> {
  name: (c: T) => string;
  info: (c: T) => EditionInfo;
  tiebreak: (a: T, b: T) => number;
  /** The tool's partial-match order. Default: first entry, in array order, whose normalized name contains the query. */
  partialMatch?: (all: readonly T[], normalizedQuery: string) => T | undefined;
  /** Defaults to twinName (the committed rename table). Tests inject their own. */
  twinName?: (name: string) => string;
}

export interface LookupResult<T> extends Selection<T> {
  /** Set when the matched name differs from the returned one within the twin group: print renameLine(). */
  renamed?: { name2014: string; name2024: string };
}

/**
 * Single lookups (get_*). Exact twin-name match first, so a 2014 name reaches
 * its renamed 2024 group; otherwise the tool's partial match picks an entry and
 * its whole twin group is the target. Then selectByEdition within the group.
 */
export function lookupByName<T>(
  all: readonly T[],
  query: string,
  requested: RulesEdition,
  opts: LookupOptions<T>,
): LookupResult<T> | null {
  const namer = opts.twinName ?? twinName;
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return null; // "" is a substring of every name
  const queryKey = namer(query);

  let key: string;
  let matched: T | undefined;
  if (all.some(c => namer(opts.name(c)) === queryKey)) {
    key = queryKey;
    matched = all.find(c => normalizeName(opts.name(c)) === normalizedQuery);
  } else {
    matched = opts.partialMatch
      ? opts.partialMatch(all, normalizedQuery)
      : all.find(c => normalizeName(opts.name(c)).includes(normalizedQuery));
    if (!matched) return null;
    key = namer(opts.name(matched));
  }

  const group = all.filter(c => namer(opts.name(c)) === key);
  const picked = selectByEdition(group, requested, opts.info, opts.tiebreak);
  if (!picked) return null;

  const matchedName = matched ? opts.name(matched) : query.trim();
  const returnedName = opts.name(picked.entry);
  if (normalizeName(matchedName) === normalizeName(returnedName)) return picked;
  // The 2024 name is the twin key itself; the other is the 2014 alias.
  const [name2024, name2014] = normalizeName(returnedName) === key
    ? [returnedName, matchedName]
    : [matchedName, returnedName];
  return { ...picked, renamed: { name2014, name2024 } };
}

export interface SearchOptions<T> {
  info: (c: T) => EditionInfo;
  twinKey: (c: T) => string;
  tiebreak: (a: T, b: T) => number;
  /** Step 2: a group matches when ANY of its entries matches. Omit for no name filter. */
  nameMatches?: (c: T) => boolean;
  /** Step 4: attribute filters, applied to the selected entry (and to other-edition twins, for the count). */
  passes?: (c: T) => boolean;
}

export interface SearchSelection<T> extends Selection<T> { info: EditionInfo }

/**
 * Search pipeline steps 1–5 over the FULL compendium (dedupe by id first):
 * group by twin key → name filter per group → one edition entry per group
 * (non-edition entries pass through) → attribute filters on the selected
 * entry → count other-edition entries in surviving groups that would also
 * have passed the attribute filters. The name filter is per group, so a twin
 * counts as hidden even if only its partner's name matched: the other
 * rules_edition would list it for the same query. Same-edition duplicates are
 * not shown and not counted.
 * Groups keep first-appearance order; sorting and paging are the caller's.
 */
export function groupAndSelect<T>(
  all: readonly T[],
  requested: RulesEdition,
  opts: SearchOptions<T>,
): { selected: SearchSelection<T>[]; hidden: number } {
  const groups = new Map<string, T[]>();
  for (const c of all) {
    const key = opts.twinKey(c);
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  const passes = opts.passes ?? (() => true);
  const selected: SearchSelection<T>[] = [];
  let hidden = 0;
  for (const group of groups.values()) {
    if (opts.nameMatches && !group.some(opts.nameMatches)) continue;
    const editions = group.filter(x => isEdition(opts.info(x).ruleset));
    const pick = selectByEdition(editions, requested, opts.info, opts.tiebreak);
    if (pick && passes(pick.entry)) {
      const info = opts.info(pick.entry);
      selected.push({ ...pick, info });
      hidden += editions.filter(x => opts.info(x).ruleset !== info.ruleset && passes(x)).length;
    }
    const nonEdition = group.filter(x => !isEdition(opts.info(x).ruleset)).sort(opts.tiebreak);
    for (const x of nonEdition) {
      if (passes(x)) selected.push({ entry: x, info: opts.info(x) });
    }
  }
  return { selected, hidden };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/edition.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/edition.ts tests/edition.test.ts
git commit -m "feat(edition): twin names, edition selection, lookup and search grouping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Label strings

**Files:**
- Modify: `src/edition.ts` (append)
- Test: `tests/edition.test.ts` (replace the import block, then append)

**Interfaces:**
- Consumes (Tasks 1–2): `EditionInfo`, `RulesEdition`, `Ruleset`, `isEdition`.
- Produces:
  - `type RulesLineReason = EditionReason | "rules-miss-2024" | "rules-miss-2014" | "treasure-no-2014"`
  - `type Open5eOrigin = "unavailable" | "not-found" | "primary"`
  - `rulesLine(info: EditionInfo, opts?: { reason?: RulesLineReason; open5e?: Open5eOrigin }): string`. When there is a reason, its line comes after a `\n`.
  - `renameLine(name2014: string, name2024: string): string`
  - `sourceNote(source: string, bookRuleset: RulesEdition, requested: RulesEdition): string | null`
  - `editionTag(info: EditionInfo): string`
  - `type SearchHeaderMode = { requested: RulesEdition } | { sourceBook: string } | { rulesDoc: RulesEdition }`
  - `searchHeader(mode: SearchHeaderMode): string`
  - `searchFooter(requested: RulesEdition, hidden: number): string | null`
  - `ambiguityMessage(query: string, candidates: ReadonlyArray<{ name: string; cr: string }>): string`
  - `type CharacterEntryKind = "class" | "subclass" | "species" | "background" | "feat" | "spell" | "item"`
  - `interface CharacterEditionEntry { name: string; kind: CharacterEntryKind; level?: number; info: EditionInfo }`
  - `characterMainEdition(entries: readonly CharacterEditionEntry[]): { main: RulesEdition | "unstated"; mixed: boolean }`
  - `characterTag(info: EditionInfo, main: RulesEdition | "unstated"): string | null`
  - `characterRulesLine(entries: readonly CharacterEditionEntry[]): string`

**Main-edition note for the implementer:** the spec says "highest level wins, tie → 2024" and also "if the counted classes span both editions, the character is mixed and 2024 is the main edition". When both editions are present the second rule applies, and when only one is present every counted class shares it. So the highest-level rule never changes the result, and the code does not implement it.

- [ ] **Step 1: Write the failing tests**

In `tests/edition.test.ts`, replace the `../src/edition.js` import block (only that statement — leave the separate `../src/edition-renames.js` import line from Task 2 in place) with:

```ts
import {
  buildSourceIndex, categoryRuleset, classifyEdition, KNOWN_CATEGORY_IDS,
  normalizeName, createTwinNamer, classFeatureTwinKey, racialTraitTwinKey,
  dedupeById, definitionTiebreak, monsterTiebreak,
  selectByEdition, lookupByName, groupAndSelect,
  rulesLine, renameLine, sourceNote, editionTag, searchHeader, searchFooter, ambiguityMessage,
  characterMainEdition, characterTag, characterRulesLine,
  type CategoryRecord, type CharacterEditionEntry, type CharacterEntryKind,
  type EditionInfo, type EditionMarkers, type Ruleset, type SourceRecord,
} from "../src/edition.js";
```

Append:

```ts
// ── Labels (spec: "Label formats") ────────────────────────────────────────────

const info = (ruleset: Ruleset, book: string | null = null): EditionInfo => ({ ruleset, book });

describe("rulesLine", () => {
  it.each([
    [info("2024", "Player's Handbook (2024)"), "Rules: 2024 · Player's Handbook (2024)"],
    [info("2014", "Xanathar's Guide to Everything"), "Rules: 2014 · Xanathar's Guide to Everything"],
    [info("2024"), "Rules: 2024"],
    [info("third-party", "Critical Role"), "Rules: third-party · Critical Role (edition not stated)"],
    [info("third-party"), "Rules: third-party (edition not stated)"],
    [info("homebrew"), "Rules: homebrew (edition not stated)"],
    [info("homebrew", "ignored"), "Rules: homebrew (edition not stated)"],
    [info("playtest", "Unearthed Arcana"), "Rules: playtest · Unearthed Arcana"],
    [info("unstated", "Eberron: Rising from the Last War"), "Rules: edition not stated · Eberron: Rising from the Last War"],
    [info("unstated"), "Rules: edition not stated"],
  ])("%j → %s", (i, expected) => {
    expect(rulesLine(i)).toBe(expected);
  });

  it("Open5e: the SRD replaces the book, with the fallback reason", () => {
    expect(rulesLine(info("2024", "x"), { open5e: "unavailable" })).toBe("Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)");
    expect(rulesLine(info("2024"), { open5e: "not-found" })).toBe("Rules: 2024 · SRD 5.2 (Open5e fallback — not found on D&D Beyond)");
    expect(rulesLine(info("2014"), { open5e: "unavailable" })).toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)");
    expect(rulesLine(info("2014"), { open5e: "not-found" })).toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)");
    expect(rulesLine(info("2024"), { open5e: "primary" })).toBe("Rules: 2024 · SRD 5.2");
    expect(rulesLine(info("2014"), { open5e: "primary" })).toBe("Rules: 2014 · SRD 5.1");
  });

  it("Open5e origin is ignored for a non-edition ruleset", () => {
    expect(rulesLine(info("homebrew"), { open5e: "primary" })).toBe("Rules: homebrew (edition not stated)");
  });

  it("appends the reason on the next line", () => {
    const xge = info("2014", "Xanathar's Guide to Everything");
    expect(rulesLine(xge, { reason: "no-2024-version" })).toBe("Rules: 2014 · Xanathar's Guide to Everything\n(no 2024 version exists — 2014 text shown)");
    expect(rulesLine(info("2024", "Player's Handbook (2024)"), { reason: "no-2014-version" })).toBe("Rules: 2024 · Player's Handbook (2024)\n(no 2014 version exists — 2024 text shown)");
    expect(rulesLine(info("2014"), { open5e: "primary", reason: "rules-miss-2024" })).toBe("Rules: 2014 · SRD 5.1\n(no matching 2024 rules section — 2014 text shown)");
    expect(rulesLine(info("2024"), { open5e: "primary", reason: "rules-miss-2014" })).toBe("Rules: 2024 · SRD 5.2\n(no matching 2014 rules section — 2024 text shown)");
    expect(rulesLine(info("2024", "Dungeon Master's Guide (2024)"), { reason: "treasure-no-2014" })).toBe("Rules: 2024 · Dungeon Master's Guide (2024)\n(no 2014 version exists — 2024 tables used)");
  });
});

describe("other single-lookup lines", () => {
  it("renameLine", () => {
    expect(renameLine("Acid Arrow", "Melf's Acid Arrow")).toBe("(2014 name: Acid Arrow · 2024 name: Melf's Acid Arrow)");
  });

  it("sourceNote: only when the book's edition differs from the request", () => {
    expect(sourceNote("mm-2024", "2024", "2014")).toBe(`(source "mm-2024" is a 2024 book — rules_edition "2014" was ignored)`);
    expect(sourceNote("mm-2014", "2014", "2024")).toBe(`(source "mm-2014" is a 2014 book — rules_edition "2024" was ignored)`);
    expect(sourceNote("mm-2024", "2024", "2024")).toBeNull();
  });

  it("ambiguityMessage", () => {
    expect(ambiguityMessage("Red Dragon", [
      { name: "Red Dragon Wyrmling", cr: "4" },
      { name: "Young Red Dragon", cr: "10" },
      { name: "Adult Red Dragon", cr: "17" },
      { name: "Ancient Red Dragon", cr: "24" },
    ])).toBe(`Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Young Red Dragon (CR 10), Adult Red Dragon (CR 17), Ancient Red Dragon (CR 24) — use the full name.`);
  });
});

describe("search labels", () => {
  it.each([
    ["2024", "[2024]"], ["2014", "[2014]"], ["third-party", "[third-party]"],
    ["homebrew", "[homebrew]"], ["playtest", "[playtest]"], ["unstated", "[edition not stated]"],
  ] as const)("editionTag %s → %s", (ruleset, tag) => {
    expect(editionTag(info(ruleset, "any book"))).toBe(tag);
  });

  it("searchHeader", () => {
    expect(searchHeader({ requested: "2024" })).toBe(`Rules: 2024 by default — 2014 entries appear only where no 2024 version exists. Use rules_edition: "2014" for 2014 versions.`);
    expect(searchHeader({ requested: "2014" })).toBe("Rules: 2014 requested — 2024 entries appear only where no 2014 version exists.");
    expect(searchHeader({ sourceBook: "Monster Manual (2024)" })).toBe("Rules: showing every entry in Monster Manual (2024), each tagged with its edition.");
    expect(searchHeader({ rulesDoc: "2024" })).toBe("Rules: sections from SRD 5.2 (2024).");
    expect(searchHeader({ rulesDoc: "2014" })).toBe("Rules: sections from SRD 5.1 (2014).");
  });

  it("searchFooter", () => {
    expect(searchFooter("2024", 14)).toBe(`14 2014 versions hidden — rules_edition: "2014" shows them.`);
    expect(searchFooter("2024", 1)).toBe(`1 2014 version hidden — rules_edition: "2014" shows it.`);
    expect(searchFooter("2014", 3)).toBe("3 2024 versions hidden — omit rules_edition to show them.");
    expect(searchFooter("2014", 1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
    expect(searchFooter("2024", 0)).toBeNull();
  });
});

// ── Character summary (spec: "Characters") ────────────────────────────────────

describe("character edition labels", () => {
  const ent = (name: string, kind: CharacterEntryKind, ruleset: Ruleset, level?: number): CharacterEditionEntry =>
    ({ name, kind, level, info: info(ruleset) });

  it("pure 2024", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Sage", "background", "2024"), ent("Alert", "feat", "2024")];
    expect(characterMainEdition(entries)).toEqual({ main: "2024", mixed: false });
    expect(characterRulesLine(entries)).toBe("Rules: 2024");
  });

  it("2024 with a 2014 background and feat", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Criminal / Spy", "background", "2014"), ent("Sharpshooter", "feat", "2014")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · 2014 content: Criminal / Spy (background), Sharpshooter (feat)");
  });

  it("all-2014 classes make a 2014 character", () => {
    const entries = [ent("Fighter", "class", "2014", 3), ent("Wizard", "class", "2014", 2), ent("Alert", "feat", "2024")];
    expect(characterMainEdition(entries)).toEqual({ main: "2014", mixed: false });
    expect(characterRulesLine(entries)).toBe("Rules: 2014 · 2024 content: Alert (feat)");
  });

  it("mixed-edition multiclass: 2024 is the main edition for tagging", () => {
    const entries = [
      ent("Bard", "class", "2024", 5), ent("Cleric", "class", "2024", 1), ent("Ranger", "class", "2014", 3),
      ent("Sage", "background", "2024"), ent("Sharpshooter", "feat", "2014"),
    ];
    expect(characterMainEdition(entries)).toEqual({ main: "2024", mixed: true });
    expect(characterRulesLine(entries)).toBe("Rules: mixed — 2024: Bard 5, Cleric 1 · 2014: Ranger 3 · 2014 content: Sharpshooter (feat)");
  });

  it("mixed even when the 2014 class is the higher level: 2024 stays the main edition", () => {
    const entries = [ent("Ranger", "class", "2014", 5), ent("Bard", "class", "2024", 1)];
    expect(characterMainEdition(entries)).toEqual({ main: "2024", mixed: true });
    expect(characterRulesLine(entries)).toBe("Rules: mixed — 2024: Bard 1 · 2014: Ranger 5");
  });

  it("non-edition entries get their own groups", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Blood Hunter", "class", "homebrew", 2), ent("Firearm Specialist", "feat", "third-party")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · homebrew: Blood Hunter 2 (class) · third-party: Firearm Specialist (feat)");
  });

  it("a subclass with a different ruleset is listed on its own", () => {
    const entries = [ent("Ranger", "class", "2024", 5), ent("Gloom Stalker", "subclass", "2014")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · 2014 content: Gloom Stalker (subclass)");
  });

  it("no 2014/2024 class: edition not stated, every other group listed", () => {
    const entries = [ent("Blood Hunter", "class", "homebrew", 5), ent("Alert", "feat", "2024"), ent("Mystery", "item", "unstated")];
    expect(characterMainEdition(entries)).toEqual({ main: "unstated", mixed: false });
    expect(characterRulesLine(entries)).toBe("Rules: edition not stated · 2024 content: Alert (feat) · homebrew: Blood Hunter 5 (class)");
  });

  it("unstated entries under an edition get the 'edition not stated' group", () => {
    const entries = [ent("Bard", "class", "2024", 5), ent("Mystery Trinket", "item", "unstated")];
    expect(characterRulesLine(entries)).toBe("Rules: 2024 · edition not stated: Mystery Trinket (item)");
  });

  it("characterTag: tag entries that differ from the main edition; non-edition always", () => {
    expect(characterTag(info("2024"), "2024")).toBeNull();
    expect(characterTag(info("2014"), "2024")).toBe("[2014]");
    expect(characterTag(info("homebrew"), "2024")).toBe("[homebrew]");
    expect(characterTag(info("2024"), "unstated")).toBe("[2024]");
    expect(characterTag(info("unstated"), "unstated")).toBe("[edition not stated]");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/edition.test.ts`
Expected: FAIL. Vitest reports `rulesLine` (and the other new imports) is not exported / `is not a function`.

- [ ] **Step 3: Implement**

Append to `src/edition.ts`:

```ts
// ── Labels ────────────────────────────────────────────────────────────────────
// Every edition string a tool prints. Wording is pinned by tests/edition.test.ts;
// new wording goes here, with a test, never in a tool module.

const NOT_STATED = "edition not stated";

const REASON_TEXT = {
  "no-2024-version": "(no 2024 version exists — 2014 text shown)",
  "no-2014-version": "(no 2014 version exists — 2024 text shown)",
  "rules-miss-2024": "(no matching 2024 rules section — 2014 text shown)",
  "rules-miss-2014": "(no matching 2014 rules section — 2024 text shown)",
  "treasure-no-2014": "(no 2014 version exists — 2024 tables used)",
} as const;
export type RulesLineReason = keyof typeof REASON_TEXT;

const SRD_NAME: Record<RulesEdition, string> = { "2024": "SRD 5.2", "2014": "SRD 5.1" };

const OPEN5E_SUFFIX = {
  unavailable: " (Open5e fallback — D&D Beyond unavailable)",
  "not-found": " (Open5e fallback — not found on D&D Beyond)",
  primary: "",
} as const;
export type Open5eOrigin = keyof typeof OPEN5E_SUFFIX;

/**
 * The line under a single lookup's title, e.g. "Rules: 2024 · Player's Handbook (2024)".
 * `open5e` swaps the book for the SRD (2014/2024 content only). `reason` adds a
 * second line saying why the edition shown differs from the one requested.
 */
export function rulesLine(info: EditionInfo, opts: { reason?: RulesLineReason; open5e?: Open5eOrigin } = {}): string {
  const { ruleset, book } = info;
  const withBook = (head: string) => (book ? `${head} · ${book}` : head);
  let line: string;
  if (opts.open5e && isEdition(ruleset)) {
    line = `Rules: ${ruleset} · ${SRD_NAME[ruleset]}${OPEN5E_SUFFIX[opts.open5e]}`;
  } else if (ruleset === "homebrew") {
    line = `Rules: homebrew (${NOT_STATED})`;
  } else if (ruleset === "third-party") {
    line = `${withBook("Rules: third-party")} (${NOT_STATED})`;
  } else if (ruleset === "unstated") {
    line = withBook(`Rules: ${NOT_STATED}`);
  } else {
    line = withBook(`Rules: ${ruleset}`); // 2024, 2014, playtest
  }
  return opts.reason ? `${line}\n${REASON_TEXT[opts.reason]}` : line;
}

/** Added when the query matched a different name in the twin group than the one shown. */
export function renameLine(name2014: string, name2024: string): string {
  return `(2014 name: ${name2014} · 2024 name: ${name2024})`;
}

/** Monsters: a `source` book whose edition contradicts rules_edition. Null when they agree. */
export function sourceNote(source: string, bookRuleset: RulesEdition, requested: RulesEdition): string | null {
  if (bookRuleset === requested) return null;
  return `(source "${source}" is a ${bookRuleset} book — rules_edition "${requested}" was ignored)`;
}

/** Inline tag placed immediately after an entry's name: "[2024]", "[edition not stated]", … */
export function editionTag(info: EditionInfo): string {
  return `[${info.ruleset === "unstated" ? NOT_STATED : info.ruleset}]`;
}

export type SearchHeaderMode = { requested: RulesEdition } | { sourceBook: string } | { rulesDoc: RulesEdition };

/** First line of every search result, above the tool's own heading. */
export function searchHeader(mode: SearchHeaderMode): string {
  if ("sourceBook" in mode) return `Rules: showing every entry in ${mode.sourceBook}, each tagged with its edition.`;
  if ("rulesDoc" in mode) return `Rules: sections from ${SRD_NAME[mode.rulesDoc]} (${mode.rulesDoc}).`;
  return mode.requested === "2024"
    ? `Rules: 2024 by default — 2014 entries appear only where no 2024 version exists. Use rules_edition: "2014" for 2014 versions.`
    : "Rules: 2014 requested — 2024 entries appear only where no 2014 version exists.";
}

/** Last line of a search when twins were hidden; null when none were. */
export function searchFooter(requested: RulesEdition, hidden: number): string | null {
  if (hidden <= 0) return null;
  const one = hidden === 1;
  const counted = `${hidden} ${requested === "2024" ? "2014" : "2024"} ${one ? "version" : "versions"} hidden`;
  return requested === "2024"
    ? `${counted} — rules_edition: "2014" shows ${one ? "it" : "them"}.`
    : `${counted} — omit rules_edition to show ${one ? "it" : "them"}.`;
}

/** Encounter/treasure: a partial monster name that spans several distinct creatures. */
export function ambiguityMessage(query: string, candidates: ReadonlyArray<{ name: string; cr: string }>): string {
  const list = candidates.map(c => `${c.name} (CR ${c.cr})`).join(", ");
  return `Ambiguous: "${query}" could be ${list} — use the full name.`;
}

// ── Character summary ─────────────────────────────────────────────────────────

export type CharacterEntryKind = "class" | "subclass" | "species" | "background" | "feat" | "spell" | "item";
export interface CharacterEditionEntry { name: string; kind: CharacterEntryKind; level?: number; info: EditionInfo }

/**
 * Only base classes classified 2014/2024 count. None → "unstated". Both
 * editions → mixed, with 2024 the main edition for tagging. Otherwise the one
 * edition they share.
 */
export function characterMainEdition(entries: readonly CharacterEditionEntry[]): { main: RulesEdition | "unstated"; mixed: boolean } {
  const editions = new Set<RulesEdition>();
  for (const e of entries) if (e.kind === "class" && isEdition(e.info.ruleset)) editions.add(e.info.ruleset);
  if (editions.size === 0) return { main: "unstated", mixed: false };
  if (editions.size > 1) return { main: "2024", mixed: true };
  return { main: [...editions][0], mixed: false };
}

/** Inline tag for one character entry: null when it matches the main edition; non-edition entries always tagged. */
export function characterTag(info: EditionInfo, main: RulesEdition | "unstated"): string | null {
  return isEdition(info.ruleset) && info.ruleset === main ? null : editionTag(info);
}

const CHARACTER_GROUPS: ReadonlyArray<readonly [Ruleset, string]> = [
  ["2024", "2024 content"],
  ["2014", "2014 content"],
  ["homebrew", "homebrew"],
  ["third-party", "third-party"],
  ["playtest", "playtest"],
  ["unstated", NOT_STATED],
];

/**
 * "Rules: 2024 · 2014 content: Criminal / Spy (background)", or for a
 * mixed-edition multiclass "Rules: mixed — 2024: Bard 5 · 2014: Ranger 3 · …".
 * Entries are listed in the order given. Entries matching the main edition are
 * never listed. That includes "edition not stated" entries when the main
 * edition is itself unstated: the head already says so, and characterTag()
 * still tags each one inline.
 */
export function characterRulesLine(entries: readonly CharacterEditionEntry[]): string {
  const { main, mixed } = characterMainEdition(entries);
  const classLabel = (e: CharacterEditionEntry) => (e.level != null ? `${e.name} ${e.level}` : e.name);
  const isCountedClass = (e: CharacterEditionEntry) => e.kind === "class" && isEdition(e.info.ruleset);

  let head: string;
  let rest = entries;
  if (mixed) {
    const classesIn = (edition: RulesEdition) =>
      entries.filter(e => isCountedClass(e) && e.info.ruleset === edition).map(classLabel).join(", ");
    head = `Rules: mixed — 2024: ${classesIn("2024")} · 2014: ${classesIn("2014")}`;
    rest = entries.filter(e => !isCountedClass(e));
  } else {
    head = `Rules: ${main === "unstated" ? NOT_STATED : main}`;
  }

  const groups: string[] = [];
  for (const [ruleset, label] of CHARACTER_GROUPS) {
    if (ruleset === main) continue;
    const items = rest
      .filter(e => e.info.ruleset === ruleset)
      .map(e => `${e.kind === "class" ? classLabel(e) : e.name} (${e.kind})`);
    if (items.length) groups.push(`${label}: ${items.join(", ")}`);
  }
  return [head, ...groups].join(" · ");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/edition.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/edition.ts tests/edition.test.ts
git commit -m "feat(edition): every rules-edition label string, pinned by tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rename/snapshot generator script and the source snapshot

**Files:**
- Create: `scripts/dump-edition-renames.mts`
- Generate: `src/source-snapshot.ts` (written by the script, never by hand)
- Test: `tests/edition.test.ts` (one more import, plus a snapshot sanity block)
- Modify: `CLAUDE.md` (refresh note)

**Interfaces:**
- Consumes (Tasks 1–2): `buildSourceIndex`, `classifyEdition`, `normalizeName`, `twinName`, `KNOWN_CATEGORY_IDS`, `CategoryRecord`, `SourceRecord`, `EditionMarkers`, `SourceIndex`; `stripHtml` from `src/utils.ts`; `beginAuthenticatedSession()` from `src/session-fetch.ts` (its `fetch(url, init?)` sends Bearer + cookies).
- Produces `src/source-snapshot.ts`, which exports:
  - `SNAPSHOT_DATE: string` (ISO date)
  - `SNAPSHOT_CATEGORIES: readonly CategoryRecord[]`
  - `SNAPSHOT_SOURCES: readonly SourceRecord[]`

- [ ] **Step 1: Write the failing snapshot sanity test**

In `tests/edition.test.ts`, add this import below the `edition-renames` import:

```ts
import { SNAPSHOT_CATEGORIES, SNAPSHOT_DATE, SNAPSHOT_SOURCES } from "../src/source-snapshot.js";
```

Append:

```ts
// ── Generated source snapshot ─────────────────────────────────────────────────

describe("source snapshot", () => {
  const snapshotIndex = buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES);

  it("is dated and non-trivial", () => {
    expect(SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SNAPSHOT_SOURCES.length).toBeGreaterThan(200);
  });

  it.each([
    [1, 26], [2, 26], [3, 26], [5, 26], [145, 24], [146, 24], [147, 24], [148, 24], [193, 34],
  ])("verified source %i is in category %i", (id, category) => {
    expect(snapshotIndex.sources.get(id)?.categoryId).toBe(category);
  });

  it("classifies the named spec cases from the snapshot alone", () => {
    const at = (...ids: number[]) => classifyEdition({ sources: ids.map(sourceId => ({ sourceId })) }, snapshotIndex);
    expect(at(1)).toEqual({ ruleset: "2014", book: "Basic Rules (2014)" });
    expect(at(145)).toEqual({ ruleset: "2024", book: "Player's Handbook (2024)" });
    expect(at(148, 1)).toEqual({ ruleset: "2024", book: "D&D Beyond Basic Rules" });
    expect(at(193).ruleset).toBe("third-party");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/edition.test.ts`
Expected: FAIL with `Failed to resolve import "../src/source-snapshot.js"`.

- [ ] **Step 3: Write the script**

Create `scripts/dump-edition-renames.mts`:

```ts
// Regenerate src/source-snapshot.ts from the live game config, report source
// categories that src/edition.ts's category table doesn't place, and propose
// 2014 → 2024 rename pairs for src/edition-renames.ts.
//
//   npx tsx scripts/dump-edition-renames.mts                 # all three (needs ddb_login)
//   npx tsx scripts/dump-edition-renames.mts --snapshot-only # snapshot + category check, no login
//
// Candidates are evidence, not answers. Keep a pair only after reading both
// descriptions: same thing, same level/rarity/CR, text clearly a revision.
// Pairs already in EDITION_RENAMES no longer show up as orphans.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beginAuthenticatedSession } from "../src/session-fetch.js";
import {
  buildSourceIndex, classifyEdition, normalizeName, twinName, KNOWN_CATEGORY_IDS,
  type CategoryRecord, type EditionMarkers, type SourceIndex, type SourceRecord,
} from "../src/edition.js";
import { stripHtml } from "../src/utils.js";

const CONFIG_URL = "https://www.dndbeyond.com/api/config/json";
const CHARACTER_SERVICE = "https://character-service.dndbeyond.com";
const MONSTER_SERVICE = "https://monster-service.dndbeyond.com";
const SNAPSHOT_PATH = fileURLToPath(new URL("../src/source-snapshot.ts", import.meta.url));

type RawSource = { id: number; name: string; description?: string | null; sourceURL?: string | null; sourceCategoryId?: number | null };
type RawConfig = { sources?: RawSource[]; sourceCategories?: Array<{ id: number; name: string }> };
type Row = Record<string, unknown>;

// ── 1. Source snapshot (the config endpoint answers without login) ───────────

const cfgResp = await fetch(CONFIG_URL, { headers: { Accept: "application/json" } });
if (!cfgResp.ok) throw new Error(`Game config fetch failed: ${cfgResp.status} ${cfgResp.statusText}`);
const cfgJson = await cfgResp.json() as RawConfig & { data?: RawConfig };
const cfg = cfgJson.data ?? cfgJson;

const sources: SourceRecord[] = (cfg.sources ?? [])
  .map(s => ({
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    sourceURL: s.sourceURL ?? null,
    sourceCategoryId: s.sourceCategoryId ?? null,
  }))
  .sort((a, b) => a.id - b.id);
const categories: CategoryRecord[] = (cfg.sourceCategories ?? [])
  .map(c => ({ id: c.id, name: c.name }))
  .sort((a, b) => a.id - b.id);
if (!sources.length) throw new Error("Game config has no sources — refusing to write an empty snapshot");

const today = new Date().toISOString().slice(0, 10);
writeFileSync(SNAPSHOT_PATH, [
  `// Generated by scripts/dump-edition-renames.mts on ${today} — do not edit by hand.`,
  `// From ${CONFIG_URL} (sources, sourceCategories). game-config.ts merges the`,
  "// live config over it, so edition labels survive a D&D Beyond outage.",
  `import type { CategoryRecord, SourceRecord } from "./edition.js";`,
  "",
  `export const SNAPSHOT_DATE = "${today}";`,
  "",
  "export const SNAPSHOT_CATEGORIES: readonly CategoryRecord[] = [",
  ...categories.map(c => `  ${JSON.stringify(c)},`),
  "];",
  "",
  "export const SNAPSHOT_SOURCES: readonly SourceRecord[] = [",
  ...sources.map(s => `  ${JSON.stringify(s)},`),
  "];",
  "",
].join("\n"));
console.log(`Wrote ${sources.length} sources and ${categories.length} categories to src/source-snapshot.ts\n`);

// ── 2. Category check ────────────────────────────────────────────────────────

const unplaced = categories.filter(c => !KNOWN_CATEGORY_IDS.has(c.id));
if (unplaced.length) {
  console.log(`Categories missing from edition.ts's table (they classify as "edition not stated" until placed):`);
  for (const c of unplaced) {
    const books = sources.filter(s => s.sourceCategoryId === c.id).map(s => s.name).join(", ") || "no sources";
    console.log(`  ${c.id} ${c.name} — ${books}`);
  }
  console.log("");
} else {
  console.log("Every source category is placed in edition.ts's table.\n");
}
if (process.argv.includes("--snapshot-only")) process.exit(0);

// ── 3. Rename candidates (needs a logged-in session) ─────────────────────────

const index: SourceIndex = buildSourceIndex(sources, categories);

interface Entry extends EditionMarkers { kind: string; id: number; name: string; bucket: string; text: string }

const clean = (html: unknown) => stripHtml(typeof html === "string" ? html : "").replace(/\s+/g, " ").trim();

async function getJson(url: string): Promise<unknown> {
  // One authenticated session per request: the cobalt token is cached, and a
  // long monster scan can outlive a single token.
  const session = await beginAuthenticatedSession();
  const resp = await session.fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`${url} → ${resp.status} ${resp.statusText}`);
  return resp.json();
}

async function getList(url: string): Promise<Row[]> {
  const json = await getJson(url);
  const list = Array.isArray(json) ? json : (json as { data?: unknown }).data;
  return Array.isArray(list) ? list as Row[] : [];
}

function toEntry(kind: string, r: Row, o: { id?: string; name?: string; bucket?: (r: Row) => string; text?: (r: Row) => string } = {}): Entry | null {
  const id = r[o.id ?? "id"];
  const name = r[o.name ?? "name"];
  if (typeof id !== "number" || typeof name !== "string") return null;
  return {
    isHomebrew: r.isHomebrew as boolean | null | undefined,
    isLegacy: r.isLegacy as boolean | null | undefined,
    sourceId: r.sourceId as number | null | undefined,
    sources: r.sources as EditionMarkers["sources"],
    kind, id, name,
    bucket: o.bucket ? o.bucket(r) : kind,
    text: o.text ? o.text(r) : clean(r.description ?? r.snippet),
  };
}
const entries = (rows: Row[], f: (r: Row) => Entry | null) => rows.map(f).filter((x): x is Entry => x !== null);

async function loadSpells(): Promise<Entry[]> {
  const urls = ["spells", "always-known-spells"].flatMap(endpoint => [1, 2, 3, 4, 5, 6, 7, 8].map(classId =>
    `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=20&sharingSetting=2`));
  const rows = (await Promise.all(urls.map(getList))).flat().map(s => s.definition as Row).filter(Boolean);
  return entries(rows, r => toEntry("spell", r, { bucket: d => `level ${String(d.level)}` }));
}

async function loadSimple(kind: string, path: string, o: Parameters<typeof toEntry>[2] = {}): Promise<Entry[]> {
  return entries(await getList(`${CHARACTER_SERVICE}/character/v5/game-data/${path}`), r => toEntry(kind, r, o));
}

async function loadMonsters(): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let skip = 0; skip < 20_000; skip += 100) {
    const json = await getJson(`${MONSTER_SERVICE}/v1/Monster?search=&skip=${skip}&take=100`) as { data?: Row[]; pagination?: { total?: number } };
    const page = json.data ?? [];
    out.push(...entries(page, r => toEntry("monster", r, {
      bucket: m => `CR id ${String(m.challengeRatingId)}, type ${String(m.typeId)}`,
      text: m => clean(`${String(m.specialTraitsDescription ?? "")} ${String(m.actionsDescription ?? "")}`),
    })));
    if (page.length < 100 || skip + 100 >= (json.pagination?.total ?? 0)) break;
  }
  if (!out.length) console.log("WARNING: monster-service returned nothing for an empty search — monsters not checked.");
  return out;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}

function similarity(a: Set<string>, b: Set<string>): number {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  const union = a.size + b.size - both;
  return union ? both / union : 0;
}

function report(kind: string, loaded: Entry[]): void {
  const seen = new Set<number>();
  const all = loaded.filter(e => !seen.has(e.id) && seen.add(e.id));
  const rows = all.map(e => ({ e, info: classifyEdition(e, index), key: twinName(e.name), w: words(e.text) }));
  const keysOf = (ruleset: string) => new Set(rows.filter(x => x.info.ruleset === ruleset).map(x => x.key));
  const keys2024 = keysOf("2024");
  const keys2014 = keysOf("2014");
  const orphans2014 = rows.filter(x => x.info.ruleset === "2014" && !keys2024.has(x.key));
  const orphans2024 = rows.filter(x => x.info.ruleset === "2024" && !keys2014.has(x.key));
  console.log(`\n=== ${kind}: ${all.length} definitions; ${orphans2014.length} 2014 names with no 2024 twin; ${orphans2024.length} 2024 names with no 2014 twin ===`);

  for (const o of orphans2014) {
    const oName = normalizeName(o.e.name);
    const candidates = orphans2024
      .map(c => ({
        c,
        contains: normalizeName(c.e.name).includes(oName),
        sim: c.e.bucket === o.e.bucket ? similarity(o.w, c.w) : 0,
      }))
      .filter(x => x.contains || x.sim >= 0.5)
      .sort((a, b) => Number(b.contains) - Number(a.contains) || b.sim - a.sim)
      .slice(0, 3);
    if (!candidates.length) continue;
    console.log(`\n[${kind}] 2014 "${o.e.name}" (id ${o.e.id}, ${o.info.book ?? "unknown book"}, ${o.e.bucket})`);
    console.log(`    2014 text: ${o.e.text.slice(0, 600)}`);
    for (const { c, contains, sim } of candidates) {
      console.log(`  → 2024 "${c.e.name}" (id ${c.e.id}, ${c.info.book ?? "unknown book"}, ${c.e.bucket})${contains ? " name-contains" : ""} sim ${sim.toFixed(2)}`);
      console.log(`    2024 text: ${c.e.text.slice(0, 600)}`);
    }
  }
  console.log(`\n--- ${kind}: every 2014 name with no 2024 twin ---\n${orphans2014.map(o => o.e.name).sort().join(", ")}`);
}

const loaders: Array<[string, () => Promise<Entry[]>]> = [
  ["spell", loadSpells],
  ["item", () => loadSimple("item", "items?sharingSetting=2", { bucket: r => `rarity ${String(r.rarity)}` })],
  ["species", () => loadSimple("species", "races", { id: "entityRaceId", name: "fullName" })],
  ["class", () => loadSimple("class", "classes")],
  ["background", () => loadSimple("background", "backgrounds")],
  ["feat", () => loadSimple("feat", "feats")],
  ["monster", loadMonsters],
];
for (const [kind, load] of loaders) {
  try {
    report(kind, await load());
  } catch (e) {
    console.log(`\n=== ${kind}: FAILED — ${(e as Error).message} ===`);
  }
}
process.exit(0);
```

- [ ] **Step 4: Generate the snapshot (no login needed)**

Run: `npx tsx scripts/dump-edition-renames.mts --snapshot-only`
Expected: `Wrote 264 sources and 50 categories to src/source-snapshot.ts` (counts as of 2026-10-16; small changes are fine), then either "Every source category is placed…" or a list of unplaced categories. **If any category is unplaced, stop and report it to the owner** with its books. Don't guess a ruleset for it; until someone places it, it is correctly `unstated`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/edition.test.ts`
Expected: PASS. The "source snapshot" block pins live descriptions (verified 2026-10-16). If one of its book strings fails, first check whether D&D Beyond changed that book's description in the regenerated snapshot. If it did, update the expected string, and say so in the commit message. Never change `buildSourceIndex` to make a live string match.

- [ ] **Step 6: Document the refresh in CLAUDE.md**

In `CLAUDE.md`, directly after the bullet that starts `  - **Refreshing the language table**:`, add a top-level bullet:

```markdown
- **Refreshing the source snapshot and rename table**: run `npx tsx scripts/dump-edition-renames.mts` (needs `ddb_login`; `--snapshot-only` needs no login). It rewrites `src/source-snapshot.ts` from the live game config (commit it), reports any `sourceCategoryId` missing from the category table in `src/edition.ts` (place it there by hand — unknown categories classify "edition not stated"), and prints 2014→2024 rename candidates with evidence. Add a pair to `src/edition-renames.ts` only after reading both descriptions, with the evidence in a comment.
```

- [ ] **Step 7: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. If lint flags the generated file, fix the **generator** and regenerate. Never hand-edit the snapshot.

```bash
git add scripts/dump-edition-renames.mts src/source-snapshot.ts tests/edition.test.ts CLAUDE.md
git commit -m "feat(edition): source snapshot and rename-candidate generator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `src/game-config.ts` — move `getGameConfig`, add `getSourceIndex`

**Files:**
- Create: `src/game-config.ts`
- Modify: `src/tools/monster.ts:1-98` (header comment, imports, `CONFIG_URL`, invalidation hook, Game config section)
- Modify: `tests/monster.test.ts:237-239` (hook lookup)
- Test: `tests/game-config.test.ts`
- Check, no change expected: `tests/monster-session.test.ts`, `tests/session-consumers.test.ts`
- Modify: `CLAUDE.md` (key modules table, caching layers)

**Interfaces:**
- Consumes: `sessionFetch`, `captureSession`, `assertSessionCurrent`, `onSessionInvalidated` from `./session-fetch.js`; `buildSourceIndex`, `CategoryRecord`, `SourceIndex`, `SourceRecord` from `./edition.js`; `SNAPSHOT_CATEGORIES`, `SNAPSHOT_SOURCES` from `./source-snapshot.js`.
- Produces:
  - `CONFIG_URL: string`
  - `interface GameConfig`, unchanged from `monster.ts` and now exported
  - `interface GameSource { id: number; name: string; description: string | null; sourceURL: string | null; sourceCategoryId?: number }`, unchanged and now exported
  - `getGameConfig(): Promise<GameConfig | null>`, identical behaviour
  - `getSourceIndex(): Promise<SourceIndex>`. It never rejects: a malformed live source list falls back to the snapshot alone. It merges the live sources/categories over the snapshot, field by field (a live `null`/missing field falls back to the snapshot's), and caches one index per config object.

- [ ] **Step 1: Write the failing tests**

Create `tests/game-config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Every hook game-config.ts registers, so tests can fire a session transition.
const S = vi.hoisted(() => ({ hooks: [] as Array<() => void> }));

vi.mock("../src/session-fetch.js", () => ({
  sessionFetch: vi.fn(),
  captureSession: vi.fn(() => ({})),
  assertSessionCurrent: vi.fn(),
  onSessionInvalidated: vi.fn((cb: () => void) => { S.hooks.push(cb); }),
}));

// A tiny snapshot, so these tests don't depend on the generated file's contents.
vi.mock("../src/source-snapshot.js", () => ({
  SNAPSHOT_DATE: "2026-10-16",
  SNAPSHOT_CATEGORIES: [
    { id: 1, name: "5e Expanded Rules" },
    { id: 24, name: "5.5e Core Rules" },
    { id: 26, name: "5e Core Rules" },
  ],
  SNAPSHOT_SOURCES: [
    { id: 2, name: "PHB", description: "Player’s Handbook (2014)", sourceURL: "sources/dnd/phb-2014", sourceCategoryId: 26 },
    { id: 27, name: "XGtE", description: "Old Title", sourceURL: "sources/dnd/xgte", sourceCategoryId: 1 },
    { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024", sourceCategoryId: 24 },
  ],
}));

import { getGameConfig, getSourceIndex } from "../src/game-config.js";
import { sessionFetch, assertSessionCurrent } from "../src/session-fetch.js";

const response = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as unknown as Response;

const LIVE = {
  challengeRatings: [{ id: 1, value: 1, xp: 200, proficiencyBonus: 2 }],
  monsterTypes: [], alignments: [], senses: [],
  sources: [
    { id: 27, name: "XGtE", description: "Xanathar’s Guide to Everything", sourceURL: "sources/dnd/xgte", sourceCategoryId: 1 },
    // Live omits the category: the snapshot's must fill it.
    { id: 145, name: "PHB-2024", description: "Player’s Handbook", sourceURL: "sources/dnd/phb-2024" },
    { id: 300, name: "NEW-2024", description: "Brand New Book", sourceURL: "sources/dnd/new-2024", sourceCategoryId: 38 },
  ],
  sourceCategories: [{ id: 38, name: "5.5e Expanded Rules" }],
};

let configResponse: () => Response;

beforeEach(() => {
  vi.clearAllMocks();
  S.hooks.forEach(hook => hook());
  configResponse = () => response({ data: LIVE });
  vi.mocked(sessionFetch).mockImplementation(async () => configResponse());
  vi.mocked(assertSessionCurrent).mockImplementation(() => undefined);
});

describe("getSourceIndex", () => {
  it("uses the snapshot alone when the live config fetch fails", async () => {
    configResponse = () => response({}, 503);
    const index = await getSourceIndex();
    expect(index.sources.get(145)).toMatchObject({ categoryId: 24, book: "Player's Handbook (2024)" });
    expect(index.sources.get(27)?.book).toBe("Old Title");
    expect(index.sources.has(300)).toBe(false);
    expect(index.categories.get(24)).toBe("5.5e Core Rules");
  });

  it("uses the snapshot alone when the fetch throws", async () => {
    vi.mocked(sessionFetch).mockRejectedValue(new Error("network down"));
    const index = await getSourceIndex();
    expect(index.sources.get(2)?.book).toBe("Player's Handbook (2014)");
    expect(index.sources.has(300)).toBe(false);
  });

  it("merges the live config over the snapshot, field by field", async () => {
    const index = await getSourceIndex();
    expect(index.sources.get(27)?.book).toBe("Xanathar's Guide to Everything");     // live wins
    expect(index.sources.get(300)).toMatchObject({ categoryId: 38, book: "Brand New Book" }); // live-only
    expect(index.sources.get(145)?.categoryId).toBe(24);                             // snapshot fills the gap
    expect(index.sources.get(2)?.book).toBe("Player's Handbook (2014)");             // snapshot-only
    expect(index.categories.get(38)).toBe("5.5e Expanded Rules");
    expect(index.categories.get(26)).toBe("5e Core Rules");
  });

  it("uses snapshot sources when the live config has no source list", async () => {
    configResponse = () => response({ data: { ...LIVE, sources: undefined, sourceCategories: undefined } });
    const index = await getSourceIndex();
    expect(index.sources.get(145)?.book).toBe("Player's Handbook (2024)");
    expect(index.sources.has(300)).toBe(false);
  });

  it("degrades to the snapshot when the live source list is malformed", async () => {
    configResponse = () => response({ data: { ...LIVE, sources: [null, { id: 300 }], sourceCategories: "oops" } });
    const index = await getSourceIndex();
    expect(index.sources.get(145)?.book).toBe("Player's Handbook (2024)");
    configResponse = () => response({ data: { ...LIVE, sources: { not: "an array" } } });
    S.hooks.forEach(hook => hook());
    expect((await getSourceIndex()).sources.get(145)?.categoryId).toBe(24);
  });

  it("builds one index per config", async () => {
    const a = await getSourceIndex();
    const b = await getSourceIndex();
    expect(b).toBe(a);
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("does not keep a snapshot-only index once the live config recovers", async () => {
    configResponse = () => response({}, 503);
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
    configResponse = () => response({ data: LIVE });
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
  });

  it("drops the cached config and index on a session transition", async () => {
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    configResponse = () => response({}, 503);
    expect((await getSourceIndex()).sources.has(300)).toBe(true); // still cached
    S.hooks.forEach(hook => hook());
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
    expect(await getGameConfig()).toBeNull();
  });

  it("never caches a config fetched across an account change", async () => {
    vi.mocked(assertSessionCurrent).mockImplementationOnce(() => { throw new Error("session changed"); });
    expect((await getSourceIndex()).sources.has(300)).toBe(false);
    expect((await getSourceIndex()).sources.has(300)).toBe(true);
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/game-config.test.ts`
Expected: FAIL with `Failed to resolve import "../src/game-config.js"`.

- [ ] **Step 3: Create `src/game-config.ts`**

```ts
/**
 * game-config.ts — D&D Beyond's game config (CR table, monster types, sizes,
 * sources…) and the source index that edition labels classify against.
 *
 * getGameConfig() fetches https://www.dndbeyond.com/api/config/json with
 * session cookies and caches it until the next session transition (cleared
 * conservatively until its account independence is established).
 *
 * getSourceIndex() merges the live source list over the generated snapshot in
 * source-snapshot.ts, so edition labels and book names survive a D&D Beyond
 * outage. While the live config is unavailable, sources newer than the
 * snapshot classify as "edition not stated". It never rejects.
 */

import { sessionFetch, captureSession, assertSessionCurrent, onSessionInvalidated } from "./session-fetch.js";
import { buildSourceIndex, type CategoryRecord, type SourceIndex, type SourceRecord } from "./edition.js";
import { SNAPSHOT_CATEGORIES, SNAPSHOT_SOURCES } from "./source-snapshot.js";

export const CONFIG_URL = "https://www.dndbeyond.com/api/config/json";

export interface GameConfig {
  challengeRatings: Array<{ id: number; value: number; xp: number; proficiencyBonus: number }>;
  monsterTypes: Array<{ id: number; name: string }>;
  alignments: Array<{ id: number; name: string }>;
  senses: Array<{ id: number; name: string }>;
  sources?: GameSource[];
  sourceCategories?: Array<{ id: number; name: string }>;
  creatureSizes?: Array<{ id: number; name: string }>;
  languages?: Array<{ id: number; name: string }>;
}

export interface GameSource {
  id: number;
  name: string;
  description: string | null;
  sourceURL: string | null;
  sourceCategoryId?: number;
}

let configCache: GameConfig | null = null;
// Keyed by the config object it was built from (null = snapshot only), so a
// recovered or newly fetched config always rebuilds it.
let indexCache: { config: GameConfig | null; index: SourceIndex } | null = null;

// Registered once per module lifetime.
onSessionInvalidated(() => {
  configCache = null;
  indexCache = null;
});

export async function getGameConfig(): Promise<GameConfig | null> {
  // Boundary check before the early singleton return, so a pending transition
  // fires the invalidation hook (which nulls configCache) before we reuse it.
  const snapshot = captureSession();
  if (configCache) return configCache;
  try {
    const resp = await sessionFetch(CONFIG_URL);
    if (!resp.ok) return null;
    const json = await resp.json() as { data?: GameConfig } | GameConfig;
    const cfg = (json as { data?: GameConfig }).data ?? (json as GameConfig);
    if (cfg.challengeRatings) {
      // Don't cache one account's config into another account's generation.
      assertSessionCurrent(snapshot);
      configCache = cfg;
      return cfg;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSourceIndex(): Promise<SourceIndex> {
  const config = await getGameConfig();
  if (indexCache && indexCache.config === config) return indexCache.index;
  let index: SourceIndex;
  try {
    // The live config is untyped JSON: a non-array list or a null entry must
    // degrade to the snapshot, never reject.
    const liveSources = Array.isArray(config?.sources) ? config.sources : undefined;
    const liveCategories = Array.isArray(config?.sourceCategories) ? config.sourceCategories : undefined;
    index = buildSourceIndex(mergeSources(liveSources), mergeCategories(liveCategories));
  } catch {
    index = buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES);
  }
  indexCache = { config, index };
  return index;
}

/** Live sources over the snapshot, field by field: a missing live field keeps the snapshot's. */
function mergeSources(live: GameSource[] | undefined): SourceRecord[] {
  const merged = new Map<number, SourceRecord>(SNAPSHOT_SOURCES.map(s => [s.id, s]));
  for (const s of live ?? []) {
    const snap = merged.get(s.id);
    merged.set(s.id, {
      id: s.id,
      name: s.name ?? snap?.name ?? "",
      description: s.description ?? snap?.description ?? null,
      sourceURL: s.sourceURL ?? snap?.sourceURL ?? null,
      sourceCategoryId: s.sourceCategoryId ?? snap?.sourceCategoryId ?? null,
    });
  }
  return [...merged.values()];
}

function mergeCategories(live: Array<{ id: number; name: string }> | undefined): CategoryRecord[] {
  const merged = new Map<number, CategoryRecord>(SNAPSHOT_CATEGORIES.map(c => [c.id, c]));
  for (const c of live ?? []) merged.set(c.id, { id: c.id, name: c.name });
  return [...merged.values()];
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run tests/game-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Point `monster.ts` at the new module**

In `src/tools/monster.ts`:

(a) Replace header comment lines 8–9:

```ts
 * Game config (CR values, type names, etc.) is fetched from
 * https://www.dndbeyond.com/api/config/json and cached for 24 h.
```

with:

```ts
 * Game config (CR values, type names, sources, etc.) comes from
 * ../game-config.ts.
```

(b) Replace the import block at lines 12–15 (`sessionFetch` is no longer used here):

```ts
import {
  sessionFetch, beginAuthenticatedSession, hasValidSession,
  captureSession, assertSessionCurrent, onSessionInvalidated,
} from "../session-fetch.js";
```

with:

```ts
import {
  beginAuthenticatedSession, hasValidSession,
  captureSession, assertSessionCurrent, onSessionInvalidated,
} from "../session-fetch.js";
import { getGameConfig, type GameConfig, type GameSource } from "../game-config.js";
```

(c) Delete line 23: `const CONFIG_URL = "https://www.dndbeyond.com/api/config/json";`

(d) Replace the invalidation hook block (comment and call, lines 46–53):

```ts
// Drop account-derived monster + game-config state on every session transition.
// The monster service is gated by the cobalt token, and the game config is
// fetched with session cookies; `configCache` is cleared conservatively until
// its account independence is established. Registered once per module lifetime.
onSessionInvalidated(() => {
  monsterCache.clear();
  configCache = null;
});
```

with:

```ts
// Drop account-derived monster state on every session transition — the
// monster service is gated by the cobalt token. game-config.ts drops the game
// config itself. Registered once per module lifetime.
onSessionInvalidated(() => {
  monsterCache.clear();
});
```

(e) Delete the whole `// ── Game config ───…` section: the heading, `interface GameConfig`, `interface GameSource`, `let configCache`, and `async function getGameConfig()`. Stop just before the `// ── Helpers ───…` heading.

Then check that nothing else referenced the removed names:

Run: `grep -n "configCache\|CONFIG_URL\|sessionFetch" src/tools/monster.ts`
Expected: no output.

- [ ] **Step 6: Update the monster test's hook lookup**

`game-config.ts` now registers its hook first, when `monster.ts` imports it, so `mock.calls[0][0]` would only clear the game config. In `tests/monster.test.ts`, replace:

```ts
// monster.ts registers one invalidation hook at import; it is the only way to
// drop the module-level game-config singleton between tests.
const invalidateMonsterModule = vi.mocked(onSessionInvalidated).mock.calls[0][0] as () => void;
```

with:

```ts
// monster.ts and game-config.ts each register an invalidation hook at import;
// running them all is the only way to drop the module-level game-config
// singleton between tests.
const invalidationHooks = vi.mocked(onSessionInvalidated).mock.calls.map(call => call[0] as () => void);
const invalidateMonsterModule = () => invalidationHooks.forEach(hook => hook());
```

`tests/monster-session.test.ts` already collects every registered hook in `S.hooks`, so it needs no change. `tests/session-consumers.test.ts` uses the real session modules, so game-config's hook registers for real.

- [ ] **Step 7: Run the monster and session suites**

Run: `npx vitest run tests/monster.test.ts tests/monster-session.test.ts tests/session-consumers.test.ts tests/encounter.test.ts tests/treasure.test.ts`
Expected: PASS, with no other test edits. If a test fails because a hook did not run, find where it reads `mock.calls[0]` and apply the Step 6 pattern. Do not change any assertion.

- [ ] **Step 8: Update CLAUDE.md**

In the **Key modules** table in `CLAUDE.md`, add these rows directly after the `src/utils.ts` row:

```markdown
| `src/edition.ts` | Rules-edition foundation — pure, never imports a tool module. `classifyEdition(entry, index)` (2024 / 2014 / third-party / homebrew / playtest / unstated, by D&D Beyond `sourceCategoryId`; unknown categories are "unstated"), `twinName` + rename table, `selectByEdition` / `lookupByName` / `groupAndSelect` (2024 by default, the other edition with a reason), and **every** edition label string (`rulesLine`, `editionTag`, `searchHeader`/`searchFooter`, `sourceNote`, `renameLine`, `ambiguityMessage`, `characterRulesLine`). No tool builds its own edition text. Spec: [docs/superpowers/specs/2026-10-16-rules-edition-design.md](docs/superpowers/specs/2026-10-16-rules-edition-design.md) |
| `src/game-config.ts` | `getGameConfig()` (moved from `monster.ts`; same boundary checks, own invalidation hook) and `getSourceIndex()` — the live config's sources merged field-by-field over `src/source-snapshot.ts`, so labels survive a D&D Beyond outage. Never rejects |
| `src/source-snapshot.ts` | Generated by `scripts/dump-edition-renames.mts` — never edit by hand |
| `src/edition-renames.ts` | Verified `[name2014, name2024]` pairs (2024 side canonical), each with an evidence comment |
```

In **Caching layers**, add this bullet after the **Open5e responses** bullet:

```markdown
- **Game config / source index**: `game-config.ts` caches the config until the next session transition (failures are never cached) and one `SourceIndex` per config object, so a recovered config always rebuilds the index; both are dropped by its `onSessionInvalidated` hook
```

- [ ] **Step 9: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/game-config.ts src/tools/monster.ts tests/game-config.test.ts tests/monster.test.ts CLAUDE.md
git commit -m "refactor(game-config): move getGameConfig out of monster.ts, add getSourceIndex

The source index merges the live game config over the generated snapshot,
so edition labels survive a D&D Beyond outage. No tool output changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Run the rename script, commit verified pairs, close out phase 1

**Files:**
- Modify: `src/edition-renames.ts` (verified pairs only)
- Regenerate: `src/source-snapshot.ts`
- Modify: `CLAUDE.md` (Next steps)

**Interfaces:**
- Consumes (Task 4): `scripts/dump-edition-renames.mts`. Consumes (Task 2): the `EDITION_RENAMES` table tests.
- Produces: the populated `EDITION_RENAMES`. Phase 2's "Acid Arrow resolves through the rename table" depends on this pair being committed, if it verifies.

This task needs a logged-in D&D Beyond session (`~/.config/ddb-mcp/session.json`). If the script fails with `No session found` or a cobalt-token error, **stop and ask the owner to run `ddb_login`**. Do not fake the run.

- [ ] **Step 1: Run the full script and keep its output**

Run: `npx tsx scripts/dump-edition-renames.mts > "$TMPDIR/edition-renames-candidates.txt" 2>&1; tail -40 "$TMPDIR/edition-renames-candidates.txt"`
Expected: a `=== <kind>: … ===` summary line for each of spell, item, species, class, background, feat and monster. A `FAILED` line for one kind is acceptable: note it in the commit message. Also review the category check at the top again.

- [ ] **Step 2: Verify candidates and fill the table**

Read the candidates for each kind in the output file. For each one, keep the pair **only if all three hold**:
1. It is the same thing (same spell, item, creature, feat…), not merely a similar one.
2. It has the same level / rarity / CR / type (shown in the bucket).
3. The 2024 text is clearly a revision of the 2014 text.

When in doubt, leave the pair out. A missing pair is visible in the output and costs one line to fix later. A wrong pair silently merges two different things.

Add each kept pair to `src/edition-renames.ts`, grouped by kind, with its evidence on the line above:

```ts
export const EDITION_RENAMES: ReadonlyArray<readonly [name2014: string, name2024: string]> = [
  // ── Spells ──
  // 2014 id <id> (<book>, level <n>) → 2024 id <id> (<book>, level <n>); name-contains, sim <x>: <one-line reason>
  ["<2014 name>", "<2024 name>"],
];
```

Fill in the real values from the script output. The tests reject a duplicated 2014 name, a self-map, or a chain.

- [ ] **Step 3: Re-run and confirm the kept pairs are gone from the orphan lists**

Run: `npx tsx scripts/dump-edition-renames.mts > "$TMPDIR/edition-renames-after.txt" 2>&1; grep "^===" "$TMPDIR/edition-renames-after.txt"`
Expected: each kind's "2014 names with no 2024 twin" count has dropped by the number of pairs kept for that kind. This run also refreshes `src/source-snapshot.ts` (usually only `SNAPSHOT_DATE` changes).

- [ ] **Step 4: Mark phase 1 done in CLAUDE.md**

In `CLAUDE.md` › **Next steps (known issues)**:

(a) Replace the sentence that begins `Last updated 2026-10-16, after PR #58` with:

```markdown
Last updated 2026-10-16, after phase 1 (foundation) of the rules-edition spec landed: `src/edition.ts`, `src/game-config.ts`, `src/source-snapshot.ts`, `src/edition-renames.ts`, `scripts/dump-edition-renames.mts`. No tool output changed.
```

(b) At the end of work item 1's first paragraph (the one ending `This covers the spell-edition collision below.`), append:

```markdown
**Phase 1 (foundation) is done.** Phase 2 is next; write its plan against the real `src/edition.ts`, whose signatures differ from the spec's sketch in places (see "Signatures that differ from the spec's sketch" in [the phase-1 plan](docs/superpowers/plans/2026-10-16-rules-edition-phase-1-foundation.md)). The rename table holds N verified pairs; owner review of them is asynchronous and does not block phase 2.
```

Replace `N` with the actual count.

- [ ] **Step 5: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/edition-renames.ts src/source-snapshot.ts CLAUDE.md
git commit -m "feat(edition): verified 2014→2024 rename pairs; phase 1 done

<one line per kind: pairs kept / candidates reviewed, and any kind whose
fetch FAILED>

Phase 1 changes no tool output, so there are no live Rules: lines to record.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Report to the owner**

Tell the owner:
- how many pairs you kept per kind, and the file to review asynchronously (`src/edition-renames.ts`);
- any unplaced source categories the script reported;
- that phase 2 needs its own plan.

Do not push unless asked.
