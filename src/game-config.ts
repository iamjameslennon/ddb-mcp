/**
 * game-config.ts — D&D Beyond's game config (CR table, monster types, sizes,
 * sources…) and the source index that edition labels classify against.
 *
 * getGameConfig() fetches https://www.dndbeyond.com/api/config/json with
 * session cookies and caches it until the next session transition (cleared
 * conservatively until its account independence is established). Concurrent
 * cold callers of one session generation share a single in-flight fetch.
 *
 * getSourceIndex() merges the live source list over the generated snapshot in
 * source-snapshot.ts, so edition labels and book names survive a D&D Beyond
 * outage. While the live config is unavailable, sources newer than the
 * snapshot classify as "edition not stated". It never rejects.
 */

import {
  sessionFetch, anonymousFetch, captureSession, assertSessionCurrent, onSessionInvalidated, type SessionSnapshot,
} from "./session-fetch.js";
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
// Snapshot-only index for peekSourceIndex(); source data isn't account-specific.
let snapshotIndex: SourceIndex | null = null;

// A failed fetch costs ~7 s of retries on a 5xx, and spell lookups ask for the
// index on every call. Remember a failure for this long, per session generation.
const CONFIG_FAILURE_TTL_MS = 60_000;
/**
 * Deadline for the shared fetch. A fetch that stalls without failing would
 * otherwise hold every caller of its generation until undici's timeouts end it.
 * At the deadline every caller resolves null, the slot is released and the
 * failure is remembered like any other; the stalled fetch is aborted, and
 * whatever it settles with later records nothing.
 */
export const CONFIG_FETCH_TIMEOUT_MS = 10_000;
let configFailure: { until: number; generation: number } | null = null;

// The one in-flight config fetch, shared by every cold caller of the same
// generation (a cold ddb_search_site "all" asks for the index from up to six
// catalog searches at once). Modelled on session-fetch.ts's cobaltTokenPending:
// published before the fetch starts, cleared by its own settlement only (a
// newer generation's entry may already hold the slot) and by the invalidation
// hook below; callers also compare generations before joining.
interface PendingConfigFetch {
  generation: number;
  promise: Promise<GameConfig | null>;
}
let configPending: PendingConfigFetch | null = null;
// Advanced by clearGameConfig(): a fetch started before a clear writes neither
// the cache nor the failure memo when it settles.
let configEpoch = 0;

// Registered once per module lifetime.
onSessionInvalidated(() => {
  configCache = null;
  indexCache = null;
  snapshotIndex = null;
  configFailure = null;
  configPending = null;
  publicConfigCache = null;
  publicConfigFailureUntil = 0;
  publicConfigPending = null;
});

export async function getGameConfig(): Promise<GameConfig | null> {
  // Boundary check before the early singleton return, so a pending transition
  // fires the invalidation hook (which nulls configCache) before we reuse it.
  const snapshot = captureSession();
  if (configCache) return configCache;
  if (configFailure && configFailure.generation === snapshot.generation && Date.now() < configFailure.until) {
    return null;
  }
  // Join this generation's fetch, or start one. Every joiner gets the starter's
  // result: the config, or null (a failure, or a session change mid-fetch).
  let pending = configPending;
  if (!pending || pending.generation !== snapshot.generation) pending = startConfigFetch(snapshot);
  return pending.promise;
}

/** Start the shared fetch for `snapshot`'s generation and publish it as the pending entry. */
/**
 * Drop the session-bound config, the index built from it, the failure memo and
 * any fetch in flight (ddb_clear_cache), so the next call fetches at once. A
 * fetch that settles after the clear writes nothing.
 */
export function clearGameConfig(): void {
  configEpoch++;
  configCache = null;
  indexCache = null;
  configFailure = null;
  configPending = null;
}

function startConfigFetch(snapshot: SessionSnapshot): PendingConfigFetch {
  // Deferred one microtask so the fetch runs only after the entry is stored: if
  // its first authority check fires the invalidation hook, the hook finds and
  // clears the entry (as in session-fetch.ts's startCobaltTokenExchange).
  // A rejection (only the boundary check below can throw past fetchGameConfig's
  // own try) resolves every caller to null, so getGameConfig never rejects.
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const epoch = configEpoch;
  const fetched = Promise.resolve().then(() => fetchGameConfig(snapshot, ctl.signal, epoch)).catch(() => null);
  // Resolves null at the deadline, after aborting the fetch and recording the
  // failure (only if the session is still the one we started under).
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      ctl.abort();
      rememberFailure(snapshot, epoch);
      release();
      resolve(null);
    }, CONFIG_FETCH_TIMEOUT_MS);
    timer.unref?.();
  });
  const entry: PendingConfigFetch = {
    generation: snapshot.generation,
    promise: Promise.race([fetched, deadline]).finally(() => clearTimeout(timer)),
  };
  configPending = entry;
  // Clear only our own entry, on either settlement: after an invalidation the
  // slot may hold a newer generation's fetch.
  function release() {
    if (configPending === entry) configPending = null;
  }
  void entry.promise.then(release, release);
  return entry;
}

// ── The public config (logged-out monster lookups) ───────────────────────────
// The config endpoint answers without credentials. Logged out, monster-service
// answers free content anonymously, and its stat blocks need the CR, type,
// size and alignment tables. getGameConfig() stays session-bound (logged out it
// is null and the source index is the snapshot), so other tools see no change.
// Not account-derived, but dropped on every session transition all the same.
let publicConfigCache: GameConfig | null = null;
let publicConfigFailureUntil = 0;
let publicConfigPending: Promise<GameConfig | null> | null = null;

