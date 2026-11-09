# Combat Section Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ddb_get_character`'s combat output show every choice a character has on its turn, as the live D&D Beyond sheet does: save advantages, attack and damaging cantrip rows, action features, an OTHER block, Unarmed Strike, the off-hand weapon, and hiding of unchosen features.

**Architecture:** All changes are in the per-domain sheet parser under `src/tools/character/`:
- `actions.ts` gains action visibility, feature dice, the action-feature list and the OTHER block.
- `weapons.ts` gains Unarmed Strike and the off-hand split.
- A new `spell-attacks.ts` builds spell rows and shares the spell attack/DC computation with `spells.ts`.
- `stats.ts` gains save-advantage lines.

Every new line goes through the existing `wrapIfHomebrew` / `shownHomebrew` / `grantingEntities` paths. Spell-row names also go through `editions.named`; action-feature and OTHER lines keep `actionLine`'s naming, which has no edition call (`actions.ts:185`), like today's BONUS ACTIONS lines.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Node ≥22.

**Spec:** `docs/superpowers/specs/2026-11-07-combat-section-completeness-design.md`. Read it first. It holds the measured impact, the owner decisions of 2026-11-07, the live-website reference values, and the data field names quoted below.

## Global Constraints

- Character tools take no `rules_edition`. Spell-row names go through `editions.named(name, def)`. No edition label text is built outside `src/edition.ts`.
- Untrusted text: a line granted by a homebrew entity is wrapped **whole** with `wrapIfHomebrew` (`shownHomebrew` for named records, `grantingEntities` for actions). Official `isHomebrew: false` content stays plain, and each new line type has a test for both cases.
- Null or non-object entries in any array are skipped (`records()` / `arr()` + `obj()`), never thrown on.
- No existing number changes (HP, AC, saves, skills, weapon to-hit/damage), except the owner-approved spell attack/DC correction for active item bonuses (spec §2.5; Orion and Sister Baronessa). Every figure comes from D&D Beyond's data or a rule the sheet already uses; when the data can't support a number, the row prints without it.
- Never hand-code class-feature maths (Sneak Attack, Potent Spellcasting, …): use D&D Beyond's `dice` / `levelScale` / modifiers.
- Cross-section consistency: every line of `summary` and `combat` also appears in `full`.
- Output snapshot (`tests/__snapshots__/character-snapshot.test.ts.snap`): when a task changes it, run `npx vitest run tests/character-snapshot.test.ts -u`, read the diff, and commit it only if every changed line is that task's intended change.
- Before every commit: `npm run typecheck && npm run lint && npm test` all green. One commit per task, on `main`. Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push; the owner pushes.
- Owner rulings recorded in `docs/claude/history.md` stand (weapon-row rulings 2026-11-06/07 included). Don't relitigate them.

## Review Focus

1. **Multiclass casters.** Each class's spells use that class's spellcasting ability (Cleric WIS + Warlock CHA), never the first class's. Test in Task 5.
2. **A spell granted twice** (class list + racial or feat list) prints one row, deduped by definition id. Test in Task 5.
3. **Homebrew in the new rows.** A homebrew spell row, action-feature line, OTHER line, off-hand row and save-advantage line are wrapped whole, and the official equivalent is plain. Tests in Tasks 2, 4, 5 and 6.
4. **A classless or level-0 sheet** (`totalLevel` 0): no crash; cantrips print their base die; Unarmed Strike still prints. Tests in Tasks 3 and 5.
5. **Malformed data.** These are skipped silently, without `undefined`/`NaN` in output: null action entries, spells without a `definition`, damage modifiers with a null `die`, a `characterValues` type-18 entry whose `valueId` isn't a number, a spellcasting ability id of 0. Tests in Tasks 1, 4 and 5.
6. **Duplicate items.** One definition owned twice, one copy equipped and one not: item modifiers still count (any active copy), and the off-hand flag follows the inventory id, not the definition. Tests in Tasks 4 and 5.

The spec's "Adversarial review 2" (2026-11-09) note records which review findings were folded in here.

---

### Task 0: Baseline capture (no commit)

Captures today's output for all 56 test characters, so Task 7 can diff against it.

- [ ] **Step 1: Fetch the characters and dump the baseline**

```bash
V=/tmp/ddb-combat-verify; mkdir -p "$V/json" "$V/before" "$V/after"   # fixed path: shells don't keep variables between calls, so re-declare V in every later command
sed -n '/^## Character List/,/^## Coverage Notes/p' testcharacters.md | grep -oE '^\| [0-9]+ ' | tr -d '| ' > "$V/ids.txt"
while read -r id; do curl -s -o "$V/json/$id.json" "https://character-service.dndbeyond.com/character/v5/character/$id"; done < "$V/ids.txt"
npm run build
```

Then write `$V/dump.mjs`. It takes `<dist dir> <json dir> <out dir>`, imports `parseCharacterData` from `<dist>/tools/character.js` and `getSourceIndex` from `<dist>/game-config.js`, awaits the index once and passes it as the third argument (as the server does, `src/tools/character.ts:108-111`; without it `parse.ts:34` falls back to `peekSourceIndex()`). For each JSON file it writes `<id>.txt` with all 8 sections (`full`, `summary`, `combat`, `spells`, `inventory`, `features`, `concentration`, `notes`), each preceded by `=== <section>`. Run `node "$V/dump.mjs" dist "$V/json" "$V/before"`.

Expected: 56 files in `$V/before`, none containing `NaN`, `undefined` or `[object Object]`. The JSON is fetched **once** here; Task 7 reuses it and never re-fetches, so live edits on D&D Beyond can't create diffs.

