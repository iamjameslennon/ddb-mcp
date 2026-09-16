import { getMonsterStats } from "./monster.js";
import { validateTreasureBudget, MAX_MONSTER_NAME_CHARS, MAX_TREASURE_OUTPUT_CHARS } from "../treasure-limits.js";

// ── Dice helpers ──────────────────────────────────────────────────────────────

function roll(n: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.floor(Math.random() * sides) + 1;
  return total;
}

function d100(): number {
  return roll(1, 100);
}

// ── Tier mapping ──────────────────────────────────────────────────────────────

type Tier = "0-4" | "5-10" | "11-16" | "17+";

function crToTier(cr: number): Tier {
  if (cr <= 4)  return "0-4";
  if (cr <= 10) return "5-10";
  if (cr <= 16) return "11-16";
  return "17+";
}

// ── Coin types ────────────────────────────────────────────────────────────────

interface Coins {
  cp: number;
  sp: number;
  gp: number;
  pp: number;
}

function zeroCoins(): Coins {
  return { cp: 0, sp: 0, gp: 0, pp: 0 };
}

function addCoins(a: Coins, b: Coins): Coins {
  return { cp: a.cp + b.cp, sp: a.sp + b.sp, gp: a.gp + b.gp, pp: a.pp + b.pp };
}

function coinsGp(c: Coins): number {
  return c.cp * 0.01 + c.sp * 0.1 + c.gp + c.pp * 10;
}

function formatCoins(c: Coins): string {
  const parts: string[] = [];
  if (c.cp) parts.push(`${c.cp.toLocaleString()} cp`);
  if (c.sp) parts.push(`${c.sp.toLocaleString()} sp`);
  if (c.gp) parts.push(`${c.gp.toLocaleString()} gp`);
  if (c.pp) parts.push(`${c.pp.toLocaleString()} pp`);
  return parts.length ? parts.join("  ·  ") : "—";
}

// ── XDMG Individual treasure (XDMG p.120) ────────────────────────────────────

function rollIndividualCoins(tier: Tier): Coins {
  const c = zeroCoins();
  switch (tier) {
    case "0-4":   c.gp = roll(3, 6);         break;  // 3d6 gp
    case "5-10":  c.gp = roll(2, 8) * 10;    break;  // 2d8×10 gp
    case "11-16": c.pp = roll(2, 10) * 10;   break;  // 2d10×10 pp
    case "17+":   c.pp = roll(2, 8) * 100;   break;  // 2d8×100 pp
  }
  return c;
}

function individualDiceExpr(tier: Tier): string {
  switch (tier) {
    case "0-4":   return "3d6 gp each";
    case "5-10":  return "2d8×10 gp each";
    case "11-16": return "2d10×10 pp each";
    case "17+":   return "2d8×100 pp each";
  }
}

// ── XDMG Hoard coins (XDMG p.120 and p.138) ──────────────────────────────────

interface HoardResult {
  coins: Coins;
  itemCount: number;
  itemDiceExpr: string;
}

function rollHoardCoins(tier: Tier): HoardResult {
  const c = zeroCoins();
  let itemCount = 0;
  let itemDiceExpr = "";

  switch (tier) {
    case "0-4":
      c.gp = roll(2, 4) * 100;
      itemCount = Math.max(0, roll(1, 4) - 1);
      itemDiceExpr = "1d4-1";
      break;
    case "5-10":
      c.gp = roll(8, 10) * 100;
      itemCount = roll(1, 3);
      itemDiceExpr = "1d3";
      break;
    case "11-16":
      c.gp = roll(8, 8) * 1000;
      itemCount = roll(1, 4);
      itemDiceExpr = "1d4";
      break;
    case "17+":
      c.gp = roll(6, 10) * 10000;
      itemCount = roll(1, 6);
      itemDiceExpr = "1d6";
      break;
  }

  return { coins: c, itemCount, itemDiceExpr };
}

// ── Magic item tables (XDMG p.218) ───────────────────────────────────────────

type Rarity = "common" | "uncommon" | "rare" | "very rare" | "legendary";
type ByLevelRange = "1-4" | "5-10" | "11-16" | "17-20";

const CATEGORIES = ["arcana", "armaments", "implements", "relics"] as const;
type Category = typeof CATEGORIES[number];

function charLevelToRange(level: number): ByLevelRange {
  if (level <= 4)  return "1-4";
  if (level <= 10) return "5-10";
  if (level <= 16) return "11-16";
  return "17-20";
}

