# Rules Edition Phase 2 (Spells, Monsters, Encounter, Treasure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spells and monsters return 2024 by default and 2014 on request, every answer says which ruleset it is, ambiguous partial monster names are reported rather than guessed, and every Open5e fallback is labelled.

**Architecture:** Phase 1's pure `src/edition.ts` does all classification, twin selection and label text. This phase wires it into the tools. The spell compendium becomes an id-keyed store, so both editions survive the merge. Monster selection moves from `rankCandidates`' `preferLegacy` key to `selectByEdition` with `monsterTiebreak`. `getMonsterStats` returns a tagged union (`found` / `not-found` / `ambiguous`) that encounter and treasure render. A cross-tool consistency test lists the server's tools and checks every tool that takes `rules_edition`.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), `@modelcontextprotocol/sdk` 1.32 (`McpServer`, `Client`, `InMemoryTransport`), zod, vitest.

**Spec:** [docs/superpowers/specs/2026-10-16-rules-edition-design.md](../specs/2026-10-16-rules-edition-design.md). Read its Principle, Vocabulary and labels, The edition module, Tool contract, the Spells/Monsters/Interim Open5e sections, and Phase 2 before starting. The real phase-1 signatures are in `src/edition.ts` and in the "Signatures that differ from the spec's sketch" table of [the phase-1 plan](2026-10-16-rules-edition-phase-1-foundation.md).

## Global Constraints

- The param is exactly `rules_edition: z.enum(["2024", "2014"]).default("2024")`. Never `edition` or any other spelling. Internally it is `rulesEdition: RulesEdition` (from `src/edition.ts`).
- No tool builds edition text. Every `Rules:` line, tag, header, footer, reason, rename line, source note, ambiguity message, tool-description sentence and the server instructions come from `src/edition.ts`. New wording goes there, with an exact-string test in `tests/edition.test.ts`.
- Error, not-found and login-required messages carry no edition label.
- The spell compendium still makes exactly the existing 16 requests (`/game-data/spells` and `/game-data/always-known-spells`, `classLevel=20`, classes 1–8). No new endpoints.
- New spell cache key: `"spell-compendium-v2"`. Old `"spell-compendium"` entries are never read.
- Homebrew output stays wrapped in `wrapUntrusted` exactly as today (monster search lines and stat blocks unless `isHomebrew === false`).
- `getMonsterStats` never guesses: no fuzzy fallback, homebrew skipped, on both the DDB and Open5e paths.
- The committed character snapshots (`tests/__snapshots__/character-snapshot.test.ts.snap`) must not change in this phase. If they do, the concentration change is wrong.
- No new dependencies. `@types/node` stays `^22`.
- Every task ends green on `npm run typecheck && npm run lint && npm test`.
- Commits go straight to `main`. Stage files by name, never `git add -A` / `git add .`: the working tree holds owner WIP (`docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md`, a deleted `2026-09-16-security-remediation.md`, an edited phase-1 plan) that must not be committed. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Every monster in an encounter or treasure request is ambiguous.** `rateEncounter` today returns only "No valid monsters provided…", so the user would never see which names were ambiguous. Expected: that message plus each ambiguity line. Test in Task 4.
2. **A game-data spell entry with no numeric `id`, no `name`, or a null `definition`.** Expected: the store skips it and counts it as dropped. It must not crash the build or collide with id 0. Test in Task 2.
3. **A rename-alias query fails while the typed name's query succeeds** (e.g. `getMonsterStats("Tough")` when the `search=Thug` request returns 500). Expected: the alias contributes nothing and the lookup still finds Tough. Only a failure of the typed name's own query fails the lookup. Test in Task 4.
4. **Treasure output under a tight `maxOutputChars`.** Expected: the new rules/reason lines are always present, like the coin trailer, and the output still never exceeds the budget. Test in Task 4.
5. **Spell search pagination after twin hiding.** Expected: the "showing 1–20 of N" total counts the list after hiding, and the footer counts hidden twins across the whole result set, not just the page shown. Test in Task 3.
6. **The requested edition's monster is locked to the account, the other edition isn't.** Live (2026-10-17, 55 of 440 twin groups sampled): about 1 in 55, e.g. Twig Blight, whose 2024 entry is an `accessType 4` placeholder while the 2014 one is owned. Expected: `ddb_get_monster` (no `source`) shows the owned twin with the `locked-…` reason. Both locked → today's Open5e fallback, then the restricted block. With `source` → the restricted block, never a swap. Test in Task 5.
7. **D&D Beyond's game config fails while the spell compendium is cached.** Each failed fetch costs about 7 s (3 retries at 1 s, 2 s, 4 s on a 5xx). Expected: one failed fetch per 60 s per session, not one per tool call. Test in Task 2.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/open5e.ts` | Modify (T1) | Every `o5*` output labelled `Rules: 2014 · SRD 5.1 (Open5e fallback — …)` or tagged `[2014]`. Gains `o5GetMonsterStats` (moved from `monster.ts`) |
| `src/tools/spell-store.ts` | Create (T2) | Pure id-keyed spell store: `SpellDefinition`, `DdbSpell`, `SpellStore`, `createSpellStore`, `addSpells`, `spellList` |
| `src/game-config.ts` | Modify (T2) | `peekSourceIndex()` (sync), and a 60 s failure cache in `getGameConfig()` |
| `src/edition.ts` | Modify (T3–T6) | "found" reason/header wording (T3), `RULES_EDITION_TOOL_NOTE` (T3), `DMG_SOURCE_ID` (T4), `locked-2024`/`locked-2014` reasons (T5), `SERVER_INSTRUCTIONS` (T6) |
| `src/tools/reference.ts` | Modify (T1–T3) | Spell compendium on the store, concentration by definition, `getSpell`/`searchSpells` with `rulesEdition`. Open5e origins for every fallback call |
| `src/tools/character/spells.ts` | Modify (T2) | `buildConcentrationByLevel` passes the definition to `isConcentrationSpell` |
| `src/tools/monster.ts` | Modify (T1, T4, T5) | `fetchCandidates` (twin aliases), `getMonsterStats` union, then `getMonster`/`searchMonsters` with `rulesEdition`, source resolution through the source index |
| `src/tools/encounter.ts` | Modify (T4) | Rules line, tagged monster lines, ambiguity lines |
| `src/tools/treasure.ts` | Modify (T4) | `rulesEdition` input, rules (+ reason) line, tagged names, ambiguity lines |
| `src/server.ts` | Create by `git mv` from `src/index.ts` (T6) | Every tool registration and `export const server`, with `instructions` |
| `src/index.ts` | Modify (T3–T5), then recreate (T6) | Tool params/descriptions (T3–T5). From T6: shebang, stdio transport, shutdown, `main()` only |
| `scripts/diagnose-compendium.mjs` | Modify (T2) | Replays the id-keyed build, reports per-endpoint edition counts and **lost** |
| `tests/fixtures/spell-service.ts` | Create (T2) | Shared spell-service fixtures moved out of `spell-compendium-endpoints.test.ts` |
| `tests/open5e.test.ts` | Create (T1) | Interim labels and `o5GetMonsterStats` |
| `tests/spell-store.test.ts`, `tests/spell-concentration.test.ts` | Create (T2) | Store and concentration precedence |
| `tests/spell-editions.test.ts` | Create (T3) | Spell tools under both editions |
| `tests/rules-edition-consistency.test.ts` | Create (T6) | Cross-tool label check driven by `tools/list` |
| Existing tests | Modify | `monster.test.ts`, `monster-session.test.ts`, `treasure.test.ts`, `encounter.test.ts`, `spell-compendium-endpoints.test.ts`, `session-consumers.test.ts`, `game-config.test.ts`, `edition.test.ts` |
| `CLAUDE.md`, `README.md`, the spec's status line | Modify (T2–T6) | Docs |

---

### Task 1: Interim Open5e labels and the relocated monster-stats fetch

**Files:**
- Modify: `src/open5e.ts`, `src/tools/reference.ts` (every `o5*` call site), `src/tools/monster.ts` (every `o5*` call site; delete the inline Open5e fetch and `CR_XP_O5` / `CR_VALUE_O5`)
- Create: `tests/open5e.test.ts`
- Modify: `tests/monster.test.ts`, `tests/monster-session.test.ts` (add `o5GetMonsterStats` to their `vi.mock("../src/open5e.js")` factories)

**Interfaces:**
- Consumes: `rulesLine`, `editionTag`, `searchHeader`, `type Open5eOrigin`, `type EditionInfo` from `src/edition.ts`.
- Produces:
  - Every exported `o5*` lookup/search function takes a trailing **required** `origin: Open5eOrigin`. Optional leading params become `name: string | undefined`. Full list: `o5SearchSpells(params, origin)`, `o5GetSpell(name, origin)`, `o5SearchMonsters(params, origin)`, `o5GetMonster(name, origin)`, `o5SearchItems(name, origin)`, `o5GetItem(name, origin)`, `o5SearchWeapons(params, origin)`, `o5GetWeapon(name, origin)`, `o5SearchArmor(params, origin)`, `o5GetArmor(name, origin)`, `o5SearchRaces(name, origin)`, `o5GetRace(name, origin)`, `o5SearchClasses(name, origin)`, `o5SearchBackgrounds(name, origin)`, `o5SearchFeats(name, origin)`. `o5SearchSections` and `o5GetSection` keep their signatures and are always `"primary"`.
  - `o5GetMonsterStats(name: string): Promise<{ name: string; crValue: number; xp: number } | null>`.

