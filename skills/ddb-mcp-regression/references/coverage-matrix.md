# Coverage matrix

One section per tool. The `Scenarios:` line lists the situations that apply to that tool. Each bullet is one example of what a user might ask, then what a suitable reply does. Phrase requests in your own words as a player or DM would, and vary them; the example is a starting point, not a script.

Each section also has a `Not applicable:` line naming the scenarios that don't apply to that tool, so you can see every one was considered. A tool is **covered** when every scenario on its `Scenarios:` line has been run and judged. Tick it off in the notes as you go. Anything you skip goes in the report's "Not covered" section with the reason; never drop a scenario silently.

Scenario meanings:
- `normal`: an ordinary request that should succeed.
- `invalid`: a malformed parameter (bad ID, bad CR, a path escape, an off-site URL). Expect a clear refusal that says what was wrong.
- `not-found`: something that doesn't exist. Expect a plain "not found", ideally with near matches, never an invented answer.
- `ambiguous`: a partial or shared name. Expect the choices listed, or a stated pick with the reason, never a silent guess.
- `locked`: content in a book the account doesn't own. Expect it to say so (on a free account this is normal, not a finding).
- `edition`: the same request with `rules_edition: "2014"` and with the default (2024). Expect the right edition and a label naming it, plus a reason line when the other edition is shown.
- `source`: a request limited to one book with `source`. Expect only that book's entries, each tagged, and a note when the book's edition differs from `rules_edition`.
- `homebrew`: `source: "homebrew"`, only when the account has homebrew (see SKILL.md, "Account type"). Expect only homebrew entries, each tagged `[homebrew]` and wrapped as untrusted, in lists and in full entries. Without homebrew on the account, list it under "Not covered".
- `pagination`: `limit`/`offset` (or `list_all` for monsters). Expect stable pages, an honest total, and nothing lost between pages.
- `gate`: a safety gate. Test the refusal first (the call without its confirmation). Run the confirmed call only where this matrix says so.
- `logged-out`: the same request with no session (only in the logged-out pass). Expect public data or the SRD fallback, labelled, or a clear "log in first".

## `ddb_login`

Scenarios: normal
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate, logged-out

- normal: (only when no session exists) "Log me in to D&D Beyond" → opens a sign-in window, says what to do, and confirms the account once signed in. The window waits up to 3 minutes; closing it by hand replies that the window was closed before sign-in finished, not "timed out".

## `ddb_logout`

Scenarios: normal
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate, logged-out

- normal: (logged-out pass only, after the contributor agrees) "Log me out" → says the saved session is deleted and how to log back in.

## `ddb_close_browser`

Scenarios: normal
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate, logged-out

- normal: "Close the browser" after a browser tool → confirms it closed; calling it again with nothing open is harmless.

## `ddb_clear_cache`

Scenarios: normal, invalid
Not applicable: not-found, ambiguous, locked, edition, source, homebrew, pagination, gate, logged-out

- normal: "Clear the cached data" (all, then one named cache) → confirms what was cleared; the next lookup still works.
- invalid: a cache name that doesn't exist → refused with the valid names.

## `ddb_list_characters`

Scenarios: normal, logged-out
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate

- normal: "What characters do I have?" → the account's characters with IDs; names wrapped as untrusted.
- logged-out: same request → a clear "log in first".

## `ddb_get_character`

Scenarios: normal, invalid, not-found, ambiguous, logged-out
Not applicable: locked, edition, source, homebrew, pagination, gate

