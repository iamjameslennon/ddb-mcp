import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Registration checks for the monster tools (B11 G4): the schema and descriptions an MCP client
 * sees, and that `list_all` reaches searchMonsters as `listAll`. The tool itself is stubbed.
 */

const mocks = vi.hoisted(() => ({ searchMonsters: vi.fn(async () => "STUB SEARCH") }));

vi.mock("../src/tools/monster.js", async (orig) => {
  const real = await orig<typeof import("../src/tools/monster.js")>();
  return { ...real, searchMonsters: mocks.searchMonsters };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../src/server.js";

let client: Client;

beforeEach(async () => {
  mocks.searchMonsters.mockClear();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
});

describe("monster tool registrations (G4)", () => {
  it("ddb_search_monsters exposes a boolean list_all whose description mentions the 50 default", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === "ddb_search_monsters")!;
    const prop = (tool.inputSchema.properties as Record<string, { type?: string; description?: string }>).list_all;
    expect(prop).toBeDefined();
    expect(prop.type).toBe("boolean");
    expect(prop.description).toContain("instead of the first 50.");
    expect(tool.inputSchema.required ?? []).not.toContain("list_all");
    expect(tool.description).toContain("at most 50 unless list_all");
    expect(tool.description).toContain("list_all: true");
  });

  it("ddb_clear_cache's description mentions the full monster list under the monsters cache", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === "ddb_clear_cache")!;
    const cache = (tool.inputSchema.properties as Record<string, { description?: string }>).cache;
    expect(cache.description).toMatch(/'monsters' — [^.]*the full monster list/);
  });

  it("list_all: true reaches searchMonsters as listAll: true", async () => {
    await client.callTool({ name: "ddb_search_monsters", arguments: { name: "goblin", list_all: true } });
    expect(mocks.searchMonsters).toHaveBeenCalledTimes(1);
    expect(mocks.searchMonsters).toHaveBeenCalledWith(expect.objectContaining({ name: "goblin", listAll: true }));
  });

  it("an omitted list_all arrives as undefined, not true", async () => {
    await client.callTool({ name: "ddb_search_monsters", arguments: { name: "goblin" } });
    expect(mocks.searchMonsters).toHaveBeenCalledWith(expect.objectContaining({ listAll: undefined }));
  });
});
