/**
 * reference.ts — Game reference tools: conditions, spells, items
 *
 * Conditions: hardcoded lookup table, no API required.
 * Spells: built from character-service game-data/spells (cantrips) and
 *         game-data/always-known-spells (leveled) across all 8 spellcasting
 *         classes; cached 24 h.
 * Items: single game-data/items endpoint; cached 24 h.
 * Class features: /classes + /subclasses?baseClassId + optional class-feature/collection?classId.
 * Racial traits: /races + optional racial-trait/collection?entityRaceId&entityRaceTypeId.
 *         Both are normalized in src/tools/features-traits.ts.
 *
 * All character-service endpoints use the cobalt Bearer token.
 */

import {
  beginAuthenticatedSession,
  captureSession, assertSessionCurrent, onSessionInvalidated, SessionChangedError,
} from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { stripHtml } from "../utils.js";
import {
  twinName, classOwnerTwinKey, classifyEdition, selectByEdition, definitionTiebreak, isEdition,
  normalizeName, searchFooter, dedupeById,
  type RulesEdition,
} from "../edition.js";
import { peekSourceIndex, getSourceIndex } from "../game-config.js";
import { resolveSource, unknownSourceError, withSourceCaveat, GENERIC_SOURCE_HINT, type ResolvedSource } from "../source-filter.js";
import {
  paginateResults, renderSection, plainSection, selectCatalog, lookupCatalog,
  type CatalogAdapter, type CatalogHit, type SearchSection,
} from "./edition-search.js";
import { createSpellStore, addSpells, spellList, type DdbSpell, type SpellStore } from "./spell-store.js";
import {
  buildClassFeatures, classFeatureFilters, compareClassFeatures, formatClassFeatureLine,
  buildRacialTraits, racialTraitFilters, compareRacialTraits, formatRacialTraitLine, raceKeyOf,
  type ClassFeatureEntry, type RacialTraitEntry, type OptionalCollection,
} from "./features-traits.js";
import {
  o5SearchSpells, o5GetSpell,
  o5SearchItems, o5GetEquipment,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchRules, o5GetRule,
} from "../open5e.js";

const CHARACTER_SERVICE = "https://character-service.dndbeyond.com";

// ── Cache ─────────────────────────────────────────────────────────────────────

const AUTHORITATIVE_TTL_MS = 24 * 60 * 60_000; // 24 h — DDB build was complete
const FALLBACK_TTL_MS = 5 * 60_000;            // 5 min — partial DDB build; retry sooner
const referenceCache = new TtlCache<string>(AUTHORITATIVE_TTL_MS, 50);

// ── Auth helper ───────────────────────────────────────────────────────────────

async function refFetch(url: string): Promise<Response> {
  // Single authenticated-fetch path: token + request bound to one snapshot.
  const session = await beginAuthenticatedSession();
  return session.fetch(url);
}

// ── Shared game-data list loader ──────────────────────────────────────────────

/** Non-OK response from a character-service game-data list endpoint. */
class GameDataFetchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GameDataFetchError";
  }
}

/**
 * Fetch a character-service game-data list once per session, bound to one
 * snapshot. An empty list is never cached: it reads as a real answer, but the
 * source may simply have returned nothing.
 */
