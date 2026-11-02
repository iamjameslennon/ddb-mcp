/**
 * open5e.ts — Open5e SRD fallback for all reference and monster tools.
 *
 * Used when DnD Beyond is unreachable, returns auth errors, or returns empty
 * results. All functions return the same string format as DDB equivalents so
 * callers can swap them in transparently.
 *
 * API: https://api.open5e.com/v2/ — no auth required.
 * Two SRD documents: srd-2024 (SRD 5.2) and srd-2014 (SRD 5.1). Each endpoint
 * is loaded one whole document at a time and matched client-side. Spells,
 * creatures, items and options select both documents together by edition, like
 * D&D Beyond entries; rules are not twin-grouped: the requested document is
 * searched first, then the other one.
 * Coverage is narrower than DDB but includes the core SRD content: spells,
 * creatures, items, species, classes, backgrounds, feats and rules chapters.
 */

import { TtlCache } from "./cache.js";
import {
  createTwinNamer, editionTag, groupAndSelect, LEGENDARY_USES_NOTE, loggedOutReason, lookupByName, normalizeName, open5eSearchHeader, reasonLine, renameLine, rulesLine, searchFooter,
  searchHeader, selectByEdition,
  type EditionInfo, type Open5eOrigin, type RulesEdition, type RulesLineReason, type SelectionReason, type TwinNamer,
} from "./edition.js";
import { paginateResults, renderSection, type SearchSection } from "./tools/edition-search.js";
import { EDITION_RENAMES, OPEN5E_ARMOUR_RENAMES, OPEN5E_EQUIPMENT_RENAMES, type RenameKind } from "./edition-renames.js";

// 1-hour cache — Open5e data doesn't change often
const open5eCache = new TtlCache<unknown>(60 * 60_000, 100);

/** Wipe the in-process Open5e response cache. */
export function clearOpen5eCache(): void {
  open5eCache.clear();
  o5Pending.clear();
  o5Failures.clear();
  // Also drops the cached equipment split (in open5eCache); a split being computed writes nothing.
  equipmentSplitPending = null;
}

/**
 * Drop both SRD documents of the creatures endpoint: cached records, fetches
 * in flight and remembered failures (ddb_clear_cache "monsters"), so the next
 * monster fallback fetches them at once. Spells, items, rules and the rest are
 * kept. A dropped fetch that settles later writes nothing (the o5Pending
 * identity guard in loadO5Document).
 */
export function clearOpen5eCreatures(): void {
  for (const edition of ["2024", "2014"] as const) {
    const url = o5DocumentUrl("creatures", edition);
    open5eCache.invalidate(url);
    o5Pending.delete(url);
    o5Failures.delete(url);
  }
}

// ── v2 document loader ────────────────────────────────────────────────────────
// Open5e v2 silently ignores filters it doesn't know, so the only request shape
// used is one whole document per endpoint (document__key__in + limit), with
// every other match done client-side.

const O5_V2 = "https://api.open5e.com/v2";
const O5_TIMEOUT_MS = 20_000;
/** One deadline across every page of a document, combined with the per-request timeout. */
export const O5_DOCUMENT_DEADLINE_MS = 30_000;
/** How long a failed document load is remembered, so an outage costs one attempt a minute per document. */
export const O5_FAILURE_TTL_MS = 60_000;

export type O5Endpoint = "spells" | "creatures" | "items" | "magicitems" | "weapons" | "armor" | "species" | "classes" | "backgrounds" | "feats" | "rulesets";

export const O5_DOC: Readonly<Record<RulesEdition, "srd-2024" | "srd-2014">> = { "2024": "srd-2024", "2014": "srd-2014" };

export interface O5Record { key: string; name: string; document: { key: string } | string }

/** A record's document key: an object on most endpoints, a string on rules. */
export function docKey(r: { document: { key: string } | string }): string {
  return typeof r.document === "string" ? r.document : r.document.key;
}

const o5Pending = new Map<string, Promise<unknown[]>>();
/** Remembered failures per document URL; the only place a failure is kept. Dropped by `clearOpen5eCache()`. */
const o5Failures = new Map<string, { error: Error; until: number }>();

/** `limit=1000` returns every SRD document in one page; this is far above that, and only bounds a misbehaving `next` chain. */
const O5_MAX_PAGES = 20;
const O5_ORIGIN = new URL(O5_V2).origin;

async function fetchPages(firstUrl: string): Promise<unknown[]> {
  const all: unknown[] = [];
  const seen = new Set<string>();
  let url: string | null = firstUrl;
  let expected: number | undefined;
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error(`Open5e document load passed ${O5_DOCUMENT_DEADLINE_MS} ms: ${new URL(firstUrl).pathname}`)),
    O5_DOCUMENT_DEADLINE_MS,
  );
  try {
    while (url) {
      if (new URL(url).origin !== O5_ORIGIN) throw new Error(`Open5e paging left ${O5_ORIGIN}: ${new URL(url).origin}`);
      if (seen.has(url)) throw new Error(`Open5e paging loop: ${new URL(url).pathname}`);
      if (seen.size >= O5_MAX_PAGES) throw new Error(`Open5e paging passed ${O5_MAX_PAGES} pages: ${new URL(firstUrl).pathname}`);
      seen.add(url);
      const signal = AbortSignal.any([AbortSignal.timeout(O5_TIMEOUT_MS), deadline.signal]);
      const resp: Response = await fetch(url, { headers: { Accept: "application/json" }, signal });
      // fetch follows redirects; a real response always carries its final url (an empty one only comes from a hand-built Response).
      if (resp.url && new URL(resp.url).origin !== O5_ORIGIN) throw new Error(`Open5e redirected off ${O5_ORIGIN}: ${new URL(resp.url).origin}`);
      if (!resp.ok) throw new Error(`Open5e ${resp.status}: ${new URL(url).pathname}`);
      const body = await resp.json() as { count?: number; next?: string | null; results?: unknown[] };
      if (expected === undefined && typeof body.count === "number") expected = body.count;
      all.push(...(body.results ?? []));
      url = body.next || null;
    }
  } finally {
    clearTimeout(timer);
  }
  const path = new URL(firstUrl).pathname;
  if (all.length === 0) throw new Error(`Open5e returned no records: ${path}`);
  if (expected !== undefined && expected > all.length) throw new Error(`Open5e returned ${all.length} of ${expected} records: ${path}`);
  return all;
}

/** One whole SRD document of an endpoint, other documents' records dropped. Cached 1 h; concurrent callers share one fetch; a failure is remembered for 60 s (and rethrown without fetching), never cached as data. */
/** The one request URL of an endpoint's SRD document (the cache, pending and failure key). */
function o5DocumentUrl(endpoint: O5Endpoint, edition: RulesEdition): string {
  return `${O5_V2}/${endpoint}/?document__key__in=${O5_DOC[edition]}&limit=1000`;
}

export async function loadO5Document<T extends O5Record>(endpoint: O5Endpoint, edition: RulesEdition): Promise<T[]> {
  const doc = O5_DOC[edition];
  const url = o5DocumentUrl(endpoint, edition);
  const cached = open5eCache.get(url) as T[] | undefined;
  if (cached !== undefined) return cached;
  let pending = o5Pending.get(url);
  if (!pending) {
    const remembered = o5Failures.get(url);
    if (remembered) {
      if (Date.now() < remembered.until) throw remembered.error;
      o5Failures.delete(url);
    }
    const p: Promise<unknown[]> = fetchPages(url)
      .then(records => {
        const kept = (records as T[]).filter(r => docKey(r) === doc);
        // An empty document is a failure (remembered, never cached): the response ignored the filter or the key changed.
        if (kept.length === 0) throw new Error(`Open5e returned no ${doc} records: ${new URL(url).pathname}`);
        return kept;
      })
      .then(kept => {
        // A clear while this fetch was in flight dropped its entry: don't repopulate.
        if (o5Pending.get(url) === p) open5eCache.set(url, kept);
        return kept;
      }, (error: unknown) => {
        // A clear while this fetch was in flight dropped its entry: remember nothing.
        if (o5Pending.get(url) === p) o5Failures.set(url, { error: error instanceof Error ? error : new Error(String(error)), until: Date.now() + O5_FAILURE_TTL_MS });
        throw error;
      })
      .finally(() => { if (o5Pending.get(url) === p) o5Pending.delete(url); });
    o5Pending.set(url, p);
    pending = p;
  }
  return pending as Promise<T[]>;
}

// ── Selection over both SRD documents ─────────────────────────────────────────
// Both documents of an endpoint are selected together, each record's ruleset
// taken from its document, with the same edition code as D&D Beyond entries.

interface O5Entry<T> { record: T; endpoint: O5Endpoint; edition: RulesEdition }

interface O5Hit<T> {
  entry: O5Entry<T>;
  reason?: RulesLineReason;
  renamed?: { name2014: string; name2024: string };
}

const o5Info = (e: O5Entry<unknown>): EditionInfo => ({ ruleset: e.edition, book: null });

/**
 * "-" as a space and apostrophes dropped: SRD 5.1's "Adamantine Armor (Chain-Mail)" is SRD 5.2's
 * "Adamantine Armor (Chain Mail)", and "will o wisp" finds Will-o'-Wisp. Open5e only; live, no
 * two records of one document share a folded name beyond what the hyphen fold already joined.
 */
