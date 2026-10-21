/**
 * conditions.ts — Condition rules text in both editions, vendored (no API required).
 *
 * 2014: the SRD 5.1 table, as ddb_get_condition has always served it.
 * 2024: transcribed from the System Reference Document 5.2.1 (Rules Glossary,
 *       pages 176–191). Source: https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
 *       (SHA-256 8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87).
 *       Each entry's opening sentence is the description and each bolded lead-in
 *       paragraph is an effect. Open5e's v2 API has no condition entries for SRD 5.2,
 *       so these stay vendored; scripts/check-conditions.mts compares them with
 *       D&D Beyond's rule-data.
 *
 * This work includes material from the System Reference Document 5.2 by Wizards of
 * the Coast LLC, licensed under CC-BY-4.0.
 */

import { rulesLine, type RulesEdition } from "../edition.js";

interface Condition {
  name: string;
  description: string;
  effects: string[];
}

const CONDITIONS_2014: Record<string, Condition> = {
  blinded: {
    name: "Blinded",
    description: "A blinded creature can't see and automatically fails any ability check that requires sight.",
    effects: [
      "Attack rolls against the creature have advantage.",
      "The creature's attack rolls have disadvantage.",
    ],
  },
  charmed: {
    name: "Charmed",
    description: "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects.",
    effects: [
      "The charmer has advantage on any ability check to interact socially with the creature.",
    ],
  },
  deafened: {
    name: "Deafened",
    description: "A deafened creature can't hear and automatically fails any ability check that requires hearing.",
    effects: [],
  },
  exhaustion: {
    name: "Exhaustion",
    description: "Exhaustion is measured in six levels. An effect can give a creature one or more levels of exhaustion.",
    effects: [
      "Level 1: Disadvantage on ability checks",
      "Level 2: Speed halved",
      "Level 3: Disadvantage on attack rolls and saving throws",
      "Level 4: Hit point maximum halved",
      "Level 5: Speed reduced to 0",
      "Level 6: Death",
    ],
  },
  frightened: {
    name: "Frightened",
    description: "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.",
    effects: [
      "The creature can't willingly move closer to the source of its fear.",
    ],
  },
  grappled: {
    name: "Grappled",
    description: "A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.",
    effects: [
      "The condition ends if the grappler is incapacitated.",
      "The condition ends if an effect removes the grappled creature from the reach of the grappler.",
    ],
  },
  incapacitated: {
    name: "Incapacitated",
    description: "An incapacitated creature can't take actions or reactions.",
    effects: [],
  },
  invisible: {
    name: "Invisible",
    description: "An invisible creature is impossible to see without the aid of magic or a special sense.",
    effects: [
      "Attack rolls against the creature have disadvantage.",
      "The creature's attack rolls have advantage.",
      "The creature can always try to hide.",
    ],
  },
  paralyzed: {
    name: "Paralyzed",
    description: "A paralyzed creature is incapacitated and can't move or speak.",
    effects: [
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
      "Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
    ],
  },
  petrified: {
    name: "Petrified",
    description: "A petrified creature is transformed into a solid inanimate substance. It ceases aging.",
    effects: [
      "The creature is incapacitated, can't move or speak, and is unaware of its surroundings.",
      "Attack rolls against the creature have advantage.",
      "The creature automatically fails Strength and Dexterity saving throws.",
      "The creature has resistance to all damage.",
      "The creature is immune to poison and disease.",
    ],
  },
  poisoned: {
    name: "Poisoned",
    description: "A poisoned creature has disadvantage on attack rolls and ability checks.",
    effects: [],
  },
  prone: {
    name: "Prone",
    description: "A prone creature's only movement option is to crawl, unless it stands up and thereby ends the condition.",
    effects: [
      "The creature has disadvantage on attack rolls.",
      "Attack rolls against the creature have advantage if the attacker is within 5 feet; otherwise disadvantage.",
    ],
  },
  restrained: {
    name: "Restrained",
    description: "A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed.",
    effects: [
      "Attack rolls against the creature have advantage.",
      "The creature's attack rolls have disadvantage.",
      "The creature has disadvantage on Dexterity saving throws.",
    ],
  },
  stunned: {
    name: "Stunned",
    description: "A stunned creature is incapacitated, can't move, and can speak only falteringly.",
    effects: [
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
    ],
  },
  unconscious: {
    name: "Unconscious",
    description: "An unconscious creature is incapacitated, can't move or speak, and is unaware of its surroundings.",
    effects: [
      "The creature drops whatever it's holding and falls prone.",
      "The creature automatically fails Strength and Dexterity saving throws.",
      "Attack rolls against the creature have advantage.",
      "Any attack that hits the creature is a critical hit if the attacker is within 5 feet.",
    ],
  },
};

