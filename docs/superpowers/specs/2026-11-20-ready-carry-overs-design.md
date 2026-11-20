# Ready carry-overs, 2026-11-20 — short design

**Intent.** Close every open item that needs no book-owning account, no new test character and no website check: the two parked bonus gates, (bv), (bu), the two parked import cycles, the (bs) round-3 minor and the 2026-11-19 deferred review minors. Sources: `docs/claude/history.md` ("Carry-overs 2026-11-20", "Carry-overs 2026-11-19" deferred minors, "Regression remediation 2026-11-13" carry-overs).

**Non-goals.** Anything blocked on paid or homebrew data ((b), (aa), (ah), (ay), (br)); items with no data shape ((bi), (bk), (bn)); recorded rulings left as they are ((bw), (ca), (q), (y), (ab), the rest of (be)); the stateless-safe plan; a release.

**Anti-goals.** No sheet number moves unless the change explains it. Monster matching is not touched by the (bv) change. The two R3 safeguards stay: a distant top hit is still "not found", and a fuzzy pick still says so on its own line.

## Owner rulings (2026-11-20)

- **(bv) the typo rule becomes a fallback.** `ddb_character_lookup` uses the typo or word-order match only when no searched name contains the query, after the usual fold. This amends the 2026-11-12 ruling (F2, F9). Measured on the 56 cached characters, with each entry's own name as the query: unrelated extra hits went from 414 (on 253 queries) to 0. Typo recall (one interior letter dropped from each word of 6+ letters) went from 2,698 to 2,697 of 2,702. The one loss is "Trace" typed for Trance, which now finds Pass without Trace. Action-name matching (`matchesAtWordStart`) is unchanged.
- **(bu) short monster names need a near-exact match.** In `isCloseName`, a query of 4 or fewer folded characters is close only within one edit, where a swapped adjacent pair counts as one edit (optimal string alignment): "Lihc" → Lich and "Orge" → Ogre still match, while Lich/Lion and Ogre/Ooze no longer do. Such a query then gets "not found" with D&D Beyond's 5 closest names. Longer queries keep R3's formula. This amends R3 (2026-11-11) for short queries only.

## Approaches considered

- **(bv):** a fallback rule (chosen: no noise, no loss of typo recall); tighter edit distances (151 extra hits left, 13 fewer typos found); leaving the rule as it is.
- **(bu):** a stricter rule for short names (chosen: a false friend becomes a not-found reply that still names it); keeping R3 and pinning it with a test.
- The rest has one sensible way each (below).

## The design, item by item

1. **Bonus gates (parked 2026-11-20).**
   - A `bonus <skill>` modifier (`computeSkillBonuses`' `flatBonus`) and a `bonus initiative` modifier (`computeInitiative`) count only while their source is active. That is the (bc) rule: an item's only while `isActiveItemMod`, a class or subclass bucket's only while `isVisibleAction`.
   - One bucket-walking helper serves saves, ability checks, skills, initiative and the save-advantage loop (it closes the 2026-11-19 Task 10 minor about the two bucket loops).
   - The value logic stays: `value`, then `fixedValue`, then `statId`, and initiative's `bonusTypes` [1] proficiency-bonus case.
   - Measure on the whole corpus. Any number that moves is reported with the character and the source that caused it.
2. **(bu) part 1, the closest flag.**
   - Reading the code, `lookupByName` never leaves a group that matches or contains the query, so a locked match ends in Open5e or "not found", never another creature.
   - Pin that with a test. If the test shows it can happen, judge the flag on the shown entry instead.
   - Correct the record either way.
3. **Import cycles.**
   - `normalizeName` moves into `name-match.ts`, and `edition.ts` re-exports it, so existing imports keep working.
   - `server.ts` (and any other caller) imports `getDefinition` from `character/definition.ts`, and `character.ts` drops the re-export.
   - The no-cycle test widens from `src/tools/character/` to all of `src/`.
4. **(bs) round-3 minor.** When a browser-tool page operation rejects and the session has moved, the tool reports `SessionChangedError`, not Playwright's error. One wrapper per tool path.
5. **Deferred review minors (2026-11-19).** The test gaps and the small cleanups not already fixed:
   - Task 2 `_msg_` pin and the no-op mock trap;
   - Task 3 test tidy-ups and CRLF/U+2028 cases;
   - Task 4 override tests;
   - Task 5 EQUIPPED tests;
   - Task 6 proficiency-bonus cases and an `isAdd` helper;
   - Task 7 tool-notes wording, the stale docstring, the shared level check and stronger tests;
   - Task 8 name helper and test gaps;
   - Task 9 speed tests and the `set` null check;
   - Task 10 tests;
   - Task 11 tests and the double build;
   - Task 12 comment and test-name fixes.

   A minor that changes output is measured on the corpus. If it moves a line, it goes to the owner instead of in.

## Records

- `history.md`: a new section holding the two rulings above, commits, measurements and reviews. Mark the amended rulings, close (bu) and (bv), and remove the parked items and the deferred minors handled here.
- `tool-notes.md`: the lookup matching note and the `ddb_get_monster` R3 note.
- The regression skill's `references/` (`known-open-issues.md`, and `intended-behaviour.md` where the rulings are cited), in the same commit as each behaviour change.
- `CLAUDE.md` Open work.

## Verification

`npm run typecheck && npm run lint && npm test` before each commit; `scripts/regress-all-characters.mts` against v2.10.2 for the bonus gates and any output-affecting minor; an adversarial review per behaviour change (Codex or the router for public code, per the global reviewer rules), with every claim checked against the code.

## Left to the builder

Helper names, test file placement, commit split, and the order of the minors.
