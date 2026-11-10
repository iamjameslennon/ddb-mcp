import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchHeader, searchFooter, open5eSearchHeader } from "../src/edition.js";
import { plainSection, noMatchSection, renderSection, type SearchSection } from "../src/tools/edition-search.js";
import {
  clearOpen5eCache,
  o5SearchSpells, o5SearchMonsters, o5SearchItems, o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchSpellsSection, o5SearchMonstersSection, o5SearchItemsSection, o5SearchRacesSection, o5SearchClassesSection,
  o5SearchBackgroundsSection, o5SearchFeatsSection,
} from "../src/open5e.js";
import { o5FixtureFetch } from "./fixtures/open5e-v2.js";

const sections = vi.hoisted(() => ({
  spells: vi.fn(), monsters: vi.fn(), items: vi.fn(), races: vi.fn(), classes: vi.fn(), feats: vi.fn(),
}));

vi.mock("../src/tools/reference.js", () => ({
  searchSpellsSection: sections.spells,
  searchItemsSection: sections.items,
  searchRacesSection: sections.races,
  searchClassesSection: sections.classes,
  searchFeatsSection: sections.feats,
}));
vi.mock("../src/tools/monster.js", () => ({ searchMonstersSection: sections.monsters }));

import { search } from "../src/tools/search.js";

const H = searchHeader({ requested: "2024" });
const O5H = open5eSearchHeader("2024", "unavailable");
const ddb = (body: string, hidden = 0): SearchSection =>
  ({ header: H, body, footer: searchFooter("2024", hidden), hidden });

beforeEach(() => {
  for (const fn of Object.values(sections)) fn.mockReset().mockResolvedValue(noMatchSection("No things found."));
  // The Open5e sections below are the real ones, served from the recorded v2 documents.
  clearOpen5eCache();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => o5FixtureFetch()(url)));
});
afterEach(() => vi.unstubAllGlobals());

