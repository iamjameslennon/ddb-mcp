/**
 * Defenses domain — damage resistances / immunities / vulnerabilities and
 * active conditions. Owns the defenses block.
 *
 * Phase 5b of the character.ts refactor — see docs/character-refactor.md.
 */

import { capitalize, isImmunityMod, isResistanceMod, isVulnerabilityMod, knownAndCustomLines, records, str } from "./helpers.js";
import { CONDITION_NAMES_BY_ID, DAMAGE_ADJUSTMENTS_BY_ID, DAMAGE_ADJUSTMENT_SLUGS } from "./modifier-slugs.js";
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

/** Marks a defense the player added by hand on the sheet. */
export const PLAYER_SET_NOTE = "(player-set)";

/**
 * Appends the player's own defenses (`customDefenseAdjustments`) to the known lists.
 * `type 2` is a rule-data damageAdjustments id, filed by that adjustment's own type
 * (1 resistance, 2 immunity, 3 vulnerability); `type 1` is a conditions id, a condition
 * immunity. An unknown id or type prints nothing. `source` is player-written and never
 * printed. A name a modifier already grants stays plain and prints once.
 */
function addPlayerSet(
  char: Record<string, unknown>,
  lists: { 1: DefenseList; 2: DefenseList; 3: DefenseList },
  granted: { 1: ReadonlySet<string>; 2: ReadonlySet<string>; 3: ReadonlySet<string> },
): void {
  for (const e of records(char.customDefenseAdjustments)) {
    const id = e.adjustmentId;
    let name: string | undefined;
    let kind: 1 | 2 | 3 | undefined;
    let slug = "";
    if (e.type === 2 && typeof id === "number" && Object.hasOwn(DAMAGE_ADJUSTMENTS_BY_ID, id)) {
      const adj = DAMAGE_ADJUSTMENTS_BY_ID[id]!;
      ({ name, slug } = adj);
      kind = adj.type;
    } else if (e.type === 1 && typeof id === "number" && Object.hasOwn(CONDITION_NAMES_BY_ID, id)) {
      name = CONDITION_NAMES_BY_ID[id];
      slug = slugOf(name!);
      kind = 2;
    }
    // Same defense already granted by a modifier of this kind: identity is the subType slug.
    if (name === undefined || kind === undefined || granted[kind].has(slug)) continue;
    const list = lists[kind];
    const marked = `${name} ${PLAYER_SET_NOTE}`;
    if (!list.known.includes(marked)) list.known.push(marked);
  }
}

export function computeDefenses(core: CoreStats): Defenses {
  const { char, allMods } = core;
  const res = allMods.filter(isResistanceMod);
  const imm = allMods.filter(isImmunityMod);
  const vul = allMods.filter(isVulnerabilityMod);
  const resistances = defenseList(res);
  const immunities = defenseList(imm);
  const vulnerabilities = defenseList(vul);
  addPlayerSet(char, { 1: resistances, 2: immunities, 3: vulnerabilities }, {
    1: new Set(res.map(m => m.subType)), 2: new Set(imm.map(m => m.subType)), 3: new Set(vul.map(m => m.subType)),
  });
  return {
    resistances,
    immunities,
    vulnerabilities,
    conditions: records(char.conditions).map(c => str(c.id)),
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
