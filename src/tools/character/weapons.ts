/**
 * Weapons domain — weapon attack rolls for equipped inventory weapons.
 *
 * Phase 6a of the character.ts refactor — see docs/character-refactor.md.
 *
 * Owns ability-mod selection (finesse, ranged, Martial Arts monk weapons),
 * proficiency bonus, magic enhancement (+1/+2/+3 from grantedModifiers), and
 * duplicate consolidation (×2 daggers, etc.). Output is pre-formatted lines
 * to preserve byte-for-byte parity with the original inline code.
 */

import { arr, isBonusMod, isProficiencyMod, num, obj, signed, str } from "./helpers.js";
import type { CoreStats } from "./types.js";

export function computeWeaponAttacks(core: CoreStats): string[] {
  const { allMods, classes, inventory, statMods, profBonus } = core;
  const dexMod = statMods[1];

  const weaponProfSlugs = new Set(
    allMods.filter(isProficiencyMod).map(m => m.subType)
  );
  const isWeaponProficient = (def: Record<string, unknown>): boolean => {
    const catId = num(def.categoryId); // 1=simple, 2=martial
    const typeName = str(def.type).toLowerCase().replace(/[,\s]+/g, "-");
    return (catId === 1 && weaponProfSlugs.has("simple-weapons")) ||
           (catId === 2 && weaponProfSlugs.has("martial-weapons")) ||
           weaponProfSlugs.has(typeName);
  };

  // Martial Arts: allows DEX for monk weapons (simple melee + shortsword, no Two-Handed/Heavy)
  const hasMartialArts =
    allMods.some(m => str(m.subType) === "martial-arts") ||
    classes.some(c =>
      arr<Record<string, unknown>>(c.classFeatures).some(cf =>
        str(obj(cf.definition).name) === "Martial Arts" &&
        num(obj(cf.definition).requiredLevel || 1) <= num(c.level)
      )
    );

  const weaponInventoryMap = new Map<string, { lines: string[]; qty: number }>();
  for (const i of inventory) {
    const def = obj(i.definition);
    if (str(def.filterType) !== "Weapon") continue;
    if (i.equipped !== true) continue; // only show equipped weapons in ACTIONS

    const wName = str(def.name);
    const dmg = obj(def.damage);
    const dmgDice = str(dmg.diceString);
    const dmgType = str(def.damageType).toLowerCase();
    const attackType = num(def.attackType); // 1=melee, 2=ranged
    const props = arr<Record<string, unknown>>(def.properties).map(p => str(p.name));
    const isFinesse = props.includes("Finesse");
    const isRanged = attackType === 2;
    const range = num(def.range);
    const longRange = num(def.longRange);
    const mastery = str(def.mastery);

    // Magic enhancement bonus from grantedModifiers (e.g. +1 weapon)
    const magicBonus = arr<Record<string, unknown>>(def.grantedModifiers)
      .filter(gm => isBonusMod(gm) && gm.subType === "magic")
      .reduce((s, gm) => s + num(gm.value ?? gm.fixedValue), 0);

    // Monk weapons: simple melee or shortsword, no Two-Handed/Heavy
    const isMonkWeapon = hasMartialArts &&
      !props.includes("Two-Handed") && !props.includes("Heavy") &&
      ((num(def.categoryId) === 1 && attackType === 1) || str(def.name) === "Shortsword");

    // Ability modifier for attack/damage
    const usesDex = isRanged || ((isFinesse || isMonkWeapon) && dexMod > statMods[0]);
    const abilityMod = usesDex ? dexMod : statMods[0];
    const profMod = isWeaponProficient(def) ? profBonus : 0;
    const hitBonus = abilityMod + profMod + magicBonus;
    const dmgBonus = abilityMod + magicBonus;
    const dmgStr = dmgBonus !== 0 ? `${dmgDice}${signed(dmgBonus)}` : dmgDice;
    const rangeStr = isRanged ? `range ${range}/${longRange} ft.` : `reach 5 ft.`;
    const propsStr = [...props, ...(mastery ? [mastery] : [])].join(", ");

    const line = `• ${wName.padEnd(16)} ${signed(hitBonus)} to hit   ${dmgStr} ${dmgType}   ${rangeStr}${propsStr ? `   ${propsStr}` : ""}`;

    // Consolidate duplicates by key
    const key = wName + dmgDice;
    const existing = weaponInventoryMap.get(key);
    if (existing) {
      existing.qty += num(i.quantity) || 1;
    } else {
      weaponInventoryMap.set(key, { lines: [line], qty: num(i.quantity) || 1 });
    }
  }

  const weaponAttacks: string[] = [];
  for (const { lines, qty } of weaponInventoryMap.values()) {
    weaponAttacks.push(qty > 1 ? lines[0].replace("•", `• ×${qty}`) : lines[0]);
  }
  return weaponAttacks;
}
