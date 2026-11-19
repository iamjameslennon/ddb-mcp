# ddb-mcp regression run — 2026-11-19

| | |
|---|---|
| **Code under test** | `main` @ `78a0a5a` ("chore: Bump playwright (#70)"), plus uncommitted devDependency bumps in `package.json` / `package-lock.json` (eslint `^10.15.0`, typescript-eslint `^8.73.0`); `dist/` built 2026-11-19 15:20; version 2.10.2 (414 commits since `v2.10.2`) |
| **Date** | 2026-11-19 |
| **Client** | Claude (claude.ai session linked to Claude Desktop; the `dndbeyond` server runs locally through the desktop app); files: could create files |
| **Account** | free (no core rulebook in the library); homebrew: yes, two homebrew species and nothing else |
| **Characters** | 56 of 56 test characters, plus 2 of the contributor's own |
| **Tools** | 35 of 36 tools fully covered; `ddb_get_character_raw` is partial (see "Not covered") |

## Verdict

The build is fit to ship. All ten findings from the 2026-11-18 run were re-tested and are fixed (list below). Across all 56 test characters every requested section read correctly against the rules and against itself. All four dndbeyond.com spot-checks matched the site exactly. Labelling and untrusted-wrapping were consistent, and every safety gate refused as designed.

This run found no 🔴 or 🟠 problems:
- **Two ⚪ Nits** (F1, F2).
- **One 🟡 Low marked suspected** (F3: a Chrome process left running after a `ddb_login` call whose reply was lost). Settle F3 before a release if it reproduces.

**Verified fixed from 2026-11-18:**
- **F1:** Laena 26158232 shows DEX 22, AC 20, Init +11, Longbow +15 1d8+9.
- **F2:** Vi 145415789 Pistol +2, `Firearms (conditional, not applied)`.
- **F3:** the 2014 Damage and Healing chapter has the Critical Hits and Death Saving Throws text.
- **F4:** spells fall back to Open5e, labelled, after `ddb_logout`.
- **F5:** `Eldritch Smite   1d8 + 1d8 per slot level`.
- **F6:** Laena `Speed: 40 ft.`.
- **F7:** player-set defenses are shown, e.g. `Poison (player-set), Frightened (player-set)`.
- **F8:** cannon `50/50 HP   (Special)`.
- **F9:** no vestigial ASI or Languages traits for 2024 species.
- **F10:** the `OTHER FEATURES` heading is plain and there is no duplicate Weapon Mastery.

## Method

- **Personas.** I played players and DMs:
  - Players: "What's my AC?", "What does Battle Medic do for Niko?", "What does Vi's eldritch cannon do?"
  - DMs: "Four level 5s against a Wraith and two Ghouls", "Roll a CR 7 hoard", "Which undead are CR 5?"
- **Phrasing.** Typos and partial names ("Owlbare", "Cure", "Skamos"), made-up names, unowned books (xgte, phb-2024, mtof) and 2014 tables.
- **Batches.**
  - All 56 test characters in seven batches of 8, with every section in each character's `Ask` list. Each batch also had one `full` request (Wyll, Bobby, Goliath Barbarian, Ancarno, Aerin, Flemin, Laena; 5–10 KB each, which suits "show me everything") and at least one `ddb_character_lookup`.
  - Then the contributor's own characters, campaign, party and library.
  - Then every row of the coverage matrix, followed by the session, cache and browser tools.
- **Website spot-checks.** Sheets opened read-only with `ddb_navigate`, with no clicks on any sheet. Required: Therai 39712797 (L2), Cathartic 112305147 (L9) and Vi 145415789 (L10, mixed edition). Extra:
  - Aerin 68903271: her AC 17 has no visible source in the tool's EQUIPPED list; the site also says 17.
  - Goliath Barbarian 152579009: the site also lists the tool proficiency "Darts", which closes the earlier suspicion.
  - Idhren 155829352: the site's DEFENSES match the tool's player-set entries.
- **Logged-out pass.** The contributor agreed. After it, the first `ddb_login` reply was lost by the desktop link at 80 s (see F3). A second `ddb_login` succeeded, and the account was the same before and after (the same four characters).
- **Interruptions.**
  - A monster scan once reported `Only 6,112 of 6,113+ entries could be read`. It was complete on retry after `ddb_clear_cache`; this was an environment hiccup, and the note itself was honest.
  - No session drops.

