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
  twinName, classifyEdition, selectByEdition, definitionTiebreak, isEdition,
  lookupByName, groupAndSelect, normalizeName, rulesLine, renameLine, editionTag,
  searchHeader, searchFooter,
  type RulesEdition, type EditionInfo, type EditionReason,
} from "../edition.js";
import { peekSourceIndex, getSourceIndex } from "../game-config.js";
import { createSpellStore, addSpells, spellList, type DdbSpell, type SpellStore } from "./spell-store.js";
import {
  buildClassFeatures, filterClassFeatures, formatClassFeatureLine,
  buildRacialTraits, filterRacialTraits, formatRacialTraitLine, raceKeyOf,
  type ClassFeatureEntry, type RacialTraitEntry, type OptionalCollection,
} from "./features-traits.js";
import {
  o5SearchSpells, o5GetSpell,
  o5SearchItems, o5GetItem,
  o5GetWeapon, o5GetArmor,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchSections, o5GetSection,
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

function formatSpell(
  spell: DdbSpell,
  edition: { info: EditionInfo; reason?: EditionReason; renamed?: { name2014: string; name2024: string } },
): string {
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
    rulesLine(edition.info, { reason: edition.reason }),
    ...(edition.renamed ? [renameLine(edition.renamed.name2014, edition.renamed.name2024)] : []),
    `Casting Time: ${castingTime}`,
    `Range: ${range}`,
    `Components: ${components || "None"}${matNote}`,
    `Duration: ${duration}`,
    "",
    stripHtml(d.description),
  ];
  return lines.join("\n");
}

export async function searchSpells(params: {
  name?: string;
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  limit?: number;
  offset?: number;
  rulesEdition?: RulesEdition;
}): Promise<string> {
  try {
    const requested = params.rulesEdition ?? "2024";
    const store = await loadSpellCompendium();
    const index = await getSourceIndex();
    const nameQuery = params.name ? normalizeName(params.name) : "";
    const schoolQuery = params.school?.toLowerCase();

    const { selected, hidden } = groupAndSelect(spellList(store), requested, {
      info: s => classifyEdition(s.definition, index),
      twinKey: s => twinName(s.definition.name),
      tiebreak: (a, b) => definitionTiebreak(a.definition, b.definition),
      nameMatches: nameQuery ? s => normalizeName(s.definition.name).includes(nameQuery) : undefined,
      passes: s => {
        const d = s.definition;
        return (params.level === undefined || d.level === params.level)
          && (!schoolQuery || d.school.toLowerCase().includes(schoolQuery))
          && (params.concentration === undefined || d.concentration === params.concentration)
          && (params.ritual === undefined || d.ritual === params.ritual);
      },
    });

    selected.sort((a, b) => {
      const da = a.entry.definition, db = b.entry.definition;
      if (da.level !== db.level) return da.level - db.level;
      return da.name.localeCompare(db.name);
    });

    const total = selected.length;
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const page = selected.slice(offset, offset + limit);

    if (page.length === 0) return "No spells found matching the criteria.";

    const header = total > limit
      ? `**Spell Search** — showing ${offset + 1}–${offset + page.length} of ${total}`
      : `**Spell Search** (${total} found)`;

    // When the compendium build was incomplete (one or more class-list
    // requests failed), tell the caller so they can re-run `ddb_login` and
    // `ddb_clear_cache` to retry.
    const provenanceNote = compendiumSource === "ddb-partial"
      ? "\n> ⚠ Compendium build was incomplete — one or more class spell-list requests to D&D Beyond failed, so spells from those classes may be missing. If you've just re-logged in, run `ddb_clear_cache` to retry.\n"
      : "";

    const lines = [searchHeader({ requested }), header + "\n" + provenanceNote];
    for (const sel of page) {
      const d = sel.entry.definition;
      const level = d.level === 0 ? "Cantrip" : `Level ${d.level}`;
      const tags: string[] = [];
      if (d.concentration) tags.push("Conc.");
      if (d.ritual) tags.push("Ritual");
      const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
      lines.push(`- **${d.name}** ${editionTag(sel.info)} — ${level} ${d.school}${tagStr}`);
    }
    if (total > offset + limit) {
      lines.push(`\n*Use offset: ${offset + limit} to see more.*`);
    }
    const footer = searchFooter(requested, hidden);
    if (footer) lines.push(footer);
    return lines.join("\n");
  } catch (err) {
    try {
      return await o5SearchSpells(params, "unavailable");
    } catch {
      throw err;
    }
  }
}

