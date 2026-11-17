/**
 * Fetch layer for subclass always-prepared spells (F4, owner rulings R1
 * 2026-11-13 and S1–S4 2026-11-17). One request per subclassed class to
 * character-service's `game-data/always-prepared-spells`, all in parallel under
 * one overall deadline, bound to the caller's session snapshot. The pure merge
 * is `character/always-prepared.ts`.
 */

import {
  hasValidSession, beginAuthenticatedSession, anonymousFetch, assertSessionCurrent,
  onSessionInvalidated, SessionChangedError,
} from "../session-fetch.js";
import type { SessionSnapshot } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { subclassRequests, type SubclassSpellLists } from "./character/always-prepared.js";
import type { CharData } from "./character/types.js";

/**
 * One deadline over all of a call's always-prepared requests (owner decision
 * S1 2026-11-17, modelled on CONFIG_FETCH_TIMEOUT_MS). At the deadline the
 * requests still running are aborted and count as failed: the character still
 * parses, with the notice, nothing is cached and the pending slots are freed.
 */
export const SUBCLASS_SPELLS_TIMEOUT_MS = 10_000;
const SUBCLASS_SPELLS_TTL_MS = 24 * 60 * 60 * 1000;
/** Lists held at most (one per subclass and class level asked for). */
const SUBCLASS_SPELLS_CACHE_MAX = 200;

type SpellList = Record<string, unknown>[];

// Keyed `gen<generation>:<subclassId>:<level>`. An empty list is a real answer
// (every 2024 subclass returns []), so it is cached like any other; a failure
// never is.
const listCache = new TtlCache<SpellList>(SUBCLASS_SPELLS_TTL_MS, SUBCLASS_SPELLS_CACHE_MAX);

/**
 * One request shared by every concurrent cold caller of its key. Each caller
 * waits on its own deadline (owner decision M3 2026-11-17); the request runs on
 * until it settles or the last caller still waiting withdraws, which aborts it.
 */
interface PendingList {
  promise: Promise<SpellList | null>;
  /** Callers still waiting on it; one that withdraws (its deadline passed) leaves. */
  waiters: number;
  /** Abort the request and free the slot: no caller is waiting any more. */
  cancel(): void;
}
// A request writes the cache, and frees its slot, only while it is still its
// key's entry, so a clear or a session change mid-fetch leaves nothing behind.
const listPending = new Map<string, PendingList>();

onSessionInvalidated(() => {
  listCache.clear();
  listPending.clear();
});

/** Drop the cached lists and any request in flight (ddb_clear_cache `characters` / `all`). */
export function clearSubclassSpellCache(): void {
  listCache.clear();
  listPending.clear();
}

/** Test-only: lists cached plus requests in flight. */
export function __subclassSpellCacheSizeForTests(): number {
  return listCache.size + listPending.size;
}

/** How this call sends its requests, and whether their answers may be cached. */
interface ListFetcher {
  fetch(url: string, signal: AbortSignal): Promise<Response>;
  cacheable: boolean;
  /** Set when this call's own token exchange failed and the lists went out anonymously. */
  tokenError?: unknown;
}

/**
 * Logged in: the token session, which must belong to `snapshot`'s generation.
 * When the token exchange fails, the lists go out anonymously (owner decision
 * S4), as the character did, and are not cached, so the next call retries with
 * the token. `tokenFailed` (the character's own exchange just failed) skips the
 * exchange: a second attempt would only repeat the failure, slowly in an
 * outage (fix round 1). Logged out: anonymous.
 */
async function listFetcher(snapshot: SessionSnapshot, tokenFailed: boolean): Promise<ListFetcher> {
  const anonymous = (cacheable: boolean, tokenError?: unknown): ListFetcher => ({
    fetch: (url, signal) => anonymousFetch(url, { signal }),
    cacheable,
    ...(tokenError !== undefined ? { tokenError } : {}),
  });
  if (snapshot.state.kind !== "authenticated" || !hasValidSession()) return anonymous(true);
  if (tokenFailed) return anonymous(false);
  try {
    const session = await beginAuthenticatedSession();
    if (session.generation !== snapshot.generation) throw new SessionChangedError();
    return { fetch: (url, signal) => session.fetch(url, { signal }), cacheable: true };
  } catch (e) {
    if (e instanceof SessionChangedError) throw e;
    assertSessionCurrent(snapshot);
    // The caller turns this into the token notice (the character came from the cache, without one).
    return anonymous(false, e);
  }
}

/** Resolves null when `signal` aborts, so a stalled step can't hold the caller past the deadline. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) {
    // Nobody reads it now; a rejection must still be handled.
    promise.catch(() => {});
    return Promise.resolve(null);
  }
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      v => { signal.removeEventListener("abort", onAbort); resolve(v); },
      e => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/** The list, or null for a failed, non-OK or malformed reply. Rethrows only SessionChangedError. */
