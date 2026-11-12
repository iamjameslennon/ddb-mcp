# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It holds the commands, invariants and gotchas. The full per-module, per-tool and historical detail lives in [docs/claude/](docs/claude/). **Read the relevant file there before changing that area, and update it when behaviour changes**:

| File | Read it before touching |
|------|-------------------------|
| [docs/claude/architecture.md](docs/claude/architecture.md) | Session lifecycle, execution paths, the full key-modules table (Open5e, edition, game config, library join, …) |
| [docs/claude/caching.md](docs/claude/caching.md) | Any cache, in-flight dedupe, failure memo, deadline or epoch guard |
| [docs/claude/tool-notes.md](docs/claude/tool-notes.md) | A tool's output, params or edition selection; `parseCharacterData` behaviour (senses, languages, spells, limited use, …) |
| [docs/claude/release-and-ops.md](docs/claude/release-and-ops.md) | Releasing, LobeHub, CI workflows, the Dockerfile, package pins |
| [docs/claude/history.md](docs/claude/history.md) | Owner decisions and rulings, every work item and carry-over (a)–(az), security finding F-2026-10-20 |

`parseCharacterData` is split into per-domain modules under [src/tools/character/](src/tools/character/). [docs/character-refactor.md](docs/character-refactor.md) has the module boundaries and the live-character snapshot regression flow. Keep that flow when changing parse behaviour. The rules-edition spec is [docs/superpowers/specs/2026-10-16-rules-edition-design.md](docs/superpowers/specs/2026-10-16-rules-edition-design.md). Where it and these notes differ, the spec wins.

## Commands

```bash
npm ci               # Install dependencies (prefer ci over install — respects the lockfile)
npm run dev          # Run in development mode (no build step, uses tsx)
npm run build        # Compile TypeScript to dist/
npm run build:watch  # Watch mode
npm run lint         # ESLint on the whole repo (src/, tests/, scripts/, root configs)
npm run typecheck    # Type-check src/, tests/ and scripts/release-history.mjs without emitting
npm test             # Run all tests (vitest)
npm run release      # Bump version, generate release notes, publish (patch|minor|major)
                     #   accepts --dry-run (mutate files only, no commit/tag/push)
                     #   and --skip-verify (skip the `npm ci && npm test` gate)
npm run lobehub:manifest  # Regenerate lhm.plugin.json (needs dist/ — run build first)
npx vitest run tests/character-parser.test.ts  # Run a single test file
```

Before each commit, run `npm run typecheck && npm run lint && npm test` and get them all green.

Data-refresh scripts. All except the last need `ddb_login`, and their output files are generated, so commit them and never edit them by hand:

- `npx tsx scripts/dump-edition-renames.mts` rewrites `src/source-snapshot.ts`. It reports `sourceCategoryId`s missing from `src/edition.ts`, which you place by hand, and prints rename candidates. Add a pair to `src/edition-renames.ts` only after reading both descriptions, with the evidence in a comment. `--snapshot-only` needs no login.
- `npx tsx scripts/dump-modifier-slugs.mts` rewrites `src/tools/character/modifier-slugs.ts`.
- `npx tsx scripts/dump-sourced-languages.mts` prints entries to paste into `LANGUAGE_NAMES_BY_ID` in `stats.ts`.
- `npx tsx scripts/check-conditions.mts` sanity-checks the vendored 2024 conditions against D&D Beyond.
- `npx tsx scripts/record-open5e-fixtures.mts [--check]` records the Open5e v2 fixtures. `--check` asserts only and writes nothing.

