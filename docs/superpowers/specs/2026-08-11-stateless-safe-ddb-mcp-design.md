# Stateless-Safe ddb-mcp — Design

**Date:** 2026-08-11
**Target release:** v3.0.0
**Status:** Approved design, not yet planned

## Context

MCP spec revision **2026-07-28** ([SEP-2575](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/seps/2575-stateless-mcp.mdx)) makes the protocol core stateless. It removes `initialize` (replaced by `server/discover`), protocol-level sessions and the `Mcp-Session-Id` header, resumable SSE, `ping`, `logging/setLevel`, `resources/subscribe`, and the entire server→client JSON-RPC request channel. SEP-2575 explicitly extends statelessness to stdio, on the grounds that transport should be an implementation detail rather than a feature gate.

An audit of ddb-mcp against that revision found the server is largely unaffected. It uses none of the deleted server→client channel — no sampling, elicitation, roots, resources, prompts, logging, subscriptions, or progress notifications — and it has never had sessions to lose. The exposure is narrower: a small number of places where one tool call reads state written by a previous tool call.

Those places are already bugs today. This spec fixes them on SDK 1.x, independent of the 2.0 migration.

## Goals

Make every tool's correctness independent of what happened in a previous tool call, so the server behaves identically on stdio and on any host that constructs a fresh server per request.

Concretely, fix these present-day defects:

1. `ddb_interact` on a cold browser fails with an opaque 10-second selector timeout.
2. Identical `ddb_search_spells` calls return different result counts depending on whether a character was fetched earlier in the process.
3. `ddb_clear_cache` does not clear `characterSpellBuffer`, despite promising to wipe in-process caches.
4. A Chrome process can be orphaned if the client dies without a clean signal.

## Non-goals

- Migrating to SDK 2.0 / `@modelcontextprotocol/server` / `serveStdio`. That is a separate spec once 2.0 leaves alpha (currently `2.0.0-alpha.2`). Nothing here should make that migration harder.
- Adding HTTP or SSE transport. The server remains stdio-only.
- Any change to the 31 tools not named in this document.

## Guiding invariants

1. **No tool reads state written by a different tool call.** Cross-call state is either eliminated or converted into a deterministic input.
2. **The read path stays auto-approvable.** Tools are split by capability rather than by page state, so the destructive permission prompt stays rare and therefore still meaningful as a human-in-the-loop check.

Invariant 1 is about *request* state. Process-scoped lifecycle infrastructure (install deduplication, in-flight handles, resolved launch strategy) is explicitly permitted, because no tool's correctness depends on it — a cold miss only costs time.

---

## 1. Tool surface: 35 → 33

| Tool | Change |
|---|---|
| `ddb_navigate` | removed |
| `ddb_interact` | removed |
| `ddb_get_page` | removed |
| `ddb_close_browser` | removed — nothing to close |
| `ddb_browse` | **new** — `{url}` → page content, `readOnlyHint: true` |
| `ddb_browse_interact` | **new** — `{url, actions[]}` → page content, `destructiveHint: true` |

`ddb_login` is unchanged in behaviour. The other 31 tools keep their names and signatures; `ddb_search_spells` and `ddb_get_spell` change behaviour but not signature.

### Why collapse rather than patch

`navigate()` already returns page content, so `ddb_navigate` is `url → content` in one call. `ddb_get_page` exists only to re-read the page after an interact. The three tools were one tool split along page-state lines rather than capability lines.

### Why two tools rather than one

Merging all three into a single tool would force a `destructiveHint: true` annotation, because the tool would be capable of clicking and filling. That would make every plain page read require a permission prompt. The cost is not primarily friction — it is that routine reads and account-changing clicks would produce visually identical approval prompts, training the user to click through the one control that matters. The README states this prompt is "the only human-in-the-loop check standing between a prompt-injected page and a click on your logged-in D&D Beyond session."

Splitting by capability keeps that boundary exactly as sharp as it is today.

### User impact of the removals

MCP clients call `tools/list` fresh each session, so there is no cached contract, generated client, or compile step — the model simply sees a different tool list. The realistic impact is:

- Users with a permission allowlist entry for `ddb_navigate` / `ddb_interact` / `ddb_get_page` get one dead entry and one re-approval prompt for the new tools.
- Hand-written instructions (CLAUDE.md, saved prompts) naming the old tools become stale.
- A major version bump and release-note callout.

These tools appear only in the README's full tool reference table and its security notes — not in the "For Players" or "For DMs" workflows — so they are a residual escape hatch rather than a promoted feature.

---

## 2. Browser tools

