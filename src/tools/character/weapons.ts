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
import { arr, records, isBonusMod, isHomebrewClassFeature, isHomebrewEntry, isProficiencyMod, num, obj, signed, str, weaponWordOrder } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats } from "./types.js";
import { hiddenOptionIds, isVisibleAction, visibleClassFeatureIds } from "./actions.js";
import { isActiveItemMod } from "./item-gate.js";

/** `characterValues` typeId of the off-hand weapon flag. */
export const OFF_HAND_VALUE_TYPE = 18;
/** `characterValues` typeId of the pact weapon flag (Pact of the Blade). */
export const PACT_WEAPON_VALUE_TYPE = 28;

/** Inventory ids flagged by a `characterValues` entry of `typeId`: value true, `valueId` an integer (others skipped). */
export function flaggedItemIds(char: CharData, typeId: number): Set<number> {
  const ids = new Set<number>();
  for (const v of arr<unknown>(char.characterValues)) {
    const e = obj(v);
    if (e.typeId !== typeId || e.value !== true) continue;
    const id = typeof e.valueId === "number" ? e.valueId : /^\d+$/.test(str(e.valueId).trim()) ? Number(str(e.valueId).trim()) : NaN;
    if (Number.isInteger(id)) ids.add(id);
  }
  return ids;
}

/** Inventory ids flagged as the off-hand weapon (typeId 18). */
export function offHandItemIds(char: CharData): Set<number> {
  return flaggedItemIds(char, OFF_HAND_VALUE_TYPE);
}

/**
 * Flat weapon bonuses from modifiers (Archery, Dueling, an item's +N): `bonus`
 * `ranged-/melee-/weapon-attacks` add to the attack roll, `damage`
 * `one-handed-melee-attacks` (no dice) to one-handed melee damage. Gated like
 * the save advantages: a class-bucket modifier of a feature or option the
 * character hasn't reached is skipped, and so is an inactive item's. A
 * modifier with a restriction is conditional and never added.
 */
export function weaponModifierBonuses(core: CoreStats): { rangedHit: number; meleeHit: number; oneHandedMeleeDamage: number } {
  const { char, classes, inventory } = core;
  const visibleIds = visibleClassFeatureIds(char, classes);
  const hiddenOptions = hiddenOptionIds(char, visibleIds);
  const out = { rangedHit: 0, meleeHit: 0, oneHandedMeleeDamage: 0 };
  for (const [bucket, list] of Object.entries(obj(char.modifiers))) {
    for (const m of arr<Record<string, unknown>>(list)) {
      if (m == null || typeof m !== "object") continue;
      const sub = str(m.subType);
      const isHit = m.type === "bonus" && (sub === "ranged-weapon-attacks" || sub === "melee-weapon-attacks" || sub === "weapon-attacks");
      const isDamage = m.type === "damage" && sub === "one-handed-melee-attacks" && !str(obj(m.dice).diceString);
      if (!isHit && !isDamage) continue;
      if (str(m.restriction).trim()) continue;
      if (!isVisibleAction(bucket === "subclass" ? "class" : bucket, m, visibleIds, hiddenOptions)) continue;
      if (!isActiveItemMod(m, inventory)) continue;
      const value = num(m.value ?? m.fixedValue);
      if (isDamage) out.oneHandedMeleeDamage += value;
      else {
        if (sub !== "melee-weapon-attacks") out.rangedHit += value;
        if (sub !== "ranged-weapon-attacks") out.meleeHit += value;
      }
    }
  }
  return out;
}

/**
 * The Two-Weapon Fighting fighting style: an `options.*` entry (2014) or a
 * feat (2024) of that name. An option under a class feature the character
 * lacks (hiddenOptionIds) doesn't count.
 */
export function hasTwoWeaponFightingStyle(char: CharData, classes: readonly ClassEntry[]): boolean {
  const named = (r: unknown): boolean => str(obj(obj(r).definition).name) === "Two-Weapon Fighting";
  const hidden = hiddenOptionIds(char, visibleClassFeatureIds(char, classes));
  const chosen = (r: unknown): boolean => named(r) && !hidden.has(num(obj(obj(r).definition).id));
  return Object.values(obj(char.options)).some(list => arr<unknown>(list).some(chosen)) || arr<unknown>(char.feats).some(named);
}

/**
 * The Martial Arts die: the `levelScale.dice.diceString` of a `Martial Arts`
 * class feature at or below its class level, read from the classFeatures
 * wrapper (the definition carries no levelScale). Null without one.
 */
function martialArts(core: CoreStats): { die: string; homebrew: boolean } | null {
  for (const c of core.classes) {
    for (const cf of records(c.classFeatures)) {
      if (str(obj(cf.definition).name) !== "Martial Arts") continue;
      const required = obj(cf.definition).requiredLevel;
      if ((required == null ? 1 : num(required)) > num(c.level)) continue;
      const die = str(obj(obj(cf.levelScale).dice).diceString);
      if (die) return { die, homebrew: isHomebrewClassFeature(cf, c) };
    }
  }
  return null;
}

export function martialArtsDie(core: CoreStats): string | null {
  return martialArts(core)?.die ?? null;
}

