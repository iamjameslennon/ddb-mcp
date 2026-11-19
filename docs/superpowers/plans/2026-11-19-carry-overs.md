# Carry-overs (2026-11-19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close twelve open carry-overs of `docs/claude/history.md` — (bf) with the deferred `statTotals` null-entry minor, (bq), (B14), (bz), (bt), (bd), (bl), (ba), (by), (bc) with the (bh) remainder, (bj), and residual (5) of (bx) — under the owner rulings below, without changing any earlier ruled behaviour except where a ruling here says so.

**Architecture:** Each fix stays inside one module. The character-sheet fixes are in `src/tools/character/*`: null-safe reads in `ac.ts`, `core.ts` and `stats.ts` (Task 1); the override rule in `core.ts` (Task 4); EQUIPPED stacks in `inventory.ts` (Task 5); proficiency-bonus uses in `actions.ts` (Task 6); the monk Unarmed Strike in `weapons.ts` (Task 7); custom item names through a new helper in `helpers.ts` used by `inventory.ts`, `weapons.ts`, `actions.ts` and `definition.ts` (Task 8); two speed gaps in `vitals.ts` (Task 9); the global save bonus in `stats.ts` (Task 10); figures on bonus-action and reaction spell lines in `spell-attacks.ts` + `actions.ts` (Task 11). The non-sheet fixes are `src/tools/monster-search.ts` (Task 2), `src/tools/library.ts` (Task 3) and `src/tools/navigate.ts` (Task 12). Each task is TDD against hand-built fixtures in the live data shapes recorded below.

**Tech Stack:** TypeScript (ESM, Node ≥22), vitest, Playwright 1.65.1 (Task 12), zod (tool schemas in `src/server.ts`, untouched).

**Spec:** none separate. The carry-over entries in `docs/claude/history.md` (search each code) are the requirements, plus the owner rulings below. Read `CLAUDE.md`, `docs/claude/tool-notes.md`, `docs/character-refactor.md` (regression layers 3 and 4) and, for Task 12, history.md's (bx) entry and the Task 12c notes before starting.

## Owner rulings 2026-11-19 (to be recorded in `docs/claude/history.md` by Task 13)

- **(bc): gate the global save bonus on equipped/attuned.** `bonus saving-throws` modifiers go through `isActiveItemMod`, as G1/G2 did for proficiencies and ability scores. Numbers on affected characters drop to match dndbeyond.com. A class- or subclass-bucket one is also skipped by the visibility rule save advantages use (closes the (bh) remainder).
- **(bj): reverses the 2026-11-09 ruling.** Bonus-action and reaction spell lines print range, to-hit or save DC, and damage like the website, by `computeSpellAttackRows`' rules. Website reference: Cathartic 112305147's Spiritual Weapon reads `60ft. +8 1d8+4`.
- **(bx): drop SameSite=Strict (and partitioned) cookies from the redirect walk for cross-site-initiated GETs.** No live impact today (the session holds only Lax and None cookies); defence in depth.
- **(bz): a manual Override Score wins outright**, even when lower than an item's `set` score. This reverses the 2026-11-18 `max(override, set)` behaviour.

## Investigation results the plan relies on (verified 2026-11-19)

Corpus = the 56 characters of `testcharacters.md`, cached by `scripts/regress-all-characters.mts` in `<os tmpdir>/ddb-mcp-regress/characters/<id>.json` (plus `<id>.always-prepared.json`); on this machine `$TMPDIR` is `/var/folders/y9/gj_cjd6x10b2p439g89f7rhm0000gn/T/`. The last 2026-11-19 run's per-character output is under `run-2026-11-19T16-03-18-514Z/head/<id>-<section>.txt`. Nothing from it goes into the repo. Counts below come from those JSON files (Ethelrede and Aerin were also re-fetched live on 2026-11-19 from the public endpoint).

- **(bf):** `ac.ts:31` reads `arr<Record<string, unknown>>(char.characterValues).find(v => num(v.typeId) === 1)`, which throws on a null entry. The same unsafe read is at `stats.ts:434` (the typeId-35 language loop). `core.ts:64-66` reads `char.stats`, `char.bonusStats` and `char.overrideStats` with `arr`, and `statTotals` does `s.id` on each, so a null `stats` entry throws in `computeCoreStats` before `notReadyParts` runs (`identity.ts:137-138` already uses `records`, so `notReadyParts` alone is safe: tests/character-parser.test.ts:3187). `helpers.ts:15` has `records`, which drops null and non-object entries. Corpus: no null entries in any of the four arrays. No corpus change.
- **(bq):** `monster-search.ts:595`'s `catch {` goes straight to `o5SearchMonstersSection(params, "unavailable")` (or `HOMEBREW_UNREACHABLE`). `getMonster` (`monster.ts:564`) and the catalog tools call `rethrowSessionChange(err)` first; it is exported from `session-fetch.ts` and defined at `session-state.ts:276` (walks the `cause` chain, 8 deep). The first page of a search is not caught by the inner `.catch(() => null)` calls (`monster-search.ts:243`, `:263` skip index 0; `:318` is the alias spellings), so a first-page `SessionChangedError` reaches the outer catch. In `ddb_search_site`'s `all` category `search.ts:33` already turns a rejected section into an `_<message>_` text, so a rethrown session change reads as that message there. No corpus data involved.
- **(B14):** `extractArticleMarkdown` (`library.ts:360-401`) builds `\n\n## x\n\n`, `\n<p>\n`, `\n- li` and `\n---\n` fragments, so adjacent block elements and empty paragraphs give runs of 3+ newlines and whitespace-only lines. `readBook` (`:499-575`) searches headings in `content`, then cuts `contentToReturn.slice(0, maxChars)`. Collapsing inside `extractArticleMarkdown` therefore happens before both. No corpus data (books need an account that owns them).
- **(bz):** `core.ts:150-153`: `calculated = override != null ? override : min(base + scoreBonuses, 20) + bonusVal`, then `scoreSetValues[id] != null ? max(calculated, set) : calculated`. Corpus: overrides exist on 3 characters (Harry 17931478 CON 5; Sister Baronessa 39876541 DEX 16, WIS 18; Aerin 68903271 STR 15, DEX 14, INT 12, WIS 14), and `set …-score` modifiers on exactly one (Laena 26158232, CON 19, active, no override). **No character has both: the change alters no corpus number.** Existing tests have no override-vs-set case.
- **(bt):** `inventory.ts` pushes `{ text: iName }` for an equipped non-armor magic or attunable item, dropping `qty`. Wrapping is already applied by `formatInventoryBlock` (`wrapIfHomebrew` per EQUIPPED entry) but untested. Corpus: 15 equipped stacks with quantity above 1 (Javelins, Darts, Arrows, Bolts); none is magic or `canAttune`. **No corpus change.**
- **(bd):** `limitedUse` has no multiplier field. The fields are `maxUses`, `numberUsed`, `statModifierUsesId`, `operator`, `useProficiencyBonus`, `proficiencyBonusOperator`, `resetType`. Rule-data `operators` is `1 Addition, 2 Multiplication`; `minimumLimitedUseMaxUse` is 1. All 79 corpus `actions.*` limited uses have `operator` 1 and `proficiencyBonusOperator` 1. 12 of them have `useProficiencyBonus: true`; 11 with `maxUses: 0` are dropped by `hasUses` (`actions.ts:505`); one has `maxUses: 4`. They are: Luck Points (Sheila 133059215, Human Fighter 152570663; level 1, PB +2), Draconic Cry (Spurt 145414075, PB +2), Stonecunning (Tremorsense) (Dwarf Cleric 152570649, PB +2), Stone's Endurance (Stone Giant) (Goliath Barbarian 152579009, PB +2), Favored Foe (Therai 39712797 PB +2, Ehsu 42519628 PB +4, Aerin 68903271 PB +3), Nature's Veil and Deft Explorer: Tireless (Ehsu), Chef: Cook Treats (Petit Nuage 40193614, PB +3, `maxUses: 0`) and **Chef: Special Food** (Petit Nuage, `maxUses: 4`, Short Rest, PB +3; printed today as `4 max`). What the site shows: recorded only for Goliath's Stone's Endurance, `1 Use (2/2)` (2026-11-19 report), which fits uses = `maxUses + PB` = 0 + 2. Chef: Special Food is unrecorded: the additive reading gives 4 + 3 = 7 (the 2024 Chef text is "4 plus your proficiency bonus"), a **plan assumption to check on the site (Task 13 Step 3)**. 8 further rows have `statModifierUsesId` with `maxUses: 0` (already listed). Visibility (`isVisibleAction`) can hide some of the 12 (Ehsu has `enableOptionalClassFeatures: false`): the corpus diff decides. Item-level `limitedUse` (`buildItemChargeLines`) has no `useProficiencyBonus: true` entry in the corpus and stays as is.
- **(bl):** `computeUnarmedStrike` (`weapons.ts:128`) takes `Math.max(STR, DEX)` only when `martialArts(core)` finds a `levelScale.dice.diceString`; `computeWeaponAttacks` already has a wider `hasMartialArts` (`weapons.ts:156`: a `martial-arts` modifier, or a class feature named `Martial Arts` at or below the class level). Corpus: 3 monks (Flemin 112315775, Diana 133054584, Petit Nuage 40193614), all three with a `levelScale` die, and no `martial-arts` modifier anywhere. **No corpus change.**
- **(ba):** `characterValues` entries `{typeId: 8, value, valueId, valueTypeId}`. Live, `valueId` and `valueTypeId` are **strings** (`"528689781"`, `"1439493548"`). `valueTypeId` 1439493548 is the inventory entry's own `entityTypeId` (all 1,082 corpus inventory entries have it) and `valueId` is the inventory entry's `id` (not the definition's). 6 of 56 characters have a typeId-8 entry, 35 entries in all:
  - 28 entries on 4 characters apply (they match an inventory entry): Gale 107165979 (2: "Robes" over Clothes, Common; "Lantern" over Lantern, Hooded; both carried), Ezra 127373542 (1: "Drake's Tooth Dagger" over the equipped Dagger, +1), Ehsu 42519628 (5: Battlement Longbow +1 (equipped, homebrew definition), Baldur's Gate Common Map, Softbound Journal (25 pages), Rope Attached Arrow over Arrows ×3, Pot, Clay), Xarius 58640338 (20: 14 over Other Gear, e.g. "Sack (Clothes)" over Sack, and 6 equipped weapons: "_Rapier (Rage Bonus)", "Sun Blade (Rage Bonus)", "xDagger", "xDart", "xSpear", "_Rapier").
  - 7 entries match no inventory entry and are ignored: Calderax 14814039 (4, `valueTypeId` 112130694), Therai 39712797 (2, 112130694 and 1782728300) and Ehsu's "Placeholder Battlement Bow" (1782728300). They look like names on entities that no longer exist.
  - Names on the site carry a `*` (Xarius: `xDagger*`, `_Rapier*`).
  - Name sites in code: `inventory.ts` (`iName` for EQUIPPED, INVENTORY and ATTUNEMENT), `weapons.ts:187` (`wLabel`), `actions.ts:558` (item charge lines), `definition.ts:370-379` (the lookup's Equipped Items).
- **(by):** (1) `speedCalc` (`vitals.ts:106`) filters `set` modifiers by `num(m.value ?? m.fixedValue) > 0`, so a null-valued `set innate-speed-<axis>` does nothing. Corpus: 3 such modifiers on 2 characters: Ehsu's Roving climbing and swimming (class bucket, `componentTypeId` 258900837 = an option, `componentId` 1306484 = the option's definition id; `enableOptionalClassFeatures: false`) and Aerin's Slippers of Spider Climbing (item bucket, `componentId` 4755, `componentTypeId` 112130694, unequipped). (2) The orphan rule (`vitals.ts:91-99`) puts a `class`/`subclass` modifier whose `componentId` is not a class feature id into `skippedClassMods`; Roving's `componentId` is the option's id, which is never a class feature id, so it would be dropped even with optional features on. Ehsu's option's parent (class feature 3035679) is in neither `classFeatures` nor `optionalClassFeatures` (both empty), so `hiddenOptionIds` (`actions.ts:222`) lists 1306484 as hidden. Characters with optional class features on (`optionalClassFeatures` non-empty): Ezra 127373542, Petit Nuage 40193614, Xarius 58640338; none has an option speed modifier. Of the 13 corpus speed modifiers only Ehsu's and Aerin's are option- or null-shaped. **Expected corpus change: none** (Ehsu stays `40 ft., burrow 10 ft.`; Aerin's unequipped Slippers grant nothing).
- **(bc) and (bh) remainder: the history entry's examples do not hold.** The only `bonus saving-throws` modifiers in the corpus are Calderax's Ring of Protection and Xarius's Stone of Good Luck, both on equipped, attuned items; no class- or subclass-bucket one exists. Ethelrede 112314883 and Aerin 68903271 have none (live data of 2026-11-19 re-checked): the "unequipped Battleaxe +1 / Slippers" in history.md and the 2026-11-07 spec are the `bonus magic` and `set innate-speed-climbing` modifiers of those items, not save bonuses. **Expected corpus change: none.** The fix is latent; its tests use synthetic fixtures. The same ungated read exists for `bonus ability-checks` (`stats.ts` `globalAbilityCheckBonus`; the only corpus instance is Xarius's equipped Luckstone). It is out of scope; Task 13 records it as a parked item.
- **(bj):** 44 bonus-action and reaction spell lines on 26 characters print today as `• <name> (spell, <label>)` (last run, `…-combat.txt`). By definition data about 17 of them would gain figures: Spiritual Weapon ×3 (Cathartic 112305147, Sister Baronessa 39876541, Zayda 49128422; `attackType` 1, 60 ft., one damage modifier `1d8` force with **`usePrimaryStat: true`**), Shillelagh ×1 (`usePrimaryStat: true`), Hellish Rebuke ×2 and Ensnaring Strike ×2 and Dragon's Breath ×1 (a save plus a damage modifier), Sanctuary ×2 (a save, no damage), Hex ×1 and Hunter's Mark ×4 (a damage modifier, no attack or save), Spirit Shroud ×1. The other 27 (Healing Word, Shield, Shield of Faith, Misty Step, Feather Fall, Lesser Restoration, Mass Healing Word, Jump, Magic Weapon) have no attack roll, save or damage modifier and stay unchanged. The exact count is the corpus diff's. `usePrimaryStat: true` on a damage modifier means "add the casting ability's modifier" (Spiritual Weapon `1d8+4` on the site). `spellDamage` reads it only for weapon-attack cantrips today. Corpus spells with `usePrimaryStat` damage: Bigby's Hand (an action spell with no attack roll, not shown), Green-Flame Blade (weapon path), Shillelagh, Spiritual Weapon. **No existing ACTIONS row changes.**
- **(bx)(5), verified live 2026-11-19** (Chrome 157 via `channel: "chrome"`, Playwright 1.65.1, two local servers `127.0.0.1` and `localhost`, a foreign page with `target="_top"` links):
  - The route handler's `request.headers()` **includes a `cookie` header that Chrome already filtered by SameSite**: `lax=1` for a cross-site `target=_top` link (with or without `rel=noreferrer`), `lax=1; strict=2` for a same-site link and for `page.goto`. It also has `referer` (the foreign origin; absent with `rel=noreferrer`); it has no `sec-fetch-*` (the server saw `Sec-Fetch-Site: cross-site` / `same-origin` / `none` only on Chrome's own request).
  - The current walk deletes that header, and Playwright fills the whole jar when the request has none: `route.fetch` without a `cookie` header sent `lax=1; strict=2` for the cross-site link. That is the leak.
  - An explicit `cookie` header is honoured (`lax=1` was sent as given) and `cookie: ""` sends an empty header (no jar fill). Playwright's `_updateRequestCookieHeader` only fills when the header is absent.
  - `context.cookies(url)` returns `sameSite` (`Strict|Lax|None`) and `partitionKey?` for each cookie. No cookie in the saved session is Strict or partitioned (11 Lax, 4 None, checked 2026-11-18).
  - **Consequence:** the signal that tells a navigation is cross-site-initiated is Chrome's own `cookie` header. No Referer or `Sec-Fetch-Site` heuristic and no "tool-initiated" marker is needed. A tool `goto` and a same-site click get the Strict cookies Chrome sent; a cross-site one does not. The Referer is not used: `rel=noreferrer` removes it and a missing Referer cannot tell `goto` from a cross-site link.
  - **Design (decided here):** each walked hop sends `context.cookies(hopUrl)` minus every Strict or partitioned cookie that Chrome did not itself send on the first request (match by `name=value` against `req.headers().cookie`). Lax and None non-partitioned cookies are always sent (Chrome sends them on a cross-site top-level GET). If the request has no `cookie` header at all, Strict and partitioned cookies are all dropped (fail closed). The decision is the same for every hop, since every hop is allowlisted and same-site with the first.

