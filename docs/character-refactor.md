# `parseCharacterData` Refactor Plan

`src/tools/character.ts` is mid-refactor. The goal is to carve the
~1000-line `parseCharacterData` function into ~14 small, focused, independently
testable modules under `src/tools/character/`. **No behavior change** — the
existing 156 vitest tests are the contract.

This document is the **single source of truth** for the refactor. Future agents
working on this codebase should read it before touching `character.ts` and
update the progress checklist as phases complete.

---

## How to view the pre-refactor original

The refactor begins at tag `v2.8.0` (commit `d003228`). Any agent can compare
against the original at any time:

```bash
# Read the entire pre-refactor file:
git show v2.8.0:src/tools/character.ts

# Diff your in-progress work against the original:
git diff v2.8.0 -- src/tools/character.ts
```

**Do not create a copy of `character.ts` in the working tree.** Git is the
canonical archive.

---

## Success criterion (binding gate)

> **Every phase must leave all 156 vitest tests passing AND keep the manual
> live-character regression output unchanged. No phase merges otherwise.**

Concretely, before merging any phase:

```bash
npm run typecheck && npm run lint && npm test          # automated, required
npx tsx scripts/snapshot-live-characters.mts > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt                    # manual, required
```

`/tmp/before.txt` should be captured before starting the phase.

---

## File structure (target)

```
src/tools/character.ts                 ← public API only (~150 lines, network/IO)
src/tools/character/
  types.ts                             ← Mod, ClassEntry, CoreStats, ParseSection
  helpers.ts                           ← str/num/arr/obj/signed/modOf/capitalize/hasTag
  templates.ts                         ← makeResolveTemplates(profBonus, totalLevel)
  core.ts                              ← computeCoreStats(char) → CoreStats
  identity.ts                          ← race-variant detection + formatHeaderBlock
  vitals.ts                            ← HP/HitDice/Speed/Init/DeathSaves + formatVitalsBlock
  ac.ts                                ← computeAc (the most rule-tangled single calc)
  stats.ts                             ← Abilities/Saves/Skills/Senses/Profs + formatStatsBlock
  defenses.ts                          ← Resistances/Immunities/Conditions + formatDefensesBlock
  features.ts                          ← Feats/ClassFeatures/RacialTraits/Background + block
  weapons.ts                           ← Weapon attack rolls (martial arts, finesse, magic)
  actions.ts                           ← Actions/Bonus/Reactions/LimitedUse + formatCombatBlock
  spells.ts                            ← Spellcasting/Slots/Spells/Concentration + 2 blocks
  inventory.ts                         ← Equipped/Carried/Attunement/Currency + block
  notes.ts                             ← Traits/Backstory/Allies + formatNotesBlock
  parse.ts                             ← parseCharacterData orchestrator (~80 lines)
  definition.ts                        ← getDefinition (separate concern, also long today)
```

Each module owns one slice of output **end-to-end** — both the computation and
the formatter. This is the cohesion choice; cross-module coupling is via
typed value objects, not shared mutable scope.

---

## The shared context object

The single most important refactor primitive. Everyone needs `statMods`,
`profBonus`, `allMods`, etc. — compute once, pass as one object:

```ts
// src/tools/character/types.ts
export interface CoreStats {
  readonly char: CharData;
  readonly allMods: readonly Mod[];
  readonly statTotals: readonly number[];   // length 6: STR..CHA scores
  readonly statMods: readonly number[];     // length 6: STR..CHA modifiers
  readonly profBonus: number;
  readonly totalLevel: number;
  readonly classes: readonly ClassEntry[];
  readonly inventory: readonly InventoryItem[];
  readonly resolveTemplates: (text: string, classLevel?: number) => string;
}
```

Most modules become `(core: CoreStats) → DomainResult` pure functions.

---

## The orchestrator (target shape)

```ts
// src/tools/character/parse.ts
export function parseCharacterData(raw: CharData, sections: ParseSection = "full"): string {
  const char = (raw?.data ?? raw) as CharData;
  addCharacterSpellsToCompendium(char);

  const core = computeCoreStats(char);
  const want = SECTION_INCLUDES[sections];
  const out: string[] = [];

  if (want.has("header"))   out.push(...formatHeaderBlock(computeIdentity(core)));
  if (want.has("vitals"))   out.push(...formatVitalsBlock(computeVitals(core), core.profBonus));
  if (want.has("stats"))    out.push(...formatStatsBlock(computeStats(core)));
  if (want.has("defenses")) out.push(...formatDefensesBlock(computeDefenses(core)));
  if (want.has("features")) out.push(...formatFeaturesBlock(computeFeatures(core)));

  // Spells are needed by combat (bonus action / reaction spells), so collect once
  const needsSpells = want.has("spells") || want.has("combat") || want.has("concentration");
  const spellSources = needsSpells ? collectSpellSources(core) : null;

  if (want.has("combat"))        out.push(...formatCombatBlock(computeActions(core, spellSources!)));
  if (want.has("spells"))        out.push(...formatSpellsBlock(computeSpellcasting(core), spellSources!));
  if (want.has("inventory"))     out.push(...formatInventoryBlock(computeInventory(core)));
  if (want.has("notes"))         out.push(...formatNotesBlock(computeNotes(core)));
  if (want.has("concentration")) out.push(...formatConcentrationBlock(computeConcentration(core, spellSources!)));

  return out.join("\n");
}
```

