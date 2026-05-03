# D&D Beyond MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude direct access to your D&D Beyond account — characters, campaigns, sourcebooks, spells, monsters, and more.

## Features

| Tool | Description |
|------|-------------|
| `ddb_login` | Authenticate with D&D Beyond (Wizards ID). Run once to save your session to disk. |
| `ddb_list_characters` | List all characters in your account with ID, level, race, and class. |
| `ddb_parse_character` | Parse a character into a compact, readable summary. Covers all stats, skills, spells, actions, and inventory. Much more token-efficient than `ddb_get_character`. |
| `ddb_get_character` | Fetch raw character JSON from the D&D Beyond API. Use `ddb_parse_character` unless you need the raw data. |
| `ddb_download_character` | Save a character's full JSON data to a local file. |
| `ddb_list_campaigns` | List all campaigns you're part of (as DM or player). |
| `ddb_get_campaign` | Fetch campaign details — DM, description, and active characters. |
| `ddb_list_library` | List all sourcebooks you own, purchased, or have shared with you. |
| `ddb_read_book` | Read content from an owned sourcebook, optionally by chapter slug. |
| `ddb_search` | Search for spells, monsters, magic items, races, classes, or feats. |
| `ddb_navigate` | Navigate to any D&D Beyond URL and return its text content. Keeps the browser open for follow-up calls. |
| `ddb_interact` | Click, fill, or screenshot the currently loaded browser page. |
| `ddb_current_page` | Return the text content of whatever page is currently loaded. |
| `ddb_close_browser` | Close the background browser window. Call this when finished with `ddb_navigate`, `ddb_interact`, or `ddb_current_page`. |

## Prerequisites

