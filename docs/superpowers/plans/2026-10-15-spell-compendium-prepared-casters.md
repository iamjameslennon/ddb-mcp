# Spell Compendium: Prepared-Caster Leveled Spells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the spell compendium silently dropping every leveled Cleric, Druid and Paladin spell (54 names live, e.g. Spirit Guardians, Bless, Divine Smite, Moonbeam).

**Root cause (verified live 2026-10-15 against character-service with a real session):** `loadSpellCompendium()` in `src/tools/reference.ts` fetches only `/character/v5/game-data/spells?classId=X&classLevel=20&sharingSetting=2` for classIds 1–8. For *known* casters (Bard 1, Ranger 5, Sorcerer 6, Warlock 7, Wizard 8) that returns cantrips + leveled spells. For *prepared* casters (Cleric 2, Druid 3, Paladin 4) it returns **cantrips only** (Cleric 14, Druid 26, Paladin 0). Their leveled spells come only from `/character/v5/game-data/always-known-spells?...` (Cleric 200, Druid 235, Paladin 69), which in turn returns **no cantrips**. All requests return HTTP 200, so the build is labelled `ddb-authoritative` and `getSpell` silently falls back to Open5e (2014 SRD) for the missing names.

**Architecture:** Fetch both endpoints for every spellcasting class (16 requests, all in parallel as today). Collect each request's spell array, then — after `Promise.all` and the existing `assertSessionCurrent(snapshot)` guard — merge them in a fixed task order (all `/spells` lists in class-ID order, then all `/always-known-spells` lists in class-ID order) with the existing first-wins-by-name rule. Merging in task order instead of response-completion order makes the build deterministic; it does not otherwise change which spells are kept.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Node ≥22.

**Spec:** none — this plan is the authority. Bug evidence is in the Root cause paragraph above.

## Global Constraints

- **Every task's requirements implicitly include this section.**
- **Out of scope — do NOT change:** edition preference for same-named 2014/2024 spells (the Map stays keyed by name, first-wins); `getSpell`/`searchSpells` matching logic; `isConcentrationSpell`; `addCharacterSpellsToCompendium` / `characterSpellBuffer`; the cache TTLs; tool registrations in `src/index.ts`; `scripts/diagnose-compendium.mjs`. A separate change will address editions.
- **Session-lifecycle invariants must hold** (`CLAUDE.md` §Revocable session lifecycle): the build captures one `snapshot` up front, a `SessionChangedError` from any request rejects the whole build (rethrown, never counted as a failed task), and `assertSessionCurrent(snapshot)` runs after every request settles and **before** anything is merged or cached. The existing test `tests/session-consumers.test.ts` › "spell compendium abandons the whole build on a mid-batch account change" must keep passing unmodified.
- **Provenance semantics unchanged:** any request that is non-OK or throws (other than `SessionChangedError`) counts as a failure → `ddb-partial` (5 min TTL); all OK → `ddb-authoritative` (24 h TTL). Zero spells total → throw the existing "Failed to load spell compendium" error, uncached.
- **`@types/node` stays `^22`; do not touch `package.json` / `package-lock.json`.**
- Run `npm run typecheck && npm run lint && npm test` green before every commit. One commit per task. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/tools/reference.ts` | Modify | `loadSpellCompendium()` fetches both endpoints, merges deterministically; stale comments fixed |
| `tests/spell-compendium-endpoints.test.ts` | **Create** | Endpoint coverage, prepared-caster leveled spells, partial provenance, deterministic merge, no Open5e fallback |
| `CLAUDE.md` | Modify | Two lines describing the spell build |

---

## Task 1: Fetch `/spells` and `/always-known-spells` for every class, merge deterministically

**Files:**
- Modify: `src/tools/reference.ts` (`loadSpellCompendium`, the module header comment, the `CompendiumSource` comment, the `characterSpellBuffer` comment)
- Create: `tests/spell-compendium-endpoints.test.ts`

**Interfaces:**
- Consumes: existing `refFetch`, `captureSession`, `assertSessionCurrent`, `SessionChangedError`, `SPELLCASTING_CLASS_IDS`, `CHARACTER_SERVICE`.
- Produces: no new exports. `loadSpellCompendium()` signature and return type unchanged.

- [x] **Step 1: Write the failing test file**

Create `tests/spell-compendium-endpoints.test.ts` with exactly:

```ts
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * spell-compendium-endpoints.test.ts
 *
 * character-service's /game-data/spells returns ONLY cantrips for prepared
 * casters (Cleric, Druid, Paladin); their leveled spells come from
 * /game-data/always-known-spells, which returns no cantrips. The compendium
 * must query both for every class. Real session-state / session-fetch; only
 * `fs` and global `fetch` are mocked (same approach as session-consumers).
 */

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  fchmodSync: vi.fn(),
  renameSync: vi.fn(),
  realpathSync: vi.fn((p: string) => p),
  constants: { O_CREAT: 0, O_TRUNC: 0, O_WRONLY: 0, O_NOFOLLOW: 0 },
}));
vi.mock("fs", () => fsMock);

