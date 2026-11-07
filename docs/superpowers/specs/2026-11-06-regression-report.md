# ddb-mcp regression run — 2026-11-06
> Plan: docs/superpowers/plans/2026-11-06-regression-fixes.md. B13 only half-matches 0c94dde: `data.customItems` are never listed, but each mirrors an `isCustomItem` inventory entry (same id and quantity) that is, so they stay unprinted (owner ruling 2026-11-06); see the plan's Task 7.

| | |
|---|---|
| **Code under test** | `main` @ `0c94dde` (== `origin/main`), `dist/` built 15:19 after the last `src/` commit |
| **Baseline** | npm `@iamjameslennon/ddb-mcp@2.10.2` (published 2026-07-17, last release) |
| **Characters** | All 56 in `testcharacters.md`. All 56 still public (HTTP 200). |
| **Tools** | 33 of 35 called live through the running server (logged in). `ddb_login` / `ddb_logout` not run (they would end the session). `ddb_interact` tested with screenshot only (click/fill change state). `ddb_get_character_raw` tested on its error path only (300–500 KB reply). |

## Verdict

**No regressions.** Across 56 characters × 8 sections (448 outputs per version), no HP, AC, initiative, speed, save, skill, passive, spell-slot, DC or attack number changed between 2.10.2 and HEAD. Every difference is an intended change. The live server's output is byte-identical to the HEAD build, so the bulk run speaks for the live tool.

The run also found **one high-impact bug that predates this release**: spell casting times are wrong in `ddb_get_spell` and `ddb_character_lookup`. It also found a set of medium/low issues, listed below. Each one was checked against the raw character JSON or the code.

## Method

1. Fetched every character's JSON from character-service v5 (anonymous; all are public).
2. Ran `parseCharacterData(raw, section, index)` for all 8 sections, on both the 2.10.2 package and HEAD `dist/`. No crashes in either.
3. Diffed baseline vs HEAD. Wrappers, `Rules:` lines and inline edition tags were stripped first, so only substantive changes remained (66 changed lines in `full` across 15 characters).
4. Cross-section consistency: the header is identical in every section; every line of `summary`, `combat`, `spells`, `inventory`, `features` and `notes` also appears in `full`; untrusted wrappers are balanced. **All passed.**
5. Scanned for `NaN` / `undefined` / `[object Object]` / sign glitches: none. Found 2 HTML-entity leaks and 1 double space.
6. Spot-checked live sheets on dndbeyond.com (Xarius L10 multiclass, Rustle L9 wizard). Every core stat matches the website exactly.
7. Called every other tool live, with edge cases (bad IDs, bad sources, invalid CR, path escapes, off-site navigation, ambiguous names).

## Baseline → HEAD changes (all intended, all confirmed)

- `Rules:` header and `[2014]`/`[2024]`/`[homebrew]` tags on every character section.
- Untrusted wrapping of names, custom languages (`Languages (custom): Orc`) and homebrew items (new `INVENTORY (homebrew)` block).
- Charged magic items in LIMITED USE (Wand of Fireballs 7, Cube of Force 36, Staff of the Woodlands 10, Spider Staff with its dusk text, Rod of Security "ten days").
- Custom backgrounds now show the borrowed feature's background: Dunil `Noble` → `Criminal / Spy`; Xarius `—` → `Outlander`, and gains its BACKGROUND FEATURE.
- 2024 Sleep is now listed as concentration (Elf Wizard 152570683).
- Wording: "already granted by Cantrips" (was "Spells").
- Same-name items from different editions are no longer merged (Presto: `Tinderbox [2014] ×2 … Tinderbox ×2`, was `×4`).

## Findings

