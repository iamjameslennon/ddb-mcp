# Regression-run fixes (2026-11-06) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs the 2026-11-06 regression run found (B1–B10, B13 and the B14 nits listed below), so that every output the report flagged is correct, with one test per behaviour.

**Architecture:** Each task fixes one finding where it lives. Two new tiny pure modules are added: `src/tools/casting-time.ts` (spell activation text) and `src/tools/weapon-mastery.ts` (the mastery names, shared by the sheet and the equipment tool). Everything else is a local change to an existing module. Character-sheet changes follow the live snapshot flow in `docs/character-refactor.md`.

**Tech Stack:** TypeScript (ESM, Node ≥22), vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-06-regression-report.md`. Task 1 copies it there from the untracked `ddb-mcp-regression-2026-11-06.md` at the repo root. Where this plan and the report differ, **this plan wins**. Each difference was checked against live JSON on 2026-11-06 and is noted in the task.

**Not in scope (needs an owner decision first, per the report's handover):** B11 (monster search quality), B12 (Critical Role category), I1–I3 (combat completeness), I4 (regression script). Also out of scope: the B14 nits `ddb_read_book` blank-line runs and `search_spells source: xgte` "not owned" wording. I5 is done only as far as Task 13's `testcharacters.md` note goes.

## Global Constraints

- Work in a worktree on branch `fix/regression-2026-11-06` (superpowers:using-git-worktrees). Never push. The owner merges to `main`.
- Before every commit: `npm run typecheck && npm run lint && npx vitest run`, all green with no new warnings.
- `rules_edition` is the only edition param name. Every edition label string lives in `src/edition.ts`; no tool module builds its own edition text.
- `src/session-state.ts`, `src/edition.ts`, `src/game-config.ts` and `src/source-filter.ts` never import a tool module.
- User-authored text (homebrew, custom items, names) stays wrapped with `wrapUntrusted` / `wrapIfHomebrew`, whole line, tag included. Official `isHomebrew: false` content stays plain.
- No output changes except the one the task specifies. When an existing test or the committed snapshot (`tests/__snapshots__/character-snapshot.test.ts.snap`) pins the old behaviour of exactly that change, update it deliberately, and list it in the task report.
- **Parse tasks (5–9):** run `npx tsx scripts/snapshot-live-characters.mts > /tmp/before-N.txt` before the change and `> /tmp/after-N.txt` after it, then `diff` them. The report lists every changed line, and each must be one this task intends.
- Update the tool's or parser's entry in `docs/claude/tool-notes.md` in the same commit as the behaviour change.
- Commit style: `fix(<scope>): …` / `test(<scope>): …` / `docs: …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code reads like its neighbours: same comment density, naming and idiom. Tests go in the module's existing test file unless the task names a new one.

## Review Focus

1. **A spell with no `activation`, or `activationTime` 0/missing**: it must still print a sane casting time ("1 Action" when `activation` is absent, as today), never "undefined Minute". Test in Task 2.
2. **`~` edge paths**: a bare `~`, `~otheruser/x.json` and `~/Downloads` itself must all be refused, and `~` must not be expanded mid-path (`a/~/b`). Test in Task 3.
3. **A 2024 character with Weapon Mastery who chose a different weapon**: e.g. a mastery modifier for `sap-spear` while also wielding a Rapier. The Rapier's "Vex" must be dropped and the Spear's "Sap" kept. A magic weapon must use its base `type` (Sun Blade → Longsword). Test in Task 9.
4. **A multiclass character's racial traits**: `requiredLevel` compares against the **total** character level, not one class's level. Test in Task 6.
5. **An encounter where every named monster fails but a `cr`-supplied one counts**: it must get the INCOMPLETE headline. When nothing counts at all, the existing "No valid monsters provided" reply stays unchanged. Test in Task 12.

---

### Task 1: Bring the report into the repo

**Files:**
- Create: `docs/superpowers/specs/2026-11-06-regression-report.md` (verbatim copy of `/Users/jameslennon/ddb-mcp/ddb-mcp-regression-2026-11-06.md`)

- [ ] **Step 1:** Copy the file. Under its title, add one line: `> Plan: docs/superpowers/plans/2026-11-06-regression-fixes.md. B13 only half-matches 0c94dde (customItems are also never listed); see the plan's Task 7.`
- [ ] **Step 2:** Commit: `docs: add the 2026-11-06 regression report`. The untracked root copy in the main checkout is left alone. The final report reminds the owner to delete it after merging.

