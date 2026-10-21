import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchHeader, searchFooter } from "../src/edition.js";
import { plainSection, renderSection, type SearchSection } from "../src/tools/edition-search.js";

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
const ddb = (body: string, hidden = 0): SearchSection =>
  ({ header: H, body, footer: searchFooter("2024", hidden), hidden });

beforeEach(() => {
  for (const fn of Object.values(sections)) fn.mockReset().mockResolvedValue(plainSection("No things found."));
});

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
    sections.items.mockResolvedValue(plainSection("Rules: 2014 · SRD 5.1\n- **Rope**"));
    const text = await search("x", "all", "2024");
    expect(text.split("\n")[0]).toBe(H);
    expect(text.match(/^Rules: /gm)).toHaveLength(2);
  });

  it('skips an empty "No items found …" section', async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    sections.items.mockResolvedValue(plainSection("No items found matching the criteria (SRD only)."));
    expect(await search("x", "all", "2024")).not.toContain("## Items");
  });

  it("a throwing section becomes an italic message", async () => {
    sections.spells.mockResolvedValue(ddb("**Spell Search** (1 found)"));
    sections.feats.mockRejectedValue(new Error("boom"));
    expect(await search("x", "all", "2024")).toContain("## Feats\n\n_boom_");
  });
});
