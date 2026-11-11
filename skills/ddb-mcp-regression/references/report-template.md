# Report template

Build the report from your notes, not from memory, and keep this structure. Text in `<angle brackets>` is for you to replace. Keep every section heading, even when a section is empty; write "None." under it.

Rules for the whole report:
- **Severity:** 🔴 High (wrong numbers or rules a user would act on, a crash, a safety gate that doesn't hold, untrusted text left unwrapped), 🟠 Med (a missing or misleading answer, a wrong edition label, a reply far bigger than the question needs), 🟡 Low (rough edges a user can work around), ⚪ Nit (cosmetic).
- **Status:** `confirmed` only when the expected value has a cited source: another part of the same output, dndbeyond.com (via the browser tools), or the skill's references. Everything else is `suspected` and also goes under "Discuss before building".
- **Where:** the tool, then "suggested starting point: <file>" from `tool-map.md`. Never claim the cause.
- **Privacy:** prefer a public test character as evidence. For the contributor's own characters, campaigns, party members, library or homebrew, use placeholders (`<own character A>`, `<campaign 1>`, `<player 2>`) instead of names, IDs and text.

---

# ddb-mcp regression run — <YYYY-MM-DD>

| | |
|---|---|
| **Code under test** | <branch and commit, as the contributor gave them> |
| **Date** | <YYYY-MM-DD> |
| **Client** | <Claude Desktop / other>; files: <could create files / printed checkpoints> |
| **Account** | <free (owns no books) / owns: <books> / has homebrew: yes/no>, as observed via `ddb_list_library` |
| **Characters** | <covered> of <total> test characters, plus <N> of the contributor's own |
| **Tools** | <covered> of 36 tools fully covered; see "Not covered" |

## Verdict

<2–4 sentences: is the build fit to ship, the most important findings, anything that blocks.>

## Method

<How the run went: personas used, batches, the spot-checks against dndbeyond.com, whether the logged-out pass ran, interruptions (session drops, service outages) and how they were handled.>

## Findings

| # | Sev | Status | Finding | Where | Evidence | Criterion |
|---|-----|--------|---------|-------|----------|-----------|
| F1 | 🟠 Med | confirmed | <one-line statement of the problem> | `<tool>`; suggested starting point: `<file>` | User asked: "<request>". Call: `<tool>({...})`. Got: "<excerpt>". Expected: "<value>" (source: <where the expected value comes from>). Character: <ID>. | <correct / answers the question / honest about limits / edition-labelled / safe / economical / well described> |

## Known open issues

| Code | Seen where |
|------|-----------|
| <(bj)> | <tool, character ID, one line> |

## By design

<Things that looked wrong but match `intended-behaviour.md`, one line each with the entry's title, so the reader can see they were checked.>

## Improvements

<Suggestions that aren't bugs: better wording, a more useful default, a missing convenience. One line each with the tool.>

## Prompts for a coding assistant

<One fenced block per area (character sheet, monsters, catalog lookups, rules, encounters and treasure, library, browser tools). Each block:>

```
<Area>: <finding numbers, e.g. F1, F4>

Symptom: <what a user sees, in plain words>
Evidence: <the calls and excerpts from the findings table>
Expected: <the suitable behaviour, and its source>
Suggested starting point: <files from tool-map.md>

Find the cause, choose the fix and add tests yourself; the tester could not see the code, so treat the starting point as a hint.
Follow the repo's rules: read CLAUDE.md and the relevant docs/claude/ file first, write the failing test first, run `npm run typecheck && npm run lint && npm test` until green, and update the docs. For character-sheet changes, follow the live-snapshot flow in docs/character-refactor.md and run `npx tsx scripts/regress-all-characters.mts`.
```

## Discuss before building

<Suspected findings, and anything whose fix would change an owner ruling in `intended-behaviour.md`. Say what you saw, what you couldn't verify, and the choice to be made.>

## Not covered

<Every matrix scenario or character not run, with the reason: skipped by the contributor, account doesn't allow it, service down, logged-out pass declined.>

## Files left behind

<Files the run created on the contributor's machine (the downloaded character JSON in ~/Downloads, screenshots), so they can delete them. "None." if there are none.>
