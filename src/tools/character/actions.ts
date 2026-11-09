/**
 * Actions domain — ACTIONS / BONUS ACTIONS / REACTIONS / OTHER / LIMITED USE.
 * Owns the combat block.
 *
 * Phase 6b of the character.ts refactor — see docs/character-refactor.md.
 *
 * Hides class-bucket actions of class features the character lacks (which
 * subsumes the Dark Bargain Circle Spell leak), lists one-action attack
 * spells and damaging cantrips in ACTIONS (spell-attacks.ts), surfaces
 * activationType 3/4 spells into bonus-action and reaction lists (with the
 * spellbook prepared/ritual gate applied), and computes "X used / Y max"
 * for limited-use features (including stat-mod-keyed uses like Bardic
 * Inspiration). Output is pre-formatted lines.
 *
 * A homebrew spell's line, and the line of an action granted by a homebrew
 * entity (resolved by componentId / componentTypeId, see grantingEntities),
 * is other players' text and is wrapped whole.
 */

import { wrapIfHomebrew } from "../../utils.js";
import { arr, featureDefinition, isHomebrewClassFeature, isHomebrewEntry, num, obj, records, shownHomebrew, signed, str } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, InventoryItem, Mod } from "./types.js";
import { resolveBackground } from "./features.js";
import type { CharacterEditions } from "./editions.js";
import { actionSpells } from "./spells.js";
import { computeSpellAttackRows } from "./spell-attacks.js";
import { computeUnarmedStrike, computeWeaponAttacks } from "./weapons.js";
import { MASTERY_NAMES } from "../weapon-mastery.js";

export interface Actions {
  weaponAttacks: string[];        // ["• Longsword        +5 to hit   1d8+3 slashing (1d10+3 two-handed)   reach 5 ft.   Versatile", …]
  unarmedStrike: string[];        // ["• Unarmed Strike   +5 to hit   3 bludgeoning   reach 5 ft."]
  spellAttacks: string[];         // ["• Fire Bolt (cantrip)        +5 to hit   2d10 fire   range 120 ft.", …] (one-action attack spells and damaging save cantrips)
  actionFeatures: string[];       // ["• Channel Divinity", "• Channel Divinity: Sear Undead   1d8", …]
  offHandAttacks: string[];       // equipped weapons flagged as the off-hand (BONUS ACTIONS)
  bonusActions: string[];         // ["• Bardic Inspiration   1d6", "• Healing Word (spell, 1st-level slot)", …]
  reactions: string[];            // ["• Opportunity Attack", "• Uncanny Dodge", …]
  otherFeatures: string[];        // ["• Sneak Attack   3d6", …] (activationType 8, Special)
  limitedUseFeatures: string[];   // ["• Action Surge   0 used / 1 max   (Short Rest)", …]
}

