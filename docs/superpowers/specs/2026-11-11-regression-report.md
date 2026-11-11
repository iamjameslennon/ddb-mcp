# ddb-mcp regression run — 2026-11-11

| | |
|---|---|
| **Code under test** | `main` @ `43035e6` ("fix(skill): final adversarial review fixes (Codex, router)"), package v2.10.2; local `dist/` built 13:42, after the last `src/` change |
| **Date** | 2026-11-11 |
| **Client** | Claude (cloud session linked to the contributor's Mac through the desktop app); files: could create files |
| **Account** | free (no paid books); homebrew: yes (a homebrew species and its racial traits; no homebrew spells, items, feats, classes, backgrounds, class features or monsters). Category only — the library is private. |
| **Characters** | 56 of 56 test characters (every `Ask` section), plus 2 of the contributor's own |
| **Tools** | 36 of 36 tools covered (`ddb_login` at the end of the run, when signing back in after the logged-out pass) |

## Verdict

Not fit to ship as-is. Five 🔴 High findings. Four print wrong attack or damage numbers that a player would act on: the Archery fighting style (+2 to hit, 4 test characters), the Dueling style (+2 damage), Pact of the Blade proficiency and Firearms proficiency are all ignored. Three of the four are confirmed against dndbeyond.com. Everything else on the sheets checked out well (AC, HP, initiative, speed, saves, passives, spell attack/DC matched the site on four spot-checks), and the safety gates, untrusted-content wrapping and edition labelling held everywhere. Signing back in after the logged-out pass also failed (F30, F29): the login window closes within seconds, and the earlier "Already logged in" reply saved a session that doesn't work, so a user who logs out can't get back in. Fourteen 🟠 Med findings are mostly about honesty of "not found" versus "locked", ambiguous names, and chosen class options (fighting styles, invocations) that never appear.

## Method

- Personas: a player asking about their own sheet ("what's my AC / longbow bonus / what invocations do I have?") and a DM building fights, rolling treasure and looking up monsters, with typos, partial names, nonsense names, 2014 tables, unowned books and follow-ups.
- Characters: all 56 public test characters in 7 batches of 8, every section in each `Ask` column, plus one `full` and at least one `ddb_character_lookup` per batch. The contributor's two own characters, their campaign, party and library were covered once each (placeholders below).
- Evidence: for suspected sheet errors I read the character's own data from D&D Beyond's public character endpoint (the same JSON `ddb_get_character_raw` returns) into my workspace rather than into the conversation, and named the exact field in each finding. `ddb_get_character_raw` itself was run once (level 1 Eric, 133055442) as its matrix row requires.
- Tool matrix: all 7 groups, every scenario on each tool's `Scenarios:` line.
- Spot-checks on dndbeyond.com (read-only `ddb_navigate`): 109965870 (L1 Elf Fighter), 112314883 (L9 Ethelrede), 112317699 (L9 Weslocke) and 58640338 (L10 Barbarian/Rogue multiclass Xarius). One extra beyond the three required, chosen to settle findings.
- Safety: every gate was tested by its refusal first. A click-without-confirm attempt on a character sheet was stopped by the client's own safety layer before it reached the tool, so the click gate was re-tested on the public search page; confirmed `fill`/`click` were used only on the dndbeyond.com search box.
- Logged-out pass: run with the contributor's agreement (`ddb_logout`), every `logged-out` scenario.
- Interruptions: none from services; no session drops or Open5e outages.

## Findings

| # | Sev | Status | Finding | Where | Evidence | Criterion |
|---|-----|--------|---------|-------|----------|-----------|
| F3 | 🔴 High | confirmed | Archery fighting style's +2 to ranged weapon attacks is not applied | `ddb_get_character` combat/full; start `src/tools/character/weapons.ts` | "What's my bonus with the longbow?" `ddb_get_character({character_id:"109965870",sections:"combat"})` → "Longbow +5 to hit 1d8+3 piercing". Expected +7 (DEX +3, prof +2, Archery +2). Source: character JSON (public endpoint, same data as ddb_get_character_raw) `options.class` = "Archery" with class modifier `bonus / ranged-weapon-attacks / 2`; rule text "+2 bonus to attack rolls you make with ranged weapons". Fourth case: Ehsu 42519628 (Ranger 10) longbows "+9", Net "+9", expected +11 (Archery in options.class, modifier +2). Third case: Aerin 68903271 (Gloom Stalker 5) "Longbow +5", expected +7 (Archery in options.class, modifier +2). Second case: Therai 39712797 (2014 Ranger 2) "Longbow +4 to hit 1d8+2", expected +6; JSON options.class includes Archery and class modifier ranged-weapon-attacks +2. Confirmed on dndbeyond.com (ddb_navigate, read-only): 109965870 sheet shows "Longbow … +7 1d8+3". | correct |
| F11 | 🔴 High | confirmed | Pact weapon proficiency not applied: a weapon flagged as the Pact of the Blade weapon is shown without proficiency | `ddb_get_character` combat/full; start `src/tools/character/weapons.ts` | "What's my attack bonus with my pact blade?" Weslocke 112317699 combat → "Shortsword, +1   +4 to hit   1d6+4 piercing". Expected +8 (DEX +3, prof +4, +1): pact weapon "you are proficient with it while you wield it". Source: character JSON characterValues {typeId: 28, value: true, valueId: 636554434 = "Shortsword, +1"} ; dndbeyond.com sheet (ddb_navigate 112317699) shows "Shortsword, +1 / Pact Weapon / +8 / 1d6+4" and "Attacks per Action: 2 — Pact Weapon Only", options.class includes Pact of the Blade. | correct |
| F12 | 🔴 High | confirmed | Firearms proficiency not applied to a Pistol: row shows no proficiency bonus | `ddb_get_character` combat; start `src/tools/character/weapons.ts` | "What's my pistol attack?" Vi 145415789 combat → "Pistol   +2 to hit   1d10+2 piercing range 30/90 ft." Expected +6 (DEX +2, prof +4). Source: character JSON class proficiency modifier `firearms` (entityTypeId 660121713 = weapon-category, as `simple-weapons`); Pistol equipped, categoryId 2. Same output lists "Firearms" under Tools (see F7). | correct |
| F28 | 🔴 High | confirmed | Dueling fighting style's +2 damage is not applied to one-handed melee weapons | `ddb_get_character` combat/full; start `src/tools/character/weapons.ts` | "How much damage does my battleaxe do?" Ethelrede 112314883 combat → "Giant Slayer Battleaxe +9 to hit 1d8+5 slashing (1d10+5 two-handed)", "Hellfire Battleaxe +8 1d8+4 (1d10+4)". dndbeyond.com (ddb_navigate 112314883) shows 1d8+7 / 1d10+5 and 1d8+6 / 1d10+4 (Dueling only one-handed). JSON options.class = Dueling. Same on Elona 49053647 (Dueling, Longsword + Shield): "Longsword +4 1d8+2", expected 1d8+4. | correct |
| F30 | 🔴 High | confirmed (cause suspected) | `ddb_login` closes its sign-in window within seconds and reports "Login timed out", so the user can't sign in | `ddb_login`; start `src/auth.ts` (`login`, the `waitForFunction` wait and its `catch`), `src/browser.ts` (`beginLoginSession`/`endLoginSession`) | After `ddb_logout`, three `ddb_login` calls each returned "Login failed: Login timed out. Please complete login in the browser window and try again." The contributor: the first window closed after a few seconds (before the cookie banner was clicked), the second before they could type, the third while they were signing in with Google. A fourth attempt got through Google sign-in and the phone 2FA check, then the window went white, stayed white, and closed with the same "Login timed out" (so the hand-back from Google to D&D Beyond never completed). `launchBrowser` in `src/browser.ts` starts the user's Chrome app under automation (`chromium.launch({ channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] })`) with a fresh, empty context each time, so a sign-in in the user's everyday Chrome isn't visible, and Google may stall or refuse to complete sign-in in an automated browser with a throwaway profile (likely cause, unverified). The code waits up to 180 s, so these weren't real timeouts: `src/auth.ts` turns any error from the wait into "Login timed out", which hides the real one. Suspected (unverified): the wait fails when the login page redirects across origins (D&D Beyond → Wizards ID → Google). Login worked earlier (a session existed at the start of the run). | answers the question / honest |
| F2 | 🟠 Med | confirmed | `ddb_character_lookup` fuzzy matching misses a typo or word swap in multi-word names, and then says the character doesn't have it | `ddb_character_lookup`; start `src/tools/character/definition.ts` | Wyll 107693030: name "eldrich blast" → "No definition found matching \"eldrich blast\" on this character." but "Eldritch Blast" and "eldritch" both return the spell. Shadowheart 107609898: "trickster blessing" → not found; "Blessing of the Trickster" found. Goliath 152579009: "stones endurance" (no apostrophe) → not found though Stone’s Endurance is in REACTIONS. Straight vs curly apostrophe: Wyll 107693030 "Dark One's Blessing" (typed ') → not found; "Dark One’s Blessing" (’) → found. Users type straight apostrophes. Single-word typo "sheild" works (109960413). Source: tool description promises "partial and fuzzy name matching". | answers the question / honest |
| F4 | 🟠 Med | confirmed | Chosen class options (2014 `options.class`: Fighting Style, Eldritch Invocations, Pact Boon, Favored Enemy/Natural Explorer, etc.) are never shown, and lookup of them fails | `ddb_get_character` features, `ddb_character_lookup`; start `src/tools/character/features.ts`, `definition.ts` | "Which fighting style did I take?" Lae'zel 107607297 features → "• Fighting Style (Fighter 1)"; `ddb_character_lookup({character_id:"107607297",name:"Great Weapon Fighting"})` → "No definition found … on this character". Source: character JSON `options.class` = Great Weapon Fighting (Lae'zel), Archery (109965870), Dueling (112314883). Lookup "Archery" on 109965870 and 39712797 → not found. Warlock: Weslocke 112317699 features list "Eldritch Invocations (Warlock 2)", "Pact Boon (Warlock 3)" only; JSON options.class = Pact of the Blade, Eldritch Smite, Agonizing Blast, Beguiling Influence, Devil’s Sight, Thirsting Blade; `ddb_character_lookup({character_id:"112317699",name:"Agonizing Blast"})` → "No definition found". "What invocations do I have?" can't be answered. Lookup "Fighting Style" on 109965870 returns only the generic "Choose one of the following options" text. | answers the question |
| F6 | 🟠 Med | confirmed | Heavy Crossbow row omits its chosen mastery (Push), while Dagger (Nick) and Longsword (Sap) show theirs | `ddb_get_character` combat/full; start `src/tools/character/weapons.ts` (mastery) | Eric 133055442 combat: "Heavy Crossbow +3 to hit 1d10+1 piercing range 100/400 ft. Ammunition, Heavy, Loading, Range, Two-Handed" — no Push. Source: character JSON feat modifier `weapon-mastery / push-heavy-crossbow` "Push (Heavy Crossbow)". Possibly linked to the "Crossbow, Heavy" → "Heavy Crossbow" rename (unverified). | correct |
| F9 | 🟠 Med | confirmed | `ddb_character_lookup` labels class features from other books as "Basic Rules (2014)" | `ddb_character_lookup`; start `src/tools/character/definition.ts`, `src/edition.ts` | Aerin 68903271 lookup "Dread Ambusher" → "Rules: 2014 · Basic Rules (2014)"; source data `sources: [{sourceId: 27, page 42}]` (Xanathar's Guide; Gloom Stalker subclass also sourceId 27). Shadowheart 107609898 "Blessing of the Trickster" → "Basic Rules (2014)"; data sourceId 2 (Player's Handbook, p.63), Trickery Domain is not in the Basic Rules/SRD. Edition (2014) is right; the book is wrong, so a user told "it's in the free Basic Rules" can't find it there. | edition-labelled / correct |
| F13 | 🟠 Med | confirmed | Net row shows "+5 bludgeoning" damage; a net deals no damage | `ddb_get_character` combat; start `src/tools/character/weapons.ts` | Ehsu 42519628 combat → "Net   +9 to hit   +5 bludgeoning   range 5/15 ft.   Special, Thrown". Source: character JSON Net definition `damage: null, fixedDamage: 0`; PHB weapons table lists Net damage "—" (it restrains). A modifier with no dice is printed as damage. | correct |
| F14 | 🟠 Med | confirmed | `ddb_get_character` by name: a partial name matching two of the account's characters returns "No character found" instead of the choices | `ddb_get_character`; start `src/tools/character.ts` | "Show me Skamos" `ddb_get_character({character_name:"Skamos"})` → "No character found matching \"Skamos\". Try ddb_list_characters…". ddb_list_characters lists two characters ending in "Skamos" (public test character Claude Skamos 155447750 and <own character A>). Unique partials work (the other character's first name; "Thera" → Therai). Expected: list both or state a pick (coverage matrix, ambiguous). | answers the question / honest |
| F17 | 🟠 Med | confirmed | `ddb_search_spells` with an unowned book lists the few visible spells as if complete, with no not-owned note (resembles known B14 wording issue, different symptom) | `ddb_search_spells`; start `src/tools/reference.ts`, `src/source-filter.ts` | "Spells from Xanathar's" `ddb_search_spells({source:"xgte"})` → "**Spell Search** (4 found)" Toll the Dead, Word of Radiance, Life Transference, Enervation. Source: free account library (no XGtE); XGtE has dozens of spells (e.g. Synaptic Static — see F18). | honest about limits |
| F18 | 🟠 Med | confirmed | Locked spells and items are reported as "not found in the compendium" rather than locked | `ddb_get_spell`, `ddb_get_equipment`; start `src/tools/reference.ts` | `ddb_get_spell({name:"Synaptic Static"})` → "Spell \"Synaptic Static\" not found in the compendium."; `ddb_get_equipment({name:"Bloodwell Vial"})` → "Item … not found." Both are real XGtE/TCoE entries the free account doesn't own. Class features handle this well ("D&D Beyond lists only the classes and subclasses available to your account"; TCoE features "locked — not available to this account"). | honest about limits |
| F21 | 🟠 Med | confirmed | `ddb_search_feats` prerequisite filter: no DDB match for "Strength 13", and the Open5e fallback's 2014 match is then hidden as a twin, giving an empty answer | `ddb_search_feats`; start `src/tools/reference.ts`, `src/tools/edition-search.ts` | "Feats that need Strength 13" `ddb_search_feats({prerequisite:"Strength 13"})` → "Rules: 2024 by default — SRD 5.2 … (Open5e fallback — not found on D&D Beyond). No feats found (SRD only). 1 2014 version hidden". DDB has Grappler [2024] (search name "grappler" finds it; 2024 prerequisite reads Str or Dex 13+). Same with offset 5. | answers the question |
| F22 | 🟠 Med | confirmed | `source` set to the free 2024 Basic Rules returns no spells and no feats | `ddb_search_spells`, `ddb_search_feats`; start `src/source-filter.ts` | `ddb_search_spells({source:"br-2024"})` → "No spells found matching the criteria in D&D Beyond Basic Rules."; `ddb_search_feats({source:"br-2024"})` → same for feats. `ddb_search_equipment({source:"br-2024",name:"bag"})` works (5 items). The 2014 Basic Rules works for spells (49 level 1). Get_spell "Shield" labels it "Player's Handbook (2024)". `ddb_read_book({book_slug:"dnd/br-2024"})` TOC lists "Feats" (Origin, General, Fighting Style, Epic Boon) and "Spell Descriptions", so the book has both. | answers the question |
| F25 | 🟠 Med | confirmed | `ddb_get_monster` for a name that matches nothing returns D&D Beyond's closest hit as if it were the answer, with no "not found" line | `ddb_get_monster`; start `src/tools/monster.ts` | "Stat block for Glorbulon the Unseen Squid-King" `ddb_get_monster({name:"Glorbulon the Unseen Squid-King"})` → "# Living Unseen Servant / Rules: 2014 · Waterdeep: Dungeon of the Mad Mage". Search for an unknown name says "No monster names match … Closest matches" (honest); get gives no such note. The description's "D&D Beyond's closest hit" rule is meant for partial names (by design for ambiguous), not for names with no match (matrix not-found: "not found", near matches). | honest about limits |
| F26 | 🟠 Med | confirmed | Encounter and treasure tools accept an invalid CR (2.5) and silently treat it as CR 2 | `ddb_rate_encounter`, `ddb_roll_treasure`; start `src/tools/encounter.ts`, `src/tools/treasure.ts` | `ddb_rate_encounter({party:[{count:4,level:5}],monsters:[{cr:2.5}]})` → "1 × CR 2.5 creature (CR 2.5, 450 XP)" (450 = CR 2). `ddb_roll_treasure({cr:2.5,treasure_type:"individual"})` → "CR 2.5 ×1 — 1 roll on tier 0-4". The tool's own schema text says "CR as a decimal — 0.125, 0.25, 0.5, or 1–30"; `ddb_search_monsters({cr:2.5})` refuses "Unknown CR \"2.5\". Valid CRs: …". | correct |
| F27 | 🟠 Med | confirmed | `ddb_read_book` on an unowned book: by slug returns the store's marketing page as book text; by title says the book doesn't exist | `ddb_read_book`; start `src/tools/library.ts` | `ddb_read_book({book_slug:"dnd/phb-2024",chapter_slug:"playing-the-game"})` → "Rules: 2024 · Player's Handbook (2024)" then "Price $59.99 … Add to Cart…" inside the content block. `ddb_read_book({book_slug:"Player's Handbook"})` → "No book found matching \"Player's Handbook\"" + owned list. Expected: a plain "you don't own this book" (matrix locked). | honest about limits |
| F29 | 🟠 Med | confirmed (cause suspected) | `ddb_login` says "Already logged in" and saves a session that can't be used | `ddb_login`; start `src/auth.ts` (`checkLoggedInOnCurrentPage`), `src/browser.ts` (`buildContextOptions`) | Logged out (session file deleted by `ddb_logout`), `ddb_login` → "Already logged in. Session is active. … Session saved to disk", with no window to sign in; then `ddb_list_characters` → "Failed to list characters: cobalt-token response has no token" (twice). The login context had no stored cookies (`buildContextOptions` loads `session.json` only if it exists), so the page was anonymous. Suspected: `checkLoggedInOnCurrentPage` returns true when it finds no "Sign In"/"Log In" button, which can happen before the header renders (the header wait's failure is ignored after 5 s), and then saves the anonymous cookies. | honest about limits |
| F1 | 🟡 Low | confirmed | Inventory list joins items with ", " while D&D Beyond item names contain commas, so one item reads as two | `ddb_get_character` inventory; start `src/tools/character/inventory.ts` | "What's in my pack?" `ddb_get_character({character_id:"107606626",sections:"inventory"})` → "Backpack, Clothes, Common, Bedroll, … Rope, Hempen (50 feet), Tinderbox". "Clothes, Common" and "Rope, Hempen (50 feet)" are single items (same output's count suffix shows on 'Rope, Hempen (50 feet) ×4' for 39714283). Weapons are reordered ("Light Crossbow") by design but inventory is not. Also 107693030, 109960413. | answers the question / economical |
| F5 | 🟡 Low | confirmed | Tough feat description prints an unresolved placeholder "?" | `ddb_get_character` features/full; start `src/tools/character/features.ts` | Diana 133054584 features and Eric 133055442 full: "Tough: When you take this feat, your HP maximum increases by ?." Also `ddb_search_feats({name:"alert"})` → "add {{proficiency#signed}} to the roll" (unresolved DDB template). Expected the 2024 text "twice your character level" (or the computed +2 at level 1). | correct / economical |
| F7 | 🟡 Low | confirmed | Weapon proficiencies D&D Beyond files as weapons (Weighted Chain, Bola, Firearms) are listed under Tools | `ddb_get_character` summary; start `src/tools/character/stats.ts` | Sheila 133059215 summary: "Tools: Thieves' Tools, Weighted Chain, Bola, Carpenter's Tools"; same on 152570675. Source: character JSON proficiency modifiers `weighted-chain` and `bola` carry entityTypeId 1782728300, the same as `rapier`/`scimitar`/`shortsword` (weapons); `thieves-tools` is 2103445194. Vi 145415789: "Tools: … Firearms …"; JSON `firearms` proficiency has entityTypeId 660121713, same as `simple-weapons`. | correct |
| F8 | 🟡 Low | confirmed | Bardic Inspiration's maximum prints as "+3 (stat)" instead of a number | `ddb_get_character` combat; start `src/tools/character/actions.ts` (LIMITED USE) | "How many Bardic Inspirations do I have left?" BillytheBard 40080729 combat → "Bardic Inspiration   1 used / +3 (stat) max   (Long Rest)"; Lysander 162797600 → "0 used / +3 (stat) max"; also Ael Varris 166265317, Ehsu 42519628 "Hunter’s Sense 0 used / +3 (stat) max", Vi 145415789 "Magical Tinkering … +4 (stat)", "Flash of Genius … +4 (stat)", Calderax 14814039 "Eyes of the Grave … +5 (stat)", "Sentinel at Death’s Door … +5 (stat)". Expected "3 max" (CHA +3, same output's ability scores). | answers the question / economical |
| F10 | 🟡 Low | confirmed | An equipped, attuned non-armour item is listed under INVENTORY, not EQUIPPED; ATTUNEMENT gives a count but no names | `ddb_get_character` inventory; start `src/tools/character/inventory.ts` | "What am I holding / attuned to?" Also Rustle 112316571 attuned Cloak of Elvenkind under INVENTORY. Orion 152720684 inventory → "EQUIPPED Shield (AC 2), Chain Shirt (AC 13)" and "INVENTORY Staff of the Woodlands [2014], …", "ATTUNEMENT: 1/3 slots used". Source: character JSON Staff of the Woodlands `equipped: true, isAttuned: true` (its +2 spell attack is applied: Spell Attack +8). | answers the question |
| F15 | 🟡 Low | confirmed | SRD rules text leaks Open5e markup | `ddb_get_rules`; start `src/tools/reference.ts`, `src/open5e.ts` | `ddb_get_rules({name:"Damage and Healing",rules_edition:"2014"})` → "a blast of flame from a srd:fireball spell", "modifier---the same modifier", "**more** **than on"; 2024 Cover → "a creature that gives HalfCover and a tree trunk that gives Three-Quarters Cover". | economical |
| F16 | 🟡 Low | confirmed | `ddb_search_rules` (SRD 5.1) matches inside words, so "cover" returns 16 chapters | `ddb_search_rules`; start `src/tools/reference.ts` | "cover rules, 2014" → 16 chapters incl. Pantheons, Diseases, Madness, Expenses; `ddb_get_rules({name:"Pantheons",rules_edition:"2014",query:"cover"})` lands on "olive-covered hillsides". 2024 search for "cover" returns 2. | economical |
| F19 | 🟡 Low | suspected | Empty catalog searches while logged in are labelled "(SRD only)" | `ddb_search_equipment`/`races`/`classes`/`backgrounds`/`feats`; start `src/tools/edition-search.ts` | Logged in: search_equipment "quantum spork" → "No items found matching the criteria (SRD only)."; races "snorklewump", classes "chronomancer", backgrounds "astronaut", feats "zorbulate" → "… (SRD only)". Non-empty searches carry no such note. Can't tell whether DDB was searched; the label suggests it wasn't. | honest about limits |
| F24 | 🟡 Low | confirmed | `ddb_get_spell` partial name picks silently | `ddb_get_spell`; start `src/tools/reference.ts` | "Cure" → full Cure Wounds with no note that Mass Cure Wounds also matches. Matrix: choices or a stated pick. | answers the question |
| F20 | ⚪ Nit | confirmed | Catalog snippets run headings and fields together after HTML stripping | `ddb_search_races`/`classes`/`backgrounds`; start `src/tools/reference.ts` | races: "Dwarf TraitsDarkvisio…", "Elf TraitsDarkvision"; classes 2014: "Hit Die: d10Primary Ability: Dexterity & WisdomSaves: Streng…"; backgrounds: "Ability Scores: Intelligence, Wisdom, CharismaFeat: Magic Initiate (Cleric)Skill Proficiencies…". | economical |
| F23 | ⚪ Nit | confirmed | `source: "phb-2024"` feat list repeats "Ability Score Improvement" five times | `ddb_search_feats`; start `src/tools/reference.ts` | `ddb_search_feats({source:"phb-2024",limit:5})` → five "Ability Score Improvement [2024]" rows (one per class copy), total 36. | economical |