type ReferenceModule = typeof import("../src/tools/reference.js");
let reference: ReferenceModule;
let fetchMock: ReturnType<typeof vi.fn>;

const COBALT_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const GAME_DATA = "https://character-service.dndbeyond.com/character/v5/game-data";

function makeJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  } as unknown as Response;
}

function spell(name: string, level: number, description = `${name} description`) {
  return { definition: { name, level, school: "Evocation", description, concentration: false, ritual: false } };
}

type Endpoint = "spells" | "always-known-spells";
type Lists = Partial<Record<Endpoint, Record<string, unknown[]>>>;

/**
 * Model character-service: `lists[endpoint][classId]` is that request's spell
 * array (missing → empty list). `status[endpoint:classId]` overrides the HTTP
 * status; `delay[endpoint:classId]` delays that response by N ms.
 */
function serviceMock(lists: Lists, opts: { status?: Record<string, number>; delay?: Record<string, number> } = {}) {
  return async (url: string) => {
    if (url === COBALT_URL) return jsonResponse({ token: makeJwt("99") });
    if (url.startsWith(GAME_DATA)) {
      const u = new URL(url);
      const endpoint = u.pathname.split("/").pop() as Endpoint;
      const classId = u.searchParams.get("classId") ?? "";
      const key = `${endpoint}:${classId}`;
      const wait = opts.delay?.[key];
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const status = opts.status?.[key] ?? 200;
      if (status !== 200) return jsonResponse({}, status);
      return jsonResponse({ data: lists[endpoint]?.[classId] ?? [] });
    }
    if (url.includes("api.open5e.com")) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({});
  };
}

function gameDataUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(GAME_DATA));
}

