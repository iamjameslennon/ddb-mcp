/**
 * Granting entities and action visibility, shared by the combat block
 * (actions.ts), the weapon rows (weapons.ts), the stats domain (stats.ts),
 * vitals (vitals.ts) and ddb_character_lookup (definition.ts).
 *
 * - Which definition grants an action or modifier (grantingEntities,
 *   grantingEntityNames), resolved by componentId / componentTypeId, and
 *   whether it is homebrew; bucketAnyHomebrew when none is named.
 * - Which class features and options the character has (visibleClassFeatureIds,
 *   hiddenOptionIds, chosenClassOptions) and so which actions show
 *   (isVisibleAction, spec §4).
 *
 * Split out of actions.ts by carry-over (bm), which also removed the
 * actions.ts ↔ weapons.ts import cycle. Pure: no output formatting.
 */

import { arr, featureDefinition, isHomebrewClassFeature, isHomebrewEntry, isRecord, num, obj, records, str } from "./helpers.js";
import type { CharData, ClassEntry, InventoryItem, Mod } from "./types.js";
import { resolveBackground } from "./features.js";

// ── Granting entities ────────────────────────────────────────────────────────
// D&D Beyond links an action to the definition that grants it: the action's
// componentId / componentTypeId are that definition's id / entityTypeId (live
// 2026-11-04, 56 characters: class features 12168134, racial traits 1960452172,
// feats 1088085227, class and feat options 258900837, race options 306912077).
// Matching both fields matters: ids repeat across entity types.
export const entityKey = (id: unknown, typeId: unknown): string => `${num(typeId)}:${num(id)}`;

/** Records `homebrew` under the definition's entityKey; a definition without an id or entity type is skipped. */
function addEntity(entities: Map<string, boolean[]>, def: unknown, homebrew: boolean): void {
  const d = obj(def);
  if (!num(d.id) || !num(d.entityTypeId)) return;
  const key = entityKey(d.id, d.entityTypeId);
  entities.set(key, [...(entities.get(key) ?? []), homebrew]);
}

/**
 * Every definition an action can name, keyed by entityKey, with whether it is
 * homebrew (as features.ts decides). Several entities can share a key; the
 * caller treats the key as homebrew when any of them is. Exported for tests.
 */
export function grantingEntities(char: CharData, classes: readonly ClassEntry[]): Map<string, boolean[]> {
  const entities = new Map<string, boolean[]>();
  walkBaseEntities(char, classes, (def, homebrew) => addEntity(entities, def, homebrew));
  return withOptions(char, entities);
}

/** Which kind of base entity a definition is (walkBaseEntities), for matching it to a lookup hit. */
export type EntityKind = "class-feature" | "racial-trait" | "feat" | "item" | "background";

/**
 * Every definition an action or modifier can name, in the order
 * grantingEntities records them (options excluded; see withOptions). Shared
 * with grantingEntityNames so the two cover the same sources.
 */
function walkBaseEntities(char: CharData, classes: readonly ClassEntry[], add: (def: unknown, homebrew: boolean, kind: EntityKind) => void): void {
  // Null or non-object entries are skipped.
  for (const cls of classes) {
    for (const cf of arr<unknown>(cls.classFeatures).filter(isRecord)) add(featureDefinition(cf), isHomebrewClassFeature(cf, cls), "class-feature");
    // Subclass features listed only on the subclass definition (plain shape).
    for (const cf of arr<unknown>(obj(cls.subclassDefinition).classFeatures).filter(isRecord)) add(featureDefinition(cf), isHomebrewClassFeature(cf, cls), "class-feature");
  }
  const race = obj(char.race);
  for (const t of arr<unknown>(race.racialTraits).filter(isRecord)) add(t.definition, isHomebrewEntry(t, race), "racial-trait");
  for (const f of arr<unknown>(char.feats).filter(isRecord)) add(f.definition, isHomebrewEntry(f), "feat");
  for (const i of arr<unknown>(char.inventory).filter(isRecord)) add(i.definition, isHomebrewEntry(i), "item");
  const { bgDef, untrusted } = resolveBackground(char);
  add(bgDef, untrusted, "background");
  // A custom background shows its own definition; an action can still name the stock one.
  if (obj(obj(char.background).definition) !== bgDef) add(obj(char.background).definition, untrusted, "background");
}

