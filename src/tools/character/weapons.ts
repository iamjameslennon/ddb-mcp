/**
 * Weapons domain — weapon attack rolls for equipped inventory weapons.
 *
 * Phase 6a of the character.ts refactor — see docs/character-refactor.md.
 *
 * Owns ability-mod selection (finesse, ranged, Martial Arts monk weapons),
 * proficiency bonus, the item's grantedModifiers (+1/+2/+3 magic, extra
 * damage dice, a replaced damage type, granted Finesse), reach and thrown
 * range, versatile dice, the Weapon Mastery gate, and duplicate
 * consolidation (×2 daggers, etc.). Output is pre-formatted lines.
 */

import { wrapIfHomebrew } from "../../utils.js";
import { MASTERY_NAMES } from "../weapon-mastery.js";
import { arr, records, isBonusMod, isHomebrewEntry, isProficiencyMod, num, obj, signed, str, weaponWordOrder } from "./helpers.js";
import type { CoreStats } from "./types.js";

export function computeWeaponAttacks(core: CoreStats): string[] {
  const { allMods, classes, inventory, statMods, profBonus, editions } = core;
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
      records(c.classFeatures).some(cf =>
        str(obj(cf.definition).name) === "Martial Arts" &&
        num(obj(cf.definition).requiredLevel || 1) <= num(c.level)
      )
    );

  // Weapon Mastery (2024): one `weapon-mastery` modifier per mastered weapon,
  // subType `<mastery>-<weapon type>` ("sap-spear", "topple-maul"). A magic
  // weapon matches by its base type (Sun Blade → longsword).
  const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const masteredSubTypes = new Set(
    allMods.filter(m => m.type === "weapon-mastery").map(m => str(m.subType))
  );

  // Lines are built after consolidation, so the ×N prefix is padded with the name.
  const weaponInventoryMap = new Map<string, { label: string; rest: string; qty: number; homebrew: boolean }>();
  for (const i of inventory) {
    const def = obj(i.definition);
    if (str(def.filterType) !== "Weapon") continue;
    if (i.equipped !== true) continue; // only show equipped weapons in ACTIONS

    const wName = str(def.name).trim();
    // "Crossbow, Light" reads "Light Crossbow", as in the proficiency list (owner ruling 2026-11-06),
    // but only when the name is the base weapon type: a magic or named variant ("Mace, +1",
    // "Crossbow, Light, +1") keeps D&D Beyond's name (owner ruling 2026-11-07).
    const wLabel = editions.named(wName === str(def.type).trim() ? weaponWordOrder(wName) : wName, def);
    const dmg = obj(def.damage);
    const dmgDice = str(dmg.diceString);
    const attackType = num(def.attackType); // 1=melee, 2=ranged
    const properties = arr<Record<string, unknown>>(def.properties);
    const props = properties.map(p => str(p.name));
    const granted = arr<Record<string, unknown>>(def.grantedModifiers);
    const grantsFinesse = granted.some(gm => gm.type === "weapon-property" && gm.subType === "finesse");
    const isFinesse = props.includes("Finesse") || grantsFinesse;
    const isRanged = attackType === 2;
    const range = num(def.range);
    const longRange = num(def.longRange);
    const mastery = str(def.mastery);

    // Magic enhancement bonus from grantedModifiers (e.g. +1 weapon)
    const magicBonus = granted
      .filter(gm => isBonusMod(gm) && gm.subType === "magic")
      .reduce((s, gm) => s + num(gm.value ?? gm.fixedValue), 0);

    // A granted damage type (Sun Blade: radiant) replaces the weapon's own.
    const replacedType = str(granted.find(gm => gm.type === "replace-damage-type" && str(gm.subType))?.subType);
    const dmgType = (replacedType || str(def.damageType)).toLowerCase();

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
    const withBonus = (dice: string): string => dmgBonus !== 0 ? `${dice}${signed(dmgBonus)}` : dice;

    // Versatile: the property's notes hold the two-handed die ("1d10").
    const versatileDie = str(properties.find(p => str(p.name) === "Versatile")?.notes).trim();
    const twoHanded = /^\d+d\d+$/.test(versatileDie) ? ` (${withBonus(versatileDie)} two-handed)` : "";
    // Extra damage dice from grantedModifiers, with D&D Beyond's restriction text.
    // "additional" is the weapon's own (shown) type, as the item text says
    // (Giant Slayer); "all" (Vicious Weapon) prints no type (owner ruling 2026-11-06).
    const extraType = (subType: string): string =>
      subType === "additional" ? dmgType : subType === "all" ? "" : subType;
    const extraDice = granted
      .filter(gm => gm.type === "damage" && str(obj(gm.dice).diceString))
      .map(gm => {
        const restriction = str(gm.restriction).trim();
        const dice = [str(obj(gm.dice).diceString), extraType(str(gm.subType))].filter(Boolean).join(" ");
        return ` + ${dice}${restriction ? ` (${restriction})` : ""}`;
      })
      .join("");
    const dmgStr = `${withBonus(dmgDice)} ${dmgType}${twoHanded}${extraDice}`;

    // A Thrown weapon with no range data prints only its reach, and one with
    // no long range only its normal range (owner ruling 2026-11-06).
    const reach = `reach ${props.includes("Reach") ? 10 : 5} ft.`;
    const thrown = longRange > 0 ? `${range}/${longRange}` : `${range}`;
    const rangeStr = isRanged ? `range ${range}/${longRange} ft.`
      : props.includes("Thrown") && range > 0 ? `${reach} / thrown ${thrown} ft.`
      : reach;

    // A mastery shows only when the character has mastered this weapon.
    const mastered = (name: string): boolean =>
      masteredSubTypes.has(`${slug(name)}-${slug(str(def.type) || wName)}`);
    const shownProps = [
      ...props.filter(p => !MASTERY_NAMES.has(p) || mastered(p)),
      ...(grantsFinesse && !props.includes("Finesse") ? ["Finesse"] : []),
      ...(mastery && mastered(mastery) ? [mastery] : []),
    ];
    const propsStr = shownProps.join(", ");

    const rest = `${signed(hitBonus)} to hit   ${dmgStr}   ${rangeStr}${propsStr ? `   ${propsStr}` : ""}`;

    // Consolidate duplicates by key. A homebrew weapon is never merged with
    // an official one, so its line can be wrapped on its own.
    // Even a nameless one: the line also prints its damage type, properties
    // and mastery, which can carry text (owner ruling; unlike shownHomebrew's
    // name-only lines).
    const homebrew = isHomebrewEntry(i);
    const key = `${Number(homebrew)}|${wLabel}${dmgDice}`;
    const existing = weaponInventoryMap.get(key);
    if (existing) {
      existing.qty += num(i.quantity) || 1;
    } else {
      weaponInventoryMap.set(key, { label: wLabel, rest, qty: num(i.quantity) || 1, homebrew });
    }
  }

  // A homebrew weapon's line is other players' text: it is wrapped whole.
  const weaponAttacks: string[] = [];
  for (const { label, rest, qty, homebrew } of weaponInventoryMap.values()) {
    const prefix = qty > 1 ? `×${qty} ` : "";
    weaponAttacks.push(wrapIfHomebrew(`• ${`${prefix}${label}`.padEnd(16)} ${rest}`, homebrew));
  }
  return weaponAttacks;
}
