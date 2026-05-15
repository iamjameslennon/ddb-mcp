import { sessionFetch, hasValidSession, getCobaltToken } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { addCharacterSpellsToCompendium } from "./reference.js";
import { stripHtml as stripHtmlFull } from "../utils.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve, relative, basename, dirname, isAbsolute } from "path";
import { homedir } from "os";
import type { CharData, ParseSection } from "./character/types.js";
import { computeCoreStats } from "./character/core.js";
import { computeIdentity, formatHeaderBlock } from "./character/identity.js";
import { computeVitals, formatVitalsBlock } from "./character/vitals.js";
import { computeAc } from "./character/ac.js";
import { computeStats, formatStatsBlock } from "./character/stats.js";
import { computeDefenses, formatDefensesBlock } from "./character/defenses.js";
import { computeFeatures, formatFeaturesBlock } from "./character/features.js";
import { computeActions, formatCombatBlock } from "./character/actions.js";
import { computeSpells, formatSpellsBlock, formatConcentrationBlock } from "./character/spells.js";
import { computeInventory, formatInventoryBlock } from "./character/inventory.js";
import { computeNotes, formatNotesBlock } from "./character/notes.js";

// Cache character JSON to avoid redundant API calls within a session.
// TTL is configurable via DDB_CHARACTER_CACHE_TTL (seconds); default 60 s.
const CHARACTER_CACHE_TTL_MS = (() => {
  const raw = process.env.DDB_CHARACTER_CACHE_TTL;
  const seconds = raw ? parseInt(raw, 10) : 60;
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
})();
const characterCache = new TtlCache<string>(CHARACTER_CACHE_TTL_MS, 50);

/** Wipe the in-process character JSON cache. */
export function clearCharacterCache(): void {
  characterCache.clear();
}

// ── Character name resolution ─────────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Resolve a character name to a numeric ID using the character list API.
 * Resolution order: exact match → substring match → Levenshtein ≤3 on full
 * name and individual words (e.g. "Throin" matches "Thorin Ironforge").
 * Returns null if no match or multiple ambiguous fuzzy matches are found.
 */
