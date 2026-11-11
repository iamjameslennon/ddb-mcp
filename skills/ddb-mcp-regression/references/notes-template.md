# Notes template

Your working memory for the run. Update it after every batch. Write each finding's evidence in full **when you find it**: the conversation may be compacted later, and the report is built from these notes only.

If you can create files, keep this as one Markdown document and replace it after each batch. If you can't, print the whole thing as a Markdown block after each batch, headed "Checkpoint <N> — save this", so the contributor can keep it and paste it back to resume.

Copy everything below the line, with nothing ticked. Tick an item only when you have done it in this run. For example, after batch 1 and part of `ddb_get_spell`, the lines read:

- `- [x] Batch 1: 39714283, 107164636, …`
- `- [ ] ddb_get_spell: normal ✓, not-found ✓, ambiguous, locked, edition, source, homebrew, logged-out` (the box stays empty until every scenario has a ✓)

---

# ddb-mcp regression notes

## Run

- Started: <YYYY-MM-DD HH:MM>
- Code under test: <branch and commit>
- Client: <name>; files: <yes / printed checkpoints>
- Account: <free / owns … / homebrew yes/no>; session at start: <existing / logged in by contributor>

## Coverage

Characters (from `test-characters.md`), batches of 8:
- [ ] Batch 1: 39714283, 107164636, 107165979, 107606626, 107607297, 107609898, 107693030, 109960413
- [ ] Batch 2: <IDs>
- [ ] Contributor's own characters, campaigns, party, library

Tools (from `coverage-matrix.md`), one line per tool, scenarios ticked as run:
- [ ] `ddb_get_spell`: normal, not-found, ambiguous, locked, edition, source, homebrew, logged-out
- [ ] <tool>: <scenarios from its `Scenarios:` line>

Spot-checks against dndbeyond.com: <character IDs done>
Logged-out pass: <not yet / done / declined>

## Findings so far

| # | Sev | Status | Finding | Where | Evidence | Criterion |
|---|-----|--------|---------|-------|----------|-----------|

Known open issues seen: <code — where>
By design seen: <entry title — where>
Improvements: <one line each>
Environment notes: <outages, session drops, retries>
Files left behind: <paths>

## Resume from

<The next batch or tool and the next step, e.g. "Batch 3, character 152570649, section combat".>
