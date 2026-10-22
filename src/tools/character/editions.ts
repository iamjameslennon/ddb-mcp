/**
 * Editions domain — which ruleset each piece of a character comes from,
 * classified once per sheet: the `Rules:` summary line and the inline tags.
 *
 * Rules-edition phase 5 — see docs/superpowers/specs/2026-10-16-rules-edition-design.md.
 *
 * Classes decide the main edition and always classify with plain
 * `classifyEdition`. Everything else goes through `classifyCharacterEntry`, so
 * a definition printed in both editions (Dagger, Leather) takes the main one.
 * Only what the sheet shows is classified: feats (real and disguised), the
 * spells the SPELLS section lists, and the items the sheet prints. All label
 * text comes from src/edition.ts.
 */

import {
  characterMainEdition, characterRulesLine, characterTag, classifyCharacterEntry, classifyEdition, editionTag,
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
  /** classifyCharacterEntry(def, index, main), for every non-class definition (decision 11). */
  info(def: unknown): EditionInfo;
  /** "" when characterTag(info(def), main) is null, else " [2014]" etc. Non-class definitions. */
  tag(def: unknown): string;
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

  const info = (def: unknown): EditionInfo => classifyCharacterEntry(markers(def), index, main);
  const entry = (name: string, kind: CharacterEntryKind, def: unknown): CharacterEditionEntry =>
    ({ name, kind, info: info(def) });
  const subclassDiffers = (cls: ClassEntry): boolean =>
    isObject(cls.subclassDefinition) && info(cls.subclassDefinition).ruleset !== classInfo(cls).ruleset;

  const entries: CharacterEditionEntry[] = [...classEntries];
  for (const c of classes) {
    if (subclassDiffers(c)) entries.push(entry(str(obj(c.subclassDefinition).name), "subclass", c.subclassDefinition));
  }
  if (isObject(char.race)) {
    entries.push(entry(str(char.race.fullName || char.race.baseName), "species", char.race));
  }
  const background = obj(char.background).definition;
  if (isObject(background)) entries.push(entry(str(background.name), "background", background));
  for (const f of arr<Mod>(char.feats)) {
    if (hasTag(f, "__INITIAL_ASI")) continue;
    entries.push(entry(str(obj(f.definition).name), "feat", f.definition));
  }
  for (const def of dedupeDefinitions(shownSpellDefinitions(char, classes))) {
    entries.push(entry(str(def.name), "spell", def));
  }
  for (const def of dedupeDefinitions(shownItemDefinitions(arr<InventoryItem>(char.inventory)))) {
    entries.push(entry(str(def.name), "item", def));
  }

  const asTag = (t: string | null): string => (t ? ` ${t}` : "");
  return {
    main,
    rulesLine: characterRulesLine(entries),
    info,
    tag: def => asTag(characterTag(info(def), main)),
    classTag: cls => asTag(characterTag(classInfo(cls), main)),
    subclassTag: cls => (subclassDiffers(cls) ? ` ${editionTag(info(cls.subclassDefinition))}` : ""),
  };
}