const CONDITIONS_2024: Record<string, Condition> = {
  blinded: {
    name: "Blinded",
    description: "While you have the Blinded condition, you experience the following effects.",
    effects: [
      "Can't See. You can't see and automatically fail any ability check that requires sight.",
      "Attacks Affected. Attack rolls against you have Advantage, and your attack rolls have Disadvantage.",
    ],
  },
  charmed: {
    name: "Charmed",
    description: "While you have the Charmed condition, you experience the following effects.",
    effects: [
      "Can't Harm the Charmer. You can't attack the charmer or target the charmer with damaging abilities or magical effects.",
      "Social Advantage. The charmer has Advantage on any ability check to interact with you socially.",
    ],
  },
  deafened: {
    name: "Deafened",
    description: "While you have the Deafened condition, you experience the following effect.",
    effects: [
      "Can't Hear. You can't hear and automatically fail any ability check that requires hearing.",
    ],
  },
  exhaustion: {
    name: "Exhaustion",
    description: "While you have the Exhaustion condition, you experience the following effects.",
    effects: [
      "Exhaustion Levels. This condition is cumulative. Each time you receive it, you gain 1 Exhaustion level. You die if your Exhaustion level is 6.",
      "D20 Tests Affected. When you make a D20 Test, the roll is reduced by 2 times your Exhaustion level.",
      "Speed Reduced. Your Speed is reduced by a number of feet equal to 5 times your Exhaustion level.",
      "Removing Exhaustion Levels. Finishing a Long Rest removes 1 of your Exhaustion levels. When your Exhaustion level reaches 0, the condition ends.",
    ],
  },
  frightened: {
    name: "Frightened",
    description: "While you have the Frightened condition, you experience the following effects.",
    effects: [
      "Ability Checks and Attacks Affected. You have Disadvantage on ability checks and attack rolls while the source of fear is within line of sight.",
      "Can't Approach. You can't willingly move closer to the source of fear.",
    ],
  },
  grappled: {
    name: "Grappled",
    description: "While you have the Grappled condition, you experience the following effects.",
    effects: [
      "Speed 0. Your Speed is 0 and can't increase.",
      "Attacks Affected. You have Disadvantage on attack rolls against any target other than the grappler.",
      "Movable. The grappler can drag or carry you when it moves, but every foot of movement costs it 1 extra foot unless you are Tiny or two or more sizes smaller than it.",
    ],
  },
  incapacitated: {
    name: "Incapacitated",
    description: "While you have the Incapacitated condition, you experience the following effects.",
    effects: [
      "Inactive. You can't take any action, Bonus Action, or Reaction.",
      "No Concentration. Your Concentration is broken.",
      "Speechless. You can't speak.",
      "Surprised. If you're Incapacitated when you roll Initiative, you have Disadvantage on the roll.",
    ],
  },
  invisible: {
    name: "Invisible",
    description: "While you have the Invisible condition, you experience the following effects.",
    effects: [
      "Surprise. If you're Invisible when you roll Initiative, you have Advantage on the roll.",
      "Concealed. You aren't affected by any effect that requires its target to be seen unless the effect's creator can somehow see you. Any equipment you are wearing or carrying is also concealed.",
      "Attacks Affected. Attack rolls against you have Disadvantage, and your attack rolls have Advantage. If a creature can somehow see you, you don't gain this benefit against that creature.",
    ],
  },
  paralyzed: {
    name: "Paralyzed",
    description: "While you have the Paralyzed condition, you experience the following effects.",
    effects: [
      "Incapacitated. You have the Incapacitated condition.",
      "Speed 0. Your Speed is 0 and can't increase.",
      "Saving Throws Affected. You automatically fail Strength and Dexterity saving throws.",
      "Attacks Affected. Attack rolls against you have Advantage.",
      "Automatic Critical Hits. Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you.",
    ],
  },
  petrified: {
    name: "Petrified",
    description: "While you have the Petrified condition, you experience the following effects.",
    effects: [
      "Turned to Inanimate Substance. You are transformed, along with any nonmagical objects you are wearing and carrying, into a solid inanimate substance (usually stone). Your weight increases by a factor of ten, and you cease aging.",
      "Incapacitated. You have the Incapacitated condition.",
      "Speed 0. Your Speed is 0 and can't increase.",
      "Attacks Affected. Attack rolls against you have Advantage.",
      "Saving Throws Affected. You automatically fail Strength and Dexterity saving throws.",
      "Resist Damage. You have Resistance to all damage.",
      "Poison Immunity. You have Immunity to the Poisoned condition.",
    ],
  },
  poisoned: {
    name: "Poisoned",
    description: "While you have the Poisoned condition, you experience the following effect.",
    effects: [
      "Ability Checks and Attacks Affected. You have Disadvantage on attack rolls and ability checks.",
    ],
  },
  prone: {
    name: "Prone",
    description: "While you have the Prone condition, you experience the following effects.",
    effects: [
      "Restricted Movement. Your only movement options are to crawl or to spend an amount of movement equal to half your Speed (round down) to right yourself and thereby end the condition. If your Speed is 0, you can't right yourself.",
      "Attacks Affected. You have Disadvantage on attack rolls. An attack roll against you has Advantage if the attacker is within 5 feet of you. Otherwise, that attack roll has Disadvantage.",
    ],
  },
  restrained: {
    name: "Restrained",
    description: "While you have the Restrained condition, you experience the following effects.",
    effects: [
      "Speed 0. Your Speed is 0 and can't increase.",
      "Attacks Affected. Attack rolls against you have Advantage, and your attack rolls have Disadvantage.",
      "Saving Throws Affected. You have Disadvantage on Dexterity saving throws.",
    ],
  },
  stunned: {
    name: "Stunned",
    description: "While you have the Stunned condition, you experience the following effects.",
    effects: [
      "Incapacitated. You have the Incapacitated condition.",
      "Saving Throws Affected. You automatically fail Strength and Dexterity saving throws.",
      "Attacks Affected. Attack rolls against you have Advantage.",
    ],
  },
  unconscious: {
    name: "Unconscious",
    description: "While you have the Unconscious condition, you experience the following effects.",
    effects: [
      "Inert. You have the Incapacitated and Prone conditions, and you drop whatever you're holding. When this condition ends, you remain Prone.",
      "Speed 0. Your Speed is 0 and can't increase.",
      "Attacks Affected. Attack rolls against you have Advantage.",
      "Saving Throws Affected. You automatically fail Strength and Dexterity saving throws.",
      "Automatic Critical Hits. Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you.",
      "Unaware. You're unaware of your surroundings.",
    ],
  },
};

const TABLES: Record<RulesEdition, Record<string, Condition>> = {
  "2024": CONDITIONS_2024,
  "2014": CONDITIONS_2014,
};

export const CONDITION_NAMES: readonly string[] = Object.values(CONDITIONS_2024).map(c => c.name);

export function getCondition(conditionName: string, rulesEdition: RulesEdition = "2024"): string {
  const conditions = TABLES[rulesEdition];
  const key = conditionName.toLowerCase().trim();

  // Exact key match, then partial name match
  const condition = conditions[key]
    ?? Object.values(conditions).find(c => c.name.toLowerCase().includes(key));

  if (!condition) {
    const available = Object.values(conditions).map(c => c.name).join(", ");
    return `Condition "${conditionName}" not found.\n\nAvailable conditions: ${available}`;
  }

  const lines = [
    `**${condition.name}**`,
    rulesLine({ ruleset: rulesEdition, book: null }, { open5e: "primary" }),
    "",
    condition.description,
  ];
  if (condition.effects.length > 0) {
    lines.push("");
    for (const effect of condition.effects) {
      lines.push(`• ${effect}`);
    }
  }
  return lines.join("\n");
}
