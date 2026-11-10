# Monster search quality (B11) and Critical Role books (B12) — design

Date: 2026-11-10. **Status: implemented 2026-11-10** (B12 `be82007..3196364`, B11 `3196364..744b3ac`; run record and the rulings made during the run in [history.md](../../claude/history.md)). Source: regression report B11 and B12
([2026-11-06-regression-report.md](2026-11-06-regression-report.md)). Every
decision marked **owner ruling 2026-11-10** was made by the owner in the
brainstorming session; everything marked **builder's call** may be changed by
the implementer if they find a better answer, and should be noted if so.
Reviewed before planning by a cold-read builder check (Claude) and an
adversarial review (opencode `deepseek-v4.1-flash-free`); their findings are
folded in below.

## Why

- **B11.** `ddb_search_monsters name: "goblin"` (and the monster section of
  `ddb_search_site`) lists 78 entries: 23 goblins and 55 unrelated
  "… Warrior" creatures (Kobold Warrior, Ratling Warrior, Warrior Infantry,
  Vampire Warrior, …). Searches that filter only by CR/type/size check the
  first 600 of D&D Beyond's 6,113 monsters, so `cr: 5, type: "undead"`
  returns 3 results and misses Wraith (MM 2024). Both make the search look
  wrong to a DM.
- **B12.** D&D Beyond's "Critical Role" source category (id 2) is classed as
  `third-party`, but three of its books are Wizards of the Coast 5e (2014)
  books, so e.g. `ddb_list_library` shows Frozen Sick as `[third-party]`.

## Root causes (verified live 2026-11-10)

- The 2024 rename pair `["Goblin", "Goblin Warrior"]`
  (`src/edition-renames.ts:231`) makes the search also query "goblin warrior"
  (`twinAliases` in `searchMonstersSection`, `src/tools/monster.ts` ~763).
  D&D Beyond's monster service matches **any word**: "goblin" → 25 results,
  all goblins; "goblin warrior" → 85 results, including every "Warrior". The
  merged list is never checked against the query. Every rename that adds a
  common word does the same (Hobgoblin → Hobgoblin Warrior, Bugbear →
  Bugbear Warrior, …).
- The service is also typo-tolerant: "vorpal" → Avoral Guardinal (its only
  hit), "gobiln" → 25 goblins, "beholdr" → Beholder…, "owlbar" → 12 owlbears.
- D&D Beyond matches at **word starts**: "goblin" never returns Hobgoblin;
  "wraith" returns "Sword Wraith".
- CR/type/size are filtered client-side over at most `MAX_FILTER_SCAN = 600`
  entries (`fetchMonsterPages`, `src/tools/monster.ts:451`).
- B12: `CATEGORY_TABLE` in `src/edition.ts:73` classes the whole category 2
  as `third-party`. Category 2 holds five sources (live config = snapshot):

  | Source id | Book | Publisher |
  |---|---|---|
  | 31 | "Critical Role" (no sourceURL, no monsters) | Critical Role / Matt Mercer (believed to hold the Blood Hunter class — unverified) |
  | 59 | Explorer's Guide to Wildemount (EGtW) | Wizards of the Coast, 2020 |
  | 62 | Frozen Sick (WA) | Wizards of the Coast, 2020 |
  | 83 | Critical Role: Call of the Netherdeep (CotN) | Wizards of the Coast, 2022 |
  | 123 | Tal'Dorei Campaign Setting Reborn (TCSR) | Darrington Press, 2022 |

### Why server-side filtering was rejected (measured 2026-11-10)

The monster service does filter server-side, through undocumented
parameters (probed anonymously): `challengeRatingMin`/`challengeRatingMax`
(CR **id**, inclusive), `monsterTypes` (type id, repeatable, OR) and
`monsterSizes` (size id; repeat/OR and combined sizes unprobed). CR 5 +
undead → 49, Wraith included. Many other spellings are silently ignored.

But a server-side filter splits edition twin groups whose CR/type/size
changed between editions: the requested edition's twin is never fetched, so
the other edition's entry is shown with a false "no 2024 version found"
reason. Over the full list (6,113 entries, 5,353 twin groups, 440 with both
editions): 54 groups changed type, 45 size, 4 CR. A 2024 `type: humanoid`
search would show 33 false labels; `size: medium`, 44. Guessing from
`isLegacy` doesn't work: 446 Legacy entries have no 2024 twin, so it would
wrongly hide 73 (humanoid) / 117 (medium). Per-group twin lookups would cost
up to ~150 extra requests per broad search. **Owner ruling 2026-11-10: use a
full cached list instead** (goal 4).