---

### Task 1: Action visibility

**Files:**
- Modify: `src/tools/character/actions.ts` (`getAllActions`, ~line 131; remove the name-based Circle Spell filter at ~line 138)
- Create: `tests/fixtures/combat-helpers.ts`
- Create: `tests/combat-visibility.test.ts`
- Modify: existing tests that relied on a class action with an unknown class feature being shown

**Interfaces:**
- Produces, in `actions.ts`:
  - `export const CLASS_FEATURE_TYPE = 12168134`
  - `export function visibleClassFeatureIds(char: CharData, classes: readonly ClassEntry[]): Set<number>`: ids of class features with `requiredLevel` ≤ that class's `level` (a missing `requiredLevel` counts as 1), plus every `char.optionalClassFeatures[].classFeatureId`. Reads both `cls.classFeatures` (wrapped) and `cls.subclassDefinition.classFeatures` (plain) through `featureDefinition`, as `core.ts:38-42` does.
  - `export function isVisibleAction(bucket: string, action: Record<string, unknown>, visibleIds: ReadonlySet<number>, hiddenOptionIds: ReadonlySet<number>): boolean`: true for any bucket other than `"class"` (spec §4: other buckets keep today's behaviour). In the `class` bucket, false when `componentTypeId === CLASS_FEATURE_TYPE` and `componentId` is not in `visibleIds`, or when `componentTypeId === 258900837` (option) and `componentId` is in `hiddenOptionIds`.
  - `export function hiddenOptionIds(char: CharData, visibleIds: ReadonlySet<number>): Set<number>`: definition ids of `options.*` records whose owner (`componentTypeId === CLASS_FEATURE_TYPE`) has a `componentId` not in `visibleIds`.
- Produces, in `tests/fixtures/combat-helpers.ts` (moved from `tests/character-homebrew-actions.test.ts`, which then imports them): `combat(overrides)`, `block(out, header)`, `action(...)`, `actions(buckets)`, `feature(...)`, `fighter(...)`, `limited`, the entity-type constants, and `BONUS = 3`, `REACTION = 4`, `ACTION = 1`, `SPECIAL = 8`.

- [ ] **Step 1: Move the helpers into `tests/fixtures/combat-helpers.ts`**, re-import them in `character-homebrew-actions.test.ts`, and run `npx vitest run tests/character-homebrew-actions.test.ts`. Expected: PASS (pure move).

- [ ] **Step 2: Write the failing tests** in `tests/combat-visibility.test.ts`:
  - `hides a class action whose class feature the character lacks, everywhere`: `Steady Aim` (componentId 3035892, CLASS_FEATURE, BONUS, `limited`), with no such feature. Output contains no `Steady Aim` (BONUS ACTIONS and LIMITED USE).
  - `shows it when chosen through optionalClassFeatures`: the same, plus `optionalClassFeatures: [{ classFeatureId: 3035892 }]`. BONUS ACTIONS block contains `• Steady Aim`.
  - `hides an action whose class feature is above the class level`: `feature(500, "Late Trick", { requiredLevel: 9 })` on the level-5 fighter, plus an action with componentId 500. Hidden.
  - `hides Initiate a Circle Spell and Circle Spell options`: componentId 12373777, CLASS_FEATURE, activation 1 and 8. Neither name appears.
  - `hides an option action whose option belongs to an unchosen class feature`: the Ehsu shape. `options.class: [{ componentId: 3035679, componentTypeId: CLASS_FEATURE, definition: { id: 1306486, entityTypeId: OPTION, name: "Tireless (10th Level)" } }]`, no feature 3035679, and actions `Deft Explorer: Tireless` (activation 1) and `Deft Explorer: Tireless (exhaustion)` (activation 8) with componentId 1306486 / componentTypeId OPTION. Neither appears. With feature 3035679 present, both appear.
  - `keeps a feat action whose feat is not on the sheet`: a feat-bucket action with an unknown FEAT component is still shown (unchanged behaviour).
  - `applies the rule only in the class bucket`: a race-bucket action whose `componentTypeId` is CLASS_FEATURE and whose `componentId` names no feature is still shown.
  - `keeps a subclass action whose feature is only in subclassDefinition.classFeatures`: a plain `{ id: 600, requiredLevel: 3 }` in `subclassDefinition.classFeatures` (absent from `classFeatures`) on the level-5 fighter, plus a class action with componentId 600. Shown. With `requiredLevel: 7`, hidden.
  - `skips null action entries`: `actions({ class: [null, <visible action>] })` prints the visible one and no `undefined`.

- [ ] **Step 3: Run** `npx vitest run tests/combat-visibility.test.ts`. Expected: the hiding tests FAIL.

- [ ] **Step 4: Implement** `visibleClassFeatureIds` and `isVisibleAction`, and apply them in `getAllActions`. Remove the `Circle Spell` / `Initiate a Circle Spell` name filter: the visibility rule subsumes it. Task 7 confirms no Circle Spell line appears in any of the 56 characters; if one does, restore the filter.

- [ ] **Step 5: Run** `npm test`. For each failure caused by a test fixture whose class action names a class feature absent from `classFeatures`: keep the test's intent by adding `optionalClassFeatures: [{ classFeatureId: <its componentId> }]` (or the matching `feature(...)`). Never weaken an assertion. Expected: all green.

- [ ] **Step 6: Commit** `feat(character): hide actions of class features the character doesn't have`.

---

### Task 2: Action features, feature dice and the OTHER block

**Files:**
- Modify: `src/tools/character/actions.ts` (`Actions`, `actionLine`, `computeActions`, `formatCombatBlock`)
- Create: `tests/combat-features.test.ts`
- Modify: `tests/character-homebrew-lines.test.ts` (~lines 64, 78) and `tests/character-homebrew-nameless.test.ts` (~line 72): their exact-block expectations gain the new lines. Update the expected strings to the new blocks; don't loosen them to `toContain`. Tasks 3 and 5 touch the same tests again.

**Interfaces:**
- Consumes: Task 1's visible `getAllActions`.
- Produces: the final `Actions` shape, which later tasks fill in:
  ```ts
  export interface Actions {
    weaponAttacks: string[];
    unarmedStrike: string[];   // Task 3 fills; [] until then
    spellAttacks: string[];    // Task 5 fills; [] until then
    actionFeatures: string[];
    offHandAttacks: string[];  // Task 4 fills; [] until then
    bonusActions: string[];
    reactions: string[];
    otherFeatures: string[];
    limitedUseFeatures: string[];
  }
  ```
- Produces: `export function actionDice(a: Record<string, unknown>): string`. It returns `obj(a.dice).diceString` trimmed when `a.displayAsAttack === true`, `a.abilityModifierStatId == null` and `a.isMartialArts !== true`; otherwise `""`. `a.value` is never printed (spec §2.4 dice rule).
- Produces: `export function isMasteryAction(a: Record<string, unknown>): boolean`. True when the name matches `^(\S+) \(.+\)$` and group 1 is in `MASTERY_NAMES` (`src/tools/weapon-mastery.ts`).
- `formatCombatBlock` order:
  - `ACTIONS` = weaponAttacks, unarmedStrike, spellAttacks, actionFeatures (`(none)` only if all four are empty);
  - `BONUS ACTIONS` = offHandAttacks, then bonusActions;
  - `REACTIONS`;
  - `OTHER` (omitted when empty);
  - `LIMITED USE` (as today).

- [ ] **Step 1: Write the failing tests** in `tests/combat-features.test.ts`:
  - `lists an action feature under ACTIONS`: the fighter's class feature + action `Channel Divinity` (activation 1). ACTIONS block contains the line `• Channel Divinity`.
  - `appends displayAsAttack dice`: `Channel Divinity: Sear Undead` with `displayAsAttack: true, dice: { diceString: "1d8" }`. The line is exactly `• Channel Divinity: Sear Undead   1d8`.
  - `prints no dice for an action that adds an ability modifier or is Martial Arts`: `Stone's Endurance` (`displayAsAttack: true`, `dice: { diceString: "1d12" }`, `abilityModifierStatId: 3`) prints `• Stone's Endurance` only. Flemin's bonus-action `Unarmed Strike` (`displayAsAttack: true`, `dice: null`, `value: 1`, `isMartialArts: true`) prints `• Unarmed Strike` only. `Deflect Missiles` (`dice: { diceString: "1d10 + 9" }`, `isMartialArts: true`) prints `• Deflect Missiles` only.
  - `prints no dice without displayAsAttack`: `dice: { diceString: "2d8" }` with `displayAsAttack: null`. The line is exactly `• Channel Divinity: Divine Spark`.
  - `appends dice in BONUS ACTIONS too`: `Bardic Inspiration` (BONUS, displayAsAttack, `1d6`). The line is `• Bardic Inspiration   1d6`.
  - `prints an OTHER block after REACTIONS and before LIMITED USE`: `Sneak Attack` (SPECIAL, displayAsAttack, `3d6`) and a limited-use action. Block `OTHER` is `OTHER\n• Sneak Attack   3d6`, and its index lies between `REACTIONS` and `LIMITED USE`.
  - `omits OTHER when there are no special actions`: output has no `\nOTHER\n`.
  - `excludes weapon-mastery actions`: feat-bucket `Vex (Handaxe)` (activation 1) is absent from ACTIONS. `isMasteryAction` is false for `Channel Divinity: Turn Undead` and `Arms of the Astral Self (Wis.)`.
  - `wraps a homebrew-granted action feature and OTHER line whole; official stays plain`: follow the homebrew-class-feature pattern already used in `character-homebrew-actions.test.ts`.
  - `keeps a limited-use action's LIMITED USE line`: Channel Divinity with `limited` appears in ACTIONS and LIMITED USE.

- [ ] **Step 2: Run** `npx vitest run tests/combat-features.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `actionLine` appends `   ${actionDice(a)}` when non-empty.
  - `actionFeatures` = visible activation-1 actions that are not mastery actions.
  - `otherFeatures` = visible activation-8 actions.
  - Replace the stale comment "activationType 1 = action (weapon masteries — skip…)".

- [ ] **Step 4: Run** `npm test`, then update the output snapshot per Global Constraints. Expected: green; snapshot diff only adds action/OTHER lines and dice.

- [ ] **Step 5: Commit** `feat(character): list action features, feature dice and an OTHER block`.

---

### Task 3: Unarmed Strike row

**Files:**
- Modify: `src/tools/character/weapons.ts`; `src/tools/character/actions.ts` (fill `unarmedStrike`)
- Create: `tests/combat-unarmed.test.ts`

**Interfaces:**
- Produces, in `weapons.ts`:
  - `export function martialArtsDie(core: CoreStats): string | null`: the `levelScale.dice.diceString` of a `Martial Arts` class feature at or below its class level, else `null`. `levelScale` is read from the `classes[].classFeatures` **wrapper**, not from its `definition` (live Flemin: wrapper `1d6`, definition has none).
  - `export function computeUnarmedStrike(core: CoreStats): string`. One row, padded like weapon rows:
    - `` `• ${"Unarmed Strike".padEnd(16)} ${signed(hit)} to hit   ${damage} bludgeoning   reach 5 ft.` ``
    - without Martial Arts: hit = STR mod + prof, damage = `Math.max(0, 1 + STR mod)`;
    - with a Martial Arts die: ability = the better of STR/DEX, hit = that + prof, damage = `` `${die}${mod === 0 ? "" : signed(mod)}` ``. `signed(0)` returns `"+0"` (`helpers.ts:21`), so don't call it for 0.
- The existing Martial Arts weapon logic (`hasMartialArts`) is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/combat-unarmed.test.ts`. Expected values come from `computeCoreStats(data, INDEX)` (`statMods`, `profBonus`), not hard-coded:
  - `prints one Unarmed Strike row in ACTIONS`: FIGHTER_5. The ACTIONS block has exactly one line starting `• Unarmed Strike`, equal to the formula above.
  - `floors damage at 0 for a negative STR modifier`: a fixture whose computed STR mod is −1 (assert that first). The row contains `   0 bludgeoning`. Website reference: Weslocke shows 0.
  - `uses the Martial Arts die and the better of STR/DEX`: a monk fixture with a `Martial Arts` feature wrapper `{ definition: {…}, levelScale: { dice: { diceString: "1d6" } } }`, and DEX mod > STR mod. The row shows the DEX-based hit and `1d6+<dex>`.
  - `ignores a levelScale on the definition`: the same die placed only on `definition.levelScale` gives the non-Martial-Arts row.
  - `prints no +0`: a Martial Arts monk whose better modifier is 0 reads `1d6 bludgeoning`.
  - `keeps D&D Beyond's monk Unarmed Strike bonus actions`: a monk with class actions `Unarmed Strike` / `Unarmed Strike (Dex.)` (activation 3, componentId = Martial Arts feature id). BONUS ACTIONS still lists both, and ACTIONS has exactly one Unarmed Strike line.
  - `prints a row on a classless level-0 sheet` (Review Focus 4): `classes: []`. The row prints and the output has no `NaN`.

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Fix the monk fixture.** `MONK_3_HANDAXE`'s Martial Arts wrapper has no `levelScale` (`tests/fixtures/character-fixtures.ts:141`), so its snapshot would record a plain `1 bludgeoning` row, which D&D Beyond never shows for a monk. Add `levelScale: { dice: { diceString: "1d4" } }` to that wrapper (2014 Monk 3; the fixture's class source is 2). Run `npm test`: nothing else may change, since today's code reads no `levelScale`.
- [ ] **Step 4: Implement** both functions and set `unarmedStrike: [computeUnarmedStrike(core)]` in `computeActions`.
- [ ] **Step 5: Run** `npm test` and update the snapshot. Expected: green; each snapshot gains one Unarmed Strike row, and MONK_3_HANDAXE's reads `+5 to hit   1d4+3 bludgeoning` (DEX +3, prof +2).
- [ ] **Step 6: Commit** `feat(character): add the Unarmed Strike row`.

