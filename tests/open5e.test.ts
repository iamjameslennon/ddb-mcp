import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Logged out, so getMonsterStats goes straight to Open5e and no real session file is read.
const sessionMocks = vi.hoisted(() => ({ hasValidSession: vi.fn(() => false) }));
vi.mock("../src/session-fetch.js", async (orig) => ({
  ...(await orig<typeof import("../src/session-fetch.js")>()),
  hasValidSession: sessionMocks.hasValidSession,
}));
import { readFileSync } from "node:fs";
import { createTwinNamer, open5eSearchHeader, twinNames, type RulesEdition } from "../src/edition.js";
import { EDITION_RENAMES, OPEN5E_ARMOUR_RENAMES, OPEN5E_EQUIPMENT_RENAMES } from "../src/edition-renames.js";
import { o5Fixture, o5FixtureFetch, o5Record } from "./fixtures/open5e-v2.js";
import {
  clearOpen5eCache,
  o5GetSpell, o5GetMonster, o5GetEquipment, o5MonsterInEdition,
  o5SearchSpells, o5SearchMonsters, o5SearchItems,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats, o5SearchFeatsSection, o5SearchRacesSection,
  o5SearchRules, o5GetRule, o5GetMonsterStats, crText, castingTime, humanize, o5TwinNameFor, o5EquipmentKey, o5EquipmentGroupKey,
  type O5Record,
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
    const lines = out.split("\n");
    const jump = lines.findIndex(l => l.startsWith("…"));
    expect(jump).toBeGreaterThan(0);
    const body = lines.slice(jump).join("\n");
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

  it("an offset past the end keeps the Open5e header and prints the shared past-the-end line", async () => {
    const out = await o5SearchSpells({ offset: 50, rulesEdition: "2024" }, "unavailable");
    const lines = out.split("\n");
    expect(lines[0]).toBe(open5eSearchHeader("2024", "unavailable"));
    expect(lines[1]).toMatch(/^\*\*Spell Search\*\* — offset 50 is past the end \(\d+ found\)$/);
    expect(out).not.toContain("•");
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
    // A document is never empty on Open5e (the loader rejects an empty one), so keep one record that does not match.
    stubFetch(o5FixtureFetch({ "srd-2024/spells": o5Fixture("srd-2024", "spells").slice(0, 1), "srd-2014/spells": o5Fixture("srd-2014", "spells").slice(0, 1) }));
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
  it("G6: item and spell searches keep substring matching (only monster names are word-start)", async () => {
    const items = await o5SearchItems({ name: "ongsword", rulesEdition: "2024" }, "unavailable");
    expect(items).toContain("• Longsword [2024]");
    expect(items).toContain("• Flame Tongue Longsword [2024]");
    const spells = await o5SearchSpells({ name: "eeblemin", rulesEdition: "2024" }, "unavailable");
    expect(spells).toContain("• Feeblemind [2014]");
    expect(await o5SearchSpells({ name: "ireball", rulesEdition: "2024" }, "unavailable")).toContain("• Fireball [2024]");
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
    // Single hit: the detail block, with the rename line a get would print.
    expect(out.split("\n").slice(0, 3)).toEqual(["Evoker", U24, "(2014 name: School of Evocation · 2024 name: Evoker)"]);
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
    expect(twinNames.item("Hide")).toBe("hide");
    expect(twinNames.item("Plate Armor")).toBe("plate armor");
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

  it("table columns typed as class features are not listed (live 2014 Warlock, 2024 Druid)", async () => {
    // The recorded records still carry the rows, typed CLASS_LEVEL_FEATURE with the "[Column data]" desc.
    const rows = (doc: "srd-2014" | "srd-2024", name: string) => (o5Record<{ features: Array<{ name: string; desc: string; feature_type: string }> }>(doc, "classes", name)).features;
    expect(rows("srd-2014", "Warlock").filter(f => f.desc === "[Column data]").map(f => f.name)).toEqual(expect.arrayContaining(["Invocations Known", "Slot Level"]));
    expect(rows("srd-2024", "Druid").filter(f => f.desc === "[Column data]").map(f => f.name)).toContain("Cantrips Known");
    const featuresOf = async (name: string, edition: "2014" | "2024") =>
      (await o5SearchClasses({ name, rulesEdition: edition }, "unavailable")).split("\n").find(l => l.startsWith("Features: "))!;
    const warlock = await featuresOf("Warlock", "2014");
    for (const col of ["Invocations Known", "Slot Level", "Spells Known"]) expect(warlock).not.toContain(col);
    expect(warlock).toContain("Pact Magic");
    expect(warlock).toContain("Eldritch Invocations");
    const druid = await featuresOf("Druid", "2024");
    expect(druid).not.toContain("Cantrips Known");
    expect(druid).toContain("Wild Shape");
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

describe("Open5e hidden count against what the other edition lists", () => {
  // SRD 5.1's "Playing card set" and SRD 5.2's "Gaming Set, Playing Cards" are one twin group, and a group
  // matches the query when any member's name does ("cards" is in only one of them).
  beforeEach(() => {
    const v2 = o5FixtureFetch({
      "srd-2014/items": [...o5Fixture("srd-2014", "items"), { ...o5Record<O5Record>("srd-2014", "items", "Abacus"), key: "srd-2014_playing-card-set", name: "Playing card set" }],
      "srd-2024/items": [...o5Fixture("srd-2024", "items"), { ...o5Record<O5Record>("srd-2024", "items", "Rope"), key: "srd-2024_gaming-set-playing-cards", name: "Gaming Set, Playing Cards" }],
    });
    stubFetch(v2);
  });

  it("a hidden twin whose own name lacks the query is counted, and the other edition lists it", async () => {
    const in2024 = (await o5SearchItems({ name: "cards", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(in2024).toContain("• Gaming Set, Playing Cards [2024] (Adventuring Gear)");
    expect(in2024.at(-1)).toBe("1 2014 version hidden — rules_edition: \"2014\" shows it.");
    const in2014 = (await o5SearchItems({ name: "cards", rulesEdition: "2014" }, "unavailable")).split("\n");
    expect(in2014).toContain("• Playing card set [2014] (Adventuring Gear)");
    expect(in2014.at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
  });
});

describe("o5GetMonsterStats", () => {
  const RED_DRAGONS = [
    { name: "Red Dragon Wyrmling", crValue: 4, xp: 1100 }, { name: "Half-Red Dragon Veteran", crValue: 5, xp: 1800 },
    { name: "Young Red Dragon", crValue: 10, xp: 5900 },
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

  it("a hyphen-less name finds hyphenated creatures, exact (Will-o'-Wisp) and partial (Half-Red Dragon Veteran)", async () => {
    const wisp = { ...o5Record<Record<string, unknown>>("srd-2024", "creatures", "Wolf"), key: "srd-2024_will-o-wisp", name: "Will-o'-Wisp" };
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [...o5Fixture("srd-2024", "creatures"), wisp] }));
    expect(await o5GetMonsterStats("will o wisp", "2024")).toMatchObject({ status: "found", name: "Will-o'-Wisp", info: { ruleset: "2024" } });
    expect(await o5GetMonsterStats("will o' wisp", "2024")).toMatchObject({ status: "found", name: "Will-o'-Wisp" });
    expect(await o5GetMonsterStats("Will-o’-Wisp", "2024")).toMatchObject({ status: "found", name: "Will-o'-Wisp" });
    expect((await o5GetMonster("will o wisp", "2024", "unavailable"))!.split("\n")[0]).toContain("Will-o'-Wisp");
    expect(await o5GetMonsterStats("half red dragon", "2014")).toMatchObject({ status: "found", name: "Half-Red Dragon Veteran", crValue: 5 });
  });

  it("a partial name within one twin group is found, picked by edition", async () => {
    expect(await o5GetMonsterStats("Ancient Red", "2024")).toEqual({ status: "found", name: "Ancient Red Dragon", crValue: 24, xp: 62000, info: { ruleset: "2024", book: null } });
    expect(await o5GetMonsterStats("Ancient Red", "2014")).toMatchObject({ status: "found", info: { ruleset: "2014", book: null } });
    expect(await o5GetMonsterStats("Zzyzx", "2024")).toEqual({ status: "not-found" });
  });

  it("is unavailable when Open5e fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await o5GetMonsterStats("Wolf", "2024")).toEqual({ status: "unavailable" });
  });

  it("logged out, the encounter rater lists the Open5e candidates of an ambiguous name and rates the rest", async () => {
    sessionMocks.hasValidSession.mockReturnValue(false);
    expect(await getMonsterStats("Red Dragon")).toEqual({ status: "ambiguous", candidates: RED_DRAGONS });
    const out = await rateEncounter([{ count: 4, level: 5 }], [{ name: "Red Dragon" }, { name: "Wolf" }], "2024");
    expect(out).toContain('⚠ Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Half-Red Dragon Veteran (CR 5), Young Red Dragon (CR 10), Adult Red Dragon (CR 17), Ancient Red Dragon (CR 24) — use the full name.');
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

  it("a 2014 Shield, an items record with no armour twin, carries the SRD's AC: +2", async () => {
    // Live srd-2014 items, 2026-10-21: category "Shield", armor null, 10 gp / 6 lb.
    const shield = { ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_shield", name: "Shield", category: { name: "Shield", key: "shield" },
      cost: "10.00", weight: "6.000", desc: "A shield is made from wood or metal and is carried in one hand. Wielding a shield increases your Armor Class by 2." };
    stubFetch(o5FixtureFetch({ "srd-2014/items": [...o5Fixture("srd-2014", "items"), shield] }));
    expect((await o5GetEquipment("Shield", "2014", "unavailable"))!.split("\n").slice(0, 4))
      .toEqual(["Shield (Shield)", U14, "AC: +2", "Cost: 10 gp | Weight: 6 lb"]);
  });

  it("a real rename whose names carry hyphens keeps its line, the right way round", async () => {
    const tent14 = { ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_tent-two-person", name: "Tent, Two-Person" };
    const tent24 = { ...o5Record<Record<string, unknown>>("srd-2024", "items", "Rope"), key: "srd-2024_tent", name: "Tent" };
    stubFetch(o5FixtureFetch({
      "srd-2014/items": [...o5Fixture("srd-2014", "items"), tent14],
      "srd-2024/items": [...o5Fixture("srd-2024", "items"), tent24],
    }));
    const out = (await o5GetEquipment("Tent, Two-Person", "2024", "unavailable"))!.split("\n");
    expect(out.slice(0, 3)).toEqual(["Tent (Adventuring Gear)", U24, "(2014 name: Tent, Two-Person · 2024 name: Tent)"]);
    const back = (await o5GetEquipment("Tent", "2014", "unavailable"))!.split("\n");
    expect(back.slice(0, 3)).toEqual(["Tent, Two-Person (Adventuring Gear)", U14, "(2014 name: Tent, Two-Person · 2024 name: Tent)"]);
  });

  describe("hyphen-less queries", () => {
    const ante14 = { ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_three-dragon-ante-set", name: "Three-Dragon Ante Set" };
    const ante24 = { ...o5Record<Record<string, unknown>>("srd-2024", "items", "Rope"), key: "srd-2024_three-dragon-ante", name: "Three-Dragon Ante" };
    const tent14 = { ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_tent-two-person", name: "Tent, Two-Person" };
    const tent24 = { ...o5Record<Record<string, unknown>>("srd-2024", "items", "Rope"), key: "srd-2024_tent", name: "Tent" };
    const LINE = "(2014 name: Tent, Two-Person · 2024 name: Tent)";
    const withAnte = (only?: "srd-2014" | "srd-2024") => stubFetch(o5FixtureFetch({
      "srd-2014/items": [...o5Fixture("srd-2014", "items"), ...(only === "srd-2024" ? [] : [ante14, tent14])],
      "srd-2024/items": [...o5Fixture("srd-2024", "items"), ...(only === "srd-2014" ? [] : [ante24, tent24])],
    }));

    it.each([
      ["Tent, Two-Person", "2024", "Tent"],
      ["Tent", "2014", "Tent, Two-Person"],
      ["tent, two person", "2024", "Tent"],
      ["tent", "2014", "Tent, Two-Person"],
    ] as const)("%s under %s shows the SRD's own spellings on both sides of the rename line", async (query, edition, shown) => {
      withAnte();
      const out = (await o5GetEquipment(query, edition, "unavailable"))!.split("\n");
      expect(out[0]).toBe(`${shown} (Adventuring Gear)`);
      expect(out[2]).toBe(LINE);
    });

    it("with only the shown edition loaded, the other side is the table's spelling, not the typed text", async () => {
      withAnte("srd-2024");
      const out = (await o5GetEquipment("tent, two person", "2024", "unavailable"))!.split("\n");
      expect(out[0]).toBe("Tent (Adventuring Gear)");
      expect(out).toContain(LINE);
    });

    it("a pair that differs only by the word \"set\" (Three-Dragon Ante) gets no rename line, hyphens or not", async () => {
      withAnte();
      for (const [query, edition, shown] of [["Three-Dragon Ante Set", "2024", "Three-Dragon Ante"], ["three dragon ante", "2014", "Three-Dragon Ante Set"]] as const) {
        const out = (await o5GetEquipment(query, edition, "unavailable"))!.split("\n");
        expect(out[0]).toBe(`${shown} (Adventuring Gear)`);
        expect(out.some(l => l.includes("2014 name:"))).toBe(false);
      }
    });

    it("a hyphen-less search finds a hyphenated name", async () => {
      withAnte();
      const out = await o5SearchItems({ name: "three dragon ante", rulesEdition: "2024" }, "unavailable");
      expect(out.split("\n").filter(l => l.startsWith("• "))).toEqual(["• Three-Dragon Ante [2024] (Adventuring Gear)"]);
      expect(await o5SearchItems({ name: "dragon ante set", rulesEdition: "2014" }, "unavailable")).toContain("• Three-Dragon Ante Set [2014]");
    });

    it("a hyphen-less partial lookup finds a hyphenated name", async () => {
      withAnte();
      expect((await o5GetEquipment("dragon ante", "2024", "unavailable"))!.split("\n")[0]).toBe("Three-Dragon Ante (Adventuring Gear)");
    });

    it("a hyphen-less species search finds a hyphenated name", async () => {
      const half = { ...o5Record<Record<string, unknown>>("srd-2024", "species", "Goliath"), key: "srd-2024_half-elf-x", name: "Half-Elf Test" };
      stubFetch(o5FixtureFetch({ "srd-2024/species": [...o5Fixture("srd-2024", "species"), half] }));
      expect(await o5SearchRaces({ name: "half elf test", rulesEdition: "2024" }, "unavailable")).toContain("Half-Elf Test");
    });
  });

  it("the D&D Beyond twin namers do not fold hyphens", () => {
    expect(twinNames.item("Adamantine Armor (Chain-Mail)")).not.toBe(twinNames.item("Adamantine Armor (Chain Mail)"));
  });
});

// Decision 5 (carry-over (a)): each Open5e endpoint uses only its own kind's pairs.
describe("Open5e twin names by endpoint kind", () => {
  it("creatures use the monster pairs; feats, species and rulesets use none", () => {
    expect(o5TwinNameFor("creatures")("Thug")).toBe("tough");
    expect(o5TwinNameFor("creatures")("School of Evocation")).toBe("school of evocation");
    // One 2014 name of each kind's pairs, plus an Open5e armour pair.
    for (const endpoint of ["feats", "species", "rulesets"] as const) {
      for (const name of ["Thug", "Leather", "School of Evocation", "Acid Arrow", "Efficient Quiver", "Criminal / Spy"]) {
        expect(o5TwinNameFor(endpoint)(name)).toBe(name.toLowerCase());
      }
    }
  });

  // Owner ruling 2026-10-29: Open5e files subclasses on /classes/, so it takes the subclass pairs.
  it("classes, which hold Open5e's subclasses, use the subclass pairs and no other kind's", () => {
    expect(o5TwinNameFor("classes")("School of Evocation")).toBe("evoker");
    expect(o5TwinNameFor("classes")("Wizard")).toBe("wizard");
    for (const name of ["Thug", "Leather", "Acid Arrow", "Efficient Quiver", "Criminal / Spy"]) {
      expect(o5TwinNameFor("classes")(name)).toBe(name.toLowerCase());
    }
  });

  it("items, magic items, weapons and armour use the item pairs plus the armour pairs", () => {
    // Their twin key is o5EquipmentKey: the item pairs' key with its words sorted (M1).
    for (const endpoint of ["items", "magicitems", "weapons", "armor"] as const) {
      expect(o5TwinNameFor(endpoint)("Efficient Quiver")).toBe("ehlonna of quiver");
      expect(o5TwinNameFor(endpoint)("Leather")).toBe("armor leather");
      expect(o5TwinNameFor(endpoint)("Thug")).toBe("thug");
    }
    expect(o5TwinNameFor("creatures")("Donkey (or Mule)")).toBe("donkey (or mule)");
  });

  it("spells use the spell pairs only, backgrounds the background pairs only", () => {
    expect(o5TwinNameFor("spells")("Acid Arrow")).toBe("melfs acid arrow");
    expect(o5TwinNameFor("spells")("Leather")).toBe("leather");
    expect(o5TwinNameFor("backgrounds")("Criminal / Spy")).toBe("criminal");
    expect(o5TwinNameFor("backgrounds")("Acolyte")).toBe("acolyte");
    expect(o5TwinNameFor("creatures")("Acolyte")).toBe("priest acolyte");
  });

  it("keeps the hyphen and apostrophe fold on every kind", () => {
    expect(o5TwinNameFor("creatures")("Will-o'-Wisp")).toBe(o5TwinNameFor("creatures")("will o wisp"));
    expect(o5TwinNameFor("spells")("Melf’s Acid Arrow")).toBe(o5TwinNameFor("spells")("Acid Arrow"));
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

  it("a capped monster search shows 50 lines, then the narrowing hint before the footer", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [...o5Fixture("srd-2024", "creatures"), ...many("srd-2024", "creatures", "Wolf", 55)] }));
    const out = (await o5SearchMonsters({ name: "wolf", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(out.filter(l => l.startsWith("• "))).toHaveLength(50);
    expect(out.some(l => l.startsWith("Found ") && l.includes("(showing 50, SRD only):"))).toBe(true);
    expect(out.join("\n")).not.toContain(REFINE);
    const hint = out.find(l => l.startsWith("Narrow the search"))!;
    // C2: Open5e cannot filter by book, so the hint never suggests source.
    expect(hint).toMatch(/^Narrow the search \(add cr, type or size\), or repeat with `list_all: true` to list all \d+ \(about \d+ KB\)\.$/);
    expect(out[out.length - 1]).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it("G5: the capped heading counts every match, and the hint's size estimate is the shown lines' average times the total", async () => {
    // Long names, so the size estimate is several KB and a wrong count or average changes the rounded figure.
    const long = many("srd-2024", "creatures", "Wolf", 55).map(r => ({ ...r, name: `${r.name} ${"x".repeat(300)}` }));
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": long }));
    // The 55 added Wolf records plus the fixture's 2014 Wolf (no 2024 twin, so it stays).
    const TOTAL = 56;
    const lines = (await o5SearchMonsters({ name: "wolf", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(lines).toContain(`Found ${TOTAL} monster(s) (showing 50, SRD only):`);
    const shown = lines.filter(l => l.startsWith("• "));
    expect(shown).toHaveLength(50);
    const avg = shown.reduce((n, l) => n + Buffer.byteLength(l), 0) / shown.length;
    const kb = Math.round(avg * TOTAL / 1024);
    const hint = lines.find(l => l.startsWith("Narrow the search"))!;
    expect(hint).toContain(`to list all ${TOTAL} (about`);
    expect(hint).toBe(`Narrow the search (add cr, type or size), or repeat with \`list_all: true\` to list all ${TOTAL} (about ${kb} KB).`);
  });

  it("monster hint names only the unused filters, and ddb_search_monsters under siteSearch", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": many("srd-2024", "creatures", "Wolf", 55) }));
    const some = await o5SearchMonsters({ name: "wolf", source: "x", rulesEdition: "2024" }, "unavailable");
    expect(some).toContain("(add cr, type or size)");
    const site = await o5SearchMonsters({ name: "wolf", siteSearch: true, listAll: true, rulesEdition: "2024" }, "unavailable");
    expect(site.split("\n").filter(l => l.startsWith("• "))).toHaveLength(50);
    expect(site).toContain("use ddb_search_monsters with `list_all: true`");
  });

  it("a size search over more than 50 records lists 50 plus the hint, or all with listAll", async () => {
    const meds = many("srd-2024", "creatures", "Wolf", 60).map(r => ({ ...r, size: { key: "medium", name: "Medium" } }));
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": meds, "srd-2014/creatures": [o5Record("srd-2014", "creatures", "Goblin")] }));
    const capped = await o5SearchMonsters({ size: "medium", rulesEdition: "2024" }, "unavailable");
    expect(capped.split("\n").filter(l => l.startsWith("• "))).toHaveLength(50);
    expect(capped).toContain("`list_all: true`");
    const all = await o5SearchMonsters({ size: "medium", listAll: true, rulesEdition: "2024" }, "unavailable");
    expect(all.split("\n").filter(l => l.startsWith("• "))).toHaveLength(60);
    expect(all).toContain("(showing 60, SRD only):");
    expect(all).not.toContain("list_all");
  });

  it("C5: a monster name search lists the query's twin first (R5), then A-Z", async () => {
    const mk = (key: string, name: string) => ({ ...o5Record<Record<string, unknown>>("srd-2024", "creatures", "Wolf"), key: `srd-2024_${key}`, name });
    stubFetch(o5FixtureFetch({
      "srd-2024/creatures": [mk("goblin-minion", "Goblin Minion"), mk("goblin-warrior", "Goblin Warrior"), mk("goblin-boss", "Goblin Boss"), mk("aardvark", "Aardvark Goblin")],
      "srd-2014/creatures": [o5Record("srd-2014", "creatures", "Wolf")],
    }));
    const names = (out: string) => out.split("\n").filter(l => l.startsWith("• ")).map(l => l.slice(2, l.indexOf(" [")));
    expect(names(await o5SearchMonsters({ name: "goblin", rulesEdition: "2024" }, "unavailable")))
      .toEqual(["Goblin Warrior", "Aardvark Goblin", "Goblin Boss", "Goblin Minion"]);
    // Without a name: A-Z.
    expect(names(await o5SearchMonsters({ size: "medium", rulesEdition: "2024" }, "unavailable")).filter(n => n.includes("Goblin")))
      .toEqual(["Aardvark Goblin", "Goblin Boss", "Goblin Minion", "Goblin Warrior"]);
  });

  it("monster name matching is at word starts: goblin skips Hobgoblin, will o wisp finds Will-o'-Wisp", async () => {
    const mk = (key: string, name: string) => ({ ...o5Record<Record<string, unknown>>("srd-2024", "creatures", "Wolf"), key: `srd-2024_${key}`, name });
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [mk("goblin-x", "Goblin Scout"), mk("hob", "Hobgoblin Captain"), mk("wisp", "Will-o'-Wisp")], "srd-2014/creatures": [o5Record("srd-2014", "creatures", "Goblin")] }));
    const gob = await o5SearchMonsters({ name: "goblin", rulesEdition: "2024" }, "unavailable");
    expect(gob).toContain("Goblin Scout");
    expect(gob).not.toContain("Hobgoblin");
    expect(await o5SearchMonsters({ name: "will o wisp", rulesEdition: "2024" }, "unavailable")).toContain("Will-o'-Wisp");
  });

  it("a capped item search adds the refine hint; an uncapped one does not", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/items": many("srd-2024", "items", "Rope", 21), "srd-2014/items": [o5Record("srd-2014", "items", "Abacus")] }));
    const out = (await o5SearchItems({ name: "rope", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(out.filter(l => l.startsWith("• "))).toHaveLength(20);
    expect(out.slice(-2)).toEqual(["", REFINE]);
    expect(out.join("\n")).toContain("showing 20");
    expect(await o5SearchItems({ name: "rope 0", rulesEdition: "2024" }, "unavailable")).not.toContain(REFINE);
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

  it("a query that is not found says so right after the Rules:/Part of lines and still shows the section's start", async () => {
    const out = (await o5GetRule("The Order of Combat", "2024", 4000, "zzznotthere"))!;
    const lines = out.split("\n");
    expect(lines[3]).toBe('*"zzznotthere" not found in The Order of Combat — showing its start. Try ddb_search_rules.*');
    expect(lines[2]).toMatch(/^\*Part of /);
    expect(out).toContain("\n\n");
    expect(lines.slice(5).join("\n").startsWith("…")).toBe(false);
    expect((await o5GetRule("The Order of Combat", "2024", 4000, "initiative"))!).not.toContain("not found in");
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

describe("Open5e single-hit option detail carries the get's rename line", () => {
  it("no rename line when the query is the shown name, or when several lines are listed", async () => {
    const evoker = (await o5SearchClasses({ name: "evoker", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(evoker.slice(0, 2)).toEqual(["Evoker", U24]);
    expect(evoker.some(l => l.includes("2014 name:"))).toBe(false);
    expect(await o5SearchClasses({ rulesEdition: "2024" }, "unavailable")).not.toContain("2014 name:");
  });

  it("under 2014 the 2024 name reaches SRD 5.1's entry, with the rename line", async () => {
    const school = (await o5SearchClasses({ name: "evoker", rulesEdition: "2014" }, "unavailable")).split("\n");
    expect(school.slice(0, 3)).toEqual(["School of Evocation", U14, "(2014 name: School of Evocation · 2024 name: Evoker)"]);
  });

  it("decision 4 suppresses a false rename line: an SRD 5.2 entry under its 2014-era name", async () => {
    // Contrived, so that a search reaches the case: each document files the subclass under the other edition's
    // name, as SRD 5.2 keeps "Arcane Hand" for spells. The query matches SRD 5.1's "Evoker" exactly.
    const swap = (doc: "srd-2024" | "srd-2014", from: string, to: string) =>
      o5Fixture<Record<string, unknown>>(doc, "classes").map(c => (c.name === from ? { ...c, name: to } : c));
    stubFetch(o5FixtureFetch({
      "srd-2024/classes": swap("srd-2024", "Evoker", "School of Evocation"),
      "srd-2014/classes": swap("srd-2014", "School of Evocation", "Evoker"),
    }));
    const out = (await o5SearchClasses({ name: "evoker", rulesEdition: "2024" }, "unavailable")).split("\n");
    expect(out.slice(0, 2)).toEqual(["School of Evocation", U24]);
    expect(out.some(l => l.includes("2014 name:"))).toBe(false);
  });
});

describe("Open5e spell Duration is capitalized", () => {
  it("\"instantaneous\" → \"Instantaneous\"; a number stays as it is", async () => {
    expect(await o5GetSpell("Fireball", "2024", "unavailable")).toMatch(/^Duration: Instantaneous$/m);
    expect(await o5GetSpell("Sleep", "2014", "unavailable")).toMatch(/^Duration: 1 minute$/m);
  });
  it("\"concentration, up to 1 minute\" → \"Concentration, up to 1 minute\"", async () => {
    const sleep = { ...o5Record<Record<string, unknown>>("srd-2024", "spells", "Sleep"), duration: "concentration, up to 1 minute" };
    stubFetch(o5FixtureFetch({ "srd-2024/spells": [sleep] }));
    expect(await o5GetSpell("Sleep", "2024", "unavailable")).toMatch(/^Duration: Concentration, up to 1 minute$/m);
  });
});

// Carry-over (r), decision 6: Open5e equipment twin keys fold word order, weapon words and price or count parts (M1–M3), plus six verified pairs.
describe("Open5e equipment twin keys (M1–M3 and six verified pairs)", () => {
  const lines = async (name: string, ed: "2024" | "2014") => (await o5GetEquipment(name, ed, "unavailable"))!.split("\n");
  const bullets = (out: string) => out.split("\n").filter(l => l.startsWith("• "));

  it("Hand Crossbow under 2014 shows SRD 5.1 Crossbow, hand with a rename line", async () => {
    const LINE = "(2014 name: Crossbow, hand · 2024 name: Hand Crossbow)";
    expect((await lines("Hand Crossbow", "2014")).slice(0, 3)).toEqual(["Crossbow, hand (Martial Weapon)", U14, LINE]);
    expect((await lines("Crossbow, hand", "2024")).slice(0, 3)).toEqual(["Hand Crossbow (Martial Weapon)", U24, LINE]);
    expect((await lines("Hand Crossbow", "2024")).slice(0, 3)).toEqual(["Hand Crossbow (Martial Weapon)", U24, "Damage: 1d6 Piercing"]);
  });

  it("a 2024 flame tongue search hides the 4 SRD 5.1 Flame Tongues and counts them", async () => {
    const out = await o5SearchItems({ name: "flame tongue", rulesEdition: "2024" }, "unavailable");
    expect(bullets(out)).toEqual([
      "• Flame Tongue Greatsword [2024] (Weapon, Rare)", "• Flame Tongue Longsword [2024] (Weapon, Rare)",
      "• Flame Tongue Rapier [2024] (Weapon, Rare)", "• Flame Tongue Shortsword [2024] (Weapon, Rare)",
    ]);
    expect(out.split("\n").at(-1)).toBe('4 2014 versions hidden — rules_edition: "2014" shows them.');
    expect(bullets(await o5SearchItems({ name: "flame tongue", rulesEdition: "2014" }, "unavailable"))).toEqual([
      "• Flame Tongue (Greatsword) [2014] (Weapon, Rare)", "• Flame Tongue (Longsword) [2014] (Weapon, Rare)",
      "• Flame Tongue (Rapier) [2014] (Weapon, Rare)", "• Flame Tongue (Shortsword) [2014] (Weapon, Rare)",
    ]);
  });

  it("Vicious Weapon (Light-Hammer) twins Vicious Light Hammer", async () => {
    expect(o5EquipmentKey("Vicious Weapon (Light-Hammer)")).toBe(o5EquipmentKey("Vicious Light Hammer"));
    const LINE = "(2014 name: Vicious Weapon (Light-Hammer) · 2024 name: Vicious Light Hammer)";
    expect((await lines("Vicious Weapon (Light-Hammer)", "2024")).slice(0, 3)).toEqual(["Vicious Light Hammer (Weapon, Rare)", U24, LINE]);
    expect((await lines("Vicious Light Hammer", "2014")).slice(0, 3)).toEqual(["Vicious Weapon (Light-Hammer) (Weapon, Rare)", U14, LINE]);
  });

  it("Smith's tools twins Smith's Tools (20 GP)", async () => {
    expect(o5EquipmentKey("Smith's tools")).toBe(o5EquipmentKey("Smith's Tools (20 GP)"));
    const got = await lines("Smith's Tools (20 GP)", "2014");
    // Owner ruling (fix round 1): names that differ only by a stripped part (here a price) get no rename line.
    expect(got.slice(0, 3)).toEqual(["Smith's tools (Tools)", U14, "Cost: 20 gp | Weight: 8 lb"]);
    const out = await o5SearchItems({ name: "smith", rulesEdition: "2024" }, "unavailable");
    expect(bullets(out)).toEqual(["• Smith's Tools (20 GP) [2024] (Tools)"]);
    expect(out.split("\n").at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  });

  it("Net (+1) does not twin mundane Net, and Shield (+1) does not twin Shield", async () => {
    expect(o5EquipmentKey("Net (+1)")).not.toBe(o5EquipmentKey("Net"));
    expect(o5EquipmentKey("Shield (+1)")).not.toBe(o5EquipmentKey("Shield"));
    expect((await lines("Net (+1)", "2024")).slice(0, 3)).toEqual(["Net (+1) (Weapon, Uncommon)", U14, "(no 2024 version found — 2014 text shown)"]);
    const nets = await o5SearchItems({ name: "net", rulesEdition: "2024" }, "unavailable");
    expect(bullets(nets)).toEqual(["• Net [2024] (Weapon)", "• Net (+1) [2014] (Weapon, Uncommon)"]);
    expect(nets.split("\n").at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
    // Live srd-2014 items, 2026-10-21: category "Shield", armor null, 10 gp / 6 lb.
    const shield = { ...o5Record<Record<string, unknown>>("srd-2014", "items", "Abacus"), key: "srd_shield", name: "Shield", category: { name: "Shield", key: "shield" },
      cost: "10.00", weight: "6.000", desc: "A shield is made from wood or metal and is carried in one hand. Wielding a shield increases your Armor Class by 2." };
    clearOpen5eCache();
    stubFetch(o5FixtureFetch({ "srd-2014/items": [...o5Fixture("srd-2014", "items"), shield] }));
    expect((await lines("Shield (+1)", "2014")).slice(0, 3)).toEqual(["Shield (+1) (Armor, Uncommon)", U24, "(no 2014 version found — 2024 text shown)"]);
    expect((await lines("Shield", "2014")).slice(0, 2)).toEqual(["Shield (Shield)", U14]);
  });

  it("a query that differs only in word order or hyphens gets no rename line", async () => {
    expect((await lines("light hammer vicious", "2024")).slice(0, 3)).toEqual(["Vicious Light Hammer (Weapon, Rare)", U24, ""]);
    expect((await lines("Vicious Light-Hammer", "2024")).slice(0, 3)).toEqual(["Vicious Light Hammer (Weapon, Rare)", U24, ""]);
  });

  it("M1–M3 fold signs, punctuation, word order, weapon words, prices, counts, category prefixes and plurals", () => {
    const same = (a: string, b: string) => expect(o5EquipmentKey(a)).toBe(o5EquipmentKey(b));
    same("Wand of the War Mage (+1)", "Wand of the War Mage +1");
    same("Belt of Fire Giant Strength", "Belt of Giant Strength (Fire)");
    same("Sword of Sharpness (Scimitar)", "Scimitar of Sharpness");
    same("Arrow (bow)", "Arrows (20)");
    same("Ball Bearings (bag of 1000)", "Ball Bearings");
    same("Bagpipes", "Musical Instrument, Bagpipes");
    same("Amulet", "Holy Symbol, Amulet)");
    same("Playing card set", "Gaming Set, Playing Cards");
    expect(o5EquipmentKey("Wand of the War Mage (+1)")).not.toBe(o5EquipmentKey("Wand of the War Mage (+2)"));
  });

  it("the six verified pairs join their twins", () => {
    for (const [name2014, name2024] of OPEN5E_EQUIPMENT_RENAMES) expect(o5EquipmentKey(name2014)).toBe(o5EquipmentKey(name2024));
    expect(OPEN5E_EQUIPMENT_RENAMES).toHaveLength(6);
  });

  describe("the whole-document pairing count", () => {
    // Every equipment record name of both SRD documents (live 2026-10-23).
    type Names = Record<"items" | "magicitems" | "weapons" | "armor", string[]>;
    const recorded = JSON.parse(readFileSync(new URL("./fixtures/open5e-v2/equipment-names.json", import.meta.url), "utf8")) as Record<"srd-2014" | "srd-2024", Names>;
    const names = (doc: "srd-2014" | "srd-2024") => [...new Set(Object.values(recorded[doc]).flat())];
    // The twin key before M1–M3: the rename table alone, hyphens and apostrophes folded.
    const fold = (n: string) => n.replace(/-/g, " ").replace(/['‘’]/g, "");
    const table = createTwinNamer([...EDITION_RENAMES.item, ...OPEN5E_ARMOUR_RENAMES].map(([a, b]) => [fold(a), fold(b)] as const));
    const tableKey = (n: string) => table(fold(n));
    /** Both documents' names grouped by o5EquipmentKey. */
    const grouped = () => {
      const groups = new Map<string, { n14: string[]; n24: string[] }>();
      for (const [doc, side] of [["srd-2014", "n14"], ["srd-2024", "n24"]] as const) {
        for (const n of names(doc)) {
          const k = o5EquipmentKey(n);
          if (!groups.has(k)) groups.set(k, { n14: [], n24: [] });
          groups.get(k)![side].push(n);
        }
      }
      return [...groups.values()];
    };

    it("joins 126 new pairs, each one SRD 5.1 name to one SRD 5.2 name, exactly the hand-checked list", () => {
      const keys24 = new Set(names("srd-2024").map(tableKey));
      // A new pair: a group with both documents that the rename table alone did not join.
      const added = grouped().filter(g => g.n14.length && g.n24.length && !g.n14.some(n => keys24.has(tableKey(n))));
      expect(added.every(g => g.n14.length === 1 && g.n24.length === 1)).toBe(true);
      const pairs = added.map(g => `${g.n14[0]} <=> ${g.n24[0]}`).sort();
      expect(pairs).toHaveLength(126);
      expect(pairs).toEqual(EXPECTED_PAIRS);
    });

    it("lists none of the known false pairs", () => {
      const twinned = (a: string, b: string) => o5EquipmentKey(a) === o5EquipmentKey(b);
      for (const [a, b] of [["Net", "Net (+1)"], ["Shield", "Shield (+1)"], ["Light hammer", "Light Hammer (+1)"],
        ["Defender", "Defender (Hand Crossbow)"], ["Wand of the War Mage (+1)", "Wand of the War Mage +2"], ["Rope, hempen (50 feet)", "Rope"]]) {
        expect(twinned(a, b), `${a} / ${b}`).toBe(false);
      }
    });

    it("the guard splits over all four equipment endpoints, so a search and a get agree (minors B item 8)", async () => {
      const base = o5Record<Record<string, unknown>>("srd-2024", "magicitems", "Ammunition (+1)");
      const rec = (doc: "srd-2024" | "srd-2014", name: string, slug: string) => ({ ...base, key: `${doc}_${slug}`, name, document: { key: doc, name: doc } });
      // 2024 files "Potions of Healing" in magicitems (in a search's scope) and "Potion of Healing" in armor (only a get's scope).
      stubFetch(o5FixtureFetch({
        "srd-2024/magicitems": [rec("srd-2024", "Potions of Healing", "potions-of-healing")],
        "srd-2024/armor": [rec("srd-2024", "Potion of Healing", "potion-of-healing")],
        "srd-2014/magicitems": [rec("srd-2014", "Potion of Healing", "potion-of-healing")],
        // The real gear lists also hold potions; replace them so only the records above are in play.
        "srd-2024/items": [rec("srd-2024", "Rope", "rope")],
        "srd-2014/items": [rec("srd-2014", "Rope", "rope")],
      }));
      const search = await o5SearchItems({ name: "healing" }, "unavailable");
      const lines = search.split("\n").filter(l => /Potions? of Healing/.test(l));
      expect(lines.some(l => l.includes("Potions of Healing") && l.includes("[2024]"))).toBe(true);
      expect(lines.some(l => l.includes("Potion of Healing") && !l.includes("Potions") && l.includes("[2014]"))).toBe(true);
      // The get splits the same way: the rarity table is its own entry, not the 2014 potion's twin.
      const get = await o5GetEquipment("Potions of Healing", "2014", "unavailable");
      expect(get).toContain("(no 2014 version found");
    });

    it("the same-document guard keeps the 126 pairs and parts only Potion of Healing from Potions of Healing", () => {
      const records = (["srd-2014", "srd-2024"] as const).flatMap(doc =>
        names(doc).map(name => ({ name, edition: (doc === "srd-2014" ? "2014" : "2024") as RulesEdition })));
      const key = o5EquipmentGroupKey(records);
      const guarded = new Map<string, { n14: string[]; n24: string[] }>();
      for (const r of records) {
        const k = key(r.name);
        if (!guarded.has(k)) guarded.set(k, { n14: [], n24: [] });
        guarded.get(k)![r.edition === "2014" ? "n14" : "n24"].push(r.name);
      }
      // Every group: within a document, one rename-table key only.
      for (const g of guarded.values()) for (const l of [g.n14, g.n24]) expect(new Set(l.map(tableKey)).size, l.join(" | ")).toBeLessThanOrEqual(1);
      const signature = (g: { n14: string[]; n24: string[] }) => `${g.n14.join()}\n${g.n24.join()}`;
      const unguarded = new Set(grouped().map(signature));
      const changed = [...guarded.values()].filter(g => g.n14.length + g.n24.length > 0 && !unguarded.has(signature(g)))
        .map(g => `${g.n14.join(" | ")} <=> ${g.n24.join(" | ")}`).sort();
      expect(changed).toEqual([" <=> Potions of Healing", "Potion of Healing <=> Potion of Healing"]);
      // Cross-document plural pairs still join.
      for (const [a, b] of [["Arrow (bow)", "Arrows (20)"], ["Spike, iron", "Spikes, Iron"], ["Playing card set", "Gaming Set, Playing Cards"]]) {
        expect(key(a), `${a} / ${b}`).toBe(key(b));
      }
    });

    it("joins no two names of one document beyond what the rename table did, except Potion of Healing and its plural", () => {
      const within = grouped().flatMap(g => [g.n14, g.n24])
        .filter(l => new Set(l.map(tableKey)).size > 1)
        .map(l => [...l].sort().join(" | "));
      expect(within).toEqual(["Potion of Healing | Potions of Healing"]);
    });
  });

  const EXPECTED_PAIRS = [
      "Alchemist's Supplies <=> Alchemist's Supplies (50 GP)",
      "Amulet <=> Holy Symbol, Amulet)",
      "Antitoxin (Vial) <=> Antitoxin",
      "Armor of Resistance (Hide) <=> Armor of Resistance (Hide Armor)",
      "Armor of Resistance (Leather) <=> Armor of Resistance (Leather Armor)",
      "Arrow (bow) <=> Arrows (20)",
      "Bagpipes <=> Musical Instrument, Bagpipes",
      "Ball Bearings (bag of 1000) <=> Ball Bearings",
      "Belt of Cloud Giant Strength <=> Belt of Giant Strength (Cloud)",
      "Belt of Fire Giant Strength <=> Belt of Giant Strength (Fire)",
      "Belt of Hill Giant Strength <=> Belt of Giant Strength (Hill)",
      "Belt of Storm Giant Strength <=> Belt of Giant Strength (Storm)",
      "Blowgun needles <=> Needles (50)",
      "Brewer's Supplies <=> Brewer's Supplies (20 GP)",
      "Calligrapher's supplies <=> Calligrapher's Supplies (10 GP)",
      "Carpenter's Tools <=> Carpenter's Tools (8 GP)",
      "Cartographer's Tools <=> Cartographer's Tools (15 GP)",
      "Cobbler's Tools <=> Cobbler's Tools (5 GP)",
      "Cook's utensils <=> Cook's Utensils (1 GP)",
      "Crossbow bolt <=> Bolts (20)",
      "Crossbow-Hand (+1) <=> Hand Crossbow (+1)",
      "Crossbow-Hand (+2) <=> Hand Crossbow (+2)",
      "Crossbow-Hand (+3) <=> Hand Crossbow (+3)",
      "Crossbow-Heavy (+1) <=> Heavy Crossbow (+1)",
      "Crossbow-Heavy (+2) <=> Heavy Crossbow (+2)",
      "Crossbow-Heavy (+3) <=> Heavy Crossbow (+3)",
      "Crossbow-Light (+1) <=> Light Crossbow (+1)",
      "Crossbow-Light (+2) <=> Light Crossbow (+2)",
      "Crossbow-Light (+3) <=> Light Crossbow (+3)",
      "Crossbow, hand <=> Hand Crossbow",
      "Crossbow, heavy <=> Heavy Crossbow",
      "Crossbow, light <=> Light Crossbow",
      "Dancing Sword (Greatsword) <=> Dancing Greatsword",
      "Dancing Sword (Longsword) <=> Dancing Longsword",
      "Dancing Sword (Rapier) <=> Dancing Rapier",
      "Dancing Sword (Shortsword) <=> Dancing Shortsword",
      "Deck of Many Things <=> Mysterious Deck",
      "Dice set <=> Gaming Set, Dice",
      "Drum <=> Musical Instrument, Drum",
      "Dulcimer <=> Musical Instrument, Dulcimer",
      "Emblem <=> Holy Symbol, Emblem)",
      "Figurine of Wondrous Power (Obsidian Steed) <=> Figurine of Wondrous Power (Obsidian Stead)",
      "Flame Tongue (Greatsword) <=> Flame Tongue Greatsword",
      "Flame Tongue (Longsword) <=> Flame Tongue Longsword",
      "Flame Tongue (Rapier) <=> Flame Tongue Rapier",
      "Flame Tongue (Shortsword) <=> Flame Tongue Shortsword",
      "Flute <=> Musical Instrument, Flute",
      "Glassblower's Tools <=> Glassblower's Tools (30 GP)",
      "Horn <=> Musical Instrument, Horn",
      "Iron Bands of Binding <=> Iron Bands",
      "Jeweler's Tools <=> Jeweler's Tools (25 GP)",
      "Lamp oil (flask) <=> Oil",
      "Leatherworker's Tools <=> Leatherworker's Tools (5 GP)",
      "Lute <=> Musical Instrument, Lute",
      "Lyre <=> Musical Instrument, Lyre",
      "Mason's Tools <=> Mason's Tools (10 GP)",
      "Orb of Dragonkind <=> Dragon Orb",
      "Painter's Supplies <=> Painter's Supplies (10 GP)",
      "Pan flute <=> Musical Instrument, Pan Flute",
      "Playing card set <=> Gaming Set, Playing Cards",
      "Potter's tools <=> Potter's Tools (10 GP)",
      "Reliquary <=> Holy Symbol, Reliquary",
      "Shawm <=> Musical Instrument, Shawm",
      "Sling bullets <=> Bullets, Sling (20)",
      "Smith's tools <=> Smith's Tools (20 GP)",
      "Spike, iron <=> Spikes, Iron",
      "Sprig of mistletoe <=> Druidic Focus, Sprig of Mistletoe",
      "Sword of Life Stealing (Greatsword) <=> Greatsword of Life Stealing",
      "Sword of Life Stealing (Longsword) <=> Longsword of Life Stealing",
      "Sword of Life Stealing (Rapier) <=> Rapier of Life Stealing",
      "Sword of Life Stealing (Shortsword) <=> Shortsword of Life Stealing",
      "Sword of Sharpness (Greatsword) <=> Greatsword of Sharpness",
      "Sword of Sharpness (Longsword) <=> Longsword of Sharpness",
      "Sword of Sharpness (Scimitar) <=> Scimitar of Sharpness",
      "Sword of Wounding (Greatsword) <=> Greatsword of Wounding",
      "Sword of Wounding (Longsword) <=> Longsword of Wounding",
      "Sword of Wounding (Rapier) <=> Rapier of Wounding",
      "Sword of Wounding (Shortsword) <=> Shortsword of Wounding",
      "Tinker's tools <=> Tinker's Tools (50 GP)",
      "Vicious Weapon (Battleaxe) <=> Vicious Battleaxe",
      "Vicious Weapon (Blowgun) <=> Vicious Blowgun",
      "Vicious Weapon (Club) <=> Vicious Club",
      "Vicious Weapon (Crossbow-Hand) <=> Vicious Hand Crossbow",
      "Vicious Weapon (Crossbow-Heavy) <=> Vicious Heavy Crossbow",
      "Vicious Weapon (Crossbow-Light) <=> Vicious Light Crossbow",
      "Vicious Weapon (Dagger) <=> Vicious Dagger",
      "Vicious Weapon (Dart) <=> Vicious Dart",
      "Vicious Weapon (Flail) <=> Vicious Flail",
      "Vicious Weapon (Glaive) <=> Vicious Glaive",
      "Vicious Weapon (Greataxe) <=> Vicious Greataxe",
      "Vicious Weapon (Greatclub) <=> Vicious Greatclub",
      "Vicious Weapon (Greatsword) <=> Vicious Greatsword",
      "Vicious Weapon (Halberd) <=> Vicious Halberd",
      "Vicious Weapon (Handaxe) <=> Vicious Handaxe",
      "Vicious Weapon (Javelin) <=> Vicious Javelin",
      "Vicious Weapon (Lance) <=> Vicious Lance",
      "Vicious Weapon (Light-Hammer) <=> Vicious Light Hammer",
      "Vicious Weapon (Longbow) <=> Vicious Longbow",
      "Vicious Weapon (Longsword) <=> Vicious Longsword",
      "Vicious Weapon (Mace) <=> Vicious Mace",
      "Vicious Weapon (Maul) <=> Vicious Maul",
      "Vicious Weapon (Morningstar) <=> Vicious Morningstar",
      "Vicious Weapon (Pike) <=> Vicious Pike",
      "Vicious Weapon (Quarterstaff) <=> Vicious Quarterstaff",
      "Vicious Weapon (Rapier) <=> Vicious Rapier",
      "Vicious Weapon (Scimitar) <=> Vicious Scimitar",
      "Vicious Weapon (Shortbow) <=> Vicious Shortbow",
      "Vicious Weapon (Shortsword) <=> Vicious Shortsword",
      "Vicious Weapon (Sickle) <=> Vicious Sickle",
      "Vicious Weapon (Sling) <=> Vicious Sling",
      "Vicious Weapon (Spear) <=> Vicious Spear",
      "Vicious Weapon (Trident) <=> Vicious Trident",
      "Vicious Weapon (War-Pick) <=> Vicious War Pick",
      "Vicious Weapon (Warhammer) <=> Vicious Warhammer",
      "Vicious Weapon (Whip) <=> Vicious Whip",
      "Viol <=> Musical Instrument, Viol",
      "Vorpal Sword (Greatsword) <=> Vorpal Greatsword",
      "Vorpal Sword (Longsword) <=> Vorpal Longsword",
      "Vorpal Sword (Scimitar) <=> Vorpal Scimitar",
      "Wand of the War Mage (+1) <=> Wand of the War Mage +1",
      "Wand of the War Mage (+2) <=> Wand of the War Mage +2",
      "Wand of the War Mage (+3) <=> Wand of the War Mage +3",
      "Weaver's tools <=> Weaver's Tools (1 GP)",
      "Woodcarver's tools <=> Woodcarver's Tools (1 GP)",
      "Wooden staff <=> Druidic Focus, Wooden Staff",
      "Yew wand <=> Druidic Focus, Yew Wand",
  ].sort();
});

// Task 10 fix round 1 (owner rulings 2026-10-30).
describe("Open5e equipment rename lines and the same-document guard", () => {
  const lines = async (name: string, ed: "2024" | "2014") => (await o5GetEquipment(name, ed, "unavailable"))!.split("\n");
  const bullets = (out: string) => out.split("\n").filter(l => l.startsWith("• "));

  it("no rename line when only a stripped part differs: a container, a category prefix, a measure", async () => {
    expect((await lines("Antitoxin (Vial)", "2024")).slice(0, 3)).toEqual(["Antitoxin (Potion)", U24, "Cost: 50 gp | Weight: —"]);
    expect((await lines("Antitoxin", "2014")).slice(0, 3)).toEqual(["Antitoxin (Vial) (Adventuring Gear)", U14, "Cost: 50 gp | Weight: —"]);
    expect((await lines("Bagpipes", "2024")).slice(0, 3)).toEqual(["Musical Instrument, Bagpipes (Tools)", U24, "Cost: 30 gp | Weight: 6 lb"]);
    expect((await lines("Musical Instrument, Bagpipes", "2014")).slice(0, 3)).toEqual(["Bagpipes (Tools)", U14, "Cost: 30 gp | Weight: 6 lb"]);
    expect((await lines("Chain (10 feet)", "2024")).slice(0, 2)).toEqual(["Chain (Adventuring Gear)", U24]);
    expect((await lines("Chain (10 feet)", "2024"))[2]).toMatch(/^Cost: /);
    // A rename-table pair too: D&D Beyond's "Acid (vial)" → "Acid".
    expect((await lines("Acid (vial)", "2024"))[2]).toMatch(/^Cost: /);
  });

  it("a comma or a plural is no stripped part: Crossbow and Arrow keep their rename lines", async () => {
    expect((await lines("Hand Crossbow", "2014"))[2]).toBe("(2014 name: Crossbow, hand · 2024 name: Hand Crossbow)");
    expect((await lines("Arrows (20)", "2014")).slice(0, 3)).toEqual(["Arrow (bow) (Ammunition)", U14, "(2014 name: Arrow (bow) · 2024 name: Arrows (20))"]);
    expect((await lines("Arrow (bow)", "2024")).slice(0, 3)).toEqual(["Arrows (20) (Ammunition)", U24, "(2014 name: Arrow (bow) · 2024 name: Arrows (20))"]);
  });

  it("a search lists the group's record whose name is the exact query, as a get picks it", async () => {
    // SRD 5.1 files both "Acid" and "Acid (vial)"; the rename table puts them in one group.
    expect(bullets(await o5SearchItems({ name: "acid (vial)", rulesEdition: "2014" }, "unavailable"))).toEqual(["• Acid (vial) [2014] (Adventuring Gear)"]);
    expect(bullets(await o5SearchItems({ name: "acid", rulesEdition: "2014" }, "unavailable"))).toEqual(["• Acid [2014] (Adventuring Gear)"]);
  });

  it("SRD 5.2's Potion of Healing and Potions of Healing stay apart", async () => {
    const healing = await o5SearchItems({ name: "healing", rulesEdition: "2024" }, "unavailable");
    expect(bullets(healing)).toEqual(["• Potion of Healing [2024] (Potion)", "• Potions of Healing [2024] (Potion)"]);
    expect(healing.split("\n").at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
    expect(bullets(await o5SearchItems({ name: "potions of healing", rulesEdition: "2024" }, "unavailable")))
      .toEqual(["• Potions of Healing [2024] (Potion)"]);
    expect(bullets(await o5SearchItems({ name: "healing", rulesEdition: "2014" }, "unavailable")))
      .toEqual(["• Potion of Healing [2014] (Potion, Common)", "• Potions of Healing [2024] (Potion)"]);
    expect((await lines("Potions of Healing", "2014")).slice(0, 3)).toEqual(["Potions of Healing (Potion)", U24, "(no 2014 version found — 2024 text shown)"]);
    expect((await lines("Potion of Healing", "2014")).slice(0, 2)).toEqual(["Potion of Healing (Potion, Common)", U14]);
  });
});

describe("Open5e monster, filter and item fixes (Task 11)", () => {
  const wolf = () => o5Record<Record<string, unknown>>("srd-2024", "creatures", "Wolf");

  it("a 2024 creature with an unrecognised CR is unknown-cr, not its 2014 twin (#8, minors C #11)", async () => {
    const odd = { ...o5Record<Record<string, unknown>>("srd-2024", "creatures", "Goblin Warrior"), challenge_rating: 0.3 };
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [odd] }));
    expect(await o5GetMonsterStats("Goblin Warrior", "2024")).toEqual({
      status: "unknown-cr", name: "Goblin Warrior", info: { ruleset: "2024", book: null },
    });
  });

  it("matches school, type and size by part of a word", async () => {
    expect(await o5SearchMonsters({ size: "med" }, "unavailable")).toContain("Wolf");
    expect(await o5SearchMonsters({ type: "drag" }, "unavailable")).toContain("Adult Red Dragon");
    const spells = await o5SearchSpells({ school: "evoc" }, "unavailable");
    expect(spells).toContain("Fireball");
    expect(spells).not.toContain("Sleep");
  });

  it("a legendary creature's block carries the per-round note (#10)", async () => {
    const lines = (await o5GetMonster("Adult Red Dragon", "2014", "unavailable"))!.split("\n");
    const i = lines.indexOf("LEGENDARY ACTIONS");
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe("(Uses per round aren't in the Open5e SRD data — usually 3.)");
    expect((await o5GetMonster("Wolf", "2024", "unavailable"))!).not.toContain("Uses per round");
  });

  it("a hovering creature prints (hover) after fly (u)", async () => {
    const f = { ...wolf(), key: "srd-2024_flyer", name: "Flyer", speed: { walk: 10, fly: 30, hover: true, unit: "feet" } };
    stubFetch(o5FixtureFetch({ "srd-2024/creatures": [f] }));
    expect(await o5GetMonster("Flyer", "2024", "unavailable")).toContain("Speed: walk 10 ft., fly 30 ft. (hover)");
  });

  it("an item record with a null rarity or category doesn't break the search (#9)", async () => {
    const base = o5Fixture<Record<string, unknown>>("srd-2024", "magicitems")[0];
    const bad = { ...base, key: "srd-2024_nullish", name: "Nullish Trinket", rarity: null, category: null };
    stubFetch(o5FixtureFetch({ "srd-2024/magicitems": [bad] }));
    const out = await o5SearchItems({ name: "Nullish" }, "unavailable");
    expect(out).toContain("Nullish Trinket");
    expect(out).not.toContain("undefined");
    expect(await o5SearchItems({ rarity: "rare" }, "unavailable")).not.toContain("Nullish");
  });

  describe("fix round 1", () => {
    const gob = (name: string, cr: number) => ({ ...o5Record<Record<string, unknown>>("srd-2024", "creatures", "Goblin Boss"), key: `srd-2024_${name.toLowerCase().replace(/ /g, "-")}`, name, challenge_rating: cr });
    const asLoggedOut = () => sessionMocks.hasValidSession.mockReturnValue(false);

    it("an ambiguous list keeps an unknown-CR pick as 'CR unknown', last", async () => {
      stubFetch(o5FixtureFetch({ "srd-2024/creatures": [gob("Goblin Boss", 1), gob("Goblin Warrior", 0.3)] }));
      const r = await o5GetMonsterStats("oblin", "2024");
      expect(r).toEqual({ status: "ambiguous", candidates: [
        { name: "Goblin Boss", crValue: 1, xp: 200 }, { name: "Goblin Warrior", crValue: null, xp: null },
      ] });
      asLoggedOut();
      const out = await rateEncounter([{ count: 4, level: 5 }], [{ name: "oblin" }], "2024");
      expect(out).toContain('⚠ Ambiguous: "oblin" could be Goblin Boss (CR 1), Goblin Warrior (CR unknown) — use the full name.');
    });

    it("every group's pick unknown is not-found; an exact name with an unknown CR is unknown-cr (minors C #11)", async () => {
      stubFetch(o5FixtureFetch({ "srd-2024/creatures": [gob("Goblin Boss", 1.5), gob("Goblin Warrior", 0.3)] }));
      expect(await o5GetMonsterStats("oblin", "2024")).toEqual({ status: "not-found" });
      stubFetch(o5FixtureFetch({ "srd-2024/creatures": [gob("Goblin Boss", 1.5), gob("Goblin Warrior", 0.3)] }));
      expect(await o5GetMonsterStats("Goblin Boss", "2024")).toMatchObject({ status: "unknown-cr", name: "Goblin Boss" });
    });

    it("a partial name matching one group with an unknown CR is unknown-cr; with a known CR it is found", async () => {
      stubFetch(o5FixtureFetch({ "srd-2024/creatures": [gob("Goblin Boss", 1.5), gob("Hobgoblin", 1)] }));
      expect(await o5GetMonsterStats("Boss", "2024")).toMatchObject({ status: "unknown-cr", name: "Goblin Boss" });
      expect(await o5GetMonsterStats("Hobgob", "2024")).toMatchObject({ status: "found", name: "Hobgoblin", crValue: 1 });
    });

    it("rateEncounter names exactly 20 candidates, CR then name, and counts the rest", async () => {
      const many = Array.from({ length: 25 }, (_, i) => gob(`Gob ${String(i).padStart(2, "0")}`, i % 5));
      stubFetch(o5FixtureFetch({ "srd-2024/creatures": many, "srd-2014/creatures": o5Fixture<{ name: string }>("srd-2014", "creatures").filter(r => r.name === "Wolf") }));
      asLoggedOut();
      const out = await rateEncounter([{ count: 4, level: 5 }], [{ name: "Gob" }], "2024");
      const line = out.split("\n").find(l => l.includes("Ambiguous:"))!;
      expect(line.match(/Gob \d\d/g)).toHaveLength(20);
      expect(line).toContain("Gob 00 (CR 0), Gob 05 (CR 0)");
      expect(line).toContain(", and 5 more — use the full name.");
    });

    it("no empty parentheses when category and rarity are null", async () => {
      const base = o5Fixture<Record<string, unknown>>("srd-2024", "magicitems")[0];
      const bad = { ...base, key: "srd-2024_nullish", name: "Nullish Trinket", rarity: null, category: null, requires_attunement: true, attunement_detail: null };
      const plain = { ...bad, key: "srd-2024_nullish2", name: "Plain Trinket", requires_attunement: false };
      stubFetch(o5FixtureFetch({ "srd-2024/magicitems": [bad, plain] }));
      const get = (await o5GetEquipment("Nullish Trinket", "2024", "unavailable"))!;
      expect(get.split("\n")[0]).toBe("Nullish Trinket (Requires attunement)");
      expect((await o5GetEquipment("Plain Trinket", "2024", "unavailable"))!.split("\n")[0]).toBe("Plain Trinket");
      const search = await o5SearchItems({ name: "Trinket" }, "unavailable");
      expect(search).toMatch(/^• Nullish Trinket \[2024\]$/m);
      expect(search).not.toContain("()");
    });

    it("a whitespace-only school, type or size matches nothing, as on D&D Beyond", async () => {
      expect(await o5SearchMonsters({ size: "  " }, "unavailable")).toContain("No monsters found");
      expect(await o5SearchSpells({ school: " " }, "unavailable")).toContain("No spells found");
    });

    it("a magic item with a null rarity counts as Common", async () => {
      const base = o5Fixture<Record<string, unknown>>("srd-2024", "magicitems")[0];
      stubFetch(o5FixtureFetch({ "srd-2024/magicitems": [{ ...base, key: "srd-2024_nullish", name: "Nullish Trinket", rarity: null }] }));
      expect(await o5SearchItems({ rarity: "common" }, "unavailable")).toContain("Nullish Trinket");
    });

    it("type: drag excludes non-dragons", async () => {
      const out = await o5SearchMonsters({ type: "drag" }, "unavailable");
      expect(out).toContain("Adult Red Dragon");
      expect(out).not.toContain("Wolf");
      expect(out).not.toContain("Aboleth");
    });
  });
});

describe("o5MonsterInEdition (logged-out locked D&D Beyond entries)", () => {
  it("returns that SRD's record by exact name, with its AC, HP and a needs-login label", async () => {
    const wolf = await o5MonsterInEdition("Wolf", "2024");
    const rec = o5Record<{ armor_class: number; hit_points: number }>("srd-2024", "creatures", "Wolf");
    expect(wolf).toMatchObject({ armorClass: rec.armor_class, hitPoints: rec.hit_points });
    expect(wolf!.text("needs-login").split("\n").slice(0, 2)).toEqual(["Wolf", "Rules: 2024 · SRD 5.2 (Open5e — the D&D Beyond version needs ddb_login)"]);
    expect((await o5MonsterInEdition("Wolf", "2014"))!.text("needs-login").split("\n")[1]).toBe("Rules: 2014 · SRD 5.1 (Open5e — the D&D Beyond version needs ddb_login)");
  });

  it("is null for a creature only the other SRD has, and for a partial name", async () => {
    expect(await o5MonsterInEdition("Half-Red Dragon Veteran", "2024")).toBeNull();
    expect(await o5MonsterInEdition("Wol", "2024")).toBeNull();
  });
});

describe("o5GetMonster with a locked D&D Beyond edition (M2)", () => {
  it("only the other SRD has it: the reason says the requested version needs ddb_login, not that none exists", async () => {
    const lines = (await o5GetMonster("Half-Red Dragon Veteran", "2024", "needs-login", "2024"))!.split("\n");
    expect(lines.slice(1, 3)).toEqual([
      "Rules: 2014 · SRD 5.1 (Open5e — the D&D Beyond version needs ddb_login)",
      "(not logged in, so the 2024 version isn't available — 2014 text shown; run ddb_login if your account owns it)",
    ]);
  });

  it("without a locked edition the reason is unchanged", async () => {
    expect((await o5GetMonster("Half-Red Dragon Veteran", "2024", "unavailable"))!.split("\n")[2]).toBe("(no 2024 version found — 2014 text shown)");
  });
});

describe("Open5e option searches: prerequisite, limit and offset", () => {
  const feat = (name: string, prerequisite: string | null): Record<string, unknown> => ({
    ...o5Record<Record<string, unknown>>("srd-2024", "feats", "Alert"),
    key: `srd-2024_${name.toLowerCase().replace(/ /g, "-")}`, name,
    has_prerequisite: !!prerequisite, prerequisite,
  });
  const bullets = (text: string): string[] => text.split("\n").filter(l => l.startsWith("• "));

  it("prerequisite is a case-insensitive substring; a feat without one never matches", async () => {
    const out = (await o5SearchFeatsSection({ prerequisite: "strength", rulesEdition: "2024" }, "not-found")).body;
    expect(out.split("\n")[0]).toBe("Grappler");
    expect(out).not.toContain("Alert");
    expect((await o5SearchFeatsSection({ prerequisite: "zzz" }, "not-found")).noMatch).toBe(true);
  });

  it("prerequisite lists exactly the matching feats", async () => {
    stubFetch(o5FixtureFetch({ "srd-2024/feats": [
      feat("Ritual Caster", "Prerequisite: Spellcasting or Pact Magic"), feat("War Caster", "Spellcasting"), feat("Spell Sniper", "Level 4+, Spellcasting"),
      feat("Tough", null), feat("Lucky", null),
    ] }));
    const out = (await o5SearchFeatsSection({ prerequisite: "spellcast", rulesEdition: "2024" }, "not-found")).body;
    expect(bullets(out)).toHaveLength(3);
    expect(out).toContain("Found 3 feat(s) (SRD only):");
    expect(out).not.toContain("Tough");
  });

  it("limit pages the lines; N counts every match", async () => {
    const out = await o5SearchFeats({ limit: 1, rulesEdition: "2024" }, "not-found");
    expect(bullets(out)).toHaveLength(1);
    expect(out).toContain("Found 2 feat(s) (SRD only), showing 1–1:");
    expect(out).toContain("\n*Use offset: 1 to see more.*");
  });

  it("the last page has the range heading and no more-hint; a full fit is the plain heading", async () => {
    const last = await o5SearchFeats({ offset: 1, rulesEdition: "2024" }, "not-found");
    expect(bullets(last)).toHaveLength(1);
    expect(last).toContain("Found 2 feat(s) (SRD only), showing 2–2:");
    expect(last).not.toContain("Use offset");
    expect(await o5SearchFeats({ rulesEdition: "2024" }, "not-found")).toContain("Found 2 feat(s) (SRD only):");
  });

  it("an offset past the end is not a no-match", async () => {
    const out = await o5SearchFeats({ offset: 999, rulesEdition: "2024" }, "not-found");
    expect(out).toContain("Found 2 feat(s) (SRD only) — offset 999 is past the end.");
    expect(bullets(out)).toHaveLength(0);
  });

  it("races page too", async () => {
    expect(bullets((await o5SearchRacesSection({ limit: 1 }, "not-found")).body)).toHaveLength(1);
  });
});

describe("Open5e request timeout", () => {
  it("a per-request TimeoutError reads as a clear message and is remembered for 60 s", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const f = vi.fn(async () => { throw timeout; });
    vi.stubGlobal("fetch", f);
    await expect(o5GetRule("Combat", "2024")).rejects.toThrow("Open5e (api.open5e.com) didn't answer within 20 s — try again shortly.");
    const calls = f.mock.calls.length;
    await expect(o5GetRule("Combat", "2024")).rejects.toThrow("didn't answer within 20 s");
    expect(f.mock.calls.length).toBe(calls);
  });

  it("a TimeoutError from resp.json() reads the same way", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      url, ok: true, status: 200, json: async () => { throw timeout; },
    })));
    await expect(o5GetRule("Combat", "2024")).rejects.toThrow("didn't answer within 20 s");
  });

  it("other fetch errors keep their own message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    await expect(o5GetRule("Combat", "2024")).rejects.toThrow("boom");
  });
});
