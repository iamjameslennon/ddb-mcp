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
 *
 * An adapter with `dualEdition` (items) classifies with the dual-edition rule
 * (decision 4, the rule character sheets use): a non-Legacy, non-homebrew
 * definition with a 2024 book and a 2014 book takes the requested edition and
 * that edition's book. Under a `source` the book's edition decides when it is
 * 2024 or 2014. A dual definition alone in its twin group is therefore listed
 * under either edition with no reason line and is never counted as hidden.
 * But a non-dual entry of that edition beats a dual one (owner ruling
 * 2026-10-28, option B): when the dual definition's twin group holds one that
 * passes the filters (a Legacy 2014 printing: Efficient Quiver, Robe of the
 * Archmagi), the dual definition classifies as classifyEdition does, so those
 * groups select exactly as without the rule. Under a `source` only the book's
 * entries count (B within the book). See classifier().
 */

import {
  classifyEdition, classifyForEdition, editionSourceId, editionSourceIdFor, editionTag, isDualEdition, isEdition, groupAndSelect, lookupByName, definitionTiebreak,
  rulesLine, renameLine, sourceNote, searchHeader, bookChoiceNote, alsoInLine, HOMEBREW_INFO, HOMEBREW_SOURCE_BOOK,
  type EditionInfo, type EditionMarkers, type RulesEdition, type SourceIndex, type TiebreakFields, type TwinNamer,
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
  // An offset at or past the end would print an inverted range ("showing 31–30 of 20").
  if (offset >= total) {
    const line = `**${label} Search** — offset ${offset} is past the end (${total} found)`;
    return note ? `${line}\n${note}` : line;
  }

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
  /** Classify with the dual-edition rule (classifyForEdition) rather than classifyEdition. */
  dualEdition?: boolean;
}

/**
 * An adapter for single lookups: the entry's name and the content kind's twin
 * namer (`twinNames[kind]`), so a get reaches only its own kind's renames. It
 * has no `twinKey` of its own: lookupCatalogAdapter derives it from these two,
 * so a search and a get of one catalog can't twin by different namers.
 */
export interface LookupAdapter<T> extends Omit<CatalogAdapter<T>, "twinKey"> {
  name: (t: T) => string;
  twinName: TwinNamer;
}

/** A lookup adapter as a catalog adapter: its twin key is always `twinName(name(t))`. */
export function lookupCatalogAdapter<T>(adapter: LookupAdapter<T>): CatalogAdapter<T> & LookupAdapter<T> {
  return { ...adapter, twinKey: t => adapter.twinName(adapter.name(t)) };
}

export interface CatalogHit<T> { entry: T; info: EditionInfo; label: string }
export interface CatalogSelection<T> { hits: CatalogHit<T>[]; hidden: number; header: string; note: string | null }

