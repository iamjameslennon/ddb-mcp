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