const BY_LEVEL_TABLE: Record<ByLevelRange, Array<{ min: number; max: number; rarity: Rarity }>> = {
  "1-4": [
    { min: 1,  max: 54,  rarity: "common" },
    { min: 55, max: 91,  rarity: "uncommon" },
    { min: 92, max: 100, rarity: "rare" },
  ],
  "5-10": [
    { min: 1,  max: 30,  rarity: "common" },
    { min: 31, max: 81,  rarity: "uncommon" },
    { min: 82, max: 98,  rarity: "rare" },
    { min: 99, max: 100, rarity: "very rare" },
  ],
  "11-16": [
    { min: 1,  max: 11,  rarity: "common" },
    { min: 12, max: 34,  rarity: "uncommon" },
    { min: 35, max: 70,  rarity: "rare" },
    { min: 71, max: 93,  rarity: "very rare" },
    { min: 94, max: 100, rarity: "legendary" },
  ],
  "17-20": [
    { min: 1,  max: 20,  rarity: "rare" },
    { min: 21, max: 64,  rarity: "very rare" },
    { min: 65, max: 100, rarity: "legendary" },
  ],
};

const ITEM_TABLES: Record<Category, Record<Rarity, string[]>> = {
  arcana: {
    common: [
      "Bead of Nourishment", "Bead of Refreshment", "Candle of the Deep", "Cloak of Billowing",
      "Cloak of Many Fashions", "Clothes of Mending", "Dark Shard Amulet", "Enduring Spellbook",
      "Ersatz Eye", "Hat of Vermin", "Hat of Wizardry", "Heward's Handy Spice Pouch",
      "Horn of Silent Alarm", "Instrument of Illusions", "Instrument of Scribing", "Lock of Trickery",
      "Mystery Key", "Orb of Direction", "Orb of Time", "Perfume of Bewitching",
      "Pipe of Smoke Monsters", "Potion of Climbing", "Potion of Comprehension", "Pot of Awakening",
      "Prosthetic Limb", "Rival Coin", "Rope of Mending", "Ruby of the War Mage",
      "Spell Scroll", "Staff of Adornment", "Staff of Birdcalls", "Staff of Flowers",
      "Talking Doll", "Tankard of Sobriety", "Wand of Conducting", "Wand of Pyrotechnics",
    ],
    uncommon: [
      "Amulet of Proof against Detection and Location", "Baba Yaga's Dancing Broom", "Bag of Holding",
      "Bag of Tricks", "Brooch of Shielding", "Broom of Flying", "Cap of Water Breathing",
      "Circlet of Blasting", "Cloak of Protection", "Cloak of the Manta Ray", "Decanter of Endless Water",
      "Deck of Illusions", "Driftglobe", "Dust of Disappearance", "Dust of Dryness",
      "Dust of Sneezing and Choking", "Elemental Gem", "Enspelled Staff", "Eversmoking Bottle",
      "Eyes of Charming", "Eyes of Minute Seeing", "Figurine of Wondrous Power, Silver Raven",
      "Gem of Brightness", "Hag Eye", "Hat of Disguise", "Headband of Intellect",
      "Helm of Comprehending Languages", "Helm of Telepathy", "Immovable Rod", "Lantern of Revealing",
      "Medallion of Thoughts", "Mithral Armor", "Necklace of Adaptation", "Oil of Slipperiness",
      "Pearl of Power", "Periapt of Health", "Philter of Love", "Potion of Animal Friendship",
      "Potion of Fire Breath", "Potion of Hill Giant Strength", "Potion of Growth", "Potion of Poison",
      "Potion of Resistance", "Potion of Water Breathing", "Quaal's Feather Token",
      "Ring of Mind Shielding", "Robe of Useful Items", "Rod of the Pact Keeper", "Rope of Climbing",
      "Saddle of the Cavalier", "Sending Stones", "Slippers of Spider Climbing", "Spell Scroll",
      "Staff of the Adder", "Staff of the Python", "Wand of Magic Detection", "Wand of Magic Missiles",
      "Wand of Secrets", "+1 Wand of the War Mage", "Wand of Web", "Wind Fan", "Winged Boots",
    ],
    rare: [
      "Bag of Beans", "Bead of Force", "Bowl of Commanding Water Elementals", "Bracers of Defense",
      "Brazier of Commanding Fire Elementals", "Cape of the Mountebank", "Censer of Controlling Air Elementals",
      "Chime of Opening", "Cloak of Displacement", "Cloak of the Bat", "Cube of Force",
      "Cube of Summoning", "Daern's Instant Fortress", "Enspelled Staff", "Figurine of Wondrous Power",
      "Folding Boat", "Gem of Seeing", "Helm of Teleportation", "Heward's Handy Haversack",
      "Horseshoes of Speed", "Ioun Stone, Reserve", "Iron Bands of Bilarro", "Mantle of Spell Resistance",
      "Necklace of Fireballs", "Oil of Etherealness", "Portable Hole", "Potion of Clairvoyance",
      "Potion of Diminution", "Potion of Gaseous Form", "Potion of Fire Giant Strength",
      "Potion of Giant Strength", "Potion of Heroism", "Potion of Invisibility", "Potion of Invulnerability",
      "Potion of Mind Reading", "Quaal's Feather Token", "Ring of Feather Falling", "Ring of Spell Storing",
      "Ring of X-ray Vision", "Robe of Eyes", "Rod of Rulership", "+2 Rod of the Pact Keeper",
      "Scroll of Protection", "Spell Scroll", "Staff of Charming", "Staff of Swarming Insects",
      "Staff of Withering", "Stone of Controlling Earth Elementals", "Wand of Binding", "Wand of Fear",
      "Wand of Fireballs", "Wand of Lightning Bolts", "+2 Wand of the War Mage", "Wand of Wonder",
      "Wings of Flying",
    ],
    "very rare": [
      "Amulet of the Planes", "Bag of Devouring", "Carpet of Flying", "Cauldron of Rebirth",
      "Cloak of Arachnida", "Crystal Ball", "Dancing Sword", "Efreeti Bottle", "Enspelled Staff",
      "Figurine of Wondrous Power, Obsidian Steed", "Hat of Many Spells", "Helm of Brilliance",
      "Horseshoes of a Zephyr", "Ioun Stone", "Manual of Golems", "Mirror of Life Trapping",
      "Nolzur's Marvelous Pigments", "Oil of Sharpness", "Potion of Flying",
      "Potion of Cloud Giant Strength", "Potion of Greater Invisibility", "Potion of Longevity",
      "Potion of Speed", "Potion of Vitality", "Ring of Regeneration", "Ring of Shooting Stars",
      "Ring of Telekinesis", "Robe of Scintillating Colors", "Robe of Stars", "Rod of Absorption",
      "Rod of Security", "+3 Rod of the Pact Keeper", "Spell Scroll", "Staff of Fire", "Staff of Frost",
      "Staff of Power", "Staff of Thunder and Lightning", "Tome of Clear Thought", "Wand of Polymorph",
      "+3 Wand of the War Mage",
    ],
    legendary: [
      "Apparatus of Kwalish", "Cloak of Invisibility", "Crystal Ball of Mind Reading",
      "Crystal Ball of Telepathy", "Crystal Ball of True Seeing", "Cubic Gate", "Deck of Many Things",
      "Enspelled Staff", "Ioun Stone", "Iron Flask", "Potion of Storm Giant Strength",
      "Ring of Djinni Summoning", "Ring of Elemental Command", "Ring of Invisibility",
      "Ring of Spell Turning", "Ring of Three Wishes", "Robe of the Archmagi",
      "Scroll of Titan Summoning", "Sovereign Glue", "Spell Scroll (Level 9)", "Sphere of Annihilation",
      "Staff of the Magi", "Talisman of the Sphere", "Tome of the Stilled Tongue", "Universal Solvent",
      "Well of Many Worlds",
    ],
  },
  armaments: {
    common: [
      "Armor of Gleaming", "Cast-Off Armor", "Dread Helm", "Moon-Touched Sword",
      "Shield of Expression", "Silvered Weapon", "Smoldering Armor", "Sylvan Talon",
      "Veteran's Cane", "Walloping Ammunition",
    ],
    uncommon: [
      "Adamantine Armor", "Adamantine Weapon", "+1 Ammunition", "Bracers of Archery",
      "Enspelled Armor", "Enspelled Weapon", "Gauntlets of Ogre Power", "Javelin of Lightning",
      "Mariner's Armor", "Mithral Armor", "Potion of Hill Giant Strength", "Potion of Pugilism",
      "Quiver of Ehlonna", "Saddle of the Cavalier", "Sentinel Shield", "+1 Shield",
      "Sword of Vengeance", "Trident of Fish Command", "+1 Weapon", "Weapon of Warning",
      "+1 Wraps of Unarmed Power",
    ],
    rare: [
      "+2 Ammunition", "+1 Armor", "Armor of Resistance", "Armor of Vulnerability",
      "Arrow-Catching Shield", "Belt of Hill Giant Strength", "Berserker Axe", "Daern's Instant Fortress",
      "Dagger of Venom", "Dragon Slayer", "Elven Chain", "Enspelled Armor", "Enspelled Weapon",
      "Flame Tongue", "Giant Slayer", "Horn of Blasting", "Horn of Valhalla", "Ioun Stone",
      "Mace of Disruption", "Mace of Smiting", "Mace of Terror", "Potion of Fire Giant Strength",
      "Potion of Giant Strength", "Potion of Heroism", "Potion of Invulnerability", "Ring of Protection",
      "Ring of the Ram", "+2 Shield", "Shield of Missile Attraction", "Sun Blade",
      "Sword of Life Stealing", "Sword of Wounding", "Tentacle Rod", "Vicious Weapon",
      "+2 Weapon", "+2 Wraps of Unarmed Power",
    ],
    "very rare": [
      "+3 Ammunition", "Ammunition of Slaying", "Animated Shield", "+2 Armor",
      "Belt of Fire Giant Strength", "Belt of Giant Strength", "Dancing Sword", "Demon Armor",
      "Dragon Scale Mail", "Dwarven Plate", "Dwarven Thrower", "Energy Bow", "Enspelled Armor",
      "Enspelled Weapon", "Executioner's Axe", "Frost Brand", "Horn of Valhalla, Bronze",
      "Ioun Stone", "Lute of Thunderous Thumping", "Manual of Gainful Exercise", "Nine Lives Stealer",
      "Oathbow", "Oil of Sharpness", "Potion of Cloud Giant Strength", "Quarterstaff of the Acrobat",
      "Scimitar of Speed", "+3 Shield", "Shield of the Cavalier", "Spellguard Shield",
      "Sword of Sharpness", "Thunderous Greatclub", "+3 Weapon", "+3 Wraps of Unarmed Power",
    ],
    legendary: [
      "+3 Armor", "Armor of Invulnerability", "Belt of Cloud Giant Strength",
      "Belt of Storm Giant Strength", "Defender", "Efreeti Chain", "Enspelled Armor",
      "Enspelled Weapon", "Hammer of Thunderbolts", "Holy Avenger", "Horn of Valhalla, Iron",
      "Luck Blade", "Moonblade", "Plate Armor of Etherealness", "Potion of Storm Giant Strength",
      "Rod of Lordly Might", "Sword of Answering", "Vorpal Sword",
    ],
  },
  implements: {
    common: [
      "Bead of Nourishment", "Bead of Refreshment", "Boots of False Tracks", "Candle of the Deep",
      "Charlatan's Die", "Cloak of Many Fashions", "Clockwork Amulet", "Ear Horn of Hearing",
      "Ersatz Eye", "Heward's Handy Spice Pouch", "Horn of Silent Alarm", "Instrument of Illusions",
      "Instrument of Scribing", "Lock of Trickery", "Moon-Touched Sword", "Mystery Key",
      "Orb of Direction", "Orb of Time", "Perfume of Bewitching", "Pipe of Smoke Monsters",
      "Pole of Angling", "Pole of Collapsing", "Potion of Climbing", "Potion of Comprehension",
      "Potion of Healing", "Prosthetic Limb", "Rope of Mending", "Staff of Birdcalls",
      "Sylvan Talon", "Talking Doll", "Tankard of Sobriety", "Veteran's Cane",
      "Walloping Ammunition", "Wand of Conducting", "Wand of Enemy Detection", "Wand of Pyrotechnics",
    ],
    uncommon: [
      "Alchemy Jug", "+1 Ammunition", "Bag of Holding", "Boots of Elvenkind",
      "Boots of Striding and Springing", "Boots of the Winterlands", "Broom of Flying",
      "Cap of Water Breathing", "Cloak of Elvenkind", "Cloak of Protection", "Cloak of the Manta Ray",
      "Decanter of Endless Water", "Driftglobe", "Dust of Disappearance", "Dust of Dryness",
      "Dust of Sneezing and Choking", "Enspelled Weapon", "Eyes of Minute Seeing", "Eyes of the Eagle",
      "Gloves of Missile Snaring", "Gloves of Swimming and Climbing", "Gloves of Thievery",
      "Goggles of Night", "Hag Eye", "Helm of Comprehending Languages", "Immovable Rod",
      "Instrument of the Bards", "Lantern of Revealing", "Nature's Mantle", "Oil of Slipperiness",
      "Pipes of Haunting", "Pipes of the Sewers", "Potion of Growth", "Potion of Greater Healing",
      "Potion of Water Breathing", "Quaal's Feather Token", "Ring of Jumping", "Ring of Swimming",
      "Ring of Warmth", "Robe of Useful Items", "Rope of Climbing", "Stone of Good Luck",
      "Wand of Secrets",
    ],
    rare: [
      "+2 Ammunition", "Bag of Beans", "Belt of Dwarvenkind", "Boots of Levitation",
      "Boots of Speed", "Chime of Opening", "Dimensional Shackles", "Enspelled Weapon",
      "Folding Boat", "Glamoured Studded Leather", "Heward's Handy Haversack", "Horseshoes of Speed",
      "Instrument of the Bards", "Ioun Stone", "Portable Hole", "Potion of Diminution",
      "Potion of Gaseous Form", "Potion of Superior Healing", "Quaal's Feather Token",
      "Ring of Evasion", "Ring of Free Action", "Rope of Entanglement", "Staff of Healing",
      "Wand of Enemy Detection",
    ],
    "very rare": [
      "+3 Ammunition", "Bag of Devouring", "Carpet of Flying", "Enspelled Weapon",
      "Horseshoes of a Zephyr", "Instrument of the Bards, Anstruth Harp", "Ioun Stone",
      "Lute of Thunderous Thumping", "Manual of Quickness of Action", "Nolzur's Marvelous Pigments",
      "Potion of Flying", "Potion of Supreme Healing", "Potion of Speed", "Tome of Leadership and Influence",
    ],
    legendary: [
      "Enspelled Weapon", "Instrument of the Bards", "Sovereign Glue", "Sphere of Annihilation",
      "Talisman of the Sphere", "Universal Solvent",
    ],
  },
  relics: {
    common: [
      "Ear Horn of Hearing", "Potion of Healing", "Pot of Awakening", "Ruby of the War Mage",
      "Shield of Expression", "Smoldering Armor", "Spell Scroll", "Staff of Adornment",
      "Staff of Flowers",
    ],
    uncommon: [
      "Enspelled Staff", "Keoghtom's Ointment", "Mariner's Armor", "Nature's Mantle",
      "Pearl of Power", "Periapt of Health", "Periapt of Wound Closure", "Potion of Animal Friendship",
      "Potion of Greater Healing", "Potion of Resistance", "Ring of Water Walking", "Sending Stones",
      "Spell Scroll", "Staff of the Adder", "Staff of the Python", "Wand of Magic Detection",
      "+1 Wand of the War Mage",
    ],
    rare: [
      "Amulet of Health", "+1 Armor", "Bowl of Commanding Water Elementals",
      "Brazier of Commanding Fire Elementals", "Censer of Controlling Air Elementals",
      "Elixir of Health", "Enspelled Staff", "Horn of Blasting", "Horn of Valhalla", "Ioun Stone",
      "Mace of Disruption", "Mace of Smiting", "Mace of Terror", "Necklace of Prayer Beads",
      "Periapt of Proof against Poison", "Potion of Superior Healing", "Ring of Animal Influence",
      "Ring of Resistance", "Ring of Spell Storing", "Scroll of Protection", "Spell Scroll",
      "Staff of Charming", "Staff of Healing", "Staff of Swarming Insects", "Staff of the Woodlands",
      "Staff of Withering", "Stone of Controlling Earth Elementals", "Tentacle Rod",
      "Wand of Paralysis", "+2 Wand of the War Mage",
    ],
    "very rare": [
      "+2 Armor", "Candle of Invocation", "Cauldron of Rebirth", "Enspelled Staff",
      "Horn of Valhalla, Bronze", "Ioun Stone", "Manual of Bodily Health", "Potion of Supreme Healing",
      "Potion of Vitality", "Rod of Alertness", "Spell Scroll", "Spirit Board", "Staff of Fire",
      "Staff of Frost", "Staff of Striking", "Staff of Thunder and Lightning", "Tome of Understanding",
      "+3 Wand of the War Mage",
    ],
    legendary: [
      "Armor of Invulnerability", "+3 Armor", "Enspelled Staff", "Holy Avenger",
      "Horn of Valhalla, Iron", "Rod of Resurrection", "Scarab of Protection",
      "Scroll of Titan Summoning", "Spell Scroll (Level 9)", "Talisman of Pure Good",
      "Talisman of Ultimate Evil",
    ],
  },
};

