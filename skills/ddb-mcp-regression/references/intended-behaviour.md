# Intended behaviour

Deliberate choices that can look like bugs. Check this list before filing a finding. If a reply matches an entry here, file it under "By design" in the report, not as a finding, unless the reply goes beyond what the entry describes.

Each entry says what it looks like and where the decision is recorded in the repo (CLAUDE.md, or `docs/claude/history.md` and `docs/claude/tool-notes.md` with the owner's ruling date), so the coding assistant can check it.

### Content defaults to the 2024 rules
Looks like: a request with no edition returns the 2024 version even when a 2014 one exists. Every tool that can return either edition takes `rules_edition: "2024" | "2014"`, and only that spelling.
Source: CLAUDE.md, Invariants, "Rules edition".

### Every rules reply names its ruleset
Looks like: a `Rules:` line under the title, or an inline tag such as `[2024]`, `[2014]`, `[third-party]`, `[homebrew]`, `[playtest]` or `[edition not stated]`, and a reason line when the other edition is shown. Expected on rules content (spells, monsters, items, species, classes, backgrounds, feats, features, traits, rules, conditions, books, characters, `ddb_get_party`, encounters, treasure). Not expected on login, logout, cache, browser or page replies, or on the `ddb_list_*` replies (`ddb_list_characters`, `ddb_list_campaigns`). `ddb_list_library` tags each book.
Source: CLAUDE.md, Invariants, "Rules edition"; spec 2026-11-11 criterion 4.

### `source` wins over `rules_edition`
Looks like: with `source` set, entries of both editions from that book are listed, each tagged, plus a note when the book's edition contradicts `rules_edition`. Nothing is hidden as a "twin".
Source: CLAUDE.md, Invariants, "`source` wins over `rules_edition`".

### A `source` search of a book the account doesn't own says so
Looks like: every `source` search (not `homebrew`) of a book the logged-in account's library doesn't list starts with `> Note: this account doesn't own <book>, so D&D Beyond shows only its free entries — this list is not the whole book.`, even when nothing matched. The free books (the Basic Rules `basic-rules-2014` and `br-2024`, and Elemental Evil Player's Companion `ee`, whose spells a free account sees) never get it. Logged out, or when the library can't be read (or isn't read within 5 s), there is no note (it never blocks or misleads).
Source: tool-notes.md, "Unowned-book note (F17)" (2026-11-11 remediation).

### `ddb_read_book` of a book the account doesn't own says so
Looks like: `You don't own <book> on D&D Beyond, so its text can't be read here. Books you can read:` followed by the owned books as `  • <title> (<slug>)` lines, instead of the store page. It applies only when the library list loaded and the book is known to the source index and not free; the free Basic Rules books (and `ee`) still read. A title that is in neither the library nor the index keeps the "No book found" error. When the library can't be fetched, reads work as before (a title resolves through the source index).
Source: tool-notes.md, "Unowned-book read (F27)" (2026-11-11 remediation).

### Logged out, a catalog fallback says to log in
Looks like: with no session (or saved cookies that aren't signed in), `ddb_search_spells`, `ddb_get_spell`, `ddb_search_equipment`, `ddb_get_equipment`, `ddb_search_races`, `ddb_search_classes`, `ddb_search_backgrounds` and `ddb_search_feats` answer from Open5e labelled `(Open5e fallback — not logged in; ddb_login shows D&D Beyond's version)`, and a no-match search ends `(not logged in — ddb_login may show more)`. They don't say "D&D Beyond unavailable"; that wording is only for an outage while logged in.
Source: tool-notes.md, "Logged-out catalog fallbacks (F13)" (2026-11-13 remediation); `src/edition.ts`, `OPEN5E_SUFFIX`.

### `source: "homebrew"` is reserved
Looks like: `source: "homebrew"` lists only homebrew entries, each tagged `[homebrew]`, and needs login.
Source: CLAUDE.md, Invariants; tool-notes C1 (owner ruling 2026-11-10).

### Encounter and treasure lookups never guess a monster
Looks like: a partial monster name that fits several creatures is reported as ambiguous, and an unknown one as not found, with "supply cr manually". It is never picked silently. `getMonsterStats` returns `found`, `not-found`, `unknown-cr`, `ambiguous` or `unavailable`, has no fuzzy fallback and skips homebrew. A wrong CR would silently skew the rating.
Source: CLAUDE.md, Invariants, "`getMonsterStats` never guesses".

### Monster search shows at most 50 by default
Looks like: a broad search lists 50 entries with the exact total and a size estimate. `list_all: true` lists everything, and should be used only after the count and size have been reported.
Source: CLAUDE.md, Invariants, "Safety gates"; history.md B11 (owner rulings 2026-11-10).

### User-written text is wrapped as untrusted
Looks like: blocks wrapped in `<untrusted_dndbeyond_content>` tags: character, campaign and player names, homebrew entries, custom languages and items, notes, book text, page scrapes, raw character JSON, and the whole replies of `ddb_list_characters`, `ddb_list_campaigns` and `ddb_get_campaign`. In `ddb_get_party`, the PARTY line and each member's name are wrapped. This is protection against prompt injection, not clutter.
Source: CLAUDE.md, Invariants, "Untrusted text"; history.md security findings (owner ruling 2026-11-06 for list replies).

### Official content stays unwrapped
Looks like: entries with `isHomebrew: false` print plain. Wrapping them would be the bug.
Source: CLAUDE.md, Invariants, "Untrusted text".

### Safety gates refuse first
Looks like: `ddb_interact` refuses `click` without `confirm_click: true` and `fill` without `confirm_fill: true`. `ddb_get_character_raw` needs `confirm_large_response: true`; the schema requires it, so a call without it fails validation before the tool runs. `ddb_download_character` writes only under `~/Downloads` or `~/Documents`. `ddb_navigate` opens only dndbeyond.com URLs.
Source: CLAUDE.md, Invariants, "Safety gates"; `src/server.ts`.

### Character tools take no edition parameter
Looks like: `ddb_get_character` has no `rules_edition`. The sheet is labelled by its main edition, and entries from other rulesets are tagged inline and counted on the `Rules:` line.
Source: CLAUDE.md, Invariants, "Character tools".

### Disguised feats count on the `Rules:` line
Looks like: "third-party: Dark Bargain (feat)" (or Hero's Journey Boon, Character Threads, Runestones) on a sheet's `Rules:` line, although D&D Beyond hides these feats.
Source: history.md, B4 (owner ruling 2026-11-06: not fixed, don't relitigate).

### Locked content on an account that doesn't own the book
Looks like: "locked" or "you don't own this book" for content from a paid book. On a free account (the owner's own account is one) this is normal, not a finding. A locked monster near-match carries the locked-entries note; its AC and HP may print as dashes.
Source: CLAUDE.md, last invariant; tool-notes C6 (owner ruling 2026-11-10).

### Open5e is the logged-out and rules fallback, and is distrusted
Looks like: logged out, or when D&D Beyond can't answer, replies come from the Open5e SRD and say so. `ddb_search_rules` and `ddb_get_rules` always read the SRD from Open5e; conditions are bundled with the server (SRD 5.1 and 5.2.1). If either SRD document fails to load, the whole call fails, so a one-document outage can read as "not found" (carry-over (q), open by design).
Source: CLAUDE.md, Invariants, "Open5e responses are distrusted"; history.md (q) (owner decision).

### 2014 Damage and Healing is complete
Looks like: `ddb_get_rules` with `rules_edition: "2014"` and `Damage and Healing` returns Hit Points (its own text only), Damage Rolls, a real Critical Hits (not a copy of Damage Rolls), Damage Types, Resistance and Vulnerability, Healing, Dropping to 0 Hit Points, Instant Death, Falling Unconscious, Death Saving Throws, Stabilizing a Creature, Monsters and Death, Knocking a Creature Out and Temporary Hit Points. `Death Saving Throws` also resolves by section name, and `ddb_search_rules` for "death saving throw" under 2014 lists the chapter. 2024 is never patched.
Source: owner ruling R3 (F3) and owner decision 2026-11-19 (embedded-copy trim); src/srd51-rules.ts.

### Nameless entries keep an empty slot
Looks like: a list with an empty entry where a character has an item or feature with no name, rather than the entry being dropped (carry-over (y), open by design).
Source: CLAUDE.md, Open work 4, (y).

### "Dual-edition" means 2024 and 2014 only
Looks like: books that mix in other rulesets (third-party, playtest) are not treated as dual-edition (carry-over (ab), open by design).
Source: CLAUDE.md, Open work 4, (ab).

### Custom items and actions are not printed separately
Looks like: `customItems` / `customActions` from the character JSON never appear as their own list. Every custom item already shows in the inventory, as player-made and wrapped, with no edition tag and not counted on the `Rules:` line.
Source: history.md, B13 (owner rulings 2026-11-06).

### Feature actions match the website's visibility
Looks like: class-feature actions the website hides are hidden, for example Harness Divine Power and Steady Aim when the optional feature isn't enabled, and level-gated racial traits (Large Form below level 5).
Source: tool-notes.md, "Visibility" (owner decision 2026-11-07); history.md B5.

### Feature rows take dice from their own text, but not when they add an ability modifier
Looks like: a feature row D&D Beyond gives no dice prints the dice its own text names when they add no ability modifier: 2014 Second Wind `• Second Wind   1d10 + 9` (Ethelrede 112314883, Fighter 9), 2014 Bardic Inspiration `• Bardic Inspiration   1d6` (BillytheBard 40080729). Dice that add an ability modifier stay off: Stone's Endurance, Deft Explorer: Tireless and Eldritch Cannon: Protector print no dice, and Martial Arts actions (Deflect Missiles, Arms of the Astral Self, monk Unarmed Strike) print none either (carry-over (be)). A plain number such as Action Surge's `{{scalevalue}} times` is not dice.
Source: tool-notes.md, "Snippet dice"; history.md R2 (owner ruling 2026-11-13).

### Slot-scaled feature dice say per slot level
Looks like: a feature row whose own text reads "plus another 1d8 per level of the spell slot" adds that to its dice: `• Eldritch Smite   1d8 + 1d8 per slot level` (Weslocke 112317699). Divine Smite's 2014 wording ("for each spell level higher than 1st") prints no dice, as before (carry-over (be)).
Source: history.md, Regression remediation 2026-11-13, R2 (F5, owner ruling 2026-11-18); tool-notes.md, "Slot-scaled dice".

### Limited-use resets and hit-point pools
Looks like: reset types read Short Rest, Long Rest, Dawn or Special (D&D Beyond's "Other"), on actions and on charged items alike: Infuse Item and Magical Tinkering `(Special)`. An Eldritch Cannon action's pool prints remaining over maximum, `• Eldritch Cannon: Flamethrower   38/50 HP   (Special)`, not `12 used / 50 max`.
Source: tool-notes.md, "Limited use" (F8, 2026-11-18).

### Feature rows print a save DC when their text names one
Looks like: a feature row whose own text names one ability's save DC ends with `   DC N`, after any dice: `• Channel Divinity: Turn Undead   DC 16` (Cathartic 112305147), `• Stunning Strike   DC 15` and `• Ki Points   DC 15` (Flemin 112315775), `• Arms of the Astral Self: Summon   DC 15` (Petit Nuage 40193614), and the 2024 Unarmed Strike (`DC 10`, and `DC 13` for the Dex. version, on Diana 133054584). Text that names two abilities' DCs, or one that can't be worked out, prints no DC, never `DC ?`.
Source: tool-notes.md, "Save DC"; history.md R3 (owner ruling 2026-11-13; A8, owner decision 2026-11-17: counted by ability).

### Weapon mastery only with the Weapon Mastery feature
Looks like: a weapon row shows its mastery property (Nick, Sap, Topple, Vex, Slow, Graze, …) only when the character has Weapon Mastery. 2014 characters and most casters show none.
Source: history.md, B6 (owner rulings 2026-11-06).

### Weapon names read "Light Crossbow", not "Crossbow, Light"
Looks like: D&D Beyond's `X, Y` names print as `Y X` in weapon rows and in the Weapons proficiency list.
Source: history.md and tool-notes.md (owner ruling 2026-11-06).

### Attack cantrips and damaging save cantrips appear in ACTIONS
Looks like: Fire Bolt, Ray of Frost, Sacred Flame, Toll the Dead and Vicious Mockery appear in ACTIONS with to-hit or DC and damage. The website lists the save cantrips only under spells. Ice Knife shows both the to-hit and the DC.
Source: tool-notes.md (owner decision 2026-11-07; owner ruling 2026-11-09).

### Bonus-action and reaction spells print no numbers
Looks like: `• Spiritual Weapon (spell, 2nd-level slot)` in BONUS ACTIONS with no to-hit or damage, although the website shows them (carry-over (bj), also listed in known-open-issues).
Source: tool-notes.md (owner ruling 2026-11-09).

### Spells are labelled by how they are cast
Looks like: CONCENTRATION SPELLS entries and the `(spell, …)` lines in BONUS ACTIONS / REACTIONS name the slot actually used: `[1st-level slot]` for a class spell, the pact slot for a Warlock class spell (`• Hex (spell, 5th-level slot)` at Warlock 9), `[from item]` for an item spell that uses no slot, `[no slot]` for a feature or racial spell that uses none, and with a fixed cast level `[2nd level, no slot]` / `• Hellish Rebuke (spell, 2nd level, no slot)` (item: `6th level, from item`). A cantrip has no concentration label. A spell held twice takes the label of the class entry.
Source: tool-notes.md (F3; owner ruling R5, 2026-11-17).

### Subclass always-prepared spells are on the sheet, though not in the raw JSON
Looks like: a subclass caster's sheet lists the spells its subclass always has prepared (Calderax 14814039's Grave Domain Vampiric Touch, a Life cleric's Bless) in SPELLS, CONCENTRATION and the combat block, although `ddb_get_character_raw` and `ddb_download_character` don't contain them: they come from D&D Beyond's separate always-prepared list, and the raw JSON stays as D&D Beyond publishes it. A 2024 subclass adds none. Zayda (49128422) lists both Arcanist's Magic Aura and Nystul's Magic Aura, as the website does. When a list can't be loaded, the reply starts with `⚠️ Subclass always-prepared spells couldn't be loaded from D&D Beyond, so the spell lists may be incomplete.`
Source: tool-notes.md, "Subclass always-prepared spells"; history.md R1 (owner ruling 2026-11-13).

### Weapon-attack cantrip rows
Looks like: `• Green-Flame Blade (cantrip) melee weapon attack   weapon damage + 1d8 fire   reach 5 ft.   (to second target: 1d8 + 3 fire)`, and for the 2024 True Strike `weapon attack with INT   weapon damage + 1d6 radiant` with no range. Neither has its own to-hit: the weapon's applies.
Source: history.md (owner rulings 2026-11-11).

### Save advantages print D&D Beyond's own wording
Looks like: `Advantage (all saves): Made to avoid or end the Charmed condition` next to `against being frightened`, with mixed capitals.
Source: history.md, Whole-corpus regression script 2026-11-11 (owner ruling 2026-11-11: accepted as is).

### Long spell names overrun the name column
Looks like: a single space after a long name (`Green-Flame Blade (cantrip) melee…`) where shorter names are padded into a column. The `(cantrip)` or `+N to hit` marker still ends each name.
Source: history.md (owner ruling 2026-11-11: accepted as is).

### Custom backgrounds show the borrowed background
Looks like: a custom background with no name shows the stock background whose feature it borrows (Dunil: `Criminal / Spy`; Xarius: `Outlander`).
Source: history.md, security findings (owner ruling 2026-11-06).

### Treasure uses the 2024 tables only
Looks like: `ddb_roll_treasure` with `rules_edition: "2014"` still rolls the 2024 tables and says so, but resolves monster CRs from 2014 stat blocks.
Source: CLAUDE.md, key modules (`treasure.ts`, "2024 tables only"); the tool's description.

### Encounter uncounted monsters
Looks like: a monster that can't be looked up is listed as uncounted with "supply cr", and an entry with neither name nor `cr` is skipped silently.
Source: tool-notes.md (owner ruling 2026-11-06).

### Downloads go to fixed folders
Looks like: `ddb_download_character` refuses any `output_path` outside `~/Downloads` or `~/Documents` (including `..` escapes) and says where it saved.
Source: CLAUDE.md, Invariants, "Safety gates".

### Equipped weapons, and other equipped items with a weapon behaviour, appear in ACTIONS, not INVENTORY
Looks like: the `inventory` section lists armor and gear but no equipped weapons or staffs; they appear as attack rows in ACTIONS (`combat`, `full`). This covers equipped weapons and other equipped items with a weapon behaviour, such as staffs (an attuned one still shows on the ATTUNEMENT line); an unequipped staff stays in INVENTORY. It holds only for equipped items: a carried weapon that isn't equipped and appears nowhere is not covered by this entry.
Source: `src/tools/character/inventory.ts` header comment.

### Encounter and treasure lookups count an exact name match
Looks like: a name that exactly matches one creature is counted even when other creatures share part of the name, including a third-party one (D&D Beyond has a third-party monster named "Dragon", CR 4). Only a name that matches several creatures without an exact match is reported as ambiguous.
Source: the `ddb_rate_encounter` and `ddb_roll_treasure` descriptions ("exact, then partial").

### Chosen class options print on their parent feature line
Looks like: `• Fighting Style (Fighter 1): Archery`; `ddb_character_lookup` resolves the option by name (`[Class Option]`, first line `Agonizing Blast (Eldritch Invocations, Warlock)`), the parent feature's hit ends with `Chosen: <names>`, and the option's Rules line uses the option's own source (Eldritch Smite reads Xanathar's Guide to Everything), falling back to the owning subclass or class. An option hit under a homebrew class, subclass or parent feature is wrapped, even when the option carries no homebrew flag; under official content it stays plain. A lookup whose query is an entry's exact name lists that entry first ("bless": Bless before Eldritch Blast).
Source: history.md, Regression remediation 2026-11-11 (owner rulings R1 and R6, 2026-11-11).

### EQUIPPED lists armour and magic or attunable gear
Looks like: EQUIPPED holds equipped armour with `(AC n)` and equipped items that are magic or attunable, except non-armor items that attack through a weapon behaviour (a staff shows in ACTIONS instead; an equipped armor item with a weapon behaviour keeps its EQUIPPED line and also gets an ACTIONS row); mundane equipped gear (Backpack, Pouch, Arrows) stays in INVENTORY. The attunement line names the items: `ATTUNEMENT (1/3): Staff of the Woodlands`.
Source: history.md, Regression remediation 2026-11-11 (owner ruling R2, 2026-11-11).

### `ddb_get_monster` takes a fuzzy hit only when it is close
Looks like: a close top hit is used and says so on its own line (`No monster is named "Owlbare"; showing the closest match, Owlbear.`); a distant one gives `Monster "…" not found. Closest matches from D&D Beyond:` with the near-match lines and no stat block.
Source: history.md, Regression remediation 2026-11-11 (owner ruling R3, 2026-11-11).

### `br-2024` redirects to `phb-2024` outside equipment
Looks like: `source: "br-2024"` for spells, feats, species, classes, backgrounds, class features and racial traits replies with a redirect to `phb-2024`, because D&D Beyond tags none of those entries with source 148 (2024 class features carry only 145). Equipment is unchanged (items do carry 148), and so are monsters. A search or get that matches nothing on D&D Beyond or in the SRD says "… on D&D Beyond or in the SRD." ("(SRD only)." only when D&D Beyond was unreachable; `ddb_search_monsters` too), and a missing spell or item says it may be misspelled or in a book the account doesn't own, never which.
Source: history.md, Regression remediation 2026-11-11 (owner ruling R4, 2026-11-11).

### Dueling follows dndbeyond.com
Looks like: +2 on every one-handed melee row, so two unflagged one-handed weapons both show it. A sheet that flags an off-hand weapon (`characterValues` typeId 18) gives no row Dueling.
Source: history.md, Regression remediation 2026-11-11 (owner ruling R5, 2026-11-11).

### A character name that matches several characters lists them
Looks like: `character_name: "Skamos"` with two Skamos characters returns an error listing each as `  • Name (ID n)` and ending `Pass character_id to pick one.`; a partial or fuzzy name that matches several characters is never silently resolved to one (an exact name, even one two characters share, resolves to the first with that name). A name matching none, or one that is only whitespace, says "No character found matching ...". If the character list cannot be loaded, the reply is a failure ("Could not load your character list: <status>"), not "No character found".
Source: `matchCharacterName` / `characterNameError` in `src/tools/character.ts` (F14).

### `ddb_login` waits up to 3 minutes and asks D&D Beyond whether you're signed in
Looks like: the sign-in window stays open for up to 3 minutes, whatever the page shows; only a sign-in D&D Beyond confirms (a usable cobalt token) is saved. "Already logged in" appears only when the saved session is really signed in. Closing the window by hand ends it at once with `Login failed: The sign-in window was closed before sign-in finished.`; running out of time says `Login failed: Sign-in wasn't finished within 3 minutes. Run ddb_login to try again.` (with `Last check failed: <reason>.` before the last sentence when D&D Beyond's sign-in check itself failed); error replies are one line, never a Playwright call log; a second `ddb_login` while one is open says a login is already in progress and leaves the first window alone. A saved session that D&D Beyond doesn't count as signed in makes other tools say `Your saved session isn't signed in to D&D Beyond; run ddb_login.`
Source: tool-notes.md, `ddb_login` (Task 10b, F30/F29; owner rulings 2026-11-11/12).

### An unfinished character gets a not-ready line, not numbers
Looks like: a character with no species, no class, or a base ability score (1–6) of zero and no override prints its header, then `⚠️ This character isn't finished on D&D Beyond (missing <a species / a class / ability scores>), so its numbers can't be worked out yet. D&D Beyond shows "Character Not Ready!" for it.` in place of the vitals, stats, defences, combat, spells and concentration. Features, inventory and notes still print. A finished 2024 character (race null, lineage in options) never gets it.
Source: tool-notes.md, `ddb_get_character` (F12; owner decision B3 2026-11-17).

### A base class feature is a Class Feature, even on a subclassed character
Looks like: `ddb_character_lookup` "Sneak Attack" on Ezra 127373542 (Arcane Trickster) gives `[Class Feature]` with first line `Sneak Attack (Rogue, Level 1)` and the class's book; "Mage Hand Legerdemain" gives `[Subclass Feature]` with `Mage Hand Legerdemain (Rogue / Arcane Trickster, Level 3)` and the subclass's book. A feature belongs to the class or subclass its `classId` names; only a feature without one, or with one naming neither, counts as the subclass's because the subclass lists it. Under a homebrew subclass of an official class, the subclass's own features are wrapped as untrusted and the base class features stay plain; under a homebrew class every feature is wrapped.
Source: history.md, Regression remediation 2026-11-13 (owner ruling R4, 2026-11-13, confirmed 2026-11-17).

### An action's name finds the entry that grants it
Looks like: `ddb_character_lookup` "battle medic" on Niko 133057712 gives `[Feat]` Healer, and "stones endurance" on Goliath Barbarian 152579009 gives `[Racial Trait]` Giant Ancestry (through its Stone Giant option); the hit carries its usual Rules line, then `Found through the action "<action>", which this entry grants.` In a list of more than three matches the line ends ` (through "<action>")`. Only actions the sheet shows count (actions, bonus actions, reactions and Special, not weapon-mastery actions, plus any action listed under LIMITED USE), and an action name matches only when the query starts at one of its words (no typo tolerance: "age" doesn't find an action named "…Damage"); only the granting entry's own kind is marked, so an item named like the trait is not; an entry already found by its own name is not listed twice, and an action named like its own feature (Sneak Attack) adds nothing. A hit is wrapped as untrusted when the entry or the action is homebrew.
Source: tool-notes.md, `ddb_character_lookup` "Entries found through an action" (F1; owner decisions A5 and A6, 2026-11-17).


### The 2014 conditions are the full SRD 5.1 text
Looks like: `ddb_get_condition` with `rules_edition: "2014"` prints the whole SRD 5.1 Appendix PH-A entry for all 15 conditions: the opening sentence, the bullets, then any further paragraphs. Exhaustion is the six-level table followed by the stacking ("as well as all lower levels"), removal and long-rest ("Finishing a long rest reduces a creature's exhaustion level by 1") rules. Grappled keeps its thunderwave sentence, and Invisible keeps the hiding and noise sentences.
Source: tool-notes.md, `ddb_get_condition` (2026-11-13 remediation, F5); `src/tools/conditions.ts`.

### Conditional proficiencies are listed but not applied
Looks like: Vi 145415789 has a `firearms` proficiency whose restriction reads "Optional rule at DM discretion". Her Weapons line says `Firearms (conditional, not applied)` (the restriction text itself is never printed) and her Pistol shows +2 to hit, as on dndbeyond.com, not +6. The same note marks a restricted tool or armor proficiency. A restricted and an unrestricted grant of one proficiency print as one plain entry and give proficiency; a whitespace-only restriction counts as unrestricted.
Source: tool-notes.md, Weapon modifier bonuses, Firearms (F2; owner ruling R1, 2026-11-18, reverses the 2026-11-11 F12 fix).

### Player-set defenses are listed and marked
Looks like: a character whose sheet has hand-added defenses (Laena, Idhren 155829352) lists them in the DEFENSES block after the granted ones, each marked, for example `Immunities: Magical Sleep, Poison (player-set), Frightened (player-set)`. A defense a feature already grants prints once, unmarked. The player's own note on why they added it is never shown.
Source: tool-notes.md, Player-set defenses (F7; `src/tools/character/defenses.ts`).
