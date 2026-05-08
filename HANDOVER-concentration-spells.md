# Handover: Concentration Spell Section

## Background

D&D Beyond does not persist active concentration state in the character API —
the character JSON contains no record of which spell a character is currently
concentrating on. This feature therefore cannot answer "what is Torvin
concentrating on right now?"

What it CAN do is answer "what concentration spells does Torvin have available?"
— which is the information a player actually needs mid-combat to decide whether
dropping concentration is worth it, or which options they have for a new
concentration spell.

---

## Scope

Add a `"concentration"` section to `parseCharacterData` in
`src/tools/character.ts`. No new tool is needed — this slots into the existing
`sections` parameter of `ddb_get_character`.

Usage:
```
ddb_get_character("Torvin", sections: "concentration")
```

---

## Implementation

### 1. Add `"concentration"` to the sections union type

In `src/tools/character.ts`, update the `sections` parameter type:

```typescript
sections: "summary" | "combat" | "spells" | "inventory" | "features" | "concentration" | "full"
```

And update both occurrences in `parseCharacter()` and `parseCharacterData()`.

### 2. Build the concentration block

Add this logic inside `parseCharacterData`, alongside the existing spell
parsing. It should run after the spell compendium is populated by
`addCharacterSpellsToCompendium(char)` (which is already called at the top).

The concentration block should:

1. Collect all prepared/known spells for the character (reuse the spell
   collection logic already in the `spellsBlock` section — do not duplicate it)

2. For each spell, look up `concentration: boolean` from the spell compendium
   via `getSpellFromCompendium(spellName)` or equivalent. The compendium is
   already populated at parse time by `addCharacterSpellsToCompendium`.

3. Filter to spells where `concentration === true`

4. Group by spell level (cantrips first, then level 1–9)

5. Output format:

```
CONCENTRATION SPELLS
  Cantrips (no slot required):
    • Dancing Lights
  Level 1:
    • Faerie Fire  [1st-level slot]
    • Entangle     [1st-level slot]
  Level 2:
    • Invisibility [2nd-level slot]
    • Web          [2nd-level slot]

SPELL SLOTS
  Level 1: 3/3   Level 2: 2/2
```

Include the spell slots summary at the end so the player can see how many
slots they have left for concentration spells.

If the character has no concentration spells: return
`"This character has no concentration spells prepared."`.

### 3. Add to the `switch` statement

```typescript
case "concentration":
  out.push(...concentrationBlock);
  break;
```

### 4. Update `ddb_get_character` tool description in `src/index.ts`

Add `concentration` to the list of valid `sections` values in the description:
```
Use sections to get just summary, combat, spells, inventory, features, concentration, or full.
```

---

## Important notes

- **Do not duplicate spell parsing logic** — the concentration block should
  reuse whatever spell collection helpers already exist in `parseCharacterData`.
  If refactoring is needed to share the logic cleanly, do that first.

- **Spell compendium dependency** — `concentration: true/false` for a spell
  comes from the compendium (populated by `addCharacterSpellsToCompendium`),
  not from the character JSON itself. If a spell isn't in the compendium yet,
  skip it rather than crashing.

- **Wizard spellbook** — Wizards have a full spellbook but only prepared spells
  are shown. Apply the same "prepared only + unprepared rituals" filter that
  the existing `spellsBlock` uses. Do not list the full spellbook.

- **Multiclass casters** — show spells from all classes, grouped by level
  regardless of source class.

---

## Tests

Add to `tests/character-parser.test.ts`:

1. **Has concentration spells** — character with Entangle and Hunter's Mark
   prepared. Assert both appear in the concentration section output.

2. **No concentration spells** — character with only non-concentration spells
   (e.g. Magic Missile, Fireball). Assert the "no concentration spells" message.

3. **Mixed sources** — character with concentration spells from class, racial
   trait, and feat. Assert all sources appear.

4. **Wizard spellbook filter** — Wizard with 10 spells in book, only 3
   prepared (2 concentration). Assert only the 2 prepared concentration spells
   appear, not all 10.

---

## README update

Add `concentration` to the `sections` parameter description in the
`ddb_get_character` row of the Full Tool Reference table, and add an example
prompt to the "For Players" section:

```
What concentration spells do I have prepared as Torvin?
```