## Findings

| # | Sev | Status | Finding | Where | Evidence | Criterion |
|---|-----|--------|---------|-------|----------|-----------|
| F1 | ⚪ Nit | confirmed | `ddb_character_lookup` renders an HTML table from feature text as runs of 3–6 blank lines between cells, so the table reads as scattered words. This resembles (B14), but in a different tool | `ddb_character_lookup`; suggested starting point: `src/tools/character/definition.ts`, `src/utils.ts` (`stripHtml`) | User asked: "What does Vi's eldritch cannon do?" Call: `ddb_character_lookup({character_id:"145415789", name:"eldritch cannon"})`. Got: `Eldritch Cannons⏎⏎⏎⏎Cannon⏎Activation⏎⏎⏎⏎⏎⏎Flamethrower⏎⏎⏎The cannon exhales fire…`. Expected: compact rows such as `Flamethrower: The cannon exhales fire…` (source: the same output, where every other paragraph is single-spaced). Character: 145415789. | economical |
| F2 | ⚪ Nit | confirmed | `ddb_get_rules` with `query` starts its excerpt in the middle of a word | `ddb_get_rules`; suggested starting point: `src/tools/reference.ts`, `src/open5e.ts` | User asked: "We play 2014: how do death saves work?" Call: `ddb_get_rules({name:"Damage and Healing", rules_edition:"2014", query:"death saving throw", max_chars:2500})`. Got: `…⏎⏎oint maximum, the cleric dies.⏎⏎### Falling Unconscious…`. Also `query:"critical hits"` gives `…⏎⏎ame time, roll the damage once…`. Expected: the excerpt starts at a paragraph or heading boundary (source: the same output). | economical |
| F3 | 🟡 Low | suspected | After a `ddb_login` call whose reply the desktop link lost at 80 s, a Chrome process stayed running on the Mac with no window. `ddb_close_browser` didn't end it, and neither did a second, successful `ddb_login` | `ddb_login`, `ddb_close_browser`; suggested starting point: `src/auth.ts`, `src/browser.ts` (`beginLoginSession` / `endLoginSession`) | Sequence: `ddb_logout`, then `ddb_login` at about 15:44. The link reported "Device did not respond within 80s". About 3.5 min later `ddb_list_characters` still said "No session found". A second `ddb_login` returned "Successfully logged in… Browser closed." At 15:49 the contributor reported that the Chrome started by the first `ddb_login` was still running: no window, but the Chrome Dock icon still showed its running dot. `ddb_close_browser` returned "Browser closed." and the process was still there. Expected: the login browser process ends when its call ends, whether by success, the 3-minute deadline or window close (source: the tool description, "it closes automatically once your session is saved"; intended-behaviour.md, "`ddb_login` waits up to 3 minutes"). Not verified: which call's process it is, what the first call returned, and whether the contributor's own Chrome was running. | safe / honest about limits |

## Known open issues

| Code | Seen where |
|------|-----------|
| (be) | Petit Nuage 40193614: Deflect Missiles, Arms of the Astral Self and Quickened Healing have no dice. Flemin 112315775: the bonus-action `Unarmed Strike` rows have no dice. Xarius 58640338 and Goliath 152579009: Stone's Endurance has no dice (site: `1d12`). Vi 145415789: Flamethrower and Detonate print `DC 16` only (site: 3d8). Diana 133054584: the bonus Unarmed Strike rows have no dice. |
| (bd) | Absent from LIMITED USE: Luck Points (Sheila 133059215, Human Fighter 152570663), Stonecunning (Dwarf Cleric 152570649), Draconic Cry (Spurt 145414075), Stone's Endurance (Goliath 152579009; site: `1 Use (2/2)`). |
| (bj) | Spiritual Weapon and Magic Weapon print no numbers for Zayda 49128422, Sister Baronessa 39876541 and Cathartic 112305147 (site for Cathartic: `+8 1d8+4`). |
| (B14) | `ddb_read_book` basic-rules-2014/combat has runs of 5–6 blank lines after headings. |

## By design

