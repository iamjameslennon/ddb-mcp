# Bug B7 — Draconic Resilience unarmored AC ignored

## Summary

**Character:** Caikrana Qualanthri (ID 40046334) — High Elf Sorcerer (Draconic Bloodline) 1  
**Symptom:** MCP reports `AC: 12`; DDB website shows `AC: 15`  
**Root cause:** The unarmored AC code always uses `10 + DEX` as the base, ignoring the
`value` field on `type:"set"` modifiers for `subType:"unarmored-armor-class"`. Draconic
Resilience raises the base from 10 to 13 (value = 3), which the code silently drops.

---

## DDB API modifier shape (confirmed from raw JSON)

```json
{
  "type": "set",
  "subType": "unarmored-armor-class",
  "value": 3,
  "fixedValue": 3,
  "statId": null
}
```

Interpretation: the base unarmored AC is SET to `10 + value = 13`, then DEX is added.  
Correct AC: 13 + DEX (+2) = **15**.

---

## Root cause (`src/tools/character.ts` ~lines 284-293)

```typescript
const unarmoredMod = allMods.find(m => m.subType === "unarmored-armor-class");
if (unarmoredMod) {
  const extraStatId = num(unarmoredMod.statId); // 3=CON, 5=WIS
  const extraMod = extraStatId > 0 ? statMods[extraStatId - 1] : 0;
  ac = 10 + dexMod + extraMod;
  //   ^^  hardcoded — never uses unarmoredMod.value/fixedValue
}
```

This works for Barbarian (`statId:3` → CON) and Monk (`statId:5` → WIS), but not for
Draconic Resilience, which has `statId: null` and `value: 3` (base lift, not an extra stat).

---

## Two distinct unarmored-AC patterns

| Feature | type | statId | value | Correct formula |
|---------|------|--------|-------|-----------------|
| Barbarian Unarmored Defense | bonus | 3 (CON) | null | 10 + DEX + CON |
| Monk Unarmored Defense | bonus | 5 (WIS) | null | 10 + DEX + WIS |
| Draconic Resilience (2014) | set | null | 3 | 10 + 3 + DEX = 13 + DEX |

---

## Fix

**File:** `src/tools/character.ts` — unarmored AC block (~lines 284-293):

```typescript
// BEFORE
const unarmoredMod = allMods.find(m => m.subType === "unarmored-armor-class");
if (unarmoredMod) {
  const extraStatId = num(unarmoredMod.statId); // 3=CON, 5=WIS
  const extraMod = extraStatId > 0 ? statMods[extraStatId - 1] : 0;
  ac = 10 + dexMod + extraMod;
}

// AFTER
const unarmoredMod = allMods.find(m => m.subType === "unarmored-armor-class");
if (unarmoredMod) {
  const extraStatId = num(unarmoredMod.statId); // 3=CON (Barbarian), 5=WIS (Monk)
  const extraMod = extraStatId > 0 ? statMods[extraStatId - 1] : 0;
  // type:"set" with a value lifts the base (e.g. Draconic Resilience sets base to 13)
  const baseBonus = unarmoredMod.type === "set" ? num(unarmoredMod.fixedValue ?? unarmoredMod.value) : 0;
  ac = 10 + baseBonus + dexMod + extraMod;
}
```

---

## Unit test to add

Add to `tests/character-parser.test.ts` (after the unarmored defense / AC section):

```typescript
// ── Draconic Resilience — type:"set" unarmored-armor-class raises base to 13 ──
// Caikrana: DEX 15 (+2), Draconic Resilience value:3 → AC = 10+3+2 = 15
describe("parseCharacterData — Draconic Resilience unarmored AC", () => {
  const withDraconicResilience: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      // Override to a DEX-only character with no armor
      inventory: [],
      modifiers: {
        race: [],
        class: [
          // Draconic Resilience: sets unarmored base to 13 (value=3 means +3 on top of 10)
          { type: "set", subType: "unarmored-armor-class", value: 3, fixedValue: 3, statId: null },
        ],
        background: [],
        feat: [],
        item: [],
        condition: [],
      },
    },
  };

  it("applies type:set unarmored-armor-class value to base AC", () => {
    const out = parseCharacterData(withDraconicResilience, "summary");
    // FIGHTER_5 has DEX 12 (+1); Draconic Resilience base = 10+3 = 13; total = 13+1 = 14
    expect(out).toContain("AC: 14");
  });

  it("does not affect Barbarian-style CON unarmored defense", () => {
    const withBarbarian: Record<string, unknown> = {
      data: {
        ...((FIGHTER_5.data) as Record<string, unknown>),
        inventory: [],
        modifiers: {
          race: [],
          class: [
            // Barbarian Unarmored Defense: bonus, statId=3 (CON)
            { type: "bonus", subType: "unarmored-armor-class", value: null, fixedValue: null, statId: 3 },
          ],
          background: [],
          feat: [],
          item: [],
          condition: [],
        },
      },
    };
    const out = parseCharacterData(withBarbarian, "summary");
    // FIGHTER_5: DEX 12 (+1), CON 14 (+2) → 10+1+2=13
    expect(out).toContain("AC: 13");
  });
});
```

---

## Claude Code prompt

```
In `src/tools/character.ts`, fix the unarmored AC calculation to handle
Draconic Resilience (and any other feature that uses `type:"set"` on
`subType:"unarmored-armor-class"` with a numeric `value`).

**Context:** Draconic Bloodline Sorcerer's Draconic Resilience emits:
  { type: "set", subType: "unarmored-armor-class", value: 3, fixedValue: 3, statId: null }

The existing code finds this modifier but ignores its value, always using
hardcoded base 10. The correct formula is: AC = (10 + value) + DEX = 13 + DEX.

Barbarian (statId:3 → CON) and Monk (statId:5 → WIS) are unaffected because
their modifier has statId set and value null.

**Fix:** In the unarmored AC block, after computing `extraMod` from `statId`,
add: `const baseBonus = unarmoredMod.type === "set" ? num(unarmoredMod.fixedValue ?? unarmoredMod.value) : 0;`
then change `ac = 10 + dexMod + extraMod` to `ac = 10 + baseBonus + dexMod + extraMod`.

Then add a unit test using the FIGHTER_5 fixture with a class modifier
`{ type:"set", subType:"unarmored-armor-class", value:3, fixedValue:3, statId:null }`
asserting AC = 10+3+DEX(+1) = 14.

Verify: `npx vitest run tests/character-parser.test.ts`. Barbarian and Monk
unarmored defense tests must still pass.
```
