# ddb-mcp regression run — 2026-11-18

| | |
|---|---|
| **Code under test** | `main` @ `9e6e740` ("docs: final fix wave record and the complete deferred-minors list (final review m2)"), local build with `dist/index.js` from 2026-11-18 16:07 |
| **Date** | 2026-11-18 |
| **Client** | Claude (claude.ai session linked to Claude Desktop, ddb-mcp connected through the desktop app); files: could create files |
| **Account** | free (no core rulebook in the library); homebrew: yes, two homebrew species and no other homebrew kinds |
| **Characters** | 56 of 56 test characters, plus 2 of the contributor's own |
| **Tools** | 35 of 36 tools fully covered; `ddb_get_character_raw` is partial (see "Not covered") |

## Verdict

The 2026-11-11 and 2026-11-13 remediation work holds up. Across all 56 test characters every section in the `Ask` column read correctly apart from the findings below, labelling and untrusted-wrapping were consistent, and every safety gate refused as designed. **Two 🔴 High findings should be settled before release**, though both affect edge data shapes rather than common sheets:
- **F1:** Laena's DEX is 20 where dndbeyond.com shows 22, which puts AC, initiative and every DEX row off by 1.
- **F2:** Vi's Pistol shows +6 where the site shows +2. Read "Discuss before building" first: the site and the rules text disagree here.

Two 🟠 Med findings are worth fixing in the same release:
- **F3:** the 2014 SRD "Damage and Healing" chapter is mangled and has no death-save rules.
- **F4:** logged out after `ddb_logout`, spell lookups error instead of falling back to the SRD.

This run cannot tell whether any of these is a regression since v2.10.2. `scripts/regress-all-characters.mts --baseline 2.10.2` would show it for F1, F2 and F5 to F8.

## Method

- **Personas.** I played players ("What's Laena's AC and initiative?", "How many times can Vi use her cannon?", "What does Battle Medic do for Niko?") and DMs ("Four level 5s against a Wraith and two Ghouls — how hard?", "Roll treasure for a CR 7 hoard", "Which undead are CR 5?").
- **Phrasing.** Requests used typos and partial names ("Owlbare", "Cure", "Skamos"), made-up names, unowned books and 2014 tables.
- **Batches.**
  - All 56 test characters in seven batches of 8, with every section in each character's `Ask` list. Each batch also had one `full` request (Wyll, Bobby, Presto, Ancarno, Petit Nuage, Dunil, Hizar; 6–9 KB each, which suits "show me everything") and at least one `ddb_character_lookup`.
  - Then the contributor's own characters, campaign, party and library.
  - Then every row of the coverage matrix, followed by the session, cache and browser tools.
