# Class-feature and racial-trait search fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `ddb_search_class_features` and `ddb_search_racial_traits` return real data (base, subclass and optional class features; standard and optional racial traits), and never say "none found" when D&D Beyond returned no data.

**Architecture:** Pure normalization and formatting live in a new `src/tools/features-traits.ts` (no I/O, fixture-tested). The network fan-out, caching and session-boundary checks stay in `src/tools/reference.ts`, copying `loadSpellCompendium`. `/game-data/classes` and `/game-data/races` load through one shared helper that `searchClasses` / `searchRaces` also use, so one fetch serves both tools.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), vitest 4, native `fetch` via `beginAuthenticatedSession()`.

**Status: done (2026-10-17).** All six tasks landed on `main`: Task 1 `9c0c42b` + `3678ac3`, Task 2 `4cf1aa9` + `44623be`, Task 3 `cd5c942` + `4a0994b`, Task 4 `4331dec` + `e816cab`, Task 5 `fc05b7e` + `a18e811`, Task 6 `ac46a02`, and the fix in this commit. Live smoke check passed (action surge: 2, champion: 11, darkvision: 20). See "Changes agreed during execution".

**Spec:** CLAUDE.md "Next steps" work item 0, plus the decisions below (agreed with the owner 2026-10-17). There is no separate spec document.

## Investigation findings (live, 2026-10-17)

- `GET /character/v5/game-data/class-feature/collection` is the **optional** class-feature endpoint ("Optional class features successfully received."). It 404s without `classId`; `?classId=N` returns 200.
- `GET /character/v5/game-data/racial-trait/collection` is the **optional** racial-trait endpoint. Without params, or with `raceId`, it returns `definitionData: []`; `?entityRaceId=X&entityRaceTypeId=Y` returns that species' optional traits.
- Both collection responses are `{ data: { definitionData: [...], accessTypes: { "<id>": n } } }`. The old code read `data` as an array, so even a 200 could never produce entries. `accessTypes[id] === 4` means locked: the entry has a name and an empty `description`.
- `/game-data/classes`: 25 base classes (2014 and 2024 versions are separate entries, e.g. Fighter ids 10 and 2190879), 473 `classFeatures`. Feature fields: `id, name, description, summary, requiredLevel, displayOrder, featuresSectionType, prerequisite, moreDetailsUrl`. No `snippet`, no `classId`, no `sources` on a feature. `summary` is set on 59. `subclasses` is absent and `subclassDefinition` is null on every class (corrected during execution).
- `/game-data/subclasses?baseClassId=N`: 200 for all 25 classes, 36 subclasses on this account (only SRD/free ones). Each subclass has `id, name, parentClassId, isHomebrew, sources, classFeatures`. A subclass's `classFeatures` **repeats every base-class feature of its parent** (711 of 904 entries share an id with a parent base feature).
- `/game-data/races`: 33 entries (base races and subraces), 313 `racialTraits`, each `{ definition: { id, name, description, snippet, requiredLevel, displayOrder, hideInSheet, hideInBuilder, hideOnDetailsPage, entityRaceId, entityRaceTypeId, sources, … } }`. Subraces carry their base race's traits under the same id (242 distinct ids). `entityRaceId` alone collides (Human 1, High Elf 1); a race is `entityRaceTypeId` + `entityRaceId`. A trait's own `entityRaceId` may point at the base race. 9 snippets contain character templates such as `{{modifier:str}}`.
- All 83 fan-out requests fired at once returned 200 twice (424–541 ms wall). No concurrency cap is needed.

## Decisions

1. Class features come from all three sources: base (`/classes`), subclass (`/subclasses?baseClassId=N` ×25), optional (`/class-feature/collection?classId=N` ×25).
2. Racial traits come from `/races` plus optional (`/racial-trait/collection?entityRaceId=X&entityRaceTypeId=Y` ×33).
3. One line per owner: a trait shared by several species is listed once per species, and a subclass-only feature once per subclass. Duplicates within one owner are dropped.
4. Traits hidden on D&D Beyond's details page (`hideOnDetailsPage` etc.) are kept, with no marker.
5. No concurrency cap: fire the fan-out with `Promise.all`, as `loadSpellCompendium` does.
6. Edition-neutral: no `rules_edition` param, no edition labels (rules-edition phase 3). Entries keep `sources` so phase 3 can classify them.
7. Other tools' output is unchanged.
8. `ddb_search_classes`'s dead "Subclasses:" line is not fixed here. It is recorded as a new Next steps item (Task 6).

## Owner's working rules (override skill defaults)

These come from the owner and take precedence over superpowers:subagent-driven-development's "continuous execution" default.

