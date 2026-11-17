/**
 * Defenses domain — damage resistances / immunities / vulnerabilities and
 * active conditions. Owns the defenses block.
 *
 * Phase 5b of the character.ts refactor — see docs/character-refactor.md.
 */

import { arr, capitalize, isImmunityMod, isResistanceMod, isVulnerabilityMod, knownAndCustomLines, str } from "./helpers.js";
import { DAMAGE_ADJUSTMENT_SLUGS } from "./modifier-slugs.js";
import type { CoreStats, Mod } from "./types.js";

/** One defense list: known D&D Beyond values, and subTypes printed on a wrapped `(custom)` line. */
export interface DefenseList {
  known: string[];
  custom: string[];
}

export interface Defenses {
  resistances: DefenseList;
  immunities: DefenseList;
  vulnerabilities: DefenseList;
  conditions: string[];
}

/** The slug a display name stands for: lowercase, other runs of non-alphanumerics as "-". */
const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * D&D Beyond's wording for a known defense (`friendlySubtypeName`, "Magical Sleep" for
 * `magical-sleep`), but only when that name is the subType spelled out in plain text
 * (letters, digits, spaces and light punctuation). Anything else falls back to
 * capitalize(subType), so a mismatched or unusual friendly name is never printed.
 */
function defenseName(m: Mod & { subType: string }): string {
  const name = m.friendlySubtypeName;
  const plain = typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9 ,'’-]*$/.test(name);
  return plain && slugOf(name) === m.subType ? name : capitalize(m.subType);
}

/**
 * A subType is printed as the defense's name, so an unknown one is untrusted text (F-2026-10-20).
 * A known subType prints its allowlisted name (F15), so it stays plain.
 */
function defenseList(mods: ReadonlyArray<Mod & { subType: string }>): DefenseList {
  const known: string[] = [];
  const custom: string[] = [];
  for (const m of mods) {
    if (DAMAGE_ADJUSTMENT_SLUGS.has(m.subType)) known.push(defenseName(m));
    else custom.push(capitalize(m.subType));
  }
  return { known: [...new Set(known)], custom: [...new Set(custom)] };
}

export function computeDefenses(core: CoreStats): Defenses {
  const { char, allMods } = core;
  return {
    resistances: defenseList(allMods.filter(isResistanceMod)),
    immunities: defenseList(allMods.filter(isImmunityMod)),
    vulnerabilities: defenseList(allMods.filter(isVulnerabilityMod)),
    conditions: arr<Record<string, unknown>>(char.conditions).map(c => str(c.id)),
  };
}

export function formatDefensesBlock(d: Defenses): string[] {
  const list = (label: string, l: DefenseList) => knownAndCustomLines("  ", label, l.known, l.custom, "(none)");
  return [
    `DEFENSES`,
    ...list("Resistances", d.resistances),
    ...list("Immunities", d.immunities),
    ...list("Vulnerabilities", d.vulnerabilities),
    `CONDITIONS: ${d.conditions.length ? d.conditions.join(", ") : "(none)"}`,
    ``,
  ];
}
