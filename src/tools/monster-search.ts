/**
 * monster-search.ts — ddb_search_monsters: the D&D Beyond monster search with
 * its Open5e fallback.
 */

import { captureSession } from "../session-fetch.js";
import { getSourceIndex } from "../game-config.js";
import {
  classifyEdition, groupAndSelect, monsterTiebreak, twinAliases,
  isEdition, editionTag, searchHeader, searchFooter,
  isLockedReason, lockedLineSuffix, lockedSwapSummary, lockedEntriesNote,
  NOT_LOGGED_IN_SUFFIX,
  HOMEBREW_SOURCE_BOOK, HOMEBREW_INFO, homebrewLoginRequired, homebrewUnreachable,
  type EditionInfo, type RulesEdition, type SelectionReason,
} from "../edition.js";
import { resolveSource, isHomebrewSource, sourceLabel, unknownSourceError, type ResolvedSource } from "../source-filter.js";
import { wrapUntrusted } from "../utils.js";
import { matchesAtWordStart } from "../name-match.js";
import { o5SearchMonstersSection, o5MonsterInEdition, type O5EditionMonster } from "../open5e.js";
import { renderSection, plainSection, noMatchSection, sourceFraming, withSourceCaveatSection, type SearchSection } from "./edition-search.js";
import {
  askerNow, configFor, assertCurrentAfter, fetchMonsterList, fetchMonsterPages, mergeAccess, isLockedIn, availableSourcesFor,
  sizeName, crDisplay, monsterTwin, PAGE_SIZE, MAX_FILTER_SCAN, type DdbMonster, type AccessMap,
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

export interface MonsterSearchParams {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  source?: string;
  rulesEdition?: RulesEdition;
}

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
  const info = (m: DdbMonster) => classifyEdition(m, index);
  const crMap = new Map(config?.challengeRatings.map(cr => [cr.id, cr]) ?? []);
  const typeMap = new Map(config?.monsterTypes.map(t => [t.id, t.name]) ?? []);

  const searchTerm = params.name?.trim() ?? "";

  // Resolve filter IDs up front so we can pass them to the API.
  const targetCrId = params.cr !== undefined
    ? config?.challengeRatings.find(cr => cr.value === params.cr)?.id
    : undefined;
  let book: ResolvedSource | null = null;
  if (params.source && !homebrew) {
    book = resolveSource(index, params.source);
    if (!book) return unknownSourceError(index, params.source);
  }
  const sourceIds = book?.ids ?? [];

  // Source filters server-side. CR/type/size (and homebrew) filter client-side,
  // so page through results (up to MAX_FILTER_SCAN) rather than judging one page.
  const attributeFilters = targetCrId !== undefined || Boolean(params.type) || Boolean(params.size);
  const clientFilters = attributeFilters || homebrew;
  // A name search takes the service's cap per spelling, so twin grouping sees
  // as much of each group as one request can; a bare browse keeps 20.
  const take = searchTerm || params.source ? PAGE_SIZE : 20;
  const fetchTerm = async (term: string): Promise<{ data: DdbMonster[]; total: number; access: AccessMap; incomplete: boolean }> => {
    if (clientFilters) return fetchMonsterPages(term, sourceIds, MAX_FILTER_SCAN, asker);
    const page = await fetchMonsterList(term, take, { sourceIds, asker });
    const access: AccessMap = new Map();
    mergeAccess(access, page);
    return { data: page.data ?? [], total: page.pagination.total, access, incomplete: false };
  };
  // Every spelling of the term's twin group (Thug and Tough are one creature,
  // but a search for one never returns the other), under one snapshot, as in
  // fetchCandidates. Only the typed term's own query fails the search.
  const snapshot = captureSession();
  const [typed, ...aliases] = searchTerm ? twinAliases(searchTerm, monsterTwin) : [""];
  const results = await Promise.all([fetchTerm(typed), ...aliases.map(alias => fetchTerm(alias).catch(() => null))]);
  assertCurrentAfter(snapshot, asker);
  // `total` is the alias totals' sum minus the duplicates met while merging:
  // exact when every scan is complete, an upper bound otherwise.
  const seen = new Set<number>();
  const fetched: DdbMonster[] = [];
  const access: AccessMap = new Map();
  let total = 0;
  for (const result of results) {
    if (!result) continue;
    total += result.total;
    for (const [id, value] of result.access) access.set(id, value);
    for (const m of result.data) {
      if (seen.has(m.id)) total--;
      else { seen.add(m.id); fetched.push(m); }
    }
  }
  const checked = fetched.length;
  // Never "checked N of M" with N > M: the service's totals can lag its pages.
  total = Math.max(total, checked);
  // A scan known to be incomplete although the totals agree prints "M+".
  const incomplete = clientFilters && results.some(r => r?.incomplete);
  const partialScan = clientFilters && (checked < total || incomplete);
  const totalText = checked < total ? String(total) : `${total}+`;
  // A name search asks for the service's cap per spelling; when a spelling has
  // more matches than that, its twins beyond the cap were never seen.
  const nameCapped = Boolean(searchTerm) && !clientFilters
    && results.some(r => r !== null && r.data.length >= PAGE_SIZE && r.total > r.data.length);

  const searchType = params.type?.toLowerCase();
  const searchSize = params.size?.toLowerCase();
  const passes = (m: DdbMonster) =>
    (targetCrId === undefined || m.challengeRatingId === targetCrId)
    && (!searchType || (typeMap.get(m.typeId) ?? "").toLowerCase().includes(searchType))
    && (!searchSize || (sizeName(config, m.sizeId) ?? "").toLowerCase().includes(searchSize));

  // With a source (a book, or homebrew), every matching entry is listed (no
  // edition selection, no swap); otherwise one entry per twin group, the other
  // edition's twins hidden, and a locked group shows its available twin.
  // `srd`: logged out, the requested entry is locked but its SRD has it, so the
  // line shows the SRD record's AC and HP (the locked list entry's are zeroed).
  type Row = { m: DdbMonster; info: EditionInfo; reason?: SelectionReason; srd?: O5EditionMonster };
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

  monsters = orderRows(monsters, searchTerm);

  if (monsters.length === 0) {
    const scope = partialScan ? ` (checked the first ${checked} of ${totalText} entries)` : "";
    if (homebrew) {
      return noMatchSection(searchTerm
        ? `No homebrew monsters found matching "${searchTerm}"${scope}.`
        : `No homebrew monsters found matching the search criteria${scope}.`);
    }
    if (params.source) {
      // Open5e only carries the SRD — never substitute it for a requested book.
      const where = sourceLabel(index, sourceIds[0]);
      let msg = `No monsters matching the search criteria in ${where}${scope}.`;
      if (searchTerm) {
        const available = await availableSourcesFor(searchTerm, index, asker, snapshot);
        if (available.length) msg += ` "${searchTerm}" appears in: ${available.join(", ")}.`;
      }
      return noMatchSection(msg);
    }
    // Only the other edition has a match: say so, rather than substitute the SRD.
    if (hidden > 0) {
      return {
        header: searchHeader({ requested }),
        body: `No monsters found matching the search criteria${scope}.`,
        footer: searchFooter(requested, hidden),
        hidden,
        noMatch: true,
      };
    }
    return await o5SearchMonstersSection(params, "not-found").catch(() => noMatchSection("No monsters found matching the search criteria."));
  }

  const matchedBy = searchTerm && params.source ? "matched by name and source"
    : searchTerm ? "matched by name"
    : params.source ? "matched by source"
    : "in the compendium";
  const shown = await withListStats(monsters.slice(0, PAGE_SIZE), access);

  const lines: string[] = [];
  let header: string;
  if (homebrew) {
    // Homebrew has no edition, so no sourceNote.
    header = searchHeader({ sourceBook: HOMEBREW_SOURCE_BOOK });
  } else if (book) {
    // Slugs aren't unique; the header names the lowest-id book, not a premade-character pack.
    const framing = sourceFraming(book, requested, index);
    header = framing.header;
    if (framing.note) lines.push(framing.note);
  } else {
    header = searchHeader({ requested });
  }
  // The note and the swap summary count every selected entry, as the header
  // total does, not just the lines shown.
  const lockedNote = lockedEntriesNote(monsters.filter(r => isLockedIn(access, r.m.id)).length, asker.anonymous);
  if (lockedNote) lines.push(lockedNote);

  // Totals count the result after hiding: the fetched entries the selection
  // dropped (hidden twins, same-edition duplicates) come off the service total.
  const countText = clientFilters
    ? `${shown.length} shown of ${monsters.length} matching; checked ${checked} of ${partialScan ? totalText : total} ${matchedBy}`
    : `${shown.length} shown, ${total - (checked - monsters.length)} total ${matchedBy}`;
  const capNote = nameCapped ? ` (the first ${PAGE_SIZE} matches per name were checked)` : "";
  lines.push(`**Monster Search** (${countText})${capNote}\n`);
  for (const { m, info: mInfo, reason, srd, statsUnknown } of shown) {
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
    if (isLockedReason(reason)) line += ` ${lockedLineSuffix(reason, asker.anonymous)}`;
    // Homebrew names are user-authored — delimit them, as getMonster does for
    // homebrew stat blocks. Fail closed: only an explicitly official entry is left plain.
    lines.push(m.isHomebrew === false ? line : wrapUntrusted(line));
  }

  if (shown.length < monsters.length) {
    lines.push(`\n*${monsters.length - shown.length} more matches not shown.*`);
  }
  if (partialScan) {
    lines.push(homebrew
      ? `\n*Only the first ${checked} of ${totalText} were checked for homebrew entries — add a name to narrow the search.*`
      : `\n*Only the first ${checked} of ${totalText} were checked against the CR/type/size filters — add a name or source to narrow the search.*`);
  } else if (!clientFilters && checked < total) {
    lines.push(`\n*Refine your search with a name term for more specific results.*`);
  }
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
export async function withListStats<R extends { m: DdbMonster; info: EditionInfo; srd?: O5EditionMonster }>(
  rows: R[], access: AccessMap,
): Promise<Array<R & { statsUnknown?: boolean }>> {
  return Promise.all(rows.map(async row => {
    const { m, info } = row;
    if (row.srd || !isLockedIn(access, m.id) || m.armorClass !== 0 || m.averageHitPoints !== 0) return row;
    const srd = isEdition(info.ruleset) ? await o5MonsterInEdition(m.name, info.ruleset).catch(() => null) : null;
    return srd ? { ...row, srd } : { ...row, statsUnknown: true };
  }));
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
  fetched: DdbMonster[], access: AccessMap, requested: RulesEdition,
  info: (m: DdbMonster) => EditionInfo, tiebreak: (a: DdbMonster, b: DdbMonster) => number,
  passes: (m: DdbMonster) => boolean,
): Promise<Map<string, O5EditionMonster>> {
  const other: RulesEdition = requested === "2024" ? "2014" : "2024";
  const groups = new Map<string, DdbMonster[]>();
  for (const m of fetched) {
    const key = monsterTwin(m.name);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const backed = new Map<string, O5EditionMonster>();
  await Promise.all([...groups].map(async ([key, group]) => {
    const wanted = group.filter(m => info(m).ruleset === requested).sort(tiebreak);
    if (!wanted.length || wanted.some(m => !isLockedIn(access, m.id))) return;
    if (!group.some(m => info(m).ruleset === other && !isLockedIn(access, m.id))) return;
    if (!passes(wanted[0]) && !group.some(m => info(m).ruleset === other && passes(m))) return;
    const srd = await o5MonsterInEdition(wanted[0].name, requested).catch(() => null);
    if (srd) backed.set(key, srd);
  }));
  return backed;
}

