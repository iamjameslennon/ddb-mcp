/**
 * Spell rows in ACTIONS (spec §2 item 3): every shown one-action spell that
 * makes an attack roll, and every damaging save cantrip, with its to-hit
 * and/or save DC, damage at the level the character casts it, and range.
 *
 * To-hit and DC share `spellAttackAndDc` / `spellBonuses` with the SPELLS
 * section's `Spell Attack` / `Save DC` lines, so the two can't disagree.
 * Every figure comes from D&D Beyond's data: cantrip scaling and beam counts
 * from `atHigherLevels`, damage bonuses from modifiers (Agonizing Blast,
 * Potent Spellcasting). When the data can't support a number, the row prints
 * without it, or states the slot level rather than guess.
 */

import { wrapIfHomebrew } from "../../utils.js";
import { isActiveItemMod } from "./item-gate.js";
import { num, obj, records, shownHomebrew, signed, statNames, str } from "./helpers.js";
import { actionSpells, classSpellcastingAbilityId, slotOrdinal, spellAttackAndDc, spellBonuses } from "./spells.js";
import type { ClassEntry, CoreStats, Mod } from "./types.js";

type Rec = Record<string, unknown>;

const higherLevels = (r: Rec): Rec[] => records(obj(r.atHigherLevels).higherLevelDefinitions);
const diceString = (d: unknown): string => str(obj(d).diceString).trim();
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const levelRow = (cls: ClassEntry): unknown[] => {
  const table = obj(obj(cls.definition).spellRules).levelSpellSlots;
  const row = Array.isArray(table) ? table[num(cls.level)] : undefined;
  return Array.isArray(row) ? row : [];
};
const isWarlock = (cls: ClassEntry): boolean => str(obj(cls.definition).name) === "Warlock";

/**
 * A cantrip damage modifier's dice at `totalLevel`: its `die`, replaced by the
 * dice of the highest typeId-15 `higherLevelDefinitions` entry whose level is
 * at most `totalLevel`. Null when neither exists.
 */
export function cantripDice(mod: Rec, totalLevel: number): string | null {
  let best: { level: number; dice: string } | null = null;
  for (const h of higherLevels(mod)) {
    const dice = diceString(h.dice);
    const level = num(h.level);
    if (num(h.typeId) !== 15 || !dice || level > totalLevel) continue;
    if (!best || level > best.level) best = { level, dice };
  }
  return best?.dice ?? (diceString(mod.die) || null);
}

/**
 * A leveled spell damage modifier's dice cast at `castLevel`: the base `die`
 * at the spell's own level. Upcast, only one shape is read: a single
 * `{ level: 1, typeId: 15 }` entry with the base die's size, adding its dice
 * per slot level above the spell's. Any other shape is null (never a guess).
 */
export function leveledDice(mod: Rec, spellLevel: number, castLevel: number): string | null {
  const base = obj(mod.die);
  const baseString = diceString(base);
  if (!baseString) return null;
  if (castLevel === spellLevel) return baseString;
  const entries = higherLevels(mod);
  if (entries.length !== 1 || castLevel < spellLevel) return null;
  const inc = entries[0];
  const incDie = obj(inc.dice);
  const size = num(base.diceValue);
  const plainBase = num(base.diceCount) > 0 && size > 0 && !num(base.fixedValue) && base.diceMultiplier == null;
  if (!plainBase || num(inc.level) !== 1 || num(inc.typeId) !== 15 || num(incDie.diceValue) !== size || !(num(incDie.diceCount) > 0)) return null;
  return `${num(base.diceCount) + num(incDie.diceCount) * (castLevel - spellLevel)}d${size}`;
}

/** A Warlock's pact slot level: the highest slot level with slots in its levelSpellSlots row. 0 for any other class. */
export function pactSlotLevel(cls: ClassEntry): number {
  if (!isWarlock(cls)) return 0;
  const row = levelRow(cls);
  for (let i = row.length - 1; i >= 0; i--) if (num(row[i]) > 0) return i + 1;
  return 0;
}

/**
 * The lowest slot level at or above `spellLevel` that a spellcasting class
 * other than Warlock has slots of (the same `canCastSpells` gate as the SPELL
 * SLOTS block); 0 when there is none.
 */
