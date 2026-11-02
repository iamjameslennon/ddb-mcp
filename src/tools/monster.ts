/**
 * monster.ts — DDB monster service tools
 *
 * API host: monster-service.dndbeyond.com
 * Auth: Bearer cobalt token (same as character service). Logged out, the
 * service is asked with no credentials at all (anonymousFetch): it answers
 * free content, and its accessType map marks the rest locked (4).
 * Envelope: { accessType, pagination, data } for list; { accessType, data } for single
 *
 * Game config (CR values, type names, sources, etc.) comes from
 * ../game-config.ts.
 */

import {
  beginAuthenticatedSession, anonymousFetch, hasValidSession,
  captureSession, assertSessionCurrent, onSessionInvalidated, type SessionSnapshot,
} from "../session-fetch.js";
import { getGameConfig, getPublicGameConfig, getSourceIndex, type GameConfig } from "../game-config.js";
import {
  classifyEdition, selectByEdition, lookupByName, groupAndSelect, monsterTiebreak, twinNames, twinAliases,
  normalizeName, dedupeById, isEdition, rulesLine, renameLine, sourceNote, editionTag, searchHeader, searchFooter,
  isLockedReason, lockedLineSuffix, lockedSwapSummary, lockedEntriesNote, availableElsewhereHint,
  loggedOutReason, LOGGED_OUT_RESTRICTED_NOTE, NOT_LOGGED_IN_SUFFIX,
  HOMEBREW_SOURCE_BOOK, HOMEBREW_INFO, homebrewLoginRequired, homebrewUnreachable,
  type EditionInfo, type RulesEdition, type RulesLineReason, type SelectionReason, type SourceIndex,
} from "../edition.js";
import {
  resolveSource, resolveSourceIds, isHomebrewSource, sourceLabel, sourceSlug, unknownSourceError, withSourceCaveat,
  type ResolvedSource,
} from "../source-filter.js";
import { TtlCache } from "../cache.js";
import { wrapUntrusted, stripHtmlRich } from "../utils.js";
import {
  o5SearchMonstersSection, o5GetMonster, o5GetMonsterStats, o5MonsterInEdition, type MonsterStatsResult, type O5EditionMonster,
} from "../open5e.js";
import { renderSection, plainSection, sourceFraming, withSourceCaveatSection, type SearchSection } from "./edition-search.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONSTER_SERVICE = "https://monster-service.dndbeyond.com";

/** Monster twin names: the monster rename pairs only (decision 5), so "Evoker" never also queries "School of Evocation". */
const monsterTwin = twinNames.monster;

const SIZE_MAP: Record<number, string> = {
  2: "Tiny", 3: "Small", 4: "Medium", 5: "Large", 6: "Huge", 7: "Gargantuan",
};

const MOVEMENT_NAMES: Record<number, string> = {
  1: "walk", 2: "burrow", 3: "climb", 4: "fly", 5: "swim",
};

const STAT_NAMES: Record<number, string> = {
  1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA",
};

// ── Cache ─────────────────────────────────────────────────────────────────────

const monsterCache = new TtlCache<string>(24 * 60 * 60_000, 200); // 24 h, 200 entries

/** Wipe the in-process monster cache. */
export function clearMonsterCache(): void {
  monsterCache.clear();
}

