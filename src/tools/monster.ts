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
    return "Monster search requires login. Run ddb_login first.";
  }

  const searchTerm = params.name ?? "";
  const url = `${MONSTER_SERVICE}/v1/Monster?search=${encodeURIComponent(searchTerm)}&skip=0&take=20`;

  const cacheKey = `monsters:search:${searchTerm.toLowerCase()}`;
  const cached = monsterCache.get(cacheKey);
  let response: MonsterListResponse;

  if (cached !== undefined) {
    response = JSON.parse(cached) as MonsterListResponse;
  } else {
    const resp = await monsterFetch(url);
    if (!resp.ok) throw new Error(`Monster search failed: ${resp.status} ${resp.statusText}`);
    response = await resp.json() as MonsterListResponse;
    monsterCache.set(cacheKey, JSON.stringify(response));
  }

  const config = await getGameConfig();
  const crMap = new Map(config?.challengeRatings.map(cr => [cr.id, cr]) ?? []);
  const typeMap = new Map(config?.monsterTypes.map(t => [t.id, t.name]) ?? []);

  let monsters = response.data ?? [];

  if (params.cr !== undefined) {
    const targetCrId = config?.challengeRatings.find(cr => cr.value === params.cr)?.id;
    if (targetCrId !== undefined) {
      monsters = monsters.filter(m => m.challengeRatingId === targetCrId);
    }
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
    return "No monsters found matching the search criteria.";
  }

  const lines = [`**Monster Search** (${monsters.length} of ${response.pagination.total} total)\n`];
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

  if (response.pagination.total > 20) {
    lines.push(`\n*Showing first 20 of ${response.pagination.total}. Refine your search for more specific results.*`);
  }

  return lines.join("\n");
}

export async function getMonster(monsterName: string): Promise<string> {
  if (!hasValidSession()) {
    return "Monster lookup requires login. Run ddb_login first.";
  }

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
  return formatStatBlock(detail.data, detail.accessType, config);
}
