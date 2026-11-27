# SDK v2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ddb-mcp from `@modelcontextprotocol/sdk` 1.x to the v2 packages so that it serves both MCP protocol eras (2025-11-25 and 2026-07-28) with an unchanged tool list, then release it as v3.1.0.

**Architecture:** Land the spike commit (`spike/sdk2`, `cb1e6f0`: 36 `registerTool` calls, `serveStdio`, the shutdown hook chained after it, test imports from `@modelcontextprotocol/client`) on top of current main. Check the tool contract against main's v1 build. Move the entry-point wiring into a function that tests can drive with in-memory streams, and pin both eras and the hook order there. Drop the `@hono/node-server` override, update docs, verify, review and release.

**Tech Stack:** TypeScript, Node ≥22, `@modelcontextprotocol/server@2.4.0` (dependency), `@modelcontextprotocol/client@2.4.0` (dev dependency), zod ^4.6.6, vitest, tsx.

**Spec:** `docs/claude/history.md`, sections "SDK v2 spike 2026-11-27 (stateless-safe reassessment)" (findings) and "SDK v2 regression run follow-ups 2026-11-27" (the owner's Claude Desktop run). Owner rulings 2026-11-27: the browser rework is parked (the four browser tools stay as they are); v2 aborting requests still running when stdin closes is accepted, with no workaround.

## Global Constraints

- The tool list does not change: the same 36 names, descriptions, input schemas, annotations and server instructions as main's v1 build. The only allowed differences are `$schema` (draft-07 becomes 2020-12) and the dropped `execution: {taskSupport: "forbidden"}`. No fallback is planned for a client that rejects 2020-12 (the owner's Claude Desktop run accepted it).
- The package versions are pinned exactly as in the spike: `"@modelcontextprotocol/server": "2.4.0"` in `dependencies` and `"@modelcontextprotocol/client": "2.4.0"` in `devDependencies`. `@modelcontextprotocol/sdk` goes.
- `src/` imports neither `@modelcontextprotocol/core` (Glama's pnpm needs each import to be a direct dependency) nor `@modelcontextprotocol/client` (a dev dependency).
- `engines.node` stays `>=22` and `@types/node` stays `^22`.
- Run `npm run typecheck && npm run lint && npm test` green before each commit.
- Work happens in the worktree `/Users/jameslennon/ddb-mcp-sdk2-spike` on branch `sdk2-migration`. Main is fast-forwarded to it only in Task 5 (the owner's changes go straight to main).
- Regression-script output holds other people's characters: it stays in the OS temp dir, never the repo.
- Reviewers: the repository and npm package are public and this is not a security fix, so Codex and `freellmapi/auto:reviewers` (Gemini) are allowed. Verify every reviewer claim against the code before acting on it.

## Review Focus

1. **A 2026-era client.** `server.connect()`, which every existing test uses, serves only the 2025 era. A client pinned to 2026-07-28 fails against it, even on v2 (measured 2026-11-27). Only `serveStdio` answers both eras. Pinned by `tests/protocol-eras.test.ts` (Task 2).
2. **The shutdown hook installed before `serveStdio`.** `serveStdio` assigns `transport.onclose`, so an earlier hook is dropped. A transport close would then never reach `exitNow`; only the stdin drain would remain. Pinned by the in-process entry-point test (Task 2): stdin EOF must take the "Transport closed" path.
3. **stdin EOF during a `ddb_login`.** Under v2 the transport closes on EOF, aborts the request (the accepted ruling), and the chained `onclose` exits after `closeAll()`. The login browser must be gone afterwards. Live check, Task 4 step 5.
4. **A conversion slip in a tool's description, schema or annotation.** Both eras come from the same server, so an era comparison can't see it. Contract diff against main's v1 build: Task 1 step 5.
5. **A pnpm strict install (Glama).** Every import must be a direct dependency. Greps in Task 1 step 3; live install in Task 4 step 3.

---

### Task 1: Land the spike on current main

**Files:**
- Modify (by rebase): `package.json`, `package-lock.json`, `src/index.ts`, `src/server.ts`, `src/shutdown.ts`, and the 7 test files from the spike (`tests/logout-errors.test.ts`, `regression-skill.test.ts`, `rules-edition-consistency.test.ts`, `server-browser-tools.test.ts`, `server-login.test.ts`, `server-monster-tools.test.ts`, `subclass-spells.test.ts`)

**Interfaces:**
- Produces: branch `sdk2-migration` = main + the spike commit. `src/server.ts` exports `server` (a v2 `McpServer`). `src/index.ts` calls `serveStdio(() => server, { transport })` and then `installShutdownHandlers(...)`.

- [ ] **Step 1:** In the worktree, `git checkout -b sdk2-migration spike/sdk2 && git rebase main`.
- [ ] **Step 2:** Resolve the expected conflicts.
  - `src/server.ts`, `ddb_login` handler: keep v2's `ctx.mcpReq._meta` / `ctx.mcpReq.notify` / `ctx.mcpReq.signal`, and main's `ALREADY_LOGGED_IN` reply (`3551468`).
  - `tests/server-login.test.ts`: keep the v2 `callLogin` (no result schema) and main's new "ddb_login's reply" describe.
  - Any other conflict: take main's behaviour and the spike's API.
- [ ] **Step 3: Greps.** Each of these must print nothing:
  - `grep -rn "modelcontextprotocol/sdk\|server\.tool(\|CallToolResultSchema" src tests`
  - `grep -rn "@modelcontextprotocol/core\|@modelcontextprotocol/client" src`
  - `grep -rn "extra\.\(_meta\|sendNotification\|signal\)" src`
- [ ] **Step 4:** `npm ci && npm run typecheck && npm run lint && npm test`. Expect all green, with the test count equal to main's (3556 passed, 1 skipped) or higher. Then `git rebase --continue` if it isn't finished. The commit keeps the spike's message, with the subject changed to `feat: migrate to MCP TypeScript SDK v2 (@modelcontextprotocol/server 2.4.0)`.
- [ ] **Step 5: Contract diff against main.**
  1. `npm run build` in both `/Users/jameslennon/ddb-mcp` (main, v1) and the worktree.
  2. A scratchpad script connects over stdio with a throwaway `HOME`: to main's `dist/index.js` with the v1 client (`@modelcontextprotocol/sdk` from main's `node_modules`), and to the branch's with the v2 client in `legacy` mode.
  3. It writes each server's `tools/list` result and instructions as JSON.
  4. Canonicalise both: recursively sort keys, drop every `$schema` key and the top-level `execution` key of each tool. They must be identical. Record the result for the history entry.

### Task 2: Pin both eras and the hook order through the real entry point

**Files:**
- Create: `src/start.ts`, `tests/protocol-eras.test.ts`
- Modify: `src/index.ts` (call `startStdioServer`), `src/shutdown.ts` (the docblock's stdin bullet), `tests/shutdown.test.ts` (new test, and the header comment)

**Interfaces:**
- Produces: `startStdioServer(deps: { stdin: Readable; stdout: Writable; proc: Pick<EventEmitter, "on">; closeAll: () => Promise<void>; exit: (code: number) => void; log: (line: string) => void }): void` in `src/start.ts`. It builds `new StdioServerTransport(deps.stdin, deps.stdout)`, calls `serveStdio(() => server, { transport })`, then `installShutdownHandlers({ stdin: deps.stdin, proc: deps.proc, transport, closeAll: deps.closeAll, exit: deps.exit, log: deps.log })`, then logs `D&D Beyond MCP server running on stdio\n`. `src/index.ts` becomes a call with `process.stdin`, `process.stdout`, `process`, `closeAllBrowsers`, `code => process.exit(code)` and a stderr writer, inside the existing `.catch` for fatal errors.

- [ ] **Step 1: Write `tests/protocol-eras.test.ts`.** It drives `startStdioServer` in-process with `PassThrough` streams, a fake `proc` (`EventEmitter`), `closeAll = vi.fn(async () => {})`, `exit = vi.fn()` and `log = vi.fn()`. Its client side is `Client` from `@modelcontextprotocol/client` over a small `Transport` adapter on the same two streams (newline-delimited JSON-RPC; `start`, `send`, `close`, `onmessage`). The adapter lives in the test file.
  - Test `"serves the same tools and instructions to a 2025 client and a 2026-pinned client"`: for each `versionNegotiation: { mode }` in `"legacy"` and `{ pin: "2026-07-28" }`, start a fresh server and connect, then:
    - `listTools()` has 36 tools;
    - `callTool({ name: "ddb_get_condition", arguments: { name: "grappled" } })` is not `isError` and its text contains `"Grappled"`;
    - collect the tools and `getInstructions()`.
    - Then expect the two eras' canonicalised tools and their instructions to be equal.
  - Test `"stdin EOF closes the transport and exits through the chained onclose"`: after a 2025 `initialize` round trip, `stdin.end()`, then wait up to 2 s. Expect:
    - `log` called with a line containing `"Transport closed"`;
    - `closeAll` called once;
    - `exit` called with `0`.

  The process-level `HOME` must not matter: the tools these tests call read no session.
- [ ] **Step 2: Add a test to `tests/shutdown.test.ts`:** `"chains the transport's existing onclose and still exits"`.
  - The `transport.onclose` is already a `vi.fn()` before `installShutdownHandlers` runs.
  - Call `transport.onclose!()`, then `await settle()`.
  - Expect that fn called once, `closeAll` once, and `exit` with `0`.
- [ ] **Step 3: Run both files and confirm they fail.** Run them before `src/start.ts` exists and confirm they FAIL (module not found). Then write `src/start.ts`, switch `src/index.ts` over to it, and run them again: expect PASS.
- [ ] **Step 4: Prove each guard.** Apply each mutation alone, run the named test, then restore with `git checkout -- <file>` before the next mutation:
  - In `src/start.ts`, move `installShutdownHandlers(...)` above `serveStdio(...)`. The EOF test must FAIL: the log shows only "Client disconnected (stdin ended)". Record what happens to `exit` (expect: not called within 2 s, since the drain's exit is a 30 s timer).
  - In `src/shutdown.ts`, remove `sdkOnClose?.()`. The chaining test must FAIL.
  - In `src/start.ts`, replace `serveStdio(() => server, { transport })` with `void server.connect(transport)`. The 2026 case must FAIL with "did not offer pinned protocol version".

  After the last restore, `git status --short` shows only the intended new and changed files.
- [ ] **Step 5: Fix the comments that v2 makes wrong.**
  - The `installShutdownHandlers` docblock in `src/shutdown.ts`: replace "The MCP SDK's StdioServerTransport listens only for stdin data and errors, never its end…" with this: under SDK v1 the transport never noticed stdin EOF (regression 2026-11-19 F3). Under v2 it closes on EOF and aborts requests still running (owner ruling 2026-11-27, accepted), so the chained `onclose` exits after `closeAll()`. The stdin drain stays for a transport that doesn't close by itself.
  - The `tests/shutdown.test.ts` header: say the same.
  - The comment in `src/index.ts` / `src/start.ts` on why the hook comes after `serveStdio`.
- [ ] **Step 6:** `npm run typecheck && npm run lint && npm test`, then commit: `test: pin both protocol eras and the shutdown hook order through startStdioServer`.

### Task 3: Packaging and docs

**Files:**
- Modify: `package.json` (remove the `@hono/node-server` entries from `"overrides"` and `"pnpm"."overrides"`; drop each block, and `"pnpm"` itself, if it ends up empty), `package-lock.json` (`npm install`)
- Modify: `CLAUDE.md`, `docs/claude/history.md`, `docs/claude/release-and-ops.md` (only if `grep -n "hono\|modelcontextprotocol/sdk" docs/claude/release-and-ops.md` finds something)

- [ ] **Step 1: Remove the override pair**, then run `npm install`. Check:
  - `grep -c '"node_modules/@hono/node-server"' package-lock.json` prints `0`;
  - `npm audit --omit=dev` reports 0 vulnerabilities.
- [ ] **Step 2: Update `CLAUDE.md`.**
  - Architecture paragraph:
    - tools are registered with `registerTool` (SDK v2, `@modelcontextprotocol/server`);
    - `src/start.ts`'s `startStdioServer` serves with `serveStdio`, which answers both protocol eras, and installs the shutdown hook after it (`serveStdio` assigns `transport.onclose`);
    - tests connect `server` to an in-memory transport, which serves the 2025 era only; `tests/protocol-eras.test.ts` covers both eras through `startStdioServer`.
  - Glama gotcha: "must stay in sync" becomes "must stay in sync when present (none since the SDK v2 migration)".
  - Open work item 1: done, pointing to history.md "SDK v2 migration 2026-11-27".
  - Key-modules table: add `src/start.ts`.
- [ ] **Step 3: Add a history.md section "SDK v2 migration 2026-11-27"** above "SDK v2 regression run follow-ups 2026-11-27".
  - Commits; what changed for clients (`$schema` 2020-12, no `execution` field, both eras, no fallback for 2020-12).
  - The `server.connect()` 2025-only finding; the hook order and how it is pinned; stdin EOF exits through `onclose` (ruling); the dropped override.
  - Verification results, from Task 4.
  - Reviews, from Task 5.
- [ ] **Step 4:** Checks green, then commit: `chore: drop the @hono/node-server override; document the SDK v2 migration`.

### Task 4: Verify

Use the built server (`npm run build`) on both main (`/Users/jameslennon/ddb-mcp`) and the branch. Record `git rev-parse --short HEAD` for each, and record every result for the history entry.

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test` are green on the branch.
- [ ] **Step 2: Whole corpus, main vs branch.**
  - Run `npx tsx scripts/regress-all-characters.mts` from main, then from the branch. Both use the same character cache, so D&D Beyond drift can't differ between them.
  - Each must exit 0, with 0 HEAD crashes, 0 inconsistencies and 0 new anomalies.
  - The 56 × 8 HEAD output files of the two runs must be byte-identical (`diff -r` on the two run directories' HEAD outputs). The migration touches no parse code.
- [ ] **Step 3: Glama.**
  - `git archive HEAD` into an empty scratchpad folder, then in that folder run `mise x pnpm@11.8.0 -- pnpm install`.
  - The `prepare` build must succeed, and the server must answer a 2025 `initialize` piped into `node dist/index.js`.
- [ ] **Step 4: Logged out, main vs branch.** This is the gap left open by the owner's run. A scratchpad script with a throwaway `HOME` calls the same list against main's build first, then the branch's, and saves every reply to a file:
  - `ddb_search_spells` "fireball", `ddb_get_spell` "Fireball";
  - `ddb_get_monster` "goblin", `ddb_search_monsters` `cr: "5"`;
  - `ddb_get_condition` "grappled", `ddb_get_rules` "opportunity attack";
  - `ddb_rate_encounter` (`party: [{ level: 5, count: 4 }]`, `monsters: [{ name: "Ogre", count: 2 }]`), `ddb_roll_treasure` CR 5;
  - `ddb_get_character` 107609898 summary.

  Each reply must be non-empty and not `isError`. The branch's replies must equal main's, except `ddb_roll_treasure`, which is random: compare only its first line. Record any other difference and explain it before going on.
- [ ] **Step 5: Disconnect during login.** A scratchpad script runs this; a sign-in window opens on the owner's screen.
  1. Spawn the branch's `node dist/index.js` with a throwaway `HOME`, connect a v2 client, and start `callTool({ name: "ddb_login" })` without awaiting it.
  2. After 8 s, record the server's descendant PIDs (`pgrep -P` walked recursively from the server PID; they include the login Chrome), then end the child's stdin.
  3. Expect the server to exit within 10 s, and every recorded descendant PID to be gone within 15 s (`kill -0` fails for each).
  4. Note any survivor with its command line and investigate before going on.
- [ ] **Step 6:** Fill the results into the history entry (Task 3 step 3) and commit: `docs: record the SDK v2 migration verification`.

### Task 5: Review, merge, release

- [ ] **Step 1: Adversarial review** of `git diff main...sdk2-migration`, excluding `package-lock.json`, by Codex (`codex exec --sandbox read-only --skip-git-repo-check - < prompt.md`) and `freellmapi/auto:reviewers`.
  - The prompt pastes the diff plus `src/start.ts`, `src/shutdown.ts`, `src/index.ts` and the `ddb_login` handler, and asks about the Review Focus list.
  - Verify each claim against the code. Fix confirmed ones test-first, as separate commits.
- [ ] **Step 2:** A final whole-branch review by a fresh Claude reviewer (Opus). Fix any Critical or Important finding; list Minor ones in history.md.
- [ ] **Step 3: Merge.** In `/Users/jameslennon/ddb-mcp`, run `git merge --ff-only sdk2-migration`, rerun the checks on main, then `git push origin main`.
- [ ] **Step 4: Release.** Run `npm run release minor` (3.0.0 → 3.1.0) from main with a clean tree. The script checks that the tree is clean and main is up to date with origin. It runs `npm ci && npm test`, commits the version bump, tags, pushes with `--follow-tags`, creates the GitHub release, and runs the LobeHub step. Then:
  - `gh run watch` the tag's `ci.yml` and `npm-publish.yml` runs;
  - `npm view @iamjameslennon/ddb-mcp version` must print `3.1.0`;
  - read the LobeHub step's output.
- [ ] **Step 5: Clean up.**
  - Run `npm ci && npm run build` on main. Then point Claude Desktop's `dndbeyond` server back at `/Users/jameslennon/ddb-mcp/dist/index.js` (its value before the spike check; the backup is `claude_desktop_config.json.bak-20261127-150617-pre-sdk2`), and tell the owner to restart Claude Desktop.
  - Remove the worktree (`git worktree remove /Users/jameslennon/ddb-mcp-sdk2-spike`) and delete the local branches `spike/sdk2` and `sdk2-migration`.
  - Update the project memory.