---

### Task 4: Off-hand weapon row and the Two-Weapon Fighting style

**Files:**
- Modify: `src/tools/character/weapons.ts` (`computeWeaponAttacks`); `src/tools/character/actions.ts` (fill `offHandAttacks`)
- Create: `tests/combat-offhand.test.ts`

**Interfaces:**
- Changes: `computeWeaponAttacks(core: CoreStats): { attacks: string[]; offHand: string[] }`.
- Produces, in `weapons.ts`:
  - `export function offHandItemIds(char: CharData): Set<number>`: the `valueId`s (parsed as integers; non-numeric skipped) of `characterValues` entries with `typeId === 18` and `value === true`.
  - `export function hasTwoWeaponFightingStyle(char: CharData): boolean`: an `options.*` entry or a `feats` entry whose `definition.name` is `"Two-Weapon Fighting"`.
- Off-hand rule:
  - Applies to an **equipped** item whose `id` is in `offHandItemIds`.
  - Same row format and to-hit as a main-hand row.
  - Damage bonus = magic bonus + (ability mod when it is negative, or when `hasTwoWeaponFightingStyle`; otherwise 0).
  - Only the ability part of the bonus changes. Build the row with the main-hand code (`weapons.ts:95-114`), passing the off-hand ability part in, so the granted extra dice and their restrictions, a replaced damage type and the versatile die all stay.
  - The consolidation key includes the off-hand flag, so off-hand and main-hand copies never merge.
  - Off-hand rows go to `offHand`, not `attacks`.

