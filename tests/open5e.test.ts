import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { open5eSearchHeader } from "../src/edition.js";
import { o5Fixture, o5FixtureFetch, o5Record } from "./fixtures/open5e-v2.js";
import {
  clearOpen5eCache,
  o5GetSpell, o5GetMonster, o5GetItem, o5GetWeapon, o5GetArmor, o5GetRace,
  o5SearchSpells, o5SearchMonsters, o5SearchItems, o5SearchWeapons, o5SearchArmor,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchSections, o5GetSection, o5GetMonsterStats, crText, castingTime,
} from "../src/open5e.js";

const UNAVAILABLE = "Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)";
const NOT_FOUND = "Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)";
const TAGGED = /^• [^[\n]+? \[2014\]/;

const item = { name: "Bag of Holding", type: "Wondrous item", rarity: "uncommon", desc: "It holds more." };
const weapon = { name: "Longsword", category: "Martial Melee Weapons", cost: "15 gp", damage_dice: "1d8", damage_type: "slashing", weight: "3 lb.", properties: ["versatile (1d10)"] };
const armor = { name: "Chain Mail", category: "Heavy Armor", base_ac: 16, ac_string: "16", strength_requirement: 13, stealth_disadvantage: true, cost: "75 gp", weight: "55 lb." };
const race = (name: string) => ({ name, desc: "", asi_desc: "", asi: [{ attributes: ["Con"], value: 2 }], size: "Medium", speed: { walk: 25 }, languages: "Common", vision: "", traits: "Tough." });
const klass = (name: string) => ({ name, hit_dice: "1d8", hp_at_1st_level: "8", hp_at_higher_levels: "", prof_armor: "", prof_weapons: "", prof_saving_throws: "", prof_skills: "", desc: "" });
const background = (name: string) => ({ name, skill_proficiencies: "Insight", equipment: "Pack", feature: "Shelter", feature_desc: "Help." });
const feat = (name: string) => ({ name, desc: "Grapple well." });
const section = { slug: "combat", name: "Combat", desc: "Roll initiative.", parent: "", document__slug: "wotc-srd" };

let raceResults: unknown[] = [race("Dwarf"), race("Elf")];

function route(url: string): unknown {
  const path = new URL(url).pathname.replace("/v1", "");
  const wrap = (results: unknown[]) => ({ count: results.length, next: null, results });
  if (path.startsWith("/magicitems/")) return wrap([item]);
  if (path.startsWith("/weapons/")) return wrap([weapon]);
  if (path.startsWith("/armor/")) return wrap([armor]);
  if (path.startsWith("/races/")) return wrap(raceResults);
  if (path.startsWith("/classes/")) return wrap([klass("Fighter"), klass("Rogue")]);
  if (path.startsWith("/backgrounds/")) return wrap([background("Acolyte"), background("Sage")]);
  if (path.startsWith("/feats/")) return wrap([feat("Grappler"), feat("Alert")]);
  if (path === "/sections/combat/") return section;
  if (path.startsWith("/sections/")) return wrap([section]);
  throw new Error(`unrouted ${path}`);
}

/** v2 document URLs are served from the recorded fixtures; the not-yet-migrated v1 kinds keep `route`. */
function stubFetch(v2 = o5FixtureFetch()): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url.includes("/v2/") ? v2(url) : { ok: true, status: 200, json: async () => route(url) }));
}

beforeEach(() => {
  clearOpen5eCache();
  raceResults = [race("Dwarf"), race("Elf")];
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("Open5e labels", () => {
  it.each([
    ["o5GetItem", () => o5GetItem("Bag of Holding", "unavailable"), UNAVAILABLE],
    ["o5GetWeapon", () => o5GetWeapon("Longsword", "unavailable"), UNAVAILABLE],
    ["o5GetArmor", () => o5GetArmor("Chain Mail", "unavailable"), UNAVAILABLE],
    ["o5GetRace", () => o5GetRace("Dwarf", "unavailable"), UNAVAILABLE],
  ])("%s puts the rules line under the title", async (_n, call, expected) => {
    const out = (await call())!;
    expect(out.split("\n")[1]).toBe(expected);
    expect(out).not.toContain("Source: SRD 5.1 via Open5e");
  });

  it.each([
    ["o5SearchItems", () => o5SearchItems("bag", "unavailable")],
    ["o5SearchWeapons", () => o5SearchWeapons({ name: "sword" }, "unavailable")],
    ["o5SearchArmor", () => o5SearchArmor({ name: "mail" }, "unavailable")],
    ["o5SearchRaces", () => o5SearchRaces(undefined, "unavailable")],
    ["o5SearchClasses", () => o5SearchClasses(undefined, "unavailable")],
    ["o5SearchBackgrounds", () => o5SearchBackgrounds(undefined, "unavailable")],
    ["o5SearchFeats", () => o5SearchFeats(undefined, "unavailable")],
  ])("%s opens with the rules line and tags every result line", async (_n, call) => {
    const out = await call();
    const lines = out.split("\n");
    expect(lines[0]).toBe(UNAVAILABLE);
    const results = lines.filter(l => l.startsWith("• "));
    expect(results.length).toBeGreaterThan(0);
    for (const l of results) expect(l).toMatch(TAGGED);
    expect(out).not.toContain("Source: SRD 5.1 via Open5e");
  });

  it("a single-result search uses the single-lookup label", async () => {
    raceResults = [race("Dwarf")];
    const one = await o5SearchRaces("dwarf", "not-found");
    expect(one.split("\n")[0]).toBe("Dwarf");
    expect(one.split("\n")[1]).toBe(NOT_FOUND);
  });

  it("rules sections are labelled as the primary source", async () => {
    expect((await o5GetSection("Combat"))!.split("\n")[1]).toBe("Rules: 2014 · SRD 5.1");
    expect((await o5SearchSections("combat")).split("\n")[0]).toBe("Rules: sections from SRD 5.1 (2014).");
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

describe("o5GetMonsterStats", () => {
  it("o5GetMonsterStats: exact twin name only, edition from the document", async () => {
    expect(await o5GetMonsterStats("Goblin", "2024")).toEqual({ name: "Goblin Warrior", crValue: 0.25, xp: 50, info: { ruleset: "2024", book: null } });
    expect(await o5GetMonsterStats("goblin", "2014")).toMatchObject({ name: "Goblin", info: { ruleset: "2014", book: null } });
    expect(await o5GetMonsterStats("Red Dragon", "2024")).toBeNull();   // partial: never a guess
    expect(await o5GetMonsterStats("Allosaurus", "2014")).toMatchObject({ info: { ruleset: "2024", book: null } });
  });

  it("returns null when Open5e fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await o5GetMonsterStats("Wolf", "2024")).toBeNull();
  });
});
