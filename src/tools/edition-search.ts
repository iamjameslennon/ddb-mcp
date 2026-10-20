/**
 * edition-search.ts — the search/lookup pipeline every catalog tool shares
 * (spells, items, species, classes, backgrounds, feats, class features, racial
 * traits). A tool supplies a CatalogAdapter; this module chooses the edition,
 * hides and counts the other edition's twins, names the book when one edition
 * has several versions, and applies a `source` book filter. All label text
 * comes from src/edition.ts.
 *
 * Two selection modes:
 * - flat (no `groupKey`, no `owner`): one entry per twin group, exactly
 *   groupAndSelect's semantics (with `countFilteredPicks`);
 * - nested (`groupKey` and/or `owner`): filter first, then choose one edition
 *   per edition group, picking whole owners (a class, subclass or species)
 *   rather than single entries. See selectCatalog.
 */

import {
  classifyEdition, editionSourceId, editionTag, isEdition, groupAndSelect, lookupByName, definitionTiebreak,
  rulesLine, renameLine, sourceNote, searchHeader, bookChoiceNote, alsoInLine,
  type EditionInfo, type EditionMarkers, type RulesEdition, type SourceIndex, type TiebreakFields,
} from "../edition.js";
import { inSources, sourceLabel, type ResolvedSource } from "../source-filter.js";

// ── Sections ──────────────────────────────────────────────────────────────────

/** One search's output in parts, so ddb_search_site can merge several under one header and footer. */
export interface SearchSection { header: string | null; body: string; footer: string | null; hidden: number }

export function renderSection(s: SearchSection): string {
  return [s.header, s.body, s.footer].filter((p): p is string => p !== null).join("\n");
}

/** A reply with no edition framing: an error, a no-match message or an Open5e fallback. */
export function plainSection(text: string): SearchSection {
  return { header: null, body: text, footer: null, hidden: 0 };
}

/**
 * The tool's heading (`**X Search** …`), one page of formatted lines, and a
 * "Use offset" hint. `note` is appended verbatim right after the heading line
 * (it carries its own blank lines). Empty string when there are no items.
 */
export function paginateResults<T>(
  label: string,
  items: T[],
  format: (item: T) => string,
  limit = 30,
  offset = 0,
  note?: string,
): string {
  const total = items.length;
  if (total === 0) return "";

  const page = items.slice(offset, offset + limit);
  const header = total > limit
    ? `**${label} Search** — showing ${offset + 1}–${offset + page.length} of ${total}`
    : `**${label} Search** (${total} found)`;

  const lines = [header + "\n" + (note ?? ""), ...page.map(format)];
  if (total > offset + limit) {
    lines.push(`\n*Use offset: ${offset + limit} to see more.*`);
  }
  return lines.join("\n");
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/** What an entry belongs to in nested mode: entries sharing an owner id are picked together. */
export interface CatalogOwner { id: string; markers: EditionMarkers; tiebreak: TiebreakFields }

export interface CatalogAdapter<T> {
  /** The entry's own classification: its tag and the source filter. */
  markers: (t: T) => EditionMarkers;
  /** Versions of one thing (with `owner`: the owner's twin key). */
  twinKey: (t: T) => string;
  tiebreak: (a: T, b: T) => number;
  /** Display order of the result; `tiebreak` orders its ties. */
  compare: (a: T, b: T) => number;
  /** Flat mode: per twin group. Nested mode: per twin group without `owner`, per entry with it. */
  nameMatches?: (t: T) => boolean;
  /** Flat mode: per selected entry. Nested mode: per entry. */
  passes?: (t: T) => boolean;
  /** Nested mode: one edition is chosen per group (default twinKey). */
  groupKey?: (t: T) => string;
  /** Nested mode: entries sharing an owner id are picked together. */
  owner?: (t: T) => CatalogOwner;
}

export interface CatalogHit<T> { entry: T; info: EditionInfo; label: string }
export interface CatalogSelection<T> { hits: CatalogHit<T>[]; hidden: number; header: string; note: string | null }

export interface SelectOptions {
  /** Name the chosen book when one edition has several versions (default true). ddb_search_site, which has no `source` param, turns it off. */
  bookNotes?: boolean;
}

// ── Book choice ───────────────────────────────────────────────────────────────

/**
 * The books of a pick's same-edition alternatives that differ from the pick's
 * own book, as source labels; null when the pick has no known source (no note).
 */
function bookChoice<U>(
  pick: U,
  alternatives: readonly U[] | undefined,
  markers: (u: U) => EditionMarkers,
  index: SourceIndex,
): { chosen: string; others: string[] } | null {
  if (!alternatives?.length) return null;
  const pickId = editionSourceId(markers(pick), index);
  if (pickId == null) return null;
  const chosen = sourceLabel(index, pickId);
  const others: string[] = [];
  for (const alt of alternatives) {
    const id = editionSourceId(markers(alt), index);
    if (id == null) continue;
    const label = sourceLabel(index, id);
    if (label !== chosen && !others.includes(label)) others.push(label);
  }
  return others.length ? { chosen, others } : null;
}

/** " · <chosen> (also in … — pass source to choose)", or "" when there is no other book. */
function bookNoteSuffix<U>(pick: U, alternatives: readonly U[] | undefined, markers: (u: U) => EditionMarkers, index: SourceIndex): string {
  const choice = bookChoice(pick, alternatives, markers, index);
  return choice ? " " + bookChoiceNote(choice.chosen, choice.others) : "";
}

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * A `source` search's framing: the search header naming the book (the
 * lowest-id one, see resolveSource), and the source note when the book's
 * edition differs from `requested`. Shared by selectCatalog and monster search.
 */
