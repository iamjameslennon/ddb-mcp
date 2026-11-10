/**
 * monster-search.ts — ddb_search_monsters: the D&D Beyond monster search with
 * its Open5e fallback.
 */

import { captureSession, type SessionSnapshot } from "../session-fetch.js";
import { getSourceIndex } from "../game-config.js";
import {
  classifyEdition, groupAndSelect, monsterTiebreak, twinAliases, normalizeName,
  isEdition, editionTag, searchHeader, NEAR_MATCH_RULES_LINE, searchFooter,
  isLockedReason, lockedLineSuffix, lockedSwapSummary, lockedEntriesNote,
  NOT_LOGGED_IN_SUFFIX,
  HOMEBREW_SOURCE_BOOK, HOMEBREW_INFO, homebrewLoginRequired, homebrewUnreachable,
  type EditionInfo, type RulesEdition, type SelectionReason, type SourceIndex,
} from "../edition.js";
import { resolveSource, isHomebrewSource, sourceLabel, unknownSourceError, type ResolvedSource } from "../source-filter.js";
import { wrapUntrusted, mapWithConcurrency } from "../utils.js";
import { matchesAtWordStart } from "../name-match.js";
import { o5SearchMonstersSection, o5MonsterInEdition, type O5EditionMonster } from "../open5e.js";
import { renderSection, plainSection, noMatchSection, sourceFraming, withSourceCaveatSection, formatCount, narrowingHint, MONSTER_SEARCH_LIMIT, type SearchSection } from "./edition-search.js";
import {
  askerNow, configFor, assertCurrentAfter, fetchMonsterList, scanAllPages, getFullMonsterList, mergeAccess, isLockedIn,
  sizeName, crDisplay, monsterTwin, PAGE_SIZE, SIZE_MAP, SCAN_CONCURRENCY,
  type Asker, type AccessMap, type MonsterListEntry, type MonsterListResponse, type MonsterScan,
} from "./monster-service.js";

// `source: "homebrew"` never returns official entries, so when D&D Beyond
// can't be used these replace the Open5e (SRD) fallback, for get and search alike.
export const HOMEBREW_LOGIN_REQUIRED = homebrewLoginRequired("monster");
export const HOMEBREW_UNREACHABLE = homebrewUnreachable("monsters");

/** The challenge ratings D&D Beyond's config lists (live 2026-11-02: 34 entries). */
export const VALID_CRS = new Set([0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)]);

/**
 * A `cr` no monster can have. Checked before either path runs, so D&D Beyond
 * doesn't skip the filter (no CR id to match) and Open5e doesn't answer "no matches".
 */
export function unknownCrError(cr: number): string | null {
  return VALID_CRS.has(cr) ? null : `Unknown CR "${cr}". Valid CRs: 0, 0.125, 0.25, 0.5, 1–30.`;
}

/** G1/G2: a word-start match of the typed name, or the same twin group as the typed name. */
function nameMatcher(query: string): (m: { name: string }) => boolean {
  const twin = monsterTwin(query);
  return m => matchesAtWordStart(m.name, query) || monsterTwin(m.name) === twin;
}

/**
 * R5: with a query, the rows whose twin key equals the query's come first; then A-Z
 * (en locale), then id. Without a query, A-Z.
 */
function orderRows<R extends { m: { name: string; id: number } }>(rows: R[], query: string): R[] {
  const twin = query ? monsterTwin(query) : null;
  const exact = (r: R) => twin !== null && monsterTwin(r.m.name) === twin ? 0 : 1;
  return [...rows].sort((a, b) =>
    exact(a) - exact(b) || a.m.name.localeCompare(b.m.name, "en") || a.m.id - b.m.id);
}

/** What a result line needs besides the row: the config tables, the source index and the requested book. */
interface RowContext {
  crMap: Map<number, { value: number }>;
  typeMap: Map<number, string>;
  config: Parameters<typeof sizeName>[0];
  index: Parameters<typeof sourceLabel>[0];
  sourceIds: number[];
  anonymous: boolean;
}
type ListedRow = { m: MonsterListEntry; info: EditionInfo; reason?: SelectionReason; srd?: O5EditionMonster; statsUnknown?: boolean };

