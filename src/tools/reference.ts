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

// Standard spellcasting class IDs on DDB (Bard=1 through Wizard=8)
const SPELLCASTING_CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

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

async function loadSpellCompendium(): Promise<DdbSpell[]> {
  if (spellCompendium) return spellCompendium;

  const cached = referenceCache.get("spell-compendium");
  if (cached) {
    spellCompendium = JSON.parse(cached) as DdbSpell[];
    return spellCompendium;
  }

  const allSpells = new Map<string, DdbSpell>();

  for (const classId of SPELLCASTING_CLASS_IDS) {
    for (const endpoint of ["always-known-spells", "always-prepared-spells"]) {
      for (const level of [1, 20]) { // level=1 gets cantrips, level=20 gets levels 1-9
        try {
          const url = `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=${level}&sharingSetting=2`;
          const resp = await refFetch(url);
          if (!resp.ok) continue;
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
      }
    }
  }

  if (allSpells.size === 0) {
    throw new Error("Failed to load spell compendium — all API requests failed. Check login status.");
  }

  spellCompendium = Array.from(allSpells.values());
  referenceCache.set("spell-compendium", JSON.stringify(spellCompendium));
  return spellCompendium;
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
}): Promise<string> {
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

  if (matched.length === 0) return "No spells found matching the criteria.";

  const lines = [`**Spell Search** (${matched.length} found)\n`];
  for (const s of matched) {
    const d = s.definition;
    const level = d.level === 0 ? "Cantrip" : `Level ${d.level}`;
    const tags: string[] = [];
    if (d.concentration) tags.push("Conc.");
    if (d.ritual) tags.push("Ritual");
    const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
    lines.push(`- **${d.name}** — ${level} ${d.school}${tagStr}`);
  }
  return lines.join("\n");
}

export async function getSpell(spellName: string): Promise<string> {
  const spells = await loadSpellCompendium();
  const q = spellName.toLowerCase();

  const spell = spells.find(s => s.definition.name.toLowerCase() === q)
    ?? spells.find(s => s.definition.name.toLowerCase().includes(q));

  if (!spell) {
    return `Spell "${spellName}" not found in the compendium. Try ddb_search_spells with a partial name.`;
  }

  return formatSpell(spell);
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
  damage: { diceString: string } | null;
  properties: Array<{ name: string }> | null;
  armorClass: number | null;
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
  if (item.armorClass) lines.push(`AC: ${item.armorClass}`);
  if (item.damage?.diceString) lines.push(`Damage: ${item.damage.diceString}`);
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

  if (shown.length === 0) return "No items found matching the criteria.";

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
  const items = await loadItemCompendium();
  const q = itemName.toLowerCase();

  const item = items.find(i => i.name.toLowerCase() === q)
    ?? items.find(i => i.name.toLowerCase().includes(q));

  if (!item) {
    return `Item "${itemName}" not found. Try ddb_search_items with a partial name.`;
  }

  return formatItem(item);
}
