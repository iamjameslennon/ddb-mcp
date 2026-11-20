# Ready Carry-overs 2026-11-20 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open items that need no paid account, new test character or website check: the parked skill/initiative bonus gates, (bv), (bu), the two parked import cycles, the (bs) round-3 minor and the 2026-11-19 deferred review minors.

**Architecture:** Small, independent changes inside the existing modules. One new helper module (`src/tools/character/active-mods.ts`) replaces three copies of the "walk the modifier buckets, keep active sources" loop. Name matching changes stay in `src/name-match.ts` and `src/tools/character/definition.ts`.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Node ≥22.

**Spec:** `docs/superpowers/specs/2026-11-20-ready-carry-overs-design.md` (owner-approved 2026-11-20). Read it first; it holds the two owner rulings and their measured impact.

## Global Constraints

- Before every commit: `npm run typecheck && npm run lint && npm test`, all green.
- Commit straight to `main`; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push unless the owner asks.
- The regression skill's `references/` change in the **same commit** as the behaviour or carry-over they describe (CLAUDE.md). `tests/regression-skill.test.ts` checks the carry-over list.
- Closing a carry-over in `history.md` uses the form `**(bv)** ~~…~~ **Closed 2026-11-20** (\`<sha>\`)`, as the existing entries do.
- No sheet number may move unless the task explains it. Run `npx tsx scripts/regress-all-characters.mts --baseline 2.10.2` where a task says so. Its output stays in the OS temp dir and never enters the repo.
- Rulings are dated "owner ruling 2026-11-20". The amended rulings (2026-11-12 lookup rule; R3 2026-11-11) are marked "amended by the 2026-11-20 ruling" where they are recorded, not deleted.
- Unreleased security-relevant code may go only to Zen DeepSeek or Claude for review. This plan has none, so the public-code reviewers (Codex, `freellmapi/auto:reviewers`) are fine. Check every reviewer claim against the code before acting on it.

## Review Focus

1. A skill bonus granted by a **feat or race** must keep counting (only item and class/subclass sources are gated). Test it in Task 1.
2. A skill bonus whose `value` and `fixedValue` are null but `statId` is set (Divine Order: Scholar) must keep adding that ability modifier when its feature is visible. Test it in Task 1.
3. A lookup query that matches **only an action name** (through-action hit) must not trigger the typo pass and lose that hit. Test it in Task 2.
4. A custom-named item must still be found by its **stock** name and by its custom name under the substring pass. Test it in Task 2.
5. A browser-tool error with **no** session change must still surface Playwright's own message, not `SessionChangedError`. Test it in Task 5.

---

### Task 1: One active-modifier walk; gate per-skill and initiative bonuses

**Files:**
- Create: `src/tools/character/active-mods.ts`
- Modify: `src/tools/character/stats.ts` (`activeGlobalBonus` ~line 80, `computeSkillBonuses` `flatBonus` ~line 157, `buildSaveAdvantageLines` ~line 476)
- Modify: `src/tools/character/vitals.ts` (`computeInitiative` ~line 167)
- Test: `tests/character-item-gates.test.ts`

**Interfaces:**
- Produces: `export function activeBucketMods(core: CoreStats): Array<{ bucket: string; mod: Mod }>`. It returns every non-null object modifier in `char.modifiers` whose source is active: `isActiveItemMod(mod, core.inventory)`, and `isVisibleAction(bucket === "subclass" ? "class" : bucket, mod, visibleIds, hiddenOptions)`. Bucket order and list order are kept.

