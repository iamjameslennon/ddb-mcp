import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * spell-editions.test.ts — rules_edition on ddb_get_spell / ddb_search_spells.
 * Same fs / fetch mocking as spell-compendium-endpoints.test.ts.
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

import { GAME_DATA, jsonResponse, serviceMock, spell } from "./fixtures/spell-service.js";

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReset().mockReturnValue(true);
  fsMock.readFileSync.mockReset().mockReturnValue(JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  }));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  reference = await import("../src/tools/reference.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const OLD = { isLegacy: true, sources: [2] };
const NEW = { sources: [145] };

function installBasics(extra: unknown[] = []) {
  fetchMock.mockImplementation(serviceMock({
    spells: {
      "8": [
        spell("Sleep", 1, { id: 101, ...OLD, description: "SLEEP 2014" }),
        spell("Sleep", 1, { id: 201, ...NEW, description: "SLEEP 2024" }),
        spell("Toll the Dead", 0, { id: 102, sources: [27] }),
        spell("Starry Wisp", 0, { id: 202, ...NEW }),
        spell("Acid Arrow", 2, { id: 103, ...OLD, description: "ACID 2014" }),
        spell("Melf's Acid Arrow", 2, { id: 203, ...NEW, description: "ACID 2024" }),
        spell("Barkskin", 2, { id: 104, ...OLD, concentration: true }),
        spell("Barkskin", 2, { id: 204, ...NEW, concentration: false }),
        ...extra,
      ],
    },
  }));
}

describe("ddb_get_spell rules_edition", () => {
  it("Sleep: 2024 by default, 2014 on request, each with its rules line", async () => {
    installBasics();
    const d = (await reference.getSpell("Sleep")).split("\n");
    expect(d[1]).toBe("Rules: 2024 · Player's Handbook (2024)");
    expect(d.join("\n")).toContain("SLEEP 2024");
    const o = (await reference.getSpell("Sleep", "2014")).split("\n");
    expect(o[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
    expect(o.join("\n")).toContain("SLEEP 2014");
  });

  it("a 2014-only spell under the default carries the reason line", async () => {
    installBasics();
    expect(await reference.getSpell("Toll the Dead")).toContain(
      "Rules: 2014 · Xanathar's Guide to Everything\n(no 2024 version found — 2014 text shown)");
  });

  it("a 2024-only spell under 2014 carries the reason line", async () => {
    installBasics();
    expect(await reference.getSpell("Starry Wisp", "2014")).toContain("(no 2014 version found — 2024 text shown)");
  });

  it("Acid Arrow resolves through the rename table", async () => {
    installBasics();
    const out = await reference.getSpell("Acid Arrow");
    expect(out).toContain("ACID 2024");
    expect(out).toContain("(2014 name: Acid Arrow · 2024 name: Melf's Acid Arrow)");
    expect(await reference.getSpell("Acid Arrow", "2014")).not.toContain("2014 name:");
  });

  it("two same-edition entries resolve by lowest id", async () => {
    installBasics([
      spell("Twin Bolt", 1, { id: 301, ...NEW, description: "TWIN 301" }),
      spell("Twin Bolt", 1, { id: 300, ...NEW, description: "TWIN 300" }),
    ]);
    const out = await reference.getSpell("Twin Bolt");
    expect(out).toContain("TWIN 300");
    expect(out).not.toContain("TWIN 301");
  });
});

describe("ddb_search_spells rules_edition", () => {
  it("search hides the other edition's twin and says so", async () => {
    installBasics();
    const lines = (await reference.searchSpells({ name: "sleep" })).split("\n");
    expect(lines[0]).toBe('Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: "2014" for 2014 versions.');
    expect(lines.filter(l => l.startsWith("- **Sleep**"))).toEqual(["- **Sleep** [2024] — Level 1 Evocation"]);
    expect(lines.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
    const old = (await reference.searchSpells({ name: "sleep", rulesEdition: "2014" })).split("\n");
    expect(old[0]).toBe("Rules: 2014 requested — 2024 entries appear only where no 2014 version was found.");
    expect(old.at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
  });

  it("attribute filters apply to the selected entry", async () => {
    installBasics();
    const conc = await reference.searchSpells({ concentration: true });
    expect(conc).not.toContain("**Barkskin**");
    // groupAndSelect counts a twin as hidden only when the group's selected entry passed the filters.
    expect(conc).not.toContain("hidden");
    expect(await reference.searchSpells({ concentration: true, rulesEdition: "2014" })).toContain("- **Barkskin** [2014]");
  });

  it("the name filter matches a group by either name", async () => {
    installBasics();
    expect(await reference.searchSpells({ name: "melf", rulesEdition: "2014" })).toContain("- **Acid Arrow** [2014]");
  });

  it("pagination and totals count the list after hiding; the footer counts every hidden twin", async () => {
    const many: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      const n = `Page ${String(i).padStart(2, "0")}`;
      many.push(spell(n, 1, { id: 1000 + i, ...OLD }), spell(n, 1, { id: 2000 + i, ...NEW }));
    }
    fetchMock.mockImplementation(serviceMock({ spells: { "8": many } }));
    const out = await reference.searchSpells({ name: "page", limit: 20 });
    expect(out).toContain("showing 1–20 of 25");
    expect(out.split("\n").at(-1)).toBe('25 2014 versions hidden — rules_edition: "2014" shows them.');
  });
});

describe("Open5e fallback labels", () => {
  const o5Spell = {
    name: "Fireball", level_int: 3, school: "Evocation", casting_time: "1 action", range: "150 feet",
    components: "V, S, M", duration: "Instantaneous", requires_concentration: false, ritual: "no", desc: "Boom.",
  };

  it("labels the Open5e fallback when every D&D Beyond request fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(GAME_DATA)) return jsonResponse({}, 403);
      if (url.includes("open5e")) return jsonResponse({ count: 1, results: [o5Spell] });
      return serviceMock({})(url);
    });
    expect((await reference.getSpell("Fireball")).split("\n")[1])
      .toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)");
  });

  it("labels the Open5e fallback as not-found when D&D Beyond lacks the spell", async () => {
    const base = serviceMock({ spells: { "8": [spell("Sleep", 1, { id: 201, ...NEW })] } });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("open5e")) return jsonResponse({ count: 1, results: [o5Spell] });
      return base(url);
    });
    expect((await reference.getSpell("Fireball")).split("\n")[1])
      .toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)");
  });
});