const foldPunctuation = (name: string): string => name.replace(/-/g, " ").replace(/['‘’]/g, "");

/** A name as its own twin key would be without renames: normalized, hyphens and apostrophes folded. */
const o5Folded = (name: string): string => normalizeName(foldPunctuation(name));

/** The rename kind of each endpoint (decision 5): only that kind's pairs twin its records. */
const O5_ENDPOINT_KIND: Readonly<Record<O5Endpoint, RenameKind | "none">> = {
  spells: "spell",
  creatures: "monster",
  items: "item", magicitems: "item", weapons: "item", armor: "item",
  backgrounds: "background",
  // Open5e files subclasses (subclass_of) on the classes endpoint, so its records take the subclass
  // pairs: a class search for "school of evocation" reaches SRD 5.2's Evoker. No class name is in them.
  classes: "subclass",
  species: "none", feats: "none", rulesets: "none",
};

/** An Open5e twin namer and the pairs it was built from (o5Renamed reads them). */
interface O5Namer {
  /** The twin key: the rename-table key, folded further for equipment (o5EquipmentKey). */
  twin: TwinNamer;
  pairs: ReadonlyArray<readonly [name2014: string, name2024: string]>;
  /** The rename-table key alone: normalized, hyphens and apostrophes folded, a 2014 name mapped to its 2024 name. */
  tableKey: (name: string) => string;
  /** Which side of a rename pair the name spells, if any: "2014" for a 2014 name, "2024" for a 2024 name. */
  tableSide: (name: string) => RulesEdition | undefined;
  /** The name's words as a rename line compares them (sameWords): o5Folded, for equipment with the M3 parts stripped. */
  words: (name: string) => string;
}

/**
 * The Open5e twin key over one kind's pairs (items also get the Open5e-only
 * armour and equipment pairs, see OPEN5E_ARMOUR_RENAMES and
 * OPEN5E_EQUIPMENT_RENAMES), with hyphens and apostrophes folded on both
 * sides. D&D Beyond's twin namers do not fold them. `fold` further folds the
 * table key (equipment: foldEquipmentKey). `spell` keeps the table's own
 * spelling, found by its folded form so a hyphen-less query still gets it.
 */
function createO5Namer(
  pairs: O5Namer["pairs"],
  fold: (key: string) => string = key => key,
  strip: (folded: string) => string = folded => folded,
): O5Namer {
  const renamer = createTwinNamer(pairs.map(([name2014, name2024]) => [foldPunctuation(name2014), foldPunctuation(name2024)] as const));
  const tableKey = (name: string): string => renamer(foldPunctuation(name));
  const spellings = new Map(pairs.flatMap(pair => pair.map(spelling => [o5Folded(spelling), spelling] as const)));
  const names2024 = new Set(pairs.filter(([name2014, name2024]) => o5Folded(name2014) !== o5Folded(name2024)).map(([, name2024]) => o5Folded(name2024)));
  const tableSide = (name: string): RulesEdition | undefined =>
    tableKey(name) !== o5Folded(name) ? "2014" : names2024.has(o5Folded(name)) ? "2024" : undefined;
  const twin: TwinNamer = Object.assign((name: string) => fold(tableKey(name)), {
    spell: (normalized: string) => spellings.get(o5Folded(normalized)),
    side: tableSide,
  });
  const words = (name: string): string => strip(o5Folded(name)).split(/\s+/).filter(Boolean).sort().join(" ");
  return { twin, pairs, tableKey, tableSide, words };
}

/** M3: a price, count or measure in parentheses (anywhere, as the probe that counted the pairs strips them). */
const EQUIPMENT_QUANTITY = /\s*\((?:\d+ gp|\d+|\d+ feet|per day|vial|flask|bow|1 piece|bag of 1000)\)\s*/g;
/** M3: an SRD 5.2 category prefix ("Musical Instrument, Bagpipes"). */
const EQUIPMENT_PREFIX = /^(?:musical instrument|gaming set|druidic focus|holy symbol),\s*/;
/** M2: words SRD 5.1 adds to a weapon's name ("Vicious Weapon (Rapier)", "Dancing Sword (Rapier)"). */
const EQUIPMENT_WEAPON_WORDS = new Set(["sword", "weapon"]);

/** M3's strip: a price, count or measure in parentheses, a stray trailing ")", a category prefix and the word "set". Commas stay. */
function stripEquipment(folded: string): string {
  return folded.replace(EQUIPMENT_QUANTITY, " ").replace(/\)$/, "").replace(EQUIPMENT_PREFIX, "").replace(/\bset\b/g, "");
}

/**
 * M1–M3 over an equipment rename-table key (lowercase, hyphens and apostrophes
 * already folded), carry-over (r), decision 6. M3 first strips a price, count
 * or measure in parentheses, a stray trailing ")", an SRD 5.2 category prefix
 * and the word "set". M1 turns "+N" into "plusN", every other non-alphanumeric
 * into a space, and sorts the unique words. M2 drops "sword" and "weapon", and
 * M3 then drops one trailing "s" per word. The steps and their order are those
 * of the 2026-10-23 probe that hand-checked the 120 pairs they add (126 with
 * OPEN5E_EQUIPMENT_RENAMES): "Crossbow, hand" is "Hand Crossbow", "Vicious
 * Weapon (Light-Hammer)" is "Vicious Light Hammer", "Smith's tools" is
 * "Smith's Tools (20 GP)". "(+1)" is no quantity: "Net (+1)" stays apart from "Net".
 */
function foldEquipmentKey(key: string): string {
  const stripped = stripEquipment(key);
  const words = [...new Set(stripped.replace(/\+(\d)/g, " plus$1 ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean))].sort();
  return words.filter(word => !EQUIPMENT_WEAPON_WORDS.has(word)).map(word => word.replace(/s$/, "")).join(" ");
}

const O5_NAMERS: Readonly<Record<RenameKind | "none", O5Namer>> = {
  spell: createO5Namer(EDITION_RENAMES.spell),
  item: createO5Namer([...EDITION_RENAMES.item, ...OPEN5E_ARMOUR_RENAMES, ...OPEN5E_EQUIPMENT_RENAMES], foldEquipmentKey, stripEquipment),
  monster: createO5Namer(EDITION_RENAMES.monster),
  subclass: createO5Namer(EDITION_RENAMES.subclass),
  background: createO5Namer(EDITION_RENAMES.background),
  none: createO5Namer([]),
};

/** The namer of the endpoints one call selects over; they must share a kind. */
function o5NamerFor(endpoints: readonly O5Endpoint[]): O5Namer {
  const kinds = new Set(endpoints.map(endpoint => O5_ENDPOINT_KIND[endpoint]));
  if (kinds.size !== 1) throw new Error(`Open5e endpoints of different rename kinds: ${endpoints.join(", ")}`);
  return O5_NAMERS[[...kinds][0]];
}

/** The Open5e twin namer of one endpoint's records. */
export function o5TwinNameFor(endpoint: O5Endpoint): TwinNamer {
  return O5_NAMERS[O5_ENDPOINT_KIND[endpoint]].twin;
}

/** The twin key of the items, magicitems, weapons and armor endpoints: the item-kind key folded by M1–M3 (foldEquipmentKey). */
export function o5EquipmentKey(name: string): string {
  return O5_NAMERS.item.twin(name);
}

/**
 * The twin key over one call's records, with the same-document guard: two
 * records of one SRD document never share a twin group through the equipment
 * folds alone. Where a document holds two rename-table keys under one twin key,
 * that key splits by rename-table key, so SRD 5.2's "Potion of Healing" (one
 * potion) and "Potions of Healing" (the rarity table) stay two entries, and
 * SRD 5.1's "Potion of Healing" joins the first. Live 2026-10-23 that is the
 * only such key; a query takes the split key the same way. Kinds whose twin key
 * is the rename-table key never split. The guard covers only keys the equipment
 * folds create: names the rename table maps together inside one document
 * (Acid and Acid (vial), Chain and Chain (10 feet)) still share a group by
 * design.
 */
function guardedNamer(namer: O5Namer, records: ReadonlyArray<{ name: string; edition: RulesEdition }>): O5Namer {
  return withSplit(namer, splitKeys(namer, records));
}

/** The twin keys under which one document holds two rename-table keys. */
function splitKeys(namer: O5Namer, records: ReadonlyArray<{ name: string; edition: RulesEdition }>): ReadonlySet<string> {
  const tableKeys = new Map<string, Set<string>>();
  const split = new Set<string>();
  for (const { name, edition } of records) {
    const key = namer.twin(name);
    const at = `${edition}\n${key}`;
    const seen = tableKeys.get(at) ?? new Set<string>();
    seen.add(namer.tableKey(name));
    tableKeys.set(at, seen);
    if (seen.size > 1) split.add(key);
  }
  return split;
}

function withSplit(namer: O5Namer, split: ReadonlySet<string>): O5Namer {
  if (split.size === 0) return namer;
  const twin: TwinNamer = Object.assign((name: string) => {
    const key = namer.twin(name);
    return split.has(key) ? `${key}\n${namer.tableKey(name)}` : key;
  }, { spell: namer.twin.spell, side: namer.twin.side });
  return { ...namer, twin };
}

const O5_EQUIPMENT_ENDPOINTS: readonly O5Endpoint[] = ["magicitems", "weapons", "armor", "items"];
const EQUIPMENT_SPLIT_KEY = "o5:equipment-split";

/** One computation of the equipment split: the split over the documents that loaded, and each failed endpoint's error. */
interface EquipmentSplitComputation {
  split: ReadonlySet<string>;
  failed: ReadonlyMap<O5Endpoint, unknown>;
}
/** The computation in flight, shared by concurrent cold callers; dropped by clearOpen5eCache(). */
let equipmentSplitPending: Promise<EquipmentSplitComputation> | null = null;

/**
 * The same-document split over every equipment endpoint's records in both
 * documents, computed once and cached with the documents (1 h, dropped by
 * `clearOpen5eCache()`). A search (magicitems + items) and a get (all four)
 * therefore group by the same keys. `required` are the call's own endpoints:
 * one of them failing fails the call, as its own load would. Another (a
 * search's weapons or armor) failing leaves the split computed over the
 * documents that loaded, used for this call and never cached (owner ruling
 * 2026-11-02). Concurrent cold callers share one computation; a clear while it
 * runs leaves nothing cached.
 */
async function equipmentSplit(required: readonly O5Endpoint[]): Promise<ReadonlySet<string>> {
  const cached = open5eCache.get(EQUIPMENT_SPLIT_KEY) as ReadonlySet<string> | undefined;
  if (cached) return cached;
  let computation = equipmentSplitPending;
  if (!computation) {
    const p: Promise<EquipmentSplitComputation> = computeEquipmentSplit().then(result => {
      // Cached only while this computation is still the authoritative one, and only when complete.
      if (equipmentSplitPending === p && result.failed.size === 0) open5eCache.set(EQUIPMENT_SPLIT_KEY, result.split);
      return result;
    }).finally(() => { if (equipmentSplitPending === p) equipmentSplitPending = null; });
    equipmentSplitPending = p;
    computation = p;
  }
  const { split, failed } = await computation;
  for (const endpoint of required) {
    if (failed.has(endpoint)) throw failed.get(endpoint);
  }
  return split;
}

async function computeEquipmentSplit(): Promise<EquipmentSplitComputation> {
  const jobs = (["2024", "2014"] as const).flatMap(edition => O5_EQUIPMENT_ENDPOINTS.map(endpoint => ({ edition, endpoint })));
  const settled = await Promise.allSettled(jobs.map(({ endpoint, edition }) => loadO5Document<O5Record>(endpoint, edition)));
  const records: Array<{ name: string; edition: RulesEdition }> = [];
  const failed = new Map<O5Endpoint, unknown>();
  settled.forEach((result, i) => {
    const { endpoint, edition } = jobs[i];
    if (result.status === "fulfilled") records.push(...result.value.map(record => ({ name: record.name, edition })));
    else if (!failed.has(endpoint)) failed.set(endpoint, result.reason);
  });
  return { split: splitKeys(O5_NAMERS.item, records), failed };
}

/** A call's guarded namer: equipment kinds use the shared split over all four endpoints, others split over the call's own records. */
async function o5GuardedNamer(endpoints: readonly O5Endpoint[], entries: ReadonlyArray<{ record: { name: string }; edition: RulesEdition }>): Promise<O5Namer> {
  const namer = o5NamerFor(endpoints);
  if (namer === O5_NAMERS.item) return withSplit(namer, await equipmentSplit(endpoints));
  return guardedNamer(namer, entries.map(e => ({ name: e.record.name, edition: e.edition })));
}

/** The equipment twin key over a set of records (each with its document's edition), with the same-document guard. */
export function o5EquipmentGroupKey(records: ReadonlyArray<{ name: string; edition: RulesEdition }>): (name: string) => string {
  return guardedNamer(O5_NAMERS.item, records).twin;
}

/**
 * Two names of one twin group that differ only by punctuation, word order or
 * the M3-stripped parts (a price, count, measure, category prefix or "set"):
 * the same twin key and the same words (O5Namer.words). Commas, parentheses
 * and plurals count, so "Crossbow, hand" and "Hand Crossbow" differ, and so do
 * "Arrow (bow)" and "Arrows (20)"; "Smith's tools" and "Smith's Tools (20 GP)" don't.
 */
function sameWords(a: string, b: string, namer: O5Namer): boolean {
  return namer.twin(a) === namer.twin(b) && namer.words(a) === namer.words(b);
}

/** Endpoint order (as given), then record key. */
function o5Tiebreak<T extends O5Record>(endpoints: readonly O5Endpoint[]): (a: O5Entry<T>, b: O5Entry<T>) => number {
  return (a, b) => endpoints.indexOf(a.endpoint) - endpoints.indexOf(b.endpoint) || a.record.key.localeCompare(b.record.key);
}

/** Both documents' records, loaded in parallel: the requested document's endpoints first, in the order given, then the other's. */
async function o5Entries<T extends O5Record>(endpoints: readonly O5Endpoint[], requested: RulesEdition): Promise<O5Entry<T>[]> {
  const order: RulesEdition[] = requested === "2024" ? ["2024", "2014"] : ["2014", "2024"];
  const loads = order.flatMap(edition => endpoints.map(async endpoint =>
    (await loadO5Document<T>(endpoint, edition)).map(record => ({ record, endpoint, edition }))));
  return (await Promise.all(loads)).flat();
}

/** A single lookup: exact twin name across both documents, else a partial match, then the requested edition's entry of that group. */
async function o5Lookup<T extends O5Record>(endpoints: readonly O5Endpoint[], name: string, requested: RulesEdition): Promise<O5Hit<T> | null> {
  const entries = await o5Entries<T>(endpoints, requested);
  const namer = await o5GuardedNamer(endpoints, entries);
  const query = o5Folded(name);
  const byEndpoint = o5Tiebreak<T>(endpoints);
  const found = lookupByName(entries, name, requested, {
    name: e => e.record.name,
    info: o5Info,
    twinName: namer.twin,
    // Within the picked edition, the exact name beats endpoint order: SRD 5.1's
    // "Plate Armor" is the items record, not the armour record "Plate".
    tiebreak: (a, b) => (o5Folded(a.record.name) === query ? 0 : 1) - (o5Folded(b.record.name) === query ? 0 : 1)
      || byEndpoint(a, b),
    // The requested document first, then names starting with the query, then the shortest, then alphabetical.
    partialMatch: (all, normalized) => {
      const q = o5Folded(normalized);
      return all
        .filter(e => o5Folded(e.record.name).includes(q))
        .sort((a, b) =>
          (a.edition === requested ? 0 : 1) - (b.edition === requested ? 0 : 1)
          || (o5Folded(a.record.name).startsWith(q) ? 0 : 1) - (o5Folded(b.record.name).startsWith(q) ? 0 : 1)
          || a.record.name.length - b.record.name.length
          || a.record.name.localeCompare(b.record.name))[0];
    },
  });
  if (!found) return null;
  return { entry: found.entry, reason: found.reason, renamed: o5Renamed(found.entry, found.renamed, entries, namer) };
}

/**
 * The rename line's names, or undefined when it would be false. SRD 5.2 keeps
 * some 2014-era names (Arcane Hand): no rename line when the shown entry
 * carries the other edition's spelling of a rename pair. Nor when the names
 * differ only by punctuation, word order or an M3-stripped part (sameWords), or when the other
 * document files the shown name too. The shown entry's edition orients the
 * pair, because a folded key no longer equals a 2024 name's normalized form.
 * The other side is the SRD record's own name when the other document has one
 * (the typed one first), else the rename table's spelling, never the typed
 * query (which may have lost its hyphens).
 */
function o5Renamed(
  entry: O5Entry<O5Record>, renamed: O5Hit<unknown>["renamed"], entries: ReadonlyArray<O5Entry<O5Record>>, namer: O5Namer,
): O5Hit<unknown>["renamed"] {
  if (!renamed || sameWords(renamed.name2014, renamed.name2024, namer)) return undefined;
  const otherEdition: RulesEdition = entry.edition === "2024" ? "2014" : "2024";
  const shownName = entry.record.name;
  const shown = o5Folded(shownName);
  if (namer.tableSide(shownName) === otherEdition) return undefined;
  const typed = o5Folded(normalizeName(renamed.name2014) === normalizeName(shownName) ? renamed.name2024 : renamed.name2014);
  // SRD 5.2 keeps some 2014-era names, so an other-side record counts only when it doesn't carry the shown edition's spelling.
  const others = entries.filter(e => e.edition === otherEdition && namer.twin(e.record.name) === namer.twin(shownName)
    && namer.tableSide(e.record.name) !== entry.edition);
  if (others.some(e => sameWords(e.record.name, shownName, namer))) return undefined;
  const other = others.find(e => o5Folded(e.record.name) === typed) ?? others[0];
  const pair = namer.pairs.find(([name2014, name2024]) => o5Folded(entry.edition === "2024" ? name2024 : name2014) === shown);
  const otherName = other?.record.name ?? (pair && (entry.edition === "2024" ? pair[0] : pair[1]));
  if (!otherName || sameWords(otherName, shownName, namer)) return undefined;
  return entry.edition === "2024" ? { name2014: otherName, name2024: shownName } : { name2014: shownName, name2024: otherName };
}

/** A search over both documents: one entry per twin group, the other edition's twins hidden and counted. Sorted by name. */
async function o5Select<T extends O5Record>(
  endpoints: readonly O5Endpoint[],
  requested: RulesEdition,
  opts: { name?: string; passes?: (e: O5Entry<T>) => boolean },
): Promise<{ selected: Array<{ entry: O5Entry<T>; reason?: SelectionReason }>; hidden: number }> {
  const entries = await o5Entries<T>(endpoints, requested);
  const namer = await o5GuardedNamer(endpoints, entries);
  const query = opts.name ? o5Folded(opts.name) : "";
  const byEndpoint = o5Tiebreak<T>(endpoints);
  const { selected, hidden } = groupAndSelect(entries, requested, {
    info: o5Info,
    twinKey: e => namer.twin(e.record.name),
    // Within the picked edition the exact query name comes first, as in o5Lookup: a search for
    // SRD 5.1's "Acid (vial)" lists it, not its same-group "Acid".
    tiebreak: (a, b) => (query && o5Folded(a.record.name) === query ? 0 : 1) - (query && o5Folded(b.record.name) === query ? 0 : 1)
      || byEndpoint(a, b),
    nameMatches: query ? e => o5Folded(e.record.name).includes(query) : undefined,
    passes: opts.passes,
    countFilteredPicks: true,
  });
  return {
    selected: selected
      .map(({ entry, reason }) => ({ entry, reason }))
      .sort((a, b) => a.entry.record.name.localeCompare(b.entry.record.name)),
    hidden,
  };
}

/** The lines under a single lookup's title: the rules line, then the reason line, then the rename line. */
function o5Label(edition: RulesEdition, origin: Open5eOrigin, extra: { reason?: RulesLineReason; renamed?: O5Hit<unknown>["renamed"] } = {}): string {
  const lines = [rulesLine({ ruleset: edition, book: null }, { open5e: origin, reason: extra.reason })];
  if (extra.renamed) lines.push(renameLine(extra.renamed.name2014, extra.renamed.name2024));
  return lines.join("\n");
}

/**
 * A search reply in parts: the Open5e header, the heading and the lines as the
 * body, and the footer. Hidden twins alone keep the header and footer around
 * `noMatch`; with neither, `noMatch` is the whole (headerless) reply.
 */
function o5SearchReply(
  requested: RulesEdition,
  origin: "unavailable" | "not-found",
  heading: string,
  lines: string[],
  hidden: number,
  noMatch: string,
): SearchSection {
  const footer = searchFooter(requested, hidden);
  if (lines.length) return o5Section(open5eSearchHeader(requested, origin), [heading, ...lines].join("\n"), footer, hidden);
  if (footer) return o5Section(open5eSearchHeader(requested, origin), noMatch, footer, hidden);
  return o5Section(null, noMatch, null, 0);
}

function o5Section(header: string | null, body: string, footer: string | null, hidden: number): SearchSection {
  return { header, body, footer, hidden, open5e: true };
}

/** Monster and item searches list at most this many lines, then D&D Beyond's refine hint. */
const SEARCH_CAP = 20;

/** The first SEARCH_CAP lines, plus D&D Beyond's refine hint when more were found. */
function capped(lines: string[]): string[] {
  return lines.length > SEARCH_CAP ? [...lines.slice(0, SEARCH_CAP), `\n*Refine your search to see more results.*`] : lines;
}

/** A float challenge rating as printed: 0.25 → "1/4". */
export function crText(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

/** school, type and size match part of a word, as on D&D Beyond (rarity stays exact). */
const lowerHas = (query: string, ...values: Array<string | null | undefined>): boolean => {
  const q = query.toLowerCase();
  return values.some(v => v != null && v.toLowerCase().includes(q));
};

// ── SPELLS ────────────────────────────────────────────────────────────────────

interface O5Spell extends O5Record {
  level: number;
  school: { name: string; key: string };
  casting_time: string;
  /** Reaction spells: "which you take when …". */
  reaction_condition?: string | null;
  range_text: string;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  material_specified?: string | null;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  desc: string;
  higher_level?: string | null;
  classes?: Array<{ name: string }>;
}

const CASTING_TIME: Record<string, string> = {
  action: "1 action",
  "bonus-action": "1 bonus action",
  reaction: "1 reaction",
  "1minute": "1 minute",
  "10minutes": "10 minutes",
  "1hour": "1 hour",
  "8hours": "8 hours",
  "12hours": "12 hours",
  "24hours": "24 hours",
};

/** A v2 casting-time key as printed: "bonus-action" → "1 bonus action"; an unknown key as-is. */
export const castingTime = (key: string): string => CASTING_TIME[key] ?? key;

const spellLevel = (s: O5Spell): string => (s.level === 0 ? "Cantrip" : `Level ${s.level}`);

function formatO5Spell(hit: O5Hit<O5Spell>, origin: Open5eOrigin): string {
  const s = hit.entry.record;
  const conc = s.concentration ? " | Concentration" : "";
  const ritual = s.ritual ? " | Ritual" : "";
  const components = [s.verbal && "V", s.somatic && "S", s.material && `M${s.material_specified ? ` (${s.material_specified})` : ""}`]
    .filter(Boolean).join(", ");
  const lines = [
    `${s.name} (${spellLevel(s)} ${s.school.name}${conc}${ritual})`,
    o5Label(hit.entry.edition, origin, hit),
    `Casting Time: ${castingTime(s.casting_time)}${s.reaction_condition ? `, ${s.reaction_condition}` : ""}`,
    `Range: ${s.range_text}`,
    `Components: ${components}`,
    // Open5e lower-cases it: "instantaneous" → "Instantaneous".
    `Duration: ${s.duration.charAt(0).toUpperCase()}${s.duration.slice(1)}`,
  ];
  const classes = (s.classes ?? []).map(c => c.name).join(", ");
  if (classes) lines.push(`Classes: ${classes}`);
  lines.push("", s.desc.replace(/<[^>]+>/g, "").trim());
  if (s.higher_level) lines.push("", `At Higher Levels: ${s.higher_level}`);
  return lines.join("\n");
}

type O5SpellSearchParams = {
  name?: string;
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  limit?: number;
  offset?: number;
  rulesEdition?: RulesEdition;
};

export async function o5SearchSpells(params: O5SpellSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchSpellsSection(params, origin));
}

export async function o5SearchSpellsSection(params: O5SpellSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const { selected, hidden } = await o5Select<O5Spell>(["spells"], requested, {
    name: params.name,
    passes: ({ record: s }) =>
      (params.level === undefined || s.level === params.level)
      && (!params.school || lowerHas(params.school, s.school.key, s.school.name))
      && (params.concentration === undefined || s.concentration === params.concentration)
      && (params.ritual === undefined || s.ritual === params.ritual),
  });

  const noMatch = "No spells found matching the criteria (SRD only).";
  // An offset past the end lists nothing: the shared past-the-end line under the Open5e header.
  if (selected.length && offset >= selected.length) {
    return o5Section(open5eSearchHeader(requested, origin), paginateResults("Spell", selected, () => "", limit, offset), searchFooter(requested, hidden), hidden);
  }
  const page = selected.slice(offset, offset + limit);
  const lines = page.map(({ entry }) => {
    const s = entry.record;
    const conc = s.concentration ? " [C]" : "";
    const ritual = s.ritual ? " [R]" : "";
    return `• ${s.name} ${editionTag(o5Info(entry))} (${spellLevel(s)} ${s.school.name}${conc}${ritual})`;
  });

  const showing = page.length === 1 ? `${offset + 1}` : `${offset + 1}–${offset + page.length}`;
  const heading = selected.length > offset + limit
    ? `Found ${selected.length} spell(s) (showing ${showing}, SRD only — use offset: ${offset + limit} for more):`
    : `Found ${selected.length} spell(s) (showing ${showing}, SRD only):`;
  return o5SearchReply(requested, origin, heading, lines, hidden, noMatch);
}

export async function o5GetSpell(name: string, rulesEdition: RulesEdition, origin: Open5eOrigin): Promise<string | null> {
  const hit = await o5Lookup<O5Spell>(["spells"], name, rulesEdition);
  return hit ? formatO5Spell(hit, origin) : null;
}

// ── MONSTERS ──────────────────────────────────────────────────────────────────

type Ability = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
const ABILITIES: ReadonlyArray<readonly [Ability, string]> = [
  ["strength", "STR"], ["dexterity", "DEX"], ["constitution", "CON"],
  ["intelligence", "INT"], ["wisdom", "WIS"], ["charisma", "CHA"],
];

interface O5Action {
  name: string;
  desc: string;
  action_type?: string | null;
  order_in_statblock?: number | null;
  legendary_action_cost?: number | null;
  usage_limits?: { type: string; param: number } | null;
}

/**
 * An action's name with its usage limit and legendary cost, as the old client printed them:
 * "Fire Breath (Recharge 5–6)", "Dominate Mind (2/Day)", "Wing Attack (Costs 2
 * Actions)". RECHARGE (SRD 5.2 only) reads like RECHARGE_ON_ROLL. A few names
 * already carry the text (Basilisk's "Petrifying Gaze (Recharge 4-6)"); it is not repeated.
 */
function actionName(a: O5Action): string {
  let name = a.name;
  const limit = a.usage_limits;
  if (limit && (limit.type === "RECHARGE_ON_ROLL" || limit.type === "RECHARGE") && !/\(Recharge/i.test(name)) {
    name += limit.param === 6 ? " (Recharge 6)" : ` (Recharge ${limit.param}–6)`;
  } else if (limit?.type === "PER_DAY" && !/\/Day\b/i.test(name)) {
    name += ` (${limit.param}/Day)`;
  }
  if (a.action_type === "LEGENDARY_ACTION" && (a.legendary_action_cost ?? 1) > 1 && !/\(Costs/i.test(name)) {
    name += ` (Costs ${a.legendary_action_cost} Actions)`;
  }
  return name;
}

const MINOR_WORDS = new Set(["of", "and", "the"]);
/** A v2 skill key as printed: "sleight_of_hand" → "Sleight of Hand". */
const skillName = (key: string): string => key.split("_")
  .map((w, i) => (i > 0 && MINOR_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
  .join(" ");

interface O5Creature extends O5Record {
  size?: { name: string; key: string } | null;
  type?: { name: string; key: string } | null;
  alignment?: string | null;
  armor_class?: number | null;
  armor_detail?: string | null;
  hit_points?: number | null;
  hit_dice?: string | null;
  speed?: Partial<Record<"walk" | "fly" | "swim" | "climb" | "burrow", number>> & { hover?: boolean; unit?: string };
  ability_scores?: Partial<Record<Ability, number>>;
  modifiers?: Partial<Record<Ability, number>>;
  saving_throws?: Partial<Record<Ability, number>>;
  skill_bonuses?: Record<string, number>;
  resistances_and_immunities?: Partial<Record<
    "damage_vulnerabilities_display" | "damage_resistances_display" | "damage_immunities_display" | "condition_immunities_display",
    string
  >>;
  darkvision_range?: number | null;
  blindsight_range?: number | null;
  tremorsense_range?: number | null;
  truesight_range?: number | null;
  passive_perception?: number | null;
  languages?: { as_string?: string | null } | null;
  challenge_rating: number;
  traits?: Array<{ name: string; desc: string }>;
  actions?: O5Action[];
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

const ACTION_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["ACTION", "ACTIONS"], ["BONUS_ACTION", "BONUS ACTIONS"], ["REACTION", "REACTIONS"], ["LEGENDARY_ACTION", "LEGENDARY ACTIONS"],
];

function formatO5Monster(hit: O5Hit<O5Creature>, origin: Open5eOrigin): string {
  const m = hit.entry.record;
  const speed = m.speed ?? {};
  const speedStr = (["walk", "fly", "swim", "climb", "burrow"] as const)
    .filter(k => typeof speed[k] === "number")
    .map(k => `${k} ${speed[k]} ft.${k === "fly" && speed.hover === true ? " (hover)" : ""}`)
    .join(", ");

  const mods = m.modifiers ?? {};
  // A 2024 record lists all six saves; only those differing from the modifier are proficient.
  const saves = ABILITIES
    .filter(([k]) => typeof m.saving_throws?.[k] === "number" && m.saving_throws[k] !== (mods[k] ?? 0))
    .map(([k, abbr]) => `${abbr} ${signed(m.saving_throws![k]!)}`);
  const skills = Object.entries(m.skill_bonuses ?? {})
    .map(([k, v]) => `${skillName(k)} ${signed(v)}`)
    .join(", ");
  const abilityLine = (pairs: typeof ABILITIES) => pairs
    .map(([k, abbr]) => {
      const score = m.ability_scores?.[k];
      if (score == null) return null;
      const mod = mods[k];
      return `${abbr} ${score}${mod != null ? ` (${signed(mod)})` : ""}`;
    })
    .filter(Boolean).join("  ");

  const kind = [m.size?.name, m.type?.name].filter(Boolean).join(" ");
  const stats = [
    `CR ${crText(m.challenge_rating)}`,
    m.armor_class != null ? `AC ${m.armor_class}${m.armor_detail ? ` (${m.armor_detail})` : ""}` : null,
    m.hit_points != null ? `HP ${m.hit_points}${m.hit_dice ? ` (${m.hit_dice})` : ""}` : null,
  ].filter(Boolean).join(" | ");

  const lines: string[] = [
    m.name,
    o5Label(hit.entry.edition, origin, hit),
    [kind, m.alignment].filter(Boolean).join(", "),
    stats,
  ];
  if (speedStr) lines.push(`Speed: ${speedStr}`);
  lines.push(``);
  for (const half of [ABILITIES.slice(0, 3), ABILITIES.slice(3)]) {
    const line = abilityLine(half);
    if (line) lines.push(line);
  }
  if (saves.length) lines.push(`Saving Throws: ${saves.join(", ")}`);
  if (skills) lines.push(`Skills: ${skills}`);
  const ri = m.resistances_and_immunities ?? {};
  if (ri.damage_vulnerabilities_display) lines.push(`Damage Vulnerabilities: ${ri.damage_vulnerabilities_display}`);
  if (ri.damage_resistances_display) lines.push(`Damage Resistances: ${ri.damage_resistances_display}`);
  if (ri.damage_immunities_display) lines.push(`Damage Immunities: ${ri.damage_immunities_display}`);
  if (ri.condition_immunities_display) lines.push(`Condition Immunities: ${ri.condition_immunities_display}`);
  const senses = ([["darkvision", m.darkvision_range], ["blindsight", m.blindsight_range], ["tremorsense", m.tremorsense_range], ["truesight", m.truesight_range]] as const)
    .filter(([, range]) => range != null)
    .map(([sense, range]) => `${sense} ${range} ft.`);
  if (m.passive_perception != null) senses.push(`passive Perception ${m.passive_perception}`);
  if (senses.length) lines.push(`Senses: ${senses.join(", ")}`);
  lines.push(`Languages: ${m.languages?.as_string || "—"}`);

  if (m.traits?.length) {
    lines.push(``, `TRAITS`);
    for (const a of m.traits) lines.push(`  ${a.name}. ${a.desc}`);
  }
  for (const [type, heading] of ACTION_SECTIONS) {
    const actions = (m.actions ?? [])
      .filter(a => a.action_type === type)
      .sort((a, b) => (a.order_in_statblock ?? 0) - (b.order_in_statblock ?? 0));
    if (!actions.length) continue;
    lines.push(``, heading);
    if (type === "LEGENDARY_ACTION") lines.push(LEGENDARY_USES_NOTE);
    for (const a of actions) lines.push(`  ${actionName(a)}. ${a.desc}`);
  }

  return lines.join("\n");
}

type O5MonsterSearchParams = {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  rulesEdition?: RulesEdition;
};

export async function o5SearchMonsters(params: O5MonsterSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchMonstersSection(params, origin));
}

export async function o5SearchMonstersSection(params: O5MonsterSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  const { selected, hidden } = await o5Select<O5Creature>(["creatures"], requested, {
    name: params.name,
    passes: ({ record: m }) =>
      (params.cr === undefined || m.challenge_rating === params.cr)
      && (!params.type || lowerHas(params.type, m.type?.key, m.type?.name))
      && (!params.size || lowerHas(params.size, m.size?.key, m.size?.name)),
  });

  const lines = selected.slice(0, SEARCH_CAP + 1).map(({ entry }) => {
    const m = entry.record;
    const kind = [m.size?.name, m.type?.name].filter(Boolean).join(" ");
    return `• ${m.name} ${editionTag(o5Info(entry))} (CR ${crText(m.challenge_rating)}${kind ? `, ${kind}` : ""})`;
  });
  return o5SearchReply(
    requested, origin,
    `Found ${selected.length} monster(s) (showing ${Math.min(selected.length, SEARCH_CAP)}, SRD only):`,
    capped(lines), hidden, "No monsters found (SRD only).",
  );
}

/**
 * `lockedEdition`: a logged-out lookup whose D&D Beyond entry of that edition is
 * locked. When only the other SRD has the creature, "no 2024 version found"
 * would be false (D&D Beyond has one), so the reason says that version needs
 * ddb_login instead.
 */
export async function o5GetMonster(name: string, rulesEdition: RulesEdition, origin: Open5eOrigin, lockedEdition?: RulesEdition): Promise<string | null> {
  const hit = await o5Lookup<O5Creature>(["creatures"], name, rulesEdition);
  if (!hit) return null;
  if (lockedEdition && hit.reason === (lockedEdition === "2024" ? "no-2024-version" : "no-2014-version")) {
    return formatO5Monster({ ...hit, reason: loggedOutReason(lockedEdition === "2024" ? "locked-2024" : "locked-2014") }, origin);
  }
  return formatO5Monster(hit, origin);
}

/** An SRD creature found by o5MonsterInEdition: its AC and HP for a search line, and its stat block. */
export interface O5EditionMonster {
  armorClass: number | null;
  hitPoints: number | null;
  text(origin: Open5eOrigin): string;
}

/**
 * Exactly `name` (by twin name) in `edition`'s SRD document only, or null when
 * that document lacks it. A logged-out D&D Beyond lookup whose requested
 * edition is locked asks this before swapping to the other edition (owner
 * ruling 2026-11-02: the requested edition's SRD text beats a swap).
 */
export async function o5MonsterInEdition(name: string, edition: RulesEdition): Promise<O5EditionMonster | null> {
  const hit = await o5Lookup<O5Creature>(["creatures"], name, edition);
  if (!hit || hit.entry.edition !== edition) return null;
  const twin = o5TwinNameFor("creatures");
  if (twin(hit.entry.record.name) !== twin(name)) return null;
  const m = hit.entry.record;
  return { armorClass: m.armor_class ?? null, hitPoints: m.hit_points ?? null, text: origin => formatO5Monster(hit, origin) };
}

// ── EQUIPMENT ─────────────────────────────────────────────────────────────────

interface O5MagicItem extends O5Record {
  desc: string;
  category?: { name?: string | null } | null;
  rarity?: { name?: string | null } | null;
  requires_attunement?: boolean;
  attunement_detail?: string | null;
}

/** A mundane item (v2 `items`): adventuring gear, and the cost and weight of weapons and armour. */
interface O5Item extends O5Record {
  desc: string;
  category?: { name?: string | null } | null;
  cost?: string | null;
  weight?: string | null;
  weight_unit?: string | null;
}

interface O5Weapon extends O5Record {
  damage_dice: string;
  damage_type?: { name: string } | null;
  range?: number | null;
  long_range?: number | null;
  distance_unit?: string | null;
  is_simple: boolean;
  properties?: Array<{ property: { name: string; type?: string | null }; detail?: string | null }>;
}

interface O5Armor extends O5Record {
  category?: string | null;   // "light", "medium", "heavy"
  ac_display: string;
  strength_score_required?: number | null;
  grants_stealth_disadvantage?: boolean;
}

/** Search hits: magic items and mundane items, told apart by endpoint. */
type O5Gear = O5MagicItem | O5Item;

const stripTags = (text: string | null | undefined): string => (text ?? "").replace(/<[^>]+>/g, "").trim();

/** An API enum as printed: "FULL" → "Full", "FIGHTING_STYLE" → "Fighting Style", "Epic Boon" kept. */
export const humanize = (value: string): string => value.split(/[_\s]+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  .join(" ");

function formatO5MagicItem(hit: O5Hit<O5MagicItem>, origin: Open5eOrigin): string {
  const i = hit.entry.record;
  const attune = i.requires_attunement ? ` | Requires attunement${i.attunement_detail ? ` (${i.attunement_detail})` : ""}` : "";
  const kind = [i.category?.name, i.rarity?.name].filter(Boolean).join(", ");
  const inner = [kind, attune.replace(/^ \| /, "")].filter(Boolean).join(" | ");
  return [`${i.name}${inner ? ` (${inner})` : ""}`, o5Label(hit.entry.edition, origin, hit), ``, stripTags(i.desc)].join("\n");
}

/** An items record's cost and weight; a zero or missing part prints a dash. */
function costWeightLine(i: O5Item): string {
  const cost = Number(i.cost);
  const weight = Number(i.weight);
  return `Cost: ${cost > 0 ? `${cost} gp` : "—"} | Weight: ${weight > 0 ? `${weight}${i.weight_unit ? ` ${i.weight_unit}` : ""}` : "—"}`;
}

/** " (a, b)" from the non-empty parts, or "" when there are none. */
const parens = (parts: Array<string | null | undefined>): string => {
  const inner = parts.filter(Boolean).join(", ");
  return inner ? ` (${inner})` : "";
};

function formatO5Item(hit: O5Hit<O5Item>, origin: Open5eOrigin): string {
  const i = hit.entry.record;
  // srd-2014 has no armour Shield, and its items record carries no AC value (armor is null), only the
  // prose "increases your Armor Class by 2": the SRD's +2, as the armour formatter prints it for 2024.
  const ac = O5_NAMERS.item.twin(i.name) === "shield" ? [`AC: +2`] : [];
  const lines = [`${i.name}${parens([i.category?.name])}`, o5Label(hit.entry.edition, origin, hit), ...ac, costWeightLine(i)];
  const desc = stripTags(i.desc);
  if (desc) lines.push(``, desc);
  return lines.join("\n");
}

/**
 * A weapon's or armour's `items` record in the same document, by Open5e twin
 * key: it holds the cost and weight. The lookup has already loaded it.
 */
async function itemsTwin(entry: O5Entry<O5Record>): Promise<O5Item | undefined> {
  const twin = O5_NAMERS.item.twin;
  const key = twin(entry.record.name);
  return (await loadO5Document<O5Item>("items", entry.edition)).find(i => twin(i.name) === key);
}

/** Cost and weight come from the weapon's `items` record, when it has one. */
function formatO5Weapon(hit: O5Hit<O5Weapon>, origin: Open5eOrigin, gear?: O5Item): string {
  const w = hit.entry.record;
  const lines = [`${w.name} (${w.is_simple ? "Simple" : "Martial"} Weapon)`, o5Label(hit.entry.edition, origin, hit)];
  const damage = [w.damage_dice, w.damage_type?.name].filter(Boolean).join(" ");
  if (damage) lines.push(`Damage: ${damage}`);
  if ((w.range ?? 0) > 0) {
    lines.push(`Range: ${w.range}${(w.long_range ?? 0) > 0 ? `/${w.long_range}` : ""}${w.distance_unit ? ` ${w.distance_unit}` : ""}`);
  }
  const props = w.properties ?? [];
  const plain = props.filter(p => p.property.type !== "Mastery").map(p => `${p.property.name}${p.detail ? ` (${p.detail})` : ""}`);
  if (plain.length) lines.push(`Properties: ${plain.join(", ")}`);
  for (const p of props.filter(p => p.property.type === "Mastery")) lines.push(`Mastery: ${p.property.name}`);
  if (gear) lines.push(costWeightLine(gear));
  return lines.join("\n");
}

/** Cost and weight come from the armour's `items` record, when it has one. */
function formatO5Armor(hit: O5Hit<O5Armor>, origin: Open5eOrigin, gear?: O5Item): string {
  const a = hit.entry.record;
  // The 2024 Shield's record says "heavy" and an AC of "2": it is a +2 shield.
  const shield = normalizeName(a.name) === "shield";
  const category = a.category ? `${a.category.charAt(0).toUpperCase()}${a.category.slice(1)} ` : "";
  const strReq = a.strength_score_required ? ` | Requires STR ${a.strength_score_required}` : "";
  const stealth = a.grants_stealth_disadvantage ? ` | Stealth disadvantage` : "";
  return [
    `${a.name} (${shield ? "Shield" : `${category}Armor`})`,
    o5Label(hit.entry.edition, origin, hit),
    `AC: ${shield ? "+" : ""}${a.ac_display}${strReq}${stealth}`,
    ...(gear ? [costWeightLine(gear)] : []),
  ].join("\n");
}

type O5ItemSearchParams = {
  name?: string;
  rarity?: string;
  type?: string;
  rulesEdition?: RulesEdition;
};

export async function o5SearchItems(params: O5ItemSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchItemsSection(params, origin));
}

export async function o5SearchItemsSection(params: O5ItemSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  const rarity = params.rarity?.trim().toLowerCase();
  const type = params.type?.toLowerCase();
  const { selected, hidden } = await o5Select<O5Gear>(["magicitems", "items"], requested, {
    name: params.name,
    // Rarity matches exactly ("common" is not "Uncommon"). Mundane items have
    // none and count as Common, so "common" lists mundane gear, as on D&D Beyond.
    passes: ({ record: i, endpoint }) =>
      (!rarity || (endpoint === "magicitems" ? ((i as O5MagicItem).rarity?.name || "Common") : "Common").toLowerCase() === rarity)
      && (!type || (i.category?.name ?? "").toLowerCase().includes(type)),
  });

  const lines = selected.slice(0, SEARCH_CAP + 1).map(({ entry }) => {
    const i = entry.record;
    const kind = [i.category?.name, entry.endpoint === "magicitems" ? (i as O5MagicItem).rarity?.name : null].filter(Boolean).join(", ");
    return `• ${i.name} ${editionTag(o5Info(entry))}${kind ? ` (${kind})` : ""}`;
  });
  return o5SearchReply(
    requested, origin,
    `Found ${selected.length} item(s) (showing ${Math.min(selected.length, SEARCH_CAP)}, SRD only):`,
    capped(lines), hidden, "No items found matching the criteria (SRD only).",
  );
}

/** One lookup across magic items, weapons, armour and gear, so an exact name in any of them beats a partial one. */
export async function o5GetEquipment(name: string, rulesEdition: RulesEdition, origin: Open5eOrigin): Promise<string | null> {
  const hit = await o5Lookup<O5Record>(["magicitems", "weapons", "armor", "items"], name, rulesEdition);
  if (!hit) return null;
  switch (hit.entry.endpoint) {
    case "magicitems": return formatO5MagicItem(hit as O5Hit<O5MagicItem>, origin);
    case "weapons": return formatO5Weapon(hit as O5Hit<O5Weapon>, origin, await itemsTwin(hit.entry));
    case "armor": return formatO5Armor(hit as O5Hit<O5Armor>, origin, await itemsTwin(hit.entry));
    default: return formatO5Item(hit as O5Hit<O5Item>, origin);
  }
}

// ── CHARACTER OPTIONS ─────────────────────────────────────────────────────────

/** A record of the same document, by key: a subrace's species or a subclass's class. */
async function o5Parent<T extends O5Record>(endpoint: O5Endpoint, edition: RulesEdition, key: string | null | undefined): Promise<T | undefined> {
  if (!key) return undefined;
  return (await loadO5Document<T>(endpoint, edition)).find(r => r.key === key);
}

/**
 * An option search's reply: a single hit is its detail block (and the footer),
 * else the result lines. The detail block is the body under no header: it
 * carries its own single-lookup label, as a get does.
 */
async function o5OptionReply<T extends O5Record>(
  requested: RulesEdition,
  origin: "unavailable" | "not-found",
  result: { selected: Array<{ entry: O5Entry<T>; reason?: SelectionReason }>; hidden: number },
  opts: {
    /** Whether a single hit renders its detail block. */
    single: boolean;
    /** The query and its endpoint: a single hit gets the rename line a get would print. */
    name?: string;
    endpoint: O5Endpoint;
    /** Counted in the heading: "race(s)". */
    counted: string;
    noMatch: string;
    detail: (hit: O5Hit<T>) => Promise<string>;
    line: (entry: O5Entry<T>) => Promise<string>;
  },
): Promise<SearchSection> {
  const { selected, hidden } = result;
  if (opts.single && selected.length === 1) {
    // The rename line comes from the get's own lookup, kept only when that lookup shows the same entry.
    const got = opts.name ? await o5Lookup<O5Record>([opts.endpoint], opts.name, requested) : null;
    const hit = selected[0];
    const same = got?.entry.edition === hit.entry.edition && got.entry.record.key === hit.entry.record.key;
    return o5Section(null, await opts.detail({ ...hit, renamed: same ? got.renamed : undefined }), searchFooter(requested, hidden), hidden);
  }
  const lines = await Promise.all(selected.map(({ entry }) => opts.line(entry)));
  return o5SearchReply(requested, origin, `Found ${selected.length} ${opts.counted} (SRD only):`, lines, hidden, opts.noMatch);
}

type O5OptionSearchParams = { name?: string; rulesEdition?: RulesEdition };

// ── Species

interface O5Trait { name: string; desc: string; type?: string | null; order?: number | null }

interface O5Species extends O5Record {
  /** SRD 5.1 only: SRD 5.2's is empty. */
  desc?: string | null;
  subspecies_of?: string | null;
  traits?: O5Trait[];
}

/** A species' Size or Speed trait: by type (SRD 5.2), else by name (SRD 5.1). */
function speciesTrait(s: O5Species | undefined, kind: "SIZE" | "SPEED"): O5Trait | undefined {
  const traits = s?.traits ?? [];
  return traits.find(t => t.type === kind) ?? traits.find(t => normalizeName(t.name) === kind.toLowerCase());
}

/** Size, speed and parent of a species; a subrace without its own size or speed takes its parent's. */
async function speciesFacts(entry: O5Entry<O5Species>): Promise<{ parent?: O5Species; size?: O5Trait; speed?: O5Trait }> {
  const s = entry.record;
  const parent = await o5Parent<O5Species>("species", entry.edition, s.subspecies_of);
  return {
    parent,
    size: speciesTrait(s, "SIZE") ?? speciesTrait(parent, "SIZE"),
    speed: speciesTrait(s, "SPEED") ?? speciesTrait(parent, "SPEED"),
  };
}

async function formatO5Species(hit: O5Hit<O5Species>, origin: Open5eOrigin): Promise<string> {
  const s = hit.entry.record;
  const { size, speed } = await speciesFacts(hit.entry);
  const lines = [s.name, o5Label(hit.entry.edition, origin, hit)];
  const facts = [size && `Size: ${size.desc.trim()}`, speed && `Speed: ${speed.desc.trim()}`].filter(Boolean);
  if (facts.length) lines.push(facts.join(" | "));
  const desc = stripTags(s.desc);
  if (desc) lines.push(``, desc);
  const traits = (s.traits ?? [])
    .map((t, i) => ({ t, order: t.order ?? i }))
    .filter(({ t }) => t !== size && t !== speed)
    .sort((a, b) => a.order - b.order);
  if (traits.length) lines.push(``, ...traits.map(({ t }) => `**${t.name}.** ${t.desc.trim()}`));
  return lines.join("\n");
}

/**
 * Species group by base race, as on D&D Beyond (nested mode in edition-search.ts):
 * selected per species name, then a base race with a pick in the requested
 * edition drops the other edition's picks and counts them hidden. So under 2024
 * the 2024 Elf replaces SRD 5.1's Elf and High Elf; under 2014 each subrace is
 * listed; and naming a subrace ("high elf") finds it under either edition.
 */
async function o5SelectSpecies(requested: RulesEdition, name?: string): ReturnType<typeof o5Select<O5Species>> {
  const { selected, hidden } = await o5Select<O5Species>(["species"], requested, { name });
  const bases = await Promise.all(selected.map(async ({ entry }) =>
    o5TwinNameFor("species")((await o5Parent<O5Species>("species", entry.edition, entry.record.subspecies_of))?.name ?? entry.record.name)));
  const withRequested = new Set(bases.filter((_, i) => selected[i].entry.edition === requested));
  const kept = selected.filter(({ entry }, i) => entry.edition === requested || !withRequested.has(bases[i]));
  return { selected: kept, hidden: hidden + selected.length - kept.length };
}

export async function o5SearchRaces(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchRacesSection(params, origin));
}

export async function o5SearchRacesSection(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5SelectSpecies(requested, params.name), {
    single: !!params.name,
    name: params.name,
    endpoint: "species",
    counted: "race(s)",
    noMatch: "No races found (SRD only).",
    detail: hit => formatO5Species(hit, origin),
    line: async entry => {
      const { parent, speed } = await speciesFacts(entry);
      return `• ${entry.record.name} ${editionTag(o5Info(entry))}${parent ? ` (subrace of ${parent.name})` : ""}${speed ? ` | Speed: ${speed.desc.trim()}` : ""}`;
    },
  });
}

// ── Classes

interface O5Class extends O5Record {
  hit_dice?: string | null;
  hit_points?: { hit_points_at_1st_level?: string | null } | null;
  saving_throws?: Array<{ name: string }>;
  caster_type?: string | null;
  subclass_of?: { name: string; key: string } | null;
  features?: Array<{ name: string; desc?: string | null; feature_type?: string | null }>;
}

const COLUMN_PLACEHOLDER = "[Column data]";

/** A class's hit die, lower-cased; a subclass has none of its own and takes its class's. */
async function hitDie(entry: O5Entry<O5Class>): Promise<string | undefined> {
  const c = entry.record;
  const die = c.hit_dice ?? (await o5Parent<O5Class>("classes", entry.edition, c.subclass_of?.key))?.hit_dice;
  return die ? die.toLowerCase() : undefined;
}

async function formatO5Class(hit: O5Hit<O5Class>, origin: Open5eOrigin): Promise<string> {
  const c = hit.entry.record;
  const die = await hitDie(hit.entry);
  const lines = [c.name, o5Label(hit.entry.edition, origin, hit)];
  const hp = c.hit_points?.hit_points_at_1st_level;
  const dice = [die && `Hit Die: ${die}`, hp && `HP at 1st: ${hp}`].filter(Boolean);
  if (dice.length) lines.push(dice.join(" | "));
  if (c.saving_throws?.length) lines.push(`Saving Throws: ${c.saving_throws.map(s => s.name).join(", ")}`);
  if (c.caster_type && c.caster_type !== "NONE") lines.push(`Spellcasting: ${humanize(c.caster_type)}`);
  // Only class-level features: the rest are table rows (spell slots, proficiency bonus, starting equipment).
  // Some of the class table's columns (Invocations Known, Spells Known, Rages, Slot Level, Cantrips Known)
  // arrive typed as CLASS_LEVEL_FEATURE; live, they are all and only the rows whose desc is this placeholder.
  const features = [...new Set((c.features ?? [])
    .filter(f => f.feature_type === "CLASS_LEVEL_FEATURE" && f.desc?.trim() !== COLUMN_PLACEHOLDER)
    .map(f => f.name))];
  if (features.length) lines.push(`Features: ${features.join(", ")}`);
  return lines.join("\n");
}

export async function o5SearchClasses(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchClassesSection(params, origin));
}

export async function o5SearchClassesSection(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5Select<O5Class>(["classes"], requested, { name: params.name }), {
    single: !!params.name,
    name: params.name,
    endpoint: "classes",
    counted: "class(es)",
    noMatch: "No classes found (SRD only).",
    detail: hit => formatO5Class(hit, origin),
    line: async entry => {
      const die = await hitDie(entry);
      const sub = entry.record.subclass_of;
      return `• ${entry.record.name} ${editionTag(o5Info(entry))}${die ? ` (${die})` : ""}${sub ? ` | subclass of ${sub.name}` : ""}`;
    },
  });
}

// ── Backgrounds

interface O5Background extends O5Record {
  /** SRD 5.1 only: SRD 5.2's is empty. */
  desc?: string | null;
  benefits?: Array<{ name: string; desc: string; type?: string | null }>;
}

function formatO5Background(hit: O5Hit<O5Background>, origin: Open5eOrigin): string {
  const b = hit.entry.record;
  const desc = stripTags(b.desc);
  const benefits = (b.benefits ?? []).map(x => `**${x.name}:** ${stripTags(x.desc)}`);
  return [
    b.name, o5Label(hit.entry.edition, origin, hit),
    ...(desc ? [``, desc] : []),
    ...(benefits.length ? [``, ...benefits] : []),
  ].join("\n");
}

export async function o5SearchBackgrounds(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchBackgroundsSection(params, origin));
}

export async function o5SearchBackgroundsSection(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5Select<O5Background>(["backgrounds"], requested, { name: params.name }), {
    single: true,
    name: params.name,
    endpoint: "backgrounds",
    counted: "background(s)",
    noMatch: "No backgrounds found (SRD only).",
    detail: async hit => formatO5Background(hit, origin),
    line: async entry => {
      const skills = (entry.record.benefits ?? []).find(x => x.type === "skill_proficiency" || x.name === "Skill Proficiencies");
      return `• ${entry.record.name} ${editionTag(o5Info(entry))}${skills?.desc ? ` (${skills.desc})` : ""}`;
    },
  });
}

// ── Feats

interface O5Feat extends O5Record {
  desc?: string | null;
  type?: string | null;
  has_prerequisite?: boolean;
  prerequisite?: string | null;
  benefits?: Array<{ desc: string }>;
}

const prerequisite = (f: O5Feat): string =>
  (f.has_prerequisite && f.prerequisite ? f.prerequisite.replace(/^Prerequisite:\s*/i, "") : "");

function formatO5Feat(hit: O5Hit<O5Feat>, origin: Open5eOrigin): string {
  const f = hit.entry.record;
  const lines = [f.name, o5Label(hit.entry.edition, origin, hit)];
  if (f.type) lines.push(`Type: ${humanize(f.type)}`);
  if (prerequisite(f)) lines.push(`Prerequisite: ${prerequisite(f)}`);
  const body = [stripTags(f.desc), ...(f.benefits ?? []).map(x => `• ${stripTags(x.desc)}`)].filter(Boolean);
  if (body.length) lines.push(``, ...body);
  return lines.join("\n");
}

export async function o5SearchFeats(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<string> {
  return renderSection(await o5SearchFeatsSection(params, origin));
}

export async function o5SearchFeatsSection(params: O5OptionSearchParams, origin: "unavailable" | "not-found"): Promise<SearchSection> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5Select<O5Feat>(["feats"], requested, { name: params.name }), {
    single: true,
    name: params.name,
    endpoint: "feats",
    counted: "feat(s)",
    noMatch: "No feats found (SRD only).",
    detail: async hit => formatO5Feat(hit, origin),
    line: async entry => `• ${entry.record.name} ${editionTag(o5Info(entry))}${prerequisite(entry.record) ? ` (${prerequisite(entry.record)})` : ""}`,
  });
}