/**
 * The trimmed name of every definition grantingEntities knows, under the same
 * entityKey (options included). Where several share a key the first named wins.
 */
export function grantingEntityNames(char: CharData, classes: readonly ClassEntry[]): Map<string, string> {
  const names = new Map([...baseEntities(char, classes)].map(([key, e]) => [key, e.name]));
  for (const o of allOptions(char)) addName(names, o.definition, n => n);
  return names;
}

/** Records a definition's trimmed name (as `make` builds the value) under its entityKey; the first named wins. */
function addName<T>(names: Map<string, T>, def: unknown, make: (name: string) => T): void {
  const d = obj(def);
  const name = str(d.name).trim();
  if (!num(d.id) || !num(d.entityTypeId) || !name) return;
  const key = entityKey(d.id, d.entityTypeId);
  if (!names.has(key)) names.set(key, make(name));
}

/** The named definitions walkBaseEntities sees (options excluded), with their kind, by entityKey. */
export function baseEntities(char: CharData, classes: readonly ClassEntry[]): Map<string, { name: string; kind: EntityKind }> {
  const entities = new Map<string, { name: string; kind: EntityKind }>();
  walkBaseEntities(char, classes, (def, _homebrew, kind) => addName(entities, def, name => ({ name, kind })));
  return entities;
}

/** Every option the character chose, in every bucket (null or non-object entries skipped). */
export const allOptions = (char: CharData): Record<string, unknown>[] =>
  Object.values(obj(char.options)).flatMap(v => arr<unknown>(v)).filter(isRecord);

/**
 * Adds the options (a choice made under a class feature, racial trait, feat or
 * another option, linked to it the same way): an option is homebrew when it
 * or its owner is. Options can chain in any order across buckets, so they are
 * resolved to a fixed point: each round recomputes every option's flag from
 * the entities known so far. A flag only moves from unknown to false to true,
 * so it settles within 2 × options + 1 rounds. An option whose owner is never
 * found is added only when it is itself homebrew.
 */
function withOptions(char: CharData, base: Map<string, boolean[]>): Map<string, boolean[]> {
  const options = allOptions(char);
  const known = (flags: readonly (boolean | undefined)[]) => {
    const entities = new Map(base);
    options.forEach((o, i) => { if (flags[i] !== undefined) addEntity(entities, o.definition, flags[i]); });
    return entities;
  };
  let flags: (boolean | undefined)[] = options.map(() => undefined);
  for (let round = 0; round <= 2 * options.length; round++) {
    const entities = known(flags);
    const next = options.map(o => {
      const owner = entities.get(entityKey(o.componentId, o.componentTypeId));
      return owner ? isHomebrewEntry(o) || owner.some(Boolean) : isHomebrewEntry(o) ? true : undefined;
    });
    if (next.every((f, i) => f === flags[i])) break;
    flags = next;
  }
  return known(flags);
}

/**
 * Whether any entity that could have granted an action in `bucket` is
 * homebrew, for an action that names no entity on the sheet (e.g. a Tasha's
 * optional class feature that isn't in classFeatures). The granting entity
 * can't be told, so the line is wrapped when any candidate is homebrew
 * (owner ruling, option C): a class, its subclass or one of its class
 * features; the species or one of its racial traits; a feat; an item; or a
 * homebrew or custom background. The `subclass` bucket has the class
 * bucket's candidates.
 */
export function bucketAnyHomebrew(char: CharData, classes: readonly ClassEntry[], bucket: string): boolean {
  switch (bucket) {
    case "subclass":
    case "class": return classes.some(c => isHomebrewEntry(c, c.subclassDefinition)
      || arr<unknown>(c.classFeatures).some(cf => isHomebrewClassFeature(cf, c))
      || arr<unknown>(obj(c.subclassDefinition).classFeatures).some(cf => isHomebrewClassFeature(cf, c)));
    case "race": {
      const race = obj(char.race);
      return isHomebrewEntry(race) || arr<unknown>(race.racialTraits).some(t => isHomebrewEntry(t, race));
    }
    case "feat": return arr<Mod>(char.feats).some(f => isHomebrewEntry(f));
    case "item": return arr<InventoryItem>(char.inventory).some(i => isHomebrewEntry(i));
    case "background": return resolveBackground(char).untrusted;
    default: return false;
  }
}

