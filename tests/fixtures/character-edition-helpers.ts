/**
 * Helpers shared by the character rules-edition tests (phase 5): the snapshot
 * source index, source-list and inventory builders, and fixture variants.
 */
import { buildSourceIndex, type SourceIndex } from "../../src/edition.js";
import { SNAPSHOT_CATEGORIES, SNAPSHOT_SOURCES } from "../../src/source-snapshot.js";
import { FIGHTER_5 } from "./character-fixtures.js";

export const INDEX: SourceIndex = buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES);

/** A definition's `sources` list citing the given source ids. */
export const S = (...ids: number[]): Array<{ sourceId: number }> => ids.map(sourceId => ({ sourceId }));

/** A deep copy of a fixture with `edit` applied to its `.data`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function variant(base: Record<string, unknown>, edit: (d: any) => void): Record<string, unknown> {
  const copy = structuredClone(base);
  edit(copy.data);
  return copy;
}

/** One inventory entry (quantity 1). */
export function item(
  id: number,
  name: string,
  filterType: string,
  extra: Record<string, unknown> = {},
  equipped = false,
): Record<string, unknown> {
  return { equipped, quantity: 1, definition: { id, name, filterType, ...extra } };
}

/** FIGHTER_5 with a 2014 background and a 2014 feat. */
export function bgAndFeat(): Record<string, unknown> {
  return variant(FIGHTER_5, d => {
    d.background.definition.sources = S(2);
    d.feats.push({ definition: { name: "Sharpshooter", snippet: "Long shots.", categories: [], sources: S(2) } });
  });
}

/** Any inline edition tag. */
export const TAG = /\[(?:2024|2014|third-party|homebrew|playtest|edition not stated)\]/;

/**
 * A sheet with the character-name wrap undone: the header always delimits the
 * name as untrusted (tests/character-untrusted-header.test.ts pins that), so
 * tests asserting that nothing else on a sheet is wrapped, or reading header
 * lines by position, compare against the sheet without it.
 */
export function withoutNameWrap(out: string): string {
  const stripped = out.replace(/(═+\n)<untrusted_dndbeyond_content>\n( {2}[^\n]*)\n<\/untrusted_dndbeyond_content>\n/, "$1$2\n");
  // Fail closed: a sheet whose name is no longer wrapped must not pass as "unwrapped".
  if (stripped === out) throw new Error("withoutNameWrap: the sheet has no wrapped character name");
  return stripped;
}