Output rules (all in `open5e.ts`; `O5_INFO: EditionInfo = { ruleset: "2014", book: null }`):
- **Single lookup:** line 1 is the existing title line, line 2 is `rulesLine(O5_INFO, { open5e: origin })`, then the rest. The `SRC` constant and every `SRC` suffix are deleted.
- **Search:** line 1 is `rulesLine(O5_INFO, { open5e: origin })`, then the existing `Found N …` heading, then result lines with `editionTag(O5_INFO)` immediately after the name, e.g. `• Fireball [2014] (Level 3 Evocation)`, `• Goblin [2014] (CR 1/4, Small humanoid)`. A single-result search that returns the single-lookup format (races, classes, backgrounds, feats) gets the single-lookup label.
- **Rules sections:** `o5GetSection` → `## Name`, then `rulesLine(O5_INFO, { open5e: "primary" })` (= `Rules: 2014 · SRD 5.1`), then the text. `o5SearchSections` → line 1 `searchHeader({ rulesDoc: "2014" })`, then today's output without `SRC`. No per-line tags (rules are not twin-grouped).
- **No-results strings** (`No spells found … (SRD only).` etc.) are unchanged.

A 2024 request answered from Open5e gets no reason line: the `(Open5e fallback — …)` suffix on a `Rules: 2014` line is the reason until phase 4 moves the fallback to SRD 5.2 (spec §Interim Open5e labels).

Origin rule for callers: inside a `catch`, or on a logged-out (`!hasValidSession()`) branch, pass `"unavailable"`. After D&D Beyond answered with no match, pass `"not-found"`. The monster restricted-block fallback (`accessType === 4`, no source) passes `"unavailable"`, because D&D Beyond holds the creature but not for this account. `getItem`'s `[o5GetItem, o5GetWeapon, o5GetArmor]` loop passes its origin to each.

- [ ] **Step 1: Write the failing tests** in `tests/open5e.test.ts`.

Stub global `fetch` (`vi.stubGlobal`) with a router that returns one result per path: `/spells/` → a Fireball `O5Spell`, `/monsters/` → a Goblin (`challenge_rating: "1/4"`), `/magicitems/`, `/weapons/`, `/armor/`, `/races/` (two results), `/classes/` (two), `/backgrounds/` (two), `/feats/` (two), and `/sections/` → one section. Call `clearOpen5eCache()` in `beforeEach`.

```ts
const UNAVAILABLE = "Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)";
const NOT_FOUND = "Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)";
const TAGGED = /^• [^[\n]+? \[2014\]/;

it.each([
  ["o5GetSpell", () => o5GetSpell("Fireball", "unavailable"), UNAVAILABLE],
  ["o5GetMonster", () => o5GetMonster("Goblin", "not-found"), NOT_FOUND],
  ["o5GetItem", () => o5GetItem("Bag of Holding", "unavailable"), UNAVAILABLE],
  ["o5GetWeapon", () => o5GetWeapon("Longsword", "unavailable"), UNAVAILABLE],
  ["o5GetArmor", () => o5GetArmor("Chain Mail", "unavailable"), UNAVAILABLE],
  ["o5GetRace", () => o5GetRace("Dwarf", "unavailable"), UNAVAILABLE],
])("%s puts the rules line under the title", async (_n, call, expected) => {
  const out = (await call())!;
  expect(out.split("\n")[1]).toBe(expected);
  expect(out).not.toContain("Source: SRD 5.1 via Open5e");
});

it.each([
  ["o5SearchSpells", () => o5SearchSpells({ name: "fire" }, "unavailable")],
  ["o5SearchMonsters", () => o5SearchMonsters({ name: "gob" }, "unavailable")],
  ["o5SearchItems", () => o5SearchItems("bag", "unavailable")],
  ["o5SearchWeapons", () => o5SearchWeapons({ name: "sword" }, "unavailable")],
  ["o5SearchArmor", () => o5SearchArmor({ name: "mail" }, "unavailable")],
  ["o5SearchRaces", () => o5SearchRaces(undefined, "unavailable")],
  ["o5SearchClasses", () => o5SearchClasses(undefined, "unavailable")],
  ["o5SearchBackgrounds", () => o5SearchBackgrounds(undefined, "unavailable")],
  ["o5SearchFeats", () => o5SearchFeats(undefined, "unavailable")],
])("%s opens with the rules line and tags every result line", async (_n, call) => {
  const lines = (await call()).split("\n");
  expect(lines[0]).toBe(UNAVAILABLE);
  const results = lines.filter(l => l.startsWith("• "));
  expect(results.length).toBeGreaterThan(0);
  for (const l of results) expect(l).toMatch(TAGGED);
});

it("rules sections are labelled as the primary source", async () => {
  expect((await o5GetSection("Combat"))!.split("\n")[1]).toBe("Rules: 2014 · SRD 5.1");
  expect((await o5SearchSections("combat")).split("\n")[0]).toBe("Rules: sections from SRD 5.1 (2014).");
});

it("a not-found search keeps its plain message", async () => { /* router returns { count: 0, results: [] } */
  expect(await o5SearchSpells({ name: "zzz" }, "not-found")).toBe("No spells found matching the criteria (SRD only).");
});

describe("o5GetMonsterStats", () => {
  it("returns CR and XP for an exact name, ignoring case and curly apostrophes", async () => { /* result name "wolf", "1/4" */
    expect(await o5GetMonsterStats("Wolf")).toEqual({ name: "wolf", crValue: 0.25, xp: 50 });
  });
  it("ignores a result whose name differs", async () => { /* result "Wolf" for query "Wolf Lord" */
    expect(await o5GetMonsterStats("Wolf Lord")).toBeNull();
  });
  it("returns null when Open5e fails", async () => { /* fetch rejects */
    expect(await o5GetMonsterStats("Wolf")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/open5e.test.ts`
Expected: FAIL (wrong second line / `o5GetMonsterStats` is not exported).

- [ ] **Step 3: Implement the labels and `o5GetMonsterStats` in `src/open5e.ts`**

`o5GetMonsterStats` keeps today's query (`/monsters/?name=…&limit=5`, v1, phase 4 migrates it) and today's exact-name rule (`trim`, lowercase, `[‘’]` → `'`). It takes the CR→XP and fraction tables from `monster.ts` and returns `null` on any error.

- [ ] **Step 4: Update every caller to pass an origin**

In `reference.ts` and `monster.ts`, apply the origin rule above. In `monster.ts`, the Open5e branch of `getMonsterStats` becomes a call to `o5GetMonsterStats(name)`, and its return shape is unchanged in this task. In `withSourceCaveat`, delete the trailing sentence "This may not be the requested edition.", because the rules line now names the edition.

- [ ] **Step 5: Update the monster test mocks**

Add `o5GetMonsterStats: vi.fn(async () => null)` to the open5e mock in `tests/monster.test.ts` and `tests/monster-session.test.ts`. Replace the two `second-round review follow-ups` tests that stub global `fetch` for Open5e stats ("ignores an Open5e result whose name doesn't match", "still takes an exact Open5e match when DDB is unavailable") with one test: logged out, `o5GetMonsterStats` resolves `{ name: "wolf", crValue: 0.25, xp: 50 }`, and `getMonsterStats("Wolf")` returns it. The name-matching cases now live in `tests/open5e.test.ts`. Existing `toHaveBeenCalledWith` assertions on `o5GetMonster`/`o5SearchMonsters` gain the origin argument.

- [ ] **Step 6: Run the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/open5e.ts src/tools/reference.ts src/tools/monster.ts tests/open5e.test.ts tests/monster.test.ts tests/monster-session.test.ts
git commit -m "feat(open5e): label every Open5e fallback with its interim 2014 ruleset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Id-keyed spell store and concentration by definition

