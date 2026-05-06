/**
 * reference.ts — Game reference tools: conditions, spells, items
 *
 * Conditions: hardcoded lookup table, no API required.
 * Spells: built from character-service always-known/prepared endpoints
 *         across all 8 spellcasting classes; cached 24 h.
 * Items: single game-data/items endpoint; cached 24 h.
 *
 * All character-service endpoints use the cobalt Bearer token.
 */

import { sessionFetch, getCobaltToken } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import {
  fetchO5Cantrips, o5SearchSpells, o5GetSpell,
  o5SearchItems, o5GetItem,
  o5GetWeapon, o5GetArmor,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchSections, o5GetSection,
} from "../open5e.js";

const CHARACTER_SERVICE = "https://character-service.dndbeyond.com";

// ── Cache ─────────────────────────────────────────────────────────────────────

const referenceCache = new TtlCache<string>(24 * 60 * 60_000, 50);

// ── Auth helper ───────────────────────────────────────────────────────────────

async function refFetch(url: string): Promise<Response> {
  const { token } = await getCobaltToken();
  return sessionFetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

// ── HTML strip ────────────────────────────────────────────────────────────────

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1))))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

interface SpellDefinition {
  name: string;
  level: number;
  school: string;
  description: string;
  snippet?: string;
  concentration: boolean;
  ritual: boolean;
  components?: number[];
  componentsDescription?: string;
  activation?: { activationTime: number; activationType: number };
  range?: { origin: string; rangeValue?: number; aoeType?: string; aoeValue?: number };
  duration?: { durationInterval?: number; durationUnit?: string; durationType?: string };
}

interface DdbSpell {
  definition: SpellDefinition;
}

let spellCompendium: DdbSpell[] | null = null;

function parseO5Range(rangeStr: string): SpellDefinition["range"] {
  if (!rangeStr) return undefined;
  const s = rangeStr.trim();
  if (/^self$/i.test(s)) return { origin: "Self" };
  if (/^touch$/i.test(s)) return { origin: "Touch" };
  if (/^unlimited$/i.test(s)) return { origin: "Unlimited" };
  const match = s.match(/^(\d+)\s*(?:feet|foot|ft\.?)/i);
  if (match) return { origin: "Ranged", rangeValue: parseInt(match[1], 10) };
  return { origin: s };
}

function parseO5Components(compStr: string): { components: number[]; componentsDescription?: string } {
  if (!compStr) return { components: [] };
  const matMatch = compStr.match(/\(([^)]+)\)/);
  const matDesc = matMatch ? matMatch[1] : undefined;
  const MAP: Record<string, number> = { V: 1, S: 2, M: 3 };
  const components = compStr
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map(s => MAP[s.trim().toUpperCase()])
    .filter(Boolean) as number[];
  return { components, ...(matDesc ? { componentsDescription: matDesc } : {}) };
}

// Spells extracted from character JSON (cantrips, Warlock choices, etc.)
// These are chosen spells absent from always-known/prepared endpoints.
const characterSpellBuffer = new Map<string, DdbSpell>();