- [ ] **Step 1: Write the failing tests** in a new `describe("per-skill and initiative bonuses (parked 2026-11-20, the (bc) rule)")`, reusing the `gated`, `STATES`, `ACTIVE`, `variant`, `FIGHTER_5` and `cf` helpers already in the file:
  - `bonus` / `arcana` value 2 on an item: each `STATES` entry leaves Arcana unchanged; each `ACTIVE` entry adds +2 to Arcana only (every other skill unchanged).
  - `bonus` / `initiative` value 2 on an item: `STATES` leaves `Initiative:` unchanged; `ACTIVE` adds +2.
  - A class-bucket `bonus arcana` (and `bonus initiative`) from feature 900 at `requiredLevel` 20 is skipped; at 1 it counts. The subclass bucket behaves the same.
  - Review Focus 1: a feat-bucket and a race-bucket `bonus arcana` value 1 count (+1).
  - Review Focus 2: a class-bucket `bonus religion` with `value: null, fixedValue: null, statId: 5` from a visible feature adds the WIS modifier; from a hidden one, nothing.
  - Initiative's `bonusTypes: [1]` with null values still adds the proficiency bonus (+3 on `FIGHTER_5`) when its source is active.
- [ ] **Step 2: Run** `npx vitest run tests/character-item-gates.test.ts`. Expected: the item-state and hidden-feature cases FAIL (bonus counted); the always-count cases pass.
- [ ] **Step 3: Implement** `activeBucketMods` in `active-mods.ts`, importing `isActiveItemMod` from `./item-gate.js` and `hiddenOptionIds`, `isVisibleAction`, `visibleClassFeatureIds` from `./granting.js`. Then rewrite `activeGlobalBonus`, the `flatBonus` reduce, the `initiativeBonus` reduce and `buildSaveAdvantageLines`' loop over it. Keep each value rule as it is. This closes the 2026-11-19 Task 10 minor ("two near-identical bucket loops… an `activeBucketMods` helper").
- [ ] **Step 4: Run** the file, then the full suite. Expected: PASS. `tests/character-module-boundaries.test.ts` must still find no cycle.
- [ ] **Step 5: Measure.** `npx tsx scripts/regress-all-characters.mts --baseline 2.10.2`, compared against a run on the parent commit (`--baseline-dir` on a build of HEAD~ also works). Expected: exit 0. Write down every skill or initiative line that moved, with the character and the modifier source. If none moved, write "no corpus change".
- [ ] **Step 6: Commit** with `fix(character): per-skill and initiative bonuses follow the item gate and the feature visibility rule`. In `history.md`, add a new section "Ready carry-overs 2026-11-20" above "Carry-overs 2026-11-20" holding the commit, the measurement and the Task 10 minor closed, and remove the two lines under "Parked (not carry-over codes yet…)". In `tool-notes.md`, the skill and initiative notes say what is gated.

### Task 2: (bv) the lookup's typo rule becomes a fallback

**Files:**
- Modify: `src/name-match.ts` (add `containsFolded`)
- Modify: `src/tools/character/definition.ts` (`searchDefinitions` ~line 168, `formatCharacterLookup` ~line 420, `matchesDefinitionQuery` line 29)
- Test: `tests/name-match.test.ts`, `tests/character-lookup.test.ts`
- Docs (same commit): `docs/claude/tool-notes.md` (lookup matching note, line 14), `docs/claude/history.md`, `skills/ddb-mcp-regression/references/known-open-issues.md` (remove `(bv)`), `skills/ddb-mcp-regression/references/intended-behaviour.md` (add a "lookup typo rule is a fallback" entry with its `Source:` line), `tests/regression-skill.test.ts` (`expected` loses `"bv"`; adjust the `Source:` count if it is pinned)

