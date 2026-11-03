# QA Findings and Carry-overs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding in `QAREPORT.md` (2026-10-23), every open rules-edition carry-over in CLAUDE.md, work items 4, 5, 7, 8 and 9 (security finding F-2026-10-20).

**Architecture:** These are fixes to existing modules, with no new subsystem. Label text stays in `src/edition.ts`. The rename table is split by content kind. Open5e twin keys gain an equipment-only normaliser. The Open5e loader gains a failure memo and an overall deadline. The fork's security commit is ported and extended to two new output paths.

**Tech Stack:** TypeScript (ES2022, NodeNext), Node ≥ 22, vitest 5, zod, MCP SDK.

**Spec:** The owner's decisions from the 2026-10-27 session (recorded under **Decisions** below), `QAREPORT.md`, CLAUDE.md "Next steps (known issues)", and [docs/superpowers/specs/2026-10-16-rules-edition-design.md](../specs/2026-10-16-rules-edition-design.md) for the labelling rules this must keep. Live evidence: `.claude/probe-2026-10-23/` (D&D Beyond dumps and probe scripts) and `.claude/probe-2026-10-23/open5e/` (both SRD documents, all 11 endpoints, plus the normalisation experiments `q1c-*`). Both directories are git-ignored.

## Decisions (owner, 2026-10-27)