/**
 * One result line, wrapped whole unless the entry is explicitly official. Normal
 * and near-match lines both come from here, so neither can skip the edition tag
 * or the untrusted wrapping.
 */
function formatRow({ m, info: mInfo, reason, srd, statsUnknown }: ListedRow, ctx: RowContext): string {
  const { crMap, typeMap, config, index, sourceIds } = ctx;
  const cr = crMap.get(m.challengeRatingId);
  const crStr = cr ? crDisplay(cr.value) : "?";
  const typeName = typeMap.get(m.typeId) ?? "Unknown";
  const size = sizeName(config, m.sizeId) ?? "Unknown size";
  const tags: string[] = [];
  if (m.isLegendary) tags.push("Legendary");
  if (m.isMythic) tags.push("Mythic");
  const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
  let sourceStr = sourceLabel(index, m.sourceId);
  if (sourceIds.length && !sourceIds.includes(m.sourceId)) {
    // Matched the requested book as a reprint — say so, or the line looks off-filter.
    const via = m.sources?.find(s => sourceIds.includes(s.sourceId))?.sourceId ?? sourceIds[0];
    sourceStr += `, reprinted in ${sourceLabel(index, via)}`;
  }
  // A locked list entry's AC and HP are zeroed: the SRD's, else dashes.
  // An SRD record's null AC or HP is unknown too: a dash, never the zeroed list value.
  const ac = srd ? srd.armorClass ?? "—" : statsUnknown ? "—" : m.armorClass;
  const hp = srd ? srd.hitPoints ?? "—" : statsUnknown ? "—" : m.averageHitPoints;
  let line = `- **${m.name}** ${editionTag(mInfo)}${tagStr} — ${sourceStr} — CR ${crStr}, ${size} ${typeName}, AC ${ac}, ${hp} HP`;
  if (isLockedReason(reason)) line += ` ${lockedLineSuffix(reason, ctx.anonymous)}`;
  // Homebrew names are user-authored — delimit them, as getMonster does for
  // homebrew stat blocks. Fail closed: only an explicitly official entry is left plain.
  return m.isHomebrew === false ? line : wrapUntrusted(line);
}

/** At most this many of D&D Beyond's closest hits are listed when no name matches (R10). */
export const NEAR_MATCH_LIMIT = 10;
/** Not edition text: it says the lines below are not name matches. */
export const nearMatchLabel = (searchTerm: string): string =>
  `No monster names match "${searchTerm}". Closest matches from D&D Beyond:`;

/**
 * R2: a name whose spellings each have at most this many hits is paged in full
 * by name; with more in any spelling, the name rules run over the full list.
 */
export const NAME_SCAN_LIMIT = 500;

/**
 * R8: the books a name "appears in" for the search's empty-book reply, by the
 * search's word-start/twin rule applied to the typed spelling only (an alias-only
 * book, e.g. "Tough" for "thug", is not found: only the typed name is fetched). Reads at most NAME_SCAN_LIMIT unfiltered
 * hits, page by page under the caller's snapshot (never the full list). Best effort:
 * any failure, a session change included, yields no hint rather than another account's.
 */