**Interfaces:**
- Produces: `export function containsFolded(name: string, query: string): boolean`. It is true when `nameFold(query)` is non-empty and `nameFold(name).includes(nameFold(query))`. This is exactly `matchesLooseName`'s substring branch.
- `searchDefinitions` gains an option `match: (name: string, query: string) => boolean` (default `containsFolded`). Every `matchesDefinitionQuery(...)` call uses it. The through-action inner call (`searchDefinitions(char, parent, …, { viaActions: false })`) always passes `containsFolded`.
- `formatCharacterLookup`: `const strict = searchDefinitions(…, { match: containsFolded }); const hits = strict.length ? strict : searchDefinitions(…, { match: matchesLooseName });`. A through-action hit counts as strict. Action matching (`matchesActionQuery`) is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `name-match.test.ts`: `containsFolded("Eldritch Blast", "eldritch")` is true; `("Eldritch Blast", "bless")` is false; `("Will-o'-Wisp", "will o wisp")` is true; `("x", "")` is false.
  - `character-lookup.test.ts`:
    - (a) Spells [Eldritch Blast, Bless], query "bless": the output is the single Bless block and does not contain "Eldritch Blast".
    - (b) Spells [Mage Armor, Rage feature or a spell named "Rage"], query "rage": no Mage Armor.
    - (c) Spells [Eldritch Blast] only, query "eldrich blast": Eldritch Blast is still found (the typo pass runs because nothing contains the query).
    - (d) Spells [Eldritch Blast] only, query "blast eldritch": found (word order).
    - (e) Review Focus 3: the existing through-action fixture (Battle Medic → Healer) still finds Healer when another entry name would match the query only loosely.
    - (f) Review Focus 4: a custom-named item is found by its stock name and by its custom name.
    - (g) Spells [Trance, Pass without Trace], query "Trace": only Pass without Trace (the recorded loss).
  - Update the two existing tests:
    - "a query that matched four entries…" now expects the three substring hits (Eldritch Blast, Eldritch Blast Focus, Eldritch Blasts), printed as blocks, without Blast Eldritch. Retitle it.
    - The exact-first five-spell test now expects `Found 4 matches` in the order BLESS, Bless’, Blessed Strikes, Blast Bless. Keep the exact-first title, and drop "carry-over (bv)" from it.
- [ ] **Step 2: Run** both files. Expected: (a), (b), (g) and the two updated tests FAIL; the rest pass.
- [ ] **Step 3: Implement** as in Interfaces. Remove the `matchesDefinitionQuery` alias. Update `exactFirst`'s comment, which cites (bv).
- [ ] **Step 4: Run** the full suite. Expected: PASS. The fix-round test "an action name matches without typo tolerance; entry names keep the loose rule" must still pass; if it relies on a loose entry hit alongside a substring one, rework its fixture so it still tests what its title says.
- [ ] **Step 5: Measure.** Re-run the spec's measurement from `/tmp/bvmeasure/m.mts`, or an equivalent that calls `formatCharacterLookup` over the cached corpus in `$TMPDIR/ddb-mcp-regress/characters`. Write down the extra-hit and typo-recall figures.
- [ ] **Step 6: Commit** with `fix(character): ddb_character_lookup uses the typo rule only when no name contains the query (bv)`. Update the docs listed under Files: record the owner ruling 2026-11-20 in the new history section, close (bv) in place, and mark the 2026-11-12 rule in `tool-notes.md` "amended by the 2026-11-20 ruling".

### Task 3: (bu) short monster names need a near-exact match; pin the closest flag

**Files:**
- Modify: `src/name-match.ts` (`isCloseName`; add `osaDistance`)
- Test: `tests/name-match.test.ts`, `tests/monster.test.ts` (the `getMonster closest hit (R3)` describe, ~line 4045)
- Docs (same commit): `tool-notes.md` (`ddb_get_monster` R3 note), `history.md` (close (bu); mark R3 "amended for short queries by the 2026-11-20 ruling" at its record, line ~481), `known-open-issues.md` (remove `(bu)`), `intended-behaviour.md` (the "takes a fuzzy hit only when it is close" entry gains the short-name rule and the new source), `tests/regression-skill.test.ts` (`expected` loses `"bu"`)

