# Regression Remediation (2026-11-13 run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding of the 2026-11-13 regression run (F1–F15) under the owner rulings below, without changing any earlier ruled behaviour except where a ruling here says so.

**Architecture:** Most fixes stay inside one module: the monster stat block (`src/tools/monster.ts`), one character-parser domain module (`src/tools/character/*`), the catalog (`src/tools/reference.ts`, `src/tools/prerequisite.ts`, `src/edition.ts`), the vendored conditions (`src/tools/conditions.ts`) or the browser tools (`src/tools/navigate.ts`). F4 adds one fetch layer, `src/tools/subclass-spells.ts`. It gets each subclass's always-prepared spells from D&D Beyond and merges them into the copy of the character JSON that is parsed. The raw and download tools stay verbatim. The slot helpers move from `spell-attacks.ts` to a new `src/tools/character/slots.ts`, so the concentration code can use them without an import cycle. Each task is TDD against hand-built fixtures in the live data shapes recorded below.

**Tech Stack:** TypeScript (ESM, Node ≥22), vitest, zod (tool schemas in `src/server.ts`).

**Spec:** `docs/superpowers/specs/2026-11-13-regression-report.md` (the run's report, moved there in Setup), plus the owner rulings below. Read `CLAUDE.md`, `docs/claude/tool-notes.md`, `docs/claude/caching.md` (Task 3) and `docs/character-refactor.md` (regression layers) before starting.

## Owner rulings 2026-11-13 (to be recorded in `docs/claude/history.md` by the Setup commit; not there yet)

- **R1 (F4):** fetch and merge each subclass's always-prepared spells from `game-data/always-prepared-spells`. This closes carry-over (bb). Measured on the 56 test characters: 8 characters gain 47 spells (Cathartic 10, Calderax 10, Sister Baronessa 10, Vi 6, Zayda 5, Shadowheart 2, Dwarf Cleric 2, Elona 2). None duplicates a spell already on the sheet, and every 2024 subclass returns an empty list.
- **R2 (F14):** a feature row with no dice takes the first dice expression in its own snippet, but only when that expression resolves without an ability modifier. Measured: Second Wind ×3 (2014), Bardic Inspiration ×1 (2014) and Quickened Healing ×2. Carry-over (be)(2) stands: an expression with `{{modifier:…}}` (Stone's Endurance, Deft Explorer: Tireless, Eldritch Cannon: Protector) prints no dice.
- **R3 (F10):** any shown feature action whose own snippet has exactly one distinct `{{savedc:x}}` prints `DC N`. Measured: about 18 rows on 10 characters (Turn Undead, the Channel Divinity variants, Ki Points, Stunning Strike, Open Hand Technique, Telekinetic Shove, Eldritch Cannon, Arms of the Astral Self: Summon, the 2024 Unarmed Strike).
- **R4 (F2), confirmed by the owner 2026-11-17:** `isSubclassFeature` narrows its membership clause. A feature whose definition carries a non-zero `classId` belongs to that class, and subclass-list membership decides only when `classId` is absent. The 2026-11-12 F9 ruling's `classId` rule and the 2026-11-13 M-8 "one rule for label and wrapping" stay. Impact: lookup labels change on 23 of the 56 characters, because every D&D Beyond subclass list also lists the base class features. Homebrew wrapping changes only for a base-class feature under a homebrew subclass of an official class: that feature's text is official, so it is no longer wrapped (0 such characters in the corpus).

## Investigation results the plan relies on (verified 2026-11-13 against live data)

- **F7:** every monster-service entry (list and detail) carries `damageAdjustments: number[]`, `conditionImmunities: number[]` and `conditionImmunitiesHtml: string`. Neither `DdbMonster` nor `GameConfig` declares them, so nothing prints them. The ids resolve through the game config: `damageAdjustments[]` is `{id, name, type, slug, isMulti, displayOrder}`, with `type` 1 = resistance, 2 = immunity and 3 = vulnerability. `conditions[]` is `{definition: {id, name, …}}`. Examples:
  - 2014 Wraith 17064: resistances `[4,5,7,9,11,14]` = Lightning, Thunder, Cold, Fire, Acid, plus the multi entry "Bludgeoning, Piercing, and Slashing from Nonmagical Attacks that aren't Silvered"; immunities Poison, Necrotic; conditions `[2,4,6,9,10,11,12,13]`.
  - Adult Red Dragon 16771 (2014) and 5194875 (2024): `[25]` = immunity Fire.
  - 2024 Zombie 4775851: immunity Poison; conditions Exhaustion, Poisoned.
  - The Open5e path (`src/open5e.ts:831`) already prints these lines. F7 is the D&D Beyond path only.
- **F9:** `computeWeaponAttacks` sets `usesDex = isRanged || ((isFinesse || isMonkWeapon) && dex > str)`. A ranged Finesse weapon (Dart: `attackType 2`, Finesse) is forced to DEX. Corpus: Flemin 112315775 only (STR 16, DEX 14). Xarius's dart already uses DEX, which is the higher score.
- **F11:** a magic staff is `filterType: "Staff"` with `attackType/damage/properties: null`. Its attack data is in `definition.weaponBehaviors[0]`: `{baseItemId: 12, type: "Quarterstaff", attackType: 1, categoryId: 1, damage: {diceString: "1d6"}, damageType: "Bludgeoning", properties: [Versatile (notes "1d8"), Topple], range: 5, longRange: 5, isMonkWeapon: true}`. Its `+N` is in `grantedModifiers` (`bonus`/`magic`, value 2) as usual. Corpus: equipped Staff of the Woodlands (Orion 152720684), equipped Spider Staff (Calderax 14814039), and an equipped **mundane** "Staff" (`filterType: "Other Gear"`, Clover 155665213). Every item in the corpus has at most one behaviour, and no `filterType: "Weapon"` item has any. Website check 2026-11-17: Clover's Actions list shows the mundane Staff as `Staff · Melee Weapon · 5ft. · +3 · 1d6+1 / 1d8+1 · Simple, Versatile, Topple`, so every equipped behaviour item gets a row, magic or not.
- **F4:** `GET https://character-service.dndbeyond.com/character/v5/game-data/always-prepared-spells?classId=<subclassDefinition.id>&classLevel=<class level>&sharingSetting=2` returns `{data: SpellEntry[]}`. It works anonymously for official content. Each entry has `alwaysPrepared: true`, `prepared: false`, `usesSpellSlot: true`, `definition {id, name, level, …}`. The base class id returns `[]`. The list is already filtered by `classLevel` (Life Domain 1 → Bless, Cure Wounds; Life Domain 9 → 10 spells). Zayda's Arcana Domain (id 74) returns both 2014 entries "Arcanist's Magic Aura" (id 2005, Basic Rules) and "Nystul's Magic Aura" (id 2331, PHB 2014). Both are kept, as D&D Beyond returns them. Website check 2026-11-17: Zayda's Spells tab lists both under 2nd level.
- **F12:** no test character reproduces it. The contributor's unfinished character printed `STR 0 (-5) … CHA 2 (-4)`, which fits null base scores plus a +2 racial bonus.
- **F3:** item spells and feature spells carry `usesSpellSlot: false`:
  - Orion's Wall of Thorns and Barkskin (`spells.item`);
  - Laena's Conjure Elemental (`spells.item`);
  - Xarius's Beast Sense (`spells.class`).
  Weslocke's Hex is a class spell (`usesSpellSlot: true`) on a Warlock list, and `castLevel()` already returns its pact slot (5).
- **F14:** the 2014 actions have `dice: null`. Second Wind's snippet is `Once per short rest, you can use a bonus action to regain 1d10 + {{classlevel}} HP.` Bardic Inspiration's is `…gains an inspiration die ({{scalevalue}})…`, and its class feature (the action's `componentId`) has `levelScale.dice.diceString: "1d6"`. `makeResolveTemplates` doesn't know `scalevalue`.
- **F10:** no action has `fixedSaveDc`. The DC exists only as `{{savedc:wis}}` in the action's own snippet (2014 Ki Points, Stunning Strike, Open Hand Technique and the rest under R3). Website check 2026-11-17: Zayda 49128422's Channel Divinity: Arcane Abjuration and Turn Undead both read "(DC 12)" (8 + 2 + WIS 2), which R3 reproduces.
- **F15:** every defense modifier carries `friendlySubtypeName` ("Magical Sleep"). `defenseList` prints `capitalize(subType)`, which gives "Magical-sleep".
- **F2:** every subclassed character's `subclassDefinition.classFeatures` lists the base class features as plain `{id, name}` entries with **no** `classId`. That is 548 entries on 24 class entries; Ezra's Arcane Trickster list includes Sneak Attack id 343. Meanwhile `classes[].classFeatures[]` Sneak Attack has `classId: 12` (Rogue). The membership clause of `isSubclassFeature` makes it a subclass feature.
- **F1:** Goliath 152579009's action "Stone's Endurance (Stone Giant)" is `{componentId: 3727539, componentTypeId: 306912077}`, a race option. That option's own `componentId 13856126 / componentTypeId 1960452172` is the racial trait Giant Ancestry. Niko 133057712's "Battle Medic" points straight at the feat Healer (`1789152 / 1088085227`). `grantingEntityNames` (actions.ts) maps these keys, but options map to their own name, not their owner's.
- **F6:** `game-data/feats` never sends `prerequisite`. It sends `prerequisites: [{description, hidePrerequisite, prerequisiteMappings: [{type, subType, value, friendlySubTypeName, …}]}]`, an OR list of groups:
  - 2014 Grappler: one group, "Strength 13 or higher" (`ability-score`/`strength`/13).
  - 2024 Grappler: two groups, "Level 4+, Strength" and "or Dexterity 13+". Their concatenation is the book text.
  - ASI: "Level 4+".
  - The fighting-style feats: 15 `class-feature` groups ("Fighter Fighting Style 1", …, subType `…-fighting-style`).
  - The spellcasting feats: `class-feature` groups with subType `…-spellcasting` / `…-pact-magic`.
  - Character-sheet feat definitions have the same `prerequisites` array.
  `tests/options-editions.test.ts` built its feats with the non-existent `prerequisite` string, so its prerequisite tests passed on a shape D&D Beyond never sends.
- **F13:** logged out, `refFetch` → `beginAuthenticatedSession()` throws (`NoSessionError`, or `SessionNotSignedInError` for anonymous cookies), and every catalog catch maps any load failure to origin `"unavailable"` (`reference.ts` spells 514/583, equipment 808, `searchCatalogListCore`).
- **F5:** the 2014 table is a paraphrase. D&D Beyond's rule-data (`character/v5/rule-data`, public) has the SRD text of all 15 conditions after `<hr>Legacy Definition`. For example, Exhaustion adds the cumulative-levels paragraph and the long-rest and raise-dead recovery. Grappled adds "or grappling effect, such as when a creature is hurled away by the thunderwave spell".
- **F8:** `navigate()` calls `page.goto(url, {waitUntil: "networkidle", timeout: 30000})`. A character sheet keeps the network busy, so the call times out after the page has loaded. `server.ts` prints `err.message` raw, which includes Playwright's `Call log:` and `Browser logs:` blocks. That second block was seen in this investigation when the browser failed to launch.

## Global Constraints

- Run `npm run typecheck && npm run lint && npm test` before every commit, and get all three green.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to `main` (owner's standing rule) but **do not push** unless the owner asks.
- Earlier owner rulings stand (CLAUDE.md "Owner rulings are recorded with dates"):
  - weapon mastery is hidden without the Weapon Mastery feature (B6);
  - Dueling R5 (2026-11-11);
  - bonus-action and reaction spell lines carry no numbers ((bj), 2026-11-09). Task 4 changes only their slot wording;
  - (be)(1) Martial Arts actions print no dice;
  - (be)(2) under R2 above;
  - character tools do no twin selection.
- **Untrusted text:** every new output line that can carry user-authored text is wrapped whole with `wrapIfHomebrew` / `wrapUntrusted`. That covers merged homebrew subclass spells, a homebrew staff's row, an action name shown in a lookup, and defense names. Official `isHomebrew: false` content stays plain, and the tests assert both.
- No tool builds edition label text itself. Every `Rules:` line and Open5e suffix comes from `src/edition.ts`.
- Snapshot updates (`tests/__snapshots__`) are deliberate. Run `npx vitest run tests/character-snapshot.test.ts -u` only in the task that changes that output, and read the diff before committing.
- **Regression skill sync** (CLAUDE.md), **in the same commit** as the change:
  - `intended-behaviour.md`: a new or changed rule a tester judges replies against (R1–R4, the F12 not-ready reply, the F13 logged-out wording). Tasks 3, 5, 6, 8 and 10.
  - `known-open-issues.md`: a carry-over opened, closed or narrowed. Task 3 closes (bb), and Task 5 narrows (be)'s text.
  - `coverage-matrix.md`: a scenario's expected reply changes. Task 8 (`ddb_character_lookup` not-found), Task 10 (`logged-out` on the catalog tools) and Task 11 (`ddb_get_condition` edition).
  - A plain bug fix that restores the intended reply (F7, F9, F11, F3, F15, F6, F8) needs no reference change. Its reviewer confirms that no reference line contradicts the new output.
  - Closing (bb) also removes `"bb"` from `expected` in `tests/regression-skill.test.ts`, and strikes it in `history.md` as `**(bb)** ~~…~~`.
- **Character-sheet changes:** Setup captures the live baseline. Task 13 diffs against it and runs the whole-corpus script. Every difference must be one this plan intends.
- Corpus numbers in this plan come from the 56 cached test characters (`<os tmpdir>/ddb-mcp-regress/characters`, fetched 2026-11-12).

## Review Focus

1. **F4 failure and session paths:** if an always-prepared request fails, times out or returns non-JSON, the character still parses with a notice. Subclasses whose requests succeeded are merged, the failed one is not, and the failure is not cached as an empty list. A session change during the fetch rejects with `SessionChangedError`; it never mixes accounts. `ddb_get_character_raw` and `ddb_download_character` stay byte-identical to D&D Beyond's JSON. A merged homebrew spell is wrapped. (Task 3 tests.)
2. **R4 wrapping:** under a homebrew subclass of an official class, the subclass's own feature (`classId` = subclass id) stays wrapped on the sheet and in lookup. Only the base-class feature becomes plain. A homebrew **class** still wraps all its features. (Task 8 tests.)
3. **F11 duplicates and gates:** an unequipped staff gets no row. A behaviour item is never listed twice, and a `filterType: "Weapon"` item ignores `weaponBehaviors`. A staff's `+N` counts like a weapon's. A homebrew staff row is wrapped. (Task 2 tests.)
4. **F12 false positives:** a finished character must never be called unfinished. That includes one whose base score is null but has an override (`overrideStats`), and one with a low but real score. (Task 6 tests.)
5. **R2/R3 over-matching:** a snippet with two different `{{savedc:…}}` abilities prints no DC. A snippet with a plain die and no template ("1d6 + 4", "2d8") prints no dice. `{{scalevalue}}` that resolves to a number, not a die ("{{scalevalue}} times"), prints no dice. An action that already has `dice` keeps its own. (Task 5 tests.)

## Plan review 2026-11-17

The plan had two adversarial reviews: Codex (gpt-6-luna, with read access to the repo) and the router's `auto:reviewers`. Zen's free quota was used up, and both Gemini models returned 503, so the router review ran on the paid Mistral DeepSeek. Every claim was checked against the code. These were accepted and folded in:

- F4: which spell-list field the merge writes, the sheet entry winning on duplicates, and partial success with a notice;
- F13: the spell compendium swallowed the session error, so the first per-request error is now kept as `cause`;
- F7: the exact `ruleset` expression;
- F15: a friendly name is printed only when it matches its slug;
- F6: prerequisites are matched per OR group;
- F8: the `safeErrorLine` change was redundant, and the fix is in `server.ts`, tested per catch block;
- F10: an unresolvable DC prints nothing;
- F3: precedence when a spell has two sources;
- the regression-skill sync named per task.

Rejected after checking:

- a staff losing Topple: `mastery` is null and Topple comes through `properties`;
- the feature map keyed by a wrapper id: wrapped features carry no outer id;
- the homebrew stat block being unwrapped: `getMonster` wraps the whole block, `monster.ts:474`/`479`;
- `subclassId` 0: no subclass correctly means a class feature;
- `walkBaseEntities` not being exported: `actionParents` lives in the same file.

---

## Setup (one commit, before Task 1)

- [ ] Move the report: `mv "$HOME/Documents/D&D/D&D Characters/Claude outputs/ddb-mcp-regression-2026-11-13.md" docs/superpowers/specs/2026-11-13-regression-report.md`.
- [ ] Record R1–R3 (dated 2026-11-13) and R4 (confirmed 2026-11-17) and the investigation results above under a new "Regression remediation 2026-11-13" heading in `docs/claude/history.md`. Add R1–R3 to `skills/ddb-mcp-regression/references/intended-behaviour.md`.
- [ ] Commit it with this plan: `git add docs/superpowers/specs/2026-11-13-regression-report.md docs/superpowers/plans/2026-11-13-regression-remediation.md docs/claude/history.md skills/ddb-mcp-regression/references/intended-behaviour.md && git commit -m "docs: 2026-11-13 regression report, owner rulings and remediation plan"`.
- [ ] Capture the live baseline: `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/before.txt"`. If no session is saved, ask the owner to run `ddb_login`.
- [ ] Build a baseline `dist/` for Task 13's whole-corpus diff: `git worktree add "$TMPDIR/ddb-base" HEAD && (cd "$TMPDIR/ddb-base" && npm ci && npm run build)`.

---

### Task 1: Monster damage adjustments and condition immunities (F7)

**Files:**
- Modify: `src/game-config.ts` (`GameConfig`), `src/tools/monster-service.ts` (`DdbMonster`), `src/tools/monster.ts` (`formatStatBlock`)
- Test: `tests/monster.test.ts` (new `describe("damage adjustments and condition immunities (F7)")`; extend `CONFIG.data`)

**Interfaces:**
- Produces:
  - `GameConfig.damageAdjustments?: Array<{ id: number; name: string; type: number; isMulti?: boolean }>`
  - `GameConfig.conditions?: Array<{ definition: { id: number; name: string } }>`
  - `DdbMonster.damageAdjustments?: number[]`, `DdbMonster.conditionImmunities?: number[]`, `DdbMonster.conditionImmunitiesHtml?: string | null`
  - `export function defenseLines(m: DdbMonster, config: GameConfig | null, ruleset: "2014" | "2024"): string[]` in `monster.ts`

- [ ] **Step 1: Write the failing tests.** Add to `CONFIG.data`: `damageAdjustments` entries 1 Bludgeoning/1, 2 Piercing/1, 3 Slashing/1, 4 Lightning/1, 5 Thunder/1, 7 Cold/1, 9 Fire/1, 11 Acid/1, 14 "Bludgeoning, Piercing, and Slashing from Nonmagical Attacks that aren't Silvered"/1/isMulti, 22 Poison/2, 25 Fire/2, 26 Necrotic/2, 33 Bludgeoning/3. Add `conditions` ids 2 Charmed, 4 Exhaustion, 6 Grappled, 9 Paralyzed, 10 Petrified, 11 Poisoned, 12 Prone, 13 Restrained. Give the existing `ZOMBIE_2014` `damageAdjustments: [22], conditionImmunities: [11]`, and the 2024 Zombie `[22]` and `[4, 11]`.

```ts
it("prints 2014 wording between Skills and Senses, singles before multi entries")
  // A 2014 (sourceId 1) monster with damageAdjustments [4,5,7,9,11,14,22,26], conditionImmunities [2,4,6,9,10,11,12,13]:
  // lines in this order, directly before "**Senses**":
  // "**Damage Resistances** Acid, Cold, Fire, Lightning, Thunder; Bludgeoning, Piercing, and Slashing from Nonmagical Attacks that aren't Silvered"
  // "**Damage Immunities** Necrotic, Poison"
  // "**Condition Immunities** Charmed, Exhaustion, Grappled, Paralyzed, Petrified, Poisoned, Prone, Restrained"
it("prints 2024 wording, with condition immunities after the damage immunities")
  // 2024 Zombie: "**Immunities** Poison; Exhaustion, Poisoned"; no "Damage Immunities", no "Condition Immunities" line.
it("prints vulnerabilities first, as Damage Vulnerabilities (2014) / Vulnerabilities (2024)")
  // damageAdjustments [33] → "**Damage Vulnerabilities** Bludgeoning" (2014), "**Vulnerabilities** Bludgeoning" (2024)
it("prints no defense lines when the lists are empty or absent")
it("labels an id missing from the config instead of dropping it")
  // damageAdjustments [999] (2014): its type is unknown, so it gets its own line "**Damage Adjustments** damage adjustment 999" after the typed lines
it("falls back to conditionImmunitiesHtml when the config has no conditions")
  // config without `conditions`, conditionImmunitiesHtml "Charmed, Poisoned" → "**Condition Immunities** Charmed, Poisoned"
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/monster.test.ts -t "F7"`. Expected: FAIL, no defense lines.
- [ ] **Step 3: Implement `defenseLines` and call it in `formatStatBlock` after the Skills line.**
  - Order: vulnerabilities (type 3), resistances (1), immunities (2), then condition immunities.
  - Within a type: names with `isMulti !== true` sorted by name and joined with `", "`, then multi names sorted by name. The multi part is joined to the singles (and to each other) with `"; "`.
  - Unknown id: `damage adjustment <id>`, listed on its own line, `**Damage Adjustments** …`.
  - Condition names come from `config.conditions` by id, sorted by name; a missing id prints `condition <id>`. With no `config.conditions` at all, use `stripHtmlRich(conditionImmunitiesHtml)`.
  - 2014 labels: `Damage Vulnerabilities`, `Damage Resistances`, `Damage Immunities`, `Condition Immunities`. 2024 labels: `Vulnerabilities`, `Resistances`, and `Immunities <damage>; <conditions>` (either part alone when the other is empty).
  - `ruleset` is `(extras.info ?? classifyEdition(m, index)).ruleset === "2024" ? "2024" : "2014"`.
  - An id absent from `config.damageAdjustments` always goes on the `**Damage Adjustments**` line, whatever list it came from.
  - The homebrew stat block is already wrapped whole by `getMonster`, so no extra wrapping is needed.
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npx vitest run tests/monster.test.ts`. Expected: PASS.
- [ ] **Step 5: Update `docs/claude/tool-notes.md` (`ddb_get_monster`) and commit.**

```bash
git add src/game-config.ts src/tools/monster-service.ts src/tools/monster.ts tests/monster.test.ts docs/claude/tool-notes.md
git commit -m "fix(monsters): print damage vulnerabilities, resistances, immunities and condition immunities (F7)"
```

---

### Task 2: Weapon rows — ranged Finesse and weapon-behaviour items (F9, F11)

**Files:**
- Modify: `src/tools/character/weapons.ts` (`computeWeaponAttacks`)
- Test: `tests/combat-weapon-bonuses.test.ts` (reuse `combat`, `block`, `BASE`, `ITEM` from `tests/fixtures/combat-helpers.ts`)

**Interfaces:**
- Produces: `export function weaponDefinition(def: Record<string, unknown>): Record<string, unknown> | null` in `weapons.ts`. It returns `def` when `filterType === "Weapon"`. Otherwise, when `weaponBehaviors[0]` is a record, it returns `{ ...def, ...behaviour, name: def.name, grantedModifiers: def.grantedModifiers, isHomebrew: def.isHomebrew, sourceId: def.sourceId, sources: def.sources }`. Otherwise it returns `null`.
  - `equipped`, `quantity` and `id` are always read from the inventory entry `i`, never from the merged definition.
  - Mastery: every staff in the corpus has `mastery: null`, and Topple comes through the behaviour's `properties`. The existing B6 gate therefore applies unchanged. The report's website string for F11 includes "Topple", but that part is deliberately not reproduced without the Weapon Mastery feature. The report itself lists this under "By design".

- [ ] **Step 1: Write the failing tests.** Read every expected number off `core.statMods` / `core.profBonus`, as the file's existing tests do.

```ts
it("a ranged Finesse weapon uses STR when STR is higher (F9)")
  // STR 16, DEX 14; equipped Dart {filterType:"Weapon", attackType:2, categoryId:1, damage 1d4, Finesse+Thrown, range 20/60}
  // with simple-weapons proficiency → "Dart" row: to hit strMod+prof, damage "1d4+{strMod}". Archery (+2 ranged) still applies to it.
it("a ranged Finesse weapon uses DEX when DEX is higher")
it("a non-Finesse ranged weapon still uses DEX")   // Light Crossbow, STR 16 DEX 14 → dexMod
it("an equipped magic staff attacks as its weapon behaviour (F11)")
  // Staff of the Woodlands: filterType "Staff", attackType null, weaponBehaviors [Quarterstaff 1d6, Versatile "1d8", Topple],
  // grantedModifiers [{type:"bonus", subType:"magic", value:2}], equipped:
  // row "• Staff of the Woodlands   {signed(strMod+prof+2)} to hit   1d6{signed(strMod+2)} bludgeoning (1d8{signed(strMod+2)} two-handed)   reach 5 ft.   Versatile"
  // (Topple hidden: no Weapon Mastery feature, B6)
it("an equipped mundane Staff (Other Gear) attacks as a quarterstaff")   // no magic bonus
it("an unequipped staff has no row")
it("a filterType Weapon item ignores weaponBehaviors")   // a Longsword carrying a stray behaviour prints once, as a longsword
it("a homebrew staff's row is wrapped, an official one is plain")
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/combat-weapon-bonuses.test.ts`. Expected: the Dart (STR) and staff tests FAIL.
- [ ] **Step 3: Implement both fixes.**
  - Replace the filter `str(def.filterType) !== "Weapon"` with `const wdef = weaponDefinition(obj(i.definition)); if (!wdef) continue;`, and read every weapon field from `wdef`.
  - The label stays the item's own name. `weaponWordOrder` is applied only when the name equals `wdef.type`, so "Staff of the Woodlands" is unchanged.
  - Ability rule: `const usesDex = (isFinesse || isMonkWeapon) ? dexMod > statMods[0] : isRanged;`
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npx vitest run tests/combat-weapon-bonuses.test.ts tests/combat-*.test.ts`. Expected: PASS.
- [ ] **Step 5: Update the snapshot only if this task changed it** (`npx vitest run tests/character-snapshot.test.ts -u`; read the diff). Update `docs/claude/tool-notes.md` (combat section: weapon rows) and commit.

```bash
git add src/tools/character/weapons.ts tests/combat-weapon-bonuses.test.ts tests/__snapshots__ docs/claude/tool-notes.md
git commit -m "fix(character): Finesse picks the better of STR and DEX even when ranged; staffs attack through their weapon behaviour (F9, F11)"
```

---

### Task 3: Subclass always-prepared spells (F4, R1, closes (bb))

**Files:**
- Create: `src/tools/subclass-spells.ts` (fetch and cache), `src/tools/character/always-prepared.ts` (pure merge)
- Modify: `src/tools/character.ts` (`parseCharacter`, new `loadCharacterForParse`), `src/tools/character/definition.ts` (`getDefinition`), `src/tools/party.ts`, `src/tools/character/spells.ts` (`isShownClassSpell`), `scripts/regress-all-characters.mts` (HEAD side only)
- Test: `tests/subclass-spells.test.ts` (new), `tests/spell-concentration.test.ts`
- Docs: `docs/claude/caching.md`, `docs/claude/tool-notes.md`, `docs/claude/history.md` (strike (bb)), `skills/ddb-mcp-regression/references/known-open-issues.md` (remove (bb)), `tests/regression-skill.test.ts` (drop `"bb"`)

**Interfaces:**
- Produces, in `always-prepared.ts` (pure):
  - `export type SubclassSpellLists = Map<number, Record<string, unknown>[]>`, keyed by the `classes[]` entry's `id` (the character class id that `classSpells[].characterClassId` uses).
  - `export function subclassRequests(char: CharData): Array<{ characterClassId: number; subclassId: number; level: number }>`: one per class entry with a `subclassDefinition.id`.
  - `export function mergeAlwaysPreparedSpells(raw: Record<string, unknown>, lists: SubclassSpellLists): Record<string, unknown>` returns a **new** object; the input is not mutated. It handles both `raw.data` and bare shapes.
    - Target entry: the `classSpells` entry whose class matches the key the way `classSpellLists` matches (`characterClassId`, else `id`, else `classId`). When none matches, it creates `{characterClassId, spells: []}`.
    - It appends to the field `classSpellLists` will read for that entry: `spells` when it is non-empty, or when `classSpells` is empty or absent; otherwise the 2024 `classSpells` field.
    - It skips any listed spell whose `definition.id` is already in any class list (both fields) or any `spells` bucket. The sheet's existing entry always wins, with its own `prepared`, `usesSpellSlot` and casting data.
    - An appended spell carries `alwaysPrepared: true`.
- Produces, in `subclass-spells.ts`: `export async function fetchSubclassSpellLists(char: CharData): Promise<{ lists: SubclassSpellLists; failed: boolean }>`.
  - It fetches each request with `character/v5/game-data/always-prepared-spells?classId=<subclassId>&classLevel=<level>&sharingSetting=2`.
  - Logged in, through `beginAuthenticatedSession().fetch`. Otherwise, through `anonymousFetch`. The choice uses one `captureSession()` snapshot, as `fetchCharacter` does.
  - The cache is a `TtlCache` keyed `gen<generation>:<subclassId>:<level>` (24 h), with a `*Pending` in-flight map. It is written only while it is still the authoritative entry, and cleared by an `onSessionInvalidated` hook.
  - A failed, non-OK or malformed reply is never cached, and sets `failed: true`. That subclass is left out of `lists`; the others that succeeded stay in. A `SessionChangedError` is rethrown.
- Produces, in `character.ts`: `export async function loadCharacterForParse(characterId: string): Promise<{ raw: Record<string, unknown>; notice?: string }>`. It is `fetchCharacter`, then `fetchSubclassSpellLists`, then `mergeAlwaysPreparedSpells`. When `failed`, the notice adds `SUBCLASS_SPELLS_UNAVAILABLE_NOTICE = "Subclass always-prepared spells couldn't be loaded from D&D Beyond, so the spell lists may be incomplete."`, joined after any existing notice with a space.
- `parseCharacter`, `getDefinition` and `party.ts` call `loadCharacterForParse`, and each still starts its `getSourceIndex` promise alongside the fetch, as today. `getDefinition` returns `withNotice(formatCharacterLookup(char, query, index), notice)` with the merged notice. `getCharacterRaw` and `downloadCharacter` keep `fetchCharacter`.

- [ ] **Step 1: Write the failing tests** in `tests/subclass-spells.test.ts`. Mock `fetch` the way `tests/session-cache.test.ts` does; fixtures are the live entry shape above.

```ts
it("subclassRequests lists one request per subclassed class at its level")
  // classes [{id:151440037, level:9, definition:{id:2}, subclassDefinition:{id:19}}, {id:2, level:3, definition:{id:8}}] → [{characterClassId:151440037, subclassId:19, level:9}]
it("mergeAlwaysPreparedSpells appends into the matching classSpells entry, marked alwaysPrepared")
it("mergeAlwaysPreparedSpells skips a spell already on the sheet by definition id, in any list or bucket, keeping the sheet entry's own fields")
  // same id already in another class's list (prepared:false) and in spells.item (usesSpellSlot:false): not appended; both existing entries unchanged
it("mergeAlwaysPreparedSpells appends to the 2024 classSpells field when that is the list the parser reads")
  // entry {characterClassId, spells: [], classSpells: [Guidance]}: Bless lands in classSpells; the SPELLS section shows Guidance and Bless
it("mergeAlwaysPreparedSpells creates the classSpells entry when the class has none, and never mutates its input")
it("one failed subclass request leaves the other subclass merged and adds the notice")
it("parseCharacter lists Life Domain spells for a Life 9 cleric in spells, concentration and combat")
  // Bless (L1) under Spells and under CONCENTRATION Level 1; Spiritual Weapon in BONUS ACTIONS as "• Spiritual Weapon (spell, 2nd-level slot)"
it("a failed always-prepared request still parses, adds the notice, and is retried next call")
it("a homebrew merged spell is wrapped; an official one is plain")
it("ddb_get_character_raw returns D&D Beyond's JSON unchanged")
it("a session change during the fetch rejects with SessionChangedError and caches nothing")
it("isShownClassSpell shows an alwaysPrepared spellbook spell")   // Wizard list, prepared:false, alwaysPrepared:true
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/subclass-spells.test.ts`. Expected: FAIL (the modules don't exist).
- [ ] **Step 3: Implement the two modules and wire the callers.** Add `|| s.alwaysPrepared === true` to `isShownClassSpell`. In `scripts/regress-all-characters.mts`, apply `mergeAlwaysPreparedSpells` with the anonymous lists to the **HEAD** parse input only, so R1 shows as an intended difference; the baseline parses D&D Beyond's JSON as published.
- [ ] **Step 4: Run all tests.** Run: `npm test`. Expected: PASS. The `regression-skill` test passes only after (bb) is removed from both `known-open-issues.md` and `expected`.
- [ ] **Step 5: Docs, snapshot and commit.** Update `caching.md` (new cache, key, TTL, hook), `tool-notes.md` (spells come partly from `always-prepared-spells`; the notice), strike (bb) in `history.md` (`**(bb)** ~~…~~ **Closed 2026-11-13 (R1)**`), and remove (bb) from `known-open-issues.md` and the test's `expected`.

```bash
git add src/tools/subclass-spells.ts src/tools/character/always-prepared.ts src/tools/character.ts src/tools/character/definition.ts src/tools/party.ts src/tools/character/spells.ts scripts/regress-all-characters.mts tests/subclass-spells.test.ts tests/regression-skill.test.ts tests/__snapshots__ docs/claude skills/ddb-mcp-regression/references
git commit -m "feat(character): merge subclass always-prepared spells from D&D Beyond (F4, closes (bb))"
```

---

### Task 4: How a spell is cast — slot labels (F3)

**Files:**
- Create: `src/tools/character/slots.ts`
- Modify: `src/tools/character/spell-attacks.ts` (move `levelRow`, `isWarlock`, `pactSlotLevel`, `lowestSharedSlot`, `castLevel` to `slots.ts` and re-export them so `tests/combat-spell-rows.test.ts` imports are unchanged), `src/tools/character/spells.ts` (move `slotOrdinal` to `slots.ts` and re-export it; concentration label), `src/tools/character/actions.ts` (`formatSpellAction`)
- Test: `tests/spell-concentration.test.ts`, `tests/combat-spell-rows.test.ts`

**Interfaces:**
- Produces: `export function spellCastLabel(entry: Record<string, unknown>, opts: { isWarlockList: boolean; bucket?: string }, classes: readonly ClassEntry[]): string` in `slots.ts`:
  - level 0 → `"cantrip"`;
  - `entry.usesSpellSlot === false` → `"from item"` when `bucket === "item"`, else `"no slot"`;
  - otherwise → `` `${slotOrdinal(castLevel(entry, level, opts.isWarlockList, classes))}-level slot` ``.
- A spell held by two sources takes the label of the entry already chosen by today's dedupe: `actionSpells` order for the combat block (class lists first), and the first entry by text for concentration. The tests pin this with a spell present in both a class list and `spells.item`.
- Concentration lines become `    • <name> [<label>]`, with no label for cantrips. Bonus-action and reaction spell lines become `• <name> (spell, <label>)`. `formatSpellAction` takes the `ActionSpell` (`{spell, list, bucket}`) so it knows the list and bucket.

- [ ] **Step 1: Write the failing tests.**

```ts
it("an item spell with usesSpellSlot false reads [from item]")      // Wall of Thorns (L6) in spells.item → "• Wall of Thorns [from item]"
it("a feature spell with usesSpellSlot false reads [no slot]")      // Beast Sense in spells.class
it("a Warlock class spell reads the pact slot")                     // Warlock 9 (pact slots L5), Hex → "[5th-level slot]"; BONUS ACTIONS "• Hex (spell, 5th-level slot)"
it("a non-Warlock class spell keeps its own level")                 // Cleric Bless → "[1st-level slot]"
it("castAtLevel wins")                                              // racial Hellish Rebuke castAtLevel 2 → "(spell, 2nd-level slot)"
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/spell-concentration.test.ts tests/combat-spell-rows.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Create `slots.ts`, move the helpers, and use `spellCastLabel`** in `buildConcentrationByLevel` / `formatConcentrationBlock` (store the label on each `ListEntry`) and in `formatSpellAction`. Concentration grouping by spell level is unchanged.
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npm test`. Expected: PASS, and the snapshot changes only in slot labels (update it with `-u` and read the diff).
- [ ] **Step 5: Update `tool-notes.md` (concentration and spell rows) and commit.**

```bash
git add src/tools/character/slots.ts src/tools/character/spell-attacks.ts src/tools/character/spells.ts src/tools/character/actions.ts tests/spell-concentration.test.ts tests/combat-spell-rows.test.ts tests/__snapshots__ docs/claude/tool-notes.md
git commit -m "fix(character): label spells by how they are cast — pact slot, item, no slot (F3)"
```

---

### Task 5: Feature rows — snippet dice and save DC (F14 under R2, F10 under R3)

**Files:**
- Modify: `src/tools/character/actions.ts` (`actionLine`, `computeActions`)
- Test: `tests/combat-features.test.ts`

**Interfaces:**
- Produces, in `actions.ts`:
  - `export interface FeatureLineContext { resolveTemplates: CoreStats["resolveTemplates"]; totalLevel: number; features: Map<number, { levelScale: Record<string, unknown>; classLevel: number }> }`. `features` is keyed by class-feature definition id, built from `classes[].classFeatures` (wrapped entries carry `levelScale`).
  - `export function featureLineContext(core: CoreStats): FeatureLineContext`
  - `export function snippetDice(action: Record<string, unknown>, ctx: FeatureLineContext): string`. It returns `""` unless every condition below holds:
    - `str(obj(action.dice).diceString)` is empty;
    - `action.isMartialArts !== true`;
    - `action.abilityModifierStatId == null`.
    Then, in the action's own `snippet` (HTML stripped), it finds the first match of `(\d+d\d+|\{\{\s*scalevalue\s*\}\})((?:\s*[+-]?\s*\{\{[^}]+\}\})*)`. The match is used only when it contains a template: either the head is `{{scalevalue}}`, or the captured tail is non-empty. No tail template body may match `/modifier:|savedc:|spellattack:|abilityscore:/` (R2).
    - A `scalevalue` head becomes `levelScale.dice.diceString` of the action's class feature (`componentTypeId === CLASS_FEATURE_TYPE`). With no die there, it returns `""`.
    - The tail is resolved with `ctx.resolveTemplates(tail, classLevel)` (`classLevel` = the feature's class level, else `ctx.totalLevel`). Any `?` returns `""`. Every `[+-]?\d+` in the resolved tail, after removing whitespace, is summed: " + 5" → 5, "+3" → 3, "+2-1" → 1.
    - Output: `"<die>"` when the sum is 0, else `"<die> + <n>"` / `"<die> - <n>"`.
  - `export function snippetSaveDc(action: Record<string, unknown>, ctx: FeatureLineContext): number | null`. When the action's own snippet has exactly one distinct `{{savedc:<abbr>…}}` body, it returns that template's resolved value (the same `classLevel`). It returns null otherwise, and also when the resolved value is `?` or not an integer.
  - `actionLine` becomes `(ctx: FeatureLineContext) => (a: CharAction) => string`, printing `• <name>[   <dice>][   DC <n>]`. The dice are `actionDice(action) || snippetDice(action, ctx)`. The line is wrapped as today.

- [ ] **Step 1: Write the failing tests** (helpers `action`, `feature`, `fighter`, `CLASS_FEATURE`, `BONUS`, `SPECIAL` from `combat-helpers.ts`).

```ts
it("2014 Second Wind prints its snippet's dice at the class level")       // snippet "…regain 1d10 + {{classlevel}} HP." Fighter 5 → "• Second Wind   1d10 + 5"
it("2014 Bardic Inspiration prints its levelScale die")                  // "({{scalevalue}})", feature levelScale.dice "1d6" → "• Bardic Inspiration   1d6"
it("scalevalue plus proficiency adds up")                                // "{{scalevalue}}{{proficiency#signed}}", die 1d6, prof 3 → "1d6 + 3"
it("an ability-modifier expression prints no dice (R2, (be)(2))")       // "1d12 {{modifier:con}}" → "• Stone's Endurance" (unchanged)
it("a plain die with no template prints no dice")                        // "restore 1d6 + 4 HP", "deal 2d8 extra radiant"
it("a numeric scalevalue prints no dice")                                // "use this {{scalevalue}} times", levelScale.fixedValue 2
it("an action with its own dice keeps them")                             // 2024 Second Wind dice "1d10 + 1"
it("Martial Arts actions stay dice-less ((be)(1))")
it("a single savedc template prints DC N (R3)")                          // Stunning Strike "(DC {{savedc:wis}})", WIS mod +3, prof 4 → "• Stunning Strike   DC 15"
it("two different savedc abilities print no DC")
it("an unresolvable savedc template prints no DC")             // "{{savedc:xyz}}" → no "DC ?"
it("dice and DC both print, dice first")
it("a homebrew feature row with DC is wrapped whole")
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/combat-features.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `featureLineContext`, `snippetDice` and `snippetSaveDc`,** and thread `ctx` through `computeActions`.
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npm test`. Expected: PASS. Update the snapshot with `-u` and check that only feature rows gained dice or a DC.
- [ ] **Step 5: Docs and commit.** Update `tool-notes.md` (feature rows: the R2/R3 rules), `intended-behaviour.md` (R2, R3) and the (be) entry in `known-open-issues.md` ((be) stays open: Deflect Missiles, Arms of the Astral Self, Stone's Endurance, Eldritch Cannon).

```bash
git add src/tools/character/actions.ts tests/combat-features.test.ts tests/__snapshots__ docs/claude/tool-notes.md skills/ddb-mcp-regression/references
git commit -m "feat(character): feature rows show snippet dice without ability modifiers and a single save DC (F14, F10)"
```

---

### Task 6: An unfinished character says so (F12)

**Files:**
- Modify: `src/tools/character/identity.ts`, `src/tools/character/parse.ts`
- Test: `tests/character-parser.test.ts` (new `describe("an unfinished character (F12)")`)

**Interfaces:**
- Produces, in `identity.ts`:
  - `export function notReadyParts(char: CharData): string[]`. The parts, in this order: `"a species"` when `char.race` is null or not an object; `"a class"` when `classes` is empty; `"ability scores"` when any stat id 1–6 has a base `stats[].value` that is not > 0 **and** no `overrideStats[].value` > 0.
  - `export function notReadyLine(parts: string[]): string` returns `` `⚠️ This character isn't finished on D&D Beyond (missing ${joinAnd(parts)}), so its numbers can't be worked out yet. D&D Beyond shows "Character Not Ready!" for it.` `` Here `joinAnd` is "a" / "a and b" / "a, b and c".
- In `parseCharacterData`: when `notReadyParts` is non-empty, the output is the header block, then `notReadyLine`. `features`, `inventory` and `notes` follow as today, and `full` prints features + inventory + notes. `summary`, `combat`, `spells` and `concentration` print nothing more.

- [ ] **Step 1: Write the failing tests.**

```ts
it("null base scores print the not-ready line and no numbers")            // FIGHTER_5 with every stats[].value null, CHA bonus +2: "summary" has the line and no "STR 0", "AC:", "Initiative"
it("names every missing part")                                            // race null, classes [], null scores → "(missing a species, a class and ability scores)"
it("an overridden score counts as set")                                   // stats[0].value null, overrideStats [{id:1,value:15}] → no line
it("a finished character never gets the line")                            // FIGHTER_5, ARCANE_TRICKSTER_9, CLERIC_5_SPELLS: all sections lack "isn't finished"
it("features, inventory and notes still print under the line")
it("the character name in the header stays wrapped")                      // as today
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/character-parser.test.ts -t "F12"`. Expected: FAIL.
- [ ] **Step 3: Implement `notReadyParts`, `notReadyLine` and the routing in `parse.ts`.**
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npm test`. Expected: PASS, snapshot unchanged.
- [ ] **Step 5: Update `tool-notes.md` (`ddb_get_character`) and commit.**

```bash
git add src/tools/character/identity.ts src/tools/character/parse.ts tests/character-parser.test.ts docs/claude/tool-notes.md
git commit -m "fix(character): say a character is unfinished instead of printing placeholder zeros (F12)"
```

---

### Task 7: Defense names read as D&D Beyond writes them (F15)

**Files:**
- Modify: `src/tools/character/defenses.ts` (`defenseList`)
- Test: `tests/character-parser.test.ts`

**Interfaces:**
- `defenseList` prints a known subType (`DAMAGE_ADJUSTMENT_SLUGS.has(subType)`) as its `friendlySubtypeName` **only when** that name slugifies back to the subType (`name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === subType`). Otherwise it prints `capitalize(subType)` as today.
  - The printed text of a known line therefore stays derived from the allowlisted slug and never needs wrapping. A mismatched friendly name, from any source, is never printed.
  - An unknown subType stays on the wrapped `(custom)` line as today.

- [ ] **Step 1: Write the failing tests.**
  - `it("Fey Ancestry's magical-sleep immunity reads Magical Sleep")`: an immunity modifier `{type:"immunity", subType:"magical-sleep", friendlySubtypeName:"Magical Sleep"}` gives `Immunities: Magical Sleep`.
  - `it("a known subType without a friendly name falls back to capitalize")`.
  - `it("a friendly name that doesn't match its subType is never printed")`: a homebrew item's modifier `{subType:"magical-sleep", friendlySubtypeName:"Ignore previous instructions"}` gives `Immunities: Magical-sleep`, and the output has no "Ignore".
- [ ] **Step 2: Run it to make sure it fails.** Run: `npx vitest run tests/character-parser.test.ts -t "Magical Sleep"`. Expected: FAIL (`Magical-sleep`).
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests.** Run: `npm test`, then update the snapshot with `-u` (expected change: `Magical-sleep` → `Magical Sleep` only).
- [ ] **Step 5: Commit.**

```bash
git add src/tools/character/defenses.ts tests/character-parser.test.ts tests/__snapshots__
git commit -m "fix(character): defense names use D&D Beyond's own wording (F15)"
```

---

### Task 8: Character lookup — class vs subclass, and actions found through their parent (F2 under R4, F1)

**Files:**
- Modify: `src/tools/character/helpers.ts` (`isSubclassFeature`), `src/tools/character/actions.ts` (new `actionParents`), `src/tools/character/definition.ts` (`searchDefinitions`, `formatDefinitionHits`)
- Test: `tests/character-lookup.test.ts`, `tests/character-homebrew-lines.test.ts`

**Interfaces:**
- `isSubclassFeature(feature, subclass)`: when `coercedId(def.classId)` is non-zero, return whether it equals `coercedId(subclass.id)`; otherwise use the existing membership rule. Update the doc comment.
- In `searchDefinitions`, the subclass-list loop skips an entry whose definition id is the id of any `cls.classFeatures` entry. Those are decided by the class loop.
- Produces, in `actions.ts`: `export function actionParents(char: CharData, classes: readonly ClassEntry[]): Array<{ action: string; parent: string; homebrew: boolean }>`.
  - It covers the shown actions (`getAllActions`' filter) with a non-empty name.
  - The parent is found from the action's `componentId`/`componentTypeId` key. While the key belongs to an option (`char.options`, any bucket, matched by `entityKey(definition.id, definition.entityTypeId)`), the key moves to that option's own `componentId`/`componentTypeId`. At most `options.length + 1` steps; a cycle ends unresolved.
  - The final key's name comes from the base entities (the names `walkBaseEntities` sees). An unresolved action, or one whose parent name equals its own (folded), is left out.
  - `homebrew` is the action's `CharAction.homebrew`.
- `DefinitionHit` gains `via?: { action: string; homebrew: boolean }`.
  - After the normal sections, for each `actionParents` entry whose action matches the query (`matchesDefinitionQuery`), the parent's hits are added. They come from `searchDefinitions(char, parent, …, { viaActions: false })`, filtered to `nameFold(h.name) === nameFold(parent)`, with `via` set.
  - Skipped: a parent already among the hits (same type and name).
  - In the formatter, a `via` hit prints `Found through the action "<action>", which this entry grants.` after its rules line. The block is wrapped when `untrusted || via.homebrew`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("a base class feature on a subclassed character is a Class Feature (F2)")
  // ARCANE_TRICKSTER_9-shaped: subclassDefinition {id:46, classFeatures:[{id:343,name:"Sneak Attack"}, {id:355,name:"Mage Hand Legerdemain"}]},
  // classFeatures Sneak Attack {id:343, classId:12} and Mage Hand Legerdemain {id:355, classId:46}:
  // "Sneak Attack" → "[Class Feature]\nSneak Attack (Rogue, Level 1)"; "Mage Hand Legerdemain" → "[Subclass Feature]\nMage Hand Legerdemain (Rogue / Arcane Trickster, Level 3)"
it("a feature with no classId still uses subclass-list membership")
it("under a homebrew subclass of an official class, the subclass feature is wrapped and the base feature is plain (R4)")
it("under a homebrew class, every feature is wrapped")
it("an action name finds its feat (F1)")
  // feat Healer {id:1789152, entityTypeId:1088085227}; feat action "Battle Medic" componentId 1789152 / 1088085227
  // lookup "battle medic" → "[Feat]\nHealer\nRules: …\nFound through the action \"Battle Medic\", which this entry grants."
it("an action granted through a race option finds the racial trait")
  // trait Giant Ancestry {13856126, 1960452172}; option "Stone’s Endurance (Stone Giant)" {3727539, 306912077} ← 13856126/1960452172;
  // action "Stone’s Endurance (Stone Giant)" 3727539/306912077 → lookup "stones endurance" lists [Racial Trait] Giant Ancestry with the via line
it("a hidden action is not found")       // class action of a feature above the class level
it("an option cycle ends without a hit and without hanging")
it("a homebrew action's via line is wrapped with its block")
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/character-lookup.test.ts tests/character-homebrew-lines.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `npm test`. Expected: PASS. The sheet snapshot should not change (features.ts prints no class/subclass label); if it does, stop and report.
- [ ] **Step 5: Docs and commit.** Update `tool-notes.md` (`ddb_character_lookup`), the `isSubclassFeature` rule in `history.md` (R4), and `intended-behaviour.md`.

```bash
git add src/tools/character/helpers.ts src/tools/character/actions.ts src/tools/character/definition.ts tests/character-lookup.test.ts tests/character-homebrew-lines.test.ts docs/claude skills/ddb-mcp-regression/references
git commit -m "fix(lookup): class features keep their class label; actions are found through their granting entry (F2, F1)"
```

---

### Task 9: Feat prerequisites from D&D Beyond's real shape (F6)

**Files:**
- Modify: `src/tools/prerequisite.ts`, `src/tools/reference.ts` (`DdbFeat`, `searchFeatsSection`), `src/tools/character/definition.ts` (`formatFeatResult`)
- Test: `tests/prerequisite.test.ts`, `tests/options-editions.test.ts` (replace every `prerequisite: "…"` fixture with the live `prerequisites` shape)

**Interfaces:**
- Produces, in `prerequisite.ts`:
  - `export interface DdbPrerequisite { description?: string | null; hidePrerequisite?: boolean; prerequisiteMappings?: Array<{ type?: string | null; subType?: string | null; value?: number | null; friendlySubTypeName?: string | null }> | null }`
  - `export function ddbPrerequisiteText(prereqs: readonly DdbPrerequisite[] | null | undefined): string`. It returns `""` with no groups. When every mapping of every group is `type: "class-feature"`, it returns the distinct summaries in first-seen order, joined with `" or "`:
    - a subType containing `fighting-style` → `"a Fighting Style feature"`;
    - one containing `spellcasting` or `pact-magic` → `"the Spellcasting or Pact Magic feature"`;
    - anything else → the group's description.
    Otherwise it returns the distinct trimmed descriptions in order. One starting with `"or "` is joined to the previous with `" "`, others with `"; "`.
  - `export function ddbPrerequisiteMatches(prereqs: readonly DdbPrerequisite[] | null | undefined, query: string): boolean`. It is true when `prerequisiteMatches(text, query)` holds for **any one group's** text, or for the whole `ddbPrerequisiteText`. A group's text is its description plus, per mapping: `ability-score` → `"<friendlySubTypeName ?? subType> <value>"`, `level` → `"level <value>"`, any other → `friendlySubTypeName`, all joined with `"; "`. Matching per group means a query can't combine words from two OR alternatives. The whole-text check keeps substring queries over the displayed text (such as "Strength or Dexterity") working.
- `DdbFeat.prerequisite` is replaced by `prerequisites?: DdbPrerequisite[] | null`. The filter becomes `ddbPrerequisiteMatches(f.prerequisites, q)`, and the row's `*(Requires: …)*` uses `ddbPrerequisiteText`.
- `formatFeatResult` prints `Prerequisite: <ddbPrerequisiteText(d.prerequisites) || str(d.prerequisite)>` when non-empty. The line stays inside the hit's (possibly wrapped) block.

- [ ] **Step 1: Write the failing tests.**

```ts
// prerequisite.test.ts
it("joins a continuation group with a space")       // 2024 Grappler groups → "Level 4+, Strength or Dexterity 13+"
it("summarises class-feature groups")               // Archery's 15 fighting-style groups → "a Fighting Style feature"
it("matches per group, with mapping phrases")      // 2024 Grappler matches "strength 13", "dexterity 13", "level 4", "Strength or Dexterity"; ASI matches "level 4", not "strength 13"
it("a query can't join words from two OR groups")  // groups [{"Strength 13", ability-score strength 13}, {"Level 19+", level 19}]: "strength 19" → false
// options-editions.test.ts (fixtures now in the live shape)
it("ddb_search_feats prerequisite 'Strength 13' lists D&D Beyond's Grappler [2024] and no Open5e fallback line")
it("prerequisite 'level 4' lists D&D Beyond's Ability Score Improvement")
it("the row shows Requires: from prerequisites")    // "- **Grappler** [2024] *(Requires: Level 4+, Strength or Dexterity 13+)*"
it("a prerequisite with no D&D Beyond match still falls back to Open5e")
// character-lookup.test.ts
it("a sheet feat's lookup prints its Prerequisite line")
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/prerequisite.test.ts tests/options-editions.test.ts tests/character-lookup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it, and move every feat fixture in `options-editions.test.ts` to `prerequisites`.** Keep each existing test's intent: the hidden-twin count and the abbreviation matching.
- [ ] **Step 4: Run all tests.** Run: `npm test`. Expected: PASS.
- [ ] **Step 5: Update `tool-notes.md` (`ddb_search_feats`) and commit.**

```bash
git add src/tools/prerequisite.ts src/tools/reference.ts src/tools/character/definition.ts tests/prerequisite.test.ts tests/options-editions.test.ts tests/character-lookup.test.ts docs/claude/tool-notes.md
git commit -m "fix(feats): read D&D Beyond's prerequisites array for the filter and the Requires line (F6)"
```

---

### Task 10: Logged-out catalog fallbacks say to log in (F13)

**Files:**
- Modify: `src/edition.ts` (`OPEN5E_SUFFIX`, `open5eSearchHeader`), `src/open5e.ts` (origin parameter types, `o5NoMatch`), `src/tools/reference.ts` (every `"unavailable"` fallback call)
- Test: `tests/untrusted-content.test.ts` or a new `tests/catalog-logged-out.test.ts` (reuse the `NoSessionError` setup of `tests/search-site.test.ts`)

**Interfaces:**
- In `edition.ts`:
  - `OPEN5E_SUFFIX["logged-out"] = " (Open5e fallback — not logged in; ddb_login shows D&D Beyond's version)"`.
  - `export type Open5eFallbackOrigin = "unavailable" | "not-found" | "logged-out"` replaces the inline `"unavailable" | "not-found"` unions in `edition.ts` and `open5e.ts`.
  - `o5NoMatch`'s logged-out wording: `` `${base} (not logged in — ddb_login searches D&D Beyond too)` ``, kept in `edition.ts` as `LOGGED_OUT_NO_MATCH_SUFFIX`.
- In `reference.ts`: `function fallbackOrigin(err: unknown): "unavailable" | "logged-out"`. It is `"logged-out"` when `err` or any `cause` in its chain is a `NoSessionError` or `SessionNotSignedInError`. Every catalog catch that passes `"unavailable"` passes `fallbackOrigin(err)` instead: spells search and get, equipment get, and `searchCatalogListCore`, whose `fallback` signature widens to `Open5eFallbackOrigin`.
- Where the original error is lost today, it is attached as `cause`:
  - `loadSpellCompendium`'s per-request catch counts the failure and returns `[]`, then throws a fresh "Failed to load spell compendium" `Error`. That swallows `NoSessionError`. It now records the first per-request error and throws `new Error(<same message>, { cause: firstError })`.
  - `loadGameDataList` and the item loader call `refFetch` directly, so the session error already reaches the catch unwrapped. A test still pins each one.

- [ ] **Step 1: Write the failing tests.**

```ts
it("logged out, ddb_get_spell's Open5e reply says not logged in")   // contains "Open5e fallback — not logged in; ddb_login shows D&D Beyond's version", not "D&D Beyond unavailable"
it("logged out, search_spells, search_feats, search_equipment, get_equipment, search_races, search_classes and search_backgrounds say not logged in")
it("an outage while logged in still says D&D Beyond unavailable")    // fetch rejects with a network error, session valid
it("anonymous saved cookies (SessionNotSignedInError) count as logged out")
```

- [ ] **Step 2: Run them to make sure they fail.** Expected: FAIL (the wording is "D&D Beyond unavailable").
- [ ] **Step 3: Implement it.** If `loadSpellCompendium` or the game-data loader replaces the original error, keep it as `cause`; the tests decide.
- [ ] **Step 4: Run all tests.** Run: `npm test`. Expected: PASS.
- [ ] **Step 5: Update `tool-notes.md` and `intended-behaviour.md` (logged-out wording), and commit.**

```bash
git add src/edition.ts src/open5e.ts src/tools/reference.ts tests docs/claude/tool-notes.md skills/ddb-mcp-regression/references
git commit -m "fix(catalog): logged-out Open5e fallbacks say to log in, not that D&D Beyond is down (F13)"
```

---

### Task 11: The 2014 conditions in full (F5)

**Files:**
- Modify: `src/tools/conditions.ts` (`CONDITIONS_2014`, `Condition`, `getCondition`), `scripts/check-conditions.mts`
- Test: `tests/conditions.test.ts`

**Interfaces:**
- `Condition` gains `notes?: string[]`, printed after the effects as plain paragraphs, each preceded by a blank line.
- `CONDITIONS_2014` is re-transcribed verbatim from SRD 5.1, Appendix PH-A: Conditions (https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf, CC-BY-4.0), for all 15 conditions.
  - The opening paragraph is `description`, each bullet is an `effect` and later paragraphs are `notes`.
  - For Exhaustion, the six table rows are the effects ("Level 1: Disadvantage on ability checks", …). Its notes are the stacking paragraph ("If an already exhausted creature suffers another effect…", "A creature suffers the effect of its current level of exhaustion as well as all lower levels…", "An effect that removes exhaustion reduces its level…") and the recovery paragraph ("Finishing a long rest reduces a creature's exhaustion level by 1, provided that the creature has also ingested some food and drink. Also, being raised from the dead reduces a creature's exhaustion level by 1.").
  - Add the SRD 5.1 attribution sentence to the file header beside the 5.2 one.
- `check-conditions.mts` keeps its authenticated fetch and so still needs `ddb_login`, even though rule-data also answers anonymously. It also compares each 2014 entry (description + effects + notes) with the rule-data text after `<hr>`, minus "Legacy Definition" and `(see the condition)` / `(see appendix A)` cross-references. Its output reads `ok 2014 <name>` / `DIFF 2014 <name>`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("2014 Exhaustion includes stacking and removal")
  // getCondition("exhaustion","2014") contains "as well as all lower levels" and "Finishing a long rest reduces a creature's exhaustion level by 1"
it("2014 Grappled keeps the thunderwave sentence")   // contains "such as when a creature is hurled away by the thunderwave spell"
it("every 2014 condition prints description, effects, then notes")
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/conditions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Transcribe the 15 entries and extend the script.**
- [ ] **Step 4: Verify.** Run `npm test` (PASS). Then run `npx tsx scripts/check-conditions.mts` (needs `ddb_login`): expected `ok 2014 <name>` for all 15. Read any `DIFF` line before going on.
- [ ] **Step 5: Commit.**

```bash
git add src/tools/conditions.ts scripts/check-conditions.mts tests/conditions.test.ts
git commit -m "fix(conditions): full SRD 5.1 text for the 2014 conditions, checked against D&D Beyond (F5)"
```

---

### Task 12: Browser tools succeed on a loaded page and never print call logs (F8)

**Files:**
- Modify: `src/tools/navigate.ts` (`navigate`), `src/server.ts` (the `ddb_navigate`, `ddb_interact`, `ddb_get_page` and `ddb_close_browser` catch blocks)
- Test: `tests/navigate.test.ts`, plus server-level tests in the style of `tests/server-login.test.ts`

**Interfaces:**
- `navigate` loads with `page.goto(url, { waitUntil: "load", timeout: 30000 })`. It then waits best-effort with `await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})`. The guard, the allowlist and the `assertSessionCurrent` checks are unchanged.
- The four `server.ts` catch blocks print `safeErrorLine(err)` in place of `err.message`, keeping their `Navigation failed:` (and similar) prefixes.
- `safeErrorLine` itself is unchanged. It already keeps only the first line, so a `Call log:` or `Browser logs:` block on a later line never survives it. The leak came from `server.ts` printing `err.message` raw.

- [ ] **Step 1: Write the failing tests.**

```ts
it("navigate returns the page when networkidle never comes")   // fake page: goto resolves; waitForLoadState("networkidle") rejects with a timeout → returns "URL: …" with the wrapped content
it("navigate waits for load, not networkidle")                 // the fake records goto's waitUntil === "load"
// Server level, one per catch block (ddb_navigate, ddb_interact, ddb_get_page, ddb_close_browser):
it("<tool>'s error reply has its first line only")
  // the tool's function rejects with "page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to …\nBrowser logs:\n<launching> /Applications/…"
  // → reply text is "<prefix> Timeout 30000ms exceeded." with no "Call log", "Browser logs", "<launching>" or "/Applications"
```

- [ ] **Step 2: Run them to make sure they fail.** Run: `npx vitest run tests/navigate.test.ts` and the new server tests. Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run all tests.** Run: `npm test`. Expected: PASS.
- [ ] **Step 5: Update `tool-notes.md` (browser tools) and commit.**

```bash
git add src/tools/navigate.ts src/server.ts tests docs/claude/tool-notes.md
git commit -m "fix(browser): a loaded page is a success; errors go through safeErrorLine (F8)"
```

---

### Task 13: Verification, website checks and docs

**Files:**
- Modify: `docs/claude/history.md`, `CLAUDE.md` ("Open work"), `skills/ddb-mcp-regression/references/*` (anything not already synced)

- [ ] **Step 1: Live snapshot diff.** Run `npx tsx scripts/snapshot-live-characters.mts > "$TMPDIR/after.txt" && diff "$TMPDIR/before.txt" "$TMPDIR/after.txt"`. Every changed line must come from one of these:
  - F7, which doesn't appear in character output;
  - F9: Flemin's Dart row;
  - F11: Orion, Calderax and Clover staff rows;
  - F4: the 8 characters' spell lists, concentration and bonus actions;
  - F3: slot labels;
  - F14/F10: feature dice and DCs (about 6 dice rows and about 18 DC rows);
  - F15: Magical Sleep.
  F12 should produce **no** difference: no test character is unfinished, so its fixture tests in Task 6 are the check. Optionally the owner runs `ddb_get_character` on their own unfinished character. Anything else is a bug to fix before going on.
- [ ] **Step 2: Whole-corpus regression.** Run `npx tsx scripts/regress-all-characters.mts --baseline-dir "$TMPDIR/ddb-base" --diff`. Expected: exit 0, 0 crashes, 0 inconsistencies and 0 new anomalies. Read every difference in `report.md` against the Step 1 list.
- [ ] **Step 3: Website checks** (read-only, dndbeyond.com; the owner can do these in a browser if `ddb_navigate` can't launch). Clover's Staff and Zayda's two Magic Auras were checked on 2026-11-17 (see "Investigation results"); the tool's output must match them:
  - Clover 155665213: the tool prints `• Staff   +3 to hit   1d6+1 bludgeoning (1d8+1 two-handed)   reach 5 ft.   Versatile`.
  - Zayda 49128422: the tool lists both Arcanist's Magic Aura and Nystul's Magic Aura.
  - Cathartic 112305147 shows Spiritual Weapon and Raise Dead, and the tool now lists them.
  - Flemin 112315775's Dart reads +7 / 1d4+3, and his Stunning Strike reads DC 15.
- [ ] **Step 4: Live MCP samples** against a fresh build (`npm run build`):
  - `ddb_get_monster` Adult Red Dragon (2014 and 2024): fire immunity shown.
  - `ddb_search_feats({prerequisite:"Strength 13"})`: D&D Beyond's Grappler.
  - `ddb_get_condition({name:"exhaustion", rules_edition:"2014"})`: full text.
  - Logged out, `ddb_get_spell({name:"Fireball"})`: says not logged in.
  - `ddb_character_lookup` Goliath 152579009 "stones endurance": Giant Ancestry.
  - `ddb_character_lookup` Ezra 127373542 "Sneak Attack": `[Class Feature]`.
- [ ] **Step 5: Docs and commit.** In `history.md`, add a "Findings and commits" table (F1–F15), the verification results and any carry-overs found. In `CLAUDE.md` "Open work", add the 2026-11-13 remediation item (done, unreleased) and update the unreleased commit count. Run `npm run typecheck && npm run lint && npm test` one last time.

```bash
git add docs/claude/history.md CLAUDE.md skills/ddb-mcp-regression/references
git commit -m "docs: regression remediation 2026-11-13 — findings, verification, carry-overs"
```

- [ ] **Step 6: Remove the baseline worktree** (the 2026-11-11 run left its worktree registered, final review M-7): `git worktree remove "$TMPDIR/ddb-base" && git worktree prune`.

## Out of scope (from the report's Improvements and Known open issues)

- The report's "Improvements" list, for example the Pact Magic label, "no spells prepared", cut-off background text, the `ddb_read_book` query note and a skill filter for backgrounds. None is a finding; pick them up in a later round.
- Known open issues (ba), (bd), (be) (beyond R2), (bj) and B14: unchanged.
- Logged-out catalog tools could fetch D&D Beyond anonymously, since `game-data/feats` answers without a session. That is a design change for the owner, not part of F13.

## Owner decisions 2026-11-17 (pre-flight)

These override the task text above where they differ. Full wording is in `docs/claude/history.md` ("Regression remediation 2026-11-13").

- R5 (F3, Task 4): "<Nth> level, no slot" (item bucket "<Nth> level, from item") when `castAtLevel` is set and `usesSpellSlot` is false; "no slot" / "from item" without it.
- S1-S4 (Task 3): 10 s overall deadline with parallel subclass requests; one session snapshot plus `assertSessionCurrent` after the merge; `ddb_clear_cache` "characters"/"all" clear the new cache; token-exchange failure fetches the lists anonymously with no extra notice.
- S5 (Task 2): equipped behaviour items leave EQUIPPED and INVENTORY like weapons; attuned ones stay on the Attuned line; `inventory.ts` joins Task 2.
- S7 (Setup): Setup records R1-R5 and the investigation in `history.md` only; each task adds its own `intended-behaviour.md` entry.
- S8 (Task 13): allowed diffs include `Rules:` spell counts, new spell rows in ACTIONS/REACTIONS and the R5 labels; F4/F11 outside the live-snapshot targets are checked by the whole-corpus diff.
- B1 (Task 9): the whole-text prerequisite check is a plain case-insensitive substring test; token matching only per OR group.
- B3 (Task 6): "a species" is missing only when `race` is not an object or lacks `fullName`/`baseName` AND `options.race` has no named entry; add a `race: null` plus `options.race` test.
- M3 (Setup): `/Users/<name>/...` paths in the moved report become `~/...`.
- M5 (Task 10): reuse `NOT_LOGGED_IN_SUFFIX`; no `LOGGED_OUT_NO_MATCH_SUFFIX`.
- M13 (Task 3): the regress script caches the always-prepared lists beside the character JSON.
- M15 (Task 12): the four catch blocks' stderr lines use `safeErrorLine`.
- M16 (Task 3): cache empty `[]` lists; document in `caching.md`; `TtlCache` needs an explicit max.
- M17 (Task 8): keep the subclass-list skip as a guard, with a comment.
- A4 (Task 1): unknown-id "Damage Adjustments" line after the condition line, same label in both editions; null config prints one "couldn't be loaded" line.
- A5 (Task 8): a `via` hit in the more-than-3-hits list appends ` (through "<action>")`, wrapped when `untrusted || via.homebrew`.
- A6 (Task 8): "shown actions" is the sheet's rule (activation types 1/3/4/8, not mastery actions).
- A7 (Task 9): `hidePrerequisite` groups are off the Requires line but used for matching; the class-feature summary branch needs at least one mapping per group.
- A8 (Task 5): "distinct savedc" is by ability; tests read proficiency from `core.profBonus`.
- A11 (Task 11): `check-conditions` prints "ok 2024 <name>" / "ok 2014 <name>"; update CLAUDE.md Commands and `tool-notes.md`.
- A12 (Task 1): the Open5e path's 2014 defense labels on SRD 5.2 creatures become carry-over (bw), not fixed.