export function sourceFraming(
  source: ResolvedSource,
  requested: RulesEdition,
  index: SourceIndex,
): { header: string; note: string | null } {
  const bookRuleset = classifyEdition({ sources: source.ids.map(sourceId => ({ sourceId })) }, index).ruleset;
  return {
    header: searchHeader({ sourceBook: source.book }),
    note: isEdition(bookRuleset) ? sourceNote(source.query, bookRuleset, requested) : null,
  };
}

/**
 * Choose what a catalog search lists. Without `source`, flat mode is
 * groupAndSelect, also counting a group whose requested pick fails the
 * filters while the other edition's passes; nested mode filters first and
 * then picks per edition group (selectNested). With `source`, every entry in
 * the book that passes the filters is listed with its own tag: no grouping,
 * no hiding. Hits are sorted by `compare`, its ties broken by `tiebreak`
 * (official → non-Legacy → lowest id), and with `owner` (and no `source`)
 * first by the owner's ruleset: the requested edition, the other, then
 * non-edition owners. Paging is the caller's.
 */
export function selectCatalog<T>(
  all: readonly T[],
  requested: RulesEdition,
  adapter: CatalogAdapter<T>,
  index: SourceIndex,
  source?: ResolvedSource,
  options: SelectOptions = {},
): CatalogSelection<T> {
  const info = (t: T) => classifyEdition(adapter.markers(t), index);
  // Equal display names (a 2024 entry and a homebrew one, two homebrew
  // entries) would otherwise keep payload order.
  const order = (a: T, b: T) => adapter.compare(a, b) || adapter.tiebreak(a, b);

  if (source) {
    const hits = all
      .filter(t => inSources(adapter.markers(t), source.ids)
        && (adapter.nameMatches?.(t) ?? true) && (adapter.passes?.(t) ?? true))
      .sort(order)
      .map(entry => { const i = info(entry); return { entry, info: i, label: editionTag(i) }; });
    return { hits, hidden: 0, ...sourceFraming(source, requested, index) };
  }

  const bookNotes = options.bookNotes ?? true;
  const nested = adapter.groupKey !== undefined || adapter.owner !== undefined;
  const { hits, hidden } = nested
    ? selectNested(all, requested, adapter, index, bookNotes)
    : selectFlat(all, requested, adapter, index, bookNotes);
  const owner = adapter.owner;
  if (owner) {
    const band = new Map(hits.map(h => {
      const ruleset = classifyEdition(owner(h.entry).markers, index).ruleset;
      return [h, ruleset === requested ? 0 : isEdition(ruleset) ? 1 : 2];
    }));
    hits.sort((a, b) => band.get(a)! - band.get(b)! || order(a.entry, b.entry));
  } else {
    hits.sort((a, b) => order(a.entry, b.entry));
  }
  return { hits, hidden, header: searchHeader({ requested }), note: null };
}