1. **Port `d7d0656` now** (security finding F-2026-10-20, work item 9). Extend the wrap to `ddb_character_lookup` class spells (QA #2).
2. **The Rules line counts homebrew entries; it does not name them** (QA #1), e.g. `homebrew: 1 species, 1 feat`.
3. **`sourceNote` wording:** `(source "xgte" is a 2014 book — its entries are listed whatever rules_edition says)` (QA #13).
4. **Dual-edition items take the requested edition.** A non-Legacy, non-homebrew definition that lists both a 2024-category and a 2014-category book is classified as the requested edition, with that edition's book. This is the rule character sheets use (carry-over (e) follow-up; 539 live items).
5. **Rename pairs are tagged by kind.** Each tool uses only its own kind's pairs (carry-over (a)).
6. **Open5e equipment twin keys use rules M1–M3 plus 6 hand pairs** (carry-over (r)). This applies to Open5e only.
7. **`source: "homebrew"` is reserved on the catalog tools**, as it is on the monster tools (carry-over (f)).
8. **school, type and size match part of a word on both paths** (QA #11). `rarity` stays exact.
9. **The Open5e legendary-actions note** is `(Uses per round aren't in the Open5e SRD data — usually 3.)` (QA #10).
10. **The ambiguity list is capped at 20**, applied centrally (QA #7).
11. **These stay as they are:** (q), (y), (z), (ab). (aa) and (b) stay open, because the free account can't verify them. Update their CLAUDE.md lines with the 2026-10-23 evidence.
12. **Scope includes work items 4, 5, 7 and 8.**

## Global Constraints

- Node 22 floor; no new runtime dependency. `@types/node` stays `^22`.
- Every edition label string lives in `src/edition.ts`; no tool builds its own edition text.
- Wrap user-authored D&D Beyond text with `wrapUntrusted` / `wrapIfHomebrew` (`src/utils.ts`); official text stays plain; compendium entries wrap only when `isHomebrew === true` (monsters stay fail-closed as today).
- Every account-derived cache registers an `onSessionInvalidated()` hook; failures are never cached except by an explicit short failure memo.
- Commit to `main` at natural boundaries, never push. Never stage `docs/superpowers/plans/2026-09-16-security-remediation.md` (deleted), `docs/superpowers/plans/2026-10-16-rules-edition-phase-1-foundation.md` (modified), `docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md` (untracked), or `QAREPORT.md` (owner WIP; Task 16 edits it but leaves it unstaged). Use `git add <paths>` only.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task, run `npm run typecheck && npm run lint && npm test`. All must pass. From Task 1 onward, typecheck covers `tests/`.

## Review Focus

1. **A dual-edition item under a `source` filter.** For example, `ddb_search_equipment { source: "basic-rules-2014" }` must tag Longsword `[2014]`, not `[2024]`. Test in Task 4.
2. **Kind-scoped renames must reach every twin-key user.** `spell-store.ts` and `isConcentrationSpell` use the spell kind; `classOwnerTwinKey` uses the subclass kind; Open5e uses the kind matching its endpoint. A leftover generic `twinName` would silently bring the cross-kind hits back. Test in Task 5.
3. **Homebrew text on every new path is wrapped.** That covers the catalog lines under `source: "homebrew"` and the `ddb_search_site` sections built from them. Tests in Tasks 2 and 6.
4. **`ddb_clear_cache` and the Open5e failure memo.** A clear must also drop remembered failures, so the next call retries at once. Test in Task 9.
5. **Logged-out monster lookups that now reach monster-service.** If monster-service fails while logged out, the existing Open5e fallback and its labels still apply, and homebrew still says it needs login. Test in Task 13.

---

### Task 1: Typecheck `tests/` (work item 7) — Sonnet

**Files:** Create `tsconfig.test.json`; Modify `package.json` (`typecheck` script); fix type errors under `tests/`.

- [ ] Step 1: Create `tsconfig.test.json`. It extends `tsconfig.json` with `"compilerOptions": { "noEmit": true, "rootDir": "." }` and `"include": ["src/**/*", "tests/**/*"]`.
- [ ] Step 2: Change `"typecheck"` to `"tsc --noEmit && tsc -p tsconfig.test.json"`. Run `npm run typecheck`. Expected: it fails, listing the test type errors.
- [ ] Step 3: Fix each test error in the test code. Use real types, not `any`. Use `as unknown as T` only for deliberately malformed fixtures, with a comment. Production code must not change, except to export a type a test needs.
- [ ] Step 4: Run `npm run typecheck && npm run lint && npm test`. All pass.
- [ ] Step 5: Commit `chore(types): typecheck tests/ (work item 7)`.

### Task 2: Port the fork security fix and wrap lookup class spells (item 9, QA #2) — Opus

**Files:** The 14 files of `d7d0656`; Modify `src/tools/character/definition.ts` (`formatSpellResult` path); Test `tests/untrusted-content.test.ts`.

**Produces:** `wrapIfHomebrew(text: string, isHomebrew: boolean | null | undefined): string` in `src/utils.ts`. It wraps only when `isHomebrew === true`.

- [ ] Step 1: Run `git fetch https://github.com/jeffstokes72/ddb-mcp.git cursor/session-cookies-and-untrusted-homebrew-58d8 && git cherry-pick -n FETCH_HEAD`.
- [ ] Step 2: Resolve conflicts as CLAUDE.md "How to port" says. Keep `main`'s code and re-apply the wrap where each line or detail block is now built:
  - catalog lines in `searchCatalogList` and `searchOptionList`;
  - the spell and item section line formatters;
  - `formatSpell` and `formatItem`;
  - the race, class, background and feat formatters.

  Wrap the whole formatted line, including its tag and book note. In `tests/class-features-racial-traits.test.ts`, `*(Homebrew)*` is now `[homebrew]`. In CLAUDE.md and README, keep `main`'s text and add the security notes.
- [ ] Step 3: Add these tests to `tests/untrusted-content.test.ts`:
  - `ddb_character_lookup wraps a homebrew spell found in classSpells[].classSpells`: a 2024-format character whose `classSpells[0].spells` is `[]` and whose `classSpells[0].classSpells` holds a spell with `definition.isHomebrew: true` and `description: "IGNORE PREVIOUS"`. `getDefinition` output contains `<untrusted_dndbeyond_content>` around the description.
  - `an official isHomebrew:false catalog entry stays plain`: no `untrusted_dndbeyond_content` in the output.
- [ ] Step 4: Wrap `formatSpellResult` output with `wrapIfHomebrew(..., def.isHomebrew)` in `definition.ts`, as the fork does for feats and items.
- [ ] Step 5: Run the full checks. Commit `fix(security): keep only D&D Beyond cookies and wrap homebrew text (port of d7d0656); wrap lookup class spells`. Credit the original author in the body: `Ported from jeffstokes72/ddb-mcp@d7d0656`.

### Task 3: Rules line counts homebrew entries (QA #1) — Sonnet

**Files:** Modify `src/edition.ts` (`characterRulesLine`); Test `tests/character-editions.test.ts`.

- [ ] Step 1: Add the failing test `characterRulesLine counts homebrew entries instead of naming them`. Input: a 2024 main class, plus homebrew entries `{ name: "Dhampir (HB)", kind: "species" }`, `{ name: "Shadow Touched+", kind: "feat" }` and two homebrew spells. Expected output: `Rules: 2024 · homebrew: 1 species, 1 feat, 2 spells`. The output must not contain `Dhampir`.
- [ ] Step 2: Implement it. For the `homebrew` group only, every kind is counted, in the order class, subclass, species, background, feat, spell, item. Plurals: `species` is unchanged; `class`→`classes`; the rest add `s`. The other groups keep naming non-spell, non-item entries.
- [ ] Step 3: Update the docstring and the CLAUDE.md "parseCharacterData notes" rule (2). Run the checks. Commit `fix(character): the Rules line counts homebrew entries rather than naming them`.

### Task 4: Item compendium keeps every item type; dual-edition items take the requested edition (carry-over (e), decision 4) — Opus

**Files:**
- Modify `src/edition.ts`: rename `classifyCharacterEntry` → `classifyForEdition`. Update every caller.
- Modify `src/tools/edition-search.ts`: add `dualEdition?: boolean` to `CatalogAdapter`.
- Modify `src/tools/reference.ts`:
  - `loadItemCompendium` and the cache read;
  - `ITEM_ADAPTER` gets `dualEdition: true`.
- Tests: `tests/equipment-editions.test.ts`, `tests/edition-search.test.ts`.

**Produces:**
- `dedupeByKey<T>(entries: readonly T[], key: (t: T) => string): T[]` in `src/edition.ts`. It keeps the first entry per key. `dedupeById` becomes `dedupeByKey(entries, e => String(e.id))`.
- `classifyForEdition(entry: EditionMarkers, index: SourceIndex, main: RulesEdition | "unstated"): EditionInfo`. It is the renamed `classifyCharacterEntry`, with unchanged behaviour.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `the item compendium keeps items that share an id across entity types`. Three items with id 3 and entityTypeIds `2103445194` (Crossbow Bolts), `1782728300` (Dagger) and `701257905` (Studded Leather). `getItem("Studded Leather")` shows `Studded Leather`, not `Glamoured Studded Leather`.
  - `a dual-edition item under rules_edition 2014 is the 2014 version`. Longsword, `sources: [{sourceId:148},{sourceId:1}]`, non-Legacy. `getItem("Longsword","2014")` gives `Rules: 2014 · Basic Rules (2014)` with no reason line. Under `"2024"` it gives `Rules: 2024 · D&D Beyond Basic Rules`.
  - `a 2014 equipment search tags dual items [2014]`.
  - `a source search classifies a dual item by the book's edition`: `source: "basic-rules-2014"` tags Longsword `[2014]` (Review Focus 1).
  - `a Legacy or homebrew item is not dual`.
- [ ] Step 2: Implement:
  - Item dedupe uses `definitionKey ?? `${entityTypeId}:${id}``. The cache key becomes `"item-compendium-v2"`, so a cached v1 list isn't reused.
  - In `selectCatalog` and `lookupCatalog`, `info` is `classifyForEdition(markers, index, edition)` when `adapter.dualEdition`.
  - Without `source`, `edition` = `requested`. With `source`, it is the source book's edition when that is 2024 or 2014, else `requested`.
  - The twin grouping in `selectFlat` uses the same `info`. A dual entry that is the only member of its group is therefore picked under either edition with no reason line.
- [ ] Step 3: Run `npx vitest run tests/equipment-editions.test.ts tests/edition-search.test.ts` and then the full checks. Update CLAUDE.md:
  - Mark (e) done, with root cause "ids repeat across entityTypeIds; 60 weapons and armour were dropped".
  - Add the catalog dual rule to the `ddb_get_equipment` tool notes.
- [ ] Step 4: Commit `fix(equipment): keep items that share an id across item types; dual-edition items take the requested edition`.

### Task 5: Rename pairs by kind (carry-over (a), (n) candidate) — Opus

**Files:** Modify `src/edition-renames.ts`, `src/edition.ts`, every `twinName` / `twinAliases` / `classOwnerTwinKey` caller (`src/tools/reference.ts`, `src/tools/monster.ts`, `src/tools/spell-store.ts`, `src/open5e.ts`), and `scripts/dump-edition-renames.mts`. Tests: `tests/edition.test.ts` and others.

**Produces:**
- `export type RenameKind = "spell" | "item" | "monster" | "subclass" | "background"` in `src/edition-renames.ts`.
- `EDITION_RENAMES: Readonly<Record<RenameKind, ReadonlyArray<readonly [name2014: string, name2024: string]>>>`. Keep the existing section comments and the evidence comments. Magic items, poisons and gear are all `item`.
- `export const ALL_EDITION_RENAMES` is the flat list, for the dump script and tests.
- `export const twinNames: Readonly<Record<RenameKind | "none", TwinNamer>>` in `src/edition.ts`. `none` has no pairs and is used by feats, species, classes and racial traits.
- The generic `twinName` export is **removed**, so every caller has to choose a kind. `twinAliases(name, namer)` takes the namer as a required argument. `classOwnerTwinKey(className, subclassName, namer = twinNames.subclass)`. `LookupOptions.twinName` becomes required.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `a monster lookup for Evoker queries only Evoker`: `twinAliases("Evoker", twinNames.monster)` equals `["Evoker"]`.
  - `the feat namer does not map Thug to Tough`: `twinNames.none("Thug") === "thug"`.
  - `the background namer does not twin Acolyte with Priest Acolyte`.
  - `the item namer does not twin with the Mule monster`: `twinNames.monster("Donkey (or Mule)") === "donkey (or mule)"`.
  - Keep the chain, duplicate and self-map tests, per kind and across the flat list.
  - `the spell store keys by the spell namer` (Review Focus 2).
- [ ] Step 2: Restructure the table and update every caller to its kind:
  - spells, `spell-store.ts` and `isConcentrationSpell` → `spell`
  - items and equipment → `item`
  - monsters → `monster`
  - class-feature owners → `subclass`
  - backgrounds → `background`
  - feats, races, classes and racial traits → `none`
  - Open5e builds one namer per kind from `EDITION_RENAMES[kind]`, plus `OPEN5E_ARMOUR_RENAMES` for `item`. Each endpoint uses its kind: spells → spell, creatures → monster, items/magicitems/weapons/armor → item, backgrounds → background, everything else → none.
- [ ] Step 3: Carry-over (n) candidate: "Dwarven Plate" (id 4626, Legacy, sources 1, 2) → "Dwarven Plate Armor" (id 9228526, sources 146, 148).
  - Read both `description`s in `.claude/probe-2026-10-23/items-ss2.json`.
  - If they are the same item at the same rarity, with text that is clearly a revision, add `["Dwarven Plate", "Dwarven Plate Armor"]` to `item`, with the usual evidence comment.
  - If not, say so in the report.
  - Update (n) in CLAUDE.md: "D&D Beyond names the seven base armours with bare names (Leather, Padded, … ids 9–18), so no D&D Beyond pairs are needed; verified live 2026-10-23."
- [ ] Step 4: Run the full checks and mark (a) done in CLAUDE.md. Commit `refactor(edition): rename pairs are scoped to their content kind`.

### Task 6: `source: "homebrew"` on the catalog tools (carry-over (f), decision 7) — Sonnet

**Files:** Modify `src/source-filter.ts`, `src/tools/monster.ts`, `src/tools/reference.ts`, `src/tools/edition-search.ts`, and `src/server.ts` (the `SOURCE_PARAM` description). Test: create `tests/homebrew-source.test.ts`.

**Produces:**
- Move `isHomebrewSource(source: string | undefined): boolean` from `monster.ts` into `src/source-filter.ts`, exported.
- `resolveSourceParam` returns `ResolvedSource | "homebrew" | string | undefined`.
- `selectCatalog` / `lookupCatalog` accept `source?: ResolvedSource | "homebrew"`.
  - Homebrew mode keeps entries with `markers.isHomebrew === true` that pass the filters.
  - Labels are `HOMEBREW_INFO`; there is no grouping or hiding.
  - The header is `searchHeader({ sourceBook: HOMEBREW_SOURCE_BOOK })`, with no source note.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `ddb_search_spells source homebrew lists only homebrew spells, tagged [homebrew] and wrapped`.
  - `ddb_get_equipment source homebrew finds a homebrew item and ignores an official twin`.
  - `logged out, a catalog source homebrew search says it needs login`: exactly `Homebrew <kind> lookup requires login. Run ddb_login first.`.
  - `D&D Beyond unreachable: the homebrew unreachable message, no Open5e`.
  - `source " HomeBrew " is reserved (case and whitespace)`.
  - `no homebrew match: "No homebrew <plural> found matching the criteria."`.
- [ ] Step 2: Implement it for spells, equipment (get and search), races, classes, backgrounds, feats, class features and racial traits.
  - The monster message constants become `homebrewLoginRequired(kind: string)` and `homebrewUnreachable(kind: string)` in `src/edition.ts`.
  - The monster text stays as it is today: `homebrewLoginRequired("monster")` gives `Homebrew monster lookup requires login. Run ddb_login first.`
- [ ] Step 3: Run the full checks. Mark (f) done and update the `source` tool notes. Commit `feat(catalog): source "homebrew" lists homebrew entries only, as on the monster tools`.

### Task 7: Narrow fallback `try`s; no-name text; species tiebreak; offset past end (carry-overs (i), (j), (k), QA #6, work item 8) — Sonnet

**Files:** Modify `src/tools/reference.ts`, `src/tools/edition-search.ts` (`paginateResults`). Tests: `tests/options-editions.test.ts`, `tests/spell-editions.test.ts`, `tests/edition-search.test.ts`.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `a selection bug surfaces instead of an Open5e "unavailable" answer`: make a mocked adapter `compare` throw. `searchItems` and `getSpell` reject with that error, and `o5*` is not called. This covers `searchCatalogList`, `getSpell`, `getItem` and the `searchSpellsSection` catch.
  - `a no-name race search with no match says "matching the criteria"`, not `"undefined"`. Same for classes and backgrounds.
  - `two species with one entityRaceId and different entityRaceTypeId order the same whatever the input order`. Covers `RACE_ADAPTER` and the racial-trait owner tiebreak.
  - `an offset past the end prints the past-the-end line`: `paginateResults("Races", 20 items, f, 30, 30)` returns `**Races Search** — offset 30 is past the end (20 found)`. `searchSpells` uses the same helper and wording, replacing its private guard.
- [ ] Step 2: Implement:
  - Only the compendium or list load sits inside each fallback `try`.
  - `notFound` uses `params.name ? `matching "${params.name}"` : "matching the criteria"`.
  - The species tiebreak becomes `definitionTiebreak` then `entityRaceTypeId`.
  - `paginateResults` returns the past-the-end line when `offset >= total > 0`.
- [ ] Step 3: Run the full checks. Mark (i), (j), (k) and item 8 done. Commit `fix(catalog): fallbacks catch only load failures; no "undefined" in no-name replies; total species order; offset past end`.

### Task 8: Source index in parallel; config fetch deadline; library list cache (QA #3, #12, carry-overs (h), (ac)) — Sonnet

**Files:** Modify:
- `src/game-config.ts`
- `src/tools/reference.ts` (each `await spec.load(); await getSourceIndex()` pair, and lines ~440, 504, 688, 754, 1183)
- `src/tools/character.ts` (`parseCharacter`), `src/tools/party.ts` (`getParty`), `src/tools/character/definition.ts`
- `src/tools/library.ts`

Tests: `tests/game-config.test.ts`, `tests/library-editions.test.ts`.

**Produces:**
- `CONFIG_FETCH_TIMEOUT_MS = 10_000` in `game-config.ts`. When the shared fetch runs past it, every caller resolves `null`, the pending slot is released, and the failure is remembered for `CONFIG_FAILURE_TTL_MS` (the same as any failure).
- `fetchLibraryBooks()` is cached for 60 s in a `TtlCache`. It is keyed by session generation and dropped by an `onSessionInvalidated` hook. Failures are not cached.

**Steps:**

- [ ] Step 1: Add failing tests (fake timers):
  - `a stalled config fetch resolves null at the deadline and frees the slot`.
  - `the stalled fetch's late settlement records nothing`.
  - `a catalog search starts the source index and the load together`: assert both are pending before either resolves.
  - `readBook resolves a title without tagging the library` (`getSourceIndex` called once per read).
  - `two reads of an unjoined slug fetch the library page once`.
  - `a session change drops the library cache`.
- [ ] Step 2: Implement:
  - `Promise.all([load, getSourceIndex()])` at each site.
  - `parseCharacter` starts `getSourceIndex()` before awaiting the fetch.
  - `getParty` starts it alongside the batch.
  - `resolveBookSlug` calls `fetchLibraryBooks()`, not `listLibrary()`.
- [ ] Step 3: Run the full checks. Mark (h) and (ac) done. Commit `perf: fetch the source index alongside the data; deadline on the shared config fetch; cache the library list`.

### Task 9: Open5e loader hardening (QA #4, #5, carry-overs (s), (v), (w)) — Sonnet

**Files:** Modify `src/open5e.ts` (`fetchPages`, `loadO5Document`, `clearOpen5eCache`), `src/tools/encounter.ts`. Tests: `tests/open5e-v2-filters.test.ts`, `tests/open5e.test.ts`.

**Produces:**
- `O5_FAILURE_TTL_MS = 60_000`: a per-URL failure memo. `loadO5Document` rejects with the remembered error without fetching. `clearOpen5eCache()` also clears the memo.
- `O5_DOCUMENT_DEADLINE_MS = 30_000`: one deadline across all pages of a document, combined with the 20 s per-request timeout via `AbortSignal.any`.
- `fetchPages` throws when:
  - `resp.url`'s origin is not `O5_ORIGIN` (redirect check);
  - a document yields 0 records;
  - the first page's `count` exceeds the records collected.
- `rateEncounter` resolves distinct monster names concurrently, as `treasure.ts` does. Output order is unchanged.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `a failed document is remembered for 60 s, then retried`.
  - `clearOpen5eCache drops remembered failures` (Review Focus 4).
  - `concurrent callers all reject on one shared failure` (v).
  - `a paged response is document-filtered` (v).
  - `an empty 200 is not cached and fails the call`.
  - `count above the records collected fails`.
  - `a redirect to another origin fails`.
  - `a stalled multi-page load fails at the document deadline`.
  - `rateEncounter resolves names concurrently`: two pending lookups observed before either settles; output order matches input.
  - Fix (w): replace `every()` with a length check plus `every()`, and add the `https://api.open5e.com.evil` and `http://api.open5e.com` origin cases.
- [ ] Step 2: Implement, then run the full checks. Mark (s), (v) and (w) done. Commit `fix(open5e): remember failures for a minute, one deadline per document, reject empty or off-origin responses`.

### Task 10: Open5e equipment twin keys M1–M3 and 6 hand pairs (carry-over (r), decision 6) — Opus

**Files:** Modify `src/open5e.ts`, `src/edition-renames.ts` (`OPEN5E_EQUIPMENT_RENAMES` beside `OPEN5E_ARMOUR_RENAMES`). Test: `tests/open5e.test.ts`. The fixtures may gain the records the tests need (record them with `scripts/record-open5e-fixtures.mts` or copy them from `.claude/probe-2026-10-23/open5e/data`).

**Produces:** `o5EquipmentKey(name: string): string`. It is the item-kind `o5TwinName` key, normalised in order:
- **M1:** `+N` → `plusN`; every non-alphanumeric → space; unique tokens sorted.
- **M2:** also drop the tokens `sword` and `weapon`.
- **M3:** before M1, strip trailing parentheticals that are a price, a count or a measure: `(N GP)`, `(N)`, `(N feet)`, `(per day)`, `(vial)`, `(flask)`, `(bow)`, `(1 piece)`, `(bag of 1000)`. Strip the prefixes `Musical Instrument, `, `Gaming Set, `, `Druidic Focus, ` and `Holy Symbol, `. Drop the token `set` and a stray `)`. Fold a trailing plural `s` per token.

It is used as the twin key for the items, magicitems, weapons and armor endpoints only. Use the exact rule set in `.claude/probe-2026-10-23/open5e/q1d.mts` / `q1e.mts`, which produced the 120 hand-checked pairs. The 6 hand pairs go in `OPEN5E_EQUIPMENT_RENAMES`:
- Iron Bands of Binding ↔ Iron Bands
- Orb of Dragonkind ↔ Dragon Orb
- Deck of Many Things ↔ Mysterious Deck
- Figurine of Wondrous Power (Obsidian Steed) ↔ Figurine of Wondrous Power (Obsidian Stead)
- Crossbow bolt ↔ Bolts (20)
- Lamp oil (flask) ↔ Oil

Before adding each pair, verify both records' `desc` in the probe data, with an evidence comment per pair. Drop any pair that fails.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `Hand Crossbow under 2014 shows SRD 5.1 Crossbow, hand with a rename line`.
  - `a 2024 flame tongue search hides the 4 SRD 5.1 Flame Tongues and counts them`.
  - `Vicious Weapon (Light-Hammer) twins Vicious Light Hammer`.
  - `Smith's tools twins Smith's Tools (20 GP)`.
  - `Net (+1) does not twin mundane Net, and Shield (+1) does not twin Shield` (no false twins).
  - `the whole-document pairing count`: a test over the probe data copied into a fixture asserts 126 pairs and lists none of the known false pairs. If the copied data is too large to commit, assert on a 30-record sample with the expected pairs.
- [ ] Step 2: Implement. Rename-line suppression keeps working: no rename line when the shown entry carries the other edition's spelling, or when the names differ only by punctuation, order or the stripped parts. Generalise the existing punctuation-only rule to "same `o5EquipmentKey` and same `o5Folded` token multiset".
- [ ] Step 3: Run the full checks. Update (r) in CLAUDE.md: done for M1–M3 plus 6 pairs. The remaining ~128 SRD 5.1 and ~356 SRD 5.2 names are one-to-many or edition-only and stay unpaired by design. Commit `fix(open5e): equipment twin keys fold word order, weapon words and price or count parts; six verified pairs`.

### Task 11: Open5e monster and filter fixes; ambiguity cap (QA #7, #8, #9, #10, #11, carry-overs (u), (x)) — Sonnet

**Files:**
- Modify `src/open5e.ts`: `o5GetMonsterStats`, `formatO5Monster`, the filters at ~345 and ~536, the item search at ~683.
- Modify `src/edition.ts`: `ambiguityMessage`.

Tests: `tests/open5e.test.ts`, `tests/encounter.test.ts` (or the existing treasure and encounter test file).

**Steps:**

- [ ] Step 1: Add failing tests:
  - `ambiguityMessage lists at most 20 and counts the rest`:
    - With 25 candidates, the output ends `…, and 5 more — use the full name.`
    - It names exactly 20.
    - With 20 or fewer, the format is unchanged.
  - `a 2024 creature with an unrecognised CR is not-found, not its 2014 twin` (#8). Inject `challenge_rating: 0.3` on the 2024 twin.
  - `Open5e matches school, type and size by part of a word`: `size: "med"` lists Medium creatures; `school: "evoc"` lists Evocation spells.
  - `a legendary creature's block carries the per-round note` (#10), exactly `(Uses per round aren't in the Open5e SRD data — usually 3.)` on the line after `LEGENDARY ACTIONS`.
  - `a hovering creature prints (hover) after fly` (u), with a synthetic record.
  - `an item record with a null rarity or category doesn't break the search` (#9).
  - Fix (x): `tests/open5e.test.ts` "a get keeps the query jump and the max_chars note" asserts by finding the jump line, not `slice(3)`.
- [ ] Step 2: Implement:
  - Cap in `ambiguityMessage` (by the caller's order: CR, then name).
  - In `o5GetMonsterStats`, select the edition over all name-matched records first. A picked record with an unknown CR is not-found (exact or single group), or is dropped from the ambiguous candidates.
  - `lowerEq` → a part-word helper for school, type and size. Rarity keeps exact.
  - Optional chaining on `rarity` and `category`.
- [ ] Step 3: Run the full checks. Mark (u) done and update the tool notes. Commit `fix(open5e): cap ambiguity lists, fail closed on unknown CR, part-word filters, legendary uses note`.

### Task 12: `ddb_search_site` keeps hidden counts from dropped sections (carry-overs (g), (o), (x)) — Opus

**Files:** Modify `src/tools/search.ts`, `src/open5e.ts` (the `o5Search*` functions used by the site search), `src/tools/reference.ts`, `src/tools/monster.ts` (the section builders that wrap Open5e). Test: `tests/search-site.test.ts`.

**Produces:** The six `o5Search*` functions that `search.ts` reaches (spells, monsters, items, races, classes, feats) return or expose `{ header: string; body: string; footer: string | null; hidden: number }`: header = the `open5eSearchHeader` line, body = the listing or the no-match line. String-returning wrappers keep their current output byte-for-byte.

- [ ] Step 1: Add failing tests:
  - `a D&D Beyond section that lists nothing but hides 3 twins adds 3 to the combined footer`.
  - `an Open5e section that lists nothing but hides twins is dropped and its count kept`.
  - `an all-Open5e "all" reply with one hidden-only section has no combined header and keeps the footer count`.
  - Fix (x): the "skips an empty 'No items found …' section" test uses the real `o5SearchItems` no-match output, not a hand-built string.
- [ ] Step 2: Implement. `search()` adds `hidden` from every section, dropped or not. Emptiness is judged on `body` (without the Open5e header line).
- [ ] Step 3: Run the full checks. Mark (g) and (o) done. Commit `fix(search): the site search footer counts twins hidden in sections it drops`.

### Task 13: Logged-out monster lookups use monster-service; monster edges (work items 4, 5) — Opus

**Files:** Modify `src/tools/monster.ts` (`searchMonsters`, `getMonster`, `getMonsterStats`, `availableSourcesFor`, the CR filter, the header counts). Tests: `tests/monster.test.ts`, `tests/monster-session.test.ts`.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `logged out, getMonster asks monster-service anonymously (no cookie header) and labels the D&D Beyond result`.
  - `logged out and monster-service fails, the Open5e fallback and its label apply` (Review Focus 5).
  - `logged out, source homebrew still says it needs login`.
  - `getMonsterStats logged out resolves from monster-service`.
  - `an unknown cr is an error`: `searchMonsters({ cr: 999 })` returns exactly `Unknown CR "999". Valid CRs: 0, 1/8, 1/4, 1/2, 1–30.`
  - `the checked count never exceeds the total`: the total grows mid-scan, and the output reads `checked 160 of 160`.
  - `a name search that fills the 100-entry cap for a spelling says so`: the header adds `(the first 100 matches per name were checked)`.
  - `availableSourcesFor uses the caller's session snapshot`.
  - `a single bold span over 8 MB is parsed without a regex backtrack`. Find the regex at the stat-block or description parser that CLAUDE.md item 5 names, and replace it with an `indexOf` scan.
- [ ] Step 2: Implement:
  - Logged out: monster-service is called with no credentials (plain `fetch` with the same retry helper and a 20 s timeout). Only a failure or an empty answer goes to Open5e.
  - `hasValidSession()` still gates homebrew and the logged-in-only paths.
  - The 2-of-518 partial-scan twin case stays as it is: the header already says the scan was partial. Record that in item 5.
- [ ] Step 3: Run the full checks. Mark items 4 and 5 done. Commit `feat(monster): logged-out lookups ask monster-service first; unknown CR error, honest scan counts`.

### Task 14: Copy, conditions and entities (QA #13, #14, #15, carry-overs (af), (t)) — Sonnet

**Files:** Modify `src/edition.ts` (`sourceNote`), `src/tools/reference.ts:816`, `src/tools/monster.ts:699,841`, `src/tools/conditions.ts` (`getCondition`), `src/utils.ts` (`decodeEntities`), `src/server.ts` (`rarity` description). Tests: `tests/edition.test.ts`, `tests/conditions.test.ts`, the utils test.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `sourceNote is neutral`: `sourceNote("xgte","2014","2024")` returns `(source "xgte" is a 2014 book — its entries are listed whatever rules_edition says)`.
  - `fallback errors say D&D Beyond`: three strings, `DnD Beyond` → `D&D Beyond`.
  - `an ambiguous partial condition lists the candidates`: `getCondition("ed")` returns `Condition "ed" is ambiguous: Blinded, Deafened, Frightened, Grappled, Incapacitated, Paralyzed, Petrified, Poisoned, Restrained, Stunned — use the full name.` Build the list from the table in table order. Assert the prefix and that every listed name contains "ed". A unique partial (`"exhaus"`) still resolves.
  - `stripHtml decodes &rsquo; &lsquo; &ldquo; &rdquo; and hex numeric entities` (af). Check this against the library title join as well: a description `Player&rsquo;s Handbook` matches the title `Player's Handbook`.
  - The `rarity` param description says `exact (rare does not include Very Rare)` (t).
- [ ] Step 2: Implement. Run the full checks. Mark (af) and (t) done. Commit `fix(copy): neutral source note, D&D Beyond spelling, ambiguous condition names, apostrophe entities`.

### Task 15: Character edges (carry-overs (ad), (ae)) — Sonnet

**Files:** Modify `src/tools/character/identity.ts` (`deriveRace`, `computeIdentity`), `src/tools/character/spells.ts` (`buildSpellSections`). Tests: `tests/character-editions.test.ts`, `tests/character-parser.test.ts`.

**Steps:**

- [ ] Step 1: Add failing tests:
  - `race null with an options.race lineage prints the lineage alone, untagged`: the header shows `Wood Elf | …`. The output has no ` (Wood Elf)` and no `[edition not stated]` there.
  - `a duplicate warning ignores an unprepared Wizard spell the SPELLS section doesn't print`. Seed duplicate detection from the same gated list the section prints.
- [ ] Step 2: Implement. Run the full checks. Mark (ad) and (ae) done. Commit `fix(character): a bare lineage has no tag; duplicate warnings follow the printed spells`.

### Task 16: Docs and the QA report — Sonnet

**Files:** Modify `CLAUDE.md`, `README.md`, `QAREPORT.md` (unstaged).

- [ ] Step 1: Update CLAUDE.md:
  - **Next steps:** mark items 4, 5, 7, 8 and 9 and F-2026-10-20 fixed, with commit hashes.
  - **Carry-overs:** mark (a), (e), (f), (g), (h), (i), (j), (k), (o), (r), (s), (t), (u), (v), (w), (x), (ac), (ad), (ae) and (af) done, each with a hash.
  - Keep (q), (y), (z), (ab) as they are. Keep (aa) and (b) open, adding the evidence that the free account lists no locked subclasses.
  - Update the "Last updated" line, and the tool notes and module table where behaviour changed.
- [ ] Step 2: Update README tool rows: `source: "homebrew"` on catalogs, exact `rarity`, and logged-out monsters.
- [ ] Step 3: In `QAREPORT.md`, set each finding's Status:
  - `✅ Fixed (<hash>)` for fixed findings;
  - `➖ No change` for #16.
- [ ] Step 4: Run `npm run lint`. Commit only `CLAUDE.md` and `README.md`: `docs: QA findings and carry-overs closed`.
