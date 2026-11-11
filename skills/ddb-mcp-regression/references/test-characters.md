# Test characters

Public D&D Beyond characters kept for regression testing (`testcharacters.md` in the repo). Anyone can fetch them, logged in or not, so their IDs and sheet text are safe to quote in a report: prefer one of these as evidence over the contributor's own characters.

- **Edition**: what the sheet's `Rules:` line read on 2026-11-11. A different line is not a finding by itself (a player can change their character); judge whether it labels the sheet suitably.
- **Covers**: why the character is in the set. Check that behaviour on it specifically.
- **Ask**: the sections to request with `ddb_get_character` (`sections`), as a user would ask for them ("what's my AC?" → `summary` or `combat`). Each batch also gets one natural-language `ddb_character_lookup` and one `full` request, to judge size.

| ID | Name | Level | Class | Edition | Covers | Ask |
|----|------|-------|-------|---------|--------|-----|
| 39714283 | Mori Yosei | 1 | Druid | 2014 | 2014 druid; Wood Elf speed | summary, combat, spells, concentration, inventory |
| 107164636 | Astarion | 1 | Rogue | 2014 | expertise rogue; darkvision; BG3 background; custom language (Orc) | summary, combat, spells, concentration, features |
| 107165979 | Gale | 1 | Wizard | 2014 · third-party: Hero's Journey Boon (feat), Dark Bargain (feat) | BG3 background; disguised feats in Rules line | summary, combat, spells, concentration, notes |
| 107606626 | Karlach | 1 | Barbarian | 2014 | darkvision; BG3 background; Javelin stack (thrown) | summary, combat, spells, concentration, inventory |
| 107607297 | Lae'zel | 1 | Fighter | 2014 | Githyanki; fighter weapon rows | summary, combat, spells, concentration, features |
| 107609898 | Shadowheart | 1 | Cleric (Trickery Domain) | 2014 | Trickery Domain; darkvision; BG3 background | summary, combat, spells, concentration, notes |
| 107693030 | Wyll | 1 | Warlock (The Fiend) | 2014 | The Fiend warlock; pact slots; Eldritch Blast beams | summary, combat, spells, concentration, inventory |
| 109960413 | Elf Wizard (High) | 1 | Wizard | 2014 | High Elf wizard; Fire Bolt / Ray of Frost rows | summary, combat, spells, concentration, features |
| 109960799 | Dwarf Cleric (Hill/Life) | 1 | Cleric (Life Domain) | 2014 | Life Domain; Hill Dwarf 25 ft. speed | summary, combat, spells, concentration, notes |
| 109963409 | Halfling Rogue (Lightfoot/Criminal) | 1 | Rogue | 2014 | expertise rogue; Goblin language via characterValues | summary, combat, inventory |
| 109965870 | Elf Fighter (Wood) | 1 | Fighter | 2014 | Wood Elf 35 ft. speed | summary, combat, features |
| 109967628 | Human Paladin | 1 | Paladin | 2014 | paladin; Divine Smite / Lay on Hands | summary, combat, spells, concentration, notes |
| 133053421 | Bobby | 1 | Barbarian | 2024 · 2014 content: 2 items · homebrew: 3 items | 2024 barbarian; homebrew items | summary, combat, inventory |
| 133054584 | Diana | 1 | Monk | 2024 | 2024 monk; Unarmed Strike / Martial Arts | summary, combat, features |
| 133055442 | Eric | 1 | Fighter | 2024 | 2024 fighter; weapon mastery | summary, combat, notes |
| 133056493 | Hank | 1 | Ranger | 2024 | 2024 ranger; Hunter's Mark dice | summary, combat, spells, concentration, inventory |
| 133057712 | Niko | 1 | Cleric | 2024 | 2024 cleric; Sacred Flame / Toll the Dead | summary, combat, spells, concentration, features |
| 133058471 | Presto | 1 | Wizard | 2024 · 2014 content: 24 items | 2024 wizard with 2014 items; same-name items of two editions | summary, combat, spells, concentration, notes |
| 133059215 | Sheila | 1 | Rogue | 2024 | 2024 expertise rogue | summary, combat, inventory |
| 152570649 | Dwarf Cleric (Acolyte) | 1 | Cleric | 2024 · 2014 content: 7 items · third-party: Dark Bargain (feat) | 2024 cleric; vestigial race ASIs skipped | summary, combat, spells, concentration, features |
| 152570663 | Human Fighter | 1 | Fighter | 2024 · third-party: Dark Bargain (feat) | 2024 fighter; Dark Bargain disguised feat | summary, combat, notes |
| 152570675 | Halfling Rogue (Criminal) | 1 | Rogue | 2024 · 2014 content: 7 items · third-party: Dark Bargain (feat) | 2024 rogue; 2014 items | summary, combat, inventory |
| 152570683 | Elf Wizard | 1 | Wizard | 2024 · third-party: Dark Bargain (feat) | 2024 wizard; Sleep (2024) as concentration | summary, combat, spells, concentration, features |
| 152579009 | Goliath Barbarian | 1 | Barbarian | 2024 · third-party: Dark Bargain (feat) | 2024 Goliath (Giant Ancestry → Stone); Large Form hidden below level 5 | summary, combat, notes |
| 155447750 | Claude Skamos | 2 | Wizard | 2024 · 2014 content: 1 item · third-party: Dark Bargain (feat) | 2024 Fiendish Legacy → Infernal | summary, combat, spells, concentration, inventory |
| 39712797 | Therai | 2 | Ranger | 2014 | 2014 ranger | summary, combat, spells, concentration, features |
| 162797600 | Lysander | 2 | Bard | 2024 · 2014 content: Half-Elf (species), Noble (background), 2 items · third-party: Dark Bargain (feat) | 2024 bard on a 2014 species and background | summary, combat, spells, concentration, notes |
| 155830640 | Oskar | 2 | Rogue | 2024 · 2014 content: 6 items · third-party: Dark Bargain (feat) | 2024 rogue; 2014 items | summary, combat, inventory |
| 155829352 | Idhren | 2 | Barbarian | 2024 · third-party: Dark Bargain (feat) | 2024 Elven Lineage → High Elf | summary, combat, spells, concentration, features |
| 155665213 | Clover Darkbloom | 2 | Druid | 2024 · 2014 content: 1 spell · third-party: Dark Bargain (feat) | 2024 Elven Lineage → Wood Elf; 2014 spell | summary, combat, spells, concentration, notes |
| 92001898 | Ancarno Arnault | 2 | Sorcerer | 2014 | 2014 sorcerer | summary, combat, spells, concentration, inventory |
| 40080729 | BillytheBard | 2 | Bard | 2014 | Jack of All Trades initiative | summary, combat, spells, concentration, features |
| 39715128 | Danyr the Lightbringer | 2 | Paladin | 2014 | custom items; paladin | summary, combat, spells, concentration, notes |
| 49128422 | Zayda Snaketooth | 3 | Cleric | 2014 | Hobgoblin cleric | summary, combat, spells, concentration, inventory |
| 49053647 | Elona Silverflame | 3 | Paladin | 2014 | Tiefling paladin | summary, combat, spells, concentration, features |
| 145414075 | Spurt the Sorcerer | 3 | Sorcerer (Wild Magic Sorcery) | 2024 · 2014 content: Kobold (species) · homebrew: 1 item | Wild Magic; 2014 Kobold species; darkvision; homebrew item | summary, combat, spells, concentration, notes |
| 152720684 | Orion Skyborn | 4 | Druid | 2024 · 2014 content: 9 spells, 1 item · third-party: Dark Bargain (feat) | Aasimar control case (no lineage); Staff of the Woodlands spell attack +2 | summary, combat, spells, concentration, inventory |
| 40193614 | Petit Nuage | 5 | Monk | 2014 | HP override (rolled HP); monk | summary, combat, features |
| 127373542 | Ezra Trickweaver | 5 | Rogue | 2014 · 2024 content: 1 spell | Arcane Trickster; Green-Flame Blade row; Sneak Attack; off-hand | summary, combat, spells, concentration, notes |
| 68903271 | Aerin Forrestlimb | 5 | Ranger (Gloom Stalker) | 2014 | Gloom Stalker: Dread Ambusher initiative | summary, combat, spells, concentration, inventory |
| 39876541 | Sister Baronessa | 9 | Cleric (Trickery Domain) | 2014 · homebrew: 4 items · edition not stated: Telepathic (Wisdom) (feat) | Trickery Domain L9; Amulet of the Devout +1 (attack and DC); homebrew items; background entities | summary, combat, spells, concentration, features |
| 112305147 | Cathartic | 9 | Cleric (Life Domain) | 2014 | Life Domain L9 | summary, combat, spells, concentration, notes |
| 112305786 | Dunil | 9 | Rogue (Assassin) | 2014 | Assassin; custom background (Criminal / Spy) | summary, combat, inventory |
| 112314883 | Ethelrede | 9 | Fighter (Champion) | 2014 · third-party: Hero's Journey Boon (feat), Dark Bargain (feat) | Champion: Remarkable Athlete; disguised feats | summary, combat, spells, concentration, features |
| 112315775 | Flemin | 9 | Monk (Way of the Open Hand) | 2014 | Open Hand monk; Hill Dwarf darkvision | summary, combat, notes |
| 112316571 | Rustle Berrydust | 9 | Wizard (School of Evocation) | 2014 | Evocation wizard; Forest Gnome | summary, combat, spells, concentration, inventory |
| 112317699 | Weslocke | 9 | Warlock (The Fiend) | 2014 | The Fiend L9; background entities | summary, combat, spells, concentration, features |
| 58640338 | Xarius Wo Tan, Pathfinder of Tabot | 10 | Barbarian/Rogue | 2014 | multiclass Barbarian/Rogue; custom background (Outlander) | summary, combat, spells, concentration, notes |
| 42519628 | Ehsu Ferncraig | 10 | Ranger | 2014 · homebrew: 1 species, 7 items | homebrew species (Bad Batch); orphan Roving speed modifier skipped | summary, combat, spells, concentration, inventory |
| 145415789 | Vi | 10 | Artificer (Artillerist) | 2014 · 2024 content: Gnome (species), Scribe (background), Skilled (feat), 16 spells, 7 items | Artificer (Artillerist); mixed 2014/2024 content; Gnome Cunning save advantage | summary, combat, spells, concentration, features |
| 14814039 | Calderax Greycastle | 12 | Cleric | 2024 · 2014 content: Grave Domain (XGtE) (subclass), Fierna Tiefling (species), Noble (background), 8 spells, 27 items · homebrew: 2 feats | L12 full caster; Grave Domain (always-prepared spells); charged items; homebrew feats | summary, combat, spells, concentration, notes |
| 26158232 | Laena | 20 | Rogue | 2014 | L20 Scout rogue; Superior Mobility speed | summary, combat, spells, concentration, inventory |
| 17931478 | Harry the Wizard | 1 | Wizard | 2014 | custom items; wizard | summary, combat, spells, concentration, features |
| 15888722 | Hizar | 2 | Wizard | 2014 | Half-Orc traits; wizard | summary, combat, spells, concentration, notes |
| 40046334 | Caikrana Qualanthri | 1 | Sorcerer (Draconic Bloodline) | 2014 | Draconic Resilience unarmored AC; comma-in-weapon-name proficiency | summary, combat, spells, concentration, inventory |
| 166265317 | Ael Varris | 1 | Bard | 2024 · 2014 content: Half-Elf (species), Noble (background), 2 items · third-party: Dark Bargain (feat), Character Threads (feat), Runestones (feat) | 2024 bard; three disguised feats in Rules line | summary, combat, spells, concentration, features |

Known gaps in this set (I5, 2026-11-06): no character with a Reach weapon, none with a save-advantage trait other than Gnome Cunning or Danger Sense, and no Warlock above level 9. Use the contributor's own characters to cover these when they have one.