**Files:**
- Create: `src/tools/spell-store.ts`, `tests/spell-store.test.ts`, `tests/spell-concentration.test.ts`, `tests/fixtures/spell-service.ts`
- Modify: `src/tools/reference.ts` (spell section), `src/game-config.ts`, `src/tools/character/spells.ts`, `scripts/diagnose-compendium.mjs`, `tests/spell-compendium-endpoints.test.ts`, `tests/session-consumers.test.ts`, `tests/game-config.test.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `twinName`, `classifyEdition`, `selectByEdition`, `definitionTiebreak`, `isEdition`, `buildSourceIndex` from `src/edition.ts`; `SNAPSHOT_SOURCES`/`SNAPSHOT_CATEGORIES`.
- Produces:
  - `src/tools/spell-store.ts`:
    - `interface SpellDefinition` = today's fields plus `id: number; isLegacy?: boolean | null; isHomebrew?: boolean | null; sources?: Array<{ sourceId: number }> | null` (moved here from `reference.ts`)
    - `interface DdbSpell { definition: SpellDefinition }`
    - `interface SpellStore { byId: Map<number, DdbSpell>; byTwin: Map<string, number[]> }`. `byTwin` is keyed by `twinName(definition.name)`, with ids in insertion order.
    - `createSpellStore(): SpellStore`
    - `addSpells(store: SpellStore, spells: Iterable<unknown>): number`. Adds each entry whose `definition` is an object with a finite numeric `id` and a non-empty string `name`. The first occurrence of an id wins. Returns how many entries it dropped for a missing `definition`, `id` or `name`.
    - `spellList(store: SpellStore): DdbSpell[]`, in insertion order.
  - `src/game-config.ts`: `peekSourceIndex(): SourceIndex`. Synchronous: the cached index if one is built, else a memoized snapshot-only index. It never fetches and never checks the session. Source data isn't account-specific, so this is safe.
  - `src/game-config.ts`: a failure cache in `getGameConfig()`, `CONFIG_FAILURE_TTL_MS = 60_000` (module-private). Today a failed fetch is never cached, so every caller re-fetches, and a 5xx costs about 7 s of retries each time. Task 3 adds a `getSourceIndex()` call to every spell lookup and search, which would pay that on every call while the compendium is still cached. Rules:
    - Any `null` outcome (non-OK response, missing `challengeRatings`, a thrown fetch) records `{ until: Date.now() + CONFIG_FAILURE_TTL_MS, generation: snapshot.generation }`, but only after `assertSessionCurrent(snapshot)` passes, as the success path does. A late failure from an old session must not suppress the new session's fetch.
    - While a record for the current generation is unexpired, `getGameConfig()` returns `null` without fetching. The check sits after `captureSession()`, beside today's early return.
    - The existing `onSessionInvalidated` hook clears the record. A success clears it too.
    - `getSourceIndex()` is unchanged: on a `null` config it already serves the snapshot index from its own cache.
  - `src/tools/reference.ts`: `isConcentrationSpell(def: Record<string, unknown>): boolean | null`, which replaces the `(spellName)` form. The internal `loadSpellCompendium(): Promise<SpellStore>`. `characterSpellBuffer: Map<number, DdbSpell>`.

Concentration precedence, from spec §Spells:
1. `typeof def.concentration === "boolean"` → return it.
2. Else a numeric `def.id` found in the buffer or the store → that entry's `concentration`.
3. Else the twin group `twinName(def.name)` from the store and the buffer. Run `selectByEdition` with the requested edition set to `classifyEdition(def, peekSourceIndex()).ruleset` when that is 2014/2024, else `"2024"`. Use `definitionTiebreak` on the definitions. Return the selected entry's `concentration`.
4. Else `null`.

`buildConcentrationByLevel` becomes `const isConc = isConcentrationSpell(def) ?? false;`.

- [ ] **Step 1: Move the spell-service fixtures**

Move `COBALT_URL`, `GAME_DATA`, `makeJwt`, `jsonResponse`, `serviceMock` and `spell` from `tests/spell-compendium-endpoints.test.ts` into `tests/fixtures/spell-service.ts` (exported). The `vi.hoisted` fs mock and `beforeEach` stay in each test file. `spell` becomes:

```ts
spell(name: string, level: number, opts?: {
  id?: number; description?: string; concentration?: boolean;
  isLegacy?: boolean; sources?: number[]; school?: string; ritual?: boolean;
})
```

`id` defaults to a deterministic hash of `name` (djb2), so the same name from several class lists is one definition, as it is live. `sources` maps to `[{ sourceId }]`. `serviceMock` keeps answering `api/config/json` with `{}`, which makes the code fall back to the snapshot index. Update the existing calls: the third positional `description` becomes `{ description }`, and the "merges in a fixed order" test gives all three Cure Wounds the same explicit `id: 10`.

- [ ] **Step 2: Write the failing tests**

`tests/spell-store.test.ts`:

```ts
it("keeps both editions of a name, keyed by id, grouped by twin name", () => {
  const store = createSpellStore();
  addSpells(store, [spell("Sleep", 1, { id: 1, isLegacy: true }), spell("Sleep", 1, { id: 2, sources: [145] })]);
  expect([...store.byId.keys()]).toEqual([1, 2]);
  expect(store.byTwin.get("sleep")).toEqual([1, 2]);
});
it("first occurrence of an id wins", () => { /* same id, two descriptions → first description kept */ });
it("groups a renamed pair under the 2024 name", () => { /* "Acid Arrow" + "Melf's Acid Arrow" → byTwin "melf's acid arrow" has both ids */ });
it("drops and counts entries with no definition, id or name", () => {
  const store = createSpellStore();
  const dropped = addSpells(store, [null, {}, { definition: null }, { definition: { name: "X" } },
    { definition: { id: 5 } }, { definition: { id: "7", name: "Y" } }, spell("Ok", 0, { id: 9 })]);
  expect(dropped).toBe(6);
  expect([...store.byId.keys()]).toEqual([9]);
});
```

`tests/spell-concentration.test.ts`. No network: seed the buffer with `addCharacterSpellsToCompendium`, and call `clearReferenceCache()` in `beforeEach`.

```ts
const NINE = ["Divine Favor", "Spiritual Weapon", "Sleep", "True Strike", "Barkskin",
              "Enthrall", "Forcecage", "Animal Shapes", "Magic Weapon"];

it.each(NINE.flatMap(n => [[n, true], [n, false]] as const))(
  "%s: the character's own definition (concentration %s) wins over the other edition", (name, conc) => {
    // Seed the other edition from a different character's classSpells.
    addCharacterSpellsToCompendium({ classSpells: [{ spells: [{ definition:
      { id: 1000, name, level: 1, concentration: !conc, isLegacy: true, sources: [{ sourceId: 2 }] } }] }] });
    // The parsed character holds the 2024 version as a racial grant (not in classSpells).
    const out = parseCharacterData(charWithRaceSpell({ id: 2000, name, level: 1, concentration: conc,
      sources: [{ sourceId: 145 }] }), "concentration");
    expect(out.includes(name)).toBe(conc);
  });

it("without a boolean, the same definition id decides", () => { /* buffer id 7 conc true → isConcentrationSpell({ id: 7, name: "Hex" }) === true */ });
it("without a boolean or a known id, the twin group's entry for the definition's own edition decides", () => {
  // buffer: Barkskin id 1 isLegacy conc true; Barkskin id 2 sources [145] conc false
  expect(isConcentrationSpell({ name: "Barkskin", isLegacy: true })).toBe(true);
  expect(isConcentrationSpell({ name: "Barkskin", sources: [{ sourceId: 145 }] })).toBe(false);
  expect(isConcentrationSpell({ name: "Barkskin" })).toBe(false); // edition not stated → 2024
});
it("returns null for an unknown spell with no boolean", () => {
  expect(isConcentrationSpell({ name: "Nope" })).toBeNull();
});
```

Build `charWithRaceSpell` from `FIGHTER_5` in `tests/fixtures/character-fixtures.ts`, the way `tests/character-parser.test.ts`'s concentration section builds its characters: a Druid class, `classSpells: []`, `spells: { race: [{ definition }], class: [], background: [], feat: [], item: [] }`.

`tests/game-config.test.ts` gains `peekSourceIndex` tests: it returns the snapshot index before any fetch, the merged index after `getSourceIndex()`, and the snapshot index again after a session transition hook fires.

It also gains failure-cache tests (`vi.useFakeTimers()`):
- after a 503, a second `getGameConfig()` within 60 s makes no `sessionFetch` call and returns `null`;
- at 60 s, it fetches again;
- the session-transition hook clears the record, so the next call fetches at once;
- a failure that settles after a session change (`assertSessionCurrent` throws) records nothing;
- a success after the TTL is cached as today.

`tests/session-consumers.test.ts`: the two buffer tests seed `{ id: 900, name: "Hex", concentration: true }` (and `{ id: 901, name: "Bless", … }`) and query `isConcentrationSpell({ id: 900, name: "Hex" })`. After the transition they expect `null`.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/spell-store.test.ts tests/spell-concentration.test.ts tests/game-config.test.ts tests/session-consumers.test.ts`
Expected: FAIL (module missing, `peekSourceIndex` not exported, the concentration cases fail).

- [ ] **Step 4: Implement `spell-store.ts`, `peekSourceIndex`, the config failure cache, and the store in `reference.ts`**

- `loadSpellCompendium` builds a store from the 16 lists in task order, then the buffer. It throws as today when `byId.size === 0`, and caches `{ source, spells: spellList(store) }` under `"spell-compendium-v2"`. Delete the bare-array compatibility branch.
- `addCharacterSpellsToCompendium` keys the buffer by `definition.id`, skips entries with no numeric id, and merges into a loaded store with `addSpells`.
- `searchSpells`/`getSpell` iterate `spellList(store)` for now. Task 3 replaces them.
- `clearReferenceCache` nulls the store.

- [ ] **Step 5: Switch `buildConcentrationByLevel` to `isConcentrationSpell(def) ?? false`**, and update the module comment in `spells.ts`.

- [ ] **Step 6: Run the gate, including the snapshot test**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, and `tests/character-snapshot.test.ts` passes with **no** snapshot update.

- [ ] **Step 7: Rewrite the replay in `scripts/diagnose-compendium.mjs`**

It now runs under tsx: change the usage line to `npx tsx scripts/diagnose-compendium.mjs`. Import `createSpellStore`/`addSpells`/`spellList` from `../src/tools/spell-store.js`, `classifyEdition`/`buildSourceIndex`/`twinName` from `../src/edition.js`, and the snapshot. Replace the name-merge replay and its "Edition collisions" section with a table with one row per endpoint (`spells`, `always-known-spells`, each over its 8 class lists) plus a `combined` row in task order. Columns:

`total` (entries received) · `2024-only` / `2014-only` / `both` (twin groups by the editions present) · `non-edition` (definitions classified third-party/homebrew/playtest/unstated) · `lost`

`lost` = `addSpells`' dropped count + ids seen in a response but absent from the store. Keep the concentration report, now per twin group listing each edition's value. Print `LOST: <n>` and `process.exit(1)` when any row's `lost > 0`.