function rollRarity(levelRange: ByLevelRange): Rarity {
  const roll100 = d100();
  const table = BY_LEVEL_TABLE[levelRange];
  const row = table.find(r => roll100 >= r.min && roll100 <= r.max);
  return row!.rarity;
}

function rollMagicItem(levelRange: ByLevelRange): { category: Category; rarity: Rarity; name: string } {
  const rarity = rollRarity(levelRange);
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const items = ITEM_TABLES[category][rarity];
  const name = items[Math.floor(Math.random() * items.length)];
  return { category, rarity, name };
}

function rollMagicItems(count: number, characterLevel: number): Array<{ category: Category; rarity: Rarity; name: string }> {
  const levelRange = charLevelToRange(characterLevel);
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(rollMagicItem(levelRange));
  }
  return results;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function crDisplay(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25)  return "1/4";
  if (cr === 0.5)   return "1/2";
  return String(cr);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function itemLabel(category: Category, rarity: Rarity): string {
  return `${titleCase(category)} – ${titleCase(rarity)}`;
}

/**
 * Caps a monster name before it's interpolated into output. Input names are
 * already bounded by validateTreasureBudget(), but *resolved* names come
 * from getMonsterStats() (DDB or Open5e) and are not under our control —
 * an oversized upstream display name must not be able to blow up the
 * formatted output.
 */