// ── Granting entities ────────────────────────────────────────────────────────
// D&D Beyond links an action to the definition that grants it: the action's
// componentId / componentTypeId are that definition's id / entityTypeId (live
// 2026-11-04, 56 characters: class features 12168134, racial traits 1960452172,
// feats 1088085227, class and feat options 258900837, race options 306912077).
// Matching both fields matters: ids repeat across entity types.
export const entityKey = (id: unknown, typeId: unknown): string => `${num(typeId)}:${num(id)}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

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

/**
 * Every definition an action or modifier can name, in the order
 * grantingEntities records them (options excluded; see withOptions). Shared
 * with grantingEntityNames so the two cover the same sources.
 */
function walkBaseEntities(char: CharData, classes: readonly ClassEntry[], add: (def: unknown, homebrew: boolean) => void): void {
  // Null or non-object entries are skipped.
  for (const cls of classes) {
    for (const cf of arr<unknown>(cls.classFeatures).filter(isRecord)) add(featureDefinition(cf), isHomebrewClassFeature(cf, cls));
    // Subclass features listed only on the subclass definition (plain shape).
    for (const cf of arr<unknown>(obj(cls.subclassDefinition).classFeatures).filter(isRecord)) add(featureDefinition(cf), isHomebrewClassFeature(cf, cls));
  }
  const race = obj(char.race);
  for (const t of arr<unknown>(race.racialTraits).filter(isRecord)) add(t.definition, isHomebrewEntry(t, race));
  for (const f of arr<unknown>(char.feats).filter(isRecord)) add(f.definition, isHomebrewEntry(f));
  for (const i of arr<unknown>(char.inventory).filter(isRecord)) add(i.definition, isHomebrewEntry(i));
  const { bgDef, untrusted } = resolveBackground(char);
  add(bgDef, untrusted);
  // A custom background shows its own definition; an action can still name the stock one.
  if (obj(obj(char.background).definition) !== bgDef) add(obj(char.background).definition, untrusted);
}

/**
 * The trimmed name of every definition grantingEntities knows, under the same
 * entityKey (options included). Where several share a key the first named wins.
 */
export function grantingEntityNames(char: CharData, classes: readonly ClassEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  const add = (def: unknown) => {
    const d = obj(def);
    const name = str(d.name).trim();
    if (!num(d.id) || !num(d.entityTypeId) || !name) return;
    const key = entityKey(d.id, d.entityTypeId);
    if (!names.has(key)) names.set(key, name);
  };
  walkBaseEntities(char, classes, add);
  for (const o of Object.values(obj(char.options)).flatMap(v => arr<unknown>(v)).filter(isRecord)) add(o.definition);
  return names;
}

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
  const options = Object.values(obj(char.options)).flatMap(v => arr<unknown>(v)).filter(isRecord);
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

// ── Action source extraction ─────────────────────────────────────────────────
interface CharAction { action: Record<string, unknown>; homebrew: boolean }

/** entityTypeId of a class feature (and of the componentTypeId of an action it grants). */
export const CLASS_FEATURE_TYPE = 12168134;
const OPTION_TYPE = 258900837;

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
  const options = Object.values(obj(char.options)).flatMap(v => arr<unknown>(v)).filter(isRecord);
  for (const o of options) {
    if (num(o.componentTypeId) !== CLASS_FEATURE_TYPE || visibleIds.has(num(o.componentId))) continue;
    const id = num(obj(o.definition).id);
    if (id) hidden.add(id);
  }
  return hidden;
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

function getAllActions(char: CharData, classes: readonly ClassEntry[]): CharAction[] {
  // activation.activationType: 1=action, 3=bonus action, 4=reaction, 8=special (listed under OTHER)
  const entities = grantingEntities(char, classes);
  const visibleIds = visibleClassFeatureIds(char, classes);
  const hiddenOptions = hiddenOptionIds(char, visibleIds);
  return Object.entries(obj(char.actions))
    .flatMap(([bucket, v]) => records(v).map(action => ({ bucket, action })))
    .filter(({ bucket, action }) => isVisibleAction(bucket, action, visibleIds, hiddenOptions))
    .map(({ bucket, action }) => {
      const granted = entities.get(entityKey(action.componentId, action.componentTypeId));
      // A nameless action carries no text: it stays plain, as every nameless entry does.
      const homebrew = str(action.name) !== "" && (action.isHomebrew === true
        || (granted ? granted.some(Boolean) : bucketAnyHomebrew(char, classes, bucket)));
      return { action, homebrew };
    });
}

const activationType = (a: Record<string, unknown>): number =>
  num(obj(a.activation).activationType);

// ── Bonus-action and reaction spells ─────────────────────────────────────────
// activationType 3=bonus action, 4=reaction; the spells are gathered by
// actionSpells (spells.ts), which applies the spellbook gate and dedupes.
const spellActivationType = (s: Record<string, unknown>): number =>
  num(obj(obj(s.definition).activation).activationType);

function formatSpellAction(s: Record<string, unknown>): string {
  const def = obj(s.definition);
  const lvl = num(def.level);
  const slotStr = lvl === 0 ? "cantrip" : `${lvl === 1 ? "1st" : lvl === 2 ? "2nd" : lvl === 3 ? "3rd" : `${lvl}th`}-level slot`;
  // A homebrew spell's name is other players' text: the whole line is wrapped.
  return wrapIfHomebrew(`• ${str(def.name)} (spell, ${slotStr})`, shownHomebrew(s, str(def.name)));
}

/**
 * The dice D&D Beyond shows for an action: only when it displays as an attack,
 * adds no ability modifier of its own and is not Martial Arts (whose figures
 * the data gets wrong or leaves incomplete). `value` is never printed.
 */
export function actionDice(a: Record<string, unknown>): string {
  if (a.displayAsAttack !== true || a.abilityModifierStatId != null || a.isMartialArts === true) return "";
  return str(obj(a.dice).diceString).trim();
}

/** A weapon-mastery action, named `<mastery> (<weapon>)` (Weapon Mastery feat). */
export function isMasteryAction(a: Record<string, unknown>): boolean {
  const m = /^(\S+) \(.+\)$/.exec(str(a.name));
  return m != null && MASTERY_NAMES.has(m[1]);
}

/** `• <name>` for an action, wrapped whole when its granting entity is homebrew. */
const actionLine = ({ action, homebrew }: CharAction): string => {
  const dice = actionDice(action);
  return wrapIfHomebrew(`• ${str(action.name)}${dice ? `   ${dice}` : ""}`, homebrew);
};

// ── Limited-use features ─────────────────────────────────────────────────────
// maxUses=0 with statModifierUsesId means uses = that stat modifier (e.g. CHA for Bardic Inspiration)
const hasUses = (lu: Record<string, unknown>): boolean =>
  lu.maxUses !== undefined && (num(lu.maxUses) > 0 || lu.statModifierUsesId != null);

function buildLimitedUseLines(
  allActions: readonly CharAction[],
  statMods: readonly number[],
): string[] {
  return allActions
    .filter(({ action: a }) => hasUses(obj(a.limitedUse)))
    .map(({ action: a, homebrew }) => {
      const lu = obj(a.limitedUse);
      const resetLabels: Record<number, string> = { 1: "Short Rest", 2: "Long Rest" };
      const reset = resetLabels[num(lu.resetType)] ?? "Rest";
      let maxStr = num(lu.maxUses) > 0
        ? String(num(lu.maxUses))
        : lu.statModifierUsesId != null
          ? `${signed(statMods[num(lu.statModifierUsesId) - 1])} (stat)`
          : "?";
      const used = num(lu.numberUsed);
      return wrapIfHomebrew(`• ${str(a.name)}   ${used} used / ${maxStr} max   (${reset})`, homebrew);
    });
}

/**
 * D&D Beyond keeps an item's charges on the inventory entry (`limitedUse`),
 * not in char.actions. Every carried item with maxUses > 0 gets a line, in
 * inventory order, equipped or attuned or not; the entry's limitedUse wins,
 * the definition's is the fallback. An item that also has a limitedUse action
 * entry (componentId / componentTypeId = its definition id / entityTypeId) is
 * left to that action's line. Two entries of one definition are two lines.
 */
function buildItemChargeLines(
  inventory: readonly InventoryItem[],
  allActions: readonly CharAction[],
  editions: CharacterEditions,
): string[] {
  const actionKeys = new Set(
    allActions.filter(({ action: a }) => hasUses(obj(a.limitedUse))).map(({ action: a }) => entityKey(a.componentId, a.componentTypeId)),
  );
  const resetLabels: Record<number, string> = { 1: "Short Rest", 2: "Long Rest" };
  return inventory.flatMap(i => {
    const def = obj(i.definition);
    const own = obj(i.limitedUse);
    const lu = num(own.maxUses) > 0 ? own : obj(def.limitedUse);
    if (!(num(lu.maxUses) > 0)) return [];
    // A consumable is already listed, with its count, under INVENTORY.
    if (lu.resetType === "Consumable") return [];
    const name = editions.named(str(def.name).trim(), def);
    if (name === "") return [];
    // A degenerate key (no definition id or entity type) never matches an action.
    if (num(def.id) && num(def.entityTypeId) && actionKeys.has(entityKey(def.id, def.entityTypeId))) return [];
    const description = str(lu.resetTypeDescription).replace(/\s+/g, " ").trim();
    const type = typeof lu.resetType === "string" ? lu.resetType.trim() : "";
    const reset = type !== "" && type !== "Other"
      ? type
      : typeof lu.resetType === "number" && resetLabels[lu.resetType]
        ? resetLabels[lu.resetType]
        : description || type || "Rest";
    return [wrapIfHomebrew(`• ${name}   ${num(lu.numberUsed)} used / ${num(lu.maxUses)} max   (${reset})`, shownHomebrew(i, name))];
  });
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeActions(core: CoreStats): Actions {
  const { char, classes, statMods, inventory, editions } = core;
  const allActions = getAllActions(char, classes);
  const allCharSpells = actionSpells(char, classes).map(({ spell }) => spell);

  // Spell activationTypes (from rule-data): 1=Action, 2=No Action, 3=Bonus Action, 4=Reaction, 8=Special
  const bonusActionSpells = allCharSpells.filter(s => spellActivationType(s) === 3).map(formatSpellAction);
  const reactionSpells = allCharSpells.filter(s => spellActivationType(s) === 4).map(formatSpellAction);

  // activationType 3 = bonus action in class actions, 4 = reaction
  // activationType 1 = action (weapon-mastery actions are skipped: the weapon rows show mastery)
  // activationType 8 = special, listed under OTHER
  const actionFeatures = allActions
    .filter(a => activationType(a.action) === 1 && !isMasteryAction(a.action))
    .map(actionLine);
  const otherFeatures = allActions.filter(a => activationType(a.action) === 8).map(actionLine);
  const bonusActions = [
    ...allActions.filter(a => activationType(a.action) === 3).map(actionLine),
    ...bonusActionSpells,
  ];
  // Reactions: Opportunity Attack is universal, then class reactions, then reaction spells
  const reactions: string[] = [
    "• Opportunity Attack",
    ...allActions.filter(a => activationType(a.action) === 4).map(actionLine),
    ...reactionSpells,
  ];
  const limitedUseFeatures = [
    ...buildLimitedUseLines(allActions, statMods),
    ...buildItemChargeLines(inventory, allActions, editions),
  ];

  const { attacks: weaponAttacks, offHand: offHandAttacks } = computeWeaponAttacks(core);
  return {
    weaponAttacks,
    unarmedStrike: [computeUnarmedStrike(core)],
    spellAttacks: computeSpellAttackRows(core),
    actionFeatures,
    offHandAttacks,
    bonusActions,
    reactions,
    otherFeatures,
    limitedUseFeatures,
  };
}

export function formatCombatBlock(a: Actions): string[] {
  const actions = [...a.weaponAttacks, ...a.unarmedStrike, ...a.spellAttacks, ...a.actionFeatures];
  const bonus = [...a.offHandAttacks, ...a.bonusActions];
  return [
    `ACTIONS`,
    ...(actions.length ? actions : ["  (none)"]),
    ``,
    `BONUS ACTIONS`,
    ...(bonus.length ? bonus : ["  (none)"]),
    ``,
    `REACTIONS`,
    ...(a.reactions.length ? a.reactions : ["  (none)"]),
    ``,
    ...(a.otherFeatures.length ? [`OTHER`, ...a.otherFeatures, ``] : []),
    ...(a.limitedUseFeatures.length ? [`LIMITED USE`, ...a.limitedUseFeatures, ``] : []),
  ];
}
