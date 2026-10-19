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
import { arr, hasTag, num, obj, str, stripHtml } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, Mod } from "./types.js";
import type { TemplateResolver } from "./templates.js";

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
function buildFeatLines(char: CharData, resolveTemplates: TemplateResolver): {
  featLines: string[]; disguisedFeatLines: string[]; realFeatCount: number;
} {
  // DDB stores some non-feat entries in the feats array.
  // __DISGUISE_FEAT = class features surfaced as feats (shown in OTHER FEATURES).
  // __INITIAL_ASI   = 2024 background Ability Score Improvements (already in ABILITY SCORES; drop entirely).
  const allFeats = arr<Mod>(char.feats);
  const realFeats = allFeats.filter(
    f => !hasTag(f, "__DISGUISE_FEAT") && !hasTag(f, "__INITIAL_ASI")
  );
  const disguisedFeats = allFeats.filter(f => hasTag(f, "__DISGUISE_FEAT"));
  const featLines = realFeats.map(f => {
    const def = obj(f.definition);
    const snippet = resolveTemplates(stripHtml(str(def.snippet || def.description))).slice(0, 120);
    const line = `• ${str(def.name)}${snippet ? `: ${snippet}${snippet.length >= 120 ? "…" : ""}` : ""}`;
    return wrapIfHomebrew(line, def.isHomebrew === true);
  });
  const disguisedFeatLines = disguisedFeats.map(f => {
    const def = obj(f.definition);
    return wrapIfHomebrew(`• ${str(def.name)}`, def.isHomebrew === true);
  });
  return { featLines, disguisedFeatLines, realFeatCount: realFeats.length };
}

// ── Class features ───────────────────────────────────────────────────────────
function buildClassFeatureLines(classes: readonly ClassEntry[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const c of classes) {
    const charLevel = num(c.level);
    const classDef = obj(c.definition);
    const classHomebrew = classDef.isHomebrew === true;
    for (const cf of arr<Record<string, unknown>>(c.classFeatures)) {
      const def = obj(cf.definition);
      const line = `• ${str(def.name)} (${str(classDef.name)} ${num(def.requiredLevel || 1)})`;
      if (num(def.requiredLevel || 0) <= charLevel && !seen.has(line)) {
        seen.add(line);
        lines.push(wrapIfHomebrew(line, classHomebrew || def.isHomebrew === true));
      }
    }
  }
  return lines;
}

// ── Racial traits ────────────────────────────────────────────────────────────
function buildRacialTraitLines(char: CharData): string[] {
  const race = obj(char.race);
  const raceHomebrew = race.isHomebrew === true;
  return arr<Record<string, unknown>>(race.racialTraits).map(t => {
    const def = obj(t.definition);
    return wrapIfHomebrew(`• ${str(def.name)}`, raceHomebrew || def.isHomebrew === true);
  });
}

// ── Background feature ───────────────────────────────────────────────────────
function buildBackgroundFeature(char: CharData, resolveTemplates: TemplateResolver): BackgroundFeature {
  // For custom backgrounds, featureName may reflect a feat name rather than
  // the actual background feature. Check customBackground first if present.
  const bgObj = obj(char.background);
  const customBg = obj(bgObj.customBackground);
  const featuresBackgroundDef = obj(obj(customBg.featuresBackground).definition);
  const customBgDef = Object.keys(featuresBackgroundDef).length > 0
    ? featuresBackgroundDef
    : obj(customBg.definition);
  const usedCustom = Object.keys(customBgDef).length > 0;
  const bgDef = usedCustom ? customBgDef : obj(bgObj.definition);
  return {
    name: str(bgDef.featureName),
    isFeat: bgDef.featureIsFeat === true,
    descSnippet: bgDef.featureDescription
      ? resolveTemplates(stripHtml(str(bgDef.featureDescription))).slice(0, 300)
      : "",
    // A custom background's feature text is written by the player. Homebrew
    // backgrounds can come from someone else's shared collection.
    untrusted: usedCustom || bgDef.isHomebrew === true || bgObj.isHomebrew === true,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeFeatures(core: CoreStats): Features {
  const { char, classes, resolveTemplates } = core;
  const { featLines, disguisedFeatLines, realFeatCount } = buildFeatLines(char, resolveTemplates);
  return {
    featLines,
    disguisedFeatLines,
    realFeatCount,
    classFeatureLines: buildClassFeatureLines(classes),
    racialTraitLines: buildRacialTraitLines(char),
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
