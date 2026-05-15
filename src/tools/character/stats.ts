/**
 * Stats domain — saving throws, skills, senses, proficiencies. Owns the
 * ability-score display line and the stats block.
 *
 * Phase 5 of the character.ts refactor — see docs/character-refactor.md.
 *
 * Output strings are pre-formatted (e.g. `savingThrows = ["STR +5*", ...]`)
 * to preserve byte-for-byte parity with the original inline code. A future
 * pass could lift these into structured data, but that's a separate concern.
 */

import { arr, capitalize, num, obj, signed, statKeys, statNames, str } from "./helpers.js";
import type { CharData, CoreStats, Mod } from "./types.js";

export interface Senses {
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;
  special: string[];   // ["Darkvision 60 ft.", "Blindsight 30 ft.", ...]
}

export interface Proficiencies {
  armor: string[];
  weapons: string[];
  tools: string[];
  languages: string[];
}

export interface Stats {
  abilityScoreDisplay: string[];   // ["STR 16 (+3)", "DEX 12 (+1)", ...]
  savingThrows: string[];           // ["STR +5*", "DEX +1", ...]
  skillLines: string[];             // ["  Acrobatics (DEX)       +1", ...]
  senses: Senses;
  proficiencies: Proficiencies;
}

// 18 standard skills, with the index of the ability stat they key off of.
const SKILLS: ReadonlyArray<readonly [string, number]> = [
  ["Acrobatics", 1], ["Animal Handling", 4], ["Arcana", 3], ["Athletics", 0],
  ["Deception", 5], ["History", 3], ["Insight", 4], ["Intimidation", 5],
  ["Investigation", 3], ["Medicine", 4], ["Nature", 3], ["Perception", 4],
  ["Performance", 5], ["Persuasion", 5], ["Religion", 3], ["Sleight of Hand", 1],
  ["Stealth", 1], ["Survival", 4],
];

const SENSE_ID_NAMES: Record<number, string> = {
  1: "Blindsight", 2: "Darkvision", 3: "Tremorsense", 4: "Truesight",
};
const SENSE_SLUGS = new Set(["darkvision", "blindsight", "tremorsense", "truesight"]);

// ── Ability score display ────────────────────────────────────────────────────
function buildAbilityScoreDisplay(statTotals: readonly number[], statMods: readonly number[]): string[] {
  return statNames.map((n, i) => `${n} ${statTotals[i]} (${signed(statMods[i])})`);
}

// ── Saving throws ────────────────────────────────────────────────────────────
function buildSavingThrows(allMods: readonly Mod[], statMods: readonly number[], profBonus: number): string[] {
  const saveProfSubTypes = new Set(
    allMods.filter(m => m.type === "proficiency" && str(m.subType).includes("saving-throws"))
      .map(m => str(m.subType))
  );
  return statKeys.map((key, i) => {
    const isProficient = saveProfSubTypes.has(`${key}-saving-throws`);
    const total = statMods[i] + (isProficient ? profBonus : 0);
    return `${statNames[i]} ${signed(total)}${isProficient ? "*" : ""}`;
  });
}

// ── Skills (returns bonuses + display lines together — both needed downstream) ──
interface SkillBonus { bonus: number; isProficient: boolean; isExpertise: boolean }