- **Website spot-checks.** Five sheets were opened read-only with `ddb_navigate`, with no clicks on any sheet: Sister Baronessa (level 9), Xarius (multiclass), Aerin (level 5), Vi (level 10, mixed edition) and Laena (level 20). The three required checks matched apart from known issues. The extra checks on Vi and Laena found F1, F2, F7 and F8.
- **Public JSON.** To give the coding assistant data rather than a guess, I read Laena's public character JSON from character-service with `curl` in the desktop app's Linux workspace (into its `/tmp`, nothing in the contributor's folders) instead of `ddb_get_character_raw`, whose 300–500 KB reply would overflow this client's context. I used it only to quote values in F1, F6 and F7.
- **Logged-out pass.** The contributor agreed to log out, then signed back in with `ddb_login`, which also covered that tool's normal path. The account was the same before and after (the same four characters).
- **Interruptions.** No session drops and no service outages.

## Findings

| # | Sev | Status | Finding | Where | Evidence | Criterion |
|---|-----|--------|---------|-------|----------|-----------|
| F1 | 🔴 High | confirmed | Laena's DEX prints 20 where dndbeyond.com shows 22, so her AC, initiative, DEX save, DEX skills and every DEX weapon row are 1 too low | `ddb_get_character`; suggested starting point: `src/tools/character/stats.ts` | User asked: "What's Laena's AC and initiative?" Call: `ddb_get_character({character_id:"26158232", sections:"summary"})` (and `combat`). Got: `STR 8 (-1)  DEX 20 (+5)`, `AC: 19   Initiative: +10`, `DEX +11*`, `Stealth (DEX) +17 **`, `Acrobatics (DEX) +5`, `• Longbow, +3      +14 to hit   1d8+8 piercing`, `• ×2 Shortsword    +11 to hit   1d6+5 piercing`. Expected: DEX 22 (+6), AC 20, Initiative +11, DEX save +12, Stealth +18, Acrobatics +6, Longbow +15 1d8+9, Shortsword +12 1d6+6 (source: dndbeyond.com sheet, read-only `ddb_navigate` on 2026-11-18). The character's public JSON holds DEX base 14, an "other bonus" (`bonusStats`) of +2, a race +2, three class ASI +1s and a feat +1; the site's 22 suggests the +2 other bonus sits outside the 20 cap there. Character: 26158232. | correct |
| F2 | 🔴 High | confirmed | Vi's Pistol row says +6 to hit; dndbeyond.com shows +2 for the same weapon. The Pistol is a [2024] item on a 2014 Artificer, and the site doesn't apply her firearm proficiency to it | `ddb_get_character`; suggested starting point: `src/tools/character/weapons.ts`, `src/tools/character/item-gate.ts` | User asked: "What's Vi's attack with her pistol?" Call: `ddb_get_character({character_id:"145415789", sections:"combat"})`. Got: `• Pistol           +6 to hit   1d10+2 piercing   range 30/90 ft.   Ammunition (Firearms), Range, Loading` and `Weapons: Simple Weapons, Firearms`; Rules line lists 7 [2024] items. Expected: `+2` (source: dndbeyond.com sheet, read-only: "Pistol Ranged Weapon 30 (90) + 2 1d10+2 Martial, Ammunition (Firearms), Range, Loading, Vex"; site proficiencies "Firearms (Optional rule at DM discretion)"). Character: 145415789. | correct |
| F3 | 🟠 Med | confirmed | The 2014 "Damage and Healing" chapter (SRD 5.1) is broken: `### Critical Hits` holds the Damage Rolls text, Damage Rolls is printed twice, and the chapter stops after Damage Resistance, with no Healing, Dropping to 0 Hit Points, Death Saving Throws or Temporary Hit Points. A 2014 table asking about crits gets the wrong text under the right heading, and the tool's own example query (`death saving throw`) finds nothing in 2014 | `ddb_get_rules`, `ddb_search_rules`; suggested starting point: `src/open5e.ts`, `src/tools/reference.ts` | User asked: "We play 2014 — how do critical hits and death saves work?" Calls: `ddb_get_rules({name:"Damage and Healing", rules_edition:"2014", max_chars:6500})` → `### Critical Hits` followed by "Each weapon, spell, and harmful monster ability specifies the damage it deals…", the same text as the `## Damage Rolls` and `### Damage Rolls` blocks above it; the whole chapter is 6190 chars and ends in "Damage Resistance and Vulnerability". `ddb_get_rules({…, query:"death saving throw"})` → `*"death saving throw" not found in Damage and Healing — showing its start.*`. `ddb_search_rules({query:"death saving throw", rules_edition:"2014"})` → `(no matching 2014 rules sections — 2024 sections listed)`. `ddb_get_rules({name:"Dropping to 0 Hit Points", rules_edition:"2014"})` → `(no matching 2014 rules section — 2024 text shown)`. Expected: the SRD 5.1 Critical Hits text and the 2014 sections on dropping to 0 HP, death saves and temporary HP (source: same output, a heading whose body repeats another section; the tool description's own example query 'death saving throw'). The fallbacks themselves are labelled honestly. | correct |
| F4 | 🟠 Med | confirmed | After `ddb_logout`, every spell lookup fails with `Session changed; the previous credentials were revoked.` rather than the labelled Open5e fallback. In the same session, equipment, species, classes, backgrounds and feats fall back correctly. It persists after `ddb_clear_cache({cache:"spells"})` and clears on `ddb_login`. It resembles known issue (bs) (browser tools after logout) but affects a catalog path | `ddb_get_spell`, `ddb_search_spells`, `ddb_search_site` (spells section); suggested starting point: `src/tools/reference.ts`, `src/tools/spell-store.ts`, `src/session-state.ts` | User asked (logged out): "What does Fireball do?" After `ddb_logout`: `ddb_get_spell({name:"Fireball"})` → `Spell lookup failed: Session changed; the previous credentials were revoked.` (3 tries, one after `ddb_clear_cache({cache:"spells"})`); `ddb_search_spells({level:3, school:"evocation", limit:5})` → `Spell search failed: Session changed; …`; `ddb_search_site({query:"Fireball", category:"spells"})` → `Search failed: Session changed; …`; `ddb_search_site({query:"Vorpal"})` → `## Spells` / `_Session changed; the previous credentials were revoked._`. Same session: `ddb_get_equipment({name:"Longsword"})` → `Rules: 2024 · SRD 5.2 (Open5e fallback — not logged in; ddb_login shows D&D Beyond's version)`. Expected: the Open5e fallback with that label (source: intended-behaviour.md, "Logged out, a catalog fallback says to log in", which names `ddb_search_spells` and `ddb_get_spell`; coverage-matrix `ddb_get_spell` logged-out). A server started with no session at all was not tested (it needs a restart). | honest about limits |
| F5 | 🟡 Low | confirmed | Eldritch Smite row prints `1d8`, but the smite always spends a pact slot (5th level for Weslocke) and deals 1d8 + 1d8 per slot level, which is 6d8. A player reading the row under-counts by 5d8 | `ddb_get_character`; suggested starting point: `src/tools/character/actions.ts` (snippet dice) | User asked: "What can Weslocke do in a fight?" Call: `ddb_get_character({character_id:"112317699", sections:"combat"})`. Got: `• Eldritch Smite   1d8` (OTHER), with `SPELL SLOTS  Level 5: 2/2` in `spells`. Expected: 6d8 at a 5th-level slot, or no dice (source: the invocation text via `ddb_character_lookup({character_id:"112317699", name:"eldritch smite"})`: "an extra 1d8 force damage to the target, plus another 1d8 per level of the spell slot"). Character: 112317699. | correct |
| F6 | 🟡 Low | confirmed | Laena prints `swim 10 ft., climb 10 ft.` although she has no swim or climb speed; Superior Mobility only raises speeds she already has | `ddb_get_character`; suggested starting point: `src/tools/character/vitals.ts` (speed) | User asked: "How fast is Laena?" Call: `ddb_get_character({character_id:"26158232", sections:"summary"})`. Got: `Speed: 40 ft., swim 10 ft., climb 10 ft.` Expected: `Speed: 40 ft.` (source: the feature text via `ddb_character_lookup({character_id:"26158232", name:"superior mobility"})`: "If you have a climbing or swimming speed, this increase applies to that speed as well"; the public JSON has race speeds swim 0 and climb 0, plus Superior Mobility modifiers `speed-climbing 10` and `speed-swimming 10`; the site header shows WALKING 40 only). This was raised as suspected in the 2026-11-13 report. The website's speed pop-up was not opened, because the run doesn't click on sheets. Character: 26158232. | correct |
| F7 | 🟡 Low | confirmed | Custom defenses the player set are dropped. dndbeyond.com lists `Frightened*` and `Poison*` for Laena, but the tool shows only Magical Sleep | `ddb_get_character`; suggested starting point: `src/tools/character/defenses.ts` | User asked: "What is Laena resistant or immune to?" Call: `ddb_get_character({character_id:"26158232", sections:"combat"})`. Got: `Resistances: (none)` / `Immunities: Magical Sleep`. Expected: the custom entries too, marked as player-set (source: dndbeyond.com sheet DEFENSES "Frightened*Magical SleepPoison*"; public JSON `customDefenseAdjustments: [22, 5]`). Character: 26158232. | answers the question |
| F8 | 🟡 Low | confirmed | In LIMITED USE, Eldritch Cannon rows read `0 used / 50 max (Rest)`, but 50 is the cannon's hit points (site: "Hit Points: 50 / Special"). Magical Tinkering and Infuse Item also print `(Rest)` where the site says "Special" | `ddb_get_character`; suggested starting point: `src/tools/character/actions.ts` (limited use) | User asked: "How many times can Vi use her cannon?" Call: `ddb_get_character({character_id:"145415789", sections:"combat"})`. Got: `• Eldritch Cannon: Flamethrower   0 used / 50 max   (Rest)` (and the same for Force Ballista and Protector), `• Magical Tinkering   0 used / 4 max   (Rest)`, `• Infuse Item   1 used / 4 max   (Rest)`. Expected: the cannon's HP not shown as uses (or labelled as HP), and the site's "Special" reset (source: dndbeyond.com sheet: "Eldritch Cannon: Flamethrower … 1 Use (50/50) … Hit Points: 50 / Special Current: 50"; "Magical Tinkering … / Special"; "Infuse Item … / Special"). Character: 145415789. | honest about limits |
| F9 | 🟡 Low | confirmed | `ddb_search_racial_traits` lists vestigial "Ability Score Increases" and "Languages" entries as [2024] Dwarf and Orc traits. 2024 species don't grant ASIs or languages, and the tool's own character sheet skips these traits | `ddb_search_racial_traits`; suggested starting point: `src/tools/features-traits.ts` | User asked: "What traits does a Dwarf have?" Call: `ddb_search_racial_traits({race_name:"dwarf", limit:10})`. Got: `**Ability Score Increases** [2024] *(Dwarf)* — When determining your character’s ability scores, increase one score by 2 and a different one by 1, …` and `**Languages** [2024] *(Dwarf)* — Your character knows at least three languages…`; Orc gives the same with `source:"phb-2024"`. Expected: only the 2024 traits (source: `ddb_get_character({character_id:"152570649", sections:"features"})`, whose 2024 Dwarf RACIAL TRAITS are Darkvision, Creature Type, Size, Speed, Dwarven Resilience, Dwarven Toughness and Stonecunning, with no ASI or Languages; test-characters.md: 152570649 "vestigial race ASIs skipped"). | correct |
| F10 | ⚪ Nit | confirmed | `full` and `features` print a developer-facing heading, "OTHER FEATURES (stored as feats in API but NOT player-chosen feats)". On Bobby it lists Weapon Mastery, which is also under CLASS FEATURES. In `full`, the notes line also runs straight on from CURRENCY with no blank line | `ddb_get_character`; suggested starting point: `src/tools/character/features.ts`, `src/tools/character/parse.ts` | User asked: "Show me Bobby's whole sheet". Call: `ddb_get_character({character_id:"133053421", sections:"full"})`. Got: `OTHER FEATURES (stored as feats in API but NOT player-chosen feats)` / `• Weapon Mastery`, then `CLASS FEATURES … • Weapon Mastery (Barbarian 1)`; at the end, `CURRENCY: 15gp` followed directly by `No notes or backstory have been recorded for this character.` The same heading appears in `features` on every Dark Bargain sheet, e.g. 152570649 `• Dark Bargain [third-party]`, and on Ael Varris 166265317 (three disguised feats). Expected: a user-facing heading (for example "Other features"), no duplicate of a listed class feature, and a blank line before the notes line (source: same output; every other section is separated by a blank line). Characters: 133053421, 152570649. | economical |