---

## Resolved design decisions

These were debated when the plan was drafted. They are settled — do not
re-litigate without strong reason.

| Question | Decision | Rationale |
|---|---|---|
| Module sub-directory or flat? | **Sub-directory `src/tools/character/`** | Keeps the namespace clean; flat `character-*.ts` clutters `tools/` listings. |
| Block formatters with their domain (cohesion) or in a single `blocks.ts`? | **With their domain** | The thing that knows how to compute AC also knows how to format AC. Independent unit-testability is the win. |
| `Mod` as discriminated union now? | **No — defer until after the carve-up.** See "Post-refactor follow-ups" below. | Three risks if done during carve-up: (a) reverse-engineering the schema from defensive coercions is guesswork — a homebrew mod with an unexpected shape would crash where the current `Record<string, unknown>` quietly tolerates it; (b) tightening types interleaves with extracting code in the same diff, breaking the per-phase snapshot diff gate; (c) the existing `m.value ?? m.fixedValue` pattern is intentional "use whichever is present" behavior, not a normalization a union should force. |
| Move `getDefinition` (220 lines)? | **Yes, in Phase 9 as `definition.ts`** | Separate concern, also too long. Easy win once everything else has moved. |
| Snapshot the original `character.ts` to a temp file? | **No — use `git show v2.8.0:src/tools/character.ts`** | Git is the immutable archive. Temp copies rot. |
| Behavioral firewall for the refactor? | **Two-layer: committed vitest snapshots (in-repo fixtures) + manual live-character script** | See "Regression test layers" below. |

---

## Phased migration

Each phase is one PR. Phases must **not** be bundled — the per-phase test gate
is meaningless if the diff covers multiple phases.