**Interfaces:**
- Produces: `export function osaDistance(a: string, b: string): number`, the optimal-string-alignment distance (Levenshtein plus an adjacent transposition costing 1).
- `isCloseName(name, query)`: with `q = nameFold(query)`, when `q.length <= 4` it returns `osaDistance(nameFold(name), q) <= 1 || matchesLooseName(name, query)`. Otherwise it is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `osaDistance`: ("lich", "lihc") = 1; ("ogre", "orge") = 1; ("lion", "lich") = 2; ("abc", "abc") = 0; ("", "ab") = 2.
  - Add rows to the `isCloseName` table: ["Lich", "Lihc", true], ["Ogre", "Orge", true], ["Lion", "Lich", false], ["Ooze", "Ogre", false], ["Lich", "Lion", false]. The existing rows keep their values.
  - `monster.test.ts`:
    - (a) `withFuzzy({ lich: [LION] })` with `LION` an available official monster: `getMonster("Lich")` starts with `Monster "Lich" not found. Closest matches from D&D Beyond:` and lists `- **Lion**`, with no stat block.
    - (b) Closest-flag pin (spec item 2): candidates [`OWLBEAR` in `unownedIds`, an available "Owlbeer"], query "Owlbear". The output does not contain Owlbeer's stat-block marker and does not contain "showing the closest match, Owlbeer".
- [ ] **Step 2: Run** both files. Expected: the Lion/Lich and Ooze/Ogre rows and (a) FAIL; `osaDistance` fails to import; (b) passes. If (b) fails, the locked-twin edge is real: change `monster.ts` ~line 515 to judge `closest` on the shown entry (`!(monsterTwin(found.entry.name) === key || normalizeName(found.entry.name).includes(typed))`) and say so in the history entry.
- [ ] **Step 3: Implement** `osaDistance` and the `isCloseName` change. Update `isCloseName`'s doc comment to say "owner ruling R3, amended 2026-11-20 for queries of 4 characters or fewer".
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(monsters): a short query is close only within one edit (bu)` and the docs listed under Files. The history entry records part 1's finding (unreachable and pinned by test (b), or fixed).

### Task 4: Remove the two parked import cycles; check all of `src/`

**Files:**
- Modify: `src/name-match.ts` (gains `normalizeName`, imports nothing from `edition.ts`)
- Modify: `src/edition.ts` (`normalizeName` becomes `export { normalizeName } from "./name-match.js";`, kept where its callers expect it; the local definition at ~line 222 goes)
- Modify: `src/tools/character.ts` (drop `export { getDefinition } from "./character/definition.js";` line 33)
- Modify: `src/server.ts` line 9 (import `getDefinition` from `./tools/character/definition.js`)
- Modify: `tests/source-index-parallel.test.ts`, `tests/character-logged-out-index.test.ts`, `tests/subclass-spells.test.ts` (import `getDefinition` from `../src/tools/character/definition.js`)
- Test: `tests/character-module-boundaries.test.ts`

**Interfaces:**
- `normalizeName(name: string): string` keeps its body and doc comment, and is importable from both `edition.js` and `name-match.js`.

- [ ] **Step 1: Write the failing test.** Generalise `importGraph` to take a root directory, then add `it("has no value-import cycle anywhere in src/")` over `src/`. Keep the `src/tools/character/` test and the "sees the graph" test. Add a "sees the graph" assertion that `name-match.ts` has no relative value import. Update the file's header comment: no parked cycles remain.
- [ ] **Step 2: Run** `npx vitest run tests/character-module-boundaries.test.ts`. Expected: FAIL, listing `name-match.ts -> edition.ts -> name-match.ts` and `tools/character.ts -> tools/character/definition.ts -> tools/character.ts`.
- [ ] **Step 3: Implement** the moves in Files. `vi.mock("../src/tools/character.js")` in `party.test.ts` still governs `loadCharacterForParse`, since `definition.ts` imports it from there.
- [ ] **Step 4: Run** the full suite and `npm run build`. Expected: PASS, and the build succeeds.
- [ ] **Step 5: Commit** with `refactor: remove the edition ↔ name-match and character ↔ definition import cycles`. In `history.md`, the "Parked by (bm)" paragraph is replaced by a pointer to the new section.

### Task 5: (bs) round 3: report the session change, not Playwright's error; Task 12 navigate minors

**Files:**
- Modify: `src/tools/navigate.ts` (`navigate` ~line 286, `interact` ~line 360, `getCurrentPageContent` ~line 438; the Task 12 doc comment on the no-header case)
- Test: `tests/navigate.test.ts` (the "navigate refuses scraped content across a session transition" describe; `makeFake`)

**Interfaces:**
- Produces (module-private): `async function withSessionCheck<T>(snapshot: SessionSnapshot, run: () => Promise<T>): Promise<T>`. It awaits `run()`. On a rejection it calls `assertSessionUnchanged(snapshot)`, which throws `SessionChangedError` when the session moved, and otherwise rethrows the original error. Each of the three tools runs its body after the first `assertSessionUnchanged` inside it.

- [ ] **Step 1: Write the failing tests.** Extend `makeFake` so a named page operation (`goto`, `evaluate`, `click` via the locator, `fill`, `screenshot`) runs `onX()` and then rejects with `new Error("Target page, context or browser has been closed")`.
  - For each operation, the session flipped in `onX` gives `rejects.toThrow(sf.SessionChangedError)`.
  - Review Focus 5: the same rejection with no session change gives `rejects.toThrow("Target page, context or browser has been closed")`.
  - Task 12 minor: rename the test "a tool goto (no Referer…)" so it names only what it asserts.
- [ ] **Step 2: Run** `npx vitest run tests/navigate.test.ts`. Expected: the session-flip rejection cases FAIL with Playwright's message.
- [ ] **Step 3: Implement** `withSessionCheck` and wrap the three bodies. Leave `leaveForeignPage` calls in place, inside the wrapped body. Fix the Task 12 doc comment: Lax and None cookies are still sent; Strict and partitioned ones are not.
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(browser): a page operation cut off by a session change reports the session change ((bs) round 3)`. In `history.md`, mark the (bs) round-3 line done and the Task 12 minors fixed. The third Task 12 minor (a Strict value containing `;` fails the `name=value` match) stays as recorded: it fails closed and is not a test gap.

