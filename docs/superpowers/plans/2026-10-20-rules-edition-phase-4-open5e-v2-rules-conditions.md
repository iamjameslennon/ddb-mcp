# Rules Edition Phase 4 (Open5e v2, Rules and Conditions) Implementation Plan

**Outcome (2026-10-21):** done, commits `15e57e5..9d5ec31` plus the docs commit. Tasks 1–6 shipped; the owner rulings made during execution and the new follow-ups are recorded in the spec (phase 4's per-source section) and CLAUDE.md (Next steps, carry-overs (l)–(q)).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review round (2026-10-20).** Four adversarial reviewers (two Claude, two opencode DeepSeek) checked the first draft against the spec, the code and the live API. Every finding below was re-verified against live data before it was accepted. This revision makes these changes:
- **Lookups and searches now run over both SRD documents at once**, through `lookupByName` / `groupAndSelect`. The draft looked in one document, then the other. That gave false "no 2024 version found" lines for renamed entries ("evocation", "thug") and for attribute misses (2024 goblins are Fey), and it dropped 2014-only entries from 2024 searches. Open5e searches therefore get a header and footer of their own.
- **Open5e lookups suppress false rename lines.** SRD 5.2 keeps 2014 spellings such as "Arcane Hand" for 2024 entries.
- **Null-safe class and species formatting.** Subclasses have no hit dice, SRD 5.1's `caster_type` is null, and SRD 5.1 traits are untyped.
- **Saving throws show only proficient saves**, because 2024 records list all six.
- **Smaller fixes:** shields, `hover`, `12hours`, SRD 5.1's `srd_` key prefix and the Background chapter; the Net test case is replaced by Abacus; the path markers are named; lint cleanup, test-stub ordering and spell-search paging are spelled out; the fixture size cap is raised; and the missing reason tests are added.

**Goal:** Every Open5e answer comes from Open5e **v2**, choosing between SRD 5.2 (2024) and SRD 5.1 (2014) the way D&D Beyond answers do: 2024 by default, 2014 on request or where it is the only version, and always saying which. `ddb_search_rules` / `ddb_get_rules` / `ddb_get_condition` take `rules_edition`, and Exhaustion gives the 2024 text by default and the 2014 six-level table on request.

**Architecture:** `src/open5e.ts` stops asking Open5e to filter anything except the document. It loads one whole document per endpoint (`?document__key__in=<doc>&limit=1000`, cached 1 h, one in-flight fetch per URL) and drops any record from another document. It then runs the phase-1 selection code from `src/edition.ts` over both documents' records together, with each record's ruleset taken from its document: `lookupByName` for gets and `groupAndSelect` for searches. Rules come from `/v2/rulesets/` (chapters with their sections nested), are not twin-grouped (per the spec), and try the requested document first. Conditions move into a new `src/tools/conditions.ts`, which holds the existing 2014 table and a new 2024 table transcribed from SRD 5.2.1.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), `@modelcontextprotocol/sdk` 1.32, zod, vitest. Open5e v2 REST API (no auth).

**Spec:** [docs/superpowers/specs/2026-10-16-rules-edition-design.md](../specs/2026-10-16-rules-edition-design.md). Read Principle, Vocabulary and labels, The edition module (gather algorithm and search pipeline), "Open5e, rules and conditions — phase 4", and Phase 4. Phases 1–3 are done, so the real signatures are in `src/edition.ts` and `src/tools/edition-search.ts`, not the spec's sketch. **The decisions below refine the spec where the live API differs from its 2026-10-16 probe. Task 6 writes them into the spec. Until then, where they differ, this plan wins.**

## Live API facts (probed 2026-10-20, re-verified by the review round)

Task 1's record script re-proves these and fails if one stops holding.

| Fact | Consequence |
|---|---|
| `document__key__in=<doc>` restricts **all 11 endpoints** used (spells, creatures, items, magicitems, weapons, armor, species, classes, backgrounds, feats, rulesets). `document__key=<doc>` is **ignored** by `items` and `magicitems`, which return every document, even for `document__key=bogus` | Use `document__key__in` everywhere, and still drop any record whose document key differs |
| **Unknown filter params are silently ignored.** `search` returns the whole document on every endpoint. `ritual`, creature `challenge_rating_decimal` / `type__key` / `size__key`, magicitem `rarity__key`, and `name__icontains` on weapons, armor and classes all do nothing | Send no filter param except `document__key__in` and `limit`. Every other match is client-side |
| `limit=1000` returns each whole document in one page (`next: null`). The largest is creatures in srd-2014: 1.47 MB, about 3 s | Load whole documents. Follow `next` defensively |
| Counts, 2024 / 2014: spells 339/319, creatures 331/325, items 203/237, magicitems 760/499, weapons 38/37, armor 13/12, species 9/13, classes 24/24 (subclasses included, marked by `subclass_of`), backgrounds 4/1, feats 17/1, rulesets 11/41 | SRD 5.1 has only Acolyte and Grappler, so backgrounds and feats have no 2014-only entry |
| Rules: `/v2/rules/` has 56/227 small sections. `/v2/rulesets/` has 11/41 chapters, each nesting all its sections in full (`name`, `key`, `desc`, `index`): 56/56 and 227/227, verified. SRD 5.1's 41 chapters are v1's 45 `sections` minus Adventuring Gear, Conditions, Legal Information and Rest, with "Backgrounds" renamed "Background". **SRD 5.2 on Open5e has no Rules Glossary**: no condition entries, and no "grappl" anywhere (seven sections mention "condition" in passing) | Rules use `rulesets`. A 2024 "grapple" search falls back to 2014 |
| Keys: srd-2024 is prefixed `srd-2024_` (`srd-2024_combat`, `srd-2024_combat_cover`); srd-2014 is prefixed `srd_` (`srd_attacking`, `srd_backgrounds`) | A rules slug is everything after the key's first `_` |
| `/v2/conditions/` has 15 conditions in document `core`, with no edition | Conditions stay vendored, as the spec says |
| A v2 record's `document` is an object `{ key, … }` on every endpoint except rules, where it is a string (`"srd-2024"`); `rulesets[].document` is an object | One `docKey(record)` helper handles both |
| **SRD 5.2 keeps 2014-era names for 30 rename-table pairs** (15 spells such as Arcane Hand, Acid Arrow and Tiny Hut; 10 items; 5 magic items such as Handy Haversack). 47 pairs have the 2014 name only in srd-2014 and the 2024 name only in srd-2024 (School of Evocation/Evoker, Branding Smite/Shining Smite, Thug/Tough, Goblin/Goblin Warrior) | Group both documents by `twinName`; never print a rename line that calls the shown entry's own name the other edition's |
| Creatures: `challenge_rating` is a float (`0.25`). `saving_throws` has all six abilities on every 2024 record (equal to `modifiers` unless proficient) and only the proficient ones on 2014 records. `speed` holds `walk`/`fly`/`swim`/`climb`/`burrow`, `unit`, and sometimes `hover: true`. `actions[]` carry `action_type` (`ACTION`, `BONUS_ACTION`, `REACTION`, `LEGENDARY_ACTION`) and `order_in_statblock`. 2024 goblinoids are type Fey | Format CR as a fraction; show a save only when it differs from the modifier; skip `unit`/`hover` as speeds |
| Spell `casting_time` is a key: `action`, `bonus-action`, `reaction`, `1minute`, `10minutes`, `1hour`, plus `8hours`, `12hours`, `24hours` in SRD 5.1 | Humanize it |
| Classes: subclasses have `hit_dice: null`, `saving_throws: []`, and `hit_points` null (2024) or absent (2014). `caster_type` is `NONE`/`FULL`/`HALF`/`PACT` in 2024 and null for 23 of 24 SRD 5.1 classes | Inherit the hit die from `subclass_of`; omit what is missing |
| Species: SRD 5.2 traits have `type` `SIZE`/`SPEED`/null; SRD 5.1 traits all have `type: null`, `order: null`, with "Size" and "Speed" found by name. SRD 5.1 subraces (High Elf, Hill Dwarf, Lightfoot, Rock Gnome) have no Size or Speed trait. `subspecies_of` is a key (`"srd_elf"`) | Find traits by type, else by name; a subrace takes its parent's |
| The 2024 Shield's armor record has `category: "heavy"` (a data error) and `ac_display: "2"` | Special-case the shield |
| SRD 5.2.1 PDF: `https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf`, linked from `https://www.dndbeyond.com/srd`; 364 pages, SHA-256 `8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87`. The Rules Glossary is pp. 176–191; condition entries are titled `<Name> [Condition]` | Transcription source for the 2024 conditions |

## Decisions this plan makes (flag in review if wrong)

1. **Load whole documents; filter client-side.** This follows from the first three facts. Each endpoint costs one larger request per document, cached 1 h, on a fallback path. In return, no filter Open5e silently ignores can leak another document's records or skip a filter.
2. **Both documents, one selection** (owner decision 2026-10-21, chosen over "requested document, then the other" and a rename-aware variant of it, after comparing user-visible output and cost). Every Open5e get and search loads both documents for its endpoints, in parallel, and selects with phase 1's code, so Open5e answers follow the same Principle and pipeline as D&D Beyond answers:
   - **Gets** use `lookupByName`: exact twin name across both documents, then partial match, then `selectByEdition`. The reason lines follow: `no-2024-version` / `no-2014-version`.
   - **Searches** use `groupAndSelect` with `countFilteredPicks`. A 2014-only entry appears under 2024 tagged `[2014]`, other-edition twins are hidden and counted in a footer, and a group whose pick fails an attribute filter is counted, not answered from the other document.
   - The spec's phase-4 wording ("Query srd-2024 by default, and srd-2014 when requested or when the 2024 query finds nothing") is the single-document reading of the same rule. Applied literally, it gave false reasons in the review round.
   - The cost: a cold fallback fetches both documents (equipment: 8 requests in parallel, about 5 MB).