- normal: per `test-characters.md` (each character's `Ask` list), e.g. "What's Flemin's AC and HP?" → the section that answers it, numbers consistent across sections, `Rules:` line present.
- invalid: a non-numeric or nonsense ID → clear refusal.
- not-found: an ID that doesn't exist (e.g. 52514332) → "not found (404)" with advice, no dangling colon.
- ambiguous: a partial name that fits two of the contributor's characters → choices or a stated pick.
- logged-out: a public test character by ID → works; by name → explains that name lookup needs login.

## `ddb_character_lookup`

Scenarios: normal, not-found, logged-out
Not applicable: invalid, ambiguous, locked, edition, source, homebrew, pagination, gate

- normal: "What does Sneak Attack do for Ezra?" (127373542) → the entry's text, tagged with its edition.
- not-found: something the character doesn't have → plain "not found on this character", near matches if any.
- logged-out: a public test character by ID → works.

## `ddb_get_character_raw`

Scenarios: normal, gate, logged-out
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination

- gate: call without `confirm_large_response` → the parameter is required by the schema, so expect a validation error naming it; suitable when a user's AI would know what to do next.
- normal: once only, with `confirm_large_response: true`, on a small public test character (a level 1, e.g. 133055442) → JSON wrapped as untrusted.
- logged-out: same small public character → works (public characters need no login).

## `ddb_download_character`

Scenarios: normal, gate, invalid
Not applicable: not-found, ambiguous, locked, edition, source, homebrew, pagination, logged-out

- gate: an `output_path` outside `~/Downloads` and `~/Documents` (e.g. `/tmp/x.json`, or `~/Downloads/../evil.json`) → refused, nothing written.
- invalid: a non-numeric character ID → refused.
- normal: once only, a public test character into `~/Downloads` → says where the file went. List the file under "Files left behind".

## `ddb_list_campaigns`

Scenarios: normal, logged-out
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate

- normal: "Which campaigns am I in?" → campaigns with IDs; the reply is wrapped as untrusted (DM-written names).
- logged-out: a clear "log in first".

## `ddb_get_campaign`

Scenarios: normal, not-found, logged-out
Not applicable: invalid, ambiguous, locked, edition, source, homebrew, pagination, gate

- normal: one of the contributor's campaigns → details, wrapped as untrusted.
- not-found: a campaign ID that doesn't exist or isn't theirs → clear message.
- logged-out: a clear "log in first".

## `ddb_get_party`

Scenarios: normal, not-found, logged-out
Not applicable: invalid, ambiguous, locked, edition, source, homebrew, pagination, gate

- normal: "Give me the party's AC, HP and passive Perception" → one block per member, each with a `Rules:` line; player and character names wrapped.
- not-found: a bad campaign ID → clear message.
- logged-out: a clear "log in first".

## `ddb_search_monsters`

Scenarios: normal, not-found, ambiguous, locked, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, gate

- normal: "Show me goblins" → only names containing the word; related fuzzy hits, if any, marked as such.
- not-found: "Show me a flumph-dragon" → plain "no match", near matches.
- ambiguous: "Show me red dragons" → every creature with that in its name (wyrmling to ancient, both editions' twins counted), each tagged, never one picked silently. (A broad search such as "dragons" tests the 50 cap instead: see pagination.)
- locked: a monster from an unowned book → listed with a locked note, not hidden or zeroed.
- edition: "Show me an owlbear" with 2014 → the 2014 version and its label.
- source: "Monsters from the 2024 Monster Manual only" → that book's entries, each tagged.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: "Show me dragons" → capped at 50 with the exact total and a size estimate; a filter-only search (CR 5, undead) → the true total; `list_all: true` only after the count and size were reported.
- logged-out: "Show me goblins" → anonymous results or the SRD fallback, labelled.

## `ddb_get_monster`

Scenarios: normal, not-found, ambiguous, locked, edition, source, homebrew, logged-out
Not applicable: invalid, pagination, gate

- normal: "Stat block for a Wraith" → full stat block, `Rules:` line.
- not-found: a made-up monster → "not found", near matches.
- ambiguous: "Stat block for a red dragon" → by design it picks a match (exact, then partial, then D&D Beyond's closest hit, only when that hit is close to the name) rather than asking; suitable when the reply names which creature it shows, so the user can tell if it's the wrong one. A close pick says so on its own line ("No monster is named …; showing the closest match, …"). A made-up name gives "not found" with near matches, never a stat block.
- locked: a monster from an unowned book → says it's locked; never `Armor Class 0` or `HP 0`.
- edition: "the 2014 Owlbear" → 2014 block and label; default gives 2024.
- source: a monster from a named book → that book's version, with a note if its edition contradicts `rules_edition`.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew results, the full entry wrapped, each `[homebrew]` and wrapped as untrusted.
- logged-out: "Stat block for a Goblin" → anonymous or SRD fallback, labelled.

## `ddb_search_spells`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "Which 3rd-level wizard spells need concentration?" → filtered list, each tagged.
- not-found: a nonsense spell name → "no spells found", near matches.
- edition: "Healing Word, 2014 version" → 2014 entry; default 2024.
- source: spells from one book (an unowned one too) → that book's spells, or a clear "you don't own this book" rather than "No spells found".
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: a broad search with `limit`/`offset` → consistent pages and total.
- logged-out: same search → SRD fallback, labelled.

## `ddb_get_spell`

Scenarios: normal, not-found, ambiguous, locked, edition, source, homebrew, logged-out
Not applicable: invalid, pagination, gate

- normal: "What does Shield do?" → full text, correct casting time (Reaction, with trigger), `Rules:` line.
- not-found: a made-up spell → "not found", near matches.
- ambiguous: a partial name ("Cure") → a stated pick, with an `Also matches: …. Ask for one by name.` line right after the Rules lines naming the other spells (wrapped as untrusted when any is homebrew).
- locked: a spell from an unowned book → says it's locked.
- edition: "Sleep, 2014 version" → 2014 text; default gives 2024 (which is concentration).
- source: a spell from a named book → that book's version, note if editions differ.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew results, the full entry wrapped, each `[homebrew]` and wrapped as untrusted.
- logged-out: "What does Fireball do?" → SRD fallback, labelled.

## `ddb_search_equipment`

Scenarios: normal, not-found, edition, source, homebrew, logged-out
Not applicable: invalid, ambiguous, locked, pagination, gate

- normal: "Rare magic swords" → filtered list, each tagged.
- not-found: a nonsense item → "no items found".
- edition: "Longsword" with 2014 → no 2024 mastery text.
- source: items from one book → that book's items.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- logged-out: same search → SRD fallback, labelled.

## `ddb_get_equipment`

Scenarios: normal, not-found, locked, edition, source, homebrew, logged-out
Not applicable: invalid, ambiguous, pagination, gate

- normal: "What does a Bag of Holding do?" → full entry, `Rules:` line.
- not-found: a made-up item → "not found", near matches.
- locked: an item from an unowned book → says it's locked.
- edition: "Longsword, 2014" → no mastery paragraph; default 2024 shows mastery.
- source: an item from a named book → that book's version.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew results, the full entry wrapped, each `[homebrew]` and wrapped as untrusted.
- logged-out: "Longsword" → SRD fallback, labelled.

## `ddb_search_races`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "What species can I play?" → list, each tagged.
- not-found: a nonsense species → "none found".
- edition: "Tiefling, 2014" → 2014 race; default 2024 species.
- source: species from one book → that book's entries.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: `limit`/`offset` → consistent pages.
- logged-out: same → SRD fallback, labelled.

## `ddb_search_classes`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "Tell me about the Paladin" → class entry, tagged.
- not-found: a nonsense class → "none found".
- edition: "Ranger, 2014" → 2014 class.
- source: classes from one book.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: `limit`/`offset` → consistent pages.
- logged-out: same → SRD fallback, labelled.

## `ddb_search_backgrounds`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "Which backgrounds give Stealth?" → list, tagged.
- not-found: a nonsense background → "none found".
- edition: "Criminal, 2014" → 2014 background.
- source: backgrounds from one book.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: `limit`/`offset` → consistent pages.
- logged-out: same → SRD fallback, labelled.

## `ddb_search_feats`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "Feats that need Strength 13" (`prerequisite`) → filtered list, tagged ("Str or Dex 13+" counts; identical rows such as five Ability Score Improvements merge to one ending ` ×5`).
- not-found: a nonsense feat → "none found".
- edition: "Great Weapon Master, 2014" → 2014 feat.
- source: feats from one book.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: `limit`/`offset` with `prerequisite` → consistent pages (the fallback once dropped these).
- logged-out: same → SRD fallback, labelled.

## `ddb_search_class_features`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "What does a level 2 Rogue get?" → features for that class and level, tagged.
- not-found: a nonsense feature → "none found".
- edition: "Rogue level 2 features, 2014" → 2014 features.
- source: features from one book.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: `limit`/`offset` → consistent pages.
- logged-out: same → SRD fallback or clear message.

## `ddb_search_racial_traits`

Scenarios: normal, not-found, edition, source, homebrew, pagination, logged-out
Not applicable: invalid, ambiguous, locked, gate

- normal: "What traits does a Dwarf have?" → traits, tagged.
- not-found: a nonsense trait → "none found".
- edition: "Dwarf traits, 2014" → 2014 traits.
- source: traits from one book.
- homebrew: `source: "homebrew"` (homebrew accounts only) → only homebrew entries, each `[homebrew]` and wrapped as untrusted.
- pagination: `limit`/`offset` → consistent pages.
- logged-out: same → SRD fallback or clear message.

## `ddb_search_rules`

Scenarios: normal, not-found, edition, logged-out
Not applicable: invalid, ambiguous, locked, source, homebrew, pagination, gate

- normal: "How does grappling work?" → matching sections; if the requested SRD lacks it, says so and shows the other SRD's match.
- not-found: a nonsense term → "no match".
- edition: "cover rules, 2014" → SRD 5.1 sections, labelled.
- logged-out: same → works (no login needed).

## `ddb_get_rules`

Scenarios: normal, not-found, edition, logged-out
Not applicable: invalid, ambiguous, locked, source, homebrew, pagination, gate

- normal: "Read me the Cover rules" → the section text, `Rules:` line; a `query` not in the text says so and suggests `ddb_search_rules`.
- not-found: a nonsense chapter → "not found", suggestions.
- edition: "Damage and Healing, 2014" → SRD 5.1 text.
- logged-out: same → works.

## `ddb_get_condition`

Scenarios: normal, not-found, edition, logged-out
Not applicable: invalid, ambiguous, locked, source, homebrew, pagination, gate

- normal: "What does Grappled do?" → 2024 text, labelled.
- not-found: a made-up condition → "not found", the list of conditions.
- edition: "Exhaustion, 2014" → the 2014 six-level table.
- logged-out: same → works.

## `ddb_rate_encounter`

Scenarios: normal, invalid, not-found, ambiguous, edition, logged-out
Not applicable: locked, source, homebrew, pagination, gate

- normal: "Four level 5s against a Wraith and two Ghouls — how hard?" → 2024 rating with the XP sums shown.
- invalid: a bad CR or party level → clear refusal.
- not-found: a monster name that matches nothing → listed as uncounted with "supply cr", and no headline rating that ignores it.
- ambiguous: "Red Dragon" (the tool description's own example) → the candidates listed with their CRs, never picked. A name that exactly matches one creature is counted, even a third-party one (D&D Beyond has a third-party monster named "Dragon").
- edition: same encounter with 2014 → Easy/Medium/Hard/Deadly with the multiplier.
- logged-out: same → works (anonymous monster lookups).

## `ddb_encounter_cr`

Scenarios: normal, invalid, edition, logged-out
Not applicable: not-found, ambiguous, locked, source, homebrew, pagination, gate

- normal: "What CR should a hard fight be for four level 5s?" → CR per encounter shape.
- invalid: a party level of 0 or 30 → clear refusal.
- edition: same with 2014 → classic DMG difficulty names.
- logged-out: same → works.

## `ddb_roll_treasure`

Scenarios: normal, invalid, not-found, ambiguous, edition, logged-out
Not applicable: locked, source, homebrew, pagination, gate

- normal: "Roll treasure for a CR 7 hoard" → 2024 table results, labelled.
- invalid: a negative CR or an oversized monster list → clear refusal.
- not-found: a monster name that matches nothing → reported, not guessed.
- ambiguous: "Red Dragon" → reported with the candidates, not picked.
- edition: asked for 2014 → rolls the 2024 tables and says so; monster CRs come from 2014 stat blocks.
- logged-out: same → works.

## `ddb_list_library`

Scenarios: normal, logged-out
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate

- normal: "Which books do I own?" → owned books, each tagged with its edition. Use this to record the account type.
- logged-out: a clear "log in first".

## `ddb_read_book`

Scenarios: normal, invalid, not-found, locked, logged-out
Not applicable: ambiguous, edition, source, homebrew, pagination, gate

- normal: "Read the Combat chapter of the Basic Rules" (a free book) → text within `max_chars`, `Rules:` line, wrapped as untrusted; no long runs of blank lines.
- invalid: a slug with odd characters → refused clearly.
- not-found: a book title that doesn't exist → "not found", owned-book suggestions.
- locked: a book the account doesn't own → says so plainly.
- logged-out: a clear "log in first".

## `ddb_search_site`

Scenarios: normal, not-found, edition, logged-out
Not applicable: invalid, ambiguous, locked, source, homebrew, pagination, gate

- normal: "Search D&D Beyond for Vorpal" → results whose names contain the term, per category, tagged.
- not-found: a nonsense term → "no results".
- edition: same with 2014 → 2014 versions, other edition's twins counted.
- logged-out: same → works or falls back, labelled.

## `ddb_navigate`

Scenarios: normal, invalid
Not applicable: not-found, ambiguous, locked, edition, source, homebrew, pagination, gate, logged-out

- normal: open a public test character sheet or a compendium page (read-only) → page text, wrapped as untrusted.
- invalid: an off-site URL (e.g. https://example.com) → refused by the allowlist.

## `ddb_get_page`

Scenarios: normal
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, gate, logged-out

- normal: after `ddb_navigate` → the current page's text, wrapped as untrusted.

## `ddb_interact`

Scenarios: normal, gate
Not applicable: invalid, not-found, ambiguous, locked, edition, source, homebrew, pagination, logged-out

- gate: `click` without `confirm_click` and `fill` without `confirm_fill` → both refused, nothing done.
- normal: `screenshot` on any page; `click`/`fill` with confirmation only on the public dndbeyond.com site search box, never on a character sheet, builder, campaign or settings page.

## Characters

Every row of `test-characters.md` is also a row of this matrix. A character is covered when everything in its `Ask` list has been requested and judged. The contributor's own characters, campaigns, party and library are covered once each by the tools above.
