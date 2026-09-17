# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** The original 1000-line `parseCharacterData` has been carved into per-domain modules under [src/tools/character/](src/tools/character/) (identity, vitals, ac, stats, defenses, features, weapons, actions, spells, inventory, notes, parse, definition). See [docs/character-refactor.md](docs/character-refactor.md) for the module boundaries. When changing parse behaviour, keep the live-character snapshot regression flow listed there.

## Commands

```bash
npm ci               # Install dependencies (prefer ci over install — respects the lockfile)
npm run dev          # Run in development mode (no build step, uses tsx)
npm run build        # Compile TypeScript to dist/
npm run build:watch  # Watch mode
npm run lint         # ESLint on the whole repo (src/, tests/, scripts/, root configs)
npm run typecheck    # Type-check without emitting
npm test             # Run all tests (vitest)
npm run release      # Bump version, generate release notes, publish (patch|minor|major)
                     #   accepts --dry-run (mutate files only, no commit/tag/push)
                     #   and --skip-verify (skip the `npm ci && npm test` gate)
npm run lobehub:manifest  # Regenerate lhm.plugin.json (needs dist/ — run build first)
npx vitest run tests/character-parser.test.ts  # Run a single test file
```

## Architecture

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes D&D Beyond data to Claude via stdio transport. Entry point: `src/index.ts`. All MCP tools are registered there and delegate to modules in `src/tools/`.

### Two execution paths: browser vs. browserless

The central architectural split is between tools that need a Playwright browser and tools that work entirely through the saved session cookies:

**Browserless (preferred)** — `src/session-fetch.ts`
- Reads cookies from a per-user config dir — `~/.config/ddb-mcp/session.json` on macOS/Linux, `%APPDATA%\ddb-mcp\session.json` on Windows (written by `ddb_login`)
- Exchanges cookies for a short-lived cobalt JWT via `getCobaltToken()`
- All character, monster, spell, item, and condition tools use this path
- `sessionFetch()` injects the cookie header into native Node `fetch`
- Every credential access binds to a `SessionSnapshot` from `src/session-state.ts` (see **Revocable session lifecycle** below) and re-checks on-disk authority before dispatch — a deleted/replaced session file, or a `ddb_logout` revoke, stops the old account's credentials at the next protected operation with no explicit invalidation call required

**Browser-based (Playwright)** — `src/browser.ts`
- Required for: `ddb_login` (OAuth flow, visible window), `ddb_navigate`, `ddb_interact`, `ddb_get_page`, `ddb_search_site`, `ddb_list_campaigns`, `ddb_get_campaign`, `ddb_list_library`, `ddb_read_book`
- Singleton browser/context (`getBrowser` / `getContext`) — lazy-initialized, shared across calls, bound to the generation they were opened under (an `onSessionInvalidated` hook closes and detaches the shared context/browser on every session transition, including a `ddb_logout` revoke — `revokeSession()` awaits that close and reports if it fails)
- `ddb_login` forces `headless: false`; all other browser tools use `headless: true`
- Tools that auto-close the browser call `closeBrowser()` at the end; navigate/interact tools leave it open intentionally
- Login uses a deliberately separate browser/context (`beginLoginSession()`/`endLoginSession()`) from the shared authenticated one, so a login can't reuse a possibly-revoked context and a revoke mid-login can't be raced into recreating a just-deleted session (`saveSession()` re-checks the generation it began under)

### Revocable session lifecycle — `src/session-state.ts`