3. **Accepted edge from decision 2: an exact twin in one document beats a partial match in the other**, as on the D&D Beyond path. `"Rope"` under 2014 gives SRD 5.2's Rope with `(no 2014 version found — 2024 text shown)`, though SRD 5.1 has "Rope, hempen (50 feet)". The rename-table-gap risk in the spec covers this.
4. **Open5e rename lines are suppressed when they would be false.** `lookupByName`'s `renamed` is kept only when the shown entry carries its own edition's spelling: a 2024 entry whose `normalizeName(name)` equals its twin key, or a 2014 entry whose name differs from it. So "Bigby's Hand" under 2024 shows SRD 5.2's "Arcane Hand" with no rename line.
5. **Open5e searches get their own first line**, new wording in `src/edition.ts`, because their lines mix SRD 5.2 and SRD 5.1 entries: `Rules: 2024 by default — SRD 5.2, with SRD 5.1 entries only where no 2024 version was found (Open5e fallback — D&D Beyond unavailable).`, and the mirror for 2014. The usual `searchFooter` closes them. A search that renders a single hit as a detail block keeps the single-lookup label with its reason line.
6. **Rules come from `/v2/rulesets/`, not `/v2/rules/`** (owner decision 2026-10-21; the spec says `rules`). Known gap, accepted: a rules get matches within the requested SRD first, so a 2024 `"spellcasting"` returns SRD 5.2's "Spellcasting" section (part of Multiclassing), because SRD 5.2 on Open5e has no spellcasting chapter; the 2014 Spellcasting chapter needs `rules_edition: "2014"`. Preferring an exact name in the other SRD over a partial one in the requested SRD was considered and dropped: it would not fix this case (the 2024 name is exact), and it would send a 2024 `"attack"` to SRD 5.1's "Attack" section. `ddb_get_rules "Combat"` keeps returning a whole chapter, as v1 did, and section names ("Cover", "Grappling") also work. Searches list chapters, naming the matching sections. Impact: v1's 2014 Adventuring Gear, Conditions, Legal Information and Rest chapters are gone (Rest's text survives inside other chapters). A 2014 `"rest"` get falls back to the 2024 "Resting" section with `(no matching 2014 rules section — 2024 text shown)`. Rules are not twin-grouped (spec): the requested document first, then the other one.
7. **Rules search lines carry the edition tag** (`• **Combat** [2024] (slug: …)`), because the consistency test requires a tag on every `ddb_search_*` result line. **A rules search that falls back gets its own reason line**, new wording: `(no matching 2024 rules sections — 2014 sections listed)` / `(no matching 2014 rules sections — 2024 sections listed)`.
8. **Unused Open5e exports are deleted, not migrated:** `fetchO5Cantrips` (the spec says so), `o5GetRace`, `o5SearchWeapons` and `o5SearchArmor` (no importer in `src/`). `o5GetItem` / `o5GetWeapon` / `o5GetArmor` become one `o5GetEquipment`, because exact-before-partial must run across all four equipment endpoints: in SRD 5.2, a partial "Longsword" match hits the magic item "Flame Tongue Longsword" before the weapon.
9. **Wider Open5e coverage.** The equipment fallback search also covers mundane items (v2 `items`) and applies `rarity` / `type`. Open5e monster search applies `size`, which the v1 query never sent.
10. **Conditions move to `src/tools/conditions.ts`:** 150 lines of self-contained data plus one function, out of the 1,500-line `reference.ts`.

## Global Constraints

- The param is exactly `rules_edition: z.enum(["2024", "2014"]).default("2024")`, the existing `RULES_EDITION_PARAM` in `src/server.ts`. Every tool given it appends `RULES_EDITION_TOOL_NOTE` to its description. Internally it is `rulesEdition: RulesEdition`.
- No tool builds edition text. Every `Rules:` line, tag, header, footer, reason and rename line comes from `src/edition.ts`, and new wording gets an exact-string test in `tests/edition.test.ts`. Error and not-found messages carry no label.
- Open5e base URL: `https://api.open5e.com/v2`. Documents: `"2024" → "srd-2024"`, `"2014" → "srd-2014"`. **Every request is document-scoped**, and its only query params are `document__key__in` and `limit=1000`.
- Labels on Open5e content (spec, "Label formats"):
  - Single lookup, line 2: `Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)` / `… (Open5e fallback — not found on D&D Beyond)`, via `rulesLine({ ruleset, book: null }, { open5e: origin, reason })`. Then the reason line, then the rename line, when there is one.
  - Searches: decision 5's header, `[2024]` / `[2014]` immediately after each name, and `searchFooter`.
  - Rules: `Rules: 2024 · SRD 5.2`. Conditions: `Rules: 2024 · SRD 5.2` / `Rules: 2014 · SRD 5.1`.
- Name matching uses `normalizeName` / `twinName` from `src/edition.ts`: case, edge whitespace and curly apostrophes are folded, and renames are applied.
- The Open5e cache stays the 1 h `TtlCache` (capacity 100; at most 22 document entries). A failed fetch is never cached.
- No new dependencies. `@types/node` stays `^22`. The scratchpad venv used to read the SRD PDF (Task 5) is not a project dependency and is never committed.
- ESLint's `no-unused-vars` is an error, so each task deletes the helpers its migration leaves unused (named in each task).
- Every task ends green on `npm run typecheck && npm run lint && npm test`.
- Commits go straight to `main`. Stage files by name, never `git add -A` / `git add .`. The working tree holds owner WIP that must not be committed: `docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md` (untracked), `docs/superpowers/plans/2026-09-16-security-remediation.md` (deleted), and `docs/superpowers/plans/2026-10-16-rules-edition-phase-1-foundation.md` (edited). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Open5e returns another document's records** (a filter it ignores, as `magicitems` does for `document__key`). Expected: only the requested document's records are used. Test in Task 1.
2. **Open5e starts paging** (`next` non-null under `limit=1000`). Expected: every page is read before matching. Test in Task 1.
3. **Open5e fails, then recovers; or two cold callers race.** Expected: the failure surfaces as today's fallback messages ("… DnD Beyond and Open5e both failed.") and is not cached, so the next call retries; two concurrent cold calls send one request. Test in Task 1.
4. **Names that differ by case, punctuation or rename**:
   - `"chain mail"` under 2014 → `Chain mail`;
   - `"Alchemist’s Fire"` (curly apostrophe) → `Alchemist's Fire`;
   - `"Goblin"` under 2024 → `Goblin Warrior` with the rename line;
   - `"Bigby's Hand"` under 2024 → `Arcane Hand` with **no** rename line;
   - a 2024 search for `"thug"` → `Tough [2024]` with 1 hidden;
   - `getMonsterStats("Goblin")` logged out → found, CR 1/4, `[2024]`, not a guess.

   Tests in Tasks 2 and 3.