/**
 * The game config fetched with no credentials (anonymousFetch). Cached until
 * the next session transition; concurrent cold callers share one fetch; a
 * failure (or the CONFIG_FETCH_TIMEOUT_MS deadline) resolves null and is
 * remembered for CONFIG_FAILURE_TTL_MS. Never rejects.
 */
export async function getPublicGameConfig(): Promise<GameConfig | null> {
  if (publicConfigCache) return publicConfigCache;
  if (Date.now() < publicConfigFailureUntil) return null;
  return publicConfigPending ?? startPublicConfigFetch();
}

/** Drop the public config, its failure memo and any fetch in flight (ddb_clear_cache), so the next call fetches afresh. */
export function clearPublicGameConfig(): void {
  publicConfigCache = null;
  publicConfigFailureUntil = 0;
  publicConfigPending = null;
}

function startPublicConfigFetch(): Promise<GameConfig | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CONFIG_FETCH_TIMEOUT_MS);
  timer.unref?.();
  const fetched = (async (): Promise<GameConfig | null> => {
    try {
      const resp = await anonymousFetch(CONFIG_URL, { signal: ctl.signal });
      if (!resp.ok) return null;
      const json = await resp.json() as { data?: GameConfig } | GameConfig;
      const cfg = (json as { data?: GameConfig }).data ?? (json as GameConfig);
      return cfg?.challengeRatings ? cfg : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  const entry: Promise<GameConfig | null> = fetched.then(cfg => {
    // A session transition mid-fetch dropped this entry: record nothing.
    if (publicConfigPending === entry) {
      publicConfigPending = null;
      if (cfg) publicConfigCache = cfg;
      else publicConfigFailureUntil = Date.now() + CONFIG_FAILURE_TTL_MS;
    }
    return cfg;
  });
  publicConfigPending = entry;
  return entry;
}

/** Remember a failure for this snapshot's generation; records nothing if the session has changed. */
function rememberFailure(snapshot: SessionSnapshot, epoch: number): void {
  // Cleared (ddb_clear_cache) since this fetch started: record nothing.
  if (epoch !== configEpoch) return;
  try {
    // A late failure from an old session must not suppress the new one's fetch.
    assertSessionCurrent(snapshot);
    configFailure = { until: Date.now() + CONFIG_FAILURE_TTL_MS, generation: snapshot.generation };
  } catch {
    // Session changed mid-fetch: record nothing.
  }
}

/** One config fetch under `snapshot`. A failure resolves null. */
async function fetchGameConfig(snapshot: SessionSnapshot, signal: AbortSignal, epoch: number): Promise<GameConfig | null> {
  // The session changed between publishing the entry and this run: send
  // nothing (sessionFetch would otherwise send the request under the new
  // session) and return what a stale fetch returns. captureSession re-reads
  // the session file; a throw from it rejects, which startConfigFetch turns into null.
  if (captureSession().generation !== snapshot.generation) return null;
  const fail = (): null => {
    // Past the deadline the failure is already remembered (or the session moved on).
    if (!signal.aborted) rememberFailure(snapshot, epoch);
    return null;
  };
  try {
    const resp = await sessionFetch(CONFIG_URL, { signal });
    if (signal.aborted) return null;
    if (!resp.ok) return fail();
    const json = await resp.json() as { data?: GameConfig } | GameConfig;
    if (signal.aborted) return null; // settled after the deadline: record nothing
    const cfg = (json as { data?: GameConfig }).data ?? (json as GameConfig);
    if (cfg.challengeRatings) {
      // Don't cache one account's config into another account's generation.
      try {
        assertSessionCurrent(snapshot);
      } catch {
        return null; // stale session: neither cache nor record a failure
      }
      // Cleared since this fetch started: hand the config to its callers, cache nothing.
      if (epoch !== configEpoch) return cfg;
      configCache = cfg;
      configFailure = null;
      return cfg;
    }
    return fail();
  } catch {
    return fail();
  }
}

/**
 * The cached source index if one is built, else a memoized snapshot-only index.
 * Synchronous: never fetches and never checks the session (source data isn't
 * account-specific).
 */
export function peekSourceIndex(): SourceIndex {
  if (indexCache) return indexCache.index;
  snapshotIndex ??= buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES);
  return snapshotIndex;
}

export async function getSourceIndex(): Promise<SourceIndex> {
  // Callers start this early and may not await it (a failing load returns
  // first), so it must never reject: any failure degrades to the snapshot.
  try {
    return await buildLiveSourceIndex();
  } catch {
    return peekSourceIndex();
  }
}

async function buildLiveSourceIndex(): Promise<SourceIndex> {
  // Capture before the work, assert before caching: a session change while the
  // index is built must not leave one account's index in the cache.
  const snapshot = captureSession();
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
  try {
    assertSessionCurrent(snapshot);
    indexCache = { config, index };
  } catch {
    // Session changed mid-build: return this index, but don't cache it.
  }
  return index;
}

/** Live sources over the snapshot, field by field: a missing live field keeps the snapshot's. */
function mergeSources(live: GameSource[] | undefined): SourceRecord[] {
  const merged = new Map<number, SourceRecord>(SNAPSHOT_SOURCES.map(s => [s.id, s]));
  for (const s of live ?? []) {
    // Skip bad entries one at a time; a single bad entry must not drop the rest.
    if (!s || typeof s !== "object" || typeof s.id !== "number") continue;
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
  for (const c of live ?? []) {
    if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
    const snap = merged.get(c.id);
    merged.set(c.id, { id: c.id, name: c.name ?? snap?.name ?? "" });
  }
  return [...merged.values()];
}