- **Labels and defaults.** 2024 is the default, every rules reply has a `Rules:` line or inline tags, and a reason line appears when the other edition is shown. Consistent on every tool.
- **Disguised feats on the Rules line:**
  - Gale 107165979 and Ethelrede 112314883 show Hero's Journey Boon and Dark Bargain.
  - Ael Varris 166265317 shows three feats.
  - They are listed under a plain `OTHER FEATURES` heading.
- **Weapon mastery only with Weapon Mastery.** The site shows Nick, Slow and Vex on 2014 Therai, Aerin and Vi; the tool shows none.
- **Save advantages use D&D Beyond's wording,** e.g. Shadowheart 107609898: "against being charmed, and magic can't put you to sleep".
- **Spells are labelled by how they are cast:**
  - Weslocke `Hex [5th-level slot]`
  - Elona and Weslocke `Hellish Rebuke (spell, 2nd level, no slot)`
  - Orion `[from item]`
  - 152570683 `Shield (spell, no slot)`
  - 152570649 `Detect Evil and Good [no slot]`
- **Feature rows take dice and a DC from their own text:**
  - Second Wind `1d10 + 9` (Ethelrede) and `1d10 + 1`
  - Bardic Inspiration `1d6` (BillytheBard 40080729; this was a prior improvement, now present)
  - `Stunning Strike   DC 15` (Flemin)
  - Diana's `Unarmed Strike   DC 10` / `(Dex.) DC 13`
- **Attack and save cantrips in ACTIONS:** Ice Knife `+5 to hit / DC 13 DEX` (Mori 39714283); Toll the Dead and Sacred Flame.
- **Subclass always-prepared spells:** Zayda's Arcanist's and Nystul's Magic Aura; Calderax's Vampiric Touch.
- **An action's name finds its entry:**
  - Niko "battle medic" finds [Feat] Healer.
  - Goliath "stones endurance" finds Giant Ancestry.
  - Weslocke "eldritch smite" finds the option plus Eldritch Invocations.
  - Vi "eldritch cannon" also finds Explosive Cannon through Detonate.
