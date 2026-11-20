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
 * Inspiration). Feature rows without dice take them from their own snippet,
 * and print a single save DC from it (owner rulings R2 and R3). Output is
 * pre-formatted lines.
 *
 * A homebrew spell's line, and the line of an action granted by a homebrew
 * entity (resolved by componentId / componentTypeId, see grantingEntities),
 * is other players' text and is wrapped whole.
 */

import { wrapIfHomebrew } from "../../utils.js";
import { arr, customItemNames, featureDefinition, itemNameParts, isRecord, num, obj, records, shownHomebrew, str, stripHtml } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, InventoryItem } from "./types.js";
import {
  allOptions, baseEntities, bucketAnyHomebrew, CLASS_FEATURE_TYPE, entityKey, type EntityKind,
  grantingEntities, hiddenOptionIds, isVisibleAction, visibleClassFeatureIds,
} from "./granting.js";
import type { CharacterEditions } from "./editions.js";
import { actionSpells, type ActionSpell } from "./spells.js";
import { spellCastLabel } from "./slots.js";
import { computeSpellRows } from "./spell-attacks.js";
import { computeUnarmedStrike, computeWeaponAttacks } from "./weapons.js";
import { MASTERY_NAMES } from "../weapon-mastery.js";
import { nameFold } from "../../name-match.js";

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

// ── Action source extraction ─────────────────────────────────────────────────
// The granting-entity and visibility rules live in granting.ts (carry-over (bm)).
interface CharAction { action: Record<string, unknown>; homebrew: boolean }

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

/**
 * Whether the combat block prints a visible action as a row: an action (1)
 * that is not a weapon-mastery action (the weapon rows show mastery), a bonus
 * action (3), a reaction (4) or a Special action (8, under OTHER). The one
 * rule for computeActions and actionParents (owner decision A6, 2026-11-17).
 */
function isShownAction(a: Record<string, unknown>): boolean {
  const type = activationType(a);
  return type === 1 ? !isMasteryAction(a) : type === 3 || type === 4 || type === 8;
}

/**
 * The entry that grants each action the sheet shows with a name, for
 * ddb_character_lookup (F1): among getAllActions' visible ones, a combat-block
 * row (isShownAction, owner decision A6) or a LIMITED USE line (hasUses,
 * whatever its activation type; fix round, owner decision 2026-11-17).
 * The action's componentId / componentTypeId key names its granting
 * definition. While that key is an option's (any bucket, matched by the
 * option definition's entityKey), it moves to that option's own owner, at most
 * options + 1 steps, so a cycle ends unresolved. The final key's name comes
 * from the base entities (walkBaseEntities). An unresolved action, or one whose
 * parent's name folds to its own (Sneak Attack), is left out. `kind` is the
 * parent's kind, so the lookup marks only that kind's entry of the name.
 * `homebrew` is the action line's own flag.
 */
export function actionParents(
  char: CharData,
  classes: readonly ClassEntry[],
): Array<{ action: string; parent: string; kind: EntityKind; homebrew: boolean }> {
  const options = allOptions(char);
  const ownerOf = new Map<string, string>();
  for (const o of options) {
    const d = obj(o.definition);
    if (!num(d.id) || !num(d.entityTypeId)) continue;
    const key = entityKey(d.id, d.entityTypeId);
    if (!ownerOf.has(key)) ownerOf.set(key, entityKey(o.componentId, o.componentTypeId));
  }
  const entities = baseEntities(char, classes);
  return getAllActions(char, classes).flatMap(({ action, homebrew }) => {
    const name = str(action.name).trim();
    if (name === "" || !(isShownAction(action) || hasUses(obj(action.limitedUse)))) return [];
    let key = entityKey(action.componentId, action.componentTypeId);
    for (let step = 0; step <= options.length && ownerOf.has(key); step++) key = ownerOf.get(key) ?? key;
    if (ownerOf.has(key)) return [];
    const parent = entities.get(key);
    if (parent === undefined || nameFold(parent.name) === nameFold(name)) return [];
    return [{ action: name, parent: parent.name, kind: parent.kind, homebrew }];
  });
}

// ── Bonus-action and reaction spells ─────────────────────────────────────────
// activationType 3=bonus action, 4=reaction; the spells are gathered by
// actionSpells (spells.ts), which applies the spellbook gate and dedupes.
const spellActivationType = (s: Record<string, unknown>): number =>
  num(obj(obj(s.definition).activation).activationType);

