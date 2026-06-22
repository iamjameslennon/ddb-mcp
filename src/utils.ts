/**
 * Wrap free-text content that originates from D&D Beyond users — scraped page
 * text, book chapters, character notes/backstories, homebrew descriptions —
 * in delimiters so MCP clients can tell it apart from trusted tool output.
 * Any delimiter tag embedded in the content itself is neutralized so the
 * content can't close the block early and pose as trusted output.
 */
export function wrapUntrusted(text: string): string {
  const sanitized = text.replace(/<\/?untrusted_dndbeyond_content>/gi, "[removed-delimiter]");
  return `<untrusted_dndbeyond_content>\n${sanitized}\n</untrusted_dndbeyond_content>`;
}

/**
 * Strip HTML tags and decode common HTML entities from a string.
 */
export function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1))))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
