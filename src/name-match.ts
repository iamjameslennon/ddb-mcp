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

/**
 * Levenshtein edit distance between two strings. Used by character-name
 * fuzzy resolution (character.ts) and definition-query matching
 * (definition.ts).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

const LOOSE_STOPWORDS = new Set(["of", "the", "a", "an"]);

/**
 * Lookup-style name match, tolerant of typos, word order and apostrophes. True when the
 * folded query is a substring of the folded name, or when the query has at least one word of
 * 3+ letters (ignoring of/the/a/an) and every such word is within edit distance 1 (words of
 * up to 4 letters) or 2 of some word of the name. A query with no such word ("ki", "of the")
 * matches by substring alone, so the typo rule cannot match vacuously. An empty folded query
 * never matches.
 */
export function matchesLooseName(name: string, query: string): boolean {
  const q = nameFold(query);
  if (q === "") return false;
  const n = nameFold(name);
  if (n.includes(q)) return true;
  const qWords = q.split(/\s+/).filter(w => w.length >= 3 && !LOOSE_STOPWORDS.has(w));
  if (qWords.length === 0) return false;
  const nWords = n.split(/\s+/).filter(Boolean);
  return qWords.every(w => {
    const max = w.length <= 4 ? 1 : 2;
    return nWords.some(nw => levenshteinDistance(w, nw) <= max);
  });
}
