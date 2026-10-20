# Rules Edition Phase 3 (Equipment and Character Options) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Outcome (2026-10-20): implemented** on `main` in `6095618..eeba441` (docs `efb82e9`, `15094ba`). The plan body below is the plan as written, not the final behaviour: the final review (F1–F8, commits `88fde6d..d4d3af3`) and the carry-over round (C1–C5, commits `cc92938..9158d0f`) changed it afterwards — filtered-out picks counted as hidden (monsters too), book-note alternatives filtered, no book notes in `ddb_search_site`, requested edition first for class features and racial traits, equal names ordered by tiebreak, the monster hidden-only reply, and one in-flight game-config fetch. Those rulings are in the [spec's phase-3 section](../specs/2026-10-16-rules-edition-design.md#equipment-and-character-options-srctoolsreferencets--phase-3) ("Rulings after the plan") and CLAUDE.md's tool notes; open follow-ups are CLAUDE.md work item 1's carry-overs.

**Goal:** Equipment, species, classes, backgrounds, feats, class features, racial traits and `ddb_search_site` return 2024 by default and 2014 on request, label every entry's ruleset, and name the book whenever one edition has more than one version. Those tools and the spell tools also take a `source` book filter, so a caller can pick which book's version they want.

**Architecture:** Phase 1's pure `src/edition.ts` keeps all classification, selection and label text. It gains a Legacy-last tiebreak, the same-edition `alternatives` of a selection, a class-owner twin key, and two book-choice labels. Monster `source` resolution moves out of `monster.ts` into a new pure `src/source-filter.ts`, so every tool shares it. A new `src/tools/edition-search.ts` holds the search/lookup pipeline every catalog uses: `selectCatalog` (flat mode, and a nested mode that picks the edition per base race or per owning class/subclass/species), `lookupCatalog` and the `SearchSection` shape. Spells move onto it first, which proves it against phase 2's tests. Then items, the four game-data lists, class features and racial traits follow. `ddb_search_site` renders each category's `SearchSection` body under one header and one combined footer.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), `@modelcontextprotocol/sdk` 1.32, zod, vitest.

**Spec:** [docs/superpowers/specs/2026-10-16-rules-edition-design.md](../specs/2026-10-16-rules-edition-design.md). Read Principle, Vocabulary and labels, The edition module, Tool contract, "Equipment and character options", and Phase 3. The real signatures are in `src/edition.ts`, not the spec's sketch. **The owner decisions below change the spec. Task 1 writes them into it. Until then, where they differ, this plan wins.**

## Owner decisions (2026-10-19)

1. **Same-edition duplicates: non-Legacy first, and always say which book.** When one twin group has several entries of the chosen edition (a book owner's 2014 "Goblin" species from Volo's, marked Legacy, and from Monsters of the Multiverse), the tiebreak is: official → non-Legacy → lowest id. The pick's search line names its book and the books of the set-aside versions. A single lookup adds an "also in" line. Owner: "the user or agent should be informed about the rules or book that were chosen and they should be able to specify which book or rules they want in their request".
2. **`source` on every phase-3 tool and on the spell tools.** This changes the spec's non-goal "No `source` (book) filter on tools other than monsters". `ddb_search_site`, encounter, treasure, conditions and rules still take no `source`. It works like the monster `source`: it is resolved through the source index (slug → short name → title, every matching id); it wins over `rules_edition`; no twins are hidden; every entry in the book is listed with its tag; the header is `searchHeader({ sourceBook })`; and `sourceNote` is added when the book's edition differs from `rules_edition`.
3. **`ddb_search_classes` drops its dead "Subclasses:" line** (CLAUDE.md work item 6, closed as removed), and the tool description drops "and subclasses". Subclass names stay reachable through `ddb_search_class_features class_name`.

## Owner decisions (2026-10-20, after the pre-flight review)

The pre-flight review (Opus and DeepSeek, 2026-10-20) found that live D&D Beyond names repeated class features with a level prefix (`6: Ability Score Improvement`, `4: Weapon Mastery`; 50 live entries), and that pairing features one by one lists every 2014 feature the 2024 class dropped (default `class_name: "ranger"` would add Natural Explorer, Primeval Awareness, Vanish … tagged `[2014]`). The owner decided:

4. **Class features and racial traits choose the edition per owner, not per feature.** The owner is the class (base and optional features), the class + subclass (subclass features), or the species (racial traits). Under the 2024 default, when the Fighter has a 2024 version, only the 2024 Fighter's features are listed, and the 2014 Fighter's matching features are hidden and counted. An owner with no version in the requested edition (a Xanathar's subclass, a 2014 subrace asked for by name) is listed with its own tag. Third-party, homebrew and unstated owners are never hidden. This replaces the plan's per-feature twin key (class/subclass/feature + occurrence), which is dropped.
5. **Filter first, then pick the owner.** The edition is chosen among the owners that have a matching feature. `name: "natural explorer"` lists `Natural Explorer [2014]` (the only version of what was asked, like a 2014-only spell); browsing a class shows only the 2024 class whenever both editions have matches.
6. **Book-choice note on every line** of a duplicated owner's features or traits (owner decision 1 applied to owners): `- **Fury of the Small** [2014] · <MotM label> (also in <VGtM label> — pass source to choose) …`.
7. **Species are edition-grouped by base race.** The 2024 Elf replaces the 2014 High Elf, Wood Elf and Eladrin (Variant) under the default, in both `ddb_search_races` and `ddb_search_racial_traits`. With `rules_edition: "2014"` each 2014 subrace is listed (book duplicates still collapse to one). Naming the subrace (`"high elf"`) finds it under either edition, because filtering comes first. Mixed setups (a 2024 Bard who is a 2014 High Elf) are served by naming the species, per-call `rules_edition`, or `source`.
8. **Subclasses renamed in 2024 get verified rename pairs in Task 5**: Draconic Bloodline → Draconic Sorcery, The Fiend → Fiend Patron, School of Evocation → Evoker, Way of the Open Hand → Warrior of the Open Hand, each added only after reading both live descriptions. Renames visible only to book owners (e.g. Path of the Totem Warrior → Path of the Wild Heart) stay a carry-over.
9. **Every catalog search calls `getSourceIndex()`** (cached per session), not only searches given a `source`: classifying an entry needs the index.
10. **`ddb_search_site` "all" prints the combined search header only when at least one included section came from D&D Beyond** (has a non-null `header`). An all-Open5e reply keeps each section's own `Rules:` line, as today.

## Decisions this plan makes (flag in review if wrong)

- **Racial traits classify from the race's sources** (the spec's open phase-3 decision). That is what `buildRacialTraits` already stores. Optional traits keep their own. Reason: the species is the owner and decides the edition (owner decision 4); a trait's own `sources` only name the book that printed its text, and under a 2024 species they can name a 2014 book even though the trait is valid 2024 content (the Studded Leather reprint policy).
- **Class features and racial traits select by owner** (owner decisions 4–7). Owner twin keys: `classOwnerTwinKey(className, subclassName)` is `class` or `class/subclass`; a species' twin key is `twinName(fullName)` and its edition group `twinName(baseRaceName || baseName || fullName)` (racial-trait entries carry only `baseRaceName` and `speciesName`, so their group is `twinName(baseRaceName || speciesName)`; live, every race has `baseRaceName`). Same-named features of different owners (2014 Cleric "Bonus Proficiency" in Life and in Tempest) never merge, because they belong to different owners, and repeated or level-prefixed names within one owner (`Ability Score Improvement`, `6: Ability Score Improvement`) need no key at all: every matching feature of the chosen owner is listed.
- **The shared rename table stays shared.** Its monster pairs whose 2014 side is a species name (Goblin, Bugbear, Hobgoblin, Kobold, Centaur, Minotaur, Merfolk, Gnoll, Sahuagin) and the Acolyte pair only change the twin *key*. Both editions of a species map the same way, so grouping is unaffected, and searches match on the entry's own name. No phase-3 tool does a name lookup that could print a false rename line. The one get, `ddb_get_equipment`, has no item named after a monster or background pair. Task 5 adds four subclass pairs to it; one, School of Evocation → Evoker, shares its 2024 side with a 2014 NPC monster named "Evoker", so monster lookups for "Evoker" also query "School of Evocation" (one extra monster-service request, no output change). Splitting the table per content kind stays an open carry-over.
- **The item cache key stays `"item-compendium"`.** It already stores the raw payload, which carries `isLegacy`/`sources`/`isHomebrew`; only the TypeScript interface was narrower.

## Global Constraints