## Known open issues

| Code | Seen where |
|------|-----------|
| (ba) | Xarius 58640338: the site shows custom names `xDagger*` and `_Rapier*`, but the tool prints the stock `Dagger` and `×2 Rapier`. |
| (bd) | PB-keyed uses are missing from LIMITED USE: Luck Points (Sheila 133059215, Human Fighter 152570663), Stonecunning (Dwarf Cleric 152570649), Stone's Endurance (Goliath Barbarian 152579009), Draconic Cry (Spurt 145414075). |
| (be) | Rows without dice. Petit Nuage 40193614: Deflect Missiles, Arms of the Astral Self (Wis.) and Quickened Healing. Flemin 112315775: the bonus-action `Unarmed Strike` and `Unarmed Strike (Dex.)` rows. Xarius 58640338: Stone's Endurance (the site shows `1d12 +4`). Vi 145415789: the Eldritch Cannon Flamethrower and Detonate rows print only `DC 16` (the site shows 3d8). |
| (bj) | Zayda 49128422 and Cathartic 112305147: Spiritual Weapon and Magic Weapon print no numbers. For Sister Baronessa 39876541 the site shows Spiritual Weapon at `+9 1d8+4`. |
| (B14) | `ddb_read_book` basic-rules-2014/combat has runs of 5–6 blank lines after headings. |

