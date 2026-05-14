import { sessionFetch, getCobaltToken, hasValidSession } from "../session-fetch.js";
import { TtlCache } from "../cache.js";

const CAMPAIGN_API = "https://www.dndbeyond.com/api/campaign/stt";

// 5 min TTL — campaign membership doesn't change often within a session
const campaignCache = new TtlCache<string>(5 * 60_000, 20);

export function invalidateCampaignCache(): void {
  campaignCache.clear();
}

interface CampaignSummary {
  id: number;
  name: string;
  dmUsername: string;
  dmId?: number;
  playerCount: number;
  dateCreated: string;
}

// Always send the cobalt Bearer token — the API returns a 200 HTML redirect
// (not a 401) when auth is missing, so cookies-only detection is unreliable.
async function campaignFetch(url: string): Promise<Response> {
  const { token } = await getCobaltToken();
  return sessionFetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

function assertJson(resp: Response): void {
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Campaign API returned non-JSON response — session may have expired. Run ddb_login.");
  }
}

async function fetchActiveCampaigns(): Promise<CampaignSummary[]> {
  const cacheKey = "user-campaigns";
  const cached = campaignCache.get(cacheKey);
  if (cached) return JSON.parse(cached) as CampaignSummary[];

  const resp = await campaignFetch(`${CAMPAIGN_API}/user-campaigns`);
  if (!resp.ok) throw new Error(`Campaign API returned ${resp.status}`);
  assertJson(resp);
  const json = await resp.json() as { status: string; data: CampaignSummary[] };
  const campaigns = json.data ?? [];
  campaignCache.set(cacheKey, JSON.stringify(campaigns));
  return campaigns;
}

export async function listMyCampaigns(): Promise<string> {
  if (!hasValidSession()) throw new Error("Not logged in. Please run ddb_login first.");

  const [campaigns, { userId }] = await Promise.all([fetchActiveCampaigns(), getCobaltToken()]);

  const mapped = campaigns.map(c => ({
    name: c.name,
    id: String(c.id),
    role: (c.dmId != null ? String(c.dmId) === userId : c.dmUsername === userId) ? "DM" : "Player",
  }));

  if (mapped.length === 0) {
    return "You are not currently a member of any campaigns on D&D Beyond.";
  }
  return JSON.stringify(mapped);
}

export async function getCampaign(campaignId: string): Promise<string> {
  if (!hasValidSession()) throw new Error("Not logged in. Please run ddb_login first.");

  const campaigns = await fetchActiveCampaigns();
  const campaign = campaigns.find(c => String(c.id) === campaignId);
  if (!campaign) {
    throw new Error(
      `Campaign ${campaignId} not found in your active campaigns. ` +
      `Use ddb_list_campaigns to see your campaigns.`
    );
  }

  const resp = await campaignFetch(`${CAMPAIGN_API}/active-short-characters/${encodeURIComponent(campaignId)}`);
  if (!resp.ok) throw new Error(`Characters API returned ${resp.status}`);
  assertJson(resp);
  type CharEntry = { id: number; name: string; userName: string; characterStatus: string };
  const json = await resp.json() as Array<CharEntry> | { data: Array<CharEntry> };
  const chars = Array.isArray(json) ? json : (json as { data: Array<CharEntry> }).data ?? [];

  const characters = chars.map(c => ({
    character: c.name,
    player: c.userName,
    url: `https://www.dndbeyond.com/characters/${c.id}`,
  }));

  return JSON.stringify({
    id: campaign.id,
    name: campaign.name,
    dungeonMaster: campaign.dmUsername,
    playerCount: campaign.playerCount,
    characters,
  });
}
