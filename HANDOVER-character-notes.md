# Handover: Character Notes & Backstory Section

## Background

The D&D Beyond character JSON exposes two top-level objects with roleplay
content that `ddb_get_character` currently ignores entirely:

- `char.traits` — personality traits, ideals, bonds, flaws, physical appearance
- `char.notes` — backstory, allies, organisations, personal possessions, other notes

These fields are null for characters where the player hasn't filled them in,
but for characters with written backstories they contain the full text. This
section surfaces all of it in one call, giving Claude the roleplay context it
needs to assist with in-character decisions, NPC interactions, and session prep.

---

## Scope

Add a `"notes"` section to `parseCharacterData` in `src/tools/character.ts`.
No new tool needed — slots into the existing `sections` parameter.

Usage:
```
ddb_get_character("Torvin", sections: "notes")
```

---

## Implementation

### 1. Add `"notes"` to the sections union type

In `src/tools/character.ts`, update the `sections` parameter type:

```typescript
sections: "summary" | "combat" | "spells" | "inventory" | "features" | "concentration" | "notes" | "full"
```

Update both occurrences in `parseCharacter()` and `parseCharacterData()`.

### 2. Build the notes block

Add this inside `parseCharacterData`. The fields map directly from the
character JSON:

**From `char.traits`:**
- `char.traits.personalityTraits`
- `char.traits.ideals`
- `char.traits.bonds`
- `char.traits.flaws`
- `char.traits.appearance`

**From `char.notes`:**
- `char.notes.backstory`
- `char.notes.allies`
- `char.notes.organizations`
- `char.notes.personalPossessions`
- `char.notes.otherNotes`

Target output format:

```
PERSONALITY
  Traits:      I use polysyllabic words that convey the impression of great erudition.
  Ideals:      Knowledge. The path to power and self-improvement is through knowledge.
  Bonds:       My life's work is a series of tomes related to a forbidden topic.
  Flaws:       I speak without thinking, often saying the wrong thing entirely.
  Appearance:  Tall, pale, silver hair. Always wears dark robes.

BACKSTORY
  Raised in a small village on the outskirts of Waterdeep, Claude Skamos ...
  [full backstory text]

ALLIES & ORGANISATIONS
  Allies:        The Harpers — contacted through an intermediary.
  Organisations: The Arcane Brotherhood (former member, left under difficult circumstances).

ADDITIONAL NOTES
  Possessions:  A locket containing a portrait of a woman I don't recognise.
  Other:        Owes a debt to a devil named Astaroth.
```

**Formatting rules:**
- Skip any field that is null or empty string entirely — do not print the label
- If an entire section (e.g. ALLIES & ORGANISATIONS) has no non-null fields,
  skip the whole section header too
- If ALL fields across both `char.traits` and `char.notes` are null/empty,
  return: `"No notes or backstory have been recorded for this character."`
- Strip HTML from field values using the existing `stripHtml()` utility from
  `src/utils.ts` — DDB sometimes stores these fields with HTML tags

### 3. Add to the `switch` statement

```typescript
case "notes":
  out.push(...notesBlock);
  break;
```

### 4. Include notes in `"full"` section

Add `...notesBlock` to the `"full"` case so a complete character sheet
includes notes. Place it last, after `inventoryBlock`.

### 5. Update tool description in `src/index.ts`

Add `notes` to the sections list in the `ddb_get_character` description:
```
Use sections to get just summary, combat, spells, inventory, features,
concentration, notes, or full.
```

---

## Important notes

- **HTML stripping is required** — backstory and notes fields from DDB
  frequently contain `<p>`, `<br>`, `<strong>` and similar tags. Always pass
  through `stripHtml()` before outputting.

- **Fields are free text** — no parsing or transformation needed beyond HTML
  stripping. Output the text as-is.

- **`char.traits` vs `char.background.definition.description`** — the
  background definition has a generic description of the background (e.g.
  "Sages spend their lives..."). `char.traits` has the player's own written
  entries. Only use `char.traits` — the generic background description is
  already surfaced elsewhere.

---

## Tests

Add to `tests/character-parser.test.ts`:

1. **All fields populated** — character mock with all traits and notes fields
   filled. Assert all sections appear in output with correct labels.

2. **Partial fields** — character with only `backstory` and `bonds` set, rest
   null. Assert only those two appear; no empty label lines.

3. **All null** — character with all traits/notes null. Assert the
   "no notes recorded" message.

4. **HTML stripping** — character with `<p>My backstory</p>` in backstory
   field. Assert output contains `My backstory` without tags.

5. **Full section includes notes** — assert `parseCharacterData(raw, "full")`
   output contains the notes block.

---

## README update

Add `notes` to the `sections` parameter description in the `ddb_get_character`
row of the Full Tool Reference table.

Add example prompts to the "For Players" section:

```
Tell me about Torvin's backstory and personality
What organisations is Kestrel affiliated with?
```
