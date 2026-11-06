/**
 * Identity domain — name, race (with 2024 variant detection), class line,
 * background, XP, inspiration, and the rules summary line. Owns the header
 * block. Species, class, subclass and background carry their edition tags.
 *
 * Phase 3 of the character.ts refactor — see docs/character-refactor.md.
 */

import { wrapUntrusted } from "../../utils.js";
import { arr, isHomebrewEntry, num, obj, str } from "./helpers.js";
import type { CharacterEditions } from "./editions.js";
import type { CharData, ClassEntry, CoreStats } from "./types.js";

export interface Identity {
  charName: string;
  rulesLine: string;
  race: string;
  classLine: string;
  totalLevel: number;
  background: string;
  xp: number;
  inspiration: boolean;
  /** The species (or a lineage option), a class or a subclass is homebrew: the species / class line is wrapped. */
  raceClassHomebrew: boolean;
  /** The background is custom or homebrew: the Background line is wrapped. */
  backgroundUntrusted: boolean;
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
  // No species object: the lineage stands alone, not as " (Wood Elf)".
  if (!base) return variant;
  // Avoid "Wood Elf (Wood Elf)" if the base race name already mentions the
  // variant (defensive — happens when fullName has been pre-decorated).
  if (base.toLowerCase().includes(variant.toLowerCase())) return base;
  return `${base} (${variant})`;
}

function buildClassLine(classes: readonly ClassEntry[], editions: CharacterEditions): string {
  return classes.map(c => {
    const name = `${str(obj(c.definition).name)}${editions.classTag(c)}`;
    const sub = obj(c.subclassDefinition);
    const lvl = num(c.level);
    return sub.name ? `${name} (${sub.name}${editions.subclassTag(c)}) ${lvl}` : `${name} ${lvl}`;
  }).join(" / ");
}

export function computeIdentity(core: CoreStats): Identity {
  const { char, classes, totalLevel, editions } = core;
  // A missing species or background stays empty rather than a bare tag.
  // A custom background in use (live shape: `hasCustomBackground`) prints the
  // player's own name for it (`customBackground.name`), untagged, as it has no
  // definition to classify. With no name it prints the stock background whose
  // feature it borrows (`customBackground.featuresBackground`, a definition of
  // its own, as resolveBackground reads it), since `background.definition` can
  // be stale (live: Dunil's Noble beside a Criminal / Spy feature); else the
  // stock background, as before.
  const bgObj = obj(char.background);
  const inUse = bgObj.hasCustomBackground === true;
  const customBgName = inUse ? str(obj(bgObj.customBackground).name).trim() : "";
  const borrowed = obj(obj(bgObj.customBackground).featuresBackground);
  const borrowedShown = inUse && customBgName === "" && Object.keys(obj(borrowed.definition)).length === 0
    && str(borrowed.name).trim() !== "";
  const bgDef = borrowedShown ? borrowed : bgObj.definition;
  return {
    charName: str(char.name),
    rulesLine: editions.rulesLine,
    // A lineage with no (or a nameless) species object has no definition to classify: untagged.
    race: str(obj(char.race).fullName || obj(char.race).baseName) ? editions.named(deriveRace(char), char.race) : deriveRace(char),
    classLine: buildClassLine(classes, editions),
    totalLevel,
    background: customBgName || editions.named(str(obj(bgDef).name), bgDef),
    xp: num(char.currentXp),
    inspiration: !!char.inspiration,
    raceClassHomebrew: isHomebrewEntry(char.race, ...arr(obj(char.options).race))
      || classes.some(c => isHomebrewEntry(c, c.subclassDefinition)),
    // Wrapped by what the line prints: the player's custom name, or a homebrew
    // definition (the one shown, or the background record's own).
    backgroundUntrusted: customBgName !== "" || isHomebrewEntry(borrowedShown ? borrowed : char.background, bgDef),
  };
}

/**
 * The header box. The character's name is the player's own text (another
 * player's, in ddb_get_party), so it is always delimited as untrusted; the
 * species / class line and the Background line are wrapped whole when an entry
 * on them is homebrew or custom (F-2026-10-20). Borders, the Rules line and
 * Inspiration stay plain.
 */
export function formatHeaderBlock(i: Identity): string[] {
  const wrapIf = (line: string, untrusted: boolean): string => untrusted ? wrapUntrusted(line) : line;
  return [
    `═══════════════════════════════════════`,
    wrapIf(`  ${i.charName}`, i.charName !== ""),
    `  ${i.rulesLine}`,
    wrapIf(`  ${i.race} | ${i.classLine} | Level ${i.totalLevel}`, i.raceClassHomebrew),
    wrapIf(`  Background: ${i.background || "—"} | XP: ${i.xp}`, i.backgroundUntrusted),
    `  Inspiration: ${i.inspiration ? "Yes" : "No"}`,
    `═══════════════════════════════════════`,
    ``,
  ];
}
