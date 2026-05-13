/**
 * open5e.ts — Open5e SRD fallback for all reference and monster tools.
 *
 * Used when DnD Beyond is unreachable, returns auth errors, or returns empty
 * results. All functions return the same string format as DDB equivalents so
 * callers can swap them in transparently.
 *
 * API: https://api.open5e.com/v1/ — no auth required.
 * SRD content only (wotc-srd slug). Coverage is narrower than DDB but
 * includes all core 5e content: 24 cantrips, ~320 spells, ~325 monsters,
 * magic items, 12 classes, most races, and key backgrounds.
 */

import { TtlCache } from "./cache.js";

const OPEN5E = "https://api.open5e.com/v1";
const SRD = "wotc-srd";

// 1-hour cache — Open5e data doesn't change often
const open5eCache = new TtlCache<unknown>(60 * 60_000, 100);

/** Wipe the in-process Open5e response cache. */
export function clearOpen5eCache(): void {
  open5eCache.clear();
}

async function o5fetch(path: string): Promise<unknown> {
  const cached = open5eCache.get(path);
  if (cached !== undefined) return cached;

  const resp = await fetch(`${OPEN5E}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Open5e ${resp.status}: ${path}`);
  const data = await resp.json();
  open5eCache.set(path, data);
  return data;
}

// ── Source tag ────────────────────────────────────────────────────────────────

const SRC = "\n\n*(Source: SRD 5.1 via Open5e — DnD Beyond unavailable)*";

// ── SPELLS ────────────────────────────────────────────────────────────────────

interface O5Spell {
  name: string;
  level_int: number;
  school: string;
  casting_time: string;
  range: string;
  components: string;
  duration: string;
  requires_concentration: boolean;
  ritual: string;
  desc: string;
  higher_level?: string;
  dnd_class?: string;
}

function formatO5Spell(s: O5Spell): string {
  const level = s.level_int === 0 ? "Cantrip" : `Level ${s.level_int}`;
  const conc = s.requires_concentration ? " | Concentration" : "";
  const ritual = s.ritual === "yes" ? " | Ritual" : "";
  const lines = [
    `${s.name} (${level} ${s.school}${conc}${ritual})`,
    `Casting Time: ${s.casting_time}`,
    `Range: ${s.range}`,
    `Components: ${s.components}`,
    `Duration: ${s.duration}`,
  ];
  if (s.dnd_class) lines.push(`Classes: ${s.dnd_class}`);
  lines.push("", s.desc.replace(/<[^>]+>/g, "").trim());
  if (s.higher_level) lines.push("", `At Higher Levels: ${s.higher_level}`);
  return lines.join("\n") + SRC;
}

/**
 * Fetch all SRD cantrips from Open5e. Used to supplement the spell compendium
 * so cantrips are available cold (without any character loaded).
 * Returns raw O5Spell objects so they can be converted to DdbSpell shape.
 */
export async function fetchO5Cantrips(): Promise<O5Spell[]> {
  let page = 1;
  const all: O5Spell[] = [];
  while (true) {
    const data = await o5fetch(
      `/spells/?level_int=0&document__slug=${SRD}&limit=100&page=${page}`
    ) as { count: number; results: O5Spell[]; next: string | null };
    all.push(...data.results);
    if (!data.next) break;
    page++;
  }
  return all;
}

