# Handover: `ddb_get_party` Tool

## Purpose

Give DMs (and players) a single-call party overview without having to call
`ddb_get_character` once per player. Returns a compact summary of every
character in a campaign — HP, AC, initiative, passive scores, ability scores,
and skills — formatted for quick scanning at the table.

---

## New tool: `ddb_get_party`

### Registration

Add to `src/index.ts` alongside the other campaign tools, following the same
registration pattern as `ddb_get_campaign`.

**Tool name:** `ddb_get_party`

**Description:** `"Fetch a compact summary of every character in a campaign. Returns HP, AC, initiative, passive scores, ability scores, and skills for the whole party in one call."`

**Input schema:**
```typescript
{
  campaign_id: z.string().min(1).describe(
    "The D&D Beyond campaign ID (found in the campaign URL)"
  )
}
```

---

## Implementation

### New file: `src/tools/party.ts`

```typescript
import { getCampaign } from "./campaign.js";
import { getCharacter, parseCharacterData } from "./character.js";

export async function getParty(campaignId: string): Promise<string> {
  // 1. Get campaign to retrieve character IDs
  const campaignJson = await getCampaign(campaignId);
  const campaign = JSON.parse(campaignJson) as {
    name: string;
    characters: Array<{ character: string; player: string; url: string }>;
  };

  if (!campaign.characters || campaign.characters.length === 0) {
    return `Campaign "${campaign.name}" has no active characters.`;
  }

  // 2. Extract character IDs from the character URLs
  //    URL format: https://www.dndbeyond.com/characters/{id}
  const characterIds = campaign.characters
    .map(c => c.url.match(/\/characters\/(\d+)/)?.[1])
    .filter((id): id is string => id != null);

  // 3. Fetch all characters concurrently (max 3 at a time to avoid hammering the API)
  const results: string[] = [];
  for (let i = 0; i < characterIds.length; i += 3) {
    const batch = characterIds.slice(i, i + 3);
    const fetched = await Promise.all(
      batch.map(async id => {
        try {
          const json = await getCharacter(id);
          const raw = JSON.parse(json) as Record<string, unknown>;
          return parseCharacterData(raw, "summary");
        } catch (err) {
          return `[Could not load character ${id}: ${err instanceof Error ? err.message : String(err)}]`;
        }
      })
    );
    results.push(...fetched);
  }

  // 4. Join with clear separators
  const separator = "\n" + "─".repeat(40) + "\n";
  return `PARTY: ${campaign.name}\n${separator}${results.join(separator)}`;
}
```

### Key design decisions

- **Reuses `parseCharacterData(raw, "summary")`** — no new parsing logic needed.
  The `"summary"` section already outputs vitals + ability scores + all 18 skills,
  which is exactly what a DM needs at the table.

- **Batched concurrency (3 at a time)** — avoids hammering the character service
  for large parties. A party of 6 becomes 2 batches of 3.

- **Per-character error isolation** — if one character fails to load (e.g. private
  or deleted), the rest of the party still returns. The failed character shows a
  clear error line instead of crashing the whole call.

- **Reuses character cache** — `getCharacter()` already has a 60 s TTL cache, so
  calling `ddb_get_party` after `ddb_get_character` for the same characters adds
  no extra API calls.

- **No new cache needed** — party data is just an aggregation of character data.
  The character-level cache is sufficient.

---

## `getCampaign` dependency note

`getCampaign` currently looks up the campaign from the list returned by
`user-campaigns` and then fetches characters from
`active-short-characters/{campaignId}`. The character URLs in that response
are what `getParty` uses to extract IDs. Verify the URL format is
`https://www.dndbeyond.com/characters/{id}` in the live response — if the
format differs, adjust the regex in step 2 accordingly.

---

## Tests

Add to `tests/party.test.ts`:

1. **Happy path** — mock `getCampaign` returning 3 characters, mock `getCharacter`
   returning valid character JSON for each. Assert output contains all 3 character
   names and the campaign name header.

2. **Empty campaign** — mock `getCampaign` returning `characters: []`. Assert
   returns the "no active characters" message.

3. **Partial failure** — mock one character fetch throwing, others succeeding.
   Assert the error line appears for the failed character and the rest return
   correctly.

4. **Large party (6+)** — verify batching logic processes all characters across
   multiple batches.

---

## README update

Add `ddb_get_party` to the Campaign Tools table in `README.md`:

| Tool | Description |
|------|-------------|
| `ddb_get_party` | Fetch a compact summary of every character in a campaign — HP, AC, initiative, passive scores, ability scores, and skills for the whole party in one call. |

Also add an example prompt to the "For Dungeon Masters" section:

```
Show me the full party stats for campaign 6709239
```