## Global Constraints

- Run `npm run typecheck && npm run lint && npm test` before every commit and get all three green.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to branch `carry-overs-2026-11-19`. **Never push.**
- Earlier owner rulings stand (CLAUDE.md "Owner rulings are recorded with dates"), except the two reversed above ((bj) reverses 2026-11-09; (bz) reverses 2026-11-18's `max()`). Do not relitigate, for instance:
  - carry-over (be)'s anti-goal of adding a modifier D&D Beyond leaves out (so Task 7 invents no Martial Arts die and Task 11 adds only the ability modifier D&D Beyond flags with `usePrimaryStat`);
  - R2/R3 of 2026-11-13 (snippet dice, snippet DC);
  - R1 of 2026-11-18 (restricted proficiencies are not applied).
- **Untrusted text** (CLAUDE.md "Untrusted text"): a custom item name (Task 8) is player-authored, so every line that prints it is wrapped whole through `wrapUntrusted`/`wrapIfHomebrew`, and official, unrenamed content stays plain; tests assert both. No tool builds its own edition text.
- **Snapshots and corpus:** `tests/__snapshots__` changes are deliberate; run `npx vitest run tests/character-snapshot.test.ts -u` only in the task that changes that output, and read the diff. Every character-sheet task states which check proves it:
  - the quick check, `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --only <ids> --diff` (needs no login), against the baseline built in Setup; its diff must hold only the lines the task lists;
  - the live-character snapshot, `npx tsx scripts/snapshot-live-characters.mts` (needs a saved `ddb_login` session), diffed in Task 13.
- **Regression skill sync** (CLAUDE.md), **in the same commit** as the change: each task deletes its `### (code)` section from `skills/ddb-mcp-regression/references/known-open-issues.md` and removes the code from the `expected` array of `tests/regression-skill.test.ts` (the "lists exactly the open carry-overs" test fails otherwise); `intended-behaviour.md` gets an entry where the task says so. `docs/claude/history.md` is updated once, in Task 13, where each entry is struck through. `coverage-matrix.md` needs no change.
- Implementers never dispatch subagents.

## Setup (one commit, before Task 1)

- [ ] Commit this plan: `git add docs/superpowers/plans/2026-11-19-carry-overs.md && git commit -m "docs: 2026-11-19 carry-overs plan"`.
- [ ] Build the baseline `dist/` for the corpus diffs: `git worktree add "$TMPDIR/ddb-base" HEAD && (cd "$TMPDIR/ddb-base" && npm ci && npm run build)`.
- [ ] Capture the live baseline: `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/before.txt"`. If no session is saved, ask the owner to run `ddb_login`; without one, Task 13 Step 1 is skipped and the corpus diff alone proves the sheet changes.

---

## Task 1: Null entries in `characterValues`, `stats`, `bonusStats` and `overrideStats` (bf, deferred minor)

**Implementer model:** sonnet

**Files:**
- Modify: `src/tools/character/ac.ts` (`:31`), `src/tools/character/core.ts` (`:64-66`), `src/tools/character/stats.ts` (`:434`), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bf)`)
- Test: `tests/character-null-entries.test.ts` (new describe), `tests/regression-skill.test.ts` (remove `"bf"` from `expected`)

**Interfaces:** none new. `records` (helpers.ts) is the existing null-dropping reader.

- [ ] **Step 1: Write the failing tests.** Add to `character-null-entries.test.ts`, reusing `SECTIONS`, `BAD`, `variant`, `FIGHTER_5` and `INDEX`:

```ts
describe.each(BAD.map(b => [String(b === undefined ? "undefined" : JSON.stringify(b)), b] as const))(
  "a %s entry in stats, bonusStats, overrideStats and characterValues (bf)", (_label, bad) => {
    const clean = variant(FIGHTER_5, d => {
      d.characterValues = [{ typeId: 1, value: 17, valueId: null }, { typeId: 35, value: 1, valueId: "2" }];
      d.bonusStats = [{ id: 6, value: 2 }];
      d.overrideStats = [{ id: 3, value: 15 }];
    });
    const pad = (list: unknown[]) => [bad, ...list, bad];
    const dirty = variant(clean, d => {
      d.stats = pad(d.stats); d.bonusStats = pad(d.bonusStats);
      d.overrideStats = pad(d.overrideStats); d.characterValues = pad(d.characterValues);
    });
    it.each(SECTIONS)("the %s section renders as if the entry were absent", section => {
      expect(parseCharacterData(dirty, section, INDEX)).toBe(parseCharacterData(clean, section, INDEX));
    });
    it("the AC override and the CON override still apply", () => {
      const out = parseCharacterData(dirty, "summary", INDEX);
      expect(out).toContain("AC: 17");
      expect(out).toContain("CON 15 (+2)");
    });
  });
```

- [ ] **Step 2: Run them.** `npx vitest run tests/character-null-entries.test.ts -t "bf"`. Expected: FAIL (`TypeError: Cannot read properties of null` for `null` and `undefined`; `7`, `"x"`, `true`, `[]` read `.typeId`/`.id` as undefined and pass, so only the two nullish cases must fail).
- [ ] **Step 3: Implement.** `ac.ts`: `import { isBonusMod, isSetMod, num, obj, records, str } from "./helpers.js"` and `const overrideEntry = records(char.characterValues).find(v => num(v.typeId) === 1);`. `core.ts`: `const baseStats = records(char.stats); const bonusStats = records(char.bonusStats); const overrideStats = records(char.overrideStats);` (`records` is already imported there). `stats.ts`: `for (const cv of records(char.characterValues))` (already imported). Leave `arr` calls on string/number arrays alone.
- [ ] **Step 4: Run the file and the parser tests.** `npx vitest run tests/character-null-entries.test.ts tests/character-parser.test.ts`. Expected: PASS, including the existing F12 test at `character-parser.test.ts:3187`.
- [ ] **Step 5: Corpus check.** Not needed (no corpus entry is null); the whole-corpus script in Task 13 confirms no change.
- [ ] **Step 6: Docs and commit.** Delete `### (bf)` from known-open-issues.md and `"bf"` from the test's `expected`. No tool-notes change. Run the three checks, then `git commit -m "fix(character): null entries in characterValues and the score arrays no longer throw (bf)"`.

---

## Task 2: A mid-call session change is not "Open5e unavailable" in the monster search (bq)

**Implementer model:** haiku

