/**
 * Definition lookup — searches a character's known spells, feats, class &
 * subclass features, racial traits, background feature, and equipped items
 * for a name match, and returns formatted definitions for the hits.
 *
 * Phase 9 of the character.ts refactor — see docs/character-refactor.md.
 *
 * `getDefinition` is the public entry point (re-exported from character.ts).
 * It depends on `fetchCharacter` from the network/IO layer in character.ts
 * — that import is intentionally one-way (definition consumes IO, not
 * the other way around).
 */

import { stripHtml as stripHtmlFull, wrapIfHomebrew } from "../../utils.js";
import { classifyEdition, editionTag, rulesLine, type EditionInfo, type EditionMarkers, type SourceIndex } from "../../edition.js";
import { getSourceIndex, LOGGED_OUT_CHARACTER_INDEX_WAIT_MS } from "../../game-config.js";
import { fetchCharacter, withNotice } from "../character.js";
import { computeCharacterEditions, type CharacterEditions } from "./editions.js";
import { featureDefinition, isHomebrewClassFeature, isHomebrewEntry, levenshteinDistance, records } from "./helpers.js";
import { resolveBackground } from "./features.js";
import type { CharData } from "./types.js";

function matchesDefinitionQuery(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.includes(q)) return true;
  return name.split(/\s+/).some(w => levenshteinDistance(q, w.toLowerCase()) <= 2);
}

function formatSpellResult(spell: Record<string, unknown>): string {
  const d = (spell.definition ?? spell) as Record<string, unknown>;
  const name = String(d.name || spell.name || "Unknown");
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
  level: number,
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
  /** The entry's own name; every `format*Result` first line starts with it. */
  name: string;
  /** Whose ruleset the entry belongs to (decision 6). */
  info: EditionInfo;
  text: string;
  /** Homebrew or a player-written custom background: the text is user-authored. */
  untrusted: boolean;
}

