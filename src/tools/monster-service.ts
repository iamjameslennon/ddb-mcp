/**
 * monster-service.ts — the D&D Beyond monster-service layer: wire types, the
 * asker/session helpers, the fetchers, the response cache and name helpers.
 * Shared by monster.ts (get, stats) and monster-search.ts (search).
 */

import {
  beginAuthenticatedSession, anonymousFetch, hasValidSession,
  captureSession, assertSessionCurrent, onSessionInvalidated, type SessionSnapshot,
  AnonymousFetchTimeoutError, SessionLayerError, CobaltTokenError, CobaltTokenTimeoutError, MalformedCobaltTokenError,
} from "../session-fetch.js";
import { getGameConfig, getPublicGameConfig, type GameConfig } from "../game-config.js";
import { monsterTiebreak, twinNames, twinAliases, dedupeById, type SourceIndex } from "../edition.js";
import { sourceLabel } from "../source-filter.js";
import { TtlCache } from "../cache.js";
import { stripHtmlRich } from "../utils.js";

export const MONSTER_SERVICE = "https://monster-service.dndbeyond.com";

/** Monster twin names: the monster rename pairs only (decision 5), so "Evoker" never also queries "School of Evocation". */
export const monsterTwin = twinNames.monster;

export const SIZE_MAP: Record<number, string> = {
  2: "Tiny", 3: "Small", 4: "Medium", 5: "Large", 6: "Huge", 7: "Gargantuan",
};

// ── Cache ─────────────────────────────────────────────────────────────────────

export const monsterCache = new TtlCache<string>(24 * 60 * 60_000, 200); // 24 h, 200 entries

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

export function crDisplay(crValue: number): string {
  if (crValue === 0.125) return "1/8";
  if (crValue === 0.25) return "1/4";
  if (crValue === 0.5) return "1/2";
  return String(crValue);
}

/** A monster name for comparison: case-, edge-whitespace- and apostrophe-insensitive. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[‘’]/g, "'");
}

export function namedCandidates(candidates: DdbMonster[], name: string, allowFuzzy = true): DdbMonster[] {
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
export function sizeName(config: GameConfig | null, sizeId: number): string | undefined {
  const name = config?.creatureSizes?.find(s => s.id === sizeId)?.name ?? SIZE_MAP[sizeId];
  return name ? stripHtmlRich(name) : undefined;
}

// ── API types ─────────────────────────────────────────────────────────────────

export interface DdbMonster {
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

export interface MonsterListResponse {
  pagination: { total: number; currentPage: number; pages: number };
  data: DdbMonster[];
  /**
   * id → accessType for the entries on this page (live 2026-10-18: agreed with
   * the detail endpoint on 60 of 60). 4 = locked to the account; 1 = available.
   */
  accessType?: Record<string, number> | null;
}

/** Merged list accessType maps (id → accessType). A missing id means available. */
export type AccessMap = Map<number, number>;

export function mergeAccess(into: AccessMap, list: Pick<MonsterListResponse, "accessType"> | null | undefined): void {
  const map = list?.accessType;
  if (!map || typeof map !== "object") return;
  for (const [id, value] of Object.entries(map)) {
    if (typeof value === "number") into.set(Number(id), value);
  }
}

/** Locked iff the list map says 4. Any other value, or no entry, counts as available. */
export function isLockedIn(access: AccessMap, id: number): boolean {
  return access.get(id) === 4;
}

export interface MonsterSingleResponse {
  accessType: number;
  data: DdbMonster;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * How one tool call asks monster-service. Logged in, with the session (cobalt
 * token and cookies from one snapshot); logged out (`anonymous`), with no
 * credentials at all. Decided once per call, so a call never mixes the two.
 */
export interface Asker {
  anonymous: boolean;
}

export const LOGGED_IN: Asker = { anonymous: false };

/** The asker for a call starting now. */
/** monster-service answered with a non-OK status: an outage-class failure. */
export class MonsterServiceHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonsterServiceHttpError";
  }
}

