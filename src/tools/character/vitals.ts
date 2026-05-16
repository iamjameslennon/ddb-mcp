/**
 * Vitals domain — HP, hit dice, speed (all 5 modes), initiative, death saves.
 * Owns the vitals block.
 *
 * Phase 3 of the character.ts refactor — see docs/character-refactor.md.
 *
 * AC is its own module ([Phase 4 → ac.ts]) — `formatVitalsBlock` takes it as
 * a separate parameter rather than including it in `Vitals`, since AC isn't
 * a vitals concern.
 */

import { arr, hasRemarkableAthlete, num, obj, signed } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, Mod } from "./types.js";

export interface HitPoints { current: number; max: number; temp: number }
export interface DeathSaves { successes: number; failures: number }

export interface Vitals {
  hp: HitPoints;
  hitDice: string[];          // e.g. ["5d10 (4 remaining)", "2d6 (2 remaining)"]
  initiative: number;
  speed: string[];             // e.g. ["30 ft.", "fly 60 ft."]
  deathSaves: DeathSaves;
}

// ── HP ───────────────────────────────────────────────────────────────────────
function computeHp(core: CoreStats): HitPoints {
  const { char, allMods, statMods, totalLevel } = core;
  // baseHitPoints does NOT include the CON modifier — must add conMod × level.
  const conMod = statMods[2];
  // Tough feat and Dwarven Toughness grant type:"bonus" subType:"hit-points-per-level" (value 2 or 1).
  const hpPerLevelBonus = allMods
    .filter(m => m.type === "bonus" && m.subType === "hit-points-per-level")
    .reduce((s, m) => s + num(m.value ?? m.fixedValue), 0);
  const max = num(char.baseHitPoints) + num(char.bonusHitPoints) + ((conMod + hpPerLevelBonus) * totalLevel);
  const current = max - num(char.removedHitPoints);
  const temp = num(char.temporaryHitPoints);
  return { current, max, temp };
}

// ── Hit dice ─────────────────────────────────────────────────────────────────
function computeHitDice(classes: readonly ClassEntry[]): string[] {
  return classes.map(c => {
    const die = num(obj(c.definition).hitDice);
    const lvl = num(c.level);
    const used = num(c.hitDiceUsed);
    return `${lvl}d${die} (${lvl - used} remaining)`;
  });
}

// ── Speed ────────────────────────────────────────────────────────────────────
function computeSpeed(core: CoreStats): string[] {
  const { char, allMods } = core;
  const weightSpeeds = obj(obj(obj(char.race).weightSpeeds).normal);

  // Tasha's optional class features (Roving, Canny, Tireless, etc.) live in
  // char.options.class. When preferences.enableOptionalClassFeatures is
  // false, DDB does NOT include them in char.classes[].classFeatures, but
  // their modifiers still appear in char.modifiers.class with
  // `isGranted: true`. The website ignores those orphan modifiers; we must
  // too. Discriminator: the modifier's componentId must match the id of a
  // feature actually present in classFeatures/subclassFeatures. Hand-built
  // fixtures don't set componentId at all (cid=0) — those bypass the filter
  // unchanged.
  const grantedClassFeatureIds = new Set<number>();
  for (const c of arr<Record<string, unknown>>(char.classes)) {
    for (const cf of arr<Record<string, unknown>>(c.classFeatures)) {
      const id = num(obj(cf.definition).id);
      if (id) grantedClassFeatureIds.add(id);
    }
    for (const cf of arr<Record<string, unknown>>(obj(c.subclassDefinition).classFeatures)) {
      const id = num(obj(cf.definition).id);
      if (id) grantedClassFeatureIds.add(id);
    }
  }
  // Build the set of modifier object identities (by reference) that originate
  // from a class/subclass category but whose componentId is orphaned — these
  // must be skipped. Other sources (race, feat, item, background, condition)
  // never get filtered.
  const skippedClassMods = new Set<Mod>();
  for (const [source, list] of Object.entries(obj(char.modifiers))) {
    if (source !== "class" && source !== "subclass") continue;
    for (const m of arr<Mod>(list)) {
      const cid = num(m.componentId);
      if (cid !== 0 && !grantedClassFeatureIds.has(cid)) skippedClassMods.add(m);
    }
  }
  const isApplicable = (m: Mod): boolean => !skippedClassMods.has(m);

  // DDB uses three subType patterns for speed modifiers:
  //   - `innate-speed-{axis}` — race-granted base / overrides (e.g. Dwarven slow speed)
  //   - `speed-{axis}` — class/feat/subclass axis-specific bonus (e.g. Scout's Superior Mobility, Ranger's Roving)
  //   - `speed` (no axis suffix) — generic walking-speed bonus (e.g. Barbarian Fast Movement, Mobile feat, Longstrider)
  // `set` mods override the base axis speed; `bonus` mods stack on top.
  const speedCalc = (axis: "walking" | "flying" | "swimming" | "climbing" | "burrowing", base: number, fallback = 0): number => {
    const subTypes = new Set([`innate-speed-${axis}`, `speed-${axis}`]);
    // The bare "speed" subType is a walking-default bonus only; never applies to fly/swim/climb/burrow.
    if (axis === "walking") subTypes.add("speed");
    const override = allMods
      .filter(m => m.type === "set" && typeof m.subType === "string" && subTypes.has(m.subType) && num(m.value ?? m.fixedValue) > 0 && isApplicable(m))
      .reduce((max, m) => Math.max(max, num(m.value ?? m.fixedValue)), 0);
    const bonus = allMods
      .filter(m => m.type === "bonus" && typeof m.subType === "string" && subTypes.has(m.subType) && isApplicable(m))
      .reduce((s, m) => s + num(m.value ?? m.fixedValue), 0);
    return (override || base || fallback) + bonus;
  };
  // Monk Unarmored Movement uses "unarmored-movement" rather than "innate-speed-walking".
  // Technically only applies when unarmored and unshielded; we add it unconditionally here.
  // TODO: gate on absence of equipped armor/shield for strict correctness.
  const unarmoredMoveBonus = allMods
    .filter(m => m.type === "bonus" && m.subType === "unarmored-movement" && isApplicable(m))
    .reduce((s, m) => s + num(m.value ?? m.fixedValue), 0);
  const walkSpeed = speedCalc("walking", num(weightSpeeds.walk), 30) + unarmoredMoveBonus;
  const flySpeed = speedCalc("flying", num(weightSpeeds.fly));
  const swimSpeed = speedCalc("swimming", num(weightSpeeds.swim));
  const climbSpeed = speedCalc("climbing", num(weightSpeeds.climb));
  const burrowSpeed = speedCalc("burrowing", num(weightSpeeds.burrow));
  const parts: string[] = [`${walkSpeed} ft.`];
  if (flySpeed > 0) parts.push(`fly ${flySpeed} ft.`);
  if (swimSpeed > 0) parts.push(`swim ${swimSpeed} ft.`);
  if (climbSpeed > 0) parts.push(`climb ${climbSpeed} ft.`);
  if (burrowSpeed > 0) parts.push(`burrow ${burrowSpeed} ft.`);
  return parts;
}

