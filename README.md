# D&D Beyond MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude direct access to your D&D Beyond account — characters, campaigns, sourcebooks, spells, monsters, and more.

## Features

| Tool | Description |
|------|-------------|
| `ddb_login` | Authenticate with D&D Beyond (Wizards ID). Run once to save your session to disk. |
| `ddb_list_characters` | List all characters in your account with ID, level, race, and class. |
| `ddb_parse_character` | Parse a character into a compact, readable summary (HP, stats, skills, spells, equipment). Much cheaper than `ddb_get_character`. |
| `ddb_get_character` | Fetch raw character JSON from the D&D Beyond API. Use `ddb_parse_character` instead unless you need the raw data. |
| `ddb_download_character` | Save a character's full JSON data to a local file. |
| `ddb_list_campaigns` | List all campaigns you're part of (as DM or player). |
| `ddb_get_campaign` | Fetch campaign details — DM, description, and active characters. |
| `ddb_list_library` | List all sourcebooks you own, purchased, or have shared with you. |
| `ddb_read_book` | Read content from an owned sourcebook, optionally by chapter slug. |
| `ddb_search` | Search for spells, monsters, magic items, races, classes, or feats. |
| `ddb_navigate` | Navigate to any D&D Beyond URL and return its text content. |
| `ddb_interact` | Click, fill, or screenshot the currently loaded browser page. |
| `ddb_current_page` | Return the text content of whatever page is currently loaded. |

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

**Get full raw character data:**
```
Get the full character sheet JSON for character ID 140476673
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

**Navigate to a specific page:**
```
Navigate to https://www.dndbeyond.com/spells/2619012-fireball and show me the content
```

**Interact with a page:**
```
Navigate to my character sheet and take a screenshot
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

```
Roland Stonehelm — Mountain Dwarf | Fighter (Battle Master) 5
Background: Soldier | XP: 6500

HP: 49/49 | Temp HP: 0
Hit Dice: 5d10 (5 remaining)
Speed: 25 ft.
AC: 18 (chain mail + shield)
Initiative: +2

STR 18 (+4)  DEX 14 (+2)  CON 16 (+3)  INT 10 (+0)  WIS 12 (+1)  CHA 8 (-1)

Proficiency Bonus: +3

SAVING THROWS
  Strength:     +7 ✓
  Dexterity:    +2
  Constitution: +6 ✓
  Intelligence: +0
  Wisdom:       +1
  Charisma:     -1

SKILLS
  Athletics:    +7 ✓
  Perception:   +4
  ...

PASSIVE PERCEPTION: 14

EQUIPMENT
  Chain Mail (equipped)
  Shield (equipped)
  Longsword (equipped)
  ...

CURRENCY: 0 pp, 45 gp, 0 ep, 12 sp, 0 cp
```

## Upgrading

To upgrade to the latest release, run the install command again — npm will overwrite the existing installation:

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

**Character returns 403**
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

Forked from [ddb-mcp/ddb-mcp](https://github.com/ddb-mcp/ddb-mcp). This fork adds:

- `ddb_parse_character` — compact human-readable character summaries
- Session-based API fetching (no browser needed after login for character/search operations)
- Performance improvements: `domcontentloaded` + targeted selectors instead of `networkidle`
- Security hardening: path traversal protection, slug validation, session file permissions
- Graceful shutdown handling

## License

MIT
