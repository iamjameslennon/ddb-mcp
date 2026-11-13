/**
 * Feat prerequisite matching, shared by the D&D Beyond and Open5e feat searches.
 * Prerequisites are free text ("Level 4+; Strength or Dexterity 13+", "Str or Dex 13+"),
 * so a plain substring test misses "strength 13" against both.
 */

const ABILITIES: Record<string, string> = {
  str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma",
};

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(t => ABILITIES[t] ?? t);
}

/**
 * True when every word of the query is among the prerequisite's words (any order,
 * ability abbreviations expanded), or when the prerequisite contains the query as a
 * substring (partial words such as "spell"). An empty query matches; an empty or null
 * prerequisite never matches a non-empty query.
 */
export function prerequisiteMatches(prerequisite: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const p = (prerequisite ?? "").toLowerCase();
  if (!p) return false;
  if (p.includes(q)) return true;
  const have = new Set(tokens(p));
  const want = tokens(q);
  return want.length > 0 && want.every(t => have.has(t));
}