async function loadGameDataList<T>(cacheKey: string, path: string): Promise<T[]> {
  const snapshot = captureSession();
  const cached = referenceCache.get(cacheKey);
  if (cached) return JSON.parse(cached) as T[];

  const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/${path}`);
  if (!resp.ok) {
    throw new GameDataFetchError(`${path} fetch failed: ${resp.status} ${resp.statusText}`, resp.status);
  }
  const json = await resp.json() as { data?: T[] } | T[];
  const list = Array.isArray(json) ? json : json.data;
  assertSessionCurrent(snapshot);
  if (!Array.isArray(list)) return [];
  if (list.length > 0) referenceCache.set(cacheKey, JSON.stringify(list));
  return list;
}

/**
 * A tool's `source` param, resolved before any catalog request so an unknown
 * book is reported even when D&D Beyond is down: undefined when none was
 * given, the unknown-source message when it names no book. Without a source
 * no index is fetched here, so the no-source path's requests are unchanged.
 */
async function resolveSourceParam(source: string | undefined): Promise<ResolvedSource | string | undefined> {
  if (!source) return undefined;
  const index = await getSourceIndex();
  return resolveSource(index, source) ?? unknownSourceError(index, source, GENERIC_SOURCE_HINT);
}

/**
 * A flat search that listed nothing because the filters let through only the
 * other edition's twins (`hidden` > 0, so no `source`): the no-match text
 * under the search header, with the footer saying how to see them, instead of
 * an Open5e fallback.
 */
function hiddenOnlySection(header: string, noMatch: string, requested: RulesEdition, hidden: number): SearchSection {
  return { header, body: noMatch, footer: searchFooter(requested, hidden), hidden };
}

// ── HTML strip — imported from src/utils.ts ───────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CONDITIONS
// ─────────────────────────────────────────────────────────────────────────────

interface Condition {
  name: string;
  description: string;
  effects: string[];
}

const CONDITIONS: Record<string, Condition> = {
  blinded: {
    name: "Blinded",
    description: "A blinded creature can't see and automatically fails any ability check that requires sight.",
    effects: [
      "Attack rolls against the creature have advantage.",
      "The creature's attack rolls have disadvantage.",
    ],
  },
  charmed: {
    name: "Charmed",
    description: "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects.",
    effects: [
      "The charmer has advantage on any ability check to interact socially with the creature.",
    ],
  },
  deafened: {
    name: "Deafened",
    description: "A deafened creature can't hear and automatically fails any ability check that requires hearing.",
    effects: [],
  },
  exhaustion: {
    name: "Exhaustion",
    description: "Exhaustion is measured in six levels. An effect can give a creature one or more levels of exhaustion.",
    effects: [
      "Level 1: Disadvantage on ability checks",
      "Level 2: Speed halved",
      "Level 3: Disadvantage on attack rolls and saving throws",
      "Level 4: Hit point maximum halved",
      "Level 5: Speed reduced to 0",
      "Level 6: Death",
    ],
  },
  frightened: {
    name: "Frightened",
    description: "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.",
    effects: [
      "The creature can't willingly move closer to the source of its fear.",
    ],
  },
  grappled: {
    name: "Grappled",
    description: "A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.",
    effects: [
      "The condition ends if the grappler is incapacitated.",
      "The condition ends if an effect removes the grappled creature from the reach of the grappler.",
    ],
  },
  incapacitated: {
    name: "Incapacitated",
    description: "An incapacitated creature can't take actions or reactions.",
    effects: [],
  },
  invisible: {
    name: "Invisible",
    description: "An invisible creature is impossible to see without the aid of magic or a special sense.",
    effects: [
      "Attack rolls against the creature have disadvantage.",
      "The creature's attack rolls have advantage.",
      "The creature can always try to hide.",
    ],
  },
  paralyzed: {
    name: "Paralyzed",
    description: "A paralyzed creature is incapacitated and can't move or speak.",
    effects: [
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
      "Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
    ],
  },
  petrified: {
    name: "Petrified",
    description: "A petrified creature is transformed into a solid inanimate substance. It ceases aging.",
    effects: [
      "The creature is incapacitated, can't move or speak, and is unaware of its surroundings.",
      "Attack rolls against the creature have advantage.",
      "The creature automatically fails Strength and Dexterity saving throws.",
      "The creature has resistance to all damage.",
      "The creature is immune to poison and disease.",
    ],
  },
  poisoned: {
    name: "Poisoned",
    description: "A poisoned creature has disadvantage on attack rolls and ability checks.",
    effects: [],
  },
  prone: {
    name: "Prone",
    description: "A prone creature's only movement option is to crawl, unless it stands up and thereby ends the condition.",
    effects: [
      "The creature has disadvantage on attack rolls.",
      "Attack rolls against the creature have advantage if the attacker is within 5 feet; otherwise disadvantage.",
    ],
  },
  restrained: {
    name: "Restrained",
    description: "A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed.",
    effects: [
      "Attack rolls against the creature have advantage.",
      "The creature's attack rolls have disadvantage.",
      "The creature has disadvantage on Dexterity saving throws.",
    ],
  },
  stunned: {
    name: "Stunned",
    description: "A stunned creature is incapacitated, can't move, and can speak only falteringly.",
    effects: [
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
    ],
  },
  unconscious: {
    name: "Unconscious",
    description: "An unconscious creature is incapacitated, can't move or speak, and is unaware of its surroundings.",
    effects: [
      "The creature drops whatever it's holding and falls prone.",
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
      "Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
    ],
  },
};

export function getCondition(conditionName: string): string {
  const key = conditionName.toLowerCase().trim();

  // Exact key match
  let condition = CONDITIONS[key];

  // Partial name match
  if (!condition) {
    condition = Object.values(CONDITIONS).find(c =>
      c.name.toLowerCase().includes(key)
    ) ?? undefined as unknown as Condition;
  }

  if (!condition) {
    const available = Object.values(CONDITIONS).map(c => c.name).join(", ");
    return `Condition "${conditionName}" not found.\n\nAvailable conditions: ${available}`;
  }

  const lines = [`**${condition.name}**\n`, condition.description];
  if (condition.effects.length > 0) {
    lines.push("");
    for (const effect of condition.effects) {
      lines.push(`• ${effect}`);
    }
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SPELLS
// ─────────────────────────────────────────────────────────────────────────────

const SPELLCASTING_CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8]; // Bard, Cleric, Druid, Paladin, Ranger, Sorcerer, Warlock, Wizard

let spellStore: SpellStore | null = null;

// Provenance of the currently-loaded compendium. "ddb-authoritative" means all
// 16 DDB game-data requests succeeded; "ddb-partial" means at least one failed
// and the result is missing content (commonly happens when the cobalt token is
// rejected for some endpoints but not others, or DDB is mid-deploy).
export type CompendiumSource = "ddb-authoritative" | "ddb-partial";
let compendiumSource: CompendiumSource | null = null;

interface CachedCompendium {
  source: CompendiumSource;
  spells: DdbSpell[];
}

/** Return the provenance of the currently-loaded spell compendium, or null if not loaded. */
export function getCompendiumSource(): CompendiumSource | null {
  return compendiumSource;
}

/**
 * Wipe the spell/items/reference cache and ALL in-memory compendium state.
 *
 * This clears `characterSpellBuffer` and `itemCompendium` in addition to the
 * reference cache + spell compendium. TEMPORARY: the buffer reset here exists
 * only because `characterSpellBuffer` is module-level mutable state seeded from
 * a specific character's JSON. When the future stateless compendium design
 * removes the buffer, delete its reset from this function (and from the
 * invalidation hook below).
 */
export function clearReferenceCache(): void {
  referenceCache.clear();
  spellStore = null;
  compendiumSource = null;
  characterSpellBuffer.clear();
  itemCompendium = null;
}

// Retire all account-derived compendium state on every session transition
// (logout, account replacement, revoke). The item compendium and the
// character-seeded spell buffer are account-scoped (game-data endpoints are
// gated by the cobalt token / character JSON), so they must not survive into a
// new generation. Registered once per module lifetime.
onSessionInvalidated(() => {
  clearReferenceCache();
});

// Spells extracted from character JSON (Warlock invocations, racial cantrip
// grants, etc.) that may not appear in the per-class game-data spell lists.
// Keyed by definition id, so both editions of a name can sit in it.
const characterSpellBuffer = new Map<number, DdbSpell>();

async function loadSpellCompendium(): Promise<SpellStore> {
  // Observe the on-disk authority BEFORE any early singleton/cache return, so a
  // pending logout/replacement fires the invalidation hook (which clears the
  // compendium + reference cache) before we hand back stale account state. Also
  // binds the whole parallel build to one generation.
  const snapshot = captureSession();

  if (spellStore) return spellStore;

  const cached = referenceCache.get("spell-compendium-v2");
  if (cached) {
    const parsed = JSON.parse(cached) as CachedCompendium;
    const store = createSpellStore();
    addSpells(store, parsed.spells);
    spellStore = store;
    compendiumSource = parsed.source;
    return store;
  }

  let failedTasks = 0;

  // Two requests per spellcasting class, both at classLevel=20:
  //
  //   /game-data/spells             — known casters (Bard, Ranger, Sorcerer,
  //                                   Warlock, Wizard): cantrips + leveled.
  //                                   Prepared casters (Cleric, Druid,
  //                                   Paladin): cantrips ONLY.
  //   /game-data/always-known-spells — every class: leveled spells, never
  //                                   cantrips. The only source of Cleric,
  //                                   Druid and Paladin leveled spells.
  //
  // Neither endpoint alone is complete. Querying only /spells (2.8.0–2.10.x)
  // silently dropped every leveled Cleric/Druid/Paladin spell; querying only
  // always-known/always-prepared (pre-2.8) dropped every cantrip. Both were
  // HTTP 200 throughout, so provenance looked authoritative.
  const SPELL_LIST_ENDPOINTS = ["spells", "always-known-spells"] as const;
  const tasks = SPELL_LIST_ENDPOINTS.flatMap(endpoint =>
    SPELLCASTING_CLASS_IDS.map(classId => ({ endpoint, classId })),
  );
  const lists = await Promise.all(tasks.map(async ({ endpoint, classId }): Promise<DdbSpell[]> => {
    try {
      const url = `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=20&sharingSetting=2`;
      const resp = await refFetch(url);
      if (!resp.ok) {
        failedTasks++;
        return [];
      }
      const json = await resp.json() as { data?: DdbSpell[] } | DdbSpell[];
      return (Array.isArray(json) ? json : json.data) ?? [];
    } catch (e) {
      // A session transition mid-build is NOT an ordinary failed class lookup:
      // abandon the entire build so no old-account (or mixed) class list is
      // merged into a new-account compendium. Rethrow to reject Promise.all.
      if (e instanceof SessionChangedError) throw e;
      // Otherwise continue — a partial compendium is still useful.
      failedTasks++;
      return [];
    }
  }));

  // Even if every individual request succeeded, the account may have changed
  // during an async body parse. Refuse to merge or cache a compendium
  // assembled across a generation boundary.
  assertSessionCurrent(snapshot);

  // Merge in task order (not response-completion order) so the same responses
  // always produce the same compendium. Keyed by definition id (first wins), so
  // a 2014 and a 2024 spell of one name both survive.
  const store = createSpellStore();
  for (const spells of lists) addSpells(store, spells);

  if (store.byId.size === 0) {
    // Deliberately don't cache this case — the catch in searchSpells/getSpell
    // falls through to per-call Open5e, and the next call retries DDB fresh.
    throw new Error(
      "Failed to load spell compendium — all D&D Beyond requests failed. " +
      "Run ddb_login if your session has expired. Falling back to SRD content for this call."
    );
  }

  // Merge character-sourced spells (Warlock-style invocations, racial cantrip
  // grants, etc.). The per-class game-data lists cover the canonical class
  // spell lists; characterSpellBuffer fills in anything else a character knows.
  addSpells(store, characterSpellBuffer.values());

  spellStore = store;
  // If any DDB task failed, the compendium is missing one or more class spell
  // lists. Short-TTL so the build is retried after ~5 min instead of being
  // locked stale for 24 h.
  compendiumSource = failedTasks === 0 ? "ddb-authoritative" : "ddb-partial";
  const ttl = compendiumSource === "ddb-authoritative" ? AUTHORITATIVE_TTL_MS : FALLBACK_TTL_MS;
  const cacheValue: CachedCompendium = { source: compendiumSource, spells: spellList(store) };
  referenceCache.set("spell-compendium-v2", JSON.stringify(cacheValue), ttl);
  return store;
}

/**
 * Supplements the spell compendium with spells from a parsed character's
 * classSpells array. Captures cantrips and chosen spells absent from the
 * per-class game-data spell lists. Called from parseCharacterData().
 */
export function addCharacterSpellsToCompendium(char: Record<string, unknown>): void {
  const arrOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const objOf = (v: unknown): Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};

  const added: DdbSpell[] = [];
  for (const cs of arrOf<Record<string, unknown>>(char.classSpells)) {
    for (const spell of arrOf<Record<string, unknown>>(cs.spells)) {
      const id = objOf(spell.definition).id;
      if (typeof id === "number" && Number.isFinite(id) && !characterSpellBuffer.has(id)) {
        characterSpellBuffer.set(id, spell as unknown as DdbSpell);
        added.push(spell as unknown as DdbSpell);
      }
    }
  }

  // Merge immediately into the live compendium if already loaded
  if (added.length && spellStore) {
    addSpells(spellStore, added);
    // Preserve provenance and use the matching TTL. If we somehow re-merge
    // before the source was set (unlikely — the compendium can't be loaded
    // without going through loadSpellCompendium), default to "ddb-partial"
    // / short TTL to err on the side of retrying sooner.
    const source = compendiumSource ?? "ddb-partial";
    const ttl = source === "ddb-authoritative" ? AUTHORITATIVE_TTL_MS : FALLBACK_TTL_MS;
    const cacheValue: CachedCompendium = { source, spells: spellList(spellStore) };
    referenceCache.set("spell-compendium-v2", JSON.stringify(cacheValue), ttl);
  }
}

/**
 * Whether a spell definition needs concentration; null if unknown.
 * Precedence: (1) the definition's own boolean; (2) the same definition id in
 * the character buffer or the compendium; (3) the entry of the definition's
 * twin group for its own edition (2024 when its edition isn't stated);
 * (4) null. Call after addCharacterSpellsToCompendium() has run.
 */
export function isConcentrationSpell(def: Record<string, unknown>): boolean | null {
  if (typeof def.concentration === "boolean") return def.concentration;

  const concOf = (spell: DdbSpell | undefined): boolean | null => {
    const c = spell?.definition?.concentration;
    return typeof c === "boolean" ? c : null;
  };

  if (typeof def.id === "number") {
    const byId = characterSpellBuffer.get(def.id) ?? spellStore?.byId.get(def.id);
    if (byId) return concOf(byId);
  }

  if (typeof def.name === "string" && def.name !== "") {
    const key = twinName(def.name);
    const group = new Map<number, DdbSpell>();
    for (const id of spellStore?.byTwin.get(key) ?? []) {
      const spell = spellStore?.byId.get(id);
      if (spell) group.set(id, spell);
    }
    for (const [id, spell] of characterSpellBuffer) {
      if (!group.has(id) && twinName(spell.definition?.name ?? "") === key) group.set(id, spell);
    }
    if (group.size > 0) {
      const index = peekSourceIndex();
      const own = classifyEdition(def as Parameters<typeof classifyEdition>[0], index).ruleset;
      const picked = selectByEdition(
        [...group.values()],
        isEdition(own) ? own : "2024",
        c => classifyEdition(c.definition, index),
        (a, b) => definitionTiebreak(a.definition, b.definition),
      );
      return concOf(picked?.entry);
    }
  }
  return null;
}

/** `rulesLines` (from lookupCatalog) go directly under the title. */
function formatSpell(spell: DdbSpell, rulesLines: string[]): string {
  const d = spell.definition;
  const ACTIVATION_TYPES: Record<number, string> = {
    1: "Action", 3: "Bonus Action", 6: "Reaction",
  };
  const levelLabel = d.level === 0 ? "Cantrip" : `Level ${d.level}`;
  const castingTime = d.activation
    ? `${d.activation.activationTime} ${ACTIVATION_TYPES[d.activation.activationType] ?? "Action"}`
    : "1 Action";

  let range = "Self";
  if (d.range) {
    if (d.range.rangeValue && d.range.origin !== "Self") range = `${d.range.rangeValue} ft`;
    else range = d.range.origin;
    if (d.range.aoeType && d.range.aoeValue) range += ` (${d.range.aoeValue}-ft ${d.range.aoeType})`;
  }

  let duration = "Instantaneous";
  if (d.duration) {
    const isConc = d.duration.durationType === "Concentration";
    if (d.duration.durationInterval && d.duration.durationUnit) {
      duration = `${isConc ? "Concentration, up to " : ""}${d.duration.durationInterval} ${d.duration.durationUnit}${Number(d.duration.durationInterval) > 1 ? "s" : ""}`;
    } else if (isConc) {
      duration = "Concentration";
    }
  }

  const components = (d.components ?? [])
    .map((c: number) => ({ 1: "V", 2: "S", 3: "M" })[c])
    .filter(Boolean).join(", ");
  const matNote = d.componentsDescription ? ` (${d.componentsDescription})` : "";

  const tags: string[] = [];
  if (d.concentration) tags.push("Concentration");
  if (d.ritual) tags.push("Ritual");
  const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";

  const lines = [
    `**${d.name}** — ${levelLabel} ${d.school}${tagStr}`,
    ...rulesLines,
    `Casting Time: ${castingTime}`,
    `Range: ${range}`,
    `Components: ${components || "None"}${matNote}`,
    `Duration: ${duration}`,
    "",
    stripHtml(d.description),
  ];
  return lines.join("\n");
}

/** The spell catalog: classified by the definition, twinned by name, listed by level then name. */
const SPELL_ADAPTER: CatalogAdapter<DdbSpell> & { name: (s: DdbSpell) => string } = {
  markers: s => s.definition,
  twinKey: s => twinName(s.definition.name),
  tiebreak: (a, b) => definitionTiebreak(a.definition, b.definition),
  compare: (a, b) => {
    const da = a.definition, db = b.definition;
    if (da.level !== db.level) return da.level - db.level;
    return da.name.localeCompare(db.name);
  },
  name: s => s.definition.name,
};

export interface SpellSearchParams {
  name?: string;
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  limit?: number;
  offset?: number;
  rulesEdition?: RulesEdition;
  /** A book: slug, short name or title. Lists that book's spells of either edition. */
  source?: string;
  /** See SelectOptions.bookNotes. */
  bookNotes?: boolean;
}

export async function searchSpells(params: SpellSearchParams): Promise<string> {
  return renderSection(await searchSpellsSection(params));
}

export async function searchSpellsSection(params: SpellSearchParams): Promise<SearchSection> {
  const source = await resolveSourceParam(params.source);
  if (typeof source === "string") return plainSection(source);
  try {
    const requested = params.rulesEdition ?? "2024";
    const store = await loadSpellCompendium();
    const index = await getSourceIndex();
    const nameQuery = params.name ? normalizeName(params.name) : "";
    const schoolQuery = params.school?.toLowerCase();

    const { hits, hidden, header, note } = selectCatalog(spellList(store), requested, {
      ...SPELL_ADAPTER,
      nameMatches: nameQuery ? s => normalizeName(s.definition.name).includes(nameQuery) : undefined,
      passes: s => {
        const d = s.definition;
        return (params.level === undefined || d.level === params.level)
          && (!schoolQuery || d.school.toLowerCase().includes(schoolQuery))
          && (params.concentration === undefined || d.concentration === params.concentration)
          && (params.ritual === undefined || d.ritual === params.ritual);
      },
    }, index, source, { bookNotes: params.bookNotes });

    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    if (hits.length === 0 && hidden > 0) {
      return hiddenOnlySection(header, "No spells found matching the criteria.", requested, hidden);
    }
    // An offset past the end is "none found" too, not an empty heading.
    if (hits.slice(offset, offset + limit).length === 0) {
      return plainSection(source
        ? `No spells found matching the criteria in ${source.book}.`
        : "No spells found matching the criteria.");
    }

    // When the compendium build was incomplete (one or more class-list
    // requests failed), tell the caller so they can re-run `ddb_login` and
    // `ddb_clear_cache` to retry.
    const provenanceNote = compendiumSource === "ddb-partial"
      ? "\n> ⚠ Compendium build was incomplete — one or more class spell-list requests to D&D Beyond failed, so spells from those classes may be missing. If you've just re-logged in, run `ddb_clear_cache` to retry.\n"
      : "";

    const results = paginateResults("Spell", hits, hit => {
      const d = hit.entry.definition;
      const level = d.level === 0 ? "Cantrip" : `Level ${d.level}`;
      const tags: string[] = [];
      if (d.concentration) tags.push("Conc.");
      if (d.ritual) tags.push("Ritual");
      const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
      return `- **${d.name}** ${hit.label} — ${level} ${d.school}${tagStr}`;
    }, limit, offset, provenanceNote);
    return {
      header,
      body: note ? `${note}\n${results}` : results,
      footer: searchFooter(requested, hidden),
      hidden,
    };
  } catch (err) {
    try {
      return plainSection(withSourceCaveat(await o5SearchSpells(params, "unavailable"), params.source));
    } catch {
      throw err;
    }
  }
}

export async function getSpell(spellName: string, rulesEdition: RulesEdition = "2024", source?: string): Promise<string> {
  const resolved = await resolveSourceParam(source);
  if (typeof resolved === "string") return resolved;
  try {
    const store = await loadSpellCompendium();
    const index = await getSourceIndex();
    const found = lookupCatalog(spellList(store), spellName, rulesEdition, SPELL_ADAPTER, index, resolved);

    if (!found) {
      // A book the caller asked for is never swapped for SRD content.
      if (resolved) return `Spell "${spellName}" not found in ${resolved.book}.`;
      const o5Result = await o5GetSpell(spellName, rulesEdition, "not-found").catch(() => null);
      if (o5Result) return o5Result;
      return `Spell "${spellName}" not found in the compendium. Try ddb_search_spells with a partial name.`;
    }

    return formatSpell(found.entry, found.rulesLines);
  } catch (err) {
    try {
      const o5Result = await o5GetSpell(spellName, rulesEdition, "unavailable");
      if (o5Result) return withSourceCaveat(o5Result, source);
    } catch {
      // fall through
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEMS
// ─────────────────────────────────────────────────────────────────────────────

interface DdbItem {
  id: number;
  name: string;
  type: string;
  filterType: string;
  rarity: string;
  requiresAttunement: boolean;
  attunementDescription: string;
  description: string;
  snippet: string;
  weight: number;
  // Weapon fields
  damage: { diceString: string } | null;
  damageType?: string | null;              // "Slashing", "Piercing", "Bludgeoning", etc.
  range?: number | null;
  longRange?: number | null;
  properties: Array<{ id: number; name: string; notes: string | null }> | null;
  // Armour fields
  armorClass: number | null;
  strengthRequirement?: number | null;
  stealthCheck?: number | null;           // 2 = stealth disadvantage, null = no penalty
  magic: boolean;
  // Edition markers
  isLegacy?: boolean | null;
  isHomebrew?: boolean | null;
  sources?: Array<{ sourceId: number }> | null;
}

let itemCompendium: DdbItem[] | null = null;

async function loadItemCompendium(): Promise<DdbItem[]> {
  // Boundary check before the early singleton/cache return (see loadSpellCompendium).
  const snapshot = captureSession();

  if (itemCompendium) return itemCompendium;

  const cached = referenceCache.get("item-compendium");
  if (cached) {
    itemCompendium = dedupeById(JSON.parse(cached) as DdbItem[]);
    return itemCompendium;
  }

  const url = `${CHARACTER_SERVICE}/character/v5/game-data/items?sharingSetting=2`;
  const resp = await refFetch(url);
  if (!resp.ok) throw new Error(`Item compendium fetch failed: ${resp.status} ${resp.statusText}`);

  const json = await resp.json() as { data?: DdbItem[] } | DdbItem[];
  const items = dedupeById((Array.isArray(json) ? json : json.data) ?? []);

  // Don't cache one account's item list into another account's generation.
  assertSessionCurrent(snapshot);
  itemCompendium = items;
  referenceCache.set("item-compendium", JSON.stringify(items));
  return items;
}

/** `rulesLines` (from lookupCatalog) go directly under the title. */
function formatItem(item: DdbItem, rulesLines: string[]): string {
  const type = item.filterType || item.type || "Item";
  const rarity = item.rarity || "Common";
  const lines = [`**${item.name}** — ${type}, ${rarity}`, ...rulesLines];

  if (item.requiresAttunement) {
    lines.push(`Requires Attunement${item.attunementDescription ? ": " + item.attunementDescription : ""}`);
  }
  if (item.weight) lines.push(`Weight: ${item.weight} lb.`);

  if (item.armorClass) {
    let acLine = `AC: ${item.armorClass}`;
    if (item.strengthRequirement) acLine += ` | Requires STR ${item.strengthRequirement}`;
    if (item.stealthCheck) acLine += ` | Stealth disadvantage`;
    lines.push(acLine);
  }

  if (item.damage?.diceString) {
    const versatileNotes = item.properties?.find(p => p.name === "Versatile")?.notes;
    const typeStr = item.damageType ? ` ${item.damageType.toLowerCase()}` : "";
    let dmgLine = `Damage: ${item.damage.diceString}${typeStr}`;
    if (versatileNotes) dmgLine += ` (${versatileNotes} two-handed)`;
    lines.push(dmgLine);
  }
  // Suppress melee range (5/5) — implied. Show ranged weapons only (longRange > range).
  if (item.range != null && item.longRange != null && item.longRange > item.range) {
    lines.push(`Range: ${item.range}/${item.longRange} ft.`);
  } else if (item.range != null && item.longRange == null && item.range > 5) {
    lines.push(`Range: ${item.range} ft.`);
  }

  if (item.properties?.length) {
    lines.push(`Properties: ${item.properties.map(p => p.name).join(", ")}`);
  }
  lines.push("", stripHtml(item.description || item.snippet || "No description available."));
  return lines.join("\n");
}

/** The item catalog: classified by the item, twinned by name, listed by name. */
const ITEM_ADAPTER: CatalogAdapter<DdbItem> & { name: (i: DdbItem) => string } = {
  markers: i => i,
  twinKey: i => twinName(i.name),
  tiebreak: definitionTiebreak,
  compare: (a, b) => a.name.localeCompare(b.name),
  name: i => i.name,
};

export interface ItemSearchParams {
  name?: string;
  rarity?: string;
  type?: string;
  rulesEdition?: RulesEdition;
  /** A book: slug, short name or title. Lists that book's items of either edition. */
  source?: string;
  /** See SelectOptions.bookNotes. */
  bookNotes?: boolean;
}

export async function searchItems(params: ItemSearchParams): Promise<string> {
  return renderSection(await searchItemsSection(params));
}

export async function searchItemsSection(params: ItemSearchParams): Promise<SearchSection> {
  const nameQuery = params.name ? normalizeName(params.name) : "";
  const rarityQuery = params.rarity?.toLowerCase();
  const typeQuery = params.type?.toLowerCase();
  return searchCatalogList<DdbItem>(params, {
    load: loadItemCompendium,
    plural: "items",
    adapter: {
      ...ITEM_ADAPTER,
      nameMatches: nameQuery ? i => normalizeName(i.name).includes(nameQuery) : undefined,
      passes: i => (!rarityQuery || !!i.rarity?.toLowerCase().includes(rarityQuery))
        && (!typeQuery || !!i.type?.toLowerCase().includes(typeQuery) || !!i.filterType?.toLowerCase().includes(typeQuery)),
    },
    // No paging: the first 30, then a hint to refine.
    render: hits => {
      const total = hits.length;
      const lines = [`**Item Search** (${total > 30 ? `showing 30 of ${total}` : `${total} found`})\n`];
      for (const { entry: item, label } of hits.slice(0, 30)) {
        const rarity = item.rarity || "Common";
        const type = item.filterType || item.type || "Item";
        const attune = item.requiresAttunement ? " (attunement)" : "";
        lines.push(`- **${item.name}** ${label} — ${rarity} ${type}${attune}`);
      }
      if (total > 30) lines.push(`\n*Refine your search to see more results.*`);
      return lines.join("\n");
    },
    notFound: "No items found matching the criteria.",
    fallback: kind => o5SearchItems(params, kind),
    // No `unavailable`: when Open5e fails too, the compendium's own error is thrown.
  });
}

export async function getItem(itemName: string, rulesEdition: RulesEdition = "2024", source?: string): Promise<string> {
  const resolved = await resolveSourceParam(source);
  if (typeof resolved === "string") return resolved;
  try {
    const items = await loadItemCompendium();
    const index = await getSourceIndex();
    const found = lookupCatalog(items, itemName, rulesEdition, ITEM_ADAPTER, index, resolved);

    if (!found) {
      // A book the caller asked for is never swapped for SRD content.
      if (resolved) return `Item "${itemName}" not found in ${resolved.book}.`;
      const result = await o5GetEquipment(itemName, rulesEdition, "not-found").catch(() => null);
      if (result) return result;
      return `Item "${itemName}" not found. Try ddb_search_equipment with a partial name.`;
    }

    return formatItem(found.entry, found.rulesLines);
  } catch (err) {
    try {
      const result = await o5GetEquipment(itemName, rulesEdition, "unavailable");
      if (result) return withSourceCaveat(result, source);
    } catch { /* fall through to the compendium's error */ }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPENDIUM TOOLS — races, classes, backgrounds, feats, features, traits
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared option-list search ─────────────────────────────────────────────────

interface OptionSearchParams {
  name?: string;
  limit?: number;
  offset?: number;
  rulesEdition?: RulesEdition;
  /** A book: slug, short name or title. Lists that book's entries of either edition. */
  source?: string;
  /** See SelectOptions.bookNotes. */
  bookNotes?: boolean;
}

/**
 * The search flow items, species, classes, backgrounds and feats share:
 * resolve `source`; load and choose editions through selectCatalog (a failure
 * falls back to Open5e, with the source caveat); with no hits, the book's
 * no-match line, a hidden-only section, else Open5e; otherwise the rendered
 * hits under the header, the source note first. `plural` names the entries in
 * messages; `notFound` is the no-match text when Open5e fails.
 */
async function searchCatalogList<T>(
  params: { source?: string; rulesEdition?: RulesEdition; bookNotes?: boolean },
  spec: {
    load: () => Promise<T[]>;
    plural: string;
    adapter: CatalogAdapter<T>;
    render: (hits: CatalogHit<T>[]) => string;
    notFound: string;
    fallback: (kind: "not-found" | "unavailable") => Promise<string>;
    /** The reply when the load and Open5e both fail; omitted, the load error is rethrown. */
    unavailable?: string;
  },
): Promise<SearchSection> {
  const source = await resolveSourceParam(params.source);
  if (typeof source === "string") return plainSection(source);
  const requested = params.rulesEdition ?? "2024";

  let selection;
  try {
    const all = await spec.load();
    const index = await getSourceIndex();
    selection = selectCatalog(all, requested, spec.adapter, index, source, { bookNotes: params.bookNotes });
  } catch (err) {
    let text: string;
    try {
      text = await spec.fallback("unavailable");
    } catch {
      if (spec.unavailable === undefined) throw err;
      text = spec.unavailable;
    }
    return plainSection(withSourceCaveat(text, params.source));
  }

  const { hits, hidden, header, note } = selection;
  if (hits.length === 0) {
    if (source) return plainSection(`No ${spec.plural} found matching the criteria in ${source.book}.`);
    if (hidden > 0) return hiddenOnlySection(header, `No ${spec.plural} found matching the criteria.`, requested, hidden);
    return plainSection(await spec.fallback("not-found").catch(() => spec.notFound));
  }

  const results = spec.render(hits);
  return {
    header,
    body: note ? `${note}\n${results}` : results,
    footer: searchFooter(requested, hidden),
    hidden,
  };
}

/**
 * Species, classes, backgrounds and feats: searchCatalogList over a game-data
 * list, paged. `heading` titles the page; `fallback` is the Open5e search.
 */
async function searchOptionList<T>(
  params: OptionSearchParams,
  spec: {
    cacheKey: string;
    path: string;
    plural: string;
    heading: string;
    defaultLimit: number;
    adapter: CatalogAdapter<T>;
    /** Entries dropped before selection. */
    usable?: (t: T) => boolean;
    passes?: (t: T) => boolean;
    format: (hit: { entry: T; label: string }) => string;
    /** The text for "no match" (Open5e fallback first). */
    notFound: string;
    fallback: (kind: "not-found" | "unavailable") => Promise<string>;
  },
): Promise<SearchSection> {
  return searchCatalogList<T>(params, {
    load: async () => {
      const loaded = await loadGameDataList<T>(spec.cacheKey, spec.path);
      return spec.usable ? loaded.filter(spec.usable) : loaded;
    },
    plural: spec.plural,
    adapter: { ...spec.adapter, passes: spec.passes },
    render: hits => paginateResults(spec.heading, hits, spec.format, params.limit ?? spec.defaultLimit, params.offset ?? 0),
    notFound: spec.notFound,
    fallback: spec.fallback,
    unavailable: `${spec.plural[0].toUpperCase()}${spec.plural.slice(1)} unavailable — DnD Beyond and Open5e both failed.`,
  });
}

/** `nameMatches` for an adapter: the display name contains the query; none without a query. */
function nameFilter<T>(name: string | undefined, displayName: (t: T) => string): ((t: T) => boolean) | undefined {
  const query = name ? normalizeName(name) : "";
  return query ? t => normalizeName(displayName(t)).includes(query) : undefined;
}

function clip(text: string | null | undefined, max: number): string {
  const desc = stripHtml(text || "").slice(0, max);
  return desc ? `${desc}${desc.length >= max ? "..." : ""}` : "";
}

// ── Races ─────────────────────────────────────────────────────────────────────

interface DdbRace {
  entityRaceId: number;
  entityRaceTypeId: number;
  fullName: string;
  baseName: string;
  baseRaceName: string;
  description: string;
  isHomebrew: boolean;
  isLegacy: boolean;
  isSubRace: boolean;
  size: string;
  sources: Array<{ sourceId: number }>;
}

const raceName = (r: DdbRace) => r.fullName || r.baseName;

/**
 * The species catalog: classified by the race, twinned by name, and edition-
 * grouped by base race (nested mode), so the 2024 Elf replaces the 2014 High
 * Elf and Wood Elf by default.
 */
const RACE_ADAPTER: CatalogAdapter<DdbRace> = {
  markers: r => r,
  twinKey: r => twinName(raceName(r)),
  groupKey: r => twinName(r.baseRaceName || r.baseName || raceName(r)),
  tiebreak: (a, b) => definitionTiebreak(
    { id: a.entityRaceId, isHomebrew: a.isHomebrew, isLegacy: a.isLegacy },
    { id: b.entityRaceId, isHomebrew: b.isHomebrew, isLegacy: b.isLegacy },
  ),
  compare: (a, b) => raceName(a).localeCompare(raceName(b)),
};

export type RaceSearchParams = OptionSearchParams;

export async function searchRaces(params: RaceSearchParams = {}): Promise<string> {
  return renderSection(await searchRacesSection(params));
}

export async function searchRacesSection(params: RaceSearchParams = {}): Promise<SearchSection> {
  return searchOptionList<DdbRace>(params, {
    cacheKey: "game-data:races",
    path: "races",
    plural: "races",
    heading: "Race",
    defaultLimit: 30,
    adapter: { ...RACE_ADAPTER, nameMatches: nameFilter(params.name, raceName) },
    usable: r => !!(r.fullName || r.baseName),
    format: ({ entry: race, label }) => {
      const desc = clip(race.description, 100);
      return `- **${raceName(race)}** ${label}${race.isSubRace ? " *(Subrace)*" : ""}${desc ? ` — ${desc}` : ""}`;
    },
    notFound: `No races found matching "${params.name}".`,
    fallback: kind => o5SearchRaces({ name: params.name, rulesEdition: params.rulesEdition }, kind),
  });
}

// ── Classes ───────────────────────────────────────────────────────────────────

const SPELLCASTING_ABILITY: Record<number, string> = {
  1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA",
};

interface DdbClass {
  id: number;
  name: string;
  description: string;
  hitDice: number;
  isHomebrew: boolean;
  isLegacy?: boolean;
  spellCastingAbilityId: number | null;
  sources: Array<{ sourceId: number }>;
}

const CLASS_ADAPTER: CatalogAdapter<DdbClass> = {
  markers: c => c,
  twinKey: c => twinName(c.name),
  tiebreak: definitionTiebreak,
  compare: (a, b) => a.name.localeCompare(b.name),
};

export type ClassSearchParams = OptionSearchParams;

export async function searchClasses(params: ClassSearchParams = {}): Promise<string> {
  return renderSection(await searchClassesSection(params));
}

export async function searchClassesSection(params: ClassSearchParams = {}): Promise<SearchSection> {
  return searchOptionList<DdbClass>(params, {
    cacheKey: "game-data:classes",
    path: "classes",
    plural: "classes",
    heading: "Class",
    defaultLimit: 30,
    adapter: { ...CLASS_ADAPTER, nameMatches: nameFilter(params.name, c => c.name) },
    format: ({ entry: cls, label }) => {
      const hitDie = cls.hitDice ? `d${cls.hitDice}` : "?";
      const spellcasting = cls.spellCastingAbilityId
        ? ` | Spellcasting: ${SPELLCASTING_ABILITY[cls.spellCastingAbilityId] ?? "Yes"}`
        : "";
      const desc = clip(cls.description, 120);
      return `- **${cls.name}** ${label} — Hit Die: ${hitDie}${spellcasting}${desc ? `\n  ${desc}` : ""}`;
    },
    notFound: `No classes found matching "${params.name}".`,
    fallback: kind => o5SearchClasses({ name: params.name, rulesEdition: params.rulesEdition }, kind),
  });
}

// ── Backgrounds ───────────────────────────────────────────────────────────────

interface DdbBackground {
  id: number;
  name: string;
  description: string;
  isHomebrew: boolean;
  isLegacy?: boolean;
  sources: Array<{ sourceId: number }>;
}

const BACKGROUND_ADAPTER: CatalogAdapter<DdbBackground> = {
  markers: b => b,
  twinKey: b => twinName(b.name),
  tiebreak: definitionTiebreak,
  compare: (a, b) => a.name.localeCompare(b.name),
};

export type BackgroundSearchParams = OptionSearchParams;

export async function searchBackgrounds(params: BackgroundSearchParams = {}): Promise<string> {
  return renderSection(await searchBackgroundsSection(params));
}

export async function searchBackgroundsSection(params: BackgroundSearchParams = {}): Promise<SearchSection> {
  return searchOptionList<DdbBackground>(params, {
    cacheKey: "game-data:backgrounds",
    path: "backgrounds",
    plural: "backgrounds",
    heading: "Background",
    defaultLimit: 30,
    adapter: { ...BACKGROUND_ADAPTER, nameMatches: nameFilter(params.name, b => b.name) },
    format: ({ entry: bg, label }) => {
      const desc = clip(bg.description, 120);
      return `- **${bg.name}** ${label}${desc ? ` — ${desc}` : ""}`;
    },
    notFound: `No backgrounds found matching "${params.name}".`,
    fallback: kind => o5SearchBackgrounds({ name: params.name, rulesEdition: params.rulesEdition }, kind),
  });
}

// ── Feats ─────────────────────────────────────────────────────────────────────

interface DdbFeat {
  id: number;
  name: string;
  description: string;
  snippet: string;
  prerequisite: string | null;
  isHomebrew: boolean;
  isLegacy?: boolean;
  sources: Array<{ sourceId: number }>;
}

const FEAT_ADAPTER: CatalogAdapter<DdbFeat> = {
  markers: f => f,
  twinKey: f => twinName(f.name),
  tiebreak: definitionTiebreak,
  compare: (a, b) => a.name.localeCompare(b.name),
};

export interface FeatSearchParams extends OptionSearchParams { prerequisite?: string }

export async function searchFeats(params: FeatSearchParams = {}): Promise<string> {
  return renderSection(await searchFeatsSection(params));
}

export async function searchFeatsSection(params: FeatSearchParams = {}): Promise<SearchSection> {
  const prereqQuery = params.prerequisite?.toLowerCase();
  return searchOptionList<DdbFeat>(params, {
    cacheKey: "game-data:feats",
    path: "feats",
    plural: "feats",
    heading: "Feat",
    defaultLimit: 30,
    adapter: { ...FEAT_ADAPTER, nameMatches: nameFilter(params.name, f => f.name) },
    passes: prereqQuery ? f => !!f.prerequisite?.toLowerCase().includes(prereqQuery) : undefined,
    format: ({ entry: feat, label }) => {
      const prereq = feat.prerequisite ? ` *(Requires: ${feat.prerequisite})*` : "";
      const desc = clip(feat.snippet || feat.description, 100);
      return `- **${feat.name}** ${label}${prereq}${desc ? ` — ${desc}` : ""}`;
    },
    notFound: "No feats found matching the search criteria.",
    fallback: kind => o5SearchFeats({ name: params.name, rulesEdition: params.rulesEdition }, kind),
  });
}

// ── Class Features and Racial Traits ─────────────────────────────────────────
//
// The collection endpoints (/class-feature/collection, /racial-trait/collection)
// are the OPTIONAL-feature endpoints: they need classId / entityRaceId +
// entityRaceTypeId and return { definitionData, accessTypes }. Base features
// live inside /game-data/classes and /game-data/races, and subclass features
// behind /game-data/subclasses?baseClassId=N, so both searches are built from
// those payloads (see features-traits.ts) rather than from one collection call.

function unavailableError(label: string, what: string, status?: number): Error {
  const detail = status === undefined ? `: it returned no ${what}` : ` (HTTP ${status})`;
  return new Error(
    `${label} data is unavailable from D&D Beyond right now${detail}. Try again later, or run ddb_login if your session has expired.`,
  );
}

/** A collection counts only with the live `{ definitionData: [...] }` shape. */
function isOptionalCollection(data: unknown): data is OptionalCollection {
  return typeof data === "object" && data !== null && Array.isArray((data as OptionalCollection).definitionData);
}

const REQUEST_FAILED = Symbol("request-failed");

/**
 * GET a character-service game-data path and return the response's `data`
 * field, or REQUEST_FAILED (already counted) on a non-OK status or any
 * non-session error. Callers count a wrong shape themselves.
 */
async function fetchGameDataField(path: string, counter: { failed: number }): Promise<unknown> {
  try {
    const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/${path}`);
    if (!resp.ok) {
      counter.failed++;
      return REQUEST_FAILED;
    }
    const json = await resp.json() as { data?: unknown };
    return json?.data;
  } catch (e) {
    // A session transition is not an ordinary failed request: abandon the
    // whole build so no old-account (or mixed) list is merged into a new one.
    if (e instanceof SessionChangedError) throw e;
    counter.failed++;
    return REQUEST_FAILED;
  }
}

