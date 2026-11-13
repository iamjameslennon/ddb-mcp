/**
 * Keeps the ddb-mcp-regression skill (skills/ddb-mcp-regression/) in step with
 * the code and the docs it summarises: the test-character list, the registered
 * tools and their parameters, the open carry-overs, and the skill's own shape.
 * The skill's testing AI has only the MCP tools, so anything stale in these
 * references turns into false findings or missed coverage.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  const VOCAB = ["normal", "invalid", "not-found", "ambiguous", "locked", "edition", "source", "homebrew", "pagination", "gate", "logged-out"];
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

  it("marks every scenario of every tool as applicable or not (spec goal 5)", () => {
    const md = matrixMd();
    for (const [tool, scenarios] of sections(md)) {
      const body = md.split(/^## /m).find(part => part.startsWith(`\`${tool}\``)) ?? "";
      const na = /^Not applicable: (.+)$/m.exec(body)?.[1].split(",").map(x => x.trim()).filter(x => x !== "none") ?? null;
      expect(na, `${tool} has no "Not applicable:" line`).not.toBeNull();
      expect([...scenarios, ...na!].sort(), tool).toEqual([...VOCAB].sort());
    }
  });

  it("tests homebrew wherever a tool takes source", async () => {
    const matrix = sections(matrixMd());
    for (const { name, params } of await listedTools()) if (params.includes("source")) expect(matrix.get(name), name).toContain("homebrew");
  });

  it("expects ddb_get_monster to pick a match, and keeps the 50 cap out of 'ambiguous'", () => {
    const md = matrixMd();
    const bullet = (tool: string, scenario: string) =>
      (md.split(/^## /m).find(part => part.startsWith(`\`${tool}\``)) ?? "").split("\n").find(l => l.startsWith(`- ${scenario}:`)) ?? "";
    expect(bullet("ddb_get_monster", "ambiguous")).toMatch(/picks|names which/);
    expect(bullet("ddb_get_monster", "ambiguous")).not.toMatch(/asks which|lists choices/);
    expect(bullet("ddb_search_monsters", "ambiguous")).not.toContain("capped at 50");
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

describe("regression skill: judgement references and templates", () => {
  it("gives every intended behaviour a 'Looks like' and a 'Source', and covers the required topics", () => {
    const md = read("skills/ddb-mcp-regression/references/intended-behaviour.md");
    const n = md.match(/^### /gm)?.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(md.match(/^Looks like:/gm)?.length).toBe(n);
    expect(md.match(/^Source:/gm)?.length).toBe(n);
    for (const topic of ["rules_edition", 'source: "homebrew"', "getMonsterStats", "list_all", "untrusted_dndbeyond_content",
      "isHomebrew: false", "confirm_fill", "confirm_click", "confirm_large_response", "~/Downloads", "free account", "(q)", "(y)",
      "(ab)", "customItems", "Harness Divine Power", "Weapon Mastery", "Green-Flame Blade", "True Strike", "ddb_get_party"])
      expect(md, topic).toContain(topic);
  });

  it("lists exactly the open carry-overs, none of them closed in history.md", () => {
    const history = read("docs/claude/history.md");
    const codes = [...read("skills/ddb-mcp-regression/references/known-open-issues.md").matchAll(/^### \(([A-Za-z0-9]+)\)/gm)].map(m => m[1]);
    const expected = ["ba", "bb", "bc", "bd", "be", "bf", "bi", "bj", "bk", "bl", "bn", "bo", "bp", "bq", "br", "bs", "bt", "bu", "bv", "b", "aa", "ah", "ay", "B14"];
    expect([...codes].sort()).toEqual([...expected].sort());
    // history.md closes a carry-over as `**(bg)** ~~…~~` or "(bg) closed".
    for (const code of codes.filter(c => c !== "B14")) {
      expect(history, code).toContain(`(${code})`);
      expect(history, code).not.toMatch(new RegExp(`\\*\\*\\(${code}\\)\\*\\* ~~|\\(${code}\\) closed`));
    }
  });

  it("report template has the agreed structure", () => {
    const md = read("skills/ddb-mcp-regression/references/report-template.md");
    const order = ["## Verdict", "## Method", "## Findings", "## Known open issues", "## By design", "## Improvements",
      "## Prompts for a coding assistant", "## Discuss before building", "## Not covered", "## Files left behind"];
    const at = order.map(h => md.indexOf(`\n${h}\n`));
    expect(at.every(i => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const cell of ["Code under test", "Date", "Client", "Account", "Characters", "Tools"]) expect(md).toContain(`| **${cell}** |`);
    for (const s of ["🔴 High", "🟠 Med", "🟡 Low", "⚪ Nit", "confirmed", "suspected", "suggested starting point"]) expect(md).toContain(s);
    expect(md).toContain("| # | Sev | Status | Finding | Where | Evidence | Criterion |");
  });

  it("notes template records coverage, evidence and a resume point", () => {
    const md = read("skills/ddb-mcp-regression/references/notes-template.md");
    for (const h of ["## Run", "## Coverage", "## Findings so far", "## Resume from"]) expect(md).toContain(`\n${h}\n`);
    expect(md).toMatch(/\[x\] Batch \d+/); // shown once, as an example
  });

  it("notes template starts with nothing ticked (examples sit outside the copied part)", () => {
    const md = read("skills/ddb-mcp-regression/references/notes-template.md");
    const coverage = md.slice(md.indexOf("\n## Coverage\n"), md.indexOf("\n## Findings so far\n"));
    expect(coverage).not.toMatch(/\[x\]|✓/);
  });

  it("report header records the account category, not the books owned", () => {
    const md = read("skills/ddb-mcp-regression/references/report-template.md");
    const account = md.split("\n").find(l => l.startsWith("| **Account** |")) ?? "";
    expect(account).toMatch(/free|owns paid books/);
    expect(account).not.toMatch(/<books>|owns: </);
  });
});

const SKILL_DIR = join(ROOT, "skills/ddb-mcp-regression");

describe("regression skill: SKILL.md", () => {
  const skill = () => read("skills/ddb-mcp-regression/SKILL.md");
  // Frontmatter: exactly `name` then a single-line `description`, nothing else.
  const front = () => /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill());

  it("has valid frontmatter", () => {
    const m = front();
    expect(m).not.toBeNull();
    expect(m![1]).toBe("ddb-mcp-regression");
    expect(m![1]).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(m![2].length).toBeGreaterThan(0);
    expect(m![2].length).toBeLessThanOrEqual(1024);
    expect(m![2]).not.toMatch(/[<>]/);
  });

  it("stays under 500 lines and links every reference file", () => {
    expect(skill().trimEnd().split("\n").length).toBeLessThanOrEqual(500);
    const refs = readdirSync(join(SKILL_DIR, "references")).filter(f => f.endsWith(".md"));
    expect(refs.length).toBe(7); // update when a reference is added
    for (const f of refs) expect(skill()).toContain(`references/${f}`);
    for (const [, link] of skill().matchAll(/\((references\/[^)#]+)(?:#[^)]*)?\)/g)) expect(existsSync(join(SKILL_DIR, link)), link).toBe(true);
  });

  const section = (h: string) => {
    const text = skill();
    const start = text.indexOf(`\n${h}\n`);
    const next = text.indexOf("\n## ", start + 1);
    return text.slice(start, next < 0 ? undefined : next);
  };

  it("keeps outages and session drops out of the findings", () => {
    const outage = section("## If a service is slow or down");
    expect(outage).not.toMatch(/is a finding/);
    expect(outage).toMatch(/environment/);
    const drop = section("## If the session drops");
    expect(drop).toMatch(/same account/);
    expect(drop).toMatch(/Known open issues/);
  });

  it("never needs a click on a character sheet for the spot-checks", () => {
    const batches = section("## Batches");
    expect(batches).toMatch(/only where the page text shows/);
    expect(batches).toMatch(/Never click or fill anything on a sheet/);
  });

  it("keeps the contributor's library out of the report", () => {
    expect(section("## Account type")).toMatch(/report header records only the category/);
  });

  it("covers the procedure and the failure modes", () => {
    for (const h of ["## Before you start", "## Account type", "## Personas", "## Batches", "## Judging a reply",
      "## Evidence", "## Safety", "## Notes and checkpoints", "## If you cannot create files", "## Resuming",
      "## If the session drops", "## If a service is slow or down", "## Logged-out pass", "## The report"])
      expect(skill()).toContain(`\n${h}\n`);
  });
});