Regression check before a release (needs no login): `npx tsx scripts/regress-all-characters.mts [--baseline <version>]`. It parses all 56 `testcharacters.md` characters × 8 sections with the published npm package and with HEAD's `src/`, diffs them with wrappers, `Rules:` lines and edition tags stripped, and scans HEAD for anomalies and section consistency. It fails only on a HEAD crash, an inconsistency or a new anomaly; differences need reading. Its output holds other people's characters, so it goes to the OS temp dir, never the repo. See [docs/character-refactor.md](docs/character-refactor.md#layer-4--whole-corpus-regression-before-a-release).

Testing through an AI client: [skills/ddb-mcp-regression/](skills/ddb-mcp-regression/) is a skill contributors load into Claude Desktop (README, "Testing your change in Claude Desktop"). It plays players and DMs across every tool and test character, judges each reply's suitability and writes a findings report. **Keep its `references/` in step in the same commit** when you add or change a tool or its parameters, an owner ruling, a carry-over (opened or closed) or the test-character list. `tests/regression-skill.test.ts` fails on drift in the tool list, tool parameters, the character list and closed carry-overs, but not on a new ruling or a new carry-over, which need the manual update (`intended-behaviour.md`, `known-open-issues.md`).

## Architecture

This is an [MCP](https://modelcontextprotocol.io) server exposing D&D Beyond (DDB) data over stdio. `src/index.ts` is the entrypoint (transport, signals, `main()`). `src/server.ts` builds the `McpServer` (with `SERVER_INSTRUCTIONS` from `src/edition.ts`) and registers all 36 tools. They are still `server.tool(...)` calls, and the move to `registerTool` is open work. The tools delegate to `src/tools/`. Tests connect `server` to an in-memory transport.

### Browserless by default

- **Browserless** (`src/session-fetch.ts`): every content tool. Cookies come from `~/.config/ddb-mcp/session.json` (`%APPDATA%\ddb-mcp\session.json` on Windows), written by `ddb_login`.
  - `sessionFetch()` sends cookies only.
  - character-service (`/character/v5/character/{id}`, `/characters/list`) ignores cookies and needs the cobalt Bearer token. Use `beginAuthenticatedSession()`, whose bound `fetch` sends the token and the cookies from one snapshot. **Never pair a separate `getCobaltToken()` with `sessionFetch()`**: an account swap between the two calls can mix accounts.
  - `anonymousFetch()` is the credential-free path for public endpoints while logged out (monster-service, the game config). It sends no Cookie or Authorization header, never reads the session, and has a 20 s overall deadline.
- **Browser** (`src/browser.ts`, Playwright): only `ddb_login` (visible window), `ddb_navigate`, `ddb_interact` and `ddb_get_page`.
  - The shared context is closed by an `onSessionInvalidated` hook on every session transition. Like the login context, it is seeded from a `captureSession()` snapshot (`buildContextOptions(snapshot)`: cookies only when authenticated and not revoked), never from `session.json` by path.
  - Login uses its own separate browser and context (`beginLoginSession()`/`endLoginSession()`), seeded from a `captureSession()` snapshot (only when authenticated and not revoked), never from a raw read of `session.json`. Only the call whose `beginLoginSession()` succeeded ends it.
  - Signed in is decided by D&D Beyond: `ddb_login` polls the cobalt-token exchange through the login context's own request API (`verifyLoginContext()`, the same `decodeCobaltToken()` as `mintCobaltToken`) for up to 180 s (`LOGIN_TIMEOUT_MS`). No DOM or URL heuristic.
  - `saveVerifiedSession()` writes only with that proof and only inside the active login (fail closed), keeps only `dndbeyond.com` cookies and origins, and re-checks the generation it began under.
  - Login errors reach stderr and the client only through `safeErrorLine()` (`src/utils.ts`): Playwright's `Call log:` on request errors lists the cookie header.
  - navigate/interact/get_page carry a navigation allowlist guard (`ensureNavigationGuard` in `navigate.ts`). The login context deliberately bypasses it.
  - The sandbox is on by default. `DDB_NO_SANDBOX=1` turns it off for containers.

### Session lifecycle — `src/session-state.ts` (load-bearing)

This module is the single authority on which account is active. It sits below every other module and never imports a tool module.

- `captureSession()` re-reads the session file on **every** call. That re-read, not a watcher, is how a deleted, replaced or corrupt file gets noticed at the next protected operation.
- Any change advances an opaque, process-local **generation**. That aborts in-flight work, drops cached state and fires every `onSessionInvalidated()` callback.
- Every credential access binds to a `SessionSnapshot` and re-checks authority before dispatch.
- A file that parses but isn't a storage state counts as `anonymous`/`malformed`.
- On read, non-`dndbeyond.com` cookies are scrubbed and the file is rewritten atomically. Stale `session.json.<pid>.tmp` files from dead writers are swept.
- `revokeSession()` (behind `ddb_logout`, local-only):
  - sets a `revoked` flag that blocks new authenticated operations at once;
  - deletes the file;
  - awaits the cleanup hooks.
  - On any failure it stays revoked and rejects, naming the step that failed.
  - `ddb_login` clears the flag.
- **Every account-derived cache must register an `onSessionInvalidated()` hook.** Character JSON, compendia, features/traits, monsters, campaigns, the library and the game config all do.
- **Future design rule:** any browser factory or on-disk cache must adopt this lifecycle. That means binding each context to a captured snapshot and registering a revocation hook. A disk cache needs a durable per-account key that is validated at read time. The `generation` counter is process-local and resets on restart, so it cannot identify an account across restarts.

Full detail: [docs/claude/architecture.md](docs/claude/architecture.md).

### Key modules (one line each — full table in [architecture.md](docs/claude/architecture.md#key-modules))

| File | Role |
|------|------|
| `src/session-state.ts` / `src/session-fetch.ts` | Session authority (above); cookie/JWT fetch with retry. Typed errors `SessionLayerError`, `NoSessionError` |
| `src/browser.ts`, `src/auth.ts`, `src/tools/navigate.ts` | Playwright lifecycle, login flow, browser tools |
| `src/edition.ts` | Pure rules-edition foundation: `classifyEdition`, `classifyForEdition` (dual-edition items), `twinNames[kind]`, `selectByEdition` / `lookupByName` / `groupAndSelect`, tiebreaks, and **every** edition label string |
| `src/edition-renames.ts` | Verified `[2014, 2024]` rename pairs tagged by kind, each with evidence |
| `src/source-snapshot.ts` | Generated source table — never edit by hand |
| `src/source-filter.ts` | `source` (book) resolution and filtering; `isHomebrewSource` |
| `src/game-config.ts` | `getGameConfig()` / `getPublicGameConfig()` / `getSourceIndex()` / `peekSourceIndex()` — never rejects |
| `src/tools/edition-search.ts` | Shared catalog search/lookup pipeline (`CatalogAdapter`, `selectCatalog`, `lookupCatalog`, `SearchSection`, `paginateResults`) |
| `src/open5e.ts` | Open5e **v2** SRD fallback (SRD 5.2 + 5.1 loaded together) and primary source for the rules tools. Heavy on twin-name folding rules; read architecture.md first |
| `src/tools/reference.ts` | Spells, items, species, classes, backgrounds, feats, class features, racial traits (DDB character-service game-data) |
| `src/tools/spell-store.ts`, `src/tools/features-traits.ts` | Pure id-keyed spell store; pure class-feature/racial-trait normalization |
| `src/tools/monster.ts` | Monster get/stat blocks/`getMonsterStats` (anonymous when logged out, Open5e fallback); re-exports the search |
| `src/tools/monster-service.ts` | Monster-service fetch layer, asker/session binding, the full monster list scan and its cache (8-way, 60 s deadline, 24 h / 5 min TTL) |
| `src/tools/monster-search.ts`, `src/name-match.ts` | `ddb_search_monsters`: word-start/twin name rule (`matchesAtWordStart`), near matches, the 50 / `list_all` rule, incomplete-scan notes |
| `src/tools/character.ts` + `src/tools/character/*` | Character fetch/cache and the per-domain sheet parser (`parse.ts`, `editions.ts`, `definition.ts`, `actions.ts` + `spell-attacks.ts` for the combat block, `item-gate.ts`, …) |
| `src/tools/campaign.ts`, `library.ts`, `search.ts` | Campaigns/party, library + book reading (cheerio, no browser), `ddb_search_site` |
| `src/tools/conditions.ts` | Vendored conditions: SRD 5.1 (2014) and SRD 5.2.1 (2024), with CC-BY-4.0 attribution |
| `src/tools/encounter.ts`, `treasure.ts` | Encounter rating (2024 XDMG / 2014 DMG), treasure (2024 tables only) |
| `src/cache.ts`, `src/utils.ts` | `TtlCache<T>`; `stripHtml`, `wrapUntrusted`, `wrapIfHomebrew`, `mapWithConcurrency` |

## Invariants and conventions

- **Rules edition.** Every tool that can return either edition takes `rules_edition: "2024" | "2014"`, defaulting to `"2024"`. Never add `edition` or any other spelling.
  - Every response labels its ruleset with a `Rules:` line or an inline `[2024]`/`[2014]`/`[third-party]`/`[homebrew]`/`[playtest]`/`[edition not stated]` tag.
  - When it shows the other edition, it adds a reason line.
  - **No tool builds its own edition text.** All label strings come from `src/edition.ts`.
  - Twin matching always uses the kind's own namer (`twinNames[kind]`). There is no kind-free namer.
- **`source` wins over `rules_edition`.** There is no twin hiding, and every entry in the book is listed with its tag. A note is added when the edition contradicts `rules_edition`: for a search, the book's edition; for a get, the shown entry's edition (`lookupSourceNote`). `source: "homebrew"` is reserved and checked before book resolution. It lists homebrew only and needs login.
- **`getMonsterStats` never guesses.** It has no fuzzy fallback and skips homebrew. A partial name that matches several creatures is `ambiguous`, not picked. The statuses are `found` / `not-found` / `unknown-cr` / `ambiguous` / `unavailable`. A wrong CR silently skews encounters and treasure, while "supply cr manually" is recoverable.
- **Untrusted text.** Wrap any tool output containing user-authored DDB text with `wrapUntrusted()`, or `wrapIfHomebrew(text, isHomebrew)` (which wraps only when `=== true`). That covers page scrapes, book content, notes, homebrew compendium entries, homebrew or custom character content, campaign/character/user names, and raw character JSON.
  - Wrap the **whole** line or block, edition tag and book note included.
  - Character content uses one predicate: `isHomebrewEntry` / `isHomebrewClassFeature` in `src/tools/character/helpers.ts`.
  - Official `isHomebrew: false` content stays plain, so test that.
  - Details: [history.md#security-findings](docs/claude/history.md#security-findings).
- **Open5e responses are distrusted.** Reject off-origin redirects, an empty `resp.url`, empty documents, and a `count` above the records collected. A failure is never cached as data, but is remembered for 60 s per URL. Either SRD document failing fails the whole call (owner decision).
- **Caches** are generation-keyed or hook-cleared, and dedupe concurrent cold callers through a `*Pending` entry. A pending fetch may write the cache only while it is still the authoritative entry (an identity or epoch check), so `ddb_clear_cache` or a session change mid-fetch leaves nothing behind. The full monster list (`getFullMonsterList`: keys `anon:`/`gen<n>:`, 24 h or 5 min when short, 60 s scan deadline, an empty unfiltered list is never cached) follows the same rules. Read [caching.md](docs/claude/caching.md) before touching one.
- **MCP annotations.** Every registration passes one (`READ_ONLY_NET` / `READ_ONLY_LOCAL` in `server.ts`, or an inline object). Only `ddb_interact`, `ddb_download_character` and `ddb_logout` are `destructiveHint: true`. Keep annotations accurate when adding tools.
- **Safety gates.** `ddb_interact` `fill` requires `confirm_fill: true`. `ddb_get_character_raw` requires `confirm_large_response: true` (300–500 KB). `ddb_download_character` writes only under `~/Downloads` or `~/Documents`. `ddb_search_monsters` shows at most 50 entries by default, with the exact total and a size estimate; `list_all: true` lists everything, so use it only after a search has reported the count and size.
- **Character tools** take no `rules_edition` and do no twin selection. They label entries by the sheet's main edition. Prefer the `summary` or `combat` section of `ddb_get_character` over `full`.
- **Owner rulings are recorded with dates** in the docs ("owner ruling 2026-…"). Don't relitigate them. If a change would alter a ruled behaviour, put the choice to the owner with the measured impact of each option.
- Live checks run against the owner's **free** DDB account, which owns no books. "Locked" content is therefore expected, and anything that needs paid or homebrew content can't be verified live.

## Release, CI, packaging — gotchas (full detail in [release-and-ops.md](docs/claude/release-and-ops.md))

- `npm run release` requires a clean tree, being on `main`, and being up to date with `origin/main`. It runs `npm ci && npm test` first, writes the notes through `claude -p`, bumps `package.json`, `package-lock.json` and the README pins, then tags, pushes and creates the GitHub release. npm publishing happens in `npm-publish.yml` via OIDC trusted publishing (no token). The LobeHub publish runs last and is never fatal.
- **LobeHub** (`iamjameslennon-ddb-mcp`):
  - `lhm.plugin.json` is a gitignored build artifact.
  - The `identifier` cannot be reconstructed. Recover it with `lhm plugin list --output json`.
  - Re-publishing an existing version silently merges into it.
  - `lhm login` and `lhm github connect` need a human with a browser.
- **CI**:
  - It tests Node 22/24/26.
  - `cancel-in-progress` is off for `main`, because a cancelled run would strand a tag with nothing published.
  - The publish job waits for the whole ci.yml run to succeed.
  - Actions are pinned by SHA.
- **Glama builds with pnpm**:
  - Every non-builtin import needs its own `package.json` dependency (`domhandler` broke it once).
  - The `overrides` and `pnpm.overrides` blocks **must stay in sync**.
- **`@types/node` stays `^22`** to match `engines.node >=22` and the CI matrix. Bump all three together when Node 22 reaches end of life (2027-04-30).
- There is no postinstall. `getBrowser()` tries system Chrome, then lazily installs bundled Chromium, with its progress sent to **stderr** so it can't corrupt the JSON-RPC stream. `DDB_USE_BUNDLED_CHROMIUM=1` skips the system Chrome.

## Open work (history and closed items in [history.md](docs/claude/history.md))

Last updated 2026-11-11. Releases and pushes go straight to `main`. The rules-edition work (phases 1–5) is complete, as are the follow-up rounds of minors A–E, the F-2026-10-20 residuals and the combat section completeness run (I1–I3). Since v2.10.2, 324 commits are unreleased.

1. **Stateless-safe plan, Task 2 onward**: [docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md](docs/superpowers/plans/2026-09-17-stateless-safe-ddb-mcp.md). Nothing blocks it. The plan predates some moves, so refresh it first:
   - the registrations are in `src/server.ts`, not `src/index.ts`;
   - Task 1 (SDK `^1.30.0`) is already satisfied, with `^1.32.2` installed;
   - Task 5's disk cache must follow the session-lifecycle future-design rule above.

   Task 4 (delete `characterSpellBuffer`) is also unblocked.
2. **Open carry-overs that need a book-owning or homebrew account**: (b) owner-only subclass renames; (aa) slug joins for paid books; (ah) a feature-level homebrew flag on optional features; (ay) item- and background-granted action entries (wrapping is covered by synthetic tests only).
3. **Regression handover (I5)**: I5 needs new test characters on D&D Beyond, see docs/superpowers/specs/2026-11-06-regression-report.md. I4 closed 2026-11-11 (`scripts/regress-all-characters.mts`; first run vs 2.10.2 found no regressions, history.md "Whole-corpus regression script 2026-11-11"). The rest of the 2026-11-06 run is done (history.md "Regression run 2026-11-06"); B11 (monster search quality) and B12 (Critical Role books) closed 2026-11-10 (history.md "Monster search quality and Critical Role books 2026-11-10"; carry-overs (bp), (bq) are listed there; the four questions the final reviews raised were decided by the owner, recorded there as owner rulings 2026-11-10); I1–I3 closed 2026-11-09, and their carry-overs (ba)–(bo) are listed ((bg) closed, (bh) closed for save advantages) under history.md "Combat section completeness 2026-11-09".
4. **`ddb_login` live checks (Task 10b, F30/F29)**: the fix (verified sign-in, a real 180 s deadline, real errors, cancel and progress pings; tool-notes.md `ddb_login`) is unit-tested only.
   - **macOS**: pending, run by the controller after review; record the result here.
   - **Windows: pending.** The owner runs it later on a Windows machine:
     1. `npm ci && npm run build`, and point Claude Desktop's `dndbeyond` server at the local build (`node <repo>/dist/index.js`); restart Claude Desktop.
     2. Run `ddb_logout`, then `ddb_login`, and sign in with **Google** (the popup). Expect `Successfully logged in to D&D Beyond…`.
     3. `ddb_logout` again, then `ddb_login` signing in with **Wizards ID** (email and password). Expect the same.
     4. `ddb_logout`, `ddb_login`, and leave the window idle for more than 60 s: it must stay open (the 3-minute deadline; the client must not cut the call off at 60 s), and at 3 minutes reply `Login failed: Sign-in wasn't finished within 3 minutes…`.
     5. `ddb_login` again and close the window by hand: expect `Login failed: The sign-in window was closed before sign-in finished.` at once.
     6. After a successful sign-in, `ddb_list_characters` must list the characters.
     7. If the Google hand-back stalls on a white popup, decide whether to remove `--enable-automation` for the login launch (owner ruling 2026-11-12: decided after the live test).
5. **Open by design** (no change planned): (q) either Open5e document failing fails the call; (y) the sheet keeps empty slots for nameless entries; (ab) "dual-edition" means only 2024 + 2014 books.