| Phase | Extract | Why this phase | Approx lines moved | Risk | Status |
|---|---|---|---|---|---|
| 1 | `helpers.ts`, `templates.ts`, `types.ts` | No business logic — validates the import path / build setup. | ~80 | Trivial | [x] |
| 2 | `core.ts` (`computeCoreStats`) | Establishes the shared-context pattern that everything else depends on. | ~80 | Low | [x] |
| 3 | `identity.ts`, `vitals.ts` | Two simple, independent domains validate the pattern works. | ~120 | Low | [x] |
| 4 | `ac.ts` | Highest single-function complexity. Biggest test win — fixes [character.ts:351 TODO](../src/tools/character.ts#L351). | ~80 | Medium | [x] |
| 5 | `stats.ts`, `defenses.ts`, `features.ts` | Independent of each other; can be one PR or three. | ~280 | Medium | [x] |
| 6 | `weapons.ts`, then `actions.ts` | Weapons first because actions depends on it. | ~150 | Medium | [ ] |
| 7 | `spells.ts` | The most cross-cutting module. Save until the pattern is well-established. | ~200 | High | [ ] |
| 8 | `inventory.ts`, `notes.ts` | Simple. Cleanup. | ~100 | Low | [ ] |
| 9 | Final `parse.ts` carve-up + `definition.ts` move | `parseCharacterData` is mostly imports by now — finish the orchestrator. | — | Low | [ ] |

**When you complete a phase: tick the box above, commit the doc change in the
same PR.** That's how the next agent knows where things stand.

---

## Regression test layers

Three layers, in increasing thoroughness:

### Layer 1 — Existing 156 unit tests (always required)

```bash
npm test
```

These exercise specific edge cases (Remarkable Athlete, JoAT, weapon mastery,
2024 race headers, etc.). They are the primary contract.

### Layer 2 — Committed vitest snapshots (always required)

`tests/character-snapshot.test.ts` runs `parseCharacterData("full")` against
the small hand-built fixtures (`FIGHTER_5`, `MONK_3_HANDAXE`,
`ARCANE_TRICKSTER_9`) exported from `character-parser.test.ts`. Output is
diffed against `tests/__snapshots__/character-snapshot.test.ts.snap` (committed).

Catches **holistic** regressions — section ordering, blank-line spacing,
header dashes — that the targeted unit tests don't assert on.

To intentionally update a snapshot after a deliberate output change:

```bash
npx vitest run tests/character-snapshot.test.ts -u
```

Then **review the snapshot diff in the PR carefully** — the whole point of
this layer is that drift is loud.

### Layer 3 — Manual live-character regression (required before merging each phase)

`scripts/snapshot-live-characters.mts` fetches a curated subset of public
characters from [testcharacters.md](../testcharacters.md) via the saved DDB
session and dumps `parseCharacterData("full")` output for each.

The recorded outputs are **not committed** (contain copyrighted PHB content +
churn frequently as DDB updates content). The workflow is:

```bash
# Before starting a phase:
git checkout main
npx tsx scripts/snapshot-live-characters.mts > /tmp/before.txt

# After finishing the phase:
npx tsx scripts/snapshot-live-characters.mts > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt    # must be empty
```

The curated subset (defined inside the script) covers: high-level full caster
(Calderax, L12 Cleric), multiclass (Xarius, L10 Barb/Rogue), Monk + darkvision
(Flemin), Gloom Stalker initiative (Aerin), 2024 race variant header (Clover),
Draconic Resilience unarmored AC (Caikrana), Remarkable Athlete (Ethelrede),
Artificer (Vi). 8 characters keeps the run under ~30s with the cobalt cache warm.

Requires `ddb_login` to have been run at least once on the local machine.
Skips silently if no session is present.

---

## Migration tactics — per-phase recipe

For each phase:

1. **Capture pre-state:** `npx tsx scripts/snapshot-live-characters.mts > /tmp/before.txt`
2. **Branch:** `git checkout -b refactor/character-phase-N-<short-name>`
3. **Move code:** Cut the relevant code into the new module. Keep identical
   logic — no "while I'm here" tweaks. (The TODOs in `character.ts` get fixed
   in *separate* PRs after the phase lands.)
4. **Add a focused test** for the new module if one doesn't already exist.
5. **Run gate locally:** `npm run typecheck && npm run lint && npm test`
6. **Run snapshot diff:** `npx tsx scripts/snapshot-live-characters.mts > /tmp/after.txt && diff /tmp/before.txt /tmp/after.txt`
7. **Tick the phase checkbox** in this doc.
8. **Commit** with message `refactor(character): phase N — extract <module>`.
9. **Open PR.** Reviewer checks: tests green, snapshot diff empty, only
   intra-character.ts code moved.

---

## What's explicitly out of scope

Things to resist doing in this refactor — they belong in separate PRs after
the carve-up is complete (see "Post-refactor follow-ups" below):

- Fixing the 4 known TODOs ([character.ts:269](../src/tools/character.ts#L269), [character.ts:308](../src/tools/character.ts#L308), [character.ts:351](../src/tools/character.ts#L351), and similar). These are correctness gaps. Fix them in
  follow-up PRs once the relevant module is isolated and easily testable.
- Tightening `Mod` from `Record<string, unknown>` to a discriminated union.
- Adding new features (e.g. supporting more race variants, new modifier types).
- Refactoring `getCharacter`, `downloadCharacter`, `listCharacters`,
  `findCharacterByName` (the network/IO layer is fine as-is).

Each "while I'm here" change widens the diff and weakens the snapshot diff
gate. Keep phases boring.

---

## Post-refactor follow-ups

Work to consider once all 9 phases land. Each is a separate PR with its own
test gate.

### A. Tighten `Mod` to a discriminated union

After the carve-up, each module owns a small focused piece of mod-handling
logic. That makes introducing types **one mod-type at a time** safe — the
blast radius is bounded to one module per change.

Recommended sequence, simplest first:

1. **`proficiency` / `expertise` / `half-proficiency`** — flat shape (just
   `subType`), highest usage count, exercised by every character. Lowest risk.
2. **`bonus`** — most fields (`value`, `fixedValue`, `statId`, `bonusTypes`).
   Touches AC, skills, saves, weapons, initiative, HP. Biggest single win.
3. **`set` / `set-base`** — overlaps with `bonus` shape. Touches AC,
   speeds, ability scores.
4. **`sense`** — narrow surface (only `senses.ts` consumes).
5. **`resistance` / `immunity` / `vulnerability`** — flat, narrow surface
   (only `defenses.ts`).
6. **`language`** — flat, only `stats.ts` (proficiencies block).

Strategy for each step:
- Define the typed shape as a TypeScript `interface`, not a class.
- Update the **one** module that consumes it. Other modules continue to use
  `Record<string, unknown>` until their turn.
- Use a type guard (`function isBonusMod(m): m is BonusMod`) at the module
  boundary so the rest of the module sees the typed shape.
- Run the snapshot diff gate. Empty diff = safe.
- If a homebrew character produces a runtime cast failure, the union's shape
  is wrong — relax the field, don't widen the type globally.

Don't try to share one canonical `Mod` union across modules until at least
3 modules have independently arrived at compatible shapes. Premature
consolidation is what made the original function hard to refactor.

### B. Fix the 4 known TODOs

Each is a one-line correctness fix once the surrounding module is isolated.
Do these as small, focused PRs after their owning module lands:

- [character.ts:269](../src/tools/character.ts#L269) — Monk Unarmored Movement should gate on absence of armor/shield (lands with Phase 3, fix after).
- [character.ts:308](../src/tools/character.ts#L308) — JoAT vs. Remarkable Athlete initiative distinction (already handled, may be removable).
- [character.ts:351](../src/tools/character.ts#L351) — `armored-armor-class` (Defense fighting style) should gate on equipped armor (lands with Phase 4, fix after).
- Any others that surface during the carve-up.

### C. Carve up `getDefinition` if it grows

`getDefinition` lands as `definition.ts` in Phase 9. It's currently 220 lines
with 6 inline formatters. If it grows further, apply the same with-domain
cohesion pattern — split into `definition/` sub-directory with one file per
result type (`spell.ts`, `feat.ts`, etc.). Don't preemptively split it.