**Files:**
- Modify: `src/tools/monster-search.ts` (`:595` catch; import), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bq)`)
- Test: `tests/monster.test.ts` (new tests in the `describe("getMonsterStats: session changes surface, lookup failures are logged"` block, which has `throwOnMonsterSearch` and the `generation` counter), `tests/regression-skill.test.ts` (remove `"bq"`)

**Interfaces:** none. `rethrowSessionChange` is exported from `../session-fetch.js` (as in `monster.ts:15`).

- [ ] **Step 1: Write the failing tests** (inside that describe, so `throwOnMonsterSearch` and `generation` are in scope):

```ts
it("searchMonsters rethrows a SessionChangedError: no Open5e answer labelled unavailable (bq)", async () => {
  throwOnMonsterSearch(new SessionChangedError(), { sessionChanges: true });
  await expect(searchMonsters({ name: "Goblin" })).rejects.toBeInstanceOf(SessionChangedError);
  expect(o5SearchMonstersSection).not.toHaveBeenCalled();
});
it("a SessionChangedError anywhere in the cause chain is rethrown too", async () => {
  const changed = new SessionChangedError();
  throwOnMonsterSearch(new Error("fetch failed", { cause: new Error("aborted", { cause: changed }) }), { sessionChanges: true });
  await expect(searchMonsters({ name: "Goblin" })).rejects.toBe(changed);
});
it("source: homebrew rethrows a session change instead of 'unreachable'", async () => {
  const changed = new SessionChangedError();
  const route = vi.mocked(sessionFetch).getMockImplementation()!;
  vi.mocked(sessionFetch).mockImplementation(async (input: string | URL | Request, ...rest: unknown[]) => {
    if (String(input).includes("/v1/Monster?")) throw changed;
    return (route as (...a: unknown[]) => Promise<Response>)(input, ...rest);
  });
  await expect(searchMonsters({ name: "Zombie", source: "homebrew" })).rejects.toBe(changed);
});
it("a plain outage still falls back to Open5e as unavailable", async () => {
  throwOnMonsterSearch(new Error("socket hang up"));
  await searchMonsters({ name: "Goblin" });
  expect(o5SearchMonstersSection).toHaveBeenCalledWith({ name: "Goblin" }, "unavailable");
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/monster.test.ts -t "bq|cause chain is rethrown too|homebrew rethrows"`. Expected: the three rethrow tests FAIL (the call resolves with the Open5e text), the plain-outage test passes. If a rethrow test does not fail because an inner `.catch(() => null)` swallowed the error first, the throwing URL is an alias spelling: use the typed first page (`/v1/Monster?search=`), as `throwOnMonsterSearch` does.
- [ ] **Step 3: Implement.** In `monster-search.ts` import `rethrowSessionChange` from `../session-fetch.js` (it already imports `captureSession` from there) and make the first statement of the catch at `:595`:

```ts
  } catch (err) {
    // An account change must surface, never be answered from Open5e labelled as an outage
    // (or as homebrew being unreachable): the rule getMonster and getMonsterStats follow (bq).
    rethrowSessionChange(err);
    if (homebrew) return HOMEBREW_UNREACHABLE;
```

  Leave `searchAppearsIn`'s `catch { return []; }` (`:171`, a best-effort hint) and the inner `.catch(() => null)` calls alone.
- [ ] **Step 4: Run the monster suites.** `npx vitest run tests/monster.test.ts tests/monster-session.test.ts tests/server-monster-tools.test.ts tests/session-consumers.test.ts`. Expected: PASS.
- [ ] **Step 5: Docs and commit.** Delete `### (bq)` from known-open-issues.md and `"bq"` from the test's `expected`. Add one clause to tool-notes' monster-search paragraph ("a session change mid-search surfaces, as for `ddb_get_monster`"; grep `getMonster` rethrow wording and match it). Run the three checks, then `git commit -m "fix(monster): a session change mid-search surfaces instead of reading as Open5e unavailable (bq)"`.

---

## Task 3: `ddb_read_book` collapses blank-line runs before `max_chars` (B14)

**Implementer model:** haiku

**Files:**
- Modify: `src/tools/library.ts` (`extractArticleMarkdown`, `:360-401`), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (B14)`)
- Test: `tests/library-parser.test.ts` (extend `describe("extractArticleMarkdown"`), `tests/regression-skill.test.ts` (remove `"B14"`)

**Interfaces:** none. The collapse is part of `extractArticleMarkdown`'s return, so `readBook`'s heading search (`query`) and its `slice(0, maxChars)` both see collapsed text.

- [ ] **Step 1: Write the failing tests.**

```ts
it("collapses runs of blank lines to one (B14)", () => {
  const html = "<article><h2>Intro</h2><p>One</p><p></p><p>  </p><p>Two</p><ul><li>a</li></ul><p>Three</p></article>";
  expect(extractArticleMarkdown(html)).toBe("## Intro\n\nOne\n\nTwo\n\n- a\n\nThree");
});
it("treats whitespace-only lines, non-breaking spaces included, as blank", () => {
  const html = "<article><p>A</p><div>&nbsp; </div><div>\t</div><p>B</p></article>";
  expect(extractArticleMarkdown(html)).not.toMatch(/\n{3,}/);
  expect(extractArticleMarkdown(html)).toMatch(/^A\n\nB$/);
});
it("keeps a single blank line and single newlines as they are", () => {
  expect(extractArticleMarkdown("<article><p>A</p><p>B</p></article>")).toBe("A\n\nB");
  expect(extractArticleMarkdown("<article><p>A<br>B</p></article>")).toBe("A\nB");
});
```

  Run the first one against the current code to read its actual output; if the exact string differs only in where a single blank line sits (e.g. `- a\n\nThree` vs `- a\nThree`), change the expected string to the real collapsed output and keep the assertions that no run of 3+ newlines survives and no line is whitespace-only. Add an end-to-end test in the `readBook` tests of this file (or `library-editions.test.ts`, whichever mocks `sessionFetch` for `readBook`): a page whose first 2,900 chars are blank-run padding followed by text, read with `maxChars: 3000`, now contains the later text (it was cut off before).
- [ ] **Step 2: Run them.** `npx vitest run tests/library-parser.test.ts`. Expected: the first two FAIL.
- [ ] **Step 3: Implement.** Replace the final `return processNode(root as AnyNode).trim();` with:

```ts
  // Adjacent block elements and empty paragraphs leave runs of newlines and lines holding only
  // whitespace (a non-breaking space included, which \s matches); they would use up max_chars (B14).
  return processNode(root as AnyNode)
    .replace(/^[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
```

- [ ] **Step 4: Run the library suites.** `npx vitest run tests/library-parser.test.ts tests/library-editions.test.ts tests/library-resolver.test.ts`. Expected: PASS.
- [ ] **Step 5: Docs and commit.** Delete `### (B14)` from known-open-issues.md and `"B14"` from the test's `expected` (the code is exempt from the history.md check but still listed in `expected`). Add a clause to tool-notes' `ddb_read_book` paragraph ("blank-line runs are collapsed before `max_chars` is applied"). Run the three checks, then `git commit -m "fix(library): ddb_read_book collapses blank-line runs before the max_chars cut (B14)"`.

---

## Task 4: A manual Override Score wins outright (bz, owner ruling)

**Implementer model:** haiku

**Files:**
- Modify: `src/tools/character/core.ts` (`:153` and the comment above it), `docs/claude/tool-notes.md` (the "Other bonus" note, about line 81), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bz)`), `skills/ddb-mcp-regression/references/intended-behaviour.md` (new entry)
- Test: `tests/character-parser.test.ts` (the "Other bonus" describe with the `build` helper, about line 1221), `tests/regression-skill.test.ts` (remove `"bz"`)

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests** (next to "an override ignores the Other bonus"):

```ts
it("a manual override wins even below an item's set score (bz, owner ruling 2026-11-19)", () => {
  const char = build({ base: [10, 12, 14, 10, 13, 8], override: { 3: 15 }, mods: [{ src: "item", type: "set", stat: 3, val: 19 }] });
  expect(parseCharacterData(char, "summary")).toContain("CON 15 (+2)");
});
it("an override above the set score still wins", () => {
  const char = build({ base: [10, 12, 14, 10, 13, 8], override: { 3: 21 }, mods: [{ src: "item", type: "set", stat: 3, val: 19 }] });
  expect(parseCharacterData(char, "summary")).toContain("CON 21 (+5)");
});
it("another ability's set score is unaffected by an override", () => {
  const char = build({ base: [10, 12, 14, 10, 13, 8], override: { 2: 12 }, mods: [{ src: "item", type: "set", stat: 3, val: 19 }] });
  expect(parseCharacterData(char, "summary")).toContain("CON 19 (+4)");
});
```

  The existing "a higher set score still wins over base + Other bonus" test (no override) must stay green.
- [ ] **Step 2: Run them.** `npx vitest run tests/character-parser.test.ts -t "override"`. Expected: the first test FAILS (CON 19), the other two pass.
- [ ] **Step 3: Implement.** In `core.ts`, replace the last line of the `statTotals` map with:

```ts
    // A manual override wins outright, even below an item's set score (owner ruling 2026-11-19, (bz));
    // otherwise a higher set score wins.
    if (overrideVal != null) return overrideVal;
    return scoreSetValues[id] != null ? Math.max(calculated, scoreSetValues[id]) : calculated;
```

  Simplify `calculated` accordingly (`const calculated = Math.min(baseVal + (scoreBonuses[id] ?? 0), ABILITY_SCORE_CAP) + bonusVal;` after the early return, with `overrideVal` read first), and update the comment above (it lists overrides and `set` modifiers as outside the cap: say that an override beats a `set` score too).
- [ ] **Step 4: Run the file.** `npx vitest run tests/character-parser.test.ts tests/combat-features.test.ts`. Expected: PASS.
- [ ] **Step 5: Corpus check.** `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --only 17931478,39876541,68903271,26158232 --diff`: expected zero differences (none of them has an override and a set score).
- [ ] **Step 6: Docs and commit.** tool-notes: rewrite the sentence to "an `overrideStats` value wins outright, even below an item `set` score (owner ruling 2026-11-19, reverses the 2026-11-18 `max()`), and ignores the Other bonus; without one, a higher item `set` score wins". intended-behaviour.md: add "A manual Override Score beats an item's set score" (Looks like: a score below what an Amulet of Health sets; Source: tool-notes, ability scores, owner ruling 2026-11-19). Delete `### (bz)` and `"bz"` from the test's `expected`. Run the three checks, then `git commit -m "fix(character): a manual Override Score wins over an item's set score (bz, owner ruling 2026-11-19)"`.

---

## Task 5: An equipped magic stack keeps its ×N, and EQUIPPED wrapping is tested (bt)

**Implementer model:** haiku

**Files:**
- Modify: `src/tools/character/inventory.ts` (the equipped non-weapon `push`), `docs/claude/tool-notes.md` (inventory note), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bt)`)
- Test: `tests/character-parser.test.ts` (the `describe("parseCharacterData — inventory separator, EQUIPPED magic items…"` block, which has the `entry`/`inv` helpers), `tests/regression-skill.test.ts` (remove `"bt"`)

**Interfaces:** none. The ×N is applied per inventory entry; two entries of one definition stay two EQUIPPED lines (no merging, as today).

- [ ] **Step 1: Write the failing tests.**

```ts
it("an equipped magic or attunable stack keeps its ×N (bt)", () => {
  const out = inv([
    entry(1, "Ring of Warmth", "Ring", { magic: true }, { equipped: true, quantity: 2 }),
    entry(2, "Staff of the Woodlands", "Other", { magic: true, canAttune: true }, { equipped: true, isAttuned: true, quantity: 1 }),
  ]);
  expect(out.split("EQUIPPED\n")[1].split("\n\n")[0]).toBe("  Ring of Warmth ×2\n  Staff of the Woodlands");
});
it("a homebrew item in EQUIPPED is wrapped whole, with its ×N; official items stay plain (bt)", () => {
  const out = inv([
    entry(1, "Odd Ring", "Ring", { isHomebrew: true, magic: true }, { equipped: true, quantity: 2 }),
    entry(2, "Staff of the Woodlands", "Other", { magic: true }, { equipped: true }),
  ]);
  expect(out).toContain(wrapUntrusted("  Odd Ring [homebrew] ×2"));
  expect(out).toContain("\n  Staff of the Woodlands\n");
  expect(out).not.toContain(wrapUntrusted("  Staff of the Woodlands"));
});
it("a player-made item in EQUIPPED is wrapped too (isCustomItem)", () => {
  const out = inv([entry(1, "My Charm", "Other", { isCustomItem: true, magic: true }, { equipped: true })]);
  expect(out).toContain(wrapUntrusted("  My Charm"));
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/character-parser.test.ts -t "EQUIPPED magic|homebrew item in EQUIPPED|player-made item in EQUIPPED"`. Expected: the first two FAIL (no `×2`), the third passes (it pins the existing wrap).
- [ ] **Step 3: Implement.** In `computeInventory` change the branch to `equippedNonWeapons.push({ text: qty > 1 ? \`${iName} ×${qty}\` : iName, homebrew });` (`qty` is already computed above it). Leave the armor branch alone (`(AC n)` and no ×N: armor stacks are not a live shape).
- [ ] **Step 4: Run the file and the snapshot test.** `npx vitest run tests/character-parser.test.ts tests/character-snapshot.test.ts`. Expected: PASS, no snapshot diff (no committed fixture has an equipped magic stack above 1).
- [ ] **Step 5: Corpus check.** None needed: 0 corpus characters have an equipped magic stack above 1 (15 equipped stacks above 1, none magic or attunable).
- [ ] **Step 6: Docs and commit.** tool-notes inventory note: an equipped magic or attunable stack reads `<name> ×N`. Delete `### (bt)` and `"bt"` from the test's `expected`. Run the three checks, then `git commit -m "fix(character): an equipped magic stack keeps its ×N; EQUIPPED wrapping is tested (bt)"`.

---

## Task 6: Uses keyed to the proficiency bonus are listed in LIMITED USE (bd)

**Implementer model:** sonnet

**Files:**
- Modify: `src/tools/character/actions.ts` (`hasUses` `:505`, `buildLimitedUseLines` `:508-535`; `buildItemChargeLines` and `actionParents` call `hasUses` too), `docs/claude/tool-notes.md` (the "Limited use" bullet, about line 87, which says these are not listed yet), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bd)`)
- Test: `tests/combat-features.test.ts` (new describe next to "limited use from an ability modifier (F8)", reusing its `sheet`/`action`/`block` helpers; the fixture fighter is level 5, PB +3), `tests/regression-skill.test.ts` (remove `"bd"`)

**Interfaces:** none new. The maximum is `maxUses + (statModifier if statModifierUsesId) + (PB if useProficiencyBonus)`, each part only for operator 1 (an absent operator counts as 1, as the stat branch already does), floored at 1 (`minimumLimitedUseMaxUse`). Any unknown operator on a part that applies prints `?`.

- [ ] **Step 1: Write the failing tests.**

```ts
describe("limited use keyed to the proficiency bonus (bd)", () => {
  const stats = (cha: number) => [10, 10, 10, 10, 10, cha].map((value, i) => ({ id: i + 1, value }));
  const line = (name: string, lu: Record<string, unknown>, cha = 10, activation = SPECIAL) =>
    block(sheet([action(name, 1, CLASS_FEATURE, activation, { limitedUse: { numberUsed: 0, resetType: 2, maxUses: 0, operator: 1,
      statModifierUsesId: null, useProficiencyBonus: true, proficiencyBonusOperator: 1, ...lu } })], "class", { stats: stats(cha), bonusStats: [], overrideStats: [] }), "LIMITED USE");

  it("uses the proficiency bonus as the maximum (Luck Points shape, level 5: +3)", () => {
    expect(line("Luck Points", {})).toBe("LIMITED USE\n• Luck Points   0 used / 3 max   (Long Rest)");
  });
  it("shows what is used", () => {
    expect(line("Draconic Cry", { numberUsed: 1 }, 10, BONUS)).toContain("• Draconic Cry   1 used / 3 max   (Long Rest)");
  });
  it("adds the bonus to a positive base (Chef: Special Food, 4 + PB)", () => {
    expect(line("Chef: Special Food", { maxUses: 4, resetType: 1 })).toContain("• Chef: Special Food   0 used / 7 max   (Short Rest)");
  });
  it("adds it to a stat-based maximum too", () => {
    expect(line("Odd", { statModifierUsesId: 6 }, 16)).toContain("/ 6 max");   // CHA +3, PB +3
  });
  it("prints ? for an unknown proficiency operator", () => {
    expect(line("Odd", { proficiencyBonusOperator: 2 })).toContain("/ ? max");
  });
  it("lists nothing when the flag is false and there is no stat or base", () => {
    const out = sheet([action("Nothing", 1, CLASS_FEATURE, ACTION, { limitedUse: { maxUses: 0, numberUsed: 0, resetType: 2, useProficiencyBonus: false } })]);
    expect(out).not.toContain("\nLIMITED USE\n");
  });
  it("a homebrew-granted row is wrapped whole, an official one is plain", () => {
    const out = combat({
      classes: [fighter({ classFeatures: [feature(900, "Hex Surge", { isHomebrew: true }), feature(901, "Rally")] })],
      ...actions({ class: [
        action("Hex Surge", 900, CLASS_FEATURE, SPECIAL, { limitedUse: { maxUses: 0, numberUsed: 0, resetType: 2, useProficiencyBonus: true, proficiencyBonusOperator: 1 } }),
        action("Rally", 901, CLASS_FEATURE, SPECIAL, { limitedUse: { maxUses: 0, numberUsed: 0, resetType: 2, useProficiencyBonus: true, proficiencyBonusOperator: 1 } }),
      ] }),
    });
    expect(block(out, "LIMITED USE")).toBe(["LIMITED USE", wrapUntrusted("• Hex Surge   0 used / 3 max   (Long Rest)"), "• Rally   0 used / 3 max   (Long Rest)"].join("\n"));
  });
});
```

  `sheet`, `SPECIAL` and the other imports already exist in that file.
- [ ] **Step 2: Run them.** `npx vitest run tests/combat-features.test.ts -t "proficiency bonus"`. Expected: the Luck Points, Draconic Cry, Chef (`4 max` today), stat-plus-PB, `?` and homebrew tests FAIL; the nothing-listed test passes.
- [ ] **Step 3: Implement.** `hasUses`: `lu.maxUses !== undefined && (num(lu.maxUses) > 0 || lu.statModifierUsesId != null || lu.useProficiencyBonus === true)`. `buildLimitedUseLines` takes `profBonus` (pass `core.profBonus` from `computeActions`) and computes the maximum as one expression: start from `num(lu.maxUses)`; if `statModifierUsesId != null` add the existing stat term (operator 1 or absent, statId 1–6) else mark unknown; if `useProficiencyBonus === true` add `profBonus` when `proficiencyBonusOperator == null || === 1`, else mark unknown; unknown anywhere gives `"?"`; otherwise `String(Math.max(1, total))` when a stat or PB term applies, and the plain positive `maxUses` string as today (no floor change for a plain base). The existing stat-only results must be byte-identical (`maxUses 0 + CHA 16 → 3`, `CHA 8 → 1`, `maxUses 1 + CHA 16 → 4`, operator 2 → `?`).
- [ ] **Step 4: Check the side effects.** `hasUses` is also read by `actionParents` (the `ddb_character_lookup` "found through an action" parents) and by `buildItemChargeLines`' `actionKeys`: run `npx vitest run tests/combat-features.test.ts tests/character-lookup.test.ts tests/character-charged-items.test.ts tests/combat-visibility.test.ts tests/character-homebrew-actions.test.ts`. Expected: PASS; if a lookup test now sees an extra parent for a proficiency-keyed action that is not a shown row, that is the intended widening (the action is listed in LIMITED USE): update the test only after reading why.
- [ ] **Step 5: Corpus check.** `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --only 133059215,152570663,145414075,152570649,152579009,39712797,40193614,42519628,68903271 --diff`. The diff must hold only LIMITED USE lines: at most 12, one added per character per row of the Investigation list (for example `• Luck Points   0 used / 2 max   (Long Rest)` on Sheila and the Human Fighter, `• Stone’s Endurance (Stone Giant)   0 used / 2 max   (Long Rest)` on Goliath), plus Petit Nuage's `• Chef: Special Food   0 used / 7 max   (Short Rest)` replacing `… / 4 max …`. Rows the visibility rule hides (Ehsu has optional class features off) may be absent; anything else is a bug.
- [ ] **Step 6: Docs and commit.** tool-notes "Limited use" bullet: replace the "not listed yet: carry-over (bd)" clause with the rule (uses keyed to proficiency bonus add the bonus to `maxUses`, like the stat term; a non-addition operator prints `?`). Delete `### (bd)` and `"bd"` from the test's `expected`. Run the three checks, then `git commit -m "fix(character): list uses keyed to the proficiency bonus in LIMITED USE (bd)"`.

---

## Task 7: A monk without a Martial Arts level scale still uses the better of STR/DEX (bl)

**Implementer model:** haiku

**Files:**
- Modify: `src/tools/character/weapons.ts` (`computeUnarmedStrike` `:128`, `hasMartialArts` `:156`), `docs/claude/tool-notes.md` (the Unarmed Strike row bullet, about line 95), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bl)`)
- Test: `tests/combat-unarmed.test.ts` (`monk("none", …)` already builds a Martial Arts class feature without a die), `tests/regression-skill.test.ts` (remove `"bl"`)

**Interfaces:** `weapons.ts` gains `function hasMartialArts(core: CoreStats): boolean` (module-private), holding the existing expression from `computeWeaponAttacks` (`allMods.some(m => str(m.subType) === "martial-arts") || classes.some(c => records(c.classFeatures).some(cf => name === "Martial Arts" && num(requiredLevel || 1) <= num(c.level)))`), used by both functions.

- [ ] **Step 1: Write the failing tests** (the `monk` helper's `dieOn: "none"` gives a feature with no `levelScale`):

```ts
it("a Martial Arts feature without a level scale still uses the better of STR/DEX (bl)", () => {
  const overrides = monk("none", 8, 16);
  const core = coreOf(overrides);
  expect(core.statMods.slice(0, 2)).toEqual([-1, 3]);
  expect(row(combat(overrides))).toEqual([`• ${"Unarmed Strike".padEnd(16)} +${3 + core.profBonus} to hit   4 bludgeoning   reach 5 ft.`]);
});
it("invents no Martial Arts die without a level scale", () => {
  expect(row(combat(monk("none", 8, 16)))[0]).not.toMatch(/\dd\d/);
});
it("a martial-arts modifier counts as Martial Arts too", () => {
  const overrides = { stats: stats(8, 16), modifiers: { ...(BASE.modifiers as object), class: [{ type: "bonus", subType: "martial-arts", componentId: 0 }] } };
  expect(row(combat(overrides))[0]).toContain("4 bludgeoning");
});
it("a Martial Arts feature above the class level does not count", () => {
  expect(row(combat(monk("none", 8, 16, { requiredLevel: 9 })))[0]).toContain("0 bludgeoning");   // STR -1: floored at 0
});
it("a non-monk keeps STR", () => {
  expect(row(combat({ stats: stats(8, 16) }))[0]).toBe("• Unarmed Strike   +2 to hit   0 bludgeoning   reach 5 ft.");
});
```

  (Fixture class level is 5, PB +3: STR 8 gives +2 to hit and 0 damage; DEX 16 gives +6 and `1+3`.)
- [ ] **Step 2: Run them.** `npx vitest run tests/combat-unarmed.test.ts`. Expected: the first and third FAIL (STR is used), the others pass.
- [ ] **Step 3: Implement.** Extract `hasMartialArts(core)`; in `computeUnarmedStrike` use `const ma = martialArts(core); const mod = ma || hasMartialArts(core) ? Math.max(statMods[0], statMods[1]) : statMods[0];` and keep the damage as `ma ? \`${ma.die}…\` : String(Math.max(0, 1 + mod))`. `computeWeaponAttacks` calls the helper instead of its inline copy.
- [ ] **Step 4: Run the weapon suites and the snapshot test.** `npx vitest run tests/combat-unarmed.test.ts tests/combat-weapon-bonuses.test.ts tests/combat-offhand.test.ts tests/character-snapshot.test.ts`. Expected: PASS, no snapshot diff.
- [ ] **Step 5: Corpus check.** `--only 112315775,133054584,40193614` with `--diff`: expected zero differences (all three monks have a `levelScale`).
- [ ] **Step 6: Docs and commit.** tool-notes Unarmed Strike bullet: with a `Martial Arts` feature (or modifier) the row uses the better of STR/DEX even when no die is known; the die is never invented. Delete `### (bl)` and `"bl"` from the test's `expected`. Run the three checks, then `git commit -m "fix(character): a monk without a Martial Arts level scale uses the better of STR/DEX (bl)"`.

---

## Task 8: Custom item names are applied, wrapped, with the stock name kept visible (ba)

**Implementer model:** sonnet

**Files:**
- Modify: `src/tools/character/helpers.ts` (new helpers), `src/tools/character/inventory.ts` (`computeInventory`), `src/tools/character/weapons.ts` (`computeWeaponAttacks` `:187`, `:278`), `src/tools/character/actions.ts` (`buildItemChargeLines` `:543`), `src/tools/character/definition.ts` (Equipped Items, `:368-380`), `docs/claude/tool-notes.md`, `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (ba)`), `skills/ddb-mcp-regression/references/intended-behaviour.md` (new entry)
- Test: new `tests/character-custom-item-names.test.ts`, `tests/regression-skill.test.ts` (remove `"ba"`)

**Plan decisions (the owner asked to decide where the name shows and how the stock name stays visible):**
- **Where:** everywhere the item's name prints: EQUIPPED, INVENTORY, ATTUNEMENT, weapon and off-hand rows (ACTIONS / BONUS ACTIONS), item charge lines (LIMITED USE) and `ddb_character_lookup`'s Equipped Items. Not in `homebrewInventoryLine`'s header (it keeps the label `INVENTORY (homebrew)`, which already holds player-made items).
- **The stock name stays visible:** the display name is `<custom> (<stock name>)`, **unless the custom name already contains the stock name, case-insensitively** (`xDagger` over Dagger, `Sack (Clothes)` over Sack, `Battlement Longbow +1` over Battlement Longbow), in which case the custom name alone shows. The edition tag stays last (`editions.named(display, def)`), after the parenthesis.
- **Untrusted:** a renamed item is player-authored text, so its line is wrapped whole, exactly as a homebrew or `isCustomItem` entry is. In practice: `homebrew = shownHomebrew(i, name) || customName != null`. A carried renamed item therefore moves to the wrapped `INVENTORY (homebrew)` list and is never merged with a stock-named copy. An unrenamed official item stays plain.
- **Which entries apply:** `typeId === 8`, `valueTypeId` equal to 1439493548 (string or number), `valueId` an integer (string or number) equal to an inventory entry's `id`, and a `value` that is a non-empty string after whitespace collapse. Anything else is ignored (stale names, other entity types).

**Interfaces:**
- Produces in `helpers.ts`:
  - `export const CUSTOM_NAME_VALUE_TYPE = 8;` and `export const INVENTORY_ENTRY_TYPE = 1439493548;`
  - `export function customItemNames(char: CharData): Map<number, string>`, keyed by inventory entry id, names whitespace-collapsed (`replace(/\s+/g, " ").trim()`), first entry wins. Reads `records(char.characterValues)` only.
  - `export function itemDisplayName(stock: string, custom: string | undefined): string`, per the rule above (`stock` is the already-trimmed stock name; returns `stock` when `custom` is undefined or `stock` is empty).

- [ ] **Step 1: Write the failing tests** in the new file (`parseCharacterData(…, "inventory" | "combat" | "full")`, `variant(FIGHTER_5, …)`, `wrapUntrusted`, `formatCharacterLookup`; the entry builder sets the inventory entry's own `id`):

```ts
const cv = (valueId: string | number, value: string, valueTypeId: string | number = "1439493548") =>
  ({ typeId: 8, value, notes: null, valueId, valueTypeId, contextId: null, contextTypeId: null });
const entry = (id: number, name: string, filterType: string, def: Record<string, unknown> = {}, rec: Record<string, unknown> = {}) =>
  ({ id, equipped: false, quantity: 1, isAttuned: false, ...rec, definition: { id: id + 100000, name, filterType, isHomebrew: false, sources: [{ sourceId: 145 }], ...def } });
const sheet = (inventory: unknown[], values: unknown[]) => variant(FIGHTER_5, d => { d.inventory = inventory; d.characterValues = values; });

describe("helpers", () => {
  it("customItemNames reads string and numeric ids, collapses whitespace, ignores other entity types, empty and non-string values", ...)
    // [cv("5","  A\n B "), cv(6,"C"), cv("7","D","112130694"), cv("8","   "), {typeId:8,value:9,valueId:"9",valueTypeId:"1439493548"}, {typeId:7,...}]
    //   → Map {5 → "A B", 6 → "C"}
  it("itemDisplayName: appends the stock name unless the custom name already contains it")
    // ("Dagger, +1","Drake's Tooth Dagger") → "Drake's Tooth Dagger (Dagger, +1)"; ("Dagger","xDagger") → "xDagger";
    // ("Sack","Sack (Clothes)") → "Sack (Clothes)"; ("Arrows","Rope Attached Arrow") → "Rope Attached Arrow (Arrows)"; ("Lantern, Hooded","Lantern") → "Lantern (Lantern, Hooded)";
    // ("Dagger", undefined) → "Dagger"
});
describe("custom item names (ba)", () => {
  it("a carried renamed item is listed wrapped under INVENTORY (homebrew), never merged with an official one (Gale shape)")
    // inventory [entry(528689781,"Clothes, Common","Other Gear"), entry(1,"Backpack","Other Gear"), entry(2,"Clothes, Common","Other Gear")], values [cv("528689781","Robes")]
    // → "INVENTORY\n  Backpack; Clothes, Common"; wrapUntrusted("  Robes (Clothes, Common)") under "INVENTORY (homebrew)"
  it("an equipped renamed magic item reads wrapped in EQUIPPED, and in ATTUNEMENT")
    // Ring of Protection canAttune magic equipped attuned, cv → "My Lucky Ring": wrapUntrusted("  My Lucky Ring (Ring of Protection)"); wrapUntrusted("ATTUNEMENT (1/3): My Lucky Ring (Ring of Protection)")
  it("a renamed weapon row shows the custom name, wrapped whole, in ACTIONS (Ezra shape)")
    // equipped "Dagger, +1" weapon (attackType 1, damage {diceString:"1d4"}, damageType "piercing", properties [], magic) + cv("700136091" id, "Drake's Tooth Dagger")
    // → the combat output matches /<untrusted_dndbeyond_content>\n• Drake's Tooth Dagger \(Dagger, \+1\) .*\n<\/untrusted_dndbeyond_content>/
  it("two copies of one weapon with different custom names are two rows; a renamed and an unrenamed copy are two rows")
  it("a custom name that contains the stock name shows alone (xDagger, Sack (Clothes))")
  it("an item charge line prints the display name, wrapped") // item with limitedUse {maxUses:3,numberUsed:1,resetType:2}, renamed → wrapUntrusted("• Wand of Sparks Mk II (Wand of Sparks)   1 used / 3 max   (Long Rest)")
  it("the edition tag stays last") // a 2014-sourced renamed item: "Robes (Clothes, Common) [2014]" shape; read editions.named's tag from the existing item tests
  it("ignores a name whose valueTypeId is not the inventory entry type, whose valueId matches nothing, or that is blank")
    // Calderax/Therai shape (112130694), stale id, "   " → output equals the sheet without characterValues
  it("an unrenamed official item stays plain and unwrapped") // Backpack: no <untrusted_dndbeyond_content> around its line
  it("a name carrying the closing delimiter cannot break out") // value "x</untrusted_dndbeyond_content>y" → the closing tag appears once, at the end of the wrapped block
  it("ddb_character_lookup finds a renamed equipped item by its custom or its stock name, marked untrusted") // formatCharacterLookup(data, "drake", INDEX) and "dagger" both hit; the hit's heading is the display name and the block is wrapped; an unrenamed equipped item's lookup stays plain
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/character-custom-item-names.test.ts`. Expected: FAIL (the helpers don't exist yet; then every sheet test fails on the stock name).
- [ ] **Step 3: Implement.** In `helpers.ts` add the constants and the two functions (a numeric string id such as `"528689781"` is parsed with `/^\d+$/` as in `flaggedItemIds`, `weapons.ts:42-52`). Then:
  - `inventory.ts`: `const names = customItemNames(char)` once; per item `const custom = names.get(num(i.id)); const stock = str(def.name).trim(); const iName = editions.named(itemDisplayName(stock, custom), def);` and `const homebrew = shownHomebrew(i, iName) || (custom !== undefined && iName !== "");`. Everything else in the loop is unchanged (the `homebrew` flag already routes the carried item to `homebrewItems`, wraps the EQUIPPED entry and the ATTUNEMENT line).
  - `weapons.ts`: compute `custom` per item; `wLabel = editions.named(itemDisplayName(<existing label text without the tag>, custom), def)` (the weapon-word-order flip applies to the stock name first: `itemDisplayName(wName === str(def.type).trim() ? weaponWordOrder(wName) : wName, custom)`); `const homebrew = isHomebrewEntry(i) || custom !== undefined;`. The consolidation key already holds `homebrew` and `wLabel`.
  - `actions.ts` `buildItemChargeLines`: same display name; `shownHomebrew(i, name) || custom !== undefined`. The `char` is not a parameter today: pass the names map (`customItemNames(char)`) from `computeActions`.
  - `definition.ts` Equipped Items: match `matchesDefinitionQuery` against the custom name and the stock name; `name` = the display name; `untrusted: isHomebrewEntry(item) || custom !== undefined`.
- [ ] **Step 4: Run the sheet suites and the snapshot test.** `npx vitest run tests/character-custom-item-names.test.ts tests/character-parser.test.ts tests/character-homebrew-lines.test.ts tests/character-homebrew-nameless.test.ts tests/character-lookup.test.ts tests/character-charged-items.test.ts tests/combat-weapon-bonuses.test.ts tests/combat-offhand.test.ts tests/character-snapshot.test.ts`. Expected: PASS, no snapshot diff (no committed fixture has a typeId-8 entry; if one does, read the diff).
- [ ] **Step 5: Corpus check.** `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --only 107165979,127373542,42519628,58640338,14814039,39712797 --diff`. Expected differences, nothing else:
  - Gale: INVENTORY loses `Clothes, Common` and `Lantern, Hooded`; a wrapped `INVENTORY (homebrew)` list holds `Robes (Clothes, Common)` and `Lantern (Lantern, Hooded)`.
  - Ezra: the Dagger, +1 row reads `Drake's Tooth Dagger (Dagger, +1)`, wrapped; EQUIPPED/ATTUNEMENT unchanged because it is a weapon (ATTUNEMENT, if attuned, shows the display name, wrapped).
  - Ehsu: `Battlement Longbow +1` (already homebrew, wrapped) and 4 carried items renamed (`Rope Attached Arrow (Arrows) ×3`, …).
  - Xarius: 14 carried items (mostly `Sack (…)`) and 6 equipped weapon rows renamed (`xDagger`, `xDart`, `xSpear`, `_Rapier`, `_Rapier (Rage Bonus)`, `Sun Blade (Rage Bonus)`).
  - Calderax and Therai: no difference (their 6 names are stale).
  Compare every changed line against the Investigation list; the rows must be wrapped.
- [ ] **Step 6: Docs and commit.** tool-notes: a Custom item names bullet (the match rule, the `<custom> (<stock>)` form, the contains-exception, wrapped whole, only inventory-entry names apply). intended-behaviour.md: "A renamed item prints its custom name with the stock name, wrapped" (Looks like: `Drake's Tooth Dagger (Dagger, +1)` in ACTIONS between untrusted tags; `Sack (Clothes)` under `INVENTORY (homebrew)`; Source: tool-notes, owner-facing plan decision 2026-11-19; Xarius's `xDagger*` on the site). Delete `### (ba)` and `"ba"` from the test's `expected`. Run the three checks, then `git commit -m "feat(character): apply custom item names, wrapped, with the stock name kept visible (ba)"`.

---

## Task 9: Two latent speed gaps: a null-valued set speed and an option's modifiers (by)

**Implementer model:** sonnet

**Files:**
- Modify: `src/tools/character/vitals.ts` (`computeSpeed` `:62-148`), `src/tools/character/actions.ts` (export `OPTION_TYPE`), `docs/claude/tool-notes.md` (the Speed bullet, about line 82), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (by)`)
- Test: `tests/character-parser.test.ts` (next to the speed tests, about lines 709 and 1473), `tests/regression-skill.test.ts` (remove `"by"`)

**Interfaces:**
- `actions.ts`: `const OPTION_TYPE = 258900837;` becomes `export const OPTION_TYPE`. `vitals.ts` imports `OPTION_TYPE`, `hiddenOptionIds` and `visibleClassFeatureIds` from `./actions.js` (`weapons.ts` and `stats.ts` already import from it; nothing `actions.ts` imports imports `vitals.ts`, so there is no cycle; confirm with `npm run typecheck`).

**Rules (decided here):**
1. A `type: "set"` modifier on a non-walking axis (`innate-speed-<axis>`) whose `value ?? fixedValue` is **null** means "equal to your walking speed" (Roving's text; the Slippers' restriction). When it applies (`applies(m)`: not skipped, and an active item), that axis's speed becomes `max(its own computed speed, the final walking speed)`. Walking has no such rule. The restriction text is not read (as for every other speed modifier) and never printed.
2. The orphan rule treats a `class`/`subclass` modifier with `componentTypeId === OPTION_TYPE` by its option, not by a class feature id: skipped exactly when `hiddenOptionIds(char, visibleClassFeatureIds(char, classes))` holds its `componentId` (the option's definition id), else it applies. Every other class/subclass modifier keeps the existing "componentId must be a granted class feature id" rule.
3. Item modifiers stay gated by `isActiveItemMod` (already in `applies`); the new null-set path uses the same `applies`.

- [ ] **Step 1: Write the failing tests** (variant of `FIGHTER_5`; the race speed is set explicitly: `d.race.weightSpeeds = { normal: { walk: 30 } }`):

```ts
const ROVING = { componentId: 1306484, componentTypeId: 258900837, isGranted: true };
const roving = (parentVisible: boolean) => variant(FIGHTER_5, d => {
  d.race.weightSpeeds = { normal: { walk: 30 } };
  d.classes[0].classFeatures = parentVisible ? [{ definition: { id: 3035679, entityTypeId: 12168134, name: "Deft Explorer", requiredLevel: 1 } }] : [];
  d.options = { class: [{ componentId: 3035679, componentTypeId: 12168134, definition: { id: 1306484, entityTypeId: 258900837, name: "Roving (6th Level)" } }] };
  d.modifiers.class = [
    { type: "bonus", subType: "speed-walking", value: 5, fixedValue: 5, ...ROVING },
    { type: "set", subType: "innate-speed-climbing", value: null, fixedValue: null, ...ROVING },
    { type: "set", subType: "innate-speed-swimming", value: null, fixedValue: null, ...ROVING },
  ];
});
const speedLine = (c: Record<string, unknown>) => /Speed: (.*)$/m.exec(parseCharacterData(c, "summary", INDEX))![1];
it("an option's modifiers apply when its parent feature is present (Roving, optional features on)", () => {
  expect(speedLine(roving(true))).toBe("35 ft., swim 35 ft., climb 35 ft.");
});
it("an option's modifiers are dropped when its parent feature is absent (Ehsu shape)", () => {
  expect(speedLine(roving(false))).toBe("30 ft.");
});
it("a null set speed equals the walking speed, including bonuses", ...)    // race walk 30 + Mobile feat bonus speed 10 + null set climb → "40 ft., climb 40 ft."
it("a null set speed never lowers a speed the character already has")      // race climb 45, walk 30, null set climb → "climb 45 ft."
it("a null set speed on the walking axis does nothing")                    // null set innate-speed-walking → "30 ft."
it("a zero set speed still does not open the axis")                        // set innate-speed-flying 0 → no fly
it("an item's null set speed grants only while the item is active (Slippers shape)", ...)
  // item mod {type:"set", subType:"innate-speed-climbing", value:null, fixedValue:null, componentId:4755, componentTypeId:112130694, restriction:"Climbing Speed Equal to Walking Speed, Non-Slippery Surfaces Only"}
  // inventory def {id:4755, entityTypeId:112130694, name:"Slippers of Spider Climbing", canAttune:true}:
  // unequipped → "30 ft."; equipped, not attuned → "30 ft."; equipped and attuned → "30 ft., climb 30 ft."
it("never prints the restriction text") // the output never contains "Non-Slippery"
it("a class feature's own modifier keeps the old rule") // a class-bucket mod with componentTypeId 12168134 and an unknown componentId is still skipped
```

- [ ] **Step 2: Run them.** `npx vitest run tests/character-parser.test.ts -t "Roving|null set speed|option's modifiers|Slippers"`. Expected: the Roving-present, null-set and Slippers-active tests FAIL; the Ehsu-absent, zero-set, walking-null and old-rule tests pass.
- [ ] **Step 3: Implement.** In `computeSpeed`: build `visible = visibleClassFeatureIds(char, core.classes)` and `hiddenOptions = hiddenOptionIds(char, visible)` once; in the `skippedClassMods` loop add the option branch ahead of the old test (`if (num(m.componentTypeId) === OPTION_TYPE && cid !== 0) { if (hiddenOptions.has(cid)) skipped.add(m); continue; }`). In `speedCalc`, keep the existing arithmetic and take a `walkSpeed` parameter for non-walking axes: after computing the result, `const followsWalking = axis !== "walking" && allMods.some(m => isSetMod(m) && m.subType === \`innate-speed-${axis}\` && (m.value ?? m.fixedValue) == null && applies(m));` and return `Math.max(result, walkSpeed)` when true. Compute `walkSpeed` first (it already is), then the other four axes with it. Update the long comment above the orphan rule: options are judged by `hiddenOptionIds`.
- [ ] **Step 4: Run the sheet suites.** `npx vitest run tests/character-parser.test.ts tests/character-item-gates.test.ts tests/combat-visibility.test.ts tests/character-snapshot.test.ts`. Expected: PASS, no snapshot diff.
- [ ] **Step 5: Corpus check.** `--only 42519628,68903271,26158232,58640338,40193614,127373542 --diff`: expected zero differences (Ehsu stays `40 ft., burrow 10 ft.`; Aerin's unequipped Slippers grant nothing; Laena's Superior Mobility rule from F6 is unchanged).
- [ ] **Step 6: Docs and commit.** tool-notes Speed bullet: add the two rules (null-valued set = walking speed; an option's modifiers follow the option's parent feature). Delete `### (by)` and `"by"` from the test's `expected`. Run the three checks, then `git commit -m "fix(character): a null-valued set speed equals walking; an option's speed modifiers follow its parent feature (by)"`.

---

## Task 10: The global save bonus is gated on the item and the visibility rule (bc, (bh) remainder, owner ruling)

**Implementer model:** haiku

**Files:**
- Modify: `src/tools/character/stats.ts` (`buildSavingThrows` `:71-90`, its call at `:503`), `docs/claude/tool-notes.md` (saving throws), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bc)`)
- Test: `tests/character-parser.test.ts` (a new describe) or `tests/character-item-gates.test.ts` (which already tests G1/G2 gates; prefer it), `tests/regression-skill.test.ts` (remove `"bc"`)

**Interfaces:** `buildSavingThrows(core: CoreStats)` replaces its four positional parameters (`allMods`, `inventory`, `statMods`, `profBonus` are read from `core`). `stats.ts` already imports `hiddenOptionIds`, `isVisibleAction` and `visibleClassFeatureIds` from `./actions.js` and `isActiveItemMod`.

- [ ] **Step 1: Write the failing tests** (FIGHTER_5 variant; read the SAVING THROWS line as numbers, so the test does not depend on the fixture's proficiencies):

```ts
const saves = (c: Record<string, unknown>) => Object.fromEntries([...parseCharacterData(c, "summary", INDEX).matchAll(/\b(STR|DEX|CON|INT|WIS|CHA) ([+-]\d+)\*?/g)]
  .slice(-6).map(m => [m[1], Number(m[2])]));        // the last six matches are the SAVING THROWS line
const ring = (extra: Record<string, unknown> = {}, bucket = "item") => variant(FIGHTER_5, d => {
  d.inventory = [{ id: 1, equipped: true, isAttuned: true, quantity: 1, definition: { id: 4501, entityTypeId: 112130694, name: "Ring of Protection", filterType: "Ring", canAttune: true, magic: true, sources: [{ sourceId: 145 }] }, ...extra }];
  d.modifiers[bucket] = [...(d.modifiers[bucket] ?? []), { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, componentId: 4501, componentTypeId: 112130694 }];
});
const clean = saves(FIGHTER_5);
it("an equipped, attuned item's save bonus counts on every save (Ring of Protection shape)", () => {
  for (const k of Object.keys(clean)) expect(saves(ring())[k]).toBe(clean[k] + 1);
});
it("an unequipped item's save bonus does not count (bc)", () => expect(saves(ring({ equipped: false }))).toEqual(clean));
it("an equipped item that needs attunement and isn't attuned doesn't count", () => expect(saves(ring({ isAttuned: false }))).toEqual(clean));
it("an item that needs no attunement counts when equipped")   // canAttune false
it("a non-item modifier (race, feat) still counts")          // bucket "feat", no inventory match → +1
```

  and the (bh) remainder:

```ts
const classMod = (bucket: "class" | "subclass", componentTypeId: number, componentId: number, classFeatures: unknown[], options: unknown[] = []) => variant(FIGHTER_5, d => {
  d.classes[0].classFeatures = classFeatures; d.options = { class: options };
  d.modifiers[bucket] = [...(d.modifiers[bucket] ?? []), { type: "bonus", subType: "saving-throws", value: 1, fixedValue: 1, componentId, componentTypeId }];
});
const cf = (id: number, requiredLevel: number) => ({ definition: { id, entityTypeId: 12168134, name: `F${id}`, requiredLevel } });
it("a class-bucket save bonus of a feature above the class level is skipped (the rule save advantages use)", () => expect(saves(classMod("class", 12168134, 900, [cf(900, 20)]))).toEqual(clean));
it("… and counts when the feature is at or below the level", () => expect(saves(classMod("class", 12168134, 900, [cf(900, 1)]))["STR"]).toBe(clean.STR + 1));
it("a subclass-bucket one follows the class rule", ...)
it("an option's save bonus follows its parent: hidden skips, visible counts", ...)   // option {componentId: 900, componentTypeId: 12168134, definition: {id: 901, entityTypeId: 258900837}}; mod componentTypeId 258900837, componentId 901
it("a null entry in a modifier list does not throw")          // d.modifiers.class = [null, mod]
it("proficiency in a save still adds the proficiency bonus once", ...)   // the global bonus does not interact with the * marker
```

  Adjust the `saves` regex to the real SAVING THROWS format (`  STR +5*   DEX +2 …`) after reading one real output.
- [ ] **Step 2: Run them.** `npx vitest run tests/character-item-gates.test.ts`. Expected: the unequipped, unattuned and hidden-class tests FAIL; the counting ones pass.
- [ ] **Step 3: Implement.** `buildSavingThrows(core)`:

```ts
  const { char, classes, inventory, statMods, profBonus } = core;
  const visibleIds = visibleClassFeatureIds(char, classes);
  const hiddenOptions = hiddenOptionIds(char, visibleIds);
  let globalSaveBonus = 0;
  for (const [bucket, list] of Object.entries(obj(char.modifiers))) {
    for (const m of records<Mod>(list)) {
      if (!isBonusMod(m) || m.subType !== "saving-throws" || !isActiveItemMod(m, inventory)) continue;
      // The rule that hides a feature's actions and save advantages: the subclass bucket follows the class bucket.
      if (!isVisibleAction(bucket === "subclass" ? "class" : bucket, m, visibleIds, hiddenOptions)) continue;
      globalSaveBonus += num(m.value ?? m.fixedValue);
    }
  }
```

  The proficiency set keeps reading `core.allMods` (it carries the starting-class filter). Update the call site `buildSavingThrows(core)` and the comment (Stone of Good Luck, Ring of Protection: active items only).
- [ ] **Step 4: Run the sheet suites and the snapshot test.** `npx vitest run tests/character-item-gates.test.ts tests/character-parser.test.ts tests/combat-save-advantages.test.ts tests/character-snapshot.test.ts`. Expected: PASS, no snapshot diff.
- [ ] **Step 5: Corpus check.** `--only 14814039,58640338,112314883,68903271 --diff`: expected **zero differences**. The only two corpus save bonuses (Calderax's Ring of Protection, Xarius's Stone of Good Luck) are on equipped, attuned items; Ethelrede and Aerin have none (see Investigation results: the history.md examples do not hold). If a difference appears, read it against the owner ruling (numbers drop to match dndbeyond.com) and report it.
- [ ] **Step 6: Docs and commit.** tool-notes (saving throws): the global `saving-throws` bonus counts only for an active item and a visible class/subclass feature (owner ruling 2026-11-19). Delete `### (bc)` and `"bc"` from the test's `expected`. Run the three checks, then `git commit -m "fix(character): the global save bonus follows the item gate and the feature visibility rule (bc, owner ruling 2026-11-19)"`.

---

## Task 11: Bonus-action and reaction spell lines print range, to-hit or DC, and damage (bj, owner ruling)

**Implementer model:** sonnet

**Files:**
- Modify: `src/tools/character/spell-attacks.ts` (`computeSpellAttackRows` `:220-276`, `spellDamage` `:145-197`), `src/tools/character/actions.ts` (`formatSpellAction` `:351`, `computeActions` `:574`), `docs/claude/tool-notes.md` (the Combat block bullets, about lines 100-102), `skills/ddb-mcp-regression/references/known-open-issues.md` (delete `### (bj)`), `skills/ddb-mcp-regression/references/intended-behaviour.md` (replace the "Bonus-action and reaction spells print no numbers" entry)
- Test: `tests/combat-spell-rows.test.ts` (new describe; it has `spellDef`, `damage`, `scaled`, `ranged`, `cleric`, `known`, `sheet`, `nums`, `block`), update the test at `:404`; `tests/regression-skill.test.ts` (remove `"bj"`)

**Plan decisions (the ruling says "by `computeSpellAttackRows`' rules"; these make it exact):**
- A bonus-action (activation 3) or reaction (activation 4) spell line gets figures **only when the rules produce some**: a to-hit (`attackType` 1 or 2), a save DC (`saveDcAbilityId` 1–6), or damage (a `damage` modifier that resolves to dice, by `spellDamage`'s rules including `(at Nth-level slot: see spell)`). The figures follow the label as `   <to hit / DC>   <damage>   <range>` and the `(note)` (`scalingNote`), the same parts, order and separators as an ACTIONS spell row, with range as `range N ft.`, `touch` or `self`. A spell with none (Healing Word, Shield, Misty Step, Shield of Faith, Magic Weapon) prints exactly as today, so those lines and their ~27 corpus instances do not change. No gate on cantrip or leveled: a leveled save spell with damage (Hellish Rebuke) now prints its DC and damage here, though not as an ACTIONS row (the ACTIONS gate, `isActionSpell`, is unchanged).
- A damage modifier flagged `usePrimaryStat: true` adds the casting ability's modifier (only when the ability is known), per modifier, on the ordinary damage path (not on the weapon-cantrip path, which already handles it). This is what makes Spiritual Weapon `1d8+4` as the site shows. Today no ACTIONS row has such a modifier on that path, so no ACTIONS row changes.
- Wrapping is unchanged: a homebrew spell's whole line stays wrapped (`wrapIfHomebrew(…, shownHomebrew(spell, name))`).

**Interfaces:**
- `spell-attacks.ts`: split the loop body of `computeSpellAttackRows` into `function spellRowParts(ctx: SpellRowCtx, entry: ActionSpell): { name: string; level: number; hitOrDc: string; damage: string; range: string; note: string } | null` (null when the spell has no name), with `SpellRowCtx = { core, bonuses, singleCasterAbility, activeMods }` built once by `function spellRowCtx(core: CoreStats): SpellRowCtx`. `computeSpellAttackRows` keeps its `isActionSpell` gate and its output byte for byte. New export `export function spellFigures(core: CoreStats): (entry: ActionSpell) => string`, which returns `""` when `hitOrDc` and `damage` are both empty, else `   ${[hitOrDc, damage, range].filter(Boolean).join("   ")}${note ? \`   (${note})\` : ""}`. `ActionSpell` is the existing type from `spells.ts`.
- `actions.ts`: `formatSpellAction(entry, classes, figures)` appends `figures(entry)` to the label inside the existing `wrapIfHomebrew`; `computeActions` builds `const figures = spellFigures(core)` once.

- [ ] **Step 1: Write the failing tests.**

```ts
describe("bonus-action and reaction spell figures (bj, owner ruling 2026-11-19)", () => {
  const act = (activationType: number, name: string, level: number, extra: Record<string, unknown>) =>
    spellDef(name, level, { activation: { activationTime: 1, activationType }, ...extra });
  const SPIRITUAL_WEAPON = act(3, "Spiritual Weapon", 2, { attackType: 1, range: ranged(60), modifiers: [{ ...damage("force", "1d8", scaled([2, "1d8"])), usePrimaryStat: true }] });
  const HELLISH_REBUKE = act(4, "Hellish Rebuke", 1, { saveDcAbilityId: 2, range: ranged(60), modifiers: [damage("fire", "2d10", scaled([1, "1d10"]))] });
  const HEX = act(3, "Hex", 1, { range: ranged(90), modifiers: [damage("necrotic", "1d6")] });
  const SANCTUARY = act(3, "Sanctuary", 1, { saveDcAbilityId: 5, range: ranged(30) });
  const SHILLELAGH = act(3, "Shillelagh", 0, { attackType: 1, range: { origin: "Touch", rangeValue: null, aoeType: null, aoeValue: null }, modifiers: [{ ...damage("bludgeoning", "1d8", CANTRIP_SCALE(8)), usePrimaryStat: true }] });
  const bonus = (o: Record<string, unknown>) => block(sheet(o), "BONUS ACTIONS");
  const reaction = (o: Record<string, unknown>) => block(sheet(o), "REACTIONS");

  it("Spiritual Weapon prints to-hit, damage with the casting modifier, and range (Cathartic shape)", () => {
    const o = cleric(5, [known(SPIRITUAL_WEAPON)]);        // WIS 18: +4
    expect(bonus(o)).toContain(`• Spiritual Weapon (spell, 2nd-level slot)   ${signed(nums(o, 5).attack)} to hit   1d8+4 force   range 60 ft.`);
  });
  it("a reaction save spell prints its DC, damage and range (Hellish Rebuke)", () => {
    const o = cleric(5, [known(HELLISH_REBUKE)]);
    expect(reaction(o)).toContain(`• Hellish Rebuke (spell, 1st-level slot)   DC ${nums(o, 5).dc} DEX   2d10 fire   range 60 ft.`);
  });
  it("a damage-only spell prints its damage and range (Hex)", ...)          // "   1d6 necrotic   range 90 ft."
  it("a save spell without damage prints the DC and range (Sanctuary)", ...) // "   DC n WIS   range 30 ft."
  it("a bonus-action cantrip prints its scaled dice with the modifier (Shillelagh, level 5)", ...) // 2d8+<WIS mod> bludgeoning, "touch"
  it("an upcast without scaling data names the slot, as ACTIONS rows do", ...) // Hex cast with castAtLevel 3 → "1d6 necrotic (at 3rd-level slot: see spell)"
  it("keeps a spell with no figures bare (Healing Word, Shield, Misty Step)", () => {
    const o = cleric(5, [known(act(3, "Healing Word", 1, { range: ranged(60) }))]);
    expect(bonus(o)).toContain("• Healing Word (spell, 1st-level slot)");
    expect(bonus(o)).not.toMatch(/Healing Word \(spell, 1st-level slot\) /);
  });
  it("prints damage but no to-hit when the casting ability is unknown")   // a spells.item entry with no spellCastingAbilityId
  it("a homebrew spell's figures are wrapped whole with its line; an official one stays plain") // isHomebrew: true variant
  it("an action spell's ACTIONS row is unchanged") // Fire Bolt / Sacred Flame rows byte-identical to before
  it("the same spell in two lists is still printed once")                 // existing dedupe in actionSpells
});
```

  Update the existing test at `:404` ("keeps the bonus-action spell line unchanged") to name what it pins: "a bonus-action spell with no figures stays bare".
- [ ] **Step 2: Run them.** `npx vitest run tests/combat-spell-rows.test.ts -t "bj"`. Expected: every figures test FAILS; the bare-line test passes.
- [ ] **Step 3: Implement** the split described under Interfaces. In `spellDamage`'s ordinary-group loop, `const bonus = flatBonus + (m.usePrimaryStat === true && abilityMod != null ? abilityMod : 0)` per modifier, and `const key = withBonus(dice, bonus)`; the weapon-cantrip branch and its `withAbility` handling stay exactly as they are. `actions.ts` passes `figures`. Keep `computeSpellAttackRows` output identical (run the whole file).
- [ ] **Step 4: Run the sheet suites and the snapshot test.** `npx vitest run tests/combat-spell-rows.test.ts tests/character-homebrew-actions.test.ts tests/character-homebrew-nameless.test.ts tests/spell-concentration.test.ts tests/character-parser.test.ts tests/character-snapshot.test.ts`. Expected: PASS. The tests that assert whole `(spell, <label>)` lines for Misty Step, Shield, Hex (no modifiers) stay green; a snapshot diff is expected only if a committed fixture has a bonus-action spell with figures: read it, then `-u` in this task.
- [ ] **Step 5: Corpus check.** `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --diff` (the whole corpus). Expected differences: only lines of BONUS ACTIONS and REACTIONS that start with `• <spell> (spell, …)`, about 17 of the 44 (Spiritual Weapon ×3, Shillelagh, Hellish Rebuke ×2, Ensnaring Strike ×2, Dragon's Breath, Sanctuary ×2, Hex, Hunter's Mark ×4, Spirit Shroud), each in `combat` and `full`. Check Cathartic 112305147's Spiritual Weapon against the site (`60ft. +8 1d8+4`): the tool must print `+8 to hit   1d8+4 force   range 60 ft.`. The other lines (Healing Word, Shield, …) must not change, and no ACTIONS row may change.
- [ ] **Step 6: Docs and commit.** tool-notes Combat bullet (about line 102): replace "keep their lines, with no numbers (owner ruling 2026-11-09; …)" with the new rule and "reverses the 2026-11-09 ruling (owner ruling 2026-11-19)". intended-behaviour.md: replace the entry at "Bonus-action and reaction spells print no numbers" with "A bonus-action or reaction spell has figures only when it has an attack, a save or damage" (Looks like: `• Healing Word (spell, 1st-level slot)` bare next to `• Spiritual Weapon … +8 to hit   1d8+4 force   range 60 ft.`). Delete `### (bj)` and `"bj"` from the test's `expected`. Run the three checks, then `git commit -m "feat(character): bonus-action and reaction spell lines print range, to-hit or DC and damage (bj, reverses the 2026-11-09 ruling)"`.

---

## Task 12: The redirect walk sends no SameSite=Strict or partitioned cookie Chrome withheld (bx)(5)

**Implementer model:** sonnet

**Files:**
- Modify: `src/tools/navigate.ts` (`guardRoute` `:103`, `followAllowedRedirects` `:128`, the doc comments at `:73-102` and `:128-140`), `docs/claude/tool-notes.md` (the Browser tools bullet, about line 49), `CLAUDE.md` (the Architecture bullet about `guardRoute`), `skills/ddb-mcp-regression/references/known-open-issues.md` (edit `### (bx)`: drop the cross-site GET clause, keep the rest)
- Test: `tests/navigate-redirects.test.ts` (update the `makeRoute` helper and the cookie test; new describe)

**Security design (read the Investigation results first):** Chrome's own `cookie` header on the paused request is the authority on what a navigation may send. Each walked hop sends `context.cookies(hopUrl)` minus every cookie with `sameSite === "Strict"` or a `partitionKey` unless the same `name=value` is in the first request's `cookie` header. Lax and None non-partitioned cookies are always sent. A request with no `cookie` header sends no Strict or partitioned cookie (fail closed). This is **reliable**, because it needs no Referer, `Sec-Fetch-Site` or "tool-initiated" marker: a tool `goto` and a same-site click get the Strict cookies Chrome sent, a cross-site `target=_top` link does not. It is stated, not hidden: it trusts that the route handler's `cookie` header is Chrome's SameSite-filtered header, which holds for Chrome 157 / Playwright 1.65.1 (Step 0 re-checks it). A foreign `Origin`, non-GET and the network-failure fallback stay on Chrome's own request, unchanged.

**Interfaces:**
- `guardRoute` reads the context from the request: `req.frame().page().context()`. In `makeRoute` (tests) the fake `frame()` gains `page: () => ({ context: () => ({ cookies }) })`. A throw from the cookie lookup (a closed page) aborts the navigation through the existing generic `route.abort("failed")` catch, never falls back to Chrome's request.
- New exported pure function, so the rule is testable without a route: `export function walkCookieHeader(jar: ReadonlyArray<{ name: string; value: string; sameSite?: string; partitionKey?: string }>, chromeCookieHeader: string | undefined): string`, returning the `Cookie` header value (possibly `""`). `followAllowedRedirects` computes `chromeSent` once from `req.headers()["cookie"]` before it deletes that header, and sets `headers.cookie = walkCookieHeader(await context.cookies(url), chromeCookieHeader)` for **every** hop (`""` when nothing is allowed: Playwright then sends an empty header and does not refill the jar, verified).

- [ ] **Step 0: Re-check the assumption (not committed).** In a scratch directory run a short Playwright script (`channel: "chrome"`, two local servers on `127.0.0.1` and `localhost`, `ctx.addCookies` with one Lax and one Strict cookie for `localhost`, a page on `127.0.0.1` with `<a target="_top" href="http://localhost:PORT/t">`). In `ctx.route("**/t", …)` log `route.request().headers()` and, for each of three modes (no `cookie` header, `cookie: ""`, `cookie: "lax=1"`), call `route.fetch({ headers, maxRedirects: 0 })` then `route.fulfill({ response })`; have the server print the `cookie` header it receives. Expected (as measured 2026-11-19): the route headers hold `cookie: lax=1` for the cross-site link and `lax=1; strict=2` after a `page.goto` to the same URL; the three modes reach the server as `lax=1; strict=2`, `` (empty) and `lax=1`. If any of these differs on the installed versions, stop and report: the design needs Referer-based detection instead.
- [ ] **Step 1: Write the failing tests.** Update `makeRoute` so the request headers can carry a Chrome `cookie` header and the fake context returns a jar:

```ts
const JAR = [
  { name: "Lax1", value: "a", sameSite: "Lax" },
  { name: "Strict1", value: "b", sameSite: "Strict" },
  { name: "None1", value: "c", sameSite: "None" },
  { name: "Part1", value: "d", sameSite: "None", partitionKey: "https://www.dndbeyond.com" },
];
// makeRoute({ …, jar?: typeof JAR }): frame: () => ({ parentFrame: () => null, page: () => ({ context: () => ({ cookies: async (u: string) => { calls.cookieUrls.push(u); return opts.jar ?? JAR; } }) }) })
```

  Replace the existing "never forwards a Cookie or Host header between hops" expectation (`{ "user-agent": "UA" }`) with `{ "user-agent": "UA", cookie: <the computed value> }` (and add that the request's own `host` is gone). New tests:

```ts
describe("walkCookieHeader", () => {
  it("sends Lax and None cookies and drops Strict and partitioned ones Chrome did not send", () => {
    expect(walkCookieHeader(JAR, "Lax1=a; None1=c")).toBe("Lax1=a; None1=c");
  });
  it("sends a Strict cookie Chrome itself sent (same-site initiator)", () => {
    expect(walkCookieHeader(JAR, "Lax1=a; Strict1=b; None1=c")).toBe("Lax1=a; Strict1=b; None1=c");
  });
  it("sends a partitioned cookie only if Chrome sent it", () => { ...Part1... });
  it("matches by name and value: a Strict cookie with another value is not sent")
  it("no Chrome cookie header: only Lax and None, no Strict or partitioned (fail closed)")  // walkCookieHeader(JAR, undefined) → "Lax1=a; None1=c"
  it("an empty result is the empty string, never undefined")  // jar of only Strict, header undefined → ""
  it("a cookie without sameSite counts as Lax")
});
describe("guardRoute: a cross-site-initiated GET is walked without the cookies Chrome withheld (bx)(5)", () => {
  it("a cross-site link (Chrome's cookie header lacks the Strict cookie) fetches with Lax and None only, on every hop", async () => {
    const { route, calls } = makeRoute({ url: A, headers: { cookie: "Lax1=a; None1=c", referer: "https://evil.example/", "user-agent": "UA" },
      server: { [A]: { status: 302, headers: { location: B } }, [B]: { status: 200 } } });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.headers?.cookie)).toEqual(["Lax1=a; None1=c", "Lax1=a; None1=c"]);
    expect(calls.cookieUrls).toEqual([A, B]);
  });
  it("a same-site navigation (Chrome sent the Strict cookie) walks with it, every hop")
  it("a tool goto (no Referer, Chrome sent every cookie) keeps the Strict cookie")
  it("a request with no cookie header and a Strict cookie in the jar sends none of them")
  it("every hop's cookies come from the jar for that hop's URL, never from a header carried over") // the request's own cookie header is never forwarded as is
  it("Playwright's fill-in is prevented: the cookie header is always present, even empty") // headers has own property "cookie", value ""
  it("a cookie lookup that throws aborts the navigation, never falls back to Chrome's request") // cookies() rejects → aborted ["failed"], continued 0, fulfilled []
  it("the cross-site decision does not widen the walk: a foreign hop is still aborted and never fetched")
  it("non-GET, foreign-Origin and subresource requests are still continued natively, without a cookie lookup") // calls.cookieUrls stays []
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/navigate-redirects.test.ts`. Expected: FAIL (`walkCookieHeader` is not exported; the walk sends no `cookie` header).
- [ ] **Step 3: Implement.** In `followAllowedRedirects`: `const chromeCookie = req.headers()["cookie"];` before `withoutHeaders(...)` (which keeps dropping `cookie` and `host`); inside the hop loop, before `route.fetch`, `const cookie = walkCookieHeader(await context.cookies(url), chromeCookie);` with `const context = req.frame().page().context();` read once at the top (outside the `try` that guards `route.fetch`, so a failure aborts via `guardRoute`'s catch), and pass `headers: { ...headers, cookie }`. Rewrite the `guardRoute` doc comment paragraph about "the walk then sends the cookies Chrome would withhold" to say the walk now sends only what Chrome sent plus Lax/None, and the `(bx)(5)` clause of the file's header comment. Do not touch the foreign-`Origin`, non-GET or fallback branches.
- [ ] **Step 4: Run the navigation suites.** `npx vitest run tests/navigate-redirects.test.ts tests/navigate-guards.test.ts tests/navigate.test.ts tests/browser-session.test.ts`. Expected: PASS.
- [ ] **Step 5: Live probe.** Repeat Step 0's local-server probe, but run the real walk logic: import `walkCookieHeader` from `src/tools/navigate.ts` through `tsx` in the scratch script and use it in a `ctx.route` handler that mimics `followAllowedRedirects` for the local URL (the real `guardRoute` refuses non-dndbeyond.com URLs). Expected: the server sees `lax=1` for the cross-site link and `lax=1; strict=2` for the same-site link and for `goto`. Record the result in the commit body; the script is not committed.
- [ ] **Step 6: Docs and commit.** tool-notes Browser tools bullet: the walk's cookie rule (Chrome's own header decides; Strict and partitioned cookies only when Chrome sent them). CLAUDE.md's Architecture bullet keeps "(residuals: carry-over (bx))" but loses nothing else; drop the sentence fragment about walking a cross-site GET with withheld cookies if present. known-open-issues.md `### (bx)`: delete the "a GET navigation started from another site … would send SameSite=Strict or partitioned cookies Chrome holds back (…)" clause and keep the other residuals; **(bx) stays in `expected`** (it is not closed). Run the three checks, then `git commit -m "fix(navigate): the redirect walk sends no Strict or partitioned cookie Chrome withheld (bx)(5, owner ruling 2026-11-19)"`.

---

## Task 13: Verification and docs

**Implementer model:** sonnet

**Files:**
- Modify: `docs/claude/history.md`, `CLAUDE.md` ("Open work"), `docs/claude/tool-notes.md` (anything a task missed), `skills/ddb-mcp-regression/references/*` (anything not already synced)

- [ ] **Step 1: Live snapshot diff** (skip if Setup found no session). `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/after.txt" && diff "$TMPDIR/before.txt" "$TMPDIR/after.txt"`. Every changed line must come from this plan:
  - (bd): LIMITED USE rows for Luck Points, Draconic Cry, Stonecunning, Stone's Endurance, Favored Foe, Nature's Veil, Deft Explorer: Tireless, Chef: Cook Treats, and Chef: Special Food `4 max` → `7 max`, only on snapshot characters among those listed in Task 6;
  - (ba): the renamed items of Gale, Ezra, Ehsu and Xarius, if they are in the snapshot's subset;
  - (bj): bonus-action and reaction spell figures (Spiritual Weapon, Hex, Hunter's Mark, Hellish Rebuke, …).
  Anything else is a bug to fix before going on.
- [ ] **Step 2: Whole-corpus regression.** `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --diff`. Expected: exit 0, 0 crashes, 0 inconsistencies, 0 new anomalies. The differences are exactly:
  - (bd): at most 12 LIMITED USE lines on 9 characters (Task 6);
  - (ba): the renamed lines of 4 characters, wrapped (Task 8); Calderax and Therai unchanged;
  - (bj): about 17 BONUS ACTIONS / REACTIONS lines (Task 11);
  - nothing else: (bf), (bz), (bt), (bl), (by) and (bc) change no corpus line (Tasks 1, 4, 5, 7, 9, 10).
  A line outside this list is a bug.
- [ ] **Step 3: Website checks** (read-only, no clicks; the owner can do them in a browser):
  - Cathartic 112305147: Spiritual Weapon shows `60ft. +8 1d8+4`, and the tool prints `+8 to hit   1d8+4 force   range 60 ft.`.
  - Petit Nuage 40193614: Chef: Special Food's maximum (the tool says 7 = 4 + PB 3). **This is the plan's one unrecorded assumption**; if the site shows 4, change Task 6's rule for a positive base to "`maxUses` alone" and report it.
  - Goliath 152579009: Stone's Endurance `1 Use (2/2)` (the tool says `0 used / 2 max`).
  - Xarius 58640338: the custom names `xDagger*`, `_Rapier*` (the tool prints `xDagger`, `_Rapier` wrapped).
- [ ] **Step 4: Live samples** against a fresh build (`npm run build`): `ddb_get_character` for Cathartic (`combat`), Xarius (`combat`, `inventory`) and Sheila (`combat`); `ddb_read_book` of any owned book with `max_chars: 6500`: no run of 3+ newlines; `ddb_search_monsters({name:"Goblin"})` (a mid-call session change can't be forced by hand, so (bq) rests on its unit tests); `ddb_navigate` to `https://www.dndbeyond.com/` and `…/sources/dnd/phb-2024` still loads (the walked GET with the new cookie header).
- [ ] **Step 5: Docs.**
  - `docs/claude/history.md`: a new section "Carry-overs 2026-11-19" holding
    - the four owner rulings above (verbatim-ish), marking the 2026-11-09 (bj) and 2026-11-18 (bz) entries "reversed by the 2026-11-19 ruling";
    - one line per closed carry-over with its commit (fill the SHAs from `git log --oneline` for Tasks 1-12; the docs commit says "this commit"), and the measured impact from the Investigation results (zero corpus change for (bf), (bq), (B14), (bz), (bt), (bl), (by), (bc); 12 rows on 9 characters for (bd); 28 names on 4 characters for (ba); about 17 lines for (bj); no live cookie change for (bx));
    - the plan decisions: (ba) display form and wrapping, (bj) the figures gate and `usePrimaryStat`, (bd) the additive rule and the Chef assumption, (by) the two rules, (bx) the design and its live verification;
    - the correction that (bc)'s examples (Ethelrede's Battleaxe +1, Aerin's Slippers) were not save bonuses and that no corpus character changed;
    - the parked item: the same ungated read for `bonus ability-checks` (`globalAbilityCheckBonus`), no corpus impact, not a carry-over code yet;
    - the deferred minor "a null entry in `stats` throws in `core.ts` `statTotals` before `notReadyParts` runs" marked fixed in Task 1.
  - Strike through each closed entry in the earlier lists (`**(bf)** ~~…~~ **Closed 2026-11-19**`, likewise (bq), (B14) where it appears, (bz), (bt), (bd), (bl), (ba), (by), (bc), (bh) remainder, (bj)), and add "(5) closed 2026-11-19" to (bx)'s entry (the other residuals stay open). Strike the matching bullet in the "Deferred review minors" list.
  - `CLAUDE.md` "Open work": update the date and the unreleased commit count (`git rev-list --count v2.10.2..HEAD`); add item "Carry-overs 2026-11-19" (done, unreleased, pointing at history.md); delete the (by) and (bz) bullets from item 6 (keep (ca)); in item 5 shorten (bx) to the residuals still open and drop "Open question for the owner: drop Strict cookies in the walk"; in item 3 drop the closed codes from the (ba)–(bo) sentence.
  - `docs/claude/tool-notes.md` and `skills/ddb-mcp-regression/references/*`: read once for anything a task missed; `tests/regression-skill.test.ts` must pass.
- [ ] **Step 6: Commit and clean up.** Run the three checks, then:

```bash
git add docs/claude/history.md CLAUDE.md docs/claude/tool-notes.md skills/ddb-mcp-regression/references
git commit -m "docs: carry-overs 2026-11-19: rulings, closed items, verification"
git worktree remove "$TMPDIR/ddb-base" && git worktree prune
```

## Out of scope

- Carry-overs not listed: (b), (aa), (ah), (ay), (bi), (bk), (bn), (bo), (bp), (br), (bs), (bu), (bv), (bw), (ca), (be) and the other (bx) residuals ((bx)(1)-(4)).
- The ungated `bonus ability-checks` read (parked, Task 13).
- An armor-stack ×N in EQUIPPED and merging two equipped copies of one magic item into one line.
- Item-level `limitedUse` with `useProficiencyBonus` (no corpus case).
- A Martial Arts die from anywhere but D&D Beyond's `levelScale`, and a bonus-action spell's ACTIONS row.
- A Referer-, `Sec-Fetch-Site`- or marker-based cross-site test in the redirect walk (the design needs none).
