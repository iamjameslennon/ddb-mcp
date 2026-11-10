import { normalizeName } from "./edition.js";

/**
 * A monster or item name as Open5e folds it: hyphens become spaces, straight and curly
 * apostrophes are dropped, then normalizeName. "Will-o'-Wisp" and "will o wisp" fold alike.
 */
export function nameFold(name: string): string {
  return normalizeName(name.replace(/-/g, " ").replace(/['‘’]/g, ""));
}

const ENDS_IN_WORD_CHAR = /[\p{L}\p{N}]$/u;

/**
 * True when the folded query occurs in the folded name at a word start: at index 0, or right
 * after a character that is not a letter or digit. Any occurrence counts, so "Sorcerer Orc"
 * matches "orc" at its second word while "Hobgoblin" does not match "goblin". An empty
 * folded query never matches.
 */
export function matchesAtWordStart(name: string, query: string): boolean {
  const needle = nameFold(query);
  if (needle === "") return false;
  const haystack = nameFold(name);
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    if (i === 0 || !ENDS_IN_WORD_CHAR.test(haystack.slice(0, i))) return true;
  }
  return false;
}