Owns the single authoritative answer to "which account are we, right now?" and sits below every other module (never imports a tool module). A "generation" is an opaque, process-local, monotonically-increasing token; two `SessionSnapshot`s share a generation iff they describe the same on-disk session-file content. `captureSession()` re-reads the file on every call — this re-read, not a file watcher or mtime check, is what makes deletion/replacement/corruption observed at the next protected operation. Any observed change advances the generation, aborts in-flight work (via `AbortSignal`), detaches cached state, and fires every callback registered with `onSessionInvalidated()` (session-fetch's cobalt-JWT cache, `browser.ts`'s shared context/browser, and each tool module's account-derived cache all register one).

`revokeSession()` — the primitive behind `ddb_logout` — blocks new authenticated operations immediately (`revoked` flag, checked before any file read), invalidates in-memory state, deletes the saved session file (`rmSync(..., { force: true })`, ENOENT-safe), then `Promise.allSettled`s every registered async cleanup hook (currently just the browser close) before resolving. Repeated calls are idempotent. If file deletion or a cleanup hook throws, `revokeSession()` still leaves the process-local `revoked` flag set — no old-file reload, no silent "logout succeeded" — and rejects with an `Error` naming which step failed. A subsequent `ddb_login` clears the flag via `invalidateSessionCache() → clearRevoked()`, establishing fresh authority. See [README's Logging out section](README.md#logging-out) for the user-facing guarantee and its limits (detection is at the next protected operation, not instantaneous; stop the process for immediate termination).

**Future design note:** any later stateless-safe/browser-factory redesign must adopt this same lifecycle rather than reinvent it — factory-created browsers need to bind each created context to a captured `SessionSnapshot` and register the same kind of `onSessionInvalidated` revocation hook `browser.ts` uses today, and any future on-disk cache (e.g. a persisted spell compendium) needs a durable per-account/session key plus validation at read time, not the in-memory `generation` counter alone — it's process-local and resets on restart, so it cannot identify which account a given disk-cache entry belongs to across process restarts.

### Key modules

| File | Role |
|------|------|
| `src/index.ts` | MCP server setup, all tool registrations |
| `src/session-state.ts` | The revocable session lifecycle owner — `captureSession()`/`assertSessionCurrent()` (generation boundary check), `onSessionInvalidated()` (consumer cleanup hooks), `revokeSession()` (full revocation, behind `ddb_logout`). Session-file path resolution (`SESSION_DIR`/`SESSION_PATH`) lives here too; re-exported from `session-fetch.ts` for import compatibility. |
| `src/session-fetch.ts` | Cookie loading, cobalt JWT exchange, `sessionFetch()`, retry logic — all bound to a `SessionSnapshot` from `session-state.ts`. Module-level singleton state — intentional for single-user MCP server. Deliberately does NOT re-export `revokeSession()`; `index.ts` imports it straight from `session-state.ts`. |
| `src/browser.ts` | Playwright browser/context lifecycle, `saveSession()`. Sandbox enabled by default; set `DDB_NO_SANDBOX=1` for containers. |
| `src/auth.ts` | Login flow — navigates to DDB login, polls until redirect, saves session |
| `src/cache.ts` | Generic in-memory TTL cache (`TtlCache<T>`) with FIFO eviction |
| `src/open5e.ts` | Open5e SRD fallback — no auth required. Used when DDB is down or returns empty results. 1 h TTL cache. Stores parsed objects (not JSON strings). |
| `src/utils.ts` | Shared `stripHtml()` (strips tags, decodes HTML entities) and `wrapUntrusted()` (delimits user-authored free text in `<untrusted_dndbeyond_content>` tags, neutralizing embedded delimiters). Wrap any new tool output containing DDB user-authored text: page scrapes, book content, character notes, homebrew descriptions. |
| `src/tools/character.ts` | Public API surface — network/IO (`getCharacter`, `downloadCharacter`, `listCharacters`, fuzzy `findCharacterByName`), JSON cache, plus re-exports of `parseCharacterData` and `getDefinition` from the per-domain modules in `src/tools/character/` |
| `src/tools/character/parse.ts` | `parseCharacterData(raw, sections)` orchestrator (sections: summary/combat/spells/inventory/features/notes/concentration/full) — delegates to the per-domain modules |
| `src/tools/character/definition.ts` | `getDefinition` — searches a character's spells/feats/class features/racial traits/background/equipped items for name matches |
| `src/tools/reference.ts` | Conditions (hardcoded), spells/items/races/classes/backgrounds/feats (DDB character-service `/game-data/spells?classId=X&classLevel=20` — one request per spellcasting class, returns cantrips + leveled spells together). Provenance-tracked cache: 24 h on full success, 5 min on partial. Per-call Open5e fallback when DDB returns nothing. Exports `addCharacterSpellsToCompendium()` to seed cantrips from character JSON. |
| `src/tools/monster.ts` | Monster search and stat block via DDB monster-service, Open5e fallback |
| `src/tools/campaign.ts` | Campaign and character list via browser scraping |
| `src/tools/library.ts` | Library listing and book reading via browser. `readBook` accepts `maxChars` (default 3000) and `query` (jump to heading). |
| `src/tools/navigate.ts` | Generic browser navigation, interaction, and screenshot |
| `src/tools/search.ts` | Browser-based DDB search |
| `src/tools/encounter.ts` | Encounter difficulty rater. Supports 2024 XDMG (XP budget, Low/Moderate/High) and 2014 DMG (XP thresholds, Easy/Medium/Hard/Deadly). Exports `rateEncounter()` and `targetEncounterCr()`. |
| `src/tools/treasure.ts` | Treasure generation per XDMG tables. Exports `generateTreasure()` — individual or hoard, with magic item rolls keyed to character level. |

### Caching layers

- **Character JSON**: 60 s TTL in `character.ts`
- **Spells/items/compendium**: 24 h TTL in `reference.ts` (5 min when build was partial) — first spell call builds the full compendium by firing 8 parallel `/game-data/spells?classId=X&classLevel=20` requests, one per spellcasting class; cantrips and leveled spells come back in one response
- **Open5e responses**: 1 h TTL in `open5e.ts`
- **Cobalt JWT**: cached in-memory until 60 s before expiry, stamped with the generation it was minted under (`session-fetch.ts`)
- **Session cookies**: in-memory after first disk read; invalidated by `invalidateSessionCache()` when a new session is saved, and by `revokeSession()` (`ddb_logout`)
- **Every account-derived cache** (character JSON, spells/compendium, monster stat blocks, campaigns) registers an `onSessionInvalidated()` hook and is dropped on any session transition — login, account swap, or `ddb_logout` — not just on its own TTL expiry

### Tool notes

- `ddb_get_character` accepts a `sections` param — prefer `summary` or `combat` over `full` to save tokens
- `ddb_get_character_raw` returns raw 300–500 KB JSON and requires `confirm_large_response: true`
- `ddb_character_lookup` returns a summary list when >3 matches — refine the query to get full text
- `ddb_search_spells` / races / classes / backgrounds / feats / class_features / racial_traits all accept `limit` and `offset` for pagination
- `ddb_search_rules` / `ddb_get_rules` — SRD rules search and retrieval, no login required
- `ddb_read_book` defaults to 3000 chars; use `query` to jump to a specific heading
- `ddb_rate_encounter` accepts `edition: "2024" | "2014"` (default `"2024"`) for XDMG vs. classic DMG rules
- `ddb_roll_treasure` accepts `type: "individual" | "hoard"` and `cr` of the monster(s)
- `ddb_interact` requires `confirm_fill: true` when `action` is `"fill"` — safety gate against prompt-injection-triggered form submissions
- `ddb_download_character` `output_path` must be under `~/Downloads` or `~/Documents`
- `ddb_logout` takes no input, routes through `revokeSession()` in `session-state.ts`, and is a local-only revoke — it never calls a D&D Beyond endpoint. Repeated calls are idempotent. On a cleanup failure (file unlink or browser close) it reports the failure and stays locally revoked rather than claiming a clean logout or falling back to the old session
- Every tool registration passes an MCP annotations object (`READ_ONLY_NET` / `READ_ONLY_LOCAL` consts in `index.ts`, or an inline object for mutating tools) so clients can scope permission prompts. `ddb_interact`, `ddb_download_character`, and `ddb_logout` are the only `destructiveHint: true` tools (36 tools total). Keep annotations accurate when adding tools

### parseCharacterData notes

- **Senses**: collected from four sources — `type:"sense"` mods (2024), `type:"set"`/`type:"set-base"` mods (2014), `char.customSenses`, and `race.racialTraits[].definition.senses`. Deduplication keeps the highest value per sense. Two-pass model: pass 1 records baselines from `set`/`set-base`/customSenses/trait notes (each with its source componentId), pass 2 walks `type:"sense"` mods — same componentId as baseline = dual encoding (take max), different componentId = additive extension (e.g. Gloom Stalker Umbral Sight +30 ft on top of race darkvision).
- **Languages**: three storage mechanisms in DDB, all collected in `computeProficiencies`:
  1. `type:"language"` modifiers in `char.modifiers.*` — standard race/class/feat grants.
  2. `char.customProficiencies` entries with `type: 3` — player-added via "Custom Proficiency" UI; name is in the entry itself.
  3. `char.characterValues` entries with `typeId: 35` — `valueId` is a stringified integer pointing into the rule-data language table. Resolved client-side by DDB's React app via `/character/v5/rule-data` → `data.languages[]`. We mirror the ID→name lookup in `LANGUAGE_NAMES_BY_ID` (in `stats.ts`), covering all 115 officially-sourced languages plus Telepathy. Unknown IDs fall back to `Language #N` so homebrew never silently disappears.
  - **Refreshing the language table**: run `npx tsx scripts/dump-sourced-languages.mts`. It fetches rule-data, filters for entries with `rpgSourceId != null`, and emits TypeScript-ready Record entries grouped by source. Paste the output into the `LANGUAGE_NAMES_BY_ID` block when DDB publishes a new sourcebook.
- **Ability scores**: `type:"set"` item modifiers (e.g. Amulet of Health) floor the calculated score; `type:"bonus"` modifiers (e.g. Ioun Stone) add to it.
- **Speed**: `type:"set"` overrides the base race speed; `type:"bonus"` modifiers (e.g. Longstrider, Boots of Speed) stack on top. Applies to walk/fly/swim/climb/burrow.
- **Spells**: cross-source duplicate detection flags spells granted by both `classSpells` (prepared/known) and `char.spells.*` (auto-granted). Warning line included in output.
- **Reactions**: `char.actions.*` entries with `activationType: 4` are shown in REACTIONS (e.g. Uncanny Dodge, Deflect Missiles).
- **Feats**: `__DISGUISE_FEAT` entries appear in OTHER FEATURES; `__INITIAL_ASI` entries (2024 background ASIs) are dropped entirely.
- **Templates**: `resolveTemplates()` supports `{{variable}}`, `{{variable*n}}`, `{{variable+n}}`, `{{variable-n}}`, `{{variable/n}}` with optional `#signed`/`#unsigned` suffix. Variables: `proficiency`, `level`, `characterlevel`, `classlevel`.

### Release process

Releases are automated via `scripts/release.js` (ES module, Node built-ins only):

1. Guards: clean tree, on `main`, and not behind `origin/main` (a failed `git fetch` downgrades to a warning). Each guard warns instead of exiting under `--dry-run`
2. Resolves the `claude` binary by scanning `~/.local/share/mise/installs/node/*/bin/claude` — no shim needed
3. Runs `npm ci && npm test` before anything is written, so a broken tree can't earn a permanent tag and a public release. `npm ci` runs `prepare` (= `npm run build`), so this compiles `dist/` too. Skipped by `--dry-run`, or by `--skip-verify` when you've just run it yourself
4. Collects git log and diff since last tag; calls `claude -p` to generate plain-English release notes for DMs/players
5. Prompts for confirmation, then bumps `version` in `package.json` and `package-lock.json` directly, and rewrites the `@iamjameslennon/ddb-mcp@X.Y.Z` pins in `README.md`
6. Commits as `chore: release vX.Y.Z`, pushes tag, creates GitHub release via `gh`
7. The `npm-publish.yml` workflow triggers on GitHub release and publishes to npm using OIDC Trusted Publishing (`--provenance`, no `NPM_TOKEN` secret required)
8. Finally, best effort and never fatal: regenerates `lhm.plugin.json` and publishes the new version to the LobeHub Marketplace (see below). It runs last on purpose — the tag, GitHub release, and npm publish have all already succeeded, so a marketplace failure only warns and prints the two commands to re-run

### LobeHub Marketplace listing

Listed as **`iamjameslennon-ddb-mcp`** ([lobehub.com/mcp/iamjameslennon-ddb-mcp](https://lobehub.com/mcp/iamjameslennon-ddb-mcp)), imported from `iamjameslennon/ddb-mcp` on 2026-08-05. Published with the `lhm` CLI (`@lobehub/market-cli`).

- `lhm.plugin.json` is a **build artifact** (gitignored), generated by [scripts/generate-lobehub-manifest.mjs](scripts/generate-lobehub-manifest.mjs). Only the `LISTING_METADATA` block at the top of that script is hand-written; `version` comes from `package.json` and the ~41 KB `tools` array is dumped from `dist/index.js` over stdio (`initialize` → `tools/list`), so the published schemas are correct by construction. It runs the compiled server rather than `tsx` so `node <path>` needs no shim on Windows, and because a release has already built `dist/`
- **The `identifier` cannot be reconstructed.** The marketplace assigned it at import — it is not derived from the package name or repo slug. Recover it with `lhm plugin list --output json`, never invent one
- **A stale `version` fails silently.** Re-publishing an existing version *merges* into it instead of erroring, so the listing would simply never show the release. This is why the release script regenerates the manifest rather than trusting a checked-in copy
- A non-empty `tools` array is what sets the marketplace's "tools" capability badge; publishing as the owner also marks the version validated, dropping the "Unvalidated" badge
- `name`/`description`/`tags` are the en-US source of truth — LobeHub machine-translates the other locales from them and never overwrites an owner-provided locale (`lhm plugin i18n set` to correct one). `homepage` and `cloudEndpoint` are validated but discarded by the publish endpoint; the listing keeps the values from its original import
- **`lhm login` and `lhm github connect` need a human with a browser** — there is no token-only publish path (the M2M credentials from `lhm register` can search but cannot publish). `github connect`'s status poller gets rate-limited into printing `Too many requests` even when authorization succeeded; verify with `lhm github status` rather than trusting it

### CI / CD

- `.github/workflows/ci.yml` — runs on push/PR to `main`, three jobs: **Type Check, Lint & Build** (matrix: Node 22/24/26 — `npm ci` runs `prepare` so the install *is* the build; then typecheck → lint → test), **Security Audit** (`--omit=dev` gates the release; a second dev-inclusive audit is informational and never fails), and **Lint Workflows** (actionlint, pinned by version + SHA256, with a hard precondition that `shellcheck` is present — actionlint skips shell linting *silently* without it)
- `.github/workflows/npm-publish.yml` — triggers on GitHub release published: waits for the **whole ci.yml run** on the release commit to conclude `success` (not individual check-run names — that filter silently skipped the audit job) → `npm ci` → test → asserts npm ≥ 11.5.1 → `npm publish --access public --provenance --registry https://registry.npmjs.org/`. No `npm install -g npm@latest`: Node 24 already ships npm past the trusted-publishing floor, and pulling an unpinned npm into the only job holding `id-token: write` is the thing worth avoiding
- Both workflows pin every action to a full commit SHA with a `# v7` comment, set `permissions: contents: read` at workflow level, use `persist-credentials: false`, and set `timeout-minutes`. CI matrix tests every live Node line (22 maintenance LTS, 24 active LTS, 26 current), publish job pins Node 24
- ci.yml sets `cancel-in-progress` for every ref **except `main`** — cancelling a run on `main` would make the publish gate read `cancelled` as failure and strand a tag with nothing published
- `.github/dependabot.yml` groups npm minor/patch bumps (dev and production separately) and all GitHub Actions bumps into one PR each; majors stay ungrouped so a breaking change is never buried in a batch

### Container / MCP directory builds

`Dockerfile` at the repo root exists for MCP directories (Glama et al.), which build from a maintainer-authored Dockerfile when one is checked in and otherwise infer one with an LLM. Two-stage: stage 1 runs `npm ci` (whose `prepare` hook is the `tsc` build), stage 2 runs `npm ci --omit=dev --ignore-scripts` and copies `dist/` across. Runs as the unprivileged `node` user with `DDB_NO_SANDBOX=1`; `CMD` is the plain stdio server (`node dist/index.js`) — hosts needing HTTP/SSE wrap it themselves.

Two traps this exists to avoid, both from Glama's inferred build using **pnpm**:

1. **Undeclared transitive imports.** npm's flat `node_modules` resolves them; pnpm's strict layout does not. `domhandler` (a cheerio dep, imported by [src/tools/library.ts](src/tools/library.ts)) was undeclared and broke the build while `npm ci` and CI stayed green. Every non-builtin import needs its own `package.json` entry.
2. **`overrides` is npm-only.** pnpm reads `pnpm.overrides`, so the production-audit pins silently vanish under pnpm. Both blocks are present and **must be kept in sync**.

`.dockerignore` keeps `dist/` and `node_modules/` out of the context so the image's `dist/` always comes from its own `tsc` run. `glama.json` (`maintainers`) claims the directory listing.

### Package metadata

- Published as `@iamjameslennon/ddb-mcp` on npm (MIT licence)
- **`@types/node` is pinned to `^22`** to match the `engines: { node: ">=22" }` floor — deliberately not the latest. Types newer than the oldest supported runtime make `tsc` accept APIs that don't exist there, so a green typecheck would no longer prove the package runs on Node 22. Dependabot is configured to ignore its major bumps (`.github/dependabot.yml`). These three move together: the `engines` floor, this pin, and the CI matrix in `ci.yml` (which tests every live Node line). Node 22 is maintenance LTS until 2027-04-30 — bump all three when it goes EOL.
- `"files"` in `package.json` limits the published tarball to `dist/` and `README.md`
- `"bin": { "ddb-mcp": "dist/index.js" }` exposes `ddb-mcp` as a CLI on PATH for global installs; the entry has a `#!/usr/bin/env node` shebang preserved through `tsc`
- **No postinstall** — `getBrowser()` in `src/browser.ts` tries `chromium.launch({ channel: 'chrome' })` first, using the user's system Chrome if present (zero download for most users). On any error it falls back to bundled Chromium, which is itself lazy-fetched by `ensureChromiumInstalled()` only on first miss. The lazy installer resolves Playwright's CLI via `createRequire(import.meta.url).resolve("playwright/package.json")` (the `cli.js` neighbour) regardless of install path (npx-cache / global / local clone), then spawns `node <cli.js> install chromium` with **child stdout piped to parent stderr** so install progress doesn't corrupt the MCP JSON-RPC stream. Singleton `chromiumInstallPromise` deduplicates concurrent callers; cleared on failure so the next call retries. Set `DDB_USE_BUNDLED_CHROMIUM=1` to skip the system-Chrome attempt (escape hatch for users with broken/outdated Chrome installs)

### Browser dependencies

All content tools are now browserless. `ddb_search_site` ([search.ts](src/tools/search.ts)) delegates to the cached compendia in `reference.ts` / `monster.ts`. `ddb_list_library` ([library.ts](src/tools/library.ts)) parses the library page's embedded RSC payload (`self.__next_f.push(…)` chunks) from `sessionFetch` HTML. `ddb_read_book` fetches sourcebook pages via `sessionFetch` and walks the `<article>` tree with cheerio — DDB book chapters are server-rendered, so no JS execution is needed.

The only tools that still drive a browser are `ddb_login`, `ddb_navigate`, `ddb_interact`, and `ddb_get_page` — all inherently browser-bound (OAuth flow / live page interaction).

Browser contexts used by navigate/interact/get_page carry a navigation guard (`ensureNavigationGuard` in [navigate.ts](src/tools/navigate.ts)): top-level navigations to non-allowlisted hosts are aborted at the network layer, `interact` re-checks `page.url()` after every click, and `getCurrentPageContent` refuses to scrape any page outside the allowlist (covers data:-URL navigations, which never hit the network layer). The `ddb_login` context never passes through these functions, so the Wizards SSO redirect flow stays unguarded.
