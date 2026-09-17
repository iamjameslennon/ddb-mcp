# Security Remediation Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` or `executing-plans` skill to implement this plan task by task. Track progress with the checkboxes below.

**Goal:** Remediate the three findings from the 2026-09-16 full-repository security scan without changing the server's single-user stdio deployment model.

**Architecture:** Use shell-free Git arguments in release tooling, enforce explicit work limits at both treasure entry points, and give credentials, browsers, and account-derived caches one revocable session lifecycle. Ship the first two fixes independently; implement the session fix as a coordinated change across its consumers.

**Tech stack:** Node.js 22+, TypeScript, ES modules, Zod, Vitest, Playwright, native fetch, and Git.

---

## Status and evidence

**Status: planned; implementation and regression tests have not been performed.** This document records proposed changes, not proof that the vulnerabilities are fixed. The user requested a repository remediation plan, not implementation or publication.

- Scan: `81651f86-0ee5-4afd-90e3-34200ae4f3bb`.
- Reviewed revision: `35e7467f18df9273f2a07fe2ef2dc9333c74be76`, plus the existing untracked stateless-design document.
- Coverage: 73 tracked/untracked source-scope files; static source review, with an independent baseline and focused investigations.
- Findings: three low-severity findings under the local, single-user threat model. No live-account exploit, release execution, resource-exhaustion payload, or online dependency-advisory audit was performed.
- Source locations below refer to that reviewed revision. Reconcile them with current code before implementation. Finding IDs provide durable traceability without relying on temporary scan-output paths.

| Order | Finding and ID | Root control | Required outcome |
| --- | --- | --- | --- |
| 1 | Release tooling executes shell syntax in Git tag names — `csf_647bea407ea0cc518d71fa16` | [scripts/release.js](../../../scripts/release.js), lines 218–239 | Git metadata never becomes shell syntax in either history command. |
| 2 | Large treasure counts can exhaust the MCP process — `csf_40fc47afbaab7c47285ad438` | [src/index.ts](../../../src/index.ts), lines 904–907; [src/tools/treasure.ts](../../../src/tools/treasure.ts), lines 459–528 and 585–591 | Invalid work is rejected before lookup or allocation; accepted work and output have practical upper bounds. |
| 3 | Documented logout leaves a running server authenticated — `csf_6775f0a69d68d9ca74541f9f` | [src/session-fetch.ts](../../../src/session-fetch.ts), lines 112–120 and 172–180 | Logout or observed session-file replacement revokes the previous account's credentials, browser state, cached data, and pending results. |

Release injection requires an attacker-controlled imported tag selected by `git describe` and a maintainer running the POSIX release workflow; an ordinary PR is insufficient. Treasure exhaustion requires tool-call access and a resolvable monster. Logout failure requires access to an already authenticated process that remains running after file deletion. Reassess severity if a shared or remotely accessible wrapper changes those prerequisites.

## Delivery boundaries

Use three reviewable changes: release handling, treasure limits, then session lifecycle. The first two can be implemented in parallel. The session work below has internal dependencies and should land together with its regression suite.

The [stateless-safe design](../specs/2026-08-11-stateless-safe-ddb-mcp-design.md) is a future design, not an existing mitigation. Its browser factory can consume the lifecycle proposed here later. Do not make these fixes depend on its tool removals, SDK migration, disk-cache design, or spell-compendium redesign.

Before coding, recheck the working tree and preserve unrelated work. All proposed tests use local fixtures, mocked network/browser operations, and temporary files. Do not run `npm run release`, even with `--dry-run`, as a regression check: that path can invoke external CLIs and mutate version files.

## Task 1: Remove tag-to-shell interpretation

**Files**

- Create `scripts/release-history.mjs`: side-effect-free history collection using Node built-ins.
- Modify `scripts/release.js`: replace its inline tag/log/diff block with the helper.
- Create `tests/release-history.test.ts`: process-boundary and fallback tests.

- [ ] Add a focused regression test with an injected Git runner. Return a literal tag such as `v2.10.2$(id)` from `describe`; assert the complete tag is one argument to revision resolution, both history commands use the resolved object ID, and no shell option is enabled. This is test data only; never interpolate it into a test shell command.
- [ ] Exercise tagged history, an untagged repository, no commits since the last tag, revision-resolution failure, and Git command failure. In an untagged repository, keep the existing full-log behavior. Define the diff base from the root commit; if multiple roots are returned, fail with a clear error instead of interpolating a multiline value.
- [ ] Extract `collectReleaseHistory()` with an injectable `runGit(args)` dependency. Importing the helper must not run the release entry point, fetch remotes, run verification, invoke Claude, or change files. Resolve a selected tag to a commit before constructing revision ranges. Keep the original display tag only as text for messages.