function formatSpellAction(entry: ActionSpell, classes: readonly ClassEntry[], figures: (e: ActionSpell) => string): string {
  const { spell: s, list, bucket } = entry;
  const def = obj(s.definition);
  const slotStr = spellCastLabel(s, { isWarlockList: list?.className === "Warlock", bucket }, classes);
  // A homebrew spell's name is other players' text: the whole line is wrapped.
  return wrapIfHomebrew(`• ${str(def.name)} (spell, ${slotStr})${figures(entry)}`, shownHomebrew(s, str(def.name)));
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

// ── Snippet dice and save DC (owner rulings R2 and R3, 2026-11-13) ──────────
/** What a feature row needs to resolve the templates in its action's snippet. */
export interface FeatureLineContext {
  resolveTemplates: CoreStats["resolveTemplates"];
  totalLevel: number;
  /** Keyed by class-feature definition id, from `classes[].classFeatures` (the wrapped entries carry `levelScale`). */
  features: Map<number, { levelScale: Record<string, unknown>; classLevel: number }>;
}

export function featureLineContext(core: CoreStats): FeatureLineContext {
  const features: FeatureLineContext["features"] = new Map();
  for (const cls of core.classes) {
    for (const cf of arr<unknown>(cls.classFeatures).filter(isRecord)) {
      const id = num(featureDefinition(cf).id);
      if (id && !features.has(id)) features.set(id, { levelScale: obj(cf.levelScale), classLevel: num(cls.level) });
    }
  }
  return { resolveTemplates: core.resolveTemplates, totalLevel: core.totalLevel, features };
}

/** The class feature that grants an action, when it is one (componentTypeId = CLASS_FEATURE_TYPE). */
const grantingFeature = (action: Record<string, unknown>, ctx: FeatureLineContext) =>
  num(action.componentTypeId) === CLASS_FEATURE_TYPE ? ctx.features.get(num(action.componentId)) : undefined;

/** The level a snippet's `{{classlevel}}` means: the granting feature's class level, else the character level. */
const snippetClassLevel = (action: Record<string, unknown>, ctx: FeatureLineContext): number =>
  grantingFeature(action, ctx)?.classLevel ?? ctx.totalLevel;

/** A die (or `{{scalevalue}}`) and the templates added to it, e.g. `1d10 + {{classlevel}}`. */
const SNIPPET_DICE = /(\d+d\d+|\{\{\s*scalevalue\s*\}\})((?:\s*[+-]?\s*\{\{[^}]+\}\})*)/;
/** A template that adds an ability modifier (owner ruling R2; carry-over (be)(2)); tested on the body with whitespace removed. */
const ABILITY_TEMPLATE = /modifier:|savedc:|spellattack:|abilityscore:/i;
/** One added template in the dice's tail, with the sign written before it, if any. */
const TAIL_TEMPLATE = /([+-]?)\s*\{\{([^}]+)\}\}/g;
/** Appended to snippet dice when a template had no sign, before it or of its own, and was taken as added (owner decision 2026-11-17, fix round 1). */
export const ASSUMED_ADD_NOTE = "(assumed the values add)";

/**
 * The dice in a feature action's own snippet, for a row D&D Beyond gives no
 * dice (owner ruling R2, 2026-11-13): the first `<die>` or `{{scalevalue}}`
 * with the templates added to it, used only when it holds a template and none
 * adds an ability modifier (whitespace in a template ignored). Each template
 * is resolved and added on its own; one with no sign before it and none of its
 * own is assumed to add, and ASSUMED_ADD_NOTE follows the dice.
 * `{{scalevalue}}` is the granting class feature's
 * `levelScale` die; one that is a number (`{{scalevalue}} times`) gives none.
 * Martial Arts actions and those adding an ability modifier print none
 * (carry-over (be)). `""` when there are no such dice.
 */
export function snippetDice(action: Record<string, unknown>, ctx: FeatureLineContext): string {
  if (str(obj(action.dice).diceString).trim() !== "" || action.isMartialArts === true || action.abilityModifierStatId != null) return "";
  const m = SNIPPET_DICE.exec(stripHtml(str(action.snippet)));
  if (!m) return "";
  const [, head, tail] = m;
  const scaled = head.startsWith("{{");
  if (!scaled && tail.trim() === "") return "";
  const templates = [...tail.matchAll(TAIL_TEMPLATE)].map(t => ({ sign: t[1], body: t[2] }));
  if (templates.some(t => ABILITY_TEMPLATE.test(t.body.replace(/\s+/g, "")))) return "";
  const die = scaled ? str(obj(grantingFeature(action, ctx)?.levelScale.dice).diceString).trim() : head;
  if (die === "") return "";
  // Each template is resolved on its own, so adjacent values never run together.
  // A sign before a template combines with the template's own (`- {{x#signed}}`
  // at +3 is -3). A template with neither is taken as added, and the row says so.
  const classLevel = snippetClassLevel(action, ctx);
  let sum = 0;
  let assumed = false;
  for (const { sign, body } of templates) {
    const value = ctx.resolveTemplates(`{{${body}}}`, classLevel).trim();
    if (!/^[+-]?\d+$/.test(value)) return "";
    if (sign === "" && !body.endsWith("#signed")) assumed = true;
    sum += sign === "-" ? -Number(value) : Number(value);
  }
  const dice = sum === 0 ? die : `${die} ${sum > 0 ? "+" : "-"} ${Math.abs(sum)}`;
  return assumed ? `${dice} ${ASSUMED_ADD_NOTE}` : dice;
}

