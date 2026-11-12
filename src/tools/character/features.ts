/**
 * Features domain — feats (real + disguised), class features, racial traits,
 * background feature. Owns the features block.
 *
 * Phase 5c of the character.ts refactor — see docs/character-refactor.md.
 *
 * Output strings are pre-formatted (e.g. featLines = ["• Great Weapon Master: …"])
 * to preserve byte-for-byte parity with the original inline code.
 */

import { wrapIfHomebrew, wrapUntrusted } from "../../utils.js";
import { records, hasTag, isHomebrewClassFeature, isHomebrewEntry, num, obj, str, stripHtml } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, Mod } from "./types.js";
import type { TemplateResolver } from "./templates.js";
import type { CharacterEditions } from "./editions.js";
import type { ChosenOptions } from "./actions.js";

export interface BackgroundFeature {
  name: string;        // empty string when there's no background feature to show
  isFeat: boolean;     // true means it overlaps a feat — rendered elsewhere
  descSnippet: string; // pre-resolved, pre-stripped, sliced to 300 chars
  /** Homebrew, or a custom background the player wrote. The name and description are user-authored. */
  untrusted: boolean;
}

export interface Features {
  featLines: string[];           // ["• Great Weapon Master: …", …]
  disguisedFeatLines: string[];   // ["• Action Surge", …]
  realFeatCount: number;          // for the "FEATS (N)" header
  classFeatureLines: string[];    // ["• Action Surge (Fighter 2)", …]
  racialTraitLines: string[];     // ["• Darkvision", …]
  background: BackgroundFeature;
}

// ── Feats ────────────────────────────────────────────────────────────────────
function buildFeatLines(char: CharData, resolveTemplates: TemplateResolver, editions: CharacterEditions): {
  featLines: string[]; disguisedFeatLines: string[]; realFeatCount: number;
} {
  // DDB stores some non-feat entries in the feats array.
  // __DISGUISE_FEAT = class features surfaced as feats (shown in OTHER FEATURES).
  // __INITIAL_ASI   = 2024 background Ability Score Improvements (already in ABILITY SCORES; drop entirely).
  const allFeats = records<Mod>(char.feats);
  const realFeats = allFeats.filter(
    f => !hasTag(f, "__DISGUISE_FEAT") && !hasTag(f, "__INITIAL_ASI")
  );
  const disguisedFeats = allFeats.filter(f => hasTag(f, "__DISGUISE_FEAT"));
  const featLines = realFeats.map(f => {
    const def = obj(f.definition);
    const snippet = resolveTemplates(stripHtml(str(def.snippet || def.description))).slice(0, 120);
    const line = `• ${editions.named(str(def.name), def)}${snippet ? `: ${snippet}${snippet.length >= 120 ? "…" : ""}` : ""}`;
    return wrapIfHomebrew(line, isHomebrewEntry(f));
  });
  const disguisedFeatLines = disguisedFeats.map(f => {
    const def = obj(f.definition);
    return wrapIfHomebrew(`• ${editions.named(str(def.name), f.definition)}`, isHomebrewEntry(f));
  });
  return { featLines, disguisedFeatLines, realFeatCount: realFeats.length };
}

// ── Class features ───────────────────────────────────────────────────────────
function buildClassFeatureLines(classes: readonly ClassEntry[], options: ChosenOptions): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const c of classes) {
    const charLevel = num(c.level);
    const classDef = obj(c.definition);
    for (const cf of records(c.classFeatures)) {
      const def = obj(cf.definition);
      const base = `• ${str(def.name)} (${str(classDef.name)} ${num(def.requiredLevel || 1)})`;
      if (num(def.requiredLevel || 0) <= charLevel && !seen.has(base)) {
        seen.add(base);
        // Chosen options print on their parent's line (owner ruling R1).
        const chosen = options.get(num(def.id)) ?? [];
        const line = chosen.length ? `${base}: ${chosen.map(o => o.name).join(", ")}` : base;
        lines.push(wrapIfHomebrew(line, isHomebrewClassFeature(cf, c) || chosen.some(o => o.homebrew)));
      }
    }
  }
  return lines;
}

