# ddb-mcp regression run — 2026-11-13

| | |
|---|---|
| **Code under test** | `main` @ `3a84caf` (package.json 2.10.2 plus the unreleased work; `dist/` built 2026-11-13 15:39; clean tree). Read from the local checkout and assumed to be the build Claude Desktop's `dndbeyond` server runs. |
| **Date** | 2026-11-13 |
| **Client** | Claude (cloud session linked to the contributor's Mac through the desktop app); files: could create files |
| **Account** | free (library holds only the free books); homebrew: yes (2 homebrew species only, no other homebrew) |
| **Characters** | 56 of 56 test characters, plus 2 of the contributor's own |
| **Tools** | 34 of 36 tools fully covered. `ddb_get_character_raw` and the homebrew scenarios are only partly covered; see "Not covered" |

## Verdict

**Not ready to ship until F7 and F9 are fixed.** Both give wrong numbers that a DM or player would use at the table:

- **F7:** monster stat blocks drop every damage resistance, damage immunity and condition immunity. An Adult Red Dragon prints with no fire immunity.
- **F9:** a Dart (a ranged Finesse weapon) uses DEX when STR is higher.

Six medium findings follow:

- **F4:** 2014 subclass always-prepared spells are missing. This is known issue (bb), but it is much wider than (bb) records.
- **F6:** the feat `prerequisite` filter never matches D&D Beyond.
- **F11:** an equipped magic staff has no attack row.
- **F12:** an unfinished character prints placeholder zeros as if they were real scores.
- **F5:** 2014 Exhaustion leaves out how levels stack and how they're removed.
- **F1:** `ddb_character_lookup` can't find action names that the sheet itself prints.

Everything else held up:

- **Safety gates:** all held.
- **Untrusted wrapping:** correct everywhere, including homebrew species and traits, homebrew items, custom languages and campaign replies.
- **Edition labels:** present on every rules reply.
- **Session lifecycle:** the logout, logged-out and login cycle behaved correctly.

## Method

- **Personas:** I played a player and a DM, mixing exact and vague names, typos ("hunters mark", "stones endurance"), made-up names, books the account doesn't own, and 2014 versus 2024 tables.
- **Test characters:** all 56 characters, in 7 batches of 8, with every section in each character's `Ask` list. Each batch also had one `full` request (4–9 KB each, a suitable size for "give me everything") and one `ddb_character_lookup`.
- **Contributor's own content:** 2 characters, the campaign, the party and the library, all shown here as placeholders.
- **Tool matrix:** every group, run logged in.
- **Spot-checks against dndbeyond.com (read-only):**
  - Elf Fighter 109965870 (level 1)
  - Cathartic 112305147 (level 9)
  - Xarius 58640338 (multiclass)
  - Extra checks to settle suspected findings: Flemin 112315775, Aerin 68903271, Orion 152720684 and `<own character B>`.
- **Download:** one character was downloaded (Cathartic) and its JSON inspected to settle F4.
- **Logged-out pass:** run with the contributor's agreement. I then logged back in with `ddb_login` and confirmed the same account.
- **Interruptions:** no session drops. The monster list scan was short once (see Environment notes); it was retried after `ddb_clear_cache` and completed.

**Environment notes:**

- One `ddb_search_monsters` scan read "6,112 of 6,113+" entries. The reply said so, and the retry was fine.
- One `ddb_navigate` timed out on networkidle while the page had loaded (filed as F8).

## Findings

| # | Sev | Status | Finding | Where | Evidence | Criterion |
|---|-----|--------|---------|-------|----------|-----------|
| F7 | 🔴 High | confirmed | Monster stat blocks leave out damage resistances, damage immunities and condition immunities, in both editions | `ddb_get_monster`; suggested starting point: `src/tools/monster.ts`, `src/tools/monster-service.ts` | DM: "Stat block for Mormesk the Wraith." Call: `ddb_get_monster({name:"Mormesk the Wraith", source:"lmop"})`. Got: AC 13, HP 45, Speed and abilities, then straight to "**Senses** Darkvision 60 ft., passive Perception 12". There are no resistance or immunity lines. Expected: the same creature in the owned book, `ddb_read_book({book_slug:"dnd/lmop", chapter_slug:"appendix-b-monsters", query:"Wraith"})`, reads "**Damage Resistances** acid, cold, fire, lightning, thunder; bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered / **Damage Immunities** necrotic, poison / **Condition Immunities** charmed, grappled, paralyzed, petrified, poisoned, prone, restrained". The same gap appears on Adult Red Dragon in 2014 and 2024 (no fire immunity), the 2024 Wraith and the 2024 Zombie (no poison immunity). | correct; answers the question |
| F9 | 🔴 High | confirmed | A ranged Finesse weapon (Dart) uses DEX even when STR is higher | `ddb_get_character` (combat/full ACTIONS); suggested starting point: `src/tools/character/weapons.ts`, `src/tools/character/actions.ts` | Player: "What's my attack with darts?" Call: `ddb_get_character({character_id:"112315775", sections:"combat"})` (Flemin: STR 16 (+3), DEX 14 (+2)). Got: "• ×10 Dart +6 to hit 1d4+2 piercing range 20/60 ft. Finesse, Thrown". Expected: "Dart … +7 … 1d4+3" (source: dndbeyond.com sheet, Actions tab). The same reply's Shortsword, also Finesse, correctly uses STR ("+7 to hit 1d6+3"). | correct |
| F4 | 🟠 Med | confirmed | Subclass always-prepared spells are missing on 2014 cleric domains, paladin oaths and the artificer Artillerist. This is the same cause as known issue (bb), which names only Calderax. | `ddb_get_character` (spells, concentration, combat), `ddb_character_lookup`; suggested starting point: `src/tools/character/spells.ts` | Player: "What spells does Cathartic have prepared?" Call: `ddb_get_character({character_id:"112305147", sections:"spells"})` (Life Domain 9). Got: 13 prepared spells, none of them Life domain spells. Combat BONUS ACTIONS shows only Mass Healing Word. Expected: dndbeyond.com shows "Spiritual Weapon … 2nd Level … 60ft. +8 1d8+4" under Bonus Actions and "Raise Dead(5th)" under Other. The downloaded character JSON has none of the domain spells in `classSpells`. Same gap on: Dwarf Cleric 109960799 (Life 1: no Bless or Cure Wounds; lookup "Bless" says not found); Shadowheart 107609898 and Sister Baronessa 39876541 (Trickery: no Charm Person, Disguise Self and so on); Zayda 49128422 (Arcana 3); Elona 49053647 (Devotion 3: no Protection from Evil and Good or Sanctuary, although features list "Oath Spells (Paladin 3)"); Vi 145415789 (Artillerist 10: features list "Artillerist Spells (Artificer 3)" but no Shield, Thunderwave, Scorching Ray, Shatter, Fireball or Wind Wall). Concentration lists are short as a result (no Bless). Subclass spells do appear for Ehsu (Monster Slayer), Aerin (Gloom Stalker) and Orion (Circle of Stars). | correct; answers the question |
| F11 | 🟠 Med | confirmed | An equipped magic staff that works as a quarterstaff has no attack row | `ddb_get_character` (combat/full ACTIONS); suggested starting point: `src/tools/character/weapons.ts`, `src/tools/character/item-gate.ts` | Player: "How do I attack with my staff?" Call: `ddb_get_character({character_id:"152720684", sections:"combat"})` (Orion; inventory shows "EQUIPPED Staff of the Woodlands [2014]", attuned). Got: ACTIONS lists only Unarmed Strike, Poison Spray, Guiding Bolt and Healing Hands. Expected: "Staff of the Woodlands · Legacy · Melee Weapon · 5ft. · +4 · 1d6+1 / 1d8+1 · 10/10 Charges, Simple, Versatile, Topple" (source: dndbeyond.com sheet, Actions tab). | answers the question; correct |
| F12 | 🟠 Med | confirmed | An unfinished character (no ability scores) prints placeholder zeros as if they were real | `ddb_get_character`; suggested starting point: `src/tools/character/parse.ts`, `src/tools/character/stats.ts` | Call: `ddb_get_character({character_id:<own character B>, sections:"summary"})`. Got: "STR 0 (-5) DEX 0 (-5) CON 0 (-5) INT 0 (-5) WIS 0 (-5) CHA 2 (-4)", "AC: 5 Initiative: -5", passive scores of 5, and every skill at -5 or -4. Expected: say the character is unfinished. dndbeyond.com shows: "Character Not Ready! The current character is not accessible because it is missing either a Species, Class or Ability Scores." No public test character reproduces this, so the contributor's own character is used, under a placeholder. | honest about limits |
| F6 | 🟠 Med | confirmed | The `prerequisite` filter of `ddb_search_feats` never matches D&D Beyond feats. Every prerequisite search falls back to the Open5e SRD and says the feat isn't on D&D Beyond. | `ddb_search_feats`; suggested starting point: `src/tools/reference.ts`, `src/tools/edition-search.ts` | DM: "Which feats need Strength 13?" Call: `ddb_search_feats({prerequisite:"Strength 13"})`. Got: only "Grappler … SRD 5.2 (Open5e fallback — not found on D&D Beyond) … Prerequisite: Level 4+, Strength or Dexterity 13+". With `prerequisite:"level 4"` it got "(Open5e fallback — not found on D&D Beyond). Found 2 feat(s) (SRD only): Ability Score Improvement, Grappler". Expected: D&D Beyond does have these feats. `ddb_search_feats({name:"grappler"})` returns D&D Beyond's own "Grappler [2024] — … Punch and Grab…", and `source:"phb-2024"` lists 20 D&D Beyond feats, including Ability Score Improvement. | answers the question; honest about limits |
| F5 | 🟠 Med | confirmed | 2014 Exhaustion leaves out how levels stack and how they're removed | `ddb_get_condition`; suggested starting point: `src/tools/conditions.ts` | Player: "We play 2014. How does exhaustion work?" Call: `ddb_get_condition({name:"exhaustion", rules_edition:"2014"})`. Got: the intro and the six-level list only. Expected: the Basic Rules (2014) text, from `ddb_read_book({book_slug:"dnd/basic-rules-2014", chapter_slug:"appendix-a-conditions", query:"Exhaustion"})`, adds that a creature "suffers the effect of its current level of exhaustion as well as all lower levels", that further exhaustion raises the level, and that "Finishing a long rest reduces a creature's exhaustion level by 1, provided that the creature has also ingested some food and drink." The 2024 reply does include stacking and removal. | answers the question; correct |
| F1 | 🟠 Med | confirmed | `ddb_character_lookup` can't find action names that the same character's sheet prints, and the not-found reply gives no near match | `ddb_character_lookup`; suggested starting point: `src/tools/character/definition.ts`, `src/tools/character.ts` | Goliath Barbarian 152579009: the combat section's REACTIONS prints "• Stone's Endurance (Stone Giant)". Player: "What does Stone's Endurance do?" `ddb_character_lookup` with "stones endurance", "stone's endurance" and "Endurance" all got "No definition found matching … on this character. Try a partial name like "hunter" for Hunter's Mark." The text is inside "Giant Ancestry", which `name:"Giant Ancestry"` returns. Niko 133057712: ACTIONS prints "• Battle Medic"; lookup "Battle Medic" says not found, although it belongs to the Healer feat. Expected: find the entry that contains the action, or name the parent feature or feat as a near match (source: the same output's ACTIONS and REACTIONS). | answers the question; honest about limits |
| F2 | 🟡 Low | confirmed | On a rogue with a subclass, `ddb_character_lookup` labels base class features as subclass features | `ddb_character_lookup`; suggested starting point: `src/tools/character/definition.ts` | Call: `ddb_character_lookup({character_id:"127373542", name:"Sneak Attack"})` (Ezra). Got: "[Subclass Feature] Sneak Attack (Rogue / Arcane Trickster, Level 1) Rules: 2014 · Player's Handbook (2014)". Uncanny Dodge is labelled the same way. Expected: "[Class Feature] Sneak Attack (Rogue, Level 1)", which is what Astarion 107164636 (no subclass) gets ("… Basic Rules (2014)"). The features section also lists Sneak Attack under CLASS FEATURES. | correct |
| F3 | 🟡 Low | confirmed | `concentration` (and the combat section's spell rows) label spells with a slot level the character doesn't have | `ddb_get_character` (concentration, combat); suggested starting point: `src/tools/character/spells.ts`, `src/tools/character/spell-attacks.ts` | Orion 152720684 concentration: "Level 6: • Wall of Thorns [2014] [6th-level slot]" and "Barkskin [2014] [2nd-level slot]", but these are cast from the Staff of the Woodlands (spells section "From Item:"), and SPELL SLOTS stop at "Level 3". Weslocke 112317699 (warlock with pact slots only, "SPELL SLOTS Level 5: 2/2"): concentration shows "Hex [1st-level slot]", and BONUS ACTIONS shows "Hex (spell, 1st-level slot)", although the ACTIONS row correctly upcasts Witch Bolt to 5d12. Laena 26158232 (rogue, no slots): "Conjure Elemental [5th-level slot]". Xarius 58640338 (no slots, rituals only): "Beast Sense [2nd-level slot]". | correct |
| F14 | 🟡 Low | confirmed | 2014 Second Wind and 2014 Bardic Inspiration rows print no dice, while the 2024 rows do | `ddb_get_character` (combat); suggested starting point: `src/tools/character/actions.ts` | Elf Fighter 109965870 shows "BONUS ACTIONS • Second Wind" with no dice. dndbeyond.com: "Once per short rest, you can use a bonus action to regain 1d10 + 1 HP." By contrast, 2024 Eric 133055442 shows "• Second Wind 1d10 + 1". Billy 40080729 (2014) shows "• Bardic Inspiration"; Lysander 162797600 (2024) shows "• Bardic Inspiration 1d6". Resembles (be). | answers the question |
| F10 | 🟡 Low | confirmed | Monk sheets never show the Ki save DC, so Stunning Strike and Open Hand Technique questions can't be answered | `ddb_get_character` (combat); suggested starting point: `src/tools/character/actions.ts` | Player: "What's the DC for my Stunning Strike?" `ddb_get_character({character_id:"112315775", sections:"combat"})` → OTHER: "• Ki Points • Stunning Strike • Open Hand Technique", with no DC anywhere. dndbeyond.com: "your Ki save DC is 15"; Stunning Strike "(DC 15)". Petit Nuage 40193614 is the same. | answers the question |
| F13 | 🟡 Low | confirmed | Logged out, catalog fallbacks say "D&D Beyond unavailable" instead of "not logged in" | `ddb_get_spell`, `ddb_search_spells`, `ddb_get_equipment`, `ddb_search_equipment`, `ddb_search_races`, `ddb_search_classes`, `ddb_search_backgrounds`, `ddb_search_feats`; suggested starting point: `src/tools/reference.ts`, `src/edition.ts` | After `ddb_logout`: `ddb_get_spell({name:"Fireball"})` → "Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)". The other listed tools use the same wording. In the same minutes, the anonymous monster tools reached D&D Beyond and said "…isn't available without logging in … Run ddb_login if your account owns it." Expected: say the account is logged out and that `ddb_login` unlocks D&D Beyond content. | honest about limits |
| F8 | 🟡 Low | confirmed | `ddb_navigate` reports failure, with a raw Playwright call log, when a sheet keeps the network busy, although the page loaded | `ddb_navigate`, `ddb_interact`; suggested starting point: `src/tools/navigate.ts` | `ddb_navigate({url:"https://www.dndbeyond.com/characters/112305147"})` → "Navigation failed: page.goto: Timeout 30000ms exceeded. Call log: - navigating to "…", waiting until "networkidle"". Straight afterwards, `ddb_get_page()` returned the full sheet. Failed `ddb_interact` selectors also return "Call log: - waiting for locator(…)". Expected: return the loaded page (or say "still loading, try ddb_get_page"), without internal call logs. | honest about limits; economical |
| F15 | ⚪ Nit | confirmed | The Fey Ancestry sleep immunity prints as a slug | `ddb_get_character` (DEFENSES); suggested starting point: `src/tools/character/defenses.ts` | Elf Fighter 109965870: "Immunities: Magical-sleep" (the same on Mori, Astarion, Shadowheart, Lysander, Aerin and others). dndbeyond.com DEFENSES shows "Magical Sleep". | economical |

## Known open issues

| Code | Seen where |
|------|-----------|
| (ba) | Xarius 58640338: dndbeyond.com shows the custom names "_Rapier*", "xDagger*", "xDart*" and "xSpear*"; the tool prints Rapier, Dagger, Dart and Spear. |
| (bb) | Calderax 14814039 (Grave Domain 12): no Bane, False Life, Revivify, Vampiric Touch and so on. It is much wider than listed; see F4. |
| (bd) | Sheila 133059215 and Human Fighter 152570663: "Luck Points" only under OTHER. Dwarf Cleric 152570649: Stonecunning. Goliath 152579009: Stone's Endurance. Spurt 145414075: Draconic Cry. All are missing from LIMITED USE. |
| (be) | Petit Nuage 40193614 (Arms of the Astral Self, Deflect Missiles), Flemin 112315775 (Deflect Missiles; the site shows 1d10+11) and Diana 133054584 (bonus-action Unarmed Strike rows) have no dice. |
| (bj) | Zayda 49128422 ("Spiritual Weapon (spell, 2nd-level slot)"), Spurt 145414075 (Dragon's Breath), Sister Baronessa 39876541 (Spirit Shroud): no numbers. |
| (B14) read_book blank lines | `ddb_read_book` on basic-rules-2014, lmop and the monsters chapter: long runs of blank lines, and tables rendered with one cell per line. |

## By design

- **Content defaults to the 2024 rules**, with a reason line when the other edition is shown: seen on every catalog tool.
- **`source` wins over `rules_edition`**: Fireball and Owlbear with `basic-rules-2014`, Spider Staff with `lmop`, and searches of the mm-2024 and XGtE books.
- **`source: "homebrew"` is reserved**: the 2 homebrew species and 19 homebrew traits are tagged and wrapped.
- **Disguised feats count on the `Rules:` line**: Gale, Ethelrede, Ael Varris and the Dark Bargain characters.
- **Locked content**: "AC —, — HP" with a not-available note, Beholder Zombie's ownership notice, and the "you don't own …" notes on books and searches.
- **User-written text is wrapped**: character names, notes, homebrew items, custom languages, campaign, party and list replies, and attunement lines that include homebrew.
- **Safety gates refuse first**: `ddb_interact` without confirm, raw without `confirm_large_response`, downloads to `/tmp` and `~/Downloads/../`, and `example.com`.
- **Weapon mastery only with the Weapon Mastery feature**: the 2014 Elf Fighter site shows Graze and Slow, the tool none.
- **Save advantages print D&D Beyond's own wording**: "Against Poison", "Made to avoid or end the Charmed condition", and "and magic can't put you to sleep".
- **Attack and damaging save cantrips appear in ACTIONS**; Ice Knife shows both its to-hit and its DC (Mori).
- **Green-Flame Blade row**: Ezra.
- **Custom backgrounds show the borrowed background**: Dunil "Criminal / Spy", Xarius "Outlander".
- **Feature actions match the website's visibility**: Large Form is hidden below level 5 (Goliath), and Steady Aim shows when enabled.
- **Equipped weapons appear in ACTIONS, not INVENTORY**: everywhere.
- **Custom items are not printed separately or counted**: Orion's Luna Heartstone and Ghost Step tattoo. Their heading reads "INVENTORY (homebrew)"; see Improvements.
- **Encounter lookups count an exact name match**: "Dragon" (third-party, CR 4) was counted.
- **Encounter and treasure lookups never guess a monster**: "Red Dragon" was ambiguous and "Snarglefoot" was uncounted with "supply cr".
- **Treasure uses the 2024 tables only**: with `rules_edition: "2014"` it says "(no 2014 version exists — 2024 tables used)".
- **Monster search shows at most 50 by default**: "dragon" gave "50 shown of 241 … about 27 KB", and `list_all` was run after a count was reported.
- **Open5e fallback**: SRD 5.2 has no rules glossary, so "grapple" and "concentration" fall back to SRD 5.1 and say so.

## Improvements

- `ddb_get_character` (spells): pact slots print as plain "SPELL SLOTS Level 5: 2/2" (Weslocke, Wyll), with no "Pact Magic, regained on a short rest" label.
- `ddb_get_character` (spells): characters with spellcasting but nothing chosen yet (Human Paladin 109967628 at level 1, Harry 17931478) print attack, DC and slots with no "no spells prepared or known" line.
- `ddb_get_character` (spells): racial cantrips that need a DC (Astarion's Minor Illusion) print without the spellcasting line or DC.
- `ddb_get_character` (features): background feature text is cut off mid-word ("…or the han…") with no hint that `ddb_character_lookup` gives the full text.
- `ddb_get_character` (features): the heading "OTHER FEATURES (stored as feats in API but NOT player-chosen feats)" is developer wording.
- `ddb_get_character` (spells): the duplicate-grant warning fires when both grants come from one feature and calls it "a wasted choice" (Orion: "Guiding Bolt — already granted by Class Feature, also in Class Feature"; Vi: Prestidigitation from Racial Trait twice).
- `ddb_get_character` (inventory): custom items sit under "INVENTORY (homebrew)" while the `Rules:` line doesn't count them (Orion). "custom" would match the by-design rule.
- `ddb_get_monster`: an ambiguous name ("red dragon") picks Adult Red Dragon without the "Also matches: …" line that `ddb_get_spell` gives.
- `ddb_encounter_cr`: a 2024 High for 4 × level 5 shows "1 monster: CR 9–30", and CR 30 is not useful advice. Cap the range or flag where it leaves the guidelines.
- `ddb_search_site` (category all): adds a monster near-miss block ("Avoral Guardinal" for "Vorpal") even when the other categories had exact hits.
- `ddb_search_feats`: a not-found reply ("great weapon master", 2014) doesn't mention books the account doesn't own, unlike `ddb_get_spell`'s not-found message.
- `ddb_read_book`: a `query` with no `chapter_slug` is silently ignored (the table of contents comes back), and a `query` that isn't a heading silently shows the chapter start. `ddb_get_rules` says "not found … showing its start" in the same situation.
- `ddb_search_racial_traits`: snippets include raw whitespace ("…in your Languages trait with ⏎\t\t\ta language…").
- `ddb_get_character` (logged out, by name): "No session found. Please run ddb_login first" could add that public characters work by `character_id`.
- `ddb_search_backgrounds`: has no skill filter, so "which backgrounds give Stealth?" means reading every snippet.
- Minor wording:
  - `ddb_close_browser` says "Browser closed." when nothing was open.
  - Logged out, `ddb_list_characters` says "No session found" while the other tools say "Not logged in".
  - A missing character reads "Failed to parse character: Character … was not found (404)".

## Prompts for a coding assistant

```
Monsters: F7

Symptom: ddb_get_monster stat blocks never show Damage Resistances, Damage Immunities or Condition Immunities (2014 wording) or Resistances/Immunities (2024 wording). A DM sees an Adult Red Dragon with no fire immunity.
Evidence: ddb_get_monster({name:"Mormesk the Wraith", source:"lmop"}) goes from the ability scores straight to "Senses …". The same creature in ddb_read_book({book_slug:"dnd/lmop", chapter_slug:"appendix-b-monsters", query:"Wraith"}) has "Damage Resistances acid, cold, fire, lightning, thunder; bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered / Damage Immunities necrotic, poison / Condition Immunities charmed, grappled, paralyzed, petrified, poisoned, prone, restrained". The same gap appears on Adult Red Dragon (2014 and 2024), the 2024 Wraith and the 2024 Zombie. Check the Open5e fallback path too.
Expected: the stat block lists vulnerabilities, resistances, immunities and condition immunities in the edition's own wording, between Skills/Saving Throws and Senses (source: the book text above).
Suggested starting point: src/tools/monster.ts, src/tools/monster-service.ts (Open5e: src/open5e.ts)

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Character sheet: F9, F11, F4, F12, F3, F14, F10, F15

Symptom:
- F9: a Dart (ranged, Finesse) uses DEX although STR is higher.
- F11: an equipped Staff of the Woodlands (a quarterstaff) has no attack row.
- F4: 2014 subclass always-prepared spells (cleric domain, paladin oath, Artillerist) are absent from spells, concentration and actions.
- F12: an unfinished character prints STR 0 (-5)…, AC 5, as if real.
- F3: concentration labels item spells and pact-magic spells with slot levels the character doesn't have.
- F14: 2014 Second Wind and Bardic Inspiration rows have no dice.
- F10: there is no Ki save DC.
- F15: "Magical-sleep".
Evidence:
- F9: Flemin 112315775, combat → "×10 Dart +6 to hit 1d4+2"; the website shows +7 / 1d4+3; the same reply's Shortsword uses STR (+7 1d6+3).
- F11: Orion 152720684, combat ACTIONS has no staff; the website shows "Staff of the Woodlands … +4 … 1d6+1 / 1d8+1 … Topple".
- F4: Cathartic 112305147 (Life 9): the website shows Spiritual Weapon (+8 1d8+4) and Raise Dead; the tool shows neither, and the character JSON's classSpells omits them. The same holds for 109960799, 107609898, 39876541, 49128422, 49053647 and 145415789 (Artillerist). Monster Slayer, Gloom Stalker and Circle of Stars subclass spells do show, so compare those code paths.
- F12: <own character B> (contributor's own; no public case). The website says "Character Not Ready! … missing either a Species, Class or Ability Scores".
- F3: Orion "Wall of Thorns [2014] [6th-level slot]" with slots only to level 3; Weslocke "Hex [1st-level slot]" with only "Level 5: 2/2" pact slots; Laena "Conjure Elemental [5th-level slot]" with no slots; Xarius "Beast Sense [2nd-level slot]" with no slots.
- F14: Elf Fighter 109965870 "• Second Wind" (the website says 1d10 + 1); Billy 40080729 "• Bardic Inspiration" (2024 Lysander shows 1d6).
- F10: Flemin has no DC; the website says "Ki save DC is 15".
- F15: the website shows "Magical Sleep".
Expected: the dndbeyond.com sheet values above. For F4, list the subclass's always-prepared spells. Known issue (bb) records that D&D Beyond's character JSON omits them, so they may need to come from the class or subclass definitions. Decide that with the owner (see "Discuss before building"). For F12, say the character is unfinished instead of deriving numbers.
Suggested starting point: src/tools/character/weapons.ts, actions.ts, spell-attacks.ts, item-gate.ts, spells.ts, stats.ts, parse.ts, defenses.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`. Update skills/ddb-mcp-regression/references (known-open-issues.md for (bb)) in the same commit.
```

```
Character lookup: F1, F2

Symptom: ddb_character_lookup says "No definition found" for action names the sheet itself prints (Stone's Endurance, Battle Medic). On a rogue with a subclass, base class features are labelled "[Subclass Feature] … (Rogue / Arcane Trickster …)".
Evidence:
- F1: Goliath 152579009: REACTIONS "Stone's Endurance (Stone Giant)"; lookup "stones endurance", "stone's endurance" and "Endurance" all say not found, while "Giant Ancestry" contains the text. Niko 133057712: ACTIONS "Battle Medic"; lookup says not found (it is part of the Healer feat).
- F2: Ezra 127373542: "Sneak Attack" and "Uncanny Dodge" are labelled [Subclass Feature] with Player's Handbook (2014). Astarion 107164636 gets "[Class Feature] Sneak Attack (Rogue, Level 1) … Basic Rules (2014)".
Expected: find the action through its parent feature, feat or trait, or offer that parent as a near match. Label class features as class features.
Suggested starting point: src/tools/character/definition.ts, src/tools/character.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Catalog lookups: F6, F13

Symptom: ddb_search_feats with `prerequisite` never matches D&D Beyond data and always falls back to the SRD, labelled "not found on D&D Beyond". When logged out, every catalog fallback says "D&D Beyond unavailable" instead of "not logged in".
Evidence:
- F6: ddb_search_feats({prerequisite:"Strength 13"}) → only SRD Grappler. ({prerequisite:"level 4"}) → 2 SRD feats. But ({name:"grappler"}) returns D&D Beyond's 2024 Grappler, and ({source:"phb-2024"}) lists 20 D&D Beyond feats, including Ability Score Improvement.
- F13: after ddb_logout, ddb_get_spell({name:"Fireball"}) → "(Open5e fallback — D&D Beyond unavailable)", while the monster tools at the same time said "isn't available without logging in … Run ddb_login".
Expected: the prerequisite filter matches D&D Beyond entries, with the fallback only when D&D Beyond really has no match. The logged-out label says to log in. All label strings come from src/edition.ts.
Suggested starting point: src/tools/reference.ts, src/tools/edition-search.ts, src/edition.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Rules and conditions: F5

Symptom: the 2014 Exhaustion condition omits the cumulative-levels rule and the long-rest recovery.
Evidence: ddb_get_condition({name:"exhaustion", rules_edition:"2014"}) gives the intro and the six levels only. Basic Rules (2014), appendix-a-conditions, adds: "A creature suffers the effect of its current level of exhaustion as well as all lower levels…", the rule that further exhaustion raises the level, and "Finishing a long rest reduces a creature's exhaustion level by 1, provided that the creature has also ingested some food and drink. Also, being raised from the dead reduces a creature's exhaustion level by 1."
Expected: the full SRD 5.1 Exhaustion text, with the same attribution as now. Check the other bundled 2014 conditions for trimmed paragraphs too.
Suggested starting point: src/tools/conditions.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Browser tools: F8

Symptom: ddb_navigate reports "Navigation failed: page.goto: Timeout 30000ms exceeded. Call log: …" on a character sheet that did load (ddb_get_page straight afterwards returned it). Failed ddb_interact selectors also return Playwright call logs.
Evidence: ddb_navigate({url:"https://www.dndbeyond.com/characters/112305147"}), then ddb_get_page() returned the full Cathartic sheet. ddb_interact fill on 'input[name="q"]:visible' returned "Call log: - waiting for locator(…)".
Expected: treat a loaded page as success (or say it is still loading and point to ddb_get_page). Pass errors through the same scrubbing as login errors (safeErrorLine) so no call log reaches the client.
Suggested starting point: src/tools/navigate.ts, src/browser.ts, src/utils.ts (safeErrorLine)

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

## Discuss before building

- **F4 changes the scope of known issue (bb).** (bb) says "D&D Beyond leaves these spells out of the character data". That holds here too: the downloaded Cathartic JSON has no domain spells. But the gap is not just Calderax. It covers every 2014 cleric domain, paladin oath and the Artillerist that I tested, and the website shows the spells. Fixing it means deriving always-prepared spells from the class or subclass definitions, which goes beyond reading the sheet JSON. **The choice to make:** keep (bb) as accepted but record its real scope, or build the derivation. Monster Slayer, Gloom Stalker and Circle of Stars already work, so a working path exists to compare against.
- **Suspected, not verified, so not filed:**
  - Laena 26158232 prints "Speed: 40 ft., swim 10 ft., climb 10 ft.", but Superior Mobility only boosts swim and climb speeds the character already has. I didn't open her sheet.
  - Bobby 133053421 has 8 proficient skills from a background, a class and a homebrew item; I couldn't verify the source.
  - Goliath Barbarian 152579009 and Ael Varris 166265317 list "Darts" as a tool proficiency.
  - Dunil 112305786 shows "Ball Bearings (bag of 1,000) ×1000" where Halfling Rogue 109963409 shows the bag once.

## Not covered

- **`ddb_get_character_raw` normal and logged-out:** not run. Each reply is 300–500 KB, which would overflow this client's working context. The gate was tested (a validation error naming `confirm_large_response`), and the same JSON was checked through `ddb_download_character`.
- **Homebrew entries for spells, items, classes, backgrounds, feats, monsters and class features:** the account's homebrew holds only 2 species. These calls answered "No homebrew … found" correctly, but there were no entries to judge. Homebrew species and racial traits were covered.
- **`ddb_get_equipment` homebrew:** not run separately. The account has no homebrew items.
- **Paid-book content:** locked on this free account. The replies say so; that isn't a finding.

## Files left behind

- `~/Documents/D&D/ddb-regression-112305147.json`: Cathartic's character JSON, from the one `ddb_download_character` call. It was saved under `~/Documents` rather than `~/Downloads` so the connected-folder shell could inspect it for F4.
- `~/Downloads/ddb-screenshot-1794586281630.png`: from `ddb_interact` screenshot.