### Task 6: Character-sheet deferred minors (2026-11-19 Tasks 4–11)

**Files:** Tests in `tests/character-*.test.ts` and `tests/combat-*.test.ts`, next to each task's existing tests (find them with `git show --stat <task commit>`; the commits are listed in `history.md` "Carry-overs 2026-11-19"). Source:
- `src/tools/character/actions.ts` ~lines 300–310 (Task 6 `isAdd`)
- `src/tools/character/weapons.ts` lines 101–135 (Task 7)
- `actions.ts` ~line 334, `definition.ts` ~line 371, `weapons.ts` ~line 180, `inventory.ts` ~line 66 (Task 8)
- `src/tools/character/vitals.ts` line 136 (Task 9)
- `src/tools/character/spell-attacks.ts` lines 227–306 (Task 11)
- `docs/claude/tool-notes.md` (Task 7 wording)

**Interfaces:**
- `isAdd(op: unknown): boolean` (module-private in `actions.ts`): `op == null || op === 1`, used at both operator checks.
- `displayItemName(item: InventoryItem, customNames: ReadonlyMap<number, string>): { name: string; renamed: boolean }` in `src/tools/character/inventory.ts`, exported. It is the `<custom> (<stock>)` rule from tool-notes "(ba) display form", used by the four call sites.
- `martialArtsLevelOk(feature, classLevel)` or an equivalent single level check, shared by `martialArts()` and `hasMartialArts`. Keep today's behaviour for `requiredLevel` 0 and for a missing level. If the two differ today, pin the current behaviour of each with a test before merging them, and keep both behaviours if they really differ.