beforeEach(async () => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReset().mockReturnValue(true);
  fsMock.readFileSync.mockReset().mockReturnValue(JSON.stringify({
    cookies: [{
      name: "CobaltSession", value: "SECRET_A", domain: ".dndbeyond.com", path: "/",
      expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
    }],
  }));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  reference = await import("../src/tools/reference.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spell compendium queries both class spell-list endpoints", () => {
  it("requests /spells and /always-known-spells for all 8 spellcasting classes at classLevel 20", async () => {
    fetchMock.mockImplementation(serviceMock({ spells: { "8": [spell("Fire Bolt", 0)] } }));

    await reference.searchSpells({});

    const urls = gameDataUrls();
    expect(urls).toHaveLength(16);
    for (const endpoint of ["spells", "always-known-spells"]) {
      for (const classId of [1, 2, 3, 4, 5, 6, 7, 8]) {
        expect(urls).toContain(`${GAME_DATA}/${endpoint}?classId=${classId}&classLevel=20&sharingSetting=2`);
      }
    }
  });

  it("includes prepared-caster leveled spells that only /always-known-spells returns", async () => {
    fetchMock.mockImplementation(serviceMock({
      // Live shape: Cleric /spells is cantrips only, Paladin /spells is empty.
      spells: { "2": [spell("Sacred Flame", 0)], "8": [spell("Fire Bolt", 0), spell("Fireball", 3)] },
      "always-known-spells": {
        "2": [spell("Spirit Guardians", 3), spell("Bless", 1)],
        "4": [spell("Divine Smite", 1)],
      },
    }));

    const search = await reference.searchSpells({ limit: 50 });
    for (const name of ["Sacred Flame", "Fire Bolt", "Fireball", "Spirit Guardians", "Bless", "Divine Smite"]) {
      expect(search).toContain(`**${name}**`);
    }
    expect(search).toContain("(6 found)");
    expect(reference.getCompendiumSource()).toBe("ddb-authoritative");

    const got = await reference.getSpell("Spirit Guardians");
    expect(got).toContain("**Spirit Guardians** — Level 3");
    // Found in the DDB compendium, so Open5e must never be consulted.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("open5e"))).toBe(false);
  });

  it("marks the build partial when one always-known-spells request fails, keeping everything else", async () => {
    fetchMock.mockImplementation(serviceMock(
      {
        spells: { "2": [spell("Sacred Flame", 0)] },
        "always-known-spells": { "2": [spell("Bless", 1)], "3": [spell("Moonbeam", 2)] },
      },
      { status: { "always-known-spells:3": 500 } },
    ));

    const search = await reference.searchSpells({ limit: 50 });
    expect(search).toContain("**Sacred Flame**");
    expect(search).toContain("**Bless**");
    expect(search).not.toContain("**Moonbeam**");
    expect(reference.getCompendiumSource()).toBe("ddb-partial");
    expect(search).toContain("Compendium build was incomplete");
  });

  it("merges in a fixed order regardless of which response arrives first", async () => {
    // Same name from three requests. Task order is /spells class 1..8, then
    // /always-known-spells class 1..8, so /spells class 2 must win even though
    // it is the slowest response and /always-known-spells class 1 the fastest.
    fetchMock.mockImplementation(serviceMock(
      {
        spells: { "2": [spell("Cure Wounds", 1, "FROM_SPELLS_CLASS_2")], "5": [spell("Cure Wounds", 1, "FROM_SPELLS_CLASS_5")] },
        "always-known-spells": { "1": [spell("Cure Wounds", 1, "FROM_ALWAYS_KNOWN_CLASS_1")] },
      },
      { delay: { "spells:2": 30, "spells:5": 10 } },
    ));

    const got = await reference.getSpell("Cure Wounds");
    expect(got).toContain("FROM_SPELLS_CLASS_2");
  });
});
```

- [x] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/spell-compendium-endpoints.test.ts`
Expected: FAIL — the first test sees 8 URLs not 16; the prepared-caster test misses Spirit Guardians / Bless / Divine Smite; the partial test sees `ddb-authoritative`. The fixed-order test may pass or fail by timing (that is fine before the change).

- [x] **Step 3: Replace the fetch-and-merge block in `loadSpellCompendium()`**

In `src/tools/reference.ts`, replace everything from the line `  const allSpells = new Map<string, DdbSpell>();` through the line `  assertSessionCurrent(snapshot);` (the first `assertSessionCurrent(snapshot);` inside `loadSpellCompendium`, together with its preceding two-line comment) with:

```ts
  let failedTasks = 0;

  // Two requests per spellcasting class, both at classLevel=20:
  //
  //   /game-data/spells             — known casters (Bard, Ranger, Sorcerer,
  //                                   Warlock, Wizard): cantrips + leveled.
  //                                   Prepared casters (Cleric, Druid,
  //                                   Paladin): cantrips ONLY.
  //   /game-data/always-known-spells — every class: leveled spells, never
  //                                   cantrips. The only source of Cleric,
  //                                   Druid and Paladin leveled spells.
  //
  // Neither endpoint alone is complete. Querying only /spells (2.7.x–2.10.x)
  // silently dropped every leveled Cleric/Druid/Paladin spell; querying only
  // always-known/always-prepared (pre-2.7) dropped every cantrip. Both were
  // HTTP 200 throughout, so provenance looked authoritative.
  const SPELL_LIST_ENDPOINTS = ["spells", "always-known-spells"] as const;
  const tasks = SPELL_LIST_ENDPOINTS.flatMap(endpoint =>
    SPELLCASTING_CLASS_IDS.map(classId => ({ endpoint, classId })),
  );
  const lists = await Promise.all(tasks.map(async ({ endpoint, classId }): Promise<DdbSpell[]> => {
    try {
      const url = `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=20&sharingSetting=2`;
      const resp = await refFetch(url);
      if (!resp.ok) {
        failedTasks++;
        return [];
      }
      const json = await resp.json() as { data?: DdbSpell[] } | DdbSpell[];
      return (Array.isArray(json) ? json : json.data) ?? [];
    } catch (e) {
      // A session transition mid-build is NOT an ordinary failed class lookup:
      // abandon the entire build so no old-account (or mixed) class list is
      // merged into a new-account compendium. Rethrow to reject Promise.all.
      if (e instanceof SessionChangedError) throw e;
      // Otherwise continue — a partial compendium is still useful.
      failedTasks++;
      return [];
    }
  }));

  // Even if every individual request succeeded, the account may have changed
  // during an async body parse. Refuse to merge or cache a compendium
  // assembled across a generation boundary.
  assertSessionCurrent(snapshot);

  // Merge in task order (not response-completion order) so the same responses
  // always produce the same compendium. First occurrence of a name wins.
  const allSpells = new Map<string, DdbSpell>();
  for (const spells of lists) {
    for (const spell of spells) {
      const name = spell.definition?.name;
      if (name && !allSpells.has(name)) allSpells.set(name, spell);
    }
  }
```

Leave everything after it (the `allSpells.size === 0` throw, the `characterSpellBuffer` merge, provenance, TTL, cache write) unchanged.

- [x] **Step 4: Fix the three stale comments in `src/tools/reference.ts`**

1. Module header — replace:
```
 * Spells: built from character-service always-known/prepared endpoints
 *         across all 8 spellcasting classes; cached 24 h.
```
with:
```
 * Spells: built from character-service game-data/spells (cantrips) and
 *         game-data/always-known-spells (leveled) across all 8 spellcasting
 *         classes; cached 24 h.
```

2. `CompendiumSource` comment — replace `// 32 DDB game-data requests succeeded;` with `// 16 DDB game-data requests succeeded;`.

3. `characterSpellBuffer` comment — replace `// grants, etc.) that may not appear in the per-class /game-data/spells lists.` with `// grants, etc.) that may not appear in the per-class game-data spell lists.`.

Also in the comment just above the `characterSpellBuffer` merge loop inside `loadSpellCompendium`, replace `The /game-data/spells endpoint covers the canonical class` with `The per-class game-data lists cover the canonical class`.

- [x] **Step 5: Run the new tests and the session-lifecycle regression**

Run: `npx vitest run tests/spell-compendium-endpoints.test.ts tests/session-consumers.test.ts`
Expected: PASS, all tests in both files.

- [x] **Step 6: Full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green; test count = baseline 392 + 4 = 396.

- [x] **Step 7: Commit**

```bash
git add src/tools/reference.ts tests/spell-compendium-endpoints.test.ts
git commit -m "fix(spells): fetch always-known-spells so Cleric/Druid/Paladin leveled spells aren't dropped

/game-data/spells returns only cantrips for prepared casters; their leveled
spells come from /game-data/always-known-spells (which returns no cantrips).
Query both for every class (16 requests) and merge in a fixed task order so
the build is deterministic. 54 spells were missing live, including Spirit
Guardians, Bless, Divine Smite and Moonbeam, and silently fell back to Open5e.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (two lines)

- [x] **Step 1: Key-modules table row**

In the `src/tools/reference.ts` row, replace:
```
(DDB character-service `/game-data/spells?classId=X&classLevel=20` — one request per spellcasting class, returns cantrips + leveled spells together)
```
with:
```
(DDB character-service, two requests per spellcasting class at `classLevel=20`: `/game-data/spells` — cantrips, plus leveled spells for known casters only — and `/game-data/always-known-spells` — leveled spells for every class, the only source for Cleric/Druid/Paladin)
```

- [x] **Step 2: Caching-layers bullet**

Replace:
```
— first spell call builds the full compendium by firing 8 parallel `/game-data/spells?classId=X&classLevel=20` requests, one per spellcasting class; cantrips and leveled spells come back in one response
```
with:
```
— first spell call builds the full compendium by firing 16 parallel requests (`/game-data/spells` and `/game-data/always-known-spells`, `classLevel=20`, for each of the 8 spellcasting classes). Neither endpoint is complete alone: `/spells` returns only cantrips for prepared casters, and `always-known-spells` never returns cantrips. Results merge in fixed request order, first name wins
```

- [x] **Step 3: Gate and commit**

Run: `npm run lint && npm test` — expected green.

```bash
git add CLAUDE.md
git commit -m "docs: describe the two-endpoint spell compendium build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