## Known open issues

| Code | Seen where |
|------|-----------|
| (bb) | Subclass always-prepared spells missing on every domain/oath/subclass caster checked: Shadowheart 107609898 (Trickery 1: no Charm Person, Disguise Self), Dwarf Cleric 109960799 (Life 1: no Bless, Cure Wounds — so Bless is also missing from `concentration`), Zayda 49128422 (Arcana 3), Elona 49053647 (Devotion 3), Sister Baronessa 39876541 (Trickery 9), Cathartic 112305147 (Life 9), Vi 145415789 (Artillerist 10), Calderax 14814039 (Grave 12). Wider than the one example in the list. |
| (bd) | Luck Points with no count (Sheila 133059215, 152570663); Stonecunning (152570649), Stone's Endurance (152579009), Draconic Cry (Spurt 145414075) absent from LIMITED USE. |
| (be) | Diana 133054584 BONUS ACTIONS "Unarmed Strike" / "Unarmed Strike (Dex.)" with no dice; Petit Nuage 40193614 Arms of the Astral Self and Deflect Missiles without dice; Flemin 112315775 Deflect Missiles. |
| (bj) | Zayda 49128422 "Spiritual Weapon (spell, 2nd-level slot)" with no numbers. |
| (ba) | Xarius 58640338: dndbeyond.com shows customised weapons ("_Rapier*", "xDagger*", "xDart*", "xSpear*", "Sun Blade (Rage Bonus)*"); the tool prints stock names. |
| (B14) read_book blank lines | `ddb_read_book` TOCs of basic-rules-2014 and br-2024 and the 2014 combat chapter: runs of 3–6 blank lines. |
| (B14) search_spells unowned-book wording | Related but different symptom filed as F17 (partial list presented as complete). |