async function loadSpellCompendium(): Promise<DdbSpell[]> {
  if (spellCompendium) return spellCompendium;

  const cached = referenceCache.get("spell-compendium");
  if (cached) {
    spellCompendium = JSON.parse(cached) as DdbSpell[];
    return spellCompendium;
  }

  const allSpells = new Map<string, DdbSpell>();

  // Build all 32 request combos (8 classes × 2 endpoints × 2 levels) and fire in parallel.
  // JS is single-threaded so Map writes between await points are race-free.
  const tasks = SPELLCASTING_CLASS_IDS.flatMap(classId =>
    (["always-known-spells", "always-prepared-spells"] as const).flatMap(endpoint =>
      ([1, 20] as const).map(level => ({ classId, endpoint, level }))
    )
  );
  await Promise.all(tasks.map(async ({ classId, endpoint, level }) => {
    try {
      // classLevel=1 gets auto-granted spells, classLevel=20 gets the full list
      const url = `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=${level}&sharingSetting=2`;
      const resp = await refFetch(url);
      if (!resp.ok) return;
      const json = await resp.json() as { data?: DdbSpell[] } | DdbSpell[];
      const spells = (Array.isArray(json) ? json : json.data) ?? [];
      for (const spell of spells) {
        const name = spell.definition?.name;
        if (name && !allSpells.has(name)) {
          allSpells.set(name, spell);
        }
      }
    } catch {
      // Continue — partial compendium is still useful
    }
  }));

  if (allSpells.size === 0) {
    throw new Error("Failed to load spell compendium — all API requests failed. Check login status.");
  }

  // Merge character-sourced spells (cantrips, Warlock choices, etc.)
  for (const [name, spell] of characterSpellBuffer) {
    if (!allSpells.has(name)) allSpells.set(name, spell);
  }

  // Supplement with SRD cantrips from Open5e (covers cold lookups before any character is loaded)
  try {
    const cantrips = await fetchO5Cantrips();
    for (const c of cantrips) {
      if (!allSpells.has(c.name)) {
        const { components, componentsDescription } = parseO5Components(c.components);
        allSpells.set(c.name, {
          definition: {
            name: c.name,
            level: c.level_int,
            school: c.school,
            description: c.desc,
            concentration: c.requires_concentration,
            ritual: c.ritual === "yes",
            activation: { activationTime: 1, activationType: 1 },
            range: parseO5Range(c.range),
            components,
            ...(componentsDescription ? { componentsDescription } : {}),
          },
        });
      }
    }
  } catch {
    // Open5e down — proceed without SRD cantrips from this source
  }

  spellCompendium = Array.from(allSpells.values());
  referenceCache.set("spell-compendium", JSON.stringify(spellCompendium));
  return spellCompendium;
}

/**
 * Supplements the spell compendium with spells from a parsed character's
 * classSpells array. Captures cantrips and chosen spells absent from the
 * always-known endpoints. Called from parseCharacterData().
 */
export function addCharacterSpellsToCompendium(char: Record<string, unknown>): void {
  const arrOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const objOf = (v: unknown): Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};

  let added = false;
  for (const cs of arrOf<Record<string, unknown>>(char.classSpells)) {
    for (const spell of arrOf<Record<string, unknown>>(cs.spells)) {
      const name = objOf(spell.definition).name as string | undefined;
      if (name && !characterSpellBuffer.has(name)) {
        characterSpellBuffer.set(name, spell as unknown as DdbSpell);
        added = true;
      }
    }
  }

  // Merge immediately into the live compendium if already loaded
  if (added && spellCompendium) {
    const existing = new Set(spellCompendium.map(s => s.definition?.name));
    for (const [name, spell] of characterSpellBuffer) {
      if (!existing.has(name)) spellCompendium.push(spell);
    }
    referenceCache.set("spell-compendium", JSON.stringify(spellCompendium));
  }
}

function formatSpell(spell: DdbSpell): string {
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
}): Promise<string> {
  try {
    const spells = await loadSpellCompendium();
    let matched = spells;

    if (params.name) {
      const q = params.name.toLowerCase();
      matched = matched.filter(s => s.definition.name.toLowerCase().includes(q));
    }
    if (params.level !== undefined) {
      matched = matched.filter(s => s.definition.level === params.level);
    }
    if (params.school) {
      const q = params.school.toLowerCase();
      matched = matched.filter(s => s.definition.school.toLowerCase().includes(q));
    }
    if (params.concentration !== undefined) {
      matched = matched.filter(s => s.definition.concentration === params.concentration);
    }
    if (params.ritual !== undefined) {
      matched = matched.filter(s => s.definition.ritual === params.ritual);
    }

    matched.sort((a, b) => {
      if (a.definition.level !== b.definition.level) return a.definition.level - b.definition.level;
      return a.definition.name.localeCompare(b.definition.name);
    });

    const total = matched.length;
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const page = matched.slice(offset, offset + limit);

    if (page.length === 0) return "No spells found matching the criteria.";

    const header = total > limit
      ? `**Spell Search** — showing ${offset + 1}–${offset + page.length} of ${total}`
      : `**Spell Search** (${total} found)`;

    const lines = [header + "\n"];
    for (const s of page) {
      const d = s.definition;
      const level = d.level === 0 ? "Cantrip" : `Level ${d.level}`;
      const tags: string[] = [];
      if (d.concentration) tags.push("Conc.");
      if (d.ritual) tags.push("Ritual");
      const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
      lines.push(`- **${d.name}** — ${level} ${d.school}${tagStr}`);
    }
    if (total > offset + limit) {
      lines.push(`\n*Use offset: ${offset + limit} to see more.*`);
    }
    return lines.join("\n");
  } catch (err) {
    try {
      return await o5SearchSpells(params);
    } catch {
      throw err;
    }
  }
}

