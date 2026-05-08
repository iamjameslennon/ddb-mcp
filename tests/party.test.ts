import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/tools/campaign.js", () => ({
  getCampaign: vi.fn(),
}));

vi.mock("../src/tools/character.js", () => ({
  getCharacter: vi.fn(),
  parseCharacterData: vi.fn(),
}));

import { getParty } from "../src/tools/party.js";
import { getCampaign } from "../src/tools/campaign.js";
import { getCharacter, parseCharacterData } from "../src/tools/character.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function campaignJson(name: string, ids: number[]): string {
  return JSON.stringify({
    name,
    characters: ids.map(id => ({
      character: `Character${id}`,
      player: `player${id}`,
      url: `https://www.dndbeyond.com/characters/${id}`,
    })),
  });
}

function charJson(name: string): string {
  return JSON.stringify({ data: { name } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getParty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path — returns all character summaries with campaign header", async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaignJson("Curse of Strahd", [101, 102, 103]));
    vi.mocked(getCharacter).mockImplementation(async id => charJson(`Hero${id}`));
    vi.mocked(parseCharacterData).mockImplementation(raw => {
      const name = (raw as Record<string, unknown>).data
        ? ((raw as Record<string, { name: string }>).data).name
        : "Unknown";
      return `Summary: ${name}`;
    });

    const result = await getParty("999");

    expect(result).toContain("PARTY: Curse of Strahd");
    expect(result).toContain("Summary: Hero101");
    expect(result).toContain("Summary: Hero102");
    expect(result).toContain("Summary: Hero103");
    expect(vi.mocked(getCharacter)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(parseCharacterData)).toHaveBeenCalledWith(expect.anything(), "summary");
  });

  it("empty campaign — returns descriptive message without fetching characters", async () => {
    vi.mocked(getCampaign).mockResolvedValue(
      JSON.stringify({ name: "Empty Campaign", characters: [] })
    );

    const result = await getParty("999");

    expect(result).toBe('Campaign "Empty Campaign" has no active characters.');
    expect(vi.mocked(getCharacter)).not.toHaveBeenCalled();
  });

  it("partial failure — failed character shows error line, others succeed", async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaignJson("Storm King's Thunder", [201, 202, 203]));
    vi.mocked(getCharacter).mockImplementation(async id => {
      if (id === "202") throw new Error("character is private");
      return charJson(`Hero${id}`);
    });
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    const result = await getParty("999");

    expect(result).toContain("Summary");
    expect(result).toContain("[Could not load character 202: character is private]");
    // The two successful characters still returned
    expect(vi.mocked(parseCharacterData)).toHaveBeenCalledTimes(2);
  });

  it("large party (6) — processes all characters across two batches of 3", async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaignJson("Waterdeep", [1, 2, 3, 4, 5, 6]));
    vi.mocked(getCharacter).mockImplementation(async id => charJson(`Hero${id}`));
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    const result = await getParty("999");

    expect(vi.mocked(getCharacter)).toHaveBeenCalledTimes(6);
    // Result should contain 6 summaries
    expect(result.split("Summary")).toHaveLength(7); // 6 "Summary" occurrences → 7 parts
    expect(result).toContain("PARTY: Waterdeep");
  });
});