- **A base class feature is a Class Feature:** Ezra "Sneak Attack" gives `[Class Feature] Sneak Attack (Rogue, Level 1)`, and Mage Hand Legerdemain gives `[Subclass Feature]`.
- **Characters by name:** "Skamos" lists both and ends `Pass character_id to pick one.`; `<own character B>` gets the not-ready line.
- **Sheet presentation:**
  - Large Form is hidden below level 5 (Goliath 152579009).
  - Custom backgrounds show the borrowed background (Dunil, Therai, Elona: `Criminal / Spy`).
  - Dueling follows the site (Elona's Javelin `1d6+4`).
- **Monster search:**
  - The 50 cap: "dragon" showed 50 of 241, about 27 KB.
  - The closest-match line: `No monster is named "Owlbare"; showing the closest match, Owlbear.`
  - Locked monsters print `AC —` with the ownership notice.
- **Encounter and treasure never guess:** "Red Dragon" lists 8 candidates. Treasure uses the 2024 tables only, with `(no 2014 version exists — 2024 tables used)` and [2014] CRs.
- **`source` wins over `rules_edition`.** The unowned-book note appears for xgte and phb-2024, and `br-2024` redirects to phb-2024 for backgrounds.
- **`ddb_read_book` of an unowned book** (xgte) says so and lists the owned books.
- **Logged-out catalog fallbacks** are labelled `(Open5e fallback — not logged in; ddb_login shows D&D Beyond's version)` for spells, equipment, species, classes, backgrounds, feats and site search. Class-feature and racial-trait search say to log in.
- **2014 Exhaustion** prints the full SRD 5.1 text.
- **The safety gates refuse first:** interact click and fill, the raw schema, `/tmp` and `../` download paths, and off-site navigation.

## Improvements

Still present from earlier runs:
- **Character sheet (`ddb_get_character`):**
  - Hank 133056493 lists `Hunter’s Mark   1d6` and `Hunter's Mark (spell, 1st-level slot)` with different apostrophes.
  - Racial cantrips with a save print no DC (Astarion 107164636's Minor Illusion).
  - Paladin 1 109967628 and Harry 17931478 print a spellcasting header with no spells and no note.
  - Warlock pact slots print as plain `SPELL SLOTS`.
  - Magic weapon names stay in comma order: `Greatsword, +1` (Danyr 39715128), `Dagger, +1` (Ezra 127373542, Dunil).
  - Duplicate-grant warnings name the same source twice: Orion 152720684 `Guiding Bolt (L1) — already granted by Class Feature, also in Class Feature`; Vi `Prestidigitation [2024] — already granted by Racial Trait, also in Racial Trait`.
  - Sister Baronessa 39876541's language reads `Telepathy` (site: with range).
  - A logged-out lookup by name, and a 404, are both prefixed `Failed to parse character:`.
- **Rules:** `ddb_search_rules` "cover" (2014) lists 10 chapters through substring hits (Expenses, Traps). `ddb_get_rules` not-found gives no suggestions.
- **Catalogs:** `ddb_search_spells` no-match says `No spells found matching the criteria.`, while the other catalogs end `… on D&D Beyond or in the SRD.` `ddb_search_class_features` shows `4: Weapon Mastery` with the level prefix from the data.
- **Monsters and books:** `ddb_read_book({book_slug:"dnd/mpmm"})` returns a bare `Book fetch failed: 404  (url)`. `ddb_search_site` "Vorpal" shows the monster "Avoral Guardinal".
- **Encounters:** `ddb_encounter_cr` (2024, High) suggests `1 monster : CR 9–30` for four level 5s.
- **Campaigns:** `ddb_get_campaign` reports `"playerCount":0` while listing one character with a player.
- **Browser tools:**
  - `ddb_close_browser` says "Browser closed." when nothing is open.
  - `ddb_interact` with a selector that matches nothing returns a bare `Timeout 10000ms exceeded.` without naming the selector.
- **`ddb_login`** says "Session saved to disk" twice and doesn't name the signed-in account.

New:
- **`ddb_search_*` without `source`, on a free account,** silently lists only the free entries; `source` searches carry the unowned-book note. Examples: 10 level-1 abjuration spells; "Great Weapon Master" 2014 returns "No feats found" with no "may be in a book you don't own" hint, unlike `ddb_get_spell` and `ddb_get_equipment`. A one-line note would stop a DM treating the list as complete.
- **`ddb_get_character`:** when the AC has no visible source (Aerin 68903271: AC 17 with only `Leather (AC 11)` equipped, and the site agrees), a note such as "AC override set on the sheet" would answer the obvious follow-up.
- **Skill reference** `test-characters.md`: the Covers note for 109960413 says "Fire Bolt / Ray of Frost rows", but the sheet has no Fire Bolt. Orion 152720684 is now level 5, not 4.

## Prompts for a coding assistant

```
Character lookup — HTML tables in feature text: F1

Symptom: ddb_character_lookup prints an HTML table inside a feature's text as scattered words with runs of 3–6 blank lines between cells.
Evidence: ddb_character_lookup({character_id:"145415789", name:"eldritch cannon"}) (Vi, public test character) → "Eldritch Cannons\n\n\n\nCannon\nActivation\n\n\n\n\n\nFlamethrower\n\n\nThe cannon exhales fire…". Known issue (B14) is the same symptom in ddb_read_book.
Expected: the table as compact rows (e.g. "Flamethrower: …", "Force Ballista: …") or a Markdown table, and no runs of blank lines; the rest of the same reply is single-spaced.
Suggested starting point: src/tools/character/definition.ts, src/utils.ts (stripHtml).

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`. If the fix lives in a shared helper, check whether it also closes (B14) and update the regression skill's known-open-issues.md in the same commit.
```

```
Rules — query excerpts start mid-word: F2

Symptom: ddb_get_rules with a query jumps to a window that starts in the middle of a word.
Evidence: ddb_get_rules({name:"Damage and Healing", rules_edition:"2014", query:"death saving throw", max_chars:2500}) → "…\n\noint maximum, the cleric dies.\n\n### Falling Unconscious…"; query:"critical hits" → "…\n\name time, roll the damage once for all of them…".
Expected: the excerpt starts at the start of a paragraph or heading that contains or precedes the match.
Suggested starting point: src/tools/reference.ts, src/open5e.ts.

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Login — a Chrome process left running: F3 (suspected; reproduce first)

Symptom: on macOS, after a ddb_login call whose reply the MCP client stopped waiting for (the Claude desktop link timed out at 80 s while the 3-minute sign-in window was open), a Chrome process stayed running with no window. ddb_close_browser ("Browser closed.") did not end it. A second ddb_login a few minutes later succeeded ("Successfully logged in… Browser closed.") and the stray process remained.
Evidence: contributor's observation at 15:49 (Chrome Dock icon with its running dot, no window); tool replies as quoted. Unknown: what the first call returned on the server side, whether its 3-minute deadline fired, and which of the two login launches owns the process.
Expected: the login browser process is always closed when a ddb_login call ends (success, deadline, window closed, or client cancellation/disconnect), and ddb_close_browser or the next ddb_login cleans up any stray login browser.
Suggested starting point: src/auth.ts, src/browser.ts (beginLoginSession/endLoginSession, the login launch), and how the server handles a client-side cancel of an in-flight tool call.

First reproduce: start ddb_login from a client that cancels after ~60–80 s, leave the window untouched, and check for a leftover Chrome process after 3 minutes. Then find the cause, choose the fix and add tests yourself; the tester could not see the code.
Follow the repo's rules: read CLAUDE.md, docs/claude/tool-notes.md (ddb_login) and docs/claude/architecture.md (session lifecycle) first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. This touches the pending Task 10b live checks (CLAUDE.md, Open work 7): add a "client cancels mid-login" step to that checklist.
```

## Discuss before building

- **F3 is suspected.** I saw only the tool replies and the contributor's description. The cause might be in the server (login browser not closed when the call is cancelled or times out), in the client (the call cancelled mid-flight), or not in ddb-mcp at all (the contributor's own Chrome). Reproduce it before building. It overlaps the open owner decision on `--enable-automation` for the login launch (Task 10b, ruling 2026-11-12).
- **Treasure magic-item categories not verifiable.** The CR 7 hoard labelled `Smoldering Armor [Relics – Common]`, `Dread Helm [Armaments – Common]` and `Potion of Greater Healing [Relics – Uncommon]`. This free account can't read the 2024 DMG tables, so whether armour and potions belong under Relics is unchecked.
- **Earlier suspicions now closed:**
  - "Darts" as a tool proficiency (Goliath 152579009, Ael Varris 166265317): the site lists it.
  - Dunil's ball bearings no longer print `×1000`.
  - Therai's Criminal/Spy background showing only `Dice Set`: the site agrees.

## Not covered

- **`ddb_get_character_raw` normal and logged-out.** Not run, because the 300–500 KB reply (about 200 KB for a level 1 character) would overflow this client's working context. The gate was tested: the schema error names `confirm_large_response`. The same JSON was saved through `ddb_download_character`.
- **Homebrew entries other than species and racial traits.** The account has no homebrew spells, items, classes, backgrounds, feats, class features or monsters. Every `source:"homebrew"` search for those says so honestly. Homebrew species and racial traits were covered (tagged and wrapped), as were homebrew items on public test characters (Bobby, Spurt, Ehsu: wrapped in ACTIONS, EQUIPPED and ATTUNEMENT).
- **Paid-book content.** Locked on this free account, and the replies say so.
- **`ddb_login` window-close and 3-minute-timeout paths.** Not deliberately exercised. The first post-logout attempt's outcome is unknown (F3).
- **I5 gaps.** No character with a Reach weapon, no new kind of save advantage, and no Warlock above level 9.

## Files left behind

- `~/Downloads/eric-133055442.json`: the `ddb_download_character` check (public test character Eric). It has the same name as the 2026-11-18 run's file, which it overwrote.
- `~/Downloads/ddb-screenshot-1795102694074.png`: the `ddb_interact` screenshot check (D&D Beyond search page).
- A Chrome process with no window may still be running from the first post-logout `ddb_login` (F3). Quit it from the Dock if it isn't your own Chrome.
- `docs/superpowers/specs/2026-11-19-regression-report.md` in the ddb-mcp repo: a copy of this report, left **untracked**. `npm run release` needs a clean tree, so commit it or move it away first.