## By design

- Content defaults to 2024 and every rules reply carries a `Rules:` line or inline tags. Consistent across all tools and characters.
- Disguised feats count on the `Rules:` line: Gale 107165979, Ethelrede 112314883 and Ael Varris 166265317 (three feats).
- Weapon mastery appears only with the Weapon Mastery feature. The site shows Slow and Vex on 2014 Aerin 68903271 and Vi 145415789; the tool shows none.
- Custom items and actions are not printed separately. Xarius's site sheet shows "Sun Blade (Rage Bonus)*" and others.
- Save advantages print D&D Beyond's own wording, e.g. Shadowheart 107609898: "against being charmed, and magic can’t put you to sleep".
- Spells are labelled by how they are cast: Weslocke `Hex [5th-level slot]`, Elona and Weslocke `Hellish Rebuke (spell, 2nd level, no slot)`, Orion `[from item]`, 152570683 `Shield (spell, no slot)`.
- Feature rows print dice and a save DC from their own text: Second Wind `1d10 + 9` (Ethelrede), `Stunning Strike   DC 15` (Flemin), Diana's 2024 bonus Unarmed Strike `DC 10` and `(Dex.) DC 13`.
- Subclass always-prepared spells are on the sheet: Zayda's Arcanist's and Nystul's Magic Aura, and Calderax's Vampiric Touch, also present while logged out.
- An action's name finds the entry that grants it: Niko "battle medic" → [Feat] Healer; Goliath "stones endurance" → Giant Ancestry; Weslocke "eldritch smite" → the option plus Eldritch Invocations.
- A base class feature is a Class Feature: Ezra "Sneak Attack" → `[Class Feature] Sneak Attack (Rogue, Level 1)`.
- A character name that matches several characters lists them: "Skamos" → both, with `Pass character_id to pick one.`
- An unfinished character gets the not-ready line (`<own character B>`).
- Large Form is hidden below level 5 (Goliath 152579009).
- Custom backgrounds show the borrowed background (Dunil 112305786 `Criminal / Spy`).
- Monster search caps at 50 and gives the total and size: "dragon" showed 50 of 241, about 27 KB.
- The closest-match line for monsters reads `No monster is named "Owlbare"; showing the closest match, Owlbear.`
- Encounter and treasure lookups never guess. "Red Dragon" listed 8 candidates with CRs, while the exact third-party "Dragon" was counted.
- Treasure uses the 2024 tables only: a 2014 request says `(no 2014 version exists — 2024 tables used)` and still uses 2014 CRs.
- `source` wins over `rules_edition`, with the unowned-book note (`xgte`, `phb-2024`) and the `br-2024` redirect for feats.
- `ddb_read_book` of an unowned book says so and lists the owned books.
- Logged-out catalog fallbacks are labelled `(Open5e fallback — not logged in; …)` for equipment, species, classes, backgrounds and feats. Spells fail instead; see F4.
- The 2014 Exhaustion condition prints the full text: the table plus the stacking, removal and long-rest paragraphs.
- The safety gates refuse first: interact click and fill, the raw schema, download path escapes and off-site navigation.

