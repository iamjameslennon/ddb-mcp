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

import { arr, capitalize, hasRemarkableAthlete, isBonusMod, isExpertiseMod, isHalfProficiencyMod, isLanguageMod, isProficiencyMod, isSenseMod, isSetBaseMod, isSetMod, num, obj, signed, statKeys, statNames, str } from "./helpers.js";
import type { CharData, ClassEntry, CoreStats, Mod } from "./types.js";

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
    allMods.filter(isProficiencyMod)
      .filter(m => m.subType.includes("saving-throws"))
      .map(m => m.subType)
  );
  // Global save bonus — `bonus subType:"saving-throws"` applies to every save.
  // Sources: Stone of Good Luck (Luckstone), Cloak of Protection, Paladin's
  // Aura of Protection (via grantedModifiers on the aura feature), etc.
  const globalSaveBonus = allMods
    .filter(m => isBonusMod(m) && m.subType === "saving-throws")
    .reduce((s, m) => s + num(m.value ?? m.fixedValue), 0);
  return statKeys.map((key, i) => {
    const isProficient = saveProfSubTypes.has(`${key}-saving-throws`);
    const total = statMods[i] + (isProficient ? profBonus : 0) + globalSaveBonus;
    return `${statNames[i]} ${signed(total)}${isProficient ? "*" : ""}`;
  });
}

// ── Skills (returns bonuses + display lines together — both needed downstream) ──
interface SkillBonus { bonus: number; isProficient: boolean; isExpertise: boolean }

// STR/DEX/CON stat indices — the abilities that Remarkable Athlete covers.
const RA_STAT_INDICES = new Set([0, 1, 2]);

