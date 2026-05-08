# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm ci               # Install dependencies (npm install is blocked — use npm ci)
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
- Reads cookies from `~/.config/ddb-mcp/session.json` (written by `ddb_login`)
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
| `src/utils.ts` | Shared `stripHtml()` utility — strips tags and decodes HTML entities. Imported by `character.ts` and `reference.ts`. |
| `src/tools/character.ts` | Character fetch, `parseCharacterData(raw, sections)` (sections: summary/combat/spells/inventory/features/full), definition lookup, fuzzy name resolution |
| `src/tools/reference.ts` | Conditions (hardcoded), spells/items/races/classes/backgrounds/feats (DDB character-service, 24 h cache, Open5e fallback). Exports `addCharacterSpellsToCompendium()` to seed cantrips from character JSON. |
| `src/tools/monster.ts` | Monster search and stat block via DDB monster-service, Open5e fallback |
| `src/tools/campaign.ts` | Campaign and character list via browser scraping |
| `src/tools/library.ts` | Library listing and book reading via browser. `readBook` accepts `maxChars` (default 3000) and `query` (jump to heading). |
| `src/tools/navigate.ts` | Generic browser navigation, interaction, and screenshot |
| `src/tools/search.ts` | Browser-based DDB search |
| `src/tools/encounter.ts` | Encounter difficulty rater. Supports 2024 XDMG (XP budget, Low/Moderate/High) and 2014 DMG (XP thresholds, Easy/Medium/Hard/Deadly). Exports `rateEncounter()` and `targetEncounterCr()`. |
| `src/tools/treasure.ts` | Treasure generation per XDMG tables. Exports `generateTreasure()` — individual or hoard, with magic item rolls keyed to character level. |

### Caching layers

- **Character JSON**: 60 s TTL in `character.ts`
- **Spells/items/compendium**: 24 h TTL in `reference.ts` (first spell call builds the full compendium — slow)
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

### parseCharacterData notes

- **Senses**: collected from four sources — `type:"sense"` mods (2024), `type:"set"`/`type:"set-base"` mods (2014), `char.customSenses`, and `race.racialTraits[].definition.senses`. Deduplication keeps the highest value per sense.
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
3. Prompts for confirmation, then bumps `version` in `package.json` and `package-lock.json` directly (avoids `preinstall` guard)
4. Commits as `chore: release vX.Y.Z`, pushes tag, creates GitHub release via `gh`
5. The `npm-publish.yml` workflow triggers on GitHub release and publishes to npm using OIDC Trusted Publishing (`--provenance`, no `NPM_TOKEN` secret required)

### CI / CD

- `.github/workflows/ci.yml` — runs on push/PR to `main`: typecheck → lint → build → test → audit
- `.github/workflows/npm-publish.yml` — triggers on GitHub release published: ci → build → `npm publish --access public --provenance`
- Both workflows use Node 22 and `actions/checkout@v4` / `actions/setup-node@v4`

### Package metadata

- Published as `@iamjameslennon/ddb-mcp` on npm (MIT licence)
- `"files"` in `package.json` limits the published tarball to `dist/` and `README.md`
- Global install (`npm install -g`) auto-runs `npx playwright install chromium` via `postinstall`
- `preinstall` blocks `npm install` for local development — always use `npm ci`

### Ongoing work: removing browser dependencies

Several tools still use Playwright for scraping pages that should use REST APIs instead. The remaining tools to convert are: `list_campaigns`, `get_campaign`, `search`, `list_library`.