function selectFlat<T>(
  all: readonly T[],
  requested: RulesEdition,
  adapter: CatalogAdapter<T>,
  index: SourceIndex,
  bookNotes: boolean,
): { hits: CatalogHit<T>[]; hidden: number } {
  const passes = adapter.passes;
  const { selected, hidden } = groupAndSelect(all, requested, {
    info: t => classifyEdition(adapter.markers(t), index),
    twinKey: adapter.twinKey,
    tiebreak: adapter.tiebreak,
    nameMatches: adapter.nameMatches,
    passes,
    countFilteredPicks: true,
  });
  const hits = selected.map(sel => {
    // Only a version the filters let through is a real alternative for the note.
    const alternatives = passes ? sel.alternatives?.filter(passes) : sel.alternatives;
    return {
      entry: sel.entry,
      info: sel.info,
      label: editionTag(sel.info) + (bookNotes ? bookNoteSuffix(sel.entry, alternatives, adapter.markers, index) : ""),
    };
  });
  return { hits, hidden };
}

/** What nested mode picks: an owner with its kept entries, or (without `owner`) one kept entry. */
interface Unit<T> {
  entries: T[];
  /** The unit's own markers: the owner's, or the entry's. */
  markers: EditionMarkers;
  ruleset: EditionInfo["ruleset"];
  twinKey: string;
  groupKey: string;
  /** For ordering without `owner`. */
  first: T;
  owner?: CatalogOwner;
}

/**
 * Nested mode, without `source`:
 * 1. filter: with `owner`, each entry must match `nameMatches` and `passes`;
 *    without it, a twin group matches when any entry matches `nameMatches`
 *    (rename-aware, as flat mode) and its entries must pass `passes`;
 * 2. units from the kept entries only (an owner with nothing kept is not a unit):
 *    one per owner id, else one per entry;
 * 3. per edition group (`groupKey`, default `twinKey`): non-edition units are
 *    listed as they are; the edition is `requested` when any unit has it, else
 *    the other; per twin key of that edition the first unit in order is
 *    picked, the rest are its alternatives (the book note);
 * 4. every kept entry of a listed unit is a line, tagged by its own markers;
 * 5. hidden counts the lines the other edition would list, only when the
 *    requested edition was chosen.
 */
