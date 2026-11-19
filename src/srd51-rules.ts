/**
 * srd51-rules.ts — SRD 5.1 "Damage and Healing" text that Open5e's v2 `srd-2014` ruleset lacks,
 * and the pure patch that applies it (F3, owner ruling R3).
 *
 * Upstream defects (Open5e v2 `rulesets?document__key=srd-2014`, chapter `srd_damage-and-healing`):
 *   - Critical Hits has the same `desc` as Damage Rolls;
 *   - the Hit Points `desc` ends with an embedded copy of the Damage Rolls section;
 *   - Healing, Dropping to 0 Hit Points, Instant Death, Falling Unconscious, Death Saving
 *     Throws, Stabilizing a Creature, Monsters and Death, Knocking a Creature Out and
 *     Temporary Hit Points are missing.
 *
 * The text below is copied verbatim, with no rewording, from the `desc` of Open5e v1
 * (`https://api.open5e.com/v1/sections/damage-and-healing/`, document `wotc-srd`, the same
 * SRD 5.1). It was emitted by script, not retyped; each `desc` is the section's body without
 * its "### Heading" line, the shape of the v2 sections o5GetRule prints under `### <name>`.
 * "Dropping to 0 Hit Points" is its intro paragraph only (its subsections are separate).
 *
 * Every rule here applies only while upstream is still broken; once Open5e fixes a section,
 * upstream wins and nothing is listed twice. Only the 2014 document is ever patched.
 *
 * This work includes material from the System Reference Document 5.1 by Wizards of the Coast
 * LLC, licensed under CC-BY-4.0.
 */

import { normalizeName } from "./edition.js";

export interface Srd51Section { key: string; name: string; index: number; desc: string }

export const DAMAGE_AND_HEALING_KEY = "srd_damage-and-healing";

/** Stands in for a section that duplicates another when no vendored text exists for it. */
export const MISSING_UPSTREAM_TEXT = "*(Open5e's SRD 5.1 text for this section is missing.)*";

// GENERATED-FROM-SOURCE BEGIN (verbatim SRD 5.1 text; do not retype)
const CRITICAL_HITS = "When you score a critical hit, you get to roll extra dice for the attack's damage against the target. Roll all of the attack's damage dice twice and add them together. Then add any relevant modifiers as normal. To speed up play, you can roll all the damage dice at once.\n\nFor example, if you score a critical hit with a dagger, roll 2d4 for the damage, rather than 1d4, and then add your relevant ability modifier. If the attack involves other damage dice, such as from the rogue's Sneak Attack feature, you roll those dice twice as well.";
const APPENDED: readonly Srd51Section[] = [
  { key: `${DAMAGE_AND_HEALING_KEY}_healing`, name: "Healing", index: 7, desc: "Unless it results in death, damage isn't permanent. Even death is reversible through powerful magic. Rest can restore a creature's hit points, and magical methods such as a _cure wounds_ spell or a _potion of healing_ can remove damage in an instant.\n\nWhen a creature receives healing of any kind, hit points regained are added to its current hit points. A creature's hit points can't exceed its hit point maximum, so any hit points regained in excess of this number are lost. For example, a druid grants a ranger 8 hit points of healing. If the ranger has 14 current hit points and has a hit point maximum of 20, the ranger regains 6 hit points from the druid, not 8.\n\nA creature that has died can't regain hit points until magic such as the srd:revivify spell has restored it to life." },
  { key: `${DAMAGE_AND_HEALING_KEY}_dropping-to-0-hit-points`, name: "Dropping to 0 Hit Points", index: 8, desc: "When you drop to 0 hit points, you either die outright or fall srd:unconscious, as explained in the following sections." },
  { key: `${DAMAGE_AND_HEALING_KEY}_instant-death`, name: "Instant Death", index: 9, desc: "Massive damage can kill you instantly. When damage reduces you to 0 hit points and there is damage remaining, you die if the remaining damage equals or exceeds your hit point maximum.\n\nFor example, a cleric with a maximum of 12 hit points currently has 6 hit points. If she takes 18 damage from an attack, she is reduced to 0 hit points, but 12 damage remains. Because the remaining damage equals her hit point maximum, the cleric dies." },
  { key: `${DAMAGE_AND_HEALING_KEY}_falling-unconscious`, name: "Falling Unconscious", index: 10, desc: "If damage reduces you to 0 hit points and fails to kill you, you fall srd:unconscious. This unconsciousness ends if you regain any hit points." },
  { key: `${DAMAGE_AND_HEALING_KEY}_death-saving-throws`, name: "Death Saving Throws", index: 11, desc: "Whenever you start your turn with 0 hit points, you must make a special saving throw, called a death saving throw, to determine whether you creep closer to death or hang onto life. Unlike other saving throws, this one isn't tied to any ability score. You are in the hands of fate now, aided only by spells and features that improve your chances of succeeding on a saving throw.\n\nRoll a d20. If the roll is 10 or higher, you succeed. Otherwise, you fail. A success or failure has no effect by itself. On your third success, you become stable (see below). On your third failure, you die. The successes and failures don't need to be consecutive; keep track of both until you collect three of a kind. The number of both is reset to zero when you regain any hit points or become stable.\n\n**Rolling 1 or 20.** When you make a death saving throw and roll a 1 on the d20, it counts as two failures. If you roll a 20 on the d20, you regain 1 hit point.\n\n**Damage at 0 Hit Points.** If you take any damage while you have 0 hit points, you suffer a death saving throw failure. If the damage is from a critical hit, you suffer two failures instead. If the damage equals or exceeds your hit point maximum, you suffer instant death." },
  { key: `${DAMAGE_AND_HEALING_KEY}_stabilizing-a-creature`, name: "Stabilizing a Creature", index: 12, desc: "The best way to save a creature with 0 hit points is to heal it. If healing is unavailable, the creature can at least be stabilized so that it isn't killed by a failed death saving throw.\n\nYou can use your action to administer first aid to an srd:unconscious creature and attempt to stabilize it, which requires a successful DC 10 Wisdom (Medicine) check. A **stable** creature doesn't make death saving throws, even though it has 0 hit points, but it does remain srd:unconscious. The creature stops being stable, and must start making death saving throws again, if it takes any damage. A stable creature that isn't healed regains 1 hit point after 1d4 hours." },
  { key: `${DAMAGE_AND_HEALING_KEY}_monsters-and-death`, name: "Monsters and Death", index: 13, desc: "Most GMs have a monster die the instant it drops to 0 hit points, rather than having it fall srd:unconscious and make death saving throws. Mighty villains and special nonplayer characters are common exceptions; the GM might have them fall srd:unconscious and follow the same rules as player characters." },
  { key: `${DAMAGE_AND_HEALING_KEY}_knocking-a-creature-out`, name: "Knocking a Creature Out", index: 14, desc: "Sometimes an attacker wants to incapacitate a foe, rather than deal a killing blow. When an attacker reduces a creature to 0 hit points with a melee attack, the attacker can knock the creature out. The attacker can make this choice the instant the damage is dealt. The creature falls srd:unconscious and is stable." },
  { key: `${DAMAGE_AND_HEALING_KEY}_temporary-hit-points`, name: "Temporary Hit Points", index: 15, desc: "Some spells and special abilities confer temporary hit points to a creature. Temporary hit points aren't actual hit points; they are a buffer against damage, a pool of hit points that protect you from injury. When you have temporary hit points and take damage, the temporary hit points are lost first, and any leftover damage carries over to your normal hit points. _For example, if you have 5 temporary hit points and take 7 damage, you lose the temporary hit points and then take 2 damage._ Because temporary hit points are separate from your actual hit points, they can exceed your hit point maximum. A character can, therefore, be at full hit points and receive temporary hit points.\n\nHealing can't restore temporary hit points, and they can't be added together. If you have temporary hit points and receive more of them, you decide whether to keep the ones you have or to gain the new ones. For example, if a spell grants you 12 temporary hit points when you already have 10, you can have 12 or 10, not 22.\n\nIf you have 0 hit points, receiving temporary hit points doesn't restore you to consciousness or stabilize you. They can still absorb damage directed at you while you're in that state, but only true healing can save you.\n\nUnless a feature that grants you temporary hit points has a duration, they last until they're depleted or you finish a long rest." },
];
// GENERATED-FROM-SOURCE END