interface CachedBuild<T> { source: CompendiumSource; entries: T[] }

function readBuildCache<T>(key: string): CachedBuild<T> | null {
  const cached = referenceCache.get(key);
  return cached ? JSON.parse(cached) as CachedBuild<T> : null;
}

function writeBuildCache<T>(key: string, build: CachedBuild<T>): void {
  // A partial build is missing some lists; short TTL so it is retried soon.
  const ttl = build.source === "ddb-authoritative" ? AUTHORITATIVE_TTL_MS : FALLBACK_TTL_MS;
  referenceCache.set(key, JSON.stringify(build), ttl);
}

/** Wrap only a GameDataFetchError from the base list; everything else propagates. */
async function baseListOrUnavailable(cacheKey: string, path: string, label: string, what: string): Promise<unknown[]> {
  try {
    return await loadGameDataList<unknown>(cacheKey, path);
  } catch (e) {
    if (e instanceof GameDataFetchError) throw unavailableError(label, what, e.status);
    throw e;
  }
}

async function loadClassFeatures(): Promise<CachedBuild<ClassFeatureEntry>> {
  // Observe on-disk authority before the cache read (see loadSpellCompendium).
  const snapshot = captureSession();
  const hit = readBuildCache<ClassFeatureEntry>("class-features");
  if (hit) return hit;

  const classes = await baseListOrUnavailable("game-data:classes", "classes", "Class feature", "class features");
  if (classes.length === 0) throw unavailableError("Class feature", "class features");

  const counter = { failed: 0 };
  const classIds = classes
    .map((c) => (c as { id?: unknown }).id)
    .filter((id): id is number => typeof id === "number");
  const subclassesByClassId = new Map<number, unknown[]>();
  const optionalByClassId = new Map<number, OptionalCollection>();

  // Requests go out in base-list order; results land in maps keyed by id, so
  // response-completion order never changes the build.
  await Promise.all(classIds.flatMap((id) => [
    (async () => {
      const data = await fetchGameDataField(`subclasses?baseClassId=${id}`, counter);
      if (Array.isArray(data)) subclassesByClassId.set(id, data);
      else if (data !== REQUEST_FAILED) counter.failed++;
    })(),
    (async () => {
      const data = await fetchGameDataField(`class-feature/collection?classId=${id}`, counter);
      if (isOptionalCollection(data)) optionalByClassId.set(id, data);
      else if (data !== REQUEST_FAILED) counter.failed++;
    })(),
  ]));

  // The account may have changed during a body parse; refuse to build across it.
  assertSessionCurrent(snapshot);

  const entries = buildClassFeatures(classes, subclassesByClassId, optionalByClassId);
  if (entries.length === 0) throw unavailableError("Class feature", "class features");
  const build: CachedBuild<ClassFeatureEntry> = {
    source: counter.failed === 0 ? "ddb-authoritative" : "ddb-partial",
    entries,
  };
  writeBuildCache("class-features", build);
  return build;
}