/** The one Unarmed Strike row of ACTIONS (STR-based; Martial Arts uses its die and the better of STR/DEX). A homebrew Martial Arts die is user text: the row is wrapped whole. */
export function computeUnarmedStrike(core: CoreStats): string {
  const { statMods, profBonus } = core;
  const ma = martialArts(core);
  const mod = ma ? Math.max(statMods[0], statMods[1]) : statMods[0];
  const damage = ma ? `${ma.die}${mod === 0 ? "" : signed(mod)}` : String(Math.max(0, 1 + mod));
  return wrapIfHomebrew(`• ${"Unarmed Strike".padEnd(16)} ${signed(mod + profBonus)} to hit   ${damage} bludgeoning   reach 5 ft.`, ma?.homebrew);
}

export function computeWeaponAttacks(core: CoreStats): { attacks: string[]; offHand: string[] } {
  const { allMods, classes, inventory, statMods, profBonus, editions } = core;
  const dexMod = statMods[1];

  const weaponProfSlugs = new Set(
    allMods.filter(isProficiencyMod).map(m => m.subType)
  );
  const pactIds = flaggedItemIds(core.char, PACT_WEAPON_VALUE_TYPE);
  const bonuses = weaponModifierBonuses(core);
  const isWeaponProficient = (def: Record<string, unknown>, itemId: number): boolean => {
    if (pactIds.has(itemId)) return true;
    if (weaponProfSlugs.has("firearms") && arr<Record<string, unknown>>(def.properties).some(p => str(p.name) === "Ammunition (Firearms)")) return true;
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

  const offHandIds = offHandItemIds(core.char);
  const twoWeaponStyle = hasTwoWeaponFightingStyle(core.char, classes);

  // Lines are built after consolidation, so the ×N prefix is padded with the name.
  const weaponInventoryMap = new Map<string, { label: string; rest: string; qty: number; homebrew: boolean; offHand: boolean }>();
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
    const profMod = isWeaponProficient(def, num(i.id)) ? profBonus : 0;
    const hitBonus = abilityMod + profMod + magicBonus + (isRanged ? bonuses.rangedHit : bonuses.meleeHit);
    // An off-hand weapon drops a positive ability modifier unless the character
    // has the Two-Weapon Fighting style; only that part changes.
    const offHand = offHandIds.has(num(i.id));
    const dmgAbility = offHand && abilityMod > 0 && !twoWeaponStyle ? 0 : abilityMod;
    const dmgBonus = dmgAbility + magicBonus;
    // Dueling (owner ruling R5): +2 on one-handed melee rows, none while any item is flagged off-hand, never the versatile die.
    const oneHandedBonus = !isRanged && !props.includes("Two-Handed") && offHandIds.size === 0 ? bonuses.oneHandedMeleeDamage : 0;
    const withBonus = (dice: string, extra = 0): string => dmgBonus + extra !== 0 ? `${dice}${signed(dmgBonus + extra)}` : dice;

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
    // No dice, no fixed damage and no extra dice (the Net): nothing to roll.
    const dmgStr = dmgDice === "" && num(def.fixedDamage) === 0 && extraDice === ""
      ? "no damage"
      : `${withBonus(dmgDice, oneHandedBonus)} ${dmgType}${twoHanded}${extraDice}`;

    // A Thrown weapon with no range data prints only its reach, and one with
    // no long range only its normal range (owner ruling 2026-11-06).
    const reach = `reach ${props.includes("Reach") ? 10 : 5} ft.`;
    const thrown = longRange > 0 ? `${range}/${longRange}` : `${range}`;
    const rangeStr = isRanged ? `range ${range}/${longRange} ft.`
      : props.includes("Thrown") && range > 0 ? `${reach} / thrown ${thrown} ft.`
      : reach;

    // A mastery shows only when the character has mastered this weapon.
    // D&D Beyond writes "Crossbow, Heavy" as the type but "push-heavy-crossbow" as the subType, so both orders match.
    const typeName = str(def.type) || wName;
    const typeSlugs = [slug(typeName), slug(weaponWordOrder(typeName))];
    const mastered = (name: string): boolean => typeSlugs.some(t => masteredSubTypes.has(`${slug(name)}-${t}`));
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
    const key = `${Number(homebrew)}|${Number(offHand)}|${Number(pactIds.has(num(i.id)))}|${wLabel}${dmgDice}`;
    const existing = weaponInventoryMap.get(key);
    if (existing) {
      existing.qty += num(i.quantity) || 1;
    } else {
      weaponInventoryMap.set(key, { label: wLabel, rest, qty: num(i.quantity) || 1, homebrew, offHand });
    }
  }

  // A homebrew weapon's line is other players' text: it is wrapped whole.
  const attacks: string[] = [];
  const offHandRows: string[] = [];
  for (const { label, rest, qty, homebrew, offHand } of weaponInventoryMap.values()) {
    const prefix = qty > 1 ? `×${qty} ` : "";
    (offHand ? offHandRows : attacks).push(wrapIfHomebrew(`• ${`${prefix}${label}`.padEnd(16)} ${rest}`, homebrew));
  }
  return { attacks, offHand: offHandRows };
}