The process boundary must have this shape:

```js
import { execFileSync } from "node:child_process";

export function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function resolveReleaseCommit(tag, git = runGit) {
  const oid = git(["rev-parse", "--verify", "--end-of-options", `${tag}^{commit}`]);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(oid)) {
    throw new Error("Git returned an invalid release commit ID.");
  }
  return oid;
}
```

For tagged history, use `runGit(["log", `${oid}..HEAD`, "--pretty=format:%h %s (%an)"])` and `runGit(["diff", "--stat", `${oid}..HEAD`])`. For untagged history, omit the log range and use a validated root commit ID for the diff. Detect absence of a reachable tag deliberately; do not convert an arbitrary Git error into a successful empty history.

- [ ] Replace both vulnerable commands in `scripts/release.js` with the helper result. Preserve the later confirmation, version calculation, and publication sequence. A tag-name restriction may be additional protection, but must not substitute for disabling the shell.
- [ ] Run `npm test -- tests/release-history.test.ts`. Expected: all tests pass, with no external commands except explicitly mocked calls or shell-free Git operations in temporary repositories. Test the extraction against the old behavior first so the regression demonstrably catches the shell boundary.
- [ ] Review the remaining release `execSync` uses for repository-derived interpolation. Convert any sibling occurrence of the same failure; do not introduce an unrelated rewrite of publication automation.

**Acceptance:** Both log and diff use shell-free argument arrays; a metacharacter-bearing tag cannot cause an additional command. A failure to resolve a selected tag aborts. The same safe history helper is used during normal and dry-run execution.

## Task 2: Bound treasure work and output

**Files**

- Create `src/treasure-limits.ts`: shared policy constants and runtime validation.
- Modify `src/index.ts`: `ddb_roll_treasure` schema and description.
- Modify `src/tools/treasure.ts`: early work-budget checks and bounded formatting.
- Extend `tests/treasure.test.ts`; create `tests/treasure-limits.test.ts` for schema/runtime agreement.
- Modify `README.md`: document accepted limits and errors.

Use these proposed initial limits. They are conservative product defaults, not measured performance thresholds:

```ts
export const MAX_TREASURE_ENTRIES = 20;
export const MAX_MONSTER_COUNT = 100;
export const MAX_INDIVIDUAL_ROLLS = 100;
export const MAX_MONSTER_NAME_CHARS = 200;
export const MAX_TREASURE_OUTPUT_CHARS = 32_000;
```

Apply the per-entry count, array, and name limits to both treasure types. Apply the aggregate roll limit only to individual treasure; a hoard still makes one roll based on the highest CR. This intentionally rejects previously accepted oversized inputs. Never clamp a requested count silently.

- [ ] Add tests for 101 monsters of one type, 20 entries whose aggregate count is 101, 21 entries, an overlong name, zero/negative/fractional/unsafe-integer counts, and an empty list. Assert rejection occurs before `getMonsterStats` or any random roll. Use small just-over-limit values when establishing the failing integration tests so the old implementation cannot exhaust the test process. Test unsafe integers against the isolated validator first; only route those values through `generateTreasure` after its early guard is in place.

Example regression within the existing mocked treasure suite:

```ts
it("rejects excess individual work before monster lookup", async () => {
  const result = await generateTreasure({
    monsters: [{ name: "Goblin", count: 101 }],
    treasureType: "individual",
  });
  expect(result).toMatch(/^Error: /);
  expect(mockGetMonsterStats).not.toHaveBeenCalled();
});
```

