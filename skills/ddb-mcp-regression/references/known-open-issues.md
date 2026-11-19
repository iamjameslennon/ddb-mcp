# Known open issues

Problems the project already knows about and hasn't fixed yet. They are tracked as "carry-overs" in `docs/claude/history.md`, by a letter code. When a reply shows one of these, put it in the report's "Known open issues" section with its code, not under Findings, so the main findings show only what is new.

If you see the same symptom somewhere this list doesn't mention, or it has become worse, file a normal finding and say which known issue it resembles.

## On the character sheet

### (ba) Custom item names are not applied
Shows up as: an item the player renamed (for example "Drake's Tooth Dagger") prints under its stock name. 6 of the 56 test characters have one.

### (bc) The global save bonus ignores whether the item is equipped
Shows up as: a save bonus from an item that isn't equipped or attuned still counts (Ethelrede's unequipped Battleaxe +1, Aerin's unequipped Slippers).

### (bd) Uses keyed to proficiency bonus are missing from LIMITED USE
Shows up as: Luck Points, Draconic Cry, Stonecunning, Stone's Endurance and similar features are absent from LIMITED USE.

### (be) Some feature dice are omitted
Shows up as: Martial Arts actions print without their dice: Deflect Missiles (Flemin 112315775, Petit Nuage 40193614), Arms of the Astral Self and some monk Unarmed Strike actions. So do rows whose dice add an ability modifier: Stone's Endurance, the Eldritch Cannon entries and Arms of the Astral Self: Summon (which still prints its save DC). Other feature rows now take their dice from their own text (2014 Second Wind, 2014 Bardic Inspiration), so a missing die on one of those is a new finding. An optional class feature whose text uses `{{scalevalue}}` (Petit Nuage 40193614's Quickened Healing) prints no dice, because the sheet carries no level scale for it.

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
Shows up as: `ddb_character_lookup` listing an unrelated entry next to the right one ("bless" → Eldritch Blast, "rage" → Mage Armor, "cure" → Hexblade's Curse). An exact name match is listed first, so this is noise, not a wrong answer; a wrong entry listed *first* is a new finding. This doesn't apply to the action names a lookup also searches (an entry found through its action): those match only where the query starts a word, without typo tolerance ("age" doesn't reach "…Damage").

## Monsters

### (bp) `ddb_get_monster` can miss a monster in a crowded name
Shows up as: `ddb_get_monster` says not found, or picks a different creature, for a name that `ddb_search_monsters` lists.

### (bq) A session change mid-search reads as "Open5e unavailable"
Shows up as: `ddb_search_monsters` answers that the SRD fallback is unavailable when the real cause was a login change during the call. Check the session (SKILL.md, "If the session drops") before filing.

### (bu) The closest-match line can be skipped, and short names count as close
Shows up as: `ddb_get_monster` showing a different entry without its `showing the closest match` line when the matching twin is locked; or a short name taken as a close match for another (Lich/Lion, Ogre/Ooze).

### (bw) Open5e stat blocks use 2014 defense labels for SRD 5.2 creatures
Shows up as: a `ddb_get_monster` stat block from the Open5e SRD fallback, for a 2024 (SRD 5.2) creature, printing its defense lines (damage resistances, immunities, vulnerabilities, condition immunities) under 2014 wording or labels. The D&D Beyond path is not affected.

### (by) Two latent speed gaps
Shows up as (no test character is affected today): a `set innate-speed-<axis>` modifier with a null value ("equal to your walking speed", as in the Roving option or Slippers of Spider Climbing) giving no such speed; or an option's speed modifiers (Roving) dropped even with optional class features on.

### (bz) A lower Override Score loses to an item's set score
Shows up as: a character with a manual Override Score below an item's `set` score (override 15, Amulet of Health setting 19) showing the item's score. Whether dndbeyond.com agrees is unchecked (to test with a test character), so report it as a question, not a defect.

### (ca) The sheet hides every `RACIALTRAIT: 0` trait
Shows up as: `ddb_search_racial_traits` listing a legacy trait that dndbeyond.com's character sheet never shows, such as the 2014 High Elf "Extra Language". Owner decision 2026-11-19: recorded, no change.

## Browser tools

### (bs) Browser tools refuse after `ddb_logout` until the next login
Shows up as: `ddb_navigate`, `ddb_interact` or `ddb_get_page` answering "Session changed" after a `ddb_logout`, until `ddb_login` runs again.

### (bx) Redirect-guard residuals
Shows up as (none of these is a new finding): a `ddb_navigate` to a URL that D&D Beyond redirects loading the final page twice (visible only in network logs); a form POST (or a navigation carrying a foreign `Origin` header) following its redirects natively; a GET navigation started from another site (a `target=_top` link) being walked by the guard, which sends no `Sec-Fetch-Site` and would send SameSite=Strict or partitioned cookies Chrome holds back (the saved session has none, so nothing changes today); a popup opened by a page reaching any host on its first load; `ddb_navigate` showing a bot-check page where a plain Chrome works, because a walked page load goes through Node's HTTP client (a check keyed on the TLS fingerprint); when that client can't connect at all (a mandatory proxy, say), the load falls back to Chrome's own request, whose redirects Chrome then follows natively. A new finding is `ddb_navigate`'s own GET (or a D&D Beyond link it follows) requesting a non-D&D Beyond host through a redirect, or `ddb_navigate`, `ddb_interact` or `ddb_get_page` returning content from or acting on a page off the allowlist.

## Only visible with an account that owns books or homebrew

### (b) Subclass renames between editions are unverified
Shows up as: a 2014 subclass and its 2024 rename (for example Path of the Totem Warrior → Path of the Wild Heart) not being treated as the same subclass across editions.

### (aa) Paid books' slugs are unverified
Shows up as: a paid book whose slug doesn't resolve, so `ddb_read_book` or `ddb_list_library` falls back to the library title.

### (ah) Homebrew flags on optional features are unverified
Shows up as: a homebrew optional class feature or racial trait on an official class or race not wrapped as untrusted.

### (ay) Item- and background-granted actions are unverified
Shows up as: an action granted by an item or background printed plain when its source is homebrew; `ddb_character_lookup` on a background-granted action's name finding nothing (the background feature is found by its own name), or on an unequipped item's action finding nothing.

## Small leftovers

### (B14) read_book blank lines
Shows up as: `ddb_read_book` output with long runs of blank lines that use up `max_chars`.
