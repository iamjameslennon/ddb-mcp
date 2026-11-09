# Combat section completeness — design

Date: 2026-11-07. Covers regression-report items I1–I3 (docs/superpowers/specs/2026-11-06-regression-report.md) plus the missing action features found while measuring them. Status: owner decisions recorded 2026-11-07. Awaiting approval of the whole document.

**Owner decisions (2026-11-07):**
- List damaging save cantrips (unlike the website).
- List only damaging cantrips, not utility ones.
- Include the missing action features.
- Hide unchosen optional features everywhere (§4, match the website).
- Count equipped (and, when required, attuned) item bonuses to spell attack and save DC (§2.5), fixing the existing SPELLS lines too (option (a), after the adversarial review).

**Builder check:** opencode DeepSeek, 2026-11-07. Its questions were folded in as data-backed answers or as the author's calls marked below.

**Adversarial review 2:** opencode DeepSeek, 2026-11-09, of this spec and its plan. Each finding was checked against the code and the cached live JSON before it was folded in. Two were rejected: restricting §2.5 to item bonuses (D&D Beyond counts every active bonus), and a claimed contradiction between §2.3's scaling fallback and its several-modifiers fallback (they cover different shapes).

## Intent

Someone running a character's turn from `ddb_get_character` (`combat` or `full`) should see every choice the character has that turn without opening dndbeyond.com. The owner picked I1–I3 as the gaps most likely to matter, not because of a reported incident, so the aim is a complete turn view, not a single urgent fix.

The reference is the live D&D Beyond sheet. It was read on 2026-11-07 for Calderax 14814039, Weslocke 112317699, Ezra 127373542, Shadowheart 107609898 and Dunil 112305786. Where this design departs from the website, it says so.

## Measured impact (56 public test characters, JSON fetched 2026-11-07)

| Change | Characters affected |
|---|---|
| Save-advantage lines | 28 |
| Spell rows in ACTIONS (attack-roll spells + damaging save cantrips) | 29 (56 rows; 25 with attack spells, 12 with save cantrips) |
| Action features in ACTIONS (Channel Divinity, Lay on Hands, …) | 17 (26 before excluding weapon-mastery actions and unchosen features) |
| OTHER block (Special features) | 37 |
| Feature damage dice (Sneak Attack, Bardic Inspiration, …) | 22 |
| Off-hand (dual-wield) row in BONUS ACTIONS | 1 (Ezra) |
| Unarmed Strike row | 56 |
| Existing lines removed (unchosen optional features, §4) | 7 BONUS ACTIONS lines on 7 characters + 4 LIMITED USE lines on 4 of them |
| Existing SPELLS numbers corrected (item spell bonuses, §2.5) | 2: Orion 152720684 Spell Attack +6 → +8; Sister Baronessa 39876541 +8 / DC 16 → +9 / DC 17 |

## Goals

### 1. Save advantages (I1) — SAVING THROWS block

- Source: active modifiers with `type: "advantage"` (and `"disadvantage"`, by symmetry) whose `subType` is `saving-throws` (all saves) or `<ability>-saving-throws`.
- One line per distinct restriction text; mods with the same restriction are merged and their abilities listed together. The line is wrapped whole when **any** member's granting entity is homebrew; an entity that can't be resolved falls back to `bucketAnyHomebrew` for the modifier's bucket, as `getAllActions` does.
  - The fallback needs each modifier's bucket (`char.modifiers.<bucket>`), so read the modifiers per bucket. `core.allMods` flattens them and drops the bucket (`core.ts:53`). For example, Rustle's three Gnome Cunning mods (INT/WIS/CHA, "Against Magic") make one line.
- Format (builder may polish, keep the parts):
  - `  Advantage (all saves): against being charmed`
  - `  Advantage (CON): saving throws that you make to maintain Concentration.`
