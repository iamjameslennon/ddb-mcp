// Shared work-budget policy for ddb_roll_treasure.
//
// Enforced at two independent entry points:
//   1. The MCP Zod schema in src/index.ts — rejects malformed tool calls
//      before they ever reach generateTreasure().
//   2. The runtime guard here, called directly by generateTreasure() in
//      src/tools/treasure.ts — direct callers of generateTreasure() bypass
//      the Zod schema entirely, so this check is not optional.
//
// This module intentionally has no dependency on src/tools/treasure.ts (or
// anything that imports it): it is a pure policy/validation layer, testable
// in isolation from the treasure-generation implementation.

/** Maximum number of distinct monster entries accepted in one request. */
export const MAX_TREASURE_ENTRIES = 20;

/** Maximum monster count for a single entry. Applies to both individual and hoard treasure. */
export const MAX_MONSTER_COUNT = 100;

/** Maximum total number of individual-treasure rolls performed for one request (sum of all entry counts). Hoard treasure always makes exactly one roll, so this budget does not apply to it. */
export const MAX_INDIVIDUAL_ROLLS = 100;

/** Maximum accepted length, in characters, of a single monster name. */
export const MAX_MONSTER_NAME_CHARS = 200;

/** Maximum length, in characters, of the formatted treasure output string. */
export const MAX_TREASURE_OUTPUT_CHARS = 32_000;

/**
 * The structural subset of ddb_roll_treasure's input this validator needs.
 * Kept independent of src/tools/treasure.ts's TreasureInput type so this
 * module never has to import the treasure implementation.
 */
export interface TreasureBudgetRequest {
  monsters?: Array<{ name: string; count: number }>;
  treasureType: "individual" | "hoard";
}

/**
 * Early work-budget validation for ddb_roll_treasure.
 *
 * Returns an `Error: ...`-prefixed message (matching generateTreasure()'s
 * existing return convention) naming the violated limit and how to reduce
 * the request, or `null` if the request is within budget. Never clamps or
 * truncates a request — an over-budget request is always rejected outright.
 *
 * Runs BEFORE any monster-name deduplication or lookup: the budget is
 * computed from the raw, as-submitted entries, so repeated or unresolved
 * names can't be used to dodge it (deduplicating "Goblin" ×60 and "Goblin"
 * ×60 down to one lookup would not change that 120 individual rolls were
 * requested).
 */
export function validateTreasureBudget(request: TreasureBudgetRequest): string | null {
  const { monsters, treasureType } = request;

  if (!monsters || monsters.length === 0) {
    // No monster list to budget: either a direct-CR request (always exactly
    // one roll) or an empty list, which generateTreasure()'s pre-existing
    // exclusivity check rejects before this validator ever runs.
    return null;
  }

  // Check array length before iterating — an oversized entries array is
  // rejected without inspecting a single element.
  if (monsters.length > MAX_TREASURE_ENTRIES) {
    return `Error: too many monster entries (${monsters.length}). Requests are limited to ${MAX_TREASURE_ENTRIES} monster entries — combine duplicate names into one entry with a higher count, or split the request across multiple calls.`;
  }

  let aggregateCount = 0;
  for (const entry of monsters) {
    const { name, count } = entry;
    const displayed = name.length > MAX_MONSTER_NAME_CHARS ? `${name.slice(0, MAX_MONSTER_NAME_CHARS)}…` : name;

    if (!Number.isSafeInteger(count) || count <= 0) {
      return `Error: invalid count (${count}) for "${displayed}". Each monster count must be a positive whole number.`;
    }

    if (count > MAX_MONSTER_COUNT) {
      return `Error: count ${count} for "${displayed}" exceeds the per-entry limit of ${MAX_MONSTER_COUNT}. Reduce this entry's count to ${MAX_MONSTER_COUNT} or fewer. This limit applies to both individual and hoard treasure.`;
    }

    if (name.length > MAX_MONSTER_NAME_CHARS) {
      return `Error: monster name is ${name.length} characters, exceeding the ${MAX_MONSTER_NAME_CHARS}-character limit. Shorten the name.`;
    }

    aggregateCount += count;
  }

  // Aggregate roll budget applies only to individual treasure — a hoard
  // always makes exactly one roll, based on the highest CR among the
  // supplied monsters, regardless of how many monsters or instances are
  // listed.
  if (treasureType === "individual" && aggregateCount > MAX_INDIVIDUAL_ROLLS) {
    return `Error: individual treasure would require ${aggregateCount} rolls (sum of all entry counts), exceeding the limit of ${MAX_INDIVIDUAL_ROLLS} rolls per request. Reduce the total monster count to ${MAX_INDIVIDUAL_ROLLS} or fewer, or request hoard treasure instead.`;
  }

  return null;
}