function searchDefinitions(char: Record<string, unknown>, query: string, editions: CharacterEditions, index: SourceIndex): DefinitionHit[] {
  const results: DefinitionHit[] = [];

  // searchDefinitions intentionally keeps these as locals (not the shared
  // helpers) — its tolerance for unexpected shapes differs slightly (e.g.
  // it accepts `spell.name` as a fallback for `spell.definition.name`).
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const obj = (v: unknown): Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  // ── Spells ────────────────────────────────────────────────────────────────
  const allSpells: Record<string, unknown>[] = [
    // Same fallback as the sheet's classSpellLists (spells.ts): 2024 format uses cs.classSpells.
    ...records(char.classSpells).flatMap(cs =>
      records(cs.spells).length > 0 ? records(cs.spells) : records(cs.classSpells)
    ),
    ...Object.values(obj(char.spells)).flatMap(v => records(v)),
  ];
  for (const spell of allSpells) {
    const name = str(obj(spell.definition).name || spell.name);
    if (name && matchesDefinitionQuery(name, query)) {
      // A homebrew spell (including one listed under classSpells[].classSpells,
      // the 2024 format) can come from another player's shared collection.
      results.push({
        type: "Spell", name, info: editions.info(spell.definition ?? spell), text: formatSpellResult(spell),
        untrusted: isHomebrewEntry(spell),
      });
    }
  }

  // ── Feats ─────────────────────────────────────────────────────────────────
  for (const feat of records(char.feats)) {
    const name = str(obj(feat.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({
        type: "Feat", name, info: editions.info(feat.definition), text: formatFeatResult(feat),
        untrusted: isHomebrewEntry(feat),
      });
    }
  }

  // ── Class & Subclass Features ─────────────────────────────────────────────
  const seen = new Set<string>();
  for (const cls of arr<Record<string, unknown>>(char.classes)) {
    const charLevel = num(cls.level);
    const classDef = obj(cls.definition);
    const className = str(classDef.name);

    for (const cf of records(cls.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push({
          type: "Class Feature",
          name,
          info: classifyEdition(classDef as EditionMarkers, index),
          text: formatClassFeatureResult(cf, className, requiredLevel),
          untrusted: isHomebrewClassFeature(cf, cls),
        });
      }
    }

    const subDef = obj(cls.subclassDefinition);
    const subName = str(subDef.name);
    // Plain definitions here, unlike classes[].classFeatures (featureDefinition reads both shapes).
    for (const cf of arr<Record<string, unknown>>(subDef.classFeatures)) {
      const d = featureDefinition(cf);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      const label = subName ? `${className} / ${subName}` : className;
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push({
          type: "Subclass Feature",
          name,
          info: editions.info(subDef),
          text: formatClassFeatureResult(cf, label, requiredLevel),
          untrusted: isHomebrewClassFeature(cf, cls),
        });
      }
    }
  }

  // ── Racial Traits ─────────────────────────────────────────────────────────
  const race = obj(char.race);
  const raceName = str(race.fullName || race.baseName);
  for (const trait of records(race.racialTraits)) {
    const def = obj(trait.definition);
    const name = str(def.name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({
        type: "Racial Trait", name, info: editions.info(char.race), text: formatRacialTraitResult(trait, raceName),
        untrusted: isHomebrewEntry(trait, race),
      });
    }
  }

  // ── Background Feature ────────────────────────────────────────────────────
  // Same resolution as the character sheet (features.ts): a custom
  // background's feature text is the player's, and it wins over the stock
  // definition. The rules line stays the stock background's, as in the header.
  const stockBgDef = obj(obj(char.background).definition);
  const { bgDef, untrusted: bgUntrusted } = resolveBackground(char);
  const bgFeatureName = str(bgDef.featureName);
  // A feature that is a feat is the feat's own entry (found above), as on the
  // sheet, which leaves it out of BACKGROUND FEATURE.
  const bgFeatureIsFeat = bgDef.featureIsFeat === true;
  if (bgFeatureName && !bgFeatureIsFeat && matchesDefinitionQuery(bgFeatureName, query)) {
    const bgName = str(bgDef.name || stockBgDef.name);
    const bgDesc = stripHtmlFull(str(bgDef.featureDescription));
    results.push({
      type: "Background Feature",
      name: bgFeatureName,
      info: editions.info(stockBgDef),
      text: `${bgFeatureName} (${bgName})\n\n${bgDesc}`,
      untrusted: bgUntrusted,
    });
  }

  // ── Equipped Items ────────────────────────────────────────────────────────
  for (const item of records(char.inventory)) {
    if (!item.equipped) continue;
    const name = str(obj(item.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push({
        type: "Item", name, info: editions.info(item.definition), text: formatItemResult(item),
        untrusted: isHomebrewEntry(item),
      });
    }
  }

  return results;
}

export async function getDefinition(
  characterId: string,
  query: string,
): Promise<string> {
  // Alongside the character fetch; a failed fetch withdraws it, as nothing will read it.
  const indexCtl = new AbortController();
  const indexPromise = getSourceIndex({ signal: indexCtl.signal, loggedOutWaitMs: LOGGED_OUT_CHARACTER_INDEX_WAIT_MS });
  const { json, notice } = await fetchCharacter(characterId).catch((err: unknown) => { indexCtl.abort(); throw err; });
  const raw = JSON.parse(json) as Record<string, unknown>;
  const char = (raw?.data ?? raw) as Record<string, unknown>;
  const index = await indexPromise;

  return withNotice(formatCharacterLookup(char, query, index), notice);
}

/** Pure: the formatted lookup reply for a character, labelled with each hit's ruleset. */
export function formatCharacterLookup(char: Record<string, unknown>, query: string, index: SourceIndex): string {
  const editions = computeCharacterEditions(char as CharData, index);
  return formatDefinitionHits(searchDefinitions(char, query, editions, index), query);
}

function formatDefinitionHits(hits: DefinitionHit[], query: string): string {
  if (hits.length === 0) {
    return `No definition found matching "${query}" on this character. Try a partial name like "hunter" for Hunter's Mark.`;
  }

  if (hits.length > 3) {
    const list = hits.map((h, i) => {
      const first = h.text.split("\n")[0];
      return wrapIfHomebrew(`${i + 1}. [${h.type}] ${h.name} ${editionTag(h.info)}${first.slice(h.name.length)}`, h.untrusted);
    }).join("\n");
    return `Found ${hits.length} matches for "${query}". Be more specific, or here are the matches:\n\n${list}`;
  }

  return hits.map(h => {
    const [first, ...rest] = h.text.split("\n");
    // The whole block, rules line included, is delimited when it is user-authored.
    return `[${h.type}]\n${wrapIfHomebrew([first, rulesLine(h.info), ...rest].join("\n"), h.untrusted)}`;
  }).join("\n\n===\n\n");
}
