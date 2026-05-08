# D&D Beyond MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude direct access to your D&D Beyond account — characters, campaigns, sourcebooks, spells, monsters, rules, encounter planning, treasure generation, and more.

---

## For Players

Use Claude as a session companion that knows your character as well as you do.

**Know your character inside out**
```
Give me a full summary of my character Torvin
```
```
What spells do I have prepared right now?
```
```
Which of my spells can I cast as rituals without using a slot?
```
```
What's my passive perception and investigation?
```

**Look up your abilities mid-session**
```
How does Uncanny Dodge work on Kestrel?
```
```
What does Hunter's Mark do — can I move it as a bonus action?
```
```
Show me the full text of the Alert feat on my character
```

**Check the rules without leaving the table**
```
What are the rules for grappling?
```
```
What does the Stunned condition do?
```
```
How does concentration work?
```
```
Remind me of the rules for death saving throws
```

**Look up spells and equipment in the compendium**
```
What does Silvery Barbs do?
```
```
Show me the stats for a Flame Tongue longsword
```
```
What's the difference between a Shortbow and a Longbow?
```

**Read your sourcebooks**
```
Show me the table of contents for the Player's Handbook
```
```
Read the Ranger class section from the 2024 Player's Handbook
```

---

## For Dungeon Masters & Game Masters

Use Claude to plan sessions, build encounters, and run the table faster.

**Plan and rate encounters**
```
How hard is this encounter for my party of 4 level 5 players:
2 trolls and a hill giant?
```
```
What CR should I target for a Moderate difficulty encounter
for my party of 3 level 8 characters?
```
```
Give me CR targets for a solo boss fight vs my party of 5 level 10s
```

**Generate treasure**
```
Roll a hoard for a CR 15 encounter for a level 12 party
```
```
Generate individual treasure for 4 bandits and their CR 5 captain
```

**Look up monsters on the fly**
```
Show me the full stat block for a Young Red Dragon
```
```
Find all Large undead with CR 5 or lower
```
```
What monsters have the Legendary Resistance trait?
```

**Manage your campaign**
```
List all the characters in my campaign
```
```
Show me the details for campaign 6709239 — who's playing what?
```

**Read sourcebooks for prep**
```
Read the Lair Actions section from the Monster Manual
```
```
What does the DMG say about setting DCs for ability checks?
```
```
Show me the treasure tables chapter from the Dungeon Master's Guide
```

**Rule lookups mid-session**
```
What are the rules for improvised weapons?
```
```
How does the Exhaustion condition work in 2024 rules?
```
```
Can a character use the Help action to assist with a skill check?
```

---

## Full Tool Reference

### Character Tools

| Tool | Description |
|------|-------------|
| `ddb_login` | Authenticate with D&D Beyond (Wizards ID). Run once — session is saved to disk and reused. |
| `ddb_list_characters` | List all characters in your account with ID, level, race, and class. |
| `ddb_get_character` | Parse a character into a compact, readable sheet. Covers all stats, skills, spells, actions, and inventory. Use `sections` to get just `summary`, `combat`, `spells`, `inventory`, `features`, or `full`. Accepts name (fuzzy matched) or numeric ID. |
| `ddb_get_character_raw` | Fetch raw character JSON from the D&D Beyond API. Use `ddb_get_character` for all normal use. |
| `ddb_download_character` | Save a character's full JSON to a local file (must be under ~/Downloads or ~/Documents). |
| `ddb_character_lookup` | Look up the full description of a spell, feat, class feature, racial trait, or item on a character sheet. Supports partial and fuzzy name matching. |

### Campaign Tools

| Tool | Description |
|------|-------------|
| `ddb_list_campaigns` | List all campaigns you're part of (as DM or player). |
| `ddb_get_campaign` | Fetch campaign details — DM, description, and active characters with their levels. |

### Monster & Encounter Tools

| Tool | Description |
|------|-------------|
| `ddb_search_monsters` | Search the D&D Beyond monster compendium by name, CR, type, or size. |
| `ddb_get_monster` | Get the full formatted stat block for a monster by name. |
| `ddb_rate_encounter` | Rate encounter difficulty for a party. Defaults to 2024 XDMG rules (Low/Moderate/High). Set `rules_edition: "2014"` for classic DMG (Easy/Medium/Hard/Deadly). Monsters are looked up automatically. |
| `ddb_encounter_cr` | Given a party and target difficulty, returns recommended CRs broken down by encounter shape: solo boss, duo, squad, horde. |
| `ddb_roll_treasure` | Generate treasure using 2024 XDMG tables. `hoard` rolls once at the highest CR and includes magic items; `individual` rolls per monster. |

