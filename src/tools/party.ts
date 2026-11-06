import { getCampaignData } from "./campaign.js";
import { fetchCharacter, parseCharacterData, withNotice } from "./character.js";
import { getSourceIndex } from "../game-config.js";
import { wrapUntrusted } from "../utils.js";

export async function getParty(campaignId: string): Promise<string> {
  // Start the source index with the campaign fetch (getSourceIndex never
  // rejects); a failed campaign fetch, or a campaign with no characters,
  // withdraws it, as nothing will read it.
  const indexCtl = new AbortController();
  const indexPromise = getSourceIndex({ signal: indexCtl.signal });

  // 1. Get campaign to retrieve character IDs
  const campaign = await getCampaignData(campaignId).catch((err: unknown) => { indexCtl.abort(); throw err; });

  // The campaign name is the DM's text (F-2026-10-20); each sheet wraps its own names.
  if (!campaign.characters || campaign.characters.length === 0) {
    indexCtl.abort();
    return wrapUntrusted(`Campaign "${campaign.name}" has no active characters.`);
  }

  // 2. Extract character IDs from URLs (format: /characters/{id})
  const characterIds = campaign.characters
    .map(c => c.url.match(/\/characters\/(\d+)/)?.[1])
    .filter((id): id is string => id != null);

  // 3. Fetch all characters concurrently, max 3 at a time, classifying each
  //    against one source index (getSourceIndex never rejects)
  const index = await indexPromise;
  const results: string[] = [];
  for (let i = 0; i < characterIds.length; i += 3) {
    const batch = characterIds.slice(i, i + 3);
    const fetched = await Promise.all(
      batch.map(async id => {
        try {
          const { json, notice } = await fetchCharacter(id);
          const raw = JSON.parse(json) as Record<string, unknown>;
          return withNotice(parseCharacterData(raw, "summary", index), notice);
        } catch (err) {
          // The message can quote D&D Beyond's response (a JSON.parse error
          // includes part of the body), so the line is delimited as untrusted.
          return wrapUntrusted(`[Could not load character ${id}: ${err instanceof Error ? err.message : String(err)}]`);
        }
      })
    );
    results.push(...fetched);
  }

  // 4. Join with clear separators
  const separator = "\n" + "─".repeat(40) + "\n";
  return `${wrapUntrusted(`PARTY: ${campaign.name}`)}\n${separator}${results.join(separator)}`;
}