// ── Class features, options and action visibility ────────────────────────────
/** entityTypeId of a class feature (and of the componentTypeId of an action it grants). */
export const CLASS_FEATURE_TYPE = 12168134;
export const OPTION_TYPE = 258900837;

/**
 * Ids of the class features the character has: each class's features whose
 * `requiredLevel` (a missing one counts as 1) is at most that class's `level`,
 * read from `classFeatures` (wrapped) and `subclassDefinition.classFeatures`
 * (plain) as core.ts does, plus every chosen optional class feature.
 */
export function visibleClassFeatureIds(char: CharData, classes: readonly ClassEntry[]): Set<number> {
  const ids = new Set<number>();
  for (const cls of classes) {
    const level = num(cls.level);
    const features = [
      ...arr<unknown>(cls.classFeatures),
      ...arr<unknown>(obj(cls.subclassDefinition).classFeatures),
    ].filter(isRecord);
    for (const cf of features) {
      const def = featureDefinition(cf);
      const id = num(def.id);
      if (id && (def.requiredLevel == null ? 1 : num(def.requiredLevel)) <= level) ids.add(id);
    }
  }
  for (const o of arr<unknown>(char.optionalClassFeatures).filter(isRecord)) {
    const id = num(o.classFeatureId);
    if (id) ids.add(id);
  }
  return ids;
}

/** Definition ids of the options whose owning class feature is not among `visibleIds`. */
export function hiddenOptionIds(char: CharData, visibleIds: ReadonlySet<number>): Set<number> {
  const hidden = new Set<number>();
  for (const o of allOptions(char)) {
    if (num(o.componentTypeId) !== CLASS_FEATURE_TYPE || visibleIds.has(num(o.componentId))) continue;
    const id = num(obj(o.definition).id);
    if (id) hidden.add(id);
  }
  return hidden;
}

/** Chosen class options (a Fighting Style, an Eldritch Invocation) keyed by their parent class feature's definition id. */
export type ChosenOptions = Map<number, Array<{ name: string; definition: Record<string, unknown>; homebrew: boolean }>>;

/**
 * The options the character chose under class features it has (`options.class`
 * only). An option whose parent feature is not visible (above the class level,
 * see hiddenOptionIds) is left out, as it is for its bonuses and actions.
 */
export function chosenClassOptions(char: CharData, classes: readonly ClassEntry[]): ChosenOptions {
  const hidden = hiddenOptionIds(char, visibleClassFeatureIds(char, classes));
  const out: ChosenOptions = new Map();
  for (const o of records(obj(char.options).class)) {
    if (num(o.componentTypeId) !== CLASS_FEATURE_TYPE) continue;
    const definition = obj(o.definition);
    const name = str(definition.name);
    if (!name || hidden.has(num(definition.id))) continue;
    const parent = num(o.componentId);
    const list = out.get(parent) ?? [];
    list.push({ name, definition, homebrew: isHomebrewEntry(o) });
    out.set(parent, list);
  }
  return out;
}

/**
 * Whether an action is shown (spec §4). Only the class bucket is filtered: an
 * action of a class feature the character lacks, or of an option under one, is
 * hidden. Other buckets keep their behaviour.
 */
export function isVisibleAction(
  bucket: string,
  action: Record<string, unknown>,
  visibleIds: ReadonlySet<number>,
  hiddenOptionIds: ReadonlySet<number>,
): boolean {
  if (bucket !== "class") return true;
  const type = num(action.componentTypeId);
  if (type === CLASS_FEATURE_TYPE) return visibleIds.has(num(action.componentId));
  if (type === OPTION_TYPE) return !hiddenOptionIds.has(num(action.componentId));
  return true;
}
