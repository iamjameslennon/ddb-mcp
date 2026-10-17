/**
 * monster.ts — DDB monster service tools
 *
 * API host: monster-service.dndbeyond.com
 * Auth: Bearer cobalt token (same as character service)
 * Envelope: { accessType, pagination, data } for list; { accessType, data } for single
 *
 * Game config (CR values, type names, sources, etc.) comes from
 * ../game-config.ts.
 */

import {
  beginAuthenticatedSession, hasValidSession,
  captureSession, assertSessionCurrent, onSessionInvalidated,
} from "../session-fetch.js";
import { getGameConfig, type GameConfig, type GameSource } from "../game-config.js";
import { TtlCache } from "../cache.js";
import { wrapUntrusted } from "../utils.js";
import { o5SearchMonsters, o5GetMonster } from "../open5e.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONSTER_SERVICE = "https://monster-service.dndbeyond.com";

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

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", times: "×", minus: "−",
};

/**
 * Decode HTML entities in one pass (so "&amp;#160;" stays "&#160;"). DDB stat
 * blocks use numeric entities such as "&#160;" — non-breaking spaces become
 * plain spaces. Unknown named entities are left as-is.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, ref: string) => {
      if (ref[0] !== "#") return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\u00a0/g, " ");
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    // [^<>] rather than [^>]: a scan stops at the next "<", so a run of
    // unterminated "<" in homebrew text stays linear instead of quadratic.
    .replace(/<[^<>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Stat-block prose (traits, actions, reactions…): like stripHtml, but keeps
 * DDB's <strong> feature names ("Bite.", "Multiattack.") as Markdown bold.
 * The body only runs up to the next tag of the same name, so each scan ends
 * there and hostile homebrew markup (unclosed tags, huge whitespace runs)
 * stays linear, while a <b> nested in a <strong> keeps the outer bold.
 */
