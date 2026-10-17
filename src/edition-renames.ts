/**
 * 2014 → 2024 name changes, for content D&D Beyond reissued under a new name
 * (the spec's unverified example: the 2014 Basic Rules' "Acid Arrow" and the
 * 2024 "Melf's Acid Arrow"). `twinName()` in edition.ts maps each 2014 name to
 * its 2024 name so both land in one twin group. The 2024 side is canonical.
 *
 * Only pairs verified by reading both descriptions belong here: same thing,
 * same level/rarity/CR, text clearly a revision. Each pair carries its evidence
 * in a comment. Propose candidates with `npx tsx scripts/dump-edition-renames.mts`
 * (needs ddb_login). tests/edition.test.ts rejects chains, duplicates and
 * self-maps.
 */
export const EDITION_RENAMES: ReadonlyArray<readonly [name2014: string, name2024: string]> = [
  // Verified live 2026-10-17. Books: BR14 = Basic Rules (2014), PHB24 = Player's Handbook (2024),
  // DMG24 = Dungeon Master's Guide (2024), MM24 = Monster Manual (2024). "orphan lists" = found by
  // cross-matching the script's two orphan lists, not by its heuristic.

  // ── Spells ──
  // 2014 id 2145 (BR14, level 1) → 2024 id 2619132 (PHB24, level 1); name-contains, sim 0.38: same Wis save, prone + incapacitated, re-save on damage with advantage
  ["Hideous Laughter", "Tasha's Hideous Laughter"],
  // 2014 id 2280 (BR14, level 3) → 2024 id 2619013 (PHB24, level 3); name-contains, sim 0.54: same 10-ft force dome/Emanation, comfortable and dry, opaque outside
  ["Tiny Hut", "Leomund's Tiny Hut"],
  // 2014 id 2179 (BR14, level 7) → 2024 id 2619112 (PHB24, level 7); name-contains, sim 0.77: same extradimensional dwelling behind a 5x10-ft door, open/close within 30 ft
  ["Magnificent Mansion", "Mordenkainen's Magnificent Mansion"],
  // 2014 id 2110 (BR14, level 1) → 2024 id 2619169 (PHB24, level 1); name-contains, sim 1.00: near-verbatim text (3-ft disk of force, 500 lb)
  ["Floating Disk", "Tenser's Floating Disk"],
  // 2014 id 1988 (BR14, level 2) → 2024 id 2619032 (PHB24, level 2); name-contains, sim 0.85: same ranged spell attack, 4d4 acid + 2d4 next turn, half on miss
  ["Acid Arrow", "Melf's Acid Arrow"],
  // 2014 id 2005 (BR14, level 2) → 2024 id 2619124 (PHB24, level 2); sim 0.61: SRD name for Nystul's; same Mask/False Aura effects, permanent after 30 days
  ["Arcanist's Magic Aura", "Nystul's Magic Aura"],
  // 2014 id 2014 (BR14, level 4) → 2024 id 2619187 (PHB24, level 4); name-contains, sim 0.66: same 20-ft square of tentacles, difficult terrain, 3d6 bludgeoning + restrained
  ["Black Tentacles", "Evard's Black Tentacles"],
  // 2014 id 2230 (BR14, level 4) → 2024 id 2619128 (PHB24, level 4); name-contains, sim 0.90: same force sphere around a Large-or-smaller target, Dex save
  ["Resilient Sphere", "Otiluke's Resilient Sphere"],
  // 2014 id 2240 (BR14, level 4) → 2024 id 2619012 (PHB24, level 4); name-contains, sim 0.65: same chest hidden on the Ethereal Plane, 12 cubic feet, replica recall
  ["Secret Chest", "Leomund's Secret Chest"],
  // 2014 id 2002 (BR14, level 5) → 2024 id 2618928 (PHB24, level 5); sim 0.61: SRD name for Bigby's; same Large force hand, AC 20, HP = your max, fist/forceful/grasping/interposing
  ["Arcane Hand", "Bigby's Hand"],
  // 2014 id 2274 (BR14, level 5) → 2024 id 2618925 (PHB24, level 5); name-contains, sim 0.82: same telepathic link among up to eight willing creatures
  ["Telepathic Bond", "Rary's Telepathic Bond"],
  // 2014 id 2117 (BR14, level 6) → 2024 id 2619126 (PHB24, level 6); name-contains, sim 0.80: same 60-ft-radius cold burst, 10d6 Con save, freezes water
  ["Freezing Sphere", "Otiluke's Freezing Sphere"],
  // 2014 id 2158 (BR14, level 6) → 2024 id 2619154 (PHB24, level 6); name-contains, sim 0.75: same sapphire-marked object of ≤10 lb summoned by crushing the sapphire
  ["Instant Summons", "Drawmij's Instant Summons"],
  // 2014 id 2216 (BR14, level 4) → 2024 id 2619114 (PHB24, level 4); name-contains, sim 0.83: same 5–100-ft warded cube with selectable security properties
  ["Private Sanctum", "Mordenkainen's Private Sanctum"],
  // 2014 id 2092 (BR14, level 4) → 2024 id 2619110 (PHB24, level 4); name-contains, sim 0.51: same invisible phantom watchdog, password, barks, 4d8 bite
  ["Faithful Hound", "Mordenkainen's Faithful Hound"],
  // 2014 id 2326 (BR14, level 2, concentration) → 2024 id 2618838 (PHB24, level 2, concentration); orphan lists: same paladin smite, +2d6 radiant, target sheds light and can't be invisible
  ["Branding Smite", "Shining Smite"],

  // ── Items: magic items ──
  // 2014 id 4572 (BR14, Legendary) → 2024 id 9228348 (DMG24, Legendary); sim 0.89: SRD name for Kwalish's; same 500-lb iron barrel, DC 20 catch, ten levers
  ["Apparatus of the Crab", "Apparatus of Kwalish"],
  // 2014 id 4628 (BR14, Uncommon) → 2024 id 5367 (DMG24, Uncommon); sim 0.95: SRD name for Ehlonna's; same three compartments (60 arrows / 18 javelins / 6 long objects)
  ["Efficient Quiver", "Quiver of Ehlonna"],
  // 2014 id 4650 (BR14, Rare) → 2024 id 9228722 (DMG24, Rare); name-contains, sim 0.73: same backpack with central + two side extradimensional pouches, always 5 lb
  ["Handy Haversack", "Heward's Handy Haversack"],
  // 2014 id 4663 (BR14, Rare) → 2024 id 9228414 (DMG24, Rare); name-contains, sim 0.58: same 1-inch cube/statuette that grows into a square tower on a command word
  ["Instant Fortress", "Daern's Instant Fortress"],
  // 2014 id 4678 (BR14, Very Rare) → 2024 id 9228905 (DMG24, Very Rare); name-contains, sim 0.44: same box of 1d4 pots + brush that paints real objects
  ["Marvelous Pigments", "Nolzur's Marvelous Pigments"],
  // 2014 ids 4758, 5161–5169 (BR14) → 2024 ids 8960642, 8960643, 9229076–9229079, 9229081–9229084 (DMG24); 2nd–9th sim 0.77, others orphan lists:
  // same item, "Nth Level" became "Level N"; rarities match level for level (Common, Common, Uncommon ×2, Rare ×2, Very Rare ×3, Legendary)
  ["Spell Scroll (0 - Cantrip)", "Spell Scroll (Cantrip)"],
  ["Spell Scroll (1st Level)", "Spell Scroll (Level 1)"],
  ["Spell Scroll (2nd Level)", "Spell Scroll (Level 2)"],
  ["Spell Scroll (3rd Level)", "Spell Scroll (Level 3)"],
  ["Spell Scroll (4th Level)", "Spell Scroll (Level 4)"],
  ["Spell Scroll (5th Level)", "Spell Scroll (Level 5)"],
  ["Spell Scroll (6th Level)", "Spell Scroll (Level 6)"],
  ["Spell Scroll (7th Level)", "Spell Scroll (Level 7)"],
  ["Spell Scroll (8th Level)", "Spell Scroll (Level 8)"],
  ["Spell Scroll (9th Level)", "Spell Scroll (Level 9)"],
  // 2014 ids 5182, 5183, 5184, 3414177, 3414194 (BR14, Rare) → 2024 ids 9229143, 9229145, 9229151, 9229131, 9229146 (DMG24, Rare); orphan lists:
  // same Vicious weapon on the same base weapon type and weight; comma names dropped, extra damage revised (7 on a 20 → 2d6 on every hit)
  ["Vicious Crossbow, Hand", "Vicious Hand Crossbow"],
  ["Vicious Crossbow, Heavy", "Vicious Heavy Crossbow"],
  ["Vicious Crossbow, Light", "Vicious Light Crossbow"],
  ["Vicious Rifle, Automatic", "Vicious Automatic Rifle"],
  ["Vicious Rifle, Hunting", "Vicious Hunting Rifle"],

  // ── Items: poisons ──
  // 2014 ids 137–139, 141–150, 68 (BR14, Common, Gear) → 2024 ids 553–556, 558–566, 398 (DMG24, Common, Gear); orphan lists:
  // same poison at the same price; the "(Ingested)"/"(Injury)"/… suffix moved into the text, conditions rewritten in 2024 terms
  ["Assassin's Blood (Ingested)", "Assassin’s Blood"],
  ["Burnt Othur Fumes (Inhaled)", "Burnt Othur Fumes"],
  ["Crawler Mucus (Contact)", "Carrion Crawler Mucus"],
  ["Essence of Ether (Inhaled)", "Essence of Ether"],
  ["Malice (Inhaled)", "Malice"],
  ["Midnight Tears (Ingested)", "Midnight Tears"],
  ["Oil of Taggit (Contact)", "Oil of Taggit"],
  ["Pale Tincture (Ingested)", "Pale Tincture"],
  ["Purple Worm Poison (Injury)", "Purple Worm Poison"],
  ["Serpent Venom (Injury)", "Serpent Venom"],
  ["Torpor (Ingested)", "Torpor"],
  ["Truth Serum (Ingested)", "Truth Serum"],
  ["Wyvern Poison (Injury)", "Wyvern Poison"],
  ["Poison, Basic (vial)", "Basic Poison"],

  // ── Items: adventuring gear, ammunition, mounts ──
  // 2014 BR14 → 2024 PHB24, all Common, each with the same cost and weight (Dragonchess 0.5 lb → 0 lb is the one weight change);
  // same item with the container/quantity moved out of the name or the "Noun, Adjective" order flipped. Ids 2014 → 2024:
  // 18→500 · 19→504 · 21→406 · 2→516 (sim 1.00) · 3→510 (sim 1.00) · 28→476 · 30→497 · 32→505 · 33→518 · 34→521 · 39→536 · 40→539 · 41→541
  ["Acid (vial)", "Acid"],
  ["Alchemist's Fire (flask)", "Alchemist's Fire"],
  ["Ball Bearings (bag of 1,000)", "Ball Bearings"],
  ["Blowgun Needles", "Needles"],
  ["Crossbow Bolts", "Bolts"],
  ["Bottle, Glass", "Glass Bottle"],
  ["Caltrops (bag of 20)", "Caltrops"],
  ["Case, Crossbow Bolt", "Crossbow Bolt Case"],
  ["Case, Map or Scroll", "Map or Scroll Case"],
  ["Chain (10 feet)", "Chain"],
  ["Clothes, Costume", "Costume"],
  ["Clothes, Fine", "Fine Clothes"],
  ["Clothes, Traveler's", "Traveler's Clothes"],
  // 121→449 · 190→453 · 122→455 · 189→458 (gaming sets) · 163→451 (mount, 8 gp, mule stat block in both) · 172→461 (sim 1.00) · 45→519 · 50→507 · 9→503 · 53→499 · 54→498
  ["Dice Set", "Dice"],
  ["Dragonchess Set", "Dragonchess"],
  ["Playing Card Set", "Playing Cards"],
  ["Three-Dragon Ante Set", "Three-Dragon Ante"],
  ["Donkey (or Mule)", "Mule"],
  ["Feed (per day)", "Feed per day"],
  ["Flask or Tankard", "Flask"],
  ["Holy Water (flask)", "Holy Water"],
  ["Ink (1 ounce bottle)", "Ink"],
  ["Jug or Pitcher", "Jug"],
  ["Ladder (10 foot)", "Ladder"],
  // 56→494 (sim 0.56) · 57→493 (sim 0.57) · 62→484 · 63→393 · 64→394 · 12→395 · 65→396 · 69→400 · 70→401 · 74→408 (sim 1.00) · 75→411 · 76→412
  ["Lantern, Bullseye", "Bullseye Lantern"],
  ["Lantern, Hooded", "Hooded Lantern"],
  ["Mirror, Steel", "Mirror"],
  ["Oil (flask)", "Oil"],
  ["Paper (one sheet)", "Paper"],
  ["Parchment (one sheet)", "Parchment"],
  ["Perfume (vial)", "Perfume"],
  ["Pole (10-foot)", "Pole"],
  ["Pot, Iron", "Iron Pot"],
  ["Ram, Portable", "Portable Ram"],
  ["Rations (1 day)", "Rations"],
  ["Robes", "Robe"],
  // 185→462 (sim 1.00) · 186→465 · 188→466 (sim 1.00) · 87→426 · 89→433
  ["Saddle, Exotic", "Exotic Saddle"],
  ["Saddle, Military", "Military Saddle"],
  ["Saddle, Riding", "Riding Saddle"],
  ["Spikes, Iron (10)", "Iron Spikes"],
  ["Tent, Two-Person", "Tent"],

  // ── Backgrounds ──
  // 2014 id 8 (BR14) → 2024 id 406474 (PHB24); orphan lists: the 2014 Criminal (with its Spy variant) revised; Stealth, thieves' tools, crowbar kept
  ["Criminal / Spy", "Criminal"],

  // ── Monsters ── (all: same CR and size, and the only 2024 entry of that family at that CR. The creature type
  // is unchanged unless a comment says "type changed"; the spec allows that. Pairs with a type change were checked
  // against full public stat blocks from /v1/Monster/{id}.)
  // 2014 id 16763 (BR14, CR 1/4 Humanoid) → 2024 id 5195169 (MM24, CR 1/4 Humanoid); name-contains, sim 0.33: same temple cleric with radiant spellcasting
  ["Acolyte", "Priest Acolyte"],
  // 2014 id 16794 (BR14, CR 2 Elemental) → 2024 id 5194909 (MM24, CR 2 Elemental); name-contains, sim 0.35: same AC 17 / 39 HP, heated body became a 1d10 fire aura
  ["Azer", "Azer Sentinel"],
  // 2014 id 16865 (BR14, CR 1/4 Construct) → 2024 id 5194895 (MM24, CR 1/4 Construct); name-contains, sim 0.13: same Small animated sword, AC 17, 1d8+2 slashing
  ["Flying Sword", "Animated Flying Sword"],
  // 2014 id 17000 (BR14, CR 2 Construct) → 2024 id 5194896 (MM24, CR 2 Construct); name-contains, sim 0.34: same Large rug, AC 12, smother-grapple
  ["Rug of Smothering", "Animated Rug of Smothering"],
  // 2014 id 17013 (BR14, CR 0 Plant) → 2024 id 5195205 (MM24, CR 0 Plant); name-contains, sim 0.00 (2024 has no traits/actions, only a reaction): same AC 5 / 13 HP, Shriek reaction to light or creatures within 30 ft
  ["Shrieker", "Shrieker Fungus"],
  // 2014 id 16958 (BR14, CR 3 Monstrosity) → 2024 id 5195126 (MM24, CR 3 Monstrosity); name-contains, sim 0.25: same Large minotaur, AC 14, gore charge
  ["Minotaur", "Minotaur of Baphomet"],
  // 2014 id 16989 (BR14, CR 0 Beast) → 2024 id 5195160 (MM24, CR 0 Beast); sim 0.52: same Tiny fish, AC 13 / 1 HP, blood-frenzy bite, water breathing
  ["Quipper", "Piranha"],
  // 2014 id 17031 (BR14, CR 1 Beast) → 2024 id 5195227 (MM24, CR 1 Beast); sim 0.64: same swarm, AC 13 / 28 HP, blood frenzy
  ["Swarm of Quippers", "Swarm of Piranhas"],
  // 2014 id 17030 (BR14, CR 2 Beast) → 2024 id 5195231 (MM24, CR 2 Beast); sim 0.55: same swarm, AC 14 / 36 HP, poisonous bites
  ["Swarm of Poisonous Snakes", "Swarm of Venomous Snakes"],
  // 2014 id 16982 (BR14, CR 1/8 Beast) → 2024 id 4775847 (MM24, CR 1/8 Beast); orphan lists: same Tiny snake with a piercing + poison bite
  ["Poisonous Snake", "Venomous Snake"],
  // 2014 id 16890 (BR14, CR 1/4 Beast) → 2024 id 5195030 (MM24, CR 1/4 Beast); orphan lists: same AC 14 / 11 HP, 10-ft reach 1d4+4 bite plus poison
  ["Giant Poisonous Snake", "Giant Venomous Snake"],
  // 2014 id 17035 (BR14, CR 1/2 Humanoid) → 2024 id 5195235 (MM24, CR 1/2 Humanoid); sim 0.68: same 32 HP brute with Pack Tactics and a mace
  ["Thug", "Tough"],
  // 2014 id 17038 (BR14, CR 1/8 Humanoid) → 2024 id 5195259 (MM24, CR 1/8 Humanoid); sim 0.68: same Pack Tactics spear warrior
  ["Tribal Warrior", "Warrior Infantry"],
  // 2014 id 17045 (BR14, CR 3 Humanoid) → 2024 id 5195260 (MM24, CR 3 Humanoid); name-contains, sim 0.48: same AC 17 multiattack veteran soldier
  ["Veteran", "Warrior Veteran"],
  // 2014 id 16836 (BR14, CR 2 Humanoid) → 2024 id 4904746 (MM24, CR 2 Humanoid); orphan lists: same AC 13 Wisdom-casting cult zealot
  ["Cult Fanatic", "Cultist Fanatic"],
  // 2014 id 16893 (BR14, CR 1/2 Beast) → 2024 id 4775820 (MM24, CR 1/2 Beast); orphan lists: same Large seahorse, 16 HP, charging ram, water breathing
  ["Giant Sea Horse", "Giant Seahorse"],
  // 2014 id 17009 (BR14, CR 0 Beast) → 2024 id 5195199 (MM24, CR 0 Beast); orphan lists: same Tiny seahorse, 1 HP, water breathing
  ["Sea Horse", "Seahorse"],
  // 2014 id 16817 (BR14, CR 1 Medium) → 2024 id 4831002 (MM24, CR 1 Medium); type changed: Humanoid → Fey. Same STR–CHA 15/14/13/8/11/9,
  // darkvision 60, Common + Goblin; AC 16→14, HP 27→33; Brute/Surprise Attack revised into Abduct, Grab, Light Hammer. Not Bugbear Stalker (CR 3)
  ["Bugbear", "Bugbear Warrior"],
  // 2014 id 16907 (BR14, CR 1/4 Small) → 2024 id 5195050 (MM24, CR 1/4 Small); type changed: Humanoid → Fey. Same AC 15, scimitar/shortbow,
  // Nimble Escape (now a bonus action); DEX 14→15, HP 7→10. Goblin Minion is CR 1/8, Goblin Boss is CR 1 and has its own twin
  ["Goblin", "Goblin Warrior"],
  // 2014 id 16925 (BR14, CR 1/2 Medium) → 2024 id 5195079 (MM24, CR 1/2 Medium); type changed: Humanoid → Fey. Identical AC 18, HP 11, ability
  // scores, darkvision and languages; longsword/longbow kept; Martial Advantage revised into Pack Tactics + poison arrows
  ["Hobgoblin", "Hobgoblin Warrior"],
  // 2014 id 16939 (BR14, CR 1/8 Small) → 2024 id 5195096 (MM24, CR 1/8 Small); type changed: Humanoid → Dragon. Identical ability scores,
  // darkvision, Common + Draconic; Pack Tactics + Sunlight Sensitivity kept; AC 12→14, HP 5→7. Winged Kobold is CR 1/4
  ["Kobold", "Kobold Warrior"],
  // 2014 id 16904 (BR14, CR 1/2 Medium) → 2024 id 5195046 (MM24, CR 1/2 Medium); type changed: Humanoid → Fiend. Identical AC 15, ability
  // scores, darkvision, Gnoll language; Rampage kept as a bonus action; HP 22→27
  ["Gnoll", "Gnoll Warrior"],
  // 2014 id 17003 (BR14, CR 1/2 Medium) → 2024 id 5195190 (MM24, CR 1/2 Medium); type changed: Humanoid → Fiend. Identical AC 12, HP 22,
  // ability scores, darkvision 120; Blood Frenzy, Limited Amphibiousness and Shark Telepathy kept
  ["Sahuagin", "Sahuagin Warrior"],
  // 2014 id 16955 (BR14, CR 1/8 Medium) → 2024 id 5195119 (MM24, CR 1/8 Medium); type changed: Humanoid → Elemental. Identical AC 11, HP 11;
  // Amphibious and the spear kept (now Ocean Spear); WIS 11→14, Aquan → Primordial. Merfolk Wavebender is CR 6
  ["Merfolk", "Merfolk Skirmisher"],
  // 2014 id 16821 (BR14, CR 2 Large) → 2024 id 5194939 (MM24, CR 2 Large); type changed: Monstrosity → Fey. Identical HP 45, ability scores,
  // Elvish + Sylvan; pike/longbow multiattack kept, Charge became Trampling Charge; AC 12→16. Centaur Warden is CR 7
  ["Centaur", "Centaur Trooper"],
  // 2014 id 16785 (BR14, CR 17 Large) → 2024 id 5195213 (MM24, CR 17 Large); type changed: Monstrosity → Celestial. Same AC 17, HP 199,
  // truesight 120, Inscrutable, three-stage Roar, claws; WIS/CHA swapped (18/23 → 23/18), Sphinx → Celestial language
  ["Androsphinx", "Sphinx of Valor"],
  // 2014 id 16917 (BR14, CR 11 Large) → 2024 id 5195211 (MM24, CR 11 Large); type changed: Monstrosity → Celestial. Identical ability scores,
  // AC 17, truesight 120, Inscrutable, Intelligence spellcasting, claws; HP 136→170. Sphinx of Secrets is CR 8
  ["Gynosphinx", "Sphinx of Lore"],
];
