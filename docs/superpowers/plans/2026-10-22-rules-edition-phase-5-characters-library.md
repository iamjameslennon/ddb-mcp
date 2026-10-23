# Rules Edition Phase 5 (Characters and Library) Implementation Plan

**Outcome (2026-10-23):** done. Commits `2325dbc..399601b` (features `2325dbc`, `2b3ee46`, `4195941`, `2ca28ae`, `2e5248a`; fix rounds `872e46e`, `cd25e72`, `5cc8104`, `399601b`) on phase start `57f61ca`, docs commit on top. The owner approved the cumulative snapshot and live diff on 2026-10-23 (decision 12). Live check: all 15 characters differ from the phase-start code only by Rules lines and tags; the live library joined 8 of 8 books by slug. Owner rulings made while executing are recorded in the spec under "Characters — phase 5" and "Library — phase 5".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review round (2026-10-22).** Four adversarial reviewers (two Opus, two Sonnet; the opencode DeepSeek reviewers could not run because the OpenCode Zen free quota was exhausted) checked the first draft against the spec and the code. One Opus reviewer built Tasks 1–4 in a copy of the repo and ran the suite. Every finding below was re-verified before it was accepted. This revision:
- **Tags `__DISGUISE_FEAT` entries** in OTHER FEATURES and lists them in the summary. The draft skipped them on the false premise that the sheet doesn't print them, which left third-party entries such as Dark Bargain unlabelled.
- **Lists the five `tests/character-parser.test.ts` assertions Task 3 breaks** and how to fix them.
- **Makes empty library slugs and empty `sourceURL`s never match.** 57 sources have `sourceURL: ""`, so `"" === ""` would label slug-less books 2014.
- **Pins the species tag after the lineage suffix.**
- **Keeps the Wizard gate out of the shared spell helper**, so duplicate detection is unchanged.
- **Gives id-less items a name fallback.**
- **Classifies classes only with `classifyEdition`** (decision 11) and skips a null subclass.
- **Fixes the Task 5 label test**, which never reached the label path.
- **Adds tests for the four new tool notes** and a live library-join probe (Task 5 Step 0).
- **Records the push-gated snapshot review and the spec's main-edition contradiction** (decisions 12–13).
- **Moves the shared test helpers to a fixture file** and adds `docs/character-refactor.md` to Task 6.

**Goal:** Character sheets, `ddb_character_lookup`, `ddb_get_party`, `ddb_list_library` and `ddb_read_book` say which ruleset their content comes from. A character gets a `Rules:` summary line under its name, inline tags on entries from another ruleset, and lookups get a rules line per hit. Books get a tag in the list and a rules line when read.

