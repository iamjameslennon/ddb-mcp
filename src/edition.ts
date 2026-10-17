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
import { EDITION_RENAMES } from "./edition-renames.js";

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
  sources?: ReadonlyArray<{ sourceId?: number | null } | null | undefined> | null;
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
    if (book && isEdition(ruleset) && !YEAR_SUFFIX.test(book)) {
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
  for (const id of [entry.sourceId, ...(entry.sources ?? []).map(s => s?.sourceId)]) {
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

// ── Twin names ────────────────────────────────────────────────────────────────

/** Lowercase, curly apostrophes folded to "'", whitespace collapsed, trimmed. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/**
 * A twin-name function. `spell` maps the normalized form of either side of a
 * rename pair to that side's spelling in the table, so output can use it.
 */
export type TwinNamer = ((name: string) => string) & {
  spell?: (normalizedName: string) => string | undefined;
  /** Every table spelling in the name's twin group, the given name first. */
  aliases?: (name: string) => string[];
};

/** A twin-name function over a rename table: normalizes, then maps a 2014 name to its 2024 name. */
export function createTwinNamer(pairs: ReadonlyArray<readonly [string, string]>): TwinNamer {
  const renames = new Map(pairs.map(([name2014, name2024]) => [normalizeName(name2014), normalizeName(name2024)]));
  const spellings = new Map<string, string>();
  for (const [name2014, name2024] of pairs) {
    spellings.set(normalizeName(name2014), name2014);
    spellings.set(normalizeName(name2024), name2024);
  }
  const namer: TwinNamer = name => {
    const n = normalizeName(name);
    return renames.get(n) ?? n;
  };
  namer.spell = normalized => spellings.get(normalized);
  namer.aliases = name => {
    const key = namer(name);
    const out = [name];
    const seen = new Set([normalizeName(name)]);
    for (const [name2014, name2024] of pairs) {
      for (const spelling of [name2014, name2024]) {
        const n = normalizeName(spelling);
        if (namer(spelling) === key && !seen.has(n)) {
          seen.add(n);
          out.push(spelling);
        }
      }
    }
    return out;
  };
  return namer;
}

/** The twin key for spells, items, monsters, feats, backgrounds, species and classes. */
export const twinName: TwinNamer = createTwinNamer(EDITION_RENAMES);

/**
 * Every spelling of a name's twin group, the name as given first, so a caller
 * that searches D&D Beyond by name can query each (Thug and Tough are one
 * creature, but a search for one never returns the other). Just `[name]` when
 * the name has no twin or the namer has no alias support.
 */
export function twinAliases(name: string, namer: TwinNamer = twinName): string[] {
  return namer.aliases ? namer.aliases(name) : [name];
}

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
  twinName?: TwinNamer;
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
  const namer: TwinNamer = opts.twinName ?? twinName;
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

  // No entry carries the typed name: use the table's spelling, else the query cleaned up but not lowercased.
  const typedName = namer.spell?.(normalizedQuery) ?? query.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  const matchedName = matched ? opts.name(matched) : typedName;
  const returnedName = opts.name(picked.entry);
  if (normalizeName(matchedName) === normalizeName(returnedName)) return picked;
  // Non-edition entries are never twins, so they never get a rename line.
  if (!isEdition(opts.info(picked.entry).ruleset)) return picked;
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
 * entry → count the groups where the OTHER rules_edition would list an
 * entry: selecting from the group's edition entries for the other edition must
 * yield an entry of that ruleset (not a fallback) that passes the attribute
 * filters. At most one per group, matching what switching would show. The
 * name filter is per group, so a twin counts as hidden even if only its
 * partner's name matched: the other rules_edition would list it for the same
 * query. Same-edition duplicates are not shown and not counted.
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
      const otherEdition = requested === "2024" ? "2014" : "2024";
      // A fallback pick (this group has only the other edition) is not hidden: the other request shows the same entry.
      if (info.ruleset !== otherEdition) {
        const other = selectByEdition(editions, otherEdition, opts.info, opts.tiebreak);
        if (other && opts.info(other.entry).ruleset === otherEdition && passes(other.entry)) hidden++;
      }
    }
    const nonEdition = group.filter(x => !isEdition(opts.info(x).ruleset)).sort(opts.tiebreak);
    for (const x of nonEdition) {
      if (passes(x)) selected.push({ entry: x, info: opts.info(x) });
    }
  }
  return { selected, hidden };
}

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