export const SRD51_DAMAGE_AND_HEALING: { replace: Readonly<Record<string, string>>; append: readonly Srd51Section[] } = {
  replace: { [`${DAMAGE_AND_HEALING_KEY}_critical-hits`]: CRITICAL_HITS },
  append: APPENDED,
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Cuts an embedded copy of another section from the end of `section.desc` (owner decision
 * 2026-11-19): the tail must be a "#"-heading naming another section of the same ruleset
 * followed by that section's exact desc (whitespace between and after allowed). Anything
 * else is left alone, so once upstream is fixed nothing is trimmed.
 */
function trimEmbeddedTail(section: Srd51Section, others: readonly Srd51Section[]): string {
  for (const other of others) {
    if (other === section || !other.desc.trim()) continue;
    const m = new RegExp(`(?:^|\n)[ \t]*#{2,6}[ \t]+${escapeRe(other.name)}[ \t]*\n+${escapeRe(other.desc.trim())}\\s*$`).exec(section.desc);
    if (m && section.desc.slice(0, m.index).trim()) return section.desc.slice(0, m.index).trim();
  }
  return section.desc;
}

/**
 * Applies the vendored SRD 5.1 Damage and Healing text to 2014 rulesets. Pure: returns new
 * objects. Steps per ruleset, in order: (1) trim embedded copies of other sections; (2) a
 * section whose desc equals an earlier section's gets its vendored replacement, or
 * MISSING_UPSTREAM_TEXT; (3) on the Damage and Healing chapter, append each vendored section
 * no upstream section already has by key or normalized name. The trim looks at the original
 * descs and the duplicate check at the trimmed ones, so the rules cannot interfere.
 */
export function patchSrd51Rulesets<T extends { key: string; rules: Srd51Section[] }>(rulesets: T[]): T[] {
  return rulesets.map(ruleset => {
    const original = ruleset.rules;
    const trimmed = original.map(s => ({ ...s, desc: trimEmbeddedTail(s, original) }));
    const earlier = (a: Srd51Section, b: Srd51Section, ia: number, ib: number): boolean =>
      a.index < b.index || (a.index === b.index && ia < ib);
    const rules = trimmed.map((s, i) => {
      const dup = s.desc.trim() !== "" && trimmed.some((o, j) =>
        j !== i && o.desc === s.desc && earlier(o, s, j, i));
      return dup ? { ...s, desc: SRD51_DAMAGE_AND_HEALING.replace[s.key] ?? MISSING_UPSTREAM_TEXT } : s;
    });
    if (ruleset.key === DAMAGE_AND_HEALING_KEY) {
      for (const add of SRD51_DAMAGE_AND_HEALING.append) {
        if (!rules.some(s => s.key === add.key || normalizeName(s.name) === normalizeName(add.name))) rules.push({ ...add });
      }
    }
    return { ...ruleset, rules };
  });
}
