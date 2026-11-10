# Rules edition across all tools: design

**Status:** approved design. Phase 1 (foundation) implemented 2026-10-17. Its real signatures are in the "Signatures that differ from the spec's sketch" table of [the phase-1 plan](../plans/2026-10-16-rules-edition-phase-1-foundation.md), plus `twinAliases()`, which was added after review. Phase 2 implemented 2026-10-18. Phase 3 implemented 2026-10-20 (commits `6095618..2fca974`, final-review fixes `c897b08..0d8c52c`, carry-over round `9c6fe30..c985939`; owner decisions on book choice, `source` and per-owner class feature and racial trait selection are recorded in CLAUDE.md, and the rulings made after its plan are under [phase 3's per-source section](#equipment-and-character-options-srctoolsreferencets--phase-3)). Phase 4 implemented 2026-10-21 (commits `15e57e5..9d5ec31`, docs `124f658`/`c1ff944`, final-fix wave `e9f4e1a..9c629ba` and its docs commit; the plan's decisions 1–10 and the owner rulings made while executing it are under [phase 4's per-source section](#open5e-rules-and-conditions-srcopen5ets-srctoolsreferencets--phase-4)). Phase 5 implemented 2026-10-23 (commits `b705004..8ee84e3` on phase start `4b1216c`, docs commit on top; the plan's decisions 1–13 and the owner rulings made while executing it are under "Characters — phase 5" and ["Library — phase 5"](#library--phase-5)). Revised 2026-10-17 with the owner's phase-2 decisions: reasons say "found", not "exists"; a locked monster pick yields to an owned other-edition twin; a failed game-config fetch is remembered for 60 s; registrations move to `src/server.ts`; the Open5e fallback label stands in for a reason line until phase 4.
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
| Classes, backgrounds, feats, class features, racial traits | **no `isLegacy`**. Classes, backgrounds and feats have `sources[]` only. Base and subclass class features have no `sources` of their own. Optional entries and racial traits have their own `sources[]` | e.g. Fighter appears twice, `[BR]` and `[PHB-2024]` |
| Monsters (monster-service) | `isLegacy` + `sourceId` + reprint `sources[]` | 2024 Zombie lists 2024 reprint books |
| Character JSON (paths below) | spells/items/race: `isLegacy` + `sources`; class/subclass/background/feat: `sources` only | A 2024 Bard character had a 2014 background (`Criminal / Spy`, `[BR]`) |
| Conditions (`/character/v5/rule-data` → `data.conditions`) | none | 15 conditions, **2024 text only** (Exhaustion: "You die if your Exhaustion level is 6", D20 Tests reduced) |
| Game config (`https://www.dndbeyond.com/api/config/json`) | `sources[].sourceCategoryId`, `sources[].sourceURL`, `sourceCategories[]` | 264 sources. The raw endpoint answers without auth; the code fetches it via `sessionFetch`, and `getPublicGameConfig()` fetches it with `anonymousFetch` for logged-out monster lookups and for `getGameConfig()` when the session file holds no valid cookies (owner rulings 2026-11-02), and for the source index whenever there is no valid session (2026-11-03, carry-over (ag)) |
| Open5e v2 | `document__key` = `srd-2024` (SRD 5.2) or `srd-2014` (SRD 5.1) | spells, creatures, weapons, armor, species, classes, backgrounds, feats, rules (56 vs 227 sections) all populated for both. **No conditions in either.** **`document__key` is ignored by `items` and `magicitems`** (they return every document, even for a bogus key); **`document__key__in` restricts all 11 endpoints used** (resolved in phase 4, probed 2026-10-20). Other filter params are silently ignored, so everything but the document is matched client-side. SRD 5.2 on Open5e has no Rules Glossary (no condition or "grapple" entries) |

**Verified source IDs** (live): `1` BR "Basic Rules (2014)" cat 26; `2` PHB (2014) cat 26; `3` DMG (2014) cat 26; `5` MM (2014) cat 26; `145` PHB-2024 cat 24; `146` DMG-2024 cat 24; `147` MM-2024 cat 24; `148` br-2024 cat 24; `193` TCMP1 cat 34 (third-party).

**"Legacy" is not the same as "2014".** D&D Beyond marks content Legacy only when 2024 replaced it. A Xanathar's spell such as Toll the Dead is 2014-era but `isLegacy: false`. This design labels by **book era**, so Toll the Dead is "2014" and carries the reason "no 2024 version found".

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

- No `source` filter on `ddb_search_site`, encounter, treasure, conditions or rules.
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
  - Fallback because D&D Beyond could not be reached or the user is logged out (monster lookups ask D&D Beyond anonymously first when logged out; see Monsters): `Rules: 2024 · SRD 5.2 (Open5e fallback — D&D Beyond unavailable)`
  - Fallback because D&D Beyond answered but had no match: `Rules: 2024 · SRD 5.2 (Open5e fallback — not found on D&D Beyond)`
  - Open5e **searches** have their own first line, because their lines mix SRD 5.2 and SRD 5.1 entries (`open5eSearchHeader`): `Rules: 2024 by default — SRD 5.2, with SRD 5.1 entries only where no 2024 version was found (Open5e fallback — D&D Beyond unavailable).` (or `… not found on D&D Beyond).`), and the mirror `Rules: 2014 requested — SRD 5.1, with SRD 5.2 entries only where no 2014 version was found (…).`. Lines carry `[2024]` / `[2014]` after the name, and the usual `searchFooter` closes them. A search that renders one hit as a detail block keeps the single-lookup label with its reason line.
  - Tools whose primary source is Open5e (rules): `Rules: 2024 · SRD 5.2`
  - Conditions (vendored): `Rules: 2024 · SRD 5.2` / `Rules: 2014 · SRD 5.1`
- **Reason line**, appended on the next line when the edition returned ≠ requested:
  - `(no 2024 version found — 2014 text shown)`
  - `(no 2014 version found — 2024 text shown)`
  - "Found", not "exists": D&D Beyond leaves content locked to the account out of its lists, so the data can't prove a version doesn't exist (live 2026-10-17: Befuddlement, the 2024 Feeblemind, is missing from the owner's spell lists).
  - Locked monster twin (`ddb_get_monster`, see [Monsters](#monsters-srctoolsmonsterts--phase-2)): `(the 2024 version isn't available to this account — 2014 text shown)` / `(the 2014 version isn't available to this account — 2024 text shown)`
  - Rules sections: `(no matching 2024 rules section — 2014 text shown)` / `(no matching 2014 rules section — 2024 text shown)`
  - Rules search that falls back to the other SRD (`rules-search-miss-2024` / `-2014`): `(no matching 2024 rules sections — 2014 sections listed)` / `(no matching 2014 rules sections — 2024 sections listed)`, under that SRD's header (`Rules: sections from SRD 5.1 (2014).`). Rules search lines are tagged: `• **Combat** [2024] (slug: …)`.
  - Treasure: `(no 2014 version exists — 2024 tables used)`
- **Locked monster content** (owner decision 2026-10-18):
  - Swapped search line suffix, after HP: `(2024 version isn't available to this account)` / `(2014 version isn't available to this account)`
  - Swap summary, just before the search footer: `1 entry shows its 2014 version because the 2024 version isn't available to this account.` / `N entries show their 2014 versions because the 2024 versions aren't available to this account.` (mirrored for 2014 requested)
  - Search header note: `1 entry isn't available to this account; its stat block falls back to the SRD or shows a restricted notice.` / `N entries aren't available to this account; their stat blocks fall back to the SRD or show a restricted notice.`
  - `ddb_get_monster` with `source`: `(an available version is in Basic Rules (2014) [basic-rules-2014] — pass source: "basic-rules-2014" to see it)` / `(an available version is in The Sunless Citadel — pass source: "TSC" to see it)`
  - `source: "homebrew"` search header: `Rules: listing homebrew entries only, each tagged [homebrew].` (`HOMEBREW_SEARCH_HEADER`; owner ruling 2026-11-10, C1: every line is `[homebrew]`, so the book header's "each tagged with its edition" was false; a homebrew monster near-match section opens with `Rules: closest homebrew matches only — no edition was selected; each line is tagged [homebrew].`, `HOMEBREW_NEAR_MATCH_RULES_LINE`). Before that it read `Rules: listing entries of every edition in homebrew content, each tagged with its edition.` (reworded from `showing every entry in homebrew content` by owner ruling 2026-11-10: the monster search now lists at most 50 entries unless `list_all`, so "every entry" was a false count claim; the meaning, no twin hiding and both editions listed, is unchanged)
- **Rename line**, appended when the query matched a different name in the same twin group than the entry returned: `(2014 name: Acid Arrow · 2024 name: Melf's Acid Arrow)`
- **Book-choice labels** (a same-edition entry exists in several books; owner decision 2026-10-19): a search line ends with `· Monsters of the Multiverse [motm] (also in Volo's Guide to Monsters [vgtm] — pass source to choose)`; a single lookup adds the line `(also in Volo's Guide to Monsters [vgtm] — pass source to choose)`.
- **Source note** (monsters): `(source "xgte" is a 2014 book — its entries are listed whatever rules_edition says)` (owner decision 3, 2026-10-27)
- **Inline tag**, placed **immediately after the entry's name** on search lines and minority-edition character entries: `[2024]`, `[2014]`, `[third-party]`, `[homebrew]`, `[playtest]`, `[edition not stated]`. Example search line: `- **Fireball** [2024] — 3rd-level Evocation`.
- **Search header**, as the first line of every search result, above the tool's existing heading (e.g. `**Spell Search** (N found)`, which stays):
  - Default: `Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: "2014" for 2014 versions.`
  - With `rules_edition: "2014"`: `Rules: 2014 requested — 2024 entries appear only where no 2014 version was found.`
  - With a `source` filter: `Rules: listing entries of every edition in <book>, each tagged with its edition.` (reworded from `showing every entry in <book>` by owner ruling 2026-11-10, for the same reason; no twin hiding, unchanged. `searchHeader({ sourceBook })` in `src/edition.ts`, shared by every catalog source search)
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

// One namer per content kind, each over only its kind's rename pairs (decision 5, 2026-10-29).
// "none" has no pairs: feats, races, classes and racial traits.
export const twinNames: Readonly<Record<"spell" | "item" | "monster" | "subclass" | "background" | "none", TwinNamer>>;
                                                     // twinNames.<kind>(name): normalized, that kind's renames applied

export function selectByEdition<T>(
  group: readonly T[],            // one twin group
  requested: RulesEdition,
  info: (c: T) => EditionInfo,
  tiebreak: (a: T, b: T) => number,
  available: (c: T) => boolean = () => true,   // false = locked to the account; drives the locked-… reasons
): Selection<T> | null;           // { entry, reason?: EditionReason | LockedReason, alternatives? }

export function groupAndSelect<T>(
  all: readonly T[], requested: RulesEdition,
  opts: SearchOptions<T>,         // info, twinKey, tiebreak, nameMatches?, passes?, available?, countFilteredPicks?, …
): { selected: SearchSelection<T>[]; hidden: number };

export function rulesLine(info: EditionInfo, opts: { reason?: RulesLineReason; open5e?: Open5eOrigin } = {}): string;  // RulesLineReason also has the rules-search-miss-…, locked-… and logged-out-locked-… reasons; Open5eOrigin also has "needs-login"
export function renameLine(name2014: string, name2024: string): string;
export function sourceNote(source: string, bookRuleset: RulesEdition, requested: RulesEdition): string | null;  // null when the book's edition equals the requested one
export function editionTag(info: EditionInfo): string;
export function searchHeader(mode: { requested: RulesEdition } | { sourceBook: string } | { rulesDoc: RulesEdition }): string;
export function searchFooter(requested: RulesEdition, hidden: number): string | null;
export function ambiguityMessage(query: string, candidates: ReadonlyArray<{ name: string; cr: string | null }>): string;  // names at most AMBIGUITY_LIST_CAP (20), then ", and N more"; a null CR prints as unknown
export function characterRulesLine(entries: readonly CharacterEditionEntry[]): string;  // see Characters
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
| Spells, items, monsters, backgrounds | `twinNames.<kind>(name)`: `twinNames.spell`, `.item` (magic items, poisons, gear), `.monster`, `.background` |
| Feats, classes | `twinNames.none(name)` (no rename pairs) |
| Class features | not twinned per feature; they select by owner (owner decision 2026-10-20): `classOwnerTwinKey` is `twinNames.subclass(className)` (base and optional features) or `twinNames.subclass(className) + "/" + twinNames.subclass(subclassName)` (subclass features). "Extra Attack" for Paladin 2014 never meets Fighter 2024 |
| Racial traits, species (races search) | the species by `twinNames.none(fullName)` within an edition group of `twinNames.none(baseRaceName \|\| baseName \|\| fullName)`, so the 2024 Elf replaces the 2014 High Elf, Wood Elf and Eladrin (Variant) |
| Rules sections, conditions | not grouped (see phase 4) |
| Open5e records | each endpoint's kind: spells → spell, creatures → monster, items / magicitems / weapons / armor → item (plus the Open5e-only armour pairs), backgrounds → background, `/classes/` → subclass (Open5e files subclasses there; owner ruling 2026-10-29), species / feats / rulesets → none |

Each `twinNames.<kind>` namer works in four steps:
1. Lowercase and trim.
2. Fold the apostrophes `'` and `'` to `'`, then collapse whitespace.
3. If the result is a **normalized** 2014 name in its kind's rename pairs, replace it with the **normalized 2024 name**. The canonical side is always 2024.
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
- **Every other type:** first dedupe by definition `id` (the same spell arrives from several class lists), then official before homebrew, then non-Legacy before Legacy, then lowest definition `id`.

### Single lookups (`get_*`): the gather algorithm

1. Normalize the query with the content kind's namer (`twinNames.<kind>`).
2. **Exact:** if some entry's twin key (`twinNames.<kind>(name)`) equals it, the target group is that twin key. Because renames map to the 2024 side, "Acid Arrow" reaches the Melf's Acid Arrow group.
3. **Partial:** otherwise, apply the tool's existing partial-match order across **every entry's name in both editions**. The target group is the group of the first match.
4. `selectByEdition` within the target group.
5. Add the rename line when the matched name's normalized form differs from the returned entry's normalized name, and only when the returned entry is 2014/2024 (non-edition picks get no rename line). When no entry carries the queried spelling, the rename table's spelling is shown.

### Searches (`search_*`): the pipeline

Every search runs these steps in order:

1. **Group** the full compendium (not the filtered set) by twin key.
2. **Name filter** (when given): a group matches if **any** entry name in the group matches. So "feeble" finds the Feeblemind/Befuddlement group.
3. **Select** one entry per edition-bearing group with `selectByEdition`. Non-edition entries pass through.
4. **Attribute filters** (level, school, concentration, CR, type, rarity, …) apply to the **selected** entry. Example: a concentration filter under 2024 drops the Barkskin group, because 2024 Barkskin is not concentration.
5. **Hidden count**: the number of other-edition entries in the surviving groups that would themselves have passed the filters. Since phase 3 (`countFilteredPicks`), a group whose selected entry fails the attribute filters while the other edition's pick passes is not listed but counted once; a search that lists nothing but counts such groups replies with the header, the no-match line and the footer, not an Open5e fallback.
6. Sort as today, then paginate or cap as today. Header totals count the result after hiding.

With a monster `source` filter, step 3 is skipped. All entries in the book are listed, each tagged, and the source header is used.

### `src/game-config.ts`

- Move `getGameConfig()` and its types (`GameConfig`, `GameSource`, now exported) **and its `onSessionInvalidated` hook** out of `src/tools/monster.ts`. Keep its boundary behaviour: `captureSession()` before the early return, and `assertSessionCurrent()` before caching. `monster.ts` and `reference.ts` import it.
- Export `getSourceIndex(): Promise<SourceIndex>`. It maps source ID → `{ categoryId, name, description, sourceURL }` and merges two inputs: the live config (preferred) and a **generated snapshot** `src/source-snapshot.ts` (all sources with those four fields, plus the category list). If the live config is unavailable, the snapshot alone is used, so labels and monster `source` resolution survive a D&D Beyond outage. The monster "Game config source list unavailable" error then occurs only if both are unusable. Sources newer than the snapshot classify as `unstated` until it is refreshed. With no valid session the live input is `getPublicGameConfig()` (anonymous, no credentials), so logged-out labels and `source` resolution see newer books too (2026-11-03, carry-over (ag)).
- `getGameConfig()` remembers a failed fetch for 60 s per session (phase 2), so an outage costs one retry run (~7 s on a 5xx) a minute rather than one per tool call. The session-transition hook clears it.

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
- **`ddb_search_site`**: one search header at the very top and one combined footer summing hidden counts. Each category section calls its search in an embedded mode that omits that search's own header and footer, and its lines keep their tags. The combined header is printed only when at least one included section came from D&D Beyond (has a non-null header); an all-Open5e reply keeps each section's own `Rules:` line, as today (owner decision 2026-10-20).
- **Catalog `source` and index** (owner decisions 2026-10-19/20): `ddb_search_equipment`, `ddb_get_equipment`, the spell tools and the races, classes, backgrounds, feats, class-feature and racial-trait searches take an optional `source`, resolved like the monster one (`src/source-filter.ts`). Every catalog search calls `getSourceIndex()` (cached per session), because classifying an entry needs it, not only searches given a `source`.
- **Monster `source` vs `rules_edition`**: `source` wins. When the chosen entry's book edition differs from `rules_edition`, `sourceNote` is added, on single lookups under the rules line and on searches under the header. It is not an error. A search's note describes the book (`sourceNoteFor` in `src/tools/edition-search.ts`, 2026-11-03, carry-over (al)). A get's note is added only when the shown entry's edition differs from `rules_edition`, naming the book's real edition and, for a reprint of the other edition, the entry's too: `(source "cos" is a 2014 book, but this entry is 2024 text — shown whatever rules_edition says)`; a 2014/2024 entry in a book that is neither (a Legacy entry in tcsr, Tal'Dorei Campaign Setting Reborn, a `[third-party]` category) reads `(this entry from source "tcsr" is 2014 text — shown whatever rules_edition says)` (`lookupSourceNote` in `src/edition.ts`, 2026-11-04, carry-over (ap)).
- **Ambiguous partial names** (`getMonsterStats` only):
  - The new return type is `{ status: "found"; name; crValue; xp; info: EditionInfo } | { status: "not-found" } | { status: "unknown-cr"; name; info: EditionInfo } | { status: "ambiguous"; candidates: Array<{ name; crValue; xp }> }` (`unknown-cr` was added later: a creature identified by an exact or single-group name whose CR is unknown; encounter and treasure print `unknownCrMessage`; an ambiguous candidate's CR/XP may be null, printed as unknown and listed last; `| { status: "unavailable" }` was added 2026-11-04: D&D Beyond could not be asked and Open5e did not find the name, see CLAUDE.md carry-over (aq)).
  - "Ambiguous" means the partial matches span more than one distinct twin group. Edition twins of one creature are **not** ambiguous; selection picks between them.
  - **Encounter and treasure treat an ambiguous member like a not-found member today**: it is excluded from the XP total / CR max and listed in the output, using `ambiguityMessage` in place of the not-found text.
  - `getMonster` keeps its fuzzy fallback; its output already names the monster.
- **Tool descriptions**: every tool with the param says "Returns 2024 content by default; set rules_edition to '2014' for 2014 rules. The 'Rules:' line or [tag] in the output names the ruleset."
- **Server instructions**: `new McpServer({...}, { instructions })` in `src/server.ts` (phase 2 moves every registration there from `src/index.ts`, which keeps only the stdio entrypoint, so the consistency test can import the server) gains: "Every rules answer carries a 'Rules:' line or an inline tag — [2024], [2014], [third-party], [homebrew], [playtest] or [edition not stated] — naming the ruleset, and says when the edition shown differs from the one requested. Pass this on to the user. Content defaults to 2024; if the user's table plays 2014, pass rules_edition: '2014'."
- **Error, not-found and login-required messages** carry no edition label and are exempt from the consistency test.

---

## Per-source behaviour

### Spells (`src/tools/reference.ts`) — phase 2

- **Types widen:** `SpellDefinition` gains `id`, `isLegacy`, `sources`, `isHomebrew`. The tests' `spell()` helper in `tests/spell-compendium-endpoints.test.ts` builds them.
- **The cache key changes** to `"spell-compendium-v2"`. Old entries (including the pre-2.7.2 bare-array compatibility path) lack the fields and are discarded, not read.
- The compendium stores **every** definition, keyed by definition `id`, with a `twinNames.spell → ids[]` index. This replaces the name-keyed first-wins merge. No new requests are made: the 16 existing requests already return both editions.
- `characterSpellBuffer` is keyed by definition `id` too, and its entries are classified like everything else.
- **Concentration** (`buildConcentrationByLevel`), using the character's own definition:
  1. a boolean `def.concentration` wins;
  2. else the compendium entry with the same definition `id`;
  3. else the compendium's selection for `twinNames.spell(def.name)` using `classifyEdition(def)`'s ruleset when that is 2014/2024, else 2024.

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
- `searchMonsters` uses the search pipeline. CR/type/size are attribute filters. (Superseded 2026-11-10: they filter over the full cached monster list, not a 600-entry scan; see the monster search spec.)
- **Locked twin** (owner decision 2026-10-17): when `getMonster`'s pick (no `source`) is the requested edition but its stat block is restricted (`accessType 4`, no stats), and the other edition's twin is owned, show that twin with the locked reason line. Live, about 1 in 55 twin groups (e.g. Twig Blight). With `source`, never swap.
  - **Owner decision 2026-10-18 (always give information when we can):** the list response carries a top-level `accessType` map, `{ "<id>": <number> }` (live: it agreed with the detail endpoint on 60 of 60 entries; only `4` means locked, a missing map or id means available). Per twin group the order is: the first available entry of the requested edition by tiebreak; else, when every requested-edition entry is locked, the first available other-edition entry with the `locked-…` reason; else today's selection (the other edition, when the requested one has no entry, keeps the `no-…-version` reason and prefers an available copy). `selectByEdition` / `lookupByName` / `groupAndSelect` take this as an optional `available` predicate.
  - **Search** (no `source`): a swapped line keeps its edition tag and ends, after HP, with `(2024 version isn't available to this account)` / `(2014 version isn't available to this account)`; a swap summary line goes just before the footer; a swapped group isn't counted as hidden. With or without `source`, a header note counts the entries that are locked. The note and the swap summary count every selected entry, as the header total does, not just the lines shown (owner decision 2026-10-18, final review). With `source`, nothing is swapped.
  - **`getMonster`** (no `source`) picks with the list map, so a locked pick's stat block is never fetched; the detail check stays the fallback when the map lacks the id or calls a restricted pick available (one more candidate, at most one extra detail request). With `source`, a restricted pick gets a hint naming the first official, available entry of its twin group outside the book (by short name when the book has no slug); a failed hint lookup gives no hint.
  - **`source: "homebrew"`** (both tools, case-insensitive, checked before book resolution): homebrew entries only (`isHomebrew !== false`), labelled `Rules: homebrew (edition not stated)` / `[homebrew]`, no selection, swap or source note; a search's header is `HOMEBREW_SEARCH_HEADER` (until 2026-11-10 the book header with `homebrew content` as the book). `getMonsterStats` still skips homebrew.
  - **Logged out** (owner rulings 2026-11-02; CLAUDE.md's monster tool notes hold the detail): `getMonster`, `searchMonsters` and `getMonsterStats` ask monster-service first through `anonymousFetch` (no credentials), with `getPublicGameConfig()`, and only a failure or an empty answer goes to Open5e. Anonymous answers lock everything but free content, so the locked/swap/restricted handling applies with logged-out wording from `src/edition.ts` (`loggedOutReason`, `lockedLineSuffix`, `lockedSwapSummary`, `lockedEntriesNote` with `loggedOut`; `LOGGED_OUT_RESTRICTED_NOTE`). A locked requested-edition entry whose twin is free is not swapped when that edition's SRD has the creature (`Rules: 2024 · SRD 5.2 (Open5e — the D&D Beyond version needs ddb_login)`). The "Fallback because ... the user is logged out" label under "Label formats" therefore now applies to logged-out monster lookups only when D&D Beyond itself fails; an empty answer gets the "not found on D&D Beyond" label, as logged in. `source: "homebrew"` still needs login.

### Interim Open5e labels — phase 2 (superseded by phase 4)

`open5e.ts` still calls v1 (SRD 5.1) until phase 4. Phase 2 makes every existing `o5*` output carry `Rules: 2014 · SRD 5.1 (Open5e fallback — …)` (single lookups) or the `[2014]` tag (search lines), for **all** content types, not just spells and monsters. The `…` is `D&D Beyond unavailable` or `not found on D&D Beyond`, chosen by the caller. This keeps the consistency test meaningful from phase 2 on, and no fallback is ever unlabelled. A 2024 request answered this way gets no reason line: the `Rules: 2014 · SRD 5.1 (Open5e fallback — …)` label is the reason until phase 4 queries SRD 5.2 first. A "no 2024 version" reason would be false, because SRD 5.2 has one. Phase 4 removed the interim label: Open5e answers now follow the labels under "Label formats".

### Equipment and character options (`src/tools/reference.ts`) — phase 3

- **Items:** same as spells. `DdbItem` gains `isLegacy`/`sources`/`isHomebrew`, the store is id-keyed, and the cache key is bumped if a cached payload's shape changes. Equipment search keeps its fixed cap of 30, applied after hiding.
- **Races, classes, backgrounds, feats, class features, racial traits:**
  - classify, tag every line, use the search pipeline with the twin keys above;
  - widen each `Ddb*` interface for any marker it lacks;
  - the existing "Legacy"/"Homebrew" text tags are replaced by `editionTag`;
  - an entry with no sources is `unstated` and stays listed.
  - class-feature and racial-trait entries are now `ClassFeatureEntry` / `RacialTraitEntry` (`src/tools/features-traits.ts`). Class and subclass features carry no `sources` of their own, so their entries take the owning subclass's or class's. Standard racial traits do carry their own `sources` (live 2026-10-17: 149 of 313 differ from their race's; e.g. 2014 Human lists sourceIds [1, 2], its traits [1]), but `buildRacialTraits` deliberately uses the race's; an optional entry keeps its own. Decided: racial traits classify from the race's sources, because the species is the owner and decides the edition, and a trait's own `sources` only name the book that printed its text (under a 2024 species they can name a 2014 book).
- **Book choice and `source`** (owner decisions 1 and 2, 2026-10-19): when one twin group holds several entries of the chosen edition, the tiebreak is official → non-Legacy → lowest id, the pick's search line names its book and the books of the set-aside versions (`bookChoiceNote`), and a single lookup adds an `alsoInLine`. `source` on these tools works like the monster one: resolved through the source index (slug → short name → title, every matching id), it wins over `rules_edition`, hides no twins, lists every entry in the book with its tag, uses the `searchHeader({ sourceBook })` header, and adds `sourceNote` when the book's edition differs from `rules_edition`.
- **Owner selection** (owner decisions 4–7, 2026-10-20): class features and racial traits choose the edition per owner (class, class/subclass, or species), not per feature. Filter first, then pick the owner, so the edition is chosen among owners with a matching feature: a name only the 2014 owner has is listed `[2014]`. An owner with no version in the requested edition is listed with its own tag; third-party, homebrew and unstated owners are never hidden. Every line of a duplicated owner carries the book-choice note. Species are grouped by base race, so the 2024 Elf replaces the 2014 High Elf, Wood Elf and Eladrin (Variant) by default, in both the races and racial-trait searches; naming the subrace finds it under either edition. Mixed setups (a 2024 Bard who is a 2014 High Elf) are served by naming the species, per-call `rules_edition`, or `source`.
- `ddb_search_site` (`src/tools/search.ts`): thread `rulesEdition` through `search()` / `runCategory` and use the embedded mode.
- **Rulings after the plan** (final review and carry-over round, 2026-10-20; these are the shipped behaviour):
  - **Filter gap:** flat searches (spells, items, classes, backgrounds, feats) and monster search set `countFilteredPicks` (see the search pipeline, step 5). A locked monster group's swapped pick is never counted. The monster hidden-only reply keeps the partial-scan note `(checked the first N of M entries)`.
  - **Book notes:** the flat book-choice note names only set-aside versions that pass the search's filters. `ddb_search_site` has no `source`, so its sections print no book notes (`bookNotes: false`); lines keep their tags.
  - **Order:** without `source`, class-feature and racial-trait results list the requested edition's owners first, then the other edition's, then third-party/homebrew/unstated owners. In every mode, entries that tie on a tool's order (equal names) are ordered by the adapter's tiebreak, official → non-Legacy → lowest id, instead of payload order.
  - **Site search frame:** with `category: "all"`, one search header (only when a section came from D&D Beyond) and one combined footer; a single category keeps its own header and footer.
  - **Game config:** concurrent cold callers of one session generation share one in-flight fetch (`configPending`, modelled on the cobalt-token exchange); a session change before it runs sends no request. A 10 s deadline (`CONFIG_FETCH_TIMEOUT_MS`) aborts it, resolves every caller null, frees the slot and remembers the failure for 60 s (carry-over (h), done).
- **Later rulings (2026-10-28..2026-11-02; CLAUDE.md's tool notes hold the full text):**
  - **Dual-edition items in the catalog** (`ddb_get_equipment`, `ddb_search_equipment`, the items section of `ddb_search_site`; `classifyForEdition` via `CatalogAdapter.dualEdition`): a non-Legacy, non-homebrew item definition listing a 2024-category and a 2014-category book (539 live) is classified as the requested edition with that edition's first book. Under a `source` the book's edition decides when it is 2024 or 2014. A dual item alone in its twin group is shown under either edition and never counted as hidden. A non-dual entry of the requested edition in the same twin group beats the dual item (option B: that item classifies as `classifyEdition` does), and under a `source` B looks only at the book's entries and only at entries that pass the search's filters.
  - **`source: "homebrew"` on the catalog tools** (owner decision 7, 2026-10-29; `isHomebrewSource` in `src/source-filter.ts`, case- and whitespace-insensitive, checked before book resolution): homebrew entries only, each tagged `[homebrew]` and wrapped as untrusted text, header `HOMEBREW_SEARCH_HEADER` (owner ruling 2026-11-10, C1; was `searchHeader({ sourceBook: HOMEBREW_SOURCE_BOOK })`), no grouping, hiding, source note or Open5e fallback. Messages come from `homebrewLoginRequired`, `homebrewUnreachable`, `homebrewNoMatch` and `homebrewNotFound` in `src/edition.ts`.
  - **`ddb_search_site` "all"** drops a section whose body is a no-match line (judged by the structural `SearchSection.noMatch` flag its builder sets, never by the text, since 2026-11-03, carry-over (aj)) but still adds its hidden count to the combined footer; when every section is dropped the reply is `No results found for "<query>".` plus the combined footer when any section hid twins (owner ruling 2026-11-02).

### Open5e, rules and conditions (`src/open5e.ts`, `src/tools/reference.ts`) — phase 4

- **Start by verifying filters for every v2 endpoint used.** That means spells, creatures, items, magicitems, weapons, armor, species, classes, backgrounds, feats and rules, for both search and by-name lookups.
  - Find the parameter that restricts each to one document: `document__key`, `document__key__in` or `document__slug`.
  - Prove it with a known 2014-only and a known 2024-only entry.
  - Where no server filter works, filter client-side on each result's document key.
  - Commit recorded v2 responses as fixtures, and a test per endpoint that asserts the filter (or client-side filtering) keeps only the requested document.
- Move every Open5e call, including the relocated monster-stats fetch, from `https://api.open5e.com/v1` to `/v2`.
  - Query `srd-2024` by default, and `srd-2014` when requested or when the 2024 query finds nothing (with the reason line). **Superseded by ruling 2 below: both documents are loaded and selected together.**
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

**Rulings in the plan** ([plan](../plans/2026-10-20-rules-edition-phase-4-open5e-v2-rules-conditions.md); where they differ from the bullets above, they win):

1. **Whole documents, client-side matching.** Open5e v2 silently ignores filters it does not know, so every request is `?document__key__in=<doc>&limit=1000` (one whole document per endpoint; `next` is followed defensively) and any record from another document is dropped. Cached 1 h, one in-flight fetch per URL, a 20 s timeout per request inside one 30 s deadline per document (`O5_DOCUMENT_DEADLINE_MS`); a failed fetch is never cached but is remembered for 60 s per URL (`O5_FAILURE_TTL_MS`); a response is rejected when it is off `api.open5e.com` (checked on `resp.url`, not only `next`; owner rulings 2026-10-29/11-02).
2. **Both documents, one selection** (owner decision 2026-10-21). This replaces the bullet "Query `srd-2024` by default, and `srd-2014` when requested or when the 2024 query finds nothing", which, applied literally, gave false reasons. Every Open5e get and search loads both documents and selects with phase 1's code, taking each record's ruleset from its document: gets use `lookupByName` (exact twin name across both documents, then partial, then `selectByEdition`; reasons `no-2024-version` / `no-2014-version`), searches use `groupAndSelect` with `countFilteredPicks` (a 2014-only entry appears under 2024 tagged `[2014]`, other-edition twins are hidden and counted in the footer).
3. **Accepted edge:** an exact twin in one document beats a partial match in the other, as on the D&D Beyond path. `"Rope"` under 2014 gives SRD 5.2's Rope with `(no 2014 version found — 2024 text shown)`, though SRD 5.1 has "Rope, hempen (50 feet)".
4. **Open5e rename lines are suppressed when they would be false.** SRD 5.2 keeps 2014-era names for 30 rename-table pairs, so `"Bigby's Hand"` under 2024 shows SRD 5.2's "Arcane Hand" with no rename line. The line is kept only when the shown entry carries its own edition's spelling.
5. **Open5e searches get their own header** (see "Label formats").
6. **Rules come from `/v2/rulesets/`, not `/v2/rules/`** (owner decision 2026-10-21): 11 SRD 5.2 / 41 SRD 5.1 chapters, each nesting all its sections in full. A rules get matches the requested SRD first, exact chapter, exact section, partial chapter, partial section; a section name ("Cover") works too, and a chapter name ("Combat") returns the whole chapter. Known gap: SRD 5.2 on Open5e has no spellcasting chapter, so a 2024 `"spellcasting"` returns SRD 5.2's "Spellcasting" section (part of Multiclassing); the 2014 chapter needs `rules_edition: "2014"`. v1's 2014 Adventuring Gear, Conditions, Legal Information and Rest chapters are gone (Rest's text survives inside other chapters). SRD 5.2 has no condition entries and no "grapple" text, so a 2024 `"grapple"` search falls back to 2014. Rules are not twin-grouped: the requested SRD first, then the other.
7. **Rules search lines carry the edition tag** (the consistency test requires one on every search line), and a search that falls back gets its own reason line (see "Label formats").
8. **Unused Open5e exports were deleted:** `fetchO5Cantrips`, `o5GetRace`, `o5SearchWeapons`, `o5SearchArmor`. `o5GetItem` / `o5GetWeapon` / `o5GetArmor` became one `o5GetEquipment`, because exact-before-partial and twin selection must run over every equipment kind at once. A per-endpoint loop would return the first endpoint's partial hit (magicitems' "Flame Tongue Longsword") before reaching the weapons endpoint's exact "Longsword".
9. **Wider coverage:** the equipment fallback search also covers mundane items and applies `rarity` / `type`; the Open5e monster search applies `size`.
10. **Conditions moved to `src/tools/conditions.ts`.** The 2024 text is transcribed from SRD 5.2.1; `scripts/check-conditions.mts` compares it with D&D Beyond's rule-data and reports all 15 `ok`. It splits D&D Beyond's description at the first `<hr>` (D&D Beyond appends the 2014 text after it) and unwraps `[condition]X[/condition]` tags before comparing, so it verifies only the text before the `<hr>`.

Later owner rulings (made while executing the plan, 2026-10-21):

- A fixture-recorder cross-endpoint check skips srd-2014's `items` records "Hide Armor" and "Shield", as it skips Net and Musket.
- Monster actions restore `usage_limits` and `legendary_action_cost` on the name: "(Recharge 5–6)", "(2/Day)", "(Costs 2 Actions)". v2 `subcategory` is not a subtype and is not printed; the type line is "<size> <type>, <alignment>".
- When one SRD document fails to load, the whole Open5e call fails (the owner chose this over degrading to one document). What the user sees depends on the caller: the content-fallback callers print their existing "… DnD Beyond and Open5e both failed." messages (a one-document outage can surface as "not found"); the rules tools are Open5e-primary, so `o5SearchRules` / `o5GetRule` throw and `server.ts` answers `Rules search failed: …` / `Rules lookup failed: …`; `o5GetMonsterStats` returns `unavailable` for the failure, and `getMonsterStats` reports `unavailable` when D&D Beyond could not be asked either (encounter and treasure: "Couldn't look up — D&D Beyond unreachable"), else `not-found` (2026-11-04, carry-over (aq)).
- Reaction spells show `reaction_condition` after "1 reaction" (new output). Skill names read "Sleight of Hand".
- An Open5e spell search with an offset past the end prints the shared `**Spell Search** — offset N is past the end (T found)` line under its Open5e search header, with the hidden-twin footer (owner ruling 2026-10-29, work item 8; this replaced the plain no-match line, and D&D Beyond's catalog searches print the same line from `paginateResults`).
- Item search no-match text: "No items found matching the criteria (SRD only)." Mundane item line: `• <name> [tag] (<category>)`. Option searches are uncapped. Cost and weight show "—" when 0 or missing.
- Open5e species search groups by base race, as D&D Beyond does: the 2024 Elf hides and counts the 2014 High Elf, 2014 lists each subrace, naming a subrace finds it.
- Seven armour renames (Leather, Padded, Studded leather, Hide, Half plate, Splint, Plate → "… Armor") are Open5e-only (`OPEN5E_ARMOUR_RENAMES` in `src/edition-renames.ts`, used through `o5TwinNameFor(endpoint)`, the per-endpoint rename kinds), not in `EDITION_RENAMES`: D&D Beyond keeps one "Studded Leather" definition for both editions, and its spellings of the other six are unverified.
- Within the edition `selectByEdition` picks, an exact-name entry beats endpoint order ("Plate Armor" under 2014 gives the SRD 5.1 items record).
- Class `Features:` lists only `feature_type` CLASS_LEVEL_FEATURE; `caster_type` and feat type are humanized (Full, General, Fighting Style).
- Rules search folds the query and text like `normalizeName`. A blank get name is not found; a blank search query lists every chapter. Not-found text: `Rules chapter or section "<name>" not found. Try ddb_search_rules to browse the chapters.`
- Plan-mandated test markers were strengthened with owner approval (Open5e `ddb_get_monster` 2014 = "Goblin\nRules: 2014 · SRD 5.1"; `ddb_get_equipment` 2014 = "Longsword (Martial Weapon)\nRules: 2014 · SRD 5.1"; markers added for `ddb_rate_encounter` / `ddb_roll_treasure`).

Later owner rulings (final whole-branch review, 2026-10-21; fixed in `e9f4e1a..9c629ba`):

- `getCondition` matches only its own table keys (`Object.hasOwn`), so "constructor" and "__proto__" are not found rather than a TypeError, and a blank or whitespace-only name is not found rather than a partial match on Blinded.
- **Open5e twin keys fold `-` to a space and drop straight and curly apostrophes** (each endpoint kind's Open5e namer, `o5TwinNameFor(endpoint)`, on both sides of that kind's rename pairs; owner ruling 2026-10-21, so "will o wisp" finds Will-o'-Wisp, and every Open5e name filter folds the same way; live, no two records of one document collide under the fold), so SRD 5.1's "Adamantine Armor (Chain-Mail)" and SRD 5.2's "Adamantine Armor (Chain Mail)" are one group in gets, searches, species grouping and `o5GetMonsterStats` (live srd-2014 magic items have 19 such hyphen-only names). D&D Beyond's `normalizeName` and `twinNames` namers are unchanged. A punctuation-only difference never prints a rename line, and the rename pair is oriented by the shown entry's edition, since a folded key no longer equals a hyphenated 2024 name.
- **`rarity` matches exactly on both paths**, case-insensitively: "common" is not "Uncommon". Mundane gear counts as Common: on D&D Beyond an item with no rarity (as it is printed), on Open5e every `items` record. So `rarity: "common"` lists mundane gear plus Common magic items; the `ddb_search_equipment` description says so.
- Open5e monster and item searches that cap at 20 lines add D&D Beyond's `*Refine your search to see more results.*` after the lines, before the footer.
- The `ddb_get_rules` `query` jump folds case, curly apostrophes and whitespace on both sides, as the rules search does (a straight "can't" jumps to SRD 5.2's "can’t"); the folded index maps back, so the output keeps the original characters.
- **`o5GetMonsterStats` mirrors the D&D Beyond branch of `getMonsterStats`:** exact twin name first, else partial matches (normalized name contains the query) grouped by twin key; one group is `found` (picked by `selectByEdition`), several are `ambiguous` with one candidate per group, sorted by CR then name. It returns `MonsterStatsResult` (now defined in `src/open5e.ts`, re-exported from `monster.ts`), so a logged-out "Red Dragon" lists five candidates (Red Dragon Wyrmling, SRD 5.1's 2014-only Half-Red Dragon Veteran, Young, Adult and Ancient Red Dragon) through `ambiguityMessage`, "Ancient Red" is found, and "Goblin" is still Goblin Warrior.
- An Open5e weapon or armour get ends with the `Cost: … | Weight: …` line of the `items` record with the same Open5e twin key in the same document, when there is one (formatted as in the mundane item block, `—` for a 0 or missing part).
- Open5e species and background detail blocks print the record's `desc` (SRD 5.1 has it, SRD 5.2's is empty) after the label block (and a species' Size | Speed line), before the traits or benefits.
- A single-hit option search's detail block prints the rename line a get of the query would print: the same `lookupByName` computation and decision-4 suppression, kept only when that lookup shows the same entry. "school of evocation" under 2024 gives the Evoker block with `(2014 name: School of Evocation · 2024 name: Evoker)`; searches listing several lines have none.
- The Open5e spell block capitalizes `Duration:` ("Instantaneous").
- Follow-ups done 2026-10-21: carry-overs (l) (class table columns skipped by their `[Column data]` desc), (m) (a 2014 Shield prints `AC: +2`) and (p) (`fetchPages` origin and 20-page guards); a logged-out `Red Dragon` is ambiguous over five candidates (the recorded srd-2014 Half-Red Dragon Veteran fixture); the Warlock and Druid class records are recorded fixtures.
- Known gap, partly closed (CLAUDE.md carry-over (r), 2026-10-30): the equipment endpoints (items, magicitems, weapons, armor) now twin by `o5EquipmentKey` (rules M1–M3 over the item-kind key: `+N` as `plusN`, punctuation as spaces, words sorted, `sword`/`weapon` dropped, a price, count, measure or category prefix and `set` stripped, one trailing `s` per word) plus six verified `OPEN5E_EQUIPMENT_RENAMES`, which adds 126 twin pairs; a `guardedNamer` keeps two records of one SRD document from sharing a group through those folds alone, and rename lines are suppressed when the names differ only by those folds (owner rulings 2026-10-30). What follows was the gap before that fix and still holds for the rest: SRD 5.1 and 5.2 name much equipment differently on Open5e (154 of 499 srd-2014 magic items and 113 of 237 srd-2014 items have no 2024 twin by name: "Flame Tongue (Longsword)" / "Flame Tongue Longsword", "Belt of Fire Giant Strength" / "Belt of Giant Strength (Fire)", "Crossbow, hand" / "Hand Crossbow", "Antitoxin (Vial)"), giving false reason lines on gets and near-duplicate `[2014]` lines in 2024 searches. The remaining names are one-to-many or edition-only and stay unpaired by design.

### Characters (`src/tools/character/*`) — phase 5

- Classify every entry at the [paths above](#character-json-paths-verified-on-live-characters) with `classifyEdition`.
- **A class's ruleset** comes from its base class definition. A subclass with a different ruleset is tagged on its own.
- **Main edition:**
  - Only classes classified 2024 or 2014 count.
  - If none qualify (all homebrew/third-party/…), the main edition is `unstated`.
  - If the counted classes span both editions, the character is `mixed`, and 2024 is the main edition for tagging.
- **`characterRulesLine`** (in `src/edition.ts`) grammar. Entries are named in the order given, except spells and items, which are counted (`8 spells`, `1 item`) after the named entries of their group, spells first:
  - `Rules: 2024` (no minority content)
  - `Rules: 2024 · 2014 content: Criminal / Spy (background), Sharpshooter (feat)`
  - `Rules: 2024 · 2014 content: Grave Domain (XGtE) (subclass), Fierna Tiefling (species), Noble (background), 8 spells, 27 items · homebrew: Spelldriver (feat), Survivalist (feat) · edition not stated: 2 items` (Calderax Greycastle, live 2026-10-23)
  - `Rules: mixed — 2024: Bard 5 · 2014: Ranger 3`, followed by `· 2014 content: …` for non-class entries
  - Non-edition entries add a group per ruleset: `· homebrew: Blood Hunter 2 (class) · third-party: Firearm Specialist (feat)`
  - `Rules: edition not stated` when the main edition is `unstated`. Every entry is then tagged inline, but entries that are themselves "edition not stated" are not listed (the head says so). The other groups follow the head in the same form: `Rules: edition not stated · 2024 content: Mountain Dwarf (species), Soldier (background), Great Weapon Master (feat), Action Surge (feat) · homebrew: Blood Hunter 5 (class)`.
- **Inline tags:** entries whose ruleset differs from the main edition. Non-edition entries are always tagged.
- **Consumers:**
  - `parse.ts` adds the summary line to every section output.
  - `ddb_get_party` shows each member's summary line.
  - **`src/tools/character/definition.ts`** (`ddb_character_lookup`, which formats on its own and never calls `parseCharacterData`) adds the entry's rules line to each single-hit result and the tag to each line of the >3-hit list. These are character content: no `rules_edition`, no twin selection.
- **Fixtures:** `tests/fixtures/character-fixtures.ts` currently has no `isLegacy`/`sources`. Phase 5 adds them for the three test characters below.
- **Snapshots:** the committed character snapshots (`tests/__snapshots__/character-snapshot.test.ts.snap`) **will change**. Update them deliberately, run `scripts/snapshot-live-characters.mts` before and after per `docs/character-refactor.md`, and have the owner review the diff. (Decision 12 below: the review gates the push, not each commit; the owner approved the cumulative snapshot and live diff on 2026-10-23.)

**Rulings in the plan** ([plan](../plans/2026-10-22-rules-edition-phase-5-characters-library.md); where they differ from the bullets above, they win):

1. **Dual-edition definitions match either edition on a character** (owner decision 2026-10-22). Live, standard weapons, armour and some magic items are one non-Legacy definition listing a 2024 and a 2014 book (Dagger, Shield, Leather, Studded Leather `[148, 1]`; Ring of Protection `[146, 1, 148]`), which `classifyEdition` calls 2024. Read literally, the spec would label 13 of 15 live characters with false lines such as `2024 content: Leather (item), Dagger (item), Shortbow (item)`. When the main edition is 2024 or 2014, a definition with `isHomebrew !== true`, `isLegacy !== true` and at least one source in each edition's category classifies as the main edition, with that edition's first source as its book: neither tagged nor listed, and a lookup shows that book (`Rules: 2014 · Basic Rules (2014)` for a Dagger on a 2014 character). Unstated main edition: plain `classifyEdition`. Catalog tools are unchanged by this ruling, but the same dual-definition idea reached them later as the catalog rule below (owner decision 4, option B, 2026-10-28/29).
2. **The summary line counts spells and items and names everything else** (owner decision 2026-10-22). Legacy mundane gear (`isLegacy`, `[1, 2]`: Bedroll, Torch) is really 2014 and numerous: Calderax (a 2024 Cleric) has 27 such items and 8 2014 spells, so naming each gave a line of about 960 characters. Within a ruleset group: named entries, then `N spells`, then `N items`. The inline tags name each one.
3. **A subclass is tagged, and listed, only when its ruleset differs from its own class's.** Otherwise it inherits the class's tag, including a non-edition one (`Blood Hunter [homebrew] (Order of the Lycan) 2`). A subclass that differs from its class is tagged even when it matches the main edition (`Ranger [2014] (Gloom Stalker [2024]) 3`), but the summary lists it only when it differs from the main edition. A null subclass is skipped.
4. **Only what the sheet shows is classified and counted:** every `char.feats` entry except `__INITIAL_ASI` (real feats and the `__DISGUISE_FEAT` entries in OTHER FEATURES, which can be third-party), the spells the SPELLS section lists, deduped by definition id, and the items it prints (every non-weapon plus equipped weapons), deduped by definition id. Ids missing: dedupe by name. The count follows the SPELLS section's `SOURCE_LABELS` keys, while the CONCENTRATION SPELLS block keeps reading every `char.spells` key (owner decision 2026-10-22; no live character has a key outside `SOURCE_LABELS`). Class features and racial traits are not classified (no sources of their own).
5. **Placement.** The summary line goes on the line after the name, in the header box, on every section. Inline tags go right after the entry's name (the species tag after the whole decorated race string, `Elf (Wood Elf) [2014]`; header class, subclass and background; FEATS and OTHER FEATURES; spell names including duplicate warnings and CONCENTRATION SPELLS; EQUIPPED and INVENTORY; weapon attack lines, where the tag is padded with the name).
6. **`ddb_character_lookup`** tags every list line with `editionTag` and gives every full hit a `rulesLine` under its first line, from the same `CharacterEditions.info()` (decision 1 applies). Class and subclass features take the owning class's or subclass's definition, racial traits the species, the background feature the background. No reason lines.
7. **Library join** — see "Library — phase 5".
8. **`ddb_list_library` stays JSON** with `"edition": "[2024]"` per book; `ddb_read_book` prints `rulesLine(info)` between its title and the `URL:` line.
9. **The source index is passed in.** `parseCharacterData(raw, sections, index = peekSourceIndex())` stays synchronous; `parseCharacter`, `getParty` (once per party) and `getDefinition` pass `await getSourceIndex()`, which never rejects and covers a logged-out public character.
10. **Carry-over (c) is closed by the header tags.** `ddb_get_party` prints `summary`, whose header tags the classes, subclass, species and background; the head `Rules: edition not stated` already covers unstated feats, spells and items.
11. **Class definitions always classify with plain `classifyEdition`** (main edition, summary entries, header tags). Decision 1 never re-labels a class.
12. **The snapshot review gates the push, not each commit.** The plan commits per task with `npm test` green; the owner reviewed the cumulative snapshot and live diff in Task 6 (approved 2026-10-23) before anything was pushed.
13. **Main-edition text reconciled to the code.** The spec said both "the highest level wins, and a tie goes to 2024" and "spanning both editions is mixed, with 2024 the main edition"; `characterMainEdition` (phase 1, tested) implements the second, which makes the first unreachable. The "highest level" sentence is removed.

Owner rulings made while executing the plan (2026-10-22/23):

- **Task 2 example (C1):** a homebrew-class character's line is `Rules: edition not stated · 2024 content: Mountain Dwarf (species), Soldier (background), Great Weapon Master (feat), Action Surge (feat) · homebrew: Blood Hunter 5 (class)`. Action Surge is a `__DISGUISE_FEAT` sourced 145 and is classified per decision 4.
- **Robustness:** `entrySourceIds` ignores a non-array `sources`; nameless species, background and subclass entries are not listed in the Rules line; nameless spells and items are not counted. The printed sheet keeps its pre-existing empty slots for nameless class spells, items and weapons (count-only fix).
- **`CharacterEditions.named(name, def)`** is the one name-plus-tag helper used by features, spells, inventory and weapons. Tests pin short tagged weapon padding, tagged consolidation (`Dagger [2014] ×2`) and same-name entries of different editions staying separate.
- **`ddb_character_lookup`:** a spell's name falls back to the entry's `name` when its definition has none (then "Unknown"), and lookup reads `classSpells[].classSpells` as the sheet does (it read only `spells` before).
- **Library:** the slug-fallback library fetch keeps `sessionFetch`'s retry and backoff (owner left the delay as is).
- **Live check 2026-10-23:** all 15 characters differ from the phase-start code only by Rules lines and tags (one weapon line's padding includes its tag). A Monk's action order changed between dumps because D&D Beyond reordered the data; the base code reproduces it.

### Library — phase 5

- **Joining a library book to its game-config source:** compare a path segment of the library slug (`dnd/phb-2024` → `phb-2024`) with the last segment of the source's `sourceURL` (`sources/dnd/phb-2024` → `phb-2024`). The rulings below say which segment: they are tried right to left, so a chapter path joins on its book segment.
- If that fails, compare the normalized title with the normalized `description` or the book label (rulings below).
- If both fail, the book is `unstated`.
- `ddb_list_library` tags each book. `ddb_read_book` puts a rules line under the title.

**Rulings in the plan** (decision 7 of the plan; it wins over the bullets above):

- **Step (a), slug.** The slug's *non-empty* path segments are tried right to left, each against the last non-empty segment of a source's `sourceURL`; the first segment with any candidate decides the step (a pick, or a disagreement that falls through to step (b); later segments are not tried), so `dnd/phb-2024/creating-a-character` joins on `phb-2024`. A slug or `sourceURL` with no non-empty segment (`""`, null) never matches: 57 of 314 sources have `sourceURL: ""`, and a library entry whose path isn't under `/sources/` gets `slug: ""`, so `"" === ""` would have labelled slug-less books.
- **Shared slugs.** Four paths are shared by several ids (`basic-rules-2014` = 1 [category 26] + 209, 210, 212 [Hidden Sources]; likewise `br-2024`, `paitm`, `ddbd`). Within a step the candidates are classified with `classifyEdition({ sourceId })`: if the non-`unstated` candidates share one ruleset, the lowest id among them wins (`basic-rules-2014` → 1); with no non-`unstated` candidate, the lowest id; if they disagree, the step fails.
- **Step (b), title.** The normalized title (`normalizeName`) equals a source's normalized decoded description **or its book label** (`Player's Handbook (2024)`), which goes beyond the spec's "description". A title matching books of both editions gives `unstated`, not a guess.
- **Both fail:** `{ ruleset: "unstated", book: null }`.
- **`ddb_read_book`** given a slug runs (a). Only when that fails and no title is known does it fetch the library list once, take the title of the library book whose slug equals the path or is a leading path prefix of it (the longest match wins; books with an empty slug are skipped), and run (b) (owner decision 2026-10-22). A slug missing from the library, or a failed library fetch, leaves the book "edition not stated" without failing the read.
- **Live 2026-10-23:** the owner's 8 free or shared books join 8 of 8 by slug (`basic-rules-2014` → 1, `br-2024` → 148, `ua` → 100, `lmop` → 8, `mcv1` → 89, `sac` → 53, `sae` → 166, `wa` → 62). Paid books are unverified: the account owns none.

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

**Touches:** `src/tools/reference.ts` (spells), new `src/tools/spell-store.ts`, `src/tools/character/spells.ts`, `src/tools/monster.ts`, `src/tools/encounter.ts`, `src/tools/treasure.ts`, `src/open5e.ts` (interim labels, relocated monster-stats fetch), `src/game-config.ts` (failure cache), `src/index.ts` → `src/server.ts` (params, descriptions, server instructions; `index.ts` keeps the entrypoint), `scripts/diagnose-compendium.mjs`, tests including the new `tests/rules-edition-consistency.test.ts`.

**Done when:**
- `ddb_get_spell "Sleep"` gives 2024 by default and 2014 with `rules_edition: "2014"`, each with the right rules line. "Acid Arrow" resolves through the rename table when the pair was committed.
- The concentration tests pass for all nine changed spells: a character's own definition wins over the compendium's other edition.
- `diagnose-compendium.mjs` replays the **id-keyed** build and reports, per content endpoint, total / 2024-only / 2014-only / both / non-edition / **lost**. Lost means definitions dropped for a missing `id` or `name`, or ids present in a response but absent from the store, and it must be 0.
- Monster tests are migrated from `preferLegacy` to `rules_edition` and pass. New tests cover:
  - the ambiguity result in both encounter and treasure output;
  - the `source` note on get and search;
  - search twin hiding with and without `source`;
  - a locked pick yielding to its owned twin, both twins locked, and no swap under `source`.
- A failed game-config fetch is not repeated within 60 s in the same session.
- `ddb_rate_encounter`, `ddb_encounter_cr` and `ddb_roll_treasure` output a rules line. Treasure also gives the reason line on `"2014"`.
- Every Open5e output carries the interim 2014 label.
- **The consistency test is in place.** It enumerates tools from the server's `tools/list` whose input schema has `rules_edition`, so a new tool can't escape it. For each one, using fixtures, it asserts:
  - single lookups have a `Rules:` line;
  - every search result line has a tag after the name;
  - error/not-found strings are exempt.
- CLAUDE.md: work items 1 and 3 are marked done, and the stateless-safe plan's Task 4 is marked unblocked.

### Phase 3: equipment and character options

**Touches:** `src/tools/reference.ts` (items, races, classes, backgrounds, feats, class features, racial traits), `src/tools/search.ts`, `src/server.ts` (registrations), new `src/tools/edition-search.ts` and `src/source-filter.ts`, `src/edition.ts`, tests.

**Done when:**
- Every tool in the phase-3 rows of the tool contract has the param, header, tags, pipeline and footer, with tests per tool, and passes the consistency test.
- Studded Leather (`[br-2024, BR]`, `isLegacy: false`) classifies as 2024.
- `ddb_search_site` shows one header and one combined footer.

### Phase 4: Open5e v2, rules and conditions (done 2026-10-21)

**Touches:** `src/open5e.ts`, new `src/tools/conditions.ts`, `src/tools/reference.ts` (rules and fallback call sites), `src/tools/monster.ts` (fallback call sites), `src/edition.ts` (Open5e search header, rules reasons), `src/edition-renames.ts` (`OPEN5E_ARMOUR_RENAMES`), `src/server.ts` (registrations), `scripts/check-conditions.mts`, README (attribution), tests and recorded v2 fixtures for both SRDs.

**Done when:**
- The per-endpoint filter tests are committed and pass.
- All fallbacks use v2, load both SRD documents and select between them together (ruling 2 under "Rulings in the plan"), and carry the final fallback labels.
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
  - Task 2 (`server.tool` → `registerTool`) waits until phase 5 is done, because all five phases edit the registrations (in `src/server.ts` from phase 2).
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
- **Rename table gaps:** an unlisted rename shows both names, each correctly labelled. The 2014 one also gets "no 2024 version found", which is misleading but visible. The fix is a table entry.
- **Open5e v2 shape changes:** phase 4 records fixtures. A shape change fails tests rather than silently mislabelling.
- **Output length:** per-line tags and headers add a few tokens per search. Character sheets tag only minority-edition entries to limit this.
