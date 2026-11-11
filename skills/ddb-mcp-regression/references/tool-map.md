# Tool → source map

Where each tool lives in the ddb-mcp repo, so a finding can tell the coding assistant where to start. Every tool is registered in `src/server.ts`, which holds its description, parameter schema and annotations. Problems with how a tool is described or which parameters it takes start there.

These are **suggested starting points, not confirmed causes**. You can't see the code, so write "suggested starting point: <file>" in the report, never "the bug is in <file>". The map is kept in step with the code by `tests/regression-skill.test.ts`.

Shared by many tools:
- `src/edition.ts`: every edition label (`Rules:` lines, `[2024]`/`[2014]`/… tags) and the 2024-by-default selection.
- `src/source-filter.ts`: the `source` (book) parameter.
- `src/utils.ts`: `wrapUntrusted` / `wrapIfHomebrew` (the `<untrusted_dndbeyond_content>` wrapper).
- `src/session-state.ts`, `src/session-fetch.ts`: login state and authenticated fetches.

| Tool | Source files | Notes |
|------|--------------|-------|
| `ddb_login` | `src/auth.ts`, `src/browser.ts` | Opens a separate visible browser for sign-in. |
| `ddb_logout` | `src/session-state.ts` (`revokeSession`) | Deletes the saved session; local only. |
| `ddb_close_browser` | `src/browser.ts` | |
| `ddb_clear_cache` | `src/server.ts` (calls every module's clear function) | |
| `ddb_list_characters` | `src/tools/character.ts` (`listCharacters`) | |
| `ddb_get_character` | `src/tools/character.ts`, `src/tools/character/parse.ts` and its per-section modules in `src/tools/character/` | Header `identity.ts`; HP/AC `vitals.ts`, `ac.ts`; abilities, saves, skills, senses, languages `stats.ts`; defenses `defenses.ts`; features `features.ts`; ACTIONS/BONUS/OTHER `actions.ts`, `spell-attacks.ts`, `weapons.ts`; spells `spells.ts`; inventory `inventory.ts`, `item-gate.ts`; notes `notes.ts`; edition labels `editions.ts`. |
| `ddb_character_lookup` | `src/tools/character.ts`, `src/tools/character/definition.ts` | |
| `ddb_get_character_raw` | `src/tools/character.ts` (`getCharacterRaw`) | |
| `ddb_download_character` | `src/tools/character.ts` (`downloadCharacter`, `resolveSafeSavePath`) | |
| `ddb_list_campaigns` | `src/tools/campaign.ts` | |
| `ddb_get_campaign` | `src/tools/campaign.ts` | |
| `ddb_get_party` | `src/tools/party.ts`, `src/tools/character/` | |
| `ddb_search_monsters` | `src/tools/monster-search.ts`, `src/tools/monster-service.ts`, `src/name-match.ts` | Falls back to Open5e (`src/open5e.ts`). |
| `ddb_get_monster` | `src/tools/monster.ts`, `src/tools/monster-service.ts` | Falls back to Open5e (`src/open5e.ts`). |
| `ddb_search_spells` | `src/tools/reference.ts`, `src/tools/spell-store.ts`, `src/tools/edition-search.ts` | |
| `ddb_get_spell` | `src/tools/reference.ts`, `src/tools/casting-time.ts`, `src/tools/edition-search.ts` | |
| `ddb_search_equipment` | `src/tools/reference.ts`, `src/tools/edition-search.ts` | |
| `ddb_get_equipment` | `src/tools/reference.ts`, `src/tools/weapon-mastery.ts` | |
| `ddb_search_races` | `src/tools/reference.ts`, `src/tools/edition-search.ts` | |
| `ddb_search_classes` | `src/tools/reference.ts`, `src/tools/edition-search.ts` | |
| `ddb_search_backgrounds` | `src/tools/reference.ts`, `src/tools/edition-search.ts` | |
| `ddb_search_feats` | `src/tools/reference.ts`, `src/tools/edition-search.ts` | |
| `ddb_search_class_features` | `src/tools/features-traits.ts`, `src/tools/reference.ts` | |
| `ddb_search_racial_traits` | `src/tools/features-traits.ts`, `src/tools/reference.ts` | |
| `ddb_search_rules` | `src/tools/reference.ts`, `src/open5e.ts` | Rules text comes from the Open5e SRD. |
| `ddb_get_rules` | `src/tools/reference.ts`, `src/open5e.ts` | |
| `ddb_get_condition` | `src/tools/conditions.ts` | Conditions are bundled in the repo (SRD 5.1 and 5.2.1). |
| `ddb_rate_encounter` | `src/tools/encounter.ts`, `src/tools/monster.ts` (`getMonsterStats`) | |
| `ddb_encounter_cr` | `src/tools/encounter.ts` | |
| `ddb_roll_treasure` | `src/tools/treasure.ts`, `src/treasure-limits.ts` | |
| `ddb_list_library` | `src/tools/library.ts`, `src/game-config.ts` | |
| `ddb_read_book` | `src/tools/library.ts` | |
| `ddb_search_site` | `src/tools/search.ts` | |
| `ddb_navigate` | `src/tools/navigate.ts`, `src/browser.ts` | Navigation allowlist: `ensureNavigationGuard`. |
| `ddb_get_page` | `src/tools/navigate.ts` | |
| `ddb_interact` | `src/tools/navigate.ts`, `src/server.ts` (the `confirm_click` / `confirm_fill` gates) | |