5. **Records with fields missing in one SRD**: a no-name class search (subclasses have no hit dice), the 2014 High Elf (no Size/Speed of its own), 2014 Wizard (null `caster_type`), the 2024 Shield (wrong category), and a 2024 Wolf (six non-proficient saves). Expected: no throw, no `undefined`/`null` text, no fake saves. Tests in Tasks 2 and 3.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/record-open5e-fixtures.mts` | Create (T1) | Re-proves the live facts; writes trimmed v2 fixtures |
| `tests/fixtures/open5e-v2/{srd-2024,srd-2014}/<endpoint>.json` | Create (T1) | Recorded v2 responses, trimmed to the names in Task 1 |
| `tests/fixtures/open5e-v2.ts` | Create (T1) | Fixture loader and a `fetch` stub that routes v2 URLs to the fixtures |
| `src/open5e.ts` | Rewrite (T1–T4) | v2 document loader (T1); selection helpers, spells, monsters, stats (T2); equipment and options (T3); rules and deletion of the v1 client (T4) |
| `src/edition.ts` | Modify (T2, T4) | `open5eSearchHeader` (T2); `rules-search-miss-*` reasons and `reasonLine` (T4) |
| `src/tools/reference.ts` | Modify (T2–T5) | Fallback call sites pass `rulesEdition` (T2, T3); `searchRules` / `getRule` take it (T4); conditions removed (T5) |
| `src/tools/monster.ts` | Modify (T2) | Fallback call sites pass `rulesEdition`; `getMonsterStats` uses the Open5e result's `info` |
| `src/tools/conditions.ts` | Create (T5) | 2014 and 2024 condition tables; `getCondition(name, rulesEdition)` |
| `src/server.ts` | Modify (T4, T5) | `rules_edition` on `ddb_search_rules`, `ddb_get_rules` and `ddb_get_condition`; their descriptions |
| `scripts/check-conditions.mts` | Create (T5) | Compares the vendored 2024 text with D&D Beyond's rule-data conditions |
| `README.md` | Modify (T5, T6) | SRD 5.2 attribution; tool table rows |
| `CLAUDE.md`, spec | Modify (T6) | Architecture notes, Next steps, the spec's status and decisions |
| Tests | Modify | `tests/open5e.test.ts` (rewritten in T2–T4); new `tests/open5e-v2-filters.test.ts` (T1) and `tests/conditions.test.ts` (T5); `tests/rules-edition-consistency.test.ts`, `tests/spell-editions.test.ts`, `tests/monster.test.ts`, `tests/options-editions.test.ts`, `tests/equipment-editions.test.ts`, `tests/edition.test.ts` |

---

### Task 1: The v2 document loader and recorded fixtures

**Files:**
- Create: `scripts/record-open5e-fixtures.mts`, `tests/fixtures/open5e-v2/srd-2024/*.json`, `tests/fixtures/open5e-v2/srd-2014/*.json`, `tests/fixtures/open5e-v2.ts`, `tests/open5e-v2-filters.test.ts`
- Modify: `src/open5e.ts` (add the loader beside the v1 client; nothing calls it yet)

**Interfaces:**
- Produces, in `src/open5e.ts`:
  - `export type O5Endpoint = "spells" | "creatures" | "items" | "magicitems" | "weapons" | "armor" | "species" | "classes" | "backgrounds" | "feats" | "rulesets";`
  - `export const O5_DOC: Readonly<Record<RulesEdition, "srd-2024" | "srd-2014">>`
  - `export interface O5Record { key: string; name: string; document: { key: string } | string }`
  - `export function docKey(r: { document: { key: string } | string }): string`
  - `export async function loadO5Document<T extends O5Record>(endpoint: O5Endpoint, edition: RulesEdition): Promise<T[]>`
- Produces, in `tests/fixtures/open5e-v2.ts`:
  - `export function o5Fixture<T = O5Record>(doc: "srd-2024" | "srd-2014", endpoint: O5Endpoint): T[]`. It reads with `readFileSync(new URL(…, import.meta.url))` + `JSON.parse`, so no tsconfig change is needed.
  - `export function o5Record<T = O5Record>(doc, endpoint, name: string): T`, which throws when the name is absent.
  - `export function o5FixtureFetch(overrides?: Partial<Record<string, unknown[]>>): (input: unknown) => Promise<Response>`. It routes `https://api.open5e.com/v2/<endpoint>/?document__key__in=<doc>&limit=1000` to `{ count, next: null, previous: null, results }` from the fixtures; `overrides` is keyed `"<doc>/<endpoint>"`. Any other URL returns 404.

- [ ] **Step 1: Write `scripts/record-open5e-fixtures.mts`**

It needs no login. For each endpoint and document, it fetches `…/<endpoint>/?document__key__in=<doc>&limit=1000` and asserts:
- `next` is null;
- every record's `docKey` equals the requested document;
- the count matches the live-facts table within ±10% (Open5e edits content: drift warns, any other failed assertion exits 1);
- each name below is present in exactly the documents its column says, **on that endpoint**;
- every name in a "2014 only" / "2024 only" column of the equipment rows (items, magicitems, weapons, armor) is absent from **all four** equipment endpoints of the other document, so equipment fallback tests can't pass only because a fixture was trimmed.

It also asserts that `…/spells/?document__key__in=bogus&limit=1` has count 0. It checks that `…/magicitems/?document__key=srd-2014&limit=50` returns a `srd-2024` record; if that stops happening, it prints a note rather than exiting, because Open5e fixing the filter is harmless.

It then writes each document's records for the listed names to `tests/fixtures/open5e-v2/<doc>/<endpoint>.json` as `{ "count": <live count>, "next": null, "previous": null, "results": [ … ] }`, pretty-printed and sorted by name. Each record drops `crossreferences`, and its `document` is reduced to `{ key, name }`.

| Endpoint | In both | 2024 only | 2014 only |
|---|---|---|---|
| spells | Fireball, Fire Bolt, Acid Arrow, Arcane Hand, Sleep | Befuddlement, Shining Smite | Feeblemind, Branding Smite |
| creatures | Aboleth, Wolf, Zombie, Red Dragon Wyrmling, Young Red Dragon, Adult Red Dragon, Ancient Red Dragon | Goblin Warrior, Goblin Boss, Allosaurus, Tough | Goblin, Thug, Orc |
| items | Longsword | Rope, Antitoxin, Alchemist's Fire | Abacus, Rope, hempen (50 feet) |
| magicitems | Bag of Holding | Ammunition (+1), Flame Tongue Longsword | Armor of Resistance (Hide) |
| weapons | Longsword, Dagger | Musket | Net |
| armor | — | Chain Mail, Hide Armor, Shield | Chain mail, Hide |
| species | Dwarf, Elf, Human | Goliath | High Elf |
| classes | Fighter, Champion, Wizard | Evoker | School of Evocation |
| backgrounds | Acolyte | Sage | — |
| feats | Grappler | Alert | — |
| rulesets | Damage and Healing | Combat, D20 Tests, Social Interaction | Attacking, Cover, Madness |

The cross-endpoint absence check excludes Net (2014 weapons only; SRD 5.2 lists Net under `items`) and Musket (2024 only, and also in 2024 `items`). Neither is used as an equipment fallback case.

- [ ] **Step 2: Run it and commit the fixtures it writes**

Run: `npx tsx scripts/record-open5e-fixtures.mts`
Expected: one `ok` line per endpoint and document, 22 files under `tests/fixtures/open5e-v2/`, exit 0, and `du -sh tests/fixtures/open5e-v2` under 500 KB. The review measured about 400 KB after trimming.

- [ ] **Step 3: Write `tests/fixtures/open5e-v2.ts`** with the interface above.

- [ ] **Step 4: Write the failing filter tests in `tests/open5e-v2-filters.test.ts`**

`fetch` is stubbed with `vi.stubGlobal`, and `clearOpen5eCache()` runs before each test.

```ts
const ENDPOINTS: O5Endpoint[] = ["spells", "creatures", "items", "magicitems", "weapons", "armor", "species", "classes", "backgrounds", "feats", "rulesets"];
const ONLY = { /* the "2024 only" / "2014 only" columns of Task 1's table, per endpoint */ };

describe.each(ENDPOINTS)("%s", endpoint => {
  it.each(["2024", "2014"] as const)("scopes the request to the %s document and sends no other filter", async ed => {
    const fetchMock = vi.fn(o5FixtureFetch()); vi.stubGlobal("fetch", fetchMock);
    await loadO5Document(endpoint, ed);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe(`/v2/${endpoint}/`);
    expect([...url.searchParams.keys()].sort()).toEqual(["document__key__in", "limit"]);
    expect(url.searchParams.get("document__key__in")).toBe(O5_DOC[ed]);
  });
  it.each(["2024", "2014"] as const)("keeps only %s records when the response mixes documents", async ed => {
    const mixed = [...o5Fixture("srd-2024", endpoint), ...o5Fixture("srd-2014", endpoint)];
    vi.stubGlobal("fetch", vi.fn(o5FixtureFetch({ [`${O5_DOC[ed]}/${endpoint}`]: mixed })));
    const got = await loadO5Document(endpoint, ed);
    expect(got.every(r => docKey(r) === O5_DOC[ed])).toBe(true);
    for (const n of ONLY[endpoint][ed]) expect(got.map(r => r.name)).toContain(n);
    for (const n of ONLY[endpoint][ed === "2024" ? "2014" : "2024"]) expect(got.map(r => r.name)).not.toContain(n);
  });
});
```

Plus these cases on `spells`:
- `"follows next until it is null"`: the first response has 2 records and `next: "<same URL>&page=2"`; the second has 1 record and `next: null`. Expect 3 records from 2 fetches.
- `"caches a document for the hour and shares one in-flight fetch"`: two concurrent calls, then a third, send 1 fetch.
- `"never caches a failure"`: the first fetch returns status 503 and the call rejects; the second call refetches and resolves.
- `"passes an abort signal"`: `fetchMock.mock.calls[0][1].signal` is an `AbortSignal`.
- `"docKey reads object and string documents"`: `docKey({ document: { key: "srd-2024" } })` and `docKey({ document: "srd-2014" })`.

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run tests/open5e-v2-filters.test.ts`
Expected: FAIL, because `loadO5Document` is not exported.

- [ ] **Step 6: Implement the loader in `src/open5e.ts`**

Add `O5_V2 = "https://api.open5e.com/v2"` beside the existing v1 constant, which Task 4 deletes.
- Cache key: the full URL.
- In-flight requests: one `Map<string, Promise<unknown[]>>`, each entry cleared when its promise settles, whether it succeeds or fails.
- Request: `fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(O5_TIMEOUT_MS) })`, with `O5_TIMEOUT_MS = 20_000`. A non-OK response throws `Open5e <status>: <path>`.
- Follow `next` and concatenate the pages, then filter by `docKey(r) === O5_DOC[edition]`.
- `clearOpen5eCache()` also clears the in-flight map.

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/open5e-v2-filters.test.ts`
Expected: PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm run typecheck && npm run lint && npm test`. Expected: all pass.

```bash
git add scripts/record-open5e-fixtures.mts tests/fixtures/open5e-v2.ts tests/fixtures/open5e-v2 tests/open5e-v2-filters.test.ts src/open5e.ts
git commit -m "feat(open5e): v2 document loader, recorded SRD 5.2/5.1 fixtures and per-endpoint filter tests"
```

---

### Task 2: Selection over both documents; spells, monsters and monster stats on v2

**Files:**
- Modify:
  - `src/edition.ts`: `open5eSearchHeader`.
  - `src/open5e.ts`: selection helpers; the spell and monster sections; `o5GetMonsterStats`. Delete `fetchO5Cantrips`, `CR_VALUE_O5` and `o5NameKey`.
  - `src/tools/reference.ts`: the spell call sites, in `searchSpellsSection`'s catch and in `getSpell`.
  - `src/tools/monster.ts`: the six `o5SearchMonsters` / `o5GetMonster` sites and the `o5GetMonsterStats` site.
- Test:
  - `tests/edition.test.ts`.
  - `tests/open5e.test.ts`: the spell, monster and stats cases.
  - `tests/spell-editions.test.ts`: its "Open5e fallback labels" block and its load-failure case.
  - `tests/monster.test.ts`: the mock-call expectations.
  - `tests/rules-edition-consistency.test.ts`: the Open5e spell and monster fixtures.