function selectNested<T>(
  all: readonly T[],
  requested: RulesEdition,
  adapter: CatalogAdapter<T>,
  index: SourceIndex,
  bookNotes: boolean,
): { hits: CatalogHit<T>[]; hidden: number } {
  const passes = adapter.passes ?? (() => true);
  const groupKeyOf = adapter.groupKey ?? adapter.twinKey;

  let kept: T[];
  if (adapter.owner) {
    kept = all.filter(t => (adapter.nameMatches?.(t) ?? true) && passes(t));
  } else {
    const nameMatches = adapter.nameMatches;
    const matching = nameMatches ? new Set(all.filter(nameMatches).map(adapter.twinKey)) : null;
    kept = all.filter(t => (!matching || matching.has(adapter.twinKey(t))) && passes(t));
  }

  const units: Unit<T>[] = [];
  const byOwner = new Map<string, Unit<T>>();
  for (const t of kept) {
    const owner = adapter.owner?.(t);
    const existing = owner ? byOwner.get(owner.id) : undefined;
    if (existing) {
      existing.entries.push(t);
      continue;
    }
    const markers = owner ? owner.markers : adapter.markers(t);
    const unit: Unit<T> = {
      entries: [t],
      markers,
      ruleset: classifyEdition(markers, index).ruleset,
      twinKey: adapter.twinKey(t),
      groupKey: groupKeyOf(t),
      first: t,
      owner,
    };
    units.push(unit);
    if (owner) byOwner.set(owner.id, unit);
  }

  const order = (a: Unit<T>, b: Unit<T>) => (a.owner && b.owner
    ? definitionTiebreak(a.owner.tiebreak, b.owner.tiebreak)
    : adapter.tiebreak(a.first, b.first));
  const linesOf = (unit: Unit<T>, note: string) => unit.entries.map(entry => {
    const i = classifyEdition(adapter.markers(entry), index);
    return { entry, info: i, label: editionTag(i) + note };
  });
  const byTwinKey = (us: Unit<T>[]) => {
    const subgroups = new Map<string, Unit<T>[]>();
    for (const u of us) {
      const sub = subgroups.get(u.twinKey);
      if (sub) sub.push(u);
      else subgroups.set(u.twinKey, [u]);
    }
    return [...subgroups.values()].map(sub => sub.sort(order));
  };

  const groups = new Map<string, Unit<T>[]>();
  for (const u of units) {
    const group = groups.get(u.groupKey);
    if (group) group.push(u);
    else groups.set(u.groupKey, [u]);
  }

  const hits: CatalogHit<T>[] = [];
  let hidden = 0;
  for (const group of groups.values()) {
    for (const u of group) if (!isEdition(u.ruleset)) hits.push(...linesOf(u, ""));
    const editions = group.filter(u => isEdition(u.ruleset));
    if (!editions.length) continue;
    const other: RulesEdition = requested === "2024" ? "2014" : "2024";
    const chosen = editions.some(u => u.ruleset === requested) ? requested : other;
    for (const [pick, ...alternatives] of byTwinKey(editions.filter(u => u.ruleset === chosen))) {
      hits.push(...linesOf(pick, bookNotes ? bookNoteSuffix(pick, alternatives, u => u.markers, index) : ""));
    }
    if (chosen === requested) {
      for (const [first] of byTwinKey(editions.filter(u => u.ruleset === other))) hidden += first.entries.length;
    }
  }
  return { hits, hidden };
}

// ── Lookup ────────────────────────────────────────────────────────────────────

/**
 * A single lookup (get_*): lookupByName over the catalog, or over the book's
 * entries when `source` is given. `rulesLines` go directly under the title, one
 * line per element: the rules line (and, without `source`, its reason), a
 * rename line, then either the source note (the shown entry's ruleset against
 * `requested`) or an "also in" line naming other books with a same-edition version.
 */
export function lookupCatalog<T>(
  all: readonly T[],
  query: string,
  requested: RulesEdition,
  adapter: CatalogAdapter<T> & { name: (t: T) => string },
  index: SourceIndex,
  source?: ResolvedSource,
): { entry: T; info: EditionInfo; rulesLines: string[] } | null {
  const info = (t: T) => classifyEdition(adapter.markers(t), index);
  const pool = source ? all.filter(t => inSources(adapter.markers(t), source.ids)) : all;
  const found = lookupByName(pool, query, requested, { name: adapter.name, info, tiebreak: adapter.tiebreak });
  if (!found) return null;

  const shown = info(found.entry);
  const rulesLines = rulesLine(shown, { reason: source ? undefined : found.reason }).split("\n");
  if (found.renamed) rulesLines.push(renameLine(found.renamed.name2014, found.renamed.name2024));
  if (source) {
    const note = isEdition(shown.ruleset) ? sourceNote(source.query, shown.ruleset, requested) : null;
    if (note) rulesLines.push(note);
  } else {
    const choice = bookChoice(found.entry, found.alternatives, adapter.markers, index);
    if (choice) rulesLines.push(alsoInLine(choice.others));
  }
  return { entry: found.entry, info: shown, rulesLines };
}
