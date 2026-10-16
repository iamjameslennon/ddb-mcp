/**
 * 2014 → 2024 name changes, for content D&D Beyond reissued under a new name
 * (the spec's unverified example: the 2014 Basic Rules' "Acid Arrow" and the
 * 2024 "Melf's Acid Arrow"). `twinName()` in edition.ts maps each 2014 name to
 * its 2024 name so both land in one twin group. The 2024 side is canonical.
 *
 * Only pairs verified by reading both descriptions belong here: same thing,
 * same level/rarity/CR, text clearly a revision. Each pair carries its evidence
 * in a comment. Propose candidates with `npx tsx scripts/dump-edition-renames.mts`
 * (needs ddb_login). tests/edition.test.ts rejects chains, duplicates and
 * self-maps.
 */
export const EDITION_RENAMES: ReadonlyArray<readonly [name2014: string, name2024: string]> = [
];
