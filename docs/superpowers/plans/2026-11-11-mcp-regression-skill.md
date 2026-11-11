# MCP Regression Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A skill (`skills/ddb-mcp-regression/`) that any contributor loads into Claude Desktop (or pastes into another MCP client) to test their local ddb-mcp build the way real users would, ending in a Markdown findings report a coding assistant can act on.

**Architecture:** A `SKILL.md` procedure plus seven reference files the testing AI reads on demand (it has only the MCP tools, never the repo). One vitest file keeps the references honest against the code: the registered tool list, each tool's input schema, `testcharacters.md` and `docs/claude/history.md`. No `src/` changes.

**Tech Stack:** Markdown (Anthropic Agent Skills format: `SKILL.md` with YAML frontmatter, reference files one level deep), vitest + `@modelcontextprotocol/sdk` in-memory transport for the sync test.

**Spec:** `docs/superpowers/specs/2026-11-11-mcp-regression-skill-design.md` (read it before any task; where this plan and the spec differ, the spec wins).

## Global Constraints

- Skill directory: `skills/ddb-mcp-regression/`; frontmatter `name: ddb-mcp-regression` (lowercase letters, digits, hyphens, ≤ 64 chars, equal to the directory name); `description` 1–1024 chars, no `<` or `>`.
- `SKILL.md` body ≤ 500 lines; every reference file sits in `skills/ddb-mcp-regression/references/` and is linked from `SKILL.md` by relative path.
- Not shipped in the npm package: `package.json` `files` stays `["dist/", "README.md"]`.
- No `src/` changes. Gate before each commit: `npm run typecheck && npm run lint && npm test`, all green.
- The tester relies on the MCP tools only; every fact it needs lives in the skill directory. Nothing it produces needs committing.
- Measure is suitability, not sameness: no step compares against an earlier version.
- Scenario vocabulary (exact strings, used by the matrix and the test): `normal`, `invalid`, `not-found`, `ambiguous`, `locked`, `edition`, `source`, `pagination`, `gate`, `logged-out`.
- Severity scale (exact): 🔴 High, 🟠 Med, 🟡 Low, ⚪ Nit. Finding status (exact): `confirmed`, `suspected`.
- Rules-edition param is `rules_edition: "2024" | "2014"`, default `"2024"` (CLAUDE.md). Owner rulings are quoted with their dates.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to `main`; do not push (the owner pushes).

## Review Focus

1. **Session drops mid-run** (cobalt token failure, expired session, another process logging out): a reasonable person expects the tester to re-check the session and ask the contributor to log in again, not to file every later failure as a finding. Pinned in Task 4 (SKILL.md section "If the session drops").
2. **D&D Beyond or Open5e is slow or down** (the 2026-11-06 run saw 5 Open5e timeouts in 8 minutes): expect one retry after a pause, then an "environment" note in the report, not a code finding. Pinned in Task 4 ("If a service is slow or down").
3. **Compaction or a new conversation mid-batch:** expect the run to resume from the last notes checkpoint without redoing or silently skipping work. Pinned in Task 3 (notes template has per-batch done markers) and Task 4 ("Resuming").
4. **Client cannot create files:** expect printed checkpoints after each batch and the report printed as Markdown at the end. Pinned in Task 4 ("If you cannot create files").
5. **Contributor's account owns books or homebrew** (not free like the owner's): locked-content expectations flip, and homebrew wrapping checks start to apply. Pinned in Task 4 ("Account type").

---

### Task 1: Sync test scaffold and test-characters reference

**Files:**
- Create: `tests/regression-skill.test.ts`
- Create: `skills/ddb-mcp-regression/references/test-characters.md`