const PARTIAL_NOTE_CLASS_FEATURES =
  "> ⚠ Some subclass or optional-feature lists failed to load from D&D Beyond, so results may be incomplete. Run `ddb_clear_cache` to retry.";
const PARTIAL_NOTE_RACIAL_TRAITS =
  "> ⚠ Some optional-trait lists failed to load from D&D Beyond, so results may be incomplete. Run `ddb_clear_cache` to retry.";

function describeCriteria(parts: Array<[string, string | number | undefined]>): string {
  return parts
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([label, v]) => (typeof v === "number" ? `${label} ${v}` : `${label} "${v}"`))
    .join(", ");
}

interface OwnedSearchParams {
  limit?: number;
  offset?: number;
  rulesEdition?: RulesEdition;
  /** A book: slug, short name or title. Lists that book's entries of either edition. */
  source?: string;
}

/**
 * Class features and racial traits share one search: load the build, choose
 * one edition per owner (class, class + subclass, species) through
 * selectCatalog's nested mode, then page and render. A failed load throws,
 * as before: neither has an Open5e path. With results, a partial build's
 * note is the first line under the header; a no-match reply is plain text.
 */
async function searchOwnedEntries<T>(
  params: OwnedSearchParams,
  spec: {
    load: () => Promise<CachedBuild<T>>;
    partialNote: string;
    heading: string;
    adapter: CatalogAdapter<T>;
    format: (entry: T, label: string) => string;
    /** The no-match message, given the build's size and the `source` book. */
    noMatch: (searched: number, book: string | undefined) => string;
  },
): Promise<SearchSection> {
  const source = await resolveSourceParam(params.source);
  if (typeof source === "string") return plainSection(source);
  const requested = params.rulesEdition ?? "2024";

  const build = await spec.load();
  const partial = build.source === "ddb-partial" ? `${spec.partialNote}\n\n` : "";
  const index = await getSourceIndex();
  const { hits, hidden, header, note } = selectCatalog(build.entries, requested, spec.adapter, index, source);
  if (hits.length === 0) return plainSection(partial + spec.noMatch(build.entries.length, source?.book));

  const results = paginateResults(
    spec.heading,
    hits,
    hit => spec.format(hit.entry, hit.label),
    params.limit ?? 30,
    params.offset ?? 0,
  );
  return {
    header,
    body: partial + (note ? `${note}\n` : "") + results,
    footer: searchFooter(requested, hidden),
    hidden,
  };
}

