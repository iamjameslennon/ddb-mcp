/**
 * `computeCoreStats(char)` — the foundation context object for the character
 * module.
 *
 * Phase 2 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Computes the values that every per-domain module (vitals, stats, ac,
 * weapons, spells, …) needs: flattened modifiers, classes, total level,
 * proficiency bonus, ability scores + mods, inventory, and the template
 * resolver. Computed once at the top of `parseCharacterData` and threaded
 * downstream.
 */

import { arr, isBonusMod, isSetMod, num, modOf, obj, statKeys, statNames } from "./helpers.js";
import { makeResolveTemplates } from "./templates.js";
import type { CharData, ClassEntry, CoreStats, InventoryItem, Mod } from "./types.js";

export function computeCoreStats(char: CharData): CoreStats {
  const classes = arr<ClassEntry>(char.classes);
  const totalLevel = classes.reduce((s, c) => s + num(c.level), 0);
  const profBonus = Math.floor((totalLevel - 1) / 4) + 2;

  // PHB multiclass rule: only the *starting* class grants saving-throw
  // proficiencies. DDB still hoists every class's Proficiencies-feature
  // modifiers into modifiers.class regardless, so we drop the non-starting
  // save-prof entries here at the source. Collect the starting class's
  // classFeature + subclassFeature ids; a save-prof mod whose componentId
  // is in that set is from the starting class and stays.
  const startingClass = classes.find(c => c.isStartingClass === true) ?? classes[0];
  const startingClassFeatureIds = new Set<number>();
  if (startingClass) {
    for (const cf of arr<Record<string, unknown>>(startingClass.classFeatures)) {
      const id = num(obj(cf.definition).id);
      if (id) startingClassFeatureIds.add(id);
    }
    for (const cf of arr<Record<string, unknown>>(obj(startingClass.subclassDefinition).classFeatures)) {
      const id = num(obj(cf.definition).id);
      if (id) startingClassFeatureIds.add(id);
    }
  }
  const isStartingClassSaveProf = (m: Mod): boolean => {
    if (m.type !== "proficiency") return true;
    if (typeof m.subType !== "string" || !m.subType.includes("saving-throws")) return true;
    const cid = num(m.componentId);
    // cid === 0 means no componentId (hand-built fixtures, older DDB data) —
    // keep, since we can't disprove it's from the starting class.
    return cid === 0 || startingClassFeatureIds.has(cid);
  };

  const allMods = Object.entries(obj(char.modifiers)).flatMap(([source, list]) => {
    const mods = arr<Mod>(list);
    return source === "class" || source === "subclass"
      ? mods.filter(isStartingClassSaveProf)
      : mods;
  });

  // ── Ability Scores ─────────────────────────────────────────────────────────
  const baseStats = arr<Record<string, unknown>>(char.stats);
  const bonusStats = arr<Record<string, unknown>>(char.bonusStats);
  const overrideStats = arr<Record<string, unknown>>(char.overrideStats);

  // Sum ability-score `bonus` modifiers, but iterate per-source so we can
  // gate race-sourced bonuses on `isGranted`. In the 2024 rules ability
  // score increases come from the character's background (origin feat),
  // not from race — DDB still emits the race-categorized ASI modifiers in
  // the JSON, but they carry `isGranted: false` and the website ignores
  // them. We must too, or the race ASI gets double-counted against
  // char.stats (which already includes it).
  //
  // 2014-era race ASIs always have `isGranted: true` (or no flag at all
  // on hand-built fixtures), so the gate is backwards-compatible: a
  // missing flag is treated as granted.
  const scoreBonuses: Record<number, number> = {};
  for (const [source, list] of Object.entries(obj(char.modifiers))) {
    for (const m of arr<Mod>(list)) {
      if (!isBonusMod(m)) continue;
      if (!m.subType.endsWith("-score")) continue;
      if (source === "race" && m.isGranted === false) continue;
      const idx = statKeys.indexOf(m.subType.replace("-score", ""));
      if (idx >= 0) scoreBonuses[idx + 1] = (scoreBonuses[idx + 1] ?? 0) + num(m.fixedValue);
    }
  }

  const scoreSetValues: Record<number, number> = {};
  for (const m of allMods) {
    if (isSetMod(m) && m.subType.endsWith("-score")) {
      const idx = statKeys.indexOf(m.subType.replace("-score", ""));
      if (idx >= 0) {
        const setVal = num(m.fixedValue ?? m.value);
        if (setVal > 0) scoreSetValues[idx + 1] = Math.max(scoreSetValues[idx + 1] ?? 0, setVal);
      }
    }
  }

  // PHB cap: ability scores from race/class/feat/background ASI sources max
  // out at 20 (both 2014 and 2024 PHB). Two sources are explicitly allowed
  // to exceed: manual overrides via `overrideStats` and `type:"set"` item
  // modifiers (Belt of Giant Strength, Manual of Bodily Health, etc.).
  // Without this cap, characters like Calderax (base 18 + multiple +1 ASIs)
  // display as 21 (+5) while the DDB website shows 20 (+5).
  const ABILITY_SCORE_CAP = 20;
  const statTotals = statNames.map((_, i) => {
    const id = i + 1;
    const base = baseStats.find(s => num(s.id) === id);
    const bonus = bonusStats.find(s => num(s.id) === id);
    const override = overrideStats.find(s => num(s.id) === id);
    const baseVal = num(base?.value ?? 0);
    const bonusVal = num(bonus?.value ?? 0);
    const overrideVal = override?.value != null ? num(override.value) : null;
    const calculated = overrideVal != null ? overrideVal : baseVal + bonusVal + (scoreBonuses[id] ?? 0);
    const capped = overrideVal != null ? calculated : Math.min(calculated, ABILITY_SCORE_CAP);
    return scoreSetValues[id] != null ? Math.max(capped, scoreSetValues[id]) : capped;
  });
  const statMods = statTotals.map(modOf);

  const inventory = arr<InventoryItem>(char.inventory);
  const resolveTemplates = makeResolveTemplates(profBonus, totalLevel);

  return {
    char,
    allMods,
    statTotals,
    statMods,
    profBonus,
    totalLevel,
    classes,
    inventory,
    resolveTemplates,
  };
}