/**
 * The save DC in a feature action's own snippet (owner ruling R3, 2026-11-13):
 * only when its templates name exactly one ability's `savedc` (A8, 2026-11-17:
 * `{{savedc:wis}}` and `{{savedc:wis#signed}}` are one). The first such
 * template's value; null when there is none, several, or it doesn't resolve to
 * an integer.
 */
export function snippetSaveDc(action: Record<string, unknown>, ctx: FeatureLineContext): number | null {
  const bodies = [...str(action.snippet).matchAll(/\{\{([^}]+)\}\}/g)].map(t => t[1].replace(/\s+/g, ""));
  const withDc = bodies.filter(b => /savedc:/i.test(b));
  // Counted case-insensitively: `{{SAVEDC:con}}` and `{{savedc:wis}}` are two abilities.
  const abilities = new Set(withDc.flatMap(b => [...b.toLowerCase().matchAll(/savedc:([a-z]*)/g)].map(a => a[1])));
  if (abilities.size !== 1) return null;
  const value = ctx.resolveTemplates(`{{${withDc[0]}}}`, snippetClassLevel(action, ctx)).trim();
  return /^[+-]?\d+$/.test(value) ? Number(value) : null;
}

/**
 * ` + <die> per slot level` when the action's own snippet says "plus another
 * <die> per level of the spell slot" (owner ruling R2, 2026-11-18; Eldritch
 * Smite). Only the matched die is emitted, never other snippet text. Divine
 * Smite's 2014 wording ("for each spell level higher than 1st") doesn't match
 * (carry-over (be)).
 */
export function slotScaling(action: Record<string, unknown>): string {
  const m = /plus another (\d+d\d+) per level of the spell slot/i.exec(stripHtml(str(action.snippet)));
  return m ? ` + ${m[1]} per slot level` : "";
}

/** True when the snippet ends with D&D Beyond's "Hit Points:" counter label (the Eldritch Cannon actions): the limited use counts hit points, not uses. */
export function isHitPointPool(action: Record<string, unknown>): boolean {
  return stripHtml(str(action.snippet)).trim().endsWith("Hit Points:");
}

/** D&D Beyond's limitedUseResetTypes (rule-data); the site prints type 4 ("Other") as "Special". An unknown type reads "Rest". */
export const RESET_LABELS: Readonly<Record<number, string>> = { 1: "Short Rest", 2: "Long Rest", 3: "Dawn", 4: "Special" };

/**
 * `• <name>[   <dice>][   DC <n>]` for a feature action, wrapped whole when its
 * granting entity is homebrew. The dice are D&D Beyond's (actionDice), else the
 * snippet's (snippetDice).
 */
const actionLine = (ctx: FeatureLineContext) => ({ action, homebrew }: CharAction): string => {
  const base = actionDice(action) || snippetDice(action, ctx);
  // The per-slot dice go before the assumed-add note, which closes the whole expression.
  const noted = base.endsWith(` ${ASSUMED_ADD_NOTE}`);
  const dice = !base ? "" : noted
    ? `${base.slice(0, -(ASSUMED_ADD_NOTE.length + 1))}${slotScaling(action)} ${ASSUMED_ADD_NOTE}`
    : `${base}${slotScaling(action)}`;
  const dc = snippetSaveDc(action, ctx);
  return wrapIfHomebrew(`• ${str(action.name)}${dice ? `   ${dice}` : ""}${dc != null ? `   DC ${dc}` : ""}`, homebrew);
};

// ── Limited-use features ─────────────────────────────────────────────────────
// maxUses=0 with statModifierUsesId means uses = that stat modifier (e.g. CHA for Bardic Inspiration)
const hasUses = (lu: Record<string, unknown>): boolean =>
  lu.maxUses !== undefined && (num(lu.maxUses) > 0 || lu.statModifierUsesId != null || lu.useProficiencyBonus === true);

/** A limited-use operator that adds: 1, or absent. No other operator is known. */
const isAdd = (op: unknown): boolean => op == null || op === 1;