async function searchAppearsIn(name: string, index: SourceIndex, asker: Asker, bound: SessionSnapshot): Promise<string[]> {
  try {
    const hits: MonsterListEntry[] = [];
    // A page's total can lag or be missing, so it is not trusted: a full page always
    // asks for the next one, and only a short page (or the limit) ends the read.
    for (let skip = 0; skip < NAME_SCAN_LIMIT; skip += PAGE_SIZE) {
      const page = await fetchMonsterList(name, PAGE_SIZE, { asker, bound, skip });
      const data = page.data ?? [];
      hits.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    // Official entries in books the source index knows (as availableSourcesFor).
    const matches = nameMatcher(name);
    const named = hits
      .filter(m => m.isHomebrew === false && index.sources.has(m.sourceId) && matches(m))
      .sort(monsterTiebreak(index));
    return [...new Set(named.map(m => sourceLabel(index, m.sourceId)))];
  } catch {
    return [];
  }
}

/**
 * Everything a search judges. `entries` and `access` may be a cached scan's own
 * arrays, shared by every caller: read only. `checked` entries were read of the
 * `scanTotal` reported; `complete` is false when a scan came up short (R3).
 * `typedFirstPage` is the typed spelling's first page, in D&D Beyond's order,
 * for near matches (R10). `snapshot` is the one every request was held to.
 */
interface Candidates {
  entries: readonly MonsterListEntry[];
  access: ReadonlyMap<number, number>;
  complete: boolean;
  checked: number;
  scanTotal: number;
  typedFirstPage: readonly MonsterListEntry[];
  snapshot: SessionSnapshot;
}

type ScanPart = Pick<Candidates, "entries" | "access" | "complete" | "checked" | "scanTotal">;

const scanPart = (scan: MonsterScan): ScanPart =>
  ({ entries: scan.entries, access: scan.access, complete: scan.complete, checked: scan.entries.length, scanTotal: scan.scanTotal });

/**
 * A spelling's first page is all of its hits only by scanAllPages' own rule
 * (summarizeScan): it holds at least the reported total and came back short.
 * Anything else (fewer entries than the total, or a full page) is scanned,
 * which re-reads a short scan and flags it when it stays short (R3).
 */
function pageIsWhole(page: MonsterListResponse): boolean {
  const data = page.data ?? [];
  return data.length >= (page.pagination?.total ?? 0) && data.length < PAGE_SIZE;
}

/** One page as a scan part; `complete` says whether it is all the spelling's hits. */
function pageScan(page: MonsterListResponse, complete: boolean): ScanPart {
  const entries = page.data ?? [];
  const access: AccessMap = new Map();
  mergeAccess(access, page);
  return { entries, access, complete, checked: entries.length, scanTotal: Math.max(page.pagination?.total ?? 0, entries.length) };
}

/** An alias spelling whose page 1 failed: nothing read, total unknown, so the result is incomplete ("+"). */
const FAILED_ALIAS: ScanPart = { entries: [], access: new Map(), complete: false, checked: 0, scanTotal: 0 };

/**
 * Every candidate a search judges, all under one session snapshot.
 * - No name: the full list (of the book, when `sourceIds` names one).
 * - A name: page 1 of each twin spelling. When any spelling has more than
 *   NAME_SCAN_LIMIT hits, the name rules (G1/G2) run over the full list instead,
 *   keeping each matching entry's whole twin group for edition selection;
 *   otherwise each spelling with more than a page is scanned in full, and
 *   (with `twinGroups`) the matches' renamed twins are added (twinSpellings).
 *   Only the typed spelling's failure fails the search.
 * `twinGroups`: the caller selects by edition over whole twin groups (no `source`).
 * Never mutates a scan: merged results are new arrays and maps.
 */
async function gatherCandidates(searchTerm: string, sourceIds: number[], asker: Asker, twinGroups: boolean): Promise<Candidates> {
  const snapshot = captureSession();
  if (!searchTerm) {
    const scan = await getFullMonsterList(asker, { sourceIds, bound: snapshot });
    assertCurrentAfter(snapshot, asker);
    return { ...scanPart(scan), typedFirstPage: [], snapshot };
  }

  const spellings = twinAliases(searchTerm, monsterTwin);
  const firstPages = await Promise.all(spellings.map((term, i) => {
    const page = fetchMonsterList(term, PAGE_SIZE, { sourceIds, asker, bound: snapshot });
    return i === 0 ? page : page.catch(() => null);
  }));
  const typedFirstPage = firstPages[0]?.data ?? [];

  let part: ScanPart;
  if (firstPages.some(page => (page?.pagination?.total ?? 0) > NAME_SCAN_LIMIT)) {
    const scan = await getFullMonsterList(asker, { sourceIds, bound: snapshot });
    const matches = nameMatcher(searchTerm);
    const twins = new Set(scan.entries.filter(matches).map(m => monsterTwin(m.name)));
    part = { ...scanPart(scan), entries: scan.entries.filter(m => twins.has(monsterTwin(m.name))) };
  } else {
    // A failed alias (owner ruling 2026-11-10) makes the result incomplete
    // rather than silently short: its page 1 failing counts nothing read of an
    // unknown total; its scan failing (a timeout included) keeps its page 1
    // and that page's total. No retry. The typed spelling's failure still fails the search.
    const parts = await Promise.all(spellings.map(async (term, i): Promise<ScanPart> => {
      const page = firstPages[i];
      if (!page) return FAILED_ALIAS;
      if (pageIsWhole(page)) return pageScan(page, true);
      const scan = scanAllPages(term, sourceIds, asker, snapshot).then(scanPart);
      return i === 0 ? scan : scan.catch(() => pageScan(page, false));
    }));
    const seen = new Set<number>();
    const entries: MonsterListEntry[] = [];
    const access: AccessMap = new Map();
    part = { entries, access, complete: true, checked: 0, scanTotal: 0 };
    // `checked` and `scanTotal` are summed per spelling, so an entry two
    // spellings both return counts twice: the note's numbers are upper bounds.
    for (const p of parts) {
      for (const m of p.entries) {
        if (!seen.has(m.id)) { seen.add(m.id); entries.push(m); }
      }
      for (const [id, value] of p.access) access.set(id, value);
      part.complete &&= p.complete;
      part.checked += p.checked;
      part.scanTotal += p.scanTotal;
    }
    if (twinGroups) {
      const twins = await twinSpellings(searchTerm, spellings, entries, sourceIds, asker, snapshot);
      for (const m of twins.entries) {
        if (!seen.has(m.id)) { seen.add(m.id); entries.push(m); }
      }
      for (const [id, value] of twins.access) access.set(id, value);
      part.complete &&= twins.complete;
    }
  }
  assertCurrentAfter(snapshot, asker);
  return { ...part, typedFirstPage, snapshot };
}

/**
 * B1 (owner ruling 2026-11-10): a partial name can match a renamed entry
 * ("warrior" → Goblin Warrior) whose other-edition twin (Goblin) none of the
 * typed name's spellings return, so edition selection would see half a group.
 * Every other spelling of each match's twin group (twinAliases), less those
 * already queried and the matches' own names (their query returned them), has
 * its page 1 fetched: at most one per rename pair, SCAN_CONCURRENCY at a time,
 * under the call's snapshot and asker. Only entries of the matches' twin groups
 * are kept. A failed spelling makes the result incomplete, like a failed alias.
 */
async function twinSpellings(
  searchTerm: string, queried: readonly string[], fetched: readonly MonsterListEntry[],
  sourceIds: number[], asker: Asker, bound: SessionSnapshot,
): Promise<{ entries: MonsterListEntry[]; access: AccessMap; complete: boolean }> {
  const matched = fetched.filter(nameMatcher(searchTerm));
  const covered = new Set([...queried, ...matched.map(m => m.name)].map(normalizeName));
  const missing = new Map<string, string>();
  for (const m of matched) {
    for (const spelling of twinAliases(m.name, monsterTwin)) {
      const key = normalizeName(spelling);
      if (!covered.has(key)) missing.set(key, spelling);
    }
  }
  const groups = new Set(matched.map(m => monsterTwin(m.name)));
  const pages = await mapWithConcurrency([...missing.values()], SCAN_CONCURRENCY, term =>
    fetchMonsterList(term, PAGE_SIZE, { sourceIds, asker, bound }).catch(() => null));
  const entries: MonsterListEntry[] = [];
  const access: AccessMap = new Map();
  for (const page of pages) {
    const pageAccess: AccessMap = new Map();
    mergeAccess(pageAccess, page);
    for (const m of page?.data ?? []) {
      if (!groups.has(monsterTwin(m.name))) continue;
      entries.push(m);
      const value = pageAccess.get(m.id);
      if (value !== undefined) access.set(m.id, value);
    }
  }
  return { entries, access, complete: pages.every(page => page !== null) };
}

/**
 * The note every answer from an incomplete scan carries. Under a count line the
 * count may be short; a reply with none (no match, Open5e not-found, near
 * matches) may have missed a match (owner ruling 2026-11-10).
 */
function incompleteNote(c: Pick<Candidates, "complete" | "checked" | "scanTotal">, countLine: boolean): string {
  if (c.complete) return "";
  const risk = countLine ? "the count may be short" : "a match may have been missed";
  return `\n*Only ${formatCount(c.checked)} of ${formatCount(c.scanTotal)}+ entries could be read from D&D Beyond, so ${risk}. Try again in a few minutes.*`;
}

/**
 * A reply with the incomplete-scan note after its body. Not `noMatch`: nothing
 * matched only in what could be read, so ddb_search_site must keep the note.
 */
function withIncompleteNote(s: SearchSection, note: string): SearchSection {
  if (!note) return s;
  const out: SearchSection = { ...s, body: s.body + note };
  delete out.noMatch;
  return out;
}

export interface MonsterSearchParams {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  source?: string;
  rulesEdition?: RulesEdition;
  /** List every match instead of the first MONSTER_SEARCH_LIMIT. Ignored with `siteSearch`. */
  listAll?: boolean;
  /** Called from ddb_search_site: the narrowing hint names ddb_search_monsters, and `listAll` is ignored. */
  siteSearch?: boolean;
}

/** Open5e probes in flight at once, for the per-line SRD lookups. */
const O5_PROBE_CONCURRENCY = 8;

export async function searchMonsters(params: MonsterSearchParams): Promise<string> {
  return renderSection(await searchMonstersSection(params));
}

export async function searchMonstersSection(params: MonsterSearchParams): Promise<SearchSection> {
  return plainOrSection(await monsterSearchParts(params));
}

/** The search as a SearchSection, or as a plain reply when it has no edition framing. */
export function plainOrSection(r: string | SearchSection): SearchSection {
  return typeof r === "string" ? plainSection(r) : r;
}

export async function monsterSearchParts(params: MonsterSearchParams): Promise<string | SearchSection> {
  const crError = params.cr === undefined ? null : unknownCrError(params.cr);
  if (crError) return crError;
  const homebrew = isHomebrewSource(params.source);
  // Logged out, monster-service is still asked (anonymously); homebrew needs an account.
  const asker = askerNow();
  if (asker.anonymous && homebrew) return HOMEBREW_LOGIN_REQUIRED;
  const requested = params.rulesEdition ?? "2024";

  try {
  const config = await configFor(asker);
  // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
  const index = await getSourceIndex();
  // A mistyped source is an error even when the config is down (the snapshot index resolves sources).
  if (params.source && !homebrew && !resolveSource(index, params.source)) return unknownSourceError(index, params.source);
  // No config means no CR, type or size tables: a filter can't be applied (the
  // CR filter used to be skipped, type and size to match nothing), and logged
  // out a stat block or line would read "(id:N)" / "type N". Answer from Open5e
  // as "unavailable" instead (owner ruling 2026-11-02).
  if (!config && (asker.anonymous || params.cr !== undefined || params.type || params.size)) {
    throw new Error("Game config unavailable");
  }
  const info = (m: MonsterListEntry) => classifyEdition(m, index);
  const crMap = new Map(config?.challengeRatings.map(cr => [cr.id, cr]) ?? []);
  const typeMap = new Map(config?.monsterTypes.map(t => [t.id, t.name]) ?? []);

  const searchTerm = params.name?.trim() ?? "";

  const targetCrId = params.cr !== undefined
    ? config?.challengeRatings.find(cr => cr.value === params.cr)?.id
    : undefined;
  let book: ResolvedSource | null = null;
  if (params.source && !homebrew) {
    book = resolveSource(index, params.source);
    if (!book) return unknownSourceError(index, params.source);
  }
  const sourceIds = book?.ids ?? [];
  const rowCtx: RowContext = { crMap, typeMap, config, index, sourceIds, anonymous: asker.anonymous };

  // CR, type and size filter locally (the service's own filters would split
  // twin groups whose CR, type or size changed between editions).
  const searchType = params.type?.toLowerCase();
  const searchSize = params.size?.toLowerCase();
  const passes = (m: MonsterListEntry) =>
    (targetCrId === undefined || m.challengeRatingId === targetCrId)
    && (!searchType || (typeMap.get(m.typeId) ?? "").toLowerCase().includes(searchType))
    && (!searchSize || (sizeName(config, m.sizeId) ?? "").toLowerCase().includes(searchSize));

  /** No entry matched (the candidates, when known, say whether everything could be read). */
  async function noMatchReply(hidden: number, c?: Candidates): Promise<SearchSection> {
    const note = c ? incompleteNote(c, false) : "";
    if (homebrew) {
      return withIncompleteNote(noMatchSection(searchTerm
        ? `No homebrew monsters found matching "${searchTerm}".`
        : "No homebrew monsters found matching the search criteria."), note);
    }
    if (book) {
      // Open5e only carries the SRD — never substitute it for a requested book.
      let msg = `No monsters matching the search criteria in ${sourceLabel(index, sourceIds[0])}.`;
      if (searchTerm && c) {
        const available = await searchAppearsIn(searchTerm, index, asker, c.snapshot);
        if (available.length) msg += ` "${searchTerm}" appears in: ${available.join(", ")}.`;
      }
      return withIncompleteNote(noMatchSection(msg), note);
    }
    // Only the other edition has a match: say so, rather than substitute the SRD.
    if (hidden > 0) {
      return withIncompleteNote({
        header: searchHeader({ requested }),
        body: "No monsters found matching the search criteria.",
        footer: searchFooter(requested, hidden),
        hidden,
        noMatch: true,
      }, note);
    }
    const o5 = await o5SearchMonstersSection(params, "not-found").catch(() => noMatchSection("No monsters found matching the search criteria."));
    return withIncompleteNote(o5, note);
  }

  // A type or size no name contains can match nothing: answer without asking D&D Beyond.
  const sizeNames = [...(config?.creatureSizes ?? []).map(s => s.id), ...Object.keys(SIZE_MAP).map(Number)]
    .map(id => (sizeName(config, id) ?? "").toLowerCase());
  if ((searchType && ![...typeMap.values()].some(t => t.toLowerCase().includes(searchType)))
    || (searchSize && !sizeNames.some(s => s.includes(searchSize)))) {
    return noMatchReply(0);
  }

  // Every candidate, under one snapshot (a book narrows them server-side).
  const candidates = await gatherCandidates(searchTerm, sourceIds, asker, !params.source);
  const { entries: fetched, access } = candidates;
  const countNote = incompleteNote(candidates, true);
  const noCountNote = incompleteNote(candidates, false);

  // With a source (a book, or homebrew), every matching entry is listed (no
  // edition selection, no swap); otherwise one entry per twin group, the other
  // edition's twins hidden, and a locked group shows its available twin.
  // `srd`: logged out, the requested entry is locked but its SRD has it, so the
  // line shows the SRD record's AC and HP (the locked list entry's are zeroed).
  type Row = { m: MonsterListEntry; info: EditionInfo; reason?: SelectionReason; srd?: O5EditionMonster };
  let monsters: Row[];
  let hidden = 0;
  const nameOk = searchTerm ? nameMatcher(searchTerm) : () => true;
  if (homebrew) {
    // Fail closed, as the untrusted wrapping does: anything not explicitly official.
    monsters = fetched.filter(m => m.isHomebrew !== false && nameOk(m) && passes(m)).map(m => ({ m, info: HOMEBREW_INFO }));
  } else if (params.source) {
    monsters = fetched.filter(m => nameOk(m) && passes(m)).map(m => ({ m, info: info(m) }));
  } else {
    // countFilteredPicks: a group whose requested pick fails the CR/type/size
    // filters while the other edition's pick passes is counted as hidden, as in
    // the catalog searches. A locked group's swapped pick is never counted.
    // Logged out, a group that would swap (every requested entry locked, a free
    // other-edition twin) is not swapped when the requested edition's SRD has
    // the creature: its stat block is that SRD text (owner ruling 2026-11-02).
    // Such a group counts as available before selection, so the filters and the
    // hidden count judge its requested pick like any other.
    const matchedTwins = new Set(fetched.filter(nameOk).map(m => monsterTwin(m.name)));
    const named = searchTerm ? fetched.filter(m => matchedTwins.has(monsterTwin(m.name))) : fetched;
    const srdBacked = asker.anonymous ? await srdBackedGroups(named, access, requested, info, monsterTiebreak(index), passes) : new Map<string, O5EditionMonster>();
    const picked = groupAndSelect(fetched, requested, {
      info, twinKey: m => monsterTwin(m.name), tiebreak: monsterTiebreak(index), passes,
      nameMatches: searchTerm ? nameOk : undefined,
      available: m => !isLockedIn(access, m.id) || srdBacked.has(monsterTwin(m.name)),
      countFilteredPicks: true,
    });
    monsters = picked.selected.map(s => ({
      m: s.entry, info: s.info, reason: s.reason,
      srd: s.info.ruleset === requested ? srdBacked.get(monsterTwin(s.entry.name)) : undefined,
    }));
    hidden = picked.hidden;
  }

  // The path's normal header: homebrew (no edition, so no sourceNote), a book, or the plain search.
  function sectionHeader(): { header: string; note?: string | null } {
    if (homebrew) return { header: searchHeader({ sourceBook: HOMEBREW_SOURCE_BOOK }) };
    // Slugs aren't unique; the header names the lowest-id book, not a premade-character pack.
    if (book) return sourceFraming(book, requested, index);
    return { header: searchHeader({ requested }) };
  }

  monsters = orderRows(monsters, searchTerm);

  /** R10: the typed spelling's hits as the service ranked them, past CR/type/size (and, for homebrew, only non-official). */
  function nearMatchHits(typedHits: readonly MonsterListEntry[]): MonsterListEntry[] {
    return typedHits.filter(m => passes(m) && (!homebrew || m.isHomebrew !== false)).slice(0, NEAR_MATCH_LIMIT);
  }

  if (monsters.length === 0) {
    // G3: nothing fetched, from any spelling, matches the typed name. The typed
    // spelling's own first page (never an alias's) is then listed as D&D Beyond's closest.
    const nearHits = searchTerm && !fetched.some(nameOk) ? nearMatchHits(candidates.typedFirstPage) : [];
    if (nearHits.length) {
      const shownNear = await withListStats(nearHits.map(m => ({ m, info: homebrew ? HOMEBREW_INFO : info(m) })), access);
      // The edition-neutral header replaces the path's edition claim (and the book header's
      // "every entry"); the book's own source note is kept.
      const header = NEAR_MATCH_RULES_LINE;
      const bookNote = book ? sectionHeader().note : null;
      const body: string[] = [];
      // R9: a book search leads with today's empty-book line and its "appears in" hint.
      if (params.source && !homebrew) {
        let msg = `No monsters matching the search criteria in ${sourceLabel(index, sourceIds[0])}.`;
        const available = await searchAppearsIn(searchTerm, index, asker, candidates.snapshot);
        if (available.length) msg += ` "${searchTerm}" appears in: ${available.join(", ")}.`;
        body.push(msg);
      }
      if (bookNote) body.push(bookNote);
      body.push(nearMatchLabel(searchTerm));
      for (const row of shownNear) body.push(formatRow(row, rowCtx));
      // A near match judged over an incomplete scan may have missed a real match: say so.
      if (noCountNote) body.push(noCountNote);
      // No noMatch: ddb_search_site's "all" must keep this section, with its own
      // neutral Rules line (ownRulesLine), not under the combined edition header.
      return { header, body: body.join("\n"), footer: searchFooter(requested, 0), hidden: 0, ownRulesLine: true };
    }
    return noMatchReply(hidden, candidates);
  }

  const listAll = params.listAll === true && !params.siteSearch;
  // Only the rows printed are probed for list stats.
  const shown = await withListStats(listAll ? monsters : monsters.slice(0, MONSTER_SEARCH_LIMIT), access);
  const shownLines = shown.map(row => formatRow(row, rowCtx));

  const lines: string[] = [];
  const { header, note: bookNote } = sectionHeader();
  if (bookNote) lines.push(bookNote);
  // The note and the swap summary count every selected entry, as the count line does, not just the lines shown.
  const lockedNote = lockedEntriesNote(monsters.filter(r => isLockedIn(access, r.m.id)).length, asker.anonymous);
  if (lockedNote) lines.push(lockedNote);

  // The total is the selected, filtered rows themselves; "+" when a scan came up short.
  lines.push(`**Monster Search** (${formatCount(shown.length)} shown of ${formatCount(monsters.length)}${candidates.complete ? "" : "+"} matching)\n`);
  lines.push(...shownLines);

  if (!listAll && monsters.length > MONSTER_SEARCH_LIMIT) {
    const avgBytes = shownLines.reduce((n, l) => n + Buffer.byteLength(l), 0) / shownLines.length;
    const unused = ([["cr", params.cr], ["type", params.type], ["size", params.size], ["source", params.source]] as const)
      .filter(([, v]) => v === undefined).map(([k]) => k);
    lines.push(`\n${narrowingHint({
      total: monsters.length, complete: candidates.complete, approxKb: Math.round(avgBytes * monsters.length / 1024), unused, siteSearch: params.siteSearch === true,
    })}`);
  }
  if (countNote) lines.push(countNote);
  const summary = lockedSwapSummary(requested, monsters.filter(r => isLockedReason(r.reason)).length, asker.anonymous);
  if (summary) lines.push(summary);

  return { header, body: lines.join("\n"), footer: searchFooter(requested, hidden), hidden };
  } catch {
    if (homebrew) return HOMEBREW_UNREACHABLE;
    return await o5SearchMonstersSection(params, "unavailable").then(r => withSourceCaveatSection(r, params.source)).catch(
      () => `Monster search unavailable — D&D Beyond and Open5e both failed.${asker.anonymous ? NOT_LOGGED_IN_SUFFIX : ""}`
    );
  }
}


/**
 * The lines about to be printed, with `srd` (the record's AC and HP) for each
 * locked entry whose list AC and HP are both 0: monster-service zeroes them on
 * locked entries, logged in (a free account) or out (final review I1). The
 * entry's own edition's SRD is asked by exact name, so only printed lines are
 * probed, after the filters. No SRD record (or an Open5e failure, or an entry
 * that isn't 2014/2024) sets `statsUnknown`: the line prints dashes. Other
 * entries are returned as they are.
 */
export async function withListStats<R extends { m: MonsterListEntry; info: EditionInfo; srd?: O5EditionMonster }>(
  rows: R[], access: ReadonlyMap<number, number>,
): Promise<Array<R & { statsUnknown?: boolean }>> {
  return mapWithConcurrency(rows, O5_PROBE_CONCURRENCY, async row => {
    const { m, info } = row;
    if (row.srd || !isLockedIn(access, m.id) || m.armorClass !== 0 || m.averageHitPoints !== 0) return row;
    const srd = isEdition(info.ruleset) ? await o5MonsterInEdition(m.name, info.ruleset).catch(() => null) : null;
    return srd ? { ...row, srd } : { ...row, statsUnknown: true };
  });
}

/**
 * Logged out: the twin groups that would swap (every requested-edition entry
 * locked, an available other-edition entry) whose requested pick the requested
 * edition's SRD has, keyed by twin name. An Open5e failure counts as "the SRD
 * lacks it", so the swap stays. Only groups the answer can change are probed:
 * the requested pick or an other-edition entry passes the CR/type/size
 * filters. When neither does, the group lists nothing and counts nothing
 * either way, so a filtered search that matches nothing asks Open5e nothing.
 */
export async function srdBackedGroups(
  fetched: readonly MonsterListEntry[], access: ReadonlyMap<number, number>, requested: RulesEdition,
  info: (m: MonsterListEntry) => EditionInfo, tiebreak: (a: MonsterListEntry, b: MonsterListEntry) => number,
  passes: (m: MonsterListEntry) => boolean,
): Promise<Map<string, O5EditionMonster>> {
  const other: RulesEdition = requested === "2024" ? "2014" : "2024";
  const groups = new Map<string, MonsterListEntry[]>();
  for (const m of fetched) {
    const key = monsterTwin(m.name);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const backed = new Map<string, O5EditionMonster>();
  await mapWithConcurrency([...groups], O5_PROBE_CONCURRENCY, async ([key, group]) => {
    const wanted = group.filter(m => info(m).ruleset === requested).sort(tiebreak);
    if (!wanted.length || wanted.some(m => !isLockedIn(access, m.id))) return;
    if (!group.some(m => info(m).ruleset === other && !isLockedIn(access, m.id))) return;
    if (!passes(wanted[0]) && !group.some(m => info(m).ruleset === other && passes(m))) return;
    const srd = await o5MonsterInEdition(wanted[0].name, requested).catch(() => null);
    if (srd) backed.set(key, srd);
  });
  return backed;
}

