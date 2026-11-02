import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { open5eSearchHeader, searchFooter, searchHeader } from "../src/edition.js";
import { o5FixtureFetch } from "./fixtures/open5e-v2.js";

/**
 * search-site-open5e.test.ts — ddb_search_site "all" end to end over a real
 * Open5e fallback: the real searchItemsSection, whose compendium load fails,
 * so its section comes from Open5e. The other categories are stubbed: spells
 * to a D&D Beyond hidden-only section (dropped, 1 twin hidden), the rest to a
 * no-match, so the reply is the items section alone. Same fs / fetch mocking
 * as equipment-editions.test.ts.
 */

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  fchmodSync: vi.fn(),
  renameSync: vi.fn(),
  realpathSync: vi.fn((p: string) => p),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

const noMatch = vi.hoisted(() => (text: string) => async () => ({ header: null, body: text, footer: null, hidden: 0 }));
vi.mock("../src/tools/reference.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/tools/reference.js")>()),
  searchSpellsSection: async () => ({
    header: "Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: \"2014\" for 2014 versions.",
    body: "No spells found matching the criteria.",
    footer: '1 2014 version hidden — rules_edition: "2014" shows it.',
    hidden: 1,
  }),
  searchRacesSection: noMatch("No races found matching the criteria."),
  searchClassesSection: noMatch("No classes found matching the criteria."),
  searchFeatsSection: noMatch("No feats found matching the criteria."),
}));
vi.mock("../src/tools/monster.js", () => ({
  searchMonstersSection: noMatch("No monsters found matching the search criteria."),
}));

import { COBALT_URL, GAME_DATA, jsonResponse, makeJwt } from "./fixtures/spell-service.js";

const realFs = await vi.importActual<typeof import("fs")>("fs");

let search: typeof import("../src/tools/search.js").search;
let searchItemsSection: typeof import("../src/tools/reference.js").searchItemsSection;

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReset().mockReturnValue(true);
  const session = JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  });
  // The recorded Open5e documents are read from disk through the real fs.
  fsMock.readFileSync.mockReset().mockImplementation((path: unknown, ...rest: unknown[]) =>
    String(path).includes("/fixtures/open5e-v2/") ? realFs.readFileSync(path as URL, ...(rest as [BufferEncoding])) : session);
  const o5 = o5FixtureFetch();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    // 403, not 500: a 5xx is retried with backoff, which only slows the test down.
    if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
    if (url.includes("open5e")) return o5(url);
    return jsonResponse({});
  }));
  vi.resetModules();
  ({ search } = await import("../src/tools/search.js"));
  ({ searchItemsSection } = await import("../src/tools/reference.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ddb_search_site over a real Open5e fallback", () => {
  it("the items section keeps its own Open5e Rules line and its hidden twins reach the combined footer", async () => {
    // The real section builder hands search() an Open5e section, not plain text.
    expect(await searchItemsSection({ name: "longsword", rulesEdition: "2024", bookNotes: false }))
      .toMatchObject({ header: open5eSearchHeader("2024", "unavailable"), open5e: true, hidden: 2 });
    const text = await search("longsword", "all", "2024");
    // All-Open5e: no combined D&D Beyond header.
    expect(text).not.toContain(searchHeader({ requested: "2024" }));
    expect(text.startsWith('# Search results for "longsword"\n\n## Items\n\n')).toBe(true);
    // The section's own header (open5e: true) stays above its body.
    expect(text).toContain(`## Items\n\n${open5eSearchHeader("2024", "unavailable")}\nFound 2 item(s)`);
    expect(text).toContain("• Longsword [2024] (Weapon)");
    expect(text).not.toContain("## Spells");
    // Its 2 hidden SRD 5.1 twins and the dropped spells section's 1 are the one combined footer.
    expect(text.match(/hidden — /g)).toHaveLength(1);
    expect(text.trimEnd().split("\n").at(-1)).toBe(searchFooter("2024", 3));
  });
});
