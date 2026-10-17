/**
 * game-config.ts — D&D Beyond's game config (CR table, monster types, sizes,
 * sources…) and the source index that edition labels classify against.
 *
 * getGameConfig() fetches https://www.dndbeyond.com/api/config/json with
 * session cookies and caches it until the next session transition (cleared
 * conservatively until its account independence is established).
 *
 * getSourceIndex() merges the live source list over the generated snapshot in
 * source-snapshot.ts, so edition labels and book names survive a D&D Beyond
 * outage. While the live config is unavailable, sources newer than the
 * snapshot classify as "edition not stated". It never rejects.
 */

import { sessionFetch, captureSession, assertSessionCurrent, onSessionInvalidated } from "./session-fetch.js";
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
let configFailure: { until: number; generation: number } | null = null;

// Registered once per module lifetime.
onSessionInvalidated(() => {
  configCache = null;
  indexCache = null;
  snapshotIndex = null;
  configFailure = null;
});

export async function getGameConfig(): Promise<GameConfig | null> {
  // Boundary check before the early singleton return, so a pending transition
  // fires the invalidation hook (which nulls configCache) before we reuse it.
  const snapshot = captureSession();
  if (configCache) return configCache;
  if (configFailure && configFailure.generation === snapshot.generation && Date.now() < configFailure.until) {
    return null;
  }
  const fail = (): null => {
    try {
      // A late failure from an old session must not suppress the new one's fetch.
      assertSessionCurrent(snapshot);
      configFailure = { until: Date.now() + CONFIG_FAILURE_TTL_MS, generation: snapshot.generation };
    } catch {
      // Session changed mid-fetch: record nothing.
    }
    return null;
  };
  try {
    const resp = await sessionFetch(CONFIG_URL);
    if (!resp.ok) return fail();
    const json = await resp.json() as { data?: GameConfig } | GameConfig;
    const cfg = (json as { data?: GameConfig }).data ?? (json as GameConfig);
    if (cfg.challengeRatings) {
      // Don't cache one account's config into another account's generation.
      try {
        assertSessionCurrent(snapshot);
      } catch {
        return null; // stale session: neither cache nor record a failure
      }
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