const classFeatureOwnerKey = (e: ClassFeatureEntry) =>
  classOwnerTwinKey(e.className, e.kind === "subclass" ? e.subclassName : null);

/**
 * Class features, picked per owner: the class (base and optional features) or
 * the class + subclass (subclass features). The owner's edition comes from its
 * own sources; each line is tagged by the feature's (an optional feature keeps its own).
 */
const CLASS_FEATURE_ADAPTER: CatalogAdapter<ClassFeatureEntry> = {
  markers: e => ({ sources: e.sources, isHomebrew: e.isHomebrew }),
  twinKey: classFeatureOwnerKey,
  groupKey: classFeatureOwnerKey,
  owner: e => ({
    id: e.kind === "subclass" ? `c${e.classId}/s${e.subclassId}` : `c${e.classId}`,
    markers: { sources: e.ownerSources, isHomebrew: e.isHomebrew },
    tiebreak: { id: e.subclassId ?? e.classId, isHomebrew: e.isHomebrew },
  }),
  tiebreak: definitionTiebreak,
  compare: compareClassFeatures,
};

export interface ClassFeatureSearchParams extends OwnedSearchParams {
  name?: string;
  className?: string;
  level?: number;
}

export async function searchClassFeatures(params: ClassFeatureSearchParams): Promise<string> {
  return renderSection(await searchClassFeaturesSection(params));
}