- [ ] Add an early validator in `src/treasure-limits.ts` that returns an error string or `null`. Its input is the structural subset `{ monsters?: Array<{ name: string; count: number }>; treasureType: "individual" | "hoard" }`; it must not import the treasure implementation. Check array length before iterating, each count with `Number.isSafeInteger`, name length, then the aggregate roll budget. Validate before deduplicating/resolving names so unresolved or repeated names cannot bypass the budget.
- [ ] Call that validator in `generateTreasure` after the existing `cr`/`monsters` exclusivity checks and before any lookup. Preserve the function's existing `Error: ...` return convention. Share constants with the MCP schema: `.max(MAX_MONSTER_COUNT)`, `.max(MAX_TREASURE_ENTRIES)`, and bounded nonempty names. Runtime validation remains mandatory because direct callers bypass Zod.
- [ ] Bound the formatter as well as the loop. Limit displayed input/resolved names to 200 characters. Build output through a capped line accumulator that reserves space for totals and an explicit omission message; stop adding detail before 32,000 characters rather than building an unbounded string and slicing it afterward. Preserve full aggregate coin totals when detail is omitted. Apply the same output budget to the unresolved-name and hoard descriptions.
- [ ] Cover exactly 100 individual rolls, mixed entries totaling 100, repeated/unresolved names, direct-CR requests, and ordinary hoards. Assert unchanged totals and ordinary output, at most 100 per-roll lines, and final output length at most 32,000 characters. Give the monster mock an oversized upstream display name to prove source response length cannot defeat the output cap.
- [ ] Run `npm test -- tests/treasure.test.ts tests/treasure-limits.test.ts`. Expected: limits agree across schema and direct calls; rejected requests do zero lookup/roll work; existing small-request tests still pass.
- [ ] Update tool descriptions and README with the exact limits, including the shared per-entry restriction for hoards. Error messages must state the violated limit and how to reduce the request.

**Acceptance:** Every entry point rejects over-budget requests before expensive work. Accepted individual requests perform at most 100 rolls, lookup fan-out is bounded by 20 entries, and every result is at most 32,000 characters. No silent count truncation or aggregate-total changes occur.

## Task 3: Define one revocable session lifecycle

**Files**

- Create `src/session-state.ts`: authoritative session snapshot, generation, transition notification, and cancellation.
- Modify `src/session-fetch.ts`: validate current authority before cached cookie/JWT access and bind authenticated requests to one snapshot.
- Extend `tests/session-cache.test.ts`; create `tests/session-state.test.ts` and `tests/session-lifecycle.test.ts`.

### Contract

Treat the session file as local authority. Before a protected operation or an account-derived cache hit, check the current file. Deletion, unreadability, malformed content, or changed credentials revoke the old generation. Local logout does not revoke DDB's remote session globally; a request already sent cannot be recalled.

Prefer reading and comparing the small file's content at operation boundaries over using only size/mtime, which can miss equal-sized replacements. Keep credentials and comparison material private in memory. An unchanged file may reuse parsed cookies and the JWT; an unchanged expired cookie/token must still obey existing expiry checks. A file watcher can accelerate cleanup but is not the correctness mechanism.

The lifecycle owner sits below tools and browsers to avoid an import cycle. Give it these explicit responsibilities:

| Proposed API | Contract |
| --- | --- |
| `captureSession()` | Refresh file authority; return an immutable validated snapshot or anonymous state, an opaque generation, and an abort signal. |
| `assertSessionCurrent(snapshot)` | Refresh authority and throw `SessionChangedError` if the snapshot is obsolete. |
| `onSessionInvalidated(callback)` | Register synchronous state detachment/clearing plus tracked asynchronous cleanup. Return an unsubscribe function. |
| `invalidateSessionState()` | Advance generation, abort old work, detach old state, and notify consumers. |
| `revokeSession()` | Block new authenticated operations, invalidate memory, remove the saved session, await browser cleanup, then report completion or a specific cleanup error. |

Keep `SESSION_PATH`, `SESSION_DIR`, and `invalidateSessionCache()` compatible for existing imports, re-exporting/delegating from `session-fetch.ts` as necessary. The lifecycle module must not import tool modules. Register hooks once per module lifetime; isolate them in tests with module resets or explicit unsubscribe.

