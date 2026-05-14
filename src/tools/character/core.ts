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

import { arr, num, modOf, obj, statKeys, statNames } from "./helpers.js";
import { makeResolveTemplates } from "./templates.js";
import type { CharData, ClassEntry, CoreStats, InventoryItem, Mod } from "./types.js";

export function computeCoreStats(char: CharData): CoreStats {
  // Flatten every modifier category — Object.values captures subclass and any
  // future categories that the old hardcoded list missed (e.g. subclass
  // modifiers like Remarkable Athlete).
  const allMods = Object.values(obj(char.modifiers))
    .flatMap(src => arr<Mod>(src));

  const classes = arr<ClassEntry>(char.classes);
  const totalLevel = classes.reduce((s, c) => s + num(c.level), 0);
  const profBonus = Math.floor((totalLevel - 1) / 4) + 2;

  // ── Ability Scores ─────────────────────────────────────────────────────────
  const baseStats = arr<Record<string, unknown>>(char.stats);
  const bonusStats = arr<Record<string, unknown>>(char.bonusStats);
  const overrideStats = arr<Record<string, unknown>>(char.overrideStats);

  const scoreBonuses: Record<number, number> = {};
  for (const m of allMods) {
    if (m.type === "bonus" && typeof m.subType === "string" && m.subType.endsWith("-score")) {
      const idx = statKeys.indexOf(m.subType.replace("-score", ""));
      if (idx >= 0) scoreBonuses[idx + 1] = (scoreBonuses[idx + 1] ?? 0) + num(m.fixedValue);
    }
  }

  const scoreSetValues: Record<number, number> = {};
  for (const m of allMods) {
    if (m.type === "set" && typeof m.subType === "string" && m.subType.endsWith("-score")) {
      const idx = statKeys.indexOf(m.subType.replace("-score", ""));
      if (idx >= 0) {
        const setVal = num(m.fixedValue ?? m.value);
        if (setVal > 0) scoreSetValues[idx + 1] = Math.max(scoreSetValues[idx + 1] ?? 0, setVal);
      }
    }
  }

  const statTotals = statNames.map((_, i) => {
    const id = i + 1;
    const base = baseStats.find(s => num(s.id) === id);
    const bonus = bonusStats.find(s => num(s.id) === id);
    const override = overrideStats.find(s => num(s.id) === id);
    const baseVal = num(base?.value ?? 0);
    const bonusVal = num(bonus?.value ?? 0);
    const overrideVal = override?.value != null ? num(override.value) : null;
    const calculated = overrideVal != null ? overrideVal : baseVal + bonusVal + (scoreBonuses[id] ?? 0);
    return scoreSetValues[id] != null ? Math.max(calculated, scoreSetValues[id]) : calculated;
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
