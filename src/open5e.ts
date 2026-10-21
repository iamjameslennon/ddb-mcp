/**
 * open5e.ts — Open5e SRD fallback for all reference and monster tools.
 *
 * Used when DnD Beyond is unreachable, returns auth errors, or returns empty
 * results. All functions return the same string format as DDB equivalents so
 * callers can swap them in transparently.
 *
 * API: https://api.open5e.com/v2/ — no auth required.
 * Two SRD documents: srd-2024 (SRD 5.2) and srd-2014 (SRD 5.1). Each endpoint
 * is loaded one whole document at a time and matched client-side. Spells,
 * creatures, items and options select both documents together by edition, like
 * D&D Beyond entries; rules are not twin-grouped: the requested document is
 * searched first, then the other one.
 * Coverage is narrower than DDB but includes the core SRD content: spells,
 * creatures, items, species, classes, backgrounds, feats and rules chapters.
 */

import { TtlCache } from "./cache.js";
import {
  createTwinNamer, editionTag, groupAndSelect, lookupByName, normalizeName, open5eSearchHeader, reasonLine, renameLine, rulesLine, searchFooter,
  searchHeader, selectByEdition,
  type EditionInfo, type Open5eOrigin, type RulesEdition, type SelectionReason, type TwinNamer,
} from "./edition.js";
import { EDITION_RENAMES, OPEN5E_ARMOUR_RENAMES } from "./edition-renames.js";

// 1-hour cache — Open5e data doesn't change often
const open5eCache = new TtlCache<unknown>(60 * 60_000, 100);