export async function o5SearchSpells(params: {
  name?: string;
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  // Request enough results to cover the offset window (capped at 100)
  const qs = new URLSearchParams({ document__slug: SRD, limit: String(Math.min(offset + limit, 100)) });
  if (params.name) qs.set("search", params.name);
  if (params.level !== undefined) qs.set("level_int", String(params.level));
  if (params.school) qs.set("school", params.school.toLowerCase());
  if (params.concentration !== undefined)
    qs.set("requires_concentration", String(params.concentration));
  if (params.ritual !== undefined)
    qs.set("ritual", params.ritual ? "yes" : "no");

  const data = await o5fetch(`/spells/?${qs}`) as { count: number; results: O5Spell[] };
  const page = data.results.slice(offset, offset + limit);
  if (!page.length) return `No spells found matching the criteria (SRD only).`;

  const lines = page.map(s => {
    const level = s.level_int === 0 ? "Cantrip" : `Level ${s.level_int}`;
    const conc = s.requires_concentration ? " [C]" : "";
    const ritual = s.ritual === "yes" ? " [R]" : "";
    return `• ${s.name} (${level} ${s.school}${conc}${ritual})`;
  });

  const showing = offset + 1 === offset + page.length
    ? `${offset + 1}`
    : `${offset + 1}–${offset + page.length}`;
  const header = data.count > offset + limit
    ? `Found ${data.count} spell(s) (showing ${showing}, SRD only — use offset: ${offset + limit} for more):`
    : `Found ${data.count} spell(s) (showing ${showing}, SRD only):`;

  return [header, ...lines, SRC].join("\n");
}

export async function o5GetSpell(name: string): Promise<string | null> {
  const data = await o5fetch(
    `/spells/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Spell[] };

  const exact = data.results.find(
    s => s.name.toLowerCase() === name.toLowerCase()
  );
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Spell(match);
}

// ── MONSTERS ──────────────────────────────────────────────────────────────────

interface O5Monster {
  name: string;
  size: string;
  type: string;
  subtype?: string;
  alignment: string;
  armor_class: number;
  armor_desc?: string;
  hit_points: number;
  hit_dice: string;
  speed: Record<string, number>;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  strength_save?: number;
  dexterity_save?: number;
  constitution_save?: number;
  intelligence_save?: number;
  wisdom_save?: number;
  charisma_save?: number;
  skills: Record<string, number>;
  damage_vulnerabilities?: string;
  damage_resistances?: string;
  damage_immunities?: string;
  condition_immunities?: string;
  senses: string;
  languages: string;
  challenge_rating: string;
  actions?: Array<{ name: string; desc: string }>;
  special_abilities?: Array<{ name: string; desc: string }>;
  reactions?: Array<{ name: string; desc: string }>;
  legendary_desc?: string;
  legendary_actions?: Array<{ name: string; desc: string }>;
}

function formatO5Monster(m: O5Monster): string {
  const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const mod = (score: number) => Math.floor((score - 10) / 2);
  const speedStr = Object.entries(m.speed)
    .map(([k, v]) => `${k} ${v} ft.`)
    .join(", ");

  const saves: string[] = [];
  const saveNames: [string, number | undefined][] = [
    ["STR", m.strength_save], ["DEX", m.dexterity_save],
    ["CON", m.constitution_save], ["INT", m.intelligence_save],
    ["WIS", m.wisdom_save], ["CHA", m.charisma_save],
  ];
  for (const [label, val] of saveNames) {
    if (val !== null && val !== undefined) saves.push(`${label} ${signed(val)}`);
  }

  const skills = Object.entries(m.skills)
    .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)} ${signed(v)}`)
    .join(", ");

  const lines: string[] = [
    `${m.name}`,
    `${m.size} ${m.type}${m.subtype ? ` (${m.subtype})` : ""}, ${m.alignment}`,
    `CR ${m.challenge_rating} | AC ${m.armor_class}${m.armor_desc ? ` (${m.armor_desc})` : ""} | HP ${m.hit_points} (${m.hit_dice})`,
    `Speed: ${speedStr}`,
    ``,
    `STR ${m.strength} (${signed(mod(m.strength))})  DEX ${m.dexterity} (${signed(mod(m.dexterity))})  CON ${m.constitution} (${signed(mod(m.constitution))})`,
    `INT ${m.intelligence} (${signed(mod(m.intelligence))})  WIS ${m.wisdom} (${signed(mod(m.wisdom))})  CHA ${m.charisma} (${signed(mod(m.charisma))})`,
  ];
  if (saves.length) lines.push(`Saving Throws: ${saves.join(", ")}`);
  if (skills) lines.push(`Skills: ${skills}`);
  if (m.damage_vulnerabilities) lines.push(`Damage Vulnerabilities: ${m.damage_vulnerabilities}`);
  if (m.damage_resistances) lines.push(`Damage Resistances: ${m.damage_resistances}`);
  if (m.damage_immunities) lines.push(`Damage Immunities: ${m.damage_immunities}`);
  if (m.condition_immunities) lines.push(`Condition Immunities: ${m.condition_immunities}`);
  lines.push(`Senses: ${m.senses}`);
  lines.push(`Languages: ${m.languages || "—"}`);

  if (m.special_abilities?.length) {
    lines.push(``, `TRAITS`);
    for (const a of m.special_abilities) lines.push(`  ${a.name}. ${a.desc}`);
  }
  if (m.actions?.length) {
    lines.push(``, `ACTIONS`);
    for (const a of m.actions) lines.push(`  ${a.name}. ${a.desc}`);
  }
  if (m.reactions?.length) {
    lines.push(``, `REACTIONS`);
    for (const a of m.reactions) lines.push(`  ${a.name}. ${a.desc}`);
  }
  if (m.legendary_actions?.length) {
    if (m.legendary_desc) lines.push(``, m.legendary_desc);
    lines.push(``, `LEGENDARY ACTIONS`);
    for (const a of m.legendary_actions) lines.push(`  ${a.name}. ${a.desc}`);
  }

  lines.push(SRC);
  return lines.join("\n");
}

export async function o5SearchMonsters(params: {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
}): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (params.name) qs.set("search", params.name);
  if (params.cr !== undefined) qs.set("challenge_rating", String(params.cr));
  if (params.type) qs.set("type", params.type.toLowerCase());

  const data = await o5fetch(`/monsters/?${qs}`) as { count: number; results: O5Monster[] };
  if (!data.results.length) return `No monsters found (SRD only).`;

  const lines = data.results.map(
    m => `• ${m.name} (CR ${m.challenge_rating}, ${m.size} ${m.type})`
  );
  return [
    `Found ${data.count} monster(s) (showing ${data.results.length}, SRD only):`,
    ...lines,
    SRC.trim(),
  ].join("\n");
}