export function lowestSharedSlot(classes: readonly ClassEntry[], spellLevel: number): number {
  let lowest = 0;
  for (const cls of classes) {
    if (isWarlock(cls)) continue;
    if (obj(cls.definition).canCastSpells !== true && obj(cls.subclassDefinition).canCastSpells !== true) continue;
    const row = levelRow(cls);
    for (let slot = Math.max(spellLevel, 1); slot <= row.length; slot++) {
      if (num(row[slot - 1]) > 0) {
        if (!lowest || slot < lowest) lowest = slot;
        break;
      }
    }
  }
  return lowest;
}

/**
 * The level a leveled spell is cast at: the entry's `castAtLevel` (racial
 * Hellish Rebuke at 2); for a Warlock class-list spell, the lower of the pact
 * slot level and the lowest shared slot; otherwise the spell's own level.
 */
export function castLevel(entry: Rec, spellLevel: number, isWarlockList: boolean, classes: readonly ClassEntry[]): number {
  const fixed = entry.castAtLevel;
  if (typeof fixed === "number" && Number.isInteger(fixed) && fixed > 0) return fixed;
  if (!isWarlockList) return spellLevel;
  const pact = Math.max(0, ...classes.map(pactSlotLevel));
  const options = [pact, lowestSharedSlot(classes, spellLevel)].filter(l => l >= spellLevel && l > 0);
  return options.length ? Math.min(...options) : spellLevel;
}

/** Shown: one action, and an attack roll, or a cantrip with a save and a damage modifier. */
function isActionSpell(def: Rec): boolean {
  if (num(obj(def.activation).activationType) !== 1) return false;
  const attackType = num(def.attackType);
  if (attackType === 1 || attackType === 2) return true;
  return num(def.level) === 0 && num(def.saveDcAbilityId) > 0 && records(def.modifiers).some(m => m.type === "damage");
}

/** An ability id: an integer 1–6 (STR … CHA). */
const isAbilityId = (id: number): boolean => Number.isInteger(id) && id >= 1 && id <= 6;

/** A bonus modifier's amount: its ability's modifier (an integer statId 1–6), else its fixed value. */
function modAmount(m: Mod, statMods: readonly number[]): number {
  const statId = num(m.statId);
  return isAbilityId(statId) ? statMods[statId - 1] : num(m.value ?? m.fixedValue);
}

const withBonus = (dice: string, bonus: number): string => (bonus ? `${dice}${signed(bonus)}` : dice);

/**
 * `N word × ` from the first damage restriction like "3 Rays", else, for a
 * cantrip only, the highest typeId-16 entry reached by character level (a
 * leveled spell's entries count slot levels, not character levels).
 */
function countPrefix(def: Rec, damageMods: readonly Rec[], level: number, totalLevel: number): string {
  let count = 0;
  let word = "";
  for (const m of damageMods) {
    const match = /^(\d+) (\w+)/.exec(str(m.restriction).trim());
    if (match) { count = Number(match[1]); word = match[2]; break; }
  }
  if (!word && level === 0) {
    let best = -1;
    for (const h of higherLevels(def)) {
      const reached = num(h.level);
      if (num(h.typeId) !== 16 || reached > totalLevel || reached <= best || !str(h.details).trim()) continue;
      best = reached;
      count = 1 + num(h.value);
      word = str(h.details).trim();
    }
  }
  return count > 1 && word ? `${count} ${word.toLowerCase()} × ` : "";
}

/** The damage text and notes for one spell; `weapon` when it is made with a melee weapon attack (Green-Flame Blade). */
function spellDamage(
  def: Rec,
  level: number,
  cast: number,
  flatBonus: number,
  totalLevel: number,
): { damage: string; weapon: boolean } {
  const damageMods = records(def.modifiers).filter(m => m.type === "damage");
  // No base die anywhere, but level-scaled dice: the cantrip rides a melee
  // weapon attack; only the first component's bonus dice print.
  if (level === 0 && damageMods.length && damageMods.every(m => !diceString(m.die))
      && damageMods.some(m => higherLevels(m).some(h => num(h.typeId) === 15 && diceString(h.dice)))) {
    const dice = cantripDice(damageMods[0], totalLevel);
    const type = str(damageMods[0].subType);
    return { damage: dice ? `+ ${withBonus(dice, flatBonus)}${type ? ` ${type}` : ""}` : "", weapon: true };
  }
  let slotNote = false;
  const groups: { dice: string; types: string[] }[] = [];
  for (const m of damageMods) {
    let dice = level === 0 ? cantripDice(m, totalLevel) : leveledDice(m, level, cast);
    if (dice == null && level > 0 && cast !== level && diceString(m.die)) {
      dice = diceString(m.die);
      slotNote = true;
    }
    if (!dice) continue;
    const key = withBonus(dice, flatBonus);
    const type = str(m.subType);
    const group = groups.find(g => g.dice === key);
    if (!group) groups.push({ dice: key, types: type ? [type] : [] });
    else if (type && !group.types.includes(type)) group.types.push(type);
  }
  if (!groups.length) return { damage: "", weapon: false };
  const text = groups.map(g => `${g.dice}${g.types.length ? ` ${g.types.join("/")}` : ""}`).join(" + ");
  const note = slotNote ? ` (at ${slotOrdinal(cast)}-level slot: see spell)` : "";
  return { damage: `${countPrefix(def, damageMods, level, totalLevel)}${text}${note}`, weapon: false };
}