## Goals

### B11 — monster search

1. **Name matching is word-start (owner ruling 2026-11-10).** With `name`,
   an entry matches when the normalized query (`normalizeName`: lowercase,
   curly apostrophes folded, whitespace collapsed) occurs in the normalized
   entry name **at the start of a word** — position 0, or preceded by a
   character that is not a letter or digit (space, hyphen, parenthesis,
   quote). "goblin" matches Goblin Boss, Dust Goblin, "Goblin Warrior
   (Stranger Things)"; not Hobgoblin or Hobgoblin Warrior. "red dragon"
   matches Adult Red Dragon. A multi-word query must match as one run.
   The rule is one shared monster-name predicate, used everywhere a monster
   search matches names (goal 10).
2. **A renamed twin still counts (owner ruling 2026-11-10).** An entry also
   matches when it is in the typed name's twin group (`monsterTwin(entry.name)
   === monsterTwin(query)`), so "thug" still finds the 2024 Tough. Twin
   aliases keep being queried for this reason; their other hits are dropped
   unless they match rule 1.
3. **Near matches when no name matches (owner ruling 2026-11-10, option B).**
   The trigger is precise: **no fetched entry passes rules 1–2, judged before
   the CR/type/size filters and before edition selection.** Then, if D&D
   Beyond returned hits for the typed name, list them under a clear label,
   e.g. *"No monster names match "gobiln". Closest matches from D&D
   Beyond:"*. If some entry passes rules 1–2 but the filters or edition
   selection remove everything, today's no-match paths apply unchanged
   (including the `hidden > 0` "only the other edition has it" branch) —
   never the near-match label. If D&D Beyond returned nothing at all,
   today's Open5e not-found fallback is unchanged.
   - Near-match lines are built by the normal line builder: same edition tag,
     source, homebrew predicate (`isHomebrew === false` means official) and
     `wrapIfHomebrew` wrapping. They must never look like matches.
   - In `ddb_search_site`, a near-match section must not set `noMatch`
     (the `"all"` path drops `noMatch` sections, `src/tools/search.ts:41-42`).
   - Builder's call: near matches use only the typed name's own query (not
     twin aliases), keep CR/type/size/source filters, and show at most 10
     lines (they are guesses).
4. **Filter-only searches use the full cached list (owner ruling
   2026-11-10).** A search with CR/type/size and no `name` (and a bare
   browse, goal 6) pages through the **entire** monster list, filters
   locally with today's `passes` semantics (CR id equality; type/size name
   `includes`), and runs edition selection over every entry, so totals and
   edition labels are exact.
   - **Cache:** a dedicated list cache, separate from `monsterCache` (the
     200-entry, 24 h `TtlCache` at `src/tools/monster.ts:60` would be flushed
     by 62 pages). It stores only the fields the search needs (id, name,
     CR/type/size ids, AC, HP, `isLegacy`, `isHomebrew`, `sourceId`,
     `sources`, plus the access map), not the stat-block HTML (a raw page is
     ~247 KB; 62 pages ≈ 15 MB). 24 h TTL. It must follow the cache rules in
     `docs/claude/caching.md` and CLAUDE.md: keyed per asker
     (anonymous vs account), cleared by an `onSessionInvalidated()` hook,
     concurrent cold callers deduped through a pending entry, and the pending
     fetch may write only while it is still the authoritative entry (so
     `ddb_clear_cache` or a session change mid-scan leaves nothing behind).
     One `SessionSnapshot` for every page, as `fetchMonsterPages` does now.
   - **Completeness:** the service can reorder entries between pages
     (comment at `src/tools/monster.ts` ~455). If the distinct entries seen
     are fewer than the reported total, never present the result as exact:
     builder's call between re-fetching the short pages and printing the
     existing "checked N of M" wording; an incomplete scan must not be
     cached for 24 h as if complete.
   - **Cost:** first filter search per asker per 24 h ≈ 10 s (62 parallel
     anonymous pages measured 9.5 s); afterwards local. Builder's call on
     page concurrency (`mapWithConcurrency` exists); report the measured time.
   - A `type`/`size` text that matches no known type/size name returns the
     existing no-match result **without** fetching the list.
   - `name` + filters keeps the name path (goal 1–3): the name queries
     already return every twin, so local filtering is exact there.
   - `source` (a book) keeps the server-side `sources=` parameter (no twin
     selection applies, `source` wins); with filters it pages that book fully
     instead of stopping at 600.
   - `source: "homebrew"` uses the same full list with its existing
     fail-closed `isHomebrew` check, so its totals are exact too.
   - The server-side filter parameters above are **not** used.
5. **Default 50 shown, with exact total and a narrowing hint (owner ruling
   2026-11-10).** Every monster search (name, filters, source, homebrew,
   bare browse) lists at most **50** entries. The count line gives the exact
   total after edition selection, e.g. *"50 shown of 1,601 matching"*. When
   more than 50 match, add a line: *"Narrow the search (add cr, type, size
   or source), or repeat with `list_all: true` to list all 1,601 (about
   190 KB)."* The total is recomputed from the final filtered, selected list
   — not from `pagination.total` sums (`src/tools/monster.ts:767-792`), whose
   `partialScan`/`totalText`/`nameCapped` logic is replaced, not patched.
   Builder's call: name only the filters not already used; estimate size
   from the rendered average line length × total, rounded.
6. **Bare browse is exact too (owner ruling 2026-11-10).** No name, filters
   or source: same full cached list, 50 shown of the exact total after
   edition selection (today: one page of 20, `take` at
   `src/tools/monster.ts:752`).
7. **`list_all: true` lists everything, no ceiling (owner ruling
   2026-11-10).** New optional boolean on `ddb_search_monsters`. The
   50-line warning above is the confirmation step — two steps only, no
   second flag, no intermediate tier. This is the tool's safety gate in the
   sense of CLAUDE.md "Safety gates" (add it to that list). Per-line work
   must stay bounded: `withListStats` (one Open5e probe per locked,
   zero-stat line, `src/tools/monster.ts:1155`) and `srdBackedGroups`
   (one Open5e probe per logged-out group that would swap, `:1185`) both use
   one unbounded `Promise.all` today; give both a concurrency bound and
   measure the logged-out `type: humanoid` + `list_all` case.
8. **Name searches are exact.** Name searches page through all of D&D
   Beyond's hits for each spelling (today one page of 100 plus a "first 100
   matches per name were checked" note). "dragon" has 287 hits → 3 pages.
9. **`ddb_search_site`** reuses `searchMonstersSection`, so it gets goals
   1–6. It does not get `list_all` (builder's call); when its monster
   section is cut at 50, the monster section itself emits the hint to use
   `ddb_search_monsters` with `list_all` (`runCategory` can't). The section
   needs a flag saying it is rendering for site search.
10. **The same matching everywhere (owner ruling 2026-11-10).** The
    word-start predicate also applies to the Open5e SRD fallback's monster
    search (`o5Select` in `src/open5e.ts` matches by `includes` today and is
    shared with spells and items — add a monster-only option; spells and
    items keep substring matching) and to the "appears in" hint of an empty
    book search (`availableSourcesFor`, which reads one page of 20 today —
    builder's call whether it pages).
11. **Open5e fallback gets the same 50 / `list_all` rule.** Its cap is
    `SEARCH_CAP = 20` (`src/open5e.ts:553`), shared with item search: add a
    separate monster constant, leave items at 20, plumb `listAll` through
    `O5MonsterSearchParams`, and keep its source caveat
    (`withSourceCaveatSection`).

### B12 — Critical Role books

12. **Per-source ruleset override (owner ruling 2026-11-10).** Sources 59
    (EGtW), 62 (Frozen Sick) and 83 (CotN) classify as **2014**. Sources 31
    and 123 stay **third-party**. Implement as a small source-id override
    table in `src/edition.ts`, with a comment giving the publisher evidence,
    consulted wherever a source's ruleset is derived. Today that is
    `categoryRuleset(...)` at `edition.ts:110` (source index), `:184`
    (`classifyWithSource`) and `:889` (`dualBook`); replace them with one
    function that takes the source, so they can't disagree.
13. **The override takes part in dual-edition detection** (builder's call,
    consistent with carry-over (ab): "dual-edition" means a 2014 book plus a
    2024 book). A definition listing EGtW/WA/CotN and a 2024-category book
    becomes dual-edition. Measure how many such definitions exist where the
    free account can see them, and report it.
14. **`scripts/dump-edition-renames.mts`** reports only unknown categories,
    which is unaffected. Its rename-candidate report classifies via
    `classifyEdition`, so it will list ~104 new 2014 "orphans" (the
    Wildemount/CotN/Frozen Sick monsters): expected, add no pairs for them.
    `--snapshot-only` must stay green.
15. **Library join.** `src/tools/library.ts:159-171` joins a library book to
    a source only when all candidate ids agree on ruleset, else `unstated`.
    Check `ddb_list_library` for the Critical Role books after the change; if
    a book now drops to `[edition not stated]`, prefer the more specific
    candidate rather than `null`.

## Measured impact (live 2026-11-10)

- **B11:** "goblin" goes from 78 entries to the goblins only (23 after
  edition selection; no Hobgoblin Warrior). "gobiln" goes from 25
  unlabelled goblins to labelled closest matches (10 shown). "vorpal" shows
  Avoral Guardinal labelled as a closest match. `cr: 5, type: "undead"` goes
  from 3 to every match (49 raw, fewer after twin selection), Wraith
  included. The first filter search per account per 24 h takes ~10 s
  instead of ~2 s; later ones are local.
- **B12:** the three Wizards books have 118 distinct monster names. 104 are
  unique and change tag `[third-party]` → `[2014]`; they still show in
  default 2024 searches (no 2024 version exists). 14 share a name elsewhere
  but are already `isLegacy` → already `[2014]`. Lacedon, Sword Wraith
  Commander and Sword Wraith Warrior have twins only in other 2014 books.
  No monster becomes newly hidden behind a 2024 version. `source: "egtw"`
  with the default 2024 edition gains the usual "this book is 2014" note.
  Characters using Wildemount options (Echo Knight, Chronurgy, Graviturgy)
  count them as 2014 instead of third-party. Spells, subclasses and items
  can't be fully measured on the owner's free account (goal 13).

## Non-goals

- `ddb_get_monster` and `getMonsterStats` lookups are unchanged
  (`getMonsterStats` never guesses; `ddb_get_monster` keeps its documented
  exact → partial → closest-hit order and its 20 candidates per spelling).
  Known consequence: a monster the paged search lists could, in a crowded
  name, be missed by `ddb_get_monster`'s 20-candidate read. Record it as a
  carry-over in history.md rather than fix it here.
- The other catalog searches (spells, items, feats, …) keep their own
  limits and substring matching.
- Re-classifying any other category or source.

## Anti-goals (would make this a failure even if it "works")

- A wrong monster presented as a match (the bug itself). Near matches must
  never look like matches.
- A total that silently undercounts or overcounts ("50 shown of 85" when 24
  match; "of 600" when 1,601 match).
- A false edition reason ("no 2024 version found" when one exists).
- Any account-derived cache that ignores the session lifecycle (goal 4).
- Edition label text built outside `src/edition.ts`.
- Homebrew/user-authored text left unwrapped in any new output path
  (near-match lines included).
- Unbounded fan-out to D&D Beyond or Open5e from one tool call.

## Constraints

- Repo invariants in `CLAUDE.md` (rules edition, untrusted text, caches,
  MCP annotations — `ddb_search_monsters` stays read-only).
- Tests first; `npm run typecheck && npm run lint && npm test` green before
  each commit. Tests that encode today's numbers will change: `take=20`
  (`tests/monster.test.ts:1439`), "100 shown of 109 matching" (`:1478`),
  "100 shown, 652 total matched by name" plus the per-name note (`:1724`),
  and the Wildemount Bullywug test (`:655-664`, whose comment says egtw is
  third-party). Add a Goblin/Goblin Warrior fixture with an unrelated
  "… Warrior" hit, a split-twin fixture (a pair whose type differs between
  editions), and a near-match fixture.
- Docs to update: `docs/claude/tool-notes.md` (monster search behaviour,
  `list_all`), `docs/claude/caching.md` (the new list cache),
  `docs/claude/history.md` (B11/B12 closed, the owner rulings above dated
  2026-11-10, the `ddb_get_monster` carry-over), the regression report's
  status for B11/B12, the README tool table if it lists params, CLAUDE.md
  "Safety gates" (`list_all`) and "Open work" item 3.
- Adversarial review (owner ruling 2026-11-10): opencode Zen
  `deepseek-v4.1-flash-free` on this design, on each finished fix (B11, B12
  separately), and on the whole change before commit; Codex review when the
  Zen quota runs out.

## Left to the builder

Everything marked "builder's call", plus: function/param naming beyond
`list_all`, the exact wording of the near-match and narrowing lines (plain,
short, consistent with existing search output), and how B11 splits into
tasks.
