# MCP regression skill — design

Date: 2026-11-11. Status: draft for owner approval. Reviewed by a builder check (Claude), Codex and Gemini 3.7 Flash; their points are folded in below, owner answers marked *owner 2026-11-11*, builder-settled points marked *my call*.

## Intent

Any contributor who has changed ddb-mcp can check, before pushing or opening a PR, that the server still serves its users well. They run their local build in Claude Desktop (or a similar MCP client), start one skill, and get back a Markdown findings report that they can hand to an AI coding assistant (Claude Code, Codex, …) to fix, without that assistant having to re-investigate.

The measure is **suitability, not sameness**: for each request a real user might make, is the server's reply right, complete enough, honest about its limits, and economical? A reply that differs from the last release is fine if it is suitable. Comparing against an earlier version is not part of this skill (that is `scripts/regress-all-characters.mts`, which the skill neither needs nor runs).

## Who runs it, and where

- A contributor with the repo checked out and their change built (`npm run build`), with Claude Desktop's MCP config pointing at the local `dist/index.js`. README "Development" does not explain this yet; the build adds it.
- For testing, the AI relies on **the MCP tools only**. It cannot run scripts and should not need the code: everything it needs to judge suitability and to point at the code ships inside the skill.
- Claude Desktop accepts custom skills as an uploaded zip (`SKILL.md` + reference files). Clients without skills must be able to use it as a pasted prompt plus attached reference files. *(Builder's call how to package both.)*
- **Files, when available** (*owner 2026-11-11*): Claude Desktop with "Code execution and file creation" on (the setting custom skills need anyway) can create Markdown documents, and some setups can also save into the project folder. The skill uses whatever is available and never requires it:
  - can create files: the notes and the report are Markdown files; save the report into the repo too if the client has access (nothing needs committing);
  - cannot: print a notes checkpoint as a Markdown block after every batch for the contributor to keep, and print the report as Markdown at the end.
  - Resuming in a new conversation means giving the AI the last notes file or checkpoint.

## Goals

1. **Emulate real use.** The AI plays the people who use this server, players and DMs, and makes the requests they would, in their natural forms: specific and vague, 2024 and 2014 tables, typos and partial names, things that don't exist, books the account doesn't own, follow-ups. It chooses tools and parameters as a user's AI would, rather than replaying a fixed call list, so tool descriptions and parameter design are tested too.
2. **Cover everything.**
   - Every character in `testcharacters.md` (56 at present), with the sections and lookups a user would plausibly ask for. The skill carries the character list.
   - All 36 tools, including their edge cases and safety gates.
   - The contributor's own account content too (their characters, campaigns, library), since that is what a logged-in user sees.
3. **Judge suitability on these criteria** (each finding names the one it fails):
   1. **Correct:** numbers agree with the rest of the sheet and with 5e rules for the edition; spot-check a few characters against dndbeyond.com through the browser tools.
   2. **Answers the question:** complete enough for what was asked.
   3. **Honest about limits:** locked, not found, ambiguous and unavailable are stated plainly; nothing is guessed (e.g. `getMonsterStats` never picks among ambiguous names).
   4. **Edition-labelled:** every reply that carries rules content (spells, monsters, items, species, classes, backgrounds, feats, features, traits, rules, conditions, books, characters, party, encounter and treasure) carries a `Rules:` line or inline tag, with a reason line when the other edition is shown (CLAUDE.md invariants). Login, logout, cache, browser, page and list replies are out of scope for this criterion (*my call*, from the Codex review).
   5. **Safe:** user-authored text is wrapped as untrusted; safety gates hold (`confirm_fill`, `confirm_large_response`, download paths, navigation allowlist).
   6. **Economical:** no bigger than the question needs (a `full` sheet or raw JSON for "what's my AC" is a finding against whatever steered the AI there); no garbage (`NaN`, `undefined`, entities, empty slots).
   7. **Well described:** the tool descriptions led the AI to the right tool and parameters first time. A wrong pick is attributed to a description only when a clear, unambiguous request reproduces it; otherwise it is noted as a possible request or model issue (*my call*).
4. **Evidence rule** (*my call*, from the Codex and Gemini reviews). A finding is **confirmed** only with a cited source for the expected value: another part of the same output, dndbeyond.com (via the browser tools), or the bundled references. Anything the tester can't verify that way is **suspected** and goes to "discuss before building", never stated as a bug. Locations come from the bundled tool→source map and are labelled "suggested starting point", not cause.
5. **Coverage matrix** (*my call*, from the Codex review). The skill ships a matrix with one row per tool (all 36) and its named scenarios (normal, invalid input, not found, ambiguous, locked/unavailable, `rules_edition` 2014 vs 2024, `source`, pagination and `list_all`, safety gate, logged out), each marked applicable or not, plus a per-character plan. A tool or character counts as covered when every applicable scenario has been run. The report's header lists anything not covered and why; a contributor may narrow a run only that way, never silently.
6. **Report for a fixer.** End with one Markdown document, shaped like `docs/superpowers/specs/2026-11-06-regression-report.md`:
   - header table: code under test (as the contributor states it: branch/commit), date, account state, characters and tools covered, anything skipped and why;
   - verdict;
   - method;
   - findings table: `#`, severity (🔴 High, 🟠 Med, 🟡 Low, ⚪ Nit), confirmed or suspected, finding, where (tool + suggested starting file), evidence (the user request, the exact tool call with parameters, the relevant output excerpt, expected vs got with its source, character ID where relevant), criterion failed;
   - **known open issues** (*owner 2026-11-11*): problems that match the bundled known-open-issues list (open carry-overs and nits in `docs/claude/history.md`) get their own section, with the carry-over letter, so the main findings show only what is new;
   - improvements (not bugs);
   - "by design" notes: things that looked wrong but match the intended-behaviour reference, so the reader sees they were checked;
   - ready-to-paste prompts for a coding assistant, grouped by area. Each states the symptom, the evidence, the expected behaviour and the suggested starting files, and asks the assistant to find the cause, choose the fix and add tests itself (the tester can't see the code, so it must not invent test names or fixes; *my call*, from the Gemini review). Each reminds it of the repo's rules (tests first, `npm run typecheck && npm run lint && npm test`, docs update);
   - "discuss before building": findings that would change an owner ruling or need a decision.

   The report is a Markdown document (see "Files, when available"). It never has to be committed or placed in the repo; the contributor may keep it, share it or attach it to a PR.
7. **Privacy** (*owner 2026-11-11*). Reports may be shared publicly. Wherever a public test character shows the same problem, use it as the evidence. Otherwise describe the finding with private names, IDs, campaign names, other players' names and homebrew text replaced by placeholders (`<own character A>`, `<campaign 1>`, `<player 2>`).

## Account and session

- **Logged in is the main run.** The skill first checks for an existing session (e.g. `ddb_list_characters`); only if there is none does it ask the contributor to log in (`ddb_login` opens a browser window they sign in to by hand). *My call*, from the Gemini review.
- **Short logged-out pass at the end** (*owner 2026-11-11: keep it*). The AI says that `ddb_logout` deletes the saved session, so they will have to sign in again by hand afterwards, and asks before running it; if they decline, the pass is skipped and listed as not covered. Then `ddb_logout` (tests logout itself), the anonymous paths real users hit (public test characters, monsters, rules, conditions, encounter tools) and what account-only tools say when logged out, then an invitation to log back in.
- The contributor's account may be free (owns no books) or own books and homebrew. Locked content on a free account is expected and is not a finding; the skill infers which kind of account it is (e.g. from `ddb_list_library`), records what it observed in the report header, and treats content it can't establish ownership of as "not verifiable" rather than a finding.

## Running it

- One conversation, worked in batches, relying on the client's compaction.
- Running **notes** (findings with their full evidence, the coverage matrix's progress, where to resume), updated after every batch: a file when the client can create one, else a printed checkpoint (see "Files, when available"). Evidence is written into the notes when it is found, so a compaction or a new conversation loses nothing and the final report is built from the notes, not from memory.
- Time and token use are not constrained; a contributor can trim the scope themselves, recorded as not covered (goal 5). The skill may suggest a quicker scope (e.g. one batch of characters) but defaults to the full run.

## What ships with the skill

- `SKILL.md`: the procedure: setup, personas and request styles, the batch plan, the suitability criteria, severity scale, notes discipline, report template.
- **Intended-behaviour reference:** the deliberate behaviours a tester would otherwise report, drawn from CLAUDE.md invariants and the dated owner rulings in `docs/claude/history.md` (e.g. 2024 default; `source` wins over `rules_edition`; 50-entry monster cap with `list_all`; `getMonsterStats` statuses; wrapped names and homebrew; the safety gates; locked content on free accounts; `customItems` unprinted; save-advantage capitals and long-name column overrun accepted 2026-11-11; Open5e failures fail the whole call).
- **Known open issues:** the open carry-overs and nits from `docs/claude/history.md` (at present (ba)–(bq) less the closed ones, the B14 leftovers and I5), each with how it shows up in output, so the tester files them under "known open issues" (*owner 2026-11-11*).
- **Tool → source map:** each tool and the files behind it (from the CLAUDE.md key-modules table), so findings name a suggested starting point.
- **Coverage matrix** (goal 5).
- **Test characters:** IDs, names and what each covers (from `testcharacters.md`).

All of these must be kept in step with the code: CLAUDE.md gets a line saying that adding or changing a tool, a ruling, a carry-over (opened or closed) or the test-character list updates the skill's references in the same commit.

## Non-goals

- Not a diff against a previous version, and not a replacement for `npm test` or `scripts/regress-all-characters.mts`.
- Not fixing anything. The run only reports.
- No mutating the contributor's D&D Beyond data (*my call*, from the Codex and Gemini reviews):
  - safety gates are tested first with the "no confirm" call (`fill` without `confirm_fill`, raw JSON without `confirm_large_response`, a download path outside `~/Downloads`/`~/Documents`), which proves the guard without doing the action;
  - `ddb_interact` `click`/`fill` only on one named safe target, the public site search box on a dndbeyond.com search page; never on a character sheet (sheets save automatically), builder, campaign or settings page;
  - `ddb_get_character_raw` with `confirm_large_response: true` once, on a small public test character;
  - `ddb_download_character` once, into `~/Downloads`; the report's closing note lists files left behind for the contributor to delete.

## Anti-goals

- **A noisy report.** Findings that are deliberate behaviour, or locked content on a free account, waste the fixer's time; check the intended-behaviour reference before reporting, and put near-misses under "by design".
- **Findings a fixer can't act on.** Every finding carries the exact call, output and expectation.
- **Guessing in the report.** If the tester can't tell whether something is wrong, it says so and marks it for the owner rather than asserting a bug.

## Constraints

- Lives in the repo (it versions with the tools). `.claude/` is gitignored here, so not there; *location is the builder's call* (e.g. `skills/ddb-mcp-regression/`), with a short "how to use it" in README "Development".
- Follows Anthropic's skill format (frontmatter `name`, `description`; body; reference files alongside).
- Side effects the contributor is told about up front: a file written by `ddb_download_character` under `~/Downloads`, a browser window for login, logout ending the session.

## Left to the builder

- The README "Development" addition: pointing Claude Desktop (and other clients) at a local build, and how to load the skill.

- Directory layout, file names, and how the skill zip is produced (a script, or instructions).
- The batch sizes and order, and which sections to request per character (as long as every character is exercised and the per-request choice reflects what a user would ask).
- The concrete request list per persona, within the goals above.
- The notes-file format.
- How many characters to spot-check against dndbeyond.com.
- Exact wording of the report template, within the structure above.