### Spell & Reference Tools

| Tool | Description |
|------|-------------|
| `ddb_search_spells` | Search the full D&D Beyond spell compendium by name, level, school, concentration, or ritual. |
| `ddb_get_spell` | Get the full description of any spell by name. |
| `ddb_search_equipment` | Search the item/equipment compendium by name, rarity, or type. Covers mundane weapons, armour, and magic items. |
| `ddb_get_equipment` | Get the full stats and description of any item — weapon damage, properties, range, STR requirement, etc. |
| `ddb_get_condition` | Look up the rules text for a condition (Poisoned, Stunned, Grappled, etc.). No login required. |
| `ddb_search_rules` | Search all 45 SRD rules sections by keyword. No login required. |
| `ddb_get_rules` | Read the full text of any SRD rules section (Spellcasting, Attacking, Combat, Multiclassing, Rest, Environment, etc.). Supports `query` to jump to a keyword within long sections. No login required. |
| `ddb_search_races` | Search all races and subraces in the D&D Beyond compendium (including homebrew). |
| `ddb_search_classes` | Search all classes with hit die, spellcasting info, and subclasses. |
| `ddb_search_backgrounds` | Search all backgrounds (including homebrew). |
| `ddb_search_feats` | Search feats by name or prerequisite. |
| `ddb_search_class_features` | Search class features by name, class, or level gained. |
| `ddb_search_racial_traits` | Search racial traits by name or race. |

### Library & Navigation Tools

| Tool | Description |
|------|-------------|
| `ddb_list_library` | List all sourcebooks you own, purchased, or have shared with you. |
| `ddb_read_book` | Read content from an owned sourcebook by book slug and optional chapter. |
| `ddb_search_site` | Search D&D Beyond by keyword across spells, monsters, items, races, classes, and feats. |
| `ddb_navigate` | Navigate to any D&D Beyond URL and return its text content. Keeps the browser open for follow-up calls. |
| `ddb_interact` | Click, fill (requires `confirm_fill: true`), or screenshot the currently loaded page. |
| `ddb_get_page` | Return the text content of the currently loaded page. |
| `ddb_close_browser` | Close the background browser window. Call this when done with `ddb_navigate`, `ddb_interact`, or `ddb_get_page`. |

---

## Prerequisites