function buildLimitedUseLines(
  allActions: readonly CharAction[],
  statMods: readonly number[],
  profBonus: number,
): string[] {
  return allActions
    .filter(({ action: a }) => hasUses(obj(a.limitedUse)))
    .map(({ action: a, homebrew }) => {
      const lu = obj(a.limitedUse);
      const reset = RESET_LABELS[num(lu.resetType)] ?? "Rest";
      // maxUses is the base; a stat modifier and the proficiency bonus are each added when
      // their operator is 1 (or absent), at least once overall. No other operator is known.
      const statId = lu.statModifierUsesId != null ? num(lu.statModifierUsesId) : null;
      const usesPb = lu.useProficiencyBonus === true;
      let total = num(lu.maxUses);
      let unknown = false;
      if (statId != null) {
        if (isAdd(lu.operator) && statId >= 1 && statId <= 6 && statMods[statId - 1] !== undefined) total += statMods[statId - 1];
        else unknown = true;
      }
      if (usesPb) {
        if (isAdd(lu.proficiencyBonusOperator)) total += profBonus;
        else unknown = true;
      }
      const maxStr = unknown ? "?"
        : statId != null || usesPb ? String(Math.max(1, total))
        : total > 0 ? String(total) : "?";
      const used = num(lu.numberUsed);
      if (isHitPointPool(a) && maxStr !== "?") {
        return wrapIfHomebrew(`• ${str(a.name)}   ${Math.max(0, Number(maxStr) - used)}/${maxStr} HP   (${reset})`, homebrew);
      }
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
  customNames: ReadonlyMap<number, string>,
): string[] {
  const actionKeys = new Set(
    allActions.filter(({ action: a }) => hasUses(obj(a.limitedUse))).map(({ action: a }) => entityKey(a.componentId, a.componentTypeId)),
  );
  return inventory.flatMap(i => {
    const def = obj(i.definition);
    const own = obj(i.limitedUse);
    const lu = num(own.maxUses) > 0 ? own : obj(def.limitedUse);
    if (!(num(lu.maxUses) > 0)) return [];
    // A consumable is already listed, with its count, under INVENTORY.
    if (lu.resetType === "Consumable") return [];
    const parts = itemNameParts(i, str(def.name).trim(), customNames);
    const custom = parts.custom;
    const name = editions.named(parts.name, def);
    if (name === "") return [];
    // A degenerate key (no definition id or entity type) never matches an action.
    if (num(def.id) && num(def.entityTypeId) && actionKeys.has(entityKey(def.id, def.entityTypeId))) return [];
    const description = str(lu.resetTypeDescription).replace(/\s+/g, " ").trim();
    const type = typeof lu.resetType === "string" ? lu.resetType.trim() : "";
    const reset = type !== "" && type !== "Other"
      ? type
      : typeof lu.resetType === "number" && RESET_LABELS[lu.resetType]
        ? RESET_LABELS[lu.resetType]
        : description || type || "Rest";
    return [wrapIfHomebrew(`• ${name}   ${num(lu.numberUsed)} used / ${num(lu.maxUses)} max   (${reset})`, shownHomebrew(i, name) || custom !== undefined)];
  });
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeActions(core: CoreStats): Actions {
  const { char, classes, statMods, inventory, editions } = core;
  const allActions = getAllActions(char, classes);
  const allCharSpells = actionSpells(char, classes);
  const { attackRows: spellAttacks, figures } = computeSpellRows(core);
  const line = actionLine(featureLineContext(core));

  // Spell activationTypes (from rule-data): 1=Action, 2=No Action, 3=Bonus Action, 4=Reaction, 8=Special
  const bonusActionSpells = allCharSpells.filter(s => spellActivationType(s.spell) === 3).map(s => formatSpellAction(s, classes, figures));
  const reactionSpells = allCharSpells.filter(s => spellActivationType(s.spell) === 4).map(s => formatSpellAction(s, classes, figures));

  // activationType 3 = bonus action in class actions, 4 = reaction
  // activationType 1 = action (weapon-mastery actions are skipped: the weapon rows show mastery)
  // activationType 8 = special, listed under OTHER
  const shown = allActions.filter(a => isShownAction(a.action));
  const actionFeatures = shown.filter(a => activationType(a.action) === 1).map(line);
  const otherFeatures = shown.filter(a => activationType(a.action) === 8).map(line);
  const bonusActions = [
    ...shown.filter(a => activationType(a.action) === 3).map(line),
    ...bonusActionSpells,
  ];
  // Reactions: Opportunity Attack is universal, then class reactions, then reaction spells
  const reactions: string[] = [
    "• Opportunity Attack",
    ...shown.filter(a => activationType(a.action) === 4).map(line),
    ...reactionSpells,
  ];
  const limitedUseFeatures = [
    ...buildLimitedUseLines(allActions, statMods, core.profBonus),
    ...buildItemChargeLines(inventory, allActions, editions, customItemNames(char)),
  ];

  const { attacks: weaponAttacks, offHand: offHandAttacks } = computeWeaponAttacks(core);
  return {
    weaponAttacks,
    unarmedStrike: [computeUnarmedStrike(core)],
    spellAttacks,
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