export async function findCharacterByName(name: string): Promise<{ id: string; name: string } | null> {
  // Throw rather than return null when there's no session — otherwise callers
  // surface a misleading "No character found matching '<name>'" message that
  // looks like the character doesn't exist, when really the user just hasn't
  // logged in yet.
  if (!hasValidSession()) {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  const { token, userId } = await getCobaltToken();
  const resp = await sessionFetch(
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const result = await resp.json() as {
    data?: { characters?: Array<{ id: number; name: string }> };
  };
  const chars = (result.data?.characters ?? []).map(c => ({ id: String(c.id), name: c.name }));
  const lower = name.toLowerCase();

  // 1. Exact match
  const exact = chars.find(c => c.name.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Substring match (only if unambiguous)
  const sub = chars.filter(c => c.name.toLowerCase().includes(lower));
  if (sub.length === 1) return sub[0];

  // 3. Levenshtein fuzzy match on full name and individual words
  const fuzzy = chars.filter(c => {
    if (levenshteinDistance(lower, c.name.toLowerCase()) <= 3) return true;
    return c.name.split(/\s+/).some(w => levenshteinDistance(lower, w.toLowerCase()) <= 3);
  });
  if (fuzzy.length === 1) return fuzzy[0];

  return null;
}

export function parseCharacterData(
  raw: CharData,
  sections: ParseSection = "full"
): string {
  const char = (raw?.data ?? raw) as CharData;

  // Supplement spell compendium with this character's chosen spells (cantrips etc.)
  addCharacterSpellsToCompendium(char);

  // computeCoreStats produces every value used across multiple sections.
  // Phase 2 of the refactor. After phases 3–8 every domain consumes `core`
  // directly; only profBonus is still needed inline (threaded into vitals
  // for the formatter's prof line).
  const core = computeCoreStats(char);
  const { profBonus } = core;

  // ── Identity & Vitals ─────────────────────────────────────────────────────
  // Computed in ./character/identity.js and ./character/vitals.js (Phase 3 of the refactor).
  // Vitals owns HP, hit dice, speed, initiative, death saves. AC is its own
  // module (Phase 4) — for now, AC is computed inline below and threaded into
  // formatVitalsBlock as a separate parameter.
  const identity = computeIdentity(core);
  const vitals = computeVitals(core);

  // ── Armor Class ───────────────────────────────────────────────────────────
  // Computed in ./character/ac.js (Phase 4 of the refactor).
  const ac = computeAc(core);

  // ── Stats (saves / skills / senses / proficiencies) ──────────────────────
  // Computed in ./character/stats.js (Phase 5 of the refactor).
  const stats = computeStats(core);

  // ── Defenses & Conditions ─────────────────────────────────────────────────
  // Computed in ./character/defenses.js (Phase 5b of the refactor).
  const defenses = computeDefenses(core);

  // ── Features (feats + class features + racial traits + background feature) ──
  // Computed in ./character/features.js (Phase 5c of the refactor).
  const features = computeFeatures(core);

  // ── Combat actions (Actions / Bonus Actions / Reactions / Limited Use + Weapons) ──
  // Computed in ./character/actions.js (Phase 6b of the refactor) which
  // internally calls ./character/weapons.js (Phase 6a).
  const actions = computeActions(core);

  // ── Spells (Spellcasting / Spell Slots / Spells / Concentration) ─────────
  // Computed in ./character/spells.js (Phase 7 of the refactor).
  const spells = computeSpells(core);

  // ── Inventory (equipped armor / carried items / attunement / currency) ──
  // Computed in ./character/inventory.js (Phase 8 of the refactor).
  const inv = computeInventory(core);

  // ── Notes & Backstory ─────────────────────────────────────────────────────
  // Computed in ./character/notes.js (Phase 8 of the refactor).
  const notes = computeNotes(core);

  // ── Assemble named blocks ─────────────────────────────────────────────────
  // headerBlock and vitalsBlock are produced by ./character/identity.js and
  // ./character/vitals.js (Phase 3). AC is still computed inline above.
  const headerBlock = formatHeaderBlock(identity);
  const vitalsBlock = formatVitalsBlock(vitals, ac, profBonus);

  const statsBlock = formatStatsBlock(stats);

  const defensesBlock = formatDefensesBlock(defenses);

  const featuresBlock = formatFeaturesBlock(features);

  const combatBlock = formatCombatBlock(actions);

  const spellsBlock = formatSpellsBlock(spells);
  const concentrationBlock = formatConcentrationBlock(spells);

  const inventoryBlock = formatInventoryBlock(inv);
  const notesBlock = formatNotesBlock(notes);

  // ── Select blocks by section ──────────────────────────────────────────────
  const out: string[] = [...headerBlock];

  switch (sections) {
    case "summary":
      out.push(...vitalsBlock, ...statsBlock);
      break;
    case "combat":
      out.push(...vitalsBlock, ...statsBlock, ...defensesBlock, ...combatBlock);
      break;
    case "spells":
      out.push(...(spellsBlock.length ? spellsBlock : ["No spellcasting on this character."]));
      break;
    case "inventory":
      out.push(...inventoryBlock);
      break;
    case "features":
      out.push(...featuresBlock);
      break;
    case "concentration":
      out.push(...concentrationBlock);
      break;
    case "notes":
      out.push(...notesBlock);
      break;
    case "full":
    default:
      out.push(
        ...vitalsBlock, ...statsBlock, ...defensesBlock,
        ...featuresBlock, ...combatBlock, ...spellsBlock, ...inventoryBlock, ...notesBlock,
      );
      break;
  }

  return out.join("\n");
}

export async function parseCharacter(
  characterId: string,
  sections: ParseSection = "full"
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const raw = JSON.parse(jsonData) as Record<string, unknown>;
  return parseCharacterData(raw, sections);
}

/**
 * Fetch raw character JSON from the DnD Beyond API.
 * Uses saved session cookies — no browser needed after initial login.
 */
export async function getCharacter(
  characterId: string
): Promise<string> {
  const cacheKey = `character:${characterId}`;
  const cached = characterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://character-service.dndbeyond.com/character/v5/character/${encodeURIComponent(characterId)}?includeCustomItems=true`;

  // Public characters work without auth. Use session cookies if available so
  // private/campaign-only characters owned by the logged-in user also work.
  const resp = hasValidSession()
    ? await sessionFetch(url)
    : await fetch(url, { headers: { Accept: "application/json" } });

  if (resp.ok) {
    const result = await resp.json();
    const json = JSON.stringify(result);
    characterCache.set(cacheKey, json);
    return json;
  }

  // 404 = character doesn't exist; 403 = private
  if (resp.status === 403) {
    throw new Error(`Character ${characterId} is private and cannot be accessed.`);
  }
  throw new Error(`DnD Beyond API returned ${resp.status}: ${resp.statusText}`);
}

export async function downloadCharacter(
  characterId: string,
  outputPath?: string
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const parsed = JSON.parse(jsonData);
  const charName: string = parsed?.data?.name ?? `character-${characterId}`;

  // Sanitize the character name: keep only alphanumeric, spaces, hyphens, apostrophes.
  // basename ensures no path separators survive; the allowlist strips anything else.
  const safeName = basename(charName)
    .replace(/[^a-zA-Z0-9 '\-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 64) || `character-${characterId}`;
  const filename = `${safeName}-${characterId}.json`;
  const downloadsDir = join(homedir(), "Downloads");
  const defaultPath = join(downloadsDir, filename);

  let savePath: string;
  if (outputPath) {
    const resolved = resolve(outputPath);
    if (resolved.includes("\0")) throw new Error("Output path contains invalid characters.");
    const allowedDirs = [
      join(homedir(), "Downloads"),
      join(homedir(), "Documents"),
    ];
    // Require resolved to be a strict child of an allowed dir — rel must be
    // non-empty (rejects passing the root itself, which would later EISDIR),
    // not escape with .., and not be absolute (cross-drive on Windows).
    const isAllowed = allowedDirs.some(dir => {
      const rel = relative(dir, resolved);
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!isAllowed) {
      throw new Error("Output path must be a file under ~/Downloads or ~/Documents.");
    }
    savePath = resolved;
  } else {
    savePath = defaultPath;
  }

  // Minimal Linux installs (and some Windows profiles) don't ship with ~/Downloads
  // or ~/Documents — create the target dir so the write doesn't ENOENT. Safe to
  // do unconditionally because the allowlist above already constrained savePath.
  try {
    mkdirSync(dirname(savePath), { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(
      `Cannot create directory ${dirname(savePath)} (${code ?? "unknown"}). ` +
      `Pass output_path pointing to an existing directory under ~/Downloads or ~/Documents.`
    );
  }
  writeFileSync(savePath, JSON.stringify(parsed, null, 2), "utf8");
  return `Character data for '${charName}' saved to: ${savePath}`;
}

export async function listCharacters(): Promise<string> {
  if (!hasValidSession()) {
    throw new Error("No session found. Please run ddb_login first.");
  }

  const { token, userId } = await getCobaltToken();
  const resp = await sessionFetch(
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) throw new Error(`Character list API returned ${resp.status}: ${resp.statusText}`);

  const result = await resp.json() as {
    data?: {
      characters?: Array<{
        id: number; name: string; level: number; raceName: string;
        classDescription: string; campaignId: number | null; campaignName: string | null;
        statusSlug: string;
      }>;
    };
  };

  const characters = (result.data?.characters ?? []).map((c) => ({
    id: String(c.id),
    name: c.name,
    level: c.level,
    race: c.raceName,
    class: c.classDescription,
    status: c.statusSlug,
    campaignId: c.campaignId ? String(c.campaignId) : null,
    campaignName: c.campaignName ?? null,
  }));

  return JSON.stringify(characters);
}

// ── Definition Lookup ─────────────────────────────────────────────────────────


function matchesDefinitionQuery(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.includes(q)) return true;
  return name.split(/\s+/).some(w => levenshteinDistance(q, w.toLowerCase()) <= 2);
}

function formatSpellResult(spell: Record<string, unknown>): string {
  const d = (spell.definition ?? spell) as Record<string, unknown>;
  const name = String(d.name ?? "Unknown");
  const level = Number(d.level ?? 0);
  const school = String(d.school ?? "");
  const levelLabel = level === 0 ? "Cantrip" : `Level ${level}`;

  const ACTIVATION_TYPES: Record<number, string> = { 1: "Action", 3: "Bonus Action", 6: "Reaction" };
  const act = d.activation as Record<string, unknown> | undefined;
  const castingTime = act
    ? `${act.activationTime} ${ACTIVATION_TYPES[Number(act.activationType)] ?? "Action"}`
    : "1 Action";

  const rng = d.range as Record<string, unknown> | undefined;
  let range = "Self";
  if (rng) {
    if (rng.rangeValue && rng.origin !== "Self") range = `${rng.rangeValue} ft`;
    else range = String(rng.origin ?? "Self");
    if (rng.aoeType && rng.aoeValue) range += ` (${rng.aoeValue}-ft ${rng.aoeType})`;
  }

  const dur = d.duration as Record<string, unknown> | undefined;
  let duration = "Instantaneous";
  if (dur) {
    const isConc = dur.durationType === "Concentration";
    if (dur.durationInterval && dur.durationUnit) {
      duration = `${isConc ? "Concentration, up to " : ""}${dur.durationInterval} ${dur.durationUnit}${Number(dur.durationInterval) > 1 ? "s" : ""}`;
    } else if (isConc) {
      duration = "Concentration";
    }
  }

  const components = (Array.isArray(d.components) ? d.components : [])
    .map((c: number) => ({ 1: "V", 2: "S", 3: "M" })[c])
    .filter(Boolean)
    .join(", ");
  const matNote = d.componentsDescription ? ` (${d.componentsDescription})` : "";

  const lines = [
    `${name} (${levelLabel} ${school})`,
    `Casting Time: ${castingTime}`,
    `Range: ${range}`,
    `Components: ${components || "None"}${matNote}`,
    `Duration: ${duration}`,
  ];
  if (d.ritual) lines.push("Ritual: Yes");
  lines.push("", stripHtmlFull(String(d.description ?? "")));
  return lines.join("\n");
}

function formatFeatResult(feat: Record<string, unknown>): string {
  const d = (feat.definition ?? feat) as Record<string, unknown>;
  const lines = [String(d.name ?? "Unknown")];
  if (d.prerequisite) lines.push(`Prerequisite: ${d.prerequisite}`);
  lines.push("", stripHtmlFull(String(d.description ?? d.snippet ?? "")));
  return lines.join("\n");
}

function formatClassFeatureResult(
  feature: Record<string, unknown>,
  className: string,
  level: number
): string {
  const d = (feature.definition ?? feature) as Record<string, unknown>;
  const name = String(d.name ?? feature.name ?? "Unknown");
  const desc = stripHtmlFull(String(d.description ?? d.snippet ?? ""));
  return `${name} (${className}, Level ${level})\n\n${desc}`;
}

function formatRacialTraitResult(trait: Record<string, unknown>, raceName: string): string {
  const d = (trait.definition ?? trait) as Record<string, unknown>;
  const name = String(d.name ?? "Unknown");
  const desc = stripHtmlFull(String(d.description ?? d.snippet ?? ""));
  return `${name} (${raceName})\n\n${desc}`;
}

function formatItemResult(item: Record<string, unknown>): string {
  const d = (item.definition ?? item) as Record<string, unknown>;
  const name = String(d.name ?? "Unknown");
  const type = String(d.type ?? "Item");
  const rarity = String(d.rarity ?? "Common");
  const weight = d.weight != null ? `Weight: ${d.weight} lb\n` : "";
  const desc = stripHtmlFull(String(d.description ?? ""));
  return `${name} (${type}, ${rarity})\n${weight}\n${desc}`;
}

interface DefinitionHit {
  type: string;
  text: string;
}

function searchDefinitions(char: Record<string, unknown>, query: string): DefinitionHit[] {
  const results: DefinitionHit[] = [];

  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const obj = (v: unknown): Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  // ── Spells ────────────────────────────────────────────────────────────────
  const allSpells: Record<string, unknown>[] = [
    ...arr<Record<string, unknown>>(char.classSpells).flatMap(cs =>
      arr<Record<string, unknown>>(cs.spells)
    ),
    ...Object.values(obj(char.spells)).flatMap(v => arr<Record<string, unknown>>(v)),
  ];
  for (const spell of allSpells) {
    const name = str(obj(spell.definition).name || spell.name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Spell", text: formatSpellResult(spell) });
    }
  }

  // ── Feats ─────────────────────────────────────────────────────────────────
  for (const feat of arr<Record<string, unknown>>(char.feats)) {
    const name = str(obj(feat.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Feat", text: formatFeatResult(feat) });
    }
  }

  // ── Class & Subclass Features ─────────────────────────────────────────────
  const seen = new Set<string>();
  for (const cls of arr<Record<string, unknown>>(char.classes)) {
    const charLevel = num(cls.level);
    const className = str(obj(cls.definition).name);

    for (const cf of arr<Record<string, unknown>>(cls.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push({
          type: "Class Feature",
          text: formatClassFeatureResult(cf, className, requiredLevel),
        });
      }
    }

    const subDef = obj(cls.subclassDefinition);
    const subName = str(subDef.name);
    for (const cf of arr<Record<string, unknown>>(subDef.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      const label = subName ? `${className} / ${subName}` : className;
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push({
          type: "Subclass Feature",
          text: formatClassFeatureResult(cf, label, requiredLevel),
        });
      }
    }
  }

  // ── Racial Traits ─────────────────────────────────────────────────────────
  const raceName = str(obj(char.race).fullName || obj(char.race).baseName);
  for (const trait of arr<Record<string, unknown>>(obj(char.race).racialTraits)) {
    const name = str(obj(trait.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Racial Trait", text: formatRacialTraitResult(trait, raceName) });
    }
  }

  // ── Background Feature ────────────────────────────────────────────────────
  const bgDef = obj(obj(char.background).definition);
  const bgFeatureName = str(bgDef.featureName);
  if (bgFeatureName && matchesDefinitionQuery(bgFeatureName, query)) {
    const bgName = str(bgDef.name);
    const bgDesc = stripHtmlFull(str(bgDef.featureDescription));
    results.push({
      type: "Background Feature",
      text: `${bgFeatureName} (${bgName})\n\n${bgDesc}`,
    });
  }

  // ── Equipped Items ────────────────────────────────────────────────────────
  for (const item of arr<Record<string, unknown>>(char.inventory)) {
    if (!item.equipped) continue;
    const name = str(obj(item.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({ type: "Item", text: formatItemResult(item) });
    }
  }

  return results;
}

export async function getDefinition(
  characterId: string,
  query: string
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const raw = JSON.parse(jsonData) as Record<string, unknown>;
  const char = (raw?.data ?? raw) as Record<string, unknown>;

  const hits = searchDefinitions(char, query);

  if (hits.length === 0) {
    return `No definition found matching "${query}" on this character. Try a partial name like "hunter" for Hunter's Mark.`;
  }

  if (hits.length > 3) {
    const list = hits.map((h, i) => `${i + 1}. [${h.type}] ${h.text.split("\n")[0]}`).join("\n");
    return `Found ${hits.length} matches for "${query}". Be more specific, or here are the matches:\n\n${list}`;
  }

  return hits.map(h => `[${h.type}]\n${h.text}`).join("\n\n===\n\n");
}