function displayName(name: string): string {
  return name.length > MAX_MONSTER_NAME_CHARS ? `${name.slice(0, MAX_MONSTER_NAME_CHARS)}…` : name;
}

/**
 * Accumulates output pieces (lines, or comma-joined segments) up to a fixed
 * character budget, refusing pushes that would exceed it rather than
 * building an unbounded string and slicing it afterward. Callers check the
 * boolean return to detect and report omissions explicitly.
 */
class BoundedAccumulator {
  readonly items: string[] = [];
  private used = 0;

  constructor(private readonly budget: number, private readonly separator: string = "\n") {}

  push(item: string): boolean {
    const addition = item.length + (this.items.length > 0 ? this.separator.length : 0);
    if (this.used + addition > this.budget) return false;
    this.items.push(item);
    this.used += addition;
    return true;
  }

  get charCount(): number {
    return this.used;
  }

  join(): string {
    return this.items.join(this.separator);
  }
}

// ── Input / output types ──────────────────────────────────────────────────────

export interface MonsterEntry {
  name: string;
  count: number;
}

export interface TreasureInput {
  cr?: number;
  monsters?: MonsterEntry[];
  treasureType: "individual" | "hoard";
  characterLevel?: number;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateTreasure(input: TreasureInput): Promise<string> {
  const { cr, monsters, treasureType, characterLevel } = input;

  if (cr === undefined && (!monsters || monsters.length === 0)) {
    return "Error: provide either cr or a monsters list.";
  }
  if (cr !== undefined && monsters && monsters.length > 0) {
    return "Error: provide either cr or monsters, not both.";
  }

  // Work-budget check — must run before any monster lookup or dice roll.
  // Runtime validation is mandatory here (not just in the MCP Zod schema in
  // index.ts) because direct callers of generateTreasure() bypass Zod.
  const budgetError = validateTreasureBudget({ monsters, treasureType });
  if (budgetError) return budgetError;

  // ── Direct CR path ────────────────────────────────────────────────────────
  if (cr !== undefined) {
    const tier = crToTier(cr);
    const crStr = crDisplay(cr);

    if (treasureType === "hoard") {
      const { coins, itemCount, itemDiceExpr } = rollHoardCoins(tier);
      const items = characterLevel !== undefined && itemCount > 0
        ? rollMagicItems(itemCount, characterLevel)
        : [];
      const totalGp = Math.round(coinsGp(coins) * 100) / 100;
      return formatHoardOutput(crStr, tier, undefined, coins, itemCount, itemDiceExpr, items, characterLevel, totalGp);
    } else {
      const coins = rollIndividualCoins(tier);
      const totalGp = Math.round(coinsGp(coins) * 100) / 100;
      return formatIndividualOutput(
        [{ label: `CR ${crStr}`, tier, count: 1 }],
        [coins],
        totalGp,
        1
      );
    }
  }

  // ── Monster list path ─────────────────────────────────────────────────────
  const monsterList = monsters!;
  const uniqueNames = [...new Set(monsterList.map(m => m.name))];
  const statsResults = await Promise.all(uniqueNames.map(n => getMonsterStats(n)));
  const resolvedMap = new Map<string, { name: string; crValue: number } | null>();
  for (let i = 0; i < uniqueNames.length; i++) {
    resolvedMap.set(uniqueNames[i], statsResults[i]);
  }

  const found: Array<{ inputName: string; name: string; crValue: number; count: number }> = [];
  const notFound: string[] = [];

  for (const entry of monsterList) {
    const stats = resolvedMap.get(entry.name);
    if (stats) {
      found.push({ inputName: entry.name, name: stats.name, crValue: stats.crValue, count: entry.count });
    } else {
      if (!notFound.includes(entry.name)) notFound.push(entry.name);
    }
  }

  if (found.length === 0) {
    // Reserve room for the closing "No treasure rolled" message so it's
    // never the casualty of a long unresolved-name list.
    const closing = [``, `No treasure rolled — no monsters could be resolved. Provide cr directly.`];
    const acc = new BoundedAccumulator(MAX_TREASURE_OUTPUT_CHARS - closing.join("\n").length - 1);
    acc.push(`TREASURE — could not resolve all monsters`);
    acc.push(``);
    let omitted = 0;
    for (const entry of monsterList) {
      if (!acc.push(`  ✗ "${displayName(entry.name)}" — not found in DDB or Open5e`)) omitted++;
    }
    if (omitted > 0) {
      acc.push(`  … ${omitted} more unresolved name${omitted !== 1 ? "s" : ""} omitted to stay under the ${MAX_TREASURE_OUTPUT_CHARS.toLocaleString()}-character output limit`);
    }
    return [...acc.items, ...closing].join("\n");
  }

  // Resolution status block (only shown when some names didn't resolve).
  // Bounded independently of the treasure body below — its size is
  // subtracted from the body's own budget so the combined output never
  // exceeds MAX_TREASURE_OUTPUT_CHARS.
  const STATUS_SECTION_BUDGET = 8_000;
  const statusLines: string[] = [];
  if (notFound.length > 0) {
    const acc = new BoundedAccumulator(STATUS_SECTION_BUDGET);
    acc.push(`TREASURE — could not resolve all monsters`);
    acc.push(``);
    let omitted = 0;
    for (const f of found) {
      if (!acc.push(`  ✓ ${displayName(f.inputName)} → CR ${crDisplay(f.crValue)}`)) omitted++;
    }
    for (const n of notFound) {
      if (!acc.push(`  ✗ "${displayName(n)}" — not found in DDB or Open5e`)) omitted++;
    }
    if (omitted > 0) {
      acc.push(`  … ${omitted} more resolution note${omitted !== 1 ? "s" : ""} omitted to stay under the output limit`);
    }
    acc.push(``);
    statusLines.push(...acc.items);
  }
  const bodyBudget = Math.max(0, MAX_TREASURE_OUTPUT_CHARS - (statusLines.length > 0 ? statusLines.join("\n").length + 1 : 0));

  if (treasureType === "hoard") {
    const highestCr = Math.max(...found.map(f => f.crValue));
    const tier = crToTier(highestCr);
    const { coins, itemCount, itemDiceExpr } = rollHoardCoins(tier);
    const items = characterLevel !== undefined && itemCount > 0
      ? rollMagicItems(itemCount, characterLevel)
      : [];
    const totalGp = Math.round(coinsGp(coins) * 100) / 100;

    const sourceAcc = new BoundedAccumulator(4_000, ", ");
    let sourceOmitted = 0;
    for (const f of found) {
      const seg = `${f.count > 1 ? f.count + " × " : ""}${displayName(f.name)} (CR ${crDisplay(f.crValue)})`;
      if (!sourceAcc.push(seg)) sourceOmitted++;
    }
    let sourceDesc = sourceAcc.join();
    if (sourceOmitted > 0) sourceDesc += `, … +${sourceOmitted} more`;

    return [
      ...statusLines,
      ...formatHoardOutput(crDisplay(highestCr), tier, sourceDesc, coins, itemCount, itemDiceExpr, items, characterLevel, totalGp, bodyBudget).split("\n"),
    ].join("\n");
  } else {
    // Individual — one roll per monster instance
    const rollEntries: Array<{ label: string; tier: Tier; count: number }> = [];
    const allCoins: Coins[] = [];

    for (const f of found) {
      const tier = crToTier(f.crValue);
      rollEntries.push({ label: `${displayName(f.name)} (CR ${crDisplay(f.crValue)})`, tier, count: f.count });
      for (let i = 0; i < f.count; i++) {
        allCoins.push(rollIndividualCoins(tier));
      }
    }

    const totalMonsters = found.reduce((sum, f) => sum + f.count, 0);
    const combined = allCoins.reduce(addCoins, zeroCoins());
    const totalGp = Math.round(coinsGp(combined) * 100) / 100;

    return [
      ...statusLines,
      ...formatIndividualOutput(rollEntries, allCoins, totalGp, totalMonsters, bodyBudget).split("\n"),
    ].join("\n");
  }
}

// ── Output builders ───────────────────────────────────────────────────────────

function formatHoardOutput(
  crStr: string,
  tier: Tier,
  sourceDesc: string | undefined,
  coins: Coins,
  itemCount: number,
  itemDiceExpr: string,
  items: Array<{ category: Category; rarity: Rarity; name: string }>,
  characterLevel: number | undefined,
  totalGp: number,
  outputBudget: number = MAX_TREASURE_OUTPUT_CHARS
): string {
  const lines: string[] = [];
  lines.push(`TREASURE HOARD — CR ${crStr} (tier ${tier})`);
  // sourceDesc is pre-bounded by the caller (a BoundedAccumulator over the
  // found-monster segments), so it can't itself be unbounded, but it can
  // still be a few thousand characters — account for its actual length
  // below rather than assuming a fixed small reserve.
  if (sourceDesc) lines.push(`Source: ${sourceDesc} — using highest CR`);
  lines.push(``);
  lines.push(`COINS`);
  lines.push(`  ${formatCoins(coins)}`);
  lines.push(``);

  const totalLine = `TOTAL VALUE  ~${totalGp.toLocaleString()} gp`;

  if (characterLevel !== undefined) {
    const levelRange = charLevelToRange(characterLevel);
    if (itemCount === 0) {
      lines.push(`MAGIC ITEMS — ${itemDiceExpr} = 0 rolled (no items this hoard)`);
    } else {
      lines.push(`MAGIC ITEMS — ${itemDiceExpr} = ${itemCount} rolled (character level ${characterLevel}, table: levels ${levelRange})`);

      // Item count is dice-bounded (at most 1d6 = 6), but stay consistent
      // with the rest of the formatter and never build an unbounded list.
      // Reserve room for everything already written (including the
      // variable-length sourceDesc line), the trailing blank + TOTAL VALUE
      // line, and a worst-case omission note.
      const trailer = [``, totalLine];
      const omissionReserve = 120;
      const fixedLength = lines.join("\n").length
        + 1 /* nl connecting the item-header line to the first item line */
        + 1 /* nl connecting the last item line to the trailer block */
        + trailer.join("\n").length;
      const itemBudget = Math.max(0, outputBudget - fixedLength - omissionReserve);

      const itemAcc = new BoundedAccumulator(itemBudget);
      let itemsOmitted = 0;
      for (let i = 0; i < items.length; i++) {
        const { category, rarity, name } = items[i];
        if (!itemAcc.push(`  ${i + 1}. ${displayName(name)}  [${itemLabel(category, rarity)}]`)) itemsOmitted++;
      }
      lines.push(...itemAcc.items);
      if (itemsOmitted > 0) {
        lines.push(`  … ${itemsOmitted} more item${itemsOmitted !== 1 ? "s" : ""} omitted to stay under the output limit`);
      }
    }
    lines.push(``);
  } else {
    lines.push(`(provide character_level to include magic items)`);
    lines.push(``);
  }

  lines.push(totalLine);
  return lines.join("\n");
}

function formatIndividualOutput(
  entries: Array<{ label: string; tier: Tier; count: number }>,
  allCoins: Coins[],
  totalGp: number,
  totalMonsters: number,
  outputBudget: number = MAX_TREASURE_OUTPUT_CHARS
): string {
  // Coin totals are always preserved in full, even when per-roll detail is
  // omitted for budget reasons — compute them up front, independent of how
  // much of the roll-detail list ends up displayed.
  const combined = allCoins.reduce(addCoins, zeroCoins());
  const trailer = [
    ``,
    `COINS (combined)`,
    `  ${formatCoins(combined)}`,
    ``,
    `TOTAL VALUE  ~${totalGp.toLocaleString()} gp`,
  ];
  const trailerText = trailer.join("\n");
  // Reserve room for the trailer plus a worst-case omission line so the
  // accumulator never has to choose between reporting an omission and
  // keeping the totals.
  const omissionReserve = 160;
  const bodyBudget = Math.max(0, outputBudget - trailerText.length - 1 - omissionReserve);

  const acc = new BoundedAccumulator(bodyBudget);
  acc.push(`INDIVIDUAL TREASURE — ${totalMonsters} monster${totalMonsters !== 1 ? "s" : ""} rolled separately`);
  acc.push(``);

  let coinIdx = 0;
  let omittedRolls = 0;
  let truncated = false;

  for (const entry of entries) {
    if (truncated) {
      omittedRolls += entry.count;
      continue;
    }
    const diceExpr = individualDiceExpr(entry.tier);
    const entryHeaderLine = `  ${entry.label} ×${entry.count} — ${entry.count} roll${entry.count !== 1 ? "s" : ""} on tier ${entry.tier} (${diceExpr})`;
    if (!acc.push(entryHeaderLine)) {
      truncated = true;
      omittedRolls += entry.count;
      continue;
    }
    for (let i = 0; i < entry.count; i++) {
      const rollLine = `    Roll ${i + 1}: ${formatCoins(allCoins[coinIdx++])}`;
      if (!acc.push(rollLine)) {
        truncated = true;
        omittedRolls += entry.count - i;
        break;
      }
    }
  }

  const lines = [...acc.items];
  if (truncated) {
    lines.push(``, `  … ${omittedRolls} roll line${omittedRolls !== 1 ? "s" : ""} omitted to stay under the ${MAX_TREASURE_OUTPUT_CHARS.toLocaleString()}-character output limit (coin totals below include every roll)`);
  }
  lines.push(...trailer);
  return lines.join("\n");
}