export async function getSpell(spellName: string): Promise<string> {
  try {
    const spells = await loadSpellCompendium();
    const q = spellName.toLowerCase();

    const spell = spells.find(s => s.definition.name.toLowerCase() === q)
      ?? spells.find(s => s.definition.name.toLowerCase().includes(q));

    if (!spell) {
      const o5Result = await o5GetSpell(spellName).catch(() => null);
      if (o5Result) return o5Result;
      return `Spell "${spellName}" not found in the compendium. Try ddb_search_spells with a partial name.`;
    }

    return formatSpell(spell);
  } catch (err) {
    try {
      const o5Result = await o5GetSpell(spellName);
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
    return await o5SearchItems(params.name ?? "").catch(
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
        const result = await fallback(itemName).catch(() => null);
        if (result) return result;
      }
      return `Item "${itemName}" not found. Try ddb_search_equipment with a partial name.`;
    }

    return formatItem(item);
  } catch (err) {
    for (const fallback of [o5GetItem, o5GetWeapon, o5GetArmor]) {
      try {
        const result = await fallback(itemName);
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
    const cacheKey = "game-data:races";
    const cached = referenceCache.get(cacheKey);

    let races: DdbRace[];
    if (cached) {
      races = JSON.parse(cached) as DdbRace[];
    } else {
      const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/races`);
      if (!resp.ok) throw new Error(`Races fetch failed: ${resp.status} ${resp.statusText}`);
      const json = await resp.json() as { data?: DdbRace[] } | DdbRace[];
      races = (Array.isArray(json) ? json : json.data) ?? [];
      referenceCache.set(cacheKey, JSON.stringify(races));
    }

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
      return await o5SearchRaces(name).catch(() => `No races found matching "${name}".`);
    }
    return result;
  } catch {
    return await o5SearchRaces(name).catch(
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
    const cacheKey = "game-data:classes";
    const cached = referenceCache.get(cacheKey);

    let classes: DdbClass[];
    if (cached) {
      classes = JSON.parse(cached) as DdbClass[];
    } else {
      const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/classes`);
      if (!resp.ok) throw new Error(`Classes fetch failed: ${resp.status} ${resp.statusText}`);
      const json = await resp.json() as { data?: DdbClass[] } | DdbClass[];
      classes = (Array.isArray(json) ? json : json.data) ?? [];
      referenceCache.set(cacheKey, JSON.stringify(classes));
    }

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
      return await o5SearchClasses(name).catch(() => `No classes found matching "${name}".`);
    }
    return result;
  } catch {
    return await o5SearchClasses(name).catch(
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
      return await o5SearchBackgrounds(name).catch(() => `No backgrounds found matching "${name}".`);
    }
    return result;
  } catch {
    return await o5SearchBackgrounds(name).catch(
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
      return await o5SearchFeats(params.name).catch(() => "No feats found matching the search criteria.");
    }
    return result;
  } catch {
    return await o5SearchFeats(params.name).catch(
      () => "Feats unavailable — DnD Beyond and Open5e both failed."
    );
  }
}

// ── Class Features ────────────────────────────────────────────────────────────

interface DdbClassFeature {
  id: number;
  name: string;
  description: string;
  snippet: string;
  requiredLevel: number;
  classId: number;
  className?: string;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
}