// ── RULES ─────────────────────────────────────────────────────────────────────
// Rules come from the rulesets endpoint: a chapter with its sections. They are
// not twin-grouped: the requested document is searched first, then the other.

interface O5RuleSection { key: string; name: string; desc: string; index: number }
interface O5Ruleset extends O5Record { desc: string; rules: O5RuleSection[] }

/** Everything after a key's first "_": `srd-2024_combat_cover` → `combat_cover`. */
const ruleSlug = (key: string): string => key.slice(key.indexOf("_") + 1);

const otherEdition = (e: RulesEdition): RulesEdition => (e === "2024" ? "2014" : "2024");

/** One document's rulesets, a missing `desc` as "" and sections in index order. */
const rulesetsOf = async (edition: RulesEdition): Promise<O5Ruleset[]> =>
  (await loadO5Document<O5Ruleset>("rulesets", edition)).map(r => ({
    ...r,
    desc: r.desc ?? "",
    rules: (r.rules ?? []).map(s => ({ ...s, desc: s.desc ?? "" })).sort((a, b) => a.index - b.index),
  }));

/** The query as a slug: normalized, spaces → "-". */
const slugOf = (query: string): string => normalizeName(query).replace(/ /g, "-");

interface RuleMatch { ruleset: O5Ruleset; section?: O5RuleSection }