| # | Sev | Finding | Where | Evidence |
|---|---|---|---|---|
| B1 | 🔴 High | **Spell casting time is wrong.** The map is `{1: Action, 3: Bonus Action, 6: Reaction}`, but D&D Beyond uses 4 = Reaction, 6 = Minute, 7 = Hour (2 = No Action, 5/8 = Special). Reaction spells read "1 Action", 1-minute spells read "1 Reaction", and 1-hour spells fall back to "1 Action". Present since `13c8695` (first commit). The character sheet's own map (`actions.ts`) is correct. | `src/tools/reference.ts:391-397` (`formatSpell`); `src/tools/character/definition.ts:37` | Live: Shield, Feather Fall, Absorb Elements → "1 Action"; Identify → "1 Reaction"; Find Familiar → "1 Action". `ddb_character_lookup` Rustle "shield" → "1 Action". |
| B2 | 🟠 Med | **`ddb_download_character` rejects `~` paths.** The tool description and the error both tell the caller to use `~/Downloads`, but `resolveSafeSavePath` never expands `~`, so `~/Downloads/x.json` resolves under the working directory and fails. Also affects Windows (`~\Documents`). | `src/tools/character.ts:297` | Live: `~/Downloads/ddb-regression-tilde-test.json` → "Output path must be a file under ~/Downloads or ~/Documents." Absolute paths and the default path work. Escapes (`/etc/…`, `~/Documents/../.ssh/…`) are correctly refused. |
| B3 | 🟠 Med | **The feat search fallback drops `prerequisite`, `limit` and `offset`.** When D&D Beyond has no match, the Open5e fallback gets only `name` and `rules_edition`, so a prerequisite search returns all 17 SRD feats, labelled as matches. | `src/tools/reference.ts:1133` → `src/open5e.ts` `o5SearchFeatsSection` | Live: `prerequisite: "spellcast", limit: 8` → 17 feats including Alert, Archery, Skilled. |
| B4 | 🟠 Med | **The `Rules:` header counts disguised feats as feats.** *By design (owner ruling 2026-11-06: rules-edition spec decision 4 stands).* The FEATS section correctly moves `__DISGUISE_FEAT` entries to OTHER FEATURES, but `editions.ts` classifies all of `char.feats`. 14 of 56 characters show e.g. `third-party: Dark Bargain (feat)`, including in `summary` and `ddb_get_party`. Dark Bargain (The Crooked Moon), Hero's Journey Boon (Obojima), Character Threads and Runestones are D&D Beyond's auto-added optional-rule entries, not player feats. | `src/tools/character/editions.ts:90-93` → `src/edition.ts:933` | Ethelrede, Claude Skamos, Elf Wizard, and 11 others. |
| B5 | 🟠 Med | **Racial traits ignore `hideInSheet`, `displayConfiguration.RACIALTRAIT === 0` and `requiredLevel`.** All 56 characters print traits the sheet hides (Languages ×47, Age/Size/Speed ×36, Ability Score Increases ×20, …). A level-1 Goliath shows **Large Form (needs L5) twice**. Aasimar shows Celestial Revelation twice. | `src/tools/character/features.ts:79` (`buildRacialTraitLines`) | Goliath Barbarian 152579009; Orion 152720684; Mori 39714283 (ASI ×2). |
| B6 | 🟠 Med | **Weapon rows lose data.** (a) Reach is hard-coded `reach 5 ft.`, so thrown weapons hide their range (Javelin 30/120, Dagger/Spear 20/60) and Reach weapons would show 5 ft not 10 ft. (b) Magic-item `grantedModifiers` are ignored: Sun Blade shows `slashing`, but it has `replace-damage-type radiant`, `+1d8 radiant` and a granted `finesse`. (c) The versatile die is not shown (website: 1d8+6 / 1d10+6). (d) Mastery properties (Sap, Vex, Nick, Slow, Topple) print on **2014** characters, because D&D Beyond now ships them on Basic Rules weapon definitions. (e) A `×N` prefix breaks column alignment. | `src/tools/character/weapons.ts:58-80` | Xarius 58640338 vs the live sheet; mastery on all 2014 characters with weapons. No test character carries a Reach weapon (coverage gap). |
| B7 | 🟡 Low | `ddb_get_equipment` with `rules_edition: 2014` prints the 2024 mastery block (2014 Longbow → "Slow" plus the mastery paragraph). Same root cause as B6(d). | `src/tools/reference.ts` item formatter | Live: Longbow 2014. |
| B8 | 🟡 Low | **`ddb_get_monster` prints zeros for locked content:** `Armor Class 0`, `Hit Points 0 (d0)`, `passive Perception 0`. | `src/tools/monster.ts:566-567` and the senses line | Live: Beholder (MM 2024, not owned). |
| B9 | 🟡 Low | **`ddb_rate_encounter` gives a headline difficulty even when some monsters were not counted.** 3×L5 + 1×L3 vs "Red Dragon" + 4 goblins → **TRIVIAL**, with the ambiguity warning at the bottom. In 2014 mode the multiplier is also computed on the reduced count. | `src/tools/encounter.ts:~110-117` | Live, both editions. |
| B10 | 🟡 Low | `ddb_get_rules` / `ddb_search_rules`: (a) a `query` that isn't found silently returns the section start; (b) an Open5e timeout surfaces as the bare "The operation was aborted due to timeout". | `src/open5e.ts` `o5GetRule` (~1460), `fetchPages` | 5 timeouts over about 8 min, then recovered. The same request from the sandbox took 0.2 s. Note: Open5e's SRD 5.1 has no death-saving-throw text at all. |
| B11 | 🟡 Low | **Monster name search shows D&D Beyond's fuzzy hits that don't contain the query**, and filter-only searches check only the first 600 of 6,113 entries. | `src/tools/monster.ts` search path | "goblin" → Warrior Infantry, Kobold Warrior, Ratling Warrior. `ddb_search_site` "Vorpal" → Avoral Guardinal. CR 5 + undead → 3 results, missing Wraith (MM 2024). |
| B12 | 🟡 Low | The **Critical Role source category (2) is classed as third-party**, but some of its books are Wizards-published (Frozen Sick, Explorer's Guide to Wildemount, Call of the Netherdeep). | `src/edition.ts:73` | `ddb_list_library`: Frozen Sick `[third-party]`. |
| B13 | 🟡 Low | **Custom items** (`customItems`, `isHomebrew` false) are tagged `[edition not stated]` inside `INVENTORY (homebrew)` and counted as "edition not stated" in `Rules:`. Names aren't trimmed (`Filigreed Longsword  [edition not stated]`). | inventory + editions | Calderax 14814039, Danyr 39715128, Harry 17931478. |
| B14 | ⚪ Nit | HTML entities in background features (`&mdash;`); proficiency names lose apostrophes and capitals (`Thieves tools`, `Cartographers tools`, `Thieves cant`, `Crossbow light`); 404 errors read `D&D Beyond API returned 404:` (empty statusText on HTTP/2); `ddb_read_book` spends `max_chars` on runs of blank lines; `search_spells source: xgte` says "No spells found" when the book simply isn't owned. | various | Sister Baronessa, Weslocke; Xarius; 83352651. |

### Improvements (not bugs)

- **I1 Save advantages:** the website shows "advantage on INT/WIS/CHA saves against magic" (Gnome Cunning), Danger Sense and similar under Saving Throws. The data is in `modifiers` (`type: advantage`, `restriction`). The MCP only names the trait.
- **I2 Attack cantrips in ACTIONS:** the website lists Fire Bolt +9 2d10 and Ray of Frost under attacks. The MCP lists them only in SPELLS.
- **I3 Sneak Attack dice and Two-Weapon Fighting** in combat (the website shows Sneak Attack 3d6 under OTHER).
- **I4 Repeatable regression:** turn this run into `scripts/regress-all-characters.mts`, which parses every `testcharacters.md` ID for all sections on the published package and on HEAD, strips the cosmetic lines, and prints a diff plus the anomaly scan.
- **I5 Test-set gaps:** no Reach weapon, no character with save-advantage traits beyond Gnome/Barbarian, and no Warlock above L9. `testcharacters.md` can be marked "verified 2026-11-06"; 52514332 in the dead list is now 404 (was 403).

---

## Claude Code prompts

Run these one at a time. Each one keeps the repo's rules: tests first, the live snapshot flow in `docs/character-refactor.md` for parse changes, and a CLAUDE.md/docs update.

### Prompt 1 — B1 spell casting time (do first)

```
Bug: ddb_get_spell and ddb_character_lookup print the wrong casting time for every reaction, minute and hour spell.

The activation map in src/tools/reference.ts formatSpell (~line 391) and src/tools/character/definition.ts (~line 37) is {1:"Action",3:"Bonus Action",6:"Reaction"} with a fallback of "Action". D&D Beyond's activationType values are 1 Action, 2 No Action, 3 Bonus Action, 4 Reaction, 5 Special, 6 Minute, 7 Hour, 8 Special (src/tools/character/actions.ts already documents 4 = reaction). Live results today: Shield / Feather Fall / Absorb Elements -> "1 Action"; Identify / Alarm -> "1 Reaction"; Find Familiar -> "1 Action" (should be "1 Hour").

Fix:
- Put one shared activation map and formatter in one module, used by both call sites. Pluralise ("10 Minutes", "8 Hours"), show the reaction trigger if the definition carries one (activation.activationCondition or castingTimeDescription), and never silently fall back to "Action": an unknown type prints the raw number.
- Check whether any other formatter (monster actions, items, the Open5e path) has its own copy of the map.
- Add unit tests for types 1-8, including plurals.
- Verify live: ddb_get_spell Shield, Counterspell, Identify, Find Familiar, Alarm (both rules editions), and ddb_character_lookup "shield" on 112316571.
Do not change anything else.
```

### Prompt 2 — Character sheet: B4, B5, B13, entities

```
Four character-sheet fixes. Run scripts/snapshot-live-characters.mts before and after; the only diffs should be the ones described here.

1) Rules: header counts disguised feats (B4). src/tools/character/editions.ts (~line 90) classifies every char.feats entry, so __DISGUISE_FEAT entries (Dark Bargain, Hero's Journey Boon, Character Threads, Runestones) appear as "third-party: Dark Bargain (feat)" on 14/56 test characters, including in summary and ddb_get_party. Apply the same split features.ts uses (exclude __DISGUISE_FEAT and __INITIAL_ASI), or classify them under a non-feat kind that characterRulesLine leaves out. Keep their [third-party] tag in OTHER FEATURES. Test: 112314883 should show "Rules: 2014" with no third-party part.

2) Racial traits (B5). features.ts buildRacialTraitLines prints every racialTraits entry. Skip a trait when definition.hideInSheet is true, when displayConfiguration.RACIALTRAIT === 0, or when definition.requiredLevel > total character level. Dedupe by name after filtering. Expected: Goliath Barbarian 152579009 (L1) loses "Large Form" (requiredLevel 5, listed twice now); Orion 152720684 shows Celestial Revelation once; Age/Size/Speed/Languages disappear for 2014 races where hideInSheet is true. ddb_character_lookup should still find hidden traits by name. Check that the same filter is right for the stats/actions code that also walks racialTraits (stats.ts ~202, actions.ts ~65); change those only if they surface hidden traits.

3) Custom items (B13). customItems entries (no source, isHomebrew false) show as "Platinum Ring [edition not stated]" inside INVENTORY (homebrew), and are counted as "edition not stated: N items" in Rules:. Label them as custom instead: tag "[custom]" or no tag inside a "INVENTORY (custom/homebrew)" block, and "custom: N items" in Rules:. Keep them wrapped as untrusted. Trim item names ("Filigreed Longsword " has a trailing space). Test with 14814039, 39715128, 17931478.

4) Decode HTML entities (&mdash;, &rsquo;, &amp;, &nbsp;) in feature/background text after the HTML strip. Seen in 39876541 and 112317699 background features.

Update tests/__snapshots__ and docs as needed.
```

### Prompt 3 — Weapons: B6, B7

```
Weapon rows in the character combat section (src/tools/character/weapons.ts ~58-80) and the 2014 item formatter need fixing. Use Xarius 58640338 as the main fixture and compare it with the live sheet (https://www.dndbeyond.com/characters/58640338).

1) Range/reach: rangeStr is "reach 5 ft." for every non-ranged weapon. Use 10 ft. for the Reach property (plus any reach bonus modifiers). For Thrown melee weapons show both: "reach 5 ft. / thrown 30/120 ft." from definition.range/longRange. Expected: Javelin 30/120, Dagger 20/60, Spear 20/60.
2) Versatile: show the two-handed die from the Versatile property's notes, e.g. "1d8+6 (1d10+6 two-handed)".
3) Item grantedModifiers on the weapon definition: apply replace-damage-type (Sun Blade -> radiant), list extra damage dice ("+1d8 radiant", with the restriction text if any), add weapon-property grants (finesse) to the properties and to the STR/DEX choice. Bonus/magic is already handled; keep it.
4) Mastery: D&D Beyond now puts mastery names (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) in properties[] of Basic Rules 2014 weapons. Only show mastery when the character has a Weapon Mastery feature, and only for weapons the character chose if that data is available. Otherwise drop those names. A 2014 character (e.g. 58640338, 112314883) should show no mastery.
5) Alignment: pad the full label including the "×N " quantity prefix so columns line up.
6) ddb_get_equipment rules_edition 2014: don't print the mastery paragraph or the mastery name in Properties for a 2014 reply (live: Longbow 2014 shows "Slow").

Add unit tests for each with small fixtures. No test character carries a Reach weapon, so add a synthetic one. Run the live snapshot script before/after.
```

### Prompt 4 — Tool behaviour: B2, B3, B8, B9, B10, 404 message

```
Six small tool fixes. Each needs a unit test.

1) B2 ddb_download_character: resolveSafeSavePath (src/tools/character.ts ~297) doesn't expand "~", so "~/Downloads/x.json" is rejected although the tool description and error tell users to write it that way. Expand a leading "~/" or "~\" to os.homedir() before resolve(), on macOS, Linux and Windows. Keep every existing escape check (symlinks, "..", NUL). Tests: "~/Downloads/a.json" accepted; "~/Documents/../.ssh/a.json" and "/etc/a.json" refused.

2) B3 ddb_search_feats: the fallback at src/tools/reference.ts ~1133 passes only name and rulesEdition to o5SearchFeatsSection, so prerequisite, limit and offset are dropped. A prerequisite search with no D&D Beyond hit returns all 17 SRD feats. Pass them through and apply them on the Open5e path (prerequisite as a case-insensitive substring of the record's prerequisite). Check the races/classes/backgrounds fallbacks for the same limit/offset loss.

3) B8 ddb_get_monster on locked content prints "Armor Class 0", "Hit Points 0 (d0)" and "passive Perception 0" (live: Beholder, MM 2024, not owned). Omit any stat that is 0 or missing on a restricted block, or print "—". Keep the ownership notice.

4) B9 ddb_rate_encounter: when any monster is ambiguous or not found, don't print a bare difficulty headline. Use "ENCOUNTER DIFFICULTY: INCOMPLETE — n monster(s) not counted (rating below covers the rest: TRIVIAL)" and move the warnings to the top. In 2014 mode, say the multiplier excludes them. Same for ddb_roll_treasure if it has the same shape.

5) B10 rules: in o5GetRule, when a query isn't found, say so ("'death saving throw' not found in Actions in Combat — try ddb_search_rules") instead of silently showing the start. Make Open5e timeouts read "Open5e (api.open5e.com) didn't answer within 20 s — try again shortly" in every tool that uses fetchPages.

6) Character fetch errors: a 404 reads "D&D Beyond API returned 404:" because HTTP/2 has no statusText. Say "Character <id> was not found (404) — check the ID or that it still exists." Don't print a dangling colon in any status message.
```

### Handover — discuss before building

These need a decision from you before any prompt:

- **B11 monster search quality:** filter locally so names must contain the query, and list D&D Beyond's other fuzzy hits as "related" (or drop them). For filter-only searches (CR/type/size), use the monster service's server-side filters rather than checking the first 600 entries. This needs a look at which query params the monster endpoint accepts.
- **B12 Critical Role category:** reclassify category 2 per source. Wizards-published (EGtW, Frozen Sick, CotN) → 2014. Darrington Press (Tal'Dorei Reborn), Blood Hunter → third-party. This needs a small source-ID override table in `edition.ts`.
- **I1–I3 combat completeness:** save advantages from `type: advantage` modifiers with restrictions; attack cantrips (to-hit/DC and dice at character level) in ACTIONS; Sneak Attack dice and Two-Weapon Fighting in combat.
- **I4 regression script and I5 test-set additions:** see above.