**Interfaces:**
- Consumes: `loadO5Document`, `O5_DOC`, `docKey` (Task 1); `lookupByName`, `groupAndSelect`, `normalizeName`, `twinName`, `rulesLine`, `renameLine`, `editionTag`, `searchFooter`, `EditionInfo`, `SelectionReason`, `RulesEdition` and `Open5eOrigin` (`src/edition.ts`).
- Produces, in `src/edition.ts`: `export function open5eSearchHeader(requested: RulesEdition, origin: "unavailable" | "not-found"): string`, giving exactly:
  - `Rules: 2024 by default — SRD 5.2, with SRD 5.1 entries only where no 2024 version was found (Open5e fallback — D&D Beyond unavailable).`
  - `Rules: 2014 requested — SRD 5.1, with SRD 5.2 entries only where no 2014 version was found (Open5e fallback — not found on D&D Beyond).`
  - The suffix is the existing `OPEN5E_SUFFIX[origin]`, trimmed; the mirror cases follow the same pattern.
- Produces, in `src/open5e.ts` (used by Task 3):
  - `interface O5Entry<T> { record: T; endpoint: O5Endpoint; edition: RulesEdition }`
  - `async function o5Entries<T extends O5Record>(endpoints: readonly O5Endpoint[], requested: RulesEdition): Promise<O5Entry<T>[]>`: both documents loaded in parallel; the requested document's endpoints first, in the order given, then the other document's.
  - `async function o5Lookup<T extends O5Record>(endpoints: readonly O5Endpoint[], name: string, requested: RulesEdition): Promise<O5Hit<T> | null>`, where `interface O5Hit<T> { entry: O5Entry<T>; reason?: SelectionReason; renamed?: { name2014: string; name2024: string } }`
  - `async function o5Select<T extends O5Record>(endpoints: readonly O5Endpoint[], requested: RulesEdition, opts: { name?: string; passes?: (e: O5Entry<T>) => boolean }): Promise<{ selected: Array<{ entry: O5Entry<T>; reason?: SelectionReason }>; hidden: number }>`
  - `function o5Label(edition: RulesEdition, origin: Open5eOrigin, extra?: { reason?: SelectionReason; renamed?: O5Hit<unknown>["renamed"] }): string`: the rules line, then the reason line, then the rename line.
  - `function o5SearchReply(requested: RulesEdition, origin: "unavailable" | "not-found", heading: string, lines: string[], hidden: number, noMatch: string): string`: `open5eSearchHeader`, then the heading, the lines and `searchFooter`. With no lines but `hidden > 0`, it gives the header, the `noMatch` line and the footer. With neither, it gives `noMatch` alone, as today.
  - `export function crText(cr: number): string`: `0.125 → "1/8"`, `0.25 → "1/4"`, `0.5 → "1/2"`, otherwise `String(cr)`.
- Produces (exported; the callers change):
  - `o5SearchSpells(params: { name?; level?; school?; concentration?; ritual?; limit?; offset?; rulesEdition?: RulesEdition }, origin: "unavailable" | "not-found"): Promise<string>`
  - `o5GetSpell(name: string, rulesEdition: RulesEdition, origin: Open5eOrigin): Promise<string | null>`
  - `o5SearchMonsters(params: { name?; cr?: number; type?; size?; rulesEdition?: RulesEdition }, origin): Promise<string>`
  - `o5GetMonster(name: string, rulesEdition: RulesEdition, origin): Promise<string | null>`
  - `o5GetMonsterStats(name: string, rulesEdition: RulesEdition): Promise<{ name: string; crValue: number; xp: number; info: EditionInfo } | null>`

**Selection rules** (every kind uses them; Task 3 reuses them):
- **`info`:** `e => ({ ruleset: e.edition, book: null })`. **Tiebreak:** endpoint order, then `key`.
- **`o5Lookup`:** runs `lookupByName(entries, name, requested, { name: e => e.record.name, info, tiebreak, partialMatch })`.
  - `partialMatch`: names containing the query, ordered by the requested document first, then names starting with the query, then the shortest, then alphabetical.
  - Then apply decision 4: drop `renamed` when the shown entry is 2024 and `normalizeName(name) !== twinName(name)`, or 2014 and `normalizeName(name) === twinName(name)`.
- **`o5Select`:** runs `groupAndSelect(entries, requested, { info, twinKey: e => twinName(e.record.name), tiebreak, nameMatches, passes, countFilteredPicks: true })`.
  - `nameMatches` is `e => normalizeName(e.record.name).includes(normalizeName(opts.name))`, when there is a name.
  - The selected entries are returned sorted by name.

**v1 → v2 field map.** Keep each formatter's current layout and its `(SRD only)` wording.

Spells:
- `level_int` → `level`; `school` → `school.name`; `range` → `range_text`.
- `casting_time` is humanized: `action` → `1 action`, `bonus-action` → `1 bonus action`, `reaction` → `1 reaction`, `1minute` → `1 minute`, `10minutes` → `10 minutes`, `1hour` → `1 hour`, `8hours` → `8 hours`, `12hours` → `12 hours`, `24hours` → `24 hours`; anything else is shown as-is.
- `components` → `V` / `S` / `M` from `verbal` / `somatic` / `material`, plus ` (${material_specified})` when M has text.
- `requires_concentration` → `concentration`; `ritual === "yes"` → the boolean `ritual`; `dnd_class` → `classes[].name` joined by `, `.
- `passes`: `level`, `school` (case-insensitive against `school.key` or `school.name`), `concentration`, `ritual`.
- Paging: slice the sorted selection by `offset` / `limit` and keep today's `Found N spell(s) (showing a–b, SRD only[ — use offset: N for more]):` heading, where N is the selection's length.

Monsters:
- `size` → `size.name`; `type` → `type.name`; `subtype` → `subcategory`; `armor_desc` → `armor_detail`.
- Speed: the `walk` / `fly` / `swim` / `climb` / `burrow` keys only (never `unit` or `hover`), with ` (hover)` after fly when `hover` is true.
- Scores and modifiers → `ability_scores.*` / `modifiers.*`.
- Saves: only the keys whose `saving_throws[k]` differs from `modifiers[k]`, where a missing modifier counts as 0. A 2024 record lists all six.
- Skills → `skill_bonuses`. Damage and condition lines → `resistances_and_immunities.*_display`, when non-empty.
- Senses → each non-null `darkvision_range` / `blindsight_range` / `tremorsense_range` / `truesight_range` as `darkvision 60 ft.`, then `passive Perception N`.
- Languages → `languages.as_string`; CR → `crText(challenge_rating)`; `special_abilities` → `traits`.
- Actions are split by `action_type` into `ACTIONS`, `BONUS ACTIONS`, `REACTIONS` and `LEGENDARY ACTIONS`, each sorted by `order_in_statblock`. `legendary_desc` has no v2 counterpart and is dropped.
- `passes`: `cr` (equal to `challenge_rating`), and `type` and `size` (case-insensitive against `.key` or `.name`).

- [ ] **Step 1: Write the failing label test in `tests/edition.test.ts`**

Assert all four exact `open5eSearchHeader` strings: 2024 and 2014, each with `"unavailable"` and with `"not-found"`.

- [ ] **Step 2: Write the failing tests in `tests/open5e.test.ts`**

Stub `fetch` with a composite: URLs containing `/v2/` go to `o5FixtureFetch()`, and every other URL goes to the file's existing v1 `route`. This keeps the not-yet-migrated v1 cases working until Task 4 deletes the v1 client. Replace the spell, monster and stats cases:

```ts
const U24 = "Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)";
const U14 = "Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)";
const H24 = open5eSearchHeader("2024", "unavailable");
it("o5GetSpell gives SRD 5.2 by default and SRD 5.1 on request", async () => {
  expect((await o5GetSpell("Fireball", "2024", "unavailable"))!.split("\n").slice(0, 2)).toEqual(["Fireball (Level 3 Evocation)", U24]);
  expect((await o5GetSpell("Fireball", "2014", "unavailable"))!.split("\n")[1]).toBe(U14);
  expect(await o5GetSpell("Fireball", "2024", "unavailable")).toContain("Casting Time: 1 action");
});
it("a 2014-only spell under 2024 carries the reason line", async () => {
  expect((await o5GetSpell("Feeblemind", "2024", "not-found"))!.split("\n").slice(1, 3))
    .toEqual(["Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)", "(no 2024 version found — 2014 text shown)"]);
});
it("a 2024-only spell under 2014 carries the reason line", async () => {
  expect((await o5GetSpell("Befuddlement", "2014", "unavailable"))!.split("\n")[2]).toBe("(no 2014 version found — 2024 text shown)");
});
it("a partial 2014 name reaches its renamed 2024 twin", async () => {
  const out = (await o5GetSpell("branding", "2024", "unavailable"))!;
  expect(out.split("\n")[0]).toMatch(/^Shining Smite \(/);
  expect(out.split("\n")[1]).toBe(U24);
});
it("no false rename line when SRD 5.2 keeps the 2014 spelling", async () => {
  const out = (await o5GetSpell("Bigby's Hand", "2024", "unavailable"))!;
  expect(out.split("\n").slice(0, 2)).toEqual([expect.stringMatching(/^Arcane Hand \(/), U24]);
  expect(out).not.toContain("2014 name:");
});
it("o5GetMonster maps a 2014 name through the rename table", async () => {
  const out = (await o5GetMonster("Goblin", "2024", "unavailable"))!;
  expect(out.split("\n").slice(0, 3)).toEqual(["Goblin Warrior", U24, "(2014 name: Goblin · 2024 name: Goblin Warrior)"]);
  expect(out).toMatch(/^CR 1\/4 \| AC \d+/m);
});
it("o5GetMonster reason lines in both directions", async () => {
  expect((await o5GetMonster("Orc", "2024", "unavailable"))!.split("\n")[2]).toBe("(no 2024 version found — 2014 text shown)");
  expect((await o5GetMonster("Allosaurus", "2014", "unavailable"))!.split("\n")[2]).toBe("(no 2014 version found — 2024 text shown)");
});
it("only proficient saves are listed", async () => {
  expect(await o5GetMonster("Wolf", "2024", "unavailable")).not.toContain("Saving Throws:");
  expect(await o5GetMonster("Aboleth", "2024", "unavailable")).toMatch(/^Saving Throws: DEX \+3, CON \+6, INT \+8, WIS \+6$/m);
});
it("o5SearchSpells mixes documents per the pipeline", async () => {
  const out = await o5SearchSpells({ name: "fire", level: 0, rulesEdition: "2024" }, "unavailable");
  expect(out.split("\n")[0]).toBe(H24);
  expect(out).toContain("• Fire Bolt [2024] (Cantrip Evocation)");
  expect(out).not.toContain("Fireball");
  expect(out.trimEnd().split("\n").at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  expect(await o5SearchSpells({ name: "feeble", rulesEdition: "2024" }, "unavailable")).toContain("• Feeblemind [2014]");
});
it("a renamed twin is found by its other name and counted", async () => {
  const out = await o5SearchMonsters({ name: "thug", rulesEdition: "2024" }, "unavailable");
  expect(out).toContain("• Tough [2024]");
  expect(out).not.toContain("Thug [2014]");
  expect(out).toContain('1 2014 version hidden — rules_edition: "2014" shows it.');
});
it("an attribute miss counts the other edition instead of answering from it", async () => {
  // 2024 goblinoids are Fey; the 2014 Goblin is a Humanoid.
  const out = await o5SearchMonsters({ name: "goblin", type: "humanoid", rulesEdition: "2024" }, "unavailable");
  expect(out.split("\n")).toEqual([H24, "No monsters found (SRD only).", '1 2014 version hidden — rules_edition: "2014" shows it.']);
});
it("o5SearchMonsters applies cr, type and size", async () => {
  const out = await o5SearchMonsters({ cr: 0.25, type: "beast", size: "medium", rulesEdition: "2014" }, "unavailable");
  expect(out).toContain("• Wolf [2014] (CR 1/4, Medium Beast)");
  expect(out).not.toContain("Zombie");
});
it("o5GetMonsterStats: exact twin name only, edition from the document", async () => {
  expect(await o5GetMonsterStats("Goblin", "2024")).toEqual({ name: "Goblin Warrior", crValue: 0.25, xp: 50, info: { ruleset: "2024", book: null } });
  expect(await o5GetMonsterStats("goblin", "2014")).toMatchObject({ name: "Goblin", info: { ruleset: "2014", book: null } });
  expect(await o5GetMonsterStats("Red Dragon", "2024")).toBeNull();   // partial: never a guess
  expect(await o5GetMonsterStats("Allosaurus", "2014")).toMatchObject({ info: { ruleset: "2024", book: null } });
});
```

Keep the "a not-found search keeps its plain message" case: an empty fixture for both documents gives `No spells found matching the criteria (SRD only).`

For the Aboleth assertion, first check the fixture: 2024 Aboleth's saves differ from its modifiers on DEX, CON, INT and WIS. Then assert the line the formatter builds from those keys, in STR→CHA order.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/edition.test.ts tests/open5e.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 4: Implement `open5eSearchHeader`, then the helpers and the spell and monster sections in `src/open5e.ts`**

`o5GetMonsterStats` takes the entries whose `twinName(record.name)` equals `twinName(query)`, and nothing else; `selectByEdition` with the same `info` and tiebreak picks among them. `xp` comes from the existing CR→XP table, keyed by `crText`, and the result is null when the CR is not in the table. Every failure returns null, as today. Delete `fetchO5Cantrips`, `CR_VALUE_O5` and `o5NameKey`.

- [ ] **Step 5: Update the callers to pass the edition**

- `src/tools/reference.ts`: `searchSpellsSection`'s catch already passes `params`, which carry `rulesEdition`. `getSpell` calls `o5GetSpell(spellName, rulesEdition, "not-found" | "unavailable")`.
- `src/tools/monster.ts`:
  - Every `o5SearchMonsters(params, …)` already passes `params`.
  - Every `o5GetMonster(monsterName, …)` becomes `o5GetMonster(monsterName, requested, …)`.
  - In `getMonsterStats`: `const o5 = await o5GetMonsterStats(name, requested);` and `return o5 ? { status: "found", ...o5 } : { status: "not-found" };`. Delete the interim comment.

- [ ] **Step 6: Migrate the dependent tests**

- `tests/monster.test.ts`:
  - `toHaveBeenCalledWith("Twig Blight", "unavailable")` → `("Twig Blight", "2024", "unavailable")`.
  - `o5GetMonsterStats` expectations gain the edition argument: `("Wolf", "2024")`, `("Tough", "2024")`.
  - Mocked results gain `info`.
  - "an Open5e result is found with the interim 2014 ruleset" becomes "an Open5e result keeps its document's ruleset": mock `info: { ruleset: "2024", book: null }` and expect it on the result.
- `tests/spell-editions.test.ts`: in "Open5e fallback labels" and "a load failure still falls back to Open5e", serve `o5FixtureFetch()` for Open5e URLs and expect the `Rules: 2024 · SRD 5.2 (…)` lines.
- `tests/rules-edition-consistency.test.ts`:
  - `o5Fetch` delegates spells and creatures to `o5FixtureFetch()` and keeps its synthetic v1 fixtures for the kinds Task 3 migrates.
  - `PATH_MARKER.open5e.ddb_get_spell = { "2024": "fiery explosion", "2014": "pointing finger" }`: the two documents' Fireball texts, live 2026-10-20.
  - `PATH_MARKER.open5e.ddb_get_monster = { "2024": "Goblin Warrior", "2014": "Goblin\n" }`: under 2024, "Goblin" reaches Goblin Warrior through the rename table, and under 2014 the title line is the bare name.
  - Add an Open5e-mode edition check, `O5_HEADER_CHECK = new Set(["ddb_search_spells", "ddb_search_monsters"])`. Task 3 extends it to equipment, races, classes, backgrounds and feats. For those tools in open5e mode, expect `text.split("\n")[0]` to be `open5eSearchHeader(ed, "unavailable")`, so a fallback that drops `rulesEdition` fails under 2014.

- [ ] **Step 7: Run the touched suites**

