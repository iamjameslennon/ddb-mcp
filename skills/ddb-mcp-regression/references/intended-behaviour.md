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
Looks like: every `source` search (not `homebrew`) of a book the logged-in account's library doesn't list starts with `> Note: this account doesn't own <book>, so D&D Beyond shows only its free entries — this list is not the whole book.`, even when nothing matched. The free Basic Rules books (`basic-rules-2014`, `br-2024`) never get it. Logged out, or when the library can't be read, there is no note (it never blocks or misleads).
Source: tool-notes.md, "Unowned-book note (F17)" (2026-11-11 remediation).

### `ddb_read_book` of a book the account doesn't own says so
Looks like: `You don't own <book> on D&D Beyond, so its text can't be read here. Books you can read:` followed by the owned books as `  • <title> (<slug>)` lines, instead of the store page. It applies only when the library list loaded and the book is known to the source index and not free; the free Basic Rules books (and `ee`) still read. A title that is in neither the library nor the index keeps the "No book found" error. When the library can't be fetched, reads work as before (a title resolves through the source index).
Source: tool-notes.md, "Unowned-book read (F27)" (2026-11-11 remediation).

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

### Equipped weapons appear in ACTIONS, not INVENTORY
Looks like: the `inventory` section lists armor and gear but no equipped weapons; they appear as attack rows in ACTIONS (`combat`, `full`). This holds only for equipped weapons: a carried weapon that isn't equipped and appears nowhere is not covered by this entry.
Source: `src/tools/character/inventory.ts` header comment.

### Encounter and treasure lookups count an exact name match
Looks like: a name that exactly matches one creature is counted even when other creatures share part of the name, including a third-party one (D&D Beyond has a third-party monster named "Dragon", CR 4). Only a name that matches several creatures without an exact match is reported as ambiguous.
Source: the `ddb_rate_encounter` and `ddb_roll_treasure` descriptions ("exact, then partial").

### Chosen class options print on their parent feature line
Looks like: `• Fighting Style (Fighter 1): Archery`; `ddb_character_lookup` resolves the option by name (`[Class Option]`, first line `Agonizing Blast (Eldritch Invocations, Warlock)`), the parent feature's hit ends with `Chosen: <names>`, and the option's Rules line uses the option's own source (Eldritch Smite reads Xanathar's Guide to Everything), falling back to the owning subclass or class. An option hit under a homebrew class, subclass or parent feature is wrapped, even when the option carries no homebrew flag; under official content it stays plain. A lookup whose query is an entry's exact name lists that entry first ("bless": Bless before Eldritch Blast).
Source: history.md, Regression remediation 2026-11-11 (owner rulings R1 and R6, 2026-11-11).

### EQUIPPED lists armour and magic or attunable gear
Looks like: EQUIPPED holds equipped armour with `(AC n)` and equipped items that are magic or attunable; mundane equipped gear (Backpack, Pouch, Arrows) stays in INVENTORY. The attunement line names the items: `ATTUNEMENT (1/3): Staff of the Woodlands`.
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
