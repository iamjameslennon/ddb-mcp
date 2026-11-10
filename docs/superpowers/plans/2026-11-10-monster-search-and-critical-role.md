# Monster search quality (B11) and Critical Role books (B12) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monster searches list only monsters whose names match the query at a word start, with exact totals for every search: 50 shown by default, or everything with `list_all: true`. Separately, the three Wizards-published Critical Role books classify as 2014.

**Architecture:**
- **B12:** a source-id override table in `src/edition.ts`, behind one `sourceIdRuleset(id, categoryId)` that replaces the three `categoryRuleset` call sites.
- **B11, code layout:** the monster-service fetch layer moves out of `monster.ts` into `monster-service.ts`, which gains a full-list cache that follows the session lifecycle (slim entries; 24 h, or 5 min when short; 60 s deadline). The search moves into `monster-search.ts`.
- **B11, candidate sets:** every search works on a complete candidate set.
  - Name searches page through all hits for each spelling. Past 500 hits, they filter the full list instead.
  - Filter, browse and homebrew searches use the full list.
- **B11, matching:** a shared word-start predicate in `src/name-match.ts` decides name matches in D&D Beyond and Open5e alike.

**Tech Stack:** TypeScript (ESM, Node ≥22), vitest, zod (tool params), `@modelcontextprotocol/sdk`.

**Spec:** [docs/superpowers/specs/2026-11-10-monster-search-and-critical-role-design.md](../specs/2026-11-10-monster-search-and-critical-role-design.md). Read it first. G1–G15 below are its goal numbers.

**Plan review (2026-11-10):** adversarial review by opencode Zen `deepseek-v4.1-flash-free` and a cold-read Claude Opus reviewer. Every finding was checked against the code. The confirmed ones are folded in, and those that needed a decision became R8–R11.

**Spec errata (found in plan review):**
- The spec's "`take=20` (`tests/monster.test.ts:1439`)" is a `ddb_get_monster` test ("a normal lookup still asks for 20 candidates per spelling"). It guards a non-goal and **must stay unchanged**.
- `search.ts:41-42` is now `:46`.

## Owner rulings made while planning (2026-11-10)

Record these in `docs/claude/history.md` (Task 11) with this date. They settle some of the spec's "builder's calls" and override the spec where they differ.