---

### Task 2: B1, the spell casting time

**Files:**
- Create: `src/tools/casting-time.ts`
- Modify: `src/tools/reference.ts:391-397` (`formatSpell`), `src/tools/character/definition.ts:37-41` (`formatSpellResult`), `src/tools/spell-store.ts:23` (add `castingTimeDescription?: string | null` to the definition type)
- Test: `tests/casting-time.test.ts` (new), plus one assertion each in `tests/spell-editions.test.ts` (via `reference.getSpell` and the `spell()` builder in `tests/fixtures/spell-service.ts`; extend its `opts` with `activation` / `castingTimeDescription` if needed) and `tests/character-lookup.test.ts`. No existing test asserts D&D Beyond's `Casting Time:` line today, which is how B1 survived.

**Interfaces:**
- Produces: `castingTimeText(activation: { activationTime?: unknown; activationType?: unknown } | null | undefined, castingTimeDescription?: unknown): string`

D&D Beyond's `activationType` (confirmed live on 112316571: Shield = 4 with a trigger in `castingTimeDescription`; Alarm and Identify = 6; Fabricate = 6 with time 10):

| type | label | prints |
|---|---|---|
| 1 | Action | `N Action(s)` |
| 2 | No Action | `No Action` (no number) |
| 3 | Bonus Action | `N Bonus Action(s)` |
| 4 | Reaction | `N Reaction(s)` + `, <castingTimeDescription>` when that is non-empty |
| 5, 8 | Special | `Special` (no number) |
| 6 | Minute | `N Minute(s)` |
| 7 | Hour | `N Hour(s)` |
| other | — | `N (activation type T)` |

The label is plural when N ≠ 1. N is `Number(activationTime)`, and a missing, zero or non-finite N counts as 1. When `activation` itself is absent the result is `"1 Action"` (unchanged).

- [ ] **Step 1: Write the failing tests** in `tests/casting-time.test.ts`:
  - `castingTimeText({activationTime:1,activationType:1})` → `"1 Action"`
  - `({1,3})` → `"1 Bonus Action"`
  - `({1,4}, "which you take when you are hit by an attack or targeted by the magic missile spell")` → `"1 Reaction, which you take when you are hit by an attack or targeted by the magic missile spell"`
  - `({1,4}, "")` → `"1 Reaction"`
  - `({1,6})` → `"1 Minute"`; `({10,6})` → `"10 Minutes"`; `({1,7})` → `"1 Hour"`; `({8,7})` → `"8 Hours"`
  - `({1,2})` → `"No Action"`; `({1,5})` and `({1,8})` → `"Special"`
  - `({1,9})` → `"1 (activation type 9)"`
  - `(undefined)` → `"1 Action"`; `({activationType:6})` → `"1 Minute"` (Review Focus 1)
  - In `spell-editions.test.ts`: a type-4 Shield fixture prints `Casting Time: 1 Reaction, which you take …`. In `character-lookup.test.ts`: a character spell with type 6 prints `Casting Time: 1 Minute`.