- [Node.js](https://nodejs.org) 18 or later
- [Claude Code](https://claude.ai/claude-code) CLI

---

## Installation

### Option A — Install from npm (recommended)

```bash
npm install -g @iamjameslennon/ddb-mcp
```

Then:

```bash
npm root -g
```

```bash
claude mcp add dndbeyond node /usr/local/lib/node_modules/@iamjameslennon/ddb-mcp/dist/index.js
```

---

### Option B — Clone and build manually

```bash
git clone https://github.com/iamjameslennon/ddb-mcp.git
cd ddb-mcp
npm ci
npx playwright install chromium
```

Register with Claude Code:

```bash
claude mcp add dndbeyond node /absolute/path/to/ddb-mcp/dist/index.js
```

Or edit `~/.claude/settings.json` manually:

```json
{
  "mcpServers": {
    "dndbeyond": {
      "command": "node",
      "args": ["/absolute/path/to/ddb-mcp/dist/index.js"]
    }
  }
}
```

---

## First-time login

Run `ddb_login` once to authenticate:

```
ddb_login
```

A browser window will open and navigate to the D&D Beyond login page. Complete the login using your Wizards ID account. Once redirected back to D&D Beyond, your session is automatically saved to `~/.config/ddb-mcp/session.json` and reused on all future calls — no browser needed again until the session expires.

---

## Finding character and campaign IDs

- **Character ID**: the number in the character URL — `dndbeyond.com/characters/140476673`
- **Campaign ID**: the number in the campaign URL — `dndbeyond.com/campaigns/6709239`

You can also use `ddb_list_characters` and `ddb_list_campaigns` to get IDs without leaving Claude.

---

## Book slugs for `ddb_read_book`

Use `ddb_list_library` to get the slug for any book you own. Common examples:

| Book | Slug |
|------|------|
| Player's Handbook (2024) | `dnd/phb-2024` |
| Dungeon Master's Guide (2024) | `dnd/dmg-2024` |
| Monster Manual (2024) | `dnd/mm-2024` |
| Player's Handbook (2014) | `dnd/phb-2014` |

To read a specific chapter, pass the chapter path after the book slug:

```
Read the Ranger class section from the 2024 Player's Handbook
→ book_slug: "dnd/phb-2024", chapter_slug: "character-classes/ranger"
```

---

## Sample `ddb_get_character` output

The output below is real — truncated slightly for length. It shows a Tiefling Wizard 2 with prepared spells, unprepared rituals, and spells from racial traits and feats.

```
═══════════════════════════════════════
  Claude Skamos
  Tiefling | Wizard 2 | Level 2
  Background: Sage | XP: 0
  Inspiration: No
═══════════════════════════════════════

HP: 10/10   Temp HP: —   Prof Bonus: +2
Hit Dice: 2d6 (2 remaining)
AC: 10   Initiative: +0   Speed: 30 ft.
Death Saves: Successes 0/3   Failures 0/3

ABILITY SCORES
  STR 8 (-1)  DEX 10 (+0)  CON 10 (+0)  INT 17 (+3)  WIS 15 (+2)  CHA 14 (+2)

SAVING THROWS
  STR -1   DEX +0   CON +0   INT +5*   WIS +4*   CHA +2
  (* proficient)

SKILLS
  Acrobatics (DEX)       +0
  Animal Handling (WIS)  +2
  Arcana (INT)           +5 *
  Athletics (STR)        -1
  Deception (CHA)        +2
  History (INT)          +7 **
  Insight (WIS)          +2
  Investigation (INT)    +5 *
  Perception (WIS)       +4 *
  ... (all 18 skills shown)
  (* proficient, ** expertise)

SENSES
  Passive Perception: 14   Passive Investigation: 15   Passive Insight: 12
  Darkvision 60 ft.

PROFICIENCIES & TRAINING
  Armor: None
  Weapons: Simple Weapons
  Tools: Calligraphers supplies
  Languages: Common, Common sign language, Draconic

DEFENSES
  Resistances: Fire
  Immunities: (none)
  Vulnerabilities: (none)
CONDITIONS: (none)

FEATS (2)
• Magic Initiate (Wizard): Two Cantrips. You learn two cantrips of your choice...
• Sage Ability Score Improvements: ...

CLASS FEATURES
• Core Wizard Traits (Wizard 1)
• Spellcasting (Wizard 1)
• Ritual Adept (Wizard 1)
• Arcane Recovery (Wizard 1)
• Scholar (Wizard 2)

ACTIONS
• Dagger           +2 to hit   1d4 piercing   reach 5 ft.   Finesse, Light, Thrown, Nick
• Quarterstaff     +1 to hit   1d6-1 bludgeoning   reach 5 ft.   Versatile, Topple

BONUS ACTIONS
  (none)

REACTIONS
• Opportunity Attack
• Shield (spell, 1st-level slot)

LIMITED USE
• Arcane Recovery   0 used / 1 max   (Long Rest)

SPELLCASTING
  Wizard: INT  Spell Attack: +5  Save DC: 13

SPELL SLOTS
  Level 1: 3/3

SPELLS
  Cantrips: Mage Hand, Light, Message
  Spells: Comprehend Languages (L1 [ritual]), Detect Magic (L1 [ritual]),
          Find Familiar (L1 [ritual]), Magic Missile (L1), Shield (L1),
          Mage Armor (L1), Chromatic Orb (L1), Grease (L1), ...
  From Racial Trait: Fire Bolt, Thaumaturgy
  From Feat: Dancing Lights, Mending, Tasha's Hideous Laughter (L1)

INVENTORY
  Spellbook, Parchment ×18, Backpack, Calligrapher's Supplies, Robe, ...

ATTUNEMENT: 0/3 slots used
CURRENCY: 34gp, 7sp
```

Key things `ddb_get_character` handles correctly:

- **Wizards**: only shows prepared spells and unprepared rituals (castable from spellbook without a slot) — not the full spellbook
- **Spell sources**: racial traits, class features, feats, and magic items are all labelled separately
- **Ritual spells**: marked with `[ritual]` in the spell list
- **Actions**: weapons include to-hit bonus, damage, range, and mastery properties; magic item bonuses (+1/+2/+3) are applied to both hit and damage
- **Bonus actions / reactions**: spell-based bonus actions and reactions (Healing Word, Shield, Hunter's Mark, Hellish Rebuke, etc.) appear in the correct section with slot cost
- **AC**: correctly calculates Unarmored Defense for Barbarians and Monks; selects best armor when multiple items are equipped
- **Skills**: Jack of All Trades applied for Bards; expertise marked with `**`
- **Initiative**: Alert feat and Jack of All Trades bonuses applied correctly, with 2014/2024 rule differences handled
- **Multiclass**: hit dice shown per class, spell slots computed from combined caster levels

---

## Upgrading

To upgrade to the latest release, run the install command again:

```bash
npm install -g "https://github.com/iamjameslennon/ddb-mcp/archive/refs/heads/main.tar.gz"
```

To install a specific tagged version:

```bash
npm install -g "https://github.com/iamjameslennon/ddb-mcp/archive/refs/tags/v2.0.0.tar.gz"
```

Then restart Claude Code and run `/mcp` to reconnect the server.

---

## Session storage

Your session is saved to `~/.config/ddb-mcp/session.json`. This file contains browser cookies from your D&D Beyond login. Keep it private — it grants access to your account.

To log out or reset your session:

```bash
rm ~/.config/ddb-mcp/session.json
```

---

## Troubleshooting

**"Not logged in" or 403 errors**
Your session has expired. Run `ddb_login` to re-authenticate.

**Chromium not found / browser won't launch**
```bash
npx playwright install chromium
```

**Character returns 403 or "private"**
The character is set to private on D&D Beyond. You must be logged in as the owner, or the owner must make it public.

**MCP server not appearing in Claude Code**
Run `/mcp` in Claude Code to reconnect. If it still doesn't appear, verify the path in `claude mcp list` points to the correct `dist/index.js`.

**Server crashes on startup**
Make sure you're running Node.js 18 or later: `node --version`.

---

## Development

```bash
# Install dependencies (always use npm ci — not npm install)
npm ci

# Run in development mode (no build step needed)
npm run dev

# Build
npm run build

# Watch mode
npm run build:watch

# Run tests
npm test
```

---

## Credits

Forked from [ddb-mcp/ddb-mcp](https://github.com/ddb-mcp/ddb-mcp). The monster, reference, and session-workflow tooling was inspired by [dndbeyond-mcp](https://www.npmjs.com/package/dndbeyond-mcp). This fork significantly expands character parsing, adds session-based API fetching, and introduces compendium, reference, encounter, and treasure tools.

**Character parsing improvements:**

- **Complete stat block**: saving throws, all 18 skills with proficiency/expertise markers, senses (passive scores + darkvision/tremorsense), proficiencies & training (armor, weapons, tools, languages), damage resistances/immunities/vulnerabilities, conditions, inspiration, death saves, hit dice per class
- **Accurate AC**: Unarmored Defense calculated correctly for Barbarians (10 + DEX + CON) and Monks (10 + DEX + WIS); when multiple armors are equipped, picks the best-AC combination; shield stacks additively
- **Correct spell display for Wizards**: shows only prepared spells and unprepared rituals — not the full spellbook
- **All spell sources**: racial traits, class features, feats, and magic items each labelled separately
- **Ritual spells**: marked with `[ritual]`
- **Full action classification**: bonus actions and reactions list both class features and spell-based entries with slot cost
- **Magic weapon bonuses**: enhancement bonuses (+1/+2/+3) applied to both to-hit and damage
- **Weapon properties and mastery**: all properties and mastery tags shown per weapon
- **Skill and initiative accuracy**: Jack of All Trades and Alert feat handled correctly for both 2014 and 2024 rules
- **Multiclass support**: hit dice per class, spell slots from combined caster levels

**Other improvements:**

- Session-based API fetching (no browser required after login for most tools)
- Encounter difficulty rating for both 2024 XDMG and 2014 DMG rules
- Treasure generation using 2024 XDMG tables
- SRD rules search and retrieval (no login required)
- Security: path constraints on file writes, slug validation, session file permissions (0600), prompt injection gate on browser form fills

---

## License

MIT