export async function searchClassFeaturesSection(params: ClassFeatureSearchParams): Promise<SearchSection> {
  return searchOwnedEntries(params, {
    load: loadClassFeatures,
    partialNote: PARTIAL_NOTE_CLASS_FEATURES,
    heading: "Class Feature",
    adapter: { ...CLASS_FEATURE_ADAPTER, ...classFeatureFilters(params) },
    format: formatClassFeatureLine,
    noMatch: (searched, book) => {
      const criteria = describeCriteria([["name", params.name], ["class", params.className], ["level", params.level]]);
      return `No class features found matching ${criteria || "the search criteria"}${book ? ` in ${book}` : ""} (searched ${searched} class features). D&D Beyond lists only the classes and subclasses available to your account.`;
    },
  });
}

async function loadRacialTraits(): Promise<CachedBuild<RacialTraitEntry>> {
  const snapshot = captureSession();
  const hit = readBuildCache<RacialTraitEntry>("racial-traits");
  if (hit) return hit;

  const races = await baseListOrUnavailable("game-data:races", "races", "Racial trait", "racial traits");
  if (races.length === 0) throw unavailableError("Racial trait", "racial traits");

  const counter = { failed: 0 };
  const optionalByRaceKey = new Map<string, OptionalCollection>();
  const raceRefs = races.filter((r): r is { entityRaceId: number; entityRaceTypeId: number } => {
    const x = r as { entityRaceId?: unknown; entityRaceTypeId?: unknown };
    return typeof x?.entityRaceId === "number" && typeof x?.entityRaceTypeId === "number";
  });

  await Promise.all(raceRefs.map(async (race) => {
    const data = await fetchGameDataField(
      `racial-trait/collection?entityRaceId=${race.entityRaceId}&entityRaceTypeId=${race.entityRaceTypeId}`,
      counter,
    );
    if (isOptionalCollection(data)) optionalByRaceKey.set(raceKeyOf(race), data);
    else if (data !== REQUEST_FAILED) counter.failed++;
  }));

  assertSessionCurrent(snapshot);

  const entries = buildRacialTraits(races, optionalByRaceKey);
  if (entries.length === 0) throw unavailableError("Racial trait", "racial traits");
  const build: CachedBuild<RacialTraitEntry> = {
    source: counter.failed === 0 ? "ddb-authoritative" : "ddb-partial",
    entries,
  };
  writeBuildCache("racial-traits", build);
  return build;
}

