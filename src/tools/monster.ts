/**
 * monster.ts — DDB monster service tools
 *
 * API host: monster-service.dndbeyond.com
 * Auth: Bearer cobalt token (same as character service)
 * Envelope: { accessType, pagination, data } for list; { accessType, data } for single
 *
 * Game config (CR values, type names, etc.) is fetched from
 * https://www.dndbeyond.com/api/config/json and cached for 24 h.
 */

import { sessionFetch, getCobaltToken, hasValidSession } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { wrapUntrusted } from "../utils.js";
import { o5SearchMonsters, o5GetMonster } from "../open5e.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONSTER_SERVICE = "https://monster-service.dndbeyond.com";
const CONFIG_URL = "https://www.dndbeyond.com/api/config/json";

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

// ── Game config ───────────────────────────────────────────────────────────────

interface GameConfig {
  challengeRatings: Array<{ id: number; value: number; xp: number; proficiencyBonus: number }>;
  monsterTypes: Array<{ id: number; name: string }>;
  alignments: Array<{ id: number; name: string }>;
  senses: Array<{ id: number; name: string }>;
}

let configCache: GameConfig | null = null;

async function getGameConfig(): Promise<GameConfig | null> {
  if (configCache) return configCache;
  try {
    const resp = await sessionFetch(CONFIG_URL);
    if (!resp.ok) return null;
    const json = await resp.json() as { data?: GameConfig } | GameConfig;
    const cfg = (json as { data?: GameConfig }).data ?? (json as GameConfig);
    if (cfg.challengeRatings) {
      configCache = cfg;
      return cfg;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  stats: Array<{ statId: number; value: number }>;
  savingThrows: Array<{ statId: number; bonusModifier: number }>;
  senses: Array<{ senseId: number; notes: string }>;
  movements: Array<{ movementId: number; speed: number; notes: string | null }>;
  languageDescription: string;
  languageNote: string;
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
  const { token } = await getCobaltToken();
  return sessionFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatStatBlock(m: DdbMonster, accessType: number, config: GameConfig | null): string {
  const crEntry = config?.challengeRatings.find(cr => cr.id === m.challengeRatingId);
  const crStr = crEntry ? crDisplay(crEntry.value) : `(id:${m.challengeRatingId})`;
  const xpStr = crEntry?.xp ? ` (${crEntry.xp.toLocaleString()} XP)` : "";
  const typeName = config?.monsterTypes.find(t => t.id === m.typeId)?.name ?? `type ${m.typeId}`;
  const sizeName = SIZE_MAP[m.sizeId] ?? `size ${m.sizeId}`;
  const alignment = config?.alignments.find(a => a.id === m.alignmentId)?.name ?? "Unaligned";

  const lines: string[] = [];
  lines.push(`# ${m.name}`);
  lines.push(`*${sizeName} ${typeName}, ${alignment}*\n`);
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

  if (m.languageDescription) {
    lines.push(`**Languages** ${m.languageDescription}${m.languageNote ? " " + m.languageNote : ""}`);
  }

  lines.push(`**Challenge** ${crStr}${xpStr}`);

  if (m.specialTraitsDescription) {
    lines.push("\n---\n");
    lines.push(stripHtml(m.specialTraitsDescription));
  }
  if (m.actionsDescription) {
    lines.push("\n## Actions\n");
    lines.push(stripHtml(m.actionsDescription));
  }
  if (m.bonusActionsDescription) {
    lines.push("\n## Bonus Actions\n");
    lines.push(stripHtml(m.bonusActionsDescription));
  }
  if (m.reactionsDescription) {
    lines.push("\n## Reactions\n");
    lines.push(stripHtml(m.reactionsDescription));
  }
  if (m.legendaryActionsDescription) {
    lines.push("\n## Legendary Actions\n");
    lines.push(stripHtml(m.legendaryActionsDescription));
  }
  if (m.mythicActionsDescription) {
    lines.push("\n## Mythic Actions\n");
    lines.push(stripHtml(m.mythicActionsDescription));
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
}): Promise<string> {
  if (!hasValidSession()) {
    return await o5SearchMonsters(params).catch(
      () => "Monster search requires login. Run ddb_login first."
    );
  }

  try {
  const config = await getGameConfig();
  const crMap = new Map(config?.challengeRatings.map(cr => [cr.id, cr]) ?? []);
  const typeMap = new Map(config?.monsterTypes.map(t => [t.id, t.name]) ?? []);

  const searchTerm = params.name ?? "";

  // Resolve filter IDs up front so we can pass them to the API.
  const targetCrId = params.cr !== undefined
    ? config?.challengeRatings.find(cr => cr.value === params.cr)?.id
    : undefined;
  const targetTypeId = params.type
    ? config?.monsterTypes.find(t => t.name.toLowerCase().includes(params.type!.toLowerCase()))?.id
    : undefined;
  const targetSizeId = params.size
    ? Object.entries(SIZE_MAP).find(([, name]) => name.toLowerCase().includes(params.size!.toLowerCase()))?.[0]
    : undefined;

  // When filtering without a name term, fetch more results since the API
  // only sorts/filters by name — CR/type/size filtering is client-side.
  const hasFiltersOnly = !params.name && (params.cr !== undefined || params.type || params.size);
  const take = hasFiltersOnly ? 100 : 20;

  const cacheKey = `monsters:search:${searchTerm.toLowerCase()}:cr${targetCrId ?? ""}:type${targetTypeId ?? ""}:size${targetSizeId ?? ""}:take${take}`;
  const cached = monsterCache.get(cacheKey);
  let response: MonsterListResponse;

  if (cached !== undefined) {
    response = JSON.parse(cached) as MonsterListResponse;
  } else {
    const url = `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(searchTerm)}&skip=0&take=${take}`;
    const resp = await monsterFetch(url);
    if (!resp.ok) throw new Error(`Monster search failed: ${resp.status} ${resp.statusText}`);
    response = await resp.json() as MonsterListResponse;
    monsterCache.set(cacheKey, JSON.stringify(response));
  }

  let monsters = response.data ?? [];

  if (targetCrId !== undefined) {
    monsters = monsters.filter(m => m.challengeRatingId === targetCrId);
  }
  if (params.type) {
    const searchType = params.type.toLowerCase();
    monsters = monsters.filter(m => (typeMap.get(m.typeId) ?? "").toLowerCase().includes(searchType));
  }
  if (params.size) {
    const searchSize = params.size.toLowerCase();
    monsters = monsters.filter(m => (SIZE_MAP[m.sizeId] ?? "").toLowerCase().includes(searchSize));
  }

  if (monsters.length === 0) {
    return await o5SearchMonsters(params).catch(() => "No monsters found matching the search criteria.");
  }

  const lines = [`**Monster Search** (${monsters.length} shown, ${response.pagination.total} total matched by name)\n`];
  for (const m of monsters) {
    const cr = crMap.get(m.challengeRatingId);
    const crStr = cr ? crDisplay(cr.value) : "?";
    const typeName = typeMap.get(m.typeId) ?? "Unknown";
    const sizeName = SIZE_MAP[m.sizeId] ?? "Unknown";
    const tags: string[] = [];
    if (m.isLegendary) tags.push("Legendary");
    if (m.isMythic) tags.push("Mythic");
    if (m.isHomebrew) tags.push("Homebrew");
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    lines.push(`- **${m.name}**${tagStr} — CR ${crStr}, ${sizeName} ${typeName}, AC ${m.armorClass}, ${m.averageHitPoints} HP`);
  }

  if (response.pagination.total > take) {
    lines.push(`\n*Refine your search with a name term for more specific results.*`);
  }

  return lines.join("\n");
  } catch {
    return await o5SearchMonsters(params).catch(
      () => "Monster search unavailable — DnD Beyond and Open5e both failed."
    );
  }
}


export async function getMonster(monsterName: string): Promise<string> {
  if (!hasValidSession()) {
    const o5Result = await o5GetMonster(monsterName).catch(() => null);
    if (o5Result) return o5Result;
    return "Monster lookup requires login. Run ddb_login first.";
  }

  try {
    const searchUrl = `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(monsterName)}&skip=0&take=5`;
    const searchCacheKey = `monsters:search:${monsterName.toLowerCase()}:5`;
    const cachedSearch = monsterCache.get(searchCacheKey);

    let searchResp: MonsterListResponse;
    if (cachedSearch !== undefined) {
      searchResp = JSON.parse(cachedSearch) as MonsterListResponse;
    } else {
      const resp = await monsterFetch(searchUrl);
      if (!resp.ok) throw new Error(`Monster search failed: ${resp.status} ${resp.statusText}`);
      searchResp = await resp.json() as MonsterListResponse;
      monsterCache.set(searchCacheKey, JSON.stringify(searchResp));
    }

    if (!searchResp.data?.length) {
      const o5Result = await o5GetMonster(monsterName).catch(() => null);
      if (o5Result) return o5Result;
      return `Monster "${monsterName}" not found. Try ddb_search_monsters with a partial name.`;
    }

    const nameLower = monsterName.toLowerCase();
    const best = searchResp.data.find(m => m.name.toLowerCase() === nameLower)
      ?? searchResp.data[0];

    const detailUrl = `${MONSTER_SERVICE}/v1/Monster/${best.id}`;
    const detailCacheKey = `monster:${best.id}`;
    const cachedDetail = monsterCache.get(detailCacheKey);

    let detail: MonsterSingleResponse;
    if (cachedDetail !== undefined) {
      detail = JSON.parse(cachedDetail) as MonsterSingleResponse;
    } else {
      const resp = await monsterFetch(detailUrl);
      if (!resp.ok) throw new Error(`Monster fetch failed: ${resp.status} ${resp.statusText}`);
      detail = await resp.json() as MonsterSingleResponse;
      monsterCache.set(detailCacheKey, JSON.stringify(detail));
    }

    const config = await getGameConfig();
    const statBlock = formatStatBlock(detail.data, detail.accessType, config);

    // If DDB returned an empty stat block (unowned content), fall back to Open5e
    if (detail.accessType === 4 && !detail.data.stats?.length) {
      const o5Result = await o5GetMonster(monsterName).catch(() => null);
      if (o5Result) return o5Result;
    }

    // Homebrew stat blocks are user-authored free text (trait/action
    // descriptions) — delimit as untrusted. Official WotC content is not.
    return detail.data.isHomebrew ? wrapUntrusted(statBlock) : statBlock;
  } catch {
    const o5Result = await o5GetMonster(monsterName).catch(() => null);
    if (o5Result) return o5Result;
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
 * Returns CR and XP for a named monster. Used by the encounter difficulty rater.
 * Tries the DDB monster service first, then falls back to Open5e.
 */
export async function getMonsterStats(name: string): Promise<{
  name: string;
  crValue: number;
  xp: number;
} | null> {
  // DDB path
  if (hasValidSession()) {
    try {
      const config = await getGameConfig();
      const resp = await monsterFetch(
        `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(name)}&skip=0&take=5`
      );
      if (resp.ok) {
        const json = await resp.json() as MonsterListResponse;
        const match =
          json.data.find(m => m.name.toLowerCase() === name.toLowerCase()) ??
          json.data.find(m => m.name.toLowerCase().includes(name.toLowerCase()));
        if (match && config) {
          const crEntry = config.challengeRatings.find(cr => cr.id === match.challengeRatingId);
          if (crEntry) {
            return { name: match.name, crValue: crEntry.value, xp: crEntry.xp };
          }
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
      const match =
        data.results.find(m => m.name.toLowerCase() === name.toLowerCase()) ??
        data.results[0];
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
