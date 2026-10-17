/**
 * Shared character-service mock for spell-compendium tests. Pure helpers: the
 * `vi.hoisted` fs mock and `beforeEach` stay in each test file.
 */

export const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
export const GAME_DATA = "https://character-service.dndbeyond.com/character/v5/game-data";

export function makeJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  } as unknown as Response;
}

/** Deterministic djb2 hash, so one name from several class lists is one definition id. */
function djb2(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function spell(name: string, level: number, opts: {
  id?: number; description?: string; concentration?: boolean;
  isLegacy?: boolean; sources?: number[]; school?: string; ritual?: boolean;
} = {}) {
  return {
    definition: {
      id: opts.id ?? djb2(name),
      name,
      level,
      school: opts.school ?? "Evocation",
      description: opts.description ?? `${name} description`,
      concentration: opts.concentration ?? false,
      ritual: opts.ritual ?? false,
      ...(opts.isLegacy !== undefined ? { isLegacy: opts.isLegacy } : {}),
      ...(opts.sources ? { sources: opts.sources.map(sourceId => ({ sourceId })) } : {}),
    },
  };
}

export type Endpoint = "spells" | "always-known-spells";
export type Lists = Partial<Record<Endpoint, Record<string, unknown[]>>>;

/**
 * Model character-service: `lists[endpoint][classId]` is that request's spell
 * array (missing → empty list). `status[endpoint:classId]` overrides the HTTP
 * status; `delay[endpoint:classId]` delays that response by N ms. The game
 * config answers `{}`, so the code falls back to the snapshot source index.
 */
export function serviceMock(lists: Lists, opts: { status?: Record<string, number>; delay?: Record<string, number> } = {}) {
  return async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(GAME_DATA)) {
      const u = new URL(url);
      const endpoint = u.pathname.split("/").pop() as Endpoint;
      const classId = u.searchParams.get("classId") ?? "";
      const key = `${endpoint}:${classId}`;
      const wait = opts.delay?.[key];
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const status = opts.status?.[key] ?? 200;
      if (status !== 200) return jsonResponse({}, status);
      return jsonResponse({ data: lists[endpoint]?.[classId] ?? [] });
    }
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  };
}
