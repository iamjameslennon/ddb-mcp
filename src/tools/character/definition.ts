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

import { stripHtml as stripHtmlFull, wrapUntrusted } from "../../utils.js";
import { fetchCharacter, withNotice } from "../character.js";
import { levenshteinDistance } from "./helpers.js";

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

function isHomebrew(record: Record<string, unknown>): boolean {
  return record.isHomebrew === true;
}

interface DefinitionHit {
  type: string;
  /** First line of the unwrapped body — the name — used when the hit list is summarized. */
  summary: string;
  text: string;
  /** Homebrew or a player-written custom background. The body is user-authored. */
  untrusted: boolean;
}

function hit(type: string, text: string, untrusted: boolean): DefinitionHit {
  return { type, summary: text.split("\n")[0] ?? "", text, untrusted };
}

function searchDefinitions(char: Record<string, unknown>, query: string): DefinitionHit[] {
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
    ...arr<Record<string, unknown>>(char.classSpells).flatMap(cs =>
      arr<Record<string, unknown>>(cs.spells)
    ),
    ...Object.values(obj(char.spells)).flatMap(v => arr<Record<string, unknown>>(v)),
  ];
  for (const spell of allSpells) {
    const name = str(obj(spell.definition).name || spell.name);
    if (name && matchesDefinitionQuery(name, query)) {
      const def = obj(spell.definition);
      results.push(hit("Spell", formatSpellResult(spell), isHomebrew(def) || isHomebrew(spell)));
    }
  }

  // ── Feats ─────────────────────────────────────────────────────────────────
  for (const feat of arr<Record<string, unknown>>(char.feats)) {
    const name = str(obj(feat.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push(hit("Feat", formatFeatResult(feat), isHomebrew(obj(feat.definition)) || isHomebrew(feat)));
    }
  }

  // ── Class & Subclass Features ─────────────────────────────────────────────
  const seen = new Set<string>();
  for (const cls of arr<Record<string, unknown>>(char.classes)) {
    const charLevel = num(cls.level);
    const classDef = obj(cls.definition);
    const className = str(classDef.name);
    const classHomebrew = isHomebrew(classDef) || isHomebrew(cls);

    for (const cf of arr<Record<string, unknown>>(cls.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push(hit(
          "Class Feature",
          formatClassFeatureResult(cf, className, requiredLevel),
          classHomebrew || isHomebrew(d) || isHomebrew(cf),
        ));
      }
    }

    const subDef = obj(cls.subclassDefinition);
    const subName = str(subDef.name);
    const subHomebrew = classHomebrew || isHomebrew(subDef);
    for (const cf of arr<Record<string, unknown>>(subDef.classFeatures)) {
      const d = obj(cf.definition);
      const name = str(d.name);
      const requiredLevel = num(d.requiredLevel || 1);
      const label = subName ? `${className} / ${subName}` : className;
      if (requiredLevel <= charLevel && name && matchesDefinitionQuery(name, query) && !seen.has(name)) {
        seen.add(name);
        results.push(hit(
          "Subclass Feature",
          formatClassFeatureResult(cf, label, requiredLevel),
          subHomebrew || isHomebrew(d) || isHomebrew(cf),
        ));
      }
    }
  }

  // ── Racial Traits ─────────────────────────────────────────────────────────
  const race = obj(char.race);
  const raceName = str(race.fullName || race.baseName);
  const raceHomebrew = isHomebrew(race);
  for (const trait of arr<Record<string, unknown>>(race.racialTraits)) {
    const def = obj(trait.definition);
    const name = str(def.name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push(hit(
        "Racial Trait",
        formatRacialTraitResult(trait, raceName),
        raceHomebrew || isHomebrew(def) || isHomebrew(trait),
      ));
    }
  }

  // ── Background Feature ────────────────────────────────────────────────────
  // Same resolution as the character sheet: a custom background's feature text
  // is the player's, and it wins over the stock definition.
  const bgObj = obj(char.background);
  const customBg = obj(bgObj.customBackground);
  const featuresBackgroundDef = obj(obj(customBg.featuresBackground).definition);
  const customBgDef = Object.keys(featuresBackgroundDef).length > 0
    ? featuresBackgroundDef
    : obj(customBg.definition);
  const usedCustom = Object.keys(customBgDef).length > 0;
  const bgDef = usedCustom ? customBgDef : obj(bgObj.definition);
  const bgFeatureName = str(bgDef.featureName);
  if (bgFeatureName && matchesDefinitionQuery(bgFeatureName, query)) {
    const bgName = str(bgDef.name || obj(bgObj.definition).name);
    const bgDesc = stripHtmlFull(str(bgDef.featureDescription));
    results.push(hit(
      "Background Feature",
      `${bgFeatureName} (${bgName})\n\n${bgDesc}`,
      usedCustom || isHomebrew(bgDef) || isHomebrew(bgObj),
    ));
  }

  // ── Equipped Items ────────────────────────────────────────────────────────
  for (const item of arr<Record<string, unknown>>(char.inventory)) {
    if (!item.equipped) continue;
    const name = str(obj(item.definition).name);
    if (name && matchesDefinitionQuery(name, query)) {
      results.push(hit(
        "Item",
        formatItemResult(item),
        isHomebrew(obj(item.definition)) || isHomebrew(item),
      ));
    }
  }

  return results;
}

export async function getDefinition(
  characterId: string,
  query: string,
): Promise<string> {
  const { json, notice } = await fetchCharacter(characterId);
  const raw = JSON.parse(json) as Record<string, unknown>;
  const char = (raw?.data ?? raw) as Record<string, unknown>;

  return withNotice(formatCharacterLookup(char, query), notice);
}

/** Format definition hits for a character object already in memory. */
export function formatCharacterLookup(char: Record<string, unknown>, query: string): string {
  return formatDefinitionHits(searchDefinitions(char, query), query);
}

function present(text: string, untrusted: boolean): string {
  return untrusted ? wrapUntrusted(text) : text;
}

function formatDefinitionHits(hits: ReturnType<typeof searchDefinitions>, query: string): string {
  if (hits.length === 0) {
    return `No definition found matching "${query}" on this character. Try a partial name like "hunter" for Hunter's Mark.`;
  }

  if (hits.length > 3) {
    const list = hits.map((h, i) => present(`${i + 1}. [${h.type}] ${h.summary}`, h.untrusted)).join("\n");
    return `Found ${hits.length} matches for "${query}". Be more specific, or here are the matches:\n\n${list}`;
  }

  return hits.map(h => `[${h.type}]\n${present(h.text, h.untrusted)}`).join("\n\n===\n\n");
}
