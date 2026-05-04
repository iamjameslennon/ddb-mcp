import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getBrowser, getContext, closeBrowser } from "./browser.js";
import { login } from "./auth.js";
import { getCharacter, downloadCharacter, listCharacters, parseCharacter, findCharacterByName, getDefinition } from "./tools/character.js";
import { getCampaign, listMyCampaigns } from "./tools/campaign.js";
import { navigate, interact, getCurrentPageContent } from "./tools/navigate.js";
import { search } from "./tools/search.js";
import { listLibrary, readBook } from "./tools/library.js";
import { searchMonsters, getMonster } from "./tools/monster.js";
import { getCondition, searchSpells, getSpell, searchItems, getItem } from "./tools/reference.js";

const server = new McpServer({
  name: "dndbeyond",
  version: "1.0.0",
});

// Lazy-initialized shared browser context (headless by default)
async function getSharedContext() {
  const browser = await getBrowser();
  const context = await getContext(browser);
  return context;
}

// Login-specific context — opens a visible window for the OAuth flow
async function getLoginContext() {
  const browser = await getBrowser(false);
  const context = await getContext(browser);
  return context;
}

// ─── ddb_login ────────────────────────────────────────────────────────────────
server.tool(
  "ddb_login",
  "Launch a browser and log into D&D Beyond. A Chrome window will open for you to complete login — it closes automatically once your session is saved. After that, character tools work without any browser.",
  {},
  async () => {
    try {
      const context = await getLoginContext();
      const result = await login(context);
      // Close the browser immediately after saving the session — no need to
      // keep it open since all API-based tools use the saved cookies directly.
      await closeBrowser();
      return { content: [{ type: "text", text: `${result}\nBrowser closed. Session saved to disk — no browser needed for future requests.` }] };
    } catch (err) {
      // Still try to close the browser even if login failed
      await closeBrowser().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_login error: ${msg}\n`);
      return { content: [{ type: "text", text: `Login failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_close_browser ───────────────────────────────────────────────────────
server.tool(
  "ddb_close_browser",
  "Close the background browser window if one is open. Useful after running ddb_navigate, ddb_interact, or ddb_current_page.",
  {},
  async () => {
    try {
      await closeBrowser();
      return { content: [{ type: "text", text: "Browser closed." }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_close_browser error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to close browser: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_characters ──────────────────────────────────────────────────────
server.tool(
  "ddb_list_characters",
  "List all characters in your D&D Beyond account, including their ID, level, race, and class.",
  {},
  async () => {
    try {
      const result = await listCharacters();
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_list_characters error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to list characters: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_character ────────────────────────────────────────────────────────
server.tool(
  "ddb_get_character",
  "Fetch raw character JSON from the D&D Beyond API. WARNING: the response is 300–500 KB of unprocessed data and will consume a large number of tokens. Prefer ddb_parse_character for any play-related question — only use this tool when you explicitly need the raw JSON (e.g. before ddb_download_character, or to inspect fields not surfaced by ddb_parse_character).",
  {
    character_id: z.string().min(1).optional().describe("The D&D Beyond character ID (e.g. '12345678')"),
    character_name: z.string().min(1).optional().describe("Character name to look up (fuzzy matched against your account)"),
  },
  async ({ character_id, character_name }) => {
    try {
      let resolvedId = character_id;
      if (!resolvedId) {
        if (!character_name) {
          return { content: [{ type: "text", text: "Either character_id or character_name must be provided." }], isError: true };
        }
        const found = await findCharacterByName(character_name);
        if (!found) {
          return { content: [{ type: "text", text: `No character found matching "${character_name}". Try ddb_list_characters to see your characters.` }], isError: true };
        }
        resolvedId = found.id;
      }
      const data = await getCharacter(resolvedId);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_get_character error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to get character: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_download_character ───────────────────────────────────────────────────
server.tool(
  "ddb_download_character",
  "Download a character's full JSON data to a local file.",
  {
    character_id: z.string().min(1).describe("The D&D Beyond character ID"),
    output_path: z
      .string()
      .optional()
      .describe("Full file path to save to (defaults to ~/Downloads/{name}-{id}.json)"),
  },
  async ({ character_id, output_path }) => {
    try {
      // No browser needed — uses saved session cookies directly
      const result = await downloadCharacter(character_id, output_path);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_download_character error: ${msg}\n`);
      return { content: [{ type: "text", text: `Download failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_parse_character ─────────────────────────────────────────────────────
server.tool(
  "ddb_parse_character",
  "Return a concise human-readable summary of a D&D Beyond character — far more token-efficient than ddb_get_character. Includes HP, ability scores, saving throws, skills, AC, initiative, speed, feats (correctly filtered to player-chosen only), class features, racial traits, actions, spell slots, spells, inventory, and currency. Works for any public character without login. Accepts either a numeric character_id or a character_name (fuzzy matched against your account).",
  {
    character_id: z.string().min(1).optional().describe("The D&D Beyond character ID (e.g. '12345678')"),
    character_name: z.string().min(1).optional().describe("Character name to look up (fuzzy matched — e.g. 'Throin' finds 'Thorin Ironforge')"),
  },
  async ({ character_id, character_name }) => {
    try {
      let resolvedId = character_id;
      if (!resolvedId) {
        if (!character_name) {
          return { content: [{ type: "text", text: "Either character_id or character_name must be provided." }], isError: true };
        }
        const found = await findCharacterByName(character_name);
        if (!found) {
          return { content: [{ type: "text", text: `No character found matching "${character_name}". Try ddb_list_characters to see your characters.` }], isError: true };
        }
        resolvedId = found.id;
      }
      const summary = await parseCharacter(resolvedId);
      return { content: [{ type: "text", text: summary }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_parse_character error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to parse character: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_definition ───────────────────────────────────────────────────────
server.tool(
  "ddb_get_definition",
  "Look up the full description of a spell, feat, class feature, subclass feature, racial trait, background feature, or equipped item by name. Supports partial and fuzzy name matching (e.g. 'cutting' finds Cutting Words, 'sheild' finds Shield). Accepts either a numeric character_id or a character_name.",
  {
    character_id: z.string().min(1).optional().describe("The D&D Beyond character ID"),
    character_name: z.string().min(1).optional().describe("Character name (fuzzy matched against your account)"),
    name: z.string().min(1).describe("Name to search for — partial match, e.g. 'hunter' finds Hunter's Mark"),
  },
  async ({ character_id, character_name, name }) => {
    try {
      let resolvedId = character_id;
      if (!resolvedId) {
        if (!character_name) {
          return { content: [{ type: "text", text: "Either character_id or character_name must be provided." }], isError: true };
        }
        const found = await findCharacterByName(character_name);
        if (!found) {
          return { content: [{ type: "text", text: `No character found matching "${character_name}". Try ddb_list_characters to see your characters.` }], isError: true };
        }
        resolvedId = found.id;
      }
      const result = await getDefinition(resolvedId, name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_get_definition error: ${msg}\n`);
      return { content: [{ type: "text", text: `Definition lookup failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_search_monsters ──────────────────────────────────────────────────────
server.tool(
  "ddb_search_monsters",
  "Search the D&D Beyond monster compendium by name, CR, type, or size. Returns a summary list. Use ddb_get_monster for the full stat block. Requires login.",
  {
    name: z.string().optional().describe("Partial name to search for (e.g. 'goblin', 'dragon')"),
    cr: z.number().optional().describe("Challenge Rating filter (e.g. 0.25, 1, 5, 20)"),
    type: z.string().optional().describe("Monster type filter (e.g. 'undead', 'fiend', 'beast')"),
    size: z.string().optional().describe("Size filter (e.g. 'large', 'tiny')"),
  },
  async ({ name, cr, type, size }) => {
    try {
      const result = await searchMonsters({ name, cr, type, size });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_search_monsters error: ${msg}\n`);
      return { content: [{ type: "text", text: `Monster search failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_monster ──────────────────────────────────────────────────────────
server.tool(
  "ddb_get_monster",
  "Get the full stat block for a specific monster from the D&D Beyond compendium. Searches by name (partial match). Requires login.",
  {
    name: z.string().min(1).describe("Monster name (e.g. 'Beholder', 'Adult Red Dragon')"),
  },
  async ({ name }) => {
    try {
      const result = await getMonster(name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_get_monster error: ${msg}\n`);
      return { content: [{ type: "text", text: `Monster lookup failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_get_campaign ─────────────────────────────────────────────────────────
server.tool(
  "ddb_get_campaign",
  "Fetch campaign information including player characters, notes, and description from a D&D Beyond campaign page.",
  {
    campaign_id: z.string().min(1).describe("The D&D Beyond campaign ID (found in the campaign URL)"),
  },
  async ({ campaign_id }) => {
    try {
      const context = await getSharedContext();
      const data = await getCampaign(context, campaign_id);
      await closeBrowser();
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      await closeBrowser().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_get_campaign error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to get campaign: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_campaigns ───────────────────────────────────────────────────────
server.tool(
  "ddb_list_campaigns",
  "List all D&D Beyond campaigns you are part of (as DM or player).",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const data = await listMyCampaigns(context);
      await closeBrowser();
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      await closeBrowser().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_list_campaigns error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to list campaigns: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_navigate ─────────────────────────────────────────────────────────────
server.tool(
  "ddb_navigate",
  "Navigate to any D&D Beyond URL and return the page's text content. Only dndbeyond.com URLs are allowed. The browser stays open after this call for follow-up ddb_interact or ddb_current_page calls. Call ddb_close_browser when finished.",
  {
    url: z
      .string()
      .min(1)
      .describe("Full D&D Beyond URL to navigate to (must start with https://www.dndbeyond.com/)"),
  },
  async ({ url }) => {
    try {
      const context = await getSharedContext();
      const content = await navigate(context, url);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_navigate error: ${msg}\n`);
      return { content: [{ type: "text", text: `Navigation failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_interact ─────────────────────────────────────────────────────────────
server.tool(
  "ddb_interact",
  "Interact with the currently loaded D&D Beyond page by clicking, filling a form field, or taking a screenshot.",
  {
    action: z
      .enum(["click", "fill", "screenshot"])
      .describe("The action to perform: click an element, fill a text field, or take a screenshot"),
    selector: z.string().min(1).describe("CSS selector or text selector for the target element"),
    value: z
      .string()
      .optional()
      .describe("Value to type into the field (required for 'fill' action)"),
  },
  async ({ action, selector, value }) => {
    try {
      const context = await getSharedContext();
      const result = await interact(context, action, selector, value);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_interact error: ${msg}\n`);
      return { content: [{ type: "text", text: `Interaction failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_current_page ─────────────────────────────────────────────────────────
server.tool(
  "ddb_current_page",
  "Return the text content of the currently loaded page in the browser. The browser stays open — call ddb_close_browser when finished.",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const content = await getCurrentPageContent(context);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_current_page error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to get page content: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_search ───────────────────────────────────────────────────────────────
server.tool(
  "ddb_search",
  "Search D&D Beyond for spells, monsters, magic items, races, classes, or feats.",
  {
    query: z.string().min(1).describe("The search query (e.g. 'Fireball', 'Beholder', 'Vorpal Sword')"),
    category: z
      .enum(["spells", "monsters", "items", "races", "classes", "feats", "all"])
      .optional()
      .describe("Category to search within (defaults to 'all')"),
  },
  async ({ query, category }) => {
    try {
      const context = await getSharedContext();
      const results = await search(context, query, category ?? "all");
      await closeBrowser();
      return { content: [{ type: "text", text: results }] };
    } catch (err) {
      await closeBrowser().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_search error: ${msg}\n`);
      return { content: [{ type: "text", text: `Search failed: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_list_library ─────────────────────────────────────────────────────────
server.tool(
  "ddb_list_library",
  "List all books and sourcebooks you own in your D&D Beyond library.",
  {},
  async () => {
    try {
      const context = await getSharedContext();
      const books = await listLibrary(context);
      await closeBrowser();
      return { content: [{ type: "text", text: books }] };
    } catch (err) {
      await closeBrowser().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_list_library error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to list library: ${msg}` }], isError: true };
    }
  }
);

// ─── ddb_read_book ────────────────────────────────────────────────────────────
server.tool(
  "ddb_read_book",
  "Read content from an owned D&D Beyond sourcebook. Provide the book slug (e.g. 'players-handbook') and optionally a chapter slug.",
  {
    book_slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9\-\/]*$/, "book_slug may only contain lowercase letters, digits, hyphens, and forward slashes")
      .describe("The book slug from the D&D Beyond URL (e.g. 'players-handbook', 'dungeon-masters-guide')"),
    chapter_slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9\-\/]*$/, "chapter_slug may only contain lowercase letters, digits, hyphens, and forward slashes")
      .optional()
      .describe(
        "Optional chapter or section slug (e.g. 'classes/ranger'). If omitted, returns the book's table of contents."
      ),
  },
  async ({ book_slug, chapter_slug }) => {
    try {
      const context = await getSharedContext();
      const content = await readBook(context, book_slug, chapter_slug);
      await closeBrowser();
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      await closeBrowser().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_read_book error: ${msg}\n`);
      return { content: [{ type: "text", text: `Failed to read book: ${msg}` }], isError: true };
    }
  }
);

// ─── Reference Tools ──────────────────────────────────────────────────────────

server.tool(
  "ddb_get_condition",
  "Look up the rules text for a D&D condition (Blinded, Charmed, Frightened, Grappled, etc.). No login required.",
  {
    name: z.string().min(1).describe("Condition name (e.g. 'frightened', 'grappled')"),
  },
  async ({ name }) => {
    const result = getCondition(name);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "ddb_search_spells",
  "Search the full D&D Beyond spell compendium by name, level, school, concentration, or ritual. First call builds the compendium (slow); subsequent calls are instant. Requires login.",
  {
    name: z.string().optional().describe("Partial spell name (e.g. 'fire' finds Fireball, Fire Storm, etc.)"),
    level: z.number().int().min(0).max(9).optional().describe("Spell level (0 = cantrip)"),
    school: z.string().optional().describe("School of magic (e.g. 'evocation', 'illusion')"),
    concentration: z.boolean().optional().describe("Filter by concentration requirement"),
    ritual: z.boolean().optional().describe("Filter by ritual tag"),
  },
  async ({ name, level, school, concentration, ritual }) => {
    try {
      const result = await searchSpells({ name, level, school, concentration, ritual });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_search_spells error: ${msg}\n`);
      return { content: [{ type: "text", text: `Spell search failed: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  "ddb_get_spell",
  "Get the full description of any spell in the D&D Beyond compendium by name. Not limited to a character's known spells. Requires login.",
  {
    name: z.string().min(1).describe("Spell name (e.g. 'Fireball', 'Hunter\\'s Mark')"),
  },
  async ({ name }) => {
    try {
      const result = await getSpell(name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_get_spell error: ${msg}\n`);
      return { content: [{ type: "text", text: `Spell lookup failed: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  "ddb_search_items",
  "Search the D&D Beyond magic item compendium by name, rarity, or type. Requires login.",
  {
    name: z.string().optional().describe("Partial item name (e.g. 'sword', 'cloak')"),
    rarity: z.string().optional().describe("Rarity filter (e.g. 'rare', 'legendary', 'uncommon')"),
    type: z.string().optional().describe("Item type filter (e.g. 'weapon', 'armor', 'wondrous')"),
  },
  async ({ name, rarity, type }) => {
    try {
      const result = await searchItems({ name, rarity, type });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_search_items error: ${msg}\n`);
      return { content: [{ type: "text", text: `Item search failed: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  "ddb_get_item",
  "Get the full description of any magic item in the D&D Beyond compendium by name. Requires login.",
  {
    name: z.string().min(1).describe("Item name (e.g. 'Bag of Holding', 'Flame Tongue')"),
  },
  async ({ name }) => {
    try {
      const result = await getItem(name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ddb-mcp] ddb_get_item error: ${msg}\n`);
      return { content: [{ type: "text", text: `Item lookup failed: ${msg}` }], isError: true };
    }
  }
);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[ddb-mcp] Received ${signal}, shutting down...\n`);
  await closeBrowser().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("D&D Beyond MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
