/**
 * Actions domain — ACTIONS / BONUS ACTIONS / REACTIONS / LIMITED USE.
 * Owns the combat block.
 *
 * Phase 6b of the character.ts refactor — see docs/character-refactor.md.
 *
 * Filters Circle Spell entries (Dark Bargain campaign leak), surfaces
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
import { arr, featureDefinition, isHomebrewClassFeature, isHomebrewEntry, num, obj, signed, str } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, InventoryItem, Mod } from "./types.js";
import { resolveBackground } from "./features.js";
import { computeWeaponAttacks } from "./weapons.js";

export interface Actions {
  weaponAttacks: string[];        // ["• Longsword       +5 to hit   1d8+3 slashing   reach 5 ft.   Versatile", …]
  bonusActions: string[];         // ["• Bardic Inspiration", "• Healing Word (spell, 1st-level slot)", …]
  reactions: string[];            // ["• Opportunity Attack", "• Uncanny Dodge", …]
  limitedUseFeatures: string[];   // ["• Action Surge   0 used / 1 max   (Short Rest)", …]
}

// ── Granting entities ────────────────────────────────────────────────────────
// D&D Beyond links an action to the definition that grants it: the action's
// componentId / componentTypeId are that definition's id / entityTypeId (live
// 2026-11-04, 56 characters: class features 12168134, racial traits 1960452172,
// feats 1088085227, class and feat options 258900837, race options 306912077).
// Matching both fields matters: ids repeat across entity types.
const entityKey = (id: unknown, typeId: unknown): string => `${num(typeId)}:${num(id)}`;

/** Every definition an action can name, keyed by entityKey, with whether it is homebrew (as features.ts decides). */
function grantingEntities(char: CharData, classes: readonly ClassEntry[]): Map<string, boolean[]> {
  const entities = new Map<string, boolean[]>();
  const add = (def: unknown, homebrew: boolean) => {
    const d = obj(def);
    if (!num(d.id) || !num(d.entityTypeId)) return;
    const key = entityKey(d.id, d.entityTypeId);
    entities.set(key, [...(entities.get(key) ?? []), homebrew]);
  };
  for (const cls of classes) {
    for (const cf of arr<unknown>(cls.classFeatures)) add(featureDefinition(cf), isHomebrewClassFeature(cf, cls));
  }
  const race = obj(char.race);
  for (const t of arr<Record<string, unknown>>(race.racialTraits)) add(t.definition, isHomebrewEntry(t, race));
  for (const f of arr<Mod>(char.feats)) add(f.definition, isHomebrewEntry(f));
  for (const i of arr<InventoryItem>(char.inventory)) add(i.definition, isHomebrewEntry(i));
  const { bgDef, untrusted } = resolveBackground(char);
  add(bgDef, untrusted);
  if (obj(obj(char.background).definition) !== bgDef) add(obj(char.background).definition, untrusted);
  // An option (a choice made under a class feature, racial trait or feat) is
  // linked to that entity the same way; it is homebrew when it or its owner is.
  for (const options of Object.values(obj(char.options))) {
    for (const o of arr<Record<string, unknown>>(options)) {
      const owner = entities.get(entityKey(o.componentId, o.componentTypeId));
      if (owner) add(o.definition, isHomebrewEntry(o) || owner.some(Boolean));
      else if (isHomebrewEntry(o)) add(o.definition, true);
    }
  }
  return entities;
}

/**
 * Whether every entity that could have granted an action in `bucket` is
 * homebrew, for an action that names no entity on the sheet (e.g. a Tasha's
 * optional class feature that isn't in classFeatures). Only then is its
 * granting entity known to be homebrew; otherwise the line stays plain.
 */
function bucketAllHomebrew(char: CharData, classes: readonly ClassEntry[], bucket: string): boolean {
  const owners: boolean[] =
    bucket === "class" ? classes.map(c => isHomebrewEntry(c))
    : bucket === "race" ? (char.race != null && typeof char.race === "object" ? [isHomebrewEntry(char.race)] : [])
    : bucket === "feat" ? arr<Mod>(char.feats).map(f => isHomebrewEntry(f))
    : bucket === "item" ? arr<InventoryItem>(char.inventory).map(i => isHomebrewEntry(i))
    : bucket === "background" ? (char.background != null && typeof char.background === "object" ? [resolveBackground(char).untrusted] : [])
    : [];
  return owners.length > 0 && owners.every(Boolean);
}

// ── Action source extraction ─────────────────────────────────────────────────
interface CharAction { action: Record<string, unknown>; homebrew: boolean }

