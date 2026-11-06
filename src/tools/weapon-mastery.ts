/**
 * The 2024 weapon mastery properties (PHB 2024). D&D Beyond lists a weapon's
 * mastery among its `properties`, in both editions, so a 2014 reader needs
 * them told apart from the 2014 properties.
 *
 * Used by the character sheet's weapon rows (`character/weapons.ts`), which
 * print a mastery only when the character has mastered that weapon, and by
 * 2014 equipment replies, which drop it.
 */
export const MASTERY_NAMES: ReadonlySet<string> = new Set([
  "Cleave", "Graze", "Nick", "Push", "Sap", "Slow", "Topple", "Vex",
]);
