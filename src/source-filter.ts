/**
 * source-filter.ts — resolving a user-supplied book ("source") to source ids and
 * filtering entries by it. Pure: shared by every tool that takes `source`.
 */

import { stripHtmlRich as stripHtml } from "./utils.js";
import { entrySourceIds } from "./edition.js";
export { entrySourceIds };
import type { EditionMarkers, IndexedSource, SourceIndex } from "./edition.js";

/** Loosely normalize a source string for comparison — case- and punctuation-insensitive. */
export function normalizeSourceQuery(s: string | null | undefined): string {
  return stripHtml(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The book's URL slug ("sources/dnd/mm-2024" → "mm-2024") — the form users and labels quote. */
export function sourceSlug(s: { sourceURL: string | null }): string {
  return (s.sourceURL ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * Resolve a user-supplied source string (e.g. "mm-2024", "MM-2024", "Curse of
 * Strahd") to source IDs. Tries the URL slug first (most unambiguous — e.g.
 * "mm-2024" vs "mm-2014"), then the short name, then the full title, stopping
 * at the first tier that matches. Returns every ID in that tier — slugs are not
 * unique (four sources share "basic-rules-2014"), and the monster service
 * accepts several `sources` at once. Never hardcoded — always resolved through
 * the source index, which merges the live config over the generated snapshot,
 * so resolution survives a game-config outage.
 */
export function resolveSourceIds(index: SourceIndex, query: string): number[] {
  const norm = normalizeSourceQuery(query);
  if (!norm) return [];
  const sources = [...index.sources];
  const tiers: Array<(s: IndexedSource) => string> = [
    s => normalizeSourceQuery(sourceSlug(s)),
    s => normalizeSourceQuery(s.name),
    s => normalizeSourceQuery(s.description),
  ];
  for (const key of tiers) {
    const ids = sources.filter(([, s]) => key(s) === norm).map(([id]) => id);
    if (ids.length) return ids;
  }
  return [];
}

/** Human-readable label for a source ID, with the slug to pass back as `source`. */
export function sourceLabel(index: SourceIndex, sourceId: number): string {
  const s = index.sources.get(sourceId);
  if (!s) return `source ${sourceId}`;
  const title = stripHtml(s.description) || stripHtml(s.name);
  const slug = sourceSlug(s);
  return slug ? `${title} [${slug}]` : title;
}

/** Sources whose slug, short name, or title loosely contains (or is contained by) the query. */
export function suggestSources(index: SourceIndex, query: string): string[] {
  const norm = normalizeSourceQuery(query);
  if (norm.length < 2) return [];
  return [...index.sources]
    .filter(([, s]) => [sourceSlug(s), s.name, s.description]
      .map(normalizeSourceQuery)
      .some(v => v.length >= 2 && (v.includes(norm) || norm.includes(v))))
    .slice(0, 8)
    .map(([id]) => sourceLabel(index, id));
}

export function unknownSourceError(index: SourceIndex, source: string, hint?: string): string {
  const suggestions = suggestSources(index, source);
  return `Unknown source "${source}". ` + (suggestions.length
    ? `Did you mean: ${suggestions.join(", ")}?`
    : hint ?? "Pass a book's short code as shown in brackets in ddb_search_monsters results (e.g. mm-2024, cos).");
}

/** Hint for tools whose results don't show a book's short code in brackets. */
export const GENERIC_SOURCE_HINT = "Pass a book's short code or title, e.g. phb-2024, xgte or \"Player's Handbook\".";

export interface ResolvedSource { query: string; ids: number[]; book: string }

/** A user-supplied source resolved to every matching id, with the lowest-id book's plain title. */
export function resolveSource(index: SourceIndex, query: string): ResolvedSource | null {
  const ids = resolveSourceIds(index, query);
  if (!ids.length) return null;
  return { query, ids, book: index.sources.get(Math.min(...ids))!.book };
}

/** Whether any of the entry's sources is one of `ids` (a reprint counts). */
export function inSources(entry: EditionMarkers, ids: readonly number[]): boolean {
  return entrySourceIds(entry).some(id => ids.includes(id));
}

/** Open5e has no concept of sources — flag that the filter wasn't honoured when one was requested. */
export function withSourceCaveat(o5Result: string, source: string | undefined): string {
  if (!source) return o5Result;
  return `${o5Result}\n\n*Note: source filtering is not available via the Open5e SRD fallback — "${source}" was requested but could not be honoured.*`;
}