- [ ] **Step 2:** Run `npx vitest run tests/casting-time.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `castingTimeText` in `src/tools/casting-time.ts`, with a doc comment holding the table above. Replace both local `ACTIVATION_TYPES` maps with calls to it (`d.activation`, `d.castingTimeDescription`). Run `grep -rn "Bonus Action\"" src` and confirm no other copy of the map is left. `actions.ts` filters on raw numbers and keeps them. `open5e.ts` `CASTING_TIME` maps Open5e's own string keys and is out of scope.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Note the casting-time behaviour in `docs/claude/tool-notes.md` under `ddb_get_spell`, then commit `fix(spells): correct casting time for reaction, minute and hour spells`.

Live check (logged in, after `npm run build` and restarting the server): `ddb_get_spell` Shield, Counterspell, Identify, Find Familiar and Alarm under both editions, and `ddb_character_lookup` 112316571 "shield". Record the outputs in the task report.

---

### Task 3: B2, `~` in `ddb_download_character` paths

**Files:**
- Modify: `src/tools/character.ts:297` (`resolveSafeSavePath`)
- Test: `tests/download-path.test.ts`

**Interfaces:**
- Produces: `resolveSafeSavePath(outputPath: string, allowedDirs: string[], home: string = homedir()): string`. The new third parameter exists only so tests can inject a home directory.

- [ ] **Step 1: Write the failing tests**, using the existing temp-dir setup with `home = root` and `allowedDirs = [join(root,"Downloads"), join(root,"Documents")]` (create both):
  - `"~/Downloads/a.json"` resolves to `join(realpath(root),"Downloads","a.json")`
  - Windows only (`it.skipIf(process.platform !== "win32")`): `"~\\Documents\\a.json"` resolves inside Documents.
  - POSIX only (`it.skipIf(process.platform === "win32")`): `"~\\Documents\\a.json"` is **refused**. A backslash is an ordinary filename character on POSIX, so the path would name a file called `Documents\a.json` in the home root, outside the allowlist.
  - Refused (throws `Output path must be a file under ~/Downloads or ~/Documents.`): `"~/Documents/../.ssh/a.json"`, `"/etc/a.json"`, `"~"`, `"~otheruser/a.json"`, `"~/Downloads"`, `"sub/~/Downloads/a.json"` (Review Focus 2)
- [ ] **Step 2:** Run `npx vitest run tests/download-path.test.ts`. Expected: the two accept cases FAIL.
- [ ] **Step 3:** In `resolveSafeSavePath`, before `resolve()`, replace a leading `~/` (and, only when `process.platform === "win32"`, a leading `~\`) with `join(home, rest)`. A bare `~` becomes `home`. Leave every existing check untouched.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(download): expand a leading ~ in output_path`.

---

### Task 4: B3, the Open5e option-search fallbacks keep `prerequisite`, `limit` and `offset`

**Files:**
- Modify: `src/open5e.ts` (`O5OptionSearchParams` at ~1116, `o5OptionReply` at ~1087, `o5SearchFeatsSection` at ~1324, the races/classes/backgrounds sections), `src/tools/reference.ts:989,1042,1085,1133` (the four `fallback:` lines)
- Test: `tests/open5e.test.ts` (or `tests/open5e-v2-filters.test.ts` if it already holds feat-fallback tests; use the recorded fixtures in `tests/fixtures/open5e-v2/`)

**Interfaces:**
- Produces: `type O5OptionSearchParams = { name?: string; rulesEdition?: RulesEdition; limit?: number; offset?: number }`, and `o5SearchFeatsSection(params: O5OptionSearchParams & { prerequisite?: string }, origin)`. `o5OptionReply` gains `limit: number` and `offset: number` in its `opts`.