/** monster-service's response body was not valid JSON (an error page, say): an outage-class failure. */
export class MonsterServiceParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MonsterServiceParseError";
  }
}

/** The game config (CR tables) could not be had, so the D&D Beyond branch can't run. */
export class GameConfigUnavailableError extends Error {
  constructor() {
    super("Game config unavailable");
    this.name = "GameConfigUnavailableError";
  }
}

/**
 * A failure of D&D Beyond being unreachable, as opposed to a bug: a network
 * error (a `TypeError` with a `cause`), an unparseable response body, a session-layer error, an abort or
 * timeout, an HTTP error status, a failed cobalt-token exchange, or no game
 * config. The "Couldn't look up" output already reports these, so they are not
 * logged.
 */
export function isExpectedOutage(e: unknown): boolean {
  return (e instanceof TypeError && e.cause !== undefined) // undici's network failure always carries a cause; a bare TypeError is a code bug (owner ruling, revised)
    || e instanceof SessionLayerError // no session, a rewrite race, a revoke cleanup: the session layer, not our logic
    || e instanceof MonsterServiceParseError
    || (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError"))
    || e instanceof AnonymousFetchTimeoutError
    || e instanceof MonsterServiceHttpError
    || e instanceof GameConfigUnavailableError
    || e instanceof CobaltTokenError
    || e instanceof CobaltTokenTimeoutError
    || e instanceof MalformedCobaltTokenError;
}

export function askerNow(): Asker {
  return hasValidSession() ? LOGGED_IN : { anonymous: true };
}

export async function monsterFetch(url: string, asker: Asker): Promise<Response> {
  // Logged out: free content only, and nothing that identifies an account.
  if (asker.anonymous) return anonymousFetch(url);
  // Single authenticated-fetch path: token + request bound to one snapshot.
  const session = await beginAuthenticatedSession();
  return session.fetch(url);
}

/**
 * The post-fetch session check. An anonymous answer carries no account data and is
 * cached under its own `anon:` keys (chosen from the asker before the request, so a
 * login landing mid-request can't move it under a logged-in key), so a session
 * transition does not invalidate it — and after ddb_logout, when every snapshot
 * reads as changed, the check would discard a good anonymous answer. An
 * authenticated answer is still held to its snapshot.
 */
export function assertCurrentAfter(snapshot: SessionSnapshot, asker: Asker): void {
  if (!asker.anonymous) assertSessionCurrent(snapshot);
}

/**
 * Anonymous answers carry a different accessType map (everything not free is
 * locked), so they are cached under their own keys; logged-in keys are unchanged.
 */
export function cacheKeyFor(asker: Asker, key: string): string {
  return asker.anonymous ? `anon:${key}` : key;
}

/** The config the call's stat blocks and CR filter read: the public one when logged out. */
export function configFor(asker: Asker): Promise<GameConfig | null> {
  return asker.anonymous ? getPublicGameConfig() : getGameConfig();
}

export interface ListOptions {
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
export async function fetchMonsterList(search: string, take: number, opts: ListOptions = {}): Promise<MonsterListResponse> {
  const { sourceIds = [], skip = 0, asker = LOGGED_IN, bound } = opts;
  const sourceQs = sourceIds.map(id => `&sources=${id}`).join("");
  const url = `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(search)}&skip=${skip}&take=${take}${sourceQs}`;
  const cacheKey = cacheKeyFor(asker, `monsters:list:${search.toLowerCase()}:skip${skip}:take${take}:src${sourceIds.join(",")}`);
  // Boundary check before the cache read, so a pending account change clears
  // the cache rather than serving the previous account's list.
  const snapshot = captureSession();
  if (bound && !asker.anonymous) assertSessionCurrent(bound);
  const cached = monsterCache.get(cacheKey);
  if (cached !== undefined) return JSON.parse(cached) as MonsterListResponse;

  const resp = await monsterFetch(url, asker);
  if (!resp.ok) throw new MonsterServiceHttpError(`Monster search failed: ${resp.status} ${resp.statusText}`);
  let list: MonsterListResponse;
  try {
    list = await resp.json() as MonsterListResponse;
  } catch (e) {
    // Only the body parse: a SyntaxError anywhere else is not an outage.
    throw e instanceof SyntaxError ? new MonsterServiceParseError(e.message, { cause: e }) : e;
  }
  assertCurrentAfter(bound ?? snapshot, asker);
  monsterCache.set(cacheKey, JSON.stringify(list));
  return list;
}

/**
 * Name-search candidates for every spelling in the name's twin group (Thug and
 * Tough are one creature, but a search for one never returns the other),
 * merged in alias order, first copy of each id kept. Only the typed name's own
 * query (the first alias) fails the call; a failed alias query contributes nothing.
 */
export async function fetchCandidates(
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
  assertCurrentAfter(snapshot, asker);
  const access: AccessMap = new Map();
  for (const list of [first, ...rest]) mergeAccess(access, list);
  return { data: dedupeById([first, ...rest].flatMap(list => list?.data ?? [])), access, snapshot };
}

/** Page size the monster service actually honours — larger `take` values are silently capped. */
export const PAGE_SIZE = 100;
/** Most entries a CR/type/size-filtered search pages through (covers the 510-entry 2024 Monster Manual). */
export const MAX_FILTER_SCAN = 600;

/**
 * Fetch up to `limit` entries by paging: the first page reveals the total,
 * the rest are fetched in parallel. Used when CR/type/size filter client-side.
 * The service can reorder entries between requests, so pages may overlap (and
 * miss entries); each ID is kept once and callers compare the distinct count
 * with `total` to tell whether the scan was complete.
 */
export async function fetchMonsterPages(
  search: string, sourceIds: number[], limit: number, asker: Asker,
): Promise<{ data: DdbMonster[]; total: number; access: AccessMap; snapshot: SessionSnapshot; incomplete: boolean }> {
  // One snapshot for the whole scan: each page checks only its own request,
  // so pages fetched either side of an account change would otherwise merge.
  const snapshot = captureSession();
  const first = await fetchMonsterList(search, PAGE_SIZE, { sourceIds, asker });
  const skips: number[] = [];
  for (let skip = PAGE_SIZE; skip < Math.min(first.pagination.total, limit); skip += PAGE_SIZE) skips.push(skip);
  const rest = await Promise.all(skips.map(skip => fetchMonsterList(search, PAGE_SIZE, { sourceIds, skip, asker })));
  assertCurrentAfter(snapshot, asker);
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
export async function fetchMonsterDetail(id: number, asker: Asker): Promise<MonsterSingleResponse> {
  const cacheKey = cacheKeyFor(asker, `monster:${id}`);
  // Boundary check before the cache read, as in fetchMonsterList.
  const snapshot = captureSession();
  const cached = monsterCache.get(cacheKey);
  if (cached !== undefined) return JSON.parse(cached) as MonsterSingleResponse;

  const resp = await monsterFetch(`${MONSTER_SERVICE}/v1/Monster/${id}`, asker);
  if (!resp.ok) throw new Error(`Monster fetch failed: ${resp.status} ${resp.statusText}`);
  const detail = await resp.json() as MonsterSingleResponse;
  assertCurrentAfter(snapshot, asker);
  monsterCache.set(cacheKey, JSON.stringify(detail));
  return detail;
}

/** Unowned content: the detail endpoint returns an accessType 4 placeholder with no ability scores. */
export function isRestricted(detail: MonsterSingleResponse): boolean {
  return detail.accessType === 4 && !detail.data.stats?.length;
}

/**
 * The distinct sources a name appears in (unfiltered search), for "not in that
 * book" errors. Best effort: a failure here must not turn the error into an
 * Open5e substitute, so it yields no hint instead. `bound` is the caller's
 * session snapshot: after an account change the hint is dropped rather than
 * taken from the other account.
 */
export async function availableSourcesFor(name: string, index: SourceIndex, asker: Asker, bound: SessionSnapshot): Promise<string[]> {
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
