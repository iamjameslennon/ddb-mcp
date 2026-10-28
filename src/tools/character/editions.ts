/**
 * Editions domain — which ruleset each piece of a character comes from,
 * classified once per sheet: the `Rules:` summary line and the inline tags.
 *
 * Rules-edition phase 5 — see docs/superpowers/specs/2026-10-16-rules-edition-design.md.
 *
 * Classes decide the main edition and always classify with plain
 * `classifyEdition`. Everything else goes through `classifyForEdition`, so
 * a definition printed in both editions (Dagger, Leather) takes the main one.
 * Only what the sheet shows is classified: feats (real and disguised), the
 * spells the SPELLS section lists, and the items the sheet prints. All label
 * text comes from src/edition.ts.
 */

import {
  characterMainEdition, characterRulesLine, characterTag, classifyForEdition, classifyEdition, editionTag,
  type CharacterEditionEntry, type CharacterEntryKind, type EditionInfo, type EditionMarkers,
  type RulesEdition, type SourceIndex,
} from "../../edition.js";
import { arr, hasTag, num, obj, str } from "./helpers.js";
import { shownSpellDefinitions } from "./spells.js";
import type { CharData, ClassEntry, InventoryItem, Mod } from "./types.js";

export interface CharacterEditions {
  main: RulesEdition | "unstated";
  /** characterRulesLine over the classified entries (decisions 2–4). */
  rulesLine: string;
  /** classifyForEdition(def, index, main), for every non-class definition (decision 11). */
  info(def: unknown): EditionInfo;
  /** "" when characterTag(info(def), main) is null, else " [2014]" etc. Non-class definitions. */
  tag(def: unknown): string;
  /** `name + tag(def)`, or "" when the name is empty so an empty name never gets a bare tag. */
  named(name: string, def: unknown): string;
  /** The class definition's tag from classifyEdition (decision 11), same "" / " [x]" form. */
  classTag(cls: ClassEntry): string;
  /** "" for a null subclass or one whose ruleset equals its class's (classifyEdition for the class, info() for the subclass), else " " + editionTag(subclass info). */
  subclassTag(cls: ClassEntry): string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

const markers = (def: unknown): EditionMarkers => obj(def) as EditionMarkers;

// The items the sheet prints: every non-weapon (EQUIPPED / INVENTORY) plus the
// equipped weapons (ACTIONS). Mirrors inventory.ts and weapons.ts.
function shownItemDefinitions(inventory: readonly InventoryItem[]): Record<string, unknown>[] {
  return inventory
    .filter(i => str(obj(i.definition).filterType) !== "Weapon" || i.equipped === true)
    .map(i => obj(i.definition));
}

// One entry per definition id, else per name, keeping the first.
function dedupeDefinitions(defs: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return defs.filter(def => {
    const id = num(def.id);
    const key = id ? `id:${id}` : `name:${str(def.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function computeCharacterEditions(char: CharData, index: SourceIndex): CharacterEditions {
  const classes = arr<ClassEntry>(char.classes);
  const classInfo = (cls: ClassEntry): EditionInfo => classifyEdition(markers(cls.definition), index);

  const classEntries: CharacterEditionEntry[] = classes.map(c => ({
    name: str(obj(c.definition).name), kind: "class", level: num(c.level), info: classInfo(c),
  }));
  const { main } = characterMainEdition(classEntries);

  const info = (def: unknown): EditionInfo => classifyForEdition(markers(def), index, main);
  const entry = (name: string, kind: CharacterEntryKind, def: unknown): CharacterEditionEntry =>
    ({ name, kind, info: info(def) });
  const subclassDiffers = (cls: ClassEntry): boolean =>
    isObject(cls.subclassDefinition) && info(cls.subclassDefinition).ruleset !== classInfo(cls).ruleset;

  const entries: CharacterEditionEntry[] = [...classEntries];
  for (const c of classes) {
    if (subclassDiffers(c) && str(obj(c.subclassDefinition).name)) entries.push(entry(str(obj(c.subclassDefinition).name), "subclass", c.subclassDefinition));
  }
  if (isObject(char.race)) {
    const speciesName = str(char.race.fullName || char.race.baseName);
    if (speciesName) entries.push(entry(speciesName, "species", char.race));
  }
  const background = obj(char.background).definition;
  if (isObject(background) && str(background.name)) entries.push(entry(str(background.name), "background", background));
  for (const f of arr<Mod>(char.feats)) {
    if (hasTag(f, "__INITIAL_ASI")) continue;
    const featName = str(obj(f.definition).name);
    if (featName) entries.push(entry(featName, "feat", f.definition));
  }
  // A nameless spell or item is printed as an empty slot but is not counted.
  for (const def of dedupeDefinitions(shownSpellDefinitions(char, classes).filter(d => str(d.name)))) {
    entries.push(entry(str(def.name), "spell", def));
  }
  for (const def of dedupeDefinitions(shownItemDefinitions(arr<InventoryItem>(char.inventory)).filter(d => str(d.name)))) {
    entries.push(entry(str(def.name), "item", def));
  }

  const asTag = (t: string | null): string => (t ? ` ${t}` : "");
  const tag = (def: unknown): string => asTag(characterTag(info(def), main));
  return {
    main,
    rulesLine: characterRulesLine(entries),
    info,
    tag,
    named: (name, def) => (name ? `${name}${tag(def)}` : ""),
    classTag: cls => asTag(characterTag(classInfo(cls), main)),
    subclassTag: cls => (subclassDiffers(cls) ? ` ${editionTag(info(cls.subclassDefinition))}` : ""),
  };
}
