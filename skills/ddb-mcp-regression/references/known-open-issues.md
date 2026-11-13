# Known open issues

Problems the project already knows about and hasn't fixed yet. They are tracked as "carry-overs" in `docs/claude/history.md`, by a letter code. When a reply shows one of these, put it in the report's "Known open issues" section with its code, not under Findings, so the main findings show only what is new.

If you see the same symptom somewhere this list doesn't mention, or it has become worse, file a normal finding and say which known issue it resembles.

## On the character sheet

### (ba) Custom item names are not applied
Shows up as: an item the player renamed (for example "Drake's Tooth Dagger") prints under its stock name. 6 of the 56 test characters have one.

### (bb) Subclass always-prepared spells are missing
Shows up as: Calderax (14814039, Grave Domain) has no Vampiric Touch anywhere on the sheet. D&D Beyond leaves these spells out of the character data.
The 2026-11-11 run found it on all 8 subclass casters checked, and Bless missing from `concentration`. Flagged for re-prioritising.

### (bc) The global save bonus ignores whether the item is equipped
Shows up as: a save bonus from an item that isn't equipped or attuned still counts (Ethelrede's unequipped Battleaxe +1, Aerin's unequipped Slippers).

### (bd) Uses keyed to proficiency bonus are missing from LIMITED USE
Shows up as: Luck Points, Draconic Cry, Stonecunning, Stone's Endurance and similar features are absent from LIMITED USE.

### (be) Some feature dice are omitted
Shows up as: Deflect Missiles (Flemin 112315775, Petit Nuage 40193614), Arms of the Astral Self and some monk Unarmed Strike actions print without their dice.

### (bf) A null AC override entry would throw
Shows up as: an error on a character whose data has a null `characterValues` entry. No live character has one, so a crash here is this issue.

### (br) Pact and hex weapons using CHA are unverified
Shows up as: a Warlock weapon row (2024 Pact of the Blade, 2014 Hex Warrior) that should use CHA but uses STR or DEX. No test character has one, so no data shape is verified.

### (bi) Warlock multiclass spell rows use the class's own slot row
Shows up as: on a Warlock multiclass, the slot level in spell rows may differ from the shared multiclass table. No test character is one.

### (bj) Bonus-action and reaction spells print no numbers
Shows up as: `• Spiritual Weapon (spell, 2nd-level slot)` in BONUS ACTIONS with no to-hit or damage. The website shows them (Cathartic 112305147: `60ft. +8 1d8+4`).

### (bk) A stack of off-hand weapons moves wholesale
Shows up as: a flagged off-hand weapon with quantity above 1 appears in BONUS ACTIONS as `×N`. No live case.

### (bl) A Martial Arts feature without a level scale falls back to STR
Shows up as: a DEX monk's Unarmed Strike row uses STR. No live case.

### (bn) Item spell bonuses assume one modifier per item definition
Shows up as: a sheet whose item spell bonus is listed once per copy would double count it. Not seen live.

### (bo) Homebrew and official save advantages with the same wording merge
Shows up as: one save-advantage line, wrapped as untrusted, that combines an official and a homebrew source.

### (bt) An equipped magic stack loses its ×N in EQUIPPED
Shows up as: an equipped magic or attunable item with quantity above 1 listed in EQUIPPED without its `×N`. No test character has one, and no test checks that a homebrew item in EQUIPPED is wrapped, so an unwrapped homebrew EQUIPPED line belongs here too.

## Character lookup

### (bv) Some short words still match loosely
Shows up as: `ddb_character_lookup` listing an unrelated entry next to the right one ("bless" → Eldritch Blast, "rage" → Mage Armor, "cure" → Hexblade's Curse). An exact name match is listed first, so this is noise, not a wrong answer; a wrong entry listed *first* is a new finding.

## Monsters

### (bp) `ddb_get_monster` can miss a monster in a crowded name
Shows up as: `ddb_get_monster` says not found, or picks a different creature, for a name that `ddb_search_monsters` lists.

### (bq) A session change mid-search reads as "Open5e unavailable"
Shows up as: `ddb_search_monsters` answers that the SRD fallback is unavailable when the real cause was a login change during the call. Check the session (SKILL.md, "If the session drops") before filing.

### (bu) The closest-match line can be skipped, and short names count as close
Shows up as: `ddb_get_monster` showing a different entry without its `showing the closest match` line when the matching twin is locked; or a short name taken as a close match for another (Lich/Lion, Ogre/Ooze).

## Browser tools

### (bs) Browser tools refuse after `ddb_logout` until the next login
Shows up as: `ddb_navigate`, `ddb_interact` or `ddb_get_page` answering "Session changed" after a `ddb_logout`, until `ddb_login` runs again.

## Only visible with an account that owns books or homebrew

### (b) Subclass renames between editions are unverified
Shows up as: a 2014 subclass and its 2024 rename (for example Path of the Totem Warrior → Path of the Wild Heart) not being treated as the same subclass across editions.

### (aa) Paid books' slugs are unverified
Shows up as: a paid book whose slug doesn't resolve, so `ddb_read_book` or `ddb_list_library` falls back to the library title.

### (ah) Homebrew flags on optional features are unverified
Shows up as: a homebrew optional class feature or racial trait on an official class or race not wrapped as untrusted.

### (ay) Item- and background-granted actions are unverified
Shows up as: an action granted by an item or background printed plain when its source is homebrew.

## Small leftovers

### (B14) read_book blank lines
Shows up as: `ddb_read_book` output with long runs of blank lines that use up `max_chars`.
