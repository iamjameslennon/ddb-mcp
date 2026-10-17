# Rules edition across all tools: design

**Status:** approved design, not yet implemented
**Date:** 2026-10-16 (revised the same day after an adversarial review)
**Supersedes:** CLAUDE.md "Next steps" work item 1 (`rules_edition` for spells and monsters) and item 3 (ambiguous partial monster names). They are now phase 2 of this spec. Where this spec and CLAUDE.md's "Decisions" differ in wording, **this spec wins**.

This spec is written for agents who arrive cold. Each phase in [Phases](#phases) says what it may assume, what it touches, and how to prove it is done. Read [Principle](#principle), [Vocabulary and labels](#vocabulary-and-labels), and [The edition module](#the-edition-module) before starting any phase. Every phase depends on them.

---

## Principle

1. **2024 by default.** Every tool that can return 2014 or 2024 content returns 2024.
2. **2014 only when it is the only version, or when it is asked for.** A caller asks with `rules_edition: "2014"`.
3. **Always say which ruleset.** Every response makes it clear to the agent and the user which ruleset each piece of content comes from. When the edition returned is not the one requested, the response says so and says why.
4. **Never guess an edition.** If the data does not establish an edition, the label says "edition not stated".

## Background: the current state (2026-10-16)

- `ddb_rate_encounter` and `ddb_encounter_cr` already take `rules_edition: "2024" | "2014"`. This is the param name everywhere. Do not introduce `edition` or any other spelling.
- Monsters (#58) already prefer the non-Legacy entry via `rankCandidates(…, preferLegacy)` in `src/tools/monster.ts`. They also have a separate `source` (book) filter.
- **The spells have a bug.** `loadSpellCompendium` (`src/tools/reference.ts`, merge `Map` keyed by spell name, first wins) discards one edition of every spell that exists in both. The 2014 version wins for 277 of 304 such names. So `ddb_get_spell` can show 2014 text to a 2024 table.
- **The bug also reaches concentration.** `buildConcentrationByLevel` (`src/tools/character/spells.ts`) prefers the compendium's `concentration` over the character's own `def.concentration`. Nine spells changed concentration between editions: Divine Favor, Spiritual Weapon, Sleep, True Strike, Barkskin, Enthrall, Forcecage, Animal Shapes, Magic Weapon.
- Conditions are hardcoded with 2014 text, for example the 2014 six-level Exhaustion table.
- `ddb_search_rules` / `ddb_get_rules` and every Open5e fallback read Open5e **v1**, document `wotc-srd` (SRD 5.1, i.e. 2014) only. `getMonsterStats` also has its own inline v1 fetch (`monster.ts`, bypassing `open5e.ts`).
- `ddb_roll_treasure` implements the 2024 DMG tables only, and calls `getMonsterStats(n)` with no edition.

### Live data facts this design rests on (probed 2026-10-16)

| Content | Edition marker | Notes |
|---|---|---|
| Spells (`/game-data/spells`, `/always-known-spells`) | `isLegacy` + `sources[]` (`sourceId` is null) | Wizard list alone has 176 names in both editions |
| Items (`/game-data/items`) | `isLegacy` + `sources[]` | 1873 rows, 357 names in both editions. **Mundane items list books from both editions in one definition**, e.g. Studded Leather `sources: [148 br-2024, 1 BR]`, `isLegacy: false` |
| Races (`/game-data/races`) | `isLegacy` + `sources[]` | One live row (`COPY_OF_Tiefling`) has no sources |
| Classes, backgrounds, feats, class features, racial traits | **no `isLegacy`**, `sources[]` only | e.g. Fighter appears twice, `[BR]` and `[PHB-2024]` |
| Monsters (monster-service) | `isLegacy` + `sourceId` + reprint `sources[]` | 2024 Zombie lists 2024 reprint books |
| Character JSON (paths below) | spells/items/race: `isLegacy` + `sources`; class/subclass/background/feat: `sources` only | A 2024 Bard character had a 2014 background (`Criminal / Spy`, `[BR]`) |
| Conditions (`/character/v5/rule-data` → `data.conditions`) | none | 15 conditions, **2024 text only** (Exhaustion: "You die if your Exhaustion level is 6", D20 Tests reduced) |
| Game config (`https://www.dndbeyond.com/api/config/json`) | `sources[].sourceCategoryId`, `sources[].sourceURL`, `sourceCategories[]` | 264 sources. The raw endpoint answers without auth; the code fetches it via `sessionFetch` |
| Open5e v2 | `document__key` = `srd-2024` (SRD 5.2) or `srd-2014` (SRD 5.1) | spells, creatures, weapons, armor, species, classes, backgrounds, feats, rules (56 vs 227 sections) all populated for both. **No conditions in either.** **`items` and `magicitems` returned identical counts for both keys, so the filter is probably ignored there** (see phase 4) |

**Verified source IDs** (live): `1` BR "Basic Rules (2014)" cat 26; `2` PHB (2014) cat 26; `3` DMG (2014) cat 26; `5` MM (2014) cat 26; `145` PHB-2024 cat 24; `146` DMG-2024 cat 24; `147` MM-2024 cat 24; `148` br-2024 cat 24; `193` TCMP1 cat 34 (third-party).

**"Legacy" is not the same as "2014".** D&D Beyond marks content Legacy only when 2024 replaced it. A Xanathar's spell such as Toll the Dead is 2014-era but `isLegacy: false`. This design labels by **book era**, so Toll the Dead is "2014" and carries the reason "no 2024 version exists".

**Some names changed between editions.** For example, the 2014 Basic Rules' "Acid Arrow" appears to be the 2024 "Melf's Acid Arrow". This and other example pairs are **unverified until the rename script runs**. Matching by name alone misses such pairs, so a rename table links them (see [Rename table](#rename-table)).

### Character JSON paths (verified on live characters)

| Entry | Path | Markers |
|---|---|---|
| Class | `classes[].definition` | `sources` |
| Subclass | `classes[].subclassDefinition` | `sources` |
| Species | `race` (the object itself) | `isLegacy`, `sources` |
| Background | `background.definition` | `sources` |
| Feats | `feats[].definition` | `sources` |
| Class spells | `classSpells[].spells[].definition` | `isLegacy`, `sources` |
| Granted spells | `spells.{race,class,feat,item}[].definition` | `isLegacy`, `sources` |
| Items | `inventory[].definition` | `isLegacy`, `sources` |

`src/tools/character/definition.ts` (`searchDefinitions`) and `src/tools/character/spells.ts` already walk these paths. Reuse them as the path inventory. A definition with no markers classifies `unstated` (never dropped, never guessed).

## Non-goals

- No `source` (book) filter on tools other than monsters.
- No edition conversion: we never rewrite 2014 text into 2024 terms.
- No change to *which* content a character has. Character tools label what the player built; they take no `rules_edition`.
- No 2014 treasure tables (yet). `ddb_roll_treasure` takes `rules_edition` but has only 2024 tables, and says so (see [Tool contract](#tool-contract)).
- No persisted (on-disk) caches. Everything stays in the existing session-scoped in-memory caches.
- `ddb_search_site` keeps its current six categories (spells, monsters, items, races, classes, feats). It does not gain backgrounds, class features, racial traits or rules.

---

## Vocabulary and labels

An entry's **ruleset** is exactly one of:

| Ruleset | Meaning | Label text |
|---|---|---|
| `2024` | From a 2024-era book | `2024` |
| `2014` | From a 2014-era book, or D&D Beyond marks it Legacy | `2014` |
| `third-party` | From a non-WotC publisher's book | `third-party` (with "edition not stated") |
| `homebrew` | `isHomebrew === true` | `homebrew` (with "edition not stated") |
| `playtest` | Unearthed Arcana | `playtest` |
| `unstated` | Official but the data establishes no edition, or the source is unknown | `edition not stated` |

Only `2024` and `2014` are editions. The other four are never treated as a 2014/2024 twin of anything, and `rules_edition` never hides them.

### Label formats (the contract every phase uses)

All strings come from `src/edition.ts`. **No tool builds its own edition text**, including the character summary, the `source` note, and the ambiguity message. The exact wording is pinned by unit tests in phase 1.

- **Rules line** (single lookups, character summaries, encounter/treasure output), on the line after the title:
  - `Rules: 2024 · Player's Handbook (2024)`
  - `Rules: 2014 · Xanathar's Guide to Everything`
  - `Rules: third-party · Critical Role (edition not stated)`
  - `Rules: homebrew (edition not stated)`
  - `Rules: playtest · Unearthed Arcana`
  - `Rules: edition not stated · <book>` (book omitted if unknown)
- **Open5e-sourced content** (the source-of-truth suffix replaces the book):
  - Fallback because D&D Beyond could not be reached or the user is logged out: `Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)`
  - Fallback because D&D Beyond answered but had no match: `Rules: 2024 · SRD 5.2 (Open5e fallback — not found on D&D Beyond)`
  - Tools whose primary source is Open5e (rules): `Rules: 2024 · SRD 5.2`
  - Conditions (vendored): `Rules: 2024 · SRD 5.2` / `Rules: 2014 · SRD 5.1`
- **Reason line**, appended on the next line when the edition returned ≠ requested:
  - `(no 2024 version exists — 2014 text shown)`
  - `(no 2014 version exists — 2024 text shown)`
  - Rules sections: `(no matching 2024 rules section — 2014 text shown)` / `(no matching 2014 rules section — 2024 text shown)`
  - Treasure: `(no 2014 version exists — 2024 tables used)`
- **Rename line**, appended when the query matched a different name in the same twin group than the entry returned: `(2014 name: Acid Arrow · 2024 name: Melf's Acid Arrow)`
- **Source note** (monsters): `(source "mm-2024" is a 2024 book — rules_edition "2014" was ignored)`
- **Inline tag**, placed **immediately after the entry's name** on search lines and minority-edition character entries: `[2024]`, `[2014]`, `[third-party]`, `[homebrew]`, `[playtest]`, `[edition not stated]`. Example search line: `- **Fireball** [2024] — 3rd-level Evocation`.
- **Search header**, as the first line of every search result, above the tool's existing heading (e.g. `**Spell Search** (N found)`, which stays):
  - Default: `Rules: 2024 by default — 2014 entries appear only where no 2024 version exists. Use rules_edition: "2014" for 2014 versions.`
  - With `rules_edition: "2014"`: `Rules: 2014 requested — 2024 entries appear only where no 2014 version exists.`
  - With a monster `source` filter: `Rules: showing every entry in <book>, each tagged with its edition.`
  - Rules search (no twin grouping): `Rules: sections from SRD 5.2 (2024).` / `Rules: sections from SRD 5.1 (2014).`
- **Search footer** when twins were hidden: `14 2014 versions hidden — rules_edition: "2014" shows them.` / `3 2024 versions hidden — omit rules_edition to show them.`
- **Character summary**: see [Characters](#characters-srctoolscharacter--phase-5).
- **Ambiguity** (encounter/treasure): `Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Young Red Dragon (CR 10), Adult Red Dragon (CR 17), Ancient Red Dragon (CR 24) — use the full name.`

**The book name** is the game-config source's `description` with HTML entities decoded (`Player&#8217;s` → `Player's`). When the description lacks a year but a same-described source exists in the other edition's categories, the year of its own category is appended, e.g. "Player's Handbook (2024)".

---

## The edition module

### `src/edition.ts`

This module is pure and stateless. It sits below the tool modules and never imports one, mirroring `session-state.ts`. Callers pass the source index in.

```ts
export type RulesEdition = "2024" | "2014";
export type Ruleset = RulesEdition | "third-party" | "homebrew" | "playtest" | "unstated";
export interface EditionInfo { ruleset: Ruleset; book: string | null }
export type EditionReason = "no-2024-version" | "no-2014-version";

export function classifyEdition(
  entry: { isHomebrew?: boolean | null; isLegacy?: boolean | null; sourceId?: number | null; sources?: Array<{ sourceId: number }> | null },
  sources: SourceIndex,
): EditionInfo;

export function twinName(name: string): string;      // normalized, renames applied

export function selectByEdition<T>(
  group: T[],                     // one twin group
  requested: RulesEdition,
  info: (c: T) => EditionInfo,
  tiebreak: (a: T, b: T) => number,
): { entry: T; reason?: EditionReason } | null;

export function groupAndSelect<T>(
  all: T[], requested: RulesEdition, info: (c: T) => EditionInfo,
  twinKey: (c: T) => string, tiebreak: (a: T, b: T) => number,
): { selected: Array<{ entry: T; reason?: EditionReason; group: T[] }>; hidden: number };

export function rulesLine(info: EditionInfo, opts?: { reason?: EditionReason | "rules-miss-2024" | "rules-miss-2014" | "treasure-no-2014"; open5e?: "unavailable" | "not-found" | "primary" }): string;
export function renameLine(name2014: string, name2024: string): string;
export function sourceNote(source: string, bookRuleset: RulesEdition, requested: RulesEdition): string;
export function editionTag(info: EditionInfo): string;
export function searchHeader(mode: { requested: RulesEdition } | { sourceBook: string } | { rulesDoc: RulesEdition }): string;
export function searchFooter(requested: RulesEdition, hidden: number): string | null;
export function ambiguityMessage(query: string, candidates: Array<{ name: string; cr: string }>): string;
export function characterRulesLine(input: CharacterEditionSummary): string;  // see Characters
```

Exact signatures may change during phase 1. The behaviour below may not.

### Classification (`classifyEdition`)

Collect the entry's source IDs: `sourceId` (when non-null) plus every `sources[].sourceId`. Look each up in the source index to get its category. The first rule that matches wins:

1. `isHomebrew === true` → `homebrew`. `book: null`.
2. `isLegacy === true` → `2014`. `book`: the first source in a 2014 category, else the first source with a known description, else `null`.
3. Any source in a **2024 category** → `2024`. `book`: the first such source.
4. Any source in a **2014 category** → `2014`. `book`: the first such source.
5. Any source in the **playtest category** → `playtest`. `book`: the first such source.
6. Any source in a **third-party category** → `third-party`. `book`: the first such source.
7. Otherwise (no sources, unknown IDs, or only other categories) → `unstated`. `book`: the first source with a known description, else `null`.

**Reprint policy (rules 2–4).** D&D Beyond creates a **new definition** when 2024 changes an entry, and marks the old one Legacy. It attaches a 2024 book to an **existing** definition only when the text is valid for both editions (Studded Leather). So:
- a definition with any 2024 source and `isLegacy !== true` is the current 2024 text;
- `isLegacy: true` always wins, even if a 2024 reprint book is attached.

If two different definitions in one twin group classify the same edition, that is not a twin pair. The tiebreak picks between them.

Category table (D&D Beyond `sourceCategoryId`, live 2026-10-16):

| Ruleset | Categories |
|---|---|
| 2024 | 24 "5.5e Core Rules", 38 "5.5e Expanded Rules" |
| 2014 | 26 "5e Core Rules", 1 "5e Expanded Rules", 23 "Legacy/Noncore" |
| playtest | 3 "Playtest" |
| third-party | 2 Critical Role, 18 Grim Hollow, 19 Drakkenheim, 20 Humblewood, 21 Kobold Press, 22 MCDM, 25 Free League, 27 The Griffon's Saddlebag, 29 1985 Games, 30 Road to Ithaka Press, 31 Loot Tavern, 32 Mage Hand Press, 33 Roll & Play Press, 34 Avantris Entertainment, 36 Chaosium, 37 Paizo, 39 Visionary Production and Design, 40 Sterling Vermin, 41 Palaeo Games, 42 Beadle & Grimm's, 43 MonkeyDM, 44 Baldman Games, 45 Vampire: The Masquerade, 47 Floral Dragons, 48 GameConclave, 49 West Coast Adventurers Guild, 50 KibblesTasty, 51 Blizzard, 52 Crow & Crown |
| unstated | everything else: 6 D&D Beyond, 7 Magic: The Gathering, 8 Eberron, 9 Archived, 10 Rick and Morty, 11 Runeterra, 12 Noncore D&D, 13 Adventurers League, 14 Dragonlance, 15 Minecraft, 16 Hidden Sources, 17 Planescape, 28 Internal, 35 Core Rules, 46 D&D Beyond Drops, and **any category not in this table** |

A new category never defaults to `third-party`. Unknown categories are `unstated`, so we never claim something isn't WotC without knowing. The generator script (below) reports new categories for a human to place.

### Twin keys and groups

A **twin group** is every entry (of any ruleset) sharing one twin key. Twins are the 2024 and 2014 entries within a group.

| Content | Twin key |
|---|---|
| Spells, items, monsters, feats, backgrounds, races, classes | `twinName(name)` |
| Class features | `twinName(className) + "/" + twinName(featureName)`. "Extra Attack" for Paladin 2014 is not a twin of "Extra Attack" for Fighter 2024 |
| Racial traits | `twinName(speciesName) + "/" + twinName(traitName)` |
| Rules sections, conditions | not grouped (see phase 4) |

`twinName` works in four steps:
1. Lowercase and trim.
2. Fold the apostrophes `'` and `'` to `'`, then collapse whitespace.
3. If the result is a **normalized** 2014 name in the rename table, replace it with the **normalized 2024 name**. The canonical side is always 2024.
4. Rename-table lookups use the same normalization on both sides.

### Selection (`selectByEdition`)

Non-edition entries (third-party/homebrew/playtest/unstated) are never compared against editions. For the edition entries in a group:

| Requested | 2024 entry exists | 2014 entry exists | Result | Reason |
|---|---|---|---|---|
| 2024 | yes | any | 2024 | — |
| 2024 | no | yes | 2014 | `no-2024-version` |
| 2014 | any | yes | 2014 | — |
| 2014 | yes | no | 2024 | `no-2014-version` |

A group with no edition entries yields its non-edition entries. A single lookup takes the first by the tiebreak; a search keeps them all.

**Tiebreak** among several entries of the chosen ruleset in one group:
- **Monsters:** #58's existing order: official → Core Rules book → lowest ID.
- **Every other type:** first dedupe by definition `id` (the same spell arrives from several class lists), then official before homebrew, then lowest definition `id`.

### Single lookups (`get_*`): the gather algorithm

1. Normalize the query with `twinName`.
2. **Exact:** if some entry's `twinName` equals it, the target group is that twin key. Because renames map to the 2024 side, "Acid Arrow" reaches the Melf's Acid Arrow group.
3. **Partial:** otherwise, apply the tool's existing partial-match order across **every entry's name in both editions**. The target group is the group of the first match.
4. `selectByEdition` within the target group.
5. Add the rename line when the matched name's normalized form differs from the returned entry's normalized name, and only when the returned entry is 2014/2024 (non-edition picks get no rename line). When no entry carries the queried spelling, the rename table's spelling is shown.

### Searches (`search_*`): the pipeline

Every search runs these steps in order:

1. **Group** the full compendium (not the filtered set) by twin key.
2. **Name filter** (when given): a group matches if **any** entry name in the group matches. So "feeble" finds the Feeblemind/Befuddlement group.
3. **Select** one entry per edition-bearing group with `selectByEdition`. Non-edition entries pass through.
4. **Attribute filters** (level, school, concentration, CR, type, rarity, …) apply to the **selected** entry. Example: a concentration filter under 2024 drops the Barkskin group, because 2024 Barkskin is not concentration.
5. **Hidden count**: the number of other-edition entries in the surviving groups that would themselves have passed the filters.
6. Sort as today, then paginate or cap as today. Header totals count the result after hiding.

With a monster `source` filter, step 3 is skipped. All entries in the book are listed, each tagged, and the source header is used.

### `src/game-config.ts`

- Move `getGameConfig()` and its types (`GameConfig`, `GameSource`, now exported) **and its `onSessionInvalidated` hook** out of `src/tools/monster.ts`. Keep its boundary behaviour: `captureSession()` before the early return, and `assertSessionCurrent()` before caching. `monster.ts` and `reference.ts` import it.
- Export `getSourceIndex(): Promise<SourceIndex>`. It maps source ID → `{ categoryId, name, description, sourceURL }` and merges two inputs: the live config (preferred) and a **generated snapshot** `src/source-snapshot.ts` (all sources with those four fields, plus the category list). If the live config is unavailable, the snapshot alone is used, so labels and monster `source` resolution survive a D&D Beyond outage. The monster "Game config source list unavailable" error then occurs only if both are unusable. Sources newer than the snapshot classify as `unstated` until it is refreshed.

### Rename table

- `src/edition-renames.ts` exports `[name2014, name2024]` pairs, each with a comment holding its evidence.
- `scripts/dump-edition-renames.mts` (new) needs a logged-in session. It:
  1. fetches spells, items, monsters, feats, backgrounds, races and classes;
  2. lists every 2014 name with no same-named 2024 entry;
  3. proposes 2024 counterparts: a 2024 name containing the 2014 name, or the same level/rarity/CR/type with a similar description;
  4. prints candidates with that evidence.
- **The phase-1 agent keeps only pairs it has verified** by reading both descriptions: same thing, same level/rarity/CR, text clearly a revision. A creature-type change does not disqualify a pair (owner decision 2026-10-17). It commits them with the evidence. The owner reviews asynchronously after commit. **This review never blocks later phases.** A wrong or missing pair is visible in output and fixed with one table line.
- The same script regenerates `src/source-snapshot.ts` and prints any `sourceCategoryId` missing from the category table above.
- Document the refresh in CLAUDE.md beside the existing `dump-sourced-languages.mts` note.

---

## Tool contract

`rules_edition: z.enum(["2024", "2014"]).default("2024")` is added to:

| Tool | Phase |
|---|---|
| `ddb_search_spells`, `ddb_get_spell` | 2 |
| `ddb_search_monsters`, `ddb_get_monster` | 2 |
| `ddb_roll_treasure` (2024 tables only; a `"2014"` request rolls 2024 with the treasure reason line, and passes the edition to monster CR lookup) | 2 |
| `ddb_search_equipment`, `ddb_get_equipment` | 3 |
| `ddb_search_races`, `ddb_search_classes`, `ddb_search_backgrounds`, `ddb_search_feats`, `ddb_search_class_features`, `ddb_search_racial_traits` | 3 |
| `ddb_search_site` (threads it into each category search) | 3 |
| `ddb_get_condition`, `ddb_search_rules`, `ddb_get_rules` | 4 |
| `ddb_rate_encounter`, `ddb_encounter_cr` | already present; gain the rules line in phase 2 |

The following tools get labels without the param, in phase 5:
- `ddb_get_character`, `ddb_character_lookup`, `ddb_get_party`;
- `ddb_list_library`, `ddb_read_book`.

These tools are not affected: `ddb_login`, `ddb_logout`, `ddb_close_browser`, `ddb_clear_cache`, `ddb_list_characters`, `ddb_get_character_raw`, `ddb_download_character`, `ddb_get_campaign`, `ddb_list_campaigns`, `ddb_navigate`, `ddb_interact`, `ddb_get_page`.

### Output shape

- **Single lookups (`get_*`)**: title, then the rules line, then the reason/rename/source-note lines that apply, then the body.
- **Searches (`search_*`)**: search header, the tool's existing heading, result lines with the tag after each name, then the footer when twins were hidden.
- **`ddb_search_site`**: one search header at the very top and one combined footer summing hidden counts. Each category section calls its search in an embedded mode that omits that search's own header and footer, and its lines keep their tags.
- **Monster `source` vs `rules_edition`**: `source` wins. When the chosen entry's book edition differs from `rules_edition`, `sourceNote` is added, on single lookups under the rules line and on searches under the header. It is not an error.
- **Ambiguous partial names** (`getMonsterStats` only):
  - The new return type is `{ status: "found"; name; crValue; xp; info: EditionInfo } | { status: "not-found" } | { status: "ambiguous"; candidates: Array<{ name; crValue; xp }> }`.
  - "Ambiguous" means the partial matches span more than one distinct twin group. Edition twins of one creature are **not** ambiguous; selection picks between them.
  - **Encounter and treasure treat an ambiguous member like a not-found member today**: it is excluded from the XP total / CR max and listed in the output, using `ambiguityMessage` in place of the not-found text.
  - `getMonster` keeps its fuzzy fallback; its output already names the monster.
- **Tool descriptions**: every tool with the param says "Returns 2024 content by default; set rules_edition to '2014' for 2014 rules. The 'Rules:' line or [tag] in the output names the ruleset."
- **Server instructions**: `new McpServer({...}, { instructions })` in `src/index.ts` gains: "Every rules answer carries a 'Rules:' line or an inline tag — [2024], [2014], [third-party], [homebrew], [playtest] or [edition not stated] — naming the ruleset, and says when the edition shown differs from the one requested. Pass this on to the user. Content defaults to 2024; if the user's table plays 2014, pass rules_edition: '2014'."
- **Error, not-found and login-required messages** carry no edition label and are exempt from the consistency test.

---

## Per-source behaviour

### Spells (`src/tools/reference.ts`) — phase 2

- **Types widen:** `SpellDefinition` gains `id`, `isLegacy`, `sources`, `isHomebrew`. The tests' `spell()` helper in `tests/spell-compendium-endpoints.test.ts` builds them.
- **The cache key changes** to `"spell-compendium-v2"`. Old entries (including the pre-2.7.2 bare-array compatibility path) lack the fields and are discarded, not read.
- The compendium stores **every** definition, keyed by definition `id`, with a `twinName → ids[]` index. This replaces the name-keyed first-wins merge. No new requests are made: the 16 existing requests already return both editions.
- `characterSpellBuffer` is keyed by definition `id` too, and its entries are classified like everything else.
- **Concentration** (`buildConcentrationByLevel`), using the character's own definition:
  1. a boolean `def.concentration` wins;
  2. else the compendium entry with the same definition `id`;
  3. else the compendium's selection for `twinName(def.name)` using `classifyEdition(def)`'s ruleset when that is 2014/2024, else 2024.

  `isConcentrationSpell` takes `(def)` instead of `(name)`.
- `getSpell(name, rulesEdition)` uses the gather algorithm. `searchSpells({ …, rulesEdition })` uses the search pipeline.

### Monsters (`src/tools/monster.ts`) — phase 2

- `rankCandidates` drops the `Boolean(m.isLegacy) === preferLegacy` key. Edition choice moves to `selectByEdition`, and the remaining keys (official → Core Rules book → lowest ID) become the monster tiebreak.
- **Every `preferLegacy` site changes:**
  - `rankCandidates` and `selectMonster` take `rulesEdition`;
  - `availableSourcesFor` drops the arg (the source hint only lists books);
  - the `getMonster` source path stops forcing an edition: `source` wins, and within the book the requested edition is preferred;
  - `getMonsterStats(name, { rulesEdition = "2024" })`;
  - `encounter.ts` passes `rulesEdition` through;
  - `treasure.ts` passes its new param.
- `getMonsterStats` gets the new return type. Its inline Open5e v1 fetch moves into `open5e.ts` (one place to migrate in phase 4).
- The `[Legacy]` tag and the `**Source** … [Legacy]` text are replaced by the edition tag and rules line.
- `searchMonsters` uses the search pipeline. CR/type/size are attribute filters; the 600-entry scan is unchanged.

### Interim Open5e labels — phase 2

`open5e.ts` still calls v1 (SRD 5.1) until phase 4. Phase 2 makes every existing `o5*` output carry `Rules: 2014 · SRD 5.1 (Open5e fallback — …)` (single lookups) or the `[2014]` tag (search lines), for **all** content types, not just spells and monsters. The `…` is `D&D Beyond unavailable` or `not found on D&D Beyond`, chosen by the caller. This keeps the consistency test meaningful from phase 2 on, and no fallback is ever unlabelled.

### Equipment and character options (`src/tools/reference.ts`) — phase 3

- **Items:** same as spells. `DdbItem` gains `isLegacy`/`sources`/`isHomebrew`, the store is id-keyed, and the cache key is bumped if a cached payload's shape changes. Equipment search keeps its fixed cap of 30, applied after hiding.
- **Races, classes, backgrounds, feats, class features, racial traits:**
  - classify, tag every line, use the search pipeline with the twin keys above;
  - widen each `Ddb*` interface for any marker it lacks;
  - the existing "Legacy"/"Homebrew" text tags are replaced by `editionTag`;
  - an entry with no sources is `unstated` and stays listed.
- `ddb_search_site` (`src/tools/search.ts`): thread `rulesEdition` through `search()` / `runCategory` and use the embedded mode.

### Open5e, rules and conditions (`src/open5e.ts`, `src/tools/reference.ts`) — phase 4

- **Start by verifying filters for every v2 endpoint used.** That means spells, creatures, items, magicitems, weapons, armor, species, classes, backgrounds, feats and rules, for both search and by-name lookups.
  - Find the parameter that restricts each to one document: `document__key`, `document__key__in` or `document__slug`.
  - Prove it with a known 2014-only and a known 2024-only entry.
  - Where no server filter works, filter client-side on each result's document key.
  - Commit recorded v2 responses as fixtures, and a test per endpoint that asserts the filter (or client-side filtering) keeps only the requested document.
- Move every Open5e call, including the relocated monster-stats fetch, from `https://api.open5e.com/v1` to `/v2`.
  - Query `srd-2024` by default, and `srd-2014` when requested or when the 2024 query finds nothing (with the reason line).
  - **Every request is document-scoped**, including by-name lookups. v2 response shapes differ from v1, so rewrite the `o5*` formatters against the fixtures.
  - Delete `fetchO5Cantrips` if it still has no importer.
- **Rules:**
  - `ddb_search_rules` / `ddb_get_rules` use v2 `rules` for the selected document.
  - Rules sections are not twin-grouped: SRD 5.2 has fewer, larger sections (56 vs 227).
  - A get that misses in the requested document retries the other one, with the rules reason line.
  - A search lists sections from the requested document. If it finds none, it lists the other document's sections under that document's header.
- **Conditions:**
  - Keep the existing 2014 text (SRD 5.1) and add 2024 text, keyed by edition: `getCondition(name, rulesEdition)`.
  - **Source of the 2024 text:** transcribe the 15 conditions from the SRD 5.2 Rules Glossary (CC-BY-4.0, published by Wizards of the Coast; official PDF linked from D&D Beyond's SRD page — record the exact URL used in a comment).
  - Add attribution ("This work includes material from the System Reference Document 5.2 by Wizards of the Coast LLC, licensed under CC-BY-4.0") in a code comment and the README.
  - Add a check script (or a mode of the rename script) that fetches `/character/v5/rule-data` `data.conditions` and reports any condition whose stripped text materially differs from the vendored 2024 text. This is a sanity check only; runtime never depends on it.

### Characters (`src/tools/character/*`) — phase 5

- Classify every entry at the [paths above](#character-json-paths-verified-on-live-characters) with `classifyEdition`.
- **A class's ruleset** comes from its base class definition. A subclass with a different ruleset is tagged on its own.
- **Main edition:**
  - Only classes classified 2024 or 2014 count. Among them, the highest level wins, and a tie between editions goes to 2024.
  - If none qualify (all homebrew/third-party/…), the main edition is `unstated`.
  - If the counted classes span both editions, the character is `mixed`, and 2024 is the main edition for tagging.
- **`characterRulesLine`** (in `src/edition.ts`) grammar:
  - `Rules: 2024` (no minority content)
  - `Rules: 2024 · 2014 content: Criminal / Spy (background), Sharpshooter (feat)`
  - `Rules: mixed — 2024: Bard 5 · 2014: Ranger 3`, followed by `· 2014 content: …` for non-class entries
  - Non-edition entries add a group per ruleset: `· homebrew: Blood Hunter 2 (class) · third-party: Firearm Specialist (feat)`
  - `Rules: edition not stated` when the main edition is `unstated`. Every entry is then tagged.
- **Inline tags:** entries whose ruleset differs from the main edition. Non-edition entries are always tagged.
- **Consumers:**
  - `parse.ts` adds the summary line to every section output.
  - `ddb_get_party` shows each member's summary line.
  - **`src/tools/character/definition.ts`** (`ddb_character_lookup`, which formats on its own and never calls `parseCharacterData`) adds the entry's rules line to each single-hit result and the tag to each line of the >3-hit list. These are character content: no `rules_edition`, no twin selection.
- **Fixtures:** `tests/fixtures/character-fixtures.ts` currently has no `isLegacy`/`sources`. Phase 5 adds them for the three test characters below.
- **Snapshots:** the committed character snapshots (`tests/__snapshots__/character-snapshot.test.ts.snap`) **will change**. Update them deliberately, run `scripts/snapshot-live-characters.mts` before and after per `docs/character-refactor.md`, and have the owner review the diff before commit.

### Library — phase 5

- **Joining a library book to its game-config source:** compare the last path segment of the library slug (`dnd/phb-2024` → `phb-2024`) with the last segment of the source's `sourceURL` (`sources/dnd/phb-2024` → `phb-2024`).
- If that fails, compare normalized title with normalized `description`.
- If both fail, the book is `unstated`.
- `ddb_list_library` tags each book. `ddb_read_book` puts a rules line under the title.

---

## Phases

Every phase:

- **May assume** only what earlier phases' "Done when" lists, plus this spec.
- **Done when** includes, in addition to its own list:
  - `npm run typecheck`, `npm run lint`, `npm test` pass;
  - CLAUDE.md is updated (architecture notes for what changed, and "Next steps" ticks the phase);
  - the work is committed to `main`.
- Must not write label wording outside `src/edition.ts`. If a phase needs new wording, add it there with a test.

### Phase 1: foundation (no tool behaviour changes)

**Touches:**
- new: `src/edition.ts`, `src/game-config.ts`, `src/source-snapshot.ts`, `src/edition-renames.ts`, `scripts/dump-edition-renames.mts`;
- `src/tools/monster.ts` (imports `getGameConfig`, its types and its invalidation hook from the new module);
- tests: new `tests/edition.test.ts` and `tests/game-config.test.ts`; `tests/monster.test.ts` and `tests/monster-session.test.ts`, whose hook-registration lookups (e.g. `onSessionInvalidated.mock.calls[0][0]`) must follow the moved hook.

**Done when:**
- `tests/edition.test.ts` covers:
  - every classification rule, including the reprint policy and the `book` choice for each rule;
  - every category-table row, plus the verified source IDs above as named cases (BR→2014, PHB-2024→2024, br-2024+BR→2024, TCMP1→third-party);
  - unknown ID / no sources → `unstated`;
  - every selection-table row, and both tiebreaks;
  - grouping and hidden counting, including the filtered-set case (a filter that matches only the 2014 member of a group still hides it);
  - the gather algorithm (exact, rename, partial);
  - class-feature and racial-trait twin keys;
  - exact strings for every label function.
- `tests/game-config.test.ts` covers: snapshot used when the live fetch fails, merged index, and the invalidation clear.
- The rename script has been run, and the verified pairs and refreshed snapshot are committed. Owner review is asynchronous and not part of done.
- All existing tests pass, with only the hook-registration lookups updated.

### Phase 2: spells, monsters, encounter, treasure

**Touches:** `src/tools/reference.ts` (spells), `src/tools/character/spells.ts`, `src/tools/monster.ts`, `src/tools/encounter.ts`, `src/tools/treasure.ts`, `src/open5e.ts` (interim labels, relocated monster-stats fetch), `src/index.ts` (params, descriptions, server instructions), `scripts/diagnose-compendium.mjs`, tests including the new `tests/rules-edition-consistency.test.ts`.

**Done when:**
- `ddb_get_spell "Sleep"` gives 2024 by default and 2014 with `rules_edition: "2014"`, each with the right rules line. "Acid Arrow" resolves through the rename table when the pair was committed.
- The concentration tests pass for all nine changed spells: a character's own definition wins over the compendium's other edition.
- `diagnose-compendium.mjs` replays the **id-keyed** build and reports, per content endpoint, total / 2024-only / 2014-only / both / non-edition / **lost**. Lost means definitions dropped for a missing `id` or `name`, or ids present in a response but absent from the store, and it must be 0.
- Monster tests are migrated from `preferLegacy` to `rules_edition` and pass. New tests cover:
  - the ambiguity result in both encounter and treasure output;
  - the `source` note on get and search;
  - search twin hiding with and without `source`.
- `ddb_rate_encounter`, `ddb_encounter_cr` and `ddb_roll_treasure` output a rules line. Treasure also gives the reason line on `"2014"`.
- Every Open5e output carries the interim 2014 label.
- **The consistency test is in place.** It enumerates tools from the server's `tools/list` whose input schema has `rules_edition`, so a new tool can't escape it. For each one, using fixtures, it asserts:
  - single lookups have a `Rules:` line;
  - every search result line has a tag after the name;
  - error/not-found strings are exempt.
- CLAUDE.md: work items 1 and 3 are marked done, and the stateless-safe plan's Task 4 is marked unblocked.

### Phase 3: equipment and character options

**Touches:** `src/tools/reference.ts` (items, races, classes, backgrounds, feats, class features, racial traits), `src/tools/search.ts`, `src/index.ts`, tests.

**Done when:**
- Every tool in the phase-3 rows of the tool contract has the param, header, tags, pipeline and footer, with tests per tool, and passes the consistency test.
- Studded Leather (`[br-2024, BR]`, `isLegacy: false`) classifies as 2024.
- `ddb_search_site` shows one header and one combined footer.

### Phase 4: Open5e v2, rules and conditions

**Touches:** `src/open5e.ts`, `src/tools/reference.ts` (conditions, rules, fallback call sites), `src/tools/monster.ts` (fallback call sites), `src/index.ts`, README (attribution), tests and recorded v2 fixtures for both SRDs.

**Done when:**
- The per-endpoint filter tests are committed and pass.
- All fallbacks use v2 with the srd-2024-first policy and the final fallback labels.
- `ddb_get_condition "Exhaustion"` gives the 2024 text by default and the 2014 table on request.
- Rules search and get respect `rules_edition`, including the miss fallback with the rules reason line.
- The condition check script reports no differences, or each difference is explained in a comment.

### Phase 5: characters and library

**Touches:** `src/tools/character/*` (`parse.ts`, `identity.ts`, `definition.ts`, and each section module that lists edition-bearing entries), `src/tools/character.ts` (party), `src/tools/library.ts`, `tests/fixtures/character-fixtures.ts`, `tests/__snapshots__/`, tests.

**Done when:**
- Fixture tests pass for:
  - a pure-2024 character: `Rules: 2024`, no inline tags;
  - a 2024 character with a 2014 background and feat: the summary lists them, with inline tags on them;
  - a mixed-edition multiclass: `mixed` grammar;
  - a homebrew-class character: the non-edition group, or `edition not stated`.
- `ddb_character_lookup` single-hit and list paths carry labels.
- The snapshot diff has been reviewed by the owner and committed.
- The library outputs carry their labels, with a test for the slug join and the title fallback.

### Sequencing with other work

- **Stateless-safe plan** (`docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md`):
  - Task 2 (`server.tool` → `registerTool`) waits until phase 5 is done, because all five phases edit the registrations in `src/index.ts`.
  - Task 4 (delete `characterSpellBuffer`) is unblocked once phase 2 is done.
- CLAUDE.md "Next steps" item 5 (minor monster edges) is not in scope.
- Releases are the owner's call. Every phase leaves the server working.

---

## Testing

- **Unit tests (phase 1):** as listed in phase 1. They use a small fixture source index (no network) and pin every label string.
- **Per-tool tests (phases 2–5):** follow the existing pattern (mocked `fetch` via `vi.stubGlobal`/`vi.spyOn`, JSON fixtures). Each affected tool proves:
  - the default call returns 2024 with a rules line;
  - `"2014"` returns 2014;
  - a 2014-only entry under the default carries the reason line;
  - a 2024-only entry under `"2014"` carries the reason line;
  - search hides twins with the correct footer count;
  - `source` (monsters) disables hiding;
  - two same-edition entries in one group resolve by the tiebreak.
- **Cross-tool consistency test** (phase 2, `tests/rules-edition-consistency.test.ts`): described in phase 2's Done when. Later phases extend its fixtures, never its tool list.
- **Live checks** (manual, logged in, end of each phase): spot-call through `npm run dev` under both editions, as each lands. The calls are Fireball, Toll the Dead, Acid Arrow, Sleep (concentration change), Goblin, Red Dragon (ambiguity), Studded Leather, Fighter and Exhaustion. Paste the outputs' `Rules:` lines into the phase's commit message.

## Risks

- **Category drift:** D&D Beyond can add categories or recategorize books. Unknown → `unstated` keeps this safe. The generator script surfaces new categories.
- **Rename table gaps:** an unlisted rename shows both names, each correctly labelled. The 2014 one also gets "no 2024 version exists", which is wrong but visible. The fix is a table entry.
- **Open5e v2 shape changes:** phase 4 records fixtures. A shape change fails tests rather than silently mislabelling.
- **Output length:** per-line tags and headers add a few tokens per search. Character sheets tag only minority-edition entries to limit this.
