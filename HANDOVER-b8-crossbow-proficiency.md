# Bug B8 — Comma in weapon type name breaks proficiency detection

## Summary

**Character:** Caikrana Qualanthri (ID 40046334) — High Elf Sorcerer (Draconic Bloodline) 1  
**Symptom:** MCP reports `Crossbow, Light  +2 to hit`; DDB website shows `+4`  
**Root cause:** `isWeaponProficient` slugifies the weapon's `type` field with
`.replace(/ /g, "-")` — spaces only. `"Crossbow, Light"` becomes `"crossbow,-light"`
(comma preserved), which never matches the proficiency subType `"crossbow-light"`.

---

## Code path (`src/tools/character.ts` lines 577-583)

```typescript
const isWeaponProficient = (def: Record<string, unknown>): boolean => {
  const catId = num(def.categoryId); // 1=simple, 2=martial
  const typeName = str(def.type).toLowerCase().replace(/ /g, "-");
  //                                                    ^^^^^^^^
  //  Only replaces spaces. "Crossbow, Light" → "crossbow,-light"
  //  Proficiency slug is:                      "crossbow-light"  ← no match!
  return (catId === 1 && weaponProfSlugs.has("simple-weapons")) ||
         (catId === 2 && weaponProfSlugs.has("martial-weapons")) ||
         weaponProfSlugs.has(typeName);
};
```

## Confirmed data

- Weapon `def.type`: `"Crossbow, Light"`  
- Slugified (current): `"crossbow,-light"` ← comma survives  
- Proficiency `subType`: `"crossbow-light"` ← no match → `profMod = 0` → +2 instead of +4

**Other weapons with commas in DDB type names:** `"Crossbow, Hand"` → `"crossbow,-hand"`;
`"Crossbow, Heavy"` → `"crossbow,-heavy"`. All are affected.

---

## Fix

**File:** `src/tools/character.ts` line 579 — change the slugify regex:

```typescript
// BEFORE
const typeName = str(def.type).toLowerCase().replace(/ /g, "-");

// AFTER
const typeName = str(def.type).toLowerCase().replace(/[,\s]+/g, "-");
```

`/[,\s]+/g` replaces any run of commas and/or whitespace with a single hyphen:
- `"Crossbow, Light"` → `"crossbow-light"` ✓
- `"Crossbow, Hand"` → `"crossbow-hand"` ✓  
- `"Hand Crossbow"` → `"hand-crossbow"` ✓  
- `"Dagger"` → `"dagger"` ✓ (unchanged)

---

## Unit test to add

Add to `tests/character-parser.test.ts` (after the weapon attack / proficiency section):

```typescript
// ── Weapon proficiency: comma-containing type names (e.g. "Crossbow, Light") ──
describe("parseCharacterData — comma-in-type-name weapon proficiency", () => {
  const withCrossbow: Record<string, unknown> = {
    data: {
      ...((FIGHTER_5.data) as Record<string, unknown>),
      modifiers: {
        ...((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>,
        class: [
          ...((((FIGHTER_5.data) as Record<string, unknown>).modifiers as Record<string, unknown>).class as unknown[]),
          { type: "proficiency", subType: "crossbow-light" },
        ],
      },
      inventory: [{
        equipped: true,
        quantity: 1,
        definition: {
          name: "Crossbow, Light",
          type: "Crossbow, Light",       // ← contains comma
          filterType: "Weapon",
          categoryId: 1,                 // simple weapon
          attackType: 2,                 // ranged
          damage: { diceCount: 1, diceValue: 8, diceString: "1d8" },
          damageType: "piercing",
          range: 80,
          longRange: 320,
          properties: [{ name: "Ammunition" }, { name: "Loading" }, { name: "Range" }, { name: "Two-Handed" }],
          grantedModifiers: [],
          mastery: "",
        },
      }],
    },
  };

  it("detects proficiency for a weapon whose type name contains a comma", () => {
    const out = parseCharacterData(withCrossbow, "combat");
    // FIGHTER_5: DEX 12 (+1), prof +3 → should be +1+3=+4 with proficiency
    // Without the fix it would be +1 (no prof detected)
    expect(out).toContain("Crossbow, Light  +4 to hit");
  });
});
```

---

## Claude Code prompt

```
In `src/tools/character.ts`, fix `isWeaponProficient` so weapon type names
containing commas (e.g. "Crossbow, Light") are slugified correctly.

**Context:** The function converts `def.type` to a slug with
`.replace(/ /g, "-")` (spaces only). "Crossbow, Light" becomes "crossbow,-light"
(comma survives) which never matches the proficiency subType "crossbow-light".
Result: Sorcerer/Wizard crossbow attack shows +2 (no prof) instead of +4.

**Fix (one line):** Change line ~579 from:
  const typeName = str(def.type).toLowerCase().replace(/ /g, "-");
to:
  const typeName = str(def.type).toLowerCase().replace(/[,\s]+/g, "-");

This also fixes "Crossbow, Hand" → "crossbow-hand" and "Crossbow, Heavy"
→ "crossbow-heavy".

Then add a unit test with a fixture injecting
`{ type: "proficiency", subType: "crossbow-light" }` into the FIGHTER_5
class modifiers and a "Crossbow, Light" (categoryId:1, attackType:2) in
inventory, asserting the attack line contains "+4 to hit".

Run `npx vitest run tests/character-parser.test.ts` to verify. Existing
weapon attack tests must still pass.
```
