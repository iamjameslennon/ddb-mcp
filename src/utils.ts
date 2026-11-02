/**
 * Wrap free-text content that originates from D&D Beyond users — scraped page
 * text, book chapters, character notes/backstories, homebrew descriptions —
 * in delimiters so MCP clients can tell it apart from trusted tool output.
 * Any delimiter tag embedded in the content itself is neutralized so the
 * content can't close the block early and pose as trusted output.
 */
export function wrapUntrusted(text: string): string {
  // Also catches near-miss variants (inner whitespace, attributes) that a model
  // could still read as our delimiter.
  const sanitized = text.replace(/<\s*\/?\s*untrusted_dndbeyond_content\b[^<>]*>/gi, "[removed-delimiter]");
  return `<untrusted_dndbeyond_content>\n${sanitized}\n</untrusted_dndbeyond_content>`;
}

/**
 * Delimit an entry D&D Beyond marked homebrew. Official entries (`isHomebrew`
 * not strictly true) stay plain. Shared homebrew collections are other
 * people's text — the same rule as homebrew monsters.
 */
export function wrapIfHomebrew(text: string, isHomebrew: boolean | null | undefined): string {
  return isHomebrew === true ? wrapUntrusted(text) : text;
}

const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi;

/** A numeric reference's character, or null when it is not a valid scalar value (zero, past U+10FFFF, or a lone surrogate). */
function codePointChar(ref: string): string | null {
  const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/** Decode entities in one pass (an entity's output is never decoded again). Unknown or invalid references stay as written. */
function decodeOnePass(s: string, named: Record<string, string>): string {
  return s.replace(ENTITY_RE, (match, ref: string) => {
    if (ref[0] !== "#") return named[ref.toLowerCase()] ?? match;
    return codePointChar(ref) ?? match;
  });
}

const STRIP_ENTITIES: Record<string, string> = {
  nbsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  amp: "&", lt: "<", gt: ">", quot: '"', ndash: "–", mdash: "—",
};

/**
 * Strip HTML tags and decode common HTML entities from a string, in one pass.
 */
export function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return decodeOnePass(s.replace(/<[^>]*>/g, ""), STRIP_ENTITIES)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", times: "×", minus: "−",
};

/**
 * Decode HTML entities in one pass (so "&amp;#160;" stays "&#160;"). DDB stat
 * blocks use numeric entities such as "&#160;" — non-breaking spaces become
 * plain spaces. Unknown named entities are left as-is.
 */
function decodeEntities(s: string): string {
  return decodeOnePass(s, NAMED_ENTITIES).replace(/\u00a0/g, " ");
}

/** Like stripHtml, but decodes named/hex entities and keeps line breaks and list bullets (monster stat blocks, source titles). */
export function stripHtmlRich(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    // [^<>] rather than [^>]: a scan stops at the next "<", so a run of
    // unterminated "<" in homebrew text stays linear instead of quadratic.
    .replace(/<[^<>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** How many monster names the encounter rater and the treasure generator look up at once. */
export const MONSTER_LOOKUP_CONCURRENCY = 4;

/**
 * `items.map(fn)` with at most `limit` calls in flight at once. Results keep
 * the input order. A rejection rejects the whole call, as Promise.all does.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
