// Record the Open5e v2 fixtures under tests/fixtures/open5e-v2/ from the live
// API, and re-prove the live facts the Open5e loader (src/open5e.ts) relies on.
//
//   npx tsx scripts/record-open5e-fixtures.mts      # needs no login
//
// Drift in a document's record count (more than 10%) only warns, since Open5e
// edits content. Any other failed assertion exits 1 and writes nothing: the
// loader's filtering assumptions no longer hold and need a human.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://api.open5e.com/v2";
const DOCS = ["srd-2024", "srd-2014"] as const;
type Doc = typeof DOCS[number];
const ENDPOINTS = ["spells", "creatures", "items", "magicitems", "weapons", "armor", "species", "classes", "backgrounds", "feats", "rulesets"] as const;
type Endpoint = typeof ENDPOINTS[number];
const EQUIPMENT: readonly Endpoint[] = ["items", "magicitems", "weapons", "armor"];
const OUT_DIR = fileURLToPath(new URL("../tests/fixtures/open5e-v2/", import.meta.url));

// Live counts (2026-10-20): [srd-2024, srd-2014].
const COUNTS: Record<Endpoint, [number, number]> = {
  spells: [339, 319], creatures: [331, 325], items: [203, 237], magicitems: [760, 499],
  weapons: [38, 37], armor: [13, 12], species: [9, 13], classes: [24, 24],
  backgrounds: [4, 1], feats: [17, 1], rulesets: [11, 41],
};

interface Names { both: string[]; only2024: string[]; only2014: string[] }
const NAMES: Record<Endpoint, Names> = {
  spells: { both: ["Fireball", "Fire Bolt", "Acid Arrow", "Arcane Hand", "Sleep"], only2024: ["Befuddlement", "Shining Smite"], only2014: ["Feeblemind", "Branding Smite"] },
  creatures: {
    both: ["Aboleth", "Wolf", "Zombie", "Red Dragon Wyrmling", "Young Red Dragon", "Adult Red Dragon", "Ancient Red Dragon"],
    only2024: ["Goblin Warrior", "Goblin Boss", "Allosaurus", "Tough"], only2014: ["Goblin", "Thug", "Orc", "Half-Red Dragon Veteran"],
  },
  items: {
    both: ["Longsword", "Net"], only2024: ["Rope", "Antitoxin", "Alchemist's Fire", "Smith's Tools (20 GP)"],
    only2014: ["Abacus", "Rope, hempen (50 feet)", "Smith's tools"],
  },
  // The Flame Tongues, Vicious Light Hammer and Smith's tools pair across the documents by o5EquipmentKey
  // (carry-over (r)); Net (+1) and Shield (+1) must not pair with Net and Shield.
  magicitems: {
    both: ["Bag of Holding"],
    only2024: ["Ammunition (+1)", "Flame Tongue Greatsword", "Flame Tongue Longsword", "Flame Tongue Rapier", "Flame Tongue Shortsword", "Vicious Light Hammer", "Shield (+1)"],
    only2014: ["Armor of Resistance (Hide)", "Flame Tongue (Greatsword)", "Flame Tongue (Longsword)", "Flame Tongue (Rapier)", "Flame Tongue (Shortsword)", "Vicious Weapon (Light-Hammer)", "Net (+1)"],
  },
  weapons: { both: ["Longsword", "Dagger"], only2024: ["Musket", "Hand Crossbow"], only2014: ["Net", "Crossbow, hand"] },
  armor: { both: [], only2024: ["Chain Mail", "Hide Armor", "Shield"], only2014: ["Chain mail", "Hide"] },
  species: { both: ["Dwarf", "Elf", "Human"], only2024: ["Goliath"], only2014: ["High Elf"] },
  classes: { both: ["Fighter", "Champion", "Wizard", "Warlock", "Druid"], only2024: ["Evoker"], only2014: ["School of Evocation"] },
  backgrounds: { both: ["Acolyte"], only2024: ["Sage"], only2014: [] },
  feats: { both: ["Grappler"], only2024: ["Alert"], only2014: [] },
  rulesets: { both: ["Damage and Healing"], only2024: ["Combat", "D20 Tests", "Social Interaction"], only2014: ["Attacking", "Cover", "Madness"] },
};
// Net is 2014 weapons only (SRD 5.2 lists it under items) and Musket is 2024
// only but also in 2024 items; neither is an equipment fallback case. Hide
// Armor and Shield are 2024 armor, but srd-2014 items has both (live
// 2026-10-21; srd-2014 armor has only "Hide" and "Chain mail").
const CROSS_CHECK_SKIP = new Set(["Net", "Musket", "Hide Armor", "Shield"]);

type Rec = { name: string; document: { key: string; name?: string } | string; [k: string]: unknown };
const docKey = (r: Rec): string => (typeof r.document === "string" ? r.document : r.document.key);

const failures: string[] = [];
const fail = (msg: string): void => { failures.push(msg); console.error(`FAIL ${msg}`); };