export async function o5GetMonster(name: string): Promise<string | null> {
  const data = await o5fetch(
    `/monsters/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Monster[] };

  const exact = data.results.find(
    m => m.name.toLowerCase() === name.toLowerCase()
  );
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Monster(match);
}

// ── ITEMS ─────────────────────────────────────────────────────────────────────

interface O5Item {
  name: string;
  type: string;
  rarity: string;
  requires_attunement?: string;
  desc: string;
}

function formatO5Item(item: O5Item): string {
  const attune = item.requires_attunement
    ? ` | Requires attunement${item.requires_attunement !== "true" ? ` (${item.requires_attunement})` : ""}`
    : "";
  return [
    `${item.name} (${item.type}, ${item.rarity}${attune})`,
    ``,
    item.desc.replace(/<[^>]+>/g, "").trim(),
    SRC,
  ].join("\n");
}

export async function o5SearchItems(name: string): Promise<string> {
  const data = await o5fetch(
    `/magicitems/?search=${encodeURIComponent(name)}&limit=20`
  ) as { count: number; results: O5Item[] };

  if (!data.results.length) return `No magic items found matching "${name}" (SRD only).`;

  const lines = data.results.map(
    i => `• ${i.name} (${i.type}, ${i.rarity})`
  );
  return [
    `Found ${data.count} item(s) (showing ${data.results.length}, SRD only):`,
    ...lines,
    SRC.trim(),
  ].join("\n");
}

export async function o5GetItem(name: string): Promise<string | null> {
  const data = await o5fetch(
    `/magicitems/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Item[] };

  const exact = data.results.find(
    i => i.name.toLowerCase() === name.toLowerCase()
  );
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Item(match);
}