export async function getSpell(spellName: string, rulesEdition: RulesEdition = "2024"): Promise<string> {
  try {
    const store = await loadSpellCompendium();
    const index = await getSourceIndex();

    const found = lookupByName(spellList(store), spellName, rulesEdition, {
      name: s => s.definition.name,
      info: s => classifyEdition(s.definition, index),
      tiebreak: (a, b) => definitionTiebreak(a.definition, b.definition),
    });

    if (!found) {
      const o5Result = await o5GetSpell(spellName, "not-found").catch(() => null);
      if (o5Result) return o5Result;
      return `Spell "${spellName}" not found in the compendium. Try ddb_search_spells with a partial name.`;
    }

    return formatSpell(found.entry, {
      info: classifyEdition(found.entry.definition, index),
      reason: found.reason,
      renamed: found.renamed,
    });
  } catch (err) {
    try {
      const o5Result = await o5GetSpell(spellName, "unavailable");
      if (o5Result) return o5Result;
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
}

let itemCompendium: DdbItem[] | null = null;

async function loadItemCompendium(): Promise<DdbItem[]> {
  // Boundary check before the early singleton/cache return (see loadSpellCompendium).
  const snapshot = captureSession();

  if (itemCompendium) return itemCompendium;

  const cached = referenceCache.get("item-compendium");
  if (cached) {
    itemCompendium = JSON.parse(cached) as DdbItem[];
    return itemCompendium;
  }

  const url = `${CHARACTER_SERVICE}/character/v5/game-data/items?sharingSetting=2`;
  const resp = await refFetch(url);
  if (!resp.ok) throw new Error(`Item compendium fetch failed: ${resp.status} ${resp.statusText}`);

  const json = await resp.json() as { data?: DdbItem[] } | DdbItem[];
  const items = (Array.isArray(json) ? json : json.data) ?? [];

  // Don't cache one account's item list into another account's generation.
  assertSessionCurrent(snapshot);
  itemCompendium = items;
  referenceCache.set("item-compendium", JSON.stringify(items));
  return items;
}

function formatItem(item: DdbItem): string {
  const type = item.filterType || item.type || "Item";
  const rarity = item.rarity || "Common";
  const lines = [`**${item.name}** — ${type}, ${rarity}`];

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

export async function searchItems(params: {
  name?: string;
  rarity?: string;
  type?: string;
}): Promise<string> {
  const items = await loadItemCompendium();
  let matched = items;

  if (params.name) {
    const q = params.name.toLowerCase();
    matched = matched.filter(i => i.name.toLowerCase().includes(q));
  }
  if (params.rarity) {
    const q = params.rarity.toLowerCase();
    matched = matched.filter(i => i.rarity?.toLowerCase().includes(q));
  }
  if (params.type) {
    const q = params.type.toLowerCase();
    matched = matched.filter(i =>
      i.type?.toLowerCase().includes(q) || i.filterType?.toLowerCase().includes(q)
    );
  }

  matched.sort((a, b) => a.name.localeCompare(b.name));

  const total = matched.length;
  const shown = matched.slice(0, 30);

  if (shown.length === 0) {
    return await o5SearchItems(params.name ?? "", "not-found").catch(
      () => "No items found matching the criteria."
    );
  }

  const lines = [`**Item Search** (${total > 30 ? `showing 30 of ${total}` : `${total} found`})\n`];
  for (const item of shown) {
    const rarity = item.rarity || "Common";
    const type = item.filterType || item.type || "Item";
    const attune = item.requiresAttunement ? " (attunement)" : "";
    lines.push(`- **${item.name}** — ${rarity} ${type}${attune}`);
  }
  if (total > 30) lines.push(`\n*Refine your search to see more results.*`);
  return lines.join("\n");
}

export async function getItem(itemName: string): Promise<string> {
  try {
    const items = await loadItemCompendium();
    const q = itemName.toLowerCase();

    const item = items.find(i => i.name.toLowerCase() === q)
      ?? items.find(i => i.name.toLowerCase().includes(q));

    if (!item) {
      // Try magic items, then weapons, then armour via Open5e
      for (const fallback of [o5GetItem, o5GetWeapon, o5GetArmor]) {
        const result = await fallback(itemName, "not-found").catch(() => null);
        if (result) return result;
      }
      return `Item "${itemName}" not found. Try ddb_search_equipment with a partial name.`;
    }

    return formatItem(item);
  } catch (err) {
    for (const fallback of [o5GetItem, o5GetWeapon, o5GetArmor]) {
      try {
        const result = await fallback(itemName, "unavailable");
        if (result) return result;
      } catch { /* continue */ }
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPENDIUM TOOLS — races, classes, backgrounds, feats, features, traits
// ─────────────────────────────────────────────────────────────────────────────

function paginateResults<T>(
  label: string,
  items: T[],
  format: (item: T) => string,
  limit = 30,
  offset = 0
): string {
  const total = items.length;
  if (total === 0) return "";

  const page = items.slice(offset, offset + limit);
  const header = total > limit
    ? `**${label} Search** — showing ${offset + 1}–${offset + page.length} of ${total}`
    : `**${label} Search** (${total} found)`;

  const lines = [header + "\n", ...page.map(format)];
  if (total > offset + limit) {
    lines.push(`\n*Use offset: ${offset + limit} to see more.*`);
  }
  return lines.join("\n");
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

export async function searchRaces(name?: string, limit?: number, offset?: number): Promise<string> {
  try {
    const races = await loadGameDataList<DdbRace>("game-data:races", "races");

    let matched = races.filter(r => r.fullName || r.baseName);

    if (name) {
      const q = name.toLowerCase();
      matched = matched.filter(r => (r.fullName || r.baseName).toLowerCase().includes(q));
    }

    matched.sort((a, b) => (a.fullName || a.baseName).localeCompare(b.fullName || b.baseName));

    const result = paginateResults(
      "Race",
      matched,
      race => {
        const raceName = race.fullName || race.baseName;
        const tags: string[] = [];
        if (race.isSubRace) tags.push("Subrace");
        if (race.isLegacy) tags.push("Legacy");
        if (race.isHomebrew) tags.push("Homebrew");
        const tagStr = tags.length ? ` *(${tags.join(", ")})*` : "";
        const desc = stripHtml(race.description || "").slice(0, 100);
        return `- **${raceName}**${tagStr}${desc ? ` — ${desc}${desc.length >= 100 ? "..." : ""}` : ""}`;
      },
      limit ?? 30,
      offset ?? 0,
    );

    if (!result) {
      return await o5SearchRaces(name, "not-found").catch(() => `No races found matching "${name}".`);
    }
    return result;
  } catch {
    return await o5SearchRaces(name, "unavailable").catch(
      () => "Races unavailable — DnD Beyond and Open5e both failed."
    );
  }
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
  spellCastingAbilityId: number | null;
  subclasses?: Array<{ id: number; name: string; description: string }>;
  sources: Array<{ sourceId: number }>;
}

export async function searchClasses(name?: string, limit?: number, offset?: number): Promise<string> {
  try {
    const classes = await loadGameDataList<DdbClass>("game-data:classes", "classes");

    let matched = classes;

    if (name) {
      const q = name.toLowerCase();
      matched = matched.filter(c => c.name.toLowerCase().includes(q));
    }

    matched.sort((a, b) => a.name.localeCompare(b.name));

    const result = paginateResults(
      "Class",
      matched,
      cls => {
        const hitDie = cls.hitDice ? `d${cls.hitDice}` : "?";
        const spellcasting = cls.spellCastingAbilityId
          ? ` | Spellcasting: ${SPELLCASTING_ABILITY[cls.spellCastingAbilityId] ?? "Yes"}`
          : "";
        const homebrew = cls.isHomebrew ? " *(Homebrew)*" : "";
        const subclasses = cls.subclasses?.length
          ? `\n  Subclasses: ${cls.subclasses.map(s => s.name).join(", ")}`
          : "";
        const desc = stripHtml(cls.description || "").slice(0, 120);
        return `- **${cls.name}**${homebrew} — Hit Die: ${hitDie}${spellcasting}${desc ? `\n  ${desc}${desc.length >= 120 ? "..." : ""}` : ""}${subclasses}`;
      },
      limit ?? 30,
      offset ?? 0,
    );

    if (!result) {
      return await o5SearchClasses(name, "not-found").catch(() => `No classes found matching "${name}".`);
    }
    return result;
  } catch {
    return await o5SearchClasses(name, "unavailable").catch(
      () => "Classes unavailable — DnD Beyond and Open5e both failed."
    );
  }
}

// ── Backgrounds ───────────────────────────────────────────────────────────────

interface DdbBackground {
  id: number;
  name: string;
  description: string;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
}

export async function searchBackgrounds(name?: string, limit?: number, offset?: number): Promise<string> {
  try {
    const cacheKey = "game-data:backgrounds";
    const cached = referenceCache.get(cacheKey);

    let backgrounds: DdbBackground[];
    if (cached) {
      backgrounds = JSON.parse(cached) as DdbBackground[];
    } else {
      const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/backgrounds`);
      if (!resp.ok) throw new Error(`Backgrounds fetch failed: ${resp.status} ${resp.statusText}`);
      const json = await resp.json() as { data?: DdbBackground[] } | DdbBackground[];
      backgrounds = (Array.isArray(json) ? json : json.data) ?? [];
      referenceCache.set(cacheKey, JSON.stringify(backgrounds));
    }

    let matched = backgrounds;

    if (name) {
      const q = name.toLowerCase();
      matched = matched.filter(b => b.name.toLowerCase().includes(q));
    }

    matched.sort((a, b) => a.name.localeCompare(b.name));

    const result = paginateResults(
      "Background",
      matched,
      bg => {
        const homebrew = bg.isHomebrew ? " *(Homebrew)*" : "";
        const desc = stripHtml(bg.description || "").slice(0, 120);
        return `- **${bg.name}**${homebrew}${desc ? ` — ${desc}${desc.length >= 120 ? "..." : ""}` : ""}`;
      },
      limit ?? 30,
      offset ?? 0,
    );

    if (!result) {
      return await o5SearchBackgrounds(name, "not-found").catch(() => `No backgrounds found matching "${name}".`);
    }
    return result;
  } catch {
    return await o5SearchBackgrounds(name, "unavailable").catch(
      () => "Backgrounds unavailable — DnD Beyond and Open5e both failed."
    );
  }
}

// ── Feats ─────────────────────────────────────────────────────────────────────

interface DdbFeat {
  id: number;
  name: string;
  description: string;
  snippet: string;
  prerequisite: string | null;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
}

export async function searchFeats(params: {
  name?: string;
  prerequisite?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  try {
    const cacheKey = "game-data:feats";
    const cached = referenceCache.get(cacheKey);

    let feats: DdbFeat[];
    if (cached) {
      feats = JSON.parse(cached) as DdbFeat[];
    } else {
      const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/feats`);
      if (!resp.ok) throw new Error(`Feats fetch failed: ${resp.status} ${resp.statusText}`);
      const json = await resp.json() as { data?: DdbFeat[] } | DdbFeat[];
      feats = (Array.isArray(json) ? json : json.data) ?? [];
      referenceCache.set(cacheKey, JSON.stringify(feats));
    }

    let matched = feats;

    if (params.name) {
      const q = params.name.toLowerCase();
      matched = matched.filter(f => f.name.toLowerCase().includes(q));
    }

    if (params.prerequisite) {
      const q = params.prerequisite.toLowerCase();
      matched = matched.filter(f => f.prerequisite?.toLowerCase().includes(q));
    }

    matched.sort((a, b) => a.name.localeCompare(b.name));

    const result = paginateResults(
      "Feat",
      matched,
      feat => {
        const prereq = feat.prerequisite ? ` *(Requires: ${feat.prerequisite})*` : "";
        const homebrew = feat.isHomebrew ? " *(Homebrew)*" : "";
        const desc = stripHtml(feat.snippet || feat.description || "").slice(0, 100);
        return `- **${feat.name}**${homebrew}${prereq}${desc ? ` — ${desc}${desc.length >= 100 ? "..." : ""}` : ""}`;
      },
      params.limit ?? 30,
      params.offset ?? 0,
    );

    if (!result) {
      return await o5SearchFeats(params.name, "not-found").catch(() => "No feats found matching the search criteria.");
    }
    return result;
  } catch {
    return await o5SearchFeats(params.name, "unavailable").catch(
      () => "Feats unavailable — DnD Beyond and Open5e both failed."
    );
  }
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

export async function searchClassFeatures(params: {
  name?: string;
  className?: string;
  level?: number;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const { source, entries } = await loadClassFeatures();
  const note = source === "ddb-partial" ? `${PARTIAL_NOTE_CLASS_FEATURES}\n\n` : "";
  const matched = filterClassFeatures(entries, params);

  if (matched.length === 0) {
    const criteria = describeCriteria([["name", params.name], ["class", params.className], ["level", params.level]]);
    return `${note}No class features found matching ${criteria || "the search criteria"} (searched ${entries.length} class features). D&D Beyond lists only the classes and subclasses available to your account.`;
  }

  return note + paginateResults(
    "Class Feature",
    matched,
    formatClassFeatureLine,
    params.limit ?? 30,
    params.offset ?? 0,
  );
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

export async function searchRacialTraits(params: {
  name?: string;
  raceName?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const { source, entries } = await loadRacialTraits();
  const note = source === "ddb-partial" ? `${PARTIAL_NOTE_RACIAL_TRAITS}\n\n` : "";
  const matched = filterRacialTraits(entries, params);

  if (matched.length === 0) {
    const criteria = describeCriteria([["name", params.name], ["race", params.raceName]]);
    return `${note}No racial traits found matching ${criteria || "the search criteria"} (searched ${entries.length} racial traits). D&D Beyond lists only the species available to your account.`;
  }

  return note + paginateResults(
    "Racial Trait",
    matched,
    formatRacialTraitLine,
    params.limit ?? 30,
    params.offset ?? 0,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RULES SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function searchRules(query?: string): Promise<string> {
  return o5SearchSections(query);
}

export async function getRule(
  nameOrSlug: string,
  maxChars?: number,
  query?: string
): Promise<string> {
  const result = await o5GetSection(nameOrSlug, maxChars, query);
  if (!result) {
    return `Rules section "${nameOrSlug}" not found. Try ddb_search_rules to browse available sections.`;
  }
  return result;
}
