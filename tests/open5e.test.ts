import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearOpen5eCache,
  o5GetSpell, o5GetMonster, o5GetItem, o5GetWeapon, o5GetArmor, o5GetRace,
  o5SearchSpells, o5SearchMonsters, o5SearchItems, o5SearchWeapons, o5SearchArmor,
  o5SearchRaces, o5SearchClasses, o5SearchBackgrounds, o5SearchFeats,
  o5SearchSections, o5GetSection, o5GetMonsterStats,
} from "../src/open5e.js";

const UNAVAILABLE = "Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)";
const NOT_FOUND = "Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)";
const TAGGED = /^• [^[\n]+? \[2014\]/;

const spell = { name: "Fireball", level_int: 3, school: "Evocation", casting_time: "1 action", range: "150 feet", components: "V, S, M", duration: "Instantaneous", requires_concentration: false, ritual: "no", desc: "A bright streak." };
const monster = (name: string, cr = "1/4") => ({
  name, size: "Small", type: "humanoid", alignment: "neutral evil", armor_class: 15, hit_points: 7, hit_dice: "2d6",
  speed: { walk: 30 }, strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8,
  skills: {}, senses: "darkvision 60 ft.", languages: "Common", challenge_rating: cr,
});
const item = { name: "Bag of Holding", type: "Wondrous item", rarity: "uncommon", desc: "It holds more." };
const weapon = { name: "Longsword", category: "Martial Melee Weapons", cost: "15 gp", damage_dice: "1d8", damage_type: "slashing", weight: "3 lb.", properties: ["versatile (1d10)"] };
const armor = { name: "Chain Mail", category: "Heavy Armor", base_ac: 16, ac_string: "16", strength_requirement: 13, stealth_disadvantage: true, cost: "75 gp", weight: "55 lb." };
const race = (name: string) => ({ name, desc: "", asi_desc: "", asi: [{ attributes: ["Con"], value: 2 }], size: "Medium", speed: { walk: 25 }, languages: "Common", vision: "", traits: "Tough." });
const klass = (name: string) => ({ name, hit_dice: "1d8", hp_at_1st_level: "8", hp_at_higher_levels: "", prof_armor: "", prof_weapons: "", prof_saving_throws: "", prof_skills: "", desc: "" });
const background = (name: string) => ({ name, skill_proficiencies: "Insight", equipment: "Pack", feature: "Shelter", feature_desc: "Help." });
const feat = (name: string) => ({ name, desc: "Grapple well." });
const section = { slug: "combat", name: "Combat", desc: "Roll initiative.", parent: "", document__slug: "wotc-srd" };

let monsterResults: unknown[] = [monster("Goblin")];
let empty = false;
let raceResults: unknown[] = [race("Dwarf"), race("Elf")];

function route(url: string): unknown {
  const path = new URL(url).pathname.replace("/v1", "");
  const wrap = (results: unknown[]) => ({ count: results.length, next: null, results: empty ? [] : results });
  if (path.startsWith("/spells/")) return wrap([spell]);
  if (path.startsWith("/monsters/")) return wrap(monsterResults);
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

beforeEach(() => {
  clearOpen5eCache();
  monsterResults = [monster("Goblin")];
  empty = false;
  raceResults = [race("Dwarf"), race("Elf")];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => route(url) })));
});
afterEach(() => vi.unstubAllGlobals());

describe("Open5e labels", () => {
  it.each([
    ["o5GetSpell", () => o5GetSpell("Fireball", "unavailable"), UNAVAILABLE],
    ["o5GetMonster", () => o5GetMonster("Goblin", "not-found"), NOT_FOUND],
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
    ["o5SearchSpells", () => o5SearchSpells({ name: "fire" }, "unavailable")],
    ["o5SearchMonsters", () => o5SearchMonsters({ name: "gob" }, "unavailable")],
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

  it("tags the name immediately, before the detail", async () => {
    expect(await o5SearchSpells({ name: "fire" }, "unavailable")).toContain("• Fireball [2014] (Level 3 Evocation)");
    expect(await o5SearchMonsters({ name: "gob" }, "unavailable")).toContain("• Goblin [2014] (CR 1/4, Small humanoid)");
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

  it("a not-found search keeps its plain message", async () => {
    empty = true;
    expect(await o5SearchSpells({ name: "zzz" }, "not-found")).toBe("No spells found matching the criteria (SRD only).");
  });
});

describe("o5GetMonsterStats", () => {
  it("returns CR and XP for an exact name, ignoring case and curly apostrophes", async () => {
    monsterResults = [monster("wolf", "1/4")];
    expect(await o5GetMonsterStats("Wolf")).toEqual({ name: "wolf", crValue: 0.25, xp: 50 });
    monsterResults = [monster("Hag's Eye", "2")];
    expect(await o5GetMonsterStats("Hag’s Eye")).toEqual({ name: "Hag's Eye", crValue: 2, xp: 450 });
  });

  it("ignores a result whose name differs", async () => {
    monsterResults = [monster("Wolf")];
    expect(await o5GetMonsterStats("Wolf Lord")).toBeNull();
  });

  it("returns null when Open5e fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await o5GetMonsterStats("Wolf")).toBeNull();
  });
});