export interface SelectOptions {
  /** Name the chosen book when one edition has several versions (default true). ddb_search_site, which has no `source` param, turns it off. */
  bookNotes?: boolean;
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * How one call classifies: an entry's ruleset and book, and that book's source
 * id; `markers*` do the same for an owner's markers (nested mode).
 */
interface Classifier<T> {
  info: (t: T) => EditionInfo;
  sourceId: (t: T) => number | null;
  markersInfo: (m: EditionMarkers) => EditionInfo;
  markersSourceId: (m: EditionMarkers) => number | null;
}

/** The ruleset of a `source` book: what its resolved ids classify as together. */
function sourceRuleset(source: ResolvedSource, index: SourceIndex): EditionInfo["ruleset"] {
  return classifyEdition({ sources: source.ids.map(sourceId => ({ sourceId })) }, index).ruleset;
}

/**
 * Plain classifyEdition, or with `dualEdition` the dual-edition rule for the
 * call's edition: `requested`, or under a `source` the book's edition when it
 * is 2024 or 2014.
 *
 * Option B: a dual entry keeps its plain classification when its twin group
 * holds a non-dual entry of that edition. The scan covers the entries in
 * scope (under a `source`, only the book's entries: "B within the book") that
 * pass the adapter's `passes` filter, so a Legacy twin the filters reject
 * does not demote the dual entry. That matches countFilteredPicks: when only
 * the dual entry passes, both editions would list that same entry, so it is
 * listed, not counted as hidden. The exceptions are a set of entries, so an
 * adapter's `markers` may return a fresh object each call.
 */
function classifier<T>(
  all: readonly T[],
  adapter: CatalogAdapter<T>,
  index: SourceIndex,
  requested: RulesEdition,
  source?: ResolvedSource,
): Classifier<T> {
  if (!adapter.dualEdition) {
    const info = (m: EditionMarkers) => classifyEdition(m, index);
    const sourceId = (m: EditionMarkers) => editionSourceId(m, index);
    return { info: t => info(adapter.markers(t)), sourceId: t => sourceId(adapter.markers(t)), markersInfo: info, markersSourceId: sourceId };
  }
  const bookRuleset = source ? sourceRuleset(source, index) : null;
  const edition = bookRuleset && isEdition(bookRuleset) ? bookRuleset : requested;

  const scope = source ? all.filter(t => inSources(adapter.markers(t), source.ids)) : all;
  const passes = adapter.passes ?? (() => true);
  const duals: T[] = [];
  const singleEditionKeys = new Set<string>();
  for (const t of scope) {
    const m = adapter.markers(t);
    if (isDualEdition(m, index)) duals.push(t);
    else if (classifyEdition(m, index).ruleset === edition && passes(t)) singleEditionKeys.add(adapter.twinKey(t));
  }
  const plainDual = new Set<T>(duals.filter(t => singleEditionKeys.has(adapter.twinKey(t))));

  const markersInfo = (m: EditionMarkers) => classifyForEdition(m, index, edition);
  const markersSourceId = (m: EditionMarkers) => editionSourceIdFor(m, index, edition);
  return {
    info: t => plainDual.has(t) ? classifyEdition(adapter.markers(t), index) : markersInfo(adapter.markers(t)),
    sourceId: t => plainDual.has(t) ? editionSourceId(adapter.markers(t), index) : markersSourceId(adapter.markers(t)),
    markersInfo,
    markersSourceId,
  };
}

// ── Book choice ───────────────────────────────────────────────────────────────

/**
 * The books of a pick's same-edition alternatives that differ from the pick's
 * own book, as source labels; null when the pick has no known source (no note).
 */
function bookChoice<U>(
  pick: U,
  alternatives: readonly U[] | undefined,
  sourceId: (u: U) => number | null,
  index: SourceIndex,
): { chosen: string; others: string[] } | null {
  if (!alternatives?.length) return null;
  const pickId = sourceId(pick);
  if (pickId == null) return null;
  const chosen = sourceLabel(index, pickId);
  const others: string[] = [];
  for (const alt of alternatives) {
    const id = sourceId(alt);
    if (id == null) continue;
    const label = sourceLabel(index, id);
    if (label !== chosen && !others.includes(label)) others.push(label);
  }
  return others.length ? { chosen, others } : null;
}

/** " · <chosen> (also in … — pass source to choose)", or "" when there is no other book. */
function bookNoteSuffix<U>(
  pick: U,
  alternatives: readonly U[] | undefined,
  sourceId: (u: U) => number | null,
  index: SourceIndex,
): string {
  const choice = bookChoice(pick, alternatives, sourceId, index);
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
  const bookRuleset = sourceRuleset(source, index);
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
  source?: ResolvedSource | "homebrew",
  options: SelectOptions = {},
): CatalogSelection<T> {
  const order = (a: T, b: T) => adapter.compare(a, b) || adapter.tiebreak(a, b);
  if (source === "homebrew") {
    // Reserved source: homebrew entries only, labelled homebrew whatever their
    // books say (so no dual-edition rule), no grouping, hiding or source note.
    const hits = all
      .filter(t => adapter.markers(t).isHomebrew === true
        && (adapter.nameMatches?.(t) ?? true) && (adapter.passes?.(t) ?? true))
      .sort(order)
      .map(entry => ({ entry, info: HOMEBREW_INFO, label: editionTag(HOMEBREW_INFO) }));
    return { hits, hidden: 0, header: searchHeader({ sourceBook: HOMEBREW_SOURCE_BOOK }), note: null };
  }
  const classify = classifier(all, adapter, index, requested, source);
  const info = classify.info;
  // Equal display names (a 2024 entry and a homebrew one, two homebrew
  // entries) would otherwise keep payload order (`order`, above).

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
    ? selectNested(all, requested, adapter, classify, index, bookNotes)
    : selectFlat(all, requested, adapter, classify, index, bookNotes);
  const owner = adapter.owner;
  if (owner) {
    const band = new Map(hits.map(h => {
      const ruleset = classify.markersInfo(owner(h.entry).markers).ruleset;
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
  classify: Classifier<T>,
  index: SourceIndex,
  bookNotes: boolean,
): { hits: CatalogHit<T>[]; hidden: number } {
  const passes = adapter.passes;
  const { selected, hidden } = groupAndSelect(all, requested, {
    info: classify.info,
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
      label: editionTag(sel.info) + (bookNotes ? bookNoteSuffix(sel.entry, alternatives, classify.sourceId, index) : ""),
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
  classify: Classifier<T>,
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
      ruleset: owner ? classify.markersInfo(markers).ruleset : classify.info(t).ruleset,
      twinKey: adapter.twinKey(t),
      groupKey: groupKeyOf(t),
      first: t,
      owner,
    };
    units.push(unit);
    if (owner) byOwner.set(owner.id, unit);
  }

  // Owner ids are unique, so comparing them last makes the order total.
  const order = (a: Unit<T>, b: Unit<T>) => (a.owner && b.owner
    ? definitionTiebreak(a.owner.tiebreak, b.owner.tiebreak) || a.owner.id.localeCompare(b.owner.id)
    : adapter.tiebreak(a.first, b.first));
  const linesOf = (unit: Unit<T>, note: string) => unit.entries.map(entry => {
    const i = classify.info(entry);
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
      hits.push(...linesOf(pick, bookNotes ? bookNoteSuffix(pick, alternatives, u => (u.owner ? classify.markersSourceId(u.markers) : classify.sourceId(u.first)), index) : ""));
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
  adapter: LookupAdapter<T>,
  index: SourceIndex,
  source?: ResolvedSource | "homebrew",
): { entry: T; info: EditionInfo; rulesLines: string[] } | null {
  if (source === "homebrew") {
    // Homebrew entries only; same-named ones resolve by the adapter's tiebreak.
    const pool = all.filter(t => adapter.markers(t).isHomebrew === true);
    const found = lookupByName(pool, query, requested, { name: adapter.name, info: () => HOMEBREW_INFO, tiebreak: adapter.tiebreak, twinName: adapter.twinName });
    if (!found) return null;
    return { entry: found.entry, info: HOMEBREW_INFO, rulesLines: rulesLine(HOMEBREW_INFO).split("\n") };
  }
  const classify = classifier(all, lookupCatalogAdapter(adapter), index, requested, source);
  const info = classify.info;
  const pool = source ? all.filter(t => inSources(adapter.markers(t), source.ids)) : all;
  const found = lookupByName(pool, query, requested, { name: adapter.name, info, tiebreak: adapter.tiebreak, twinName: adapter.twinName });
  if (!found) return null;

  const shown = info(found.entry);
  const rulesLines = rulesLine(shown, { reason: source ? undefined : found.reason }).split("\n");
  if (found.renamed) rulesLines.push(renameLine(found.renamed.name2014, found.renamed.name2024));
  if (source) {
    const note = isEdition(shown.ruleset) ? sourceNote(source.query, shown.ruleset, requested) : null;
    if (note) rulesLines.push(note);
  } else {
    const choice = bookChoice(found.entry, found.alternatives, classify.sourceId, index);
    if (choice) rulesLines.push(alsoInLine(choice.others));
  }
  return { entry: found.entry, info: shown, rulesLines };
}