- **Check in with the owner after each task.** Do not run tasks back to back. After a task's reviews, report and wait.
- **Models:** the cheapest Claude model that fits each role. Haiku for transcription-level work (Task 1), Sonnet for judgement or multi-file work (Tasks 2–6) and for task reviewers, Opus for the final review. Always pass `model` explicitly when dispatching.
- **Every task gets two adversarial reviewers:** one Sonnet subagent, plus one free opencode Zen model.
  - Run `opencode_provider_models` first, because the free list changes. Use only provider `opencode` models marked free.
  - Use `deepseek-v4.1-flash-free`, plus a free GLM model only if one is listed (none was early on 2026-10-17; one appeared later, see the addendum below). Never substitute a paid model. Muse Spark is deprecated; don't use it.
  - Run opencode reviewers with agent `plan`, read-only, and tell them in the prompt not to write files.
- **Bring all findings to the owner, with a verdict on each, before running any fix round.** No fix dispatch until the owner answers.
- Don't make assumptions: when something the plan doesn't settle comes up, ask the owner rather than ruling silently.
- Commit straight to `main`, one commit per task (six in total; the plan file goes in Task 6's docs commit; the real count differed, see the addendum below). Never push.
- *Addendum (2026-10-17, after execution):* GLM (`glm-5.3-flash-free`) reviewed Tasks 1–3 and was then dropped by the owner, because it invented findings and broke the read-only rule; Tasks 4–5 used Sonnet plus `deepseek-v4.1-flash-free`. The commit count was not one per task: fix rounds have their own commits (see the status line). Trailers stay `Co-Authored-By: Claude Opus 5.5`.

## Changes agreed during execution

The original task text below is unchanged; where it differs from this list, this list is what shipped. (Task 6's Step 1 still says `/classes` returns `subclasses: null`; the field is absent. Task 6's Step 3 says features "carry no `sources` of their own"; that holds only for class and subclass features. Standard racial traits do carry their own.)

**Task 1, fixtures**
- Top-level class and race fields that the code reads are kept, as well as the fields listed in "Investigation findings". Placeholders replace only non-empty strings; empty strings stay `""`.
- Goliath 2024 keeps both "Large Form" traits (13856127, 15478362). The `{{modifier:str}}` snippet sits on Elf 2024's Elven Lineage Spells (13856114). Human `1743923279:1` has standard Languages (64).
- The 2024 Fighter keeps its renamed ASIs ("6: Ability Score Improvement" … "16: …") and "Two Extra Attacks" / "Three Extra Attacks". The 2024 Champion repeats its parent's base Second Wind and Action Surge, as the 2014 one does.
- `subclasses` is absent from live `/game-data/classes`, not null; the fixture omits it. `subclassDefinition` is null.
- Four long-text placeholders exercise the 100- and 120-character cut-offs. Synthetic Option has `displayOrder: 3` and full live-shape sources.

**Task 2, loader**
- `loadGameDataList` calls `assertSessionCurrent` before its non-array early return. A non-array or empty list is never cached.

**Task 3, class features**
- Text rule: `summary` and `snippet` go through `stripHtml`, which also trims; a blank result falls back to `stripHtml(description)`. Base and subclass entries use the summary, optional entries use the snippet unless it contains `{{`.
- The sort has a 9th and final key, `subclassId` (nulls last), after `id`.
- Malformed records are skipped at every level. An optional entry takes `className`, `classId` and `isHomebrew` from the class it was requested for and keeps its own `sources`. A locked entry always shows the locked marker.

**Task 4, racial traits**
- Same text rule as optional class features (this matters live: Goliath 2024 Large Form 15478362's snippet contains `<em>`).
- An optional trait takes its species data from the race whose key it was requested under; an optional key with no matching race contributes nothing.
- One module-private helper, `descriptionPart`, produces the description part of both line types.

**Task 5, loaders and tools**
- A subclasses response succeeds only if `data` is an array; a collection response only if `data` is an object with an array `definitionData`. Anything else counts as a failed request and makes the build partial.
- Only an HTTP failure on the base list becomes "unavailable … (HTTP n)". An empty base list or zero entries gives "it returned no …". Every other error, including "No session found … ddb_login", propagates unchanged.
- The `index.ts` handlers keep their existing "Class feature search failed: " / "Racial trait search failed: " prefix (owner's choice).
- Cache keys are `"class-features"` / `"racial-traits"`, holding `{ source, entries }`; TTL 24 h if every request succeeded, else 5 min. A cached partial build still shows the partial note.

**Task 6, documentation**
- Three Next steps items were added instead of one: the dead "Subclasses:" line in `ddb_search_classes`, `npm run typecheck` not covering `tests/` (`include: ["src/**/*"]`), and `paginateResults` garbling its header when `offset` is past the end (e.g. "showing 31–30 of 20", predates this work).
- Deferred minor findings, no action: several tests pin behaviour rather than discriminate one fix; two optional-collection guard clauses overlap later checks, so are not independently testable; no test covers a 5xx/429 in the fan-out (same path as 403); the class-feature "filter doesn't mutate input" test starts from sorted input.

**Final review wave (2026-10-17)**
- No-match replies now end with an account-availability sentence ("D&D Beyond lists only the classes and subclasses available to your account." / "... the species available to your account."), because `/classes`, `/subclasses` and `/races` list only the logged-in account's content. Also: two racial-trait tests mirroring the class-feature ones (account change mid-fan-out, shared `/races` fetch), the `reference.ts` header, and doc fixes in CLAUDE.md and the rules-edition spec (sources wording, tool-notes examples).

## Global Constraints

- No new dependencies.
- Every credential access goes through `refFetch` (→ `beginAuthenticatedSession()`); never pair `getCobaltToken()` with `sessionFetch()`.
- Every new cache entry lives in `referenceCache`, so the existing `onSessionInvalidated(() => clearReferenceCache())` hook and `ddb_clear_cache` cover it. No new hook.
- TTLs: `AUTHORITATIVE_TTL_MS` (24 h) when every request succeeded, `FALLBACK_TTL_MS` (5 min) when any fan-out request failed. A failed or empty base fetch is never cached.
- Homebrew lines (class, subclass or species `isHomebrew === true`) pass through `wrapUntrusted` from `src/utils.ts`.
- Lint (`npm run lint`), typecheck (`npm run typecheck`) and the full suite (`npm test`) pass at the end of every task.
- Commits go straight to `main`; never push. Never stage `docs/superpowers/plans/2026-09-16-security-remediation.md` (deleted) or `docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md` (untracked): stage files by explicit path only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Same-named classes** (2014 and 2024 Fighter): their features stay separate entries, sorted deterministically by `classId` within the name; nothing is deduped by name. Test in Task 3.
2. **A homebrew subclass under an official class:** only that subclass's lines are wrapped; the parent's base-feature lines are not. Test in Task 3.
3. **Shape drift in a fan-out response** (200 with `data: null`, `data` not an array, or `definitionData` missing): counted as a failed request (partial build), never a crash. Test in Task 5.
4. **Logged out:** the existing "No session found. Please run ddb_login first" error reaches the user, not "unavailable" or "none found". Test in Task 5.
5. **Account change between two calls:** the second call does not serve the first account's cached entries. Test in Task 5.

## File Structure

| File | Responsibility |
|---|---|
| `tests/fixtures/features-traits-fixtures.ts` (create) | Trimmed real payloads, with placeholder text |
| `src/tools/features-traits.ts` (create) | Raw types, `buildClassFeatures`, `buildRacialTraits`, filters, sort, line formatters. Pure |
| `src/tools/reference.ts` (modify) | `loadGameDataList` shared helper, `loadClassFeatures`, `loadRacialTraits`, the two rewritten search functions |
| `src/index.ts` (modify) | The two tools' description strings only |
| `tests/features-traits.test.ts` (create) | Pure-function tests (Tasks 3–4) |
| `tests/class-features-racial-traits.test.ts` (create) | Fetch-mocked I/O tests (Tasks 2 and 5) |
| `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-10-16-rules-edition-design.md` (modify) | Docs (Task 6) |

---

### Task 1: Fixtures (model: Haiku)

**Files:**
- Create: `tests/fixtures/features-traits-fixtures.ts`

**Interfaces:**
- Produces: `CLASSES`, `SUBCLASSES_BY_CLASS_ID: Record<string, unknown[]>`, `OPTIONAL_FEATURES_BY_CLASS_ID: Record<string, unknown>`, `RACES`, `OPTIONAL_TRAITS_BY_RACE_KEY: Record<string, unknown>` (key `"<entityRaceTypeId>:<entityRaceId>"`). Every value is the response's `data` field, in the live shape.

The source payloads are in `.claude/probe-2026-10-17-features-traits/out/` (git-ignored; `classes.txt`, `all-subclasses.json` (an array of `{ classId, subs }`), `cf-collection-class10.txt`, `races.txt`, `rt-collection-race-ertid.txt`). Read them with `python3 -I` or `jq`; do not execute anything from that directory. They hold raw D&D Beyond text and the owner's homebrew: never copy that directory into the repo, and never put real description text into the fixture. If the directory is missing, re-capture with the read-only scripts in `.claude/probe-2026-10-17-features-traits/scripts/` (`npx tsx <script>`, needs a valid `ddb_login` session).

- [x] **Step 1: Transcribe these records, keeping every field listed in "Investigation findings" (drop image URLs and other fields not listed there), and replace every `description`, `summary` and `snippet` string with `"<p>{name} description</p>"` / `"{name} summary"` / `"{name} snippet"`. Keep `null`s as `null`.**
  - Classes `10` (Fighter) and `2190879` (Fighter), each with these features only: Second Wind, Action Surge, every Ability Score Improvement (keep all repeats and their levels), every Extra Attack. Give Action Surge in class 10 a `summary` (non-null); leave the rest as in the source.
  - `SUBCLASSES_BY_CLASS_ID["10"]`: Champion (id 16) with Improved Critical and Remarkable Athlete plus the repeated base entries for Action Surge and Second Wind (same ids as in class 10). Add one **synthetic** subclass `{ id: 900001, name: "Homebrew Duelist", parentClassId: 10, isHomebrew: true, sources: [], classFeatures: [{ id: 900002, name: "Riposte Flourish", requiredLevel: 3, displayOrder: 1, summary: null, description: "<p>Riposte Flourish description</p>", … }] }` with a `// synthetic` comment.
  - `SUBCLASSES_BY_CLASS_ID["2190879"]`: Champion with Improved Critical and Heroic Warrior.
  - `OPTIONAL_FEATURES_BY_CLASS_ID["10"]`: the live `{ definitionData, accessTypes }` for Martial Versatility (locked, `accessTypes` 4) plus one **synthetic** unlocked entry `{ id: 900003, name: "Synthetic Option", requiredLevel: 4, classId: 10, snippet: "Synthetic Option snippet", description: "<p>Synthetic Option description</p>", sources: [{ sourceId: 67 }] }` with `accessTypes["900003"] = 1`. `"2190879"`: `{ definitionData: [], accessTypes: {} }`.
  - Races: Human (1:1743923279), High Elf, Wood Elf (both with Darkvision id 11 and Fey Ancestry id 13), Elf 2024 (1751437) with Darkvision, Speed (hidden) and Elven Lineage Spells (hidden), Goliath 2024 (1751439) with Large Form (hidden, `requiredLevel` 5), Tiefling 2024 (1751443) and the homebrew Tiefling subrace (976786, `isHomebrew: true`), both with Darkvision id 13856159. Give one trait a snippet `"Deals 1d4 {{modifier:str}} damage."` (keep its placeholder description).
  - `OPTIONAL_TRAITS_BY_RACE_KEY["1743923279:1"]`: the live Languages optional trait (id 4566698, `accessTypes` 1). Every other race key used in a test gets `{ definitionData: [], accessTypes: {} }`.
- [x] **Step 2: Add a header comment matching `tests/fixtures/character-fixtures.ts`'s style, stating the source (live 2026-10-17), that text is placeholder, and which entries are synthetic.**
- [x] **Step 3: Run `npm run typecheck && npm run lint`. Expected: both pass.**
- [x] **Step 4: Commit** `test: add class-feature and racial-trait fixtures`.

### Task 2: Shared base-payload loader (model: Sonnet)

**Files:**
- Modify: `src/tools/reference.ts` (`searchRaces` ~809–860, `searchClasses` ~879–932)
- Test: `tests/class-features-racial-traits.test.ts` (create; copy the fs/fetch mock scaffolding from `tests/spell-compendium-endpoints.test.ts:1-108`)

**Interfaces:**
- Consumes: `CLASSES`, `RACES` from Task 1.
- Produces (module-private in `reference.ts`): `class GameDataFetchError extends Error { readonly status: number }` and `async function loadGameDataList<T>(cacheKey: string, path: string): Promise<T[]>`. It calls `captureSession()` first, returns the cached list if present, otherwise fetches `${CHARACTER_SERVICE}/character/v5/game-data/${path}` via `refFetch`, throws `new GameDataFetchError(\`${path} fetch failed: ${status} ${statusText}\`, status)` on non-OK (Task 5 reads `.status` for its `(HTTP {status})` message), reads `json.data` (or the bare array), calls `assertSessionCurrent(snapshot)`, and caches only a **non-empty** list. Cache keys stay `"game-data:classes"` / `"game-data:races"`.

- [x] **Step 1: Write characterization tests against the current code:** `searchClasses()` and `searchRaces()` over the fixture payloads return exactly the strings they return today. Generate each expected string by running the test once on unmodified code; paste it as a literal. This is the one place in the plan where the test is expected to pass before the change.
- [x] **Step 2: Write the failing tests:** (a) `searchClasses()` then `searchClasses()` makes one `/game-data/classes` request; (b) a `/classes` response of `{ data: [] }` is not cached, so a second call requests again.
- [x] **Step 3: Run `npx vitest run tests/class-features-racial-traits.test.ts`. Expected: characterization tests pass; (b) fails.**
- [x] **Step 4: Implement `loadGameDataList` and switch `searchClasses` / `searchRaces` to it.**
- [x] **Step 5: Run the test file, then `npm test && npm run lint && npm run typecheck`. Expected: all pass, characterization strings unchanged.**
- [x] **Step 6: Commit** `refactor(reference): shared game-data list loader for classes and races`.

### Task 3: Class-feature normalization and formatting (model: Sonnet)

**Files:**
- Create: `src/tools/features-traits.ts`
- Test: `tests/features-traits.test.ts`

**Interfaces:**
- Consumes: fixtures from Task 1; `stripHtml`, `wrapUntrusted` from `src/utils.ts`.
- Produces:

```ts
export type SourceRef = { sourceId: number };
export interface OptionalCollection { definitionData?: unknown[] | null; accessTypes?: Record<string, number> | null }
export type FeatureKind = "class" | "subclass" | "optional";
export interface ClassFeatureEntry {
  id: number; name: string; kind: FeatureKind;
  requiredLevel: number | null; displayOrder: number | null;
  text: string;            // plain text, untruncated
  locked: boolean;
  classId: number; className: string;
  subclassId: number | null; subclassName: string | null;
  sources: SourceRef[];    // owning subclass's, else class's; an optional feature's own
  isHomebrew: boolean;     // class or subclass isHomebrew
}
export function buildClassFeatures(
  classes: unknown[],
  subclassesByClassId: ReadonlyMap<number, unknown[]>,
  optionalByClassId: ReadonlyMap<number, OptionalCollection>,
): ClassFeatureEntry[];
export function filterClassFeatures(entries: readonly ClassFeatureEntry[], f: { name?: string; className?: string; level?: number }): ClassFeatureEntry[]; // filtered AND sorted
export function formatClassFeatureLine(e: ClassFeatureEntry): string;
```

Rules:
- Base entries are keyed `(classId, id)`, first wins. A subclass entry is dropped when its id is one of the parent class's base ids, otherwise keyed `(subclassId, id)`. An optional entry is attributed to the class it was requested for, dropped if its id is a base id of that class, otherwise keyed `(classId, id)`.
- `text`: base and subclass use `summary` if non-empty, else `stripHtml(description)`. Optional uses `snippet` if non-empty and free of `{{`, else `stripHtml(description)`.
- `locked`: optional entry with `accessTypes[String(id)] === 4`.
- Malformed records (no numeric `id` or no string `name`) are skipped.
- Sort: `className` (localeCompare) → `classId` → kind (class, subclass, optional) → `subclassName` → `requiredLevel` (null last) → `displayOrder` (null last) → `name` → `id`.
- Filters are case-insensitive substrings: `name` on `name`; `className` on `className` **or** `subclassName`. `level` is exact on `requiredLevel`.
- Line copy (exact):
  `- **{name}** — {className}[ ({subclassName})] level {requiredLevel ?? "?"}[, optional]`, then, if there is text or the entry is locked, `\n  {desc}`. `desc` is `*locked — not available to this account*` when locked, else the first 100 characters of `text` plus `...` when `text.length >= 100` (the existing idiom). When `isHomebrew`, the whole line is `wrapUntrusted(line)`.

- [x] **Step 1: Write failing tests:**
  - `buildClassFeatures` over the fixtures: Action Surge appears twice, once per Fighter (`classId` 10 and 2190879), both `kind: "class"`, `requiredLevel` 2.
  - Champion's Improved Critical is `kind: "subclass"`, `subclassName: "Champion"`. The repeated Action Surge/Second Wind ids under Champion produce no subclass entries.
  - Every Ability Score Improvement repeat survives as its own entry (distinct ids).
  - Martial Versatility: `kind: "optional"`, `locked: true`. Its line ends with `\n  *locked — not available to this account*`.
  - Synthetic Option: `locked: false`, text `"Synthetic Option snippet"`.
  - Class 10's Action Surge text is its `summary`.
  - `filterClassFeatures(e, { className: "champion" })` returns only Champion entries. `{ name: "action surge" }` returns the classId-10 entry before the classId-2190879 one. `{ level: 2 }` keeps only level-2 entries.
  - **Review Focus 1:** shuffling the input class order does not change the sorted output.
  - **Review Focus 2:** Riposte Flourish's line equals `wrapUntrusted("- **Riposte Flourish** — Fighter (Homebrew Duelist) level 3\n  Riposte Flourish description")`. Fighter base lines contain no `untrusted_dndbeyond_content`.
  - A record without `name` is skipped without throwing.
- [x] **Step 2: Run `npx vitest run tests/features-traits.test.ts`. Expected: FAIL (module not found).**
- [x] **Step 3: Implement the three functions in `src/tools/features-traits.ts`.**
- [x] **Step 4: Run the test file, then `npm test && npm run lint && npm run typecheck`. Expected: PASS.**
- [x] **Step 5: Commit** `feat(reference): normalize class, subclass and optional class features`.

### Task 4: Racial-trait normalization and formatting (model: Sonnet)

**Files:**
- Modify: `src/tools/features-traits.ts`
- Test: `tests/features-traits.test.ts`

**Interfaces:**
- Consumes: `SourceRef`, `OptionalCollection` from Task 3.
- Produces:

```ts
export type TraitKind = "standard" | "optional";
export interface RacialTraitEntry {
  id: number; name: string; kind: TraitKind;
  requiredLevel: number | null; displayOrder: number | null;
  text: string; locked: boolean;
  raceKey: string;          // `${entityRaceTypeId}:${entityRaceId}` of the race it is listed under
  speciesName: string;      // race fullName
  baseRaceName: string; isSubRace: boolean;
  isLegacy: boolean; isHomebrew: boolean;
  sources: SourceRef[];     // the race's; an optional trait's own
}
export function raceKeyOf(race: { entityRaceTypeId: number; entityRaceId: number }): string;
export function buildRacialTraits(races: unknown[], optionalByRaceKey: ReadonlyMap<string, OptionalCollection>): RacialTraitEntry[];
export function filterRacialTraits(entries: readonly RacialTraitEntry[], f: { name?: string; raceName?: string }): RacialTraitEntry[]; // filtered AND sorted
export function formatRacialTraitLine(e: RacialTraitEntry): string;
```

Rules:
- Standard entries are keyed `(raceKey, id)`, first wins. Optional entries are keyed `(raceKey, id)` and dropped if that species already has the id as a standard trait. Hide flags are ignored.
- `text`: `snippet` if non-empty and free of `{{`, else `stripHtml(description)`. `locked` as in Task 3.
- Sort: `speciesName` → `raceKey` → kind (standard, optional) → `name` → `id`.
- Filters are case-insensitive substrings: `name` on `name`; `raceName` on `speciesName` **or** `baseRaceName`.
- Species label: `speciesName`, plus ` — subrace of {baseRaceName}` when `isSubRace` and `baseRaceName` is non-empty, plus `, Homebrew` when `isHomebrew`.
- Line copy (exact): `- **{name}** *({label})*[ *(optional)*][ — {desc}]`, with `desc` as in Task 3. Homebrew lines are wrapped whole.

- [x] **Step 1: Write failing tests:**
  - Darkvision id 11 yields two entries, one each for High Elf and Wood Elf, labelled `High Elf — subrace of Elf` and `Wood Elf — subrace of Elf`.
  - Tiefling 2024 and the homebrew Tiefling subrace each get a Darkvision entry. The homebrew line is wrapped and its label ends `, Homebrew`; the 2024 line is not wrapped.
  - Human (raceKey `1743923279:1`) and High Elf (same `entityRaceId` 1) keep separate `raceKey`s.
  - Elf 2024's hidden Speed and Elven Lineage Spells and Goliath's Large Form are present.
  - The `{{modifier:str}}` trait's text is its stripped description, not the snippet.
  - The optional Languages trait for Human is `kind: "optional"` and its line contains ` *(optional)*`.
  - `filterRacialTraits(e, { raceName: "elf" })` includes High Elf, Wood Elf and Elf entries. `{ name: "darkvision" }` is sorted by species.
- [x] **Step 2: Run the test file. Expected: the new tests FAIL.**
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the test file, then `npm test && npm run lint && npm run typecheck`. Expected: PASS.**
- [x] **Step 5: Commit** `feat(reference): normalize standard and optional racial traits`.

### Task 5: Network loaders and the two search tools (model: Sonnet)

**Files:**
- Modify: `src/tools/reference.ts` (replace `DdbClassFeature`, `DdbRacialTrait`, `searchClassFeatures`, `searchRacialTraits`, ~1063–1214)
- Modify: `src/index.ts` (descriptions of `ddb_search_class_features` and `ddb_search_racial_traits`, ~788–830)
- Test: `tests/class-features-racial-traits.test.ts`

**Interfaces:**
- Consumes: `loadGameDataList` (Task 2); `buildClassFeatures`, `filterClassFeatures`, `formatClassFeatureLine` (Task 3); `buildRacialTraits`, `filterRacialTraits`, `formatRacialTraitLine`, `raceKeyOf` (Task 4).
- Produces: the same exported signatures `searchClassFeatures(params: { name?; className?; level?; limit?; offset? }): Promise<string>` and `searchRacialTraits(params: { name?; raceName?; limit?; offset? }): Promise<string>`. Module-private `loadClassFeatures()` / `loadRacialTraits()` return `{ source: CompendiumSource; entries: … }`, cached under `"class-features"` / `"racial-traits"`.

Loader algorithm (both copy `loadSpellCompendium`):
1. `const snapshot = captureSession()`, then return the cache entry if present.
2. Base list via `loadGameDataList`. A non-OK response throws the unavailable error with `(HTTP {status})`.
3. Fan out with `Promise.all` in base-list order. Class features: `subclasses?baseClassId={id}` and `class-feature/collection?classId={id}` per class. Racial traits: `racial-trait/collection?entityRaceId={entityRaceId}&entityRaceTypeId={entityRaceTypeId}` per race. A non-OK response, a thrown non-session error, or an unexpected shape (subclasses `data` not an array; collection `data` not an object) increments `failedTasks` and contributes nothing. `SessionChangedError` is rethrown.
4. `assertSessionCurrent(snapshot)`, then build.
5. Zero entries → throw the unavailable error (not cached). Otherwise cache with the TTL for its `source` (`failedTasks === 0` → `"ddb-authoritative"`).
6. Never request either collection endpoint without its parameters.

Exact copy:
- Unavailable: `Class feature data is unavailable from D&D Beyond right now: it returned no class features. Try again later, or run ddb_login if your session has expired.` and `Racial trait data is unavailable from D&D Beyond right now: it returned no racial traits. …` (same tail). The HTTP variant replaces `: it returned no …` with ` (HTTP {status})`. These are thrown, so `index.ts` returns them with `isError: true`.
- No matches: `No class features found matching {criteria} (searched {n} class features).` where criteria joins `name "{x}"`, `class "{y}"`, `level {n}` with `, `. Traits: `No racial traits found matching {criteria} (searched {n} racial traits).` with `name "{x}"`, `race "{y}"`.
- Partial note, prepended with a blank line after it, and also prepended to a no-matches reply: `> ⚠ Some subclass or optional-feature lists failed to load from D&D Beyond, so results may be incomplete. Run \`ddb_clear_cache\` to retry.` Traits: `> ⚠ Some optional-trait lists failed to load from D&D Beyond, so results may be incomplete. Run \`ddb_clear_cache\` to retry.`
- Pagination: `paginateResults("Class Feature", …)` / `paginateResults("Racial Trait", …)`, default limit 30, as today.
- `index.ts` descriptions: `"Search class, subclass and optional class features by name, class or subclass, or level gained. Requires login — run ddb_login first if you haven't already."`; `class_name`: `"Class or subclass name filter (e.g. 'fighter', 'champion')"`; `"Search racial traits, including optional ones, by name or species. Requires login — run ddb_login first if you haven't already."`; `race_name`: `"Species or race filter; also matches a subrace's base race (e.g. 'elf' matches High Elf)"`.

- [x] **Step 1: Write failing tests** (fetch mock routes by pathname and query, serving the Task 1 fixtures):
  - A cold `searchClassFeatures({ name: "action surge" })` requests `/classes` once, `subclasses?baseClassId=` for both class ids, and `class-feature/collection?classId=` for both. Its output contains `**Action Surge** — Fighter level 2` twice.
  - `searchRacialTraits({ name: "darkvision" })` requests `racial-trait/collection?entityRaceId=1&entityRaceTypeId=1743923279` (both params).
  - No request URL ever ends in `/class-feature/collection` or `/racial-trait/collection` without a query string.
  - A second call makes no new game-data requests (cache hit), and only one cobalt-token exchange happens for the cold build.
  - `/classes` returns `{ data: [] }`: the call rejects with the exact unavailable message, and a second call requests `/classes` again. `/classes` returns 403: rejects with the `(HTTP 403)` variant.
  - Data loaded, no match: `searchClassFeatures({ name: "zzz" })` returns `No class features found matching name "zzz" (searched {n} class features).` with the fixture's entry count.
  - One `subclasses?baseClassId=10` request returns 403 (non-retryable, so no backoff): the output still lists base features, starts with the partial note, and the cache entry gets `FALLBACK_TTL_MS` (assert via `vi.useFakeTimers` advancing 5 min + 1 ms, then a re-request).
  - **Review Focus 3:** a collection 200 with `{ data: null }` and a subclasses 200 with `{ data: {} }` each yield the partial note, not a throw.
  - The account changes mid-fan-out (gate pattern from `spell-compendium-endpoints.test.ts:191-235`): the call rejects or falls through without account A's entries, and nothing is cached.
  - **Review Focus 4:** no session file (`fsMock.existsSync` → false): rejects with a message containing `ddb_login`, not `unavailable` or `No class features found`.
  - **Review Focus 5:** after a successful call, swap the session file to account B. The next call re-requests `/classes`.
  - `searchClasses()` after `searchClassFeatures()` makes no second `/classes` request, and the Task 2 characterization strings still match.
- [x] **Step 2: Run the test file. Expected: the new tests FAIL.**
- [x] **Step 3: Implement the loaders, rewrite both search functions, update the `index.ts` strings, and delete `DdbClassFeature`, `DdbRacialTrait` and the stderr key-dump.**
- [x] **Step 4: Run the test file, then `npm test && npm run lint && npm run typecheck && npm run build`. Expected: all pass.**
- [x] **Step 5: Live smoke check (read-only, owner's session).** Run a one-off `npx tsx` script from the scratchpad (not the repo) that calls `searchClassFeatures({ name: "action surge" })`, `searchClassFeatures({ className: "champion" })` and `searchRacialTraits({ name: "darkvision" })`. Expected: real results; no unavailable, partial or no-matches text.
- [x] **Step 6: Commit** `fix(reference): class-feature and racial-trait search use classes, subclasses and races data`.

### Task 6: Documentation (model: Sonnet)

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-10-16-rules-edition-design.md`

- [x] **Step 1: Update `CLAUDE.md`:**
  - Key modules: add a `src/tools/features-traits.ts` row. Extend the `reference.ts` row with class features (`/classes` + `/subclasses?baseClassId` + `class-feature/collection?classId`, the optional endpoint) and racial traits (`/races` + `racial-trait/collection?entityRaceId&entityRaceTypeId`).
  - Caching layers: add the `"class-features"` / `"racial-traits"` entries (24 h / 5 min partial; empty or failed base never cached) and note that the classes/races payloads are shared with `ddb_search_classes` / `ddb_search_races`.
  - Tool notes: one bullet on `class_name` matching subclasses, one entry per owner, locked optional entries, and unavailable vs no-match replies.
  - Next steps: mark item 0 done (one or two lines: what was found, what shipped), and update "Last updated". Add a new item: `ddb_search_classes` "Subclasses:" line is dead because `/classes` returns `subclasses: null`. The fix is per-class `/subclasses?baseClassId=N` (now loaded by `loadClassFeatures`), with the caveat that the endpoint lists only subclasses available to the account. A natural fit for phase 3, which edits `searchClasses` anyway.
  - Decisions → Sequencing: drop "Do item 0 … first"; phase 2 is next.
- [x] **Step 2: Update `README.md`:**
  - `ddb_search_classes` row: drop "and subclasses" (it never printed them).
  - `ddb_search_class_features` row: "Search class, subclass, and optional class features by name, class or subclass, or level gained."
  - `ddb_search_racial_traits` row: "Search racial traits, including optional ones, by name or species."
- [x] **Step 3: Update the rules-edition spec, phase 3 "Races, classes, … racial traits" bullet:** add that class-feature and racial-trait entries are now `ClassFeatureEntry` / `RacialTraitEntry` (`src/tools/features-traits.ts`), whose `sources` are the owning subclass's, class's or race's (an optional entry's own); D&D Beyond features carry no `sources` of their own.
- [x] **Step 4: Run `npm run lint`. Expected: pass. Then `git diff --stat` and confirm only the three docs files changed, plus this plan file (untracked until now).**
- [x] **Step 5: Commit** the three docs files and `docs/superpowers/plans/2026-10-17-class-features-racial-traits.md`, by explicit path: `docs: mark work item 0 done; document class-feature and racial-trait sources`.

### After every task: adversarial review

One Sonnet reviewer subagent, plus `deepseek-v4.1-flash-free` via opencode (provider `opencode`, agent `plan`, told it is read-only and must not write files). Run `opencode_provider_models` first: use a free GLM model too if one is listed, never a paid substitute, never Muse Spark. Both review that task's diff against this plan (see "Owner's working rules"). The orchestrator brings findings, with a verdict on each, to the owner before any fix round.

### Final: whole-change review (model: Opus)

After Task 6: one Opus reviewer over all six commits against this plan and CLAUDE.md's constraints. Then `npm ci && npm test && npm run lint && npm run typecheck`.