// ── WEAPONS ───────────────────────────────────────────────────────────────────

interface O5Weapon {
  name: string;
  category: string;       // e.g. "Simple Melee Weapons", "Martial Ranged Weapons"
  cost: string;
  damage_dice: string;
  damage_type: string;
  weight: string;
  properties: string[];   // e.g. ["versatile (1d10)", "thrown (20/60)"]
}

function formatO5Weapon(w: O5Weapon): string {
  return [
    `${w.name} (${w.category})`,
    `Damage: ${w.damage_dice} ${w.damage_type}`,
    `Cost: ${w.cost} | Weight: ${w.weight || "—"}`,
    w.properties.length ? `Properties: ${w.properties.join(", ")}` : "",
    SRC,
  ].filter(Boolean).join("\n");
}

export async function o5SearchWeapons(params: {
  name?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const qs = new URLSearchParams({ document__slug: SRD, limit: String(Math.min(offset + limit, 100)) });
  if (params.name) qs.set("search", params.name);
  if (params.category) qs.set("category", params.category);

  const data = await o5fetch(`/weapons/?${qs}`) as { count: number; results: O5Weapon[] };
  const page = data.results.slice(offset, offset + limit);
  if (!page.length) return `No weapons found matching the criteria (SRD only).`;

  const lines = page.map(w => `• ${w.name} — ${w.category} | ${w.damage_dice} ${w.damage_type} | ${w.cost}`);
  return [`Found ${data.count} weapon(s) (SRD only):`, ...lines, SRC.trim()].join("\n");
}

export async function o5GetWeapon(name: string): Promise<string | null> {
  const data = await o5fetch(
    `/weapons/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Weapon[] };

  const exact = data.results.find(w => w.name.toLowerCase() === name.toLowerCase());
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Weapon(match);
}

// ── ARMOUR ────────────────────────────────────────────────────────────────────

interface O5Armor {
  name: string;
  category: string;                  // "Light Armor", "Medium Armor", "Heavy Armor"
  base_ac: number;
  ac_string: string;                 // e.g. "14 + Dex modifier (max 2)"
  strength_requirement: number | null;
  stealth_disadvantage: boolean;
  cost: string;
  weight: string;
}

function formatO5Armor(a: O5Armor): string {
  const strReq = a.strength_requirement ? ` | Requires STR ${a.strength_requirement}` : "";
  const stealth = a.stealth_disadvantage ? ` | Stealth disadvantage` : "";
  return [
    `${a.name} (${a.category})`,
    `AC: ${a.ac_string}${strReq}${stealth}`,
    `Cost: ${a.cost} | Weight: ${a.weight || "—"}`,
    SRC,
  ].join("\n");
}

export async function o5SearchArmor(params: {
  name?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const qs = new URLSearchParams({ document__slug: SRD, limit: String(Math.min(offset + limit, 100)) });
  if (params.name) qs.set("search", params.name);
  if (params.category) qs.set("category", params.category);

  const data = await o5fetch(`/armor/?${qs}`) as { count: number; results: O5Armor[] };
  const page = data.results.slice(offset, offset + limit);
  if (!page.length) return `No armour found matching the criteria (SRD only).`;

  const lines = page.map(a => {
    const strReq = a.strength_requirement ? ` | STR ${a.strength_requirement}` : "";
    const stealth = a.stealth_disadvantage ? ` | Stealth disadv.` : "";
    return `• ${a.name} — ${a.category} | ${a.ac_string}${strReq}${stealth} | ${a.cost}`;
  });
  return [`Found ${data.count} armour piece(s) (SRD only):`, ...lines, SRC.trim()].join("\n");
}

export async function o5GetArmor(name: string): Promise<string | null> {
  const data = await o5fetch(
    `/armor/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Armor[] };

  const exact = data.results.find(a => a.name.toLowerCase() === name.toLowerCase());
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Armor(match);
}

// ── RACES ─────────────────────────────────────────────────────────────────────

interface O5Race {
  name: string;
  desc: string;
  asi_desc: string;
  asi: Array<{ attributes: string[]; value: number }>;
  size: string;
  speed: Record<string, number>;
  languages: string;
  vision: string;
  traits: string;
}

function formatO5Race(r: O5Race): string {
  const speedStr = Object.entries(r.speed).map(([k, v]) => `${k} ${v} ft.`).join(", ");
  const asiStr = r.asi.map(a => `+${a.value} ${a.attributes.join(", ")}`).join("; ");
  return [
    `${r.name}`,
    `Size: ${r.size} | Speed: ${speedStr} | ASI: ${asiStr}`,
    `Languages: ${r.languages}`,
    r.vision ? `Vision: ${r.vision}` : "",
    ``,
    r.traits.replace(/<[^>]+>/g, "").trim(),
    SRC,
  ].filter(Boolean).join("\n");
}

export async function o5SearchRaces(name?: string): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/races/?${qs}`) as { count: number; results: O5Race[] };
  if (!data.results.length) return `No races found (SRD only).`;

  if (name && data.results.length === 1) return formatO5Race(data.results[0]);

  const lines = data.results.map(r => {
    const speedStr = Object.entries(r.speed).map(([k, v]) => `${k} ${v} ft.`).join(", ");
    const asiStr = r.asi.map(a => `+${a.value} ${a.attributes.join(", ")}`).join("; ");
    return `• ${r.name} | ${speedStr} | ASI: ${asiStr}`;
  });
  return [
    `Found ${data.count} race(s) (SRD only):`,
    ...lines,
    SRC.trim(),
  ].join("\n");
}

export async function o5GetRace(name: string): Promise<string | null> {
  const data = await o5fetch(
    `/races/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Race[] };

  const exact = data.results.find(r => r.name.toLowerCase() === name.toLowerCase());
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Race(match);
}