function findRule(rulesets: O5Ruleset[], query: string): RuleMatch | null {
  const q = normalizeName(query);
  if (!q) return null;
  const slug = slugOf(query);
  const same = (r: { key: string; name: string }): boolean =>
    normalizeName(r.name) === q || r.key.toLowerCase() === q || ruleSlug(r.key) === slug;
  const sectionSame = (r: O5RuleSection): boolean => same(r) || ruleSlug(r.key).split("_").pop() === slug;
  const sections = (test: (r: O5RuleSection) => boolean): RuleMatch | null => {
    for (const ruleset of rulesets) {
      const section = ruleset.rules.find(test);
      if (section) return { ruleset, section };
    }
    return null;
  };
  const exactSet = rulesets.find(same);
  if (exactSet) return { ruleset: exactSet };
  const exactSection = sections(sectionSame);
  if (exactSection) return exactSection;
  const partSet = rulesets.find(r => normalizeName(r.name).includes(q));
  if (partSet) return { ruleset: partSet };
  return sections(r => normalizeName(r.name).includes(q));
}

export async function o5SearchRules(query: string | undefined, rulesEdition: RulesEdition): Promise<string> {
  const q = query ? normalizeName(query) : "";
  const has = (text: string): boolean => normalizeName(text).includes(q);
  const search = async (edition: RulesEdition): Promise<string[]> => {
    const lines: string[] = [];
    for (const r of await rulesetsOf(edition)) {
      const sections = q ? r.rules.filter(s => has(s.name) || has(s.desc)) : [];
      if (q && !has(r.name) && !has(r.desc) && !sections.length) continue;
      const tag = editionTag({ ruleset: edition, book: null });
      lines.push(`• **${r.name}** ${tag} (slug: \`${ruleSlug(r.key)}\`)${sections.length ? ` — ${sections.map(s => s.name).join(", ")}` : ""}`);
    }
    return lines;
  };
  let edition = rulesEdition;
  let lines = await search(edition);
  let miss = false;
  if (!lines.length) {
    edition = otherEdition(rulesEdition);
    lines = await search(edition);
    miss = lines.length > 0;
  }
  if (!lines.length) return `No rules sections found matching "${query?.trim() ?? ""}" (SRD only).`;
  return [
    searchHeader({ rulesDoc: edition }),
    ...(miss ? [reasonLine(rulesEdition === "2024" ? "rules-search-miss-2024" : "rules-search-miss-2014")] : []),
    `Found ${lines.length} rules chapter(s)${q ? ` matching "${query!.trim()}"` : ""} (SRD only):`,
    ...lines,
    `\nUse ddb_get_rules with the section name or slug to read the full text.`,
  ].join("\n");
}

