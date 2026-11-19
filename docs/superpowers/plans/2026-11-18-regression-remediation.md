# Regression Remediation (2026-11-18 run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding of the 2026-11-18 regression run (F1–F10), plus F11 confirmed from the report's suspicions, under the owner rulings below, without changing any earlier ruled behaviour except where a ruling here says so.

**Architecture:** Each fix stays inside one module. The character-sheet fixes are in `src/tools/character/*`: ability scores in `core.ts`, weapon proficiency in `weapons.ts` + `stats.ts`, speed in `vitals.ts`, defenses in `defenses.ts`, feature rows and limited use in `actions.ts`, the features heading in `features.ts` + `inventory.ts`, and bundled item counts in `inventory.ts` (F11). F7 adds two generated id tables to `modifier-slugs.ts`. The catalog fixes are in `src/tools/reference.ts` (F4) and `src/tools/features-traits.ts` (F9). F3 adds a vendored SRD 5.1 patch, `src/srd51-rules.ts`, applied when the 2014 Open5e rulesets load in `src/open5e.ts`. Each task is TDD against hand-built fixtures in the live data shapes recorded below.

**Tech Stack:** TypeScript (ESM, Node ≥22), vitest, zod (tool schemas in `src/server.ts`).

**Spec:** `docs/superpowers/specs/2026-11-18-regression-report.md` (the run's report, committed in Setup), plus the owner rulings below. Read `CLAUDE.md`, `docs/claude/tool-notes.md`, `docs/claude/caching.md` (Task 8) and `docs/character-refactor.md` (regression layers) before starting.

## Owner rulings 2026-11-18 (to be recorded in `docs/claude/history.md` by the Setup commit)

- **R1 (F2): follow the site.** A proficiency modifier with a non-empty trimmed `restriction` does not make a weapon proficient. The proficiency line still names it, marked `(conditional, not applied)`, so the AI can tell a DM who allows it what changes. This **reverses the 2026-11-11 F12 fix**. That run expected +6 for Vi's Pistol without checking the site, and dndbeyond.com shows +2. Measured: one modifier in the 56-character corpus (Vi 145415789, `firearms`, "Optional rule at DM discretion"). Vi's Pistol goes from +6 to +2.
- **R2 (F5):** a feature row whose snippet reads "plus another `<die>` per level of the spell slot" appends ` + <die> per slot level` to its dice. Measured: one row (Weslocke 112317699 Eldritch Smite → `1d8 + 1d8 per slot level`). Divine Smite's 2014 wording ("for each spell level higher than 1st") doesn't match. It stays without dice under carry-over (be).
- **R3 (F3): vendor the missing SRD 5.1 text.** The Damage and Healing sections are copied verbatim from Open5e v1 (`wotc-srd`, the same SRD 5.1, CC-BY-4.0) into `src/srd51-rules.ts`, with attribution as in `conditions.ts`. They are applied only while upstream is still broken: a replacement only while the upstream section duplicates another section, an addition only while the section is absent.

## Investigation results the plan relies on (verified 2026-11-18 against the cached corpus, rule-data and Open5e)

- **F1:** `computeCoreStats` (`core.ts`, `statTotals`) adds `bonusStats` (D&D Beyond's "Other bonus") **inside** `Math.min(…, 20)`. Laena 26158232: DEX base 14 + race 2 + class 1×3 + feat 1 = 20, plus `bonusStats` +2 = 22 on the site. CON is base 14 + `bonusStats` 2 = 16, with an item `set constitution-score 19`, so 19. WIS is 13 + 2 + 1 = 16, under the cap either way. **Laena is the only corpus character with any non-zero `bonusStats`.**
- **F2:** Vi's modifier is `{type:"proficiency", subType:"firearms", restriction:"Optional rule at DM discretion"}`. `computeWeaponAttacks` builds `weaponProfSlugs` from every proficiency modifier and ignores `restriction`. The Weapons line comes from `stats.ts` (the `isProficiencyMod` loop, about line 373). It is the only restricted proficiency, expertise or half-proficiency modifier in the corpus.
- **F3:** Open5e v2 `rulesets?document__key=srd-2014` "Damage and Healing" (`srd_damage-and-healing`) has sections 1 Hit Points, 2 Damage Rolls, 3 Critical Hits, 5 Damage Types and 6 Damage Resistance and Vulnerability. The `desc` of Critical Hits is byte-identical to Damage Rolls (820 chars). No section of any 2014 ruleset contains the death-save rules. The recorded fixture `tests/fixtures/open5e-v2/srd-2014/rulesets.json` has the same shape. Open5e **v1** `https://api.open5e.com/v1/sections/damage-and-healing/` (`document__slug: "wotc-srd"`) has the full chapter. Its headings are `## Hit Points`, `## Damage Rolls`, `### Critical Hits`, `### Damage Types`, `## Damage Resistance and Vulnerability`, `## Healing`, `## Dropping to 0 Hit Points`, `### Instant Death`, `### Falling Unconscious`, `### Death Saving Throws`, `### Stabilizing a Creature`, `### Monsters and Death`, `## Knocking a Creature Out` and `## Temporary Hit Points`.
- **F4:** `ddb_logout` → `revokeSession()` sets `revoked = true` and bumps the generation. `loadSpellCompendium` (`reference.ts`) then captures an anonymous snapshot (reason `revoked`). Every per-class `refFetch` throws `NoSessionError`, which is caught and counted. Then `assertSessionCurrent(snapshot)` throws `SessionChangedError` **because `revoked` is true**, and `rethrowSessionChange` sends it to the user. With no session file and no logout, `revoked` is false, so the assert passes and the empty build falls back correctly. `loadClassFeatures` and `loadRacialTraits` follow the same catch-then-assert pattern (`fetchGameDataField`). `loadGameDataList` and the item compendium throw from `refFetch` before their assert, so they are not affected.
- **F5:** Weslocke's Eldritch Smite action has `dice.diceString "1d8"` (D&D Beyond's own) and the snippet "…an extra 1d8 force damage to the target, plus another 1d8 per level of the spell slot…". The only other slot-scaled snippets in the corpus are Divine Smite on Danyr and Elona (2014: "plus 1d8 for each spell level higher than 1st", `dice: null`).
- **F6:** Laena has race speeds swim 0 and climb 0, and Superior Mobility class `bonus` modifiers `speed-walking`, `speed-climbing` and `speed-swimming` 10. `speedCalc` (`vitals.ts`) returns `(override || base || fallback) + bonus`, so 0 + 10. Only Laena has `speed-{swimming,climbing,flying,burrowing}` bonus modifiers on a zero base. Ehsu 42519628 and Aerin 68903271 have `set innate-speed-climbing` with a null value. That is a different, unreported shape, and out of scope.
- **F7:** `customDefenseAdjustments` entries are `{adjustmentId, source, type}`. `type: 2` means `adjustmentId` is a rule-data `damageAdjustments` id, whose own `type` is 1 resistance, 2 immunity or 3 vulnerability. `type: 1` means it is a rule-data `conditions` id, which is a condition immunity. Evidence: Laena `[{22, type 2}, {5, type 1}]` = Poison (immunity) and Frightened, which matches the site's "Frightened*" and "Poison*". Idhren 155829352 `[3, 51, 93]` all type 2 = Slashing, Ranged Attacks, "Extra damage caused by Sneak Attack and Critical Hits", all resistances (51 and 93 exist only as damage adjustments). Claude Skamos 155447750 `[{15, type 1, source:"Magic origin"}]` = Unconscious (to check on the site, Task 11). `source` is player-written. Rule-data (`character/v5/rule-data`, public) has 92 `damageAdjustments` and the 15 standard conditions (1 Blinded … 15 Unconscious). `scripts/dump-modifier-slugs.mts` already reads both tables.
- **F8:** rule-data `limitedUseResetTypes` is 1 Short Rest, 2 Long Rest, 3 Dawn, 4 Other (the site prints "Special"). `buildLimitedUseLines` and the item-charge lines map only 1 and 2, so everything else becomes "Rest". Corpus: resetType 2 ×58, 1 ×16, 4 ×5 (Vi's three cannons, Magical Tinkering, Infuse Item), 3 ×0. The three Eldritch Cannon actions have `limitedUse {maxUses: 50, resetType: 4}`, and each snippet ends `<strong>Hit Points:</strong>`, where D&D Beyond appends the counter. No other corpus snippet ends that way.
- **F9:** in both `game-data/races` (live, 2026-11-18) and character JSON, the 2024 species' "Ability Score Increases" and "Languages" traits carry `displayConfiguration.RACIALTRAIT: 0`. Every other trait of those species has `1`. The only legacy trait with `RACIALTRAIT: 0` is "Extra Language" (2014 High Elf and others), a real 2014 trait. `hideInSheet` can't be the test: the 2014 "Languages" traits are hidden in the sheet but are real traits.
- **F10:** `formatFeaturesBlock` prints the literal heading `OTHER FEATURES (stored as feats in API but NOT player-chosen feats)`. Nine corpus characters have a `__DISGUISE_FEAT` "Weapon Mastery" that is also a shown class feature: Bobby 133053421, Eric 133055442, Hank 133056493, Sheila 133059215, Human Fighter 152570663, Halfling Rogue 152570675, Goliath Barbarian 152579009, Idhren 155829352 and Oskar 155830640. The heading change touches every character with a disguised feat (22). `formatInventoryBlock` ends with `CURRENCY: …` and no blank line, unlike every other block, so in `full` the notes line runs straight on.
- **F11 (the report's "suspected" Dunil item, confirmed from data):** D&D Beyond's inventory `quantity` counts pieces, and `definition.bundleSize` is the pieces per bundle. `computeInventory` prints `×quantity`, so a bundle whose **name** states its size reads as that many bundles: Dunil 112305786 `Ball Bearings (bag of 1,000) ×1000` (one bag, 2 lb). Corpus, items whose name ends `(… of N)` with N = `bundleSize`:
  - Dunil, bearings qty 1000 → one bag;
  - Xarius 58640338, bearings qty 1000 → one bag, and `Caltrops (bag of 20)` qty 100 → 5 bags;
  - Halfling Rogue 109963409, bearings qty 1 → one bearing, part of a bag.
  Items named per piece (`Arrows`, `Crossbow Bolts`, `Stake (Wooden)`, 2024 `Ball Bearings`) are counted in pieces already and don't change. Task 7 Step 0 checks the pieces reading on the site before any code changes.

## The report's other suspicions (investigated 2026-11-18, no task)

- **Laena's "Shield" proficiency: not a finding.** Laena, a 2014 Rogue 20, has only a `light-armor` proficiency (class feature 467). Nothing in her JSON grants a shield proficiency: no modifier, item `grantedModifiers`, feat (Alert, Tough, Elven Accuracy), race (High Elf), background (Noble) or `customProficiencies`. She has an equipped, attuned Animated Shield (armorTypeId 4), and she is the only corpus character with a shield and no shield proficiency. So the site's entry is most likely drawn from the equipped shield, not from a proficiency. The tool follows the rules, and her AC already counts the shield. Record it in history.md as not a finding.
- **"Darts" under Tools: correct.** There are two different modifiers:
  - `dart`, entityTypeId 1782728300, is a weapon (Wizards, Druids…). It is listed under Weapons.
  - `darts`, entityTypeId 2103445194, entityId 570, is rule-data tool 570 "Darts", a **gaming set**. Goliath Barbarian 152579009 (Soldier) and Ael Varris 166265317 (Noble) chose it for their background's "Choose a Gaming Set". `Tools: Darts` is right.
  Close the 2026-11-13 suspicion in history.md.
- **Null-valued `set innate-speed-climbing` (raised in this plan's first draft): not a finding today.**
  - Ehsu 42519628's modifiers come from the Tasha's option Roving. Ehsu has `enableOptionalClassFeatures: false`, so the existing orphan-modifier rule (`vitals.ts`) skips them as the site does, and the tool's `40 ft., burrow 10 ft.` is right.
  - Aerin 68903271's come from unequipped Slippers of Spider Climbing.
  No corpus character has an active instance, but the shape points at two latent gaps, recorded as **carry-over (by)**, not fixed:
  1. A `set innate-speed-<axis>` with a null value means "equal to your walking speed" (Roving's text; the Slippers' `restriction` "Climbing Speed Equal to Walking Speed"), and `speedCalc` ignores it.
  2. An option's modifiers carry the **option's** id as `componentId`, not its parent feature's, so the orphan rule would drop Roving even with optional features on.
  A fix must gate item modifiers on `isActiveItemMod`, or Aerin's unequipped slippers would grant a climb speed.
- **Sister Baronessa's Turn Undead DC (the report's "not a finding"):** it matches the site. No change.

## Global Constraints

- Run `npm run typecheck && npm run lint && npm test` before every commit, and get all three green.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to `main` (owner's standing rule) but **do not push** unless the owner asks.
- Earlier owner rulings stand (CLAUDE.md "Owner rulings are recorded with dates"), except the 2026-11-11 F12 behaviour that R1 reverses:
  - R2/R3 of 2026-11-13 (snippet dice, snippet DC);
  - carry-over (be);
  - the 20 cap for ASI sources (Calderax).
- **Untrusted text:** no new output line may print player-written text unwrapped. F7 never prints `source`, and F2 prints a fixed label, not the `restriction` text. Official content stays plain, and the tests assert both.
- No tool builds edition label text itself. Every `Rules:` line comes from `src/edition.ts`.
- Snapshot updates (`tests/__snapshots__`) are deliberate. Run `npx vitest run tests/character-snapshot.test.ts -u` only in the task that changes that output, and read the diff before committing.
- **Regression skill sync** (CLAUDE.md), **in the same commit** as the change:
  - `skills/ddb-mcp-regression/references/intended-behaviour.md`: R1 (Task 2), R2 (Task 5), the player-set defenses (Task 4), the 2014 Damage and Healing source (Task 10).
  - `coverage-matrix.md`: the `ddb_get_spell` / `ddb_search_spells` logged-out rows say "also after `ddb_logout`" (Task 8).
  - `known-open-issues.md`: carry-over (by) opened (Task 11).
  - A plain bug fix that restores the intended reply (F1, F6, F8, F9, F10, F11) needs no reference change. Its reviewer confirms that no reference line contradicts the new output.
- **Character-sheet changes:** Setup captures the live baseline. Task 11 diffs against it and runs the whole-corpus script. Every difference must be one this plan intends.

## Review Focus

1. **F4, account mixing:** the not-logged-in early exit must not weaken the session guard. A logged-in build that sees the account change mid-build still rejects with `SessionChangedError` (the existing `tests/catalog-session-change.test.ts` must stay green unchanged). After `ddb_logout` and then `ddb_login`, a lookup builds from D&D Beyond again, with no stale fallback cached. (Task 8 tests.)
2. **F1 ordering with set scores and overrides:** `overrideStats` still wins outright and ignores `bonusStats`. An item `set` score still wins when higher (Laena's CON stays 19). A negative "Other bonus" lowers a capped score (20 − 2 = 18). (Task 1 tests.)
3. **F3 when upstream is fixed:** if Open5e corrects Critical Hits or adds the missing sections, upstream text wins and nothing is listed twice. A 2024 ruleset is never patched. (Task 10 tests.)
4. **F7 duplicates and stale ids:** a custom entry that names a defense a modifier already grants prints once, plain. An unknown `adjustmentId` or `type` prints nothing. `source` text never appears. (Task 4 tests.)
5. **F2 mixed grants:** a restricted and an unrestricted grant of the same proficiency print as one plain entry and give proficiency. Whitespace-only `restriction` counts as unrestricted. (Task 2 tests.)

## Plan review 2026-11-19

Three outside reviews were requested. Every claim was checked against the code.

- **Codex** (gpt-6-luna, read-only repo access): 4 findings, all accepted:
  - Task 10 tests the report's exact `max_chars: 6500` + query call.
  - Task 9 gates on `isLegacy === false`.
  - Task 2 tests a tool proficiency.
  - Task 8 says that only spells have an Open5e path.
- **DeepSeek:** Zen's free quota was used up, so it ran through the router's `auto:reviewers`. Both Gemini models returned 503, so it reached the **paid** Mistral DeepSeek V4.1 Flash. 12 findings.
  - Accepted:
    - Task 1: an explicit override expression, plus a below-the-cap test.
    - Task 2: the conditional label for armor and tools, merged after the loop and independent of order.
    - Task 3: a zero set speed test.
    - Task 4: the type of id 51 asserted, and duplicates checked by bare name.
    - Task 5: both local reset maps deleted.
    - Task 6: the name set built from definitions, plus a chosen-option test.
    - Task 8: the check moved directly after `captureSession()`, and the re-login test uses `invalidateSessionCache()`.
    - Task 10: appended sections deduped by name as well as key.
  - Rejected after checking:
    - "Task 1's override test would fail": `??` binds looser than `+`, so the override wins. The expression was still made explicit.
    - "A stale spell singleton survives a logout": `revokeSession` fires the hook that runs `clearReferenceCache()` and nulls `spellStore` (`reference.ts:226`).
    - Different `bundleSize`s merged under one name: no such data.
    - The `$TMPDIR` worktree: it is outside the repo.
- **Cursor** (grok-4.7-medium): the free plan's usage limit was reached and no review ran. Not retried.

---

## Setup (one commit, before Task 1)

- [ ] Record R1–R3 (dated 2026-11-18) and the investigation results above under a new "Regression remediation 2026-11-18" heading in `docs/claude/history.md`. Under the 2026-11-11 F12 entry, add "reversed by owner ruling R1 2026-11-18". Add the verdicts from "The report's other suspicions" and open carry-over (by).
- [ ] Commit the report with this plan: `git add docs/superpowers/specs/2026-11-18-regression-report.md docs/superpowers/plans/2026-11-18-regression-remediation.md docs/claude/history.md && git commit -m "docs: 2026-11-18 regression report, owner rulings and remediation plan"`.
- [ ] Capture the live baseline: `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/before.txt"`. If no session is saved, ask the owner to run `ddb_login`.
- [ ] Build a baseline `dist/` for Task 11: `git worktree add "$TMPDIR/ddb-base" HEAD && (cd "$TMPDIR/ddb-base" && npm ci && npm run build)`.

---

### Task 1: "Other bonus" applies after the 20 cap (F1)

**Files:**
- Modify: `src/tools/character/core.ts` (`statTotals`), `docs/claude/tool-notes.md` (ability scores)
- Test: `tests/character-parser.test.ts` (extend the "Ability scores capped at 20" block, about line 1121)

**Interfaces:** none new; `CoreStats.statTotals` keeps its shape.

- [ ] **Step 1: Write the failing tests.**

```ts
it("adds the Other bonus (bonusStats) after the cap (Laena shape)")
  // stats DEX 14; race bonus dexterity-score 2 (isGranted true); class dexterity-score 1 ×3; feat 1;
  // bonusStats [{id:2, value:2}] → summary has "DEX 22 (+6)"
it("a higher set score still wins over base + Other bonus")
  // CON base 14, bonusStats {id:3, value:2}, item set constitution-score 19 → "CON 19 (+4)"
it("a negative Other bonus lowers a capped score")
  // STR base 18 + class 1 ×3, bonusStats {id:1, value:-2} → "STR 18 (+4)"
it("an override ignores the Other bonus")
  // overrideStats {id:2, value:15}, bonusStats {id:2, value:2} → "DEX 15 (+2)"
it("an Other bonus below the cap adds in full")
  // DEX base 14, bonusStats {id:2, value:2}, no other bonuses → "DEX 16 (+3)"
```

- [ ] **Step 2: Run them.** `npx vitest run tests/character-parser.test.ts -t "Other bonus|override ignores"`. Expected: the Laena and negative-bonus cases FAIL (20 and 19). The other two pass.
- [ ] **Step 3: Implement.** In `statTotals`: `calculated = overrideVal != null ? overrideVal : Math.min(baseVal + (scoreBonuses[id] ?? 0), ABILITY_SCORE_CAP) + bonusVal`, then the existing `set` maximum. (`bonusStats` is not in `char.modifiers`, so it never reaches `scoreBonuses`.) Rewrite the cap comment to say that the Other bonus applies after the cap, as dndbeyond.com shows Laena (2026-11-18).
- [ ] **Step 4: Run the file.** `npx vitest run tests/character-parser.test.ts`. Expected: PASS, including the Calderax cap test.
- [ ] **Step 5: Docs and commit.** Add one line to the ability-score notes in tool-notes.md. Run the three checks, then `git commit -m "fix(character): Other bonus applies after the 20 cap (F1)"`.

---

### Task 2: A conditional proficiency is not applied (F2, R1)

**Files:**
- Modify: `src/tools/character/helpers.ts`, `src/tools/character/weapons.ts` (`weaponProfSlugs`), `src/tools/character/stats.ts` (proficiency lists), `docs/claude/tool-notes.md` (Firearms paragraph), `skills/ddb-mcp-regression/references/intended-behaviour.md`
- Test: `tests/combat-weapon-bonuses.test.ts` (rewrite the Firearms case), `tests/character-parser.test.ts` (proficiency line)

**Interfaces:**
- Produces: `export const isConditionalMod = (m: Mod): boolean` in `helpers.ts`, true when `typeof m.restriction === "string" && m.restriction.trim() !== ""`. Also `export const CONDITIONAL_PROFICIENCY_NOTE = "(conditional, not applied)"` in `stats.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
// combat-weapon-bonuses.test.ts, replacing "applies Firearms proficiency…"
it("a restricted Firearms proficiency doesn't apply (Vi shape, owner ruling R1)")
  // {type:"proficiency", subType:"firearms", restriction:"Optional rule at DM discretion"}; Pistol categoryId 2,
  // properties [{name:"Ammunition (Firearms)"}], attackType 2, 1d10 → to hit = dexMod (no prof)
it("an unrestricted or whitespace-restricted Firearms proficiency applies")   // restriction "" and "  " → dexMod + prof
it("a restricted and an unrestricted grant of one proficiency apply")         // both mods → dexMod + prof

// character-parser.test.ts
it("lists a restricted proficiency as conditional")
  // summary Weapons line contains "Firearms (conditional, not applied)"; not "Optional rule"
it("a restricted and an unrestricted grant list one plain entry")
  // the restricted modifier comes FIRST in allMods → "Firearms", once, no note
it("marks a restricted tool or armor proficiency as conditional")
  // thieves-tools with restriction "x" → "Thieves' Tools (conditional, not applied)"; light-armor with restriction → "Light Armor (conditional, not applied)";
  // an unrestricted thieves-tools grant as well → plain "Thieves' Tools"
```

- [ ] **Step 2: Run them.** Expected: the restricted cases FAIL.
- [ ] **Step 3: Implement.** In `weapons.ts`, `weaponProfSlugs` takes only proficiency modifiers with `!isConditionalMod(m)`. In `stats.ts` `computeProficiencies`, collect the names from conditional modifiers (armor, weapon and tool) in a separate set during the loop. After the loop, append `<name> ${CONDITIONAL_PROFICIENCY_NOTE}` to the right list only for names that no unconditional modifier listed, so the order of `allMods` doesn't matter. Skills and saves are unchanged (the corpus has no restricted ones). Armor proficiency drives no number, so armor is only labelled.
- [ ] **Step 4: Run the two files.** Expected: PASS.
- [ ] **Step 5: Docs and commit.** Rewrite the tool-notes **Firearms** sentence: a proficiency modifier with a restriction never applies (R1, reverses 2026-11-11 F12). Add an intended-behaviour entry: "Conditional proficiencies are listed but not applied". Then `git commit -m "fix(character): conditional proficiencies are listed, not applied (F2, owner ruling R1)"`.

---

### Task 3: Speed bonuses raise only speeds the character has (F6)

**Files:**
- Modify: `src/tools/character/vitals.ts` (`speedCalc`), `docs/claude/tool-notes.md` (speed)
- Test: `tests/character-parser.test.ts` (next to the speed subType tests, about line 1473)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.**

```ts
it("a speed-climbing/-swimming bonus adds nothing without that speed (Laena shape)")
  // race weightSpeeds walk 30, swim 0, climb 0; class bonus speed-walking/-climbing/-swimming 10 → "Speed: 40 ft." exactly
it("the same bonus raises a race speed")        // race climb 30 → "climb 40 ft."
it("the same bonus raises a set speed")         // set innate-speed-swimming 30 → "swim 40 ft."
it("an innate-speed bonus still grants")        // bonus innate-speed-flying 30 on base 0 → "fly 30 ft." (unchanged)
it("a zero set speed doesn't open the axis")     // set innate-speed-flying 0 + bonus speed-flying 10, base 0 → no "fly"
```

- [ ] **Step 2: Run them.** Expected: the Laena case FAILS. The others pass.
- [ ] **Step 3: Implement.** In `speedCalc`, for an axis other than walking, a `bonus` with subType `speed-${axis}` counts only when `override || base` is greater than 0. `innate-speed-${axis}` bonuses and the walking axis are unchanged.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Docs and commit.** Speed note in tool-notes ("Superior Mobility only raises speeds you have"), then `git commit -m "fix(character): speed bonuses raise only speeds the character has (F6)"`.

---

### Task 4: Player-set defenses (F7)

**Files:**
- Modify: `scripts/dump-modifier-slugs.mts`, `src/tools/character/modifier-slugs.ts` (regenerated, never hand-edited), `src/tools/character/defenses.ts`, `docs/claude/tool-notes.md` (defenses), `skills/ddb-mcp-regression/references/intended-behaviour.md`
- Test: new `tests/character-custom-defenses.test.ts`

**Interfaces:**
- Produces (generated in `modifier-slugs.ts`):
  - `export const DAMAGE_ADJUSTMENTS_BY_ID: Readonly<Record<number, { name: string; type: 1 | 2 | 3 }>>` (rule-data `damageAdjustments`: 1 resistance, 2 immunity, 3 vulnerability)
  - `export const CONDITION_NAMES_BY_ID: Readonly<Record<number, string>>` (rule-data `conditions[].definition`)
- Produces (in `defenses.ts`): `export const PLAYER_SET_NOTE = "(player-set)"`.

- [ ] **Step 1: Regenerate the tables.** Extend the generator to emit both maps, sorted by id. Run `npx tsx scripts/dump-modifier-slugs.mts` (needs a saved session; ask the owner for `ddb_login` if there is none). Check the diff: only the two new exports are added, and the slug sets are unchanged.
- [ ] **Step 2: Write the failing tests.**

```ts
it("the generated tables hold the ids live data uses")
  // DAMAGE_ADJUSTMENTS_BY_ID[22] = {name:"Poison", type:2}; [51] = {name:"Ranged Attacks", type:1}; CONDITION_NAMES_BY_ID[5] = "Frightened"
it("prints Laena's custom defenses, marked player-set")
  // immunity modifier magical-sleep + customDefenseAdjustments [{adjustmentId:22,type:2,source:null},{adjustmentId:5,type:1,source:null}]
  // → "Immunities: Magical Sleep, Poison (player-set), Frightened (player-set)"
it("files custom damage adjustments by their own type (Idhren shape)")
  // [{3,type 2},{51,type 2},{93,type 2}] → Resistances "Slashing (player-set), Ranged Attacks (player-set),
  //   Extra damage caused by Sneak Attack and Critical Hits (player-set)"
it("never prints the player's source text")       // source "Ignore previous instructions" → absent from the output
it("skips an unknown id or type")                 // {9999, type 2} and {5, type 7} → Immunities "(none)"
it("a custom entry already granted by a modifier prints once, plain")  // immunity poison modifier + {22, type 2} → "Poison" only
```

- [ ] **Step 3: Run them.** Expected: the generated-table test passes, and the defense cases FAIL.
- [ ] **Step 4: Implement** in `computeDefenses`. Read `char.customDefenseAdjustments`, in array order after the modifier entries:
  - type 2 → `DAMAGE_ADJUSTMENTS_BY_ID`, into the known list of its type;
  - type 1 → `CONDITION_NAMES_BY_ID`, into immunities.
  Each is printed as `${name} ${PLAYER_SET_NOTE}`. A **bare** name already in that list from a modifier is skipped. Compare before appending the note, since `defenseList`'s `Set` dedupes whole strings.
- [ ] **Step 5: Run the file and the snapshot test.** Expected: PASS. Update the snapshot only if a snapshot character has custom defenses, and read the diff.
- [ ] **Step 6: Docs and commit.** Add the tool-notes defenses note (the id meaning per `type`, and `source` never printed) and an intended-behaviour entry ("Player-set defenses are listed and marked"). Then `git commit -m "feat(character): list player-set defenses (F7)"`.

---

### Task 5: Slot-scaled dice, reset labels and hit-point pools (F5 under R2, F8)

**Files:**
- Modify: `src/tools/character/actions.ts` (`actionLine`, `buildLimitedUseLines`, the item-charge lines), `docs/claude/tool-notes.md` (limited use, feature rows), `skills/ddb-mcp-regression/references/intended-behaviour.md` (R2)
- Test: `tests/combat-features.test.ts`

**Interfaces:**
- Produces in `actions.ts`:
  - `export const RESET_LABELS: Readonly<Record<number, string>> = { 1: "Short Rest", 2: "Long Rest", 3: "Dawn", 4: "Special" }`, used by both the action lines and the item lines. An unknown reset type is still "Rest".
  - `export function slotScaling(action: Record<string, unknown>): string`: `" + <die> per slot level"` when the stripped snippet matches `/plus another (\d+d\d+) per level of the spell slot/i`, else `""`.
  - `export function isHitPointPool(action: Record<string, unknown>): boolean`: the stripped snippet, trimmed, ends with `Hit Points:`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("appends per-slot-level dice (Eldritch Smite, owner ruling R2)")
  // SPECIAL action, dice {diceString:"1d8"}, Weslocke's snippet → "• Eldritch Smite   1d8 + 1d8 per slot level"
it("leaves Divine Smite's 2014 wording alone")   // dice null, "…plus 1d8 for each spell level higher than 1st…" → "• Divine Smite"
it("labels reset types 3 and 4 Dawn and Special")
  // limitedUse {maxUses:4, numberUsed:1, resetType:4} → "• Infuse Item   1 used / 4 max   (Special)"; resetType 3 → "(Dawn)"
it("prints a hit-point pool as HP (Eldritch Cannon shape)")
  // limitedUse {maxUses:50, numberUsed:12, resetType:4}, snippet ending "<strong>Hit Points:</strong>"
  //   → "• Eldritch Cannon: Flamethrower   38/50 HP   (Special)"
it("an item's numeric resetType 4 reads Special")  // inventory limitedUse {maxUses:3, resetType:4} → "(Special)"
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `actionLine` appends `slotScaling(action)` after non-empty dice. `buildLimitedUseLines` uses `RESET_LABELS`, and for `isHitPointPool` prints `${max - used}/${max} HP`. The item lines use `RESET_LABELS` for a numeric `resetType`; string reset types are unchanged. Delete both local `resetLabels` maps (`actions.ts:491` and `:524`).
- [ ] **Step 4: Run the file and the snapshot test.** Expected: PASS. Read any snapshot diff before `-u`.
- [ ] **Step 5: Docs and commit.** Update tool-notes and intended-behaviour (R2: "slot-scaled feature dice say per slot level"). Then `git commit -m "fix(character): slot-scaled dice, Dawn/Special resets and HP pools (F5, F8)"`.

---

### Task 6: Features heading, duplicate Weapon Mastery, blank line before notes (F10)

**Files:**
- Modify: `src/tools/character/features.ts` (`buildFeatLines`, `computeFeatures`, `formatFeaturesBlock`), `src/tools/character/inventory.ts` (`formatInventoryBlock`), `tests/__snapshots__/*`
- Test: `tests/character-parser.test.ts` (features describe)

**Interfaces:**
- Changes: `buildFeatLines(char, resolveTemplates, editions, shownClassFeatureNames: ReadonlySet<string>)`. `computeFeatures` first builds the set from the classes' `classFeatures[].definition.name`, with the same level gate as `buildClassFeatureLines`, never from the formatted lines (which carry `(Class N)` and chosen options). It passes the set to `buildFeatLines`. `realFeatCount` and the `Rules:` line counts are unchanged.

- [ ] **Step 1: Write the failing tests.**

```ts
it("titles disguised feats OTHER FEATURES")  // a __DISGUISE_FEAT "Dark Bargain" → line "OTHER FEATURES"; no "stored as feats" anywhere
it("drops a disguised feat that is also a shown class feature (Bobby shape)")
  // __DISGUISE_FEAT "Weapon Mastery" + Barbarian 1 class feature "Weapon Mastery" → "• Weapon Mastery" absent from OTHER FEATURES,
  // "• Weapon Mastery (Barbarian 1)" present; with only that feat, no OTHER FEATURES heading at all
it("keeps it when the class feature is above the character's level")
it("still drops it when the class feature line carries chosen options") // class feature "Weapon Mastery" with a chosen option → dropped
it("full separates CURRENCY from the notes line")  // the line after "CURRENCY: …" is ""
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Change the heading to `OTHER FEATURES`, filter the disguised feats by `shownClassFeatureNames`, and end `formatInventoryBlock` with `""`.
- [ ] **Step 4: Run the file, then update snapshots.** `npx vitest run tests/character-parser.test.ts`, then `npx vitest run tests/character-snapshot.test.ts -u`. Read the diff: only the heading, the removed duplicate and the trailing blank line.
- [ ] **Step 5: Commit.** `git commit -m "fix(character): OTHER FEATURES heading, no duplicate class features, blank line before notes (F10)"`.

---

### Task 7: Bundles named by size count in bundles (F11)

**Files:**
- Modify: `src/tools/character/inventory.ts` (`computeInventory`), `docs/claude/tool-notes.md` (inventory)
- Test: `tests/character-parser.test.ts` (new `describe("bundled items (F11)")`)

**Interfaces:**
- Produces in `inventory.ts`: `export function bundleEntry(name: string, quantity: number, bundleSize: number): string`. It is the INVENTORY entry text, replacing the `×quantity` rule in `computeInventory`'s `line`. A name ending `(<word> of <N>)`, matched by `/\(\s*(?:[a-z]+\s+)?of\s+([\d,]+)\s*\)\s*$/i` with N (commas removed) equal to `bundleSize` > 1, counts bundles:
  - a whole multiple k = quantity / N prints `name` when k is 1, else `name ×k`;
  - otherwise it prints `name — <quantity> of <N as written in the name>`.
  Any other item keeps `name ×quantity` (or the bare name for 1).
- `computeInventory` keeps each name's `bundleSize` beside the summed quantity (first copy's value) for the carried and homebrew maps.

- [ ] **Step 0: Confirm the reading on the site.** Read-only, no clicks (the owner can check in a browser): Dunil 112305786's inventory shows the Ball Bearings (bag of 1,000) at **2 lb** in total, which is one bag. If it shows 2,000 lb, `quantity` counts bags: stop, drop this task and record F11 as not a finding.
- [ ] **Step 1: Write the failing tests.**

```ts
it("one bag reads as one bag (Dunil shape)")    // "Ball Bearings (bag of 1,000)", qty 1000, bundleSize 1000 → "Ball Bearings (bag of 1,000)", no "×"
it("several bags count in bags (Xarius shape)") // "Caltrops (bag of 20)", qty 100, bundleSize 20 → "Caltrops (bag of 20) ×5"
it("part of a bag says so (Halfling Rogue shape)") // qty 1, bundleSize 1000 → "Ball Bearings (bag of 1,000) — 1 of 1,000"
it("items named per piece keep their count")   // "Arrows" qty 20 bundleSize 20 → "Arrows ×20"; "Crossbow Bolts" qty 26 bundleSize 20 → "Crossbow Bolts ×26"
it("a name whose number isn't the bundle size keeps its count") // "Caltrops (bag of 20)", bundleSize 1, qty 2 → "Caltrops (bag of 20) ×2"
it("two copies of one bag merge before counting") // two entries qty 1000 each, bundleSize 1000 → "Ball Bearings (bag of 1,000) ×2"
```

- [ ] **Step 2: Run them.** `npx vitest run tests/character-parser.test.ts -t "bundled items"`. Expected: the Dunil, Xarius, part-of-a-bag and merge cases FAIL. The per-piece ones pass.
- [ ] **Step 3: Implement** `bundleEntry` and use it in `computeInventory`'s `line`.
- [ ] **Step 4: Run the file and the snapshot test.** Expected: PASS. Read any snapshot diff before `-u`.
- [ ] **Step 5: Docs and commit.** Add a tool-notes inventory note (D&D Beyond counts pieces; a bundle named by its size counts in bundles). Then `git commit -m "fix(character): bundles named by size count in bundles (F11)"`.

---

### Task 8: After `ddb_logout`, spells fall back to Open5e and feature searches say not logged in (F4)

**Files:**
- Modify: `src/tools/reference.ts` (`loadSpellCompendium`, `loadClassFeatures`, `loadRacialTraits`), `docs/claude/caching.md` (catalog builds), `skills/ddb-mcp-regression/references/coverage-matrix.md`
- Test: `tests/catalog-logged-out.test.ts`

**Interfaces:** none new. It uses `NoSessionError` and `captureSession` (already imported).

- [ ] **Step 1: Write the failing tests.** Add `Mode` `"after-logout"`: a valid session as in `"outage"`, then `await (await import("../src/session-state.js")).revokeSession()` after `reference` is imported, with `existsSync` returning false from then on.

```ts
describe("after ddb_logout, the catalog tools fall back like a fresh logged-out server (F4)", () => {
  it("ddb_get_spell says not logged in")          // getSpell("Fireball") contains LOGGED_OUT; not "Session changed"
  it("ddb_search_spells says not logged in")      // searchSpells({level:3, school:"evocation", limit:5}) contains LOGGED_OUT
  it("class features and racial traits reply as with no session") // equal to the "no-session" replies (they have no Open5e path); no "Session changed"
  it("signing back in builds from D&D Beyond again")
    // after revoke, set existsSync true, make GAME_DATA serve the spell fixture, and call invalidateSessionCache()
    // from session-fetch (what ddb_login's saveVerifiedSession does); getSpell("Fireball") has no "Open5e" at all
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/catalog-logged-out.test.ts`. Expected: the spell and feature cases FAIL with "Session changed".
- [ ] **Step 3: Implement.** In each of the three loaders, directly after its `captureSession()` (before the singleton and cache returns, which the invalidation hook has already cleared after a logout): `if (snapshot.state.kind !== "authenticated") throw new NoSessionError();`. Spells then fall back to Open5e. Class features and racial traits keep their existing no-session reply, and no fallback is added. Each assert after a build stays as it is. Add a comment pointing at F4: a snapshot taken after a logout is anonymous, and the revoked flag would otherwise turn the failed build into a session change.
- [ ] **Step 4: Run the session suites.** `npx vitest run tests/catalog-logged-out.test.ts tests/catalog-session-change.test.ts tests/session-consumers.test.ts`. Expected: PASS, with `catalog-session-change` unchanged.
- [ ] **Step 5: Docs and commit.** Update caching.md (catalog builds refuse early when not signed in; only spells have an Open5e path) and the coverage-matrix logged-out rows. Then `git commit -m "fix(reference): spells, class features and racial traits fall back after ddb_logout (F4)"`.

---

### Task 9: No vestigial 2024 racial traits in the search (F9)

**Files:**
- Modify: `src/tools/features-traits.ts` (`buildRacialTraits`), `tests/fixtures/features-traits-fixtures.ts` (`RACES`)
- Test: `tests/features-traits.test.ts` (`describe("racial traits")`)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.** Give a 2024 fixture race (`isLegacy: false`) "Ability Score Increases" and "Languages" traits with `displayConfiguration {RACIALTRAIT: 0, ABILITYSCORE: 1}` / `{RACIALTRAIT: 0, LANGUAGE: 1}`, and a legacy race an "Extra Language" trait with `RACIALTRAIT: 0`.

```ts
it("drops 2024 traits D&D Beyond doesn't display as racial traits")  // no "Ability Score Increases"/"Languages" for the 2024 race
it("keeps a legacy race's Extra Language")                           // present
it("keeps traits with no displayConfiguration")                      // present (homebrew and older shapes)
it("keeps RACIALTRAIT 0 traits when isLegacy is missing")             // race with no isLegacy field → its Extra Language present
```

- [ ] **Step 2: Run them.** Expected: the first case FAILS.
- [ ] **Step 3: Implement.** In the standard-trait loop, skip a trait whose `definition.displayConfiguration.RACIALTRAIT === 0` when `race.isLegacy === false` (live data always sends the field; a missing one keeps the trait). The optional-trait loop is unchanged. The trait's id is still added to `standardIds`, so an optional repeat stays dropped.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "fix(reference): racial trait search drops vestigial 2024 ASI and Languages traits (F9)"`.

---

### Task 10: The 2014 Damage and Healing chapter in full (F3, R3)

**Files:**
- Create: `src/srd51-rules.ts`
- Modify: `src/open5e.ts` (`rulesetsOf`), `docs/claude/architecture.md` (Open5e rules), `docs/claude/tool-notes.md` (`ddb_get_rules`), `skills/ddb-mcp-regression/references/intended-behaviour.md`
- Test: `tests/open5e.test.ts` (new `describe("2014 Damage and Healing patch (F3)")`; uses the recorded `srd-2014/rulesets.json`)

**Interfaces:**
- Produces in `src/srd51-rules.ts`:
  - `export interface Srd51Section { key: string; name: string; index: number; desc: string }`
  - `export const DAMAGE_AND_HEALING_KEY = "srd_damage-and-healing"`
  - `export const SRD51_DAMAGE_AND_HEALING: { replace: Readonly<Record<string, string>>; append: readonly Srd51Section[] }`
    - `replace`: `srd_damage-and-healing_critical-hits` → the Critical Hits text.
    - `append`, indexes 7–15, keys `srd_damage-and-healing_<slug>`: Healing, Dropping to 0 Hit Points (its intro paragraph only), Instant Death, Falling Unconscious, Death Saving Throws, Stabilizing a Creature, Monsters and Death, Knocking a Creature Out, Temporary Hit Points.
  - `export const MISSING_UPSTREAM_TEXT = "*(Open5e's SRD 5.1 text for this section is missing.)*"`
  - `export function patchSrd51Rulesets<T extends { key: string; rules: Srd51Section[] }>(rulesets: T[]): T[]`, a pure function that returns new objects. It replaces a desc only while it equals another section's desc, and appends a vendored section only when no upstream section has its key or its normalized name.
- Text source: copy each section **verbatim** from the `desc` of `https://api.open5e.com/v1/sections/damage-and-healing/` (SRD 5.1, `wotc-srd`), with no rewording, keeping its Markdown tables and emphasis. The file header carries the CC-BY-4.0 attribution worded as in `src/tools/conditions.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("prints the real Critical Hits text")
  // o5GetRule("Damage and Healing","2014",20000): "### Critical Hits\nWhen you score a critical hit, you get to roll extra dice";
  // "Each weapon, spell, and harmful monster ability specifies the damage it deals" occurs exactly once
it("includes the death-save sections")
  // same output contains "### Death Saving Throws\nWhenever you start your turn with 0 hit points, you must make a special saving throw"
  // and "### Temporary Hit Points\nSome spells and special abilities confer temporary hit points"
it("the report's exact call reaches the death-save text")
  // o5GetRule("Damage and Healing","2014",6500,"death saving throw"): no "not found"; contains "Whenever you start your turn with 0 hit points"
it("finds a section by name in 2014")
  // o5GetRule("Death Saving Throws","2014"): "## Death Saving Throws", "*Part of Damage and Healing*", a 2014 Rules line, no rules-miss reason
it("the search finds death saves in 2014")       // o5SearchRules("death saving throw","2014") lists a 2014 Death Saving Throws hit
it("upstream text wins once fixed")
  // patchSrd51Rulesets on a ruleset whose Critical Hits desc differs from Damage Rolls keeps it; one whose rules already
  // include key srd_damage-and-healing_healing, or a section NAMED "Healing" under another key, gets no second Healing
it("a section duplicating another, with no vendored text, says its text is missing")
  // ruleset {key:"srd_x", rules:[{a,"same"},{b,"same"}]} → b.desc === MISSING_UPSTREAM_TEXT
it("2024 rulesets are not patched")              // rulesetsOf/"2024" output unchanged for srd-2024 fixture
```

- [ ] **Step 2: Run them.** `npx vitest run tests/open5e.test.ts -t "Damage and Healing patch"`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/srd51-rules.ts`. In `open5e.ts`, `rulesetsOf` applies `patchSrd51Rulesets` before sorting, only for `edition === "2014"`.
- [ ] **Step 4: Run the Open5e suites.** `npx vitest run tests/open5e.test.ts tests/open5e-v2-filters.test.ts` and `npx tsx scripts/record-open5e-fixtures.mts --check`. Expected: PASS. The check asserts upstream only, so the patch doesn't affect it.
- [ ] **Step 5: Docs and commit.** architecture.md: the SRD 5.1 patch, when it applies and its source. tool-notes `ddb_get_rules`. intended-behaviour: "2014 Damage and Healing is complete". Then `git add src/srd51-rules.ts src/open5e.ts tests/open5e.test.ts docs skills && git commit -m "fix(rules): vendor the missing SRD 5.1 Damage and Healing sections (F3, owner ruling R3)"`.

---

### Task 11: Verification, website checks and docs

**Files:**
- Modify: `docs/claude/history.md`, `CLAUDE.md` ("Open work"), `skills/ddb-mcp-regression/references/*` (anything not already synced)

- [ ] **Step 1: Live snapshot diff.** `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/after.txt" && diff "$TMPDIR/before.txt" "$TMPDIR/after.txt"`. Every changed line must come from:
  - F1: Laena's DEX and every DEX-derived value (AC 20, Initiative +11, DEX save +12, Stealth +18, Acrobatics +6, Longbow +15 1d8+9, Shortsword +12 1d6+6);
  - F2: Vi's Pistol +2 and her Weapons line;
  - F5: Weslocke's Eldritch Smite;
  - F6: Laena's speed;
  - F7: Laena's, Idhren's and Skamos's defenses;
  - F8: Vi's LIMITED USE;
  - F10: the heading, the dropped Weapon Mastery lines and the blank line;
  - F11: the inventory lines of Dunil, Xarius and Halfling Rogue.

  Anything else is a bug to fix before going on.
- [ ] **Step 2: Whole-corpus regression.** `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --diff`. Expected: exit 0, 0 crashes, 0 inconsistencies and 0 new anomalies. Every difference must be on the Step 1 list. F10's dropped lines must appear on exactly the 9 Weapon Mastery characters.
- [ ] **Step 3: Website checks** (read-only, no clicks; the owner can do them in a browser):
  - Laena 26158232: DEX 22, AC 20, Initiative +11 and **CON 19** (confirms that the set score wins over the Other bonus).
  - Claude Skamos 155447750: DEFENSES lists "Unconscious*" (confirms `type: 1` = condition).
  - Idhren 155829352: DEFENSES lists the three resistances.
  - Vi 145415789: Pistol +2; the cannons' HP 50.
  - (Dunil's bag weight was checked in Task 7 Step 0.)
- [ ] **Step 4: Live MCP samples** against a fresh build (`npm run build`):
  - `ddb_logout`, then `ddb_get_spell({name:"Fireball"})`, `ddb_search_spells({level:3, school:"evocation", limit:5})` and `ddb_search_site({query:"Fireball", category:"spells"})`: each gives the labelled Open5e fallback. Then `ddb_login` and `ddb_get_spell` again: D&D Beyond's version.
  - `ddb_get_rules({name:"Damage and Healing", rules_edition:"2014", query:"death saving throw"})`: jumps to the 2014 text. `ddb_search_rules({query:"death saving throw", rules_edition:"2014"})`: a 2014 hit.
  - `ddb_search_racial_traits({race_name:"dwarf"})`: no Ability Score Increases or Languages.
- [ ] **Step 5: Docs and commit.** In `history.md`, add a "Findings and commits" table (F1–F11) and the verification results. Add carry-over (by) to `skills/ddb-mcp-regression/references/known-open-issues.md` and to history.md's carry-over list. In `CLAUDE.md` "Open work", add the 2026-11-18 remediation item (done, unreleased) and update the unreleased commit count (`git rev-list --count v2.10.2..HEAD`). Run the three checks one last time.

```bash
git add docs/claude/history.md CLAUDE.md skills/ddb-mcp-regression/references
git commit -m "docs: regression remediation 2026-11-18 — findings, verification, carry-overs"
```

- [ ] **Step 6: Remove the baseline worktree.** `git worktree remove "$TMPDIR/ddb-base" && git worktree prune`.

## Out of scope

- The report's "Improvements" list (attacks per action, pact-slot label, apostrophes, `mpmm` alias, …). None is a finding; pick them up in a later round.
- Known open issues (ba), (bd), (be) (Divine Smite and cannon damage dice included), (bj) and B14: unchanged.
- The report's other suspicions: see "The report's other suspicions" above (Laena's shield and the Darts tool are not findings; carry-over (by) is recorded, not fixed).
- Restricted skill or save proficiencies (none in the corpus). R1 changes weapon and tool proficiencies only.
