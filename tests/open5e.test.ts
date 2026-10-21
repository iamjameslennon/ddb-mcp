import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Logged out, so getMonsterStats goes straight to Open5e and no real session file is read.
const sessionMocks = vi.hoisted(() => ({ hasValidSession: vi.fn(() => false) }));
vi.mock("../src/session-fetch.js", async (orig) => ({
  ...(await orig<typeof import("../src/session-fetch.js")>()),
  hasValidSession: sessionMocks.hasValidSession,
}));
import { open5eSearchHeader, twinName } from "../src/edition.js";
import { o5Fixture, o5FixtureFetch, o5Record } from "./fixtures/open5e-v2.js";
import {
  clearOpen5eCache,
  o5GetSpell, o5GetMonster, o5GetEquipment,
  o5SearchSpells, o5SearchMonsters, o5SearchItems,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchRules, o5GetRule, o5GetMonsterStats, crText, castingTime, humanize,
} from "../src/open5e.js";
import { getMonsterStats } from "../src/tools/monster.js";
import { rateEncounter } from "../src/tools/encounter.js";

function stubFetch(v2 = o5FixtureFetch()): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => v2(url)));
}

beforeEach(() => {
  clearOpen5eCache();
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("Open5e labels", () => {
  it.each([
    ["o5SearchItems", () => o5SearchItems({ name: "bag" }, "unavailable")],
    ["o5SearchRaces", () => o5SearchRaces({}, "unavailable")],
    ["o5SearchClasses", () => o5SearchClasses({}, "unavailable")],
    ["o5SearchBackgrounds", () => o5SearchBackgrounds({}, "unavailable")],
    ["o5SearchFeats", () => o5SearchFeats({}, "unavailable")],
  ])("%s opens with the Open5e search header and tags every result line", async (_n, call) => {
    const out = await call();
    const lines = out.split("\n");
    expect(lines[0]).toBe(open5eSearchHeader("2024", "unavailable"));
    const results = lines.filter(l => l.startsWith("• "));
    expect(results.length).toBeGreaterThan(0);
    for (const l of results) expect(l).toMatch(/^• [^[\n]+? \[(?:2024|2014)\]/);
    expect(out).not.toContain("Source: SRD 5.1 via Open5e");
  });

  it("a single-result search uses the single-lookup label", async () => {
    const one = await o5SearchRaces({ name: "dwarf" }, "not-found");
    expect(one.split("\n")[0]).toBe("Dwarf");
    expect(one.split("\n")[1]).toBe("Rules: 2024 · SRD 5.2 (Open5e fallback — not found on D&D Beyond)");
  });

  it("a chapter get gives the whole chapter under the SRD's rules line", async () => {
    const out = (await o5GetRule("Damage and Healing", "2024", 30000))!;
    expect(out.split("\n").slice(0, 2)).toEqual(["## Damage and Healing", "Rules: 2024 · SRD 5.2"]);
    expect(out).toMatch(/^### Resting$/m);
    expect((await o5GetRule("Damage and Healing", "2014"))!.split("\n")[1]).toBe("Rules: 2014 · SRD 5.1");
  });
  it("v1-style slugs, full keys and section names resolve", async () => {
    expect((await o5GetRule("damage-and-healing", "2024"))!.split("\n")[0]).toBe("## Damage and Healing");
    expect((await o5GetRule("attacking", "2014"))!.split("\n")[0]).toBe("## Attacking");
    expect((await o5GetRule("srd-2024_combat", "2024"))!.split("\n")[0]).toBe("## Combat");
    expect((await o5GetRule("Grappling", "2014"))!).toContain("*Part of Attacking*");
    expect((await o5GetRule("srd-2024_combat_cover", "2024"))!.split("\n").slice(0, 3)).toEqual(["## Cover", "Rules: 2024 · SRD 5.2", "*Part of Combat*"]);
  });
  it("partial names resolve: a chapter name first, then a section name", async () => {
    expect((await o5GetRule("damage", "2024"))!.split("\n")[0]).toBe("## Damage and Healing");
    const u = (await o5GetRule("underwater", "2024"))!.split("\n");
    expect(u[0]).toBe("## Underwater Combat");
    expect(u[2]).toBe("*Part of Combat*");
  });
  it("a blank name finds nothing; a blank search query lists every chapter", async () => {
    expect(await o5GetRule("   ", "2024")).toBeNull();
    const out = await o5SearchRules("  ", "2024");
    expect(out).toContain("Found 4 rules chapter(s) (SRD only):");
    expect(out).not.toContain("matching");
  });
  it("a section with a null desc does not break search or get", async () => {
    const rs = o5Fixture<{ rules: Array<{ desc: string | null }> }>("srd-2024", "rulesets" as never);
    const broken = rs.map((r, i) => i === 0 ? { ...r, rules: r.rules.map((s, j) => j === 0 ? { ...s, desc: null } : s) } : r);
    stubFetch(o5FixtureFetch({ "srd-2024/rulesets": broken }));
    expect(await o5SearchRules("initiative", "2024")).toContain("**Combat**");
    expect(await o5GetRule("Combat", "2024", 30000)).toContain("### The Order of Combat\n\n");
    expect(await o5GetRule("The Order of Combat", "2024")).toContain("*Part of Combat*");
  });
  it("a repeated 2024 section name resolves to its first chapter", async () => {
    // Live 2026-10-20: "Ability Checks" is a section of both D20 Tests and Social Interaction.
    expect((await o5GetRule("Ability Checks", "2024"))!.split("\n")[2]).toBe("*Part of D20 Tests*");
  });
  it("a get that misses retries the other document with the rules reason", async () => {
    expect((await o5GetRule("Madness", "2024"))!.split("\n").slice(1, 3)).toEqual(["Rules: 2014 · SRD 5.1", "(no matching 2024 rules section — 2014 text shown)"]);
    expect((await o5GetRule("D20 Tests", "2014"))!.split("\n")[2]).toBe("(no matching 2014 rules section — 2024 text shown)");
    expect(await o5GetRule("Zzz", "2024")).toBeNull();
  });
  it("a get keeps the query jump and the max_chars note", async () => {
    const out = (await o5GetRule("Damage and Healing", "2024", 500, "resting"))!;
    expect(out).toContain("*(Showing first 500 of ");
    const body = out.split("\n").slice(3).join("\n");
    expect(body.startsWith("…")).toBe(true);
    expect(body.slice(0, 300).toLowerCase()).toContain("resting");
  });
  it("a search lists the requested document's chapters, tagged", async () => {
    const out = await o5SearchRules("cover", "2014");
    expect(out.split("\n")[0]).toBe("Rules: sections from SRD 5.1 (2014).");
    expect(out.split("\n")[1]).toMatch(/^Found \d+ rules chapter\(s\)/);
    expect(out).toContain("• **Cover** [2014] (slug: `cover`)");
  });
  it("a search that misses lists the other document with the search reason", async () => {
    const g = await o5SearchRules("grapple", "2024");
    expect(g.split("\n").slice(0, 2)).toEqual(["Rules: sections from SRD 5.1 (2014).", "(no matching 2024 rules sections — 2014 sections listed)"]);
    expect(g).toMatch(/^• \*\*Attacking\*\* \[2014\] \(slug: `attacking`\) — .*\bGrappling\b/m);
    const d = await o5SearchRules("d20 test", "2014");
    expect(d.split("\n").slice(0, 2)).toEqual(["Rules: sections from SRD 5.2 (2024).", "(no matching 2014 rules sections — 2024 sections listed)"]);
    // Apostrophes and whitespace fold like names: straight "can't" finds SRD 5.2's curly one, no false reason.
    const c = await o5SearchRules("can't", "2024");
    expect(c.split("\n")[0]).toBe("Rules: sections from SRD 5.2 (2024).");
    expect(c).not.toContain("no matching");
    expect(await o5SearchRules("d20  tests", "2024")).toContain("**D20 Tests**");
    expect(await o5SearchRules("zzzz", "2024")).toBe('No rules sections found matching "zzzz" (SRD only).');
  });

});

// ── v2: SRD 5.2 and SRD 5.1 selected together ────────────────────────────────

const U24 = "Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)";
const U14 = "Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)";
const H24 = open5eSearchHeader("2024", "unavailable");

describe("Open5e v2 spells and monsters", () => {
  it("o5GetSpell gives SRD 5.2 by default and SRD 5.1 on request", async () => {
    expect((await o5GetSpell("Fireball", "2024", "unavailable"))!.split("\n").slice(0, 2)).toEqual(["Fireball (Level 3 Evocation)", U24]);
    expect((await o5GetSpell("Fireball", "2014", "unavailable"))!.split("\n")[1]).toBe(U14);
    expect(await o5GetSpell("Fireball", "2024", "unavailable")).toContain("Casting Time: 1 action");
  });

  it("a 2014-only spell under 2024 carries the reason line", async () => {
    expect((await o5GetSpell("Feeblemind", "2024", "not-found"))!.split("\n").slice(1, 3))
      .toEqual(["Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)", "(no 2024 version found — 2014 text shown)"]);
  });

  it("a 2024-only spell under 2014 carries the reason line", async () => {
    expect((await o5GetSpell("Befuddlement", "2014", "unavailable"))!.split("\n")[2]).toBe("(no 2014 version found — 2024 text shown)");
  });

  it("a partial 2014 name reaches its renamed 2024 twin", async () => {
    const out = (await o5GetSpell("branding", "2024", "unavailable"))!;
    expect(out.split("\n")[0]).toMatch(/^Shining Smite \(/);
    expect(out.split("\n")[1]).toBe(U24);
  });

  it("no false rename line when SRD 5.2 keeps the 2014 spelling", async () => {
    const out = (await o5GetSpell("Bigby's Hand", "2024", "unavailable"))!;
    expect(out.split("\n").slice(0, 2)).toEqual([expect.stringMatching(/^Arcane Hand \(/), U24]);
    expect(out).not.toContain("2014 name:");
  });

  it("o5GetMonster maps a 2014 name through the rename table", async () => {
    const out = (await o5GetMonster("Goblin", "2024", "unavailable"))!;
    expect(out.split("\n").slice(0, 3)).toEqual(["Goblin Warrior", U24, "(2014 name: Goblin · 2024 name: Goblin Warrior)"]);
    expect(out).toMatch(/^CR 1\/4 \| AC \d+/m);
  });

  it("o5GetMonster reason lines in both directions", async () => {
    expect((await o5GetMonster("Orc", "2024", "unavailable"))!.split("\n")[2]).toBe("(no 2024 version found — 2014 text shown)");
    expect((await o5GetMonster("Allosaurus", "2014", "unavailable"))!.split("\n")[2]).toBe("(no 2014 version found — 2024 text shown)");
  });

  it("only proficient saves are listed", async () => {
    expect(await o5GetMonster("Wolf", "2024", "unavailable")).not.toContain("Saving Throws:");
    expect(await o5GetMonster("Aboleth", "2024", "unavailable")).toMatch(/^Saving Throws: DEX \+3, CON \+6, INT \+8, WIS \+6$/m);
  });

  it("o5SearchSpells mixes documents per the pipeline", async () => {
    const out = await o5SearchSpells({ name: "fire", level: 0, rulesEdition: "2024" }, "unavailable");
    expect(out.split("\n")[0]).toBe(H24);
    expect(out).toContain("• Fire Bolt [2024] (Cantrip Evocation)");
    expect(out).not.toContain("Fireball");
    expect(out.trimEnd().split("\n").at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
    expect(await o5SearchSpells({ name: "feeble", rulesEdition: "2024" }, "unavailable")).toContain("• Feeblemind [2014]");
  });

  it("a renamed twin is found by its other name and counted", async () => {
    const out = await o5SearchMonsters({ name: "thug", rulesEdition: "2024" }, "unavailable");
    expect(out).toContain("• Tough [2024]");
    expect(out).not.toContain("Thug [2014]");
    expect(out).toContain('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it("an attribute miss counts the other edition instead of answering from it", async () => {
    // 2024 goblinoids are Fey; the 2014 Goblin is a Humanoid.
    const out = await o5SearchMonsters({ name: "goblin", type: "humanoid", rulesEdition: "2024" }, "unavailable");
    expect(out.split("\n")).toEqual([H24, "No monsters found (SRD only).", '1 2014 version hidden — rules_edition: "2014" shows it.']);
  });

  it("o5SearchMonsters applies cr, type and size", async () => {
    const out = await o5SearchMonsters({ cr: 0.25, type: "beast", size: "medium", rulesEdition: "2014" }, "unavailable");
    expect(out).toContain("• Wolf [2014] (CR 1/4, Medium Beast)");
    expect(out).not.toContain("Zombie");
  });

  it("an offset past the end gives the plain message, with no header or footer", async () => {
    // 8 spells selected and 6 twins hidden: the page past them is still a plain no-match.
    expect(await o5SearchSpells({ offset: 50, rulesEdition: "2024" }, "unavailable")).toBe("No spells found matching the criteria (SRD only).");
  });

  it("the school filter alone excludes a spell", async () => {
    const out = await o5SearchSpells({ school: "Enchantment", rulesEdition: "2024" }, "unavailable");
    expect(out).toContain("• Befuddlement [2024]");
    expect(out).toContain("• Sleep [2024]");
    expect(out).not.toContain("Fireball");
    expect(await o5SearchSpells({ school: "evocation", rulesEdition: "2024" }, "unavailable")).not.toContain("Sleep");
  });

  it("the concentration filter alone excludes a spell", async () => {
    const yes = await o5SearchSpells({ concentration: true, rulesEdition: "2024" }, "unavailable");
    expect(yes).toContain("• Arcane Hand [2024] (Level 5 Evocation [C])");
    expect(yes).not.toContain("Fireball");
    const no = await o5SearchSpells({ concentration: false, rulesEdition: "2024" }, "unavailable");
    expect(no).toContain("• Fireball [2024]");
    expect(no).not.toContain("Arcane Hand");
  });

  it("the ritual filter alone excludes a spell", async () => {
    const alarm = { ...o5Record<Record<string, unknown>>("srd-2024", "spells", "Sleep"), key: "srd-2024_alarm", name: "Alarm", ritual: true, concentration: false };
    stubFetch(o5FixtureFetch({ "srd-2024/spells": [...o5Fixture("srd-2024", "spells"), alarm] }));
    const yes = await o5SearchSpells({ ritual: true, rulesEdition: "2024" }, "unavailable");
    expect(yes).toContain("• Alarm [2024] (Level 1 Enchantment [R])");
    expect(yes).not.toContain("Sleep");
    const no = await o5SearchSpells({ ritual: false, rulesEdition: "2024" }, "unavailable");
    expect(no).toContain("• Sleep [2024]");
    expect(no).not.toContain("Alarm");
  });

  it("every casting-time key is humanized; an unknown one is shown as-is", () => {
    expect(Object.fromEntries(["action", "bonus-action", "reaction", "1minute", "10minutes", "1hour", "8hours", "12hours", "24hours", "special"]
      .map(k => [k, castingTime(k)]))).toEqual({
      action: "1 action", "bonus-action": "1 bonus action", reaction: "1 reaction", "1minute": "1 minute", "10minutes": "10 minutes",
      "1hour": "1 hour", "8hours": "8 hours", "12hours": "12 hours", "24hours": "24 hours", special: "special",
    });
  });

  it("a reaction spell shows its trigger after the casting time", async () => {
    // Shield's reaction_condition, live 2026-10-21.
    const shield = {
      ...o5Record<Record<string, unknown>>("srd-2024", "spells", "Sleep"), key: "srd-2024_shield", name: "Shield", casting_time: "reaction",
      reaction_condition: "which you take when you are hit by an attack roll or targeted by the Magic Missile spell",
    };
    stubFetch(o5FixtureFetch({ "srd-2024/spells": [shield] }));
    expect(await o5GetSpell("Shield", "2024", "unavailable"))
      .toContain("Casting Time: 1 reaction, which you take when you are hit by an attack roll or targeted by the Magic Missile spell\n");
    expect(await o5GetSpell("Fireball", "2024", "unavailable")).toContain("Casting Time: 1 action\n");
  });

  it("decision 4, the 2014 side: an SRD 5.1 entry under its 2014 name keeps the rename line", async () => {
    expect((await o5GetSpell("Bigby's Hand", "2014", "unavailable"))!.split("\n").slice(0, 3))
      .toEqual([expect.stringMatching(/^Arcane Hand \(/), U14, "(2014 name: Arcane Hand · 2024 name: Bigby's Hand)"]);
    expect((await o5GetMonster("Goblin Warrior", "2014", "unavailable"))!.split("\n").slice(0, 3))
      .toEqual(["Goblin", U14, "(2014 name: Goblin · 2024 name: Goblin Warrior)"]);
  });

  it("actions carry their usage limits and legendary costs", async () => {
    const dragon = (await o5GetMonster("Adult Red Dragon", "2014", "unavailable"))!;
    expect(dragon).toMatch(/^ {2}Fire Breath \(Recharge 5–6\)\. /m);
    expect(dragon).toMatch(/^ {2}Wing Attack \(Costs 2 Actions\)\. /m);
    expect(dragon).toMatch(/^ {2}Tail Attack\. /m); // a cost of 1 adds nothing
    expect(await o5GetMonster("Aboleth", "2024", "unavailable")).toMatch(/^ {2}Dominate Mind \(2\/Day\)\. /m);
  });

  it("Recharge 6, the RECHARGE type, a name already carrying its limit, and skill casing", async () => {
    const base = o5Record<Record<string, unknown>>("srd-2024", "creatures", "Wolf");
    const act = (name: string, usage_limits: unknown, order: number) => ({ name, desc: "Boo.", action_type: "ACTION", order_in_statblock: order, usage_limits });
    const odd = {
      ...base, key: "srd-2024_odd", name: "Oddity",
      skill_bonuses: { sleight_of_hand: 5, animal_handling: 3, stealth: 4 },
      actions: [
        act("Gaze", { type: "RECHARGE_ON_ROLL", param: 6 }, 0),
        act("Charge", { type: "RECHARGE", param: 5 }, 1),
        act("Petrifying Gaze (Recharge 4-6)", { type: "RECHARGE", param: 4 }, 2),
      ],
    };
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [odd] }));
    const out = (await o5GetMonster("Oddity", "2024", "unavailable"))!;
    expect(out).toMatch(/^ {2}Gaze \(Recharge 6\)\. /m);
    expect(out).toMatch(/^ {2}Charge \(Recharge 5–6\)\. /m);
    expect(out).toMatch(/^ {2}Petrifying Gaze \(Recharge 4-6\)\. /m);
    expect(out).toMatch(/^Skills: Sleight of Hand \+5, Animal Handling \+3, Stealth \+4$/m);
  });

  it("the type line has no subtype parenthetical", async () => {
    expect((await o5GetMonster("Adult Red Dragon", "2014", "unavailable"))!.split("\n")[2]).toBe("Huge Dragon, chaotic evil");
  });

  it("the size filter alone excludes a creature", async () => {
    expect(await o5SearchMonsters({ cr: 0.25, type: "beast", size: "large", rulesEdition: "2014" }, "unavailable")).toBe("No monsters found (SRD only).");
    const large = await o5SearchMonsters({ size: "Large", rulesEdition: "2024" }, "unavailable");
    expect(large).toContain("• Aboleth [2024] (CR 10, Large Aberration)");
    expect(large).toContain("• Allosaurus [2024] (CR 2, Large Beast)");
    expect(large).not.toContain("Wolf");
    expect(large).not.toContain("Zombie");
  });

  it("crText prints fractions exactly", () => {
    expect([0, 0.125, 0.25, 0.5, 1, 10].map(crText)).toEqual(["0", "1/8", "1/4", "1/2", "1", "10"]);
  });

  it("a not-found search keeps its plain message", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/spells": [], "srd-2014/spells": [] }));
    expect(await o5SearchSpells({ name: "zzz" }, "not-found")).toBe("No spells found matching the criteria (SRD only).");
  });
});

describe("Open5e v2 equipment and character options", () => {
  it("o5GetEquipment prefers an exact name in any endpoint over a partial one", async () => {
    expect((await o5GetEquipment("Longsword", "2024", "unavailable"))!.split("\n")[0]).toBe("Longsword (Martial Weapon)");
  });
  it("o5GetEquipment matches case-insensitively and picks the requested document", async () => {
    expect((await o5GetEquipment("chain mail", "2014", "unavailable"))!.split("\n").slice(0, 2)).toEqual(["Chain mail (Heavy Armor)", U14]);
  });
  it("o5GetEquipment folds curly apostrophes", async () => {
    expect((await o5GetEquipment("Alchemist’s Fire", "2024", "unavailable"))!.split("\n")[0]).toMatch(/^Alchemist's Fire \(/);
  });
  it("o5GetEquipment reason lines in both directions", async () => {
    expect((await o5GetEquipment("Abacus", "2024", "not-found"))!.split("\n")[2]).toBe("(no 2024 version found — 2014 text shown)");
    expect((await o5GetEquipment("Musket", "2014", "unavailable"))!.split("\n")[2]).toBe("(no 2014 version found — 2024 text shown)");
  });
  it("the shield is a shield", async () => {
    expect((await o5GetEquipment("Shield", "2024", "unavailable"))!).toMatch(/^Shield \(Shield\)\n[^\n]+\nAC: \+2$/m);
  });
  it("o5SearchItems covers magic and mundane items and applies rarity", async () => {
    const all = await o5SearchItems({ name: "longsword", rulesEdition: "2024" }, "unavailable");
    expect(all).toContain("• Flame Tongue Longsword [2024]");
    expect(all).toContain("• Longsword [2024]");
    expect(await o5SearchItems({ name: "longsword", rarity: "rare", rulesEdition: "2024" }, "unavailable")).not.toContain("• Longsword [2024]");
  });
  it("a 2014 feat request with no SRD 5.1 match shows SRD 5.2 with the reason", async () => {
    const out = await o5SearchFeats({ name: "alert", rulesEdition: "2014" }, "unavailable");
    expect(out.split("\n").slice(0, 3)).toEqual(["Alert", U24, "(no 2014 version found — 2024 text shown)"]);
  });
  it("a subrace takes its parent's speed", async () => {
    expect(await o5SearchRaces({ name: "elf", rulesEdition: "2014" }, "unavailable"))
      .toContain("• High Elf [2014] (subrace of Elf) | Speed: Your base walking speed is 30 feet.");
  });
  it("a no-name class search survives subclasses and missing fields", async () => {
    const out = await o5SearchClasses({ rulesEdition: "2024" }, "unavailable");
    expect(out).toContain("• Champion [2024] (d10) | subclass of Fighter");
    expect(out).not.toMatch(/undefined|null/);
    expect(await o5SearchClasses({ name: "wizard", rulesEdition: "2014" }, "unavailable")).not.toContain("Spellcasting: null");
  });
  it("a class search by a renamed subclass's 2014 name finds the 2024 one", async () => {
    const out = await o5SearchClasses({ name: "school of evocation", rulesEdition: "2024" }, "unavailable");
    expect(out.split("\n").slice(0, 2)).toEqual(["Evoker", U24]);   // single hit: detail block
    expect(out).toContain('1 2014 version hidden — rules_edition: "2014" shows it.');
  });
  it("a mundane item prints a dash for a zero cost or weight", async () => {
    expect(await o5GetEquipment("Antitoxin", "2024", "unavailable")).toMatch(/^Cost: 50 gp \| Weight: —$/m);
  });
});

describe("Open5e v2 equipment and options, fix round 1", () => {
  const lines = (out: string | null) => out!.split("\n");

  it("2024 weapon and armour gets carry the SRD 5.2 label", async () => {
    expect(lines(await o5GetEquipment("Longsword", "2024", "unavailable"))[1]).toBe(U24);
    expect(lines(await o5GetEquipment("Shield", "2024", "unavailable"))[1]).toBe(U24);
    expect(lines(await o5GetEquipment("Chain Mail", "2024", "unavailable")).slice(0, 2)).toEqual(["Chain Mail (Heavy Armor)", U24]);
  });

  it("decision 3: an exact twin in one document beats a partial match in the other", async () => {
    // SRD 5.1 has only "Rope, hempen (50 feet)": the exact "Rope" is SRD 5.2's.
    expect(lines(await o5GetEquipment("Rope", "2014", "unavailable")).slice(0, 3))
      .toEqual(["Rope (Adventuring Gear)", U24, "(no 2014 version found — 2024 text shown)"]);
  });

  it("a renamed armour's 2014 name reaches SRD 5.2's armour, with the rename line", async () => {
    const out = (await o5GetEquipment("Hide", "2024", "unavailable"))!;
    expect(out.split("\n").slice(0, 3)).toEqual(["Hide Armor (Medium Armor)", U24, "(2014 name: Hide · 2024 name: Hide Armor)"]);
    expect(out).not.toContain("no 2024 version");
    expect(lines(await o5GetEquipment("Hide", "2014", "unavailable")).slice(0, 2)).toEqual(["Hide (Medium Armor)", U14]);
  });

  it("the armour pairs are Open5e-only: the shared namer leaves Hide alone", async () => {
    expect(twinName("Hide")).toBe("hide");
    expect(twinName("Plate Armor")).toBe("plate armor");
    expect(lines(await o5GetEquipment("Hide", "2024", "unavailable"))[0]).toBe("Hide Armor (Medium Armor)");
  });

  it("within the picked edition the exact name beats endpoint order", async () => {
    // SRD 5.1 files the armour as "Plate" (armor) and its gear entry as "Plate Armor" (items); fields live 2026-10-21.
    const plateItem = {
      ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_plate-armor", name: "Plate Armor",
      desc: "Plate consists of shaped, interlocking metal plates to cover the entire body.",
      category: { name: "Armor", key: "armor" }, weight: "65.000", weight_unit: "lb", cost: "1500.00",
    };
    const plate = {
      ...o5Record<Record<string, unknown>>("srd-2014", "armor", "Chain mail"), key: "srd_plate", name: "Plate",
      ac_display: "18", ac_base: 18, strength_score_required: 15,
    };
    stubFetch(o5FixtureFetch({
      "srd-2014/items": [...o5Fixture("srd-2014", "items"), plateItem],
      "srd-2014/armor": [...o5Fixture("srd-2014", "armor"), plate],
    }));
    const item = (await o5GetEquipment("Plate Armor", "2014", "unavailable"))!;
    expect(item.split("\n").slice(0, 3)).toEqual(["Plate Armor (Armor)", U14, "Cost: 1500 gp | Weight: 65 lb"]);
    expect(item).not.toContain("2014 name:");
    const armour = (await o5GetEquipment("Plate", "2014", "unavailable"))!;
    expect(armour.split("\n").slice(0, 2)).toEqual(["Plate (Heavy Armor)", U14]);
    expect(armour).toMatch(/^AC: 18 \| Requires STR 15 \| Stealth disadvantage$/m);
    // A weapon and a gear entry sharing the exact name: endpoint order decides.
    expect(lines(await o5GetEquipment("Longsword", "2024", "unavailable"))[0]).toBe("Longsword (Martial Weapon)");
  });

  it("the rarity filter keeps the rare magic item and drops the mundane one", async () => {
    const rare = (await o5SearchItems({ name: "longsword", rarity: "rare", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(rare).toContain("• Flame Tongue Longsword [2024] (Weapon, Rare)");
    expect(rare).not.toContain("• Longsword [2024] (Weapon)");
    expect((await o5SearchItems({ name: "longsword", rulesEdition: "2024" }, "unavailable")).split("\n")).toContain("• Longsword [2024] (Weapon)");
  });

  it("the type filter alone excludes a line", async () => {
    expect(await o5SearchItems({ rulesEdition: "2024" }, "unavailable")).toContain("• Antitoxin [2024] (Potion)");
    const wondrous = (await o5SearchItems({ type: "wondrous", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(wondrous).toContain("• Bag of Holding [2024] (Wondrous Item, Uncommon)");
    expect(wondrous.some(l => l.includes("Antitoxin"))).toBe(false);
  });

  it("equipment detail blocks", async () => {
    expect(lines(await o5GetEquipment("Flame Tongue Longsword", "2024", "unavailable"))[0])
      .toBe("Flame Tongue Longsword (Weapon, Rare | Requires attunement)");
    const dagger = (await o5GetEquipment("Dagger", "2014", "unavailable"))!;
    expect(dagger).toMatch(/^Range: 20\/60 feet$/m);
    expect(dagger).toMatch(/^Properties: Finesse, Light, Thrown \(range 20\/60\)$/m);
    expect(await o5GetEquipment("Chain mail", "2014", "unavailable")).toMatch(/^AC: 16 \| Requires STR 13 \| Stealth disadvantage$/m);
  });

  it("species group by base race: under 2024 the 2024 Elf replaces SRD 5.1's Elf and High Elf", async () => {
    const all = await o5SearchRaces({ rulesEdition: "2024" }, "unavailable");
    expect(all).toContain("• Elf [2024] | Speed: 30 feet");
    expect(all).not.toContain("High Elf [2014]");
    expect(all.split("\n").at(-1)).toBe('4 2014 versions hidden — rules_edition: "2014" shows them.');
    const elf = await o5SearchRaces({ name: "elf", rulesEdition: "2024" }, "unavailable");
    expect(elf.split("\n").slice(0, 2)).toEqual(["Elf", U24]);   // single hit: detail block
    // The 2024 Elf's Elven Lineage trait names the High Elf lineage; SRD 5.1's High Elf itself is not shown.
    expect(elf).not.toContain("High Elf [2014]");
    expect(elf).not.toContain("subrace of");
    expect(elf.split("\n").at(-1)).toBe('2 2014 versions hidden — rules_edition: "2014" shows them.');
  });

  it("species under 2014 list each subrace; naming a subrace finds it under either edition", async () => {
    const elf = (await o5SearchRaces({ name: "elf", rulesEdition: "2014" }, "unavailable")).split("\n");
    expect(elf.filter(l => l.startsWith("• "))).toEqual([
      "• Elf [2014] | Speed: Your base walking speed is 30 feet.",
      "• High Elf [2014] (subrace of Elf) | Speed: Your base walking speed is 30 feet.",
    ]);
    expect(elf.at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
    const high = (await o5SearchRaces({ name: "high elf", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(high.slice(0, 3)).toEqual(["High Elf", U14, "(no 2024 version found — 2014 text shown)"]);
    expect(high.some(l => l.includes("hidden"))).toBe(false);
  });

  it("class detail: saving throws, humanized spellcasting, class-level features only", async () => {
    const wizard = lines(await o5SearchClasses({ name: "wizard", rulesEdition: "2024" }, "unavailable"));
    expect(wizard).toContain("Saving Throws: Intelligence, Wisdom");
    expect(wizard).toContain("Spellcasting: Full");
    expect(wizard).toContain("Features: Ability Score Improvement, Arcane Recovery, Epic Boon, Memorize Spell, Ritual Adept, Scholar, "
      + "Signature Spells, Spell Mastery, Spellcasting, Wizard Spell List, Wizard Subclass");
    const wizard14 = lines(await o5SearchClasses({ name: "wizard", rulesEdition: "2014" }, "unavailable"));
    expect(wizard14).toContain("Features: Ability Score Improvement, Arcane Recovery, Arcane Tradition, Signature Spells, Spell Mastery, Spellcasting");
    expect(wizard14.some(l => l.startsWith("Spellcasting:"))).toBe(false);
  });

  it("background detail lists its benefits", async () => {
    const acolyte = lines(await o5SearchBackgrounds({ name: "acolyte", rulesEdition: "2024" }, "unavailable"));
    expect(acolyte.slice(0, 2)).toEqual(["Acolyte", U24]);
    expect(acolyte).toContain("**Skill Proficiencies:** Insight and Religion");
    expect(acolyte).toContain("**Feat:** Magic Initiate (Cleric)");
  });

  it("feat detail: humanized type, prerequisite, benefits", async () => {
    const grappler = lines(await o5SearchFeats({ name: "grappler", rulesEdition: "2024" }, "unavailable"));
    expect(grappler.slice(2, 4)).toEqual(["Type: General", "Prerequisite: Level 4+, Strength or Dexterity 13+"]);
    expect(grappler).toContain("• You have Advantage on attack rolls against a creature Grappled by you.");
    expect(lines(await o5SearchFeats({ name: "grappler", rulesEdition: "2014" }, "unavailable"))[2]).toBe("Type: General");
    const alert = lines(await o5SearchFeats({ name: "alert", rulesEdition: "2024" }, "unavailable"));
    expect(alert[2]).toBe("Type: Origin");
    expect(alert.some(l => l.startsWith("Prerequisite:"))).toBe(false);
  });

  it("humanize title-cases API enums", () => {
    expect(["FULL", "HALF", "PACT", "GENERAL", "FIGHTING_STYLE", "Epic Boon", "Origin"].map(humanize))
      .toEqual(["Full", "Half", "Pact", "General", "Fighting Style", "Epic Boon", "Origin"]);
  });

  it.each([
    ["races", () => o5SearchRaces({ name: "zzz" }, "unavailable"), "No races found (SRD only)."],
    ["classes", () => o5SearchClasses({ name: "zzz" }, "unavailable"), "No classes found (SRD only)."],
    ["backgrounds", () => o5SearchBackgrounds({ name: "zzz" }, "unavailable"), "No backgrounds found (SRD only)."],
    ["feats", () => o5SearchFeats({ name: "zzz" }, "unavailable"), "No feats found (SRD only)."],
  ])("a %s search with no match gives the plain message", async (_n, call, expected) => {
    expect(await call()).toBe(expected);
  });
});

describe("o5GetMonsterStats", () => {
  const RED_DRAGONS = [
    { name: "Red Dragon Wyrmling", crValue: 4, xp: 1100 }, { name: "Young Red Dragon", crValue: 10, xp: 5900 },
    { name: "Adult Red Dragon", crValue: 17, xp: 18000 }, { name: "Ancient Red Dragon", crValue: 24, xp: 62000 },
  ];

  it("an exact twin name first, the edition from the document", async () => {
    expect(await o5GetMonsterStats("Goblin", "2024")).toEqual({ status: "found", name: "Goblin Warrior", crValue: 0.25, xp: 50, info: { ruleset: "2024", book: null } });
    expect(await o5GetMonsterStats("goblin", "2014")).toMatchObject({ status: "found", name: "Goblin", info: { ruleset: "2014", book: null } });
    expect(await o5GetMonsterStats("Allosaurus", "2014")).toMatchObject({ status: "found", info: { ruleset: "2024", book: null } });
    // 2014-only, asked for under 2024.
    expect(await o5GetMonsterStats("Orc", "2024")).toEqual({ status: "found", name: "Orc", crValue: 0.5, xp: 100, info: { ruleset: "2014", book: null } });
  });

  it("a partial name spanning several creatures is ambiguous, one candidate per twin group, by CR then name", async () => {
    expect(await o5GetMonsterStats("Red Dragon", "2024")).toEqual({ status: "ambiguous", candidates: RED_DRAGONS });
    expect(await o5GetMonsterStats("red dragon", "2014")).toEqual({ status: "ambiguous", candidates: RED_DRAGONS });
  });

  it("a partial name within one twin group is found, picked by edition", async () => {
    expect(await o5GetMonsterStats("Ancient Red", "2024")).toEqual({ status: "found", name: "Ancient Red Dragon", crValue: 24, xp: 62000, info: { ruleset: "2024", book: null } });
    expect(await o5GetMonsterStats("Ancient Red", "2014")).toMatchObject({ status: "found", info: { ruleset: "2014", book: null } });
    expect(await o5GetMonsterStats("Zzyzx", "2024")).toEqual({ status: "not-found" });
  });

  it("is not-found when Open5e fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await o5GetMonsterStats("Wolf", "2024")).toEqual({ status: "not-found" });
  });

  it("logged out, the encounter rater lists the Open5e candidates of an ambiguous name and rates the rest", async () => {
    sessionMocks.hasValidSession.mockReturnValue(false);
    expect(await getMonsterStats("Red Dragon")).toEqual({ status: "ambiguous", candidates: RED_DRAGONS });
    const out = await rateEncounter([{ count: 4, level: 5 }], [{ name: "Red Dragon" }, { name: "Wolf" }], "2024");
    expect(out).toContain('⚠ Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Young Red Dragon (CR 10), Adult Red Dragon (CR 17), Ancient Red Dragon (CR 24) — use the full name.');
    expect(out).toContain("1 × Wolf [2024] (CR 1/4");
    expect(sessionMocks.hasValidSession).toHaveBeenCalled();
  });
});

// ── Final fix wave (2026-10-21) ──────────────────────────────────────────────

describe("Open5e twin keys fold hyphens", () => {
  // Live srd-2014 has 19 magic items whose SRD 5.2 twin differs only by a hyphen.
  const bag14 = o5Record<Record<string, unknown>>("srd-2014", "magicitems", "Bag of Holding");
  const bag24 = o5Record<Record<string, unknown>>("srd-2024", "magicitems", "Bag of Holding");
  const chain14 = { ...bag14, key: "srd_adamantine-armor-chain-mail", name: "Adamantine Armor (Chain-Mail)", category: { name: "Armor", key: "armor" } };
  const chain24 = { ...bag24, key: "srd-2024_adamantine-armor-chain-mail", name: "Adamantine Armor (Chain Mail)", category: { name: "Armor", key: "armor" } };
  beforeEach(() => stubFetch(o5FixtureFetch({
    "srd-2014/magicitems": [...o5Fixture("srd-2014", "magicitems"), chain14],
    "srd-2024/magicitems": [...o5Fixture("srd-2024", "magicitems"), chain24],
  })));

  it("a hyphen-only difference is one twin group, with no reason or rename line", async () => {
    const got24 = (await o5GetEquipment("Adamantine Armor (Chain-Mail)", "2024", "unavailable"))!.split("\n");
    expect(got24.slice(0, 2)).toEqual(["Adamantine Armor (Chain Mail) (Armor, Uncommon)", U24]);
    expect(got24[2]).toBe("");
    const got14 = (await o5GetEquipment("Adamantine Armor (Chain Mail)", "2014", "unavailable"))!.split("\n");
    expect(got14.slice(0, 2)).toEqual(["Adamantine Armor (Chain-Mail) (Armor, Uncommon)", U14]);
    expect(got14[2]).toBe("");
  });

  it("a search lists the group once and counts the other edition", async () => {
    const out = (await o5SearchItems({ name: "adamantine", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(out.filter(l => l.startsWith("• "))).toEqual(["• Adamantine Armor (Chain Mail) [2024] (Armor, Uncommon)"]);
    expect(out.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it("a real rename whose names carry hyphens keeps its line, the right way round", async () => {
    const ante14 = { ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_three-dragon-ante-set", name: "Three-Dragon Ante Set" };
    const ante24 = { ...o5Record<Record<string, unknown>>("srd-2024", "items", "Rope"), key: "srd-2024_three-dragon-ante", name: "Three-Dragon Ante" };
    stubFetch(o5FixtureFetch({
      "srd-2014/items": [...o5Fixture("srd-2014", "items"), ante14],
      "srd-2024/items": [...o5Fixture("srd-2024", "items"), ante24],
    }));
    const out = (await o5GetEquipment("Three-Dragon Ante Set", "2024", "unavailable"))!.split("\n");
    expect(out.slice(0, 3)).toEqual(["Three-Dragon Ante (Adventuring Gear)", U24, "(2014 name: Three-Dragon Ante Set · 2024 name: Three-Dragon Ante)"]);
    const back = (await o5GetEquipment("Three-Dragon Ante", "2014", "unavailable"))!.split("\n");
    expect(back.slice(0, 3)).toEqual(["Three-Dragon Ante Set (Adventuring Gear)", U14, "(2014 name: Three-Dragon Ante Set · 2024 name: Three-Dragon Ante)"]);
  });

  it("the D&D Beyond twinName does not fold hyphens", () => {
    expect(twinName("Adamantine Armor (Chain-Mail)")).not.toBe(twinName("Adamantine Armor (Chain Mail)"));
  });
});

describe("Open5e rarity filter", () => {
  const potion = {
    ...o5Record<Record<string, unknown>>("srd-2024", "magicitems", "Bag of Holding"),
    key: "srd-2024_potion-of-climbing", name: "Potion of Climbing",
    category: { name: "Potion", key: "potion" }, rarity: { name: "Common", key: "common", rank: 1 },
  };
  beforeEach(() => stubFetch(o5FixtureFetch({ "srd-2024/magicitems": [...o5Fixture("srd-2024", "magicitems"), potion] })));
  const listed = async (rarity: string) => (await o5SearchItems({ rarity, rulesEdition: "2024" }, "unavailable"))
    .split("\n").filter(l => l.startsWith("• "));

  it("\"common\" lists mundane gear and Common magic items, not Uncommon ones", async () => {
    const common = await listed("common");
    expect(common).toContain("• Potion of Climbing [2024] (Potion, Common)");
    expect(common).toContain("• Antitoxin [2024] (Potion)");
    expect(common).toContain("• Rope [2024] (Adventuring Gear)");
    expect(common.some(l => l.includes("Uncommon"))).toBe(false);
    expect(common.some(l => l.includes("Bag of Holding"))).toBe(false);
  });

  it("\"uncommon\" still lists Uncommon magic items only", async () => {
    const uncommon = await listed("Uncommon");
    expect(uncommon).toContain("• Bag of Holding [2024] (Wondrous Item, Uncommon)");
    expect(uncommon.every(l => l.endsWith(", Uncommon)"))).toBe(true);
  });
});

describe("Open5e searches capped at 20 lines", () => {
  const many = (doc: "srd-2024" | "srd-2014", endpoint: "creatures" | "items", base: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...o5Record<Record<string, unknown>>(doc, endpoint, base), key: `${doc}_x${i}`, name: `${base} ${String(i).padStart(2, "0")}` }));
  const REFINE = "*Refine your search to see more results.*";

  it("a capped monster search adds the refine hint before the footer", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [...o5Fixture("srd-2024", "creatures"), ...many("srd-2024", "creatures", "Wolf", 25)] }));
    const out = (await o5SearchMonsters({ name: "wolf", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(out.filter(l => l.startsWith("• "))).toHaveLength(20);
    expect(out.slice(-3)).toEqual(["", REFINE, '1 2014 version hidden — rules_edition: "2014" shows it.']);
  });

  it("a capped item search adds the refine hint; an uncapped one does not", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/items": many("srd-2024", "items", "Rope", 21), "srd-2014/items": [] }));
    const out = (await o5SearchItems({ name: "rope", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(out.filter(l => l.startsWith("• "))).toHaveLength(20);
    expect(out.slice(-2)).toEqual(["", REFINE]);
    expect(await o5SearchItems({ name: "rope 0", rulesEdition: "2024" }, "unavailable")).not.toContain(REFINE);
    expect(await o5SearchMonsters({ name: "wolf", rulesEdition: "2024" }, "unavailable")).not.toContain(REFINE);
  });
});

describe("o5GetRule query jump folds like the search", () => {
  it("a straight apostrophe, odd case and doubled spaces jump to SRD 5.2's curly \"can’t\"; the output keeps the original text", async () => {
    const out = (await o5GetRule("The Order of Combat", "2024", 4000, "If you CAN'T  decide"))!;
    const body = out.split("\n").slice(4).join("\n");
    expect(body.startsWith("…\n\n")).toBe(true);
    const at = body.indexOf("If you can’t decide what to do");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(220);
    expect(body).not.toContain("can't decide");
  });

  it("a query that is not in the text leaves the start alone", async () => {
    const out = (await o5GetRule("The Order of Combat", "2024", 4000, "zzzz"))!;
    expect(out.split("\n").slice(4).join("\n").startsWith("…")).toBe(false);
  });
});

describe("Open5e weapon and armour gets carry the items record's cost and weight", () => {
  // Live srd-2024 items, 2026-10-21: Chain Mail 75 gp / 55 lb, Shield 10 gp / 6 lb.
  const gear = (name: string, cost: string, weight: string) => ({
    ...o5Record<Record<string, unknown>>("srd-2024", "items", "Rope"), key: `srd-2024_${name.toLowerCase().replace(/ /g, "-")}`, name,
    category: { name: "Armor", key: "armor" }, cost, weight, weight_unit: "lb",
  });
  const lines = async (name: string, ed: "2024" | "2014") => (await o5GetEquipment(name, ed, "unavailable"))!.split("\n");

  it("Longsword in both editions", async () => {
    for (const ed of ["2024", "2014"] as const) {
      const out = await lines("Longsword", ed);
      expect(out[0]).toBe("Longsword (Martial Weapon)");
      expect(out.at(-1)).toBe("Cost: 15 gp | Weight: 3 lb");
    }
  });

  it("2024 Chain Mail and the 2024 Shield, from their items twins", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/items": [...o5Fixture("srd-2024", "items"), gear("Chain Mail", "75.00", "55.000"), gear("Shield", "10.00", "6.000")] }));
    const chain = await lines("Chain Mail", "2024");
    expect(chain.slice(2)).toEqual(["AC: 16 | Requires STR 13 | Stealth disadvantage", "Cost: 75 gp | Weight: 55 lb"]);
    const shield = await lines("Shield", "2024");
    expect(shield.slice(2)).toEqual(["AC: +2", "Cost: 10 gp | Weight: 6 lb"]);
  });

  it("no items twin in the document: no cost line", async () => {
    // The recorded srd-2024 items have no Chain Mail.
    expect((await lines("Chain Mail", "2024")).some(l => l.startsWith("Cost:"))).toBe(false);
    expect((await lines("Dagger", "2014")).some(l => l.startsWith("Cost:"))).toBe(false);
  });
});

describe("Open5e species and background desc", () => {
  const detail = async (call: Promise<string>) => (await call).split("\n");

  it("a 2014 species prints its desc after the size and speed line, before the traits", async () => {
    const dwarf = await detail(o5SearchRaces({ name: "dwarf", rulesEdition: "2014" }, "unavailable"));
    expect(dwarf.slice(0, 2)).toEqual(["Dwarf", U14]);
    expect(dwarf[2]).toMatch(/^Size: .* \| Speed: /);
    expect(dwarf.slice(3, 6)).toEqual(["", "Your dwarf character has an assortment of inborn abilities, part and parcel of dwarven nature.", ""]);
    expect(dwarf[6]).toMatch(/^\*\*[^*]+\.\*\* /);
    const high = await detail(o5SearchRaces({ name: "high elf", rulesEdition: "2014" }, "unavailable"));
    expect(high).toContain("As a high elf, you have a keen mind and a mastery of at least the basics of magic. In many fantasy gaming worlds, "
      + "there are two kinds of high elves. One type is haughty and reclusive, believing themselves to be superior to non-elves and even other elves. "
      + "The other type is more common and more friendly, and often encountered among humans and other races.");
  });

  it("the 2014 Acolyte prints its desc before its benefits", async () => {
    const acolyte = await detail(o5SearchBackgrounds({ name: "acolyte", rulesEdition: "2014" }, "unavailable"));
    expect(acolyte.slice(0, 3)).toEqual(["Acolyte", U14, ""]);
    expect(acolyte[3]).toMatch(/^You have spent your life in the service of a temple to a specific god or pantheon of gods\./);
    // The desc keeps its own paragraphs; the benefits follow it after a blank line.
    const firstBenefit = acolyte.findIndex(l => /^\*\*[^*]+:\*\* /.test(l));
    expect(firstBenefit).toBeGreaterThan(4);
    expect(acolyte[firstBenefit - 1]).toBe("");
  });

  it("an empty SRD 5.2 desc adds no blank paragraph", async () => {
    const acolyte = await detail(o5SearchBackgrounds({ name: "acolyte", rulesEdition: "2024" }, "unavailable"));
    expect(acolyte.slice(0, 4)).toEqual(["Acolyte", U24, "", acolyte[3]]);
    expect(acolyte[3]).toMatch(/^\*\*[^*]+:\*\* /);
    const elf = await detail(o5SearchRaces({ name: "elf", rulesEdition: "2024" }, "unavailable"));
    expect(elf[3]).toBe("");
    expect(elf[4]).toMatch(/^\*\*[^*]+\.\*\* /);
  });
});
