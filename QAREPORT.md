# 🔍 QA Team Review Report

| Key                 | Value |
| ------------------- | ----- |
| **Branch**          | `main` (local, 71 commits ahead) |
| **Base**            | `origin/main` |
| **Files changed**   | 85 (24,753+ / 1,737−; ~6,500 diff lines in `src/` + `scripts/`) |
| **Agents deployed** | 🔒 security · 🔄 reliability · 🔗 compatibility · 📊 data-integrity · ⚡ performance · ✏️ copy · 🧑‍💻 generalist-a · 🕵️ generalist-b |
| **Date**            | 2026-10-23 |
| **Status**          | ✅ Done (2026-11-02): all 16 findings closed, 15 fixed and 1 no change, in `0789c3d..74e090b` ([plan](docs/superpowers/plans/2026-10-27-qa-findings-and-carry-overs.md)) |

> ℹ️ The run was first launched on `opencode/deepseek-v4.1-flash-free`. All 8 runs stopped at once with `Free usage limit reached` (account-wide Zen quota) before reviewing anything. The review below was run on Claude sub-agents: Opus for security and both generalists, Sonnet for the other five. Each reviewer saw only its own brief. Every finding below was checked against the code before it went into this report.

---

## 📋 Summary

- 🧩 This is rules-edition phases 3–5:
  - the shared catalog pipeline (`edition-search.ts`) with `rules_edition` and `source` on equipment, options, class features and racial traits;
  - Open5e v1 → v2, with SRD 5.2 and 5.1 selected together;
  - vendored 2024 conditions;
  - rules search on v2 rulesets;
  - `Rules:` lines and tags on character sheets, lookups and library books.
- 🔁 It also adds a shared in-flight game-config fetch per session generation, and the library slug/title join.
- ✅ Every reviewer rated the branch **LOW** risk. No one found a correctness, security or data-loss defect at Medium or above.
- 🧪 generalist-a ran 5 test files: 218/218 pass.

### Key findings

- 🟢🔁 **Convergent:** tools await `getSourceIndex()` one step after their data load, so a failing config endpoint adds about 7 s once a minute to catalog, library and lookup calls. Carry-overs (h) and (ac) cover only the character tools. Flagged by ⚡ and 🔗.
- 🟢🔁 **Convergent:** Open5e failures aren't remembered and `fetchPages` has no overall deadline. During an Open5e outage, each call waits up to 20 s again, and the encounter loop pays that once per monster. Flagged by 🔄 and ⚡.
- 🟢🔒 Two homebrew-text paths are new on this branch and are **not covered by the planned F-2026-10-20 port** (`d7d0656` predates them):
  - homebrew feat names in the `Rules:` header, which `ddb_get_party` prints for other players' characters;
  - homebrew spell descriptions in `ddb_character_lookup`, now that it reads 2024-format class spells.
- 🟢🕵️ The Open5e ambiguity list in `getMonsterStats` has no cap. A short name like `e` lists hundreds of creatures per monster entry. The D&D Beyond branch sees at most about 20.

---

## 🏁 Verdict

> ✅ **APPROVE**

Every reviewer returned LOW, so nothing blocks the push. All 16 findings are Low-priority follow-ups. #1 and #2 should go into F-2026-10-20's scope now, so the security port doesn't miss them. The rest can join the CLAUDE.md carry-over list.

---

## 👥 Agent summaries

| Agent             | Risk   | Summary |
| ----------------- | ------ | ------- |
| 🔒 security       | 🟢 LOW | No new serious risk. Open5e no longer sends user input in URLs, and the shared config fetch respects session revocation. Found two new homebrew-text paths that the planned port won't cover. |
| 🔄 reliability    | 🟢 LOW | Config and Open5e in-flight sharing is sound. Gaps are in the Open5e loader only: it caches an empty 200 for 1 h, and it has no failure memo. |
| 🔗 compatibility  | 🟢 LOW | No serialization, cache-key or tool-schema breaks. Params are additive, and removed exports have no remaining references. Risks: v2 record shape is unvalidated at full-document scale, and title resolution now depends on the config endpoint. |
| 📊 data-integrity | 🟢 LOW | Hidden counts are consistent, caches are bound to the session generation, and the 2024 condition text is correct. Two small silent paths: unknown-CR records are dropped before edition selection, and a condition partial name resolves to the first match. |
| ⚡ performance    | 🟢 LOW | Selection measured 6–44 ms over 60k entries. Three latency items: the serial source-index wait, the library page re-fetched on every read, and whole-document cold loads on the Open5e fallback. |
| ✏️ copy           | 🟢 LOW | The label system is clear and consistent. Two nits: `sourceNote` says a *default* was "ignored", and three error strings say "DnD Beyond". |
| 🧑‍💻 generalist-a   | 🟢 LOW | The commits do what their messages say, and concurrency is handled carefully. Found Open5e vs D&D Beyond filter inconsistencies, and get-path `try` blocks wide enough to report a code bug as "D&D Beyond unavailable". |
| 🕵️ generalist-b   | 🟢 LOW | Garbage responses fail cleanly. Found the uncapped Open5e ambiguity list, and that the legendary-actions preamble was lost on v2. |