/**
 * Where a normalized query first occurs in `text` folded like normalizeName
 * (case, curly apostrophes, whitespace runs), as an index into the original
 * text, so the jump keeps its characters. -1 when it does not occur.
 */
function foldedIndexOf(text: string, normalizedQuery: string): number {
  let folded = "";
  const origin: number[] = [];   // folded index → text index
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (folded.endsWith(" ")) continue;
      folded += " ";
      origin.push(i);
      continue;
    }
    // toLowerCase can lengthen a character ("İ"): each output unit maps back to it.
    for (const unit of ch.replace(/[‘’]/g, "'").toLowerCase()) {
      folded += unit;
      origin.push(i);
    }
  }
  const at = folded.indexOf(normalizedQuery);
  return at === -1 ? -1 : origin[at];
}

export async function o5GetRule(
  nameOrSlug: string,
  rulesEdition: RulesEdition,
  maxChars = 4000,
  query?: string
): Promise<string | null> {
  let edition = rulesEdition;
  let match = findRule(await rulesetsOf(edition), nameOrSlug);
  if (!match) {
    edition = otherEdition(rulesEdition);
    match = findRule(await rulesetsOf(edition), nameOrSlug);
  }
  if (!match) return null;

  const { ruleset, section } = match;
  let text = section
    ? section.desc
    : [ruleset.desc, ...ruleset.rules.map(s => `### ${s.name}\n${s.desc}`)].filter(Boolean).join("\n\n");

  // If query provided, start near the first occurrence, matched as the search matches
  const q = query ? normalizeName(query) : "";
  if (q) {
    const idx = foldedIndexOf(text, q);
    if (idx !== -1) {
      const start = Math.max(0, idx - 200);
      text = (start > 0 ? "…\n\n" : "") + text.slice(start);
    }
  }

  const truncated = text.length > maxChars;
  const output = truncated ? text.slice(0, maxChars) : text;
  const truncNote = truncated
    ? `\n\n*(Showing first ${maxChars} of ${text.length} chars — increase max_chars or use query to jump to a topic)*`
    : "";

  const reason = edition === rulesEdition ? undefined : (rulesEdition === "2024" ? "rules-miss-2024" : "rules-miss-2014");
  return [
    `## ${(section ?? ruleset).name}`,
    rulesLine({ ruleset: edition, book: null }, { open5e: "primary", reason }),
    ...(section ? [`*Part of ${ruleset.name}*`] : []),
    ``,
    output + truncNote,
  ].join("\n");
}

