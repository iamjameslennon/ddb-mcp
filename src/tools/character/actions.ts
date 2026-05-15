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
 */

import { arr, num, obj, signed, str } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats } from "./types.js";
import { computeWeaponAttacks } from "./weapons.js";

export interface Actions {
  weaponAttacks: string[];        // ["• Longsword       +5 to hit   1d8+3 slashing   reach 5 ft.   Versatile", …]
  bonusActions: string[];         // ["• Bardic Inspiration", "• Healing Word (spell, 1st-level slot)", …]
  reactions: string[];            // ["• Opportunity Attack", "• Uncanny Dodge", …]
  limitedUseFeatures: string[];   // ["• Action Surge   0 used / 1 max   (Short Rest)", …]
}

// ── Action source extraction ─────────────────────────────────────────────────
function getAllActions(char: CharData): Record<string, unknown>[] {
  // activation.activationType: 1=action, 3=bonus action, 4=reaction, 8=special (skip)
  // Filter Circle Spell entries — these leak from the Dark Bargain campaign feature
  // and don't represent real character abilities on the website.
  return Object.values(obj(char.actions))
    .flatMap(v => arr<Record<string, unknown>>(v))
    .filter(a => a != null && !str(a.name).startsWith("Circle Spell") && str(a.name) !== "Initiate a Circle Spell");
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
  return `• ${str(def.name)} (spell, ${slotStr})`;
}

// ── Limited-use features ─────────────────────────────────────────────────────
function buildLimitedUseLines(
  allActions: readonly Record<string, unknown>[],
  statMods: readonly number[],
): string[] {
  return allActions
    .filter(a => {
      const lu = obj(a.limitedUse);
      // maxUses=0 with statModifierUsesId means uses = that stat modifier (e.g. CHA for Bardic Inspiration)
      return lu.maxUses !== undefined && (num(lu.maxUses) > 0 || lu.statModifierUsesId != null);
    })
    .map(a => {
      const lu = obj(a.limitedUse);
      const resetLabels: Record<number, string> = { 1: "Short Rest", 2: "Long Rest" };
      const reset = resetLabels[num(lu.resetType)] ?? "Rest";
      let maxStr = num(lu.maxUses) > 0
        ? String(num(lu.maxUses))
        : lu.statModifierUsesId != null
          ? `${signed(statMods[num(lu.statModifierUsesId) - 1])} (stat)`
          : "?";
      const used = num(lu.numberUsed);
      return `• ${str(a.name)}   ${used} used / ${maxStr} max   (${reset})`;
    });
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeActions(core: CoreStats): Actions {
  const { char, classes, statMods } = core;
  const allActions = getAllActions(char);
  const allCharSpells = getCharSpellsForActions(char, classes);

  // Spell activationTypes (from rule-data): 1=Action, 2=No Action, 3=Bonus Action, 4=Reaction, 8=Special
  const bonusActionSpells = allCharSpells.filter(s => spellActivationType(s) === 3).map(formatSpellAction);
  const reactionSpells = allCharSpells.filter(s => spellActivationType(s) === 4).map(formatSpellAction);

  // activationType 3 = bonus action in class actions, 4 = reaction
  // activationType 1 = action (weapon masteries — skip, shown in ACTIONS already)
  // activationType 8 = special/passive — skip
  const bonusActions = [
    ...allActions.filter(a => activationType(a) === 3).map(a => `• ${str(a.name)}`),
    ...bonusActionSpells,
  ];
  // Reactions: Opportunity Attack is universal, then class reactions, then reaction spells
  const reactions: string[] = [
    "• Opportunity Attack",
    ...allActions.filter(a => activationType(a) === 4).map(a => `• ${str(a.name)}`),
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
