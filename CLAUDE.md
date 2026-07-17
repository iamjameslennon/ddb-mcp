# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** The original 1000-line `parseCharacterData` has been carved into per-domain modules under [src/tools/character/](src/tools/character/) (identity, vitals, ac, stats, defenses, features, weapons, actions, spells, inventory, notes, parse, definition). See [docs/character-refactor.md](docs/character-refactor.md) for the module boundaries. When changing parse behaviour, keep the live-character snapshot regression flow listed there.

## Commands

```bash
npm ci               # Install dependencies (prefer ci over install — respects the lockfile)
npm run dev          # Run in development mode (no build step, uses tsx)
npm run build        # Compile TypeScript to dist/
npm run build:watch  # Watch mode
npm run lint         # ESLint on src/
npm run typecheck    # Type-check without emitting
npm test             # Run all tests (vitest)
npm run release      # Bump version, generate release notes, publish (patch|minor|major)
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

**Browser-based (Playwright)** — `src/browser.ts`
- Required for: `ddb_login` (OAuth flow, visible window), `ddb_navigate`, `ddb_interact`, `ddb_get_page`, `ddb_search_site`, `ddb_list_campaigns`, `ddb_get_campaign`, `ddb_list_library`, `ddb_read_book`
- Singleton browser/context (`getBrowser` / `getContext`) — lazy-initialized, shared across calls
- `ddb_login` forces `headless: false`; all other browser tools use `headless: true`
- Tools that auto-close the browser call `closeBrowser()` at the end; navigate/interact tools leave it open intentionally

### Key modules

| File | Role |
|------|------|
| `src/index.ts` | MCP server setup, all tool registrations |
| `src/session-fetch.ts` | Cookie loading, cobalt JWT exchange, `sessionFetch()`, retry logic. Module-level singleton state — intentional for single-user MCP server. |
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
- **Cobalt JWT**: cached in-memory until 60 s before expiry (`session-fetch.ts`)
- **Session cookies**: in-memory after first disk read; invalidated by `invalidateSessionCache()` when a new session is saved

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
- Every tool registration passes an MCP annotations object (`READ_ONLY_NET` / `READ_ONLY_LOCAL` consts in `index.ts`, or an inline object for mutating tools) so clients can scope permission prompts. `ddb_interact` and `ddb_download_character` are the only `destructiveHint: true` tools. Keep annotations accurate when adding tools

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

1. Resolves the `claude` binary by scanning `~/.local/share/mise/installs/node/*/bin/claude` — no shim needed
2. Collects git log and diff since last tag; calls `claude -p` to generate plain-English release notes for DMs/players
3. Prompts for confirmation, then bumps `version` in `package.json` and `package-lock.json` directly
4. Commits as `chore: release vX.Y.Z`, pushes tag, creates GitHub release via `gh`
5. The `npm-publish.yml` workflow triggers on GitHub release and publishes to npm using OIDC Trusted Publishing (`--provenance`, no `NPM_TOKEN` secret required)

### CI / CD

- `.github/workflows/ci.yml` — runs on push/PR to `main`: typecheck → lint → build → test (matrix: Node 22/24/26) → audit
- `.github/workflows/npm-publish.yml` — triggers on GitHub release published: verifies CI passed → build → upgrades npm to latest → `npm publish --access public --provenance --registry https://registry.npmjs.org/`
- Both workflows use `actions/checkout@v7` / `actions/setup-node@v6`; CI matrix tests every live Node line (22 maintenance LTS, 24 active LTS, 26 current), publish job pins Node 24

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