function computeSkillBonuses(allMods: readonly Mod[], statMods: readonly number[], profBonus: number): SkillBonus[] {
  const skillProfSubTypes = new Set(
    allMods.filter(m => m.type === "proficiency").map(m => str(m.subType))
  );
  const skillExpertiseSubTypes = new Set(
    allMods.filter(m => m.type === "expertise").map(m => str(m.subType))
  );
  // half-proficiency (e.g. Bard's Jack of All Trades applies to all ability checks)
  const hasJackOfAllTrades = allMods.some(
    m => m.type === "half-proficiency" && m.subType === "ability-checks"
  );
  const skillHalfProfSubTypes = new Set(
    allMods.filter(m => m.type === "half-proficiency" && m.subType !== "ability-checks")
      .map(m => str(m.subType))
  );
  return SKILLS.map(([skillName, statIdx]) => {
    const slug = skillName.toLowerCase().replace(/ /g, "-").replace(/'/g, "");
    const isProficient = skillProfSubTypes.has(slug);
    const isExpertise = skillExpertiseSubTypes.has(slug);
    const isHalf = !isProficient && (skillHalfProfSubTypes.has(slug) || hasJackOfAllTrades);
    let bonus = statMods[statIdx];
    if (isExpertise) bonus += profBonus * 2;
    else if (isProficient) bonus += profBonus;
    else if (isHalf) bonus += Math.floor(profBonus / 2);
    // Flat bonus modifiers on the skill subType (e.g. Divine Order: Scholar adds WIS to Arcana/Religion).
    // When value/fixedValue are null, statId identifies which ability modifier to add instead.
    const flatBonus = allMods
      .filter(m => m.type === "bonus" && m.subType === slug)
      .reduce((s, m) => {
        if (m.value != null) return s + num(m.value);
        if (m.fixedValue != null) return s + num(m.fixedValue);
        const sid = num(m.statId);
        return s + (sid > 0 ? statMods[sid - 1] : 0);
      }, 0);
    bonus += flatBonus;
    return { bonus, isProficient, isExpertise };
  });
}

function buildSkillLines(skillBonuses: readonly SkillBonus[]): string[] {
  return SKILLS.map(([skillName, statIdx], i) => {
    const { bonus, isProficient, isExpertise } = skillBonuses[i];
    const marker = isExpertise ? " **" : isProficient ? " *" : "";
    const statLabel = statNames[statIdx];
    return `  ${(skillName + ` (${statLabel})`).padEnd(22)} ${signed(bonus)}${marker}`;
  });
}

// ── Senses ──────────────────────────────────────────────────────────────────
function computeSenses(char: CharData, allMods: readonly Mod[], skillBonuses: readonly SkillBonus[]): Senses {
  const perceptionIdx = SKILLS.findIndex(([n]) => n === "Perception");
  const investigationIdx = SKILLS.findIndex(([n]) => n === "Investigation");
  const insightIdx = SKILLS.findIndex(([n]) => n === "Insight");
  const passivePerception = 10 + skillBonuses[perceptionIdx].bonus;
  const passiveInvestigation = 10 + skillBonuses[investigationIdx].bonus;
  const passiveInsight = 10 + skillBonuses[insightIdx].bonus;
  // Collect senses from all sources; keep highest value per sense name.
  const senseMap = new Map<string, number>();
  const mergeSense = (name: string, val: number) => {
    if (val > 0) senseMap.set(name, Math.max(senseMap.get(name) ?? 0, val));
  };
  // 2024: type:"sense" modifiers
  for (const m of allMods)
    if (m.type === "sense") mergeSense(capitalize(str(m.subType)), num(m.value));
  // 2014: type:"set" / type:"set-base" modifiers with sense subType slugs
  for (const m of allMods)
    if ((m.type === "set" || m.type === "set-base") && SENSE_SLUGS.has(str(m.subType)))
      mergeSense(capitalize(str(m.subType)), num(m.value));
  // 2014: customSenses array (explicit overrides / grants)
  for (const cs of arr<Record<string, unknown>>(char.customSenses)) {
    const name = SENSE_ID_NAMES[num(cs.senseId)];
    if (name) mergeSense(name, num(cs.value));
  }
  // 2014: racial trait senses (range parsed from notes, e.g. "60 feet")
  for (const trait of arr<Record<string, unknown>>(obj(char.race).racialTraits)) {
    for (const sense of arr<Record<string, unknown>>(obj(trait.definition).senses)) {
      const name = SENSE_ID_NAMES[num(sense.senseId)];
      const match = str(sense.notes).match(/\d+/);
      if (name && match) mergeSense(name, parseInt(match[0], 10));
    }
  }
  const special = Array.from(senseMap.entries()).map(([n, v]) => `${n} ${v} ft.`);
  return { passivePerception, passiveInvestigation, passiveInsight, special };
}

// ── Proficiencies ───────────────────────────────────────────────────────────
function computeProficiencies(allMods: readonly Mod[]): Proficiencies {
  const armorProfMap: Record<string, string> = {
    "light-armor": "Light Armor", "medium-armor": "Medium Armor",
    "heavy-armor": "Heavy Armor", "shields": "Shields",
  };
  const weaponProfMap: Record<string, string> = {
    "simple-weapons": "Simple Weapons", "martial-weapons": "Martial Weapons",
  };
  // Placeholder subType values that are unresolved character-builder selections — discard them.
  const isProfPlaceholder = (sub: string) =>
    sub.toLowerCase().startsWith("choose") || sub.toLowerCase() === "self";
  // Specific weapon type slugs — route to Weapons, not Tools.
  const isWeaponSlug = (sub: string) =>
    /sword|axe|bow|crossbow|dagger|dart|sling|blowgun|staff|spear|club|mace|hammer|flail|lance|pike|rapier|scimitar|sickle|whip|maul|halberd|glaive|javelin|trident|handaxe|net|morningstar/.test(sub);
  const armor: string[] = [];
  const weapons: string[] = [];
  const tools: string[] = [];
  const languages: string[] = [];
  for (const m of allMods) {
    const sub = str(m.subType);
    if (isProfPlaceholder(sub)) continue;
    if (m.type === "proficiency") {
      if (armorProfMap[sub]) armor.push(armorProfMap[sub]);
      else if (weaponProfMap[sub]) weapons.push(weaponProfMap[sub]);
      else if (sub.includes("saving-throws") || sub.includes("-skill") ||
               SKILLS.some(([n]) => n.toLowerCase().replace(/ /g, "-").replace(/'/g, "") === sub)) {
        // skill/save prof — handled elsewhere
      } else if (!sub.includes("-score") && sub.length > 0 &&
                 !statKeys.some(k => sub.startsWith(k))) {
        if (isWeaponSlug(sub)) {
          weapons.push(capitalize(sub.replace(/-/g, " ")));
        } else {
          tools.push(capitalize(sub.replace(/-/g, " ")));
        }
      }
    } else if (m.type === "language") {
      languages.push(capitalize(sub.replace(/-/g, " ")));
    }
  }
  return { armor, weapons, tools, languages };
}

// ── Public API ──────────────────────────────────────────────────────────────
export function computeStats(core: CoreStats): Stats {
  const { char, allMods, statMods, statTotals, profBonus } = core;
  const skillBonuses = computeSkillBonuses(allMods, statMods, profBonus);
  return {
    abilityScoreDisplay: buildAbilityScoreDisplay(statTotals, statMods),
    savingThrows: buildSavingThrows(allMods, statMods, profBonus),
    skillLines: buildSkillLines(skillBonuses),
    senses: computeSenses(char, allMods, skillBonuses),
    proficiencies: computeProficiencies(allMods),
  };
}

export function formatStatsBlock(s: Stats): string[] {
  const { proficiencies: p } = s;
  return [
    `ABILITY SCORES`,
    `  ${s.abilityScoreDisplay.join("  ")}`,
    ``,
    `SAVING THROWS`,
    `  ${s.savingThrows.join("   ")}`,
    `  (* proficient)`,
    ``,
    `SKILLS`,
    ...s.skillLines,
    `  (* proficient, ** expertise)`,
    ``,
    `SENSES`,
    `  Passive Perception: ${s.senses.passivePerception}   Passive Investigation: ${s.senses.passiveInvestigation}   Passive Insight: ${s.senses.passiveInsight}`,
    ...(s.senses.special.length ? [`  ${s.senses.special.join(", ")}`] : []),
    ``,
    `PROFICIENCIES & TRAINING`,
    `  Armor: ${p.armor.length ? [...new Set(p.armor)].join(", ") : "None"}`,
    `  Weapons: ${p.weapons.length ? [...new Set(p.weapons)].join(", ") : "None"}`,
    `  Tools: ${p.tools.length ? [...new Set(p.tools)].join(", ") : "None"}`,
    `  Languages: ${p.languages.length ? [...new Set(p.languages)].join(", ") : "None"}`,
    ``,
  ];
}