// Drop account-derived monster state on every session transition — the
// monster service is gated by the cobalt token. game-config.ts drops the game
// config itself. Registered once per module lifetime.
onSessionInvalidated(() => {
  monsterCache.clear();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Stat-block prose (traits, actions, reactions…): like stripHtml, but keeps
 * DDB's <strong> feature names ("Bite.", "Multiattack.") as Markdown bold.
 * Exported for tests.
 */
export function statBlockText(html: string | null | undefined): string {
  if (!html) return "";
  return stripHtmlRich(boldSpans(html));
}

const BOLD_TAGS = ["strong", "b"] as const;

/** [A-Za-z0-9_], as a regex \b sees it. NaN (past the end) is not a word character. */
function isWordChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** `name` (lowercase ASCII) at `at`, ASCII case-insensitive, followed by a word boundary. */
function tagNameAt(html: string, at: number, name: string): boolean {
  if (at + name.length > html.length) return false;
  for (let i = 0; i < name.length; i++) {
    // `| 0x20` lowercases A–Z; no other code unit maps onto a lowercase letter.
    if ((html.charCodeAt(at + i) | 0x20) !== name.charCodeAt(i)) return false;
  }
  return !isWordChar(html.charCodeAt(at + name.length));
}

/**
 * Each <strong>/<b> span as Markdown bold, by an indexOf scan: what
 * `html.replace(/<(strong|b)\b[^<>]*>((?:(?!<\/?\1\b)[\s\S])*)<\/\1>/gi, …)`
 * did, without its backtracking (a single span over ~8 MB overflowed V8's
 * backtrack stack and the lookup fell back to Open5e). A span's body runs up to
 * the next tag of its own name, opening or closing; the span matches only if
 * that tag is exactly `</name>`. So an unclosed tag stays as it is, and a <b>
 * nested in a <strong> keeps the outer bold. Linear: each attempt's body scan
 * ends at the next tag of the same name.
 */
function boldSpans(html: string): string {
  let out = "";
  let last = 0;
  let open = html.indexOf("<");
  while (open !== -1) {
    const end = boldSpanEnd(html, open);
    if (end === null) {
      open = html.indexOf("<", open + 1);
      continue;
    }
    out += html.slice(last, open) + boldInner(html.slice(end.bodyStart, end.bodyEnd));
    last = end.next;
    open = html.indexOf("<", last);
  }
  return last === 0 ? html : out + html.slice(last);
}

/** The span opening at `open` (a "<"), or null when no span matches there. */
function boldSpanEnd(html: string, open: number): { bodyStart: number; bodyEnd: number; next: number } | null {
  const name = BOLD_TAGS.find(n => tagNameAt(html, open + 1, n));
  if (!name) return null;
  // The opening tag's attributes: anything but "<" up to its ">".
  let q = open + 1 + name.length;
  while (q < html.length && html[q] !== ">" && html[q] !== "<") q++;
  if (html[q] !== ">") return null;
  const bodyStart = q + 1;
  for (let r = html.indexOf("<", bodyStart); r !== -1; r = html.indexOf("<", r + 1)) {
    if (html[r + 1] === "/" && tagNameAt(html, r + 2, name)) {
      const close = r + 2 + name.length;
      return html[close] === ">" ? { bodyStart, bodyEnd: r, next: close + 1 } : null;
    }
    if (tagNameAt(html, r + 1, name)) return null;
  }
  return null;
}

/** Wrap a tag's contents in Markdown bold, keeping its surrounding whitespace outside the markers. */
function boldInner(inner: string): string {
  if (!inner.replace(/<[^<>]+>/g, "").trim()) return inner;
  const lead = inner.length - inner.trimStart().length;
  const end = inner.trimEnd().length;
  return `${inner.slice(0, lead)}**${inner.slice(lead, end)}**${inner.slice(end)}`;
}

function abilityMod(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function crDisplay(crValue: number): string {
  if (crValue === 0.125) return "1/8";
  if (crValue === 0.25) return "1/4";
  if (crValue === 0.5) return "1/2";
  return String(crValue);
}

/** A monster name for comparison: case-, edge-whitespace- and apostrophe-insensitive. */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[‘’]/g, "'");
}

function namedCandidates(candidates: DdbMonster[], name: string, allowFuzzy = true): DdbMonster[] {
  const key = nameKey(name);
  if (!key) return []; // "" is a substring of every name
  const exact = candidates.filter(m => nameKey(m.name) === key);
  if (exact.length) return exact;
  const partial = candidates.filter(m => nameKey(m.name).includes(key));
  if (partial.length || !allowFuzzy) return partial;
  // No name contains the query (typos, word order: "Beholdr", "red dragon
  // adult"), but the service ranks its fuzzy hits best-first. Take the top
  // hit's name — not the entry, whose edition twin may be listed first instead.
  const top = candidates[0] ? nameKey(candidates[0].name) : "";
  return top ? candidates.filter(m => nameKey(m.name) === top) : [];
}

/**
 * Size name from the live game config (which has combined sizes such as
 * 10 = "Medium or Small" on 2024 entries), falling back to the built-in map.
 */
function sizeName(config: GameConfig | null, sizeId: number): string | undefined {
  const name = config?.creatureSizes?.find(s => s.id === sizeId)?.name ?? SIZE_MAP[sizeId];
  return name ? stripHtmlRich(name) : undefined;
}

/**
 * The Languages line. 2014 entries carry free text in languageDescription;
 * 2024 entries leave it null and list language IDs (resolved through the game
 * config) with per-language notes such as telepathy range. languageNote holds
 * extra text — on some entries the whole line ("Understands Common … but
 * can't speak"), on others a repeat of languageDescription, which is dropped.
 */
function languagesLine(m: DdbMonster, config: GameConfig | null): string {
  const description = stripHtmlRich(m.languageDescription);
  const listed = description || (m.languages ?? [])
    .map(l => {
      const name = stripHtmlRich(config?.languages?.find(c => c.id === l.languageId)?.name) || `Language #${l.languageId}`;
      const notes = stripHtmlRich(l.notes);
      return notes ? `${name} ${notes}` : name;
    })
    .join(", ");
  const note = stripHtmlRich(m.languageNote);
  const extra = note && note.toLowerCase() !== listed.toLowerCase() ? note : "";
  return [listed, extra].filter(Boolean).join(", ");
}

// ── API types ─────────────────────────────────────────────────────────────────

interface DdbMonster {
  id: number;
  name: string;
  alignmentId: number;
  sizeId: number;
  typeId: number;
  armorClass: number;
  armorClassDescription: string;
  averageHitPoints: number;
  hitPointDice: { diceString: string } | null;
  passivePerception: number;
  challengeRatingId: number;
  isHomebrew: boolean;
  isLegendary: boolean;
  isMythic: boolean;
  isLegacy: boolean;
  sourceId: number;
  sources: Array<{ sourceId: number; pageNumber: number | null; sourceType: number }>;
  stats: Array<{ statId: number; value: number }>;
  savingThrows: Array<{ statId: number; bonusModifier: number }>;
  senses: Array<{ senseId: number; notes: string }>;
  movements: Array<{ movementId: number; speed: number; notes: string | null }>;
  languages?: Array<{ languageId: number; notes: string | null }>;
  languageDescription: string | null;
  languageNote: string | null;
  skillsHtml: string;
  specialTraitsDescription: string;
  actionsDescription: string;
  reactionsDescription: string;
  legendaryActionsDescription: string;
  mythicActionsDescription: string;
  bonusActionsDescription: string;
}

interface MonsterListResponse {
  pagination: { total: number; currentPage: number; pages: number };
  data: DdbMonster[];
  /**
   * id → accessType for the entries on this page (live 2026-10-18: agreed with
   * the detail endpoint on 60 of 60). 4 = locked to the account; 1 = available.
   */
  accessType?: Record<string, number> | null;
}

/** Merged list accessType maps (id → accessType). A missing id means available. */
type AccessMap = Map<number, number>;

function mergeAccess(into: AccessMap, list: Pick<MonsterListResponse, "accessType"> | null | undefined): void {
  const map = list?.accessType;
  if (!map || typeof map !== "object") return;
  for (const [id, value] of Object.entries(map)) {
    if (typeof value === "number") into.set(Number(id), value);
  }
}

/** Locked iff the list map says 4. Any other value, or no entry, counts as available. */
function isLockedIn(access: AccessMap, id: number): boolean {
  return access.get(id) === 4;
}

interface MonsterSingleResponse {
  accessType: number;
  data: DdbMonster;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * How one tool call asks monster-service. Logged in, with the session (cobalt
 * token and cookies from one snapshot); logged out (`anonymous`), with no
 * credentials at all. Decided once per call, so a call never mixes the two.
 */
interface Asker {
  anonymous: boolean;
}

const LOGGED_IN: Asker = { anonymous: false };

/** The asker for a call starting now. */
function askerNow(): Asker {
  return hasValidSession() ? LOGGED_IN : { anonymous: true };
}

async function monsterFetch(url: string, asker: Asker): Promise<Response> {
  // Logged out: free content only, and nothing that identifies an account.
  if (asker.anonymous) return anonymousFetch(url);
  // Single authenticated-fetch path: token + request bound to one snapshot.
  const session = await beginAuthenticatedSession();
  return session.fetch(url);
}

/**
 * Anonymous answers carry a different accessType map (everything not free is
 * locked), so they are cached under their own keys; logged-in keys are unchanged.
 */
function cacheKeyFor(asker: Asker, key: string): string {
  return asker.anonymous ? `anon:${key}` : key;
}

/** The config the call's stat blocks and CR filter read: the public one when logged out. */
function configFor(asker: Asker): Promise<GameConfig | null> {
  return asker.anonymous ? getPublicGameConfig() : getGameConfig();
}

interface ListOptions {
  sourceIds?: number[];
  skip?: number;
  asker?: Asker;
  /**
   * The caller's session snapshot, when the list must come from the same
   * account as the rest of its reply (availableSourcesFor): checked before the
   * cache read and after the fetch, so a change since then yields an error, not
   * another account's list.
   */
  bound?: SessionSnapshot;
}

/**
 * Fetch (or serve from cache) one page of `/v1/Monster` search results.
 * `sourceIds` filters server-side via repeated `sources=` params, which match
 * an entry's primary *or* reprint sources and keep `pagination.total` honest.
 */
async function fetchMonsterList(search: string, take: number, opts: ListOptions = {}): Promise<MonsterListResponse> {
  const { sourceIds = [], skip = 0, asker = LOGGED_IN, bound } = opts;
  const sourceQs = sourceIds.map(id => `&sources=${id}`).join("");
  const url = `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(search)}&skip=${skip}&take=${take}${sourceQs}`;
  const cacheKey = cacheKeyFor(asker, `monsters:list:${search.toLowerCase()}:skip${skip}:take${take}:src${sourceIds.join(",")}`);
  // Boundary check before the cache read, so a pending account change clears
  // the cache rather than serving the previous account's list.
  const snapshot = captureSession();
  if (bound) assertSessionCurrent(bound);
  const cached = monsterCache.get(cacheKey);
  if (cached !== undefined) return JSON.parse(cached) as MonsterListResponse;

  const resp = await monsterFetch(url, asker);
  if (!resp.ok) throw new Error(`Monster search failed: ${resp.status} ${resp.statusText}`);
  const list = await resp.json() as MonsterListResponse;
  assertSessionCurrent(bound ?? snapshot);
  monsterCache.set(cacheKey, JSON.stringify(list));
  return list;
}

/**
 * Name-search candidates for every spelling in the name's twin group (Thug and
 * Tough are one creature, but a search for one never returns the other),
 * merged in alias order, first copy of each id kept. Only the typed name's own
 * query (the first alias) fails the call; a failed alias query contributes nothing.
 */
async function fetchCandidates(
  name: string, take: number, sourceIds: number[] | undefined, asker: Asker, bound?: SessionSnapshot,
): Promise<{ data: DdbMonster[]; access: AccessMap; snapshot: SessionSnapshot }> {
  // One snapshot for every alias query, as in fetchMonsterPages: lists fetched
  // either side of an account change must not merge. Returned, so a follow-up
  // request (availableSourcesFor) can be held to the same account.
  const snapshot = bound ?? captureSession();
  const [typed, ...others] = twinAliases(name, monsterTwin);
  const [first, ...rest] = await Promise.all([
    fetchMonsterList(typed, take, { sourceIds, asker, bound }),
    ...others.map(alias => fetchMonsterList(alias, take, { sourceIds, asker, bound }).catch(() => null)),
  ]);
  assertSessionCurrent(snapshot);
  const access: AccessMap = new Map();
  for (const list of [first, ...rest]) mergeAccess(access, list);
  return { data: dedupeById([first, ...rest].flatMap(list => list?.data ?? [])), access, snapshot };
}

/** Page size the monster service actually honours — larger `take` values are silently capped. */
const PAGE_SIZE = 100;
/** Most entries a CR/type/size-filtered search pages through (covers the 510-entry 2024 Monster Manual). */
const MAX_FILTER_SCAN = 600;

/**
 * Fetch up to `limit` entries by paging: the first page reveals the total,
 * the rest are fetched in parallel. Used when CR/type/size filter client-side.
 * The service can reorder entries between requests, so pages may overlap (and
 * miss entries); each ID is kept once and callers compare the distinct count
 * with `total` to tell whether the scan was complete.
 */
async function fetchMonsterPages(
  search: string, sourceIds: number[], limit: number, asker: Asker,
): Promise<{ data: DdbMonster[]; total: number; access: AccessMap; snapshot: SessionSnapshot; incomplete: boolean }> {
  // One snapshot for the whole scan: each page checks only its own request,
  // so pages fetched either side of an account change would otherwise merge.
  const snapshot = captureSession();
  const first = await fetchMonsterList(search, PAGE_SIZE, { sourceIds, asker });
  const skips: number[] = [];
  for (let skip = PAGE_SIZE; skip < Math.min(first.pagination.total, limit); skip += PAGE_SIZE) skips.push(skip);
  const rest = await Promise.all(skips.map(skip => fetchMonsterList(search, PAGE_SIZE, { sourceIds, skip, asker })));
  assertSessionCurrent(snapshot);
  const seen = new Set<number>();
  const data = [first, ...rest].flatMap(page => page.data ?? []).filter(m => !seen.has(m.id) && seen.add(m.id));
  const access: AccessMap = new Map();
  for (const page of [first, ...rest]) mergeAccess(access, page);
  // The result set can grow mid-scan: a later page's total, or the entries
  // actually seen, can exceed the first page's, and "checked N of M" must not
  // read N > M.
  const total = Math.max(data.length, ...[first, ...rest].map(page => page.pagination.total));
  // Known incomplete even when the totals agree with what was seen: a full
  // first page whose total says it was the only page (the total lags). A scan
  // that reached `limit` is incomplete only when a total says there is more
  // (callers compare `total` with what was checked), so exactly 600 of 600 is complete.
  // (A first page of exactly PAGE_SIZE reporting PAGE_SIZE is a genuine single page.)
  const incomplete = (first.data?.length ?? 0) >= PAGE_SIZE && first.pagination.total < PAGE_SIZE;
  return { data, total, access, snapshot, incomplete };
}

/** Fetch (or serve from cache) one monster's stat block. */
async function fetchMonsterDetail(id: number, asker: Asker): Promise<MonsterSingleResponse> {
  const cacheKey = cacheKeyFor(asker, `monster:${id}`);
  // Boundary check before the cache read, as in fetchMonsterList.
  const snapshot = captureSession();
  const cached = monsterCache.get(cacheKey);
  if (cached !== undefined) return JSON.parse(cached) as MonsterSingleResponse;

  const resp = await monsterFetch(`${MONSTER_SERVICE}/v1/Monster/${id}`, asker);
  if (!resp.ok) throw new Error(`Monster fetch failed: ${resp.status} ${resp.statusText}`);
  const detail = await resp.json() as MonsterSingleResponse;
  assertSessionCurrent(snapshot);
  monsterCache.set(cacheKey, JSON.stringify(detail));
  return detail;
}

/** Unowned content: the detail endpoint returns an accessType 4 placeholder with no ability scores. */
function isRestricted(detail: MonsterSingleResponse): boolean {
  return detail.accessType === 4 && !detail.data.stats?.length;
}

/**
 * The distinct sources a name appears in (unfiltered search), for "not in that
 * book" errors. Best effort: a failure here must not turn the error into an
 * Open5e substitute, so it yields no hint instead. `bound` is the caller's
 * session snapshot: after an account change the hint is dropped rather than
 * taken from the other account.
 */
async function availableSourcesFor(name: string, index: SourceIndex, asker: Asker, bound: SessionSnapshot): Promise<string[]> {
  try {
    const all = await fetchMonsterList(name, 20, { asker, bound });
    // Official entries in books the source index knows: a homebrew copy filed
    // under a book (or under none) would advertise a source with no official
    // entry, and an unknown id would surface as a bare "source 424242".
    const official = (all.data ?? []).filter(m => m.isHomebrew === false && index.sources.has(m.sourceId));
    // No fuzzy guess: a typo's nearest hit is a different monster.
    const named = namedCandidates(official, name, false).sort(monsterTiebreak(index));
    return [...new Set(named.map(m => sourceLabel(index, m.sourceId)))];
  } catch {
    return [];
  }
}

// ── Formatter ─────────────────────────────────────────────────────────────────

interface StatBlockExtras {
  reason?: RulesLineReason;
  renamed?: { name2014: string; name2024: string };
  /** A sourceNote() line. */
  note?: string | null;
  /** An availableElsewhereHint() line. */
  hint?: string | null;
  /** Overrides the entry's own classification (source: "homebrew"). */
  info?: EditionInfo;
  /** Asked anonymously: a restricted block says to log in, not that content needs owning. */
  loggedOut?: boolean;
}

function formatStatBlock(
  m: DdbMonster, accessType: number, config: GameConfig | null, index: SourceIndex, extras: StatBlockExtras = {},
): string {
  const crEntry = config?.challengeRatings.find(cr => cr.id === m.challengeRatingId);
  const crStr = crEntry ? crDisplay(crEntry.value) : `(id:${m.challengeRatingId})`;
  const xpStr = crEntry?.xp ? ` (${crEntry.xp.toLocaleString()} XP)` : "";
  const typeName = config?.monsterTypes.find(t => t.id === m.typeId)?.name ?? `type ${m.typeId}`;
  const size = sizeName(config, m.sizeId) ?? "Unknown size";
  const alignment = config?.alignments.find(a => a.id === m.alignmentId)?.name ?? "Unaligned";

  const lines: string[] = [];
  lines.push(`# ${m.name}`);
  lines.push(rulesLine(extras.info ?? classifyEdition(m, index), { reason: extras.reason }));
  if (extras.renamed) lines.push(renameLine(extras.renamed.name2014, extras.renamed.name2024));
  if (extras.note) lines.push(extras.note);
  if (extras.hint) lines.push(extras.hint);
  lines.push(`*${size} ${typeName}, ${alignment}*`);
  // Name the book (as ddb_search_monsters does) so same-named 2014/2024 blocks are distinguishable.
  if (m.sourceId) lines.push(`**Source** ${sourceLabel(index, m.sourceId)}`);
  lines.push("");
  lines.push(`**Armor Class** ${m.armorClass}${m.armorClassDescription ? " " + m.armorClassDescription.trim() : ""}`);
  lines.push(`**Hit Points** ${m.averageHitPoints}${m.hitPointDice?.diceString ? " (" + m.hitPointDice.diceString + ")" : ""}`);

  if (m.movements?.length) {
    const speeds = m.movements.map(mv => {
      const name = MOVEMENT_NAMES[mv.movementId] ?? "walk";
      return name === "walk" ? `${mv.speed} ft.` : `${name} ${mv.speed} ft.`;
    });
    lines.push(`**Speed** ${speeds.join(", ")}`);
  }

  if (m.stats?.length) {
    lines.push("");
    const statLine = [...m.stats]
      .sort((a, b) => a.statId - b.statId)
      .map(s => `**${STAT_NAMES[s.statId] ?? s.statId}** ${s.value} (${abilityMod(s.value)})`)
      .join(" | ");
    lines.push(statLine);
  }

  lines.push("");

  if (m.savingThrows?.length) {
    // bonusModifier is null in the live API — derive from stat mod + CR proficiency bonus.
    const profBonus = crEntry?.proficiencyBonus ?? 2;
    const statMap = new Map(m.stats?.map(s => [s.statId, s.value]) ?? []);
    const saves = m.savingThrows
      .map(s => {
        const bonus = s.bonusModifier != null
          ? s.bonusModifier
          : Math.floor(((statMap.get(s.statId) ?? 10) - 10) / 2) + profBonus;
        const sign = bonus >= 0 ? "+" : "";
        return `${STAT_NAMES[s.statId] ?? s.statId} ${sign}${bonus}`;
      })
      .join(", ");
    lines.push(`**Saving Throws** ${saves}`);
  }

  if (m.skillsHtml) {
    lines.push(`**Skills** ${stripHtmlRich(m.skillsHtml)}`);
  }

  if (m.senses?.length) {
    const senseStrs = m.senses.map(s => {
      const name = config?.senses.find(cs => cs.id === s.senseId)?.name ?? `sense ${s.senseId}`;
      return `${name} ${s.notes}`;
    });
    senseStrs.push(`passive Perception ${m.passivePerception}`);
    lines.push(`**Senses** ${senseStrs.join(", ")}`);
  } else {
    lines.push(`**Senses** passive Perception ${m.passivePerception}`);
  }

  const languages = languagesLine(m, config);
  if (languages) {
    lines.push(`**Languages** ${languages}`);
  }

  lines.push(`**Challenge** ${crStr}${xpStr}`);

  if (m.specialTraitsDescription) {
    lines.push("\n---\n");
    lines.push(statBlockText(m.specialTraitsDescription));
  }
  if (m.actionsDescription) {
    lines.push("\n## Actions\n");
    lines.push(statBlockText(m.actionsDescription));
  }
  if (m.bonusActionsDescription) {
    lines.push("\n## Bonus Actions\n");
    lines.push(statBlockText(m.bonusActionsDescription));
  }
  if (m.reactionsDescription) {
    lines.push("\n## Reactions\n");
    lines.push(statBlockText(m.reactionsDescription));
  }
  if (m.legendaryActionsDescription) {
    lines.push("\n## Legendary Actions\n");
    lines.push(statBlockText(m.legendaryActionsDescription));
  }
  if (m.mythicActionsDescription) {
    lines.push("\n## Mythic Actions\n");
    lines.push(statBlockText(m.mythicActionsDescription));
  }

  // accessType 4 = restricted — basic stats returned but ability scores and actions may be empty.
  if (accessType === 4 && (!m.stats?.length || !m.actionsDescription)) {
    lines.push(extras.loggedOut
      ? `\n---\n${LOGGED_OUT_RESTRICTED_NOTE}`
      : "\n---\n*⚠️ Full stat block requires ownership of this content on D&D Beyond. Ability scores and actions may be missing.*");
  }

  return lines.join("\n");
}

// ── Exported tool functions ───────────────────────────────────────────────────

// `source: "homebrew"` never returns official entries, so when D&D Beyond
// can't be used these replace the Open5e (SRD) fallback, for get and search alike.
const HOMEBREW_LOGIN_REQUIRED = homebrewLoginRequired("monster");
const HOMEBREW_UNREACHABLE = homebrewUnreachable("monsters");

/** The challenge ratings D&D Beyond's config lists (live 2026-11-02: 34 entries). */
const VALID_CRS = new Set([0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)]);

/**
 * A `cr` no monster can have. Checked before either path runs, so D&D Beyond
 * doesn't skip the filter (no CR id to match) and Open5e doesn't answer "no matches".
 */
function unknownCrError(cr: number): string | null {
  return VALID_CRS.has(cr) ? null : `Unknown CR "${cr}". Valid CRs: 0, 0.125, 0.25, 0.5, 1–30.`;
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
function plainOrSection(r: string | SearchSection): SearchSection {
  return typeof r === "string" ? plainSection(r) : r;
}

async function monsterSearchParts(params: MonsterSearchParams): Promise<string | SearchSection> {
  const crError = params.cr === undefined ? null : unknownCrError(params.cr);
  if (crError) return crError;
  const homebrew = isHomebrewSource(params.source);
  // Logged out, monster-service is still asked (anonymously); homebrew needs an account.
  const asker = askerNow();
  if (asker.anonymous && homebrew) return HOMEBREW_LOGIN_REQUIRED;
  const requested = params.rulesEdition ?? "2024";

  try {
  const config = await configFor(asker);
  // No config means no CR, type or size tables: a filter can't be applied (the
  // CR filter used to be skipped, type and size to match nothing), and logged
  // out a stat block or line would read "(id:N)" / "type N". Answer from Open5e
  // as "unavailable" instead (owner ruling 2026-11-02).
  if (!config && (asker.anonymous || params.cr !== undefined || params.type || params.size)) {
    throw new Error("Game config unavailable");
  }
  // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
  const index = await getSourceIndex();
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
  assertSessionCurrent(snapshot);
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
  if (homebrew) {
    // Fail closed, as the untrusted wrapping does: anything not explicitly official.
    monsters = fetched.filter(m => m.isHomebrew !== false && passes(m)).map(m => ({ m, info: HOMEBREW_INFO }));
  } else if (params.source) {
    monsters = fetched.filter(passes).map(m => ({ m, info: info(m) }));
  } else {
    // countFilteredPicks: a group whose requested pick fails the CR/type/size
    // filters while the other edition's pick passes is counted as hidden, as in
    // the catalog searches. A locked group's swapped pick is never counted.
    // Logged out, a group that would swap (every requested entry locked, a free
    // other-edition twin) is not swapped when the requested edition's SRD has
    // the creature: its stat block is that SRD text (owner ruling 2026-11-02).
    // Such a group counts as available before selection, so the filters and the
    // hidden count judge its requested pick like any other.
    const srdBacked = asker.anonymous ? await srdBackedGroups(fetched, access, requested, info, monsterTiebreak(index), passes) : new Map<string, O5EditionMonster>();
    const picked = groupAndSelect(fetched, requested, {
      info, twinKey: m => monsterTwin(m.name), tiebreak: monsterTiebreak(index), passes,
      available: m => !isLockedIn(access, m.id) || srdBacked.has(monsterTwin(m.name)),
      countFilteredPicks: true,
    });
    monsters = picked.selected.map(s => ({
      m: s.entry, info: s.info, reason: s.reason,
      srd: s.info.ruleset === requested ? srdBacked.get(monsterTwin(s.entry.name)) : undefined,
    }));
    hidden = picked.hidden;
  }

  if (monsters.length === 0) {
    const scope = partialScan ? ` (checked the first ${checked} of ${totalText} entries)` : "";
    if (homebrew) {
      return searchTerm
        ? `No homebrew monsters found matching "${searchTerm}"${scope}.`
        : `No homebrew monsters found matching the search criteria${scope}.`;
    }
    if (params.source) {
      // Open5e only carries the SRD — never substitute it for a requested book.
      const where = sourceLabel(index, sourceIds[0]);
      let msg = `No monsters matching the search criteria in ${where}${scope}.`;
      if (searchTerm) {
        const available = await availableSourcesFor(searchTerm, index, asker, snapshot);
        if (available.length) msg += ` "${searchTerm}" appears in: ${available.join(", ")}.`;
      }
      return msg;
    }
    // Only the other edition has a match: say so, rather than substitute the SRD.
    if (hidden > 0) {
      return {
        header: searchHeader({ requested }),
        body: `No monsters found matching the search criteria${scope}.`,
        footer: searchFooter(requested, hidden),
        hidden,
      };
    }
    return await o5SearchMonstersSection(params, "not-found").catch(() => "No monsters found matching the search criteria.");
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


export async function getMonster(
  monsterName: string,
  opts: { source?: string; rulesEdition?: RulesEdition } = {},
): Promise<string> {
  const { source } = opts;
  const requested = opts.rulesEdition ?? "2024";
  monsterName = monsterName.trim();
  if (!monsterName) return "Monster name is required.";
  const homebrew = isHomebrewSource(source);
  // Logged out, monster-service is still asked (anonymously); homebrew needs an account.
  const asker = askerNow();
  if (asker.anonymous && homebrew) return HOMEBREW_LOGIN_REQUIRED;

  try {
    const config = await configFor(asker);
    // Without the config (public or session-bound), a stat block would read
    // "(id:N)" / "type N": use Open5e as "unavailable" (owner ruling 2026-11-02).
    // Homebrew has no Open5e answer and keeps its D&D Beyond block.
    if (!config && !homebrew) throw new Error("Game config unavailable");
    // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
    const index = await getSourceIndex();
    const info = (m: DdbMonster) => classifyEdition(m, index);
    const tiebreak = monsterTiebreak(index);
    let sourceIds: number[] = [];
    if (source && !homebrew) {
      sourceIds = resolveSourceIds(index, source);
      if (!sourceIds.length) return unknownSourceError(index, source);
    }

    // 20 slots per spelling so a crowded name (e.g. "Zombie" has Ash/Beholder/
    // Girallon/Greater/Ogre/Strahd/Yellow Musk/plain across both editions)
    // doesn't miss the intended entry. Homebrew pages through the same
    // MAX_FILTER_SCAN entries as searchMonsters, so get and search agree.
    const { data: candidates, access, snapshot } = homebrew
      ? await fetchMonsterPages(monsterName, [], MAX_FILTER_SCAN, asker)
      : await fetchCandidates(monsterName, 20, sourceIds, asker);

    let detail: MonsterSingleResponse;
    let extras: StatBlockExtras;
    if (homebrew) {
      // Homebrew only (fail closed: anything not explicitly official): exact
      // name first, then partial, each by tiebreak. No twins, so no edition
      // selection, swap, reason or note; a locked entry shows the restricted block.
      const query = normalizeName(monsterName);
      const own = candidates.filter(m => m.isHomebrew !== false);
      const pick = own.filter(m => normalizeName(m.name) === query).sort(tiebreak)[0]
        ?? own.filter(m => normalizeName(m.name).includes(query)).sort(tiebreak)[0];
      if (!pick) return `No homebrew monster found matching "${monsterName}".`;
      detail = await fetchMonsterDetail(pick.id, asker);
      extras = { info: HOMEBREW_INFO, loggedOut: asker.anonymous };
    } else if (source) {
      // With a source, require an exact (twin) name: a partial match would
      // quietly turn "Zombie" in mm-2014 into Beholder Zombie. Near names are offered instead.
      const key = monsterTwin(monsterName);
      const picked = selectByEdition(candidates.filter(m => monsterTwin(m.name) === key), requested, info, tiebreak);
      if (!picked) {
        // A requested book is never silently swapped for another edition or the SRD.
        // Homebrew names are user-authored — keep them out of this hint.
        const similar = [...new Set(namedCandidates(candidates, monsterName).filter(m => !m.isHomebrew).map(m => m.name))].slice(0, 5);
        const available = await availableSourcesFor(monsterName, index, asker, snapshot);
        let msg = `No "${monsterName}" entry found in source "${source}".`;
        if (similar.length) msg += ` Similar names in that source: ${similar.join(", ")}.`;
        msg += available.length
          ? ` Available sources for "${monsterName}": ${available.join(", ")}.`
          : ` Try ddb_search_monsters with a partial name.`;
        return msg;
      }
      // `source` wins over rules_edition, so the reason is dropped; a book of
      // the other edition gets a note instead. A restricted pick is never
      // swapped or replaced with Open5e: the book was asked for, and the
      // restricted block already says the content isn't owned. It does get a
      // hint naming a book where an available version is.
      detail = await fetchMonsterDetail(picked.entry.id, asker);
      const shown = info(detail.data);
      extras = {
        note: isEdition(shown.ruleset) ? sourceNote(source, shown.ruleset, requested) : null,
        // Only 2014/2024 entries are twins, so only they can be shown under
        // another name than the query's (as in lookupByName).
        renamed: isEdition(shown.ruleset) ? renamedFromQuery(monsterName, detail.data.name) : undefined,
        hint: isRestricted(detail)
          ? await availableElsewhere(monsterName, picked.entry, sourceIds, index, asker, snapshot).catch(() => null)
          : null,
        loggedOut: asker.anonymous,
      };
    } else {
      const lookup = (available: (m: DdbMonster) => boolean) => lookupByName(candidates, monsterName, requested, {
        name: m => m.name,
        info,
        tiebreak,
        twinName: monsterTwin,
        // No name contains the query (typos, word order: "Beholdr", "red dragon
        // adult"), but the service ranks its fuzzy hits best-first: take the top
        // hit, whose whole twin group is then the target.
        partialMatch: (all, q) => all.filter(m => normalizeName(m.name).includes(q)).sort(tiebreak)[0] ?? all[0],
        available,
      });
      // The list map picks an available entry (the requested edition's first,
      // else the other edition's with a locked-… reason) without fetching a
      // locked one's stat block.
      const mapAvailable = (m: DdbMonster) => !isLockedIn(access, m.id);
      let found = lookup(mapAvailable);
      if (!found) {
        const o5Result = await o5GetMonster(monsterName, requested, "not-found").catch(() => null);
        if (o5Result) return o5Result;
        return `Monster "${monsterName}" not found. Try ddb_search_monsters with a partial name.`;
      }
      // Logged out, a locked requested edition with SRD text shows that text
      // rather than the other edition (owner ruling 2026-11-02).
      if (asker.anonymous && isLockedReason(found.reason)) {
        const wanted = lookup(() => true)?.entry;
        if (wanted && info(wanted).ruleset === requested) {
          const srd = await o5MonsterInEdition(wanted.name, requested).catch(() => null);
          if (srd) return srd.text("needs-login");
        }
      }
      detail = await fetchMonsterDetail(found.entry.id, asker);
      // The detail check is the fallback when the map lacked the id or called a
      // restricted pick available: try the next candidate in the same order,
      // at most one extra (cached) detail request.
      const first = found;
      if (isRestricted(detail) && !isLockedIn(access, first.entry.id)) {
        const retry = lookup(m => mapAvailable(m) && m.id !== first.entry.id);
        if (retry && retry.entry.id !== first.entry.id) {
          const retryDetail = await fetchMonsterDetail(retry.entry.id, asker);
          if (!isRestricted(retryDetail)) {
            found = retry;
            detail = retryDetail;
          }
        }
      }
      extras = {
        reason: asker.anonymous && isLockedReason(found.reason) ? loggedOutReason(found.reason) : found.reason,
        renamed: found.renamed,
        loggedOut: asker.anonymous,
      };

      // Still an empty stat block (unowned content): fall back to Open5e. Logged
      // out, the label says the D&D Beyond version needs a login (owner ruling 2026-11-02).
      if (isRestricted(detail)) {
        // Logged out, the locked pick's edition goes along, so an answer from the
        // other SRD doesn't claim "no <edition> version found".
        const lockedRuleset = info(detail.data).ruleset;
        const o5Result = await (asker.anonymous
          ? o5GetMonster(monsterName, requested, "needs-login", isEdition(lockedRuleset) ? lockedRuleset : undefined)
          : o5GetMonster(monsterName, requested, "unavailable")).catch(() => null);
        if (o5Result) return o5Result;
      }
    }

    const statBlock = formatStatBlock(detail.data, detail.accessType, config, index, extras);
    // Homebrew stat blocks are user-authored free text (trait/action
    // descriptions) — delimit as untrusted. Official WotC content is not.
    // Fail closed: only an explicitly official entry is left plain.
    return detail.data.isHomebrew === false ? statBlock : wrapUntrusted(statBlock);
  } catch {
    if (homebrew) return HOMEBREW_UNREACHABLE;
    const o5Result = await o5GetMonster(monsterName, requested, "unavailable").catch(() => null);
    if (o5Result) return withSourceCaveat(o5Result, source);
    return `Monster "${monsterName}" not found. D&D Beyond is unavailable and "${monsterName}" is not in the SRD.${asker.anonymous ? NOT_LOGGED_IN_SUFFIX : ""}`;
  }
}

/**
 * For a restricted pick in a requested book: the first official entry of its
 * twin group, by tiebreak, that the list map doesn't mark locked and that isn't
 * in that book, as a hint line. Books the index doesn't know are skipped (same
 * filter as availableSourcesFor). A book with no slug is passed by short name.
 */
async function availableElsewhere(
  name: string, pick: DdbMonster, sourceIds: number[], index: SourceIndex, asker: Asker, bound: SessionSnapshot,
): Promise<string | null> {
  const { data, access } = await fetchCandidates(name, 20, undefined, asker, bound);
  const key = monsterTwin(pick.name);
  const inBook = (m: DdbMonster) =>
    sourceIds.includes(m.sourceId) || (m.sources ?? []).some(s => sourceIds.includes(s.sourceId));
  const alt = data
    .filter(m => monsterTwin(m.name) === key && m.isHomebrew === false && index.sources.has(m.sourceId)
      && !isLockedIn(access, m.id) && !inBook(m))
    .sort(monsterTiebreak(index))[0];
  if (!alt) return null;
  const book = index.sources.get(alt.sourceId)!;
  return availableElsewhereHint(sourceLabel(index, alt.sourceId), sourceSlug(book) || book.name);
}

/**
 * The rename line's names when a `source` lookup shows a twin under another
 * name than the query's (Thug → Tough): the 2024 name is the twin key, as in
 * lookupByName. Undefined when the shown name is the query's.
 */
function renamedFromQuery(query: string, shownName: string): { name2014: string; name2024: string } | undefined {
  const normalizedQuery = normalizeName(query);
  if (normalizeName(shownName) === normalizedQuery) return undefined;
  const typed = monsterTwin.spell?.(normalizedQuery) ?? query.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  return normalizeName(shownName) === monsterTwin(shownName)
    ? { name2014: typed, name2024: shownName }
    : { name2014: shownName, name2024: typed };
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
async function withListStats<R extends { m: DdbMonster; info: EditionInfo; srd?: O5EditionMonster }>(
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
async function srdBackedGroups(
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

/** Defined beside o5GetMonsterStats, which returns it too. */
export type { MonsterStatsResult };

/**
 * CR and XP for a named monster, for the encounter rater and the treasure
 * generator. Tries the DDB monster service first (anonymously when logged
 * out), then falls back to Open5e.
 * `rulesEdition` (default "2024") picks between edition twins of one creature.
 *
 * Unlike getMonster, it never guesses (on either path): callers fold the CR
 * into a rating or a treasure roll, where a near-miss creature would silently
 * skew the result. So there is no fuzzy fallback, and a partial name matching
 * several distinct creatures ("Red Dragon": Wyrmling … Ancient) is reported as
 * ambiguous with each candidate's CR instead of picked. Homebrew is skipped too:
 * callers print the returned name as trusted text, and the rating should use
 * official CRs.
 */
export async function getMonsterStats(name: string, opts: { rulesEdition?: RulesEdition } = {}): Promise<MonsterStatsResult> {
  name = name.trim();
  if (!name) return { status: "not-found" };
  const requested = opts.rulesEdition ?? "2024";
  // Logged out, monster-service is still asked, anonymously.
  const asker = askerNow();
  // Set when D&D Beyond's only pick is another edition's entry with an unknown CR.
  let unknownElsewhere: MonsterStatsResult | null = null;
  try {
    const config = await configFor(asker);
    // No CR table, no CR: Open5e answers instead.
    if (!config) throw new Error("Game config unavailable");
    // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
    const index = await getSourceIndex();
    const info = (m: DdbMonster) => classifyEdition(m, index);
    const tiebreak = monsterTiebreak(index);
    const crById = new Map(config.challengeRatings.map(cr => [cr.id, cr]));
    // No access map: the requested edition's entry is picked whether or not it
    // is locked (its list entry carries its CR), so logged out a locked 2024
    // entry gives its own CR, never its free 2014 twin's.
    const official = (await fetchCandidates(name, 20, undefined, asker)).data.filter(m => m.isHomebrew === false);
    const stats = (m: DdbMonster) => {
      const cr = crById.get(m.challengeRatingId);
      return cr ? { name: m.name, crValue: cr.value, xp: cr.xp } : { name: m.name, crValue: null, xp: null };
    };
    // The edition is picked over every name match first; a pick whose CR the
    // config doesn't know is never replaced by its other-edition twin (fail
    // closed, as o5GetMonsterStats does): it is unknown-cr.
    const found = (group: DdbMonster[]): MonsterStatsResult | null => {
      const picked = selectByEdition(group, requested, info, tiebreak);
      if (!picked) return null;
      const s = stats(picked.entry);
      return s.crValue !== null && s.xp !== null
        ? { status: "found", name: s.name, crValue: s.crValue, xp: s.xp, info: info(picked.entry) }
        : { status: "unknown-cr", name: s.name, info: info(picked.entry) };
    };
    // D&D Beyond identified the creature but not its CR. The requested
    // edition's entry ends the lookup there: Open5e must not answer with the
    // other edition's SRD record. Another edition's pick (no requested-edition
    // entry) still lets Open5e try the requested edition's SRD.
    const settle = (result: MonsterStatsResult | null): MonsterStatsResult | null => {
      if (result?.status !== "unknown-cr" || result.info.ruleset === requested) return result;
      unknownElsewhere = result;
      return null;
    };

    const key = monsterTwin(name);
    const exact = official.filter(m => monsterTwin(m.name) === key);
    if (exact.length) {
      const result = settle(found(exact));
      if (result) return result;
    } else {
      const query = normalizeName(name);
      const groups = new Map<string, DdbMonster[]>();
      for (const m of official) {
        if (!normalizeName(m.name).includes(query)) continue;
        const k = monsterTwin(m.name);
        groups.set(k, [...(groups.get(k) ?? []), m]);
      }
      if (groups.size === 1) {
        const result = settle(found([...groups.values()][0]));
        if (result) return result;
      } else if (groups.size > 1) {
        const candidates = [...groups.values()]
          .map(group => selectByEdition(group, requested, info, tiebreak))
          .filter(picked => picked !== null)
          .map(picked => stats(picked.entry));
        // Unknown CRs are listed ("CR unknown"), last; all unknown falls through to Open5e.
        if (candidates.some(c => c.crValue !== null)) {
          candidates.sort((a, b) => (a.crValue === null ? 1 : 0) - (b.crValue === null ? 1 : 0)
            || (a.crValue ?? 0) - (b.crValue ?? 0) || a.name.localeCompare(b.name));
          return { status: "ambiguous", candidates };
        }
      }
    }
  } catch {
    // fall through to Open5e
  }

  const o5 = await o5GetMonsterStats(name, requested);
  return o5.status === "not-found" && unknownElsewhere ? unknownElsewhere : o5;
}