function getAllActions(char: CharData, classes: readonly ClassEntry[]): CharAction[] {
  // activation.activationType: 1=action, 3=bonus action, 4=reaction, 8=special (skip)
  // Filter Circle Spell entries — these leak from the Dark Bargain campaign feature
  // and don't represent real character abilities on the website.
  const entities = grantingEntities(char, classes);
  return Object.entries(obj(char.actions))
    .flatMap(([bucket, v]) => arr<Record<string, unknown>>(v).map(action => ({ bucket, action })))
    .filter(({ action: a }) => a != null && !str(a.name).startsWith("Circle Spell") && str(a.name) !== "Initiate a Circle Spell")
    .map(({ bucket, action }) => {
      const granted = entities.get(entityKey(action.componentId, action.componentTypeId));
      const homebrew = action.isHomebrew === true
        || (granted ? granted.some(Boolean) : bucketAllHomebrew(char, classes, bucket));
      return { action, homebrew };
    });
}

const activationType = (a: Record<string, unknown>): number =>
  num(obj(a.activation).activationType);

// ── Bonus-action and reaction spells ─────────────────────────────────────────
function getCharSpellsForActions(char: CharData, classes: readonly ClassEntry[]): Record<string, unknown>[] {
  // Bonus-action and reaction spells — activationType 3=bonus action, 4=reaction.
  // Apply the same prepared/ritual filter used in the main SPELLS section for spellbook
  // classes (Wizards) so unprepared non-ritual spells don't bleed into these sections.
  return [
    ...arr<Record<string, unknown>>(char.classSpells).flatMap(cs => {
      const classEntry = classes.find(c => c.id === cs.characterClassId);
      const isSpellbook = str(obj(classEntry?.definition ?? {}).name) === "Wizard";
      return arr<Record<string, unknown>>(cs.spells).filter(s =>
        !isSpellbook || s.prepared === true || obj(s.definition).ritual === true
      );
    }),
    ...Object.values(obj(char.spells)).flatMap(v => arr<Record<string, unknown>>(v)),
  ].filter(Boolean);
}

const spellActivationType = (s: Record<string, unknown>): number =>
  num(obj(obj(s.definition).activation).activationType);

function formatSpellAction(s: Record<string, unknown>): string {
  const def = obj(s.definition);
  const lvl = num(def.level);
  const slotStr = lvl === 0 ? "cantrip" : `${lvl === 1 ? "1st" : lvl === 2 ? "2nd" : lvl === 3 ? "3rd" : `${lvl}th`}-level slot`;
  // A homebrew spell's name is other players' text: the whole line is wrapped.
  return wrapIfHomebrew(`• ${str(def.name)} (spell, ${slotStr})`, isHomebrewEntry(s));
}

/** `• <name>` for an action, wrapped whole when its granting entity is homebrew. */
const actionLine = ({ action, homebrew }: CharAction): string => wrapIfHomebrew(`• ${str(action.name)}`, homebrew);

// ── Limited-use features ─────────────────────────────────────────────────────
function buildLimitedUseLines(
  allActions: readonly CharAction[],
  statMods: readonly number[],
): string[] {
  return allActions
    .filter(({ action: a }) => {
      const lu = obj(a.limitedUse);
      // maxUses=0 with statModifierUsesId means uses = that stat modifier (e.g. CHA for Bardic Inspiration)
      return lu.maxUses !== undefined && (num(lu.maxUses) > 0 || lu.statModifierUsesId != null);
    })
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

// ── Public API ───────────────────────────────────────────────────────────────
export function computeActions(core: CoreStats): Actions {
  const { char, classes, statMods } = core;
  const allActions = getAllActions(char, classes);
  const allCharSpells = getCharSpellsForActions(char, classes);

  // Spell activationTypes (from rule-data): 1=Action, 2=No Action, 3=Bonus Action, 4=Reaction, 8=Special
  const bonusActionSpells = allCharSpells.filter(s => spellActivationType(s) === 3).map(formatSpellAction);
  const reactionSpells = allCharSpells.filter(s => spellActivationType(s) === 4).map(formatSpellAction);

  // activationType 3 = bonus action in class actions, 4 = reaction
  // activationType 1 = action (weapon masteries — skip, shown in ACTIONS already)
  // activationType 8 = special/passive — skip
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
  const limitedUseFeatures = buildLimitedUseLines(allActions, statMods);

  return {
    weaponAttacks: computeWeaponAttacks(core),
    bonusActions,
    reactions,
    limitedUseFeatures,
  };
}

export function formatCombatBlock(a: Actions): string[] {
  return [
    `ACTIONS`,
    ...(a.weaponAttacks.length ? a.weaponAttacks : ["  (none)"]),
    ``,
    `BONUS ACTIONS`,
    ...(a.bonusActions.length ? a.bonusActions : ["  (none)"]),
    ``,
    `REACTIONS`,
    ...(a.reactions.length ? a.reactions : ["  (none)"]),
    ``,
    ...(a.limitedUseFeatures.length ? [`LIMITED USE`, ...a.limitedUseFeatures, ``] : []),
  ];
}
