/**
 * Armor Class calculation.
 *
 * Phase 4 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Pulled out as its own module because AC has the highest single-function
 * complexity in the parser: body armor (light/medium/heavy with their own
 * DEX rules), shields, Unarmored Defense (Barbarian / Monk), Draconic
 * Resilience (`type: "set"` base bump), AC bonus modifiers (Shield of Faith,
 * Ring of Protection), and the Defense fighting style edge case.
 *
 * KNOWN GAP (see follow-up B in the refactor doc): the `armored-armor-class`
 * branch of the bonus accumulator is applied unconditionally, but Defense
 * fighting style only applies when wearing armor. Preserved verbatim during
 * the Phase 4 extraction; fix in a separate PR with focused unit tests now
 * that AC is isolated.
 */

import { num, obj, str } from "./helpers.js";
import type { CoreStats, InventoryItem } from "./types.js";

export function computeAc(core: CoreStats): number {
  const { inventory, allMods, statMods } = core;
  const dexMod = statMods[1];

  // armorTypeId: 1=light, 2=medium, 3=heavy, 4=shield
  const equippedArmorPieces = inventory.filter(i =>
    i.equipped === true && str(obj(i.definition).filterType) === "Armor"
  );
  const shield = equippedArmorPieces.find(i => num(obj(i.definition).armorTypeId) === 4);
  // If multiple body armors are equipped (e.g. party loot), pick whichever yields the best effective AC.
  const bodyArmorCandidates = equippedArmorPieces.filter(i => num(obj(i.definition).armorTypeId) !== 4);

  const effectiveBodyAc = (i: InventoryItem) => {
    const def = obj(i.definition);
    const baseAc = num(def.armorClass);
    const typeId = num(def.armorTypeId);
    if (typeId === 1) return baseAc + dexMod;
    if (typeId === 2) return baseAc + Math.min(dexMod, 2);
    return baseAc;
  };

  const bodyArmor = bodyArmorCandidates.reduce<InventoryItem | null>(
    (best, i) => best === null || effectiveBodyAc(i) > effectiveBodyAc(best) ? i : best, null
  );

  let ac: number;
  if (bodyArmor) {
    ac = effectiveBodyAc(bodyArmor);
  } else {
    // Unarmored Defense (Barbarian = 10+DEX+CON, Monk = 10+DEX+WIS)
    // Draconic Resilience uses type:"set" with a numeric value to lift the base (e.g. value:3 → base 13).
    const unarmoredMod = allMods.find(m => m.subType === "unarmored-armor-class");
    if (unarmoredMod) {
      const extraStatId = num(unarmoredMod.statId); // 3=CON (Barbarian), 5=WIS (Monk)
      const extraMod = extraStatId > 0 ? statMods[extraStatId - 1] : 0;
      const baseBonus = unarmoredMod.type === "set" ? num(unarmoredMod.fixedValue ?? unarmoredMod.value) : 0;
      ac = 10 + baseBonus + dexMod + extraMod;
    } else {
      ac = 10 + dexMod;
    }
  }

  if (shield) ac += num(obj(shield.definition).armorClass);

  // Add any AC bonus modifiers (e.g. shield of faith, ring of protection, Defense fighting style).
  // Defense fighting style uses "armored-armor-class" instead of "armor-class"; it should only apply
  // when wearing armor, but we include it unconditionally — most characters with it are armored.
  // TODO: gate "armored-armor-class" on equipped armor to avoid inflating AC for unarmored characters.
  const acBonus = allMods
    .filter(m => (m.subType === "armor-class" || m.subType === "armored-armor-class") && m.type === "bonus")
    .reduce((s, m) => s + num(m.fixedValue ?? m.value), 0);
  return ac + acBonus;
}