/** Wipe the in-process Open5e response cache. */
export function clearOpen5eCache(): void {
  open5eCache.clear();
  o5Pending.clear();
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

/** "-" as a space: SRD 5.1's "Adamantine Armor (Chain-Mail)" is SRD 5.2's "Adamantine Armor (Chain Mail)". */
const foldHyphens = (name: string): string => name.replace(/-/g, " ");

const O5_RENAMES = [...EDITION_RENAMES, ...OPEN5E_ARMOUR_RENAMES];
const o5Renamer = createTwinNamer(O5_RENAMES.map(([name2014, name2024]) => [foldHyphens(name2014), foldHyphens(name2024)] as const));

/**
 * The Open5e twin key: the shared rename table plus the Open5e-only armour
 * pairs (see OPEN5E_ARMOUR_RENAMES), with hyphens folded on both sides. D&D
 * Beyond's twinName does not fold them. `spell` keeps the table's own spelling.
 */
const o5TwinName: TwinNamer = Object.assign((name: string) => o5Renamer(foldHyphens(name)), { spell: createTwinNamer(O5_RENAMES).spell });

/** A name as its own twin key would be without renames: normalized, hyphens folded. */
const o5Folded = (name: string): string => normalizeName(foldHyphens(name));

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
  const query = normalizeName(name);
  const byEndpoint = o5Tiebreak<T>(endpoints);
  const found = lookupByName(entries, name, requested, {
    name: e => e.record.name,
    info: o5Info,
    twinName: o5TwinName,
    // Within the picked edition, the exact name beats endpoint order: SRD 5.1's
    // "Plate Armor" is the items record, not the armour record "Plate".
    tiebreak: (a, b) => (normalizeName(a.record.name) === query ? 0 : 1) - (normalizeName(b.record.name) === query ? 0 : 1)
      || byEndpoint(a, b),
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
  return { entry: found.entry, reason: found.reason, renamed: o5Renamed(found.entry, found.renamed) };
}

/**
 * The rename line's names, or undefined when it would be false. SRD 5.2 keeps
 * some 2014-era names (Arcane Hand): a rename line is printed only when the
 * shown entry carries its own edition's spelling. A punctuation-only difference
 * (a hyphen) is no rename. The shown entry's edition orients the pair, because
 * a hyphen-folded key no longer equals a 2024 name's normalized form.
 */
function o5Renamed(entry: O5Entry<O5Record>, renamed: O5Hit<unknown>["renamed"]): O5Hit<unknown>["renamed"] {
  if (!renamed || o5Folded(renamed.name2014) === o5Folded(renamed.name2024)) return undefined;
  const shownName = entry.record.name;
  const otherName = normalizeName(renamed.name2024) === normalizeName(shownName) ? renamed.name2014 : renamed.name2024;
  const ownSpelling = o5Folded(shownName) === o5TwinName(shownName);
  if (entry.edition === "2024") return ownSpelling ? { name2014: otherName, name2024: shownName } : undefined;
  return ownSpelling ? undefined : { name2014: shownName, name2024: otherName };
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
    twinKey: e => o5TwinName(e.record.name),
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
  /** Reaction spells: "which you take when …". */
  reaction_condition?: string | null;
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

/** A v2 casting-time key as printed: "bonus-action" → "1 bonus action"; an unknown key as-is. */
export const castingTime = (key: string): string => CASTING_TIME[key] ?? key;

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
    `Casting Time: ${castingTime(s.casting_time)}${s.reaction_condition ? `, ${s.reaction_condition}` : ""}`,
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

  const noMatch = "No spells found matching the criteria (SRD only).";
  // An offset past the end lists nothing: the plain reply, as on the D&D Beyond path.
  if (selected.length && offset >= selected.length) return noMatch;
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
  return o5SearchReply(requested, origin, heading, lines, hidden, noMatch);
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

interface O5Action {
  name: string;
  desc: string;
  action_type?: string | null;
  order_in_statblock?: number | null;
  legendary_action_cost?: number | null;
  usage_limits?: { type: string; param: number } | null;
}

/**
 * An action's name with its usage limit and legendary cost, as the old client printed them:
 * "Fire Breath (Recharge 5–6)", "Dominate Mind (2/Day)", "Wing Attack (Costs 2
 * Actions)". RECHARGE (SRD 5.2 only) reads like RECHARGE_ON_ROLL. A few names
 * already carry the text (Basilisk's "Petrifying Gaze (Recharge 4-6)"); it is not repeated.
 */
function actionName(a: O5Action): string {
  let name = a.name;
  const limit = a.usage_limits;
  if (limit && (limit.type === "RECHARGE_ON_ROLL" || limit.type === "RECHARGE") && !/\(Recharge/i.test(name)) {
    name += limit.param === 6 ? " (Recharge 6)" : ` (Recharge ${limit.param}–6)`;
  } else if (limit?.type === "PER_DAY" && !/\/Day\b/i.test(name)) {
    name += ` (${limit.param}/Day)`;
  }
  if (a.action_type === "LEGENDARY_ACTION" && (a.legendary_action_cost ?? 1) > 1 && !/\(Costs/i.test(name)) {
    name += ` (Costs ${a.legendary_action_cost} Actions)`;
  }
  return name;
}

const MINOR_WORDS = new Set(["of", "and", "the"]);
/** A v2 skill key as printed: "sleight_of_hand" → "Sleight of Hand". */
const skillName = (key: string): string => key.split("_")
  .map((w, i) => (i > 0 && MINOR_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
  .join(" ");

interface O5Creature extends O5Record {
  size?: { name: string; key: string } | null;
  type?: { name: string; key: string } | null;
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
    .map(([k, v]) => `${skillName(k)} ${signed(v)}`)
    .join(", ");
  const abilityLine = (pairs: typeof ABILITIES) => pairs
    .map(([k, abbr]) => {
      const score = m.ability_scores?.[k];
      if (score == null) return null;
      const mod = mods[k];
      return `${abbr} ${score}${mod != null ? ` (${signed(mod)})` : ""}`;
    })
    .filter(Boolean).join("  ");

  const kind = [m.size?.name, m.type?.name].filter(Boolean).join(" ");
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
    for (const a of actions) lines.push(`  ${actionName(a)}. ${a.desc}`);
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

// ── EQUIPMENT ─────────────────────────────────────────────────────────────────

interface O5MagicItem extends O5Record {
  desc: string;
  category: { name: string };
  rarity: { name: string };
  requires_attunement?: boolean;
  attunement_detail?: string | null;
}

/** A mundane item (v2 `items`): adventuring gear, and the cost and weight of weapons and armour. */
interface O5Item extends O5Record {
  desc: string;
  category: { name: string };
  cost?: string | null;
  weight?: string | null;
  weight_unit?: string | null;
}

interface O5Weapon extends O5Record {
  damage_dice: string;
  damage_type?: { name: string } | null;
  range?: number | null;
  long_range?: number | null;
  distance_unit?: string | null;
  is_simple: boolean;
  properties?: Array<{ property: { name: string; type?: string | null }; detail?: string | null }>;
}

interface O5Armor extends O5Record {
  category?: string | null;   // "light", "medium", "heavy"
  ac_display: string;
  strength_score_required?: number | null;
  grants_stealth_disadvantage?: boolean;
}

/** Search hits: magic items and mundane items, told apart by endpoint. */
type O5Gear = O5MagicItem | O5Item;

const stripTags = (text: string | null | undefined): string => (text ?? "").replace(/<[^>]+>/g, "").trim();

/** An API enum as printed: "FULL" → "Full", "FIGHTING_STYLE" → "Fighting Style", "Epic Boon" kept. */
export const humanize = (value: string): string => value.split(/[_\s]+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  .join(" ");

function formatO5MagicItem(hit: O5Hit<O5MagicItem>, origin: Open5eOrigin): string {
  const i = hit.entry.record;
  const attune = i.requires_attunement ? ` | Requires attunement${i.attunement_detail ? ` (${i.attunement_detail})` : ""}` : "";
  return [`${i.name} (${i.category.name}, ${i.rarity.name}${attune})`, o5Label(hit.entry.edition, origin, hit), ``, stripTags(i.desc)].join("\n");
}

function formatO5Item(hit: O5Hit<O5Item>, origin: Open5eOrigin): string {
  const i = hit.entry.record;
  // A zero or missing cost or weight prints a dash.
  const cost = Number(i.cost);
  const weight = Number(i.weight);
  const lines = [
    `${i.name} (${i.category.name})`,
    o5Label(hit.entry.edition, origin, hit),
    `Cost: ${cost > 0 ? `${cost} gp` : "—"} | Weight: ${weight > 0 ? `${weight}${i.weight_unit ? ` ${i.weight_unit}` : ""}` : "—"}`,
  ];
  const desc = stripTags(i.desc);
  if (desc) lines.push(``, desc);
  return lines.join("\n");
}

/** No cost or weight: those live on the weapon's `items` record. */
function formatO5Weapon(hit: O5Hit<O5Weapon>, origin: Open5eOrigin): string {
  const w = hit.entry.record;
  const lines = [`${w.name} (${w.is_simple ? "Simple" : "Martial"} Weapon)`, o5Label(hit.entry.edition, origin, hit)];
  const damage = [w.damage_dice, w.damage_type?.name].filter(Boolean).join(" ");
  if (damage) lines.push(`Damage: ${damage}`);
  if ((w.range ?? 0) > 0) {
    lines.push(`Range: ${w.range}${(w.long_range ?? 0) > 0 ? `/${w.long_range}` : ""}${w.distance_unit ? ` ${w.distance_unit}` : ""}`);
  }
  const props = w.properties ?? [];
  const plain = props.filter(p => p.property.type !== "Mastery").map(p => `${p.property.name}${p.detail ? ` (${p.detail})` : ""}`);
  if (plain.length) lines.push(`Properties: ${plain.join(", ")}`);
  for (const p of props.filter(p => p.property.type === "Mastery")) lines.push(`Mastery: ${p.property.name}`);
  return lines.join("\n");
}

function formatO5Armor(hit: O5Hit<O5Armor>, origin: Open5eOrigin): string {
  const a = hit.entry.record;
  // The 2024 Shield's record says "heavy" and an AC of "2": it is a +2 shield.
  const shield = normalizeName(a.name) === "shield";
  const category = a.category ? `${a.category.charAt(0).toUpperCase()}${a.category.slice(1)} ` : "";
  const strReq = a.strength_score_required ? ` | Requires STR ${a.strength_score_required}` : "";
  const stealth = a.grants_stealth_disadvantage ? ` | Stealth disadvantage` : "";
  return [
    `${a.name} (${shield ? "Shield" : `${category}Armor`})`,
    o5Label(hit.entry.edition, origin, hit),
    `AC: ${shield ? "+" : ""}${a.ac_display}${strReq}${stealth}`,
  ].join("\n");
}

export async function o5SearchItems(params: {
  name?: string;
  rarity?: string;
  type?: string;
  rulesEdition?: RulesEdition;
}, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  const rarity = params.rarity?.toLowerCase();
  const type = params.type?.toLowerCase();
  const { selected, hidden } = await o5Select<O5Gear>(["magicitems", "items"], requested, {
    name: params.name,
    // Mundane items have no rarity, so a rarity filter excludes them.
    passes: ({ record: i, endpoint }) =>
      (!rarity || (endpoint === "magicitems" && (i as O5MagicItem).rarity.name.toLowerCase().includes(rarity)))
      && (!type || i.category.name.toLowerCase().includes(type)),
  });

  const shown = selected.slice(0, 20);
  const lines = shown.map(({ entry }) => {
    const i = entry.record;
    const rarityName = entry.endpoint === "magicitems" ? `, ${(i as O5MagicItem).rarity.name}` : "";
    return `• ${i.name} ${editionTag(o5Info(entry))} (${i.category.name}${rarityName})`;
  });
  return o5SearchReply(
    requested, origin,
    `Found ${selected.length} item(s) (showing ${shown.length}, SRD only):`,
    lines, hidden, "No items found matching the criteria (SRD only).",
  );
}

/** One lookup across magic items, weapons, armour and gear, so an exact name in any of them beats a partial one. */
export async function o5GetEquipment(name: string, rulesEdition: RulesEdition, origin: Open5eOrigin): Promise<string | null> {
  const hit = await o5Lookup<O5Record>(["magicitems", "weapons", "armor", "items"], name, rulesEdition);
  if (!hit) return null;
  switch (hit.entry.endpoint) {
    case "magicitems": return formatO5MagicItem(hit as O5Hit<O5MagicItem>, origin);
    case "weapons": return formatO5Weapon(hit as O5Hit<O5Weapon>, origin);
    case "armor": return formatO5Armor(hit as O5Hit<O5Armor>, origin);
    default: return formatO5Item(hit as O5Hit<O5Item>, origin);
  }
}

// ── CHARACTER OPTIONS ─────────────────────────────────────────────────────────

/** A record of the same document, by key: a subrace's species or a subclass's class. */
async function o5Parent<T extends O5Record>(endpoint: O5Endpoint, edition: RulesEdition, key: string | null | undefined): Promise<T | undefined> {
  if (!key) return undefined;
  return (await loadO5Document<T>(endpoint, edition)).find(r => r.key === key);
}

/** An option search's reply: a single hit is its detail block (and the footer), else the result lines. */
async function o5OptionReply<T>(
  requested: RulesEdition,
  origin: "unavailable" | "not-found",
  result: { selected: Array<{ entry: O5Entry<T>; reason?: SelectionReason }>; hidden: number },
  opts: {
    /** Whether a single hit renders its detail block. */
    single: boolean;
    /** Counted in the heading: "race(s)". */
    counted: string;
    noMatch: string;
    detail: (hit: O5Hit<T>) => Promise<string>;
    line: (entry: O5Entry<T>) => Promise<string>;
  },
): Promise<string> {
  const { selected, hidden } = result;
  if (opts.single && selected.length === 1) {
    const footer = searchFooter(requested, hidden);
    return [await opts.detail(selected[0]), ...(footer ? [footer] : [])].join("\n");
  }
  const lines = await Promise.all(selected.map(({ entry }) => opts.line(entry)));
  return o5SearchReply(requested, origin, `Found ${selected.length} ${opts.counted} (SRD only):`, lines, hidden, opts.noMatch);
}

// ── Species

interface O5Trait { name: string; desc: string; type?: string | null; order?: number | null }

interface O5Species extends O5Record {
  subspecies_of?: string | null;
  traits?: O5Trait[];
}

/** A species' Size or Speed trait: by type (SRD 5.2), else by name (SRD 5.1). */
function speciesTrait(s: O5Species | undefined, kind: "SIZE" | "SPEED"): O5Trait | undefined {
  const traits = s?.traits ?? [];
  return traits.find(t => t.type === kind) ?? traits.find(t => normalizeName(t.name) === kind.toLowerCase());
}

/** Size, speed and parent of a species; a subrace without its own size or speed takes its parent's. */
async function speciesFacts(entry: O5Entry<O5Species>): Promise<{ parent?: O5Species; size?: O5Trait; speed?: O5Trait }> {
  const s = entry.record;
  const parent = await o5Parent<O5Species>("species", entry.edition, s.subspecies_of);
  return {
    parent,
    size: speciesTrait(s, "SIZE") ?? speciesTrait(parent, "SIZE"),
    speed: speciesTrait(s, "SPEED") ?? speciesTrait(parent, "SPEED"),
  };
}

async function formatO5Species(hit: O5Hit<O5Species>, origin: Open5eOrigin): Promise<string> {
  const s = hit.entry.record;
  const { size, speed } = await speciesFacts(hit.entry);
  const lines = [s.name, o5Label(hit.entry.edition, origin, hit)];
  const facts = [size && `Size: ${size.desc.trim()}`, speed && `Speed: ${speed.desc.trim()}`].filter(Boolean);
  if (facts.length) lines.push(facts.join(" | "));
  const traits = (s.traits ?? [])
    .map((t, i) => ({ t, order: t.order ?? i }))
    .filter(({ t }) => t !== size && t !== speed)
    .sort((a, b) => a.order - b.order);
  if (traits.length) lines.push(``, ...traits.map(({ t }) => `**${t.name}.** ${t.desc.trim()}`));
  return lines.join("\n");
}

/**
 * Species group by base race, as on D&D Beyond (nested mode in edition-search.ts):
 * selected per species name, then a base race with a pick in the requested
 * edition drops the other edition's picks and counts them hidden. So under 2024
 * the 2024 Elf replaces SRD 5.1's Elf and High Elf; under 2014 each subrace is
 * listed; and naming a subrace ("high elf") finds it under either edition.
 */
async function o5SelectSpecies(requested: RulesEdition, name?: string): ReturnType<typeof o5Select<O5Species>> {
  const { selected, hidden } = await o5Select<O5Species>(["species"], requested, { name });
  const bases = await Promise.all(selected.map(async ({ entry }) =>
    o5TwinName((await o5Parent<O5Species>("species", entry.edition, entry.record.subspecies_of))?.name ?? entry.record.name)));
  const withRequested = new Set(bases.filter((_, i) => selected[i].entry.edition === requested));
  const kept = selected.filter(({ entry }, i) => entry.edition === requested || !withRequested.has(bases[i]));
  return { selected: kept, hidden: hidden + selected.length - kept.length };
}

export async function o5SearchRaces(params: { name?: string; rulesEdition?: RulesEdition }, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5SelectSpecies(requested, params.name), {
    single: !!params.name,
    counted: "race(s)",
    noMatch: "No races found (SRD only).",
    detail: hit => formatO5Species(hit, origin),
    line: async entry => {
      const { parent, speed } = await speciesFacts(entry);
      return `• ${entry.record.name} ${editionTag(o5Info(entry))}${parent ? ` (subrace of ${parent.name})` : ""}${speed ? ` | Speed: ${speed.desc.trim()}` : ""}`;
    },
  });
}

// ── Classes

interface O5Class extends O5Record {
  hit_dice?: string | null;
  hit_points?: { hit_points_at_1st_level?: string | null } | null;
  saving_throws?: Array<{ name: string }>;
  caster_type?: string | null;
  subclass_of?: { name: string; key: string } | null;
  features?: Array<{ name: string; feature_type?: string | null }>;
}

/** A class's hit die, lower-cased; a subclass has none of its own and takes its class's. */
async function hitDie(entry: O5Entry<O5Class>): Promise<string | undefined> {
  const c = entry.record;
  const die = c.hit_dice ?? (await o5Parent<O5Class>("classes", entry.edition, c.subclass_of?.key))?.hit_dice;
  return die ? die.toLowerCase() : undefined;
}

async function formatO5Class(hit: O5Hit<O5Class>, origin: Open5eOrigin): Promise<string> {
  const c = hit.entry.record;
  const die = await hitDie(hit.entry);
  const lines = [c.name, o5Label(hit.entry.edition, origin, hit)];
  const hp = c.hit_points?.hit_points_at_1st_level;
  const dice = [die && `Hit Die: ${die}`, hp && `HP at 1st: ${hp}`].filter(Boolean);
  if (dice.length) lines.push(dice.join(" | "));
  if (c.saving_throws?.length) lines.push(`Saving Throws: ${c.saving_throws.map(s => s.name).join(", ")}`);
  if (c.caster_type && c.caster_type !== "NONE") lines.push(`Spellcasting: ${humanize(c.caster_type)}`);
  // Only class-level features: the rest are table rows (spell slots, proficiency bonus, starting equipment).
  const features = [...new Set((c.features ?? []).filter(f => f.feature_type === "CLASS_LEVEL_FEATURE").map(f => f.name))];
  if (features.length) lines.push(`Features: ${features.join(", ")}`);
  return lines.join("\n");
}

export async function o5SearchClasses(params: { name?: string; rulesEdition?: RulesEdition }, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5Select<O5Class>(["classes"], requested, { name: params.name }), {
    single: !!params.name,
    counted: "class(es)",
    noMatch: "No classes found (SRD only).",
    detail: hit => formatO5Class(hit, origin),
    line: async entry => {
      const die = await hitDie(entry);
      const sub = entry.record.subclass_of;
      return `• ${entry.record.name} ${editionTag(o5Info(entry))}${die ? ` (${die})` : ""}${sub ? ` | subclass of ${sub.name}` : ""}`;
    },
  });
}

// ── Backgrounds

interface O5Background extends O5Record {
  benefits?: Array<{ name: string; desc: string; type?: string | null }>;
}

function formatO5Background(hit: O5Hit<O5Background>, origin: Open5eOrigin): string {
  const b = hit.entry.record;
  const benefits = (b.benefits ?? []).map(x => `**${x.name}:** ${stripTags(x.desc)}`);
  return [b.name, o5Label(hit.entry.edition, origin, hit), ...(benefits.length ? [``, ...benefits] : [])].join("\n");
}

export async function o5SearchBackgrounds(params: { name?: string; rulesEdition?: RulesEdition }, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5Select<O5Background>(["backgrounds"], requested, { name: params.name }), {
    single: true,
    counted: "background(s)",
    noMatch: "No backgrounds found (SRD only).",
    detail: async hit => formatO5Background(hit, origin),
    line: async entry => {
      const skills = (entry.record.benefits ?? []).find(x => x.type === "skill_proficiency" || x.name === "Skill Proficiencies");
      return `• ${entry.record.name} ${editionTag(o5Info(entry))}${skills?.desc ? ` (${skills.desc})` : ""}`;
    },
  });
}

// ── Feats

interface O5Feat extends O5Record {
  desc?: string | null;
  type?: string | null;
  has_prerequisite?: boolean;
  prerequisite?: string | null;
  benefits?: Array<{ desc: string }>;
}

const prerequisite = (f: O5Feat): string =>
  (f.has_prerequisite && f.prerequisite ? f.prerequisite.replace(/^Prerequisite:\s*/i, "") : "");

function formatO5Feat(hit: O5Hit<O5Feat>, origin: Open5eOrigin): string {
  const f = hit.entry.record;
  const lines = [f.name, o5Label(hit.entry.edition, origin, hit)];
  if (f.type) lines.push(`Type: ${humanize(f.type)}`);
  if (prerequisite(f)) lines.push(`Prerequisite: ${prerequisite(f)}`);
  const body = [stripTags(f.desc), ...(f.benefits ?? []).map(x => `• ${stripTags(x.desc)}`)].filter(Boolean);
  if (body.length) lines.push(``, ...body);
  return lines.join("\n");
}

export async function o5SearchFeats(params: { name?: string; rulesEdition?: RulesEdition }, origin: "unavailable" | "not-found"): Promise<string> {
  const requested = params.rulesEdition ?? "2024";
  return o5OptionReply(requested, origin, await o5Select<O5Feat>(["feats"], requested, { name: params.name }), {
    single: true,
    counted: "feat(s)",
    noMatch: "No feats found (SRD only).",
    detail: async hit => formatO5Feat(hit, origin),
    line: async entry => `• ${entry.record.name} ${editionTag(o5Info(entry))}${prerequisite(entry.record) ? ` (${prerequisite(entry.record)})` : ""}`,
  });
}

// ── RULES ─────────────────────────────────────────────────────────────────────
// Rules come from the rulesets endpoint: a chapter with its sections. They are
// not twin-grouped: the requested document is searched first, then the other.

interface O5RuleSection { key: string; name: string; desc: string; index: number }
interface O5Ruleset extends O5Record { desc: string; rules: O5RuleSection[] }

/** Everything after a key's first "_": `srd-2024_combat_cover` → `combat_cover`. */
const ruleSlug = (key: string): string => key.slice(key.indexOf("_") + 1);

const otherEdition = (e: RulesEdition): RulesEdition => (e === "2024" ? "2014" : "2024");

/** One document's rulesets, a missing `desc` as "" and sections in index order. */
const rulesetsOf = async (edition: RulesEdition): Promise<O5Ruleset[]> =>
  (await loadO5Document<O5Ruleset>("rulesets", edition)).map(r => ({
    ...r,
    desc: r.desc ?? "",
    rules: (r.rules ?? []).map(s => ({ ...s, desc: s.desc ?? "" })).sort((a, b) => a.index - b.index),
  }));

/** The query as a slug: normalized, spaces → "-". */
const slugOf = (query: string): string => normalizeName(query).replace(/ /g, "-");

interface RuleMatch { ruleset: O5Ruleset; section?: O5RuleSection }

function findRule(rulesets: O5Ruleset[], query: string): RuleMatch | null {
  const q = normalizeName(query);
  if (!q) return null;
  const slug = slugOf(query);
  const same = (r: { key: string; name: string }): boolean =>
    normalizeName(r.name) === q || r.key.toLowerCase() === q || ruleSlug(r.key) === slug;
  const sectionSame = (r: O5RuleSection): boolean => same(r) || ruleSlug(r.key).split("_").pop() === slug;
  const sections = (test: (r: O5RuleSection) => boolean): RuleMatch | null => {
    for (const ruleset of rulesets) {
      const section = ruleset.rules.find(test);
      if (section) return { ruleset, section };
    }
    return null;
  };
  const exactSet = rulesets.find(same);
  if (exactSet) return { ruleset: exactSet };
  const exactSection = sections(sectionSame);
  if (exactSection) return exactSection;
  const partSet = rulesets.find(r => normalizeName(r.name).includes(q));
  if (partSet) return { ruleset: partSet };
  return sections(r => normalizeName(r.name).includes(q));
}

export async function o5SearchRules(query: string | undefined, rulesEdition: RulesEdition): Promise<string> {
  const q = query ? normalizeName(query) : "";
  const has = (text: string): boolean => normalizeName(text).includes(q);
  const search = async (edition: RulesEdition): Promise<string[]> => {
    const lines: string[] = [];
    for (const r of await rulesetsOf(edition)) {
      const sections = q ? r.rules.filter(s => has(s.name) || has(s.desc)) : [];
      if (q && !has(r.name) && !has(r.desc) && !sections.length) continue;
      const tag = editionTag({ ruleset: edition, book: null });
      lines.push(`• **${r.name}** ${tag} (slug: \`${ruleSlug(r.key)}\`)${sections.length ? ` — ${sections.map(s => s.name).join(", ")}` : ""}`);
    }
    return lines;
  };
  let edition = rulesEdition;
  let lines = await search(edition);
  let miss = false;
  if (!lines.length) {
    edition = otherEdition(rulesEdition);
    lines = await search(edition);
    miss = lines.length > 0;
  }
  if (!lines.length) return `No rules sections found matching "${query?.trim() ?? ""}" (SRD only).`;
  return [
    searchHeader({ rulesDoc: edition }),
    ...(miss ? [reasonLine(rulesEdition === "2024" ? "rules-search-miss-2024" : "rules-search-miss-2014")] : []),
    `Found ${lines.length} rules chapter(s)${q ? ` matching "${query!.trim()}"` : ""} (SRD only):`,
    ...lines,
    `\nUse ddb_get_rules with the section name or slug to read the full text.`,
  ].join("\n");
}

export async function o5GetRule(
  nameOrSlug: string,
  rulesEdition: RulesEdition,
  maxChars = 4000,
  query?: string
): Promise<string | null> {
  let edition = rulesEdition;
  let match = findRule(await rulesetsOf(edition), nameOrSlug);
  if (!match) {
    edition = otherEdition(rulesEdition);
    match = findRule(await rulesetsOf(edition), nameOrSlug);
  }
  if (!match) return null;

  const { ruleset, section } = match;
  let text = section
    ? section.desc
    : [ruleset.desc, ...ruleset.rules.map(s => `### ${s.name}\n${s.desc}`)].filter(Boolean).join("\n\n");

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

  const reason = edition === rulesEdition ? undefined : (rulesEdition === "2024" ? "rules-miss-2024" : "rules-miss-2014");
  return [
    `## ${(section ?? ruleset).name}`,
    rulesLine({ ruleset: edition, book: null }, { open5e: "primary", reason }),
    ...(section ? [`*Part of ${ruleset.name}*`] : []),
    ``,
    output + truncNote,
  ].join("\n");
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
    const key = o5TwinName(name);
    const group = (await o5Entries<O5Creature>(["creatures"], rulesEdition)).filter(e => o5TwinName(e.record.name) === key);
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