/**
 * Racial traits, picked per species and edition-grouped by base race (as the
 * species search), so the 2024 Elf's traits replace the 2014 High Elf's by
 * default. A trait is tagged by its own markers: a standard trait's sources
 * are the race's, an optional trait keeps its own.
 */
const RACIAL_TRAIT_ADAPTER: CatalogAdapter<RacialTraitEntry> = {
  markers: e => ({ sources: e.sources, isLegacy: e.isLegacy, isHomebrew: e.isHomebrew }),
  twinKey: e => twinName(e.speciesName),
  groupKey: e => twinName(e.baseRaceName || e.speciesName),
  owner: e => ({
    id: e.raceKey,
    markers: { sources: e.ownerSources, isLegacy: e.isLegacy, isHomebrew: e.isHomebrew },
    tiebreak: { id: e.entityRaceId, isLegacy: e.isLegacy, isHomebrew: e.isHomebrew },
  }),
  tiebreak: definitionTiebreak,
  compare: compareRacialTraits,
};

export interface RacialTraitSearchParams extends OwnedSearchParams {
  name?: string;
  raceName?: string;
}

export async function searchRacialTraits(params: RacialTraitSearchParams): Promise<string> {
  return renderSection(await searchRacialTraitsSection(params));
}

export async function searchRacialTraitsSection(params: RacialTraitSearchParams): Promise<SearchSection> {
  return searchOwnedEntries(params, {
    load: loadRacialTraits,
    partialNote: PARTIAL_NOTE_RACIAL_TRAITS,
    heading: "Racial Trait",
    adapter: { ...RACIAL_TRAIT_ADAPTER, ...racialTraitFilters(params) },
    format: formatRacialTraitLine,
    noMatch: (searched, book) => {
      const criteria = describeCriteria([["name", params.name], ["race", params.raceName]]);
      return `No racial traits found matching ${criteria || "the search criteria"}${book ? ` in ${book}` : ""} (searched ${searched} racial traits). D&D Beyond lists only the species available to your account.`;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RULES
// ─────────────────────────────────────────────────────────────────────────────

export async function searchRules(query?: string, rulesEdition: RulesEdition = "2024"): Promise<string> {
  return o5SearchRules(query, rulesEdition);
}

export async function getRule(
  nameOrSlug: string,
  maxChars?: number,
  query?: string,
  rulesEdition: RulesEdition = "2024"
): Promise<string> {
  const result = await o5GetRule(nameOrSlug, rulesEdition, maxChars, query);
  if (!result) {
    return `Rules chapter or section "${nameOrSlug}" not found. Try ddb_search_rules to browse the chapters.`;
  }
  return result;
}