// ── Racial traits ────────────────────────────────────────────────────────────
function buildRacialTraitLines(char: CharData, totalLevel: number): string[] {
  const race = obj(char.race);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const t of records(race.racialTraits)) {
    const def = obj(t.definition);
    // The sheet hides these (Age, Size, Languages, ASI, level-gated traits). Lookup, senses and
    // granted actions still read every trait. A sheet with no class levels shows its
    // level-gated traits (fail-open, owner ruling 2026-11-06).
    if (def.hideInSheet === true || obj(def.displayConfiguration).RACIALTRAIT === 0) continue;
    if (totalLevel > 0 && num(def.requiredLevel) > totalLevel) continue;
    const line = wrapIfHomebrew(`• ${str(def.name)}`, isHomebrewEntry(t, race));
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

// ── Background feature ───────────────────────────────────────────────────────
/**
 * The background definition whose feature the sheet shows, and whether its
 * text is untrusted: a custom definition the player wrote, or a homebrew one
 * (it can come from someone else's shared collection). A live-shape borrowed
 * `featuresBackground` is a stock D&D Beyond background (`definitionKey`,
 * `sources`), so it is untrusted only when it is homebrew. The sheet and
 * ddb_character_lookup both resolve it here.
 */
export function resolveBackground(char: CharData): { bgDef: Record<string, unknown>; untrusted: boolean } {
  // For custom backgrounds, featureName may reflect a feat name rather than
  // the actual background feature. Check customBackground first if present.
  const bgObj = obj(char.background);
  const customBg = obj(bgObj.customBackground);
  // Live (2026-11-06), featuresBackground is itself the definition whose
  // feature a custom background borrows, read only while the custom background
  // is in use (`hasCustomBackground`: a character with it off can still carry
  // one); a nested `.definition` is read as before.
  const featuresBg = obj(customBg.featuresBackground);
  const nestedFeaturesDef = obj(featuresBg.definition);
  if (Object.keys(nestedFeaturesDef).length === 0 && bgObj.hasCustomBackground === true && str(featuresBg.featureName) !== "") {
    return { bgDef: featuresBg, untrusted: isHomebrewEntry(featuresBg) };
  }
  const customBgDef = Object.keys(nestedFeaturesDef).length > 0
    ? nestedFeaturesDef
    : obj(customBg.definition);
  const usedCustom = Object.keys(customBgDef).length > 0;
  const bgDef = usedCustom ? customBgDef : obj(bgObj.definition);
  return { bgDef, untrusted: usedCustom || isHomebrewEntry(bgObj, bgDef) };
}

function buildBackgroundFeature(char: CharData, resolveTemplates: TemplateResolver): BackgroundFeature {
  const { bgDef, untrusted } = resolveBackground(char);
  return {
    name: str(bgDef.featureName),
    isFeat: bgDef.featureIsFeat === true,
    descSnippet: bgDef.featureDescription
      ? resolveTemplates(stripHtml(str(bgDef.featureDescription))).slice(0, 300)
      : "",
    untrusted,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeFeatures(core: CoreStats, options: ChosenOptions): Features {
  const { char, classes, totalLevel, resolveTemplates, editions } = core;
  const { featLines, disguisedFeatLines, realFeatCount } = buildFeatLines(char, resolveTemplates, editions);
  return {
    featLines,
    disguisedFeatLines,
    realFeatCount,
    classFeatureLines: buildClassFeatureLines(classes, options),
    racialTraitLines: buildRacialTraitLines(char, totalLevel),
    background: buildBackgroundFeature(char, resolveTemplates),
  };
}

export function formatFeaturesBlock(f: Features): string[] {
  return [
    `FEATS (${f.realFeatCount})`,
    ...(f.featLines.length ? f.featLines : ["  (none)"]),
    ``,
    ...(f.disguisedFeatLines.length ? [
      `OTHER FEATURES (stored as feats in API but NOT player-chosen feats)`,
      ...f.disguisedFeatLines,
      ``,
    ] : []),
    `CLASS FEATURES`,
    ...f.classFeatureLines,
    ``,
    `RACIAL TRAITS`,
    ...f.racialTraitLines,
    ``,
    ...(!f.background.name || f.background.isFeat ? [] : (() => {
      const desc = f.background.descSnippet;
      const descSnippet = desc ? `${desc}${desc.length >= 300 ? "…" : ""}` : "";
      const line = `  ${f.background.name}${descSnippet ? `: ${descSnippet}` : ""}`;
      return [
        `BACKGROUND FEATURE`,
        f.background.untrusted ? wrapUntrusted(line) : line,
        ``,
      ];
    })()),
  ];
}
