import { describe, it, expect, vi, beforeEach } from "vitest";

const { SENTINEL_INDEX, SNAPSHOT } = vi.hoisted(() => ({
  SENTINEL_INDEX: { sources: new Map(), categories: new Map() },
  SNAPSHOT: { generation: 7, state: { kind: "authenticated", cookies: [] }, signal: new AbortController().signal },
}));

// The session file is never read: getParty's one snapshot is this sentinel.
vi.mock("../src/session-fetch.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/session-fetch.js")>()),
  captureSession: vi.fn(() => SNAPSHOT),
}));

vi.mock("../src/game-config.js", () => ({
  getSourceIndex: vi.fn(async () => SENTINEL_INDEX),
}));

vi.mock("../src/tools/campaign.js", () => ({
  getCampaignData: vi.fn(),
}));

vi.mock("../src/tools/character.js", async (importActual) => ({
  loadCharacterForParse: vi.fn(),
  parseCharacterData: vi.fn(),
  withNotice: (await importActual<typeof import("../src/tools/character.js")>()).withNotice,
}));

import { getParty } from "../src/tools/party.js";
import { getCampaignData, type CampaignInfo } from "../src/tools/campaign.js";
import { wrapUntrusted } from "../src/utils.js";
import { loadCharacterForParse, parseCharacterData } from "../src/tools/character.js";
import { getSourceIndex } from "../src/game-config.js";
import { SessionChangedError } from "../src/session-fetch.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function campaignData(name: string, ids: number[]): CampaignInfo {
  return ({
    id: 1, name, dungeonMaster: "dm", playerCount: ids.length,
    characters: ids.map(id => ({
      character: `Character${id}`,
      player: `player${id}`,
      url: `https://www.dndbeyond.com/characters/${id}`,
    })),
  });
}

function charRaw(name: string): Record<string, unknown> {
  return { data: { name } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getParty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path — returns all character summaries with campaign header", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Curse of Strahd", [101, 102, 103]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => ({ raw: charRaw(`Hero${id}`) }));
    vi.mocked(parseCharacterData).mockImplementation(raw => {
      const name = (raw as Record<string, unknown>).data
        ? ((raw as Record<string, { name: string }>).data).name
        : "Unknown";
      return `Summary: ${name}`;
    });

    const result = await getParty("999");

    // The campaign name is the DM's text: the PARTY line is delimited as untrusted.
    expect(result.startsWith(`${wrapUntrusted("PARTY: Curse of Strahd")}\n`)).toBe(true);
    expect(result).toContain("Summary: Hero101");
    expect(result).toContain("Summary: Hero102");
    expect(result).toContain("Summary: Hero103");
    expect(vi.mocked(loadCharacterForParse)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(parseCharacterData)).toHaveBeenCalledWith(expect.anything(), "summary", SENTINEL_INDEX);
  });

  it("empty campaign — returns descriptive message without fetching characters", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Empty Campaign", []));

    const result = await getParty("999");

    // The campaign name is the DM's text, so the reply is delimited as untrusted.
    expect(result).toBe(wrapUntrusted('Campaign "Empty Campaign" has no active characters.'));
    expect(vi.mocked(loadCharacterForParse)).not.toHaveBeenCalled();
  });

  it("partial failure — failed character shows error line, others succeed", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Storm King's Thunder", [201, 202, 203]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => {
      if (id === "202") throw new Error("character is private");
      return { raw: charRaw(`Hero${id}`) };
    });
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    const result = await getParty("999");

    expect(result).toContain("Summary");
    // The error text can quote D&D Beyond's response, so the line is delimited as untrusted.
    expect(result).toContain(wrapUntrusted("[Could not load character 202: character is private]"));
    // The two successful characters still returned
    expect(vi.mocked(parseCharacterData)).toHaveBeenCalledTimes(2);
  });

  it("large party (6) — processes all characters across two batches of 3", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Waterdeep", [1, 2, 3, 4, 5, 6]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => ({ raw: charRaw(`Hero${id}`) }));
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    const result = await getParty("999");

    expect(vi.mocked(loadCharacterForParse)).toHaveBeenCalledTimes(6);
    // Result should contain 6 summaries
    expect(result.split("Summary")).toHaveLength(7); // 6 "Summary" occurrences → 7 parts
    expect(result).toContain("PARTY: Waterdeep");
  });

  it("passes one session snapshot to every member, across batches", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Waterdeep", [1, 2, 3, 4]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => ({ raw: charRaw(`Hero${id}`) }));
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    await getParty("999");

    const snapshots = vi.mocked(loadCharacterForParse).mock.calls.map(c => c[1]);
    expect(snapshots).toHaveLength(4);
    for (const s of snapshots) expect(s).toBe(SNAPSHOT);
  });

  it("a session change in a later batch fails the whole call, not one member's line", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Waterdeep", [1, 2, 3, 4, 5, 6]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => {
      if (id === "5") throw new SessionChangedError();
      return { raw: charRaw(`Hero${id}`) };
    });
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    await expect(getParty("999")).rejects.toBeInstanceOf(SessionChangedError);
  });

  it("a member that isn't found (404) is still a per-member line", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Waterdeep", [1, 2]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => {
      if (id === "2") throw new Error("Character 2 was not found (404) — check the ID, or that the character still exists.");
      return { raw: charRaw(`Hero${id}`) };
    });
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    const result = await getParty("999");
    expect(result).toContain("Summary");
    expect(result).toContain(wrapUntrusted("[Could not load character 2: Character 2 was not found (404) — check the ID, or that the character still exists.]"));
  });

  it("fetches the source index once per party", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Phandelver", [401, 402, 403, 404]));
    vi.mocked(loadCharacterForParse).mockImplementation(async id => ({ raw: charRaw(`Hero${id}`) }));
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    await getParty("999");

    expect(vi.mocked(parseCharacterData)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(getSourceIndex)).toHaveBeenCalledTimes(1);
  });

  it("shows a fetch notice above that character's summary", async () => {
    vi.mocked(getCampaignData).mockResolvedValue(campaignData("Rime", [301]));
    vi.mocked(loadCharacterForParse).mockResolvedValue({ raw: charRaw("Hero301"), notice: "Loaded without signing in." });
    vi.mocked(parseCharacterData).mockImplementation(() => "Summary");

    const result = await getParty("999");

    expect(result).toContain("⚠️ Loaded without signing in.\n\nSummary");
  });
});
