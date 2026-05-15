/**
 * Identity domain — name, race (with 2024 variant detection), class line,
 * background, XP, inspiration. Owns the header block.
 *
 * Phase 3 of the character.ts refactor — see docs/character-refactor.md.
 */

import { arr, num, obj, str } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats } from "./types.js";

export interface Identity {
  charName: string;
  race: string;
  classLine: string;
  totalLevel: number;
  background: string;
  xp: number;
  inspiration: boolean;
}

/**
 * 2024 races store the sub-selection (Elven Lineage, Fiendish Legacy, Giant
 * Ancestry, Gnomish Lineage, …) in `char.options.race[]` rather than in the
 * subRaceShortName field that 2014 characters use. The option name encodes
 * the chosen variant — e.g. "Wood Elf Lineage", "Infernal Legacy",
 * "Stone's Endurance (Stone Giant)". Pattern-match the suffix so this is
 * generic across every 2024 race that follows the same naming convention.
 *
 * Note: 2024 Aasimar Celestial Revelation is *not* a creation-time choice —
 * the player picks one of Heavenly Wings / Inner Radiance / Necrotic Shroud
 * each time they transform, and `char.options.race` is empty for Aasimar.
 * Header correctly shows just "Aasimar" with no parenthetical.
 */
function detectRaceVariant(char: CharData): string | null {
  for (const opt of arr<Record<string, unknown>>(obj(char.options).race)) {
    const name = str(obj(opt.definition).name).trim();
    if (!name) continue;
    // "Wood Elf Lineage" / "High Elf Lineage" / "Drow Lineage"
    //  / "Forest Gnome Lineage" / "Rock Gnome Lineage" / …
    let m = name.match(/^(.+?)\s+Lineage$/);
    if (m) return m[1];
    // "Infernal Legacy" / "Abyssal Legacy" / "Chthonic Legacy"
    m = name.match(/^(.+?)\s+Legacy$/);
    if (m) return m[1];
    // Giant Ancestry: "Stone's Endurance (Stone Giant)" etc.
    m = name.match(/\(([A-Za-z]+)\s+Giant\)$/);
    if (m) return m[1];
  }
  return null;
}

function deriveRace(char: CharData): string {
  const base = str(obj(char.race).fullName || obj(char.race).baseName);
  const variant = detectRaceVariant(char);
  if (!variant) return base;
  // Avoid "Wood Elf (Wood Elf)" if the base race name already mentions the
  // variant (defensive — happens when fullName has been pre-decorated).
  if (base.toLowerCase().includes(variant.toLowerCase())) return base;
  return `${base} (${variant})`;
}

function buildClassLine(classes: readonly ClassEntry[]): string {
  return classes.map(c => {
    const def = obj(c.definition);
    const sub = obj(c.subclassDefinition);
    const lvl = num(c.level);
    return sub.name ? `${def.name} (${sub.name}) ${lvl}` : `${def.name} ${lvl}`;
  }).join(" / ");
}

export function computeIdentity(core: CoreStats): Identity {
  const { char, classes, totalLevel } = core;
  return {
    charName: str(char.name),
    race: deriveRace(char),
    classLine: buildClassLine(classes),
    totalLevel,
    background: str(obj(obj(char.background).definition).name),
    xp: num(char.currentXp),
    inspiration: !!char.inspiration,
  };
}

export function formatHeaderBlock(i: Identity): string[] {
  return [
    `═══════════════════════════════════════`,
    `  ${i.charName}`,
    `  ${i.race} | ${i.classLine} | Level ${i.totalLevel}`,
    `  Background: ${i.background || "—"} | XP: ${i.xp}`,
    `  Inspiration: ${i.inspiration ? "Yes" : "No"}`,
    `═══════════════════════════════════════`,
    ``,
  ];
}