- [ ] Write the missing regression first: warm cookies and JWT, delete the temporary file **without** calling `invalidateSessionCache`, then perform an authenticated operation. Assert no previous Cookie or Bearer is sent. The existing deletion test manually invalidates first and does not establish this property.
- [ ] Cover atomic replacement, equal-length changed content with preserved timestamps, malformed/unreadable files, unchanged valid files, and deletion when already logged out. File errors must clear stale authority; public operations may continue anonymously where already supported.
- [ ] Implement the lifecycle owner and adapt cookie/JWT access. Keep POSIX permission tightening, secure/domain/expiry filtering, and the existing session-file location. Update tests that currently require only one disk read: parsed credentials and tokens may be cached, but authoritative revocation checks cannot be skipped.
- [ ] Introduce a single authenticated-fetch path that captures one session, obtains its JWT and Cookie header from that same snapshot, checks it immediately before dispatch/retries, and checks again before returning results. Use a typed `SessionChangedError` for cancellation; do not silently replay an operation with another account's credentials.
- [ ] Replace separated `getCobaltToken()` then `sessionFetch()` sequences in `src/tools/character.ts`, `src/tools/campaign.ts`, `src/tools/reference.ts`, `src/tools/monster.ts`, and `scripts/dump-sourced-languages.mts`. An account-ID lookup and its request must share the snapshot too. Retain plain cookie-authenticated requests where no Bearer token is needed.
- [ ] Prevent late token responses from repopulating the token cache. Check generation after asynchronous body parsing, before cache writes, and before retries after backoff. Merge lifecycle cancellation with caller cancellation instead of dropping either signal.
- [ ] Run `npm test -- tests/session-state.test.ts tests/session-cache.test.ts tests/session-lifecycle.test.ts`. Expected: warmed credentials cannot survive observed revocation; no A-token/B-cookie combination is sent; delayed token responses and retry callbacks cannot resurrect old authority.

**Acceptance:** Every protected cache hit/request observes current authority. A session transition revokes all old snapshots, and stale asynchronous work cannot publish credentials or results into the new generation.

## Task 4: Revoke account data, browsers, and pending login flows

Depends on Task 3. Land these changes with Task 3; a credential-only patch is incomplete.

**Files**

- Modify `src/tools/character.ts`, `src/tools/campaign.ts`, `src/tools/reference.ts`, and `src/tools/monster.ts`.
- Modify `src/browser.ts`, `src/auth.ts`, `src/tools/navigate.ts`, and the browser/login handlers in `src/index.ts`.
- Create `tests/session-consumers.test.ts` and `tests/browser-session.test.ts`; extend `tests/navigate.test.ts` and `tests/session-lifecycle.test.ts`.

- [ ] Register invalidation for all state in the following table. Validate generation before early returns and before writing fetched results. Keep anonymous public-character entries separate or conservatively clear the whole character cache on transition. The public Open5e cache is independent and need not be discarded on logout.

| Module | State to clear or partition by generation |
| --- | --- |
| `src/tools/character.ts` | `characterCache`, including its early return before authentication checks. |
| `src/tools/campaign.ts` | `campaignCache`, including the current account's campaign list. |
| `src/tools/reference.ts` | `referenceCache`, `spellCompendium`, `compendiumSource`, `characterSpellBuffer`, and `itemCompendium`. |
| `src/tools/monster.ts` | `monsterCache`; conservatively clear `configCache` until its account independence is established. |
| `src/browser.ts` | Authenticated contexts, browser/page handles, pending context creation, and cleanup associated with the old generation. |

- [ ] Extend `clearReferenceCache()` to clear `characterSpellBuffer` and `itemCompendium` as well as its existing state. Update `ddb_clear_cache` tests accordingly. When the separate stateless design removes the buffer, remove this temporary reset hook too.
- [ ] Make compendium batches abandon their entire old-account build on `SessionChangedError`. Do not swallow that error as an ordinary failed class lookup and merge old results into a new-account partial compendium. Independent Open5e fallback can remain available with no old authenticated data.
- [ ] Bind browser contexts and pending launches to their opening generation. Refresh authority before returning a shared context and before an authenticated browser action or scraped result. On invalidation, detach old globals synchronously and close captured old handles asynchronously. Completion of old cleanup must not null or close newly created handles.
- [ ] Give login a fresh, deliberately owned context rather than reusing a revoked authenticated context. Serialize or reject concurrent login attempts. Capture the login generation and check it before saving so a login started before observed revocation cannot recreate the deleted session. A fresh login explicitly started afterward may save a new session.
- [ ] Preserve `saveSession()` atomic replacement and permission controls. Publish the new session as one lifecycle transition after saving; retire old account state without letting delayed cleanup affect the new login/context.
- [ ] Test warm private character, campaign, monster, spell, item, and character-seeded spell caches across deletion and account replacement. Test delayed body parsing, compendium batches, pending browser launch, delayed browser close, deletion during login, and two competing logins. Assert no old result is returned or cached and no old completion overwrites new state.
- [ ] Run `npm test -- tests/session-consumers.test.ts tests/browser-session.test.ts tests/navigate.test.ts tests/session-lifecycle.test.ts tests/campaign.test.ts`. Expected: mocked consumers enforce the lifecycle end to end; existing navigation guards still pass. A test that mocks out the entire session helper is insufficient evidence for the cross-module revocation contract.

