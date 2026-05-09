# Bug B6 — Gloom Stalker WIS-to-initiative silently dropped

## Summary

**Character affected:** Aerin Forrestlimb (ID 68903271) — Wood Elf Ranger (Gloom Stalker) 5  
**Symptom:** MCP reports `Initiative: +2`; correct value is `+4`  
**Root cause:** The `initiativeBonus` reducer in `src/tools/character.ts` does not handle
`statId`-based bonus modifiers (value and fixedValue both null, ability stat referenced by
`statId`). The Gloom Stalker's Dread Ambusher feature emits exactly this shape, so its WIS
contribution is silently dropped.

---

## DDB API modifier shape (confirmed from raw character JSON)

```json
{
  "type": "bonus",
  "subType": "initiative",
  "value": null,
  "fixedValue": null,
  "statId": 5,
  "friendlySubtypeName": "Initiative"
}
```

`statId: 5` = WIS. For Aerin, WIS 14 → +2 mod. So initiative should be DEX mod (+2) + WIS mod (+2) = **+4**, not +2.

---

## Root cause (lines 250–256 of `src/tools/character.ts`)

```typescript
const initiativeBonus = allMods
  .filter(m => m.subType === "initiative" && m.type === "bonus")
  .reduce((s, m) => {
    const usesProfBonus = arr<number>(m.bonusTypes).includes(1) && (m.fixedValue == null && m.value == null);
    return s + (usesProfBonus ? profBonus : num(m.fixedValue ?? m.value));
    //                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //  When value==null AND fixedValue==null AND bonusTypes doesn't include 1,
    //  this evaluates to num(null ?? null) = 0.  The statId path is never reached.
  }, 0);
```

The same `statId` pattern is already handled correctly in the skills flat-bonus path
(lines 341–348). The initiative reducer just needs the same treatment.

---

## Fix

**File:** `src/tools/character.ts`  
**Lines 250–256** — replace the `initiativeBonus` reducer:

```typescript
// BEFORE
const initiativeBonus = allMods
  .filter(m => m.subType === "initiative" && m.type === "bonus")
  .reduce((s, m) => {
    // bonusTypes [1] means the bonus value is the proficiency bonus, not a fixed number
    const usesProfBonus = arr<number>(m.bonusTypes).includes(1) && (m.fixedValue == null && m.value == null);
    return s + (usesProfBonus ? profBonus : num(m.fixedValue ?? m.value));
  }, 0);

// AFTER
const initiativeBonus = allMods
  .filter(m => m.subType === "initiative" && m.type === "bonus")
  .reduce((s, m) => {
    // bonusTypes [1] means the bonus value is the proficiency bonus, not a fixed number
    const usesProfBonus = arr<number>(m.bonusTypes).includes(1) && (m.fixedValue == null && m.value == null);
    if (usesProfBonus) return s + profBonus;
    if (m.value != null) return s + num(m.value);
    if (m.fixedValue != null) return s + num(m.fixedValue);
    // statId-based bonus (e.g. Dread Ambusher adds WIS mod to initiative)
    const sid = num(m.statId);
    return s + (sid > 0 ? statMods[sid - 1] : 0);
  }, 0);
```

---

## Unit test to add

Add to `tests/character-parser.test.ts`, after the Remarkable Athlete block:

```typescript
// ── Gloom Stalker Dread Ambusher — statId-based WIS bonus to initiative ────────
// Real DDB API shape: type:"bonus" subType:"initiative" value:null fixedValue:null statId:5
// FIGHTER_5: DEX 12 (+1), WIS 13 (+1)
// Initiative should be DEX mod (+1) + WIS mod (+1) = +2
describe("parseCharacterData — Dread Ambusher WIS-to-initiative (statId-based)", () => {
  const withDreadAmbusher: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          // existing class mods from FIGHTER_5
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>).class as unknown[]),
          // Dread Ambusher: adds WIS mod to initiative, no fixed value — statId only
          { type: "bonus", subType: "initiative", value: null, fixedValue: null, statId: 5, bonusTypes: [] },
        ],
      },
    },
  };

  it("adds WIS modifier to initiative when statId:5 initiative bonus is present", () => {
    const out = parseCharacterData(withDreadAmbusher, "summary");
    // DEX mod (+1) + WIS mod (+1) = +2
    expect(out).toContain("Initiative: +2");
  });

  it("does not affect initiative when no statId-based bonus is present", () => {
    const out = parseCharacterData(FIGHTER_5, "summary");
    // FIGHTER_5 DEX 12 → +1, no initiative bonus
    expect(out).toContain("Initiative: +1");
  });
});
```

---

## Claude Code prompt

```
In `src/tools/character.ts`, fix the initiative bonus reducer to handle statId-based
bonus modifiers (the same way the skill flat-bonus path already does).

**Context:** The Gloom Stalker subclass feature Dread Ambusher grants WIS modifier to
initiative. DDB encodes this as:
  { type: "bonus", subType: "initiative", value: null, fixedValue: null, statId: 5 }

The current reducer at lines ~250-256 only handles (a) proficiency-bonus via bonusTypes[1]
and (b) fixed numeric value/fixedValue. When both are null and bonusTypes doesn't include 1,
it evaluates `num(null ?? null) = 0` and silently drops the bonus.

**Fix:** Replace the reducer body so that after checking proficiency-bonus and fixed-value
cases, it falls through to: `const sid = num(m.statId); return s + (sid > 0 ? statMods[sid - 1] : 0);`

Then add a unit test in `tests/character-parser.test.ts` (after the Remarkable Athlete
block) with a fixture that injects `{ type: "bonus", subType: "initiative", value: null,
fixedValue: null, statId: 5, bonusTypes: [] }` into the FIGHTER_5 class modifiers, and
asserts that Initiative shows DEX mod + WIS mod (both +1 in FIGHTER_5 → "Initiative: +2").

Run `npx vitest run tests/character-parser.test.ts` to verify. The existing JoAT and
Remarkable Athlete initiative tests must continue to pass.
```
