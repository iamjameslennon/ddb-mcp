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
import { getGameConfig, getSourceIndex, type GameConfig } from "../game-config.js";
import {
  classifyEdition, selectByEdition, lookupByName, groupAndSelect, monsterTiebreak, twinName, twinAliases,
  normalizeName, dedupeById, isEdition, rulesLine, renameLine, sourceNote, editionTag, searchHeader, searchFooter,
  isLockedReason, lockedLineSuffix, lockedSwapSummary, lockedEntriesNote, availableElsewhereHint,
  HOMEBREW_SOURCE_BOOK, HOMEBREW_INFO,
  type EditionInfo, type IndexedSource, type RulesEdition, type RulesLineReason, type SelectionReason, type SourceIndex,
} from "../edition.js";
import { TtlCache } from "../cache.js";
import { wrapUntrusted } from "../utils.js";
import { o5SearchMonsters, o5GetMonster, o5GetMonsterStats } from "../open5e.js";

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
function sourceSlug(s: { sourceURL: string | null }): string {
  return (s.sourceURL ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * Resolve a user-supplied source string (e.g. "mm-2024", "MM-2024", "Curse of
 * Strahd") to source IDs. Tries the URL slug first (most unambiguous — e.g.
 * "mm-2024" vs "mm-2014"), then the short name, then the full title, stopping
 * at the first tier that matches. Returns every ID in that tier — slugs are not
 * unique (four sources share "basic-rules-2014"), and the monster service
 * accepts several `sources` at once. Never hardcoded — always resolved through
 * the source index, which merges the live config over the generated snapshot,
 * so resolution survives a game-config outage.
 */
function resolveSourceIds(index: SourceIndex, query: string): number[] {
  const norm = normalizeSourceQuery(query);
  if (!norm) return [];
  const sources = [...index.sources];
  const tiers: Array<(s: IndexedSource) => string> = [
    s => normalizeSourceQuery(sourceSlug(s)),
    s => normalizeSourceQuery(s.name),
    s => normalizeSourceQuery(s.description),
  ];
  for (const key of tiers) {
    const ids = sources.filter(([, s]) => key(s) === norm).map(([id]) => id);
    if (ids.length) return ids;
  }
  return [];
}

/** Human-readable label for a source ID, with the slug to pass back as `source`. */
function sourceLabel(index: SourceIndex, sourceId: number): string {
  const s = index.sources.get(sourceId);
  if (!s) return `source ${sourceId}`;
  const title = stripHtml(s.description) || stripHtml(s.name);
  const slug = sourceSlug(s);
  return slug ? `${title} [${slug}]` : title;
}

/** Sources whose slug, short name, or title loosely contains (or is contained by) the query. */
function suggestSources(index: SourceIndex, query: string): string[] {
  const norm = normalizeSourceQuery(query);
  if (norm.length < 2) return [];
  return [...index.sources]
    .filter(([, s]) => [sourceSlug(s), s.name, s.description]
      .map(normalizeSourceQuery)
      .some(v => v.length >= 2 && (v.includes(norm) || norm.includes(v))))
    .slice(0, 8)
    .map(([id]) => sourceLabel(index, id));
}

function unknownSourceError(index: SourceIndex, source: string): string {
  const suggestions = suggestSources(index, source);
  return `Unknown source "${source}". ` + (suggestions.length
    ? `Did you mean: ${suggestions.join(", ")}?`
    : "Pass a book's short code as shown in brackets in ddb_search_monsters results (e.g. mm-2024, cos).");
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

/**
 * Name-search candidates for every spelling in the name's twin group (Thug and
 * Tough are one creature, but a search for one never returns the other),
 * merged in alias order, first copy of each id kept. Only the typed name's own
 * query (the first alias) fails the call; a failed alias query contributes nothing.
 */
async function fetchCandidates(name: string, take: number, sourceIds?: number[]): Promise<{ data: DdbMonster[]; access: AccessMap }> {
  // One snapshot for every alias query, as in fetchMonsterPages: lists fetched
  // either side of an account change must not merge.
  const snapshot = captureSession();
  const [typed, ...others] = twinAliases(name);
  const [first, ...rest] = await Promise.all([
    fetchMonsterList(typed, take, sourceIds),
    ...others.map(alias => fetchMonsterList(alias, take, sourceIds).catch(() => null)),
  ]);
  assertSessionCurrent(snapshot);
  const access: AccessMap = new Map();
  for (const list of [first, ...rest]) mergeAccess(access, list);
  return { data: dedupeById([first, ...rest].flatMap(list => list?.data ?? [])), access };
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
  search: string, sourceIds: number[], limit: number,
): Promise<{ data: DdbMonster[]; total: number; access: AccessMap }> {
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
  const access: AccessMap = new Map();
  for (const page of [first, ...rest]) mergeAccess(access, page);
  return { data, total, access };
}

/** Fetch (or serve from cache) one monster's stat block. */
async function fetchMonsterDetail(id: number): Promise<MonsterSingleResponse> {
  const cacheKey = `monster:${id}`;
  // Boundary check before the cache read, as in fetchMonsterList.
  const snapshot = captureSession();
  const cached = monsterCache.get(cacheKey);
  if (cached !== undefined) return JSON.parse(cached) as MonsterSingleResponse;

  const resp = await monsterFetch(`${MONSTER_SERVICE}/v1/Monster/${id}`);
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
 * Open5e substitute, so it yields no hint instead.
 */
async function availableSourcesFor(name: string, index: SourceIndex): Promise<string[]> {
  try {
    const all = await fetchMonsterList(name, 20);
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

/** `source: "homebrew"` is reserved: homebrew entries only. Checked before book resolution. */
function isHomebrewSource(source: string | undefined): boolean {
  return source?.trim().toLowerCase() === "homebrew";
}

export async function searchMonsters(params: {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  source?: string;
  rulesEdition?: RulesEdition;
}): Promise<string> {
  if (!hasValidSession()) {
    return await o5SearchMonsters(params, "unavailable").then(r => withSourceCaveat(r, params.source)).catch(
      () => "Monster search requires login. Run ddb_login first."
    );
  }
  const requested = params.rulesEdition ?? "2024";
  const homebrew = isHomebrewSource(params.source);

  try {
  const config = await getGameConfig();
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
  let sourceIds: number[] = [];
  if (params.source && !homebrew) {
    sourceIds = resolveSourceIds(index, params.source);
    if (!sourceIds.length) return unknownSourceError(index, params.source);
  }

  // Source filters server-side. CR/type/size (and homebrew) filter client-side,
  // so page through results (up to MAX_FILTER_SCAN) rather than judging one page.
  const attributeFilters = targetCrId !== undefined || Boolean(params.type) || Boolean(params.size);
  const clientFilters = attributeFilters || homebrew;
  const take = !searchTerm && params.source ? PAGE_SIZE : 20;
  const fetchTerm = async (term: string): Promise<{ data: DdbMonster[]; total: number; access: AccessMap }> => {
    if (clientFilters) return fetchMonsterPages(term, sourceIds, MAX_FILTER_SCAN);
    const page = await fetchMonsterList(term, take, sourceIds);
    const access: AccessMap = new Map();
    mergeAccess(access, page);
    return { data: page.data ?? [], total: page.pagination.total, access };
  };
  // Every spelling of the term's twin group (Thug and Tough are one creature,
  // but a search for one never returns the other), under one snapshot, as in
  // fetchCandidates. Only the typed term's own query fails the search.
  const snapshot = captureSession();
  const [typed, ...aliases] = searchTerm ? twinAliases(searchTerm) : [""];
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
  const partialScan = clientFilters && checked < total;

  const searchType = params.type?.toLowerCase();
  const searchSize = params.size?.toLowerCase();
  const passes = (m: DdbMonster) =>
    (targetCrId === undefined || m.challengeRatingId === targetCrId)
    && (!searchType || (typeMap.get(m.typeId) ?? "").toLowerCase().includes(searchType))
    && (!searchSize || (sizeName(config, m.sizeId) ?? "").toLowerCase().includes(searchSize));

  // With a source (a book, or homebrew), every matching entry is listed (no
  // edition selection, no swap); otherwise one entry per twin group, the other
  // edition's twins hidden, and a locked group shows its available twin.
  type Row = { m: DdbMonster; info: EditionInfo; reason?: SelectionReason };
  let monsters: Row[];
  let hidden = 0;
  if (homebrew) {
    // Fail closed, as the untrusted wrapping does: anything not explicitly official.
    monsters = fetched.filter(m => m.isHomebrew !== false && passes(m)).map(m => ({ m, info: HOMEBREW_INFO }));
  } else if (params.source) {
    monsters = fetched.filter(passes).map(m => ({ m, info: info(m) }));
  } else {
    const picked = groupAndSelect(fetched, requested, {
      info, twinKey: m => twinName(m.name), tiebreak: monsterTiebreak(index), passes,
      available: m => !isLockedIn(access, m.id),
    });
    monsters = picked.selected.map(s => ({ m: s.entry, info: s.info, reason: s.reason }));
    hidden = picked.hidden;
  }

  if (monsters.length === 0) {
    const scope = partialScan ? ` (checked the first ${checked} of ${total} entries)` : "";
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
        const available = await availableSourcesFor(searchTerm, index);
        if (available.length) msg += ` "${searchTerm}" appears in: ${available.join(", ")}.`;
      }
      return msg;
    }
    return await o5SearchMonsters(params, "not-found").catch(() => "No monsters found matching the search criteria.");
  }

  const matchedBy = searchTerm && params.source ? "matched by name and source"
    : searchTerm ? "matched by name"
    : params.source ? "matched by source"
    : "in the compendium";
  const shown = monsters.slice(0, PAGE_SIZE);

  const lines: string[] = [];
  if (homebrew) {
    // Homebrew has no edition, so no sourceNote.
    lines.push(searchHeader({ sourceBook: HOMEBREW_SOURCE_BOOK }));
  } else if (params.source) {
    // Slugs aren't unique; the lowest ID is the main book, not a premade-character pack.
    lines.push(searchHeader({ sourceBook: index.sources.get(Math.min(...sourceIds))!.book }));
    const bookRuleset = classifyEdition({ sources: sourceIds.map(sourceId => ({ sourceId })) }, index).ruleset;
    const note = isEdition(bookRuleset) ? sourceNote(params.source, bookRuleset, requested) : null;
    if (note) lines.push(note);
  } else {
    lines.push(searchHeader({ requested }));
  }
  const lockedNote = lockedEntriesNote(shown.filter(r => isLockedIn(access, r.m.id)).length);
  if (lockedNote) lines.push(lockedNote);

  // Totals count the result after hiding: the fetched entries the selection
  // dropped (hidden twins, same-edition duplicates) come off the service total.
  const header = clientFilters
    ? `${shown.length} shown of ${monsters.length} matching; checked ${checked} of ${total} ${matchedBy}`
    : `${shown.length} shown, ${total - (checked - monsters.length)} total ${matchedBy}`;
  lines.push(`**Monster Search** (${header})\n`);
  let swapped = 0;
  for (const { m, info: mInfo, reason } of shown) {
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
    let line = `- **${m.name}** ${editionTag(mInfo)}${tagStr} — ${sourceStr} — CR ${crStr}, ${size} ${typeName}, AC ${m.armorClass}, ${m.averageHitPoints} HP`;
    if (isLockedReason(reason)) {
      line += ` ${lockedLineSuffix(reason)}`;
      swapped++;
    }
    // Homebrew names are user-authored — delimit them, as getMonster does for
    // homebrew stat blocks. Fail closed: only an explicitly official entry is left plain.
    lines.push(m.isHomebrew === false ? line : wrapUntrusted(line));
  }

  if (shown.length < monsters.length) {
    lines.push(`\n*${monsters.length - shown.length} more matches not shown.*`);
  }
  if (partialScan) {
    lines.push(homebrew
      ? `\n*Only the first ${checked} of ${total} were checked for homebrew entries — add a name to narrow the search.*`
      : `\n*Only the first ${checked} of ${total} were checked against the CR/type/size filters — add a name or source to narrow the search.*`);
  } else if (!clientFilters && checked < total) {
    lines.push(`\n*Refine your search with a name term for more specific results.*`);
  }
  const summary = lockedSwapSummary(requested, swapped);
  if (summary) lines.push(summary);
  const footer = searchFooter(requested, hidden);
  if (footer) lines.push(footer);

  return lines.join("\n");
  } catch {
    return await o5SearchMonsters(params, "unavailable").then(r => withSourceCaveat(r, params.source)).catch(
      () => "Monster search unavailable — DnD Beyond and Open5e both failed."
    );
  }
}


/** Open5e has no concept of sources — flag that the filter wasn't honoured when one was requested. */
function withSourceCaveat(o5Result: string, source: string | undefined): string {
  if (!source) return o5Result;
  return `${o5Result}\n\n*Note: source filtering is not available via the Open5e SRD fallback — "${source}" was requested but could not be honoured.*`;
}

export async function getMonster(
  monsterName: string,
  opts: { source?: string; rulesEdition?: RulesEdition } = {},
): Promise<string> {
  const { source } = opts;
  const requested = opts.rulesEdition ?? "2024";
  monsterName = monsterName.trim();
  if (!monsterName) return "Monster name is required.";
  if (!hasValidSession()) {
    const o5Result = await o5GetMonster(monsterName, "unavailable").catch(() => null);
    if (o5Result) return withSourceCaveat(o5Result, source);
    return "Monster lookup requires login. Run ddb_login first.";
  }

  try {
    const config = await getGameConfig();
    // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
    const index = await getSourceIndex();
    const info = (m: DdbMonster) => classifyEdition(m, index);
    const tiebreak = monsterTiebreak(index);
    const homebrew = isHomebrewSource(source);
    let sourceIds: number[] = [];
    if (source && !homebrew) {
      sourceIds = resolveSourceIds(index, source);
      if (!sourceIds.length) return unknownSourceError(index, source);
    }

    // 20 slots per spelling so a crowded name (e.g. "Zombie" has Ash/Beholder/
    // Girallon/Greater/Ogre/Strahd/Yellow Musk/plain across both editions)
    // doesn't miss the intended entry.
    const { data: candidates, access } = await fetchCandidates(monsterName, 20, sourceIds);

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
      detail = await fetchMonsterDetail(pick.id);
      extras = { info: HOMEBREW_INFO };
    } else if (source) {
      // With a source, require an exact (twin) name: a partial match would
      // quietly turn "Zombie" in mm-2014 into Beholder Zombie. Near names are offered instead.
      const key = twinName(monsterName);
      const picked = selectByEdition(candidates.filter(m => twinName(m.name) === key), requested, info, tiebreak);
      if (!picked) {
        // A requested book is never silently swapped for another edition or the SRD.
        // Homebrew names are user-authored — keep them out of this hint.
        const similar = [...new Set(namedCandidates(candidates, monsterName).filter(m => !m.isHomebrew).map(m => m.name))].slice(0, 5);
        const available = await availableSourcesFor(monsterName, index);
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
      detail = await fetchMonsterDetail(picked.entry.id);
      const shown = info(detail.data);
      extras = {
        note: isEdition(shown.ruleset) ? sourceNote(source, shown.ruleset, requested) : null,
        // Only 2014/2024 entries are twins, so only they can be shown under
        // another name than the query's (as in lookupByName).
        renamed: isEdition(shown.ruleset) ? renamedFromQuery(monsterName, detail.data.name) : undefined,
        hint: isRestricted(detail)
          ? await availableElsewhere(monsterName, picked.entry, sourceIds, index).catch(() => null)
          : null,
      };
    } else {
      const lookup = (available: (m: DdbMonster) => boolean) => lookupByName(candidates, monsterName, requested, {
        name: m => m.name,
        info,
        tiebreak,
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
        const o5Result = await o5GetMonster(monsterName, "not-found").catch(() => null);
        if (o5Result) return o5Result;
        return `Monster "${monsterName}" not found. Try ddb_search_monsters with a partial name.`;
      }
      detail = await fetchMonsterDetail(found.entry.id);
      // The detail check is the fallback when the map lacked the id or called a
      // restricted pick available: try the next candidate in the same order,
      // at most one extra (cached) detail request.
      const first = found;
      if (isRestricted(detail) && !isLockedIn(access, first.entry.id)) {
        const retry = lookup(m => mapAvailable(m) && m.id !== first.entry.id);
        if (retry && retry.entry.id !== first.entry.id) {
          const retryDetail = await fetchMonsterDetail(retry.entry.id);
          if (!isRestricted(retryDetail)) {
            found = retry;
            detail = retryDetail;
          }
        }
      }
      extras = { reason: found.reason, renamed: found.renamed };

      // Still an empty stat block (unowned content): fall back to Open5e.
      if (isRestricted(detail)) {
        const o5Result = await o5GetMonster(monsterName, "unavailable").catch(() => null);
        if (o5Result) return o5Result;
      }
    }

    const statBlock = formatStatBlock(detail.data, detail.accessType, config, index, extras);
    // Homebrew stat blocks are user-authored free text (trait/action
    // descriptions) — delimit as untrusted. Official WotC content is not.
    // Fail closed: only an explicitly official entry is left plain.
    return detail.data.isHomebrew === false ? statBlock : wrapUntrusted(statBlock);
  } catch {
    const o5Result = await o5GetMonster(monsterName, "unavailable").catch(() => null);
    if (o5Result) return withSourceCaveat(o5Result, source);
    return `Monster "${monsterName}" not found. DnD Beyond is unavailable and "${monsterName}" is not in the SRD.`;
  }
}

/**
 * For a restricted pick in a requested book: the first official entry of its
 * twin group, by tiebreak, that the list map doesn't mark locked and that isn't
 * in that book, as a hint line. Books the index doesn't know are skipped (same
 * filter as availableSourcesFor). A book with no slug is passed by short name.
 */
async function availableElsewhere(
  name: string, pick: DdbMonster, sourceIds: number[], index: SourceIndex,
): Promise<string | null> {
  const { data, access } = await fetchCandidates(name, 20);
  const key = twinName(pick.name);
  const inBook = (m: DdbMonster) =>
    sourceIds.includes(m.sourceId) || (m.sources ?? []).some(s => sourceIds.includes(s.sourceId));
  const alt = data
    .filter(m => twinName(m.name) === key && m.isHomebrew === false && index.sources.has(m.sourceId)
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
  const typed = twinName.spell?.(normalizedQuery) ?? query.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  return normalizeName(shownName) === twinName(shownName)
    ? { name2014: typed, name2024: shownName }
    : { name2014: shownName, name2024: typed };
}

export type MonsterStatsResult =
  | { status: "found"; name: string; crValue: number; xp: number; info: EditionInfo }
  | { status: "not-found" }
  | { status: "ambiguous"; candidates: Array<{ name: string; crValue: number; xp: number }> };

/**
 * CR and XP for a named monster, for the encounter rater and the treasure
 * generator. Tries the DDB monster service first, then falls back to Open5e.
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
  if (hasValidSession()) {
    try {
      const config = await getGameConfig();
      // No extra request: getGameConfig() serves this call from its cache (or its failure cache).
      const index = await getSourceIndex();
      const info = (m: DdbMonster) => classifyEdition(m, index);
      const tiebreak = monsterTiebreak(index);
      const crById = new Map((config?.challengeRatings ?? []).map(cr => [cr.id, cr]));
      const official = (await fetchCandidates(name, 20)).data
        .filter(m => m.isHomebrew === false && crById.has(m.challengeRatingId));
      const stats = (m: DdbMonster) => {
        const cr = crById.get(m.challengeRatingId)!;
        return { name: m.name, crValue: cr.value, xp: cr.xp };
      };
      const found = (group: DdbMonster[]): MonsterStatsResult | null => {
        const picked = selectByEdition(group, requested, info, tiebreak);
        return picked ? { status: "found", ...stats(picked.entry), info: info(picked.entry) } : null;
      };

      const key = twinName(name);
      const exact = official.filter(m => twinName(m.name) === key);
      if (exact.length) {
        const result = found(exact);
        if (result) return result;
      }

      const query = normalizeName(name);
      const groups = new Map<string, DdbMonster[]>();
      for (const m of official) {
        if (!normalizeName(m.name).includes(query)) continue;
        const k = twinName(m.name);
        groups.set(k, [...(groups.get(k) ?? []), m]);
      }
      if (groups.size === 1) {
        const result = found([...groups.values()][0]);
        if (result) return result;
      } else if (groups.size > 1) {
        const candidates = [...groups.values()]
          .map(group => selectByEdition(group, requested, info, tiebreak))
          .filter(picked => picked !== null)
          .map(picked => stats(picked.entry))
          .sort((a, b) => a.crValue - b.crValue || a.name.localeCompare(b.name));
        return { status: "ambiguous", candidates };
      }
    } catch {
      // fall through to Open5e
    }
  }

  // Open5e fallback: its monsters are SRD 5.1 (2014) until phase 4 moves it to v2.
  const o5 = await o5GetMonsterStats(name);
  return o5 ? { status: "found", ...o5, info: { ruleset: "2014", book: null } } : { status: "not-found" };
}