**Architecture:** A new `src/tools/character/editions.ts` classifies a character once (classes decide the main edition) and hands every section module a `CharacterEditions` object (on `CoreStats`) with the summary line and a per-definition tag. The label strings stay in `src/edition.ts`, which gains `classifyCharacterEntry` (dual-edition definitions take the character's main edition) and spell/item counts in `characterRulesLine`. `parseCharacterData` takes the source index as an argument (default `peekSourceIndex()`, so it stays synchronous). Its async callers pass `await getSourceIndex()`. The library joins each book to a game-config source by slug, then title, and classifies that source.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), `@modelcontextprotocol/sdk` 1.32, zod, vitest.

**Spec:** [docs/superpowers/specs/2026-10-16-rules-edition-design.md](../specs/2026-10-16-rules-edition-design.md). Read Principle, Vocabulary and labels, "Characters — phase 5", "Library — phase 5" and Phase 5. Phases 1–4 are done: the real label functions (`characterMainEdition`, `characterTag`, `characterRulesLine`, `rulesLine`, `editionTag`) are already in `src/edition.ts` with tests in `tests/edition.test.ts`. **Where the decisions below differ from the spec, this plan wins. Task 6 writes them into the spec.**

## Live data facts (probed 2026-10-22, the 15 characters in `scripts/snapshot-live-characters.mts`)

| Fact | Consequence |
|---|---|
| Standard weapons, armour and some magic items are one non-Legacy definition listing a 2024 and a 2014 book (Dagger, Shield, Leather, Studded Leather `[148, 1]`; Ring of Protection `[146, 1, 148]`). `classifyEdition` calls them 2024 | Read literally, the spec would label 13 of 15 live characters (every 2014 one) with false lines like `2024 content: Leather (item), Dagger (item), Shortbow (item)`. Decision 1 |
| Legacy mundane gear (`isLegacy: true`, `[1, 2]`: Bedroll, Torch, Waterskin) appears on 2024 characters; the same character can hold the 2024 copy (`[145, 148]`) instead | Really 2014 content, but numerous: Calderax (2024 Cleric) has 26 such items and 8 2014 spells, so naming every entry gives a 962-char summary line. Decision 2 |
| No class, subclass, species, background, feat or spell on the 15 characters carries books from both editions | Decision 1 affects only items in practice |
| The species definition is `char.race` and carries `fullName` / `baseName`, not `name` | The species entry's name is `fullName \|\| baseName` |
| Some items have no sources (`Platinum Ring`, `Filigreed Longsword`: `sources: []`) and some species are homebrew (`Kobold (Bad Batch)`) | They classify `unstated` / `homebrew` and are always tagged |
| `__DISGUISE_FEAT` entries can be third-party ("Dark Bargain", "Hero's Journey Boon"). The sheet prints them under OTHER FEATURES (`features.ts`, `formatFeaturesBlock`) | They are classified and tagged like feats. Decision 4 |
| Game-config `sourceURL` is `sources/dnd/<slug>`; 57 of 314 snapshot sources have `sourceURL: ""` (e.g. id 4, Elemental Evil Player's Companion); 4 paths are shared by several ids (`basic-rules-2014` = 1 [cat 26] + 209, 210, 212 [cat 16 Hidden Sources]; likewise `br-2024`, `paitm`, `ddbd`). A library entry whose `relativePath` isn't under `/sources/` gets `slug: ""` (`library.ts`, `parseSourcesFromLibraryHtml`) | Library join: decision 7 (an empty segment never matches) |
| Calderax's live subclass is literally named "Grave Domain (XGtE)" | So decision 2's example prints `Grave Domain (XGtE) (subclass)` |
| `char.spells` keys on the 15 characters: only `race`, `class`, `item`, `feat`, all in `SOURCE_LABELS` | The summary count and the concentration list read the same spells on live data (decision 4) |
| The owner's live library (8 free or shared books) joins 8 of 8 by slug segment: `basic-rules-2014` → 1, `br-2024` → 148, `ua` → 100, `lmop` → 8, `mcv1` → 89, `sac` → 53, `sae` → 166, `wa` → 62 | Step (a) of decision 7 holds on live data. Paid books are unverified (the account owns none), so a failed slug join falls back to the library title |

## Decisions this plan makes (flag in review if wrong)

1. **Dual-edition definitions match either edition on a character** (owner decision 2026-10-22). When the character's main edition is 2024 or 2014, a definition with `isHomebrew !== true`, `isLegacy !== true`, and at least one source in a 2024 category and one in a 2014 category classifies as the main edition, with that edition's first source as its book. So it is neither tagged nor listed, and a lookup shows the main edition's book (`Rules: 2014 · Basic Rules (2014)` for a Dagger on a 2014 character). When the main edition is `unstated`, plain `classifyEdition` applies. Catalog tools are unchanged.
2. **The summary line counts spells and items; it names everything else** (owner decision 2026-10-22). Within each ruleset group: named entries in the order given, then `1 spell` / `N spells`, then `1 item` / `N items`. Example: `Rules: 2024 · 2014 content: Grave Domain (XGtE) (subclass), Noble (background), 8 spells, 26 items · homebrew: Spelldriver (feat), Survivalist (feat)`. The inline tags on the spell and inventory lines name each one.
3. **A subclass is tagged, and listed in the summary, only when its ruleset differs from its own class's.** This reads the spec's "a subclass with a different ruleset is tagged on its own". Otherwise the subclass inherits its class's tag, including a non-edition one: a homebrew subclass of a homebrew class reads `Blood Hunter [homebrew] (Order of the Lycan) 2`, and the class's summary entry covers both. Without this rule, a mixed character's 2014 Ranger would print `Ranger [2014] (Gloom Stalker [2014])` and list Gloom Stalker again in the summary. With it, a 2024 Ranger with a 2014 Gloom Stalker still gives `2014 content: Gloom Stalker (subclass)`, as the spec's example does. A subclass that differs from its class is tagged even when it matches the main edition (`Ranger [2014] (Gloom Stalker [2024]) 3` on a mixed character), so the header never implies the class's ruleset for it; the summary doesn't list it, because it matches the main edition. A null subclass is skipped.
4. **Only what the sheet shows is classified and counted:** every entry in `char.feats` except `__INITIAL_ASI` (the real feats in FEATS and the `__DISGUISE_FEAT` entries in OTHER FEATURES, both `kind: "feat"`); spells the SPELLS section lists (class spells behind the Wizard prepared-or-ritual gate for leveled spells, plus `spells[key]` for the `SOURCE_LABELS` keys), deduped by definition id; items the sheet shows (every non-weapon, plus equipped weapons, which appear under ACTIONS), deduped by definition id. Spells and items without an id dedupe by name. A count never names something the sheet doesn't print. The count follows the SPELLS section's keys, while the CONCENTRATION SPELLS block keeps reading every `char.spells` key, as it does today (owner decision 2026-10-22). A concentration spell under a key outside `SOURCE_LABELS` would be tagged there but not counted. No live character has such a key. Class features and racial traits are not classified: they are not on the spec's path list and carry no sources of their own.
5. **Placement.** The summary line goes on the line after the character's name, inside the header box, on every section (it is part of `formatHeaderBlock`). Inline tags go right after the entry's name: header (the species tag goes after the whole decorated race string, `Elf (Wood Elf) [2014]`; also class, subclass and background), FEATS and OTHER FEATURES lines, spell names in SPELLS (including duplicate warnings) and CONCENTRATION SPELLS, EQUIPPED and INVENTORY entries, and weapon attack lines (the tag is padded with the name, so `Longsword [2014]` fills the 16-char column).
6. **`ddb_character_lookup`** tags every list line with `editionTag` and gives every full hit a `rulesLine` under its first line. Both use the character's `CharacterEditions.info()`, so decision 1 applies there too. Class and subclass features take the owning class's or subclass's definition, racial traits the species, the background feature the background. No reason lines: character content has no requested edition.
7. **Library join**, in order: (a) the slug's last non-empty path segment equals the last non-empty segment of a source's `sourceURL`; a slug or `sourceURL` with no non-empty segment (`""`, null) never matches in this step; (b) else the normalized title (`normalizeName`) equals a source's normalized decoded description or its book label. Within a step, the candidates are classified with `classifyEdition({ sourceId })`. If the non-`unstated` candidates share one ruleset, take the lowest id among them (`basic-rules-2014` → 1). If there are no non-`unstated` candidates, take the lowest id. If they disagree, the step fails. If both steps fail, the book is `{ ruleset: "unstated", book: null }`. `ddb_read_book` given a slug runs step (a). Only when that fails does it fetch the library list once, take the title of the book with that slug, and run step (b) (owner decision 2026-10-22). A slug missing from the library, or a failed library fetch, leaves the book "edition not stated" without failing the read.
8. **`ddb_list_library` stays JSON**: each book gains `"edition": "[2024]"` (the `editionTag` text). `ddb_read_book` prints `rulesLine(info)` between its `# <slug>` title and the `URL:` line.
9. **The source index is passed in, not fetched inside the parser.** `parseCharacterData(raw, sections, index = peekSourceIndex())` stays synchronous. `parseCharacter`, `getParty` (once per party) and `getDefinition` pass `await getSourceIndex()`, which never rejects and falls back to the snapshot. This covers a logged-out public character too.
10. **Carry-over (c) is closed by the header tags.** `ddb_get_party` prints the `summary` section, whose header tags the classes, subclass, species and background. The head `Rules: edition not stated` already covers unstated feats, spells and items, so nothing goes unlabelled.
11. **Class definitions always classify with plain `classifyEdition`**, in the main-edition computation, their summary entries and their header tags (`classTag`). Decision 1 never re-labels a class, because the classes decide the main edition. No live class carries books from both editions.
12. **The snapshot review gates the push, not each commit.** The spec says "have the owner review the diff before commit". This plan commits per task, so every commit passes `npm test`, and the owner reviews the cumulative snapshot and live diff in Task 6 before anything is pushed. Changes the owner asks for land as fix commits.
13. **The spec's main-edition text is reconciled to the code.** The spec says "the highest level wins, and a tie goes to 2024" and also "spanning both editions is mixed, with 2024 the main edition". `characterMainEdition` (phase 1, tested) implements the second, which makes the first unreachable. Task 6 removes the "highest level" sentence.

## Global Constraints

- No label wording outside `src/edition.ts`. New wording (the counts, tool-description notes) goes there with a test.
- Character tools take no `rules_edition` and do no twin selection (spec non-goal).
- `npm run typecheck`, `npm run lint`, `npm test` pass at every commit.
- Inline tag format: `[2024]`, `[2014]`, `[third-party]`, `[homebrew]`, `[playtest]`, `[edition not stated]`, one space after the name.
- The committed snapshots (`tests/__snapshots__/character-snapshot.test.ts.snap`) change deliberately. Commit locally per task; **do not push until the owner approves the cumulative snapshot and live diff in Task 6.**
- Don't touch homebrew wrapping (`wrapIfHomebrew`, security finding F-2026-10-20). It is ported after the stateless plan's Task 2.

## Review Focus

1. **An entry with no sources** (a custom item, an old homebrew-free definition) must be tagged `[edition not stated]` and counted under `edition not stated:`, never dropped or guessed. Tested in Task 2 (count) and Task 3 (tag).
2. **Missing pieces**: `race: null`, `background.definition: null` (custom background), `subclassDefinition: null` must not throw, and nothing is listed for them. Tested in Task 2.
3. **The same spell granted twice** (class list and a racial grant) is counted once; an unequipped weapon, which the sheet never prints, is not counted. Tested in Task 2.
4. **A library slug shared by several sources** (`dnd/basic-rules-2014` → ids 1, 209, 210, 212) must label the book 2014 (id 1), not "edition not stated" from a Hidden Sources twin. Tested in Task 5.
5. **A library title matching books of both editions** must give "edition not stated", not a guess. Tested in Task 5.

---

### Task 1: Character labels in `src/edition.ts`

**Files:**
- Modify: `src/edition.ts` (character summary section, ~lines 681–747)
- Test: `tests/edition.test.ts` (`describe("character edition labels")`, line 717)

**Interfaces:**
- Produces: `classifyCharacterEntry(entry: EditionMarkers, index: SourceIndex, main: RulesEdition | "unstated"): EditionInfo`; `characterRulesLine` with counts (same signature).

- [ ] **Step 1: Write the failing tests** (in the existing describe; it already has `ent()` and `info()`; `classifyCharacterEntry` tests use the file's fixture `INDEX` built from `SOURCES`/`CATEGORIES`)

```ts
it("classifyCharacterEntry: a non-Legacy definition with 2024 and 2014 books takes the main edition", () => {
  const dagger = { sources: [{ sourceId: 148 }, { sourceId: 1 }] };
  expect(classifyCharacterEntry(dagger, INDEX, "2014")).toEqual({ ruleset: "2014", book: "Basic Rules (2014)" });
  expect(classifyCharacterEntry(dagger, INDEX, "2024")).toEqual({ ruleset: "2024", book: "D&D Beyond Basic Rules" });
  expect(classifyCharacterEntry(dagger, INDEX, "unstated")).toEqual(classifyEdition(dagger, INDEX));
});

it("classifyCharacterEntry: Legacy, homebrew and single-edition definitions classify as usual", () => {
  const legacy = { isLegacy: true, sources: [{ sourceId: 148 }, { sourceId: 1 }] };
  expect(classifyCharacterEntry(legacy, INDEX, "2024").ruleset).toBe("2014");
  expect(classifyCharacterEntry({ isHomebrew: true, sources: [{ sourceId: 148 }, { sourceId: 1 }] }, INDEX, "2014").ruleset).toBe("homebrew");
  expect(classifyCharacterEntry({ sources: [{ sourceId: 2 }] }, INDEX, "2024")).toEqual({ ruleset: "2014", book: "Player's Handbook (2014)" });
});

it("counts spells and items after the named entries of each group", () => {
  const entries = [
    ent("Cleric", "class", "2024", 12), ent("Grave Domain", "subclass", "2014"), ent("Noble", "background", "2014"),
    ent("Friends", "spell", "2014"), ent("Web", "spell", "2014"), ent("Bedroll", "item", "2014"),
    ent("Spelldriver", "feat", "homebrew"), ent("Torch", "item", "2014"),
  ];
  expect(characterRulesLine(entries)).toBe(
    "Rules: 2024 · 2014 content: Grave Domain (subclass), Noble (background), 2 spells, 2 items · homebrew: Spelldriver (feat)");
});

it("singular counts", () => {
  const entries = [ent("Bard", "class", "2024", 1), ent("Frostbite", "spell", "2014"), ent("Torch", "item", "2014")];
  expect(characterRulesLine(entries)).toBe("Rules: 2024 · 2014 content: 1 spell, 1 item");
});
```

Update the existing assertion at line 771 to `"Rules: 2024 · edition not stated: 1 item"`, and any other existing assertion that names a `spell` or `item` entry.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/edition.test.ts -t "character edition labels"`
Expected: FAIL (`classifyCharacterEntry` is not exported; the count assertions get named entries).

- [ ] **Step 3: Implement**

`classifyCharacterEntry`: apply decision 1, using `entrySourceIds`, `index.sources` and `categoryRuleset`. Otherwise return `classifyEdition(entry, index)`. In `characterRulesLine`, within each group, list non-spell, non-item entries by name as today, then append the spell count and the item count when non-zero. Update the doc comment.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/edition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/edition.ts tests/edition.test.ts
git commit -m "feat(edition): character entries take the main edition when valid for both; count spells and items"
```

---

### Task 2: Character editions, the summary line, and header tags

**Files:**
- Create: `src/tools/character/editions.ts`
- Modify: `src/tools/character/types.ts` (`CoreStats.editions`), `src/tools/character/core.ts` (`computeCoreStats(char, index)`), `src/tools/character/parse.ts`, `src/tools/character/identity.ts`, `src/tools/character/spells.ts` (export `shownSpellDefinitions`), `src/tools/character.ts` (`parseCharacter`), `src/tools/party.ts`, `src/server.ts` (descriptions of `ddb_get_character`, `ddb_get_party`), `src/edition.ts` (`CHARACTER_RULES_TOOL_NOTE`)
- Modify: `tests/fixtures/character-fixtures.ts` (edition markers), `tests/party.test.ts`, `tests/edition.test.ts` (note constant), `tests/__snapshots__/character-snapshot.test.ts.snap`
- Create: `tests/fixtures/character-edition-helpers.ts`
- Test: `tests/character-editions.test.ts` (new)

**Interfaces:**
- Consumes: `classifyCharacterEntry`, `characterRulesLine`, `characterTag`, `editionTag`, `classifyEdition`, `CharacterEditionEntry` from `src/edition.ts`; `peekSourceIndex` / `getSourceIndex` from `src/game-config.ts`.
- Produces:
  ```ts
  // src/tools/character/editions.ts
  export interface CharacterEditions {
    main: RulesEdition | "unstated";
    /** characterRulesLine over the classified entries (decisions 2–4). */
    rulesLine: string;
    /** classifyCharacterEntry(def, index, main), for every non-class definition (decision 11). */
    info(def: unknown): EditionInfo;
    /** "" when characterTag(info(def), main) is null, else " [2014]" etc. Non-class definitions. */
    tag(def: unknown): string;
    /** The class definition's tag from classifyEdition (decision 11), same "" / " [x]" form. */
    classTag(cls: ClassEntry): string;
    /** "" for a null subclass or one whose ruleset equals its class's (classifyEdition for the class, info() for the subclass), else " " + editionTag(subclass info). */
    subclassTag(cls: ClassEntry): string;
  }
  export function computeCharacterEditions(char: CharData, index: SourceIndex): CharacterEditions;
  // src/tools/character/spells.ts
  export function shownSpellDefinitions(char: CharData, classes: readonly ClassEntry[]): Record<string, unknown>[];
  // tests/fixtures/character-edition-helpers.ts (shared by Tasks 2–4)
  export const INDEX: SourceIndex;            // buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES)
  export const S: (...ids: number[]) => Array<{ sourceId: number }>;
  export function variant(base: Record<string, unknown>, edit: (d: any) => void): Record<string, unknown>; // structuredClone, edit .data
  export function item(id: number, name: string, filterType: string, extra?: Record<string, unknown>, equipped?: boolean): Record<string, unknown>;
  export function bgAndFeat(): Record<string, unknown>;
  export const TAG: RegExp;                   // /\[(?:2024|2014|third-party|homebrew|playtest|edition not stated)\]/
  // src/tools/character/parse.ts
  export function parseCharacterData(raw: CharData, sections?: ParseSection, index?: SourceIndex): string; // index defaults to peekSourceIndex()
  // CoreStats gains: readonly editions: CharacterEditions;  computeCoreStats(char: CharData, index: SourceIndex)
  ```

- [ ] **Step 1: Capture the live "before" dump** (needs `ddb_login`; skip with a note if no session)

Run: `mkdir -p .claude/phase5 && git rev-parse HEAD > .claude/phase5/base && npx tsx scripts/snapshot-live-characters.mts > .claude/phase5/before.txt`
Expected: exit 0, one block per character. `.claude/phase5/base` holds the phase-start commit, which Task 6 diffs against. Without a session, record `base` anyway. Task 6 then builds `before.txt` from a `git worktree add .claude/phase5/base-tree $(cat .claude/phase5/base)` checkout, running the script there with `npm ci` first.

- [ ] **Step 2: Add edition markers to the three fixtures**

- `FIGHTER_5` (pure 2024): `sources: [{ sourceId: 145 }]` on `race`, the Fighter definition, the Soldier background definition, the Great Weapon Master definition and the Action Surge (`__DISGUISE_FEAT`) definition.
- `MONK_3_HANDAXE` (2014): `isLegacy: true, sources: [{ sourceId: 2 }]` on `race`; `sources: [{ sourceId: 2 }]` on Monk and Outlander; Handaxe `sources: [{ sourceId: 148 }, { sourceId: 1 }]` (dual-edition).
- `ARCANE_TRICKSTER_9` (2024 with a 2014 background): `sources: [{ sourceId: 145 }]` on `race`, Rogue and Arcane Trickster; `sources: [{ sourceId: 2 }]` on Criminal.

Update the header comment of each fixture with its ruleset.

- [ ] **Step 3: Write the failing tests** in `tests/character-editions.test.ts`, with the shared helpers in `tests/fixtures/character-edition-helpers.ts` (Interfaces above). `item(id, name, filterType, extra = {}, equipped = false)` builds `{ equipped, quantity: 1, definition: { id, name, filterType, ...extra } }`. `bgAndFeat()` returns `FIGHTER_5` with background `sources = S(2)` and a pushed feat `{ definition: { name: "Sharpshooter", snippet: "Long shots.", categories: [], sources: S(2) } }`. Locally:

```ts
const sheet = (c: Record<string, unknown>, s: ParseSection = "full") => parseCharacterData(c, s, INDEX);
const lines = (c: Record<string, unknown>) => sheet(c).split("\n");
```

| Test | Input | Assertions |
|---|---|---|
| `pure 2024: Rules: 2024 and no inline tags` | `FIGHTER_5` | `lines(c)[1] === "  Thorin"`, `lines(c)[2] === "  Rules: 2024"`, `sheet(c)` does not match `TAG` |
| `the summary line is on every section` | `FIGHTER_5`, each of the 8 `ParseSection`s | `sheet(c, s).split("\n")[2] === "  Rules: 2024"` |
| `2024 with a 2014 background and feat` | `bgAndFeat()` | contains `"  Rules: 2024 · 2014 content: Soldier (background), Sharpshooter (feat)"` and `"  Background: Soldier [2014] | XP: 6500"` |
| `mixed multiclass` | `FIGHTER_5`; push class `{ id: 9, level: 3, definition: { name: "Ranger", hitDice: 10, canCastSpells: false, spellCastingAbilityId: 0, spellRules: {}, sources: S(2) }, subclassDefinition: null, classFeatures: [] }` | contains `"  Rules: mixed — 2024: Fighter 5 · 2014: Ranger 3"` and `"  Mountain Dwarf | Fighter 5 / Ranger [2014] 3 | Level 8"` |
| `homebrew class: edition not stated` | `FIGHTER_5`; class definition `name: "Blood Hunter", isHomebrew: true, sources: []` | contains `"  Rules: edition not stated · 2024 content: Mountain Dwarf (species), Soldier (background), Great Weapon Master (feat) · homebrew: Blood Hunter 5 (class)"`, `"  Mountain Dwarf [2024] | Blood Hunter [homebrew] 5 | Level 5"`, `"  Background: Soldier [2024] | XP: 6500"` |
| `a subclass of its class's ruleset is neither tagged nor listed` | `ARCANE_TRICKSTER_9` | contains `"  Rules: 2024 · 2014 content: Criminal (background)"` and `"Rogue (Arcane Trickster) 9"` |
| `a 2014 subclass under a 2024 class is tagged on its own` | `ARCANE_TRICKSTER_9`; subclass `sources = S(2)` | contains `"Rogue (Arcane Trickster [2014]) 9"` and `"  Rules: 2024 · 2014 content: Arcane Trickster (subclass), Criminal (background)"` |
| `2014 character with a dual-edition weapon` | `MONK_3_HANDAXE` | `lines(c)[2] === "  Rules: 2014"`; header line `"  Wood Elf | Monk 3 | Level 3"` |
| `counts spells and items the sheet shows, once each` (Review Focus 1, 3) | `FIGHTER_5`; `spells.race = [{ definition: { id: 901, name: "Toll the Dead", level: 0, sources: S(27) } }]`; `spells.feat = [{ definition: { id: 901, name: "Toll the Dead", level: 0, sources: S(27) } }, { definition: { id: 902, name: "Hex", level: 1, sources: S(2) } }]`; `inventory = [ item(903, "Bedroll", "Other Gear", { isLegacy: true, sources: S(1, 2) }), item(904, "Dagger", "Weapon", { isLegacy: true, sources: S(1) }, false), item(905, "Platinum Ring", "Other Gear", { sources: [] }) ]` | contains `"  Rules: 2024 · 2014 content: 2 spells, 1 item · edition not stated: 1 item"` |
| `items without an id are counted by name` | `FIGHTER_5`; inventory: two `{ equipped: false, quantity: 1, definition: { name: "Torch", filterType: "Other Gear", isLegacy: true, sources: S(1) } }` and one with `name: "Bedroll"` (same markers), none with an `id` | contains `"2014 content: 2 items"` |
| `a third-party disguised feat is listed` | `FIGHTER_5`; push feat `{ definition: { name: "Dark Bargain", categories: [{ tagName: "__DISGUISE_FEAT" }], sources: S(193) } }` | contains `"  Rules: 2024 · third-party: Dark Bargain (feat)"` |
| `missing race, background and subclass don't throw` (Review Focus 2) | `FIGHTER_5`; `race = null`; `background = { definition: null }` | `lines(c)[2] === "  Rules: 2024"` |
| `the species tag follows the lineage` | `FIGHTER_5`; `race = { fullName: "Elf", baseName: "Elf", isLegacy: false, sources: S(2), weightSpeeds: { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } }, racialTraits: [] }`; `options = { race: [{ definition: { name: "Wood Elf Lineage" } }] }` | contains `"  Elf (Wood Elf) [2014] | Fighter 5 | Level 5"` |

Add to `tests/edition.test.ts`: `expect(CHARACTER_RULES_TOOL_NOTE).toBe(<the Step 5 text>)`.

Add to `tests/party.test.ts`: `vi.mock("../src/game-config.js", () => ({ getSourceIndex: vi.fn(async () => SENTINEL_INDEX) }))`, where `SENTINEL_INDEX` comes from `vi.hoisted`. Change line 58 to `toHaveBeenCalledWith(expect.anything(), "summary", SENTINEL_INDEX)`. Add a test, `fetches the source index once per party`: `getSourceIndex` called once for a 4-member party.

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/character-editions.test.ts tests/party.test.ts`
Expected: FAIL (no `Rules:` line; party called with two args).

- [ ] **Step 5: Implement**

- `spells.ts`: extract the class-spell walk that `buildSpellSections` and `buildConcentrationByLevel` both do into one private helper returning `Array<{ className: string; isSpellbook: boolean; spells: Record<string, unknown>[] }>`. It finds the class by `characterClassId` / `id` / `classId` and takes `cs.spells` else `cs.classSpells`. It does **not** apply the Wizard gate: each caller gates. `buildSpellSections` still pre-seeds duplicate detection from the ungated list, so an unprepared spellbook spell that a feat also grants stays a duplicate warning. Both builders and the new `shownSpellDefinitions` use it. `shownSpellDefinitions` returns the gated class spells, then `spells[key]` for each `SOURCE_LABELS` key in order.
- `editions.ts`: entries in this order:
  1. each class (`kind: "class"`, `level`, `classifyEdition`; decision 11);
  2. each non-null subclass whose ruleset differs from its class's;
  3. the species (`name: fullName || baseName`, skipped when `char.race` is not an object);
  4. the background definition (skipped when null);
  5. every `char.feats` entry except `__INITIAL_ASI` (`hasTag` from `helpers.ts`);
  6. shown spells;
  7. shown items.

  Spells and items are deduped by `id`, else by name. Compute `main` with `characterMainEdition`, then classify the non-class entries with `classifyCharacterEntry(def, index, main)`.
- `core.ts` / `types.ts`: `computeCoreStats(char, index)` sets `editions: computeCharacterEditions(char, index)`.
- `parse.ts`: the third param, defaulting to `peekSourceIndex()`, is passed to `computeCoreStats`.
- `identity.ts`: `Identity` gains `rulesLine: string`. `race` is `deriveRace(char) + editions.tag(char.race)`, with the tag after the lineage suffix. `background` carries its tag. `buildClassLine` renders `${name}${editions.classTag(c)} (${sub.name}${editions.subclassTag(c)}) ${lvl}`. `formatHeaderBlock` prints `  ${i.rulesLine}` right after the name line.
- `character.ts` `parseCharacter`, `party.ts` `getParty` (once, before the batch loop): pass `await getSourceIndex()`.
- `src/edition.ts`: `export const CHARACTER_RULES_TOOL_NOTE = "The 'Rules:' line under the character's name gives the ruleset of the character's classes and lists content from other rulesets; that content is also tagged inline ([2014], [2024], [homebrew], …).";`. Append it to the `ddb_get_character` and `ddb_get_party` descriptions in `src/server.ts`.

- [ ] **Step 6: Run the new tests, then the whole suite**

Run: `npx vitest run tests/character-editions.test.ts tests/party.test.ts && npm test`
Expected: the new tests PASS. Only `tests/character-snapshot.test.ts` fails, on the added `Rules:` lines and the `[2014]` on ARCANE_TRICKSTER_9's background. The `makeChar` tests in `tests/character-parser.test.ts` have no sources, so their headers gain `[edition not stated]` tags. They still pass, as long as the species tag follows the lineage (`"Elf (Wood Elf)"` stays a substring). A reviewer's simulated run of Tasks 1–4 confirmed this. Any other failure is a bug.

- [ ] **Step 7: Update the snapshots and check the diff**

Run: `npx vitest run tests/character-snapshot.test.ts -u && git diff --stat tests/__snapshots__ && git diff tests/__snapshots__`
Expected: each snapshot gains one `  Rules: …` line after the name (`Rules: 2024` for both FIGHTER_5 snapshots, `Rules: 2014` for MONK, `Rules: 2024 · 2014 content: Criminal (background)` for both ARCANE_TRICKSTER_9 snapshots); ARCANE's background line reads `Criminal [2014]`. Nothing else changes.

- [ ] **Step 8: Typecheck, lint, test, commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/tools/character/ src/tools/character.ts src/tools/party.ts src/server.ts src/edition.ts tests/character-editions.test.ts tests/party.test.ts tests/edition.test.ts tests/fixtures/character-fixtures.ts tests/fixtures/character-edition-helpers.ts tests/__snapshots__/character-snapshot.test.ts.snap
git commit -m "feat(character): Rules summary line and header tags on character sheets"
```

---

### Task 3: Inline tags in feats, spells, concentration, inventory and weapons

**Files:**
- Modify: `src/tools/character/features.ts` (`buildFeatLines`), `src/tools/character/spells.ts` (`buildSpellSections`, `buildConcentrationByLevel`), `src/tools/character/inventory.ts` (`computeInventory`), `src/tools/character/weapons.ts` (`computeWeaponAttacks`)
- Modify: `tests/character-parser.test.ts`. Its ad-hoc definitions added to `FIGHTER_5` have no sources, so under the now-2024 main edition they would be tagged `[edition not stated]`. Give each one `sources: [{ sourceId: 145 }]` so the assertions keep their intent and column widths: the crossbow (test ending at line 545, `"Crossbow, Light  +4 to hit"`) and the spells behind lines 1235, 1255, 1259 and 1278 (Fireball, Find Familiar, Speak with Animals). Then grep the file for any other `toContain` on a `Name (L` spell string or a padded weapon name.
- Modify: `tests/__snapshots__/character-snapshot.test.ts.snap` (only if a fixture shows a tagged entry; with Task 2's markers none should change)
- Test: `tests/character-editions.test.ts`

**Interfaces:**
- Consumes: `core.editions.tag(def)` from Task 2.

- [ ] **Step 1: Write the failing tests** in a new `describe("inline tags")`, reusing Task 2's helpers

| Test | Input | Assertions |
|---|---|---|
| `feat lines` | `bgAndFeat()` | contains `"• Sharpshooter [2014]: Long shots."` and `"• Great Weapon Master: On a critical hit or kill, make a bonus attack."` |
| `disguised feats in OTHER FEATURES` | `FIGHTER_5`; push feat `{ definition: { name: "Dark Bargain", categories: [{ tagName: "__DISGUISE_FEAT" }], sources: S(193) } }` | contains `"• Dark Bargain [third-party]"` and `"• Action Surge"` with no tag (sourced 145) |
| `class spells and granted spells` | `ARCANE_TRICKSTER_9`; `classSpells = [{ characterClassId: 3, spells: [{ definition: { id: 911, name: "Fire Bolt", level: 0, sources: S(2) } }, { definition: { id: 912, name: "Shield", level: 1, sources: S(145) } }] }]`; `spells.race = [{ definition: { id: 913, name: "Toll the Dead", level: 0, sources: S(27) } }]` | contains `"  Cantrips: Fire Bolt [2014]"`, `"  Spells: Shield (L1)"`, `"  From Racial Trait: Toll the Dead [2014]"` |
| `duplicate warning keeps the tag` | as above, plus `spells.race` also holding id 911 | contains `"  • Fire Bolt [2014] — already granted by Spells, also in Racial Trait"` |
| `concentration block` | `FIGHTER_5`; `spells.feat = [{ definition: { id: 914, name: "Hex", level: 1, concentration: true, sources: S(2) } }]`; section `"concentration"` | contains `"    • Hex [2014] [1st-level slot]"` |
| `inventory and equipped armour` (Review Focus 1) | `FIGHTER_5`; inventory `item(903, "Bedroll", "Other Gear", { isLegacy: true, sources: S(1, 2) })`, `item(905, "Platinum Ring", "Other Gear", { sources: [] })`, `item(906, "Studded Leather", "Armor", { isLegacy: true, sources: S(1), armorClass: 12 }, true)` | contains `"  Studded Leather [2014] (AC 12)"` and `"  Bedroll [2014], Platinum Ring [edition not stated]"` |
| `weapon line pads the tag with the name` | `FIGHTER_5`; equipped weapon `{ id: 907, name: "Longsword", filterType: "Weapon", isLegacy: true, sources: S(1), categoryId: 2, attackType: 1, damage: { diceString: "1d8" }, damageType: "Slashing", properties: [], grantedModifiers: [] }` | matches `/^• Longsword \[2014\] [+-]\d+ to hit/m` |
| `dual-edition weapon on a 2014 character is untagged` | `MONK_3_HANDAXE` | matches `/^• Handaxe +\+5 to hit/m`; `sheet(c)` does not match `TAG` |

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/character-editions.test.ts -t "inline tags"`
Expected: FAIL (names print without tags).

- [ ] **Step 3: Implement**

Append `core.editions.tag(def)` right after each name: feat lines and disguised-feat lines; cantrip and leveled names (`Name [2014] (L1)`); granted-spell names; duplicate-warning `spellStr`; concentration bucket entries (stored with the tag, deduped on the tagged string); equipped armour (`Name [2014] (AC 12)`); carried-item map keys (so two same-named definitions of different rulesets stay separate); weapon lines, where `(wName + tag).padEnd(16)` replaces `wName.padEnd(16)` and the consolidation key includes the tag. `features.ts` and `spells.ts` currently receive only parts of `core`: pass `editions` down to the builders that need it.

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/character-editions.test.ts && npm test`
Expected: PASS, with no snapshot change, once the `character-parser.test.ts` definitions carry sources: no fixture shows a minority-edition feat, spell, item or weapon. If a snapshot changes, stop and report it; that means a fixture marker is wrong.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/tools/character/ tests/character-editions.test.ts tests/character-parser.test.ts
git commit -m "feat(character): tag minority-edition feats, spells, items and weapons inline"
```

---

### Task 4: `ddb_character_lookup` labels

**Files:**
- Modify: `src/tools/character/definition.ts`, `src/server.ts` (`ddb_character_lookup` description), `src/edition.ts` (`CHARACTER_LOOKUP_TOOL_NOTE`)
- Test: `tests/character-lookup.test.ts` (new)

**Interfaces:**
- Consumes: `computeCharacterEditions(char, index)` and `CharacterEditions.info` (Task 2); `rulesLine`, `editionTag`.
- Produces: `export function formatCharacterLookup(char: Record<string, unknown>, query: string, index: SourceIndex): string` (pure, testable); `getDefinition` becomes fetch, then `await getSourceIndex()`, then `formatCharacterLookup`, then `withNotice`.

- [ ] **Step 1: Write the failing tests** (`INDEX`, `S` and `variant` from `tests/fixtures/character-edition-helpers.ts`; `char = FIXTURE.data`). Also add `expect(CHARACTER_LOOKUP_TOOL_NOTE).toBe(<the Step 3 text>)` to `tests/edition.test.ts`.

```ts
it("a single hit carries the entry's rules line under its title", () => {
  expect(formatCharacterLookup(FIGHTER_5.data, "great weapon", INDEX)).toBe(
    "[Feat]\nGreat Weapon Master\nRules: 2024 · Player's Handbook (2024)\n\nOn a critical hit or kill, make a bonus attack.");
});

it("a dual-edition item shows the character's main edition and its book", () => {
  expect(formatCharacterLookup(MONK_3_HANDAXE.data, "handaxe", INDEX).split("\n").slice(0, 3)).toEqual(
    ["[Item]", "Handaxe (Handaxe, Common)", "Rules: 2014 · Basic Rules (2014)"]);
});

it("a class feature takes its class's ruleset", () => {
  expect(formatCharacterLookup(MONK_3_HANDAXE.data, "martial arts", INDEX).split("\n").slice(0, 3)).toEqual(
    ["[Class Feature]", "Martial Arts (Monk, Level 1)", "Rules: 2014 · Player's Handbook (2014)"]);
});

it("a list of more than three hits tags each line after the name", () => {
  const char = variant(FIGHTER_5, d => { d.spells = { race: [
    { definition: { id: 1, name: "Fire Bolt", level: 0, school: "Evocation", sources: S(2) } },
    { definition: { id: 2, name: "Fireball", level: 3, school: "Evocation", sources: S(145) } },
    { definition: { id: 3, name: "Fire Shield", level: 4, school: "Evocation", isHomebrew: true } },
    { definition: { id: 4, name: "Wall of Fire", level: 4, school: "Evocation", sources: [] } },
  ] }; }).data;
  const out = formatCharacterLookup(char, "fire", INDEX);
  expect(out).toContain("1. [Spell] Fire Bolt [2014] (Cantrip Evocation)");
  expect(out).toContain("2. [Spell] Fireball [2024] (Level 3 Evocation)");
  expect(out).toContain("3. [Spell] Fire Shield [homebrew] (Level 4 Evocation)");
  expect(out).toContain("4. [Spell] Wall of Fire [edition not stated] (Level 4 Evocation)");
});

it("no hit keeps the existing not-found text", () => {
  expect(formatCharacterLookup(FIGHTER_5.data, "zzzz", INDEX)).toMatch(/^No definition found matching "zzzz"/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/character-lookup.test.ts`
Expected: FAIL (`formatCharacterLookup` is not exported).

- [ ] **Step 3: Implement**

`DefinitionHit` gains `name: string` and `info: EditionInfo`. `searchDefinitions(char, query, editions)` sets `info` per decision 6: the spell, feat or item definition; for a class feature, the class definition; for a subclass feature, the subclass definition; for a racial trait, `char.race`; for the background feature, the background definition. A full hit inserts `rulesLine(h.info)` after the first line of `h.text`. A list line renders `${i + 1}. [${h.type}] ${h.name} ${editionTag(h.info)}${firstLine.slice(h.name.length)}`; every `format*Result` first line starts with the name. Add `CHARACTER_LOOKUP_TOOL_NOTE = "Each result carries a 'Rules:' line naming the entry's ruleset; a list of matches tags each line instead."` and append it to the `ddb_character_lookup` description.

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/character-lookup.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/tools/character/definition.ts src/server.ts src/edition.ts tests/character-lookup.test.ts tests/edition.test.ts
git commit -m "feat(character): rules lines and tags in ddb_character_lookup"
```

---

### Task 5: Library labels

**Files:**
- Modify: `src/tools/library.ts`, `src/server.ts` (`ddb_list_library`, `ddb_read_book` descriptions), `src/edition.ts` (`LIBRARY_LIST_TOOL_NOTE`, `READ_BOOK_TOOL_NOTE`), `tests/library-parser.test.ts` (imports the moved helpers)
- Create: `tests/fixtures/library-rsc.ts`
- Test: `tests/library-editions.test.ts` (new)

**Interfaces:**
- Consumes: `classifyEdition`, `normalizeName`, `rulesLine`, `editionTag` (`src/edition.ts`); `getSourceIndex` (`src/game-config.ts`); `stripHtml` (`src/utils.ts`).
- Produces:
  ```ts
  export function librarySourceId(book: { slug: string; title: string | null }, index: SourceIndex): number | null;
  export function libraryBookInfo(book: { slug: string; title: string | null }, index: SourceIndex): EditionInfo; // unstated, book null when no join
  export function tagLibraryBooks(books: readonly LibraryBook[], index: SourceIndex): Array<LibraryBook & { edition: string }>;
  export async function resolveBookSlug(input: string): Promise<{ slug: string; title: string | null }>; // was Promise<string>
  ```

- [ ] **Step 0: Re-check the live library join** (needs `ddb_login`; the owner's account owns no books, so this checks free and shared content only; on 2026-10-22 it joined 8 of 8). In a scratch script under `.claude/phase5/`, call `listLibrary()` and print each book's slug and the source id that decision 7's step (a) joins it to. Then compare the library slugs of the free rules books with their `sourceURL` segments. If a listed book fails step (a) while its title clearly names a known source, stop and report the slug and the `sourceURL` to the owner before Step 3: a slug mismatch would label every slug-only `ddb_read_book` call "edition not stated". Without a session, say so and continue.

- [ ] **Step 1: Write the failing tests** (`INDEX` from `tests/fixtures/character-edition-helpers.ts`)

| Test | Call | Expected |
|---|---|---|
| `joins by the slug's last segment` | `librarySourceId({ slug: "dnd/phb-2024", title: null }, INDEX)` | `145` |
| `a shared slug prefers the source with an edition` (Review Focus 4) | `{ slug: "dnd/basic-rules-2014", title: null }` | `1` |
| `a shared slug with no edition takes the lowest id` | `{ slug: "dnd/ddbd", title: null }` | `272` |
| `falls back to the title on the description` | `{ slug: "dnd/not-a-source", title: "Xanathar's Guide to Everything" }` | `27` |
| `falls back to the title on the book label` | `{ slug: "", title: "Player's Handbook (2024)" }` (145's description is "Player’s Handbook"; only its label matches) | `145` |
| `an empty slug never matches an empty sourceURL` | `{ slug: "", title: null }` (57 snapshot sources, e.g. id 4, have `sourceURL: ""`) | `null` |
| `an empty slug falls through to the title` | `{ slug: "", title: "Player's Handbook (2014)" }` | `2` |
| `a title matching both editions is not guessed` (Review Focus 5) | index `buildSourceIndex([{ id: 1, name: "A", description: "Dragon Book", sourceURL: null, sourceCategoryId: 24 }, { id: 2, name: "B", description: "Dragon Book", sourceURL: null, sourceCategoryId: 26 }], [])`, `{ slug: "", title: "Dragon Book" }` | `null`; `libraryBookInfo` gives `{ ruleset: "unstated", book: null }` |
| `no join` | `{ slug: "dnd/nope", title: "Nope" }` | `null` |
| `tags each listed book` | `tagLibraryBooks([{ title: "Player's Handbook (2024)", slug: "dnd/phb-2024", ownership: "Owned" }, { title: "Xanathar's Guide to Everything", slug: "dnd/xgte", ownership: "Owned" }, { title: "Nope", slug: "dnd/nope", ownership: "Owned" }], INDEX).map(b => b.edition)` | `["[2024]", "[2014]", "[edition not stated]"]` |

Integration tests: `vi.mock("../src/session-fetch.js")` with `hasValidSession: () => true` and a `sessionFetch` `mockImplementation` that builds a fresh `Response` per call (a body reads once), routed by URL: the library URL gets `buildFixture([...])`, any `/sources/` URL gets `"<html><article><p>Text</p></article></html>"`. Also `vi.mock("../src/game-config.js")` with `getSourceIndex: async () => INDEX`. Move `rscChunk` / `buildFixture` out of `tests/library-parser.test.ts` into `tests/fixtures/library-rsc.ts`, and import them in both files.
- `readBook puts a rules line under the title`: `readBook("dnd/phb-2024")` starts with `"# dnd/phb-2024\nRules: 2024 · Player's Handbook (2024)\nURL: https://www.dndbeyond.com/sources/dnd/phb-2024\n\n"`.
- `readBook by title uses the library title as fallback`: the library payload lists `{ name: "Xanathar's Guide to Everything", relativePath: "/sources/not-a-source", isOwned: true }`. `readBook("xanathar")` has `"Rules: 2014 · Xanathar's Guide to Everything"` as its second line.
- `readBook by slug falls back to the library title when the slug doesn't join`: the library payload lists `{ name: "Player's Handbook (2014)", relativePath: "/sources/dnd/old-phb", isOwned: true }`. `readBook("dnd/old-phb")` has `"Rules: 2014 · Player's Handbook (2014)"` as its second line.
- `readBook by slug skips the library when the slug joins`: `readBook("dnd/phb-2024")` makes no request to the library URL. Assert on the `sessionFetch` mock's calls.
- `readBook by slug survives a failed library fetch`: the library URL answers 500. `readBook("dnd/old-phb")` still returns the book, with `"Rules: edition not stated"` as its second line.
- `listLibrary adds an edition to each book`: `JSON.parse(await listLibrary()).books[0].edition === "[2024]"` for a payload listing PHB 2024.

Tool notes:
- In `tests/edition.test.ts`, pin `LIBRARY_LIST_TOOL_NOTE` and `READ_BOOK_TOOL_NOTE` with `toBe`.
- In `tests/rules-edition-consistency.test.ts`, which already has a connected client, add `character and library tools carry their rules notes`. Through `listTools()`, assert that the descriptions of `ddb_get_character` and `ddb_get_party` end with `CHARACTER_RULES_TOOL_NOTE`, `ddb_character_lookup` with `CHARACTER_LOOKUP_TOOL_NOTE`, `ddb_list_library` with `LIBRARY_LIST_TOOL_NOTE`, and `ddb_read_book` with `READ_BOOK_TOOL_NOTE`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/library-editions.test.ts`
Expected: FAIL (the functions are not exported).

- [ ] **Step 3: Implement**

`librarySourceId` follows decision 7. The last segment is the last non-empty `/` part. When the slug has none, skip step (a), and never treat a source without one as a candidate. A source's normalized description is `normalizeName(stripHtml(description ?? ""))`, and its label is `normalizeName(s.book)`. `listLibrary` returns `{ count, books: tagLibraryBooks(books, await getSourceIndex()) }`. `resolveBookSlug` returns `{ slug: input, title: null }` for a slug input, else the matched book's slug and title (look the title up in the same list `matchBookSlug` searched; `matchBookSlug` itself is unchanged). `readBook` prints `rulesLine(libraryBookInfo(resolved, await getSourceIndex()))` between the `# …` line and `URL:`. When `resolved.title` is null and `librarySourceId` returns null, first look the slug up in the library list (the same parse `listLibrary` uses, inside a `try` that treats any failure as "no title") and retry with that title (decision 7). Notes for the descriptions: `LIBRARY_LIST_TOOL_NOTE = "Each book carries an edition tag ([2024], [2014], …)."`, `READ_BOOK_TOOL_NOTE = "A 'Rules:' line under the title names the book's ruleset."`.

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/library-editions.test.ts tests/library-parser.test.ts tests/library-resolver.test.ts && npm test`
Expected: PASS (the existing parser and resolver tests are unchanged).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/tools/library.ts src/server.ts src/edition.ts tests/library-editions.test.ts tests/library-parser.test.ts tests/fixtures/library-rsc.ts tests/edition.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(library): edition tags on listed books and a rules line when reading"
```

---

### Task 6: Owner review, live check, and docs

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-10-16-rules-edition-design.md`, `README.md` (Character Tools and Library rows), `docs/character-refactor.md` (`computeCoreStats(char)` → `computeCoreStats(char, index)` and the new `editions.ts` in its file structure), this plan (outcome line)

- [ ] **Step 1: Live "after" dump and diff** (needs `ddb_login`)

Run: `npx tsx scripts/snapshot-live-characters.mts > .claude/phase5/after.txt; diff .claude/phase5/before.txt .claude/phase5/after.txt > .claude/phase5/live.diff`
Expected: the only differences are one `  Rules: …` line per character and inline tags. On the 2014 characters, no `[2024]` appears on standard weapons or armour (Dagger, Leather, Shield). Calderax's line names Grave Domain (XGtE) and Noble and counts spells and items.

- [ ] **Step 2: Owner review gate**

Show the owner `git diff $(cat .claude/phase5/base)..HEAD -- tests/__snapshots__/` and `.claude/phase5/live.diff`, and wait for approval. Requested changes land as fix commits, re-run through Steps 1–2. Do not push before approval.

- [ ] **Step 3: Docs**

- `CLAUDE.md`:
  - Key modules: add `src/tools/character/editions.ts`.
  - Mention the `index` param in the `character/parse.ts` and `character.ts` rows.
  - Add a "Rules edition" bullet under parseCharacterData notes: decisions 1–5, 9.
  - Tool notes for `ddb_get_character`, `ddb_character_lookup`, `ddb_get_party`, `ddb_list_library` and `ddb_read_book`.
  - Next steps: phase 5 done with its commit range; carry-over (c) closed (decision 10); stateless plan Task 2 is unblocked; "Last updated" line.
- Spec: status line (phase 5 implemented, commits). Add "Rulings in the plan" under "Characters — phase 5" and "Library — phase 5": decisions 1–13 with the owner-decision dates. Remove the "highest level wins" sentence (decision 13) and note the push-gated snapshot review (decision 12). Rewrite the spec's `characterRulesLine` grammar bullets with the counts (decision 2) and with the grouped form under an unstated head (`Rules: edition not stated · 2024 content: … · homebrew: Blood Hunter 5 (class)`). Spell out the library join (decision 7): the shared-slug rule, the empty-segment rule, and that the title also matches a source's book label (`Player's Handbook (2024)`), which goes beyond the spec's "description".
- `docs/character-refactor.md`: update the `computeCoreStats` signature and add `editions.ts` to the file structure.
- `README.md`: the `ddb_get_character`, `ddb_character_lookup`, `ddb_get_party`, `ddb_list_library` and `ddb_read_book` rows mention the `Rules:` line or tags.
- This plan: add an `**Outcome (date):**` line under the title.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add CLAUDE.md README.md docs/character-refactor.md docs/superpowers/specs/2026-10-16-rules-edition-design.md docs/superpowers/plans/2026-10-22-rules-edition-phase-5-characters-library.md
git commit -m "docs: rules-edition phase 5 done — characters and library"
```

Paste three characters' `Rules:` lines from `.claude/phase5/after.txt` into the commit body (spec, Testing → live checks): one 2014 character, Calderax, and Clover.