- [ ] **Step 1: Write the failing tests** in `tests/combat-offhand.test.ts`. Expectations come from `computeCoreStats`:
  - `moves a flagged equipped weapon to BONUS ACTIONS without its ability modifier`: two equipped `Dagger, +1` entries (ids 1 and 2, magic +1 granted modifier) and `characterValues: [{ typeId: 18, value: true, valueId: "2" }]`.
    - ACTIONS has one `• Dagger, +1` line and no `×2`.
    - BONUS ACTIONS' first line is the off-hand row, with the same to-hit and damage `1d4+1 piercing`. Website reference: Ezra `+9 1d4+1`.
  - `ignores the flag on an unequipped weapon`: no off-hand row.
  - `adds the ability modifier with the 2024 Two-Weapon Fighting feat`, and `… with the 2014 options.class Two-Weapon Fighting`.
  - `applies a negative ability modifier on the off-hand`.
  - `keeps granted extra dice on the off-hand`: an off-hand weapon with a granted `damage` modifier (`dice: { diceString: "2d6" }`, `subType: "fire"`) reads `… + 2d6 fire`, as its main-hand row would.
  - `keys the off-hand by inventory id, not definition`: two copies of one definition, the flag on the second id. Only that copy moves; the other stays in ACTIONS.
  - `wraps a homebrew off-hand weapon row whole`.
  - `skips a type-18 entry whose valueId is not a number` (Review Focus 5).

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement**, updating the `computeWeaponAttacks` call site in `actions.ts`.
- [ ] **Step 4: Run** `npm test` and update the snapshot if it moves. Expected: green.
- [ ] **Step 5: Commit** `feat(character): show the dual-wield off-hand attack under BONUS ACTIONS`.

