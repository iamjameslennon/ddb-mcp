/**
 * Defenses domain — damage resistances / immunities / vulnerabilities and
 * active conditions. Owns the defenses block.
 *
 * Phase 5b of the character.ts refactor — see docs/character-refactor.md.
 */

import { arr, capitalize, isImmunityMod, isResistanceMod, isVulnerabilityMod, str } from "./helpers.js";
import type { CoreStats } from "./types.js";

export interface Defenses {
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  conditions: string[];
}

export function computeDefenses(core: CoreStats): Defenses {
  const { char, allMods } = core;
  return {
    resistances: [...new Set(
      allMods.filter(isResistanceMod).map(m => capitalize(m.subType))
    )],
    immunities: [...new Set(
      allMods.filter(isImmunityMod).map(m => capitalize(m.subType))
    )],
    vulnerabilities: [...new Set(
      allMods.filter(isVulnerabilityMod).map(m => capitalize(m.subType))
    )],
    conditions: arr<Record<string, unknown>>(char.conditions).map(c => str(c.id)),
  };
}

export function formatDefensesBlock(d: Defenses): string[] {
  return [
    `DEFENSES`,
    `  Resistances: ${d.resistances.length ? d.resistances.join(", ") : "(none)"}`,
    `  Immunities: ${d.immunities.length ? d.immunities.join(", ") : "(none)"}`,
    `  Vulnerabilities: ${d.vulnerabilities.length ? d.vulnerabilities.join(", ") : "(none)"}`,
    `CONDITIONS: ${d.conditions.length ? d.conditions.join(", ") : "(none)"}`,
    ``,
  ];
}