- Restriction text is trimmed. An empty restriction prints the granting entity's name instead: `  Advantage (INT, WIS, CHA): Gnome Cunning` (Vi 145415789). The granting entity is resolved by `componentId`/`componentTypeId`, as `grantingEntities` in `actions.ts` already does.
- Item modifiers count only when the item is active: equipped, and attuned when its definition requires attunement. Resolve the item by `componentId`/`componentTypeId` against `inventory` (they are the item's `definition.id`/`definition.entityTypeId`: 49 of 49 live item modifiers resolve).
  - A character can own several copies of one definition (Ezra's two `Dagger, +1`; 7 live item modifiers match more than one copy). The modifier counts when **any** matching copy is active.
  - `allMods` (`core.ts:53`) applies **no** equipped/attuned gating; it includes unequipped items' modifiers (builder check: Ethelrede's unequipped Battleaxe +1, Aerin's unequipped Slippers). So this gate is new and local to save advantages.
  - The existing global save bonus (`bonus saving-throws`, `stats.ts`) has the same gap. That is recorded as a carry-over, not fixed here (it would change existing numbers).
- The lines print wherever SAVING THROWS prints, so the cross-section consistency check (every `summary`/`combat` line also appears in `full`) holds.

### 2. ACTIONS rows

The order in the block:

1. **Equipped weapons**, unchanged.
2. **Unarmed Strike**, one row on every sheet, matching the website.
   - To-hit is STR + proficiency. Damage is 1 + STR bludgeoning, floored at 0: the website shows `0` for Weslocke (STR −1), `1` for Ezra (STR +0) and `2` for Calderax (STR +1). Range is `reach 5 ft.`.
   - Martial Arts (monks Flemin 112315775, Diana 133054584, Petit Nuage 40193614): the ACTIONS row uses the Martial Arts class feature's `levelScale.dice.diceString` (Flemin: `1d6`) and the better of STR/DEX for to-hit and damage. `levelScale` sits on the `classes[].classFeatures` wrapper, not on its `definition` (live Flemin: wrapper `1d6`, definition none). A modifier of 0 prints no suffix (`1d6`, not `1d6+0`).
     - D&D Beyond's own `Unarmed Strike` / `Unarmed Strike (Dex.)` actions on these characters are **bonus actions** (`activationType: 3`, `isMartialArts: true`, no dice): the Martial Arts bonus attack. They stay in BONUS ACTIONS as today and do not replace the ACTIONS row. (Corrected 2026-11-07 during planning from the live data.)
   - Features that change unarmed damage without such an action (the Unarmed Fighting style, Tavern Brawler) are not modelled. This is a known limitation, noted in tool-notes.
3. **Spell rows.**
   - Which spells:
     - every shown spell (class spells through the existing `isShownClassSpell` gate, plus every `char.spells.*` bucket; deduped by definition id as `getCharSpellsForActions` does) whose casting time is one action (`activation.activationType === 1`), and that either:
       - makes an attack roll (`definition.attackType` 1 melee / 2 ranged), cantrip or leveled; or
       - is a **cantrip** with a save (`saveDcAbilityId`) and a damage modifier (`definition.modifiers[].type === "damage"`).
     - **Departure from the website:** it omits save cantrips (Sacred Flame, Toll the Dead and Vicious Mockery are absent on Calderax and Shadowheart). Owner decision 2026-11-07: list damaging save cantrips, because a player asking "what can I do?" should see them as choices.
     - Utility cantrips (Light, Guidance, Mage Hand) and leveled save spells (Fireball) are **not** listed (owner decision 2026-11-07); they stay in SPELLS.
     - Bonus-action and reaction spells keep their existing BONUS ACTIONS / REACTIONS lines (builder's call to add numbers there; not required).
   - **Ability:**
     - Class spells use their class's spellcasting ability, exactly as SPELLS' `Spell Attack` / `Save DC` lines compute it. Share that computation so the two never disagree.
     - A class's ability is that of whichever definition (class, else subclass) has `canCastSpells === true`; Way of the Open Hand carries `spellCastingAbilityId: 5` with `canCastSpells: false` and must not count.
     - Non-class spells (`char.spells.race|feat|item|background|class`) use the entry's `spellCastingAbilityId`. Only a `spells.class` entry with a null one (Niko, Dwarf Cleric 152570649, Orion) falls back to the class's ability when the character has exactly one spellcasting class; any other null prints the row with no to-hit/DC rather than a guess.
     - An ability id of 0 counts as null, wherever it comes from (a class list on a class that can't cast resolves to 0). It never indexes `statMods`, so no `NaN` can print.
     - A spell that makes an attack roll **and** has a save (Ice Knife: `attackType 2`, `saveDcAbilityId 2`) shows both: `+N to hit / DC N DEX`.
   - **Damage:**
     - Cantrips: the damage modifier's `die`, replaced by the highest `atHigherLevels.higherLevelDefinitions[]` entry (typeId 15, `dice`) whose `level` ≤ total character level (`scaleType: "characterlevel"`).
     - Eldritch Blast style beams: spell-level `atHigherLevels.higherLevelDefinitions[]` with `details: "Beams"` (typeId 16, `value` = extra beams) gives the count. The website shows `1d10+4  Count: 2` for Weslocke L9.
     - Damage bonuses come only from modifiers D&D Beyond gives: Agonizing Blast is `type: "eldritch-blast"`, `subType: "bonus-damage"`, `statId: 6` (add that ability's modifier). Generalise on the data shape (a modifier whose `type` is the spell's slug and whose `subType` is `bonus-damage`), not on the invocation's name.
       - Class cantrip damage bonuses: a `bonus` modifier with `subType` `<class-slug>-cantrip-damage` and a `statId` adds that ability's modifier to that class's damaging cantrips (Calderax 14814039: `cleric-cantrip-damage`, statId 5, Potent Spellcasting: +5 on Toll the Dead, Sacred Flame and Word of Radiance). Found by the adversarial review; the website omits save cantrips, so no website read covers it.
     - The first non-empty `details` among the damage modifier's `higherLevelDefinitions` is shown as a short note, at every level (Toll the Dead: "The die type becomes a d12 if the target is missing any of its hit points.", so level-1 Niko gets it too).
     - Leveled spells: damage at the lowest slot the character casts them with. That is the spell's own level, with two exceptions:
       - An entry with a non-null `castAtLevel` is cast at that level (live: racial Hellish Rebuke and Charm Person at 2; neither gets an ACTIONS row today).
       - A Warlock class-list spell casts at the pact slot level (website: Weslocke's Witch Bolt `5d12`). When the character also has another spellcasting class, it can use a shared slot instead, so the cast level is the lower of the pact slot level and the lowest shared slot level ≥ the spell's level. No test character is a Warlock multiclass, so synthetic tests cover it.
       - The data supports this: `scaleType: "spellscale"` with a damage-modifier `higherLevelDefinitions` entry `{level: 1, typeId: 15, dice}` means "+dice per slot level above the spell's level". Witch Bolt is `1d12` + `1d12`/level, so 5d12 at a 5th-level pact slot. Guiding Bolt is `4d6` + `1d6`/level.
       - Any other scaling shape: print the base damage with the slot level stated, never a guessed figure.
     - Several damage modifiers:
       - Modifiers with the same dice and different types merge, with the types joined by "/" (Chromatic Orb: `3d8 acid/cold/fire/lightning/poison/thunder`; Sorcerous Burst likewise).
       - Different components are joined with " + " (Ice Knife: `1d10 piercing + 2d6 cold`).
       - A count from a spell-level `higherLevelDefinitions` entry (any `typeId 16` entry, with its `details` as the word, e.g. "Beams") or a modifier `restriction` such as "3 Rays" prints as `3 rays × 2d4 fire`. A count of 1 or less prints no prefix (Wyll, Warlock 1: `1d10 force`, not `1 beams × …`).
       - A shape that doesn't fit these rules prints the row without damage.
     - Range prints as `range N ft.`, `touch` or `self`, from `definition.range` / the entry's `range`. That is an object (`{ origin, rangeValue, aoeType, aoeValue }`; live origins `Ranged`, `Self`, `Touch`): `Ranged` with a positive `rangeValue` → `range N ft.`, `Touch` → `touch`, `Self` → `self`. Any other shape prints no range.
     - Spells with no base die but level-scaled bonus dice (Green-Flame Blade, Booming Blade): one row stating it is made with a melee weapon attack, plus the **first** damage modifier's bonus dice at the current level; later components (Green-Flame Blade's second `fire` modifier, restricted "To Second Target") are omitted. The website folds this into the weapon's notes instead; a separate row is our call.
   - Format, aligned with weapon rows:
     - `• Fire Bolt (cantrip)        +9 to hit   4d10 fire   range 120 ft.`
     - `• Sacred Flame (cantrip)     DC 17 DEX   3d8 radiant   range 60 ft.`
     - `• Eldritch Blast (cantrip)   +8 to hit   2 beams × 1d10+4 force   range 120 ft.`
     - `• Guiding Bolt (1st level)   +9 to hit   4d6 radiant   range 120 ft.`
   - Spell names go through `editions.named`, as the SPELLS section does, and a homebrew spell's row is wrapped whole (`shownHomebrew`). Action-feature and OTHER lines keep today's `actionLine` naming (`actions.ts:185`, no edition call), like the existing BONUS ACTIONS and REACTIONS lines.
4. **Action features**: visible (see 4 below) `char.actions` entries with `activationType === 1`, by name, in data order.
   - When the action passes the dice rule below, append its dice: `• Channel Divinity: Sear Undead   1d8`. Show what D&D Beyond's data says, as its website does.
     - This applies in **every** action list: ACTIONS, BONUS ACTIONS, REACTIONS and OTHER. So existing BONUS ACTIONS / REACTIONS lines gain dice, e.g. `• Bardic Inspiration   1d6`, `• Second Wind   1d10 + 1`, `• Hunter’s Mark   1d6`. These are additions only. (Corrected 2026-11-09: the third example was `• Deflect Missiles   1d10 + 9`, which the dice rule below excludes, since Deflect Missiles is `isMartialArts`; the code follows the rule.)
   - Weapon-mastery actions ("Vex (Shortsword)", "Nick (Dagger)") are excluded, because the weapon rows already show mastery.
     - They sit in the `feat` bucket, granted by the Weapon Mastery feat, and are named `<mastery> (<weapon>)`. Identify them by a name of that shape whose first word is in `MASTERY_NAMES` (`src/tools/weapon-mastery.ts`).
   - Uses are not repeated here. LIMITED USE shows them, except uses keyed to proficiency bonus (`useProficiencyBonus: true`, `maxUses: 0`), which `hasUses` filters out today (Luck Points ×2, Draconic Cry, Stonecunning, Stone's Endurance, Chef: Cook Treats on the 56). That is recorded as a carry-over, not fixed here.
   - **Dice rule (all lists):** append dice only when `displayAsAttack === true`, `dice.diceString` is non-empty, `abilityModifierStatId` is null and `isMartialArts !== true`. A `value` alone is never printed. This keeps Sneak Attack, Bardic Inspiration, Second Wind, Hunter's Mark, Favored Foe, Eldritch Smite, Sear Undead and Healing Hands. It drops the figures D&D Beyond's data gets wrong or leaves incomplete: monk Unarmed Strike `1`, Deflect Missiles `1d10 + 9` (no DEX), Arms of the Astral Self, Stone's Endurance (no CON), and the Eldritch Cannon entries.
   - Homebrew wrapping follows `getAllActions`.

### 2.5 Item bonuses to spell attack and save DC (owner decision 2026-11-07, option (a))

- `bonus` modifiers with `subType` `spell-attacks` add to every spell attack bonus; `spell-save-dc` adds to every spell save DC. Value is `value ?? fixedValue`.
- Every active bonus counts, whatever grants it, as on D&D Beyond. On the 56 test characters only item modifiers carry these subTypes (Orion, Sister Baronessa), so only those two sheets change.
- An item modifier counts only when its item is active: equipped, and attuned when the definition has `canAttune === true`. With several copies of the item, it counts when any copy is active. This is the same gate as §1, shared through one helper.
- It applies to the SPELLS `Spell Attack` / `Save DC` lines and to the new spell rows alike, because they share one computation.
- Live: Orion's Staff of the Woodlands (`bonus spell-attacks` +2) and Sister Baronessa's Amulet of the Devout +1 (`spell-attacks` +1, `spell-save-dc` +1), both equipped and attuned.

### 3. OTHER block (new) and the off-hand row (I3)

- **OTHER**: visible `char.actions` entries with `activationType === 8` (Special), with dice when `displayAsAttack` (`• Sneak Attack   5d6`, Dunil L9). It goes after REACTIONS and before LIMITED USE, and is omitted when empty, like LIMITED USE.
  - Sneak Attack dice come precomputed in the action's `dice` (`3d6` for Ezra L5). Never compute class-feature dice by hand.
- **Off-hand row**: an equipped weapon with `characterValues` `typeId: 18`, `value: true`, keyed to the inventory id (`valueId`), is a dual-wield off-hand weapon.
  - It gets a row in BONUS ACTIONS with the weapon-row format and damage without a positive ability modifier (a negative one still applies). The ability modifier is added back when the character has the Two-Weapon Fighting fighting style.
  - Only the ability part changes. Everything else in the main-hand row stays: the magic bonus, granted extra dice with their restrictions (Flame Tongue), a replaced damage type, and the versatile die.
  - Website reference: Ezra's `Dagger, +1` off-hand reads `+9  1d4+1`.
  - The off-hand weapon **leaves ACTIONS** and appears only in BONUS ACTIONS, as on the website. Only an equipped item with the flag counts.
    - Ezra's current `×2 Dagger, +1` row splits: one `Dagger, +1` in ACTIONS (the main hand, id 700136091, flag `false`), and the off-hand (id 693410702) in BONUS ACTIONS.
    - The consolidation key must keep the two apart.
  - Two-Weapon Fighting style detection: an `options.*` entry or a `feats` entry whose definition name is "Two-Weapon Fighting". 2014 stores fighting styles as `options.class` (Ethelrede: "Dueling"); 2024 stores them as feats (Eric: "Defense"). No test character has it, so a synthetic fixture covers it.
- The general Two-Weapon Fighting rule is **not** listed; the website shows it on every sheet, so it carries no character-specific information.

### 4. Action visibility (affects existing output — owner decision 2026-11-07: match the website)

D&D Beyond ships actions for features the character doesn't have. The website hides them; we show some today.

- **Rule:** an action in the `class` bucket whose `componentTypeId` is 12168134 (class feature) is shown only when its `componentId` is one of the character's class features at or below that class's level, or appears in `char.optionalClassFeatures[].classFeatureId` (a chosen Tasha's optional feature).
  - The class features are read from both `classes[].classFeatures` (wrapped) and `subclassDefinition.classFeatures` (plain), through `featureDefinition`, as `core.ts:38-42` does. Live sheets repeat subclass features in the first, but a sheet with only the second shape must not lose its subclass actions.
  - `classes[].classFeatures` lists features up to level 20 (live Calderax, Ezra, Dunil), so the level check is load-bearing.
- An option-granted action (`componentTypeId` 258900837) in the `class` bucket is hidden too when its `options.*` record's owner is a class feature (`componentTypeId` 12168134) that isn't visible. Ehsu 42519628 has Natural Explorer, not Deft Explorer, yet D&D Beyond ships "Deft Explorer: Tireless" (activation 1) and "… (exhaustion)" (activation 8) through the Tireless option, owned by class feature 3035679; found by the adversarial review.
- Other buckets keep today's behaviour, even for an action whose `componentTypeId` is a class feature (none on the 56 today).
- **Evidence:**
  - Calderax's "Initiate a Circle Spell" (component 12373777, no such feature) is hidden on the website.
  - Ezra chose Steady Aim (`optionalClassFeatures: [3035892]`) and the website shows it.
  - Dunil did not choose it, and the website doesn't show it.
- The rule applies to every list built from actions, LIMITED USE included: a hidden action shows nowhere.
- **Effect on today's output:** removes 4 existing LIMITED USE lines (`Harness Divine Power   0 used / N max`) on Cathartic, Sister Baronessa, Elona Silverflame and Zayda Snaketooth. It also removes 7 existing BONUS ACTIONS lines: Steady Aim (Dunil, Laena), Harness Divine Power (Cathartic, Sister Baronessa, Elona Silverflame, Zayda Snaketooth), Nature's Veil (Ehsu Ferncraig). It also stops the new ACTIONS/OTHER lists from picking up Quickened Healing, Ki-Fueled Attack, Focused Aim, Favored Foe, Blessed Strikes, Cantrip Formulas and Magical Inspiration on characters that didn't choose them.
- It subsumes the name-based Circle Spell filter at `actions.ts:138`. Keep that filter only if removing it changes any output.

## Non-goals

- Feature descriptions in the combat block (names and numbers only; `ddb_character_lookup` has the text).
- The website's generic "Actions in Combat" list (Dash, Dodge, …) and its "Attacks per Action" header.
- Upcast damage tables for leveled spells.
- Custom item names (`characterValues` typeId 8, e.g. "Drake's Tooth Dagger"; 6 of 56 characters). The sheet never applies them today; this is separate work.
- Subclass always-prepared spells (Calderax's Grave domain Vampiric Touch). They are not in the character JSON, so the sheet doesn't list them anywhere today; this is separate work.
- Any change to existing numbers (HP, AC, saves, skills, weapon rows), except the spell attack/DC correction in §2.5.

## Anti-goals (a failure even if it "works")

- A wrong number. Every figure must come from D&D Beyond's data or a rule the sheet already uses; when the data can't support a number, print the row without it.
- Hand-coded class-feature maths (Sneak Attack, Potent Spellcasting, …) instead of D&D Beyond's data.
- Duplicate rows (two Unarmed Strikes, a spell listed twice, an off-hand weapon merged with its main-hand copy).
- Showing features the character didn't choose, or levels they haven't reached.
- Breaking untrusted wrapping, `Rules:`/edition tagging, or cross-section consistency.

## Constraints (repo rules that apply)

- Character tools take no `rules_edition`; entries are labelled by the sheet's main edition via `editions.named`.
- Untrusted text: homebrew-granted lines are wrapped whole (`wrapIfHomebrew`, `shownHomebrew`, `grantingEntities`). Official `isHomebrew: false` content stays plain, and tests check both.
- Tests first. Keep the live snapshot flow in `docs/character-refactor.md`. `npm run typecheck && npm run lint && npm test` green before every commit; commits go straight to `main`.
- Update `docs/claude/tool-notes.md` (parseCharacterData behaviour), `docs/character-refactor.md` if module boundaries move, the README sample if it shows the combat block, and `docs/claude/history.md` (I1–I3 closed, new carry-overs for custom names and subclass spells).
- Owner rulings already recorded stand (weapon-row rulings of 2026-11-06/07 in history.md).

## Verification

- Before/after diff of all 8 sections for all 56 characters in `testcharacters.md`. The only diffs are:
  - the additions above;
  - dice appended to existing action lines;
  - the 11 removed lines (§4);
  - Ezra's `×2 Dagger, +1` split (§3).

  No existing number changes. This is what regression-report item I4 automates; building that script first makes this check repeatable.
- Spot checks against the website reads of 2026-11-07:
  - Calderax: Guiding Bolt `+9`, Sear Undead `1d8`, Channel Divinity entries, no Initiate a Circle Spell, CON concentration advantage line.
  - Weslocke: Eldritch Blast `+8`, `2 beams × 1d10+4`; Witch Bolt `+8 5d12`; Create Pact Weapon.
  - Ezra: Sneak Attack `3d6` in OTHER; off-hand `Dagger, +1` `+9 1d4+1` in BONUS ACTIONS; Steady Aim kept; "against being frightened".
  - Shadowheart: Guiding Bolt `+5 4d6`; Inflict Wounds `+5 3d10`; Blessing of the Trickster; Sacred Flame present (our departure).
  - Dunil: Sneak Attack `5d6`; no Steady Aim.
- Unit tests with small synthetic fixtures for each rule, including homebrew wrapping of each new line type and an official line staying plain.

## Left to the builder

- Module placement: likely `actions.ts` (actions/OTHER/visibility), a new spell-attack helper shared with `spells.ts`, and `stats.ts` (save advantages).
- Exact column padding, and whether bonus-action attack spells also get numbers.
- How weapon-mastery actions are identified in the data.
- Wording of the Green-Flame Blade row.