### `ddb_browse`

```ts
{ url: string }                         // https://www.dndbeyond.com/… only
annotations: READ_ONLY_NET
```

Behaviour is today's `navigate()` verbatim plus a `finally` that closes the browser: launch → install navigation guard → allowlist-check the URL → `goto(networkidle, 30 s)` → scrape `main`/`article` innerText → truncate at 8000 chars → wrap in `<untrusted_dndbeyond_content>` → close.

Cannot click, fill, or write files **by construction** — no code path in this tool does.

### `ddb_browse_interact`

```ts
{
  url: string,
  actions: [                            // ordered, min 1, max 5
    { type: "click",      selector, confirm: true },
    { type: "fill",       selector, value, confirm: true },
    { type: "screenshot" }              // no gate — matches today
  ]
}
annotations: { readOnlyHint: false, destructiveHint: true,
               idempotentHint: false, openWorldHint: true }
```

Navigates to `url`, runs the actions in order, then returns the resulting page content alongside the action log. Returning content is essential: with the browser closing after every call there is no follow-up `ddb_get_page`, so this tool must return what the page became.

**The `actions` array is load-bearing, not a convenience.** Because the browser closes after every call, an interaction sequence can no longer span calls — a two-step interaction must be batched into one call or it cannot be expressed at all.

**Per-action confirmation.** `confirm` is a required `z.literal(true)` on each click and fill action, so the gate is enforced structurally by the schema rather than by a runtime check that could be forgotten. This preserves today's semantics exactly — one affirmation per act — where a single top-level flag would have let one affirmation authorize N acts. A defensive runtime check is retained purely so the error message can carry the existing instructive wording about prompt-injected content rather than a terse zod error.

Screenshot stays in this tool rather than in `ddb_browse`, despite being read-only in spirit, because it writes a file to `~/Downloads` and an auto-approvable tool should not write to disk. This matches today's placement, so it is not a regression.

### Security invariants

| Invariant | Status |
|---|---|
| URL allowlist before navigation (`isAllowedPageUrl`) | unchanged |
| Network-layer guard on off-allowlist top-level navigations | unchanged; installed on the fresh context **before** any `goto` |
| Selector deny-list (`assertSafeSelector`) | unchanged; applied to every action's selector |
| Refuse to scrape off-allowlist or `about:blank` pages | unchanged |
| `wrapUntrusted()` on returned page text | unchanged |
| Screenshot confined to `~/Downloads` | unchanged |
| Post-action URL re-check | **strengthened** — see below |

Today the post-click URL re-check runs after a click. With a batch, a click could commit a navigation and a subsequent fill would then target a foreign page. The re-check therefore runs **after every action**, and a failure aborts all remaining actions and returns an error rather than continuing.

`guardedContexts` (a `WeakSet`) is retained unchanged. With a fresh context per call it always misses, which is correct and costs nothing.

---

## 3. Browser lifecycle

`browser.ts` loses its singletons and becomes a factory. `getBrowser()` / `getContext()` currently return cached module state; they become `launchBrowser(headless)` and `createContext(browser)`, with the caller owning the lifecycle via `try/finally`.

All three browser tools then share one shape:

```
launch → createContext → install guard → do work → finally: close
```

`ddb_login` already works this way — it calls `closeBrowser()` immediately after `saveSession()`. It stops being the exception and becomes just another caller.

### Retained module state

Three values are deliberately kept. None is request state; no tool's correctness depends on any of them.

| Value | Purpose | Cost of a cold miss |
|---|---|---|
| `chromiumInstallPromise` | Deduplicates concurrent 140 MB Chromium downloads within a process | Re-probe; the durable guard is the on-disk `existsSync` check |
| `Set<Browser>` of in-flight instances | Drained by `shutdown()` on `SIGTERM` / `SIGINT` / `transport.onclose` | Without it, killing the client mid-browse orphans a Chrome process — the exact leak this refactor removes |
| `launchStrategy: "chrome" \| "bundled" \| null` | Caches which launch strategy resolved | Re-probe |

`launchStrategy` is new and exists because of a cost the refactor introduces. Under the singleton, later calls returned the cached browser and never re-entered the launch logic. Without it, **every** call would retry `chromium.launch({channel: "chrome"})`, so users without system Chrome would pay a failed launch attempt on every call before falling back. Caching the resolved strategy removes that from the hot path. It is scoped to process lifetime, so installing Chrome mid-session requires a restart to be picked up — an acceptable trade.

### Chromium download is unaffected