- [Node.js](https://nodejs.org) 18 or later
- [Claude Code](https://claude.ai/claude-code) CLI

## Installation

### Option A — Install directly from GitHub (recommended)

```bash
npm install -g "https://github.com/iamjameslennon/ddb-mcp/archive/refs/heads/main.tar.gz"
```

Then install the browser:

```bash
npx playwright install chromium
```

Find the install path and register with Claude Code:

```bash
npm root -g
# outputs something like /usr/local/lib/node_modules
```

```bash
claude mcp add dndbeyond node /usr/local/lib/node_modules/ddb-mcp/dist/index.js
```

---

### Option B — Clone and build manually

```bash
git clone https://github.com/iamjameslennon/ddb-mcp.git
cd ddb-mcp
npm install
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

## Usage

### First-time login

The first time you use the server, you need to authenticate:

```
ddb_login
```

A browser window (Chrome for Testing) will open and navigate to the D&D Beyond login page. Complete the login using your Wizards ID account. Once you're redirected back to D&D Beyond, your session is automatically saved to `~/.config/ddb-mcp/session.json` and reused on all future calls.

You only need to log in once. If your session expires, just run `ddb_login` again.

### Example prompts

**List your characters:**
```
List all my D&D Beyond characters
```

**Get a character summary:**
```
Give me a summary of character ID 140476673
```

**List your campaigns:**
```
What campaigns am I part of on D&D Beyond?
```

**Get campaign details:**
```
Show me the details for campaign 6709239, including all the player characters
```

**Search for spells:**
```
Search D&D Beyond for spells named "Fireball"
```

**Search for monsters:**
```
Find the Beholder stat block on D&D Beyond
```

**Read a sourcebook:**
```
Show me the table of contents for the Player's Handbook
```

```
Read the Barbarian class section from the Player's Handbook
```

**Download a character:**
```
Download the character data for Roland Stonehelm to my Downloads folder
```

### Finding character and campaign IDs

- **Character ID**: The number in the character URL — `dndbeyond.com/characters/140476673`
- **Campaign ID**: The number in the campaign URL — `dndbeyond.com/campaigns/6709239`

You can also use `ddb_list_characters` and `ddb_list_campaigns` to get IDs without leaving Claude.

### Book slugs for `ddb_read_book`

Use `ddb_list_library` to get the slug for any book you own. Examples:

| Book | Slug |
|------|------|
| Player's Handbook (2024) | `dnd/phb-2024` |
| Dungeon Master's Guide (2024) | `dnd/dmg-2024` |
| Monster Manual (2024) | `dnd/mm-2024` |
| Player's Handbook (2014) | `dnd/phb-2014` |

To read a specific chapter, pass the chapter path after the book slug:

```
ddb_read_book("dnd/phb-2024", "character-classes/barbarian")
```

### Sample `ddb_parse_character` output

The output below is real — truncated slightly for length. It shows a Tiefling Wizard 2 with a mix of prepared spells, unprepared rituals, and spells from racial traits and feats.

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

BACKGROUND FEATURE
  Magic Initiate (Wizard)

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

Key things `ddb_parse_character` handles correctly:

- **Wizards**: only shows prepared spells and unprepared rituals (castable from spellbook without a slot) — not the full spellbook
- **Spell sources**: racial traits, class features, feats, and magic items are all labelled separately
- **Ritual spells**: marked with `[ritual]` in the spell list
- **Actions**: weapons include to-hit bonus, damage, range, and mastery properties; magic item bonuses (+1/+2/+3) are applied to both hit and damage
- **Bonus actions / reactions**: spell-based bonus actions and reactions (Healing Word, Shield, Hunter's Mark, Hellish Rebuke, etc.) appear in the correct section with slot cost
- **AC**: correctly calculates Unarmored Defense for Barbarians and Monks; selects best armor when multiple items are equipped
- **Skills**: Jack of All Trades applied for 2014 Bards; expertise marked with `**`
- **Initiative**: Alert feat and Jack of All Trades bonuses applied correctly, with 2014/2024 rule differences handled
- **Multiclass**: hit dice shown per class, spell slots computed from combined caster levels

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

## Session storage

Your session is saved to `~/.config/ddb-mcp/session.json`. This file contains browser cookies and local storage from your D&D Beyond login. Keep this file private — it grants access to your account.

To log out or reset your session, delete the file:

```bash
rm ~/.config/ddb-mcp/session.json
```

## Troubleshooting

**"Not logged in" or 403 errors**
Your session has expired. Run `ddb_login` to re-authenticate.

**Chromium not found / browser won't launch**
Install the browser:
```bash
npx playwright install chromium
```

**Character returns 403 or "private"**
The character is set to private on D&D Beyond. The owner must make it public, or you must be logged in as the owner.

**MCP server not appearing in Claude Code**
Run `/mcp` in Claude Code to reconnect. If it still doesn't appear, verify the path in `claude mcp list` points to the correct `dist/index.js`.

**Server crashes on startup**
Make sure you're running Node.js 18 or later: `node --version`.

## Development

```bash
# Run in development mode (no build step needed)
npm run dev

# Build
npm run build

# Watch mode
npm run build:watch

# Run tests
npm test
```

## Credits

Forked from [ddb-mcp/ddb-mcp](https://github.com/ddb-mcp/ddb-mcp). This fork significantly expands `ddb_parse_character` and adds session-based API fetching so most operations don't require a browser after initial login.

**Character parsing improvements:**

- **Complete stat block**: saving throws, all 18 skills with proficiency/expertise markers, senses (passive scores + darkvision/tremorsense), proficiencies & training (armor, weapons, tools, languages), damage resistances/immunities/vulnerabilities, conditions, inspiration, death saves, hit dice per class
- **Accurate AC**: Unarmored Defense calculated correctly for Barbarians (10 + DEX + CON) and Monks (10 + DEX + WIS); when multiple armors are equipped, picks the best-AC combination; shield stacks additively
- **Correct spell display for Wizards**: shows only prepared spells and unprepared rituals (castable without a slot) — not the full spellbook. Unprepared non-ritual spells are correctly excluded
- **All spell sources**: racial traits, class features, feats, and magic items each labelled separately. Previously only class spells and some feat spells were shown
- **Ritual spells**: marked with `[ritual]` so it's clear they can be cast without expending a slot
- **Full action classification**: bonus actions and reactions list both class features (Cunning Action, Rage, Bardic Inspiration, Wild Shape, etc.) and spell-based entries (Healing Word, Hunter's Mark, Shield, Hellish Rebuke) with slot cost shown
- **Magic weapon bonuses**: enhancement bonuses (+1/+2/+3) from `grantedModifiers` applied to both to-hit and damage rolls
- **Weapon properties and mastery**: Finesse, Light, Thrown, Versatile, Heavy, Two-Handed, Reach, Ammunition shown per weapon; weapon mastery properties (Nick, Vex, Cleave, Topple, Graze, Sap, Slow) shown where applicable
- **Skill and initiative accuracy**: Jack of All Trades applied correctly for Bards (2014 rules apply JoAT to initiative; 2024 rules do not); Alert feat adds proficiency bonus (2024) or +5 flat (2014) to initiative
- **Proficiency deduplication**: multiclass and race/class overlap no longer produces duplicate entries in weapon or armor proficiency lists
- **Spell slot accuracy**: phantom spell slots suppressed for non-spellcasting classes (Barbarian, Monk, Scout Rogue, etc.); Arcane Trickster and Eldritch Knight correctly receive their third-caster slots
- **Unequipped weapon filtering**: only equipped weapons generate attack entries in ACTIONS
- **Placeholder filtering**: unfilled character builder strings ("Choose a gaming set", "Self") excluded from proficiency output
- **Multiclass support**: hit dice shown per class; spell slots computed from combined caster levels using standard multiclassing rules

**Other improvements:**

- Session-based API fetching (no browser required after login for character/search operations)
- Performance: `domcontentloaded` + targeted selectors instead of `networkidle`
- Security: path traversal protection, slug validation, session file permissions (0600)
- Graceful shutdown handling

## License

MIT
