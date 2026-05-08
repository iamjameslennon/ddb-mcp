import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before importing the module under test so vitest hoists them.

vi.mock("../src/session-fetch.js", () => ({
  hasValidSession: vi.fn(() => true),
  getCobaltToken: vi.fn(async () => ({ token: "tok", userId: "99" })),
  sessionFetch: vi.fn(),
}));

import { listMyCampaigns, getCampaign, invalidateCampaignCache } from "../src/tools/campaign.js";
import { sessionFetch, getCobaltToken } from "../src/session-fetch.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockResponse(body: unknown, status = 200, contentType = "application/json"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => h === "content-type" ? contentType : null },
    json: async () => body,
  } as unknown as Response;
}

const CAMPAIGNS_RESPONSE = {
  status: "success",
  data: [
    { id: 1001, name: "Curse of Strahd", dmUsername: "dungeonMaster99", dmId: 99, playerCount: 4, dateCreated: "2024-01-01" },
    { id: 1002, name: "Lost Mine of Phandelver", dmUsername: "anotherDM", dmId: 55, playerCount: 3, dateCreated: "2024-02-01" },
  ],
};

const CHARACTERS_RESPONSE = [
  { id: 123, name: "Arabella", userName: "player1", characterStatus: 1 },
  { id: 456, name: "Torbin",   userName: "player2", characterStatus: 1 },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("listMyCampaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCampaignCache();
    vi.mocked(getCobaltToken).mockResolvedValue({ token: "tok", userId: "99" });
  });

  it("returns a list of campaigns with correct role assignment", async () => {
    vi.mocked(sessionFetch).mockResolvedValue(mockResponse(CAMPAIGNS_RESPONSE));

    const result = JSON.parse(await listMyCampaigns());

    expect(result).toHaveLength(2);
    // userId "99" matches dmId 99 on the first campaign → DM
    expect(result[0]).toMatchObject({ name: "Curse of Strahd", id: "1001", role: "DM" });
    // userId "99" does not match dmId 55 on the second campaign → Player
    expect(result[1]).toMatchObject({ name: "Lost Mine of Phandelver", id: "1002", role: "Player" });
  });

  it("always sends Bearer token (single request, no cookie-only attempt)", async () => {
    vi.mocked(sessionFetch).mockResolvedValue(mockResponse(CAMPAIGNS_RESPONSE));

    await listMyCampaigns();
    expect(vi.mocked(sessionFetch)).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(sessionFetch).mock.calls[0];
    expect((callArgs[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("throws a descriptive error when the API returns HTML (session expired)", async () => {
    vi.mocked(sessionFetch).mockResolvedValue(mockResponse("<html>login</html>", 200, "text/html"));
    await expect(listMyCampaigns()).rejects.toThrow("non-JSON response");
  });

  it("returns a descriptive message when user has no campaigns", async () => {
    vi.mocked(sessionFetch).mockResolvedValue(mockResponse({ status: "success", data: [] }));
    const result = await listMyCampaigns();
    expect(result).toBe("You are not currently a member of any campaigns on D&D Beyond.");
  });
});

describe("getCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCampaignCache();
    vi.mocked(getCobaltToken).mockResolvedValue({ token: "tok", userId: "99" });
  });

  it("returns campaign details with characters", async () => {
    vi.mocked(sessionFetch)
      .mockResolvedValueOnce(mockResponse(CAMPAIGNS_RESPONSE))    // active-campaigns
      .mockResolvedValueOnce(mockResponse(CHARACTERS_RESPONSE));  // active-short-characters

    const result = JSON.parse(await getCampaign("1001"));

    expect(result.name).toBe("Curse of Strahd");
    expect(result.dungeonMaster).toBe("dungeonMaster99");
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0]).toMatchObject({
      character: "Arabella",
      player: "player1",
      url: "https://www.dndbeyond.com/characters/123",
    });
    expect(result.characters[1]).toMatchObject({
      character: "Torbin",
      player: "player2",
      url: "https://www.dndbeyond.com/characters/456",
    });
  });

  it("throws a descriptive error when campaign ID is not in the active list", async () => {
    vi.mocked(sessionFetch).mockResolvedValue(mockResponse(CAMPAIGNS_RESPONSE));

    await expect(getCampaign("9999")).rejects.toThrow("Campaign 9999 not found");
  });

  it("handles a campaign with no characters", async () => {
    vi.mocked(sessionFetch)
      .mockResolvedValueOnce(mockResponse(CAMPAIGNS_RESPONSE))
      .mockResolvedValueOnce(mockResponse([]));

    const result = JSON.parse(await getCampaign("1001"));
    expect(result.characters).toEqual([]);
  });
});