export async function searchClassFeatures(params: {
  name?: string;
  className?: string;
  level?: number;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const cacheKey = "game-data:class-features";
  const cached = referenceCache.get(cacheKey);

  let features: DdbClassFeature[];
  if (cached) {
    features = JSON.parse(cached) as DdbClassFeature[];
  } else {
    const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/class-feature/collection`);
    if (resp.status === 404) {
      return "Class feature search is not available on this account. Use ddb_character_lookup with a character_name to look up features for a specific character instead.";
    }
    if (!resp.ok) throw new Error(`Class features fetch failed: ${resp.status} ${resp.statusText}`);
    const json = await resp.json() as { data?: DdbClassFeature[] } | DdbClassFeature[];
    features = (Array.isArray(json) ? json : json.data) ?? [];
    referenceCache.set(cacheKey, JSON.stringify(features));
  }

  let matched = features;

  if (params.name) {
    const q = params.name.toLowerCase();
    matched = matched.filter(f => f.name.toLowerCase().includes(q));
  }

  if (params.className) {
    const q = params.className.toLowerCase();
    matched = matched.filter(f => f.className?.toLowerCase().includes(q));
  }

  if (params.level !== undefined) {
    matched = matched.filter(f => f.requiredLevel === params.level);
  }

  matched.sort((a, b) => {
    const classComp = (a.className || "").localeCompare(b.className || "");
    if (classComp !== 0) return classComp;
    if (a.requiredLevel !== b.requiredLevel) return a.requiredLevel - b.requiredLevel;
    return a.name.localeCompare(b.name);
  });

  if (matched.length === 0) return "No class features found matching the search criteria.";

  return paginateResults(
    "Class Feature",
    matched,
    feature => {
      const className = feature.className || "Unknown";
      const level = feature.requiredLevel ?? "?";
      const desc = stripHtml(feature.snippet || feature.description || "").slice(0, 100);
      return `- **${feature.name}** — ${className} level ${level}${desc ? `\n  ${desc}${desc.length >= 100 ? "..." : ""}` : ""}`;
    },
    params.limit ?? 30,
    params.offset ?? 0,
  );
}

// ── Racial Traits ─────────────────────────────────────────────────────────────

interface DdbRacialTrait {
  id: number;
  name: string;
  description: string;
  snippet: string;
  raceId: number;
  raceName?: string;
  isHomebrew: boolean;
  sources: Array<{ sourceId: number }>;
}

export async function searchRacialTraits(params: {
  name?: string;
  raceName?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const cacheKey = "game-data:racial-traits";
  const cached = referenceCache.get(cacheKey);

  let traits: DdbRacialTrait[];
  if (cached) {
    traits = JSON.parse(cached) as DdbRacialTrait[];
  } else {
    const resp = await refFetch(`${CHARACTER_SERVICE}/character/v5/game-data/racial-trait/collection`);
    if (!resp.ok) throw new Error(`Racial traits fetch failed: ${resp.status} ${resp.statusText}`);
    const json = await resp.json() as Record<string, unknown> | DdbRacialTrait[];
    let raw: unknown = json;
    if (!Array.isArray(raw)) {
      raw = (json as Record<string, unknown>).data
         ?? (json as Record<string, unknown>).collection
         ?? (json as Record<string, unknown>).results
         ?? [];
    }
    traits = Array.isArray(raw) ? (raw as DdbRacialTrait[]) : [];
    if (traits.length === 0) {
      process.stderr.write(`[ddb-mcp] racial-trait/collection response keys: ${Object.keys(json as object).join(", ")}\n`);
    }
    referenceCache.set(cacheKey, JSON.stringify(traits));
  }

  let matched = traits;

  if (params.name) {
    const q = params.name.toLowerCase();
    matched = matched.filter(t => t.name.toLowerCase().includes(q));
  }

  if (params.raceName) {
    const q = params.raceName.toLowerCase();
    matched = matched.filter(t => t.raceName?.toLowerCase().includes(q));
  }

  matched.sort((a, b) => {
    const raceComp = (a.raceName || "").localeCompare(b.raceName || "");
    if (raceComp !== 0) return raceComp;
    return a.name.localeCompare(b.name);
  });

  if (matched.length === 0) return "No racial traits found matching the search criteria.";

  return paginateResults(
    "Racial Trait",
    matched,
    trait => {
      const raceName = trait.raceName || "Unknown";
      const desc = stripHtml(trait.snippet || trait.description || "").slice(0, 100);
      return `- **${trait.name}** *(${raceName})*${desc ? ` — ${desc}${desc.length >= 100 ? "..." : ""}` : ""}`;
    },
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