---

### Task 5: Spell rows in ACTIONS

**Files:**
- Create: `src/tools/character/spell-attacks.ts`
- Modify: `src/tools/character/spells.ts` (extract the ability/attack/DC computation; `ClassSpellList` gains `classEntry`); `src/tools/character/actions.ts` (fill `spellAttacks`)
- Create: `tests/combat-spell-rows.test.ts`

**Interfaces:**
- Produces, in a new `src/tools/character/item-gate.ts` (Task 6 reuses it): `export function isActiveItemMod(m: Mod, inventory: readonly InventoryItem[]): boolean`.
  - Matching copies are the inventory items whose `definition.id`/`definition.entityTypeId` equal the modifier's `componentId`/`componentTypeId`. A character can own several (Ezra's two `Dagger, +1`).
  - With no matching copy, the modifier is not from an item: true.
  - Otherwise true when **any** matching copy is active: `equipped === true`, and `isAttuned === true` when its `definition.canAttune === true`. That is `copies.some(isActive)`, never `find` on the first copy.
- Produces, in `spells.ts` (`buildSpellcastingLines` switches to them, so the SPELLS lines and the rows can't disagree):
  - `export function classSpellcastingAbilityId(cls: ClassEntry): number`: the `spellCastingAbilityId` of whichever definition (class, else subclass) has `canCastSpells === true`, else 0. This is exactly `buildSpellcastingLines`' current gate; Way of the Open Hand (`canCastSpells: false`, ability 5) returns 0.
  - `export function spellBonuses(core: CoreStats): { attack: number; dc: number }`: the sums of `bonus` modifiers with `subType` `spell-attacks` / `spell-save-dc` (`value ?? fixedValue`) that pass `isActiveItemMod`. Every bucket counts, not only items (spec §2.5); on the 56 test characters only item modifiers carry these subTypes.
  - `export function spellAttackAndDc(abilityId: number, statMods: readonly number[], profBonus: number, bonuses: { attack: number; dc: number }): { attack: number; dc: number } | null` = ability mod + prof + `bonuses.attack`; 8 + ability mod + prof + `bonuses.dc`. Returns `null` when `abilityId` is not 1–6 (0 included), so `statMods[-1]` is never read; the caller then prints no to-hit/DC part.
  - `ClassSpellList.classEntry: ClassEntry | undefined`.
- Produces, in `spell-attacks.ts`:
  - `export function cantripDice(mod: Record<string, unknown>, totalLevel: number): string | null`. Returns the modifier's `die.diceString`, replaced by the `dice.diceString` of the highest `atHigherLevels.higherLevelDefinitions[]` entry with `typeId === 15` and `level ≤ totalLevel`. Returns `null` when neither exists.
  - `export function leveledDice(mod: Record<string, unknown>, spellLevel: number, castLevel: number): string | null`.
    - `castLevel === spellLevel`: the base `die.diceString`.
    - Otherwise only one shape is supported: exactly one `higherLevelDefinitions` entry with `level === 1`, `typeId === 15`, and the same `diceValue` as the base die. That gives `${base.diceCount + inc.diceCount * (castLevel - spellLevel)}d${diceValue}`.
    - Any other shape returns `null`, and the caller prints the base damage plus `(at <ordinal>-level slot: see spell)`, never a guess.
  - `export function pactSlotLevel(cls: ClassEntry): number`. For a class whose definition name is `Warlock`: the highest slot level with a non-zero count in `definition.spellRules.levelSpellSlots[cls.level]`. Otherwise 0.
  - `export function lowestSharedSlot(classes: readonly ClassEntry[], spellLevel: number): number`: the lowest slot level ≥ `spellLevel` with a non-zero count in the `levelSpellSlots[level]` row of any spellcasting class (same `canCastSpells` gate as `buildSlotLines`, `spells.ts:82-84`) other than Warlock; 0 when there is none.
  - `export function castLevel(entry: Record<string, unknown>, spellLevel: number, isWarlockList: boolean, classes: readonly ClassEntry[]): number`:
    - a numeric `entry.castAtLevel` wins (live: racial Hellish Rebuke and Charm Person at 2);
    - a Warlock class-list spell: the lower non-zero value of `pactSlotLevel` and `lowestSharedSlot(classes, spellLevel)`;
    - otherwise the spell's level.
  - `export function computeSpellAttackRows(core: CoreStats): string[]`.
- Selection, from the spec §2.3:
  - Source: class spells through `isShownClassSpell`, then every `char.spells.*` bucket, deduped by definition id (first wins).
  - Kept when `definition.activation.activationType === 1`, and either:
    - `attackType` is 1 or 2; or
    - `level === 0` and `saveDcAbilityId` is set and some `definition.modifiers[]` has `type === "damage"`.
- Ability:
  - class spells: `classSpellcastingAbilityId(classEntry)`;
  - other buckets: the entry's `spellCastingAbilityId`;
  - a `spells.class` entry with a null one: the single spellcasting class's ability when the character has exactly one;
  - any other null, and any 0: no to-hit/DC part (`spellAttackAndDc` returns `null`).
- Cast level: cantrips have none; leveled spells use `castLevel(...)`.
- Damage text:
  - Each damage modifier with dice; same dice → types joined by `/`; different components joined by ` + `.
  - Count prefix:
    - from a spell-level `higherLevelDefinitions` entry with `typeId === 16` (`1 + value` of the highest such entry ≤ totalLevel; the word is its `details`, e.g. "Beams");
    - or a modifier `restriction` matching `^(\d+) (\w+)`;
    - prints `${n} ${word.toLowerCase()} × <dice>`.
  - A count of 1 or less prints no prefix.
  - Bonus damage, added inside the dice term (`1d10+4`):
    - each modifier with `type === slug(spell name)` and `subType === "bonus-damage"` adds `statMods[statId - 1]` (or its fixed value);
    - for a cantrip from a class list, each `bonus` modifier with `subType === "<slug(class name)>-cantrip-damage"` adds `statMods[statId - 1]` (Potent Spellcasting).
  - The first non-empty `details` among the damage modifier's `higherLevelDefinitions` is appended as `   (<details>)`, at every level.
  - No base die anywhere but level-scaled dice (Green-Flame Blade, Booming Blade): the to-hit part reads `melee weapon attack`, and damage is `+ <scaled dice> <type>` from the **first** damage modifier only (omitted below the first scaling level).
- Row: `` `• ${`${name} (${label})`.padEnd(26)} ${hitOrDc}   ${damage}   ${range}` ``, where:
  - `label` is `cantrip` or `<ordinal> level`;
  - `hitOrDc` is `+N to hit`, `DC N <ABILITY>` (from `saveDcAbilityId`), or both as `+N to hit / DC N <ABILITY>` when the spell has both (Ice Knife);
  - `range` comes from the object `definition.range` (`{ origin, rangeValue, aoeType, aoeValue }`): origin `Ranged` with `rangeValue > 0` → `range N ft.`; `Touch` → `touch`; `Self` → `self`; anything else → no range part.
  - Empty parts are dropped with their separators.
  - `name` = `editions.named(def.name, def)`; the line is wrapped by `wrapIfHomebrew(line, shownHomebrew(entry, name))`.

- [ ] **Step 1: Write the failing pure-function tests** (use the live definitions quoted in the spec as fixtures):
  - `cantripDice` on Fire Bolt's modifier at totalLevel 0, 1, 5, 11, 17, 20 → `1d10`, `1d10`, `2d10`, `3d10`, `4d10`, `4d10`.
  - `leveledDice` Witch Bolt (`1d12`, +`1d12` at level 1) spell 1 cast 5 → `5d12`; Guiding Bolt (`4d6`, +`1d6`) cast 1 → `4d6`; an increment with a different die value → `null`.
  - `pactSlotLevel` for a Warlock 9 whose `levelSpellSlots[9]` is `[0,0,0,0,2,0,0,0,0]` → 5; a Cleric → 0.
  - `castLevel`: Witch Bolt on a single-class Warlock 9 → 5; on a Warlock 9 / Cleric 1 (Cleric row `[2,0,…]`) → 1, so the row reads `1d12`; Guiding Bolt (1st) from the Cleric list on that sheet → 1; an entry with `castAtLevel: 2` → 2.

- [ ] **Step 2: Write the failing sheet tests** in `tests/combat-spell-rows.test.ts`. Expected to-hit/DC come from `spellAttackAndDc` with `computeCoreStats` values:
  - `prints an attack cantrip row`: Fire Bolt on a wizard. `+N to hit   <scaled> fire   range 120 ft.`; to-hit equals the SPELLS section's `Spell Attack: +N`.
  - `prints a damaging save cantrip row`: Sacred Flame on a cleric. `DC N DEX   <scaled> radiant`.
  - `prints Eldritch Blast with beams and Agonizing Blast`: warlock 9, CHA mod 4, modifier `{ type: "eldritch-blast", subType: "bonus-damage", statId: 6 }`. `2 beams × 1d10+4 force`.
  - `casts a Warlock spell at the pact slot level`: Witch Bolt shows `5d12`.
  - `appends a scaling note at every level`: Toll the Dead at totalLevel 1 and at 5 both end with `(The die type becomes a d12 if the target is missing any of its hit points.)`.
  - `adds Potent Spellcasting to class cantrips`: cleric with `modifiers.class: [{ type: "bonus", subType: "cleric-cantrip-damage", statId: 5 }]` and WIS mod 5. Sacred Flame at totalLevel 12 reads `3d8+5 radiant`; a racial cantrip on the same sheet gets no +5.
  - `prints no beam prefix at one beam`: Eldritch Blast at totalLevel 1 reads `1d10 force`, no `beams`.
  - `reads any typeId-16 count`: a spell-level entry `{ level: 5, typeId: 16, value: 1, details: "Rays" }` at totalLevel 5 reads `2 rays × …`.
  - `prints range from the range object`: `{ origin: "Ranged", rangeValue: 60 }` → `range 60 ft.`; `{ origin: "Touch", rangeValue: 0 }` → `touch`; `{ origin: "Self" }` → `self`; no `range 0 ft.` anywhere.
  - `prints no to-hit/DC for an ability id of 0`: a class spell list on a class whose `classSpellcastingAbilityId` is 0 (neither definition casts) prints the row without to-hit/DC and without `NaN`.
  - `prints both to-hit and DC`: Ice Knife reads `+N to hit / DC N DEX   1d10 piercing + 2d6 cold`.
  - `does not treat a non-casting subclass as a caster`: a Way of the Open Hand monk (`subclassDefinition: { canCastSpells: false, spellCastingAbilityId: 5 }`) gets no SPELLCASTING line and no spell rows.
  - `merges same-dice damage types`: Chromatic Orb → `3d8 acid/cold/fire/lightning/poison/thunder`. `joins different components`: Ice Knife → `1d10 piercing + 2d6 cold`.
  - `prints Green-Flame Blade as a weapon attack`: two `fire` modifiers with `die: null`, the second restricted "To Second Target". At totalLevel 5 the row reads `melee weapon attack   + 1d8 fire`, with no `fire/fire`.
  - `omits utility cantrips, leveled save spells and non-action spells`: Light, Guidance, Fireball and Healing Word are not in ACTIONS.
  - `gates spellbook spells`: an unprepared Wizard Chromatic Orb is absent and a prepared one present; a Warlock's unprepared known Witch Bolt is present.
  - Review Focus 1, `uses each class's own ability when multiclassed`: Cleric (WIS) Sacred Flame and Warlock (CHA) Eldritch Blast each use their class's numbers.
  - Review Focus 2, `prints a spell granted twice once`: Fire Bolt in a class list and in `spells.race` with the same definition id gives one row.
  - Review Focus 3, `wraps a homebrew spell row whole; an official one stays plain`.
  - Review Focus 4, `prints base cantrip dice at totalLevel 0`.
  - Review Focus 5, `skips spells without a definition and damage modifiers with a null die`: no `undefined`/`NaN`.

  - `adds active item bonuses to spell attack and DC, in SPELLS and in the rows`: equipped + attuned item (`canAttune: true`) with `bonus spell-attacks` 2 and `bonus spell-save-dc` 1. SPELLS reads `Spell Attack: +<base+2>  Save DC: <base+1>`, and the Fire Bolt row's to-hit equals it. Unequipped → no bonus. Equipped but unattuned (`canAttune: true`, `isAttuned: false`) → no bonus. Equipped with `canAttune: false` → bonus.
  - `counts an item bonus when any copy is active`: two inventory entries with the same definition, the first unequipped and the second equipped (and attuned) → bonus. Both unequipped → no bonus.
  - `counts a non-item spell-attacks bonus`: a `modifiers.feat` `bonus spell-attacks` 1 raises SPELLS and the rows by 1.
- [ ] **Step 3: Run** both test sets. Expected: FAIL.
- [ ] **Step 4: Implement** `item-gate.ts`, `spell-attacks.ts` and the `spells.ts` extraction, and set `spellAttacks` in `computeActions`.
- [ ] **Step 5: Add a spell-row snapshot.** No existing snapshot fixture has an action spell: `ARCANE_TRICKSTER_9` has `classSpells: []` and `spells: {}` (`tests/fixtures/character-fixtures.ts:278-279`), and four other test files use it, so don't change it. Add a new `CLERIC_5_SPELLS` fixture (Cleric 5, WIS 18) whose class list has Sacred Flame, Guiding Bolt (prepared) and Light, plus Fire Bolt in `spells.race` with `spellCastingAbilityId: 4`. Add `CLERIC_5_SPELLS — full output` and `— combat section only` cases to `tests/character-snapshot.test.ts`.
- [ ] **Step 6: Run** `npm test` and update the snapshots. Expected: green. The new snapshots show the Sacred Flame, Guiding Bolt and Fire Bolt rows and no Light row. The existing snapshots don't move, and every existing `Spell Attack:` / `Save DC:` line is unchanged unless its fixture carries an active `spell-attacks`/`spell-save-dc` modifier.
- [ ] **Step 7: Commit** `feat(character): list attack spells and damaging cantrips under ACTIONS`.

---

### Task 6: Save-advantage lines

**Files:**
- Modify: `src/tools/character/stats.ts` (`Stats`, `computeStats`, `formatStatsBlock`); `src/tools/character/actions.ts` (export a name map)
- Create: `tests/combat-save-advantages.test.ts`

**Interfaces:**
- Produces, in `actions.ts`:
  - `export function grantingEntityNames(char: CharData, classes: readonly ClassEntry[]): Map<string, string>`. Same keys as `grantingEntities` (`entityKey`), value = the definition's trimmed `name`.
  - `export const entityKey` (now exported).
- Produces, in `stats.ts`:
  - `export function buildSaveAdvantageLines(core: CoreStats): string[]`;
  - `Stats.saveAdvantages: string[]`.
- Rules:
  - Source: modifiers with `type` `advantage` or `disadvantage` and `subType` `saving-throws` or `<ability>-saving-throws`, read per bucket from `core.char.modifiers` (`Object.entries`, each modifier kept with its bucket name; null entries skipped). Not `core.allMods`: it flattens the buckets (`core.ts:53`), and the homebrew fallback below needs each modifier's bucket.
  - **Item gate:** a modifier counts only when `isActiveItemMod(m, core.inventory)` (Task 5) is true.
  - Group by (kind, trimmed restriction); an empty restriction groups by the granting entity's name instead.
  - Abilities print in STR…CHA order; any `saving-throws` member makes the group `all saves`.
  - Line formats:
    - `  Advantage (all saves): against being charmed`
    - `  Advantage (INT, WIS, CHA): Gnomish Cunning` (the empty-restriction case)
    - `  Disadvantage (DEX): …`
  - A group is wrapped whole when **any** member's granting entity is homebrew (`grantingEntities`). A member whose entity can't be resolved falls back to `bucketAnyHomebrew(char, classes, <its modifiers bucket>)` (export it from `actions.ts`). Identical lines are deduped.
  - `formatStatsBlock` prints the lines after the saves line and before `  (* proficient)`.

- [ ] **Step 1: Write the failing tests** in `tests/combat-save-advantages.test.ts`:
  - `prints an all-saves advantage with its condition`: race mod `advantage saving-throws`, restriction `against being charmed` → `  Advantage (all saves): against being charmed`.
  - `merges per-ability mods sharing a restriction`: three race mods (INT/WIS/CHA, `Against Magic`) → `  Advantage (INT, WIS, CHA): Against Magic`.
  - `names the granting trait when the restriction is empty`: Gnomish Cunning trait (id 13856121, RACIAL_TRAIT) + three empty-restriction mods → `  Advantage (INT, WIS, CHA): Gnomish Cunning`.
  - `trims the restriction`: `" unless you are Incapacitated."` → `  Advantage (DEX): unless you are Incapacitated.`.
  - `prints disadvantage too`.
  - `gates item mods`:
    - unequipped item → no line;
    - equipped, `canAttune: true`, not attuned → no line;
    - equipped and attuned → line;
    - two copies, only the second equipped and attuned → line.
  - `prints the same lines in summary, combat and full`.
  - `wraps a homebrew trait's line whole; an official one stays plain`.
  - `wraps a line whose granting entity is unresolved when its bucket holds homebrew`: a race mod with an unknown componentId on a homebrew race.
  - `adds nothing when there are no advantage mods`: SAVING THROWS block equals today's output.

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and update the snapshot if it moves. Expected: green.
- [ ] **Step 5: Commit** `feat(character): show save advantages under SAVING THROWS`.

---

### Task 7: Live verification and docs

**Files:**
- Modify:
  - `docs/claude/tool-notes.md` (parseCharacterData: combat block contents and rules, the monk/Unarmed Fighting limitation);
  - `docs/character-refactor.md` (the new `spell-attacks.ts` module);
  - `docs/claude/history.md` ("Regression run 2026-11-06": I1–I3 done with commits; new carry-overs: custom item names `characterValues` typeId 8, subclass always-prepared spells absent from the character JSON, global save bonus lacks item gating, proficiency-bonus uses (`useProficiencyBonus`) missing from LIMITED USE, feature dice omitted where D&D Beyond's data adds an ability modifier);
  - `CLAUDE.md` (open-work handover now `B11, B12, I4, I5`);
  - `README.md` (only if it shows a combat block sample).

Every command in this task starts with `V=/tmp/ddb-combat-verify;` (shells don't keep variables between calls; see Task 0).

- [ ] **Step 1: Dump the after state**: `V=/tmp/ddb-combat-verify; npm run build && node "$V/dump.mjs" dist "$V/json" "$V/after" && diff -r "$V/before" "$V/after" > "$V/diff.txt"`. `diff` exits 1 when there are differences, which is expected here.

- [ ] **Step 2: Classify every diff line.** Each must be one of:
  - a new save-advantage, Unarmed Strike, spell, action-feature, OTHER or off-hand line;
  - dice appended to an existing action line;
  - nothing appearing for Ehsu 42519628's `Deft Explorer: Tireless` entries;
  - one of the 11 removed lines (7 BONUS ACTIONS: Steady Aim on Dunil 112305786 and Laena 26158232, Harness Divine Power on Cathartic 112305147, Sister Baronessa 39876541, Elona Silverflame 49053647 and Zayda Snaketooth 49128422, Nature's Veil on Ehsu Ferncraig 42519628; 4 LIMITED USE: Harness Divine Power on those four);
  - Ezra 127373542's `×2 Dagger, +1` split;
  - the two SPELLS corrections: Orion 152720684 `Spell Attack: +6` → `+8`; Sister Baronessa 39876541 `+8` / `Save DC: 16` → `+9` / `17`.

  Also check that no number changed on an existing line, that `V=/tmp/ddb-combat-verify; grep -l "Circle Spell" "$V/after"/*` finds nothing, and that `V=/tmp/ddb-combat-verify; grep -lE "NaN|undefined|\[object Object\]|range 0 ft\." "$V/after"/*` finds nothing.

  Expected counts (spec table): save-advantage lines on 28 characters, spell rows on 29 (56 rows), action features on 17, OTHER on up to 37 (fewer once unchosen features are hidden), Unarmed Strike on 56. Explain any deviation before going on.

- [ ] **Step 3: Spot-check against the website values** in the spec's Verification section:
  - Calderax 14814039: Guiding Bolt `+9`, Sear Undead `1d8`, no Initiate a Circle Spell, CON concentration advantage line.
  - Weslocke 112317699: `2 beams × 1d10+4`, Witch Bolt `+8` `5d12`, Create Pact Weapon.
  - Ezra 127373542: Sneak Attack `3d6` in OTHER, off-hand `+9` `1d4+1`, Steady Aim kept, "against being frightened".
  - Shadowheart 107609898: Guiding Bolt `+5 4d6`, Inflict Wounds `+5 3d10`, Blessing of the Trickster, Sacred Flame present.
  - Dunil 112305786: Sneak Attack `5d6`, no Steady Aim.

  Any mismatch is a bug in the owning task: fix it there, with a test.

- [ ] **Step 4: Update the docs listed above.**

- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all green.

- [ ] **Step 6: Commit** `docs: record the combat section completeness work`.