// ── CLASSES ───────────────────────────────────────────────────────────────────

interface O5Class {
  name: string;
  hit_dice: string;
  hp_at_1st_level: string;
  hp_at_higher_levels: string;
  prof_armor: string;
  prof_weapons: string;
  prof_saving_throws: string;
  prof_skills: string;
  spellcasting_ability?: string;
  desc: string;
}

function formatO5Class(c: O5Class): string {
  return [
    `${c.name}`,
    `Hit Die: ${c.hit_dice} | HP at 1st: ${c.hp_at_1st_level}`,
    `Armor: ${c.prof_armor || "None"} | Weapons: ${c.prof_weapons}`,
    `Saving Throws: ${c.prof_saving_throws}`,
    `Skills: ${c.prof_skills}`,
    c.spellcasting_ability ? `Spellcasting: ${c.spellcasting_ability}` : "",
    SRC,
  ].filter(Boolean).join("\n");
}

export async function o5SearchClasses(name?: string): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/classes/?${qs}`) as { count: number; results: O5Class[] };
  if (!data.results.length) return `No classes found (SRD only).`;

  if (name && data.results.length === 1) return formatO5Class(data.results[0]);

  const lines = data.results.map(c =>
    `• ${c.name} (${c.hit_dice})${c.spellcasting_ability ? ` | Spellcasting: ${c.spellcasting_ability}` : ""}`
  );
  return [`Found ${data.count} class(es) (SRD only):`, ...lines, SRC.trim()].join("\n");
}

// ── BACKGROUNDS ───────────────────────────────────────────────────────────────

interface O5Background {
  name: string;
  skill_proficiencies: string;
  tool_proficiencies?: string;
  languages?: string;
  equipment: string;
  feature: string;
  feature_desc: string;
}

function formatO5Background(b: O5Background): string {
  return [
    `${b.name}`,
    `Skills: ${b.skill_proficiencies}`,
    b.tool_proficiencies ? `Tools: ${b.tool_proficiencies}` : "",
    b.languages ? `Languages: ${b.languages}` : "",
    `Equipment: ${b.equipment}`,
    ``,
    `Feature — ${b.feature}`,
    b.feature_desc.replace(/<[^>]+>/g, "").trim(),
    SRC,
  ].filter(Boolean).join("\n");
}

export async function o5SearchBackgrounds(name?: string): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/backgrounds/?${qs}`) as { count: number; results: O5Background[] };
  if (!data.results.length) return `No backgrounds found (SRD only — only Acolyte is in the SRD).`;

  if (data.results.length === 1) return formatO5Background(data.results[0]);

  const lines = data.results.map(b => `• ${b.name} (Skills: ${b.skill_proficiencies})`);
  return [`Found ${data.count} background(s) (SRD only):`, ...lines, SRC.trim()].join("\n");
}