- The param is exactly `rules_edition: z.enum(["2024", "2014"]).default("2024")` (the existing `RULES_EDITION_PARAM` in `src/server.ts`). Internally it is `rulesEdition: RulesEdition`.
- Every tool given the param appends `RULES_EDITION_TOOL_NOTE` to its description.
- No tool builds edition text. Every `Rules:` line, tag, header, footer, reason, rename line, source note and book-choice note comes from `src/edition.ts`, with an exact-string test in `tests/edition.test.ts`. Error, not-found and unknown-source messages are not edition text and carry no label.
- Every search with results from D&D Beyond starts with its search header (no-match replies, Open5e fallbacks, and the all-empty or all-Open5e `ddb_search_site` reply keep today's text, with no header). Then any note (source note, partial-build note), then the tool's existing heading, e.g. `**Race Search** (N found)`. The tag goes immediately after the bolded name: `- **Fighter** [2024] — Hit Die: d10`.
- Header totals and the footer count the result after hiding, across the whole result, not just the page shown.
- Homebrew output stays wrapped in `wrapUntrusted` wherever it is today (class-feature and racial-trait lines).
- No new endpoints. Every catalog search calls `getSourceIndex()` (cached per session; owner decision 9). No other new requests.
- No new dependencies. `@types/node` stays `^22`.
- Every task ends green on `npm run typecheck && npm run lint && npm test`.
- Commits go straight to `main`. Stage files by name, never `git add -A` / `git add .`. The working tree holds owner WIP that must not be committed: `docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md` (untracked), `docs/superpowers/plans/2026-09-16-security-remediation.md` (deleted), and `docs/superpowers/plans/2026-10-16-rules-edition-phase-1-foundation.md` (edited). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Owner selection for class features and species.** Cases:
   - across subclasses of one class: 2014 Cleric "Bonus Proficiency" in Life Domain and in Tempest Domain — both listed (different owners);
   - repeated and level-prefixed within one class: the shared fixture's 2014 Fighter has 7 `Ability Score Improvement` entries; the 2024 Fighter has `Ability Score Improvement` plus `6: …`, `8: …`, `12: …`, `14: …`, `16: …` (6). Default: the six 2024 lines and `7 2014 versions hidden — rules_edition: "2014" shows them.`; `level: 6` finds the 2024 level-6 ASI;
   - a feature only the 2014 owner has (filter first): listed `[2014]`, no footer;
   - species by base race: 2024 Elf hides 2014 High Elf / Wood Elf by default; `"high elf"` finds High Elf `[2014]`.
   Tests in Tasks 2, 4 and 5.
2. **A species whose name is a monster rename's 2014 side** ("Goblin" → twin key `goblin warrior`). Expected: `searchRaces({ name: "goblin" })` lists it, `searchRacialTraits({ raceName: "goblin" })` lists its traits, and neither shows a rename line. Test in Task 4.
3. **A `source` slug shared by several sources, and a reprint.** Studded Leather's sources are `[148 br-2024, 1 BR]` and `isLegacy: false`. Expected: `source: "basic-rules-2014"` lists it tagged `[2024]`, because the filter matches any of the entry's sources while the tag classifies the entry. The header names the lowest-id book, and a `sourceNote` follows because BR is a 2014 book and `rules_edition` defaulted to 2024. Test in Task 3.
4. **Equipment search when D&D Beyond can't be reached** (logged out, or a 5xx). Today `searchItems` throws, so the tool returns an error. Expected: the labelled Open5e fallback, like every other search, plus the source caveat when a `source` was given. Test in Task 3.
5. **Entries with no usable sources.** Live there is `COPY_OF_Tiefling`, homebrew with no sources. Expected: `[homebrew]`. An official entry with no sources is tagged `[edition not stated]`, is listed under both `rules_edition` values, and is never counted as hidden. Test in Task 4.
6. **A name that matches only the other edition's twin.** `searchItems({ name: "handy haversack" })` under 2024. Expected: lists `Heward's Handy Haversack [2024]`, and the footer counts 1 hidden. Test in Task 3.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/edition.ts` | Modify (T1) | Legacy-last `definitionTiebreak`, `alternatives` on selections, `classOwnerTwinKey` (replaces `classFeatureTwinKey`; `racialTraitTwinKey` deleted), `editionSourceId`, `bookChoiceNote`, `alsoInLine` |
| `src/edition-renames.ts` | Modify (T5) | Four verified subclass rename pairs |
| `src/source-filter.ts` | Create (T1) | Pure source resolution moved from `monster.ts`, plus `resolveSource`, `entrySourceIds`, `inSources`, `withSourceCaveat` |
| `src/tools/monster.ts` | Modify (T1, T6) | Imports the moved helpers (T1). `searchMonstersSection` (T6) |
| `src/tools/edition-search.ts` | Create (T2) | `SearchSection`, `renderSection`, `plainSection`, `paginateResults` (moved from `reference.ts`), `selectCatalog`, `lookupCatalog` |
| `src/tools/reference.ts` | Modify (T2–T5) | Spells (T2), items (T3), races/classes/backgrounds/feats (T4), class features/racial traits (T5) on the catalog pipeline. Each search gets a `…Section` twin |
| `src/tools/features-traits.ts` | Modify (T5) | Owner fields on entries, exported filters/comparators, line formatters taking a label |
| `src/tools/search.ts` | Modify (T4, T6) | Params-object calls (T4); `rulesEdition` threading and the embedded mode (T6) |
| `src/server.ts` | Modify (T2–T6) | `rules_edition` and `source` params, descriptions |
| `tests/edition.test.ts` | Modify (T1) | New behaviour and exact strings |
| `tests/source-filter.test.ts` | Create (T1) | Resolution and filtering |
| `tests/edition-search.test.ts` | Create (T2) | Pure pipeline tests |
| `tests/spell-editions.test.ts` | Modify (T2) | Spell `source` and book choice |
| `tests/equipment-editions.test.ts` | Create (T3) | Items |
| `tests/options-editions.test.ts` | Create (T4) | Races, classes, backgrounds, feats |
| `tests/features-traits.test.ts`, `tests/class-features-racial-traits.test.ts` | Modify (T4, T5) | New line format, selection; characterization strings regenerated |
| `tests/search-site.test.ts` | Create (T6) | One header, combined footer |
| `tests/rules-edition-consistency.test.ts` | Modify (T3–T6) | Fixtures for every new tool, Open5e fixtures that filter by query |
| spec, `CLAUDE.md`, `README.md` | Modify (T1, T7) | Owner decisions (T1); architecture notes, Next steps, tool notes (T7) |

---

### Task 1: Edition additions and the shared source filter

**Files:**
- Modify: `src/edition.ts`, `src/tools/monster.ts` (delete the moved helpers, import them), `docs/superpowers/specs/2026-10-16-rules-edition-design.md`
- Create: `src/source-filter.ts`, `tests/source-filter.test.ts`
- Test: `tests/edition.test.ts`

**Interfaces:**
- Produces (`src/edition.ts`):
  - `interface TiebreakFields { id: number; isHomebrew?: boolean | null; isLegacy?: boolean | null }`. `definitionTiebreak` orders official → non-Legacy (`isLegacy !== true`) → lowest id. `monsterTiebreak` is unchanged.
  - `interface Selection<T> { entry: T; reason?: SelectionReason; alternatives?: T[] }`. `selectByEdition` sets `alternatives` only when the pick's ruleset is `2024`/`2014` and the group has other entries of that same ruleset. They are those entries in tiebreak order, regardless of `available`. The property is absent when there are none. `LookupResult` and `SearchSelection` inherit it.
  - `classOwnerTwinKey(className: string, subclassName?: string | null, namer = twinName): string` returns `namer(className)`, or `` `${namer(className)}/${namer(subclassName)}` `` when `subclassName` is non-empty. It replaces `classFeatureTwinKey`. Delete `classFeatureTwinKey` and `racialTraitTwinKey` (owner decision 4: features select by owner; a species owner keys on `twinName` of its name directly). Only `tests/edition.test.ts` uses them today.
  - `editionSourceId(entry: EditionMarkers, index: SourceIndex): number | null` returns the source id whose book `classifyEdition` reports (null exactly when its `book` is null). Refactor `classifyEdition` onto one private helper so the two can never disagree.
  - `bookChoiceNote(chosen: string, others: readonly string[]): string` → `· ${chosen} (also in ${others.join(", ")} — pass source to choose)`
  - `alsoInLine(others: readonly string[]): string` → `(also in ${others.join(", ")} — pass source to choose)`
- Produces (`src/source-filter.ts`, pure, imports only `edition.ts` and `utils.ts`):
  - Moved verbatim from `monster.ts`: `normalizeSourceQuery`, `sourceSlug`, `resolveSourceIds`, `sourceLabel`, `suggestSources`.
  - `unknownSourceError(index: SourceIndex, source: string, hint?: string): string`. Without `hint`, the wording is today's, including the monster sentence. With `hint`, that sentence is replaced by `hint`.
  - `interface ResolvedSource { query: string; ids: number[]; book: string }`, where `book` is `index.sources.get(Math.min(...ids))!.book`. That is the plain title with no `[slug]`, which is what the monster search header uses today.
  - `resolveSource(index: SourceIndex, query: string): ResolvedSource | null`.
  - `entrySourceIds(entry: EditionMarkers): number[]` returns `sourceId` (when numeric) plus every `sources[].sourceId`, deduped.
  - `inSources(entry: EditionMarkers, ids: readonly number[]): boolean`.
  - `withSourceCaveat(text: string, source: string | undefined): string`, moved verbatim from `monster.ts`.
  - `GENERIC_SOURCE_HINT = "Pass a book's short code or title, e.g. phb-2024, xgte or \"Player's Handbook\"."`

- [ ] **Step 1: Write the failing tests** in `tests/edition.test.ts`. Use the file's `INDEX`, `e()` helper and source ids. Add `isLegacy?: boolean` to the `E` type (line 284) and to `e()`'s options.

```ts
it("definitions: official → non-Legacy → lowest id", () => {
  const sorted = [e(9, "X", "2014", { isHomebrew: true }), e(3, "X", "2014", { isLegacy: true }), e(7, "X", "2014")].sort(definitionTiebreak);
  expect(sorted.map(x => x.id)).toEqual([7, 3, 9]);
});
it("selectByEdition reports same-edition alternatives in tiebreak order", () => {
  const pick = selectByEdition([e(3, "Goblin", "2014", { isLegacy: true }), e(7, "Goblin", "2014"), e(5, "Goblin", "2014")], "2024", infoOf, definitionTiebreak);
  expect(pick?.entry.id).toBe(5);
  expect(pick?.alternatives?.map(x => x.id)).toEqual([7, 3]);
  expect(pick?.reason).toBe("no-2024-version");
  expect(selectByEdition([e(1, "A", "2024"), e(2, "A", "2014")], "2024", infoOf, definitionTiebreak)).toEqual({ entry: expect.objectContaining({ id: 1 }) });
  expect("alternatives" in selectByEdition([e(1, "H", "homebrew", { isHomebrew: true }), e(2, "H", "homebrew", { isHomebrew: true })], "2024", infoOf, definitionTiebreak)!).toBe(false);
});
it("class-feature owners twin by class, and by class and subclass", () => {
  expect(classOwnerTwinKey("Cleric", "Life Domain", twin)).toBe("cleric/life domain");
  expect(classOwnerTwinKey("Cleric", null, twin)).toBe("cleric");
  expect(classOwnerTwinKey(" fighter", undefined, twin)).toBe("fighter");
  expect(classOwnerTwinKey("Paladin", null, twin)).not.toBe(classOwnerTwinKey("Fighter", null, twin));
});
it("editionSourceId names the source classifyEdition took its book from", () => {
  expect(editionSourceId({ sources: from(148, 1) }, INDEX)).toBe(148);
  expect(editionSourceId({ isLegacy: true, sources: from(145, 2) }, INDEX)).toBe(2);
  expect(editionSourceId({ sources: from(999) }, INDEX)).toBeNull();
});
it("book-choice labels", () => {
  expect(bookChoiceNote("Monsters of the Multiverse [motm]", ["Volo's Guide to Monsters [vgtm]"]))
    .toBe("· Monsters of the Multiverse [motm] (also in Volo's Guide to Monsters [vgtm] — pass source to choose)");
  expect(alsoInLine(["A [a]", "B [b]"])).toBe("(also in A [a], B [b] — pass source to choose)");
});
```

`twin` is not file-scoped: it is declared inside individual `describe` blocks (about lines 209, 230, 356, 444). Put the `classOwnerTwinKey` test in the `describe` that holds the existing `classFeatureTwinKey` / `racialTraitTwinKey` assertions (about lines 218–225) and delete those assertions, along with the two names from the import on line 4.

Adding `alternatives` changes existing `toEqual` results in `describe("selectByEdition with an availability predicate")` (about lines 780–810). Update each to the value the new rule yields — `alternatives` lists the other entries of the pick's own ruleset in tiebreak order, regardless of `available`: line ~789 `{ entry: B24, alternatives: [A24] }`, ~790 `{ entry: B14, alternatives: [A14] }`, ~794 `{ entry: B14, reason: "locked-2024", alternatives: [A14] }`, ~795 `{ entry: B24, reason: "locked-2014", alternatives: [A24] }`, ~804 `{ entry: B14, reason: "no-2024-version", alternatives: [A14] }`, ~805 `{ entry: A14, reason: "no-2024-version", alternatives: [B14] }`. Check the whole file for any other `toEqual` on a selection whose group holds two entries of the pick's ruleset, and update those the same way. No assertion may be loosened to `objectContaining` to dodge the change.

The Legacy-last tiebreak also changes phase-2 spell picks and `isConcentrationSpell` precedence 3 (`reference.ts:482`) when a twin group mixes Legacy and non-Legacy entries of one edition — intended by owner decision 1. The definitions test above covers it; no spell test may change.

In `tests/source-filter.test.ts`, build an index with `buildSourceIndex` that has three sources sharing the slug `basic-rules-2014` (ids 1, 30, 31) and a `phb-2024` (145):
- `resolveSource(index, "basic-rules-2014")` → `{ ids: [1, 30, 31], book: <id 1's book> }`; `resolveSource(index, "PHB-2024")` → ids `[145]` (case-insensitive slug); `resolveSource(index, "Player's Handbook")` → 145 via title; `resolveSource(index, "nope")` → `null`.
- `inSources({ sources: [{ sourceId: 148 }, { sourceId: 1 }] }, [1])` → true. `inSources({ sourceId: 5 }, [1])` → false. `entrySourceIds({ sourceId: 5, sources: [{ sourceId: 5 }, { sourceId: 7 }] })` → `[5, 7]`.
- `unknownSourceError(index, "zzz")` still contains `ddb_search_monsters results`. `unknownSourceError(index, "zzz", GENERIC_SOURCE_HINT)` ends with `GENERIC_SOURCE_HINT` and does not mention monsters.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/edition.test.ts tests/source-filter.test.ts`
Expected: FAIL. The new exports don't exist, and the tiebreak test orders `[3, 7, 9]`.

- [ ] **Step 3: Implement** the `edition.ts` changes and `src/source-filter.ts` per the Interfaces block. Then switch `monster.ts` to import the moved helpers and delete its copies. Monster behaviour and wording must not change.

- [ ] **Step 4: Write the owner decisions into the spec.** Status line: "Phase 3 planned 2026-10-19 with owner decisions on book choice and `source`". Non-goals: replace the first bullet with "No `source` filter on `ddb_search_site`, encounter, treasure, conditions or rules". Selection → Tiebreak, "Every other type": "official before homebrew, then non-Legacy before Legacy, then lowest definition `id`". Add the book-choice labels to Label formats. Twin keys table: class features and racial traits no longer twin per feature; they select by owner — `class` (base and optional features) or `class/subclass` (subclass features) via `classOwnerTwinKey`, and species by `twinName(fullName)` within an edition group of `twinName(baseRaceName || baseName || fullName)`; species (races search) use the same two keys. Equipment and character options: close the open trait decision ("from the race's sources", one sentence of reasoning), add a "Book choice and `source`" bullet that restates owner decisions 1 and 2, and add an "Owner selection" bullet that restates owner decisions 4–7 (owner per class/subclass/species, filter first, book note per line, species grouped by base race, mixed setups). Add owner decision 9 to the Tool contract and decision 10 to the `ddb_search_site` text.

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. The monster tests pass unchanged, because the source helpers moved without any change in wording.

- [ ] **Step 6: Commit**

```bash
git add src/edition.ts src/source-filter.ts src/tools/monster.ts tests/edition.test.ts tests/source-filter.test.ts docs/superpowers/specs/2026-10-16-rules-edition-design.md docs/superpowers/plans/2026-10-19-rules-edition-phase-3-equipment-options.md
git commit -m "feat(edition): Legacy-last tiebreak, same-edition alternatives, book-choice labels, class owner twin key; shared source filter"
```

---

### Task 2: The catalog pipeline, proven on spells (with `source`)

**Files:**
- Create: `src/tools/edition-search.ts`, `tests/edition-search.test.ts`
- Modify: `src/tools/reference.ts` (spells; move `paginateResults` out), `src/server.ts` (`ddb_search_spells`, `ddb_get_spell` gain `source`)
- Test: `tests/spell-editions.test.ts`

**Interfaces:**
- Consumes: Task 1's `alternatives`, `editionSourceId`, `bookChoiceNote`, `alsoInLine`, `ResolvedSource`, `inSources`, `sourceLabel`.
- Produces (`src/tools/edition-search.ts`):

```ts
export interface SearchSection { header: string | null; body: string; footer: string | null; hidden: number }
export function renderSection(s: SearchSection): string;           // non-null parts joined with "\n"
export function plainSection(text: string): SearchSection;          // { header: null, body: text, footer: null, hidden: 0 }
export function paginateResults<T>(label: string, items: T[], format: (item: T) => string, limit?: number, offset?: number, note?: string): string; // moved; `note` goes right after the heading line, as the spell provenance note does today

export interface CatalogOwner { id: string; markers: EditionMarkers; tiebreak: TiebreakFields }
export interface CatalogAdapter<T> {
  markers: (t: T) => EditionMarkers;   // the entry's own classification: its tag and the source filter
  twinKey: (t: T) => string;           // versions of one thing (with `owner`: the owner's twin key)
  tiebreak: (a: T, b: T) => number;
  compare: (a: T, b: T) => number;     // display order of the result
  nameMatches?: (t: T) => boolean;     // flat mode: per twin group; nested mode: see below
  passes?: (t: T) => boolean;          // flat mode: per selected entry; nested mode: per entry
  groupKey?: (t: T) => string;         // nested mode: one edition is chosen per group (default twinKey)
  owner?: (t: T) => CatalogOwner;      // nested mode: entries sharing an owner id are picked together
}
export interface CatalogHit<T> { entry: T; info: EditionInfo; label: string }
export interface CatalogSelection<T> { hits: CatalogHit<T>[]; hidden: number; header: string; note: string | null }
export function selectCatalog<T>(all: readonly T[], requested: RulesEdition, adapter: CatalogAdapter<T>, index: SourceIndex, source?: ResolvedSource): CatalogSelection<T>;
export function lookupCatalog<T>(all: readonly T[], query: string, requested: RulesEdition, adapter: CatalogAdapter<T> & { name: (t: T) => string }, index: SourceIndex, source?: ResolvedSource): { entry: T; info: EditionInfo; rulesLines: string[] } | null;
```

Semantics:
- **Book note (both modes).** For a picked unit with `alternatives` whose `editionSourceId` is non-null: `pickLabel = sourceLabel(index, editionSourceId(m(pick), index))`, and `others` = the distinct `sourceLabel(index, editionSourceId(m(alt), index))` values (skipping null ids) that differ from `pickLabel`, where `m` is `adapter.markers` for an entry and `owner(t).markers` for an owner. If any remain, the label gets `" " + bookChoiceNote(pickLabel, others)`. A pick with no known source gets no note.
- **`selectCatalog` without `source`, flat mode** (no `groupKey`, no `owner`; spells, items, classes, backgrounds, feats): `groupAndSelect` with the adapter (its semantics unchanged, so phase-2 spell output is byte-identical wherever no same-edition alternative from a different book exists; where one does, the line gains the book note — owner decision 1), then sort the hits by `compare`. A hit's `label` is `editionTag(info)` plus the book note. `header = searchHeader({ requested })`, `note = null`.
- **`selectCatalog` without `source`, nested mode** (`groupKey` and/or `owner` given; races use `groupKey`, class features and racial traits use both). Owner decisions 4–7. Filter first, then pick:
  1. *Filter.* With `owner`: keep the entries that pass `nameMatches` and `passes`, each per entry (feature names are the entry's own). Without `owner`: a twin group (by `twinKey`) matches when any of its entries matches `nameMatches`, as flat mode does (rename-aware); keep the entries of matching twin groups that pass `passes`.
  2. *Units.* Built from the entries kept in step 1 only: an owner or entry with nothing kept is not a unit. With `owner`, one unit per distinct `owner(t).id`, holding its kept entries; its ruleset is `classifyEdition(owner.markers, index).ruleset` and its order is `definitionTiebreak` on `owner.tiebreak`. Without `owner`, each kept entry is a unit, classified by `markers` and ordered by `tiebreak`. The adapter guarantees that one owner's entries share `twinKey` and `groupKey`.
  3. *Per edition group* (`groupKey`, default `twinKey`): units whose ruleset is not an edition are listed as they are. Among edition units, the chosen edition is `requested` when any unit has it, else the other edition. Sub-group the chosen edition's units by `twinKey`; in each sub-group the first unit in order is picked and the rest are its `alternatives`.
  4. *Lines:* every kept entry of every picked (or non-edition) unit. Each line's label is `editionTag(classifyEdition(markers(entry), index))` — the entry's own classification (an optional feature keeps its own sources) — plus the unit's book note.
  5. *`hidden`:* when the chosen edition is `requested` and the group has other-edition units, add the number of lines the other edition would list: per other-edition `twinKey` sub-group, the kept entries of its first unit in order. That is the "N versions hidden" count: lines, not groups.
  6. Sort the hits by `compare`. `header = searchHeader({ requested })`, `note = null`.
- **`selectCatalog` with `source` (both modes):** no grouping and no hiding. The candidates are entries with `inSources(markers(entry), source.ids)`, then `nameMatches` and `passes` per entry, sorted by `compare`. Each label is just `editionTag(info)`, and `hidden = 0`. `header = searchHeader({ sourceBook: source.book })`. `note = sourceNote(source.query, bookRuleset, requested)`, where `bookRuleset` is `classifyEdition({ sources: ids.map(sourceId => ({ sourceId })) }, index).ruleset`, and only when that ruleset is an edition. A caller puts a non-null `note` as the **first line of the section body, before the `**X Search**` heading**, as `searchMonsters` does (`monster.ts:707`).
- **`lookupCatalog`:** `lookupByName` over `all`, or over the in-book subset when `source` is given. Returns null when it finds nothing. `rulesLines` holds one line per element, so the reason that `rulesLine` embeds after a `\n` is split into its own element. In order:
  - `...rulesLine(info, { reason }).split("\n")`, where the reason is omitted under `source`;
  - `renameLine(…)` when `renamed`;
  - under `source`, `sourceNote(source.query, info.ruleset, requested)` when `isEdition(info.ruleset)` (`sourceNote` takes a `RulesEdition`), using the **shown entry's** ruleset, as `getMonster` does (`monster.ts:852`). Studded Leather looked up with `source: "basic-rules-2014"` is 2024 text, so no "rules_edition was ignored" note is added. Searches use the book's ruleset, because they list a whole book;
  - without `source`, `alsoInLine(others)` with the same `others` rule as the book note.

Spells on it:
- Add `searchSpellsSection(params): Promise<SearchSection>`. `searchSpells(params)` becomes `renderSection(await searchSpellsSection(params))`. Params gain `source?: string`.
- The spell adapter:
  - `markers = s => s.definition`;
  - `twinKey = s => twinName(s.definition.name)`;
  - `tiebreak` is `definitionTiebreak` on the definitions;
  - `compare` is level, then name;
  - name and attribute filters are today's.
- Body: `paginateResults("Spell", hits, format, limit ?? 20, offset ?? 0, provenanceNote)`. That is byte-identical to today, where the note sits between the heading and the first result. Keep today's empty-page check (`reference.ts:578`, an `offset` past the end returns "No spells found matching the criteria.") ahead of `paginateResults`, and reproduce today's `header + "\n" + provenanceNote` join exactly (`reference.ts:589–592`).
- **`source` rules, shared by every catalog tool in Tasks 2–5:**
  - Resolve first with `resolveSource(await getSourceIndex(), source)`. `null` returns `plainSection(unknownSourceError(index, source, GENERIC_SOURCE_HINT))`, or the plain string for a get.
  - An empty result under `source` returns `No <kind> found matching the criteria in <book>.` (exempt from labelling). It never substitutes Open5e SRD content for a book the caller asked for.
  - A load failure (D&D Beyond unreachable) still falls back to Open5e, wrapped in `withSourceCaveat(text, source)`. That covers gets too. Exception: class features and racial traits have no Open5e path and keep their "unavailable" error (Task 5); their empty result under `source` is `No class features found matching the criteria in <book>.` / `No racial traits found matching the criteria in <book>.`
  - Without `source`, the no-results and Open5e paths are today's, as `plainSection(…)`.
- `getSpell(spellName, rulesEdition = "2024", source?: string)`. `formatSpell(spell, rulesLines: string[])` puts `rulesLines` directly under the title. A miss under `source` returns `Spell "<name>" not found in <book>.` with no Open5e fallback.

- [ ] **Step 1: Write the failing tests.**

`tests/edition-search.test.ts` (pure, with a small `buildSourceIndex` fixture holding VGtM 15 in category 23 (slug `vgtm`), MotM 85 in category 1 (slug `motm`), BR 1, br-2024 148 and PHB-2024 145 — the real snapshot ids). Entries are `{ id, name, isLegacy?, sources }`:
- Flat mode: `selectCatalog` over a Goblin VGtM entry (id 3, `isLegacy: true`, `[15]`) and a Goblin MotM entry (id 9, `[85]`), requested 2024. Exactly one hit, the MotM entry. Its label is `[2014] · <MotM label> (also in <VGtM label> — pass source to choose)`, and `hidden` is 0.
- Two same-edition entries from the **same** book get no book note.
- With `source` = `{ query: "vgtm", ids: [15], book: … }`, it lists only the VGtM Goblin, labelled `[2014]`. `header` is `Rules: showing every entry in Volo's Guide to Monsters, each tagged with its edition.`, `note` is `(source "vgtm" is a 2014 book — rules_edition "2024" was ignored)`, and `hidden` is 0.
- `lookupCatalog` for "Goblin" returns the MotM entry, with `rulesLines` `["Rules: 2014 · <MotM book>", "(no 2024 version found — 2014 text shown)", "(also in <VGtM label> — pass source to choose)"]`.
- Nested mode, `groupKey` (species): Elf (id 1, `[145]`), High Elf (id 2, `isLegacy: true`, `[1]`) and Wood Elf (id 3, `isLegacy: true`, `[1]`), all `groupKey` `"elf"`, `twinKey` their own names, `nameMatches` a substring of the name. Requested 2024 with name "elf": one hit, Elf `[2024]`, `hidden` 2. Requested 2014: High Elf and Wood Elf, both `[2014]`, `hidden` 1. Requested 2024 with name "high elf": High Elf `[2014]`, `hidden` 0.
- Nested mode, `owner` (features): owner F14 (`"c10"`, `[1]`) with features ASI L4, ASI L8, ASI L19 and "Natural Explorer"; owner F24 (`"c20"`, `[145]`) with ASI L4 and "8: ASI" L8; both twinKey/groupKey `"fighter"`. Requested 2024, `nameMatches` = name contains "ASI": F24's two lines `[2024]`, `hidden` 3. Requested 2014: F14's three lines, `hidden` 2. Name "natural explorer" under 2024: one line `[2014]`, `hidden` 0. A non-edition owner (homebrew, no sources) in the same group is always listed and never counted.
- Nested mode, duplicated owner: two 2014 owners sharing twinKey `"goblin"` — VGtM (`isLegacy: true`, `[15]`) and MotM (`[85]`), each with "Fury of the Small" — list only the MotM owner's line, labelled `[2014] · <MotM label> (also in <VGtM label> — pass source to choose)`.
- An optional feature whose own `markers` classify differently from its owner (owner `[145]`, entry `[1]`) is selected with its owner and tagged by its own markers (`[2014]`).

`tests/spell-editions.test.ts` (extend `installBasics` with a second Legacy 2014 "Sleep": `id: 400, isLegacy: true, sources: [27]`, description `SLEEP XGTE`. Ids 300/301 are taken by the existing Twin Bolt test, and the store keeps the first occurrence of an id):
- `getSpell("Sleep", "2014")` shows the PHB 2014 Sleep (`SLEEP 2014`; both are Legacy, so the lower id, 101, wins), and its line 3 is `` `(also in ${sourceLabel(index, 27)} — pass source to choose)` ``, where `index` is the snapshot index (`getSourceIndex()`). Non-Legacy precedence is pinned in `tests/edition.test.ts` and on species in Task 4.
- `getSpell("Sleep", "2024", "phb-2014")` → line 2 `Rules: 2014 · Player's Handbook (2014)`, line 3 `(source "phb-2014" is a 2014 book — rules_edition "2024" was ignored)`.
- `searchSpells({ source: "phb-2024" })` → line 1 is the source header, every result line is tagged `[2024]`, and there is no hidden footer.
- `searchSpells({ source: "nope" })` contains `Unknown source "nope"`. `getSpell("Sleep", "2024", "nope")` does too.
- `searchSpells({ name: "zzz", source: "phb-2024" })` returns `No spells found matching the criteria in Player's Handbook (2024).` and makes no Open5e request.
- With the compendium failing (every game-data request 500) and `source: "phb-2024"`, `searchSpells` returns the Open5e text followed by the source caveat.

Use the source ids the existing fixtures resolve through the snapshot index. `serviceMock` answers `{}` for the config, so the snapshot supplies `phb-2014`, `phb-2024` and `xgte`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/edition-search.test.ts tests/spell-editions.test.ts`
Expected: FAIL. The module doesn't exist, and `getSpell` ignores its third argument.

- [ ] **Step 3: Implement** `edition-search.ts`, then move spells onto it per the semantics above. Leave the existing phase-2 spell output byte-identical where there is no `source` and no alternative.

- [ ] **Step 4: Register `source`** on `ddb_search_spells` and `ddb_get_spell` in `src/server.ts`. Add one shared `SOURCE_PARAM` const beside `RULES_EDITION_PARAM`: `z.string().optional().describe("Book: slug (phb-2024), short name or title. Lists or picks that book's version, of either edition; wins over rules_edition.")`. Add one sentence to each description: "A source picks one book's version and wins over rules_edition."

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. Every pre-existing spell and consistency test passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/tools/edition-search.ts src/tools/reference.ts src/server.ts tests/edition-search.test.ts tests/spell-editions.test.ts
git commit -m "feat(edition): catalog search/lookup pipeline with book choice and source; spells use it"
```

---

### Task 3: Equipment (`ddb_search_equipment`, `ddb_get_equipment`)

**Files:**
- Modify: `src/tools/reference.ts` (items), `src/server.ts`
- Create: `tests/equipment-editions.test.ts`
- Modify: `tests/rules-edition-consistency.test.ts`

**Interfaces:**
- Consumes: Task 2's `selectCatalog`, `lookupCatalog`, `SearchSection`, `renderSection`, `plainSection`, `SOURCE_PARAM`.
- Produces:
  - `DdbItem` gains `isLegacy?: boolean | null; isHomebrew?: boolean | null; sources?: Array<{ sourceId: number }> | null`.
  - `loadItemCompendium()` returns `dedupeById(items)`.
  - `searchItemsSection(params: { name?: string; rarity?: string; type?: string; source?: string; rulesEdition?: RulesEdition }): Promise<SearchSection>`, plus `searchItems(params)` = `renderSection(await searchItemsSection(params))`.
  - `getItem(itemName: string, rulesEdition: RulesEdition = "2024", source?: string): Promise<string>`.
  - `formatItem(item: DdbItem, rulesLines: string[])`.

Behaviour:
- Item adapter: `markers = i => i`; `twinKey = i => twinName(i.name)`; `tiebreak = definitionTiebreak`; `compare` by name; `nameMatches` is a `normalizeName` substring; `passes` applies today's rarity/type filters.
- The search keeps its fixed cap, applied after hiding: heading `**Item Search** (N found)` or `(showing 30 of N)`, the trailing `*Refine your search to see more results.*`, and `- **Name** <label> — Rarity Type (attunement)` lines.
- Without `source`, an empty result keeps today's Open5e "not-found" fallback. Under `source`, the Task 2 `source` rules apply.
- **New:** a load failure (any throw from `loadItemCompendium`) falls back to `o5SearchItems(name ?? "", "unavailable")` and rethrows when that fails too, as `searchSpells` does. The Open5e result passes through `withSourceCaveat`.
- `getItem`: `lookupCatalog` with `name = i => i.name` (today's order: exact, then partial in array order). A miss without `source` keeps today's Open5e chain. A miss under `source` returns `Item "<name>" not found in <book>.`

- [ ] **Step 1: Write the failing tests** in `tests/equipment-editions.test.ts`, with the same fs/fetch harness as `tests/spell-editions.test.ts`. Route `/game-data/items` to:
  - Studded Leather (id 10, `sources [148, 1]`, `isLegacy: false`);
  - Longsword 2014 (id 11, `isLegacy: true`, `[1]`) and Longsword 2024 (id 12, `[148]`);
  - Handy Haversack (id 13, `isLegacy: true`, `[3]`) and Heward's Handy Haversack (id 14, `[146]`);
  - a homebrew "Moon Blade" (id 15, `isHomebrew: true`, no sources).

```ts
it("Studded Leather ([br-2024, BR], not Legacy) is 2024", async () => {
  const text = await reference.getItem("Studded Leather");
  expect(text.split("\n")[1]).toBe("Rules: 2024 · D&D Beyond Basic Rules");
});
it("Longsword: 2024 by default, 2014 on request", async () => {
  expect((await reference.getItem("Longsword")).split("\n")[1]).toMatch(/^Rules: 2024/);
  expect((await reference.getItem("Longsword", "2014")).split("\n")[1]).toMatch(/^Rules: 2014/);
});
it("a 2014 name reaches its renamed 2024 twin with a rename line", async () => {
  const lines = (await reference.getItem("Handy Haversack")).split("\n");
  expect(lines[0]).toContain("Heward's Handy Haversack");
  expect(lines).toContain("(2014 name: Handy Haversack · 2024 name: Heward's Handy Haversack)");
});
it("search: header, tags, hidden footer", async () => {
  const lines = (await reference.searchItems({ name: "longsword" })).split("\n");
  expect(lines[0]).toBe(searchHeader({ requested: "2024" }));
  expect(lines).toContain("- **Longsword** [2024] — Common Weapon");   // fixture: rarity "Common", filterType "Weapon"
  expect(lines.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
});
it("a query for the 2014 name lists the 2024 twin and counts the hide", async () => { /* Review Focus 6: "handy haversack" (also a substring of the 2024 name) → Heward's Handy Haversack [2024], footer 1 hidden */ });
it("source basic-rules-2014 lists the reprint, tagged by its own classification", async () => { /* Review Focus 3: Studded Leather [2024], header names Basic Rules (2014), sourceNote present */ });
it("homebrew with no sources is tagged [homebrew]", async () => { /* Review Focus 5 */ });
it("a load failure falls back to labelled Open5e, with the source caveat when a source was given", async () => { /* Review Focus 4: items 500 → body starts "Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)" */ });
```

Fill the elided bodies with the assertions named in their titles. Set the Longsword fixture's `rarity`/`filterType` so the expected line string is exact.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/equipment-editions.test.ts`
Expected: FAIL. There are no rules lines or tags, and `getItem` ignores the edition.

- [ ] **Step 3: Implement** the item changes in `reference.ts` per the Interfaces block.

- [ ] **Step 4: Register.** Add `rules_edition: RULES_EDITION_PARAM` and `source: SOURCE_PARAM` to `ddb_search_equipment` and `ddb_get_equipment`, append `RULES_EDITION_TOOL_NOTE` and the Task 2 source sentence to both descriptions, and pass both through.

- [ ] **Step 5: Extend the consistency test.**
  - `FIXTURES`: `ddb_search_equipment: ed => ({ name: "longsword", rules_edition: ed })` and `ddb_get_equipment: ed => ({ name: "Longsword", rules_edition: ed })`.
  - `route()`: answer `/game-data/items` with the two Longswords.
  - `o5Fetch`: answer `/magicitems/`, `/weapons/` and `/armor/` with a Longsword-shaped record. **Make `o5Fetch` filter every fixture by the request's `search` or `name` query param** (case-insensitive substring), including the existing spell and monster fixtures. A request with neither param (e.g. `fetchO5Cantrips`, `open5e.ts:95`) gets every fixture unfiltered. Then a not-found fallback in ddb mode for an unrelated query finds nothing, and the "no Open5e fallback in ddb mode" assertion keeps meaning something. The existing queries (`fire` / `Fireball`, `goblin` / `Goblin`) still match their fixtures.
  - `EDITION_CHECK.ddb_search_equipment = ed => ({ present: [hiddenFooter(ed)], resultTag: true })`.
  - `PATH_MARKER.ddb.ddb_get_equipment`: text unique to each edition's fixture.

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. `session-consumers.test.ts` still finds `ItemA` in the item search output.

- [ ] **Step 7: Commit**

```bash
git add src/tools/reference.ts src/server.ts tests/equipment-editions.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(equipment): rules_edition and source on equipment search and lookup; Open5e fallback on load failure"
```

---

### Task 4: Species, classes, backgrounds, feats

**Files:**
- Modify: `src/tools/reference.ts`, `src/server.ts`, `src/tools/search.ts` (params-object calls only)
- Create: `tests/options-editions.test.ts`
- Modify: `tests/class-features-racial-traits.test.ts` (convert the positional `searchClasses("fight")` / `searchRaces("elf")` calls, about lines 117–157, 366 and 473, to the params object; regenerate the `EXPECTED.classes*` / `EXPECTED.races*` characterization strings deliberately and diff them in review), `tests/rules-edition-consistency.test.ts`

**Interfaces:**
- Consumes: Task 2's pipeline and `paginateResults`.
- Produces:
  - `searchRacesSection` / `searchClassesSection` / `searchBackgroundsSection` / `searchFeatsSection` return `SearchSection`, each with a string twin, `searchX(...) = renderSection(await searchXSection(...))`.
  - Signatures change to one params object: `searchRaces(params: { name?: string; limit?: number; offset?: number; source?: string; rulesEdition?: RulesEdition } = {})`, and the same shape (with the `= {}` default, because tests call `searchClasses()` / `searchRaces()` with no argument and are not typechecked) for `searchClasses` and `searchBackgrounds`. `searchFeats` keeps its params object and gains `source` and `rulesEdition`.
  - Update the callers: `src/server.ts`, `src/tools/search.ts` (switch its calls to the params object, without `rulesEdition` until Task 6), and tests.
  - `DdbClass` loses `subclasses`. `DdbBackground` and `DdbFeat` gain `isLegacy?`.

Behaviour:
- Backgrounds and feats load through `loadGameDataList("game-data:backgrounds", "backgrounds")` / `("game-data:feats", "feats")`. The cache keys stay the same, and the lists gain the session boundary check and the never-cache-empty rule.
- Adapters: `markers` is the record itself; `twinKey` is `twinName` of the display name (`fullName || baseName` for races); `compare` by display name. `nameMatches` (when `name` is given) is `normalizeName(displayName).includes(normalizeName(name))`. Without it, no name filter applies at all. Races keep today's guard that drops entries with neither `fullName` nor `baseName`, applied before selection. Races use `tiebreak = (a, b) => definitionTiebreak({ id: a.entityRaceId, isHomebrew: a.isHomebrew, isLegacy: a.isLegacy }, …)`. The others use `definitionTiebreak` directly.
- **Races use nested mode** (owner decision 7): `groupKey = r => twinName(r.baseRaceName || r.baseName || displayName)`. So the 2024 Elf hides the 2014 High Elf and Wood Elf by default, `rules_edition: "2014"` lists each 2014 subrace, and `name: "high elf"` finds High Elf `[2014]` under either edition. Classes, backgrounds and feats stay in flat mode.
- Race lines: `- **<name>** <label>[ *(Subrace)*] — desc`. The `Legacy` and `Homebrew` text tags are gone.
- Class lines: `- **<name>** <label> — Hit Die: …`. There is no `Subclasses:` line.
- Background and feat lines: `- **<name>** <label>[ *(Requires: …)*] — desc`. The `*(Homebrew)*` text is gone.
- Feats keep `prerequisite` as a `passes` filter.
- Without `source`, an empty result keeps today's Open5e not-found fallback. A thrown load keeps the "unavailable" fallback, through `plainSection` with `withSourceCaveat`. Under `source`, the Task 2 `source` rules apply.

- [ ] **Step 1: Write the failing tests** in `tests/options-editions.test.ts`, routing `/game-data/{races,classes,backgrounds,feats}`:
  - **Classes:** Fighter `[1]` (id 1) and Fighter `[145]` (id 2). Default search: one Fighter line tagged `[2024]`, footer `1 2014 version hidden — rules_edition: "2014" shows it.`. With `"2014"`: the `[2014]` line, footer `1 2024 version hidden — omit rules_edition to show it.`. No output contains `Subclasses:`.
  - **Races:**
    - Human Legacy `[1]`, Human `[148]`.
    - Goblin, 2014, `isLegacy: true` `[15]` and Goblin, 2014, not Legacy `[85]`. These are real snapshot ids: 15 is VGtM (category 23, slug `vgtm`) and 85 is MotM (category 1, slug `motm`). The config route answers `{}`, and `getGameConfig` ignores a config without `challengeRatings`, so the snapshot index applies and no config needs serving.
    - `COPY_OF_Tiefling` (`isHomebrew: true`, no sources).
    - An official "Mystery Folk" with no sources.
    - Elf (base, `[145]`), High Elf and Wood Elf (subraces, `isSubRace: true`, `baseRaceName: "Elf"`, `isLegacy: true`, `[1]`).

    Expected:
    - `searchRaces({ name: "goblin" })` lists exactly one Goblin: `- **Goblin** [2014] · Mordenkainen Presents: Monsters of the Multiverse [motm] (also in Volo's Guide to Monsters [vgtm] — pass source to choose)`, with the description after it. That is Review Focus 2 plus owner decision 1. (Confirm the exact book labels from `sourceLabel` on the snapshot index when writing the assertion.)
    - `source: "vgtm"` lists the Volo's Goblin.
    - `searchRaces({ name: "elf" })`: one line, `Elf [2024]`, footer `2 2014 versions hidden — rules_edition: "2014" shows them.` With `rulesEdition: "2014"`: High Elf and Wood Elf lines, both `[2014]`, footer `1 2024 version hidden — omit rules_edition to show it.` `searchRaces({ name: "high elf" })` under the default: High Elf `[2014]`, no footer (owner decision 7).
    - `COPY_OF_Tiefling` is tagged `[homebrew]`.
    - "Mystery Folk" is tagged `[edition not stated]` under both editions and never counted in the footer (Review Focus 5).
  - **Backgrounds:** Acolyte `[1]` and Acolyte `[145]` (same name; the rename table maps both sides to `priest acolyte`, so they still group). Criminal / Spy `[1]` and Criminal `[145]` exercise a real rename pair. Default: `Acolyte [2024]` and `Criminal [2024]`, footer `2 2014 versions hidden — rules_edition: "2014" shows them.`
  - **Feats:** Alert `[2]` (prerequisite `null`) and Alert `[145]` (prerequisite `"Level 4+"`). The default search lists `Alert [2024]` with 1 hidden. `prerequisite: "level 4"` lists `Alert [2024]` with **no** footer: the hidden count only counts other-edition entries that would pass the filters, and the 2014 Alert has no prerequisite.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/options-editions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the four searches on the pipeline.

- [ ] **Step 4: Register.** Add `rules_edition` and `source` to `ddb_search_races`, `ddb_search_classes`, `ddb_search_backgrounds` and `ddb_search_feats`. Their descriptions get `RULES_EDITION_TOOL_NOTE` and the source sentence. Drop "and subclasses" from `ddb_search_classes`' description.

- [ ] **Step 5: Regenerate the characterization strings** in `tests/class-features-racial-traits.test.ts` (`EXPECTED.classesAll`, `classesFight`, `racesAll`, `racesElf`). Review the diff. The expected changes are:
  - the header line, the tags, and the removal of the `Legacy`/`Homebrew` text and `Subclasses:`;
  - twin hiding: the shared fixture's 2014 Fighter (id 10, `[1]`) and 2024 Fighter (id 2190879, `[145]`) now show as one `[2024]` line, the count drops from 2 to 1, and the hidden footer appears;
  - the same for any race pair in `RACES`, and for 2014 subraces whose base race has a 2024 species (base-race grouping).

  No other change is expected.

- [ ] **Step 6: Extend the consistency test.**
  - Add fixtures for the four tools (`name: "fighter"`, `"human"`, `"acolyte"`, `"alert"`), with matching `route()` data.
  - Add Open5e records for `/races/`, `/classes/`, `/backgrounds/` and `/feats/`, filtered by query (a request with no `search`/`name` param, such as `fetchO5Cantrips` at `open5e.ts:95`, gets every fixture unfiltered). Give **two records per endpoint whose names both contain the query**, e.g. "Human" and "Human (Variant)", "Fighter" and "Fighter (Champion)". `o5SearchRaces` / `o5SearchClasses` return a detail block for a single named hit, and `o5SearchBackgrounds` / `o5SearchFeats` do for any single hit (`src/open5e.ts:497`, `:557`, `:597`, `:629`). That block has no result line, so the search check would fail.
  - Add `EDITION_CHECK` entries with the hidden footer and `resultTag: true`.

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tools/reference.ts src/server.ts src/tools/search.ts tests/options-editions.test.ts tests/class-features-racial-traits.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(options): rules_edition and source on species, classes, backgrounds and feats; drop the dead Subclasses line"
```

---

### Task 5: Class features and racial traits

**Files:**
- Modify: `src/tools/features-traits.ts`, `src/tools/reference.ts`, `src/server.ts`, `src/edition-renames.ts`
- Modify: `tests/features-traits.test.ts`, `tests/class-features-racial-traits.test.ts`, `tests/fixtures/features-traits-fixtures.ts`, `tests/rules-edition-consistency.test.ts`

New fixture data for this task (the 2014 Cleric with Life and Tempest, the Champion/Samurai/Evoker subclasses, the Elf/High Elf and Goblin races below) goes in **new, separately exported arrays** in `tests/fixtures/features-traits-fixtures.ts`, used only by this task's tests. The shared `CLASSES` / `RACES` inputs behind Task 4's `EXPECTED` characterization strings must not change, and those strings must still pass unchanged.

**Interfaces:**
- Consumes: Task 1's `classOwnerTwinKey`; Task 2's pipeline in nested mode (`groupKey`, `owner`, `CatalogOwner`).
- Produces (`features-traits.ts`, still pure):
  - `ClassFeatureEntry` gains `ownerSources: SourceRef[]`: the owning subclass's sources for a subclass feature, else the class's — for optional features too (their `sources` stay their own). `RacialTraitEntry` gains `ownerSources: SourceRef[]` (the race's, for optional traits too) and `entityRaceId: number`.
  - `classFeatureFilters(f: { name?: string; className?: string; level?: number }): { nameMatches?: (e: ClassFeatureEntry) => boolean; passes: (e: ClassFeatureEntry) => boolean }`. `nameMatches` is the feature-name filter. `passes` is the class/subclass and level filters.
  - `racialTraitFilters(f: { name?: string; raceName?: string })`, the same shape for traits (`raceName` keeps today's species-or-base-race match).
  - `compareClassFeatures(a, b)` and `compareRacialTraits(a, b)`: the comparator bodies inside today's `sortEntries` (`features-traits.ts:204`) and `sortTraits` (`:367`), extracted and exported; the two sorters call them.
  - `filterClassFeatures` / `filterRacialTraits` are reimplemented on these and keep their behaviour and tests.
  - `formatClassFeatureLine(e: ClassFeatureEntry, label: string)` → `- **<name>** <label> — <Class>[ (<Subclass>)] level N[, optional]`, then today's description line.
  - `formatRacialTraitLine(e: RacialTraitEntry, label: string)` → `- **<name>** <label> *(<species>[ — subrace of X])*[ *(optional)*] — desc`. The `, Homebrew` text is gone: the tag says it.
  - Both keep the `wrapUntrusted` rule.
- Produces (`reference.ts`):
  - `searchClassFeaturesSection(params & { source?; rulesEdition? })` and `searchRacialTraitsSection(…)`, each with a string twin.
  - Class-feature adapter (nested mode, owner decisions 4–6):
    - `owner = e => ({ id: e.kind === "subclass" ? `c${e.classId}/s${e.subclassId}` : `c${e.classId}`, markers: { sources: e.ownerSources, isHomebrew: e.isHomebrew }, tiebreak: { id: e.subclassId ?? e.classId, isHomebrew: e.isHomebrew } })`;
    - `twinKey = groupKey = e => classOwnerTwinKey(e.className, e.kind === "subclass" ? e.subclassName : null)`;
    - `markers = e => ({ sources: e.sources, isHomebrew: e.isHomebrew })` (the entry's own: an optional feature keeps its own sources);
    - `tiebreak = definitionTiebreak`, `compare = compareClassFeatures`, `nameMatches`/`passes` from `classFeatureFilters`.
  - Racial-trait adapter (nested mode, owner decisions 4–7):
    - `owner = e => ({ id: e.raceKey, markers: { sources: e.ownerSources, isLegacy: e.isLegacy, isHomebrew: e.isHomebrew }, tiebreak: { id: e.entityRaceId, isLegacy: e.isLegacy, isHomebrew: e.isHomebrew } })`;
    - `twinKey = e => twinName(e.speciesName)`; `groupKey = e => twinName(e.baseRaceName || e.speciesName)`;
    - `markers = e => ({ sources: e.sources, isLegacy: e.isLegacy, isHomebrew: e.isHomebrew })` (a standard trait's `sources` are the race's — the plan's decision on racial-trait classification; an optional trait keeps its own);
    - `tiebreak = definitionTiebreak`, `compare = compareRacialTraits`, `nameMatches`/`passes` from `racialTraitFilters`.
  - With results, the partial-build note is the first line of the body, under the header.
  - With no match, the reply is `plainSection(note + message)`, with no header, exactly as today. The existing no-match `startsWith(CF_PARTIAL)` assertions stay. (Filter-first selection lists something whenever anything matched, so a no-match reply never has hidden entries.)
  - The "unavailable" errors are unchanged, so these two tools still have no Open5e path.
- Produces (`src/edition-renames.ts`, owner decision 8): four `[name2014, name2024]` subclass pairs — `["Draconic Bloodline", "Draconic Sorcery"]`, `["The Fiend", "Fiend Patron"]`, `["School of Evocation", "Evoker"]`, `["Way of the Open Hand", "Warrior of the Open Hand"]` — each with an evidence comment in the file's existing style (ids, sources, and what the two descriptions share). Read both live descriptions first in `.claude/probe-2026-10-17-features-traits/out/all-subclasses.json` (git-ignored, local; the 2014 class ids are 6 Sorcerer, 7 Warlock, 8 Wizard, 11 Monk; the 2024 ones 2190884, 2190885, 2190886, 2190880). If a pair turns out not to be the same subclass revised, leave it out and report it. Check whether a monster or other kind shares a name with either side (the 2014 Volo's NPC "Evoker" may); a shared 2024 side only adds a `twinAliases` spelling to monster-service lookups, which is accepted (see Decisions), but report what you find.

- [ ] **Step 1: Write the failing tests.**

In `tests/features-traits.test.ts`:
- Update every `formatClassFeatureLine` / `formatRacialTraitLine` call to pass a label, e.g. `"[2024]"`, and its expected string (the tag goes after the name).
- Add: `buildClassFeatures` sets `ownerSources` to the subclass's sources for a subclass feature and to the class's for a base and an optional feature (whose own `sources` differ); `buildRacialTraits` sets `ownerSources` and `entityRaceId` from the race for standard and optional traits.

In `tests/class-features-racial-traits.test.ts`:
- **Shared fixture Fighters** (2014 id 10 `[1]`, 2024 id 2190879 `[145]`; their live ASI names are 7 × `Ability Score Improvement` for 2014 and `Ability Score Improvement`, `6: …`, `8: …`, `12: …`, `14: …`, `16: …` for 2024):
  - `searchClassFeatures({ name: "action surge" })`: line 1 is the 2024 header, one line `- **Action Surge** [2024] — Fighter level 2`, footer `1 2014 version hidden — rules_edition: "2014" shows it.`
  - `searchClassFeatures({ name: "ability score", className: "fighter" })`: the six 2024 ASI lines, each `[2024]` (names as D&D Beyond gives them), and no `[2014]` line; footer `7 2014 versions hidden — rules_edition: "2014" shows them.` With `rulesEdition: "2014"`: the seven 2014 lines, footer `6 2024 versions hidden — omit rules_edition to show them.`
  - `level: 6` with `className: "fighter"`: the 2024 Fighter's level-6 features, including `6: Ability Score Improvement`; the footer counts the 2014 Fighter's level-6 features.
  - `name: "martial versatility"` (an optional feature of the 2014 Fighter only, `[67]` TCoE, in the shared fixture): listed `[2014]`, no footer (owner decision 5).
  - `source: "phb-2024"`: only the 2024 Fighter's features, tagged, under the source header.
- **New fixture arrays:**
  - a 2014 Cleric `[1]` with Life Domain and Tempest Domain subclasses (each subclass `[1]` too: subclass features classify from the subclass's sources), each with "Bonus Proficiency": `searchClassFeatures({ name: "bonus proficiency", className: "cleric", rulesEdition: "2014" })` lists both lines and has no footer; under the default (no 2024 Cleric in this fixture) both are listed `[2014]`, no footer (Review Focus 1);
  - Champion: reuse the shared fixture's 2014 Champion (subclass 16) and 2024 Champion (2190931); `searchClassFeatures({ name: "improved critical" })` under the default lists the 2024 one, footer 1 hidden;
  - a 2014-only subclass "Samurai" (`[27]`, xgte) under the 2014 Fighter: `searchClassFeatures({ className: "samurai" })` lists its features `[2014]`; `className: "fighter"` under the default lists the 2024 Fighter's base features **and** the Samurai's features `[2014]` (a 2024 Fighter with a 2014-only subclass — mixed setups);
  - a 2014 "School of Evocation" `[1]` under a 2014 Wizard and a 2024 "Evoker" `[145]` under a 2024 Wizard, each with "Sculpt Spells": `searchClassFeatures({ name: "sculpt spells" })` under the default lists only the Evoker's, footer 1 hidden (owner decision 8). If the evidence check drops this rename pair, the test instead expects both subclasses listed, each tagged, no footer;
  - a 2014 Ranger `[1]` with "Natural Explorer" and "Favored Enemy", and a 2024 Ranger `[145]` with "Deft Explorer" and "Favored Enemy": `searchClassFeatures({ className: "ranger" })` under the default lists only the 2024 Ranger's two features, footer `2 2014 versions hidden — rules_edition: "2014" shows them.`; `name: "natural explorer"` lists `Natural Explorer [2014]`, no footer;
  - races: Elf (base, 2024, `[145]`) with "Darkvision" whose own `definition.sources` are `[1]`; High Elf (2014 subrace, `isLegacy: true`, `[1]`, `baseRaceName: "Elf"`) with "Darkvision" and "Age". `searchRacialTraits({ raceName: "elf" })`: only the 2024 Elf's traits, Darkvision tagged `[2024]` (classified from the race, not the trait's own sources), footer `2 2014 versions hidden — rules_edition: "2014" shows them.` `raceName: "high elf"`: High Elf's traits `[2014]`, no footer. `name: "age"`: `Age [2014]`, no footer;
  - Goblin VGtM (`isLegacy: true`, `[15]`) and Goblin MotM (`[85]`) species, each with "Fury of the Small": `searchRacialTraits({ raceName: "goblin" })` lists one Fury of the Small line labelled `[2014] · <MotM label> (also in <VGtM label> — pass source to choose)` and no rename line (Review Focus 2, owner decision 6).
- Existing tests in `tests/class-features-racial-traits.test.ts` that must be updated, and only these:
  - `out.split("**Action Surge** — Fighter level 2")).toHaveLength(3)` (about line 200): the fixture's two Fighters are now one owner pair, so assert `out.split("**Action Surge** [2024] — Fighter level 2")` has length 2 and the output ends with the 1-hidden footer;
  - every `toContain("**Action Surge** — Fighter level 2")`: insert the tag;
  - the partial-note `startsWith(CF_PARTIAL…)` checks on searches **with results** (about lines 250, 271, 284–303) become "line 1 is the header and line 2 starts with `CF_PARTIAL`". The racial-trait equivalents (from about line 408) change the same way.

  Unavailable and no-match tests are unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/features-traits.test.ts tests/class-features-racial-traits.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the `features-traits.ts` changes, the rename pairs, then the two searches on the pipeline.

- [ ] **Step 4: Register** `rules_edition` and `source` on `ddb_search_class_features` and `ddb_search_racial_traits`, with the description sentences.

- [ ] **Step 5: Extend the consistency test.**
  - Fixtures: `ddb_search_class_features: ed => ({ name: "action surge", rules_edition: ed })` and `ddb_search_racial_traits: ed => ({ name: "darkvision", rules_edition: ed })`, with `route()` serving classes (with `classFeatures`), empty `subclasses`, empty collections, and races with `racialTraits`. Both collection endpoints end in `/collection`, so route them on the full path, not `pathname.split("/").pop()` (test line ~156).
  - Add `const NO_OPEN5E = new Set(["ddb_search_class_features", "ddb_search_racial_traits"])`. In open5e mode, right after the tool call and before the exempt/label checks (test lines ~226, ~239–245), those tools assert `isError: true` and return. In ddb mode they get the full check, including the hidden footer.

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/features-traits.ts src/tools/reference.ts src/server.ts src/edition-renames.ts tests/features-traits.test.ts tests/class-features-racial-traits.test.ts tests/fixtures/features-traits-fixtures.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(features): rules_edition and source on class features and racial traits, chosen per class, subclass and species; subclass rename pairs"
```

---

### Task 6: `ddb_search_site` embedded mode

**Files:**
- Modify: `src/tools/search.ts`, `src/tools/monster.ts`, `src/server.ts`
- Create: `tests/search-site.test.ts`
- Modify: `tests/rules-edition-consistency.test.ts`

**Interfaces:**
- Consumes: every `…Section` function from Tasks 2–5.
- Produces:
  - `searchMonstersSection(params): Promise<SearchSection>` in `monster.ts`. Its `header` is the search header line. Its `body` is everything between header and footer: source note, locked note, heading, lines, more/partial notes and swap summary. Its `footer` is `searchFooter(...)`. Every early return (login, homebrew messages, Open5e, no results) is a `plainSection`. `searchMonsters(params) = renderSection(await searchMonstersSection(params))`, and its output is byte-identical to today's.
  - `search(query: string, category: SearchCategory = "all", rulesEdition: RulesEdition = "2024"): Promise<string>`.

Behaviour:
- A single category returns `renderSection` of that category's section: its own header and footer.
- `"all"`:
  - runs every category's section with today's limits (spells 10, races/classes/feats 10, items cap 30, monsters default) and `rulesEdition`;
  - skips a section whose `body` matches `EMPTY_RESULT_PATTERN`, widened to `/^no\s+[\w\s]+?\s+found/i`, so "No magic items found …" (`open5e.ts:325`) is skipped too. Today the narrower pattern keeps an empty Open5e item section;
  - output is `searchHeader({ requested })` — **only when at least one included section has a non-null `header`** (owner decision 10; an all-Open5e reply has no combined header) — then `# Search results for "<query>"`, then each `## <Label>\n\n<body>`, joined with today's separators (`search.ts:41`);
  - then `searchFooter(requested, Σ hidden)` when non-null;
  - a section that throws becomes `_<message>_` with hidden 0, as today;
  - when no section remains, the text is still `No results found for "<query>".` with no header.

- [ ] **Step 1: Write the failing tests** in `tests/search-site.test.ts`. Mock `../src/tools/reference.js` and `../src/tools/monster.js` section functions with `vi.mock`, returning fixed `SearchSection`s:

```ts
it("all: one header, section bodies without their own header/footer, one combined footer", async () => {
  // spells: { header: H, body: "**Spell Search** (1 found)\n\n- **Fireball** [2024] — Level 3 Evocation", footer: F1, hidden: 1 }
  // monsters: { header: H, body: "...- **Goblin Warrior** [2024] ...", footer: F1, hidden: 1 }; others: plainSection("No races found …")
  const text = await search("fire", "all", "2024");
  expect(text.split("\n")[0]).toBe(searchHeader({ requested: "2024" }));
  expect(text.match(/^Rules: /gm)).toHaveLength(1);
  expect(text.trimEnd().split("\n").at(-1)).toBe('2 2014 versions hidden — rules_edition: "2014" shows them.');
  expect(text).not.toContain("## Races");
});
it("a single category keeps its own header and footer", async () => { /* renderSection of that section, unchanged */ });
it("threads rules_edition into every category", async () => { /* each section mock called with rulesEdition "2014" */ });
it("all empty: plain no-results text with no header", async () => { /* … */ });
it("all sections plain (Open5e fallbacks): no combined header, each section keeps its own Rules line", async () => { /* owner decision 10 */ });
it("mixed: a D&D Beyond section and an Open5e section print the combined header and the Open5e section's own Rules line", async () => { /* owner decision 10 */ });
it('skips an empty "No magic items found …" section', async () => { /* items: plainSection('No magic items found matching "x" (SRD only).') → no "## Items" */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/search-site.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `searchMonstersSection` (a pure restructuring: the existing `tests/monster.test.ts` must pass unchanged), then `search.ts`.

- [ ] **Step 4: Register** `rules_edition: RULES_EDITION_PARAM` on `ddb_search_site` (no `source`). Append `RULES_EDITION_TOOL_NOTE` to its description and pass it through.

- [ ] **Step 5: Extend the consistency test.**
  - Fixture: `ddb_search_site: ed => ({ query: "Fireball", rules_edition: ed })`.
  - `EDITION_CHECK.ddb_search_site = ed => ({ present: [hiddenFooter(ed)], resultTag: true })`. Fireball is the only cross-category hit in ddb mode, so the combined footer is the spell section's 1.
  - Also assert `text.match(/^Rules: /gm)` has length 1 in ddb mode for this tool.

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. The consistency test's first case proves every `rules_edition` tool now has fixtures.

- [ ] **Step 7: Commit**

```bash
git add src/tools/search.ts src/tools/monster.ts src/server.ts tests/search-site.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(search): rules_edition on ddb_search_site with one header and a combined footer"
```

---

### Task 7: Docs and live check

**Files:**
- Modify: `CLAUDE.md`, `README.md` (only where it lists tool params), the spec's status line

- [ ] **Step 1: Update CLAUDE.md.**
  - Key modules table: add `src/source-filter.ts` and `src/tools/edition-search.ts`. Update the `features-traits.ts` and `reference.ts` rows (`loadGameDataList` now also serves backgrounds and feats).
  - Tool notes: the phase-3 tools take `rules_edition` and `source`. The spell tools take `source`. `ddb_search_site` takes `rules_edition` and prints one header and one footer. Explain the book-choice note.
  - "Next steps":
    - phase 3 done, with commit range;
    - close item 6 ("Subclasses line removed, owner decision 2026-10-19");
    - carry-overs for phase 4: the rename table is still shared (now with four subclass pairs; splitting it per kind is open), subclass renames visible only to book owners (e.g. Path of the Totem Warrior → Path of the Wild Heart) need verified pairs, and `searchItems` now falls back to Open5e on load failure;
    - the stateless-safe Task 2 still waits for phase 5.
  - Decisions: record owner decisions 1–10 (per-owner selection for class features and racial traits, filter first, base-race grouping for species and how mixed setups are served, `getSourceIndex()` on every catalog search, the `ddb_search_site` header rule).

- [ ] **Step 2: Update the spec's status line** to "Phase 3 implemented 2026-10-xx".

- [ ] **Step 3: Live check** (logged in, `npm run dev` or a rebuilt MCP server), under both editions:
  - `ddb_get_equipment` "Studded Leather" and "Longsword";
  - `ddb_search_equipment` "haversack";
  - `ddb_search_classes` "fighter";
  - `ddb_search_races` "human";
  - `ddb_search_backgrounds` "criminal";
  - `ddb_search_feats` "alert";
  - `ddb_search_class_features` "action surge", `class_name: "ranger"` (no removed 2014 Ranger features under the default), and `name: "ability score", class_name: "fighter"`;
  - `ddb_search_racial_traits` "darkvision", and `race_name: "elf"` / `"high elf"`;
  - `ddb_search_races` "elf";
  - `ddb_search_site` "fire";
  - `ddb_get_spell` "Sleep" with `source: "phb-2014"`.

  Expected: each first line is a `Rules:` line or a search header, every result line is tagged, and the footers count hidden twins.

- [ ] **Step 4: Run the full suite, then commit** with the live `Rules:` lines and footers pasted into the message body.

```bash
npm run typecheck && npm run lint && npm test
git add CLAUDE.md README.md docs/superpowers/specs/2026-10-16-rules-edition-design.md
git commit -m "docs: rules-edition phase 3 done"
```