**Acceptance:** Neither credentials nor private/account-derived data survive the old generation. Revoked browser handles are unusable, and stale login, fetch, cache, or cleanup work cannot alter the replacement session.

## Task 5: Expose logout and document its exact guarantee

Depends on Tasks 3–4.

**Files**

- Modify `src/index.ts`: register `ddb_logout` through the current registration API.
- Modify `README.md`: tool table, logout instructions, caching, and security notes.
- Modify `CLAUDE.md`: session lifecycle and cache descriptions.
- Extend `tests/session-lifecycle.test.ts` with logout-operation and failure cases.

- [ ] Add `ddb_logout` with no account input. Use annotations `{ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }`, since it revokes local access and deletes local session state without a remote logout call.
- [ ] Route it through `revokeSession()`. Repeated logout is successful. Block new authenticated use before asynchronous cleanup. If file deletion fails, retain a process-local revoked state and report that the file remains; do not reload the old file or claim durable logout. Surface browser-cleanup failure rather than reporting complete closure. A deliberate new login may establish fresh authority.
- [ ] Document the immediate workaround for older versions: stop the MCP server, delete the platform-specific session file, and restart. For the fixed version, prefer `ddb_logout`. Explain that external file deletion/replacement is detected at the next protected operation, and cannot retract requests already sent or immediately stop idle browser background activity before detection. Advise stopping the process when immediate termination is needed.
- [ ] State explicitly that local logout is not a global DDB account logout. Keep the existing macOS/Linux and Windows paths. Avoid printing cookies, tokens, or session fingerprints in any success/error message.
- [ ] Reconcile the stateless design in a separate documentation edit during implementation: factory-created browsers must use the same snapshot and revocation hooks; its future disk caches need durable account/session partitioning and validation before reads. A process-local generation alone cannot identify disk data across process restarts. Recheck any tool-count claims after adding logout.
- [ ] Test logout with missing storage, successful deletion, unlink failure, context-close failure, repeated calls, and a fresh post-logout login. Expected: success matches the documented guarantee and error cases never resume old credentials automatically.

**Acceptance:** Successful `ddb_logout` leaves no saved session, usable old browser context, old-account cache entry, or pending work able to restore authority. Failure messages distinguish incomplete persistent deletion or browser cleanup from completed logout, while the process remains locally revoked.

## Verification, release, and closure

- [ ] Run each focused regression suite before and after its fix. Record the expected failing assertion, then the passing result. Do not run oversized allocations or real shell payloads to establish regression coverage.
- [ ] Run the existing repository checks after implementation:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: all commands exit zero. Existing CI should cover its configured Node versions. Use `npm ci` only when dependency installation is needed; this plan requires no new runtime dependency or lockfile update. Mock live DDB/Open5e responses and Playwright so tests do not require credentials or browser downloads.

- [ ] Check tool registration and README agreement, anonymous public-character/Open5e behavior, login/account replacement, and unchanged small treasure output. Review the final diff for accidental session fixtures, tokens, generated `dist/` files, unrelated changes, and publication side effects.
- [ ] Keep the three changes independently reviewable and record test evidence with each. Release notes should name the new treasure limits, `ddb_logout`, and the restart workaround for older versions. Choose the release version through the normal maintainer process; do not publish merely to validate a fix.
- [ ] Once implementation is requested and completed, perform targeted security-fix verification against these three finding IDs and record the fixing commit and evidence. The original scan remains historical evidence; do not rewrite its sealed report to claim remediation.

If a fix must be rolled back, retain its documented workaround and reopen its finding. In particular, do not restore persistent credentials after a logout error just to recover availability. Stopping the process remains the safe operational fallback for session-lifecycle failures.

## Follow-up questions outside finding closure

These observations were not validated vulnerabilities in the scan and must not inflate the three-finding completion criteria:

- **Browser containment:** both launch paths omit `chromiumSandbox`, while the inspected Playwright version defaults it off. Evaluate explicit sandbox configuration and container compatibility separately; no browser exploit was established.
- **Redirect guards:** add final-URL checks as defense in depth and test redirect behavior with controlled fixtures. The scan did not establish an attacker-controlled redirect on an allowed DDB origin.
- **Filesystem writes:** consider non-following/atomic export and screenshot writes. The observed symlink cases require an independently planted local link; remote placement was not established.
- **Deployment controls:** Git tag protection, publisher-account configuration, host ACLs, and any external shared-server wrapper need their own evidence. They are not established by source review.

No follow-up above should delay the bounded release/treasure fixes or the complete local logout correction.