Verified: `chromium.executablePath()` resolves to `~/Library/Caches/ms-playwright/chromium-<rev>/…`, a persistent on-disk cache directory separate from any browser process. `browser.close()` terminates a Chrome process; it does not touch that directory. Closing the browser after every call therefore cannot re-trigger a download — the second call's `existsSync` check hits and returns immediately.

### Accepted cost

Two concurrent `ddb_browse` calls now launch two Chrome processes instead of sharing one. Clients issue few parallel browser calls and each is short-lived; this is preferred over reintroducing a shared instance and the locking it would require.

`DDB_NO_SANDBOX`, `DDB_USE_BUNDLED_CHROMIUM`, the system-Chrome-first launch order, and the lazy Chromium installer are all unchanged.

---

## 4. Deterministic spell compendium

### Delete `characterSpellBuffer`

The buffer is redundant. In `buildConcentrationByLevel`:

```js
const fromCompendium = isConcentrationSpell(name);
const isConc = fromCompendium !== null ? fromCompendium : def.concentration === true;
```

`addConcSpell` iterates spell objects from `char.classSpells[].spells[]` — the same objects `addCharacterSpellsToCompendium` copies into the buffer. For the character's own spells, `isConcentrationSpell(name)` returns `spell.definition.concentration`, the identical value the local `def.concentration` fallback already provides. The buffer lookup is a module-level detour to data already in scope.

The only case where the buffer changes the answer is when a name was seeded by a different character in a previous call — precisely the nondeterminism being removed.

Therefore:

1. Delete `characterSpellBuffer` and `addCharacterSpellsToCompendium`. The `clearReferenceCache` gap disappears with them rather than needing a fix.
2. `character/parse.ts` stops importing `reference.ts`.
3. `isConcentrationSpell` keeps only the compendium lookup. Callers already fall back to `def.concentration`, so no behaviour is lost.

### Two-layer compendium

Homebrew spells and subclasses reach the compendium only through a character's `classSpells` — they will never appear in DDB's per-class endpoints. Preserving that coverage is a hard requirement. It is preserved by making character seeding an explicit, deterministic input to the build rather than an incidental side effect of having fetched a character.

```
loadSpellCompendium():

  Layer 1 — class spell lists           [no change signal available]
    8× /game-data/spells?classId=…&classLevel=20
    disk cache, 7-day TTL

  Layer 2 — character spells            [exact change signal]
    GET /character/v5/characters/list    ← one small request
    per character, cache key = (id, lastModifiedDate):
        hit  → reuse cached spells, no fetch
        miss → fetch character JSON, extract classSpells, store
    drop entries for characters no longer in the list
    no TTL

  merge → compendium
```

This is **strictly more coverage than today**: currently homebrew appears only if that character happened to be fetched in the same process; now every character's homebrew is always present.

### Evidence for the change signal

A read-only probe of `GET /character/v5/characters/list` on a live account returned:

```
keys: avatarUrl, backdropUrl, campaignId, campaignName, characterSecondaryInfo,
      classDescription, coverImageUrl, createdDate, id, isAssigned, isReady,
      lastModifiedDate, level, name, raceName, status, statusSlug

lastModifiedDate: 1778275152  → 2026-05-08T21:19:12Z   distinct across 4/4 chars
createdDate:      1606080784  → 2020-11-22T21:33:04Z   distinct across 4/4 chars
```

`lastModifiedDate` is a seconds-precision Unix timestamp that varies per character. It is an exact change signal, which is why layer 2 needs no TTL.

### Why this beats any TTL

- **Exact freshness.** A character edited seconds ago is picked up by the next spell search. No staleness window on the layer that carries homebrew.
- **Near-zero steady-state cost.** One small list request and zero character fetches in the common case.
- **Staleness impossible by construction.** Entries keyed by `lastModifiedDate` cannot be served as current when stale — they simply miss. This is what makes disk-caching layer 2 safe, and it is what protects per-request hosts, which otherwise would rebuild the entire compendium on every call.

### The one remaining TTL

Layer 1 has no change signal, so 7 days is chosen for these reasons: DDB's class spell lists change only when new content is published, a few times a year; the worst case is new spells missing for a week; `ddb_clear_cache` already exists and is documented for exactly that situation; and once the layer is on disk, 8 requests per week is negligible, so a longer TTL would save nothing while making a missed sourcebook linger far longer.

### Provenance and failure handling

The existing provenance model is retained. Seeding is best-effort and never breaks spell search — `searchSpells` already catches and falls through to Open5e.