## By design

- Content defaults to 2024 with a `Rules:` line and twin counts — seen on every catalog search.
- `source` wins over `rules_edition` with a note ("source \"xgte\" is a 2014 book — its entries are listed whatever rules_edition says").
- Disguised feats counted on the `Rules:` line and listed as "Dark Bargain [third-party]" (152570649, 152570663, 152570683, 152579009, 166265317 with three).
- User-written text wrapped (names, notes, custom languages, homebrew items and species, page scrapes, raw JSON, whole list/campaign replies); official content plain.
- Safety gates refuse first: interact click/fill, raw `confirm_large_response`, download paths (`/tmp/x.json`, `~/Downloads/../evil.json`), navigate off-site.
- Locked monsters show AC/HP as "—" with an ownership note (Beholder Zombie); locked class features marked "locked — not available to this account".
- Monster search caps at 50 with exact total and size ("50 shown of 226 … about 24 KB").
- `ddb_get_monster` "red dragon" picks Adult Red Dragon and names it; "Owlbare" (2014) → Owlbear.
- Encounter/treasure never guess: "Red Dragon" listed as ambiguous with CRs; "Dragon" counted as the exact third-party CR 4 match; unknown names listed with "supply cr".
- Treasure with `rules_edition: "2014"` rolls the 2024 tables, says so, uses 2014 CRs.
- Save advantages in D&D Beyond's wording ("against being charmed, and magic can't put you to sleep"; "Made to avoid or end the Charmed condition").
- Equipped weapons only in ACTIONS (Mori Yosei's Scimitar).
- Large Form hidden below level 5 (Goliath 152579009).
- Weapon mastery only with the Weapon Mastery feature (2014 characters show none).
- Weapon names "Light Crossbow"; attack and damaging save cantrips in ACTIONS; Green-Flame Blade row format (Ezra 127373542).
- Custom items wrapped and not counted (Orion 152720684 "Luna Heartstone, Ghost Step tattoo"); custom backgrounds show the borrowed one ("Criminal / Spy").
- `ddb_character_lookup` finds equipped items only ("Tinderbox" on Presto → not found).
- Name lookup searches only the account's characters ("Astarion" → clear "not found … try ddb_list_characters").

## Improvements

- `ddb_get_character` spells: racial cantrips ("From Racial Trait: Minor Illusion", Astarion 107164636) give no casting ability or DC.
- `ddb_get_character` spells: warlock slots print as plain "SPELL SLOTS Level 1: 1/1" (Wyll 107693030); naming Pact Magic / short-rest recovery would help.
- `ddb_get_character` combat: a non-proficient weapon row isn't flagged (Wyll's Rapier +1 is correct, but nothing says why it's low).
- `ddb_get_character` combat: Hank 133056493 lists "Hunter's Mark 1d6" and "Hunter's Mark (spell, 1st-level slot)" with different apostrophes — label the free Favored Enemy cast.
- `ddb_get_character` combat: BillytheBard 40080729 "Bardic Inspiration" bonus action has no die where Lysander's shows 1d6.
- `ddb_get_character` combat: Vi 145415789 "Eldritch Cannon: Flamethrower 0 used / 50 max (Rest)" (×3) — 50 is D&D Beyond's placeholder, not a real limit.
- `ddb_get_character` features/full: header "OTHER FEATURES (stored as feats in API but NOT player-chosen feats)" is implementation jargon; Weapon Mastery is also repeated under CLASS FEATURES (Eric 133055442).
- `ddb_get_character` concentration: item-cast spells list a slot level the character lacks ("Wall of Thorns [2014] [6th-level slot]", Orion 152720684 — cast with staff charges).
- `ddb_get_character` spells: duplicate-grant warning "Guiding Bolt (L1) — already granted by Class Feature, also in Class Feature" (Orion) is unclear.
- `ddb_get_character` spells: a caster with no spells or no slots yet shows only the header (Harry 17931478; Paladin 1 109967628) — say so.
- `ddb_get_character`: an unfinished sheet (all ability scores 0 → AC 5, initiative −5) is shown without an "incomplete character" note (<own character B>).
- `ddb_get_character` logged out by name: "No session found. Please run ddb_login first" — add that public characters work by numeric ID.
- `ddb_get_character_raw` description says "Requires login" and "300–500 KB"; it works logged out for public characters and returned 198 KB for a level 1 character.
- `ddb_search_spells` has no class filter ("3rd-level wizard concentration spells" returns paladin/cleric spells); `ddb_search_backgrounds` has no skill filter.
- `source` suggestions: "mpmm" suggests Monster Manual (2014); consider aliasing it to motm.
- `ddb_search_site` "Vorpal": the Monsters section offers "Avoral Guardinal" as a closest match — noise when the term names items.
- `ddb_get_rules` not-found gives no suggestions, only "Try ddb_search_rules".
- `ddb_search_class_features`: names like "4: Weapon Mastery" keep a level prefix from the data.
- `ddb_get_campaign`: `"playerCount":0` with one character listed (<campaign 1>).
- `ddb_close_browser` with nothing open still says "Browser closed."
- `ddb_clear_cache({cache:"monsters"})` replies "Cleared: monsters" though it also clears the game config and Open5e creature data.
- `ddb_navigate` after `ddb_logout` fails even for a public sheet with "Session changed; the previous credentials were revoked" (retried once, same) — the message doesn't say what to do.
- `ddb_get_spell` / `ddb_get_equipment` not-found replies give no near matches (monster search does).

## Prompts for a coding assistant

```
Login: F30, F29

Symptom: after ddb_logout, the user can't sign back in. ddb_login's window closes within seconds and the tool reports "Login timed out"; earlier, ddb_login said "Already logged in" without a sign-in and saved a session that fails every account call.
Evidence:
- F30: three ddb_login calls → "Login failed: Login timed out. Please complete login in the browser window and try again." The windows closed after a few seconds (before the cookie banner was touched), then before typing, then partway through a Google sign-in; a fourth got through Google sign-in and 2FA, then went white and stayed white until it closed. The wait in src/auth.ts allows 180 s, and its catch turns any error into "Login timed out".
- F29: with no session.json, ddb_login → "Already logged in. Session is active. … Session saved to disk"; ddb_list_characters then fails with "cobalt-token response has no token" (twice). checkLoggedInOnCurrentPage falls back to "no Sign In/Log In button means logged in".
- Context: launchBrowser (src/browser.ts) runs the user's Chrome app via chromium.launch({ channel: "chrome" }) with a new, empty context for every login; nothing persists between attempts and the user's normal Chrome profile (where they are already signed in to D&D Beyond) is never used. Google sign-in in an automated browser with a throwaway profile is a likely reason the hand-back stalls on a white page (unverified).
- Options the contributor wants considered (choose with the owner, mind the session-lifecycle rules in CLAUDE.md): a persistent, ddb-mcp-owned login profile that keeps the Google/Wizards sign-in between attempts; or a way to reuse the user's existing Chrome sign-in to D&D Beyond (e.g. importing its dndbeyond.com cookies, or signing in through the user's normal Chrome) instead of a fresh automated profile. Check each against macOS, Windows and Linux, and against the rule that only dndbeyond.com cookies are kept.
Expected: the window stays open until the user finishes signing in (Google and Wizards ID flows included), or until the real timeout; a failure shows its actual cause; "Already logged in" only when D&D Beyond confirms it (for example a cobalt token can be fetched), and never saves an anonymous session.
Suggested starting point: src/auth.ts, src/browser.ts (beginLoginSession, endLoginSession, saveSession, buildContextOptions), src/session-state.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. This needs a live check: log out, then sign in with Google through ddb_login on macOS and Windows.
```

```
Character sheet — attack and damage bonuses: F3, F11, F12, F28

Symptom: Weapon rows ignore four sources of attack/damage bonus that D&D Beyond applies: the Archery fighting style (+2 to hit with ranged weapons), Dueling (+2 damage with a one-handed melee weapon), Pact of the Blade (proficiency with the pact weapon) and Firearms proficiency.
Evidence:
- F3 Archery: 109965870 "Longbow +5" vs dndbeyond.com "+7"; Therai 39712797 +4 (exp. +6); Aerin 68903271 +5 (exp. +7); Ehsu 42519628 longbows and Net +9 (exp. +11). Character JSON: options.class "Archery", class modifier type bonus / subType ranged-weapon-attacks / value 2.
- F28 Dueling: Ethelrede 112314883 "Giant Slayer Battleaxe … 1d8+5 (1d10+5 two-handed)", "Hellfire Battleaxe 1d8+4"; dndbeyond.com shows 1d8+7 / 1d10+5 and 1d8+6 / 1d10+4. Elona 49053647 Longsword + Shield "1d8+2", expected 1d8+4. JSON options.class "Dueling"; no modifier in the data — D&D Beyond computes it.
- F11 Pact weapon: Weslocke 112317699 "Shortsword, +1 +4 to hit 1d6+4"; dndbeyond.com "Pact Weapon +8 1d6+4". JSON characterValues {typeId: 28, value: true, valueId: <the Shortsword, +1 inventory id>}.
- F12 Firearms: Vi 145415789 "Pistol +2 to hit 1d10+2", expected +6. JSON class proficiency modifier subType "firearms" (entityTypeId 660121713, same as simple-weapons). Not checked on the site (navigation unavailable after logout).
Expected: the sheet's weapon rows match dndbeyond.com (source: the site for F3/F11/F28; PHB rules and the proficiency modifier for F12).
Suggested starting point: src/tools/character/weapons.ts, src/tools/character/actions.ts, src/tools/character/parse.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Character sheet — other rows and sections: F1, F5, F6, F7, F8, F10, F13

Symptom: several rows print data a user would misread.
Evidence:
- F6: Eric 133055442 "Heavy Crossbow … Ammunition, Heavy, Loading, Range, Two-Handed" has no mastery; JSON feat modifier weapon-mastery / push-heavy-crossbow "Push (Heavy Crossbow)". Dagger (Nick) and Longsword (Sap) work.
- F13: Ehsu 42519628 "Net +9 to hit +5 bludgeoning"; Net definition damage null, fixedDamage 0 — a net deals no damage.
- F8: LIMITED USE max prints "+3 (stat)" (Bardic Inspiration on 40080729, 162797600, 166265317; Hunter's Sense 42519628; Magical Tinkering, Flash of Genius on 145415789; Eyes of the Grave, Sentinel at Death's Door on 14814039) instead of the number.
- F5: Tough feat "your HP maximum increases by ?." (133054584, 133055442); also ddb_search_feats Alert "add {{proficiency#signed}} to the roll".
- F7: Tools lists weapon proficiencies: "Weighted Chain, Bola" (133059215, 152570675), "Firearms" (145415789); JSON entityTypeIds match weapons, not tools.
- F10: Orion 152720684 equipped + attuned Staff of the Woodlands listed under INVENTORY, not EQUIPPED; "ATTUNEMENT: 1/3 slots used" names nothing (also Rustle 112316571, Cloak of Elvenkind).
- F1: inventory joins items with ", " while names contain commas: "Backpack, Clothes, Common, Bedroll, … Rope, Hempen (50 feet)" (Karlach 107606626; many others).
Expected: mastery shown whenever the character has it for that weapon; no damage for a no-damage weapon; numeric maxima; resolved feat text; weapon proficiencies under Weapons; equipped/attuned items identifiable; an unambiguous item separator.
Suggested starting point: src/tools/character/weapons.ts, src/tools/character/actions.ts, src/tools/character/features.ts, src/tools/character/stats.ts, src/tools/character/inventory.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Character features, lookup and name matching: F2, F4, F9, F14

Symptom: chosen class options never appear; lookup misses names users type; lookup labels books wrongly; a shared partial name says "not found".
Evidence:
- F4: Lae'zel 107607297 features "Fighting Style (Fighter 1)" only; lookup "Great Weapon Fighting" → "No definition found … on this character". Weslocke 112317699 features "Eldritch Invocations (Warlock 2)", "Pact Boon (Warlock 3)"; lookup "Agonizing Blast" → not found. JSON options.class holds the choices (Great Weapon Fighting; Pact of the Blade, Eldritch Smite, Agonizing Blast, Beguiling Influence, Devil's Sight, Thirsting Blade; Archery on 109965870 / 39712797).
- F2: Wyll 107693030 "eldrich blast" and "Dark One's Blessing" (straight apostrophe) → not found, while "Eldritch Blast" and "Dark One’s Blessing" (curly) work; Shadowheart 107609898 "trickster blessing" → not found; Goliath 152579009 "stones endurance" → not found. The description promises fuzzy matching ("sheild" does work).
- F9: Aerin 68903271 "Dread Ambusher" → "Rules: 2014 · Basic Rules (2014)" though its data source is sourceId 27 (Xanathar's); Shadowheart "Blessing of the Trickster" → "Basic Rules (2014)" though sourceId 2 (PHB p.63). Flash of Genius (Vi) is labelled Tasha's correctly.
- F14: ddb_get_character({character_name:"Skamos"}) → "No character found" although two account characters end in "Skamos" (one is test character 155447750).
Expected: chosen options listed and lookup-able; apostrophe/typo-tolerant lookup that never claims a character lacks something it has; the entry's real book on the Rules line; ambiguous names list the candidates or state a pick.
Suggested starting point: src/tools/character/features.ts, src/tools/character/definition.ts, src/tools/character.ts, src/edition.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

```
Catalog lookups (spells, items, feats, species, classes, backgrounds): F17, F18, F19, F20, F21, F22, F23, F24

Symptom: locked content reads as "not found" or as a complete short list; the free 2024 Basic Rules can't be used as a source for spells or feats; a feat prerequisite search comes back empty; minor text and labelling issues.
Evidence:
- F18: ddb_get_spell "Synaptic Static" → "not found in the compendium"; ddb_get_equipment "Bloodwell Vial" → "not found" (both real, unowned). Class features say "locked — not available to this account".
- F17: ddb_search_spells({source:"xgte"}) → "(4 found)" with no note the book isn't owned.
- F22: ddb_search_spells({source:"br-2024"}) and ddb_search_feats({source:"br-2024"}) → "No … found … in D&D Beyond Basic Rules"; items with the same source work; the book's own TOC (ddb_read_book dnd/br-2024) lists Feats and Spell Descriptions. get_spell labels 2024 spells "Player's Handbook (2024)".
- F21: ddb_search_feats({prerequisite:"Strength 13"}) → "No feats found (SRD only). 1 2014 version hidden" logged in and logged out; Grappler exists on DDB (2024 prerequisite worded "Str or Dex 13+"), and the 2014 SRD Grappler matches but is hidden as a twin of a 2024 entry that didn't match the filter.
- F19 (suspected): empty searches while logged in say "(SRD only)" (equipment "quantum spork", races, classes, backgrounds, feats).
- F24: ddb_get_spell "Cure" → Cure Wounds with no note that Mass Cure Wounds also matches.
- F20: snippets "Dwarf TraitsDarkvisio…", "d10Primary Ability…", "CharismaFeat: Magic Initiate…".
- F23: ddb_search_feats({source:"phb-2024"}) lists "Ability Score Improvement" five times.
Expected: locked entries say they're locked (as monsters and class features do); a book's entries listed when it is a secondary source; twin hiding only when the shown twin matches the filters; honest scope labels; separators kept when stripping HTML; duplicates collapsed or distinguished.
Suggested starting point: src/tools/reference.ts, src/tools/edition-search.ts, src/source-filter.ts, src/tools/spell-store.ts, src/open5e.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Rules: F15, F16

Symptom: SRD rules text carries Open5e markup, and the SRD 5.1 search matches inside words.
Evidence: ddb_get_rules({name:"Damage and Healing",rules_edition:"2014"}) → "a srd:fireball spell", "modifier---the same", "**more** **than on"; 2024 Cover → "gives HalfCover". ddb_search_rules({query:"cover",rules_edition:"2014"}) → 16 chapters incl. Pantheons ("olive-covered"), Diseases, Madness; the 2024 search returns 2.
Expected: clean prose; whole-word (or word-start) matching like the monster search.
Suggested starting point: src/tools/reference.ts, src/open5e.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Monsters: F25

Symptom: ddb_get_monster for a name that matches nothing returns some other creature with no "not found" line.
Evidence: ddb_get_monster({name:"Glorbulon the Unseen Squid-King"}) → "# Living Unseen Servant" (Waterdeep: Dungeon of the Mad Mage). ddb_search_monsters handles the same case honestly ("No monster names match … Closest matches").
Expected: "not found" plus near matches, or a clear "no exact or partial match — closest is X" line (see "Discuss before building": the description currently promises "D&D Beyond's closest hit").
Suggested starting point: src/tools/monster.ts, src/tools/monster-service.ts, src/name-match.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Encounters and treasure: F26

Symptom: an invalid CR such as 2.5 is accepted and silently treated as CR 2.
Evidence: ddb_rate_encounter({party:[{count:4,level:5}],monsters:[{cr:2.5}]}) → "1 × CR 2.5 creature (CR 2.5, 450 XP)"; ddb_roll_treasure({cr:2.5,treasure_type:"individual"}) → "CR 2.5 ×1 — 1 roll on tier 0-4". ddb_search_monsters({cr:2.5}) refuses "Unknown CR \"2.5\". Valid CRs: 0, 0.125, 0.25, 0.5, 1–30."
Expected: the same refusal as the monster search (the encounter schema text already lists the valid values).
Suggested starting point: src/tools/encounter.ts, src/tools/treasure.ts, src/treasure-limits.ts, src/server.ts (schemas)

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

```
Library: F27

Symptom: reading an unowned book returns the store page as if it were the book, or says the book doesn't exist.
Evidence: ddb_read_book({book_slug:"dnd/phb-2024",chapter_slug:"playing-the-game"}) → "Rules: 2024 · Player's Handbook (2024)" followed by "Price $59.99 … Add to Cart". ddb_read_book({book_slug:"Player's Handbook"}) → "No book found matching \"Player's Handbook\"" plus the owned-books list.
Expected: a plain "you don't own this book" (coverage matrix, locked), with the owned list as a hint.
Suggested starting point: src/tools/library.ts

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs.
```

## Discuss before building

- **F19 (suspected): "(SRD only)" on empty logged-in searches.** I could see the label but not whether D&D Beyond was actually queried. If DDB was searched and Open5e was also tried, the label just needs rewording; if DDB wasn't searched, it's a real scope bug.
- **F25: `ddb_get_monster` closest-hit fallback.** The tool description deliberately promises "exact, then partial, then D&D Beyond's closest hit", and intended-behaviour covers the ambiguous case. A name with no exact or partial match falling through to an unrelated creature looks unintended, but the fix touches that documented rule — choose between "not found + near matches" and keeping the pick with an explicit "no match; closest is X" line.
- **F4: which chosen options to show.** Showing `options.class` choices (fighting styles, invocations, pact boon, favored enemy, natural explorer, metamagic, etc.) changes the size of `features`; decide whether they go under their parent feature, as their own entries, or both, and whether lookup should resolve them.
- **F10: what EQUIPPED means.** It currently lists armour and shields only; equipped non-weapon items (staffs, cloaks) fall under INVENTORY. Decide whether EQUIPPED should list every equipped item, or whether attuned items should simply be named on the ATTUNEMENT line.
- **Weapon mastery on 2014 sheets (owner ruling B6).** dndbeyond.com lists mastery properties in the property column for 2014 characters too (109965870: Greatsword "Graze", Longbow "Slow"). The ruling hides them without the Weapon Mastery feature. No change suggested; noted because the site differs.
- **(bb) breadth.** The known always-prepared-spells gap affected all 8 subclass casters checked, not just Calderax. Worth re-prioritising: Bless (Life Domain) also goes missing from `concentration`.

## Not covered

- Re-login after the logged-out pass did not succeed (F30), so the contributor ended the run logged out.
- Homebrew scenarios for spells, items, feats, classes, backgrounds, class features and monsters: the account has no homebrew of those kinds (each `source: "homebrew"` search returned the clear "No homebrew … found"); homebrew wrapping was verified on species and racial traits only.
- Locked/owned contrast for paid books: free account, so owned-book reading couldn't be verified (known (aa), (b) also untestable).
- F12 on dndbeyond.com: navigation to the sheet failed after logout; the finding rests on the character data.
- Spot-check spell attack/DC: compared only on Weslocke; the other three spot-check characters show no spell block on the sheet's default tab and clicking tabs is not allowed.
- Test-character table drift (not findings): Elf Wizard 109960413 no longer has Fire Bolt; Orion Skyborn 152720684 is now level 5.

## Files left behind

- `~/Downloads/eric-133055442.json` (from `ddb_download_character`)
- `~/Downloads/ddb-screenshot-1794406093847.png` (from `ddb_interact` screenshot)
- `~/ddb-mcp/ddb-mcp-regression-2026-11-11.md` (this report; untracked, no need to commit)
