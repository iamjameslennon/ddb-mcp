/**
 * The 2024 weapon mastery properties (PHB 2024). D&D Beyond lists a weapon's
 * mastery among its `properties`, in both editions, so a 2014 reader needs
 * them told apart from the 2014 properties.
 *
 * Used by the character sheet's weapon rows (`character/weapons.ts`), which
 * print a mastery only when the character has mastered that weapon, and by
 * 2014 equipment replies, which drop it (ddb_character_lookup drops only the
 * description's mastery paragraph, as it prints no property list).
 */
export const MASTERY_NAMES: ReadonlySet<string> = new Set([
  "Cleave", "Graze", "Nick", "Push", "Sap", "Slow", "Topple", "Vex",
]);

/** Starts the paragraph D&D Beyond appends to a weapon's description for its 2024 mastery. */
const MASTERY_PARAGRAPH = /(?:^|\n)[ \t]*This weapon has the following mastery property/;

/**
 * A stripped description without its 2024 mastery paragraph (and the mastery
 * text after it), for a weapon shown as 2014: ddb_get_equipment and
 * ddb_character_lookup.
 */
export function withoutMasteryParagraph(description: string): string {
  const cut = description.search(MASTERY_PARAGRAPH);
  return cut >= 0 ? description.slice(0, cut).trimEnd() : description;
}