- [ ] **Step 1: Add the missing tests listed in `history.md` "Deferred review minors (2026-11-19)", items Task 4 to Task 11, one `it` per listed gap. Do not add the ones marked "(fixed in the final fix wave)".** Each asserts current behaviour, so it passes on today's code. A test that fails has found a bug: stop and report it instead of fixing it in this task.
- [ ] **Step 2: Run** the touched files. Expected: PASS (see Step 1 for a failure).
- [ ] **Step 3: Refactor:**
  - `isAdd`.
  - `displayItemName`.
  - The shared Martial Arts level check.
  - The stale `weapons.ts:101` docstring.
  - The Task 9 null-`set` check: no code change. A `set` with both `value` and `fixedValue` null is the (by) rule's "equal to walking speed" case by design. The Task 9 tests from Step 1 pin it, and the `walkSpeed = 0` default parameter goes if every caller passes a value.
  - Build Task 11's definition guard and `spellRowCtx` once per sheet and pass them down.
  - Remove the duplicated `HEX` in the describe.
  - Fix the Task 7 tool-notes wording ("at or below its class level" gates the feature, not the modifier; "explicit 0 as 0" matches `hasMartialArts`).
- [ ] **Step 4: Run** the full suite, then the whole corpus (`--baseline 2.10.2`). Expected: PASS. The corpus output must be byte-identical to the run made after Task 1: these are refactors.
- [ ] **Step 5: Commit** in two commits: `test(character): cover the 2026-11-19 deferred review gaps` and `refactor(character): fold the 2026-11-19 deferred review duplications`. In `history.md`, mark each minor handled.

### Task 7: Search and library deferred minors (2026-11-19 Tasks 2–3)

**Files:**
- Test: `tests/search-site*.test.ts` or the file that holds `ddb_search_site` category tests (`grep -l "category" tests/*.ts`)
- Test: `tests/monster-session.test.ts`, `tests/library-editions.test.ts` (~line 134), the `stripHtml` / collapse tests (`grep -l "collapse" tests/*.ts`)

- [ ] **Step 1: Write the tests.**
  - Task 2: `ddb_search_site` with category `"all"` shows a monster-section `SessionChangedError` as an `_msg_` section (pin today's output).
  - In `monster-session.test.ts`, replace the no-op `rethrowSessionChange` mock with the real one (`vi.importActual`), or a mock that rethrows `SessionChangedError`, so a future session test there is not silently swallowed. Existing tests must still pass.
  - Task 3: remove the redundant `route([...])` and the duplicated book object at `library-editions.test.ts:134`. Add an end-to-end test that the `ddb_read_book` query jump lands correctly on collapsed text, plus CRLF and U+2028 cases for the blank-line collapse (B14).
- [ ] **Step 2: Run** the touched files. Expected: PASS. A failure is a bug: stop and report it.
- [ ] **Step 3: Commit** with `test: cover the 2026-11-19 deferred search and library gaps`. In `history.md`, mark them handled.

### Task 8: Records, whole-corpus check, reviews

**Files:** `CLAUDE.md` (Open work: add item 12 "Ready carry-overs 2026-11-20"; item 2/3 lists unchanged; refresh the unreleased-commit count with `git rev-list --count v2.10.2..HEAD`), `docs/claude/history.md` (the new section's summary, reviews, final measurements), memory note `project_next.md` (outside the repo).

- [ ] **Step 1: Whole corpus.** `npx tsx scripts/regress-all-characters.mts --baseline 2.10.2`. Expected: exit 0, 56 of 56, 0 crashes, 0 inconsistencies, 0 new anomalies. Every difference from the pre-round baseline is traced to Task 1 (if any moved) or is the known always-prepared noise.
- [ ] **Step 2: Live check** with the built server (`npm run build`), logged out:
  - `ddb_get_monster "Lich"` gives the Lich stat block;
  - `"Lihc"` gives Lich with the closest line;
  - a short non-name that has a 2-edit neighbour gives "not found" with near matches;
  - `ddb_character_lookup` on a public test character whose sheet has Bless and Eldritch Blast: "bless" gives Bless alone (pick the character from `testcharacters.md`).
- [ ] **Step 3: Adversarial reviews**, one per behaviour change (Tasks 1, 2, 3, 5), by Codex or `freellmapi/auto:reviewers` with the diff and the touched files pasted. Check every claim against the code; fix what is confirmed; record the reviews in `history.md` as the earlier rounds did.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test`. Expected: all green.
- [ ] **Step 5: Commit** with `docs: ready carry-overs 2026-11-20: rulings, measurements, reviews`.