| Situation | Provenance | TTL |
|---|---|---|
| No valid session | skip layer 2, not an error | unchanged |
| Both layers succeed | `ddb-authoritative` | layer 1: 7 d |
| Account has zero characters | `ddb-authoritative` | layer 1: 7 d |
| Any class-list request failed | `ddb-partial` | 5 min |
| List request or any character fetch failed | `ddb-partial` | 5 min |

### Disk cache hygiene

Both layers live in the existing config dir alongside `session.json`, written 0600 via the same atomic temp-file-and-rename pattern as `saveSession()`. `invalidateSessionCache()` wipes the character layer so switching accounts cannot leave the previous account's spell data behind. `ddb_clear_cache` clears both layers.

### New module to avoid an import cycle

`reference.ts` needs character JSON, but `character/spells.ts` already imports `reference.ts`; importing `character.ts` back would create a cycle. Additionally, `listCharacters()` returns a formatted `Promise<string>` rather than structured data.

Extract `src/tools/ddb-character-api.ts` holding the raw character-service calls (list and fetch-by-id) plus the existing 60 s character TtlCache. Both `character.ts` and `reference.ts` import it; it depends only on `session-fetch.ts`. No cycle, and it is a better boundary — talking to the character service is separated from formatting character output, consistent with the existing per-domain module split.

---

## 5. Housekeeping

- **Pin `@modelcontextprotocol/sdk` from `^1.0.0` to `^1.30.0`.** The current floor means a fresh `npm ci` could resolve an old 1.x; CI proves nothing about it.
- **Migrate `server.tool` → `registerTool`** across all registrations. The `tool()` overloads are already `@deprecated` in the installed 1.30.0, and this removes one variable from the eventual 2.0 migration. **Land this as its own commit, first** — at which point there are still 35 registrations — so a mechanical 35-site rewrite does not bury the substantive diff.

---

## 6. Testing

The existing suite mocks the Playwright surface, so the browser work stays browser-free.

| Area | Test |
|---|---|
| Browser always closed | `ddb_browse` closes in `finally`, including on navigation error and on selector error mid-batch |
| Gate enforcement | `confirm` missing on a click/fill action → rejected before any action runs |
| Batch abort | a click landing off-allowlist aborts remaining actions and returns an error |
| Selector safety | existing `assertSafeSelector` coverage, applied per action |
| **Core invariant** | run tool B in a fresh module registry with and without tool A having run first; assert identical output |
| Spell layer | unchanged `lastModifiedDate` → no character fetch; changed → refetch; character removed from list → entry dropped |
| Buffer deletion | concentration still resolves with no compendium loaded, via `def.concentration` |
| Disk cache | 0600 permissions; atomic replace; wiped by `invalidateSessionCache()` and `ddb_clear_cache` |

**The buffer deletion has a built-in proof.** The live-character snapshot regression flow (`docs/character-refactor.md`) must produce byte-identical output before and after. If a snapshot moves, the analysis that the buffer lookup is redundant was wrong — that is the signal to stop and re-examine.

---

## 7. Release — v3.0.0

- README: update the full tool reference table; the security section's `ddb_interact` guidance becomes `ddb_browse_interact`; remove `ddb_close_browser` references.
- CLAUDE.md: update the browser-dependency section, the caching-layers table, and the tool notes.
- Release notes must explicitly name the removed tools, since anyone with a permission allowlist entry for `ddb_navigate` / `ddb_interact` / `ddb_get_page` will need to re-approve.
- `lhm.plugin.json` regenerates from `dist/` during the release script — no manual work.
- Dockerfile and `.dockerignore` unchanged.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Snapshot output changes after buffer deletion | Treated as a stop signal, not something to re-baseline; it would falsify the redundancy analysis |
| A user depends on multi-step interaction across calls | The `actions` array covers sequences up to 5; longer sequences were already fragile and undocumented |
| Layer 2 disk cache grows unbounded | Entries for characters absent from the list are dropped on each build |
| `lastModifiedDate` does not update on every edit type | Unverified for prepared-spell changes specifically; `ddb_clear_cache` remains the escape hatch. Worth confirming during implementation |
| Concurrent browser calls spike memory | Accepted; calls are short-lived and rarely parallel |

## 9. Relationship to the SDK 2.0 migration

Every change here is compatible with 1.x and reduces work in the eventual 2.0 migration. After this spec lands, that migration is: swap `new StdioServerTransport()` + `server.connect()` for `serveStdio(() => buildServer())`, change the import path from `@modelcontextprotocol/sdk/server/mcp.js` to `@modelcontextprotocol/server`, move the tool registrations inside a factory function, and re-verify the shutdown hook. No architectural work remains, because no tool will depend on cross-call state.
