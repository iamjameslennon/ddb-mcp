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
import {
  editionTag, groupAndSelect, lookupByName, normalizeName, open5eSearchHeader, renameLine, rulesLine, searchFooter,
  searchHeader, selectByEdition, twinName,
  type EditionInfo, type Open5eOrigin, type RulesEdition, type SelectionReason,
} from "./edition.js";

const OPEN5E = "https://api.open5e.com/v1";
const SRD = "wotc-srd";

// 1-hour cache — Open5e data doesn't change often
const open5eCache = new TtlCache<unknown>(60 * 60_000, 100);

/** Wipe the in-process Open5e response cache. */
export function clearOpen5eCache(): void {
  open5eCache.clear();
  o5Pending.clear();
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

// ── v2 document loader ────────────────────────────────────────────────────────
// Open5e v2 silently ignores filters it doesn't know, so the only request shape
// used is one whole document per endpoint (document__key__in + limit), with
// every other match done client-side.

const O5_V2 = "https://api.open5e.com/v2";
const O5_TIMEOUT_MS = 20_000;

export type O5Endpoint = "spells" | "creatures" | "items" | "magicitems" | "weapons" | "armor" | "species" | "classes" | "backgrounds" | "feats" | "rulesets";

export const O5_DOC: Readonly<Record<RulesEdition, "srd-2024" | "srd-2014">> = { "2024": "srd-2024", "2014": "srd-2014" };

export interface O5Record { key: string; name: string; document: { key: string } | string }

/** A record's document key: an object on most endpoints, a string on rules. */
export function docKey(r: { document: { key: string } | string }): string {
  return typeof r.document === "string" ? r.document : r.document.key;
}

const o5Pending = new Map<string, Promise<unknown[]>>();

async function fetchPages(firstUrl: string): Promise<unknown[]> {
  const all: unknown[] = [];
  const seen = new Set<string>();
  let url: string | null = firstUrl;
  while (url) {
    if (seen.has(url)) throw new Error(`Open5e paging loop: ${new URL(url).pathname}`);
    seen.add(url);
    const resp: Response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(O5_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`Open5e ${resp.status}: ${new URL(url).pathname}`);
    const body = await resp.json() as { next?: string | null; results?: unknown[] };
    all.push(...(body.results ?? []));
    url = body.next || null;
  }
  return all;
}

/** One whole SRD document of an endpoint, other documents' records dropped. Cached 1 h; concurrent callers share one fetch; failures are never cached. */
export async function loadO5Document<T extends O5Record>(endpoint: O5Endpoint, edition: RulesEdition): Promise<T[]> {
  const doc = O5_DOC[edition];
  const url = `${O5_V2}/${endpoint}/?document__key__in=${doc}&limit=1000`;
  const cached = open5eCache.get(url) as T[] | undefined;
  if (cached !== undefined) return cached;
  let pending = o5Pending.get(url);
  if (!pending) {
    const p: Promise<unknown[]> = fetchPages(url)
      .then(records => {
        const kept = (records as T[]).filter(r => docKey(r) === doc);
        // A clear while this fetch was in flight dropped its entry: don't repopulate.
        if (o5Pending.get(url) === p) open5eCache.set(url, kept);
        return kept;
      })
      .finally(() => { if (o5Pending.get(url) === p) o5Pending.delete(url); });
    o5Pending.set(url, p);
    pending = p;
  }
  return pending as Promise<T[]>;
}

// ── Edition labels ────────────────────────────────────────────────────────────

// Interim: the v1 kinds below serve SRD 5.1 only, until they move to v2.
const O5_INFO: EditionInfo = { ruleset: "2014", book: null };

/** Line 2 of a single lookup. */
const label = (origin: Open5eOrigin): string => rulesLine(O5_INFO, { open5e: origin });
/** Inline tag after a search result's name. */
const TAG = editionTag(O5_INFO);

// ── Selection over both SRD documents ─────────────────────────────────────────
// Both documents of an endpoint are selected together, each record's ruleset
// taken from its document, with the same edition code as D&D Beyond entries.

interface O5Entry<T> { record: T; endpoint: O5Endpoint; edition: RulesEdition }

interface O5Hit<T> {
  entry: O5Entry<T>;
  reason?: SelectionReason;
  renamed?: { name2014: string; name2024: string };
}

const o5Info = (e: O5Entry<unknown>): EditionInfo => ({ ruleset: e.edition, book: null });

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
  const found = lookupByName(entries, name, requested, {
    name: e => e.record.name,
    info: o5Info,
    tiebreak: o5Tiebreak<T>(endpoints),
    // The requested document first, then names starting with the query, then the shortest, then alphabetical.
    partialMatch: (all, q) => all
      .filter(e => normalizeName(e.record.name).includes(q))
      .sort((a, b) =>
        (a.edition === requested ? 0 : 1) - (b.edition === requested ? 0 : 1)
        || (normalizeName(a.record.name).startsWith(q) ? 0 : 1) - (normalizeName(b.record.name).startsWith(q) ? 0 : 1)
        || a.record.name.length - b.record.name.length
        || a.record.name.localeCompare(b.record.name))[0],
  });
  if (!found) return null;
  // SRD 5.2 keeps some 2014-era names (Arcane Hand): a rename line is printed
  // only when the shown entry carries its own edition's spelling.
  const shownName = found.entry.record.name;
  const ownSpelling = normalizeName(shownName) === twinName(shownName);
  const keepRename = found.entry.edition === "2024" ? ownSpelling : !ownSpelling;
  return { entry: found.entry, reason: found.reason, renamed: keepRename ? found.renamed : undefined };
}

