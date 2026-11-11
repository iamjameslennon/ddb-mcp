/**
 * Keeps the ddb-mcp-regression skill (skills/ddb-mcp-regression/) in step with
 * the code and the docs it summarises: the test-character list, the registered
 * tools and their parameters, the open carry-overs, and the skill's own shape.
 * The skill's testing AI has only the MCP tools, so anything stale in these
 * references turns into false findings or missed coverage.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { server } from "../src/server.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** A repo-relative file as UTF-8. */
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Table rows shaped `| <digits> | <name> |`, trimmed. */
function idNameRows(md: string): { id: string; name: string }[] {
  return [...md.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|/gm)].map(m => ({ id: m[1], name: m[2] }));
}

/** The `## Character List` table of testcharacters.md (same rule as scripts/regress-all-characters.mts). */
function characterList(): { id: string; name: string }[] {
  const text = read("testcharacters.md");
  const start = text.indexOf("## Character List");
  const end = text.indexOf("\n## ", start + 1);
  return idNameRows(text.slice(start, end < 0 ? undefined : end));
}

let toolList: Promise<{ name: string; params: string[] }[]> | undefined;
/**
 * The registered tools and their parameter names, listed once. The shared
 * `server` throws "Already connected to a transport" on a second connect, so
 * the client is closed after listing (which also disconnects the server side).
 */
function listedTools(): Promise<{ name: string; params: string[] }[]> {
  toolList ??= (async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "regression-skill-test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const { tools } = await client.listTools();
      return tools.map(t => ({ name: t.name, params: Object.keys(t.inputSchema.properties ?? {}) }));
    } finally {
      await client.close();
    }
  })();
  return toolList;
}

describe("regression skill: test characters", () => {
  it("lists exactly the characters in testcharacters.md, by ID and name", () => {
    const key = (r: { id: string; name: string }) => `${r.id} ${r.name}`;
    const skill = idNameRows(read("skills/ddb-mcp-regression/references/test-characters.md")).map(key);
    expect(new Set(skill).size).toBe(skill.length); // no duplicates
    expect([...skill].sort()).toEqual(characterList().map(key).sort());
  });
});

describe("regression skill: coverage matrix and tool map", () => {
  const VOCAB = ["normal", "invalid", "not-found", "ambiguous", "locked", "edition", "source", "pagination", "gate", "logged-out"];
  const matrixMd = () => read("skills/ddb-mcp-regression/references/coverage-matrix.md");
  const sections = (md: string) =>
    new Map([...md.matchAll(/^## `(ddb_[a-z_]+)`\n+Scenarios: (.+)$/gm)].map(m => [m[1], m[2].split(",").map(s => s.trim())]));
  /** The `- <scenario>:` bullets of one tool's section. */
  const bullets = (md: string, tool: string) => {
    const body = md.split(/^## /m).find(part => part.startsWith(`\`${tool}\``)) ?? "";
    return [...body.matchAll(/^- ([a-z-]+):/gm)].map(m => m[1]);
  };

  it("has one matrix section per registered tool, using only the vocabulary", async () => {
    const tools = await listedTools();
    const matrix = sections(matrixMd());
    expect([...matrix.keys()].sort()).toEqual(tools.map(t => t.name).sort());
    for (const [tool, scenarios] of matrix) {
      expect(scenarios, tool).toContain("normal");
      for (const s of scenarios) expect(VOCAB).toContain(s);
      expect([...bullets(matrixMd(), tool)].sort(), tool).toEqual([...scenarios].sort()); // one bullet per scenario
    }
    expect(matrixMd()).toContain("\n## Characters\n");
  });

  it("derives schema-driven scenarios from each tool's parameters", async () => {
    const matrix = sections(matrixMd());
    for (const { name, params } of await listedTools()) {
      const s = matrix.get(name)!;
      if (params.includes("rules_edition")) expect(s, name).toContain("edition");
      if (params.includes("source")) expect(s, name).toContain("source");
      if (params.some(p => ["limit", "offset", "list_all"].includes(p))) expect(s, name).toContain("pagination");
      if (params.some(p => p.startsWith("confirm_") || p === "output_path")) expect(s, name).toContain("gate");
    }
  });

  it("maps every registered tool to source files", async () => {
    const mapped = [...read("skills/ddb-mcp-regression/references/tool-map.md").matchAll(/^\| `(ddb_[a-z_]+)` \|/gm)].map(m => m[1]);
    expect(mapped.sort()).toEqual((await listedTools()).map(t => t.name).sort());
  });
});