## Improvements

Character sheet (`ddb_get_character`):
- The combat block has no "attacks per action" line. The site shows `Attacks per Action: 2` for Aerin 68903271 (Ranger 5); Extra Attack appears only in `features`.
- Warlock pact slots print as plain `SPELL SLOTS` (Wyll `Level 1: 1/1`, Weslocke `Level 5: 2/2`), with no "pact / short rest" label.
- On Hank 133056493, BONUS ACTIONS lists `Hunter’s Mark   1d6` (the Favored Enemy free cast) and `Hunter's Mark (spell, 1st-level slot)` with different apostrophes. They read like two different things.
- Orion 152720684's duplicate-grant warning says `Guiding Bolt (L1) — already granted by Class Feature, also in Class Feature … may be a wasted choice`. It names the same source twice, and Star Map's Guiding Bolt isn't a player's choice.
- A 2014 Paladin 1 (109967628) `spells` section prints spell attack and DC with no slots, no spells and no note that spellcasting starts at level 2.
- Racial-trait cantrips with a save (Astarion 107164636's Minor Illusion) print no DC.
- Danyr 39715128's row reads `Greatsword, +1`. The comma-order ruling would give `+1 Greatsword`.
- Sister Baronessa 39876541's language is `Telepathy`, where the site says `Telepathy (60 ft.)`.

Character errors and login:
- A logged-out lookup by name says `Failed to parse character: No session found…`. It could add that public characters work by `character_id`. "Failed to parse character" is also the prefix on a 404 for an unknown ID.
- `ddb_login` says "Session saved to disk" twice and doesn't name the signed-in account.

Rules (`ddb_search_rules`):
- "cover" (2014) lists 10 chapters, including Expenses, Abilities and Traps, through substring hits such as discover and recover. Matching at word starts would cut the noise.
- SRD 5.2 on Open5e has no spellcasting chapter, so the description's own example "concentration" falls back to 2014. It is labelled, but the description could say so.

Monsters and sources:
- `source:"mpmm"` is unknown and the suggestion offers Monster Manual (2014); the code is `motm`. Accepting `mpmm` as an alias would help, since it's a common abbreviation.
- `ddb_read_book({book_slug:"dnd/mpmm"})` replies `Failed to read book: Book fetch failed: 404  (url)`. A "no such book" reply with the owned-book list would help.
- `ddb_search_spells` with no match says `No spells found matching the criteria.`, while the other catalog searches end `… on D&D Beyond or in the SRD.`

Other tools:
- `ddb_encounter_cr` (2024, High) suggests `1 monster : CR 9–30` for four level 5s. A practical ceiling would serve a DM better.
- `ddb_search_site` "Vorpal" (all) shows a closest-match monster, "Avoral Guardinal", where other empty categories are left out.
- `ddb_interact` with a selector that matches nothing waits 30 s (fill) or 10 s (click) and returns a bare `Timeout 30000ms exceeded.` Naming the selector would help the AI retry.
- `ddb_close_browser` says "Browser closed." when nothing was open.
- `ddb_get_campaign` reports `"playerCount":0` while listing one character with a player.

## Prompts for a coding assistant

```
Character sheet — ability scores and DEX-derived values: F1

Symptom: Laena (26158232, 2014 Scout 20) prints DEX 20; dndbeyond.com shows DEX 22. Everything built on DEX is 1 low: AC 19 (site 20), Initiative +10 (site +11), DEX save +11 (site +12), Stealth +17 (site +18), Acrobatics +5 (site +6), Longbow +14 1d8+8 (site +15 1d8+9), Shortsword +11 1d6+5 (site +12 1d6+6).
Evidence: ddb_get_character({character_id:"26158232", sections:"summary"|"combat"}) vs the site sheet (read-only, 2026-11-18). The public JSON holds DEX base 14, bonusStats (D&D Beyond's "Other bonus") +2, a race +2, three class ASI +1s and a feat +1. WIS shows its bonusStats +1 correctly. The site's 22 suggests the "other bonus" is applied outside the 20 cap.
Expected: the site's values (source: dndbeyond.com).
Suggested starting point: src/tools/character/stats.ts (then ac.ts, weapons.ts, which consume the score).

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Character sheet — weapon proficiency on a cross-edition item: F2 (settle "Discuss before building" first)

Symptom: Vi (145415789, 2014 Artificer 10 with 7 [2024] items) shows "• Pistol +6 to hit 1d10+2 piercing"; dndbeyond.com shows "Pistol … +2 1d10+2 Martial, Ammunition (Firearms), Range, Loading, Vex". Her proficiencies read "Weapons: Simple Weapons, Firearms" (site: "Firearms (Optional rule at DM discretion)").
Evidence: ddb_get_character({character_id:"145415789", sections:"combat"}) vs the site sheet (read-only, 2026-11-18).
Expected: whatever the owner decides; the site (the skill's reference) says +2.
Suggested starting point: src/tools/character/weapons.ts, src/tools/character/item-gate.ts.

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Character sheet — smaller row and defense issues: F5, F6, F7, F8, F10

Symptoms:
- F5 Weslocke (112317699): "• Eldritch Smite 1d8". The invocation is 1d8 + 1d8 per slot level, and his only slots are 5th level, so 6d8.
- F6 Laena (26158232): "Speed: 40 ft., swim 10 ft., climb 10 ft.". She has no swim or climb speed. The JSON has race swim 0 and climb 0 plus Superior Mobility "speed-climbing 10" and "speed-swimming 10". The feature text says the bonus applies only to speeds you already have.
- F7 Laena: the site lists custom defenses "Frightened*" and "Poison*" (JSON customDefenseAdjustments [22, 5]); the tool shows only "Immunities: Magical Sleep".
- F8 Vi (145415789): "• Eldritch Cannon: Flamethrower 0 used / 50 max (Rest)" (and Force Ballista, Protector). On the site 50 is the cannon's hit points ("Hit Points: 50 / Special"). Magical Tinkering and Infuse Item print "(Rest)" where the site says "Special".
- F10 Bobby (133053421) full, and every Dark Bargain sheet's features (e.g. 152570649): the heading "OTHER FEATURES (stored as feats in API but NOT player-chosen feats)" is developer wording. Bobby's Weapon Mastery is listed there and again under CLASS FEATURES. In full, "No notes or backstory…" runs straight on from "CURRENCY:" with no blank line.
Expected: as described in each item (sources: the feature texts via ddb_character_lookup, the site sheets, the same output).
Suggested starting points: src/tools/character/actions.ts (F5, F8), vitals.ts (F6), defenses.ts (F7), features.ts and parse.ts (F10).

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Rules — 2014 Damage and Healing: F3

Symptom: ddb_get_rules({name:"Damage and Healing", rules_edition:"2014", max_chars:6500}) returns 6190 chars. "### Critical Hits" is followed by the Damage Rolls paragraphs, Damage Rolls appears twice, and the chapter ends at Damage Resistance and Vulnerability, with no Healing, Dropping to 0 Hit Points, Death Saving Throws or Temporary Hit Points. query:"death saving throw" (the description's own example) says not found. ddb_search_rules({query:"death saving throw", rules_edition:"2014"}) falls back to 2024. ddb_get_rules({name:"Dropping to 0 Hit Points", rules_edition:"2014"}) shows 2024 text.
Expected: the SRD 5.1 text under each heading, including the 2014 death-save and temporary-HP rules; or, if Open5e's document really lacks them, a reply that says the 2014 section is unavailable rather than printing another section's text under the "Critical Hits" heading.
Suggested starting point: src/open5e.ts (SRD 5.1 section assembly), src/tools/reference.ts.

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Catalog lookups — spells after ddb_logout: F4

Symptom: after ddb_logout, ddb_get_spell({name:"Fireball"}), ddb_search_spells({level:3, school:"evocation"}) and the spells section of ddb_search_site all fail with "Session changed; the previous credentials were revoked." It still happens after ddb_clear_cache({cache:"spells"}) and clears on ddb_login. In the same logged-out session, ddb_get_equipment, ddb_search_races, ddb_search_classes, ddb_search_backgrounds and ddb_search_feats fall back to Open5e with "(Open5e fallback — not logged in; ddb_login shows D&D Beyond's version)".
Expected: the same labelled Open5e fallback for spells (intended-behaviour: "Logged out, a catalog fallback says to log in"). Resembles carry-over (bs), the browser tools after logout, but on a catalog path. Not tested: a server started with no session at all.
Suggested starting point: src/tools/reference.ts, src/tools/spell-store.ts, src/session-state.ts (the revoked flag).

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first (docs/claude/caching.md for the compendium), write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Catalog lookups — vestigial 2024 racial traits: F9

Symptom: ddb_search_racial_traits({race_name:"dwarf"}) lists "Ability Score Increases [2024] (Dwarf)" and "Languages [2024] (Dwarf)". Orc does the same with source:"phb-2024". 2024 species grant neither, and the character sheet already skips these traits: 152570649's 2024 Dwarf has no such entries in RACIAL TRAITS.
Expected: the search lists only the traits the 2024 species actually has, matching the sheet.
Suggested starting point: src/tools/features-traits.ts.

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

## Discuss before building

- **F2: which number is right for Vi's Pistol?** The site, which is this skill's reference, shows +2. The tool's own proficiency line says "Firearms", and the 2014 Artificer's firearm proficiency is a DM-optional rule that the site labels as such. The site seems not to apply it to the [2024] Pistol item.
  - **Option A: follow the site.** The tool matches D&D Beyond.
  - **Option B: keep +6.** It is defensible from the rules text. Say so in tool-notes and add a by-design entry.

  Measure the impact first with the whole-corpus script: Vi is the only test character with a firearm.
- **F1 changes how ability scores add up.** Before building, check whether the site always applies "Other bonus" after the 20 cap, or only for some sources. Laena is the only test character it shows on; the whole-corpus diff will show whether any other sheet moves.
- **F6 was confirmed from data and rules text, not from the site.** The speed pop-up on the sheet wasn't opened, because the run doesn't click on sheets. If the site also shows swim 10 and climb 10, it's a choice between matching the site and matching the rules.
- **Suspected, not filed:**
  - The site lists "Shield" in Laena's armour proficiencies; the tool lists only "Light Armor". The JSON has no shield-proficiency modifier I could find, so the source is unexplained.
  - Goliath Barbarian 152579009 and Ael Varris 166265317 still list "Darts" as a tool proficiency. This was raised on 2026-11-13 and is still unverified.
  - Dunil 112305786 still shows "Ball Bearings (bag of 1,000) ×1000". This was raised on 2026-11-13 and is still unverified.
- **Not a finding.** Sister Baronessa's `Channel Divinity: Turn Undead   DC 16` matches the site. By the rules text, her Amulet of the Devout +1 also raises Channel Divinity DCs, so the rules would say 17. Recorded here in case the owner prefers the rules over the site.

## Not covered

- **`ddb_get_character_raw` normal and logged-out.** Not run, because the 300–500 KB reply would overflow this client's working context. The gate was tested: the schema error names `confirm_large_response`, logged in and logged out. The same JSON was saved through `ddb_download_character`.
- **Homebrew entries for spells, items, classes, backgrounds, feats, class features and monsters.** The account's homebrew is only 2 species. Every `source:"homebrew"` search and get for those kinds answered "No homebrew … found", which is honest, but there were no entries to judge for tagging and wrapping. Homebrew species and racial traits were covered.
- **Paid-book content.** Locked on this free account. The replies say so, which is not a finding.
- **`ddb_login` window-close and 3-minute-timeout paths.** Not exercised; the contributor signed in normally.
- **Spells on a server started with no session.** Only the after-logout path was tested (F4).
- **I5 gaps.** None of the contributor's own characters has a Reach weapon, a new kind of save advantage, or Warlock levels above 9.

## Files left behind

- `~/Downloads/eric-133055442.json`: the `ddb_download_character` check (public test character Eric).
- `~/Downloads/ddb-screenshot-1795019292081.png`: the `ddb_interact` screenshot check (D&D Beyond search page).
- `/tmp/laena.json` in the desktop app's Linux workspace, not in the contributor's folders: Laena's public character JSON, used for F1, F6 and F7 evidence. It goes away with that workspace.
- `docs/superpowers/specs/2026-11-18-regression-report.md` in the ddb-mcp repo: a copy of this report, left **untracked**. `npm run release` needs a clean tree, so commit it or move it away first.