**Note:** ✏️ copy findings are always non-blocking nits. 🧑‍💻 generalist-a and 🕵️ generalist-b are independent generalist reviewers used to cross-check the specialists. Their findings carry extra weight when they match a specialist's finding.

---

## 📝 Findings

Every finding below was checked against the code. CLAUDE.md carry-overs (a)–(af) and work items 4–9 were excluded.

| #  | Status  | Priority | Finding | Location | Agents | Reasoning | Suggested fix |
| -- | ------- | -------- | ------- | -------- | ------ | --------- | ------------- |
| 1  | ✅ Fixed (`1062e0f, 7f717f2`) | 🟢 Low | Homebrew feat, subclass, species and background names appear unwrapped in the `Rules:` header | `src/edition.ts:788-791` (`characterRulesLine`) | 🔒 | The `homebrew` group names every entry. The header is on every section, including `summary`, so `ddb_get_party` prints other players' homebrew names. Before this branch, `summary` held no feat names. This is new surface not covered by the `d7d0656` port (Pattern 4, prompt injection). | Count homebrew entries rather than naming them (`homebrew: 2 feats`), or wrap them. Add this location to F-2026-10-20's scope. |
| 2  | ✅ Fixed (`e22e190, cdde3fc`) | 🟢 Low | `ddb_character_lookup` now prints homebrew spell descriptions unwrapped | `src/tools/character/definition.ts:138-142`, `:75` | 🔒 | Commit `8db9433` makes the lookup also read `classSpells[].classSpells`. `formatSpellResult` prints `description` with no wrap. F-2026-10-20 lists feats, features and items for `definition.ts`, but not spells. | Add spells in `definition.ts` to F-2026-10-20's scope, and add a test with a homebrew class spell. |
| 3  | ✅ Fixed (`03fd4b0, 4f0823e, 8a5ad87, 85266d0`) | 🟢 Low | `getSourceIndex()` is awaited serially after the data load | `src/tools/reference.ts:754-755` (also `:440`, `:504`, `:688`, `:1183`), `src/tools/library.ts:148-153,230,297`, `src/tools/character/definition.ts:243` | ⚡ 🔗 🔁 | When the config endpoint is failing, the first call each minute waits through the ~7 s retry run. Carry-overs (h) and (ac) mention only the character and party paths. `resolveBookSlug` → `listLibrary()` also tags books it then discards. | Use `Promise.all([load(), getSourceIndex()])`. Have `resolveBookSlug` call `fetchLibraryBooks()`. Or fix all of these together with the (h) deadline. |
| 4  | ✅ Fixed (`c770497, aac7329`) | 🟢 Low | Open5e failures are never remembered, and paging has no overall deadline | `src/open5e.ts:60-97`; `src/tools/encounter.ts:281` | 🔄 ⚡ 🔁 | During an outage, each no-match search or monster lookup waits up to 20 s again. `rateEncounter` resolves names in series, so it pays that once per monster. A `next` chain can run 20 pages × 20 s. | Add a 30–60 s failure memo in `loadO5Document`, like `CONFIG_FAILURE_TTL_MS`. Put an overall deadline on `fetchPages`. Optionally resolve encounter names concurrently, as `treasure.ts` does. |
| 5  | ✅ Fixed (`c770497, aac7329`) | 🟢 Low | An empty or truncated Open5e 200 is cached for 1 h | `src/open5e.ts:72-90` | 🔄 | `fetchPages` ignores `count`, and the loader caches `results: []`. Every fallback then answers "not found" for an hour, unless `ddb_clear_cache all` is run. Not observed live. | Throw (so nothing is cached) when no records are kept, or when `count` is greater than the number collected. |
| 6  | ✅ Fixed (`7126109, d3faa3a`) | 🟢 Low | The `try` in `getSpell` and `getItem` also covers selection and formatting | `src/tools/reference.ts:517` (spell), `:701` (item) | 🧑‍💻 | A bug in `lookupCatalog` or `formatSpell` is shown as an Open5e answer labelled "D&D Beyond unavailable", and the real error is lost. Carry-over (i) names only `searchCatalogList`. | Put only the compendium load inside the fallback `try`. Or extend (i) to name these call sites. |
| 7  | ✅ Fixed (`367dcb4, c5e6b47`) | 🟢 Low | The Open5e ambiguity candidate list has no cap | `src/open5e.ts:1155-1162`; `src/tools/encounter.ts:287` | 🕵️ | The partial match covers about 656 creatures. The D&D Beyond branch fetches 20 (`monster.ts:854`). A short name like `e` puts hundreds of names into the reply for each monster entry. | Cap at about 20 by CR then name, plus "… and N more — use the full name". Optionally require a minimum query length. |
| 8  | ✅ Fixed (`367dcb4, c5e6b47`) | 🟢 Low | Open5e monster stats drop unknown-CR records before edition selection | `src/open5e.ts:1131-1132` | 📊 | If a 2024 record's CR isn't a `CR_XP_O5` key, its 2014 twin wins silently, and that CR feeds the encounter and treasure tools. The docstring says this is intended, and the fixtures use float CRs, so it is latent. | Select the edition first, then return `not-found` if the chosen record's CR is unknown (fail closed). |
| 9  | ✅ Fixed (`367dcb4, c5e6b47`) | 🟢 Low | Open5e v2 fields are read with no null check across whole documents | `src/open5e.ts:683-684,689` (also the sibling loaders) | 🔗 (🧑‍💻 noted as unverified) | One record with a null `rarity` or `category` throws for the whole search, which surfaces as "both failed". The fixtures are samples of 1–11 records per file, so full-document data is untested. | Use optional chaining (`i.rarity?.name`, `i.category?.name`), and add a test with a null-field record. |
| 10 | ✅ Fixed (`367dcb4, c5e6b47`) | 🟢 Low | Open5e stat blocks no longer say how many legendary actions a creature gets per round | `src/open5e.ts` (`formatO5Monster`, LEGENDARY ACTIONS) | 🕵️ | v1 printed `legendary_desc` (`origin/main:src/open5e.ts:253`). The v2 Adult Red Dragon records in both documents have no such field, so the block looks complete but leaves out the per-round count. | Derive the count if v2 carries it anywhere. Otherwise print a short "per-round uses not in the Open5e SRD data" note. |
| 11 | ✅ Fixed (`367dcb4, c5e6b47`) | 🟢 Low | `school`, `type` and `size` match exactly on Open5e but as substrings on D&D Beyond | `src/open5e.ts:345,536-537` vs `src/tools/reference.ts:451`, `src/tools/monster.ts:574-575` | 🧑‍💻 | `size: "med"` or `school: "evoc"` works on D&D Beyond and finds nothing on the fallback. This predates the branch, but the branch aligned `rarity` and left these three. | Pick one rule for all three on both paths, or document exact matching as was done for rarity. |
| 12 | ✅ Fixed (`03fd4b0, 4f0823e, 8a5ad87, 85266d0`) | 🟢 Low | `ddb_read_book` re-fetches the library page on every read when the slug join fails | `src/tools/library.ts:297-308` | ⚡ | Nothing is cached, so reading chapter by chapter repeats a full page fetch per chapter. This is exactly the paid-book case in (aa). | Add a ~60 s `TtlCache` for the parsed library list, dropped on session invalidation. |
| 13 | ✅ Fixed (`8959849`) | 🟢 Low | `sourceNote` says the *default* `rules_edition` "was ignored" | `src/edition.ts:601` | ✏️ | A user who passed only `source: "xgte"` is told a parameter they never set was ignored. | Reword it neutrally, e.g. `(xgte is a 2014 book, so its entries are listed whatever rules_edition says)`, and update `tests/edition.test.ts`. |
| 14 | ✅ Fixed (`8959849`) | 🟢 Low | "DnD Beyond" spelling in fallback errors | `src/tools/reference.ts:816`, `src/tools/monster.ts:699,841` | ✏️ | All the new output says "D&D Beyond". `reference.ts:816` was rewritten on this branch. | Change it to "D&D Beyond", after checking exact-string test assertions. |
| 15 | ✅ Fixed (`8959849`) | 🟢 Low | A condition partial name resolves to the first match | `src/tools/conditions.ts:305-306` | 📊 | Predates the branch: `"e"` gives Blinded. The output names the condition, so the risk is a misread query, not wrong data. | List the candidates when more than one condition matches. |
| 16 | ➖ No change | 🟢 Low | `check-conditions` pins a D&D Beyond app version | `scripts/check-conditions.mts:9` | 🔗 | Same pattern as `dump-sourced-languages.mts`. This is a manual check script, so runtime is unaffected. | Nothing to do now. Update the version when it breaks. |