describe("search (ddb_search_site)", () => {
  it("all: one header, bodies without their own header/footer, one combined footer", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)\n\n- **Fireball** [2024] — Level 3 Evocation", 1));
    sections.monsters.mockResolvedValue(ddb("**Monster Search** (1 shown)\n- **Goblin Warrior** [2024]", 1));
    const text = await search("fire", "all", "2024");
    expect(text.split("\n")[0]).toBe(H);
    expect(text.match(/^Rules: /gm)).toHaveLength(1);
    expect(text.trimEnd().split("\n").at(-1)).toBe('2 2014 versions hidden — rules_edition: "2014" shows them.');
    expect(text).toContain('# Search results for "fire"');
    expect(text).toContain("## Spells\n\n**Spell Search**");
    expect(text).not.toContain("## Races");
  });

  it("all: a near-match monster section (no noMatch) is kept", async () => {
    sections.monsters.mockResolvedValue(ddb('No monster names match "vorpal". Closest matches from D&D Beyond:\n- **Avoral Guardinal** [2024]'));
    const text = await search("vorpal", "all", "2024");
    expect(text).toContain("## Monsters");
    expect(text).toContain("Avoral Guardinal");
  });

  it("passes siteSearch: true to the monster search, never listAll", async () => {
    await search("goblin", "monsters", "2024");
    expect(sections.monsters).toHaveBeenCalledWith({ name: "goblin", rulesEdition: "2024", siteSearch: true });
  });

  it("a single category keeps its own header and footer", async () => {
    const s = ddb("**Spell Search** (1 found)", 1);
    sections.spells.mockResolvedValue(s);
    expect(await search("fire", "spells", "2024")).toBe(renderSection(s));
  });

  it("threads rules_edition into every category", async () => {
    await search("x", "all", "2014");
    for (const fn of Object.values(sections)) expect(fn.mock.calls[0][0]).toMatchObject({ name: "x", rulesEdition: "2014" });
  });

  it("asks every catalog category for no book notes (ddb_search_site has no source param)", async () => {
    for (const category of ["all", "spells", "items", "races", "classes", "feats"] as const) {
      for (const fn of Object.values(sections)) fn.mockClear();
      await search("x", category, "2024");
      for (const [name, fn] of Object.entries(sections)) {
        if (name === "monsters" || fn.mock.calls.length === 0) continue;
        expect(fn.mock.calls[0][0]).toMatchObject({ bookNotes: false });
      }
    }
  });

  it("all empty: plain no-results text with no header", async () => {
    expect(await search("zzz", "all", "2024")).toBe('No results found for "zzz".');
  });

  it("all plain (Open5e fallbacks): no combined header, each keeps its own Rules line", async () => {
    sections.spells.mockResolvedValue(plainSection("Rules: 2014 · SRD 5.1\n- **Fireball**"));
    sections.items.mockResolvedValue(plainSection("Rules: 2014 · SRD 5.1\n- **Rope**"));
    const text = await search("x", "all", "2024");
    expect(text.startsWith('# Search results for "x"')).toBe(true);
    expect(text).not.toContain(H);
    expect(text.match(/^Rules: /gm)).toHaveLength(2);
  });

  it("mixed: prints the combined header and the Open5e section's own Rules line", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    // The real Open5e section (open5e: true, its own header), not a hand-built plain one.
    const items = await o5SearchItemsSection({ name: "longsword" }, "unavailable");
    expect(items).toMatchObject({ header: O5H, open5e: true, hidden: 2 });
    sections.items.mockResolvedValue(items);
    const text = await search("x", "all", "2024");
    expect(text.split("\n")[0]).toBe(H);
    expect(text.match(/^Rules: /gm)).toHaveLength(2);
    expect(text).toContain(`## Items\n\n${O5H}\n${items.body}`);
    expect(text.trimEnd().split("\n").at(-1)).toBe(searchFooter("2024", 2));
  });

  it('skips an empty "No items found …" section', async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    // The real Open5e no-match reply, not a hand-built string.
    const none = await o5SearchItemsSection({ name: "zzzz" }, "not-found");
    expect(renderSection(none)).toBe(await o5SearchItems({ name: "zzzz" }, "not-found"));
    sections.items.mockResolvedValue(none);
    expect(await search("x", "all", "2024")).not.toContain("## Items");
  });

  it.each([
    ["spells listed", () => o5SearchSpells({ name: "fire" }, "unavailable"), () => o5SearchSpellsSection({ name: "fire" }, "unavailable")],
    ["spells past the end", () => o5SearchSpells({ name: "fire", offset: 9 }, "not-found"), () => o5SearchSpellsSection({ name: "fire", offset: 9 }, "not-found")],
    ["spells no match", () => o5SearchSpells({ name: "zzz" }, "not-found"), () => o5SearchSpellsSection({ name: "zzz" }, "not-found")],
    ["monsters hidden-only", () => o5SearchMonsters({ name: "goblin", type: "humanoid" }, "unavailable"), () => o5SearchMonstersSection({ name: "goblin", type: "humanoid" }, "unavailable")],
    ["monsters listed, 2014", () => o5SearchMonsters({ name: "goblin", rulesEdition: "2014" }, "unavailable"), () => o5SearchMonstersSection({ name: "goblin", rulesEdition: "2014" }, "unavailable")],
    ["items listed", () => o5SearchItems({ name: "bag" }, "unavailable"), () => o5SearchItemsSection({ name: "bag" }, "unavailable")],
    ["races single-hit detail", () => o5SearchRaces({ name: "elf" }, "not-found"), () => o5SearchRacesSection({ name: "elf" }, "not-found")],
    ["races listed", () => o5SearchRaces({}, "unavailable"), () => o5SearchRacesSection({}, "unavailable")],
    ["classes single-hit detail", () => o5SearchClasses({ name: "wizard" }, "unavailable"), () => o5SearchClassesSection({ name: "wizard" }, "unavailable")],
    ["classes no match", () => o5SearchClasses({ name: "zzz" }, "unavailable"), () => o5SearchClassesSection({ name: "zzz" }, "unavailable")],
    ["backgrounds listed", () => o5SearchBackgrounds({}, "unavailable"), () => o5SearchBackgroundsSection({}, "unavailable")],
    ["feats listed", () => o5SearchFeats({}, "not-found"), () => o5SearchFeatsSection({}, "not-found")],
  ])("Open5e %s: the section renders to the string reply byte for byte", async (_n, asString, asSection) => {
    const section = await asSection();
    expect(section.open5e).toBe(true);
    expect(renderSection(section)).toBe(await asString());
  });

  it("keeps an Open5e detail block or listed body whose entry name starts 'No … found' (minors B item 3)", async () => {
    sections.items.mockResolvedValue({ header: null, body: "No Mercy Found\nRules: 2024 · SRD 5.2 (Open5e fallback — not found on D&D Beyond)\nA gentle blade.", footer: null, hidden: 0, open5e: true });
    sections.feats.mockResolvedValue({ header: null, body: "- **No Quarter found** [2024]", footer: null, hidden: 0, open5e: true });
    const text = await search("x", "all", "2024");
    expect(text).toContain("## Items");
    expect(text).toContain("No Mercy Found");
    expect(text).toContain("## Feats");
  });

  it("keeps a D&D Beyond section whose first listed line is a closed 'No … found.' sentence", async () => {
    sections.items.mockResolvedValue(ddb("No Escape found.\nA grim relic."));
    const text = await search("x", "all", "2024");
    expect(text).toContain("## Items\n\nNo Escape found.");
  });

  it.each([
    ["spells", () => o5SearchSpellsSection({ name: "zzz" }, "not-found"), () => o5SearchSpellsSection({ name: "fire", limit: 10 }, "not-found")],
    ["monsters", () => o5SearchMonstersSection({ name: "zzz" }, "not-found"), () => o5SearchMonstersSection({ name: "goblin" }, "not-found")],
    ["items", () => o5SearchItemsSection({ name: "zzz" }, "not-found"), () => o5SearchItemsSection({ name: "bag" }, "not-found")],
    ["races", () => o5SearchRacesSection({ name: "zzz" }, "not-found"), () => o5SearchRacesSection({}, "not-found")],
    ["classes", () => o5SearchClassesSection({ name: "zzz" }, "not-found"), () => o5SearchClassesSection({}, "not-found")],
    ["feats", () => o5SearchFeatsSection({ name: "zzz" }, "not-found"), () => o5SearchFeatsSection({}, "not-found")],
  ])("Open5e %s: the no-match reply carries noMatch, the listed one does not", async (_n, none, listed) => {
    expect((await none()).noMatch).toBe(true);
    expect((await listed()).noMatch).toBeUndefined();
  });

  it("an Open5e hidden-only reply carries noMatch", async () => {
    expect((await o5SearchMonstersSection({ name: "goblin", type: "humanoid" }, "unavailable")).noMatch).toBe(true);
  });

  it("an error section is kept", async () => {
    sections.items.mockResolvedValue(plainSection("No items found: Unknown source."));
    expect(await search("x", "all", "2024")).toContain("## Items");
  });

  it("a D&D Beyond section that lists nothing but hides 3 twins adds 3 to the combined footer", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    sections.items.mockResolvedValue({ header: H, body: "No items found matching the criteria.", footer: searchFooter("2024", 3), hidden: 3, noMatch: true });
    const text = await search("x", "all", "2024");
    expect(text).not.toContain("## Items");
    expect(text).not.toContain("No items found");
    expect(text.trimEnd().split("\n").at(-1)).toBe('3 2014 versions hidden — rules_edition: "2014" shows them.');
  });

  it("an Open5e section that lists nothing but hides twins is dropped and its count kept", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    // 2024 goblinoids are Fey; the 2014 Goblin is a Humanoid: nothing listed, one 2014 twin hidden.
    const goblins = await o5SearchMonstersSection({ name: "goblin", type: "humanoid" }, "unavailable");
    expect(goblins).toMatchObject({ header: O5H, body: "No monsters found (SRD only).", hidden: 1 });
    sections.monsters.mockResolvedValue(goblins);
    const text = await search("x", "all", "2024");
    expect(text).not.toContain("## Monsters");
    expect(text).not.toContain(O5H);
    expect(text.trimEnd().split("\n").at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it('an all-Open5e "all" reply with one hidden-only section has no combined header and keeps the footer count', async () => {
    const spells = await o5SearchSpellsSection({ name: "fire", limit: 10 }, "unavailable");
    const goblins = await o5SearchMonstersSection({ name: "goblin", type: "humanoid" }, "unavailable");
    sections.spells.mockResolvedValue(spells);
    sections.monsters.mockResolvedValue(goblins);
    const text = await search("x", "all", "2024");
    expect(text.startsWith('# Search results for "x"')).toBe(true);
    expect(text).not.toContain(H);
    expect(text).not.toContain("## Monsters");
    // The listed section keeps its own Open5e Rules line; every count is in the one combined footer.
    expect(text).toContain(`## Spells\n\n${O5H}\n${spells.body}`);
    expect(text.match(/hidden — /g)).toHaveLength(1);
    expect(text.trimEnd().split("\n").at(-1)).toBe(searchFooter("2024", spells.hidden + 1));
  });

  it("every section dropped but some hid twins: the no-results line, then the combined footer", async () => {
    sections.items.mockResolvedValue({ header: H, body: "No items found matching the criteria.", footer: searchFooter("2024", 2), hidden: 2, noMatch: true });
    expect(await search("q", "all", "2024")).toBe('No results found for "q".\n\n2 2014 versions hidden — rules_edition: "2014" shows them.');
  });

  it("an Open5e section's own footer moves into the combined footer", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)", 1));
    // Thug is the 2014 name of the 2024 Tough: one line, one 2014 twin hidden.
    const thugs = await o5SearchMonstersSection({ name: "thug" }, "unavailable");
    expect(thugs.hidden).toBe(1);
    sections.monsters.mockResolvedValue(thugs);
    const text = await search("x", "all", "2024");
    expect(text).toContain(`## Monsters\n\n${O5H}\n${thugs.body}`);
    expect(text.match(/hidden — /g)).toHaveLength(1);
    expect(text.trimEnd().split("\n").at(-1)).toBe('2 2014 versions hidden — rules_edition: "2014" shows them.');
  });

  it("an Open5e single-hit detail block keeps its own label, its count goes to the combined footer", async () => {
    const elf = await o5SearchRacesSection({ name: "elf" }, "unavailable");
    expect(elf.header).toBeNull();
    expect(elf.hidden).toBeGreaterThan(0);
    sections.races.mockResolvedValue(elf);
    const text = await search("x", "all", "2024");
    expect(text.startsWith('# Search results for "x"\n\n## Races\n\nElf\nRules: 2024 · SRD 5.2 (Open5e fallback')).toBe(true);
    expect(text.match(/hidden — /g)).toHaveLength(1);
    expect(text.trimEnd().split("\n").at(-1)).toBe(searchFooter("2024", elf.hidden));
  });

  it("a throwing section becomes an italic message", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    sections.feats.mockRejectedValue(new Error("boom"));
    expect(await search("x", "all", "2024")).toContain("## Feats\n\n_boom_");
  });
});