function computeSkillBonuses(
  allMods: readonly Mod[],
  statMods: readonly number[],
  profBonus: number,
  classes: ReadonlyArray<ClassEntry>,
): SkillBonus[] {
  const skillProfSubTypes = new Set(
    allMods.filter(isProficiencyMod).map(m => m.subType)
  );
  const skillExpertiseSubTypes = new Set(
    allMods.filter(isExpertiseMod).map(m => m.subType)
  );
  // half-proficiency (e.g. Bard's Jack of All Trades applies to all ability
  // checks; floor(prof/2)).
  const hasJackOfAllTrades = allMods.some(
    m => isHalfProficiencyMod(m) && m.subType === "ability-checks"
  );
  const skillHalfProfSubTypes = new Set(
    allMods.filter(isHalfProficiencyMod)
      .filter(m => m.subType !== "ability-checks")
      .map(m => m.subType)
  );
  // Remarkable Athlete (Champion 7+) adds ceil(prof/2) to non-proficient
  // STR/DEX/CON ability checks. DDB does NOT emit a half-proficiency
  // modifier for RA, so we must detect it by class + level.
  const ra = hasRemarkableAthlete(classes);
  // Global ability-check bonus — `bonus subType:"ability-checks"` applies to
  // every skill (and therefore every passive). Sources: Stone of Good Luck
  // (Luckstone), Headband of Intellect (no — that's a set on INT score), etc.
  const globalAbilityCheckBonus = allMods
    .filter(m => isBonusMod(m) && m.subType === "ability-checks")
    .reduce((s, m) => s + num(m.value ?? m.fixedValue), 0);
  return SKILLS.map(([skillName, statIdx]) => {
    const slug = skillName.toLowerCase().replace(/ /g, "-").replace(/'/g, "");
    const isProficient = skillProfSubTypes.has(slug);
    const isExpertise = skillExpertiseSubTypes.has(slug);
    const isJoatHalf = !isProficient && (skillHalfProfSubTypes.has(slug) || hasJackOfAllTrades);
    const isRaHalf = !isProficient && ra && RA_STAT_INDICES.has(statIdx);
    let bonus = statMods[statIdx];
    if (isExpertise) bonus += profBonus * 2;
    else if (isProficient) bonus += profBonus;
    // RA takes precedence over JoAT on STR/DEX/CON because it rounds up
    // (a strict superset of JoAT's floor at odd proficiency bonuses).
    else if (isRaHalf) bonus += Math.ceil(profBonus / 2);
    else if (isJoatHalf) bonus += Math.floor(profBonus / 2);
    // Flat bonus modifiers on the skill subType (e.g. Divine Order: Scholar adds WIS to Arcana/Religion).
    // When value/fixedValue are null, statId identifies which ability modifier to add instead.
    const flatBonus = allMods
      .filter(m => isBonusMod(m) && m.subType === slug)
      .reduce((s, m) => {
        if (m.value != null) return s + num(m.value);
        if (m.fixedValue != null) return s + num(m.fixedValue);
        const sid = num(m.statId);
        return s + (sid > 0 ? statMods[sid - 1] : 0);
      }, 0);
    bonus += flatBonus + globalAbilityCheckBonus;
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
// Senses use a two-pass model so Gloom Stalker's Umbral Sight extends race
// darkvision rather than being clamped to the higher of the two:
//
//   Pass 1 (base-establishing): record `set`/`set-base` modifiers,
//     `customSenses`, and racial-trait sense notes. These define the
//     character's baseline for each sense.
//   Pass 2 (`type:"sense"` modifiers): for each, decide:
//     • no baseline yet → this sense becomes the base (2024-style: race
//       emits `type:"sense"` directly without a paired set-base)
//     • baseline from a DIFFERENT component → additive (Umbral Sight pattern:
//       race has set-base 60 from one component, class emits sense 30 from
//       another → 60 + 30 = 90)
//     • baseline from the SAME component → take the max (Umbral Sight in
//       isolation emits both set-base 30 and sense 30 from the same
//       component as dual encodings — must not double-count to 60)
function computeSenses(char: CharData, allMods: readonly Mod[], skillBonuses: readonly SkillBonus[]): Senses {
  const perceptionIdx = SKILLS.findIndex(([n]) => n === "Perception");
  const investigationIdx = SKILLS.findIndex(([n]) => n === "Investigation");
  const insightIdx = SKILLS.findIndex(([n]) => n === "Insight");
  const passivePerception = 10 + skillBonuses[perceptionIdx].bonus;
  const passiveInvestigation = 10 + skillBonuses[investigationIdx].bonus;
  const passiveInsight = 10 + skillBonuses[insightIdx].bonus;

  const senseBase = new Map<string, { value: number; componentId: number }>();
  const senseAdditions = new Map<string, number>();
  const recordBase = (name: string, val: number, cid: number) => {
    if (val <= 0) return;
    const existing = senseBase.get(name);
    if (!existing || val > existing.value) senseBase.set(name, { value: val, componentId: cid });
  };

  // Pass 1: collect baseline-establishing sources.
  for (const m of allMods) {
    if ((isSetMod(m) || isSetBaseMod(m)) && SENSE_SLUGS.has(m.subType)) {
      recordBase(capitalize(m.subType), num(m.value), num(m.componentId));
    }
  }
  for (const cs of arr<Record<string, unknown>>(char.customSenses)) {
    const name = SENSE_ID_NAMES[num(cs.senseId)];
    if (name) recordBase(name, num(cs.value), 0);
  }
  for (const trait of arr<Record<string, unknown>>(obj(char.race).racialTraits)) {
    for (const sense of arr<Record<string, unknown>>(obj(trait.definition).senses)) {
      const name = SENSE_ID_NAMES[num(sense.senseId)];
      const match = str(sense.notes).match(/\d+/);
      if (name && match) recordBase(name, parseInt(match[0], 10), 0);
    }
  }

  // Pass 2: process `type:"sense"` modifiers — additive if from a different
  // component than the current baseline (Umbral Sight extending race darkvision).
  for (const m of allMods) {
    if (!isSenseMod(m)) continue;
    const name = capitalize(m.subType);
    const val = num(m.value);
    if (val <= 0) continue;
    const cid = num(m.componentId);
    const baseEntry = senseBase.get(name);
    if (!baseEntry) {
      recordBase(name, val, cid);
    } else if (baseEntry.componentId !== cid) {
      senseAdditions.set(name, (senseAdditions.get(name) ?? 0) + val);
    } else if (val > baseEntry.value) {
      // Same component — dual encoding of one effective value; keep the higher.
      senseBase.set(name, { value: val, componentId: cid });
    }
  }

  const special: string[] = [];
  for (const [name, { value }] of senseBase) {
    special.push(`${name} ${value + (senseAdditions.get(name) ?? 0)} ft.`);
  }
  return { passivePerception, passiveInvestigation, passiveInsight, special };
}

// ── Proficiencies ───────────────────────────────────────────────────────────
// customProficiencies type IDs (DDB's encoding):
//   1 = Skill, 2 = Tool, 3 = Language
// Languages added by the player directly (not via a race/background/feat
// modifier) live here. Confirmed by inspecting Astarion (107164636) whose
// "Orc" language is stored as {name:"Orc", type:3, proficiencyLevel:3}.
const CUSTOM_PROF_TYPE_LANGUAGE = 3;

// characterValues entries with typeId 35 are language grants that point
// into the rule-data language table via `valueId` (a stringified integer).
// DDB's React app resolves the ID → name client-side from a /rule-data
// fetch. Confirmed via Playwright network trace against the three "missing
// languages" characters in BUG #7. We mirror every officially-sourced
// language (those with `rpgSourceId != null` in /character/v5/rule-data)
// here so the parser doesn't need a network call. Creature-language IDs
// (Worg, Sahuagin, Giant Eagle, etc — `rpgSourceId: null`) are excluded
// since they aren't typically player-selectable. Unknown IDs fall back
// to a placeholder so homebrew never silently disappears.
//
// Refresh procedure: re-run `scripts/dump-sourced-languages.mts` and
// paste the output here, keeping the ID-sorted order.
const CHAR_VALUE_TYPE_LANGUAGE = 35;
const LANGUAGE_NAMES_BY_ID: Record<number, string> = {
  // PHB (rpgSourceId 198) — core 2014 + 2024 standard languages
  1: "Common", 2: "Dwarvish", 3: "Elvish", 4: "Giant", 5: "Gnomish",
  6: "Goblin", 7: "Halfling", 8: "Orc", 9: "Abyssal", 10: "Celestial",
  11: "Draconic", 12: "Deep Speech", 13: "Infernal", 14: "Primordial",
  15: "Sylvan", 16: "Undercommon",
  // Telepathy (unsourced in rule-data but commonly granted by monster races / mind flayers)
  18: "Telepathy",
  // PHB elementals + Druidic + Thieves' Cant
  19: "Aquan", 20: "Auran", 21: "Ignan", 22: "Terran", 23: "Druidic",
  46: "Thieves' Cant",
  // Journeys through the Radiant Citadel (rpgSourceId 87)
  74: "Citlanés", 75: "Djaynaian", 76: "Godstongue", 77: "Halri",
  78: "Maynah", 79: "N'warian", 80: "Quirapu", 81: "Sensan",
  82: "Shankhi", 83: "Tletlahtolli", 84: "Xingyu", 85: "Zabaani",
  // Spelljammer: Adventures in Space (rpgSourceId 90)
  86: "Dohwar", 87: "Hadozee", 88: "Aartuk",
  // Dragonlance: Shadow of the Dragon Queen (rpgSourceId 95)
  89: "Abanasinian", 90: "Ergot", 91: "Istarian", 92: "Kenderspeak",
  93: "Kharolian", 94: "Khur", 95: "Kothian", 96: "Nerakese",
  97: "Nordmaarian", 98: "Ogre", 99: "Solamnic",
  // Planescape: Adventures in the Multiverse (rpgSourceId 114)
  101: "Demodand",
  // Humblewood (rpgSourceId 133)
  102: "Birdfolk", 103: "Cervan", 105: "Hedge", 106: "Jerbeen",
  107: "Mapach", 108: "Vulpin",
  // Tome of Beasts / Kobold Press (rpgSourceId 139)
  110: "Derro", 111: "Eonic", 113: "Lemurfolk", 114: "Loxodan",
  115: "Millitaur", 117: "Tosculi", 118: "Trollkin", 120: "Void Speech",
  // Tales of the Valiant (rpgSourceId 142)
  121: "Angulotl", 122: "Kuran'zoi",
  // Tome of Beasts 2 / Midgard (rpgSourceId 151)
  109: "Darakhul", 112: "Erina", 116: "Ravenfolk", 119: "Umbral",
  124: "Huginn's Speech", 125: "Northern Tongue",
  // Ankeshel (rpgSourceId 152)
  126: "Ankeshelian",
  // Birdfolk feather speech (rpgSourceId 39)
  104: "Feather Speech",
  // Old Gods of Appalachia / Drakkenheim (rpgSourceId 137)
  123: "Gibberling",
  // 2024 additions (rpgSourceId 198)
  127: "Common Sign Language",
  // Adventures in Middle-earth (rpgSourceId 154)
  129: "Black Speech", 130: "Dalish", 131: "Khuzdul", 132: "Orkish",
  133: "Sindarin", 134: "Warg-speech", 135: "Westron", 136: "Dunlendish",
  // Setting expansion (rpgSourceId 156) — secondary Thieves' Cant entry
  137: "Thieves' Cant",
  // Quests from the Infinite Staircase / Critical Role / etc (rpgSourceId 158, 160, 162)
  138: "Capran", 139: "Eluran", 140: "Tilia",
  141: "Swallybog",
  142: "Dara", 143: "Howler", 144: "Naku Naku", 145: "Torum",
  // Pathfinder for Dummies / Paizo-style (rpgSourceId 202)
  146: "Aklo", 147: "Caligni", 148: "Daemonic", 149: "Necril",
  150: "Varisian",
  // Forgotten Realms regional (rpgSourceId 205)
  151: "Aglarondan", 152: "Alzhedo", 153: "Chessentan", 154: "Chondathan",
  155: "Damaran", 156: "Iluskan", 157: "Lantanese", 158: "Midani",
  159: "Mulhorandi", 160: "Rashemi", 161: "Reghedjic", 162: "Sespech",
  163: "Turmic", 164: "Untheric",
  // Misc later additions (rpgSourceId 224, 225, 230)
  165: "Skin Cant", 166: "Communication Spores", 167: "Archosauric",
};

function computeProficiencies(char: CharData, allMods: readonly Mod[]): Proficiencies {
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
    if (isProficiencyMod(m)) {
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
    } else if (isLanguageMod(m)) {
      languages.push(capitalize(sub.replace(/-/g, " ")));
    }
  }
  // Player-added languages via DDB's "Custom Proficiency" UI live here.
  for (const cp of arr<Record<string, unknown>>(char.customProficiencies)) {
    if (num(cp.type) !== CUSTOM_PROF_TYPE_LANGUAGE) continue;
    const name = str(cp.name).trim();
    if (name) languages.push(name);
  }
  // Language grants stored in char.characterValues (typeId 35). valueId is
  // a stringified integer pointing into the rule-data language table.
  for (const cv of arr<Record<string, unknown>>(char.characterValues)) {
    if (num(cv.typeId) !== CHAR_VALUE_TYPE_LANGUAGE) continue;
    if (num(cv.value) <= 0) continue;
    const id = parseInt(str(cv.valueId), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    languages.push(LANGUAGE_NAMES_BY_ID[id] ?? `Language #${id}`);
  }
  return { armor, weapons, tools, languages };
}

// ── Public API ──────────────────────────────────────────────────────────────
export function computeStats(core: CoreStats): Stats {
  const { char, allMods, statMods, statTotals, profBonus, classes } = core;
  const skillBonuses = computeSkillBonuses(allMods, statMods, profBonus, classes);
  return {
    abilityScoreDisplay: buildAbilityScoreDisplay(statTotals, statMods),
    savingThrows: buildSavingThrows(allMods, statMods, profBonus),
    skillLines: buildSkillLines(skillBonuses),
    senses: computeSenses(char, allMods, skillBonuses),
    proficiencies: computeProficiencies(char, allMods),
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