/** `range N ft.`, `touch` or `self`, from the definition's range object; "" for any other shape. */
function spellRange(def: Rec): string {
  const range = obj(def.range);
  const origin = str(range.origin);
  if (origin === "Ranged" && num(range.rangeValue) > 0) return `range ${num(range.rangeValue)} ft.`;
  if (origin === "Touch") return "touch";
  if (origin === "Self") return "self";
  return "";
}

/** The first non-empty `details` among the damage modifiers' higher-level entries (Toll the Dead's d12 note). */
function scalingNote(def: Rec): string {
  for (const m of records(def.modifiers).filter(r => r.type === "damage")) {
    for (const h of higherLevels(m)) {
      const details = str(h.details).replace(/\s+/g, " ").trim();
      if (details) return details;
    }
  }
  return "";
}

/** The ACTIONS spell rows, in the order the spells are gathered (class lists, then `char.spells` buckets). */
export function computeSpellAttackRows(core: CoreStats): string[] {
  const { char, classes, statMods, profBonus, totalLevel, editions, inventory } = core;
  const bonuses = spellBonuses(core);
  const casterAbilities = classes.map(classSpellcastingAbilityId).filter(id => id > 0);
  const singleCasterAbility = casterAbilities.length === 1 ? casterAbilities[0] : 0;
  // Spell damage bonuses from an item count only while the item is active (owner 2026-11-09).
  const activeMods = core.allMods.map(obj).filter(m => isActiveItemMod(m, inventory));
  const rows: string[] = [];
  for (const { spell, list, bucket } of actionSpells(char, classes)) {
    if (spell.definition == null || typeof spell.definition !== "object") continue;
    const def = obj(spell.definition);
    const name = editions.named(str(def.name), def);
    if (!name || !isActionSpell(def)) continue;
    const level = num(def.level);

    // Ability: the class list's class; another bucket's own id (0 counts as
    // null); a spells.class null falls back to the only spellcasting class.
    const abilityId = list
      ? (list.classEntry ? classSpellcastingAbilityId(list.classEntry) : 0)
      : num(spell.spellCastingAbilityId) || (bucket === "class" ? singleCasterAbility : 0);
    const nums = spellAttackAndDc(abilityId, statMods, profBonus, bonuses);

    const spellSlug = slug(str(def.name));
    const classSlug = list && level === 0 ? slug(list.className) : "";
    const flatBonus = activeMods
      .filter(m => (spellSlug && m.type === spellSlug && m.subType === "bonus-damage")
        || (classSlug && m.type === "bonus" && m.subType === `${classSlug}-cantrip-damage`))
      .reduce((sum, m) => sum + modAmount(m, statMods), 0);

    const cast = level === 0 ? 0 : castLevel(spell, level, list != null && list.className === "Warlock", classes);
    const { damage, weapon } = spellDamage(def, level, cast, flatBonus, totalLevel);

    const attackType = num(def.attackType);
    const saveId = num(def.saveDcAbilityId);
    const hitOrDc = weapon
      ? "melee weapon attack"
      : nums
        ? [
          attackType === 1 || attackType === 2 ? `${signed(nums.attack)} to hit` : "",
          isAbilityId(saveId) ? `DC ${nums.dc} ${statNames[saveId - 1]}` : "",
        ].filter(Boolean).join(" / ")
        : "";

    const head = `${name} (${level === 0 ? "cantrip" : `${slotOrdinal(level)} level`})`;
    const body = [hitOrDc, damage, spellRange(def)].filter(Boolean).join("   ");
    const note = scalingNote(def);
    const line = `• ${body ? `${head.padEnd(26)} ${body}` : head}${note ? `   (${note})` : ""}`;
    rows.push(wrapIfHomebrew(line, shownHomebrew(spell, name)));
  }
  return rows;
}
