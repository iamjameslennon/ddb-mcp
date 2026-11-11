# Regression Remediation (2026-11-11 run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every 🔴/🟠/🟡/⚪ finding of the 2026-11-11 regression run (F1–F28), under the owner rulings of 2026-11-11, without changing any earlier ruled behaviour.

**Architecture:** Most fixes are local to one character-parser domain module (`src/tools/character/*`) or one catalog module (`src/tools/reference.ts`, `src/open5e.ts`, `src/tools/monster.ts`, `src/tools/library.ts`). Shared fuzzy name matching moves into `src/name-match.ts`, so the character lookup (F2) and the monster closest-hit rule (F25) use one implementation. Each task is TDD against hand-built fixtures in `tests/`. The plan was written against the live JSON of the test characters, so every expected value below is D&D Beyond's, not a guess.

**Tech Stack:** TypeScript (ESM, Node ≥22), vitest, zod (tool schemas in `src/server.ts`).

**Spec:** `docs/superpowers/specs/2026-11-11-regression-report.md` (the run's report, moved there in Setup), plus the owner rulings below. Read `CLAUDE.md`, `docs/claude/tool-notes.md` and `docs/character-refactor.md` (regression layers) before starting.

## Owner rulings 2026-11-11 (recorded in `docs/claude/history.md` in the Setup commit)

- **R1 (F4):** chosen class options are appended to their parent class-feature line (`• Fighting Style (Fighter 1): Archery`). `ddb_character_lookup` resolves each option by name.
- **R2 (F10, narrowed after review):** EQUIPPED lists equipped armour (with its `(AC n)`) plus equipped items that are magic or attunable (`definition.magic === true || definition.canAttune === true`). Mundane equipped gear (Backpack, Pouch, Arrows: 47 of the 70 equipped non-weapon items on the test characters) stays in INVENTORY. The attunement line names the attuned items: `ATTUNEMENT (1/3): Staff of the Woodlands`.
- **R5 (F28):** Dueling follows dndbeyond.com: +2 on every one-handed melee row (Ethelrede, with two unflagged battleaxes, shows it on both). The exception is a sheet that flags an off-hand weapon (`characterValues` typeId 18). Then no row gets Dueling, because the rule requires no other weapon.
- **R6 (F4 lookup):** a chosen option's Rules line uses the option's own source (`editions.info(option.definition)`, so Eldritch Smite reads Xanathar's Guide to Everything). It falls back to the owning subclass or class when the option has no `sourceId`. Class features keep their existing ruling (the owning class's or subclass's book).
- **R3 (F25):** `ddb_get_monster` takes D&D Beyond's top fuzzy hit only when it is *close* to the query. Otherwise it replies "not found" with near matches. A close pick says so on its own line.
- **R4 (F22):** `source: "br-2024"` for spells, feats, species, classes and backgrounds replies with a redirect to `phb-2024`. D&D Beyond tags none of those entries with source 148. Verified on all 57 fetched test characters: 2024 spells, feats, species (18), backgrounds (19) and classes (21) carry only 145. Items do carry 148 (437 inventory entries), so equipment is unchanged.

## Investigation results the plan relies on (verified 2026-11-11 against live character JSON)

- **F3:** Archery is a class modifier `{type:"bonus", subType:"ranged-weapon-attacks", value:2, componentTypeId:258900837 (option), componentId:<option id>}`.
- **F28:** Dueling **does** have a modifier, despite the report: `{type:"damage", subType:"one-handed-melee-attacks", value:2, componentTypeId:258900837}`, with no dice.
- **F11:** the pact weapon is `characterValues` `{typeId:28, value:true, valueId:"<inventory id>"}`. Typed as a string, as the off-hand flag (typeId 18) is.
- **F12:** the Pistol is `categoryId:2` with a property named `"Ammunition (Firearms)"`. The proficiency modifier is `subType:"firearms"`, `entityTypeId:660121713` (weapon category).
- **F6:** Eric's mastery modifier is `push-heavy-crossbow`, but the weapon's `type` is `"Crossbow, Heavy"`, so `slug(type)` is `crossbow-heavy`.
- **F13:** the Net is `damage:null, fixedDamage:0`.
- **F7:** proficiency modifiers carry `entityTypeId` 1782728300 (weapon) or 660121713 (weapon category). Tools carry 2103445194.
- **F8:** every stat-based `limitedUse` in the corpus has `operator:1`. Bardic Inspiration, Hunter’s Sense, Magical Tinkering, Flash of Genius, Eyes of the Grave and Sentinel at Death’s Door have `{maxUses:0, statModifierUsesId:N}`, and each rule says "minimum of once". **Divine Sense is `{maxUses:1, statModifierUsesId:6}` (1 + CHA)**. Today's `maxUses > 0` branch prints it as "1 max" (Elona 49053647 should read 4).
- **F5:** feat snippets use `{{2*characterlevel}}` (Tough). Class text uses `modifier:cha`, `savedc:wis`, `spellattack:int`, `@min:1`, `@roundup`, parentheses and `abilityscore:str`.
- **F9:** subclass features also appear in `classes[].classFeatures`, with `definition.classId` equal to the **subclass** id (Dread Ambusher: classId 108 = Gloom Stalker, sourceId 27). The class loop finds them first and labels them with the class's book.
- **F19:** D&D Beyond *is* searched first. "(SRD only)" is Open5e's wording, printed after both sources come back empty. It is a wording bug, not a scope bug.
- **F21:** the hidden-twin count is by design (`countFilteredPicks`, `src/edition.ts:496`). The bug is the prerequisite text match: "Strength 13" against "Str or Dex 13+" and "Strength or Dexterity 13+".
- **F15:** "HalfCover" is a typo in Open5e's own data (`tests/fixtures/open5e-v2/srd-2024/rulesets.json`). Task 13 repairs it with one narrow replacement. The report's "**more** **than on" is the report truncating its own quote; the data reads `**more** **than one target**`.
- **F11, CHA attacks:** no test character uses CHA for pact or hex weapon attacks. Weslocke is a 2014 Fiend; the site's +8 = DEX +3 + prof +4 + 1. 2024 Pact of the Blade and the 2014 Hexblade's Hex Warrior allow CHA, but no data shape for them is verified, so that is carry-over **(br)**, opened in Task 17.
- **F7 side effect:** `darts` carries entityTypeId 2103445194 (a tool: the gaming set). Today's regex files it under Weapons; Task 3 fixes that too.
- **F22 reach:** 2024 class features carry only 145 as well (439 features checked). The br-2024 redirect also covers `ddb_search_class_features` and `ddb_search_racial_traits`.
- **The "br-2024" source** resolves to ids 148, 211, 213 and 214 (premade-character sources share its URL). `ResolvedSource` is `{query, ids, book}`, so slug checks need the `SourceIndex`.

## Global Constraints

- Run `npm run typecheck && npm run lint && npm test` before every commit, and get all three green.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to `main` (owner's standing rule) but **do not push** unless the owner asks.
- Earlier owner rulings stand (CLAUDE.md "Owner rulings are recorded with dates"). In particular:
  - Weapon mastery stays hidden on sheets without the Weapon Mastery feature (B6).
  - Disguised feats stay counted.
  - `countFilteredPicks` hidden counts are unchanged.
  - Class features take the owning class's or subclass's definition for their Rules line.
- **Untrusted text:** every new output line that contains user-authorable text is wrapped whole, with `wrapIfHomebrew` / `wrapUntrusted`. That covers option names, attuned item names, near-match monster names and character names. Official `isHomebrew: false` content stays plain, and tests assert both.
- No tool builds edition label text itself. Rules lines come from `rulesLine` / `editionTag` in `src/edition.ts`.
- Snapshot updates (`tests/__snapshots__`) are deliberate. Run `npx vitest run tests/character-snapshot.test.ts -u` only in the task that changes that output, and read the diff before committing.
- **Regression skill sync:** a task that changes a tool description, a tool parameter or an owner-ruled behaviour updates `skills/ddb-mcp-regression/references/` (`intended-behaviour.md`, `coverage-matrix.md`, `known-open-issues.md`) **in the same commit**.
- **Character-sheet changes:** before Task 1, capture `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/before.txt"` (needs `ddb_login`). Task 17 diffs against it and runs the whole-corpus script. Every difference must be one this plan intends.

## Review Focus

1. **Hidden options:** an option under a class feature the character hasn't reached must neither add a bonus (Task 1) nor appear on the sheet (Task 7). Gate with `hiddenOptionIds` / `isVisibleAction` exactly as `buildSaveAdvantageLines` does.
2. **Inactive items:** an item-bucket attack or damage modifier from an unequipped, or unattuned-but-requires-attunement, item must not apply. Gate with `isActiveItemMod` (Task 1 test).
3. **Looser lookup matching:** it must not turn unrelated names into hits.
   - "fire bolt" must not match "Eldritch Blast".
   - A query with no word of 3+ letters ("ki", "ac", "of the") must use substring matching only. Simulated over 39 characters, the vacuous rule took "ki" from 6 to 51 hits on 145415789.
   - Task 8 negative tests cover both.
4. **Library failures:** when the library list can't be fetched (outage, or a session change other than `SessionChangedError`), reading a book you own must work as today, by slug **and by title**. Only a positive "not in your library" answer blocks a read (Task 16 tests).
5. **Homebrew in new lines:** these are wrapped when homebrew, and plain when official (tests in Tasks 6, 7, 9, 12, 14):
   - an attuned homebrew item;
   - a homebrew option name;
   - a homebrew "Also matches" spell or item name;
   - a homebrew near-match monster name;
   - ambiguous character names, where the whole header line is wrapped.

---

## Setup (one commit, before Task 1)

- [ ] Move the report: `mv ddb-mcp-regression-2026-11-11.md docs/superpowers/specs/2026-11-11-regression-report.md`.
- [ ] Record rulings R1–R6 (dated 2026-11-11) under a new "Regression remediation 2026-11-11" heading in `docs/claude/history.md`, and add them to `skills/ddb-mcp-regression/references/intended-behaviour.md`.
- [ ] Commit it with this plan: `git add docs/superpowers/specs/2026-11-11-regression-report.md docs/superpowers/plans/2026-11-11-regression-remediation.md docs/claude/history.md skills/ddb-mcp-regression/references/intended-behaviour.md && git commit -m "docs: 2026-11-11 regression report, owner rulings R1–R6 and remediation plan"`.
- [ ] Capture the live baseline: `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/before.txt"`. If no session is saved, ask the owner to run `ddb_login`.
- [ ] Build a baseline `dist/` for Task 17's whole-corpus diff: `git worktree add "$TMPDIR/ddb-base" HEAD && (cd "$TMPDIR/ddb-base" && npm ci && npm run build)`. Diffing against npm 2.10.2 would mix in 324 unreleased commits.

---

### Task 1: Weapon attack and damage bonuses — Archery, Dueling, pact weapon, Firearms (F3, F28, F11, F12)

**Files:**
- Modify: `src/tools/character/weapons.ts`
- Test: `tests/combat-weapon-bonuses.test.ts` (new)

**Interfaces:**
- Produces (in `weapons.ts`):
  - `export const OFF_HAND_VALUE_TYPE = 18; export const PACT_WEAPON_VALUE_TYPE = 28;`
  - `export function flaggedItemIds(char: CharData, typeId: number): Set<number>`: the current `offHandItemIds` body, parameterised. `offHandItemIds(char)` stays exported as `flaggedItemIds(char, OFF_HAND_VALUE_TYPE)`.
  - `export function weaponModifierBonuses(core: CoreStats): { rangedHit: number; meleeHit: number; oneHandedMeleeDamage: number }`

- [ ] **Step 1: Write the failing tests** in `tests/combat-weapon-bonuses.test.ts`. Reuse the helpers `combat`, `block`, `fighter`, `feature`, `BASE`, `OPTION`, `CLASS_FEATURE`, `ITEM` from `tests/fixtures/combat-helpers.ts`, and a `coreOf` helper as in `tests/combat-offhand.test.ts`. Read every expected number off `core.statMods` and `core.profBonus`, never a literal ability modifier.

```ts
// Fighting Style feature id 191 on the Fighter; Archery option id 1 under it.
const archeryOpt = { componentId: 191, componentTypeId: CLASS_FEATURE, definition: { id: 1, name: "Archery" } };
const archeryMod = { type: "bonus", subType: "ranged-weapon-attacks", value: 2, fixedValue: 2, componentId: 1, componentTypeId: OPTION };
const duelingOpt = { componentId: 191, componentTypeId: CLASS_FEATURE, definition: { id: 3, name: "Dueling" } };
const duelingMod = { type: "damage", subType: "one-handed-melee-attacks", value: 2, fixedValue: 2, componentId: 3, componentTypeId: OPTION };
// The Fighter gets a class feature {id:191, name:"Fighting Style", requiredLevel:1} through fighter({ classFeatures: [...] }).

it("adds Archery's +2 to ranged weapon attack rolls only")
  // Longbow (categoryId 2, attackType 2, 1d8) and Longsword (categoryId 2, attackType 1) equipped; add class modifier {type:"proficiency", subType:"martial-weapons"} (FIGHTER_5 has none).
  // Longbow row: to hit = dexMod + prof + 2; damage = 1d8+dexMod (unchanged). Longsword to hit = strMod + prof (no +2).
it("ignores Archery when its Fighting Style feature is above the class level")
  // Fighting Style requiredLevel 99 → Longbow to hit = dexMod + prof.
it("adds Dueling's +2 to the one-handed damage of a melee weapon, not to the versatile die")
  // Battleaxe 1d8 Versatile notes "1d10": "1d8+{strMod+2} slashing (1d10+{strMod} two-handed)".
it("does not add Dueling to a Two-Handed weapon or a ranged weapon")
  // Greatsword (Two-Handed) and Longbow rows unchanged.
it("adds Dueling to every one-handed melee row when no off-hand is flagged (R5, as dndbeyond.com shows Ethelrede)")
  // Two battleaxes, neither flagged: both rows read "1d8+{strMod+2} … (1d10+{strMod} two-handed)".
it("adds no Dueling to any row when an off-hand weapon is flagged (R5)")
  // Two battleaxes, the second flagged typeId 18: the ACTIONS row and the BONUS ACTIONS row both lack the +2.
it("adds Dueling to the flat bonus only, not to a magic weapon's extra dice")
  // Giant Slayer Battleaxe: grantedModifiers magic +1 and damage 2d6 "additional" (restriction "against giants") →
  // "1d8+{strMod+1+2} slashing (1d10+{strMod+1} two-handed) + 2d6 slashing (against giants)".
it("adds Archery to a weapon with no damage (Net)")
  // Net (damage null, fixedDamage 0, attackType 2) with Archery: to hit = dexMod + prof + 2 (martial proficiency present).
it("applies an equipped item's weapon-attack bonus and ignores an unequipped one's")
  // modifiers.item: {type:"bonus", subType:"ranged-weapon-attacks", value:1, componentId:<item def id>, componentTypeId: ITEM}:
  // with that item equipped → Longbow +1; with equipped:false → unchanged.
it("skips a weapon-attack modifier that carries a restriction")
  // Same item modifier with restriction "against undead" → Longbow unchanged (a conditional bonus is not added unconditionally).
it("gives proficiency with the pact weapon")
  // No martial proficiency; Shortsword, +1 (inventory id 636554434, type "Shortsword", categoryId 2, properties Finesse + Light, magic +1) flagged
  // characterValues {typeId:28, value:true, valueId:"636554434"}: to hit = max(str,dex) + prof + 1.
  // An unflagged second Shortsword stays non-proficient.
it("does not merge a pact-flagged weapon with an unflagged copy of the same name")
  // Two plain "Shortsword" entries, the first flagged typeId 28 → two rows with different to-hit, no "×2".
it("applies Firearms proficiency to a weapon with the Ammunition (Firearms) property")
  // modifiers.class {type:"proficiency", subType:"firearms", entityTypeId:660121713}; Pistol categoryId 2,
  // properties [{name:"Ammunition (Firearms)"},{name:"Loading"}], attackType 2, 1d10: to hit = dexMod + prof.
  // Without the firearms modifier: to hit = dexMod.
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run tests/combat-weapon-bonuses.test.ts`. Expected: the Archery, Dueling, pact and Firearms cases FAIL. The "unchanged" cases pass.

- [ ] **Step 3: Implement `weaponModifierBonuses(core)`.**
  - Iterate `Object.entries(obj(core.char.modifiers))` the way `buildSaveAdvantageLines` does (`src/tools/character/stats.ts:425`): treat bucket `subclass` as `class`, then keep a modifier only if `isVisibleAction(bucket, m, visibleIds, hiddenOptions)` and `isActiveItemMod(m, core.inventory)` both hold.
  - Sum `num(m.value ?? m.fixedValue)` as follows:
    - `type "bonus"`: subType `ranged-weapon-attacks` → `rangedHit`; `melee-weapon-attacks` → `meleeHit`; `weapon-attacks` → both.
    - `type "damage"`: subType `one-handed-melee-attacks` with an empty `obj(m.dice).diceString` → `oneHandedMeleeDamage`.
  - Skip any modifier whose `restriction` is non-empty after trimming. Every live Archery and Dueling modifier has `""`.

- [ ] **Step 4: Use it in `computeWeaponAttacks`.**
  - `hitBonus` adds `isRanged ? rangedHit : meleeHit`. This includes weapons with no damage, such as the Net.
  - The one-handed damage adds `oneHandedMeleeDamage` to the flat bonus (not to extra dice) when the weapon is melee and has no `Two-Handed` property, **and no inventory item is flagged off-hand** (`offHandIds.size === 0`, ruling R5). The versatile two-handed die keeps the plain `dmgBonus`.
  - `isWeaponProficient` gains two more true cases:
    - the item's id is in `flaggedItemIds(core.char, PACT_WEAPON_VALUE_TYPE)`;
    - `weaponProfSlugs.has("firearms")` and a property name equals `"Ammunition (Firearms)"`. The 39 readable test characters have only one firearm, so this is the only verified shape. Note it in tool-notes as the single verified shape.
  - The consolidation key (`weapons.ts:205`) adds the pact flag, so a flagged and an unflagged same-named weapon never merge.
  - Ability choice stays STR/DEX. CHA for pact or hex weapons (2024 Pact of the Blade, 2014 Hex Warrior) is carry-over (br): no live data shape is verified.

- [ ] **Step 5: Run the tests and confirm they pass.** Run: `npx vitest run tests/combat-weapon-bonuses.test.ts tests/combat-offhand.test.ts tests/character-snapshot.test.ts`. Expected: PASS. The snapshots are expected not to change (the three snapshot fixtures have none of these modifiers). If one does change, check that it is an intended bonus before updating it.

- [ ] **Step 6: Update the docs.** Add a "Weapon modifier bonuses" bullet to `docs/claude/tool-notes.md` (parseCharacterData notes). It names:
  - the three bonus subTypes, and that a modifier with a restriction is skipped;
  - the Dueling rule (R5: every one-handed melee row, none when an off-hand is flagged, never the versatile die or extra dice);
  - typeId 28 = pact weapon (proficiency only, CHA is carry-over (br));
  - the Firearms property rule.

- [ ] **Step 7: Commit.** Run `npm run typecheck && npm run lint && npm test`, then `git add -A src/tools/character/weapons.ts tests/combat-weapon-bonuses.test.ts docs/claude/tool-notes.md && git commit -m "fix(character): apply Archery, Dueling, pact weapon and Firearms to weapon rows (F3, F28, F11, F12)"`.

---

### Task 2: Weapon row details — mastery on reordered names, no-damage weapons (F6, F13)

**Files:**
- Modify: `src/tools/character/weapons.ts`
- Test: `tests/combat-weapon-bonuses.test.ts` (extend)

- [ ] **Step 1: Write the failing tests.**

```ts
it("shows the mastery of a weapon whose type D&D Beyond writes 'X, Y'")
  // feat modifier {type:"weapon-mastery", subType:"push-heavy-crossbow"}; equipped "Crossbow, Heavy" (type "Crossbow, Heavy",
  // properties [...,{name:"Push"}]) → row ends with "Push". (A Weapon Mastery class feature is present, per ruling B6.)
it("prints 'no damage' for a weapon with no damage dice and no fixed damage")
  // Net: damage null, fixedDamage 0, attackType 2, range 5/15, properties Special, Thrown →
  // row matches /• Net\s+\+\d+ to hit   no damage   range 5\/15 ft\.   Special, Thrown/, and no "bludgeoning".
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/combat-weapon-bonuses.test.ts`. Expected: these two FAIL.

- [ ] **Step 3: Implement.**
  - `mastered(name)` accepts `${slug(name)}-${slug(t)}` for `t` in both `str(def.type) || wName` and `weaponWordOrder(str(def.type) || wName)`. For "Crossbow, Heavy" the second gives `push-heavy-crossbow`; for a comma-free type both are the same key, so a Longsword's `sap-longsword` still matches (keep the existing Longsword/Dagger mastery tests green).
  - When `dmgDice === ""`, `num(def.fixedDamage) === 0` and `extraDice === ""`, `dmgStr` is `"no damage"`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run tests/combat-weapon-bonuses.test.ts tests/combat-*.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** Run the three checks, then commit with `fix(character): mastery on 'X, Y' weapon types and no-damage weapons (F6, F13)`.

---

### Task 3: Weapon proficiencies listed under Tools (F7)

**Files:**
- Modify: `src/tools/character/stats.ts` (`computeProficiencies`)
- Test: `tests/character-parser.test.ts` (add a `describe("proficiency routing")`)

- [ ] **Step 1: Write the failing test.** Class modifiers:
  - `{type:"proficiency", subType:"weighted-chain", friendlySubtypeName:"Weighted Chain", entityTypeId:1782728300}`
  - `{… subType:"bola", friendlySubtypeName:"Bola", entityTypeId:1782728300}`
  - `{… subType:"firearms", friendlySubtypeName:"Firearms", entityTypeId:660121713}`
  - `{… subType:"thieves-tools", friendlySubtypeName:"Thieves' Tools", entityTypeId:2103445194}`

  - `{… subType:"darts", friendlySubtypeName:"Darts", entityTypeId:2103445194}` (the gaming set)
  - `{… subType:"dagger", friendlySubtypeName:"Dagger"}` (no entityTypeId)

  Assert that the summary's Weapons line contains `Weighted Chain`, `Bola`, `Firearms` and `Dagger`, and that its Tools line contains `Thieves' Tools` and `Darts`. Any other `entityTypeId` keeps today's routing.
- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run tests/character-parser.test.ts -t "proficiency routing"`. Expected: FAIL (the three weapons land under Tools, Darts under Weapons).
- [ ] **Step 3: Implement.** A proficiency with `m.entityTypeId` 1782728300 or 660121713 is a weapon. One with 2103445194 is a tool. Any other value, or none, falls back to the `isWeaponSlug` regex as today. Name them `WEAPON_ENTITY_TYPES` / `TOOL_ENTITY_TYPE`, with a comment citing the live ids.
- [ ] **Step 4: Run the test and confirm it passes.** Run `npx vitest run tests/character-parser.test.ts tests/character-snapshot.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Run the checks, then commit with `fix(character): route weapon proficiencies by entityTypeId (F7)`.

---

### Task 4: Limited-use maximum from an ability modifier (F8)

**Files:**
- Modify: `src/tools/character/actions.ts` (`buildLimitedUseLines`)
- Test: `tests/combat-features.test.ts` (extend)

- [ ] **Step 1: Write the failing tests.**
  - A class action "Bardic Inspiration" with `limitedUse {maxUses:0, statModifierUsesId:6, operator:1, numberUsed:1, resetType:2}`, and CHA 16 in `stats` → the LIMITED USE line is `• Bardic Inspiration   1 used / 3 max   (Long Rest)`. With CHA 8 → `… / 1 max …` (minimum of once).
  - "Divine Sense" `{maxUses:1, statModifierUsesId:6, operator:1}` with CHA 16 → `/ 4 max`. Today it prints "1 max", because the `maxUses > 0` branch runs first.
  - The same shape with `operator: 2` → `/ ? max`. No other operator appears in the corpus, so it is not guessed.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/combat-features.test.ts`. Expected: FAIL (`+3 (stat)` and `1 max`).
- [ ] **Step 3: Implement.** Check `statModifierUsesId` **before** the `maxUses > 0` branch.
  - With `operator === 1` (or absent), `maxStr = String(Math.max(1, num(lu.maxUses) + statMods[id - 1]))`. The minimum of 1 is each corpus feature's own rule ("minimum of once"; Divine Sense is 1 + CHA).
  - Any other operator, or an id outside 1–6, gives `"?"`.
  - `maxUses > 0` without a stat stays as today.
- [ ] **Step 4: Run the test and confirm it passes.** Run the same file plus `tests/character-snapshot.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Commit with `fix(character): numeric limited-use maximum from an ability modifier (F8)`.

---

### Task 5: D&D Beyond description templates (F5)

**Files:**
- Modify: `src/tools/character/templates.ts`, `src/tools/character/core.ts:148`, `src/tools/reference.ts` (feat search lines and feat detail)
- Test: `tests/templates.test.ts` (new), `tests/edition-search.test.ts` or the existing feat-search test file (one assertion)

**Interfaces:**
- Produces:
  - `export interface TemplateContext { profBonus: number; totalLevel: number; statMods: readonly number[]; statTotals: readonly number[] }`
  - `export function makeResolveTemplates(ctx: TemplateContext): TemplateResolver` (the signature changes; `core.ts` passes `{ profBonus, totalLevel, statMods, statTotals }`)
  - `export function describeTemplates(text: string): string`: for catalog text with no character.

- [ ] **Step 1: Write the failing tests** in `tests/templates.test.ts`. `ctx = { profBonus: 2, totalLevel: 1, statMods: [3,1,2,0,1,-1], statTotals: [16,12,14,10,12,8] }`, `classLevel` 5 where used.

```ts
expect(r("increases by {{2*characterlevel}}.")).toBe("increases by 2.");
expect(r("{{characterlevel*2}}")).toBe("2");
expect(r("{{proficiency#signed}}")).toBe("+2");
expect(r("{{modifier:cha@min:1#unsigned}}")).toBe("1");          // −1 floored to 1
expect(r("DC {{savedc:wis}}")).toBe("DC 11");                       // 8 + 2 + 1
expect(r("{{spellattack:str}}")).toBe("5");
expect(r("{{(classlevel/2)@roundup}}", 5)).toBe("3");
expect(r("{{(classlevel/2)@rounddown}}", 5)).toBe("2");
expect(r("{{10+modifier:dex+modifier:con#unsigned}}")).toBe("13");
expect(r("{{abilityscore:str}}")).toBe("16");
expect(r("{{scalevalue}}")).toBe("?");                              // unresolvable stays "?"
expect(describeTemplates("add {{proficiency#signed}} to the roll")).toBe("add your Proficiency Bonus to the roll");
expect(describeTemplates("by {{2*characterlevel}}")).toBe("by twice your character level");
expect(describeTemplates("{{3*classlevel}}")).toBe("3 × your class level");
expect(r("{{modifier:cha}}")).toBe("-1");                          // a negative intermediate without @min stays negative
expect(describeTemplates("{{(modifier:cha+classlevel)@min:1}}")).toBe("a value based on your character");
```

  Add one search test: a DDB feat whose snippet is `"add {{proficiency#signed}} to the roll"` lists without `{{`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/templates.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the evaluator** (a small recursive-descent parser; this is an algorithm the tests don't fully fix):
  - Grammar: `expr := term (('+'|'-') term)*`, `term := factor (('*'|'/') factor)*`, `factor := (number | var | '(' expr ')') postfix*`, `postfix := '@min:' number | '@max:' number | '@roundup' | '@rounddown'`.
  - Variables:
    - `proficiency`, `level`, `characterlevel`, `classlevel`;
    - `modifier:<abbr>`, `savedc:<abbr>` (8 + prof + mod), `spellattack:<abbr>` (prof + mod), `abilityscore:<abbr>`, where `<abbr>` ∈ str dex con int wis cha.
  - `statMods` and `statTotals` are indexed str=0 … cha=5, as `statKeys` in `helpers.ts`.
  - Division is exact. `@roundup` / `@rounddown` round the factor they follow (ceil / floor). `@min` / `@max` clamp the factor they follow.
  - Then the final value is floored (`Math.floor`, so −1.5 → −2), and only after that do `#signed` / `#unsigned` format it.
  - Any parse failure or unknown variable gives `"?"`.
  - `describeTemplates`:
    - a lone variable → its phrase ("your Proficiency Bonus", "your character level", "your class level", "your Charisma modifier", "your Wisdom save DC", "your Intelligence spell attack bonus", "your Strength score");
    - `2*var` or `var*2` → `twice <phrase>` (the 2024 Tough text says "twice your character level");
    - `N*var` or `var*N` with other N → `N × <phrase>`;
    - anything else → `a value based on your character`.

- [ ] **Step 4: Wire it up.** In `reference.ts`, run feat snippets and descriptions through `describeTemplates`: the search line (`clip(feat.snippet || feat.description, 100)` → describe first, then clip) and the DDB feat detail block.

- [ ] **Step 5: Run the tests and confirm they pass.** Run `npx vitest run tests/templates.test.ts tests/character-*.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit.** Commit with `fix: resolve D&D Beyond description templates on sheets and describe them in catalog text (F5)`.

---

### Task 6: Inventory — item separator, EQUIPPED, named attunement (F1, F10; ruling R2)

**Files:**
- Modify: `src/tools/character/inventory.ts`
- Test: `tests/character-parser.test.ts` (inventory describe), `tests/character-untrusted-header.test.ts` (homebrew attuned name), `tests/character-homebrew-lines.test.ts` (pins `ATTUNEMENT: 0/3 slots used` and `Backpack, Torch ×3` at lines ~203 and ~220; update to the new format deliberately)
- Snapshot: `tests/__snapshots__/character-snapshot.test.ts.snap` (deliberate update)

**Interfaces:**
- Changes `Inventory`:
  - `attuned: number` becomes `attunedItems: ListEntry[]` (name, `homebrew` via `shownHomebrew`);
  - `equippedNonWeapons` holds equipped armour plus equipped magic or attunable non-weapons (R2).

- [ ] **Step 1: Write the failing tests.**
  - An inventory of Backpack, `Clothes, Common`, `Rope, Hempen (50 feet)` ×2 → the INVENTORY line is `  Backpack; Clothes, Common; Rope, Hempen (50 feet) ×2`.
  - The items: an equipped `Staff of the Woodlands` (filterType "Other", `magic: true`, `canAttune: true`, `isAttuned: true`); an equipped Chain Shirt (AC 13); an equipped mundane Backpack (`magic: false`, `canAttune: false`); and an equipped, attuned `Longsword, +1` (Weapon):
    - EQUIPPED lists `Chain Shirt (AC 13)` and `Staff of the Woodlands`, and not the Backpack or the Longsword;
    - INVENTORY contains the Backpack and not the Staff;
    - the attunement line is `ATTUNEMENT (2/3): Staff of the Woodlands; Longsword, +1`;
    - the Longsword still has its ACTIONS row.
  - Nothing attuned → `ATTUNEMENT (0/3): none`.
  - A homebrew attuned item → the whole ATTUNEMENT line is `wrapUntrusted(...)`. With only official items it isn't wrapped.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/character-parser.test.ts tests/character-untrusted-header.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Join with `"; "`.
  - An `equipped` item goes to `equippedNonWeapons` when its `filterType` is `"Armor"` (keeps ` (AC n)`), or when it is not a Weapon and `def.magic === true || def.canAttune === true`. Every other non-weapon stays in INVENTORY.
  - `attunedItems` comes from every `isAttuned` inventory entry, weapons included, in inventory order.
  - The format is `ATTUNEMENT (${n}/3): ${names.join("; ") || "none"}`, wrapped whole if any entry is homebrew.
- [ ] **Step 4: Update the snapshot deliberately.** Run `npx vitest run tests/character-snapshot.test.ts -u`, then read the diff. It may change only these: the INVENTORY separator, magic or attunable equipped items moving from INVENTORY to EQUIPPED, and the ATTUNEMENT line.
- [ ] **Step 5: Run everything.** Run `npm test`. Expected: PASS.
- [ ] **Step 6: Record the ruling and commit.** Update the inventory bullet in `docs/claude/tool-notes.md` (R2 is already in `intended-behaviour.md` since Setup). Commit with `fix(character): unambiguous inventory separator, equipped magic items, named attunement (F1, F10)`.

---

### Task 7: Chosen class options on the sheet and in lookup (F4; ruling R1)

**Files:**
- Modify: `src/tools/character/actions.ts` (new export beside `hiddenOptionIds`), `src/tools/character/features.ts` (`computeFeatures`, `buildClassFeatureLines`), `src/tools/character/parse.ts` (passes the map), `src/tools/character/definition.ts` (`searchDefinitions`)
- Test: `tests/character-lookup.test.ts`, `tests/character-parser.test.ts` (features describe)
- Skill: `skills/ddb-mcp-regression/references/intended-behaviour.md` (R1)

**Interfaces:**
- Produces (in `actions.ts`, beside `hiddenOptionIds`, because `actions.ts` already imports `features.ts` and the reverse import would make a cycle): `export type ChosenOptions = Map<number, Array<{ name: string; definition: Record<string, unknown>; homebrew: boolean }>>` and `export function chosenClassOptions(char: CharData, classes: readonly ClassEntry[]): ChosenOptions`. The map is keyed by parent class-feature definition id. Keep only options with `componentTypeId === CLASS_FEATURE_TYPE` that are not in `hiddenOptionIds(char, visibleClassFeatureIds(char, classes))`, from **`options.class` only**.
- `computeFeatures(core: CoreStats, options: ChosenOptions)`: `parse.ts` computes the map and passes it in, and `buildClassFeatureLines(classes, options)` reads it. `features.ts` imports only the `ChosenOptions` *type* (`import type`, erased at runtime, so no cycle). `definition.ts` imports `chosenClassOptions` directly.

- [ ] **Step 1: Write the failing tests.**
  - The Fighter with feature `{id:191, name:"Fighting Style", requiredLevel:1}` and `options.class: [Archery under 191]` → the features section has `• Fighting Style (Fighter 1): Archery`.
  - A Warlock 5 with "Eldritch Invocations" (id 400, level 2) holding options Agonizing Blast and Devil’s Sight, and "Pact Boon" (id 401, level 3) holding Pact of the Blade → `• Eldritch Invocations (Warlock 2): Agonizing Blast, Devil’s Sight` and `• Pact Boon (Warlock 3): Pact of the Blade`.
  - An option under a feature above the class level appears nowhere.
  - A homebrew option (`definition.isHomebrew: true`) → the whole line is wrapped. An official one isn't. `homebrew` is set through `isHomebrewEntry(option)`, the single predicate.
  - Lookup: `formatCharacterLookup(char, "Agonizing Blast", INDEX)` starts with `[Class Option]` and its first line is `Agonizing Blast (Eldritch Invocations, Warlock)`.
  - Lookup, R6: Eldritch Smite (option `sourceId: 27`) → `Rules: 2014 · Xanathar's Guide to Everything`, although the Warlock class is sourceId 1. An option with no `sourceId` → the owning class's line.
  - Lookup of the parent: "Fighting Style" on the Archery fighter → the class-feature hit's text ends with `\n\nChosen: Archery`.
  - Visibility parity with Task 1: an Archery option under a Fighting Style above the class level appears neither on the sheet nor as a lookup hit, and adds no bonus.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/character-lookup.test.ts tests/character-parser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `chosenClassOptions`.
  - Append `: ${names.join(", ")}` to the parent's line.
  - Wrap the line when the feature or any of its options is homebrew.
  - Lookup gets a `Class Option` section after class features.
    - `text`: ``${name} (${parentName}, ${className})\n\n${stripHtml(description)}``.
    - `info`: `editions.info(option.definition)` when `entrySourceIds(option.definition).length > 0`, else the owning class's `classifyEdition(classDef, index)` (R6).
    - `untrusted`: `homebrew`.
  - A class-feature hit whose feature has chosen options appends `\n\nChosen: ${names.join(", ")}`.
  - An option whose parent feature is not printed (Ehsu's Canny, Roving and Tireless sit under an optional class feature not in `classes[].classFeatures`) is still found by lookup, but adds nothing to the sheet. That matches R1's "under the parent" rule.
- [ ] **Step 4: Update the snapshot deliberately and run.** Run `npx vitest run tests/character-snapshot.test.ts -u` (read the diff), then `npm test`.
- [ ] **Step 5: Record and commit.** Add the R1/R6 behaviour to `tool-notes.md` (features and lookup bullets). Commit with `feat(character): show chosen class options under their feature and resolve them in lookup (F4)`.

---

### Task 8: Lookup name matching and subclass-feature books (F2, F9)

**Files:**
- Modify: `src/name-match.ts`, `src/tools/character/helpers.ts` (re-export), `src/tools/character/definition.ts`
- Test: `tests/name-match.test.ts`, `tests/character-lookup.test.ts`

**Interfaces:**
- Produces (in `src/name-match.ts`):
  - `export function levenshteinDistance(a: string, b: string): number`: moved here from `helpers.ts`, which re-exports it so existing imports keep working.
  - `export function matchesLooseName(name: string, query: string): boolean`: true when either:
    - (a) `nameFold(name).includes(nameFold(query))`; or
    - (b) the query has **at least one** word of 3+ letters (after `nameFold`, ignoring `of`, `the`, `a`, `an`), and every such word is within edit distance `w.length <= 4 ? 1 : 2` of some word of the name.

    A query with no such word ("ki", "ac", "of the") uses rule (a) alone, so rule (b) can't match vacuously. An empty folded query never matches.

- [ ] **Step 1: Write the failing tests.**

```ts
// name-match.test.ts
expect(matchesLooseName("Eldritch Blast", "eldrich blast")).toBe(true);
expect(matchesLooseName("Dark One’s Blessing", "Dark One's Blessing")).toBe(true);
expect(matchesLooseName("Blessing of the Trickster", "trickster blessing")).toBe(true);
expect(matchesLooseName("Stone’s Endurance", "stones endurance")).toBe(true);
expect(matchesLooseName("Shield", "sheild")).toBe(true);
expect(matchesLooseName("Eldritch Blast", "fire bolt")).toBe(false);
expect(matchesLooseName("Bless", "blessing of the trickster")).toBe(false);
expect(matchesLooseName("Anything", "  ")).toBe(false);
expect(matchesLooseName("Backpack", "ki")).toBe(false);       // no 3+ letter word: substring only
expect(matchesLooseName("Ki Points", "ki")).toBe(true);
expect(matchesLooseName("Eldritch Blast", "of the")).toBe(false);
```

  - Lookup, F9: a Ranger (class def id 5, `sources [{sourceId:1}]`) with subclass Gloom Stalker (id 108, `sources [{sourceId:27}]`), and a `classes[].classFeatures` entry Dread Ambusher (`classId:108`, requiredLevel 3) at Ranger 5 → the hit is `[Subclass Feature]` with first line `Dread Ambusher (Ranger / Gloom Stalker, Level 3)` and Rules line `Rules: 2014 · Xanathar's Guide to Everything`.
  - Lookup, regression: a query that matched 4 entries before still prints the `Found 4 matches` list.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/name-match.test.ts tests/character-lookup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `matchesDefinitionQuery` becomes `matchesLooseName` (the old single-word rule is subsumed).
  - In the class loop, a feature with `num(d.classId) === num(subDef.id)` (and a subclass present) is recorded as `Subclass Feature` with `info: editions.info(subDef)` and the `Class / Subclass` label. This is the ruled "owning subclass" rule applied correctly.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Commit with `fix(lookup): typo, word-order and apostrophe tolerant matching; subclass features take the subclass's book (F2, F9)`.

---

### Task 9: Character name that matches several characters (F14)

**Files:**
- Modify: `src/tools/character.ts` (`findCharacterByName`), `src/server.ts` (3 call sites: `ddb_get_character_raw` :214, `ddb_get_character` :281, `ddb_character_lookup` :314; `ddb_download_character` takes only an id)
- Test: `tests/character-name-match.test.ts` (new)

**Interfaces:**
- Produces:
  - `export type CharacterNameMatch = { kind: "found"; id: string; name: string } | { kind: "ambiguous"; candidates: Array<{ id: string; name: string }> } | { kind: "none" }`
  - `export function matchCharacterName(chars: ReadonlyArray<{ id: string; name: string }>, name: string): CharacterNameMatch`: pure, same order as today. Exact, then substring (one → found, several → ambiguous), then Levenshtein ≤3 (one → found, several → ambiguous).
  - `findCharacterByName(name): Promise<CharacterNameMatch>`. A non-OK list response **throws** (`Could not load your character list: <status>`) instead of returning "none", so an outage never reads as "No character found".
  - `export function characterNameError(name: string, m: Exclude<CharacterNameMatch, { kind: "found" }>): string`.
    - `none` gives today's text.
    - `ambiguous` gives `wrapUntrusted(\`Several of your characters match "${name}":\`)` (the whole header line, query echo included). After it comes one `wrapUntrusted(\`  • ${c.name} (ID ${c.id})\`)` line per candidate, and then the plain line `Pass character_id to pick one.`

- [ ] **Step 1: Write the failing tests.**
  - `matchCharacterName([{id:"1",name:"Claude Skamos"},{id:"2",name:"Barakas Skamos"},{id:"3",name:"Therai"}], "Skamos")` → `{kind:"ambiguous", candidates:[…1, …2]}`.
  - `"Thera"` → found 3.
  - `"zzz"` → none.
  - `characterNameError` wraps the whole header line and every candidate line. The closing hint is not wrapped.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run tests/character-name-match.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it and update the three server call sites** to use `characterNameError` with `isError: true`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Commit with `fix: list the candidates when a character name matches several characters (F14)`.

---

### Task 10: Catalog honesty — not-found wording, "(SRD only)", Basic Rules redirect (F18, F19, F22; ruling R4)

**Files:**
- Modify: `src/open5e.ts` (`o5SearchReply` / the option `noMatch` strings), `src/tools/reference.ts` (`getSpell`, `getItem`, the search entry points), `src/source-filter.ts`
- Test: `tests/search-site-open5e.test.ts` or `tests/open5e.test.ts` (no-match wording), `tests/spell-editions.test.ts`, `tests/equipment-editions.test.ts`, `tests/source-filter.test.ts`
- Skill: `references/intended-behaviour.md` (R4)

**Interfaces:**
- Produces (in `source-filter.ts`): `export function basicRules2024Reply(source: ResolvedSource, index: SourceIndex, plural: string): string | null`. It returns non-null when every id in `source.ids` has slug `br-2024`. Use `sourceSlug(index.sources.get(id)!)`; the ids are 148, 211, 213 and 214, and no id is hardcoded. The exact text:
  `D&D Beyond files the Basic Rules (2024) ${plural} under the Player's Handbook (2024), so source "br-2024" matches none. Use source: "phb-2024" — on an account that doesn't own the Player's Handbook, that lists just the free (Basic Rules) ${plural}.`
  The function never decides by kind; each call site chooses to call it. Its JSDoc says not to call it for items or monsters (items carry 148).

- [ ] **Step 1: Write the failing tests.**
  - When D&D Beyond has no match and Open5e has none either (origin `"not-found"`), the reply is `No items found matching the criteria on D&D Beyond or in the SRD.`. The same holds for races, classes, backgrounds, feats and spells, with their plurals. With origin `"unavailable"` (D&D Beyond unreachable, which includes the logged-out paths that can't reach it) the text stays `… (SRD only).`
  - `getSpell("Synaptic Static")` with no DDB or SRD match gives:
    `Spell "Synaptic Static" not found on D&D Beyond or in the SRD. It may be misspelled, or in a book this account doesn't own (D&D Beyond shows only free content and owned books). Try ddb_search_spells with a partial name.`
    `getItem` gets the same text with `Item` and `ddb_search_equipment`. The wording never claims which cause applies: the compendium holds only visible entries, so locked and absent can't be told apart.
  - `searchSpells({ source: "br-2024" })` and `searchFeats`, `searchRaces`, `searchClasses`, `searchBackgrounds`, `searchClassFeatures`, `searchRacialTraits` with `br-2024` → the redirect text (plural "class features" / "racial traits" for the last two). `searchItems({ source: "br-2024", name: "bag" })` still lists items.
  - `getSpell("Shield", "2024", "br-2024")` → the redirect text. The get tools take `source` (`reference.ts:540`).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `o5SearchReply` (and `o5OptionReply`'s no-match path) take the no-match base without its suffix and append ` on D&D Beyond or in the SRD.` for `"not-found"`, or ` (SRD only).` for `"unavailable"`.
  - Call `basicRules2024Reply` right after `resolveSourceParam` in these paths, and never in items or monsters:
    - the spell, feat, race, class and background search **and get** paths;
    - the class-feature and racial-trait searches (2024 class features carry only 145; 439 checked).
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS. Fix pinned strings in existing tests deliberately (grep `SRD only).` in `tests/`).
- [ ] **Step 5: Record and commit.** Record R4 and the new wording in `tool-notes.md` and `intended-behaviour.md`. Commit with `fix(catalog): honest not-found and no-match wording; redirect br-2024 for non-item kinds (F18, F19, F22)`.

---

### Task 11: Source search of a book the account doesn't own (F17)

**Files:**
- Modify: `src/tools/library.ts` (new export), `src/tools/reference.ts` (`searchSpellsSection`, `searchCatalogSection`)
- Test: `tests/library-resolver.test.ts` (pure part), `tests/source-filter.test.ts` or `tests/spell-editions.test.ts` (wiring, with the library mocked)

**Interfaces:**
- Produces (in `library.ts`):
  - `export function isFreeBookSlug(slug: string): boolean`: true for `basic-rules-2014` and `br-2024` (match the last slug segment).
  - `export async function unownedSourceNote(source: ResolvedSource, index: SourceIndex): Promise<string | null>`. It returns null when any of these holds:
    - the caller is logged out;
    - the library fetch throws (rethrow `SessionChangedError` only);
    - any id of `source` is a free book;
    - some library book's `librarySourceId` is in `source.ids`.

    Otherwise it returns `> Note: this account doesn't own ${source.book}, so D&D Beyond shows only its free entries — this list is not the whole book.`

- [ ] **Step 1: Write the failing tests.** With the library mocked to `[Player's Handbook (2024)]`:
  - `xgte` → the note;
  - `phb-2024` → null;
  - `br-2024` → null;
  - a library fetch that throws → null;
  - logged out → null.

  Wiring: `searchSpells({source:"xgte"})` with the note → the body starts with the note, and the existing "source wins over rules_edition" note (`sourceNote`) still prints after it.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Prepend the note to the body of every `source` search except `homebrew`, whether or not the search found anything.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`.
- [ ] **Step 5: Verify live.** Ask the owner to `ddb_login` if needed. Then:
  - `ddb_list_library` shows which books the free account lists, including giveaways history.md says are marked "Owned".
  - `ddb_search_spells({source:"xgte"})` carries the note.
  - `ddb_search_spells({source:"basic-rules-2014", level:1})` doesn't.
  - If a free book that is missing from the library list gets the note, add it to `isFreeBookSlug` with the live evidence in a comment.
- [ ] **Step 6: Commit.** Commit with `fix(catalog): say when a source search covers a book the account doesn't own (F17)`.

---

### Task 12: Spell/item partial-name pick names the other matches (F24) and catalog search text (F20, F21, F23)

**Files:**
- Modify: `src/edition.ts` (`LookupResult`, `lookupByName`), `src/tools/edition-search.ts` (`lookupCatalog` passes it through), `src/tools/reference.ts` (`getSpell`, `getItem`, `clip`, feat search), `src/open5e.ts` (`o5SearchFeatsSection`)
- Create: `src/tools/prerequisite.ts`
- Test: `tests/edition.test.ts`, `tests/spell-editions.test.ts`, `tests/prerequisite.test.ts` (new), the existing feat/option search tests

**Interfaces:**
- `LookupResult<T>` gains `alsoMatches?: Array<{ name: string; homebrew: boolean }>`.
  - It is set only when the partial-match path ran, and attached on **every** return after that branch (`edition.ts` returns at ~460, ~466, ~469 and ~479).
  - It holds up to 5 other twin groups whose name matches the query **at a word start** (`matchesAtWordStart`), one entry per group (the group's tiebreak-first entry), A–Z. `homebrew` comes from that entry's markers (`isHomebrew === true`).
  - `lookupCatalog`'s return value gains the same field.
- `export function prerequisiteMatches(prerequisite: string, query: string): boolean` in `src/tools/prerequisite.ts`.
  - Lower-case both, and expand `str dex con int wis cha` to the full ability names.
  - Tokenize on non-alphanumerics, so `13+` gives `13`.
  - True when every query token is among the prerequisite's tokens, in any order, **or** when the lower-cased prerequisite contains the lower-cased query as a substring. The second keeps today's partial words ("spell" against "Spellcasting or Pact Magic Feature").
  - An empty query is true; a prerequisite of `""` or null with a non-empty query is false.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(prerequisiteMatches("Str or Dex 13+", "Strength 13")).toBe(true);
expect(prerequisiteMatches("Level 4+; Strength or Dexterity 13+", "strength 13")).toBe(true);
expect(prerequisiteMatches("Strength 13 or higher", "Strength 13")).toBe(true);
expect(prerequisiteMatches("Dexterity 13 or higher", "Strength 13")).toBe(false);
expect(prerequisiteMatches("Level 4+", "spellcasting")).toBe(false);
expect(prerequisiteMatches("Spellcasting or Pact Magic Feature", "spell")).toBe(true);   // today's substring behaviour kept
expect(prerequisiteMatches("Str or Dex 13+", "13 strength")).toBe(true);                  // order-free
```

  - `getSpell("Cure")` with Cure Wounds and Mass Cure Wounds in the store → the reply contains `Also matches: Mass Cure Wounds. Ask for one by name.` right after the Rules lines. `getSpell("Cure Wounds")` (exact) → no such line.
  - A homebrew spell among the "also matches" → the whole line is `wrapUntrusted(...)`. With only official names it is plain.
  - Feat search, DDB path: a feat with prerequisite "Str or Dex 13+" is listed for `prerequisite: "Strength 13"`. The Open5e fallback uses the same matcher.
  - The F21 Open5e case (2024 SRD Grappler "Strength or Dexterity 13+", 2014 Grappler "Strength 13 or higher") now lists the 2024 Grappler. Its hidden count is 1, because the 2014 twin still matches: `countFilteredPicks`, unchanged by design.
  - Feat search under `source`: five DDB entries named "Ability Score Improvement" with the same edition tag → one line ending ` ×5`, and the "found" count counts it once.
  - `clip("<h4>Dwarf Traits</h4><p>Darkvision…</p>", 100)` → `Dwarf Traits Darkvision…`. `"Hit Die: d10<br>Primary Ability"` → `Hit Die: d10 Primary Ability`. `"<p>Ability Scores: Intelligence, Wisdom, Charisma</p><p>Feat: Magic Initiate (Cleric)</p>"` → `Ability Scores: Intelligence, Wisdom, Charisma Feat: Magic Initiate (Cleric)`.
  - The F23 collapse keeps different names apart: "Magic Initiate (Cleric)" and "Magic Initiate (Wizard)" stay two lines.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `lookupByName` computes `alsoMatches` in its `else` (partial) branch and attaches it on every later return.
  - `getSpell` and `getItem` print the line when it is non-empty, with `…, and N more` past 5 names. They wrap it whole if any listed entry is homebrew.
  - `clip` replaces `/<\/(p|h[1-6]|li|div|td|th|tr)>|<br\s*\/?>/gi` with `" "` before `stripHtml`, then collapses whitespace.
  - Feat render collapses hits with an identical name and label before `paginateResults`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`.
- [ ] **Step 5: Commit.** Commit with `fix(catalog): name other partial matches, tolerant prerequisite filter, deduped feat rows, readable snippets (F20, F21, F23, F24)`.

---

### Task 13: Rules text and rules search (F15, F16)

**Files:**
- Modify: `src/open5e.ts` (rules search `has()` near line 1446, rule text before returning, `o5GetRule` query landing)
- Test: `tests/open5e.test.ts` (rules describe), using the recorded `tests/fixtures/open5e-v2` rulesets

**Interfaces:**
- Produces (in `open5e.ts`):
  - `export function cleanO5Markdown(text: string): string`
  - `function wordPhraseIndex(text: string, query: string): number`: the index of the first occurrence of the normalized query **as a phrase** on word boundaries (`\b<phrase>(s|es)?\b`, with the query's words regex-escaped and joined by `\s+`) in the normalized text, else −1. Search uses `>= 0`. The query landing uses the index, replacing today's substring index.

- [ ] **Step 1: Write the failing tests.**

```ts
expect(cleanO5Markdown("a blast of flame from a srd:fireball spell")).toBe("a blast of flame from a fireball spell");
expect(cleanO5Markdown("casts srd:flame-strike, the")).toBe("casts flame strike, the");
expect(cleanO5Markdown("modifier---the same")).toBe("modifier—the same");
expect(cleanO5Markdown("|Size|Space|\n|---|---|")).toBe("|Size|Space|\n|---|---|"); // tables untouched
expect(cleanO5Markdown("to **more** **than one target** at")).toBe("to **more than one target** at"); // the data's real form; the report truncated it
expect(cleanO5Markdown("a creature that gives HalfCover and")).toBe("a creature that gives Half Cover and");
expect(wordPhraseIndex("olive-covered hillsides", "cover")).toBe(-1);
expect(wordPhraseIndex("you have half cover", "cover")).toBeGreaterThan(-1);
expect(wordPhraseIndex("fighting with two weapons", "two weapon fighting")).toBe(-1); // a phrase, not a bag of words
```

  - The recorded fixtures hold only Attacking, Cover, Damage and Healing and Madness (2014), and Combat, D20 Tests, Damage and Healing and Social Interaction (2024). So the search test is written against those: run `o5SearchRules("cover", "2014")` against the fixture, then check its result against the substring rule's. Every chapter it drops must have no whole-word "cover", and Cover must still be listed. (Madness is listed only if its text has "cover" as a word; assert whichever the fixture says, and first confirm that the test fails under today's substring rule.)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
  - The `srd:` regex is `/\bsrd:([a-z0-9-]+)/g` → the slug with `-` turned into spaces.
  - `---` is replaced only between non-space, non-`|`, non-`-` characters.
  - Repeat the `**a** **b**` merge until the text stops changing.
  - `/\bHalfCover\b/g` → `Half Cover`. Comment it as an upstream Open5e typo (srd-2024 rulesets), the only one found.
  - Apply `cleanO5Markdown` to every rules text the rules tools print.
  - Replace `has()` with `wordPhraseIndex(...) >= 0`, and the query landing with the index.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`.
- [ ] **Step 5: Commit.** Note the cleaning rules and the HalfCover typo in `tool-notes.md`. Commit with `fix(rules): clean Open5e markup and match whole phrases in rules search (F15, F16)`.

---

### Task 14: Monster closest hit only when close (F25; ruling R3)

**Files:**
- Modify: `src/name-match.ts`, `src/tools/monster.ts` (the `partialMatch` and not-found path near lines 391–410), `src/server.ts:363` (description)
- Test: `tests/name-match.test.ts`, `tests/monster.test.ts` (follow its existing service mocks)
- Skill: `references/coverage-matrix.md:143`, `references/intended-behaviour.md` (R3)

**Interfaces:**
- Produces (in `src/name-match.ts`): `export function isCloseName(name: string, query: string): boolean`. True when `levenshteinDistance(nameFold(name), nameFold(query)) <= Math.max(2, Math.floor(nameFold(query).length / 3))`, or `matchesLooseName(name, query)`.

- [ ] **Step 1: Write the failing tests.**
  - `isCloseName("Owlbear","Owlbare")` and `isCloseName("Beholder","Beholdr")` are true, and so is `isCloseName("Adult Red Dragon","red dragon adult")`. `isCloseName("Living Unseen Servant","Glorbulon the Unseen Squid-King")` is false.
  - `getMonster("Glorbulon the Unseen Squid-King")`, where the service's fuzzy hits are [Living Unseen Servant, Unseen Servant] and Open5e has no match:
    - the reply starts with `Monster "Glorbulon the Unseen Squid-King" not found. Closest matches from D&D Beyond:`;
    - then `NEAR_MATCH_RULES_LINE`;
    - then one line per near match in monster search's near-match form: name plus its own `editionTag`, and a locked one gets the locked note, reusing monster-search's row and label helpers rather than new wording;
    - no stat block.
  - `getMonster("Owlbare")` → the Owlbear stat block, preceded by `No monster is named "Owlbare"; showing the closest match, Owlbear.`
  - `getMonster("red dragon")` (substring) → unchanged, with no closest line.
  - `getMonster("Dragon")` → still the exact third-party CR 4 "Dragon" (exact twin match), with no closest line. `getMonsterStats` is untouched: it has no fuzzy path.
  - A homebrew near-match name is wrapped. An official one isn't.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `partialMatch: (all, q) => all.filter(includes).sort(tiebreak)[0] ?? all.find(m => isCloseName(m.name, q))`, which keeps the service's best-first order.
  - When there is no match and no Open5e result, list the service's first 5 hits as near matches.
  - When the chosen entry's name neither equals (twin) nor contains the query, prepend the closest line.
  - The server description becomes: `Matches by name: exact, then partial, then D&D Beyond's closest hit when it is close to the name (otherwise "not found" with near matches); with source, only an exact name in that book counts.`
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`, including `tests/regression-skill.test.ts`.
- [ ] **Step 5: Update the skill references and commit.** In `coverage-matrix.md`, the "ambiguous" line now names the close-only rule and the not-found case. Add R3 to `intended-behaviour.md`. Commit with `fix(monsters): take D&D Beyond's closest hit only when it is close, else not found with near matches (F25)`.

---

### Task 15: Invalid CR in encounters and treasure (F26)

**Files:**
- Modify: `src/tools/encounter.ts` (`rateEncounter`), `src/tools/treasure.ts` (`generateTreasure`)
- Test: `tests/encounter.test.ts`, `tests/treasure.test.ts`

**Interfaces:**
- Consumes: `unknownCrError(cr: number): string | null` from `src/tools/monster-search.ts:39`.

- [ ] **Step 1: Write the failing tests.**
  - `rateEncounter([{count:4,level:5}], [{cr:2.5}])` (the signature is positional, `encounter.ts:223`) → `Unknown CR "2.5". Valid CRs: 0, 0.125, 0.25, 0.5, 1–30.`
  - `rateEncounter(party, [{cr:2},{cr:7.5}])` → the error names `7.5`.
  - `generateTreasure({ cr: 2.5, treasureType: "individual" })` (the `TreasureInput` field names, `treasure.ts:466`) → the same text. The same applies to a bad `cr` inside `monsters`.
  - `cr: 2` is still accepted by both, and an absent `cr` (name-only monsters) is unchanged.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Validate every supplied `cr` before any lookup or roll, and return the first error.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`.
- [ ] **Step 5: Commit.** Commit with `fix(encounter,treasure): refuse an invalid CR as the monster search does (F26)`.

---

### Task 16: Reading a book the account doesn't own (F27)

**Files:**
- Modify: `src/tools/library.ts` (`readBook`, `matchBookSlug` no-match path)
- Test: `tests/library-resolver.test.ts`

**Interfaces:**
- Consumes: `isFreeBookSlug` (Task 11).
- Produces: `export function notOwnedMessage(title: string, owned: ReadonlyArray<{ title: string; slug: string }>): string` →
  `You don't own ${title} on D&D Beyond, so its text can't be read here. Books you can read:\n` followed by the same `  • <title> (<slug>)` lines as today.

- [ ] **Step 1: Write the failing tests** (library list and fetch mocked as the existing resolver tests do).
  - `readBook("dnd/phb-2024","playing-the-game")` with a library that lacks phb-2024 → `notOwnedMessage("Player’s Handbook", …)` (the 2024 PHB's index `book` label). The title comes from the source index via `sourceSlug`, and **no page fetch** happens.
  - `readBook("Player's Handbook")` (straight apostrophe; not in the library) → the same message for the **2024** book. Matching folds apostrophes (`nameFold`), so it equals the 2024 label `Player’s Handbook` exactly, while the 2014 one is `Player’s Handbook (2014)`. An exact folded match wins over substrings. Without an exact match, substrings that hit both editions resolve to the 2024 one (the edition default).
  - `readBook("dnd/br-2024")` → fetched even when the library lacks it.
  - `readBook("dnd/no-such-book")`, a slug in neither the library nor the source index → fetched as today. The message is only for a book the index knows.
  - The library fetch throws a plain `Error`:
    - by slug → fetched as today;
    - **by title**, say "Player's Handbook" → resolved through the source index to `dnd/phb-2024` and fetched (no block on an outage).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
  - Before fetching, return `notOwnedMessage` when all of these hold:
    - the library list loaded;
    - the slug's book is in the source index;
    - the slug's book is not free;
    - no library entry covers it (the same prefix rule as the title join in `readBook`).
  - Title resolution:
    - If the library fetch fails with anything but `SessionChangedError`, resolve the title through the source index (folded, as above) and read the book.
    - If `matchBookSlug` finds nothing in a loaded library, look the title up in the source index. A hit gives `notOwnedMessage`; a miss keeps today's error.
- [ ] **Step 4: Verify live.** Run `ddb_list_library` (the MCP tool) on the owner's free account and confirm the free books read as today: `ddb_read_book({book_slug:"dnd/br-2024"})` still returns its TOC.
- [ ] **Step 5: Run the tests and commit.** Run `npm test`, then commit with `fix(library): say plainly when a book isn't owned instead of returning the store page (F27)`.

---

### Task 17: Docs, regression runs, close-out

**Files:**
- Modify: `docs/claude/history.md`, `docs/claude/tool-notes.md`, `CLAUDE.md` ("Open work"), `skills/ddb-mcp-regression/references/known-open-issues.md`

- [ ] **Step 1: Run the live snapshot.** Run `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/after.txt" && diff "$TMPDIR/before.txt" "$TMPDIR/after.txt"`. Every hunk must be one of these:
  - weapon rows (Tasks 1–2), the Weapons/Tools lines (3), LIMITED USE maxima (4), resolved feat text (5);
  - the INVENTORY / EQUIPPED / ATTUNEMENT lines (6);
  - option suffixes on class-feature lines (7).

  Investigate anything else before going on.
- [ ] **Step 2: Run the whole-corpus regression** against the Setup baseline: `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --diff`. Expected: exit 0. Then read `report.md` and confirm at least one value per finding's evidence:
  - **F3:** 109965870 Longbow `+7`; 39712797 Longbow `+6`; 68903271 Longbow `+7`. Don't pin 42519628's longbows: its Battlement Longbow carries characterValues typeIds 10 and 12, customisation carry-over (ba). Its Net row must be 2 higher than at baseline.
  - **F28:** 112314883 `Giant Slayer Battleaxe … 1d8+7 … (1d10+5 two-handed)` and `Hellfire Battleaxe … 1d8+6 … (1d10+4 two-handed)`; 49053647 Longsword `1d8+4`.
  - **F11:** 112317699 `Shortsword, +1   +8 to hit   1d6+4 piercing` (the full row).
  - **F12:** 145415789 Pistol `+6`.
  - **F13:** 42519628 Net `no damage`.
  - **F6:** 133055442 Heavy Crossbow `Push`.
  - **F8:** 40080729 Bardic Inspiration `/ 3 max`; 145415789 Magical Tinkering and Flash of Genius `/ 4 max`; 14814039 Eyes of the Grave `/ 5 max`; 49053647 Divine Sense `/ 4 max`.
  - **F5:** 133054584 Tough with no `?`.
  - **F7:** 133059215 Weapons including `Weighted Chain, Bola`.
  - **F4:** 107607297 `Fighting Style (Fighter 1): Great Weapon Fighting`; 112317699 Eldritch Invocations listing all five invocations and `Pact Boon (Warlock 3): Pact of the Blade`.
  - **F10:** 152720684 EQUIPPED containing `Staff of the Woodlands` and `ATTUNEMENT (1/3): Staff of the Woodlands`; 112316571 attunement naming `Cloak of Elvenkind`.
  - **F1:** 107606626 INVENTORY with `Clothes, Common;`.
- [ ] **Step 3: Check a sample live through the MCP tools.**
  - `ddb_character_lookup` for 107693030 with `eldrich blast` and `Dark One's Blessing`.
  - `ddb_get_monster` with `Glorbulon the Unseen Squid-King`.
  - `ddb_search_feats` with `prerequisite:"Strength 13"`.
  - `ddb_rate_encounter` with `cr:2.5`.
- [ ] **Step 4: Update the docs.**
  - `history.md`: complete the "Regression remediation 2026-11-11" entry (begun in Setup with R1–R6). List F1–F28 with commits, the investigation corrections (Dueling has a modifier; F19 is wording; F21's hidden count is by design; HalfCover is an upstream typo, now repaired; the report's `**more** **than on` was truncated), and the adversarial-review round (Claude, Codex, router) that shaped this plan.
  - Open carry-over **(br)** in `history.md` and `known-open-issues.md`: pact or hex weapons using CHA (2024 Pact of the Blade, 2014 Hex Warrior). No test character has one, so no data shape is verified.
  - `CLAUDE.md` "Open work": the handover line, the unreleased commit count, and (br).
  - `known-open-issues.md`: close nothing that is still open. Add (bb)'s wider evidence (8 subclass casters, Bless missing from `concentration`) to its entry, flagged for re-prioritising.
- [ ] **Step 5: Run the final checks and commit.** Run `npm run typecheck && npm run lint && npm test` (including `tests/regression-skill.test.ts`, which fails on a carry-over listing out of step). Then commit with `docs: regression remediation 2026-11-11 — history, carry-over (br), handover`. Afterwards remove the baseline worktree: `git worktree remove "$TMPDIR/ddb-base"`.

---

## Adversarial review round (2026-11-11)

Claude (with repo and data access), Codex (read-only repo) and the router (`auto:reviewers`, text only) reviewed this plan against the report. Every reviewer claim was verified against the code and the cached character JSON before it was used. The confirmed findings are folded into the tasks above. These suggestions were rejected:

- **Gate Dueling on any second wielded weapon (Codex):** this contradicts dndbeyond.com, which shows the +2 on both of Ethelrede's unflagged battleaxes. Ruling R5 gates it only on an off-hand flag.
- **Implement "twin hiding only when the shown twin matches" in general (router, F21):** `countFilteredPicks` is deliberate (edition.ts:496, tool-notes). F21 is fixed by the prerequisite matcher.
- **Merge an unclosed `**more** **than on` (router, F15):** the report truncated its quote; the data is well-formed.
- **Drop `source` from the get paths (router, F22):** the get tools do take `source` (`reference.ts:540`).
- **Dedupe F9 across the class and subclass loops (router):** `searchDefinitions` already dedupes by name (`seen`, definition.ts:175).
- **The "Tinderbox" regression (router, F2):** lookup searches only equipped items, which this plan doesn't change.
- **Scale the character-name Levenshtein (router, F14):** that is today's behaviour and the report doesn't flag it. Out of scope.
- **Change the "with source, only an exact name" wording (router, F25):** that clause is already in today's description.

## Out of scope (left as recorded)

- **Pact or hex weapons using CHA:** carry-over (br), opened in Task 17. No test character has one.
- **Weapon mastery on 2014 sheets:** owner ruling B6 stands. The report notes only that the site differs.
- **(bb) always-prepared subclass spells:** the run found it on all 8 subclass casters checked. Task 17 records the evidence. A fix needs its own plan.
- **The report's "Improvements" list:** not findings. Pick from it in a later round.