async function requestList(url: string, fetcher: ListFetcher, snapshot: SessionSnapshot, signal: AbortSignal): Promise<SpellList | null> {
  try {
    const resp = await fetcher.fetch(url, signal);
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    // The body parse is async: never hand one account's list to another. A call
    // that started logged out has no account to protect, like fetchCharacter's
    // anonymous path (owner decision M1 2026-11-17).
    if (snapshot.state.kind === "authenticated") assertSessionCurrent(snapshot);
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return null;
    const isEntry = (e: unknown) => e != null && typeof e === "object" && !Array.isArray(e)
      && (e as { definition?: unknown }).definition != null && typeof (e as { definition?: unknown }).definition === "object";
    if (!data.every(isEntry)) return null;
    return data as SpellList;
  } catch (e) {
    if (e instanceof SessionChangedError) throw e;
    return null;
  }
}

/** Start the shared request for `key` and publish it as the pending entry. */
function startList(key: string, url: string, fetcher: ListFetcher, snapshot: SessionSnapshot): PendingList {
  const ctl = new AbortController();
  const entry: PendingList = {
    promise: requestList(url, fetcher, snapshot, ctl.signal).then(list => {
      if (list !== null && listPending.get(key) === entry) listCache.set(key, list);
      return list;
    }),
    waiters: 0,
    cancel() {
      ctl.abort();
      release();
    },
  };
  function release() {
    if (listPending.get(key) === entry) listPending.delete(key);
  }
  listPending.set(key, entry);
  entry.promise.then(release, release);
  return entry;
}

/** Wait for a shared request until `signal` (this caller's deadline) aborts; the last caller to withdraw cancels it. */
function waitFor(entry: PendingList, signal: AbortSignal): Promise<SpellList | null> {
  entry.waiters++;
  return new Promise<SpellList | null>((resolve, reject) => {
    const withdraw = () => {
      resolve(null);
      if (--entry.waiters === 0) entry.cancel();
    };
    if (signal.aborted) {
      withdraw();
      return;
    }
    signal.addEventListener("abort", withdraw, { once: true });
    entry.promise.then(
      list => { signal.removeEventListener("abort", withdraw); resolve(list); },
      e => { signal.removeEventListener("abort", withdraw); reject(e); },
    );
  });
}

/** One list from a request already in flight for it, or a new request. */
function loadList(key: string, url: string, fetcher: ListFetcher, snapshot: SessionSnapshot, signal: AbortSignal): Promise<SpellList | null> {
  // Answers fetched through the anonymous fallback are this call's alone.
  if (!fetcher.cacheable) return untilAborted(requestList(url, fetcher, snapshot, signal), signal);
  return waitFor(listPending.get(key) ?? startList(key, url, fetcher, snapshot), signal);
}

/**
 * Each subclass's always-prepared spells for `char`, keyed by class entry id,
 * fetched bound to `snapshot` (the one the character itself was fetched under).
 * `failed` is true when any list couldn't be loaded (an error, a non-OK or
 * malformed reply, or the SUBCLASS_SPELLS_TIMEOUT_MS deadline); that class is
 * left out and the others are kept. `tokenFailed`: the character's token
 * exchange failed, so the lists go out anonymously with no second exchange.
 * `tokenError` is set when this call's own exchange failed instead. A session
 * change rejects with SessionChangedError (logged in).
 */
export async function fetchSubclassSpellLists(
  char: CharData,
  snapshot: SessionSnapshot,
  options: { tokenFailed?: boolean } = {},
): Promise<{ lists: SubclassSpellLists; failed: boolean; tokenError?: unknown }> {
  const lists: SubclassSpellLists = new Map();
  const misses: Array<{ characterClassId: number; key: string; url: string }> = [];
  for (const r of subclassRequests(char)) {
    const key = `gen${snapshot.generation}:${r.subclassId}:${r.level}`;
    const cached = listCache.get(key);
    if (cached !== undefined) {
      lists.set(r.characterClassId, cached);
      continue;
    }
    const url = `https://character-service.dndbeyond.com/character/v5/game-data/always-prepared-spells?classId=${r.subclassId}&classLevel=${r.level}&sharingSetting=2`;
    misses.push({ characterClassId: r.characterClassId, key, url });
  }
  if (misses.length === 0) return { lists, failed: false };

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), SUBCLASS_SPELLS_TIMEOUT_MS);
  timer.unref?.();
  try {
    // The token lookup counts against the deadline too (fetchCharacter has
    // usually just cached the token, so it is normally instant).
    const fetcher = await untilAborted(listFetcher(snapshot, options.tokenFailed === true), deadline.signal);
    if (fetcher === null) return { lists, failed: true };
    const results = await Promise.all(misses.map(m => loadList(m.key, m.url, fetcher, snapshot, deadline.signal)));
    let failed = false;
    misses.forEach((m, i) => {
      const list = results[i];
      if (list === null) failed = true;
      else lists.set(m.characterClassId, list);
    });
    return fetcher.tokenError !== undefined ? { lists, failed, tokenError: fetcher.tokenError } : { lists, failed };
  } finally {
    clearTimeout(timer);
  }
}