async function getJson(url: string): Promise<{ count: number; next: string | null; results: Rec[] }> {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${url}`);
  return await resp.json() as { count: number; next: string | null; results: Rec[] };
}

const live = new Map<string, { count: number; results: Rec[] }>();
for (const endpoint of ENDPOINTS) {
  for (const [i, doc] of DOCS.entries()) {
    const body = await getJson(`${API}/${endpoint}/?document__key__in=${doc}&limit=1000`);
    const id = `${doc}/${endpoint}`;
    live.set(id, { count: body.count, results: body.results });
    if (body.next) fail(`${id}: next is not null (${body.next})`);
    const wrong = body.results.filter(r => docKey(r) !== doc);
    if (wrong.length) fail(`${id}: ${wrong.length} records from another document (first: ${wrong[0].name})`);
    if (body.results.length !== body.count) fail(`${id}: count ${body.count} but ${body.results.length} records`);
    const expected = COUNTS[endpoint][i];
    if (Math.abs(body.count - expected) > expected * 0.1) {
      console.warn(`WARN ${id}: count ${body.count} drifted more than 10% from ${expected}`);
    }
  }
}

const has = (doc: Doc, endpoint: Endpoint, name: string): boolean =>
  live.get(`${doc}/${endpoint}`)!.results.some(r => r.name === name);

for (const endpoint of ENDPOINTS) {
  const n = NAMES[endpoint];
  for (const name of n.both) for (const doc of DOCS) if (!has(doc, endpoint, name)) fail(`${doc}/${endpoint}: missing "${name}"`);
  for (const name of n.only2024) {
    if (!has("srd-2024", endpoint, name)) fail(`srd-2024/${endpoint}: missing "${name}"`);
    if (has("srd-2014", endpoint, name)) fail(`srd-2014/${endpoint}: unexpectedly has "${name}"`);
  }
  for (const name of n.only2014) {
    if (!has("srd-2014", endpoint, name)) fail(`srd-2014/${endpoint}: missing "${name}"`);
    if (has("srd-2024", endpoint, name)) fail(`srd-2024/${endpoint}: unexpectedly has "${name}"`);
  }
}

// An equipment name that is one edition's only must be absent from all four
// equipment endpoints of the other document, so fallback tests cannot pass
// merely because a fixture was trimmed.
for (const endpoint of EQUIPMENT) {
  for (const [names, otherDoc] of [[NAMES[endpoint].only2024, "srd-2014"], [NAMES[endpoint].only2014, "srd-2024"]] as const) {
    for (const name of names) {
      if (CROSS_CHECK_SKIP.has(name)) continue;
      for (const other of EQUIPMENT) if (has(otherDoc, other, name)) fail(`${otherDoc}/${other}: has "${name}", which ${endpoint} treats as the other edition's only`);
    }
  }
}

const bogus = await getJson(`${API}/spells/?document__key__in=bogus&limit=1`);
if (bogus.count !== 0) fail(`spells with document__key__in=bogus has count ${bogus.count}, expected 0`);

const loose = await getJson(`${API}/magicitems/?document__key=srd-2014&limit=50`);
if (loose.results.some(r => docKey(r) === "srd-2024")) {
  console.log("note: magicitems still ignores document__key (returns srd-2024 records)");
} else {
  console.log("note: magicitems now honours document__key; the loader's client-side filter is still harmless");
}

if (failures.length) {
  console.error(`${failures.length} assertion(s) failed; fixtures not written`);
  process.exit(1);
}

for (const doc of DOCS) {
  mkdirSync(`${OUT_DIR}${doc}`, { recursive: true });
  for (const endpoint of ENDPOINTS) {
    const { count, results } = live.get(`${doc}/${endpoint}`)!;
    const n = NAMES[endpoint];
    const keep = new Set([...n.both, ...n.only2024, ...n.only2014]);
    const kept = results
      .filter(r => keep.has(r.name))
      .map(r => {
        const d = typeof r.document === "string" ? r.document : { key: r.document.key, name: r.document.name };
        const slim: Rec = { ...r, document: d };
        delete slim.crossreferences;
        return slim;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    writeFileSync(`${OUT_DIR}${doc}/${endpoint}.json`, JSON.stringify({ count, next: null, previous: null, results: kept }, null, 2) + "\n");
    console.log(`ok ${doc}/${endpoint}: ${kept.length} of ${count} records kept`);
  }
}

// Every equipment record name of both documents, for the whole-document pairing test of o5EquipmentKey
// (tests/open5e.test.ts). A re-record that changes the pairing count fails that test: re-check the pairs.
const equipmentNames: Record<string, unknown> = {
  note: `Every record name of the four Open5e v2 equipment endpoints, per SRD document (live ${new Date().toISOString().slice(0, 10)}). Written by scripts/record-open5e-fixtures.mts.`,
};
for (const doc of DOCS) {
  equipmentNames[doc] = Object.fromEntries(EQUIPMENT.map(endpoint =>
    [endpoint, live.get(`${doc}/${endpoint}`)!.results.map(r => r.name).sort((a, b) => a.localeCompare(b))]));
}
writeFileSync(`${OUT_DIR}equipment-names.json`, JSON.stringify(equipmentNames, null, 1) + "\n");
console.log("ok equipment-names.json");