// ── FEATS ─────────────────────────────────────────────────────────────────────

interface O5Feat {
  name: string;
  desc: string;
  prerequisite?: string;
  effects_desc?: string[];
}

function formatO5Feat(f: O5Feat): string {
  return [
    `${f.name}`,
    f.prerequisite ? `Prerequisite: ${f.prerequisite.replace(/^Prerequisite:\s*/i, "")}` : "",
    ``,
    f.desc.replace(/<[^>]+>/g, "").trim(),
    SRC,
  ].filter(Boolean).join("\n");
}

export async function o5SearchFeats(name?: string): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/feats/?${qs}`) as { count: number; results: O5Feat[] };
  if (!data.results.length) return `No feats found (SRD only — only Grappler is in the SRD).`;

  if (data.results.length === 1) return formatO5Feat(data.results[0]);

  const lines = data.results.map(f =>
    `• ${f.name}${f.prerequisite ? ` (${f.prerequisite.replace(/^Prerequisite:\s*/i, "")})` : ""}`
  );
  return [`Found ${data.count} feat(s) (SRD only):`, ...lines, SRC.trim()].join("\n");
}

// ── RULES SECTIONS ────────────────────────────────────────────────────────────

interface O5Section {
  slug: string;
  name: string;
  desc: string;         // plain markdown — no HTML stripping needed
  parent: string;
  document__slug: string;
}

export async function o5SearchSections(query?: string): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: query ? "20" : "50" });
  if (query) qs.set("search", query);

  const data = await o5fetch(`/sections/?${qs}`) as { count: number; results: O5Section[] };
  if (!data.results.length) return `No rules sections found matching "${query ?? ""}" (SRD only).`;

  const lines = data.results.map(s => `• **${s.name}** (slug: \`${s.slug}\`)`);
  return [
    `Found ${data.count} rules section(s)${query ? ` matching "${query}"` : ""} (SRD only):`,
    ...lines,
    `\nUse ddb_get_rules with the section name or slug to read the full text.`,
    SRC.trim(),
  ].join("\n");
}

export async function o5GetSection(
  nameOrSlug: string,
  maxChars = 4000,
  query?: string
): Promise<string | null> {
  // Try direct slug lookup first
  const slug = nameOrSlug.toLowerCase().replace(/\s+/g, "-");
  const bySlug = await o5fetch(`/sections/${encodeURIComponent(slug)}/`).catch(() => null) as O5Section | { name?: string } | null;
  let section: O5Section | null = (bySlug && (bySlug as O5Section).name) ? bySlug as O5Section : null;

  // Fall back to name search
  if (!section) {
    const data = await o5fetch(
      `/sections/?search=${encodeURIComponent(nameOrSlug)}&document__slug=${SRD}&limit=5`
    ) as { results: O5Section[] };
    const exact = data.results.find(s => s.name.toLowerCase() === nameOrSlug.toLowerCase());
    section = exact ?? data.results[0] ?? null;
  }

  if (!section) return null;

  let text = section.desc;

  // If query provided, start near the first occurrence
  if (query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
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

  return [`## ${section.name}`, ``, output + truncNote, SRC].join("\n");
}