Run: `npx vitest run tests/edition.test.ts tests/open5e.test.ts tests/monster.test.ts tests/spell-editions.test.ts tests/rules-edition-consistency.test.ts tests/encounter.test.ts tests/treasure.test.ts`
Expected: PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm run typecheck && npm run lint && npm test`. Expected: all pass.

```bash
git add src/edition.ts src/open5e.ts src/tools/reference.ts src/tools/monster.ts tests/edition.test.ts tests/open5e.test.ts tests/monster.test.ts tests/spell-editions.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(open5e): spells, monsters and monster stats on v2 — SRD 5.2 and 5.1 selected together like D&D Beyond entries"
```

---

### Task 3: Equipment, species, classes, backgrounds and feats on v2

**Files:**
- Modify:
  - `src/open5e.ts`: the items, weapons, armour, races, classes, backgrounds and feats sections. Delete `o5GetItem`, `o5GetWeapon`, `o5GetArmor`, `o5GetRace`, `o5SearchWeapons` and `o5SearchArmor`, plus the now-unused `TAG` constant.
  - `src/tools/reference.ts`: the fallbacks of `searchItemsSection` and `getItem`, and the four `searchOptionList` fallbacks.
- Test: `tests/open5e.test.ts`, `tests/equipment-editions.test.ts`, `tests/options-editions.test.ts`, `tests/rules-edition-consistency.test.ts`

**Interfaces:**
- Consumes: `o5Entries`, `o5Lookup`, `o5Select`, `o5Label`, `o5SearchReply` (Task 2).
- Produces:
  - `o5SearchItems(params: { name?: string; rarity?: string; type?: string; rulesEdition?: RulesEdition }, origin): Promise<string>`: `o5Select(["magicitems", "items"], …)`, capped at 20 lines as today.
  - `o5GetEquipment(name: string, rulesEdition: RulesEdition, origin): Promise<string | null>`: `o5Lookup(["magicitems", "weapons", "armor", "items"], …)`, rendered by the hit's `endpoint`.
  - `o5SearchRaces`, `o5SearchClasses`, `o5SearchBackgrounds`, `o5SearchFeats(params: { name?: string; rulesEdition?: RulesEdition }, origin): Promise<string>`. Each keeps the single-hit-renders-the-detail-block behaviour, labelled with `o5Label(entry.edition, origin, { reason })`, plus the footer when there are hidden twins. The no-match text, e.g. `(SRD only — only Acolyte is in the SRD)`, becomes `(SRD only)`, because SRD 5.2 has four backgrounds and seventeen feats.

**v1 → v2 field map:**
- **Magic item:** `type` → `category.name`; `rarity` → `rarity.name`; attunement → `requires_attunement` (a boolean), plus ` (${attunement_detail})` when set.
- **Mundane item (`items`):**
  - title `${name} (${category.name})`;
  - `Cost: ${Number(cost)} gp | Weight: ${Number(weight)} ${weight_unit}` (`—` when either is 0);
  - `desc`.
- **Weapon:**
  - title `${name} (${is_simple ? "Simple" : "Martial"} Weapon)`;
  - `Damage: ${damage_dice} ${damage_type.name}`;
  - `Range: ${range}/${long_range} ${distance_unit}` when `range > 0`;
  - `Properties:` lists each non-Mastery `property.name`, plus ` (${detail})` when set;
  - `Mastery: <name>` for a property whose `type` is `Mastery`;
  - no cost or weight (those live on the `items` record).
- **Armour:**
  - title `${name} (${Capitalized category} Armor)`;
  - `AC: ${ac_display}`, then ` | Requires STR ${strength_score_required}` and ` | Stealth disadvantage` (`grants_stealth_disadvantage`);
  - a record whose `normalizeName(name)` is `shield` is titled `Shield (Shield)` with `AC: +${ac_display}`, whatever its `category` says.
- **Species:**
  - Find a trait by `type` (`SIZE` / `SPEED`), else by name (`Size` / `Speed`). A subrace with neither takes its parent's (resolve `subspecies_of`, a key, within the same document). When a field is still missing, omit it.
  - Title `name`, then `Size: … | Speed: …`, with only the fields found. Then each other trait as `**${name}.** ${desc}`, ordered by `order ?? array index`.
  - Search line: `• ${name} ${tag}${subrace ? ` (subrace of ${parent name})` : ""}${speed ? ` | Speed: ${speed}` : ""}`.
- **Class:**
  - A subclass takes its hit die from its `subclass_of` parent, resolved by key in the same document.
  - Title `name`; `Hit Die: ${hitDie.toLowerCase()}`, plus ` | HP at 1st: ${hit_points.hit_points_at_1st_level}` when `hit_points` is set.
  - `Saving Throws: ${saving_throws[].name}` when non-empty; `Spellcasting: ${caster_type}` unless it is null or `NONE`; `Features:` gives the distinct `features[].name` in order.
  - Search line: `• ${name} ${tag} (${hitDie.toLowerCase()})`, plus ` | subclass of ${subclass_of.name}` for a subclass.
- **Background:** title `name`, then each `benefits[]` as `**${name}:** ${desc}`. Search line: `• ${name} ${tag}`, plus the Skill Proficiencies benefit's `desc` in parentheses.
- **Feat:** title `name`; `Type: ${type}` when set; `Prerequisite: …` when `has_prerequisite`; then `desc` and each `benefits[].desc` as a `•` bullet.
- **Item `passes`:**
  - `rarity` matches `rarity.name` (contains, case-insensitive); mundane items have none, so they never match a rarity.
  - `type` matches `category.name` (contains).

- [ ] **Step 1: Write the failing tests in `tests/open5e.test.ts`**

```ts
it("o5GetEquipment prefers an exact name in any endpoint over a partial one", async () => {
  expect((await o5GetEquipment("Longsword", "2024", "unavailable"))!.split("\n")[0]).toBe("Longsword (Martial Weapon)");
});
it("o5GetEquipment matches case-insensitively and picks the requested document", async () => {
  expect((await o5GetEquipment("chain mail", "2014", "unavailable"))!.split("\n").slice(0, 2)).toEqual(["Chain mail (Heavy Armor)", U14]);
});
it("o5GetEquipment folds curly apostrophes", async () => {
  expect((await o5GetEquipment("Alchemist’s Fire", "2024", "unavailable"))!.split("\n")[0]).toMatch(/^Alchemist's Fire \(/);
});
it("o5GetEquipment reason lines in both directions", async () => {
  expect((await o5GetEquipment("Abacus", "2024", "not-found"))!.split("\n")[2]).toBe("(no 2024 version found — 2014 text shown)");
  expect((await o5GetEquipment("Musket", "2014", "unavailable"))!.split("\n")[2]).toBe("(no 2014 version found — 2024 text shown)");
});
it("the shield is a shield", async () => {
  expect((await o5GetEquipment("Shield", "2024", "unavailable"))!).toMatch(/^Shield \(Shield\)\n[^\n]+\nAC: \+2$/m);
});
it("o5SearchItems covers magic and mundane items and applies rarity", async () => {
  const all = await o5SearchItems({ name: "longsword", rulesEdition: "2024" }, "unavailable");
  expect(all).toContain("• Flame Tongue Longsword [2024]");
  expect(all).toContain("• Longsword [2024]");
  expect(await o5SearchItems({ name: "longsword", rarity: "rare", rulesEdition: "2024" }, "unavailable")).not.toContain("• Longsword [2024]");
});
it("a 2014 feat request with no SRD 5.1 match shows SRD 5.2 with the reason", async () => {
  const out = await o5SearchFeats({ name: "alert", rulesEdition: "2014" }, "unavailable");
  expect(out.split("\n").slice(0, 3)).toEqual(["Alert", U24, "(no 2014 version found — 2024 text shown)"]);
});
it("a subrace takes its parent's speed", async () => {
  expect(await o5SearchRaces({ name: "elf", rulesEdition: "2014" }, "unavailable"))
    .toContain("• High Elf [2014] (subrace of Elf) | Speed: Your base walking speed is 30 feet.");
});
it("a no-name class search survives subclasses and missing fields", async () => {
  const out = await o5SearchClasses({ rulesEdition: "2024" }, "unavailable");
  expect(out).toContain("• Champion [2024] (d10) | subclass of Fighter");
  expect(out).not.toMatch(/undefined|null/);
  expect(await o5SearchClasses({ name: "wizard", rulesEdition: "2014" }, "unavailable")).not.toContain("Spellcasting: null");
});
it("a class search by a renamed subclass's 2014 name finds the 2024 one", async () => {
  const out = await o5SearchClasses({ name: "school of evocation", rulesEdition: "2024" }, "unavailable");
  expect(out.split("\n").slice(0, 2)).toEqual(["Evoker", U24]);   // single hit: detail block
  expect(out).toContain('1 2014 version hidden — rules_edition: "2014" shows it.');
});
```

Also port the existing "opens with the rules line and tags every result line" `it.each` to the new signatures for items, races, classes, backgrounds and feats. Their first line is now `open5eSearchHeader(…)`. Delete the cases and imports for the six removed exports.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/open5e.test.ts`
Expected: FAIL (`o5GetEquipment` is not exported; v1 shapes).

- [ ] **Step 3: Implement the sections and delete the superseded exports and `TAG` in `src/open5e.ts`**

- [ ] **Step 4: Update the call sites in `src/tools/reference.ts`**

- `searchItemsSection`: `fallback: kind => o5SearchItems(params, kind)`.
- `getItem`: both `for (const fallback of [o5GetItem, o5GetWeapon, o5GetArmor])` loops become one call each, `o5GetEquipment(itemName, rulesEdition, "not-found" | "unavailable")`. The `unavailable` branch keeps `withSourceCaveat` and its catch-then-`throw err` behaviour.
- The four option searches: `fallback: kind => o5SearchRaces({ name: params.name, rulesEdition: params.rulesEdition }, kind)`, and likewise for classes, backgrounds and feats.

- [ ] **Step 5: Migrate the dependent tests**

- `tests/equipment-editions.test.ts` / `tests/options-editions.test.ts`: any case that asserts on Open5e output serves `o5FixtureFetch()` and expects the new header or label. Cases that only count Open5e calls, or that return `{ count: 0, results: [] }`, are unchanged apart from the `(SRD only)` text.
- `tests/rules-edition-consistency.test.ts`:
  - `o5Fetch` now delegates every endpoint to `o5FixtureFetch`.
  - Species, classes, backgrounds and feats get overrides that add a second record whose name matches the fixture query, because a single hit renders a detail block with no result line. Clone the recorded record and rename it: `"Human (Variant)"`, `"Fighter (Variant)"`, `"Acolyte (Variant)"`, `"Alert (Variant)"`.
  - **Each clone goes in the document that answers the query.** Human, Fighter and Acolyte are in both documents, so clone into each. Alert exists only in srd-2024, so its clone goes in `srd-2024/feats` with the srd-2024 `document`, for both editions.
  - Delete the synthetic v1 fixtures.
  - `PATH_MARKER.open5e.ddb_get_equipment = { "2024": "Mastery: Sap", "2014": "Properties: Versatile (1d10)" }`. The weapon record has no `desc`, and only these lines differ between documents.
  - Add `ddb_search_equipment`, `ddb_search_races`, `ddb_search_classes`, `ddb_search_backgrounds` and `ddb_search_feats` to `O5_HEADER_CHECK`.

- [ ] **Step 6: Full check and commit**

Run: `npm run typecheck && npm run lint && npm test`. Expected: all pass.

```bash
git add src/open5e.ts src/tools/reference.ts tests/open5e.test.ts tests/equipment-editions.test.ts tests/options-editions.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(open5e): equipment and character options on v2; one exact-first equipment lookup across magic items, weapons, armour and gear"
```

---

### Task 4: Rules search and get with `rules_edition`

**Files:**
- Modify:
  - `src/edition.ts`: two reasons and `reasonLine`.
  - `src/open5e.ts`: rules from `rulesets`. Delete `o5SearchSections`, `o5GetSection`, the v1 `OPEN5E` / `SRD` constants, `o5fetch`, `O5Section`, and the interim `O5_INFO` / `label`. Rewrite the file-top comment for v2.
  - `src/tools/reference.ts`: `searchRules`, `getRule`.
  - `src/server.ts`: `ddb_search_rules`, `ddb_get_rules`.
- Test: `tests/edition.test.ts`, `tests/open5e.test.ts`, `tests/rules-edition-consistency.test.ts`

**Interfaces:**
- Consumes: `loadO5Document("rulesets", …)` (Task 1); `searchHeader({ rulesDoc })`, `rulesLine`, `editionTag` (`src/edition.ts`).
- Produces:
  - In `src/edition.ts`: `REASON_TEXT` gains `"rules-search-miss-2024": "(no matching 2024 rules sections — 2014 sections listed)"` and `"rules-search-miss-2014": "(no matching 2014 rules sections — 2024 sections listed)"`, plus `export function reasonLine(reason: RulesLineReason): string`.
  - In `src/open5e.ts`: `o5SearchRules(query: string | undefined, rulesEdition: RulesEdition): Promise<string>` and `o5GetRule(nameOrSlug: string, rulesEdition: RulesEdition, maxChars?: number, query?: string): Promise<string | null>`.
  - In `src/tools/reference.ts`: `searchRules(query?: string, rulesEdition: RulesEdition = "2024")` and `getRule(nameOrSlug: string, maxChars?: number, query?: string, rulesEdition: RulesEdition = "2024")`.

**Matching.** A ruleset is `{ key, name, desc, rules: Array<{ key, name, desc, index }> }`.
- **Slug:** everything after a key's first `_`. For example `srd-2024_combat` → `combat`, `srd_attacking` → `attacking`, `srd-2024_combat_cover` → `combat_cover`.
- **Query:** normalized with `normalizeName`, then spaces → `-` when compared with slugs.

**Get.** Within one document, the first match wins, in this order:
1. a ruleset whose name, full key or slug equals the query;
2. a section whose name, full key or slug equals it, or whose slug's last `_` segment does;
3. a ruleset whose name contains the query;
4. a section whose name contains it.

Ties go to ruleset order, then `index`. A miss in the requested document tries the other one, with `rules-miss-<requested>`.

Output for a ruleset: `## <name>`, the rules line, a blank line, `desc`, then each section as `### <name>` followed by its `desc`. For a section: `## <name>`, the rules line, `*Part of <ruleset name>*`, a blank line, `desc`. Today's `query` jump and `maxChars` truncation note apply to the body.

**Search.** A ruleset matches when the query is in its name or `desc`, or in any section's name or `desc` (case-insensitive). With no query, every ruleset is listed. Each line is `` • **<name>** <tag> (slug: `<slug>`) ``, plus ` — <matching section names, comma-separated>` when sections matched. The reply is:
- `searchHeader({ rulesDoc })`;
- when the other document answered, `reasonLine("rules-search-miss-<requested>")`;
- `Found N rules chapter(s)[ matching "<q>"] (SRD only):`;
- the lines;
- today's closing hint.

When neither document matches: `No rules sections found matching "<q>" (SRD only).`

- [ ] **Step 1: Write the failing label test in `tests/edition.test.ts`**

```ts
it("reasonLine gives the rules search-miss text", () => {
  expect(reasonLine("rules-search-miss-2024")).toBe("(no matching 2024 rules sections — 2014 sections listed)");
  expect(reasonLine("rules-search-miss-2014")).toBe("(no matching 2014 rules sections — 2024 sections listed)");
  expect(reasonLine("rules-miss-2024")).toBe("(no matching 2024 rules section — 2014 text shown)");
});
```

- [ ] **Step 2: Write the failing rules tests in `tests/open5e.test.ts`** (they replace the v1 sections cases)

```ts
it("a chapter get gives the whole chapter under the SRD's rules line", async () => {
  const out = (await o5GetRule("Damage and Healing", "2024", 30000))!;
  expect(out.split("\n").slice(0, 2)).toEqual(["## Damage and Healing", "Rules: 2024 · SRD 5.2"]);
  expect(out).toMatch(/^### Resting$/m);
  expect((await o5GetRule("Damage and Healing", "2014"))!.split("\n")[1]).toBe("Rules: 2014 · SRD 5.1");
});
it("v1-style slugs, full keys and section names resolve", async () => {
  expect((await o5GetRule("damage-and-healing", "2024"))!.split("\n")[0]).toBe("## Damage and Healing");
  expect((await o5GetRule("attacking", "2014"))!.split("\n")[0]).toBe("## Attacking");
  expect((await o5GetRule("srd-2024_combat", "2024"))!.split("\n")[0]).toBe("## Combat");
  expect((await o5GetRule("Grappling", "2014"))!).toContain("*Part of Attacking*");
});
it("a repeated 2024 section name resolves to its first chapter", async () => {
  // Live 2026-10-20: "Ability Checks" is a section of both D20 Tests and Social Interaction.
  expect((await o5GetRule("Ability Checks", "2024"))!.split("\n")[2]).toBe("*Part of D20 Tests*");
});
it("a get that misses retries the other document with the rules reason", async () => {
  expect((await o5GetRule("Madness", "2024"))!.split("\n").slice(1, 3)).toEqual(["Rules: 2014 · SRD 5.1", "(no matching 2024 rules section — 2014 text shown)"]);
  expect((await o5GetRule("D20 Tests", "2014"))!.split("\n")[2]).toBe("(no matching 2014 rules section — 2024 text shown)");
  expect(await o5GetRule("Zzz", "2024")).toBeNull();
});
it("a search lists the requested document's chapters, tagged", async () => {
  const out = await o5SearchRules("cover", "2014");
  expect(out.split("\n")[0]).toBe("Rules: sections from SRD 5.1 (2014).");
  expect(out).toContain("• **Cover** [2014] (slug: `cover`)");
});
it("a search that misses lists the other document with the search reason", async () => {
  const g = await o5SearchRules("grapple", "2024");
  expect(g.split("\n").slice(0, 2)).toEqual(["Rules: sections from SRD 5.1 (2014).", "(no matching 2024 rules sections — 2014 sections listed)"]);
  expect(g).toMatch(/^• \*\*Attacking\*\* \[2014\] \(slug: `attacking`\) — .*\bGrappling\b/m);
  const d = await o5SearchRules("d20 test", "2014");
  expect(d.split("\n").slice(0, 2)).toEqual(["Rules: sections from SRD 5.2 (2024).", "(no matching 2014 rules sections — 2024 sections listed)"]);
});
```

Before asserting the "d20 test" case, confirm that no recorded 2014 chapter mentions "d20 test". If one does, pick another term found only in the 2024 fixture's D20 Tests chapter.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/edition.test.ts tests/open5e.test.ts`
Expected: FAIL (`reasonLine` and `o5GetRule` are not exported).

- [ ] **Step 4: Implement `reasonLine` and the two reasons in `src/edition.ts`, then the rules section in `src/open5e.ts`, and delete the v1 client and the interim helpers**

With the v1 client gone, drop the v1 `route` half of `tests/open5e.test.ts`'s composite stub. Then `grep -n "v1\|wotc-srd\|Interim" src/open5e.ts` prints nothing.

- [ ] **Step 5: Thread the edition through `src/tools/reference.ts` and `src/server.ts`**

`searchRules` and `getRule` take the new params and delegate. Both registrations take `rules_edition: RULES_EDITION_PARAM` and pass it on.

- New `ddb_search_rules` description: "Search the SRD rules chapters by keyword, across chapter and section names and text: SRD 5.2 (2024) by default, SRD 5.1 (2014) with rules_edition '2014'. When the requested SRD has no match (SRD 5.2 on Open5e has no Rules Glossary, so e.g. grappling is only in SRD 5.1), the other SRD's chapters are listed and the reply says so. Returns matching chapters with their slugs and matching sections. Use ddb_get_rules to read one. No login required. " + `RULES_EDITION_TOOL_NOTE`.
- New text for the `query` param: "Omit to list every chapter (11 in SRD 5.2, 41 in SRD 5.1)."
- New `ddb_get_rules` description: "Get SRD rules text by chapter or section name or slug (e.g. 'Combat', 'Damage and Healing', 'Cover', 'Grappling', 'attacking'). A chapter returns all its sections. Use query to jump to a keyword within long text. For conditions use ddb_get_condition; for non-SRD rules use ddb_read_book. No login required. " + `RULES_EDITION_TOOL_NOTE`.

- [ ] **Step 6: Extend the consistency test**

- `FIXTURES` gains `ddb_search_rules: ed => ({ query: "cover", rules_edition: ed })` and `ddb_get_rules: ed => ({ name: "Damage and Healing", rules_edition: ed })`.
- `EDITION_CHECK` gains `ddb_search_rules: ed => ({ present: [searchHeader({ rulesDoc: ed })], resultTag: true })` and `ddb_get_rules: ed => ({ present: [`Rules: ${ed} · SRD 5.${ed === "2024" ? 2 : 1}`] })`.
- Import `searchHeader` from `../src/edition.js`.

- [ ] **Step 7: Full check and commit**

Run: `npm run typecheck && npm run lint && npm test`. Expected: all pass.

```bash
git add src/edition.ts src/open5e.ts src/tools/reference.ts src/server.ts tests/edition.test.ts tests/open5e.test.ts tests/rules-edition-consistency.test.ts
git commit -m "feat(rules): ddb_search_rules / ddb_get_rules take rules_edition — v2 rulesets, SRD 5.2 first, a miss falls back with a reason"
```

---

### Task 5: Conditions in both editions

**Files:**
- Create: `src/tools/conditions.ts`, `tests/conditions.test.ts`, `scripts/check-conditions.mts`
- Modify:
  - `src/tools/reference.ts`: delete the CONDITIONS block and `getCondition`, and fix the header comment.
  - `src/server.ts`: import from `./tools/conditions.js`; `ddb_get_condition` gains the param.
  - `README.md`: attribution.
  - `tests/rules-edition-consistency.test.ts`.

**Interfaces:**
- Produces: `export function getCondition(conditionName: string, rulesEdition: RulesEdition = "2024"): string`, and `export const CONDITION_NAMES: readonly string[]` (the 15 names, for the check script).

**Output:**
- `**<Name>**`;
- the rules line, `rulesLine({ ruleset: ed, book: null }, { open5e: "primary" })`: `Rules: 2024 · SRD 5.2` / `Rules: 2014 · SRD 5.1`;
- a blank line, the description, then `• ` effect lines.

Both editions have all 15 conditions, so there is never a reason line. Not-found keeps today's text and lists the requested edition's names. Matching is today's: exact key, then partial name.

- [ ] **Step 1: Write the failing tests in `tests/conditions.test.ts`**

```ts
it("Exhaustion is the 2024 text by default", () => {
  const out = getCondition("Exhaustion");
  expect(out.split("\n").slice(0, 2)).toEqual(["**Exhaustion**", "Rules: 2024 · SRD 5.2"]);
  expect(out).toContain("You die if your Exhaustion level is 6.");
  expect(out).toContain("the roll is reduced by 2 times your Exhaustion level");
  expect(out).not.toContain("Level 2: Speed halved");
});
it("Exhaustion is the six-level table on request", () => {
  const out = getCondition("exhaustion", "2014");
  expect(out.split("\n")[1]).toBe("Rules: 2014 · SRD 5.1");
  expect(out).toContain("Level 6: Death");
});
it("every condition exists in both editions, with a rules line", () => {
  expect(CONDITION_NAMES).toHaveLength(15);
  for (const n of CONDITION_NAMES) for (const ed of ["2024", "2014"] as const) {
    expect(getCondition(n, ed).split("\n")[1]).toMatch(/^Rules: (2024 · SRD 5\.2|2014 · SRD 5\.1)$/);
  }
});
it("partial names still match, and an unknown name lists the conditions", () => {
  expect(getCondition("exhaust").split("\n")[0]).toBe("**Exhaustion**");
  expect(getCondition("zzz")).toMatch(/^Condition "zzz" not found\.\n\nAvailable conditions: Blinded, /);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/conditions.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Extract the 2024 text from the SRD 5.2.1 PDF**

No PDF tool is installed. Use a throwaway venv in the scratchpad, never in the repo:

```bash
SP=<scratchpad>; python3 -m venv "$SP/venv" && "$SP/venv/bin/pip" install -q pypdf==5.1.0
curl -s -o "$SP/SRD_CC_v5.2.1.pdf" https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
shasum -a 256 "$SP/SRD_CC_v5.2.1.pdf"   # expect 8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87
```

Then, with `"$SP/venv/bin/python" -I`, print the text of pages 176–191 and copy each `<Name> [Condition]` entry. Rejoin hyphenated line breaks (`num-\nber` → `number`). Keep the glossary's bolded lead-ins as effect lines, e.g. `Exhaustion Levels. This condition is cumulative. …`.

- [ ] **Step 4: Implement `src/tools/conditions.ts`**

- `CONDITIONS_2014`: today's table, moved unchanged.
- `CONDITIONS_2024`: the transcription, in the same `Condition` shape: the entry's opening sentence becomes `description` and each lead-in paragraph becomes an effect.
- The file-top comment records the source URL, the PDF's SHA-256, "pages 176–191 (Rules Glossary)" and the attribution sentence: "This work includes material from the System Reference Document 5.2 by Wizards of the Coast LLC, licensed under CC-BY-4.0."
- Delete the conditions block from `src/tools/reference.ts`, and drop "conditions" from its header comment.
- In `src/server.ts`, import from `./tools/conditions.js`. `ddb_get_condition` gets `rules_edition: RULES_EDITION_PARAM` and this description: "Look up the rules text for a D&D condition (Blinded, Charmed, Exhaustion, Grappled, etc.): SRD 5.2 (2024) by default, SRD 5.1 (2014) on request. No login required. " + `RULES_EDITION_TOOL_NOTE`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/conditions.test.ts`
Expected: PASS.

- [ ] **Step 6: Write `scripts/check-conditions.mts` and run it**

The script needs `ddb_login`. It fetches rule-data exactly as `scripts/dump-sourced-languages.mts` does and reads `data.conditions`. If the first entry has no name and description where expected (`definition.name` / `definition.description`), it prints the entry's keys and exits 1, so the shape gets fixed in the script rather than guessed.

For each of `CONDITION_NAMES`, it compares `stripHtml(description)` with the vendored 2024 description plus its effects, joined by spaces, after both are lowercased with punctuation and whitespace removed. It prints `ok <name>`, or `DIFF <name>` plus the first differing 80-character window of each side. It exits 0 either way: this is a sanity check, and runtime never depends on it.

Run: `npx tsx scripts/check-conditions.mts`
Expected: 15 `ok` lines. Resolve each `DIFF` either by correcting the transcription, or with a one-line comment above that condition in `CONDITIONS_2024` saying why D&D Beyond's text differs (e.g. D&D Beyond prints a table where the SRD has prose).

- [ ] **Step 7: Add the attribution to README and extend the consistency test**

- `README.md`, License section: add the attribution sentence, and say that `ddb_get_condition`'s 2024 text and the Open5e SRD 5.2 content come from SRD 5.2.1 under CC-BY-4.0. Change the `ddb_get_condition` row to "… in 2024 (default) or 2014 rules …".
- `tests/rules-edition-consistency.test.ts`:
  - `FIXTURES` gains `ddb_get_condition: ed => ({ name: "Exhaustion", rules_edition: ed })`.
  - `EDITION_CHECK` gains `ddb_get_condition: ed => ({ present: [`Rules: ${ed} · SRD 5.${ed === "2024" ? 2 : 1}`, ed === "2024" ? "You die if your Exhaustion level is 6." : "Level 6: Death"] })`.

- [ ] **Step 8: Full check and commit**

Run: `npm run typecheck && npm run lint && npm test`. Expected: all pass.

```bash
git add src/tools/conditions.ts src/tools/reference.ts src/server.ts scripts/check-conditions.mts tests/conditions.test.ts tests/rules-edition-consistency.test.ts README.md
git commit -m "feat(conditions): 2024 condition text from SRD 5.2.1 by default, 2014 on request; rule-data check script"
```

---

### Task 6: Docs and live check

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-10-16-rules-edition-design.md`, and this plan (an Outcome line under the header once done)

- [ ] **Step 1: Run the live check**

These are real network calls, and none needs a login. Write a scratchpad script (not committed) that imports from `src/` via `npx tsx` and prints the first three lines of each of these:
- `o5GetSpell("Fireball", "2024" / "2014", "unavailable")`
- `o5GetSpell("Feeblemind", "2024", "unavailable")`
- `o5GetSpell("Bigby's Hand", "2024", "unavailable")`
- `o5SearchSpells({ name: "smite" }, "unavailable")`
- `o5GetMonster("Goblin", "2024", "unavailable")`
- `o5GetMonsterStats("Red Dragon", "2024")` (expect null)
- `o5GetEquipment("Studded Leather Armor", "2024", "unavailable")`
- `o5SearchClasses({}, "unavailable")`
- `getCondition("Exhaustion")` and `getCondition("Exhaustion", "2014")`
- `searchRules("grapple")` and `getRule("Combat")`

Then, logged in, run `npm run dev` and spot-call each of these under both editions, as the spec's Testing section asks: `ddb_get_spell` (Fireball, Toll the Dead, Acid Arrow, Sleep), `ddb_get_monster` (Goblin), `ddb_rate_encounter` (Red Dragon), `ddb_get_equipment` (Studded Leather), `ddb_search_classes` (Fighter) and `ddb_get_condition` (Exhaustion).

Expected: every `Rules:` line names SRD 5.2 / 5.1 or a book; reason lines appear wherever the edition differs; and there is no `undefined` or `null` in any output. Keep the `Rules:` lines for the commit message.

- [ ] **Step 2: Update CLAUDE.md**

Key-modules table:
- The `src/open5e.ts` row describes v2:
  - whole-document loads with only `document__key__in`;
  - client-side matching, and why (filters are ignored);
  - both documents selected together through `lookupByName` / `groupAndSelect`;
  - the Open5e search header;
  - a 1 h cache, one in-flight fetch per URL, a 20 s timeout.
- Add a new `src/tools/conditions.ts` row.
- Remove "Conditions (hardcoded)" from the `src/tools/reference.ts` row.

Elsewhere in CLAUDE.md:
- **Caching layers:** the Open5e line gains the in-flight dedupe.
- **Tool notes:**
  - `ddb_search_rules` / `ddb_get_rules`: rulesets, slugs, the miss fallback, and SRD 5.2's missing glossary.
  - `ddb_get_condition`: both editions.
  - Open5e fallbacks: final; the interim label is gone, and decision 3's Rope edge is noted.
- **Next steps:**
  - update the header's "Last updated" line;
  - in Decisions, mark phase 4 done and phase 5 next;
  - in work item 1, record phase 4 done with this plan's commit range, and close carry-over (d);
  - add any new follow-up found while implementing.

- [ ] **Step 3: Update the spec**

- The status line: phase 4 implemented, with dates and commits.
- The live-facts row for Open5e v2: `document__key__in` works on every endpoint; the "probably ignored" note is resolved.
- Under the phase-4 section: a "Rulings in the plan" list carrying this plan's decisions 1–10, including the rewording of "srd-2024 first, srd-2014 when the 2024 query finds nothing" to both documents under one selection.
- Under "Label formats": the Open5e search header and the rules search-miss line.

- [ ] **Step 4: Update README**

- The `ddb_search_rules` / `ddb_get_rules` rows: chapters and sections, SRD 5.2 by default, SRD 5.1 on request.
- The `api.open5e.com` line: "SRD fallback, v2 (SRD 5.2 and 5.1; no auth)".

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`. Expected: all pass. Then `git status --short`: only the four doc files are staged, and the owner WIP files are untouched.

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-10-16-rules-edition-design.md docs/superpowers/plans/2026-10-20-rules-edition-phase-4-open5e-v2-rules-conditions.md
git commit -m "docs: rules-edition phase 4 done — Open5e v2, rules and conditions

<the Rules: lines from the live check>"
```