Behaviour:
- **Feats:** `prerequisite` is a case-insensitive substring of `prerequisite(record)` (the existing helper, "Prerequisite:" prefix stripped). A feat with no prerequisite never matches a prerequisite query. Applied through `o5Select`'s `passes`.
- **Paging (all four option searches):** the result lines are sliced `[offset, offset+limit)`. The heading reads `Found N feat(s) (SRD only):` when everything fits, and `Found N feat(s) (SRD only), showing A–B:` when it doesn't, followed by the line `\n*Use offset: B to see more.*` when more remain. An offset at or past the end returns the heading `Found N feat(s) (SRD only) — offset X is past the end.` with no lines. The single-hit detail block (`opts.single && selected.length === 1`) is unaffected, and N always counts every match.
- `reference.ts` passes `limit: params.limit ?? 30`, `offset: params.offset ?? 0` (30 is each tool's `defaultLimit`), plus `prerequisite` for feats.

**The recorded fixtures are tiny.** `tests/fixtures/open5e-v2/srd-2024/feats.json` holds only Alert and Grappler, `srd-2014/feats.json` only Grappler, and each species file has 4 records. Tests that need more records add them through `o5FixtureFetch(overrides)` (`tests/fixtures/open5e-v2.ts:35`), and call `clearOpen5eCache()` between tests, as `tests/open5e.test.ts` does.

- [ ] **Step 1: Write the failing tests:**
  - With the recorded fixtures: `o5SearchFeatsSection({ prerequisite: "strength", rulesEdition: "2024" }, "not-found")` → Grappler's detail block (single hit), with no `Alert`. `{ prerequisite: "zzz" }` → the `noMatch` reply.
  - With overrides adding three 2024 feats whose prerequisite contains "Spellcasting" plus two without one: `{ prerequisite: "spellcast" }` lists exactly the three. Assert the count, so the test can't pass on an empty list.
  - With the recorded fixtures (2024: Alert, Grappler): `{ limit: 1 }` → one bullet line, heading `showing 1–1`, and `Use offset: 1`. `{ offset: 999 }` → contains `offset 999 is past the end`.
  - `o5SearchRacesSection({ limit: 1 }, "not-found")` → one bullet line.
  - Through `searchFeatsSection` with D&D Beyond returning no match (use the existing fallback test harness): `prerequisite` reaches the Open5e path.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(open5e): feat/race/class/background fallbacks honour prerequisite, limit and offset`.

---

### Task 5: B4, the `Rules:` header no longer counts disguised feats

> **Skipped (owner ruling 2026-11-06):** the earlier decision stands. Rules-edition spec decision 4 keeps counting `__DISGUISE_FEAT` entries in `Rules:`, so B4 is by design.

**Files:**
- Modify: `src/tools/character/editions.ts:90-94`
- Test: `tests/character-editions.test.ts`

Ruling: a `__DISGUISE_FEAT` entry is skipped in `computeCharacterEditions` **unless it is homebrew** (`isHomebrewEntry(f)`). Homebrew disguised feats keep their `homebrew: N feat` count, so the header still signals homebrew. Their `[third-party]` tag in OTHER FEATURES is unchanged. `ddb_get_party` uses the same `rulesLine` and is fixed with it.

- [ ] **Step 1: Write the failing tests.** **Update the pinned test** `character-editions.test.ts:107-112` ("a third-party disguised feat is listed", which expects `Rules: 2024 · third-party: Dark Bargain (feat)`) to expect `Rules: 2024`, and list it in the report. New: a 2014 fighter fixture (`FIGHTER_5` variant) with feats Tough (plain, source 1) and Dark Bargain (`__DISGUISE_FEAT` tag, a third-party source id from `INDEX`). Its summary `Rules:` line is exactly `Rules: 2014`, and its features section still has `• Dark Bargain [third-party]` under OTHER FEATURES. A second case adds a homebrew disguised feat and expects `homebrew: 1 feat` in `Rules:`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Add the `__DISGUISE_FEAT && !isHomebrewEntry(f)` skip next to the existing `__INITIAL_ASI` skip.
- [ ] **Step 4:** Run `npx vitest run` and the snapshot diff. Expected: tests pass. Diff: on 112314883, `Rules: 2014 · third-party: Hero's Journey Boon (feat), Dark Bargain (feat)` → `Rules: 2014`, and similar on the other ~13 characters. Nothing else changes.
- [ ] **Step 5:** Commit `fix(character): Rules header skips auto-added disguised feats`.

---

### Task 6: B5, racial traits follow the sheet's visibility

**Files:**
- Modify: `src/tools/character/features.ts:79-83` (`buildRacialTraitLines`)
- Test: `tests/character-parser.test.ts`

Rule (fields confirmed live on 152579009 and 112314883): skip a trait when `definition.hideInSheet === true`, when `definition.displayConfiguration?.RACIALTRAIT === 0`, or when `num(definition.requiredLevel) > totalLevel`. `totalLevel` is the sum of `classes[].level`. After filtering, drop a later line identical to an earlier rendered line (the dedupe runs on the final, possibly wrapped string, so a homebrew trait never collapses into an official one of the same name). Only the RACIAL TRAITS list changes. `ddb_character_lookup` (`definition.ts:217`), senses (`stats.ts:202`) and granting entities (`actions.ts:65`) still see every trait: those read effects and lookups, not sheet display.

- [ ] **Step 1: Write the failing tests** (synthetic race on `FIGHTER_5`):
  - The traits Giant Ancestry, Large Form (`hideInSheet:true, requiredLevel:5`), Languages (`hideInSheet:true, RACIALTRAIT:0`), Ability Score Increases (`RACIALTRAIT:0`) and Large Form (`requiredLevel:5`) on a level-1 character list only `• Giant Ancestry`.
  - The same traits on a multiclass Fighter 3 / Rogue 2 (total 5) list Giant Ancestry and **one** `• Large Form` (Review Focus 4).
  - Two visible "Celestial Revelation" entries print once.
  - `getDefinition`/lookup for "languages" on the level-1 fixture still finds the hidden trait.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the filter and the line dedupe in `buildRacialTraitLines`. It needs `classes` (pass `core.classes` from `computeFeatures`).
- [ ] **Step 4:** Run `npx vitest run` and the snapshot diff. Expected: hidden Age/Size/Speed/Languages/ASI lines and level-gated traits disappear. Nothing else changes.
- [ ] **Step 5:** Commit `fix(character): racial traits honour hideInSheet, display config and required level`.

---

### Task 7: B13, custom items (two paths)

> **7(b) dropped (owner ruling 2026-11-06):** every `data.customItems` entry mirrors an `isCustomItem` inventory entry (same id and quantity), so `customItems` stay unprinted and only 7(a) was done. Item names are trimmed everywhere they print.

**The report only half-matches HEAD.** Custom items reach the character JSON two ways:
- **(a)** Inventory entries whose definition has `isCustomItem: true` (live: 7 on 5 of 57 characters). They are placed as homebrew, wrapped in `INVENTORY (homebrew)`, per the existing ruling in `tests/character-homebrew-lines.test.ts:269-283`. But they carry `[edition not stated]` there, on equipped and weapon lines too, and they are counted as `edition not stated: N items` in `Rules:`. This is the report's B13.
- **(b)** `data.customItems` (`{id, name, description, weight, cost, quantity, notes}`, with no definition) is never read, so those items are silently **absent**. Live: Calderax 14814039 has `Platinum Ring` ×2 and `Filigreed Longsword ` (trailing space), and 39715128 and 17931478 each have `Unidentified Item 1`.

**Files:**
- Modify: `src/tools/character/editions.ts` (the `tag` helper ~line 104, the item loop ~line 99), `src/tools/character/inventory.ts` (`computeInventory`)
- Test: `tests/character-homebrew-lines.test.ts` (the "custom items are placed as homebrew" describe), `tests/character-editions.test.ts`

Ruling (it keeps the existing "custom is placed as homebrew" decision, and adds no new block or label):
1. A definition with `isCustomItem === true` gets **no edition tag**: `tag(def)` returns `""`, so `named()` and every line built from it carry none. It is **not counted** in `Rules:`: skip it in the item loop. A custom item has no ruleset.
2. Each `data.customItems` entry joins the existing homebrew carried list (`homebrewItems` in `computeInventory`) under its trimmed name, with `quantity` (missing → 1). An entry whose trimmed name is empty is skipped. It merges by name with other homebrew-list entries. It is not counted in `Rules:`.
3. Trim item names on the homebrew list (`Filigreed Longsword ` → `Filigreed Longsword`).

- [ ] **Step 1: Write the failing tests:**
  - **Update the pinned test** `character-homebrew-lines.test.ts:277`: the expected line becomes `wrapUntrusted("  Oasis Amulet")` (no tag). List it in the report.
  - The equipped-custom and custom-weapon test in the same describe: those lines contain no `[edition not stated]`.
  - `character-editions.test.ts`: a FIGHTER_5 variant with one `isCustomItem` gear entry: `Rules:` contains no `edition not stated`.
  - `customItems: [{name:"Platinum Ring",quantity:2},{name:"Filigreed Longsword ",quantity:1},{name:"  ",quantity:1}]` → the inventory section contains `INVENTORY (homebrew)` and `wrapUntrusted("  Platinum Ring ×2, Filigreed Longsword")`, and `Rules:` is unchanged from the same fixture without `customItems`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run` and the snapshot diff. Expected: the `[edition not stated]` tags go from custom items, the `edition not stated: N items` counts drop from `Rules:`, and the three characters gain their `customItems` in the homebrew list. Nothing else changes.
- [ ] **Step 5:** Commit `fix(character): custom items carry no edition tag and customItems are listed`.

---

### Task 8: B14 text glitches (entities, proficiency names, 404 message)

**Files:**
- Modify: `src/tools/character/helpers.ts:30` (`stripHtml`), `src/tools/character/stats.ts:356-365` (`computeProficiencies`), `src/tools/character.ts:261,374`
- Test: `tests/character-parser.test.ts`, plus the character-fetch error test (find it with `grep -ln "is private and cannot be accessed" tests`)

Changes:
1. `helpers.stripHtml(s)` = `utils.stripHtml(s)` (it decodes entities) followed by the whitespace collapse and trim. Feature snippets, background features and notes then show `—` and `’`, not `&mdash;` and `&rsquo;`.
2. For a **known** slug (`PROFICIENCY_SLUGS.has(sub)` / `LANGUAGE_SLUGS.has(sub)`), print `str(m.friendlySubtypeName)` when it is non-empty, else today's `capitalize(...)`. Unknown (custom, wrapped) slugs keep today's text: `friendlySubtypeName` there is not D&D Beyond's. Live values: `Thieves' Tools`, `Cartographer's Tools`, `Thieves’ Cant`, `Crossbow, Light`.
3. `character.ts:261`: a 404 → `Character <id> was not found (404) — check the ID, or that the character still exists.`; any other status → `D&D Beyond API returned <status>` plus `: <statusText>` only when statusText is non-empty. Apply the same no-dangling-colon rule to the list error at `:374`.

- [ ] **Step 1: Write the failing tests:** a background `featureDescription` of `"A&mdash;B &rsquo;s"` prints `A—B ’s`. Proficiency mods `thieves-tools`/`Thieves' Tools` and `thieves-cant`/`Thieves’ Cant` print those names. A 404 response with `statusText: ""` throws the 404 text, and a 500 with an empty statusText throws exactly `D&D Beyond API returned 500`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run` and the snapshot diff. Expected: only entity, proficiency-name and error-text lines change.
- [ ] **Step 5:** Commit `fix(character): decode entities, use D&D Beyond proficiency names, clearer 404`.

---

### Task 9: B6, the weapon rows

**Files:**
- Create: `src/tools/weapon-mastery.ts`
- Modify: `src/tools/character/weapons.ts:44-104`
- Test: `tests/character-parser.test.ts` (a new `describe("weapon rows")`), using synthetic weapons on `FIGHTER_5`

**Interfaces:**
- Produces: `export const MASTERY_NAMES: ReadonlySet<string>` (the eight names below) in `src/tools/weapon-mastery.ts`; Task 10 imports it.

Row format: `• <label padded> <hit> to hit   <damage>   <range>   <props>`. Changes:

1. **Range:** ranged (`attackType 2`) is unchanged (`range R/L ft.`). Melee reach is `10` when properties include `Reach`, else `5`. A melee weapon with `Thrown` prints `reach 5 ft. / thrown R/L ft.` from `range`/`longRange`. Expected: Javelin `reach 5 ft. / thrown 30/120 ft.`, Dagger and Spear `… / thrown 20/60 ft.`.
2. **Versatile:** with a `Versatile` property whose `notes` is a die, damage reads `1d8+6 radiant (1d10+6 two-handed)`. The same bonus applies to both dice.
3. **`definition.grantedModifiers`:**
   - `type:"replace-damage-type"` → its `subType` replaces the damage type.
   - `type:"damage"` with `dice.diceString` → append ` + <dice> <subType>`, plus ` (<restriction>)` when the restriction is non-empty.
   - `type:"weapon-property"`, `subType:"finesse"` → counts as Finesse for the STR/DEX choice and adds `Finesse` to the properties.
   - Keep the existing `bonus/magic` handling.
   - Xarius 58640338 Sun Blade becomes: `1d8+6 radiant (1d10+6 two-handed) + 1d8 radiant (Against Undead Targets)`, with properties `Versatile, Finesse`.
4. **Mastery gate:** the names in `MASTERY_NAMES` (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) are removed from the properties, along with `def.mastery`, unless the character has a modifier with `type === "weapon-mastery"` and `subType === \`${slug(mastery)}-${slug(def.type || def.name)}\``. Here `slug` lowercases and turns runs of non-alphanumerics into `-`. Live: 152579009 has `sap-spear` and `topple-maul`, and Xarius (2014) has none, so all of Xarius's mastery names drop.
5. **Alignment:** pad `${prefix}${label}` (prefix = `×N ` or empty) to 16, the current width. Rows without a quantity stay byte-identical, and only prefixed rows change. Build the line with the prefix instead of using `replace("•", …)`, which means the quantity must be known before the line is built: format the lines after consolidation.

- [ ] **Step 1: Write the failing tests**, one per item:
  - a thrown dagger's range text
  - a Reach glaive → `reach 10 ft.` (no test character has one)
  - Versatile dice
  - the Sun Blade granted modifiers (the radiant replacement, the extra die with its restriction, the Finesse grant making DEX the attack stat when DEX > STR)
  - mastery kept only for a weapon with a matching modifier, plus Review Focus 3: a `sap-spear` modifier with a Rapier → no Vex, and a Sun Blade with a `sap-longsword` modifier → Sap kept
  - two rows (`×2 Rapier` and `Dagger`) whose `to hit` starts at the same column
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified. Keep the dedupe key (`homebrew|label|dice`) unchanged.
- [ ] **Step 4:** Run `npx vitest run` and the snapshot diff. Expected: weapon rows change on characters with thrown, versatile or magic weapons, and mastery names disappear on 2014 characters. Compare Xarius's rows with https://www.dndbeyond.com/characters/58640338 and record any mismatch.
- [ ] **Step 5:** Commit `fix(character): weapon range, versatile, granted modifiers and mastery gating`.

---

### Task 10: B7, no 2024 mastery in a 2014 `ddb_get_equipment` reply

**Files:**
- Modify: `src/tools/reference.ts:659-695` (`formatItem(item, rulesLines, shownRuleset)`) and its one caller at `reference.ts:788`
- Test: `tests/equipment-editions.test.ts`

Rule: the shown edition is `found.info.ruleset` from `lookupCatalog` (`reference.ts:777`), passed into `formatItem` as a new parameter. Do **not** re-classify with `classifyEdition`: items are dual-edition (ITEM_ADAPTER `dualEdition: true`), and a definition printed in both editions would classify as 2024 even when the 2014 version is shown. When the shown edition is 2014, `Properties:` omits the names in `MASTERY_NAMES`, and the description is cut at the first paragraph that starts with `This weapon has the following mastery property` (live text, Longbow 2014). Trailing whitespace is trimmed. Import `MASTERY_NAMES` from `src/tools/weapon-mastery.ts` (Task 9). Do not create a second copy. A 2024 reply is unchanged.

- [ ] **Step 1: Write the failing tests:** a Longbow fixture (Basic Rules 2014 source) with properties `[Ammunition, Heavy, Range, Two-Handed, Slow]` and a description that ends with the mastery paragraph. Under `rules_edition: "2014"`: `Properties: Ammunition, Heavy, Range, Two-Handed`, and the output contains neither `Slow.` nor `mastery property`. The same fixture under a 2024 source keeps both. A dual-edition definition (sources in both a 2024 and a 2014 book) requested with `rules_edition: "2014"` also drops both: this is the case `classifyEdition` would get wrong.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(equipment): drop 2024 mastery from 2014 weapon replies`.

---

### Task 11: B8, no zeros in a locked monster's stat block

**Files:**
- Modify: `src/tools/monster.ts:565-617` (`formatStatBlock`)
- Test: `tests/monster.test.ts`

Rule: only on a block that shows the ownership notice, i.e. the same condition as `monster.ts:652` (`accessType === 4 && (!m.stats?.length || !m.actionsDescription)`). Compute it once and use it for both: an AC of 0 or missing prints `**Armor Class** —`. HP of 0 or missing prints `**Hit Points** —` (no dice). A `passivePerception` of 0 or missing leaves the passive part out, and with no senses either, the `**Senses**` line is omitted. The ownership notice stays. Unrestricted blocks are unchanged, including a real AC 0.

- [ ] **Step 1: Write the failing tests:** a restricted Beholder fixture (`armorClass 0, averageHitPoints 0, hitPointDice {diceString:"d0"}, passivePerception 0, stats []`, accessType 4) prints `**Armor Class** —` and `**Hit Points** —`, contains no `passive Perception 0` and no `(d0)`, and keeps the `⚠️ Full stat block requires ownership` line.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(monster): show — instead of zeros on locked stat blocks`.

---

### Task 12: B9, encounter ratings with uncounted monsters

**Files:**
- Modify: `src/tools/encounter.ts:270-425` (`rateEncounter`, `warningLines`)
- Test: `tests/encounter.test.ts`

Rule: keep a running `uncounted` number, adding `m.count ?? 1` at each of the four `continue`s (not-found, unavailable, ambiguous, unknown-cr). The name arrays stay as they are, since unknown-cr messages are deduped there. When `uncounted > 0` and `totalMonsterCount > 0`:
- The headline becomes `ENCOUNTER DIFFICULTY: INCOMPLETE — <uncounted> monster(s) not counted (the rest rate <DIFFICULTY>)`. The 2024 form keeps its ` (2024 XDMG)` suffix after the closing parenthesis.
- The warning lines move to directly after the `Rules:` line (still preceded by a blank line), not the end.
- In 2014 mode, the Multiplier line is **always** printed (today it is hidden at ×1 with no note), and its parenthesis gains `; excludes <uncounted> not counted`.
- The `Result:` line is unchanged.

When `totalMonsterCount === 0` the existing reply is unchanged. `ddb_roll_treasure` already leads with its status block: no change.

- [ ] **Step 1: Write the failing tests** (mock `getMonsterStats` as the existing tests do):
  - 2024: 3×L5 + 1×L3 vs "Red Dragon" (ambiguous) + 4 goblins (cr 0.25). The first line starts `ENCOUNTER DIFFICULTY: INCOMPLETE — 1 monster(s) not counted (the rest rate`, and the `⚠` line comes before `PARTY`.
  - 2014: the same input, with `excludes 1 not counted` on the Multiplier line.
  - 2014: one counted monster (×1, party of 4) plus one not-found → the Multiplier line is present, reading `×1 (1 monster; excludes 1 not counted)`.
  - Review Focus 5: `{name:"Nope", count:3}` not found + `{cr:1}` → `INCOMPLETE — 3 monster(s)`.
  - Only not-found monsters → the existing `No valid monsters provided` text.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(encounter): mark ratings incomplete when monsters were not counted`.

---

### Task 13: B10, the rules lookup query miss and Open5e timeout text, plus docs

**Files:**
- Modify: `src/open5e.ts:86-121` (`fetchPages`), `src/open5e.ts:1461-1469` (`o5GetRule`)
- Modify (docs): `docs/claude/history.md`, `CLAUDE.md` "Open work", `testcharacters.md`
- Test: `tests/open5e.test.ts`

Changes:
1. `o5GetRule`: when `query` is given and not found in the text, the reply keeps the section's start but adds the line `*"<query>" not found in <section or ruleset name> — showing its start. Try ddb_search_rules.*` directly after the `Rules:`/`*Part of …*` lines. Escape nothing: the query is the caller's own text, and the reply is Open5e content.
2. `fetchPages`: a per-request timeout (an error with `name === "TimeoutError"`. That is the reason `AbortSignal.timeout` aborts with, and `AbortSignal.any` passes it through; the report's observed text "The operation was aborted due to timeout" is that DOMException's message, from `AbortSignal.timeout(O5_TIMEOUT_MS)`, in either `fetch` or `resp.json()`) is rethrown as `new Error(\`Open5e (api.open5e.com) didn't answer within ${O5_TIMEOUT_MS / 1000} s — try again shortly.\`)`. The document-deadline abort keeps its own message. The 60 s failure memo then stores the new error unchanged.
3. Docs:
   - `docs/claude/history.md`: a new dated section "Regression run 2026-11-06" with one line per finding fixed (B1–B10, B13-as-found, the B14 parts done) and the deferred items (B11, B12, I1–I5, the two B14 nits).
   - `CLAUDE.md` "Open work": add a line "Regression handover (B11, B12, I1–I4): needs owner decisions, see docs/superpowers/specs/2026-11-06-regression-report.md", and bump "Last updated".
   - `testcharacters.md`: "verified 2026-11-06 (56 public)"; 52514332 is now 404.

- [ ] **Step 1: Write the failing tests:** `o5GetRule("Actions in Combat", "2024", 4000, "zzznotthere")` contains `"zzznotthere" not found in`. With `fetch` mocked to reject with `Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })`, a document load rejects with `didn't answer within 20 s`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement items 1 and 2, then make the doc edits.
- [ ] **Step 4:** Run `npm run typecheck && npm run lint && npx vitest run`. Expected: all green.
- [ ] **Step 5:** Commit the code as `fix(rules): say when a query isn't found; readable Open5e timeout`, and the docs separately as `docs: record the 2026-11-06 regression fixes`.

---

## Final verification (after Task 13)

> **Adapted (owner rulings 2026-11-06):** Task 5 was skipped, and the snapshots live in the plan workspace (`.superpowers/sdd/2026-11-06-regression-fixes/snap/`), so the baseline is `before-6`, not `/tmp/before-5.txt`.

- [ ] `npm run build`, restart the server, and repeat the report's live checks for B1, B2, B3, B7, B8 and B9. Record each output.
- [ ] Run the full snapshot diff against `/tmp/before-5.txt`: every changed line maps to one of Tasks 5–9.