// ── Initiative ───────────────────────────────────────────────────────────────
function computeInitiative(core: CoreStats): number {
  const { allMods, statMods, classes, profBonus } = core;
  const dexMod = statMods[1];
  const initiativeBonus = allMods
    .filter(m => m.subType === "initiative" && m.type === "bonus")
    .reduce((s: number, m: Mod) => {
      // bonusTypes [1] means the bonus value is the proficiency bonus, not a fixed number
      const usesProfBonus = arr<number>(m.bonusTypes).includes(1) && (m.fixedValue == null && m.value == null);
      if (usesProfBonus) return s + profBonus;
      if (m.value != null) return s + num(m.value);
      if (m.fixedValue != null) return s + num(m.fixedValue);
      // statId-based bonus (e.g. Gloom Stalker Dread Ambusher adds WIS mod to initiative)
      const sid = num(m.statId);
      return s + (sid > 0 ? statMods[sid - 1] : 0);
    }, 0);
  // Half-proficiency to initiative comes from two distinct sources:
  //
  //   1. Bard's Jack of All Trades emits an explicit
  //      `type:"half-proficiency" subType:"initiative"` modifier (in addition
  //      to its `subType:"ability-checks"` modifier that drives skills).
  //      PHB rule: round DOWN.
  //   2. Champion Fighter's Remarkable Athlete emits NO modifier at all —
  //      detection is by subclass name + level (see hasRemarkableAthlete).
  //      PHB rule: round UP.
  //
  // We must NOT infer initiative half-prof from `subType:"ability-checks"`
  // alone — the DDB website doesn't. If a character has both JoAT and RA
  // somehow (Bard 2 / Champion 7 multiclass), take the max rather than
  // double-stacking.
  const joatInit = allMods.some(m => m.type === "half-proficiency" && m.subType === "initiative")
    ? Math.floor(profBonus / 2)
    : 0;
  const raInit = hasRemarkableAthlete(classes) ? Math.ceil(profBonus / 2) : 0;
  return dexMod + initiativeBonus + Math.max(joatInit, raInit);
}

// ── Death saves ──────────────────────────────────────────────────────────────
function computeDeathSaves(char: CharData): DeathSaves {
  const ds = obj(char.deathSaves);
  return { successes: num(ds.successCount), failures: num(ds.failCount) };
}

// ── Public API ───────────────────────────────────────────────────────────────
export function computeVitals(core: CoreStats): Vitals {
  return {
    hp: computeHp(core),
    hitDice: computeHitDice(core.classes),
    initiative: computeInitiative(core),
    speed: computeSpeed(core),
    deathSaves: computeDeathSaves(core.char),
  };
}

/**
 * `ac` is computed by ./ac.js (Phase 4) and threaded in here separately
 * because AC has its own module. `profBonus` is from CoreStats.
 */
export function formatVitalsBlock(v: Vitals, ac: number, profBonus: number): string[] {
  return [
    `HP: ${v.hp.current}/${v.hp.max}   Temp HP: ${v.hp.temp || "—"}   Prof Bonus: ${signed(profBonus)}`,
    `Hit Dice: ${v.hitDice.join(" / ")}`,
    `AC: ${ac}   Initiative: ${signed(v.initiative)}   Speed: ${v.speed.join(", ")}`,
    `Death Saves: Successes ${v.deathSaves.successes}/3   Failures ${v.deathSaves.failures}/3`,
    ``,
  ];
}