Run: `npx tsx scripts/diagnose-compendium.mjs` (needs a saved login).
Expected: every row's `lost` is `0`, exit code 0. With no session file the script exits early with its existing "no session" message. Record "live diagnose pending: no session" for the commit message.

- [ ] **Step 8: Update `CLAUDE.md`**

- Caching layers → Spells: the id-keyed store under `spell-compendium-v2`, both editions kept, the buffer keyed by id.
- Caching layers → Game config: "a failed or rejected fetch is never cached" becomes "a failed fetch is remembered for 60 s per session (so an outage costs one ~7 s retry run a minute, not one per call); a rejected one is never cached".
- Next steps item 1, phase-2 notes: delete the "every `getSourceIndex()` call re-runs `getGameConfig()`" note.
- Module table: add `src/tools/spell-store.ts`.
- parseCharacterData notes: concentration precedence (own boolean → same id → twin selection by the definition's edition).
- Next steps item 1: replace the "Spell editions collide by name" bullet with "fixed in phase 2 Task 2".

- [ ] **Step 9: Commit**

```bash
git add src/tools/spell-store.ts src/tools/reference.ts src/game-config.ts src/tools/character/spells.ts scripts/diagnose-compendium.mjs tests/fixtures/spell-service.ts tests/spell-store.test.ts tests/spell-concentration.test.ts tests/spell-compendium-endpoints.test.ts tests/session-consumers.test.ts tests/game-config.test.ts CLAUDE.md
git commit -m "feat(spells): keep both editions in an id-keyed compendium; concentration follows the character's own definition

<paste the diagnose script's table, or 'live diagnose pending: no session'>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `rules_edition` on `ddb_get_spell` and `ddb_search_spells`

**Files:**
- Modify: `src/tools/reference.ts` (`getSpell`, `searchSpells`, `formatSpell`), `src/edition.ts`, `src/index.ts`, `tests/edition.test.ts`, `CLAUDE.md`
- Create: `tests/spell-editions.test.ts` (same fs-mock/session `beforeEach` as `spell-compendium-endpoints.test.ts`, fixtures from `tests/fixtures/spell-service.ts`)

**Interfaces:**
- Consumes: `SpellStore`, `spellList` (Task 2); `getSourceIndex`; `lookupByName`, `groupAndSelect`, `classifyEdition`, `definitionTiebreak`, `twinName`, `normalizeName`, `rulesLine`, `renameLine`, `editionTag`, `searchHeader`, `searchFooter` from `src/edition.ts`.
- Produces:
  - `getSpell(spellName: string, rulesEdition: RulesEdition = "2024"): Promise<string>`
  - `searchSpells(params: { name?; level?; school?; concentration?; ritual?; limit?; offset?; rulesEdition?: RulesEdition }): Promise<string>`, defaulting to `"2024"`
  - `src/edition.ts`: `export const RULES_EDITION_TOOL_NOTE = "Returns 2024 content by default; set rules_edition to '2014' for 2014 rules. The 'Rules:' line or [tag] in the output names the ruleset."`
  - `src/index.ts`: `const RULES_EDITION_PARAM = z.enum(["2024", "2014"]).default("2024").describe("Ruleset: '2024' (default) or '2014'.")`, reused by Tasks 4–5.
  - `src/edition.ts` wording change (owner decision 2026-10-17, spec §Label formats). "exists" becomes "found", because D&D Beyond leaves locked content out of the account's lists, so "doesn't exist" can't be proved. Live, Feeblemind's 2024 version (Befuddlement) is missing from this account's spell lists. The new strings:
    - `no-2024-version`: `(no 2024 version found — 2014 text shown)`
    - `no-2014-version`: `(no 2014 version found — 2024 text shown)`
    - `searchHeader({ requested: "2024" })`: `Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: "2014" for 2014 versions.`
    - `searchHeader({ requested: "2014" })`: `Rules: 2014 requested — 2024 entries appear only where no 2014 version was found.`
    - `treasure-no-2014` keeps "exists": no 2014 treasure tables exist in this server.

    Update the four pins in `tests/edition.test.ts` (the `rulesLine` reason cases and the two `searchHeader` cases).

Behaviour:
- `getSpell`: `const index = await getSourceIndex()`. Call `lookupByName(spellList(store), name, rulesEdition, { name: s => s.definition.name, info: s => classifyEdition(s.definition, index), tiebreak: (a, b) => definitionTiebreak(a.definition, b.definition) })`. The default `partialMatch` (first in insertion order) is today's order. No match → `o5GetSpell(name, "not-found")`, else today's not-found text. Catch → `o5GetSpell(name, "unavailable")`.
- `formatSpell(spell, { info, reason, renamed })`: line 1 the existing `**Name** — Level N School [tags]`, then `rulesLine(info, { reason })`, then `renameLine(…)` when `renamed`, then Casting Time… and the body as today.
- `searchSpells`: `groupAndSelect(spellList(store), rulesEdition, { info, twinKey: s => twinName(s.definition.name), tiebreak, nameMatches: name ? s => normalizeName(s.definition.name).includes(normalizeName(name)) : undefined, passes: <level/school/concentration/ritual on the entry> })`. Sort the selections by level then name, as today, then paginate. Output: `searchHeader({ requested })`, then today's heading and provenance note, then lines `- **Fireball** [2024] — Level 3 Evocation (Conc.)` (the tag is `editionTag(sel.info)`), then the offset hint, then `searchFooter(requested, hidden)` last when non-null. Catch → `o5SearchSpells(params, "unavailable")`.
- `index.ts`: both spell registrations gain `rules_edition: RULES_EDITION_PARAM`, pass it through, and append `" " + RULES_EDITION_TOOL_NOTE` to the description.

- [ ] **Step 1: Write the failing tests** in `tests/spell-editions.test.ts`

Fixtures (ids explicit): Sleep 2014 `{ id: 101, isLegacy: true, sources: [2], description: "SLEEP 2014" }` and 2024 `{ id: 201, sources: [145], description: "SLEEP 2024" }`. Toll the Dead `{ id: 102, sources: [27] }`. A 2024-only spell "Starry Wisp" `{ id: 202, sources: [145] }`. Acid Arrow `{ id: 103, isLegacy: true, sources: [2], description: "ACID 2014" }` and Melf's Acid Arrow `{ id: 203, sources: [145], description: "ACID 2024" }`. Barkskin 2014 `{ id: 104, isLegacy: true, sources: [2], concentration: true }` and 2024 `{ id: 204, sources: [145], concentration: false }`.

```ts
it("Sleep: 2024 by default, 2014 on request, each with its rules line", async () => {
  const d = (await reference.getSpell("Sleep")).split("\n");
  expect(d[1]).toBe("Rules: 2024 · Player's Handbook (2024)");
  expect(d.join("\n")).toContain("SLEEP 2024");
  const o = (await reference.getSpell("Sleep", "2014")).split("\n");
  expect(o[1]).toBe("Rules: 2014 · Player's Handbook (2014)");
  expect(o.join("\n")).toContain("SLEEP 2014");
});
it("a 2014-only spell under the default carries the reason line", async () => {
  expect(await reference.getSpell("Toll the Dead")).toContain(
    "Rules: 2014 · Xanathar's Guide to Everything\n(no 2024 version found — 2014 text shown)");
});
it("a 2024-only spell under 2014 carries the reason line", async () => {
  expect(await reference.getSpell("Starry Wisp", "2014")).toContain("(no 2014 version found — 2024 text shown)");
});
it("Acid Arrow resolves through the rename table", async () => {
  const out = await reference.getSpell("Acid Arrow");
  expect(out).toContain("ACID 2024");
  expect(out).toContain("(2014 name: Acid Arrow · 2024 name: Melf's Acid Arrow)");
  expect(await reference.getSpell("Acid Arrow", "2014")).not.toContain("2014 name:");
});
it("two same-edition entries resolve by lowest id", async () => { /* two 2024 "Twin Bolt", ids 301/300 → id 300's text */ });

it("search hides the other edition's twin and says so", async () => {
  const lines = (await reference.searchSpells({ name: "sleep" })).split("\n");
  expect(lines[0]).toBe('Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: "2014" for 2014 versions.');
  expect(lines.filter(l => l.startsWith("- **Sleep**"))).toEqual(["- **Sleep** [2024] — Level 1 Evocation"]);
  expect(lines.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  const old = (await reference.searchSpells({ name: "sleep", rulesEdition: "2014" })).split("\n");
  expect(old[0]).toBe("Rules: 2014 requested — 2024 entries appear only where no 2014 version was found.");
  expect(old.at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
});
it("attribute filters apply to the selected entry", async () => {
  const conc = await reference.searchSpells({ concentration: true });
  expect(conc).not.toContain("**Barkskin**");
  // groupAndSelect counts a twin as hidden only when the group's selected entry passed the filters.
  expect(conc).not.toContain("hidden");
  expect(await reference.searchSpells({ concentration: true, rulesEdition: "2014" })).toContain("- **Barkskin** [2014]");
});
it("the name filter matches a group by either name", async () => {
  expect(await reference.searchSpells({ name: "melf", rulesEdition: "2014" })).toContain("- **Acid Arrow** [2014]");
});
it("pagination and totals count the list after hiding; the footer counts every hidden twin", async () => {
  // 25 distinct names, each with a 2014 and a 2024 definition
  const out = await reference.searchSpells({ name: "page", limit: 20 });
  expect(out).toContain("showing 1–20 of 25");
  expect(out.split("\n").at(-1)).toBe('25 2014 versions hidden — rules_edition: "2014" shows them.');
});
it("labels the Open5e fallback when every D&D Beyond request fails", async () => { /* all 16 → 403; open5e router returns one spell */
  expect((await reference.getSpell("Fireball")).split("\n")[1])
    .toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — D&D Beyond unavailable)");
});
it("labels the Open5e fallback as not-found when D&D Beyond lacks the spell", async () => {
  expect((await reference.getSpell("Fireball")).split("\n")[1])
    .toBe("Rules: 2014 · SRD 5.1 (Open5e fallback — not found on D&D Beyond)");
});
```

`tests/edition.test.ts`: pin `RULES_EDITION_TOOL_NOTE`'s exact string, and update the four "exists" pins to the "found" wording above.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/spell-editions.test.ts tests/edition.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `getSpell`, `searchSpells`, `formatSpell`, the constant, the "found" wording, and the two registrations**

- [ ] **Step 4: Run the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. `spell-compendium-endpoints.test.ts` still passes unchanged (its `toContain` checks are unaffected by the new first line).

- [ ] **Step 5: Update `CLAUDE.md`**

In Decisions → "Rules edition everywhere", change `with "no 2024 version exists"` to `with "no 2024 version found"`.

- [ ] **Step 6: Commit**

```bash
git add src/tools/reference.ts src/edition.ts src/index.ts tests/spell-editions.test.ts tests/edition.test.ts CLAUDE.md
git commit -m "feat(spells): rules_edition on ddb_get_spell and ddb_search_spells

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `getMonsterStats` union, ambiguity, and labelled encounter/treasure output

**Files:**
- Modify: `src/tools/monster.ts`, `src/edition.ts`, `src/tools/encounter.ts`, `src/tools/treasure.ts`, `src/index.ts`, `CLAUDE.md`
- Test: `tests/monster.test.ts`, `tests/encounter.test.ts`, `tests/treasure.test.ts`, `tests/edition.test.ts`

**Interfaces:**
- Consumes: `o5GetMonsterStats` (Task 1); `peekSourceIndex` and the config failure cache (Task 2); `RULES_EDITION_TOOL_NOTE`, `RULES_EDITION_PARAM` (Task 3); `classifyEdition`, `selectByEdition`, `monsterTiebreak`, `twinName`, `twinAliases`, `normalizeName`, `rulesLine`, `editionTag`, `ambiguityMessage` from `src/edition.ts`.
- Produces:
  - `src/tools/monster.ts`:
    ```ts
    export type MonsterStatsResult =
      | { status: "found"; name: string; crValue: number; xp: number; info: EditionInfo }
      | { status: "not-found" }
      | { status: "ambiguous"; candidates: Array<{ name: string; crValue: number; xp: number }> };
    export async function getMonsterStats(name: string, opts?: { rulesEdition?: RulesEdition }): Promise<MonsterStatsResult>;
    async function fetchCandidates(name: string, take: number, sourceIds?: number[]): Promise<DdbMonster[]>; // module-private, reused by Task 5
    ```
  - `src/edition.ts`: `export const DMG_SOURCE_ID: Readonly<Record<RulesEdition, number>> = { "2024": 146, "2014": 3 };` (verified source IDs, spec §Live data facts).
  - `src/tools/treasure.ts`: `TreasureInput` gains `rulesEdition?: RulesEdition` (default `"2024"`).

`fetchCandidates`: query `fetchMonsterList(alias, take, sourceIds)` for each `twinAliases(name)` spelling. Merge the results in alias order, keeping the first copy of each id. The typed name's query (the first alias) propagates its error. Every other alias's error is swallowed, so that alias contributes nothing.

`getMonsterStats` DDB path (logged in):
1. `config = await getGameConfig()`, `index = await getSourceIndex()`. The second call costs no request: `getGameConfig()` serves a success from its cache and a recent failure from Task 2's failure cache. `info = m => classifyEdition(m, index)`, `tiebreak = monsterTiebreak(index)`.
2. `official` = `fetchCandidates(name, 20)` filtered to `isHomebrew === false` and a `challengeRatingId` present in `config.challengeRatings`. A null config yields none.
3. **Exact:** the entries whose `twinName(m.name) === twinName(name)`. If any → `selectByEdition(…)` → `found` (name, crValue, xp, info).
4. **Partial:** the entries whose `normalizeName(m.name)` includes `normalizeName(name)`, grouped by `twinName`. One group → select → `found`. Two or more → `ambiguous`, with each group's `selectByEdition` pick, sorted by `crValue` then name.
5. Nothing matched, or the DDB path threw → `o5GetMonsterStats(name)` → `found` with `info: { ruleset: "2014", book: null }`, else `{ status: "not-found" }`. Logged out goes straight to this step.

`getMonster` and `searchMonsters` are **not** changed in this task: `rankCandidates` keeps its `preferLegacy` key until Task 5.

Encounter (`src/tools/encounter.ts`):
- The rules line is `rulesLine(classifyEdition({ sourceId: DMG_SOURCE_ID[rulesEdition] }, peekSourceIndex()))`. It goes on line 2 of `rateEncounter` (after `ENCOUNTER DIFFICULTY: …`) and of `targetEncounterCr` (after `TARGET CR — …`).
- A named, found monster's line puts `editionTag(stats.info)` after the name: `  1 × Wolf [2024] (CR 1/4, 50 XP)`. A `cr`-supplied monster has no tag.
- `getMonsterStats(m.name, { rulesEdition })`. `not-found` behaves as today. `ambiguous` is excluded from totals and collected as `ambiguityMessage(m.name, candidates.map(c => ({ name: c.name, cr: displayCr(c.crValue) })))`. Each one is printed as `⚠ <message>` after the not-found line, **and** appended to the "No valid monsters provided…" return when nothing resolved (Review Focus 1).

Treasure (`src/tools/treasure.ts`):
- `getMonsterStats(n, { rulesEdition })`. `resolvedMap` holds `MonsterStatsResult`.
- The rules text is `rulesLine(classifyEdition({ sourceId: DMG_SOURCE_ID["2024"] }, peekSourceIndex()), rulesEdition === "2014" ? { reason: "treasure-no-2014" } : {})`, so `"2014"` gives two lines. `formatHoardOutput` and `formatIndividualOutput` take it as a new `rules: string` param, print it right after their title line, and reserve its length up front like the coin trailer, so it is never omitted and the budget still holds (Review Focus 4). The direct-`cr` path prints it too.
- Resolved names carry the tag: hoard `Source:` segments `Goblin [2024] (CR 1/4)`, individual labels `Goblin [2024] (CR 1/4)`. `✓` status lines are unchanged.
- An ambiguous name's `✗` line is `  ✗ ${ambiguityMessage(displayName(n), candidates.map(c => ({ name: displayName(c.name), cr: crDisplay(c.crValue) })))}`, in both the partial and the all-unresolved paths. A not-found name keeps today's text.

`src/index.ts`:
- `ddb_roll_treasure` gains `rules_edition: RULES_EDITION_PARAM` and passes `rulesEdition`. Its description appends `RULES_EDITION_TOOL_NOTE` plus "Only 2024 treasure tables exist: '2014' still rolls them and says so, but resolves monster CRs from 2014 stat blocks."
- `ddb_rate_encounter` / `ddb_encounter_cr` keep their own `rules_edition` describe text and append `RULES_EDITION_TOOL_NOTE` to their descriptions.

- [ ] **Step 1: Write the failing tests**

`tests/monster.test.ts`:
- Add CR entries to `CONFIG.challengeRatings`: `{ id: 8, value: 4, xp: 1100 }`, `{ id: 14, value: 10, xp: 5900 }`, `{ id: 21, value: 17, xp: 18000 }`, `{ id: 28, value: 24, xp: 62000 }` (each with a `proficiencyBonus`).
- Add a `failSearchTerms: Set<string>` hook to `setupFetch` (a listed lowercased term → 500) and reset it in `beforeEach`.
- Migrate the existing `getMonsterStats` expectations: `toEqual({ name, crValue, xp })` → `toMatchObject({ status: "found", name, crValue, xp })`, `{ preferLegacy: true }` → `{ rulesEdition: "2014" }`, and `toBeNull()` → `toEqual({ status: "not-found" })`.

```ts
const RED = (id: number, name: string, cr: number) => monster({ id, name, sourceId: 147, sources: sources(147), challengeRatingId: cr });
const RED_DRAGONS = [RED(8_000_200, "Adult Red Dragon", 21), RED(8_000_201, "Red Dragon Wyrmling", 8),
                     RED(8_000_202, "Ancient Red Dragon", 28), RED(8_000_203, "Young Red Dragon", 14)];

it("a partial name spanning several creatures is ambiguous, listed by CR", async () => {
  extraMonsters = RED_DRAGONS;
  expect(await getMonsterStats("Red Dragon")).toEqual({ status: "ambiguous", candidates: [
    { name: "Red Dragon Wyrmling", crValue: 4, xp: 1100 }, { name: "Young Red Dragon", crValue: 10, xp: 5900 },
    { name: "Adult Red Dragon", crValue: 17, xp: 18000 }, { name: "Ancient Red Dragon", crValue: 24, xp: 62000 }] });
});
it("edition twins of one creature are not ambiguous", async () => {
  expect(await getMonsterStats("Gray Ooze")).toMatchObject({ status: "found", name: "Psychic Gray Ooze", crValue: 1 });
});
it("found results carry the entry's edition", async () => {
  expect(await getMonsterStats("Zombie")).toMatchObject({ info: { ruleset: "2024", book: "Monster Manual (2024)" } });
  expect(await getMonsterStats("Zombie", { rulesEdition: "2014" })).toMatchObject({ info: { ruleset: "2014", book: "Basic Rules (2014)" } });
});
it("queries every rename alias and finds the renamed creature", async () => {
  extraMonsters = [monster({ id: 8_000_100, name: "Tough", typeId: 8, sourceId: 147, sources: sources(147), challengeRatingId: 4 })];
  expect(await getMonsterStats("Thug")).toMatchObject({ status: "found", name: "Tough", crValue: 0.5 });
  expect(listUrls.some(u => u.includes("search=Tough"))).toBe(true);
});
it("a failed alias query doesn't fail the lookup", async () => {
  extraMonsters = [/* the Tough above */];
  failSearchTerms.add("thug");
  expect(await getMonsterStats("Tough")).toMatchObject({ status: "found", name: "Tough" });
});
it("rateEncounter lists an ambiguous name and rates the rest", async () => {
  extraMonsters = RED_DRAGONS;
  const out = await rateEncounter([{ count: 4, level: 5 }], [{ name: "Red Dragon" }, { name: "Wolf" }], "2024");
  expect(out).toContain('⚠ Ambiguous: "Red Dragon" could be Red Dragon Wyrmling (CR 4), Young Red Dragon (CR 10), Adult Red Dragon (CR 17), Ancient Red Dragon (CR 24) — use the full name.');
  expect(out).toContain("1 × Wolf [2024] (CR 1/4");
  expect(out).toContain("Total XP: 50");
});
it("rateEncounter with only ambiguous names still shows the ambiguity", async () => {
  extraMonsters = RED_DRAGONS;
  const out = await rateEncounter([{ count: 4, level: 5 }], [{ name: "Red Dragon" }], "2024");
  expect(out).toContain("No valid monsters provided");
  expect(out).toContain('Ambiguous: "Red Dragon" could be');
});
```

`tests/encounter.test.ts` (no mocks; `peekSourceIndex` reads the real snapshot):

```ts
it.each([["2024", "Rules: 2024 · Dungeon Master's Guide (2024)"], ["2014", "Rules: 2014 · Dungeon Master's Guide (2014)"]] as const)(
  "rateEncounter and targetEncounterCr put the %s rules line under the title", async (ed, line) => {
    expect((await rateEncounter(PARTY_4_L5, [{ cr: 1 }], ed)).split("\n")[1]).toBe(line);
    expect((await targetEncounterCr(PARTY_4_L5, ed === "2024" ? "moderate" : "medium", undefined, ed)).split("\n")[1]).toBe(line);
  });
```

`tests/treasure.test.ts`:
- Migrate every `getMonsterStats` mock to the union: `{ status: "found", name, crValue, xp, info: { ruleset: "2024", book: "Monster Manual (2024)" } }`, and `null` → `{ status: "not-found" }`.
- Add these tests:
  - hoard and individual outputs have `Rules: 2024 · Dungeon Master's Guide (2024)` right after their title;
  - `rulesEdition: "2014"` adds `(no 2014 version exists — 2024 tables used)` on the next line and calls `getMonsterStats` with `{ rulesEdition: "2014" }`;
  - resolved names are tagged (`Goblin [2024] (CR 1/4)`);
  - an `ambiguous` mock produces the `✗ Ambiguous: …` line in both the partial and all-unresolved paths;
  - with `maxOutputChars` small enough to force omissions, the rules line is still present and `out.length <= maxOutputChars` (Review Focus 4).

`tests/edition.test.ts`: `DMG_SOURCE_ID` equals `{ "2024": 146, "2014": 3 }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/monster.test.ts tests/encounter.test.ts tests/treasure.test.ts tests/edition.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `DMG_SOURCE_ID`, `fetchCandidates`, the new `getMonsterStats`, then the encounter and treasure changes, then the three registrations.

- [ ] **Step 4: Run the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, including `tests/treasure-limits.test.ts` unchanged.

- [ ] **Step 5: Update `CLAUDE.md`**

- Tool notes: `ddb_rate_encounter` / `ddb_roll_treasure` take `rules_edition`. `getMonsterStats` returns `found`/`not-found`/`ambiguous`, and an ambiguous name is listed rather than guessed.
- Decisions: the ambiguity bullet becomes a statement of current behaviour.
- Mark work item 3 done.

- [ ] **Step 6: Commit**

```bash
git add src/tools/monster.ts src/edition.ts src/tools/encounter.ts src/tools/treasure.ts src/index.ts tests/monster.test.ts tests/encounter.test.ts tests/treasure.test.ts tests/edition.test.ts CLAUDE.md
git commit -m "feat(monsters): getMonsterStats reports ambiguous names; encounter and treasure carry rules lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `rules_edition` on `ddb_get_monster` and `ddb_search_monsters`

**Files:**
- Modify: `src/tools/monster.ts`, `src/edition.ts`, `src/index.ts`, `README.md`, `CLAUDE.md`
- Test: `tests/monster.test.ts`, `tests/monster-session.test.ts`, `tests/edition.test.ts`

**Interfaces:**
- Consumes: `fetchCandidates` (Task 4); `getSourceIndex`; `RULES_EDITION_PARAM`, `RULES_EDITION_TOOL_NOTE` (Task 3); `lookupByName`, `selectByEdition`, `groupAndSelect`, `classifyEdition`, `monsterTiebreak`, `twinName`, `normalizeName`, `isEdition`, `rulesLine`, `renameLine`, `sourceNote`, `editionTag`, `searchHeader`, `searchFooter` from `src/edition.ts`.
- Produces:
  - `getMonster(monsterName: string, opts?: { source?: string; rulesEdition?: RulesEdition }): Promise<string>`. This replaces the positional `source`.
  - `searchMonsters(params: { name?; cr?; type?; size?; source?; rulesEdition?: RulesEdition }): Promise<string>`
  - `rankCandidates`, `coreCategoryIds` and `selectMonster` are deleted. Ordering is `monsterTiebreak(index)`.
  - `src/edition.ts`: two `REASON_TEXT` keys (owner decision 2026-10-17), so they are `RulesLineReason`s, not `EditionReason`s, because `selectByEdition` never produces them:
    - `locked-2024`: `(the 2024 version isn't available to this account — 2014 text shown)`
    - `locked-2014`: `(the 2014 version isn't available to this account — 2024 text shown)`
  - Source helpers take the index instead of the config: `resolveSourceIds(index, query)`, `sourceLabel(index, id)`, `suggestSources(index, query)`, `unknownSourceError(index, source)`, `availableSourcesFor(name, index)`. Labels keep today's text (`Monster Manual [mm-2024]`, from `description` and the `sourceURL` slug). The "Game config source list unavailable" throw is deleted, because the snapshot always supplies sources.

`getMonster`:
- **No source:** `lookupByName(candidates, name, rulesEdition, { name: m => m.name, info, tiebreak, partialMatch })`. `partialMatch(all, q)` returns the first by `tiebreak` among entries whose `normalizeName` includes `q`. If there are none, it returns `all[0]` (the service's top fuzzy hit for the typed name).
- **Locked twin (no source only).** A pick is restricted when its detail has `accessType === 4 && !data.stats?.length`, the same check today's Open5e fallback uses. When the pick is restricted, came back with no `reason` (it is the requested edition) and is 2014/2024:
  1. Take the other edition's entries in the pick's twin group (`twinName(m.name) === twinName(pick.name)`), and pick the first by `tiebreak`.
  2. Fetch its detail through the same cached detail path. Only this case adds a request, and the result is cached.
  3. If that detail isn't restricted, show it instead, with reason `"locked-2024"` when 2024 was requested, or `"locked-2014"` when 2014 was. Show `renameLine` (2014 entry's name, 2024 entry's name) when the two names differ and the shown entry's normalized name differs from the query's.
  4. Otherwise (no other edition, or it is locked too), keep today's behaviour: the Open5e fallback (origin `"unavailable"`), else the restricted block.

  Searches can't do this, because the list response carries no `accessType` (live 2026-10-17). They list the locked entry, and the stat block shows it. `getMonsterStats` reads CR from the list and needs no change.
- **With source:** the group is the candidates whose `twinName(m.name) === twinName(name)`, picked with `selectByEdition`. The reason is dropped. A restricted pick is never swapped: the book was asked for, and the restricted block already says the content isn't owned. When the pick's ruleset is 2014/2024, add `sourceNote(source, pick ruleset, rulesEdition)` (null when they agree). Today's near-name / available-sources error stays.
- **`formatStatBlock(m, accessType, config, index, extras: { reason?; renamed?; note? })`:** `# Name`, then `rulesLine(info, { reason })`, then `renameLine` / note when present, then `*Size Type, Alignment*`, then `**Source** <label>` with no `[Legacy]`, then the rest unchanged.

`searchMonsters`:
- Fetching: with a search term, run today's fetch (single page or `fetchMonsterPages`) once per `twinAliases(term)` spelling and merge by id, as `fetchCandidates` does. The typed term's failure fails the search (today's Open5e catch). Another alias's failure is swallowed and contributes nothing. `total` is the sum of the alias totals minus the duplicate ids met while merging: exact when every scan is complete, an upper bound otherwise, so the "checked X of Y" note stays honest.
- **No source:** `groupAndSelect(fetched, rulesEdition, { info, twinKey: m => twinName(m.name), tiebreak, passes: <CR/type/size> })`. Line 1 is `searchHeader({ requested: rulesEdition })`. `searchFooter(rulesEdition, hidden)` is the last line.
- **With source:** no selection. Filter every fetched entry with the same CR/type/size predicate. Line 1 is `searchHeader({ sourceBook: index.sources.get(Math.min(...sourceIds))!.book })`. 4 of 195 slugs map to several IDs (`basic-rules-2014`, `br-2024`, `paitm`, `ddbd`), and in each the lowest ID is the main book, not a premade-character pack. Line 2 is `sourceNote(source, bookRuleset, rulesEdition)` when non-null, where `bookRuleset = classifyEdition({ sources: sourceIds.map(sourceId => ({ sourceId })) }, index).ruleset` and only when `isEdition`. No footer.
- Result line: `- **Wolf** [2024] — Monster Manual [mm-2024] — CR 1/4, …`. `Legendary`/`Mythic` move to a second bracket after the edition tag (`- **Tarrasque** [2024] [Legendary] — …`). The `Homebrew`/`Legacy` text tags are gone (`editionTag` says `[homebrew]`). Untrusted wrapping is unchanged. Today's `**Monster Search** (…)` heading, counts (now after hiding) and notes follow line 1/2.

`src/index.ts`: both registrations gain `rules_edition: RULES_EDITION_PARAM` and pass it through. Rewrite the descriptions to drop the "Legacy tag" / "non-Legacy (2024) entry is preferred" wording, say that `source` wins over `rules_edition` (and that a contradicting book adds a note), and append `RULES_EDITION_TOOL_NOTE`. `README.md`: the `ddb_search_monsters` / `ddb_get_monster` rows say the same (no `[Legacy]`).

- [ ] **Step 1: Write the failing tests** (`tests/monster.test.ts`)

Migrate first:
- `getMonster(name, source)` → `getMonster(name, { source })` everywhere, including `monster-session.test.ts`.
- The `default selection` 2014 case uses `{ rulesEdition: "2014" }`.
- "labels each entry with its source and a Legacy tag" becomes the twin-hiding test below.
- "names the source book near the header, tagging Legacy entries" now expects `Rules: 2014 · Basic Rules (2014)` and `**Source** Basic Rules (2014) [basic-rules-2014]`, with no `[Legacy]` anywhere.
- The three "no sources list" tests (getMonster and searchMonsters, `configWithoutSources`) now expect resolution through the snapshot: `listUrls[0]` contains `sources=6` for `cos`, and `o5GetMonster`/`o5SearchMonsters` are not called.

New tests:

```ts
it("search hides the other edition's twin, with header and footer", async () => {
  const lines = (await searchMonsters({ name: "Wolf" })).split("\n");
  expect(lines[0]).toBe('Rules: 2024 by default — 2014 entries appear only where no 2024 version was found. Use rules_edition: "2014" for 2014 versions.');
  expect(lines.filter(l => l.startsWith("- **Wolf**"))).toEqual([expect.stringMatching(/^- \*\*Wolf\*\* \[2024\] — Monster Manual \[mm-2024\]/)]);
  expect(lines.at(-1)).toBe('1 2014 version hidden — rules_edition: "2014" shows it.');
  const old = await searchMonsters({ name: "Wolf", rulesEdition: "2014" });
  expect(old).toMatch(/- \*\*Wolf\*\* \[2014\] — Basic Rules \(2014\) \[basic-rules-2014\]/);
  expect(old.split("\n").at(-1)).toBe("1 2024 version hidden — omit rules_edition to show it.");
});
it("a source filter lists every edition in the book, tagged, without hiding", async () => {
  extraMonsters = [monster({ id: 8_000_300, name: "Crypt Wolf", isLegacy: true, sourceId: 6, sources: sources(6) }),
                   monster({ id: 8_000_301, name: "Crypt Wolf", sourceId: 147, sources: sources(147, 6) })];
  const out = await searchMonsters({ name: "Crypt Wolf", source: "cos" });
  expect(out.split("\n")[0]).toBe("Rules: showing every entry in Curse of Strahd, each tagged with its edition.");
  expect(out).toContain("- **Crypt Wolf** [2014]");
  expect(out).toContain("- **Crypt Wolf** [2024]");
  expect(out).not.toContain("hidden");
});
it("a source that contradicts rules_edition adds a note, on get and search", async () => {
  expect(await getMonster("Zombie", { source: "mm-2024", rulesEdition: "2014" }))
    .toContain('(source "mm-2024" is a 2024 book — rules_edition "2014" was ignored)');
  expect((await searchMonsters({ name: "Zombie", source: "mm-2024", rulesEdition: "2014" })).split("\n")[1])
    .toBe('(source "mm-2024" is a 2024 book — rules_edition "2014" was ignored)');
  expect(await getMonster("Zombie", { source: "mm-2024" })).not.toContain("was ignored");
});
it("the stat block opens with the rules line", async () => {
  expect((await getMonster("Zombie")).split("\n")[1]).toBe("Rules: 2024 · Monster Manual (2024)");
});
it("a 2014-only monster under the default gives the reason", async () => {
  expect(await getMonster("Bugbear")).toContain("Rules: 2014 · Basic Rules (2014)\n(no 2024 version found — 2014 text shown)");
});
it("a 2024-only monster under 2014 gives the reason", async () => {
  expect(await getMonster("Giant Shark", { rulesEdition: "2014" })).toContain("(no 2014 version found — 2024 text shown)");
});
it("a 2014 name reaches its renamed 2024 creature, with the rename line", async () => {
  extraMonsters = [/* Tough as in Task 4 */];
  expect(await getMonster("Thug")).toContain("(2014 name: Thug · 2024 name: Tough)");
});

describe("a locked twin", () => {
  // Replace the const UNOWNED_IDS with `unownedIds`, a Set refilled with VAMPIRE_SPAWN_COS.id in beforeEach,
  // so each test chooses what is locked.
  const BLIGHT_2014 = monster({ id: 8_000_400, name: "Twig Blight", isLegacy: true, sourceId: 5, sources: sources(5), actionsDescription: "<p>BLIGHT 2014</p>" });
  const BLIGHT_2024 = monster({ id: 8_000_401, name: "Twig Blight", sourceId: 147, sources: sources(147), stats: [], actionsDescription: "" });
  beforeEach(() => { extraMonsters = [BLIGHT_2014, BLIGHT_2024]; });

  it("shows the owned 2014 version when the 2024 one is locked", async () => {
    unownedIds.add(BLIGHT_2024.id);
    const lines = (await getMonster("Twig Blight")).split("\n");
    expect(lines.slice(1, 3)).toEqual(["Rules: 2014 · Monster Manual (2014)",
      "(the 2024 version isn't available to this account — 2014 text shown)"]);
    expect(lines.join("\n")).toContain("BLIGHT 2014");
  });
  it("shows the owned 2024 version when the 2014 one is locked under rules_edition 2014", async () => {
    // a 2024 entry with stats, and a locked 2014 one with stats: []
    expect(await getMonster("Twig Blight", { rulesEdition: "2014" })).toContain(
      "(the 2014 version isn't available to this account — 2024 text shown)");
  });
  it("both locked: today's Open5e fallback", async () => {
    unownedIds.add(BLIGHT_2024.id); unownedIds.add(BLIGHT_2014.id); // BLIGHT_2014 with stats: [] for this case
    await getMonster("Twig Blight");
    expect(o5GetMonster).toHaveBeenCalledWith("Twig Blight", "unavailable");
  });
  it("with a source, the restricted block is shown and nothing is swapped", async () => {
    unownedIds.add(BLIGHT_2024.id);
    const out = await getMonster("Twig Blight", { source: "mm-2024" });
    expect(out).not.toContain("BLIGHT 2014");
    expect(out).not.toContain("isn't available to this account — 2014");
  });
  it("an owned pick makes no second detail request", async () => {
    await getMonster("Twig Blight");
    expect(detailUrls.filter(u => /\/Monster\/8000400$/.test(u))).toEqual([]);
  });
});
```

`setupFetch` records detail URLs in `detailUrls` (reset in `beforeEach`) beside `listUrls`. `tests/edition.test.ts` pins both `locked-…` strings through `rulesLine`.

The existing `describe.each([false, true])` reversed-order block, the tiebreak block and the homebrew tests must keep passing unchanged apart from the signature migration.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/monster.test.ts tests/monster-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the two `locked-…` reasons, the source helpers on the index, `getMonster` (with the locked-twin swap), `formatStatBlock`, `searchMonsters`, the registrations and the README rows.

- [ ] **Step 4: Run the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Update `CLAUDE.md`**

- Rewrite the `ddb_get_monster` / `ddb_search_monsters` tool note: `rules_edition`, twin hiding, `source` wins with a note, ranking by `monsterTiebreak`, and source resolution through the source index (survives a config outage).
- Delete the phase-2 note "Monster `source` resolution still calls `getGameConfig()` directly".
- Replace the phase-2 note "'(no 2024 version exists)' is false for content that exists but is locked to the account…" with current behaviour: the reasons say "found", not "exists", because spell lists leave out locked spells (Feeblemind/Befuddlement on the owner's account); `ddb_get_monster` swaps a locked pick for an owned other-edition twin with the `locked-…` reason; monster search can't, because the list carries no `accessType`. Keep its sentence about the ~30 unverified monster renames.
- Next steps item 5 (minor monster-tool edges): add "A CR/type/size search with no name scans the first 600 of ~6,000 monsters, so a 2014 entry can be listed while its 2024 twin lies beyond the scan (live 2026-10-17: 2 of 518 twin groups). The header already says the scan was partial.

- [ ] **Step 6: Commit**

```bash
git add src/tools/monster.ts src/edition.ts src/index.ts README.md CLAUDE.md tests/monster.test.ts tests/monster-session.test.ts tests/edition.test.ts
git commit -m "feat(monsters): rules_edition on ddb_get_monster and ddb_search_monsters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server module, instructions, consistency test, docs, live check

**Files:**
- Move: `src/index.ts` → `src/server.ts` (`git mv`), then create a new `src/index.ts`
- Modify: `src/edition.ts`, `tests/edition.test.ts`, `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-10-16-rules-edition-design.md` (status line only)
- Create: `tests/rules-edition-consistency.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `src/server.ts`: `export const server: McpServer`, built as `new McpServer({ name: "dndbeyond", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS })`, with every registration. No shebang, no transport, no `main()`.
  - `src/index.ts`: the `#!/usr/bin/env node` shebang, imports `server` and `closeBrowser`, plus today's `shutdown` and `main()`, unchanged. `package.json` `bin`/`main`/`dev`, the Dockerfile and the LobeHub script keep pointing at `index`.
  - `src/edition.ts`: `export const SERVER_INSTRUCTIONS = "Every rules answer carries a 'Rules:' line or an inline tag — [2024], [2014], [third-party], [homebrew], [playtest] or [edition not stated] — naming the ruleset, and says when the edition shown differs from the one requested. Pass this on to the user. Content defaults to 2024; if the user's table plays 2014, pass rules_edition: '2014'."`

- [ ] **Step 1: Split the entrypoint**

Run `git mv src/index.ts src/server.ts`, then edit `server.ts`: delete the shebang, the `StdioServerTransport` import, `shutdown`, the signal handlers and `main()`, and export `server` with the instructions. Recreate `src/index.ts` with just those pieces. Pin `SERVER_INSTRUCTIONS` in `tests/edition.test.ts`.

Run: `npm run build && npm run lobehub:manifest`
Expected: both succeed, and `lhm.plugin.json` lists 36 tools (git-ignored, don't commit it).

- [ ] **Step 2: Write `tests/rules-edition-consistency.test.ts`**

- Partially mock `../src/session-fetch.js`: `vi.mock(path, async (orig) => ({ ...(await orig()), hasValidSession, sessionFetch, beginAuthenticatedSession, captureSession, assertSessionCurrent }))`. Keep the real `onSessionInvalidated`/`SessionChangedError`, so the whole server module graph imports.
- Route `sessionFetch` by URL:
  - `api/config/json` → a config with the CR table and the sources used;
  - monster-service list/detail → Goblin 2014 (`isLegacy`, source 1) and Goblin 2024 (source 147);
  - character-service `game-data/spells` / `always-known-spells` → Fireball 2014 (`isLegacy`, sources [2]) and 2024 (sources [145]);
  - cobalt-token → a JWT.
- Stub global `fetch` for Open5e with one spell and one monster (`challenge_rating: "1/4"`).
- Connect `new Client({ name: "t", version: "0" })` to `server` through `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`).

```ts
const TAG = String.raw`\[(?:2024|2014|third-party|homebrew|playtest|edition not stated)\]`;
const RESULT_LINE = /^(?:- \*\*|• )/;
const TAGGED_LINE = new RegExp(String.raw`^(?:- \*\*[^*]+\*\*|• [^[\n]+?) ${TAG}`);
const EXEMPT = /^(?:Error:|No \w[^\n]* (?:found|matching)|[^\n]*\bnot found\b|[^\n]*requires login)/;

// Every tool whose input schema has rules_edition must appear here; Task-3+ phases extend the fixtures.
const FIXTURES: Record<string, (ed: "2024" | "2014") => Record<string, unknown>> = {
  ddb_search_spells: ed => ({ name: "fire", rules_edition: ed }),
  ddb_get_spell: ed => ({ name: "Fireball", rules_edition: ed }),
  ddb_search_monsters: ed => ({ name: "goblin", rules_edition: ed }),
  ddb_get_monster: ed => ({ name: "Goblin", rules_edition: ed }),
  ddb_rate_encounter: ed => ({ party: [{ count: 4, level: 3 }], monsters: [{ name: "Goblin" }], rules_edition: ed }),
  ddb_encounter_cr: ed => ({ party: [{ count: 4, level: 3 }], difficulty: ed === "2024" ? "moderate" : "medium", rules_edition: ed }),
  ddb_roll_treasure: ed => ({ monsters: [{ name: "Goblin" }], treasure_type: "individual", rules_edition: ed }),
};

it("every tool with rules_edition has fixtures, and vice versa", async () => {
  const { tools } = await client.listTools();
  const withParam = tools.filter(t => "rules_edition" in ((t.inputSchema.properties ?? {}) as object)).map(t => t.name).sort();
  expect(withParam).toEqual(Object.keys(FIXTURES).sort());
});

it("the server instructions tell the client about the labels", async () => {
  expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
});

describe.each(["ddb", "open5e"] as const)("labels (%s path)", mode => {
  // "open5e": hasValidSession → false; sessionFetch and beginAuthenticatedSession reject.
  it.each(Object.keys(FIXTURES).flatMap(t => [[t, "2024"], [t, "2014"]] as const))("%s (%s)", async (tool, ed) => {
    const res = await client.callTool({ name: tool, arguments: FIXTURES[tool](ed) });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(EXEMPT.test(text.split("\n")[0])).toBe(false); // fixtures must exercise a labelled answer
    if (tool.startsWith("ddb_search_")) {
      const results = text.split("\n").filter(l => RESULT_LINE.test(l));
      expect(results.length).toBeGreaterThan(0);
      for (const l of results) expect(l).toMatch(TAGGED_LINE);
    } else {
      expect(text).toMatch(/^Rules: /m);
    }
  });
});

it("error and not-found answers are exempt", () => {
  expect(EXEMPT.test('Spell "Zzz" not found in the compendium. Try ddb_search_spells with a partial name.')).toBe(true);
  expect(EXEMPT.test("No spells found matching the criteria.")).toBe(true);
});
```

Reset module caches between modes (`clearReferenceCache`, `clearMonsterCache`, `clearOpen5eCache`) in `beforeEach`. In `open5e` mode, `ddb_encounter_cr` and the two encounter/treasure tools still return their DMG rules line. The Goblin lookup in `rate_encounter`/`roll_treasure` resolves through `o5GetMonsterStats`.

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/rules-edition-consistency.test.ts`
Expected: PASS. If a case fails, fix the tool, not the test. Check that the first test fails if `rules_edition` is temporarily removed from `FIXTURES.ddb_get_spell`, then restore it.

- [ ] **Step 4: Docs**

- `CLAUDE.md`:
  - Architecture: registrations live in `src/server.ts`, and `src/index.ts` is the stdio entrypoint.
  - Module table: add `src/server.ts`.
  - Tool notes: `rules_edition` on spells/monsters/treasure; every Open5e fallback is labelled `Rules: 2014 · SRD 5.1 (Open5e fallback — …)` until phase 4.
  - Next steps: mark work item 1 done. Its spells/monsters scope is phase 2; add one line saying phases 3–5 continue from the spec. Delete the phase-2 notes it consumed, and mark the stateless-safe plan's Task 4 unblocked (its Task 2 now targets `src/server.ts`). Decisions → Sequencing: phase 3 is next. Bump "Last updated".
  - `ddb_search_site` still prints each category's own header/footer until phase 3's embedded mode: add that line to Next steps.
- `README.md`: rows for `ddb_get_spell`, `ddb_search_spells`, `ddb_rate_encounter`, `ddb_encounter_cr` and `ddb_roll_treasure` mention `rules_edition` and the `Rules:` line.
- The spec's **Status** line: "Phase 2 implemented 2026-10-17."

- [ ] **Step 5: Full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, with no snapshot updates.

- [ ] **Step 6: Live check (logged in)**

Write a throwaway client in the scratchpad (not committed). It spawns `npx tsx src/index.ts` with `StdioClientTransport` and calls the tools below under both editions:
- `ddb_get_spell` Fireball, Toll the Dead, Acid Arrow and Sleep;
- `ddb_get_monster` Goblin;
- `ddb_rate_encounter` with `{ name: "Red Dragon" }` plus `{ name: "Goblin" }`;
- `ddb_roll_treasure` Goblin.

Expected:
- Sleep differs between editions;
- Acid Arrow shows the rename line under 2024;
- Toll the Dead shows the no-2024 reason;
- Red Dragon is reported as ambiguous.

Collect every `Rules:` line. If there is no saved session, say so and skip.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/index.ts src/edition.ts tests/edition.test.ts tests/rules-edition-consistency.test.ts CLAUDE.md README.md docs/superpowers/specs/2026-10-16-rules-edition-design.md
git commit -m "feat(edition): server instructions and cross-tool rules-edition consistency test; phase 2 done

Live Rules: lines:
<paste from Step 6, or 'live check skipped: no session'>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do not push unless asked. Report to the owner the live `Rules:` lines, the diagnose table from Task 2, and that phase 3 needs its own plan.