/** A search over both documents: one entry per twin group, the other edition's twins hidden and counted. Sorted by name. */
async function o5Select<T extends O5Record>(
  endpoints: readonly O5Endpoint[],
  requested: RulesEdition,
  opts: { name?: string; passes?: (e: O5Entry<T>) => boolean },
): Promise<{ selected: Array<{ entry: O5Entry<T>; reason?: SelectionReason }>; hidden: number }> {
  const entries = await o5Entries<T>(endpoints, requested);
  const query = opts.name ? normalizeName(opts.name) : "";
  const { selected, hidden } = groupAndSelect(entries, requested, {
    info: o5Info,
    twinKey: e => twinName(e.record.name),
    tiebreak: o5Tiebreak<T>(endpoints),
    nameMatches: query ? e => normalizeName(e.record.name).includes(query) : undefined,
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
function o5Label(edition: RulesEdition, origin: Open5eOrigin, extra: { reason?: SelectionReason; renamed?: O5Hit<unknown>["renamed"] } = {}): string {
  const lines = [rulesLine({ ruleset: edition, book: null }, { open5e: origin, reason: extra.reason })];
  if (extra.renamed) lines.push(renameLine(extra.renamed.name2014, extra.renamed.name2024));
  return lines.join("\n");
}

/** A search reply: the Open5e header, the heading, the lines and the footer. Hidden twins alone keep the header and footer around `noMatch`. */
function o5SearchReply(
  requested: RulesEdition,
  origin: "unavailable" | "not-found",
  heading: string,
  lines: string[],
  hidden: number,
  noMatch: string,
): string {
  const footer = searchFooter(requested, hidden);
  if (lines.length) return [open5eSearchHeader(requested, origin), heading, ...lines, ...(footer ? [footer] : [])].join("\n");
  if (footer) return [open5eSearchHeader(requested, origin), noMatch, footer].join("\n");
  return noMatch;
}

/** A float challenge rating as printed: 0.25 → "1/4". */
export function crText(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

const lowerEq = (query: string, ...values: Array<string | null | undefined>): boolean =>
  values.some(v => v != null && v.toLowerCase() === query.toLowerCase());

// ── SPELLS ────────────────────────────────────────────────────────────────────

interface O5Spell extends O5Record {
  level: number;
  school: { name: string; key: string };
  casting_time: string;
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
    `Casting Time: ${CASTING_TIME[s.casting_time] ?? s.casting_time}`,
    `Range: ${s.range_text}`,
    `Components: ${components}`,
    `Duration: ${s.duration}`,
  ];
  const classes = (s.classes ?? []).map(c => c.name).join(", ");
  if (classes) lines.push(`Classes: ${classes}`);
  lines.push("", s.desc.replace(/<[^>]+>/g, "").trim());
  if (s.higher_level) lines.push("", `At Higher Levels: ${s.higher_level}`);
  return lines.join("\n");
}

export async function o5SearchSpells(params: {
  name?: string;
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
  limit?: number;
  offset?: number;
  rulesEdition?: RulesEdition;
}, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const { selected, hidden } = await o5Select<O5Spell>(["spells"], requested, {
    name: params.name,
    passes: ({ record: s }) =>
      (params.level === undefined || s.level === params.level)
      && (!params.school || lowerEq(params.school, s.school.key, s.school.name))
      && (params.concentration === undefined || s.concentration === params.concentration)
      && (params.ritual === undefined || s.ritual === params.ritual),
  });

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
  return o5SearchReply(requested, origin, heading, lines, hidden, "No spells found matching the criteria (SRD only).");
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

interface O5Action { name: string; desc: string; action_type?: string | null; order_in_statblock?: number | null }

interface O5Creature extends O5Record {
  size?: { name: string; key: string } | null;
  type?: { name: string; key: string } | null;
  subcategory?: string | null;
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
    .map(([k, v]) => `${k.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")} ${signed(v)}`)
    .join(", ");
  const abilityLine = (pairs: typeof ABILITIES) => pairs
    .map(([k, abbr]) => {
      const score = m.ability_scores?.[k];
      if (score == null) return null;
      const mod = mods[k];
      return `${abbr} ${score}${mod != null ? ` (${signed(mod)})` : ""}`;
    })
    .filter(Boolean).join("  ");

  const kind = [m.size?.name, m.type?.name].filter(Boolean).join(" ") + (m.subcategory ? ` (${m.subcategory})` : "");
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
    for (const a of actions) lines.push(`  ${a.name}. ${a.desc}`);
  }

  return lines.join("\n");
}

export async function o5SearchMonsters(params: {
  name?: string;
  cr?: number;
  type?: string;
  size?: string;
  rulesEdition?: RulesEdition;
}, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  const { selected, hidden } = await o5Select<O5Creature>(["creatures"], requested, {
    name: params.name,
    passes: ({ record: m }) =>
      (params.cr === undefined || m.challenge_rating === params.cr)
      && (!params.type || lowerEq(params.type, m.type?.key, m.type?.name))
      && (!params.size || lowerEq(params.size, m.size?.key, m.size?.name)),
  });

  const shown = selected.slice(0, 20);
  const lines = shown.map(({ entry }) => {
    const m = entry.record;
    const kind = [m.size?.name, m.type?.name].filter(Boolean).join(" ");
    return `• ${m.name} ${editionTag(o5Info(entry))} (CR ${crText(m.challenge_rating)}${kind ? `, ${kind}` : ""})`;
  });
  return o5SearchReply(
    requested, origin,
    `Found ${selected.length} monster(s) (showing ${shown.length}, SRD only):`,
    lines, hidden, "No monsters found (SRD only).",
  );
}

export async function o5GetMonster(name: string, rulesEdition: RulesEdition, origin: Open5eOrigin): Promise<string | null> {
  const hit = await o5Lookup<O5Creature>(["creatures"], name, rulesEdition);
  return hit ? formatO5Monster(hit, origin) : null;
}

// ── ITEMS ─────────────────────────────────────────────────────────────────────

interface O5Item {
  name: string;
  type: string;
  rarity: string;
  requires_attunement?: string;
  desc: string;
}

function formatO5Item(item: O5Item, origin: Open5eOrigin): string {
  const attune = item.requires_attunement
    ? ` | Requires attunement${item.requires_attunement !== "true" ? ` (${item.requires_attunement})` : ""}`
    : "";
  return [
    `${item.name} (${item.type}, ${item.rarity}${attune})`,
    label(origin),
    ``,
    item.desc.replace(/<[^>]+>/g, "").trim(),
  ].join("\n");
}

export async function o5SearchItems(name: string, origin: Open5eOrigin): Promise<string> {
  const data = await o5fetch(
    `/magicitems/?search=${encodeURIComponent(name)}&limit=20`
  ) as { count: number; results: O5Item[] };

  if (!data.results.length) return `No magic items found matching "${name}" (SRD only).`;

  const lines = data.results.map(
    i => `• ${i.name} ${TAG} (${i.type}, ${i.rarity})`
  );
  return [
    label(origin),
    `Found ${data.count} item(s) (showing ${data.results.length}, SRD only):`,
    ...lines,
  ].join("\n");
}

export async function o5GetItem(name: string, origin: Open5eOrigin): Promise<string | null> {
  const data = await o5fetch(
    `/magicitems/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Item[] };

  const exact = data.results.find(
    i => i.name.toLowerCase() === name.toLowerCase()
  );
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Item(match, origin);
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

function formatO5Weapon(w: O5Weapon, origin: Open5eOrigin): string {
  return [
    `${w.name} (${w.category})`,
    label(origin),
    `Damage: ${w.damage_dice} ${w.damage_type}`,
    `Cost: ${w.cost} | Weight: ${w.weight || "—"}`,
    w.properties.length ? `Properties: ${w.properties.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export async function o5SearchWeapons(params: {
  name?: string;
  category?: string;
  limit?: number;
  offset?: number;
}, origin: Open5eOrigin): Promise<string> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  const qs = new URLSearchParams({ document__slug: SRD, limit: String(Math.min(offset + limit, 100)) });
  if (params.name) qs.set("search", params.name);
  if (params.category) qs.set("category", params.category);

  const data = await o5fetch(`/weapons/?${qs}`) as { count: number; results: O5Weapon[] };
  const page = data.results.slice(offset, offset + limit);
  if (!page.length) return `No weapons found matching the criteria (SRD only).`;

  const lines = page.map(w => `• ${w.name} ${TAG} — ${w.category} | ${w.damage_dice} ${w.damage_type} | ${w.cost}`);
  return [label(origin), `Found ${data.count} weapon(s) (SRD only):`, ...lines].join("\n");
}

export async function o5GetWeapon(name: string, origin: Open5eOrigin): Promise<string | null> {
  const data = await o5fetch(
    `/weapons/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Weapon[] };

  const exact = data.results.find(w => w.name.toLowerCase() === name.toLowerCase());
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Weapon(match, origin);
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

function formatO5Armor(a: O5Armor, origin: Open5eOrigin): string {
  const strReq = a.strength_requirement ? ` | Requires STR ${a.strength_requirement}` : "";
  const stealth = a.stealth_disadvantage ? ` | Stealth disadvantage` : "";
  return [
    `${a.name} (${a.category})`,
    label(origin),
    `AC: ${a.ac_string}${strReq}${stealth}`,
    `Cost: ${a.cost} | Weight: ${a.weight || "—"}`,
  ].join("\n");
}

export async function o5SearchArmor(params: {
  name?: string;
  category?: string;
  limit?: number;
  offset?: number;
}, origin: Open5eOrigin): Promise<string> {
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
    return `• ${a.name} ${TAG} — ${a.category} | ${a.ac_string}${strReq}${stealth} | ${a.cost}`;
  });
  return [label(origin), `Found ${data.count} armour piece(s) (SRD only):`, ...lines].join("\n");
}

export async function o5GetArmor(name: string, origin: Open5eOrigin): Promise<string | null> {
  const data = await o5fetch(
    `/armor/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Armor[] };

  const exact = data.results.find(a => a.name.toLowerCase() === name.toLowerCase());
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Armor(match, origin);
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

function formatO5Race(r: O5Race, origin: Open5eOrigin): string {
  const speedStr = Object.entries(r.speed).map(([k, v]) => `${k} ${v} ft.`).join(", ");
  const asiStr = r.asi.map(a => `+${a.value} ${a.attributes.join(", ")}`).join("; ");
  return [
    `${r.name}`,
    label(origin),
    `Size: ${r.size} | Speed: ${speedStr} | ASI: ${asiStr}`,
    `Languages: ${r.languages}`,
    r.vision ? `Vision: ${r.vision}` : "",
    ``,
    r.traits.replace(/<[^>]+>/g, "").trim(),
  ].filter(Boolean).join("\n");
}

export async function o5SearchRaces(name: string | undefined, origin: Open5eOrigin): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/races/?${qs}`) as { count: number; results: O5Race[] };
  if (!data.results.length) return `No races found (SRD only).`;

  if (name && data.results.length === 1) return formatO5Race(data.results[0], origin);

  const lines = data.results.map(r => {
    const speedStr = Object.entries(r.speed).map(([k, v]) => `${k} ${v} ft.`).join(", ");
    const asiStr = r.asi.map(a => `+${a.value} ${a.attributes.join(", ")}`).join("; ");
    return `• ${r.name} ${TAG} | ${speedStr} | ASI: ${asiStr}`;
  });
  return [
    label(origin),
    `Found ${data.count} race(s) (SRD only):`,
    ...lines,
  ].join("\n");
}

export async function o5GetRace(name: string, origin: Open5eOrigin): Promise<string | null> {
  const data = await o5fetch(
    `/races/?name=${encodeURIComponent(name)}&limit=5`
  ) as { results: O5Race[] };

  const exact = data.results.find(r => r.name.toLowerCase() === name.toLowerCase());
  const match = exact ?? data.results[0];
  if (!match) return null;
  return formatO5Race(match, origin);
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

function formatO5Class(c: O5Class, origin: Open5eOrigin): string {
  return [
    `${c.name}`,
    label(origin),
    `Hit Die: ${c.hit_dice} | HP at 1st: ${c.hp_at_1st_level}`,
    `Armor: ${c.prof_armor || "None"} | Weapons: ${c.prof_weapons}`,
    `Saving Throws: ${c.prof_saving_throws}`,
    `Skills: ${c.prof_skills}`,
    c.spellcasting_ability ? `Spellcasting: ${c.spellcasting_ability}` : "",
  ].filter(Boolean).join("\n");
}

export async function o5SearchClasses(name: string | undefined, origin: Open5eOrigin): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/classes/?${qs}`) as { count: number; results: O5Class[] };
  if (!data.results.length) return `No classes found (SRD only).`;

  if (name && data.results.length === 1) return formatO5Class(data.results[0], origin);

  const lines = data.results.map(c =>
    `• ${c.name} ${TAG} (${c.hit_dice})${c.spellcasting_ability ? ` | Spellcasting: ${c.spellcasting_ability}` : ""}`
  );
  return [label(origin), `Found ${data.count} class(es) (SRD only):`, ...lines].join("\n");
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

function formatO5Background(b: O5Background, origin: Open5eOrigin): string {
  return [
    `${b.name}`,
    label(origin),
    `Skills: ${b.skill_proficiencies}`,
    b.tool_proficiencies ? `Tools: ${b.tool_proficiencies}` : "",
    b.languages ? `Languages: ${b.languages}` : "",
    `Equipment: ${b.equipment}`,
    ``,
    `Feature — ${b.feature}`,
    b.feature_desc.replace(/<[^>]+>/g, "").trim(),
  ].filter(Boolean).join("\n");
}

export async function o5SearchBackgrounds(name: string | undefined, origin: Open5eOrigin): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/backgrounds/?${qs}`) as { count: number; results: O5Background[] };
  if (!data.results.length) return `No backgrounds found (SRD only — only Acolyte is in the SRD).`;

  if (data.results.length === 1) return formatO5Background(data.results[0], origin);

  const lines = data.results.map(b => `• ${b.name} ${TAG} (Skills: ${b.skill_proficiencies})`);
  return [label(origin), `Found ${data.count} background(s) (SRD only):`, ...lines].join("\n");
}

// ── FEATS ─────────────────────────────────────────────────────────────────────

interface O5Feat {
  name: string;
  desc: string;
  prerequisite?: string;
  effects_desc?: string[];
}

function formatO5Feat(f: O5Feat, origin: Open5eOrigin): string {
  return [
    `${f.name}`,
    label(origin),
    f.prerequisite ? `Prerequisite: ${f.prerequisite.replace(/^Prerequisite:\s*/i, "")}` : "",
    ``,
    f.desc.replace(/<[^>]+>/g, "").trim(),
  ].filter(Boolean).join("\n");
}

export async function o5SearchFeats(name: string | undefined, origin: Open5eOrigin): Promise<string> {
  const qs = new URLSearchParams({ document__slug: SRD, limit: "20" });
  if (name) qs.set("search", name);

  const data = await o5fetch(`/feats/?${qs}`) as { count: number; results: O5Feat[] };
  if (!data.results.length) return `No feats found (SRD only — only Grappler is in the SRD).`;

  if (data.results.length === 1) return formatO5Feat(data.results[0], origin);

  const lines = data.results.map(f =>
    `• ${f.name} ${TAG}${f.prerequisite ? ` (${f.prerequisite.replace(/^Prerequisite:\s*/i, "")})` : ""}`
  );
  return [label(origin), `Found ${data.count} feat(s) (SRD only):`, ...lines].join("\n");
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
    searchHeader({ rulesDoc: "2014" }),
    `Found ${data.count} rules section(s)${query ? ` matching "${query}"` : ""} (SRD only):`,
    ...lines,
    `\nUse ddb_get_rules with the section name or slug to read the full text.`,
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

  return [`## ${section.name}`, label("primary"), ``, output + truncNote].join("\n");
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

/**
 * CR and XP for an exact-twin-name SRD monster, or null (no match, unknown CR,
 * or any Open5e failure). Never guesses: only an exact twin name counts, and
 * the edition comes from the document the pick is in.
 */
export async function o5GetMonsterStats(name: string, rulesEdition: RulesEdition): Promise<{ name: string; crValue: number; xp: number; info: EditionInfo } | null> {
  try {
    const key = twinName(name);
    const group = (await o5Entries<O5Creature>(["creatures"], rulesEdition)).filter(e => twinName(e.record.name) === key);
    const picked = selectByEdition(group, rulesEdition, o5Info, o5Tiebreak<O5Creature>(["creatures"]));
    if (!picked) return null;
    const m = picked.entry.record;
    const xp = CR_XP_O5[crText(m.challenge_rating)];
    if (xp === undefined) return null;
    return { name: m.name, crValue: m.challenge_rating, xp, info: o5Info(picked.entry) };
  } catch {
    return null;
  }
}
