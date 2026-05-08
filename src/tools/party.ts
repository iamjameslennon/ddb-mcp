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

  // 2. Extract character IDs from URLs (format: /characters/{id})
  const characterIds = campaign.characters
    .map(c => c.url.match(/\/characters\/(\d+)/)?.[1])
    .filter((id): id is string => id != null);

  // 3. Fetch all characters concurrently, max 3 at a time
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