function statBlockText(html: string | null | undefined): string {
  if (!html) return "";
  return stripHtml(html.replace(/<(strong|b)\b[^<>]*>((?:(?!<\/?\1\b)[\s\S])*)<\/\1>/gi,
    (_m, _tag, inner: string) => boldInner(inner)));
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

/** Loosely normalize a source string for comparison — case- and punctuation-insensitive. */
function normalizeSourceQuery(s: string | null | undefined): string {
  return stripHtml(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The book's URL slug ("sources/dnd/mm-2024" → "mm-2024") — the form users and labels quote. */
function sourceSlug(s: GameSource): string {
  return (s.sourceURL ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * Resolve a user-supplied source string (e.g. "mm-2024", "MM-2024", "Curse of
 * Strahd") to game-config source IDs. Tries the URL slug first (most
 * unambiguous — e.g. "mm-2024" vs "mm-2014"), then the short name, then the
 * full title, stopping at the first tier that matches. Returns every ID in that
 * tier — slugs are not unique (four sources share "basic-rules-2014"), and the
 * monster service accepts several `sources` at once. Never hardcoded — always
 * resolved through the live config.
 */
function resolveSourceIds(config: GameConfig | null, query: string): number[] {
  const sources = config?.sources ?? [];
  const norm = normalizeSourceQuery(query);
  if (!norm) return [];
  const tiers: Array<(s: GameSource) => string> = [
    s => normalizeSourceQuery(sourceSlug(s)),
    s => normalizeSourceQuery(s.name),
    s => normalizeSourceQuery(s.description),
  ];
  for (const key of tiers) {
    const ids = sources.filter(s => key(s) === norm).map(s => s.id);
    if (ids.length) return ids;
  }
  return [];
}

/** Human-readable label for a source ID, with the slug to pass back as `source`. */
function sourceLabel(config: GameConfig | null, sourceId: number): string {
  const s = config?.sources?.find(x => x.id === sourceId);
  if (!s) return `source ${sourceId}`;
  const title = stripHtml(s.description) || stripHtml(s.name);
  const slug = sourceSlug(s);
  return slug ? `${title} [${slug}]` : title;
}

/** Sources whose slug, short name, or title loosely contains (or is contained by) the query. */
function suggestSources(config: GameConfig | null, query: string): string[] {
  const norm = normalizeSourceQuery(query);
  if (norm.length < 2) return [];
  return (config?.sources ?? [])
    .filter(s => [sourceSlug(s), s.name, s.description]
      .map(normalizeSourceQuery)
      .some(v => v.length >= 2 && (v.includes(norm) || norm.includes(v))))
    .slice(0, 8)
    .map(s => sourceLabel(config, s.id));
}

function unknownSourceError(config: GameConfig | null, source: string): string {
  const suggestions = suggestSources(config, source);
  return `Unknown source "${source}". ` + (suggestions.length
    ? `Did you mean: ${suggestions.join(", ")}?`
    : "Pass a book's short code as shown in brackets in ddb_search_monsters results (e.g. mm-2024, cos).");
}

/** IDs of the "Core Rules" source categories (5e and 5.5e) — resolved by name, not hardcoded. */
function coreCategoryIds(config: GameConfig | null): Set<number> {
  return new Set((config?.sourceCategories ?? [])
    .filter(c => /core\s*rules/i.test(stripHtml(c.name)))
    .map(c => c.id));
}

/**
 * Order same-named candidates deterministically. The monster service returns
 * them in a different order from one request to the next, so "first match"
 * is not a stable choice. Ranking: official before homebrew → preferred
 * edition (2024 by default, Legacy when `preferLegacy`) → a Core Rules book
 * (MM/BR) before an adventure or third-party reprint → lowest ID.
 */
function rankCandidates(candidates: DdbMonster[], config: GameConfig | null, preferLegacy: boolean): DdbMonster[] {
  const core = coreCategoryIds(config);
  const isCore = (m: DdbMonster) => {
    const cat = config?.sources?.find(s => s.id === m.sourceId)?.sourceCategoryId;
    return cat !== undefined && core.has(cat);
  };
  const score = (m: DdbMonster) => [
    m.isHomebrew ? 1 : 0,
    Boolean(m.isLegacy) === preferLegacy ? 0 : 1,
    isCore(m) ? 0 : 1,
    m.id,
  ];
  return [...candidates].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return 0;
  });
}

/**
 * Pick the right monster from a candidate list fetched by name: exact name
 * matches, falling back to partial, then (unless `allowFuzzy` is false) the
 * service's top hit — ranked by rankCandidates(). Source filtering happens
 * server-side before this.
 */
function selectMonster(
  candidates: DdbMonster[],
  name: string,
  config: GameConfig | null,
  opts: { preferLegacy?: boolean; allowFuzzy?: boolean } = {}
): DdbMonster | undefined {
  const named = namedCandidates(candidates, name, opts.allowFuzzy ?? true);
  return rankCandidates(named, config, opts.preferLegacy ?? false)[0];
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
  return name ? stripHtml(name) : undefined;
}

/**
 * The Languages line. 2014 entries carry free text in languageDescription;
 * 2024 entries leave it null and list language IDs (resolved through the game
 * config) with per-language notes such as telepathy range. languageNote holds
 * extra text — on some entries the whole line ("Understands Common … but
 * can't speak"), on others a repeat of languageDescription, which is dropped.
 */
function languagesLine(m: DdbMonster, config: GameConfig | null): string {
  const description = stripHtml(m.languageDescription);
  const listed = description || (m.languages ?? [])
    .map(l => {
      const name = stripHtml(config?.languages?.find(c => c.id === l.languageId)?.name) || `Language #${l.languageId}`;
      const notes = stripHtml(l.notes);
      return notes ? `${name} ${notes}` : name;
    })
    .join(", ");
  const note = stripHtml(m.languageNote);
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
}

interface MonsterSingleResponse {
  accessType: number;
  data: DdbMonster;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function monsterFetch(url: string): Promise<Response> {
  // Single authenticated-fetch path: token + request bound to one snapshot.
  const session = await beginAuthenticatedSession();
  return session.fetch(url);
}

/**
 * Fetch (or serve from cache) one page of `/v1/Monster` search results.
 * `sourceIds` filters server-side via repeated `sources=` params, which match
 * an entry's primary *or* reprint sources and keep `pagination.total` honest.
 */
async function fetchMonsterList(search: string, take: number, sourceIds: number[] = [], skip = 0): Promise<MonsterListResponse> {
  const sourceQs = sourceIds.map(id => `&sources=${id}`).join("");
  const url = `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(search)}&skip=${skip}&take=${take}${sourceQs}`;
  const cacheKey = `monsters:list:${search.toLowerCase()}:skip${skip}:take${take}:src${sourceIds.join(",")}`;
  // Boundary check before the cache read, so a pending account change clears
  // the cache rather than serving the previous account's list.
  const snapshot = captureSession();
  const cached = monsterCache.get(cacheKey);
  if (cached !== undefined) return JSON.parse(cached) as MonsterListResponse;

  const resp = await monsterFetch(url);
  if (!resp.ok) throw new Error(`Monster search failed: ${resp.status} ${resp.statusText}`);
  const list = await resp.json() as MonsterListResponse;
  assertSessionCurrent(snapshot);
  monsterCache.set(cacheKey, JSON.stringify(list));
  return list;
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
async function fetchMonsterPages(search: string, sourceIds: number[], limit: number): Promise<{ data: DdbMonster[]; total: number }> {
  // One snapshot for the whole scan: each page checks only its own request,
  // so pages fetched either side of an account change would otherwise merge.
  const snapshot = captureSession();
  const first = await fetchMonsterList(search, PAGE_SIZE, sourceIds);
  const total = first.pagination.total;
  const skips: number[] = [];
  for (let skip = PAGE_SIZE; skip < Math.min(total, limit); skip += PAGE_SIZE) skips.push(skip);
  const rest = await Promise.all(skips.map(skip => fetchMonsterList(search, PAGE_SIZE, sourceIds, skip)));
  assertSessionCurrent(snapshot);
  const seen = new Set<number>();
  const data = [first, ...rest].flatMap(page => page.data ?? []).filter(m => !seen.has(m.id) && seen.add(m.id));
  return { data, total };
}

/**
 * The distinct sources a name appears in (unfiltered search), for "not in that
 * book" errors. Best effort: a failure here must not turn the error into an
 * Open5e substitute, so it yields no hint instead.
 */
async function availableSourcesFor(name: string, config: GameConfig | null): Promise<string[]> {
  try {
    const all = await fetchMonsterList(name, 20);
    // Official entries in books the config knows: a homebrew copy filed under a
    // book (or under none) would advertise a source with no official entry, and
    // an unknown id would surface as a bare "source 424242".
    const known = new Set((config?.sources ?? []).map(s => s.id));
    const official = (all.data ?? []).filter(m => m.isHomebrew === false && known.has(m.sourceId));
    // No fuzzy guess: a typo's nearest hit is a different monster.
    const named = rankCandidates(namedCandidates(official, name, false), config, false);
    return [...new Set(named.map(m => sourceLabel(config, m.sourceId)))];
  } catch {
    return [];
  }
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatStatBlock(m: DdbMonster, accessType: number, config: GameConfig | null): string {
  const crEntry = config?.challengeRatings.find(cr => cr.id === m.challengeRatingId);
  const crStr = crEntry ? crDisplay(crEntry.value) : `(id:${m.challengeRatingId})`;
  const xpStr = crEntry?.xp ? ` (${crEntry.xp.toLocaleString()} XP)` : "";
  const typeName = config?.monsterTypes.find(t => t.id === m.typeId)?.name ?? `type ${m.typeId}`;
  const size = sizeName(config, m.sizeId) ?? "Unknown size";
  const alignment = config?.alignments.find(a => a.id === m.alignmentId)?.name ?? "Unaligned";

  const lines: string[] = [];
  lines.push(`# ${m.name}`);
  lines.push(`*${size} ${typeName}, ${alignment}*`);
  // Name the book (as ddb_search_monsters does) so same-named 2014/2024 blocks are distinguishable.
  if (m.sourceId) lines.push(`**Source** ${sourceLabel(config, m.sourceId)}${m.isLegacy ? " [Legacy]" : ""}`);
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
    lines.push(`**Skills** ${stripHtml(m.skillsHtml)}`);
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
    lines.push("\n---\n*⚠️ Full stat block requires ownership of this content on D&D Beyond. Ability scores and actions may be missing.*");
  }

  return lines.join("\n");
}

// ── Exported tool functions ───────────────────────────────────────────────────

export async function searchMonsters(params: {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  source?: string;
}): Promise<string> {
  if (!hasValidSession()) {
    return await o5SearchMonsters(params).then(r => withSourceCaveat(r, params.source)).catch(
      () => "Monster search requires login. Run ddb_login first."
    );
  }

  try {
  const config = await getGameConfig();
  const crMap = new Map(config?.challengeRatings.map(cr => [cr.id, cr]) ?? []);
  const typeMap = new Map(config?.monsterTypes.map(t => [t.id, t.name]) ?? []);

  const searchTerm = params.name?.trim() ?? "";

  // Resolve filter IDs up front so we can pass them to the API.
  const targetCrId = params.cr !== undefined
    ? config?.challengeRatings.find(cr => cr.value === params.cr)?.id
    : undefined;
  let sourceIds: number[] = [];
  if (params.source) {
    // No source list means DDB is unreachable or changed shape — the catch
    // below falls back to Open5e with a caveat rather than calling every
    // source "unknown".
    if (!config?.sources?.length) throw new Error("Game config source list unavailable");
    sourceIds = resolveSourceIds(config, params.source);
    if (!sourceIds.length) return unknownSourceError(config, params.source);
  }

  // Source filters server-side. CR/type/size filter client-side, so page
  // through results (up to MAX_FILTER_SCAN) rather than judging one page.
  const clientFilters = targetCrId !== undefined || Boolean(params.type) || Boolean(params.size);
  let fetched: DdbMonster[];
  let total: number;
  let take = 0;
  if (clientFilters) {
    ({ data: fetched, total } = await fetchMonsterPages(searchTerm, sourceIds, MAX_FILTER_SCAN));
  } else {
    take = !searchTerm && params.source ? PAGE_SIZE : 20;
    const page = await fetchMonsterList(searchTerm, take, sourceIds);
    fetched = page.data ?? [];
    total = page.pagination.total;
  }
  const checked = fetched.length;
  const partialScan = clientFilters && checked < total;
  let monsters = fetched;

  if (targetCrId !== undefined) {
    monsters = monsters.filter(m => m.challengeRatingId === targetCrId);
  }
  if (params.type) {
    const searchType = params.type.toLowerCase();
    monsters = monsters.filter(m => (typeMap.get(m.typeId) ?? "").toLowerCase().includes(searchType));
  }
  if (params.size) {
    const searchSize = params.size.toLowerCase();
    monsters = monsters.filter(m => (sizeName(config, m.sizeId) ?? "").toLowerCase().includes(searchSize));
  }

  if (monsters.length === 0) {
    if (params.source) {
      // Open5e only carries the SRD — never substitute it for a requested book.
      const where = sourceLabel(config, sourceIds[0]);
      const scope = partialScan ? ` (checked the first ${checked} of ${total} entries)` : "";
      let msg = `No monsters matching the search criteria in ${where}${scope}.`;
      if (searchTerm) {
        const available = await availableSourcesFor(searchTerm, config);
        if (available.length) msg += ` "${searchTerm}" appears in: ${available.join(", ")}.`;
      }
      return msg;
    }
    return await o5SearchMonsters(params).catch(() => "No monsters found matching the search criteria.");
  }

  const matchedBy = searchTerm && params.source ? "matched by name and source"
    : searchTerm ? "matched by name"
    : params.source ? "matched by source"
    : "in the compendium";
  const shown = monsters.slice(0, PAGE_SIZE);
  const header = clientFilters
    ? `${shown.length} shown of ${monsters.length} matching; checked ${checked} of ${total} ${matchedBy}`
    : `${shown.length} shown, ${total} total ${matchedBy}`;
  const lines = [`**Monster Search** (${header})\n`];
  for (const m of shown) {
    const cr = crMap.get(m.challengeRatingId);
    const crStr = cr ? crDisplay(cr.value) : "?";
    const typeName = typeMap.get(m.typeId) ?? "Unknown";
    const size = sizeName(config, m.sizeId) ?? "Unknown size";
    const tags: string[] = [];
    if (m.isLegendary) tags.push("Legendary");
    if (m.isMythic) tags.push("Mythic");
    if (m.isHomebrew) tags.push("Homebrew");
    if (m.isLegacy) tags.push("Legacy");
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    let sourceStr = sourceLabel(config, m.sourceId);
    if (sourceIds.length && !sourceIds.includes(m.sourceId)) {
      // Matched the requested book as a reprint — say so, or the line looks off-filter.
      const via = m.sources?.find(s => sourceIds.includes(s.sourceId))?.sourceId ?? sourceIds[0];
      sourceStr += `, reprinted in ${sourceLabel(config, via)}`;
    }
    const line = `- **${m.name}**${tagStr} — ${sourceStr} — CR ${crStr}, ${size} ${typeName}, AC ${m.armorClass}, ${m.averageHitPoints} HP`;
    // Homebrew names are user-authored — delimit them, as getMonster does for
    // homebrew stat blocks. Fail closed: only an explicitly official entry is left plain.
    lines.push(m.isHomebrew === false ? line : wrapUntrusted(line));
  }

  if (shown.length < monsters.length) {
    lines.push(`\n*${monsters.length - shown.length} more matches not shown.*`);
  }
  if (partialScan) {
    lines.push(`\n*Only the first ${checked} of ${total} were checked against the CR/type/size filters — add a name or source to narrow the search.*`);
  } else if (!clientFilters && total > take) {
    lines.push(`\n*Refine your search with a name term for more specific results.*`);
  }

  return lines.join("\n");
  } catch {
    return await o5SearchMonsters(params).then(r => withSourceCaveat(r, params.source)).catch(
      () => "Monster search unavailable — DnD Beyond and Open5e both failed."
    );
  }
}


/** Open5e has no concept of sources — flag that the filter wasn't honoured when one was requested. */
function withSourceCaveat(o5Result: string, source: string | undefined): string {
  if (!source) return o5Result;
  return `${o5Result}\n\n*Note: source filtering is not available via the Open5e SRD fallback — "${source}" was requested but could not be honoured. This may not be the requested edition.*`;
}

export async function getMonster(monsterName: string, source?: string): Promise<string> {
  monsterName = monsterName.trim();
  if (!monsterName) return "Monster name is required.";
  if (!hasValidSession()) {
    const o5Result = await o5GetMonster(monsterName).catch(() => null);
    if (o5Result) return withSourceCaveat(o5Result, source);
    return "Monster lookup requires login. Run ddb_login first.";
  }

  try {
    const config = await getGameConfig();
    let sourceIds: number[] = [];
    if (source) {
      // No source list means DDB is unreachable or changed shape — the catch
      // below falls back to Open5e with a caveat.
      if (!config?.sources?.length) throw new Error("Game config source list unavailable");
      sourceIds = resolveSourceIds(config, source);
      if (!sourceIds.length) return unknownSourceError(config, source);
    }

    // 20 slots so a crowded name (e.g. "Zombie" has Ash/Beholder/Girallon/
    // Greater/Ogre/Strahd/Yellow Musk/plain across both editions) doesn't
    // miss the intended entry.
    const searchResp = await fetchMonsterList(monsterName, 20, sourceIds);
    const candidates = searchResp.data ?? [];
    // With a source, require an exact name: a partial match would quietly turn
    // "Zombie" in mm-2014 into Beholder Zombie. Near names are offered instead.
    const best = source
      ? rankCandidates(candidates.filter(m => nameKey(m.name) === nameKey(monsterName)), config, false)[0]
      : selectMonster(candidates, monsterName, config);

    if (!best) {
      if (source) {
        // A requested book is never silently swapped for another edition or the SRD.
        // Homebrew names are user-authored — keep them out of this hint.
        const similar = [...new Set(namedCandidates(candidates, monsterName).filter(m => !m.isHomebrew).map(m => m.name))].slice(0, 5);
        const available = await availableSourcesFor(monsterName, config);
        let msg = `No "${monsterName}" entry found in source "${source}".`;
        if (similar.length) msg += ` Similar names in that source: ${similar.join(", ")}.`;
        msg += available.length
          ? ` Available sources for "${monsterName}": ${available.join(", ")}.`
          : ` Try ddb_search_monsters with a partial name.`;
        return msg;
      }
      const o5Result = await o5GetMonster(monsterName).catch(() => null);
      if (o5Result) return o5Result;
      return `Monster "${monsterName}" not found. Try ddb_search_monsters with a partial name.`;
    }

    const detailUrl = `${MONSTER_SERVICE}/v1/Monster/${best.id}`;
    const detailCacheKey = `monster:${best.id}`;
    // Boundary check before the cache read, as in fetchMonsterList.
    const snapshot = captureSession();
    const cachedDetail = monsterCache.get(detailCacheKey);

    let detail: MonsterSingleResponse;
    if (cachedDetail !== undefined) {
      detail = JSON.parse(cachedDetail) as MonsterSingleResponse;
    } else {
      const resp = await monsterFetch(detailUrl);
      if (!resp.ok) throw new Error(`Monster fetch failed: ${resp.status} ${resp.statusText}`);
      detail = await resp.json() as MonsterSingleResponse;
      assertSessionCurrent(snapshot);
      monsterCache.set(detailCacheKey, JSON.stringify(detail));
    }

    const statBlock = formatStatBlock(detail.data, detail.accessType, config);

    // If DDB returned an empty stat block (unowned content), fall back to Open5e.
    // Not when a source was requested: the SRD isn't that book, and the
    // restricted block already says the content isn't owned.
    if (detail.accessType === 4 && !detail.data.stats?.length && !source) {
      const o5Result = await o5GetMonster(monsterName).catch(() => null);
      if (o5Result) return o5Result;
    }

    // Homebrew stat blocks are user-authored free text (trait/action
    // descriptions) — delimit as untrusted. Official WotC content is not.
    // Fail closed: only an explicitly official entry is left plain.
    return detail.data.isHomebrew === false ? statBlock : wrapUntrusted(statBlock);
  } catch {
    const o5Result = await o5GetMonster(monsterName).catch(() => null);
    if (o5Result) return withSourceCaveat(o5Result, source);
    return `Monster "${monsterName}" not found. DnD Beyond is unavailable and "${monsterName}" is not in the SRD.`;
  }
}

const CR_XP_O5: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800,
  "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900,
  "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
  "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000,
  "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000,
  "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

const CR_VALUE_O5: Record<string, number> = {
  "0": 0, "1/8": 0.125, "1/4": 0.25, "1/2": 0.5,
};

/**
 * Returns CR and XP for a named monster. Used by the encounter difficulty rater
 * and treasure generator. Tries the DDB monster service first, then falls back
 * to Open5e. `preferLegacy` picks the 2014 entry when a name exists in both
 * editions (the encounter rater sets it for 2014 rules).
 *
 * Unlike getMonster, no fuzzy fallback (on either path): callers fold the CR
 * into a rating or a treasure roll, where a near-miss creature would silently
 * skew the result instead of surfacing as "not found". Homebrew is skipped too —
 * callers print the returned name as trusted text, and the rating should use
 * official CRs.
 */
export async function getMonsterStats(name: string, opts: { preferLegacy?: boolean } = {}): Promise<{
  name: string;
  crValue: number;
  xp: number;
} | null> {
  name = name.trim();
  if (!name) return null;
  // DDB path
  if (hasValidSession()) {
    try {
      const config = await getGameConfig();
      const list = await fetchMonsterList(name, 20);
      const official = (list.data ?? []).filter(m => m.isHomebrew === false);
      const match = selectMonster(official, name, config, { preferLegacy: opts.preferLegacy, allowFuzzy: false });
      if (match && config) {
        const crEntry = config.challengeRatings.find(cr => cr.id === match.challengeRatingId);
        if (crEntry) {
          return { name: match.name, crValue: crEntry.value, xp: crEntry.xp };
        }
      }
    } catch {
      // fall through to Open5e
    }
  }

  // Open5e fallback
  try {
    const resp = await fetch(
      `https://api.open5e.com/v1/monsters/?name=${encodeURIComponent(name)}&limit=5`,
      { headers: { Accept: "application/json" } }
    );
    if (resp.ok) {
      const data = await resp.json() as { results: Array<{ name: string; challenge_rating: string }> };
      const match = data.results.find(m => nameKey(m.name) === nameKey(name));
      if (match) {
        const crStr = match.challenge_rating;
        const xp = CR_XP_O5[crStr];
        const crValue = CR_VALUE_O5[crStr] ?? parseFloat(crStr);
        if (xp !== undefined) return { name: match.name, crValue, xp };
      }
    }
  } catch {
    // both sources failed
  }

  return null;
}