// ── MONSTER STATS (encounter / treasure) ─────────────────────────────────────

const CR_XP_O5: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800,
  "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900,
  "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
  "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000,
  "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000,
  "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

/** A monster's CR and XP for the encounter rater and treasure generator; getMonsterStats returns the same shape. */
export type MonsterStatsResult =
  | { status: "found"; name: string; crValue: number; xp: number; info: EditionInfo }
  | { status: "not-found" }
  /** The creature was identified (exact name, or the one group a partial name matches), but its CR isn't known. */
  | { status: "unknown-cr"; name: string; info: EditionInfo }
  | { status: "ambiguous"; candidates: Array<{ name: string; crValue: number | null; xp: number | null }> };

/**
 * CR and XP for an SRD monster, as the D&D Beyond branch of getMonsterStats
 * finds them: the exact twin name first, else the partial matches grouped by
 * twin name. One group is found, picked by edition; several are ambiguous, one
 * candidate per group, by CR then name. Never a guess. The edition comes from
 * the document the pick is in. A picked record with an unknown CR is
 * unknown-cr (exact or single group: never replaced by its other-edition twin)
 * or listed as "CR unknown", last, among ambiguous candidates (all unknown is
 * not-found); any Open5e failure is not-found.
 */
export async function o5GetMonsterStats(name: string, rulesEdition: RulesEdition): Promise<MonsterStatsResult> {
  try {
    const all = await o5Entries<O5Creature>(["creatures"], rulesEdition);
    const hasXp = (e: O5Entry<O5Creature>) => CR_XP_O5[crText(e.record.challenge_rating)] !== undefined;
    const tiebreak = o5Tiebreak<O5Creature>(["creatures"]);
    const stats = (e: O5Entry<O5Creature>) => ({
      name: e.record.name, crValue: e.record.challenge_rating, xp: CR_XP_O5[crText(e.record.challenge_rating)],
    });
    // The edition is picked over every name match first; a picked record with an
    // unknown CR is never replaced by its other-edition twin (fail closed).
    const found = (group: Array<O5Entry<O5Creature>>): MonsterStatsResult | null => {
      const picked = selectByEdition(group, rulesEdition, o5Info, tiebreak);
      if (!picked) return null;
      return hasXp(picked.entry)
        ? { status: "found", ...stats(picked.entry), info: o5Info(picked.entry) }
        : { status: "unknown-cr", name: picked.entry.record.name, info: o5Info(picked.entry) };
    };

    const twin = o5TwinNameFor("creatures");
    const key = twin(name);
    const exact = all.filter(e => twin(e.record.name) === key);
    if (exact.length) return found(exact) ?? { status: "not-found" };

    const query = o5Folded(name);
    if (!query) return { status: "not-found" };
    const groups = new Map<string, Array<O5Entry<O5Creature>>>();
    for (const e of all) {
      if (!o5Folded(e.record.name).includes(query)) continue;
      const k = twin(e.record.name);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    if (groups.size === 1) return found([...groups.values()][0]) ?? { status: "not-found" };
    if (groups.size > 1) {
      const candidates = [...groups.values()]
        .map(group => selectByEdition(group, rulesEdition, o5Info, tiebreak))
        .filter(picked => picked !== null)
        .map(picked => hasXp(picked.entry)
          ? stats(picked.entry)
          : { name: picked.entry.record.name, crValue: null, xp: null });
      // Unknown CRs are listed ("CR unknown"), last; all unknown is not-found.
      if (candidates.every(c => c.crValue === null)) return { status: "not-found" };
      candidates.sort((a, b) => (a.crValue === null ? 1 : 0) - (b.crValue === null ? 1 : 0)
        || (a.crValue ?? 0) - (b.crValue ?? 0) || a.name.localeCompare(b.name));
      return { status: "ambiguous", candidates };
    }
    return { status: "not-found" };
  } catch {
    return { status: "not-found" };
  }
}