**Interfaces:**
- Produces (in the test file, reused by later tasks, all written in Step 1): `const ROOT = fileURLToPath(new URL("..", import.meta.url))` (repo root, so the tests don't depend on the working directory); `const SKILL_DIR = join(ROOT, "skills/ddb-mcp-regression")`; `read(rel: string): string` (`readFileSync(join(ROOT, rel), "utf8")`); `idNameRows(md: string): { id: string; name: string }[]` (rows shaped `| <digits> | <name> |`, trimmed); `characterList(): { id: string; name: string }[]` (`idNameRows` over the `## Character List` section of `testcharacters.md`, from that heading to the next `## `, same rule as `scripts/regress-all-characters.mts`).
- Produces (file format): `test-characters.md` has one Markdown table whose rows start `| <id> | <name> |`, columns `ID | Name | Level | Class | Edition | Covers | Ask`. `Covers` = why the character is in the set (from `testcharacters.md` "Coverage Notes"); `Ask` = the sections and lookups the tester must request for it (see Task 4's per-character rule; at minimum `summary, combat`, plus `spells, concentration` for casters).

- [ ] **Step 1: Write the helpers above and the failing test**

```ts
describe("regression skill: test characters", () => {
  it("lists exactly the characters in testcharacters.md, by ID and name", () => {
    const key = (r: { id: string; name: string }) => `${r.id} ${r.name}`;
    const skill = idNameRows(read("skills/ddb-mcp-regression/references/test-characters.md")).map(key);
    expect(new Set(skill).size).toBe(skill.length);                  // no duplicates
    expect([...skill].sort()).toEqual(characterList().map(key).sort());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/regression-skill.test.ts`
Expected: FAIL with ENOENT on `test-characters.md` (the helpers read `testcharacters.md`, which exists).

- [ ] **Step 3: Write `references/test-characters.md`**

A one-paragraph intro (public characters; anyone can fetch them; IDs are safe to quote in reports), then the table. Fill `Edition` from the sheet's `Rules:` line (fetch with `ddb_get_character` `sections: "summary"` via this session's dndbeyond MCP tools); if those tools are unavailable, write `?` and say so under the table rather than guess. Names must match `testcharacters.md` exactly. Note the I5 gaps under the table: no Reach weapon, no save-advantage trait beyond Gnome/Barbarian, no Warlock above level 9.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/regression-skill.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test` → all green.
```bash
git add tests/regression-skill.test.ts skills/ddb-mcp-regression/references/test-characters.md
git commit -m "feat(skill): regression skill test-character reference and sync test"
```

---

### Task 2: Coverage matrix and tool → source map

**Files:**
- Create: `skills/ddb-mcp-regression/references/coverage-matrix.md`
- Create: `skills/ddb-mcp-regression/references/tool-map.md`
- Modify: `tests/regression-skill.test.ts`

**Interfaces:**
- Consumes: `read`, `SKILL_DIR` (Task 1).
- Produces (test helper): `listedTools(): Promise<{ name: string; params: string[] }[]>`, memoised (one module-level promise): connects `server` from `src/server.ts` over `InMemoryTransport.createLinkedPair()` (pattern: `tests/server-monster-tools.test.ts:16-34`), lists the tools, then `await client.close()` (the shared `server` throws "Already connected to a transport" on a second `connect` unless the first is closed), and returns each tool's name and `Object.keys(inputSchema.properties ?? {})`.
- Produces (file format, `coverage-matrix.md`): one section per tool, heading exactly ``## `ddb_<name>` ``; first line under it exactly `Scenarios: <comma-separated subset of the vocabulary>`; then one bullet per scenario: `- <scenario>: <a user request in natural words> → <what a suitable reply does>`. Inapplicable scenarios are omitted from the `Scenarios:` line; the bullets list exactly the scenarios on that line, one each, at column 0, and nothing in a section wraps the `Scenarios:` line. A closing section `## Characters` says every row of `test-characters.md` is a matrix row too, covered when its `Ask` list is done.
- Produces (file format, `tool-map.md`): one table, rows ``| `ddb_<name>` | <source files> | <notes> |``; files from the CLAUDE.md key-modules table and `docs/claude/architecture.md`. Header text: these are suggested starting points, not confirmed causes.

- [ ] **Step 1: Write the failing tests**

```ts
describe("regression skill: coverage matrix and tool map", () => {
  const VOCAB = ["normal", "invalid", "not-found", "ambiguous", "locked", "edition", "source", "pagination", "gate", "logged-out"];
  const matrixMd = () => read("skills/ddb-mcp-regression/references/coverage-matrix.md");
  const sections = (md: string) =>
    new Map([...md.matchAll(/^## `(ddb_[a-z_]+)`\n+Scenarios: (.+)$/gm)].map(m => [m[1], m[2].split(",").map(s => s.trim())]));
  /** The `- <scenario>:` bullets of one tool's section. */
  const bullets = (md: string, tool: string) => {
    const body = md.split(/^## /m).find(part => part.startsWith(`\`${tool}\``)) ?? "";
    return [...body.matchAll(/^- ([a-z-]+):/gm)].map(m => m[1]);
  };

  it("has one matrix section per registered tool, using only the vocabulary", async () => {
    const tools = await listedTools();
    const matrix = sections(matrixMd());
    expect([...matrix.keys()].sort()).toEqual(tools.map(t => t.name).sort());
    for (const [tool, scenarios] of matrix) {
      expect(scenarios, tool).toContain("normal");
      for (const s of scenarios) expect(VOCAB).toContain(s);
      expect([...bullets(matrixMd(), tool)].sort(), tool).toEqual([...scenarios].sort());   // one bullet per scenario
    }
    expect(matrixMd()).toContain("\n## Characters\n");
  });

  it("derives schema-driven scenarios from each tool's parameters", async () => {
    const matrix = sections(matrixMd());
    for (const { name, params } of await listedTools()) {
      const s = matrix.get(name)!;
      if (params.includes("rules_edition")) expect(s, name).toContain("edition");
      if (params.includes("source")) expect(s, name).toContain("source");
      if (params.some(p => ["limit", "offset", "list_all"].includes(p))) expect(s, name).toContain("pagination");
      if (params.some(p => p.startsWith("confirm_") || p === "output_path")) expect(s, name).toContain("gate");
    }
  });

  it("maps every registered tool to source files", async () => {
    const mapped = [...read("skills/ddb-mcp-regression/references/tool-map.md").matchAll(/^\| `(ddb_[a-z_]+)` \|/gm)].map(m => m[1]);
    expect(mapped.sort()).toEqual((await listedTools()).map(t => t.name).sort());
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/regression-skill.test.ts`, expected FAIL (ENOENT).

- [ ] **Step 3: Write `tool-map.md`** — one row per registered tool (36 at present; the test, not the count, is the check).

- [ ] **Step 4: Write `coverage-matrix.md`** — read each tool's description and schema (`src/server.ts`) and the CLAUDE.md invariants. Beyond the schema-driven scenarios, add by judgement: `not-found`/`ambiguous` for name lookups, `locked` where paid content can appear, `invalid` where a parameter can be malformed (bad ID, bad CR, path escape, off-site URL), `logged-out` for every tool a logged-out user can call plus the account-only ones (their refusal must be clear). Safety rows follow the spec, plus `confirm_click` (found in the code after the spec was written): gate checks first with the "no confirm" call (`click` without `confirm_click`, `fill` without `confirm_fill`, a download path outside `~/Downloads`/`~/Documents`, an off-site `ddb_navigate` URL). `confirm_large_response` is required by the schema (`z.literal(true)`), so its gate check is the client's validation error for a call without it: suitable when the error names the parameter; `ddb_interact` `click`/`fill` only on the public dndbeyond.com search box (read-only `ddb_navigate`, `ddb_get_page` and `ddb_interact` `screenshot` on public character sheets are fine, for the spot-checks); `ddb_get_character_raw` with `confirm_large_response: true` once on a small public character; `ddb_download_character` once into `~/Downloads`; `ddb_logout` only in the logged-out pass after the contributor agrees.

- [ ] **Step 5: Run to verify they pass** — same command, PASS.

- [ ] **Step 6: Gate and commit**

```bash
git add tests/regression-skill.test.ts skills/ddb-mcp-regression/references/coverage-matrix.md skills/ddb-mcp-regression/references/tool-map.md
git commit -m "feat(skill): coverage matrix and tool-to-source map, checked against the tool schemas"
```

---

### Task 3: Judgement references and templates

**Files:**
- Create: `skills/ddb-mcp-regression/references/intended-behaviour.md`
- Create: `skills/ddb-mcp-regression/references/known-open-issues.md`
- Create: `skills/ddb-mcp-regression/references/report-template.md`
- Create: `skills/ddb-mcp-regression/references/notes-template.md`
- Modify: `tests/regression-skill.test.ts`

**Interfaces:**
- Consumes: `read`, `SKILL_DIR` (Task 1).
- Produces (file formats):
  - `intended-behaviour.md`: entries headed `### <behaviour>`, each with a line `Looks like:` (what a tester would mistake for a bug) and a line `Source:` (CLAUDE.md section, or `history.md` + the owner-ruling date); both lines at column 0, and no `### ` inside code fences. Must cover at least: 2024 default and labelling; `source` wins over `rules_edition`; `source: "homebrew"`; `getMonsterStats` statuses and no guessing; monster search 50 cap + `list_all` + size estimate; untrusted wrapping (names, homebrew, party, campaign and list replies, raw JSON); official `isHomebrew: false` stays plain; safety gates; character tools take no `rules_edition`; locked content on a free account; Open5e distrust and "either document failing fails the call" (q); empty slots for nameless entries (y); "dual-edition" means 2024 + 2014 only (ab); `customItems` / `customActions` unprinted; feature visibility matching the website (Harness Divine Power, Steady Aim hidden); mastery shown only with Weapon Mastery; save-advantage capitals and long-name column overrun accepted (owner 2026-11-11); Green-Flame Blade and True Strike rows (owner 2026-11-11); edition labels not expected on login/logout/cache/browser/page replies or the `ddb_list_*` replies, while `ddb_get_party` is in scope.
  - `known-open-issues.md`: entries headed `### (<code>) <title>`, each with `Shows up as:` (what the tester will see, which character or tool). Codes, exactly: (ba), (bb), (bc), (bd), (be), (bf), (bi), (bj), (bk), (bl), (bn), (bo), (bp), (bq); account-limited (b), (aa), (ah), (ay); plus `### (B14) read_book blank lines` and `### (B14) search_spells unowned-book wording`. Not (bm) (internal refactor) and not (bg)/(bh) (closed).
  - `report-template.md`: the report skeleton (structure below).
  - `notes-template.md`: the notes/checkpoint skeleton (structure below).

- [ ] **Step 1: Write the failing tests**

```ts
describe("regression skill: judgement references and templates", () => {
  it("gives every intended behaviour a 'Looks like' and a 'Source', and covers the required topics", () => {
    const md = read("skills/ddb-mcp-regression/references/intended-behaviour.md");
    const n = md.match(/^### /gm)?.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(md.match(/^Looks like:/gm)?.length).toBe(n);
    expect(md.match(/^Source:/gm)?.length).toBe(n);
    for (const topic of ["rules_edition", "source: \"homebrew\"", "getMonsterStats", "list_all", "untrusted_dndbeyond_content",
      "isHomebrew: false", "confirm_fill", "confirm_click", "confirm_large_response", "~/Downloads", "free account", "(q)", "(y)",
      "(ab)", "customItems", "Harness Divine Power", "Weapon Mastery", "Green-Flame Blade", "True Strike", "ddb_get_party"])
      expect(md, topic).toContain(topic);
  });

  it("lists exactly the open carry-overs, none of them closed in history.md", () => {
    const history = read("docs/claude/history.md");
    const codes = [...read("skills/ddb-mcp-regression/references/known-open-issues.md").matchAll(/^### \(([A-Za-z0-9]+)\)/gm)].map(m => m[1]);
    const expected = ["ba", "bb", "bc", "bd", "be", "bf", "bi", "bj", "bk", "bl", "bn", "bo", "bp", "bq", "b", "aa", "ah", "ay", "B14", "B14"];
    expect([...codes].sort()).toEqual([...expected].sort());
    // history.md closes a carry-over as `**(bg)** ~~…~~` or "(bg) closed".
    for (const code of codes.filter(c => c !== "B14")) {
      expect(history, code).toContain(`(${code})`);
      expect(history, code).not.toMatch(new RegExp(`\\*\\*\\(${code}\\)\\*\\* ~~|\\(${code}\\) closed`));
    }
  });

  it("report template has the agreed structure", () => {
    const md = read("skills/ddb-mcp-regression/references/report-template.md");
    const order = ["## Verdict", "## Method", "## Findings", "## Known open issues", "## By design", "## Improvements",
      "## Prompts for a coding assistant", "## Discuss before building", "## Not covered", "## Files left behind"];
    const at = order.map(h => md.indexOf(`\n${h}\n`));
    expect(at.every(i => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const cell of ["Code under test", "Date", "Client", "Account", "Characters", "Tools"]) expect(md).toContain(`| **${cell}** |`);
    for (const s of ["🔴 High", "🟠 Med", "🟡 Low", "⚪ Nit", "confirmed", "suspected", "suggested starting point"]) expect(md).toContain(s);
    expect(md).toContain("| # | Sev | Status | Finding | Where | Evidence | Criterion |");
  });

  it("notes template records coverage, evidence and a resume point", () => {
    const md = read("skills/ddb-mcp-regression/references/notes-template.md");
    for (const h of ["## Run", "## Coverage", "## Findings so far", "## Resume from"]) expect(md).toContain(`\n${h}\n`);
    expect(md).toMatch(/\[x\] Batch \d+/);
  });
});
```

The `known-open-issues` regex relies on `history.md`'s closed form: `**(bg)** ~~…~~` and `(bg) closed`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/regression-skill.test.ts`, expected FAIL (ENOENT).

- [ ] **Step 3: Write `intended-behaviour.md` and `known-open-issues.md`** from CLAUDE.md, `docs/claude/history.md` and `docs/claude/tool-notes.md`. Plain language: the reader is a testing AI with no repo.

- [ ] **Step 4: Write `report-template.md`**, modelled on `docs/superpowers/specs/2026-11-06-regression-report.md` without its baseline section:
  - title `# ddb-mcp regression run — <date>`; header table (Code under test as the contributor states it, Date, Client, Account with observed ownership, Characters covered/total, Tools covered/36);
  - `## Verdict` (2–4 sentences), `## Method`;
  - `## Findings`: table `# | Sev | Status | Finding | Where | Evidence | Criterion`; Where = tool + "suggested starting point: <file>"; Evidence = user request, exact call with parameters, output excerpt, expected vs got and its source, character ID; privacy rule (placeholders for the contributor's own data, public test character preferred);
  - `## Known open issues` (code, where seen), `## By design` (looked wrong, matches `intended-behaviour.md`), `## Improvements`;
  - `## Prompts for a coding assistant`: one fenced block per area, each with symptom, evidence, expected behaviour, suggested starting files, and the instruction to find the cause, choose the fix and add tests itself, following the repo's rules (tests first; `npm run typecheck && npm run lint && npm test`; docs update; the live-snapshot flow in `docs/character-refactor.md` for character parse changes);
  - `## Discuss before building` (suspected findings, anything touching an owner ruling), `## Not covered` (matrix rows skipped and why), `## Files left behind` (download, screenshots).

- [ ] **Step 5: Write `notes-template.md`**: `## Run` (date, client, account, files available yes/no), `## Coverage` (checklist: `- [ ] Batch N: <character IDs>` and `- [ ] <tool>: <scenarios>`, ticked `[x]` (lowercase) when done; the template shows one ticked example, `- [x] Batch 1: …`), `## Findings so far` (same columns as the report, evidence written in full when found), `## Resume from` (the next batch and step).

- [ ] **Step 6: Run to verify they pass**, then gate and commit.

```bash
git add tests/regression-skill.test.ts skills/ddb-mcp-regression/references/
git commit -m "feat(skill): intended-behaviour, known-issues references and report/notes templates"
```

---

### Task 4: SKILL.md procedure

**Files:**
- Create: `skills/ddb-mcp-regression/SKILL.md`
- Modify: `tests/regression-skill.test.ts`

**Interfaces:**
- Consumes: every reference file and format from Tasks 1–3.
- Produces: the skill entry point. Section headings below are exact (the test checks them).

- [ ] **Step 1: Write the failing tests**

```ts
describe("regression skill: SKILL.md", () => {
  const skill = () => read("skills/ddb-mcp-regression/SKILL.md");
  // Frontmatter: exactly `name` then a single-line `description`, nothing else.
  const front = () => /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill());

  it("has valid frontmatter", () => {
    const m = front();
    expect(m).not.toBeNull();
    expect(m![1]).toBe("ddb-mcp-regression");
    expect(m![1]).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(m![2].length).toBeGreaterThan(0);
    expect(m![2].length).toBeLessThanOrEqual(1024);
    expect(m![2]).not.toMatch(/[<>]/);
  });

  it("stays under 500 lines and links every reference file", () => {
    expect(skill().trimEnd().split("\n").length).toBeLessThanOrEqual(500);
    const refs = readdirSync(join(SKILL_DIR, "references")).filter(f => f.endsWith(".md"));
    expect(refs.length).toBe(7);                                     // update when a reference is added
    for (const f of refs) expect(skill()).toContain(`references/${f}`);
    for (const [, link] of skill().matchAll(/\((references\/[^)#]+)(?:#[^)]*)?\)/g)) expect(existsSync(join(SKILL_DIR, link)), link).toBe(true);
  });

  it("covers the procedure and the failure modes", () => {
    for (const h of ["## Before you start", "## Account type", "## Personas", "## Batches", "## Judging a reply",
      "## Evidence", "## Safety", "## Notes and checkpoints", "## If you cannot create files", "## Resuming",
      "## If the session drops", "## If a service is slow or down", "## Logged-out pass", "## The report"])
      expect(skill()).toContain(`\n${h}\n`);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — expected FAIL (ENOENT).

- [ ] **Step 3: Write `SKILL.md`** (aim for ≤ 400 lines; every `##` heading is followed by a blank line and body text). Frontmatter: `name`, then `description` on one line, no other keys. `description`: when to use it (after changing ddb-mcp, to test a local build end to end through its MCP tools as a player and a DM would, ending in a findings report for a coding assistant). Body sections, in this order, each short and imperative:
  - `## Before you start`: confirm the dndbeyond tools are connected and which build (ask the contributor for branch/commit); list side effects up front (login window, one downloaded file in `~/Downloads`, logout at the end only with consent); check for files (try creating the notes document; see "If you cannot create files"); check for an existing session with `ddb_list_characters` before suggesting `ddb_login`.
  - `## Account type`: infer from `ddb_list_library`; record it; locked content on an account that doesn't own the book is not a finding; content of unknown ownership is "not verifiable"; homebrew checks apply only if the account has homebrew.
  - `## Personas`: player and DM; request styles (specific, vague, typo/partial name, nonexistent, unowned book, 2014 table, follow-up); pick tools as a user's AI would, record request → tool → parameters.
  - `## Batches`: order: (1) characters in batches of 8 from `references/test-characters.md`, each character's `Ask` list, one `full` request per batch to judge economy, one `ddb_character_lookup` per batch; (2) the contributor's own characters, campaigns, party and library; (3) the tool matrix (`references/coverage-matrix.md`) grouped: rules and conditions → spells → equipment and options → monsters → encounter and treasure → library and books → site search → browser tools; (4) session, cache and browser tools (`ddb_clear_cache`, `ddb_close_browser`, `ddb_navigate`, `ddb_get_page`, `ddb_interact`); (5) logged-out pass; (6) before the report, reconcile every matrix row as done or listed under "Not covered". Spot-check 3 public test characters against dndbeyond.com with read-only `ddb_navigate` + `ddb_get_page` (no click or fill on a sheet).
  - `## Judging a reply`: the seven criteria from the spec (goal 3), the edition-label scope, the "well described" attribution rule; check `references/intended-behaviour.md` then `references/known-open-issues.md` before filing.
  - `## Evidence`: confirmed vs suspected; sources allowed; locations from `references/tool-map.md` as suggested starting points; privacy placeholders.
  - `## Safety`: the spec's non-goal rules in substance, plus `confirm_click` (in the code, not named in the spec) (gate checks first; `confirm_large_response` is schema-required, so its check is the validation error; the one safe `ddb_interact` target; never a character sheet, builder, campaign or settings page; raw JSON once; download once).
  - `## Notes and checkpoints`: `references/notes-template.md`; update after every batch; write evidence in full when found.
  - `## If you cannot create files`, `## Resuming`, `## If the session drops`, `## If a service is slow or down`: per the Review Focus lines 1–4. Session-drop test: when a tool that worked fails with a login, token or session error, call `ddb_list_characters`; if that fails too, ask the contributor to log in again and re-run the failed call once; a failure that persists after a good `ddb_list_characters` is a suspected finding (it may be (bq), which turns a session change into an Open5e error).
  - `## Logged-out pass`: warn, ask, skip and record if declined; then `ddb_logout`, anonymous paths, account-only refusals, invite to log back in.
  - `## The report`: build from the notes with `references/report-template.md`; save as a Markdown document (and into the repo if the client can); else print it; close with a short chat summary (verdict, counts by severity, where the file is).

- [ ] **Step 4: Run to verify they pass**, then gate and commit.

```bash
git add tests/regression-skill.test.ts skills/ddb-mcp-regression/SKILL.md
git commit -m "feat(skill): ddb-mcp-regression SKILL.md procedure"
```

---

### Task 5: Contributor docs and sync rule

**Files:**
- Modify: `README.md` (section `## Development`, line ~614)
- Modify: `CLAUDE.md` (Commands section, after the regression-script paragraph; and "Open work" date)
- Modify: `docs/claude/history.md` (new entry after "Whole-corpus regression script 2026-11-11")
- Modify: `docs/claude/release-and-ops.md` only if it lists repo directories (check; skip otherwise)

**Interfaces:**
- Consumes: the skill directory (Tasks 1–4).

- [ ] **Step 1: README "Development"**: add "Testing your change in Claude Desktop": build (`npm run build`), point Claude Desktop at the local build (JSON `mcpServers.dndbeyond = { "command": "node", "args": ["<absolute path>/dist/index.js"] }` in the config files listed at README ~line 316, then restart Desktop), load the skill (zip the folder so the zip holds `ddb-mcp-regression/SKILL.md` and `ddb-mcp-regression/references/…`, e.g. `cd skills && zip -r ddb-mcp-regression.zip ddb-mcp-regression`, and upload it in Claude Desktop's Skills settings (Settings → Capabilities at the time of writing), which needs "Code execution and file creation" on; if the upload is rejected, zip the folder's contents instead and tell the owner so the README can be corrected; other clients: paste `SKILL.md` and attach the `references/` files), start it ("run the ddb-mcp regression skill"), and what comes back (a Markdown report to keep or attach to a PR; nothing to commit).

- [ ] **Step 2: CLAUDE.md**: under Commands, one paragraph: the skill's location and purpose, and the sync rule — adding or changing a tool, an owner ruling, a carry-over (opened or closed) or the test-character list updates `skills/ddb-mcp-regression/references/` in the same commit; `tests/regression-skill.test.ts` fails on tool, schema, character-list and closed-carry-over drift, but not on new rulings or new carry-overs, which need the manual update. Update the count in CLAUDE.md "Open work" (`Since v2.10.2, N commits are unreleased.`) to `git rev-list --count v2.10.2..HEAD` plus one for this commit.

- [ ] **Step 3: history.md entry** "Regression skill 2026-11-11": spec and plan paths, the owner answers (files when available, known-issues section, privacy placeholders, logged-out pass with consent), the reviewers used, and a line `Pilot: pending (Task 6).` that Task 6 replaces (never a made-up result).

- [ ] **Step 4: Gate and commit**

```bash
git add README.md CLAUDE.md docs/claude/history.md
git commit -m "docs: how contributors run the regression skill, and the sync rule"
```

---

### Task 6: Pilot run and fixes

**Files:**
- Modify: any skill file the pilot shows to be unclear or wrong
- Modify: `docs/claude/history.md` (pilot result)

**Interfaces:**
- Consumes: the whole skill. This session's `dndbeyond` MCP server runs `/Users/jameslennon/ddb-mcp/dist/index.js`.

- [ ] **Step 1: Build and reconnect** — `npm run build`; ask the owner to reconnect the dndbeyond server (`/mcp`) so it runs the fresh build. If the dndbeyond tools are not available to you, or the owner can't confirm the reconnect, stop and hand over: never pilot against a stale build.

- [ ] **Step 2: Run the skill on a narrowed scope**, following `SKILL.md` literally as the tester: batch 1 of the test characters only, the contributor's own content, and matrix rows for `ddb_get_spell`, `ddb_search_monsters`, `ddb_get_rules`, `ddb_rate_encounter`, `ddb_read_book`, and the gate checks only for `ddb_interact` (click and fill without confirm), `ddb_get_character_raw` (without `confirm_large_response`) and `ddb_download_character` (a path outside `~/Downloads`/`~/Documents`); no real download and no logged-out pass (record both as not covered). The notes record "no side effect observed" for each gate check. Write the notes and report under `/private/tmp/claude-501/-Users-jameslennon-ddb-mcp/dce7772a-bb09-433c-bb21-624a9a31e350/scratchpad/pilot/`, never the repo.

- [ ] **Step 3: Fix the skill** wherever following it literally was ambiguous, impossible or produced noise (a "by design" item filed as a finding means `intended-behaviour.md` is missing an entry). Re-run the affected step.

- [ ] **Step 4: Record and commit** — add the pilot result to the history entry (scope, findings count by severity, skill fixes made), gate, commit:

```bash
git add skills/ docs/claude/history.md
git commit -m "fix(skill): pilot-run fixes to the regression skill"
```

- [ ] **Step 5: Hand over** — give the owner the pilot report path and ask for a full run in Claude Desktop.