- **R1 — name fold.** Before the word-start test, the predicate folds both names the way Open5e already does: hyphens become spaces, straight and curly apostrophes are dropped, then `normalizeName`. So "will o wisp" and "will-o-wisp" match Will-o'-Wisp.
- **R2 — name paging bound.** If every spelling has ≤ 500 hits (`NAME_SCAN_LIMIT`), each is paged in full. If any spelling has more, the name rules (G1/G2) run locally over the full cached list instead. Near matches still come from the typed spelling's first page. This applies to `ddb_search_site` too, so a common word can cost one full-list scan there (cached 24 h).
- **R3 — short scan.** If a scan sees fewer distinct entries than the largest reported total, re-fetch every page once, uncached, and merge. If it is still short, answer with an honest "N+" count and a note, and cache it for 5 min, not 24 h.
- **R4 — layout.** `monster-service.ts` holds the fetch layer and the list cache, and `monster-search.ts` the search and near matches. `monster.ts` keeps get, stats and the stat block, and re-exports the search functions.
- **R5 — order.** Name searches list rule-2 matches first (twin key equals the query's: "goblin" → Goblin Warrior, "thug" → Tough), then the rest A–Z. Every other search is A–Z. Ties go by id. Near matches keep D&D Beyond's relevance order.
- **R6 — one plan, B12 first**, with its own review checkpoint.
- **R7 — scan concurrency 8** (`SCAN_CONCURRENCY`), re-measured live in Task 11.
- **R8 — `ddb_get_monster`'s hint unchanged.** Its "Available sources for X" error keeps today's `availableSourcesFor` (exact-first, 20 hits). Only the search's empty-book "appears in" hint uses word-start matching. It reads ≤ `NAME_SCAN_LIMIT` hits and never the full list.
- **R9 — book + no name match: both.** With a `source` and a name, if nothing in the book matches by name but the book has fuzzy hits, the reply leads with today's "No monsters … in <book>." line (plus "appears in: …" when other books have a real match), then the near-match label and the closest hits in that book.
- **R10 — near matches are raw.** No twin selection: each hit is listed as D&D Beyond ranked it, with its own edition tag, no reason suffix and no hidden count. CR/type/size filters and the homebrew rule still apply.
- **R11 — 60 s scan deadline.** `FULL_SCAN_DEADLINE_MS = 60_000` covers one whole page scan, retry and tail included. On expiry the scan stops dispatching pages, rejects with `MonsterScanTimeoutError` (an expected outage), caches nothing and releases its pending slot. The search then falls back as today (Open5e, "unavailable").

## Global Constraints

- `rules_edition: "2024" | "2014"`, default `"2024"`. All edition label text comes from `src/edition.ts`.
- `source` wins over `rules_edition`. `source: "homebrew"` is checked before book resolution and fails closed (`isHomebrew !== false`).
- Every catalog line containing homebrew or user-authored text is wrapped whole (`m.isHomebrew === false ? line : wrapUntrusted(line)`). This includes near-match lines.
- Every account-derived cache:
  - registers an `onSessionInvalidated()` hook;
  - dedupes concurrent cold callers through a pending entry;
  - writes only while that pending entry is still its own;
  - is dropped by `ddb_clear_cache` `monsters`/`all`.
- One `SessionSnapshot` per tool call covers every page and every spelling. Logged-in answers are re-checked with `assertCurrentAfter(snapshot, asker)`, and anonymous answers are cached under `anon:` keys. Every `fetchMonsterList` call passes the call's `asker`. The default is `LOGGED_IN`, which would break logged-out search.
- `ddb_search_monsters` stays `READ_ONLY_NET`.
- No unbounded fan-out. D&D Beyond page scans and Open5e probes go through `mapWithConcurrency` (`src/utils.ts:115`), and scans have R11's deadline.
- The server-side `challengeRatingMin/Max`, `monsterTypes` and `monsterSizes` parameters are **not** used.
- `ddb_get_monster` and `getMonsterStats` are unchanged (spec non-goals, R8). Spells and items keep substring matching and `SEARCH_CAP = 20`.
- Before each commit, `npm run typecheck && npm run lint && npm test` must be green. Commit to `main`, and don't push unless the owner says so.
- Counts are printed with `formatCount(n) = n.toLocaleString("en-US")` ("1,601"), defined in Task 7.

## Review Focus

1. **A twin pair whose type or size differs between editions, under a filter-only search.** The requested twin must be in the candidate set, so there is never a false "no 2024 version found". → Task 7 `split-twin fixture`.
2. **Reordered or lagging pages during a scan.** The total must never read exact when entries were missed, and a short scan must never be cached for 24 h. → Task 5 `short scan retries once`, `lagging first page`, `5-minute TTL`.
3. **`ddb_clear_cache` or a session change while a scan is in flight.** Nothing may be cached afterwards, and pages from two accounts must never merge. → Task 5 `clear mid-scan`, `session change mid-scan`, and the updated `tests/monster-session.test.ts` swap tests.
4. **A logged-out `list_all` over a broad filter.** Both Open5e probe sites stay ≤ 8 in flight. → Task 8, the two bounded-probe cases.
5. **A near-match result inside `ddb_search_site` `"all"`.** It must not be `noMatch`, and its homebrew lines must be wrapped. → Task 6 `near-match section is not noMatch` (gate in `monster.test.ts`), `homebrew near-match lines are wrapped`.

---

## Part A — B12: Critical Role books

### Task 1: Per-source ruleset override

**Files:**
- Modify: `src/edition.ts` (the `CATEGORY_TABLE` block ~:64-89; call sites :110, :184, :889; the `lookupSourceNote` comment ~:654, which calls egtw `[third-party]`)
- Modify: `tests/monster.test.ts:655-664` (the Wildemount Bullywug test)
- Test: `tests/edition.test.ts`, `tests/library-editions.test.ts`

**Interfaces:**
- Produces: `export function sourceIdRuleset(sourceId: number, categoryId: number | null | undefined): Ruleset` in `src/edition.ts`.
  - It is not named `sourceRuleset`, which is already a private function at `src/tools/edition-search.ts:172`.
  - `categoryRuleset` stays exported (tests and scripts use it).
  - No code in `edition.ts` derives a source's ruleset except through `sourceIdRuleset`.

- [ ] **Step 1: Write the failing tests.** In `tests/edition.test.ts`, add `sourceIdRuleset` and `isDualEdition` to the imports. Import `SNAPSHOT_SOURCES`/`SNAPSHOT_CATEGORIES` from `../src/source-snapshot.js`, and build `const SNAPSHOT_INDEX = buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES)` at the new describe's scope (the existing `snapshotIndex` at ~:1036 is block-scoped).

```ts
describe("sourceIdRuleset: per-source overrides (B12)", () => {
  it.each([[59, "2014"], [62, "2014"], [83, "2014"], [31, "third-party"], [123, "third-party"]] as const)(
    "Critical Role source %i is %s", (id, ruleset) => expect(sourceIdRuleset(id, 2)).toBe(ruleset));
  it("an unlisted category-2 source stays third-party", () => expect(sourceIdRuleset(999_999, 2)).toBe("third-party"));
  it("falls back to the category table", () => expect(sourceIdRuleset(145, 24)).toBe("2024"));
  it("classifyEdition: a non-Legacy EGtW entry is 2014", () =>
    expect(classifyEdition({ sourceId: 59, sources: [{ sourceId: 59 }] }, SNAPSHOT_INDEX))
      .toEqual({ ruleset: "2014", book: "Explorer's Guide to Wildemount" }));
  it("isDualEdition: EGtW + PHB 2024 is dual-edition", () =>
    expect(isDualEdition({ sourceId: 59, sources: [{ sourceId: 59 }, { sourceId: 145 }] }, SNAPSHOT_INDEX)).toBe(true));
  it("isDualEdition: TCSR + PHB 2024 is not", () =>
    expect(isDualEdition({ sourceId: 123, sources: [{ sourceId: 123 }, { sourceId: 145 }] }, SNAPSHOT_INDEX)).toBe(false));
});
```

In `tests/library-editions.test.ts`, using an index built from the snapshot (it holds sources 62 and 123), check that `libraryBookInfo({ slug: "sources/dnd/wa", title: "Frozen Sick" }, index).ruleset` is `"2014"` and `{ slug: "sources/dnd/tcsr", title: "Tal'Dorei Campaign Setting Reborn" }` is `"third-party"`.

- [ ] **Step 2: Run** `npx vitest run tests/edition.test.ts tests/library-editions.test.ts`. Expected: FAIL (`sourceIdRuleset` is not exported).
- [ ] **Step 3: Implement.**
  - Add `SOURCE_RULESET_OVERRIDES: ReadonlyMap<number, Ruleset>` = `{59, 62, 83} → "2014"`. Comment each entry with its publisher evidence: EGtW, Wizards of the Coast 2020; Frozen Sick (WA), Wizards of the Coast 2020; Call of the Netherdeep, Wizards of the Coast 2022. Also note that 31 (Critical Role / Blood Hunter) and 123 (Darrington Press, 2022) stay `third-party` (owner ruling 2026-11-10).
  - `sourceIdRuleset` returns the override, else `categoryRuleset(categoryId)`.
  - Replace the call sites: :110 (`s.id`, `s.sourceCategoryId`), :184 (`k.id`, `k.s.categoryId`), :889 (`id`, `src.categoryId`).
  - Update the ~:654 comment so its third-party example names TCSR, not egtw.
- [ ] **Step 4: Fix the Bullywug test** (`tests/monster.test.ts:655-664`).
  - EGtW is now a 2014 book, so `lookupSourceNote` takes the `sourceNote` branch.
  - Both the Legacy "Wildemount Bullywug" and the non-Legacy "Wildemount Native", fetched with `source: "egtw"` and the default 2024 edition, now contain `(source "egtw" is a 2014 book — its entries are listed whatever rules_edition says)`. With `rulesEdition: "2014"`, neither has a note.
  - Move the carry-over (ap) case (`(this entry from source "…" is 2014 text — shown whatever rules_edition says)`) to TCSR. A Legacy "Tal'Dorei Bullywug" with `sourceId: 123`, fetched with `source: "tcsr"`, still gets that exact wording. Source 123 comes from the snapshot merge; if `resolveSource(index, "tcsr")` fails in the test, add it through `extraConfigSources`.
  - Rewrite the test's comment.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: green. Any other test that encoded egtw, wa or cotn as third-party is fixed and listed in the commit body.
- [ ] **Step 6: Run** `grep -n "categoryRuleset(" src/edition.ts`. Expected: only its definition and the one use inside `sourceIdRuleset`.
- [ ] **Step 7: Commit** `fix(edition): classify the Wizards-published Critical Role books as 2014 (B12)`

### Checkpoint A: B12 live verification and review

No code unless a check fails. The results go into Task 11's history entry.

- [ ] `npx tsx scripts/dump-edition-renames.mts --snapshot-only` exits 0.
- [ ] Logged in, `npx tsx scripts/dump-edition-renames.mts` lists about 104 new 2014 orphans (Wildemount, CotN and Frozen Sick monsters; G14). These are expected, so add no pairs.
- [ ] G15: through the built server (`npm run build`), `ddb_list_library` shows Frozen Sick, EGtW and CotN as `[2014]` and TCSR as `[third-party]` where the account lists them. If one drops to `[edition not stated]`, **stop and bring the owner** the candidate source ids that `pickCandidate` (`src/tools/library.ts:163`) saw, with a proposed tie-break, before changing it.
- [ ] G13: write a throwaway script in the session scratchpad directory (never committed). It loads the spell compendium, items, feats, backgrounds, races, classes and the monster list, and counts the non-Legacy, non-homebrew entries whose `entrySourceIds` include 59, 62 or 83 **and** a 2024-category source. Report the count per kind.
- [ ] Adversarial review of the B12 commit: `opencode run -m opencode/deepseek-v4.1-flash-free "<prompt>"` with the spec's B12 section and `git show <B12 commit>`. Spot-check every finding against the code, and fix the confirmed ones in a separate commit. Use Codex (`codex:rescue`) if the Zen quota is out.

---

## Part B — B11: monster search

### Task 2: Shared word-start name predicate

**Files:**
- Create: `src/name-match.ts`
- Modify: `src/open5e.ts:187-190` (`o5Folded` reuses `nameFold`; no behaviour change)
- Test: `tests/name-match.test.ts`

**Interfaces:**
- Produces: `export function nameFold(name: string): string` = `normalizeName(name.replace(/-/g, " ").replace(/['‘’]/g, ""))`, which is exactly today's `o5Folded`.
- Produces: `export function matchesAtWordStart(name: string, query: string): boolean`. It folds both. An empty folded query is `false`. Otherwise it is true when **any** occurrence of the query in the name starts at index 0 or right after a character that is not `\p{L}` or `\p{N}`.

- [ ] **Step 1: Write the failing tests** as a table over `matchesAtWordStart(name, query)`:

| name | query | expected |
|---|---|---|
| Goblin Boss | goblin | true |
| Dust Goblin | goblin | true |
| Goblin Warrior (Stranger Things) | goblin | true |
| Hobgoblin | goblin | false |
| Hobgoblin Warrior | goblin | false |
| Adult Red Dragon | red dragon | true |
| Adult Red Dragon | dragon red | false |
| Sword Wraith | wraith | true |
| Will-o'-Wisp | will o wisp | true |
| Will-o’-Wisp | will-o-wisp | true |
| Sorcerer Orc | orc | true (the second occurrence is at a word start) |
| Avoral Guardinal | vorpal | false |
| Goblin | "" and "   " | false |
| GOBLIN  BOSS | goblin boss | true |

Also check `nameFold("Adamantine Armor (Chain-Mail)") === "adamantine armor (chain mail)"`.

- [ ] **Step 2: Run** `npx vitest run tests/name-match.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** `src/name-match.ts`. It is pure and imports only `normalizeName` from `./edition.js`. In `open5e.ts`, `o5Folded` becomes `nameFold`; delete `foldPunctuation` if nothing else uses it.
- [ ] **Step 4: Run** `npx vitest run tests/name-match.test.ts tests/open5e.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(search): shared word-start monster name predicate`

### Task 3: Extract the monster-service layer and the search module (pure move)

**Files:**
- Create: `src/tools/monster-service.ts`, `src/tools/monster-search.ts`
- Modify: `src/tools/monster.ts`

**Interfaces:**
- `monster-service.ts` exports these, moved verbatim:
  - **Types:** `DdbMonster`, `MonsterListResponse`, `MonsterSingleResponse`, `AccessMap`, `Asker`.
  - **Asker and session helpers:** `mergeAccess`, `isLockedIn`, `LOGGED_IN`, `askerNow`, `assertCurrentAfter`, `cacheKeyFor`, `configFor`.
  - **Errors:** `MonsterServiceHttpError`, `MonsterServiceParseError`, `GameConfigUnavailableError`, `isExpectedOutage`.
  - **Cache:** `monsterCache`, `clearMonsterCache`, and the `onSessionInvalidated` hook.
  - **Fetching:** `fetchMonsterList`, `fetchCandidates`, `PAGE_SIZE`, `MAX_FILTER_SCAN`, `fetchMonsterPages`, `fetchMonsterDetail`, `isRestricted`.
  - **Name, size and CR helpers:** `sizeName`, `SIZE_MAP`, `crDisplay`, `nameKey`, `namedCandidates`, `monsterTwin`, `availableSourcesFor` (used by `getMonster`; R8 keeps it as it is).
- `monster-search.ts` exports `MonsterSearchParams`, `searchMonsters`, `searchMonstersSection`, `HOMEBREW_LOGIN_REQUIRED` and `HOMEBREW_UNREACHABLE` (`getMonster` uses both, at :957 and :1103). It holds `monsterSearchParts`, `plainOrSection`, `withListStats`, `srdBackedGroups`, `unknownCrError` and `VALID_CRS`.
- `monster.ts` re-exports `searchMonsters`, `searchMonstersSection`, `MonsterSearchParams` and `clearMonsterCache`. `src/server.ts`, `src/tools/search.ts`, encounter, treasure and every test import keep working.

- [ ] **Step 1: Move the code**, with no logic edits and no import cycle: `monster-search.ts` imports `monster-service.ts`, and `monster.ts` imports both.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test`. Expected: green with **no test edits**. The session-fetch mock still collects the hook, because `monster-service.ts` imports the mocked `session-fetch.js`.
- [ ] **Step 3: Commit** `refactor(monster): split the service layer and search out of monster.ts`

### Task 4: Name matching rules 1–2 and result order

**Files:**
- Modify: `src/tools/monster-search.ts`
- Test: `tests/monster.test.ts` (new `describe("word-start name matching (B11)")`)

**Interfaces:**
- Consumes: `matchesAtWordStart` (Task 2), `monsterTwin` (Task 3).
- Produces (module-private, used by Tasks 6–8 and 10):
  - `nameMatcher(query: string): (m: { name: string }) => boolean` = `m => matchesAtWordStart(m.name, query) || monsterTwin(m.name) === monsterTwin(query)`.
  - `orderRows<R extends { m: { name: string; id: number } }>(rows: R[], query: string): R[]`, per R5: when there is a query, rows with `monsterTwin(m.name) === monsterTwin(query)` come first; then `name.localeCompare(…, "en")`; then id.

- [ ] **Step 1: Test-mock additions** (in `setupFetch`/`beforeEach`, reset each test):
  - `leadMonsters: Array<Record<string, unknown>>`, prepended before `ALL_MONSTERS`, so a fixture can sit inside today's 600-entry scan.
  - `ANY_WORD: Record<string, unknown[]>`, whose entries are appended to the substring hits for that term **before** the `sources=` filter. It emulates the live any-word matching.
- [ ] **Step 2: Write the failing tests.** Fixtures (all in `extraMonsters` unless noted):
  - `GOBLIN_2014`: Legacy, source 1.
  - `GOBLIN_WARRIOR_2024`, `GOBLIN_BOSS_2024`, `AARDVARK_GOBLIN_2024`, `HOBGOBLIN_WARRIOR_2024`, `KOBOLD_WARRIOR_2024`: all source 147.
  - `ANY_WORD["goblin warrior"] = [KOBOLD_WARRIOR_2024]`.

  Tests:
  - `name: "goblin"` lists Goblin Warrior [2024], Goblin Boss and Aardvark Goblin, and hides the 2014 Goblin (footer `1 2014 version hidden — rules_edition: "2014" shows it.`). No `Kobold Warrior` or `Hobgoblin Warrior`. The first `- **` line is **Goblin Warrior**, ahead of the A–Z-earlier Aardvark Goblin (R5).
  - `name: "goblin warrior"` lists Goblin Warrior [2024] and counts the 2014 Goblin as hidden. The "goblin" alias fetched it, and its group matches through Goblin Warrior.
  - `name: "thug"` with Thug (2014) and Tough (2024) still lists Tough (G2).
  - `source: "mm-2024", name: "goblin"` doesn't list Kobold Warrior, even though the any-word hit survives the book filter.
  - `source: "homebrew", name: "goblin"`: a homebrew "Kobold Warrior" from `ANY_WORD` is not listed.
  - A–Z: two CR 17 fixtures (`challengeRatingId: 21`; no base fixture has CR 17) in `leadMonsters` in reverse name order. `{ cr: 17 }` lists them A–Z.
- [ ] **Step 3: Run** `npx vitest run tests/monster.test.ts -t "word-start"`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Default path: `groupAndSelect(…, { nameMatches: searchTerm ? nameMatcher(searchTerm) : undefined, … })`.
  - Source and homebrew paths: filter entries with `nameMatcher`.
  - `srdBackedGroups` receives only the entries of name-matched groups.
  - Sort the selected rows with `orderRows` before slicing.
- [ ] **Step 5: Run** `npm test`. Expected: green. Fix any existing expectation that relied on unfiltered fuzzy hits, and name it in the commit body.
- [ ] **Step 6: Commit** `fix(monster): name searches list only word-start and twin matches (B11)`

### Task 5: Page scanner and full-list cache

**Files:**
- Modify: `src/tools/monster-service.ts`
- Test: `tests/monster.test.ts` (new `describe("monster page scans and the full-list cache")`)

**Interfaces:**
- Produces:
  - `export type MonsterListEntry = Pick<DdbMonster, "id" | "name" | "challengeRatingId" | "typeId" | "sizeId" | "armorClass" | "averageHitPoints" | "isLegacy" | "isHomebrew" | "isLegendary" | "isMythic" | "sourceId" | "sources">`. `isLegendary`/`isMythic` go beyond the spec's list because the result line prints them.
  - `export interface MonsterScan { entries: MonsterListEntry[]; access: AccessMap; scanTotal: number; complete: boolean }`.
    - `scanTotal` = max(every page's `pagination.total`, distinct entries).
    - `complete` = distinct ≥ every reported total, **and** the last page fetched came back short.
  - `export async function scanAllPages(search: string, sourceIds: number[], asker: Asker, snapshot: SessionSnapshot): Promise<MonsterScan>`. It is uncached and reads every page with `{ noCache: true }`.
  - `export async function getFullMonsterList(asker: Asker, opts?: { sourceIds?: number[]; bound?: SessionSnapshot }): Promise<MonsterScan>`, cached.
  - `export class MonsterScanTimeoutError extends Error`, added to `isExpectedOutage`.
  - Constants: `SCAN_CONCURRENCY = 8`, `MAX_SCAN_PAGES = 100`, `FULL_SCAN_DEADLINE_MS = 60_000`, `FULL_LIST_TTL_MS = 24 * 60 * 60_000`, `SHORT_LIST_TTL_MS = 5 * 60_000`.
  - `export function monsterCacheSize(): number`, a test hook, like `statBlockText`.
  - `ListOptions` gains `noCache?: boolean` (skip both the read and the write).
  - `clearMonsterCache()` also clears the full-list cache and its pending map.
- **`scanAllPages` algorithm:**
  1. Page 1 reveals the total. Pages `skip = 100…total-1` go through `mapWithConcurrency(…, SCAN_CONCURRENCY, …)`.
  2. **Tail:** while the last page came back full (`PAGE_SIZE` entries), fetch the next page one at a time, up to `MAX_SCAN_PAGES` pages in all. This covers a lagging first-page total.
  3. **R3 retry:** if `!complete`, re-fetch every page once and merge by id.
  4. **R11 deadline:** one `FULL_SCAN_DEADLINE_MS` deadline over steps 1–3. On expiry, stop dispatching and reject with `MonsterScanTimeoutError`.
  5. After the last page, `assertCurrentAfter(snapshot, asker)`. Every page request is also held to `snapshot` (pass it as `bound` to `fetchMonsterList`).
- **`getFullMonsterList` cache:**
  - `fullListCache = new TtlCache<MonsterScan>(FULL_LIST_TTL_MS, 32)`, written with `set(key, scan, scan.complete ? FULL_LIST_TTL_MS : SHORT_LIST_TTL_MS)`.
  - `fullListPending = new Map<string, Promise<MonsterScan>>()`.
  - Key: `${asker.anonymous ? "anon" : `gen${snapshot.generation}`}:src${sourceIds.join(",")}`, where `snapshot` = `opts.bound ?? captureSession()`.
  - A logged-in call checks `assertSessionCurrent(bound)` before the cache read.
  - The pending entry is published before the first request.
  - On settle, the cache is written and the pending entry deleted only if `fullListPending.get(key) === thisPromise`. A rejection caches nothing.
  - The hook and `clearMonsterCache` clear both maps.

- [ ] **Step 1: Write the failing tests.** Import from `../src/tools/monster-service.js`. Add `vi.useRealTimers()` to the file's `afterEach`. The base fixture list is 675 entries (7 pages); the empty search term returns all of them.
  - `at most 8 pages in flight`: `extraMonsters` = 1,000 fillers (17 pages). Wrap the routed `sessionFetch` with an in-flight counter (`await new Promise(r => setTimeout(r, 0))` inside). Assert max **=== 8**, `entries.length === scanTotal`, `complete === true`.
  - `slim entries`: `"actionsDescription" in entries[0]` is false.
  - `pages bypass the stat-block cache`: `monsterCacheSize()` is unchanged by a full scan.
  - `served from cache`: the second call makes no new `search=&` requests.
  - `concurrent cold callers share one scan`: two parallel calls make 7 list requests in all.
  - `clear mid-scan leaves nothing cached`: start the scan, call `clearMonsterCache()` before awaiting, await, call again; a second scan runs.
  - `session change mid-scan`: logged in; `assertSessionCurrent` throws `SessionChangedError` after page 3. The call rejects with it, and a later call scans afresh.
  - `generation-keyed`: `captureSession` returns `{ generation: 1 }` and then `{ generation: 2 }`; the second call scans again.
  - `anonymous and logged-in cached apart`: `goLoggedOut()` (helper ~:1569), then log back in; each scans once.
  - `short scan retries once`: `firstPageTotal = 900`, 675 entries. Each pass is 9 pages, so 18 list requests in all; `complete === false`, `scanTotal === 900`.
  - `lagging first page`: `firstPageTotal = 99`, `extraMonsters` = 158 RtHW entries, `sourceIds` `[232]`. The tail reads all 160 entries, `complete === true`.
  - `5-minute TTL`: with `vi.useFakeTimers({ shouldAdvanceTime: true })`, a short scan is re-fetched after `SHORT_LIST_TTL_MS + 1` ms. A complete scan isn't re-fetched after 6 min, but is after 24 h + 1 ms.
  - `deadline`: page requests that never resolve, plus fake timers. After `FULL_SCAN_DEADLINE_MS`, the call rejects with `MonsterScanTimeoutError`, and a fresh call starts a new scan.
- [ ] **Step 2: Run** `npx vitest run tests/monster.test.ts -t "page scans"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: green. The search still uses `fetchMonsterPages`; nothing calls the new code yet.
- [ ] **Step 5: Commit** `feat(monster): page scanner and session-safe full monster list cache`

### Task 6: Near matches

**Files:**
- Modify: `src/tools/monster-search.ts`
- Test: `tests/monster.test.ts` (new `describe("near matches (B11 option B)")`), `tests/search-site.test.ts`

**Interfaces:**
- Consumes: `nameMatcher` (Task 4), `withListStats`.
- Produces:
  - `NEAR_MATCH_LIMIT = 10`.
  - The label `` `No monster names match "${searchTerm}". Closest matches from D&D Beyond:` ``, built in `monster-search.ts`. It is not edition text.
  - `formatRow(row, ctx): string`, extracted from today's line loop, so normal and near-match lines are built the same way, wrapping included.
- **Trigger (G3):** no fetched entry, from any spelling, passes `nameMatcher`, judged before the filters and selection.
- **Candidates (R10):**
  1. Start from the typed spelling's own hits, in service order.
  2. Filter: `passes` (CR/type/size); on the homebrew path, also `isHomebrew !== false`.
  3. **No twin selection**, no reason, no hidden count. Each row's info is `classifyEdition`, or `HOMEBREW_INFO` on the homebrew path.
  4. Take the first `NEAR_MATCH_LIMIT`, run `withListStats`, then render with `formatRow`.
  5. If nothing is left, today's no-match paths run unchanged.
- **Not a near match:** when some entry passes the name rule but the filters or selection empty the result, today's paths apply (including `hidden > 0`).
- **Section:** the path's normal header (search header or source framing). Footer `searchFooter(requested, 0)`. Body = label + lines. **No `noMatch`.**
- **R9 (book):** with a `source` and a name, the body starts with today's `No monsters matching the search criteria in <book>.` line and the `"X" appears in: …` hint when there is one, then the label and the near-match lines.

- [ ] **Step 1: Write the failing tests:**
  - `"gobiln"`: `FUZZY["gobiln"] = [GOBLIN_WARRIOR_2024, GOBLIN_2014, GOBLIN_BOSS_2024]`. The output contains the label, then `- **Goblin Warrior** [2024]` and `- **Goblin** [2014]` in that order. No `**Monster Search**` line, no `hidden` footer, ≤ 10 entry lines.
  - `"vorpal"`: `FUZZY["vorpal"] = [AVORAL_GUARDINAL]`. Avoral Guardinal is listed under the label.
  - `section is not noMatch`: for `searchMonstersSection({ name: "vorpal" })`, `.noMatch` is `undefined` **and** `.body` contains the label.
  - `homebrew near-match lines are wrapped`: logged in, a homebrew fuzzy hit's line is inside `<untrusted_dndbeyond_content>`.
  - `filters keep applying`: `{ name: "gobiln", cr: 24 }` (CR 24 is in the mock config; no goblin has it) shows no label, and falls back to `O5 SEARCH RESULT`.
  - `a name match emptied by filters is not a near match`: `{ name: "goblin", cr: 24 }` shows no label.
  - `aliases don't feed near matches`: a hit only an alias query returns is not listed.
  - `R9`: `{ source: "mm-2024", name: "gobiln" }` with `FUZZY["gobiln"]` holding a 2024 MM goblin and the 2014 Goblin in source 1. The body starts with `No monsters matching the search criteria in Monster Manual (2024).`, then the label, and the book's hit.
  - `tests/search-site.test.ts` (a regression guard only; the gate is the `monster.test.ts` test): a monster section without `noMatch` is kept in `"all"`.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `npm test`. Expected: green.
- [ ] **Step 5: Commit** `feat(monster): label D&D Beyond's closest hits when no name matches (B11)`

### Task 7: Exact candidate sets and exact totals

**Files:**
- Modify: `src/tools/monster-search.ts`, `src/tools/edition-search.ts` (add `formatCount`)
- Modify: `tests/monster.test.ts`, `tests/monster-session.test.ts`

**Interfaces:**
- Consumes: `scanAllPages`, `getFullMonsterList`, `MonsterListEntry`, `MonsterScan` (Task 5); `nameMatcher`, `orderRows` (Task 4).
- Produces:
  - `export function formatCount(n: number): string` in `edition-search.ts` = `n.toLocaleString("en-US")`.
  - `NAME_SCAN_LIMIT = 500`.
  - Module-private `gatherCandidates(...)`, returning `{ entries: MonsterListEntry[]; access: AccessMap; complete: boolean; checked: number; scanTotal: number; typedFirstPage: MonsterListEntry[] }`.
- **Retype** the search pipeline to `MonsterListEntry`: `Row`, `passes`, `info`, `withListStats`, `srdBackedGroups` and `formatRow`. `DdbMonster` is a structural superset, so name-path pages fit too.
- **`gatherCandidates`** captures one `snapshot = captureSession()` and passes it to every request (`bound`), then calls `assertCurrentAfter(snapshot, asker)` after all spellings.
  - **Name** (with or without filters or a book):
    - For each `twinAliases` spelling, fetch page 1 with `fetchMonsterList(term, PAGE_SIZE, { sourceIds, asker, bound: snapshot })`. Only the typed spelling's failure fails the call.
    - If any spelling's total > `NAME_SCAN_LIMIT`, use `getFullMonsterList(asker, { sourceIds, bound: snapshot })`, filtered by `nameMatcher` (R2).
    - Otherwise, each spelling whose total > `PAGE_SIZE` goes through `scanAllPages(term, sourceIds, asker, snapshot)`.
    - `complete` is the AND of every spelling's flag. `typedFirstPage` is the typed spelling's page 1.
  - **No name** (filters, bare browse or homebrew): `getFullMonsterList(asker, { bound: snapshot })`. **No name, with a book**: `getFullMonsterList(asker, { sourceIds, bound: snapshot })`.
  - **Unknown type or size:** no `typeMap` name, and no size name in `config.creatureSizes` or `SIZE_MAP`, contains the lowercased text. Return the zero-result tail **before any `/v1/Monster?search=` request**:
    - homebrew: "No homebrew monsters found matching the search criteria." (with the name variant if a name was given);
    - a book: "No monsters matching the search criteria in <book>." with no appears-in hint;
    - otherwise: Open5e `"not-found"`.
- **Delete** from the search: `fetchMonsterPages`/`MAX_FILTER_SCAN` use, `partialScan`, `totalText`, `nameCapped`, the per-name cap note, `matchedBy`, the "Refine your search with a name term" line, and the `(checked …)` scope suffix on no-match messages.
  - `getMonster`'s homebrew path keeps `fetchMonsterPages(…, MAX_FILTER_SCAN, …)` (non-goal). Fix its comment, which claims parity with search.
- **Count line:** `` `**Monster Search** (${formatCount(shown)} shown of ${formatCount(total)}${complete ? "" : "+"} matching)` ``, where `total` is the number of selected, filtered rows.
- **Incomplete note:** when `!complete`, add `` `\n*Only ${formatCount(checked)} of ${formatCount(scanTotal)}+ entries could be read from D&D Beyond, so the count may be short. Try again in a few minutes.*` ``.
- The lines shown are still capped at `PAGE_SIZE` (100) in this task; Task 8 changes it.

- [ ] **Step 1: Write the new failing tests:**
  - `split-twin fixture`: in `leadMonsters`, a 2014 "Gnarl Hag" (Legacy, source 1, `typeId: 16` Undead). In `extraMonsters` (beyond entry 600), a 2024 "Gnarl Hag" (source 147, `typeId: 8` Humanoid).
    - `{ type: "undead" }` (2024): Gnarl Hag is not listed, and the footer counts 1 hidden. No line says "no 2024 version found".
    - `{ type: "humanoid" }`: `- **Gnarl Hag** [2024]`.
  - `cr: 21` finds `CR21_TARGET` (today beyond 600): `(1 shown of 1 matching)`.
  - Bare browse `{}`: `(100 shown of ${N} matching)`, where the test computes `N` from the fixtures. Exactly one empty-term scan, all with `take=100`.
  - `"Filler"` (652 hits > 500) uses the full list: no `search=Filler&skip=100` request; `(100 shown of 652 matching)`.
  - 150 `"Murk …"` fixtures page in full: `search=Murk` at `skip=0` and `skip=100`; `(100 shown of 150 matching)`.
  - Unknown `type: "dragonish"` makes zero `/v1/Monster?search=` requests.
  - `source: "homebrew"` counts every homebrew fixture, wherever it sits in the list.
  - Incomplete: `firstPageTotal = 900` gives `+ matching)` and the "could be read" note.
- [ ] **Step 2: Update the existing tests that encode the removed behaviour.** Each one gets its new exact expectation, and the intent of the incompleteness guards is kept:
  - `tests/monster.test.ts` :671 and :956 (`3 total matched by source` → `(3 shown of 3 matching)`; drop the `take=100&sources=6` URL check only if the request shape changed); :703-717 (the 600-cap note → the exact count, no note); :798-799 (reordered pages → after the retry, the exact count, or `+` and the note when the mock still hides entries); :1459-1460 and :1722-1725 (Filler → `(100 shown of 652 matching)`, no cap note); :1523-1529 (no-match without the `checked the first 600` scope); :1710-1719 (`checked 160 of 160` → `(… shown of … matching)` with no `+`); :1979-2003 (lagging page → exact, the tail reads all 160; the "genuine 100" case stays plain); :2104-2121 (600-of-600 / 642 → the exact book count); :833 (`/\d+ shown of [\d,]+ matching\)/`, still no "matched by name").
  - `tests/monster-session.test.ts` :77-90 and :95 (the account-swap scan still falls back to `O5 SEARCH RESULT`; the assert count that triggers the swap moves with the new request order, so recount it; the in-account scan → `(30 shown of 30 matching)`), and :157-185 (the hint's snapshot gating is unchanged, since R8 keeps `availableSourcesFor`).
  - **Don't touch** :1437-1440 (`getMonster` `take=20`, a non-goal) or `tests/session-lifecycle.test.ts:405`.
- [ ] **Step 3: Run** `npx vitest run tests/monster.test.ts tests/monster-session.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `npm test`. Expected: green.
- [ ] **Step 6: Commit** `feat(monster): exact monster search totals over complete candidate sets (B11)`

### Task 8: 50 shown, narrowing hint, `list_all`, bounded probes, site-search flag

**Files:**
- Modify: `src/tools/monster-search.ts`, `src/tools/edition-search.ts`, `src/server.ts` (`ddb_search_monsters` :330-357; `ddb_clear_cache` description ~:142-147), `src/tools/search.ts:71`
- Test: `tests/monster.test.ts`, `tests/edition-search.test.ts`, `tests/search-site.test.ts`

**Interfaces:**
- Produces in `src/tools/edition-search.ts`:
  - `export const MONSTER_SEARCH_LIMIT = 50` and `export function orList(items: string[]): string`. `orList(["cr","type","size","source"])` → `"cr, type, size or source"`, and one item → that item.
  - `export function narrowingHint(o: { total: number; approxKb: number; unused: string[]; siteSearch: boolean }): string`, with this exact copy:
    - default: `` `Narrow the search (add ${orList(unused)}), or repeat with \`list_all: true\` to list all ${formatCount(total)} (about ${formatCount(approxKb)} KB).` ``. With `unused` empty: `` `Narrow the search, or repeat with \`list_all: true\` to list all …` ``.
    - site search: `` `Narrow the search, or use ddb_search_monsters with \`list_all: true\` to list all ${formatCount(total)} (about ${formatCount(approxKb)} KB).` ``
- `MonsterSearchParams` gains `listAll?: boolean` and `siteSearch?: boolean`. `search.ts:71` passes `siteSearch: true`, never `listAll`. `listAll` is ignored when `siteSearch` is set.
- `unused` = whichever of `cr`, `type`, `size`, `source` weren't given, in that order. `approxKb = Math.round(avgBytes * total / 1024)`, where `avgBytes` is the mean `Buffer.byteLength` of the rendered shown lines.
- Shown rows: all of them with `listAll`, else the first `MONSTER_SEARCH_LIMIT`. When `!listAll && total > MONSTER_SEARCH_LIMIT`, add the hint line. It replaces "*N more matches not shown.*".
- `withListStats` and `srdBackedGroups` use `mapWithConcurrency(…, O5_PROBE_CONCURRENCY = 8, …)` (their inner functions already catch).
- Server param: `list_all: z.boolean().optional().describe("List every match instead of the first 50. Use only after a search has reported the total and size; a full list can be hundreds of KB.")`. Mention it in the tool description.
- `ddb_clear_cache`: the `monsters` text also names "the full monster list".

- [ ] **Step 1: Write the failing tests:**
  - `cr: 0.25` (> 50 matches) gives 50 `- **` lines, `(50 shown of ${N} matching)`, and a hint that names `type, size or source` and ends with `/about [\d,]+ KB\)\.$/`.
  - The same with `listAll: true` gives N lines and no hint.
  - `siteSearch: true` gives the site-search wording. `{ siteSearch: true, listAll: true }` still shows 50.
  - ≤ 50 matches: no hint.
  - `withListStats bounded`: logged out, `listAll`, 40 locked zero-stat fixtures; `o5MonsterInEdition` counts in-flight calls (a `setTimeout(0)` await inside). Max === 8.
  - `srdBackedGroups bounded`: logged out, 40 pairs (2024 locked + free 2014 twin), the same counter. Max === 8.
  - `tests/edition-search.test.ts`: `narrowingHint` exact strings for 0, 1 and 3 unused filters and for site search; `orList` for 1, 2 and 4 items.
  - `tests/search-site.test.ts`: `sections.monsters` is called with `siteSearch: true`.
  - Update Task 7's `(100 shown of …)` expectations (bare browse, Filler 652, Murk 150, and :1478 "of 109") to `(50 shown of …)`.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: green.
- [ ] **Step 5: Commit** `feat(monster): 50 results by default with exact totals and list_all (B11)`

### Task 9: Open5e fallback — word-start matching, 50 and `list_all`

**Files:**
- Modify: `src/open5e.ts` (`o5Select` ~:494, `SEARCH_CAP` ~:553, `O5MonsterSearchParams` ~:839, `o5SearchMonstersSection` ~:851); `src/tools/monster-search.ts` (pass `source`, `listAll` and `siteSearch` through)
- Test: `tests/open5e.test.ts`, `tests/search-site.test.ts`

**Interfaces:**
- `o5Select` opts gain `wordStart?: boolean`. When it is set, `nameMatches` uses `matchesAtWordStart(e.record.name, opts.name)`. Otherwise it keeps `o5Folded(...).includes(query)`. Only the creature search sets it.
- `O5MonsterSearchParams` gains `source?`, `listAll?` and `siteSearch?`. `source` is used only to work out the unused filters; Open5e doesn't filter by book, and `withSourceCaveatSection` stays.
- Monster lines are capped at `MONSTER_SEARCH_LIMIT`, or not at all with `listAll`. Past the cap, the extra line is `narrowingHint(...)` instead of the refine hint, with `approxKb` worked out as in Task 8. The heading is `Found N monster(s) (showing M, SRD only):`.
- Items keep `SEARCH_CAP = 20` and the refine hint.

- [ ] **Step 1: Write the failing tests** (`tests/open5e.test.ts`; add creature records to its fixtures where missing):
  - `name: "goblin"` lists Goblin but not Hobgoblin.
  - `name: "will o wisp"` lists Will-o'-Wisp.
  - A `size: "medium"` search with > 50 records shows 50 lines plus the hint; with `listAll`, all of them.
  - Split the `REFINE` test (:791-806): items keep `REFINE` and `showing 20`, and monsters assert the hint.
- [ ] **Step 2: Run** `npx vitest run tests/open5e.test.ts tests/search-site.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: green.
- [ ] **Step 5: Commit** `feat(open5e): word-start monster matching and the 50/list_all rule (B11)`

### Task 10: The search's "appears in" hint uses the same matching (R8)

**Files:**
- Modify: `src/tools/monster-search.ts`
- Test: `tests/monster.test.ts` (extend `describe("the available-sources hint lists official entries only")` ~:803), `tests/monster-session.test.ts`

**Interfaces:**
- Produces (module-private): `searchAppearsIn(name: string, index: SourceIndex, asker: Asker, bound: SessionSnapshot): Promise<string[]>`. It is used only by the search's empty-book path (and R9's lead line). `getMonster` keeps `availableSourcesFor`.
- `searchAppearsIn` works like this:
  - Fetch page 1 of the unfiltered name (`fetchMonsterList(name, PAGE_SIZE, { asker, bound })`). If total > `PAGE_SIZE`, page up to `NAME_SCAN_LIMIT` entries with the same `bound`, and **never** use the full list.
  - Keep official entries in known books that pass `nameMatcher(name)`, sorted by `monsterTiebreak`, and map them to unique `sourceLabel`s.
  - Any failure yields `[]`.

- [ ] **Step 1: Write the failing tests:**
  - `source: "cos", name: "goblin"` with no goblin in CoS: the appears-in list doesn't name a book whose only hit is Hobgoblin Warrior or Kobold Warrior (`ANY_WORD`).
  - A book whose only real hit comes after 25 earlier fillers is still named.
  - `getMonster("Zombie", { source: "cos" })`'s "Available sources" text is unchanged. Snapshot today's string before implementing.
  - `tests/monster-session.test.ts`: a search hint fetched after an account change is dropped, mirroring the existing get test at :157-185.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: green.
- [ ] **Step 5: Commit** `fix(monster): search book hint uses word-start matching (B11)`

### Task 11: Live measurement, docs, final reviews

**Files:**
- Modify:
  - `docs/claude/tool-notes.md`, `docs/claude/caching.md`, `docs/claude/history.md`;
  - `docs/claude/architecture.md` (key-modules rows for `monster-service.ts`, `monster-search.ts`, `name-match.ts`);
  - `docs/superpowers/specs/2026-11-06-regression-report.md` (B11/B12 status) and the spec's status line;
  - `README.md` (`ddb_search_monsters` row ~:194; `ddb_clear_cache` text ~:231);
  - `CLAUDE.md`: the key-modules one-liners, "Safety gates" (add `ddb_search_monsters` `list_all`), the caches bullet, and "Open work" item 3 (B11/B12 closed; date 2026-11-10).

- [ ] **Step 1: Live checks.** Run `npm run build` and call through the built server, logged out and then logged in (owner's free account). Record each result:
  - `name: "goblin"`: goblins only (the spec expects 23), no Hobgoblin Warrior.
  - `"gobiln"`: the label and ≤ 10 lines.
  - `"vorpal"`: Avoral Guardinal under the label.
  - `cr: 5, type: "undead"`: includes Wraith.
  - `ddb_search_site "Vorpal"`: the monster section is shown, with the label.
  - The first filter search: time it logged out and in at 8, then try 4 and 16 once. If 8 is far slower, bring both numbers to the owner before changing `SCAN_CONCURRENCY`.
  - Logged out, `type: "humanoid", list_all: true`: time and output size.
  - `source: "egtw"`: the 2014-book note.
  - A site search for a common word (> 500 hits, R2): its time, cold and warm.
- [ ] **Step 2: Docs.**
  - tool-notes: R1, the twin rule, near matches (R9, R10), 50 / `list_all`, R5 order, R2 paging, Open5e parity, R8.
  - caching.md: the full-list cache (keys, TTLs, pending, hook, clear, `noCache` pages, R3 retry and tail, R11 deadline).
  - history.md:
    - B11/B12 closed, with the commit range;
    - the spec's owner rulings, and R1–R11, dated 2026-11-10;
    - the G13 count and the Checkpoint A results;
    - carry-over **(bp)**: `ddb_get_monster` reads 20 candidates per spelling, so in a crowded name it can miss a monster the paged search lists;
    - carry-over **(bq)**: `monsterSearchParts`' catch-all turns a mid-call `SessionChangedError` into the Open5e "unavailable" answer, unlike `getMonsterStats` (pre-existing, found in plan review).
  - The spec errata above.
- [ ] **Step 3: Reviews.**
  1. Adversarial review of the B11 diff (`git diff <B11 start>..HEAD -- src tests`) with `opencode run -m opencode/deepseek-v4.1-flash-free`.
  2. Then the same for the whole change (B12 + B11 + docs).
  3. Spot-check every finding, and fix the confirmed ones in separate commits. Use Codex (`codex:rescue`) if the Zen quota is out.
  4. Then one Claude whole-branch review (superpowers:requesting-code-review, most capable model).
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test`. Expected: green.
- [ ] **Step 5: Commit** `docs: record monster search quality and Critical Role books (B11, B12)`
