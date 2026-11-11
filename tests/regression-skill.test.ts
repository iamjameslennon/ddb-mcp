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
import { describe, expect, it } from "vitest";

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

describe("regression skill: test characters", () => {
  it("lists exactly the characters in testcharacters.md, by ID and name", () => {
    const key = (r: { id: string; name: string }) => `${r.id} ${r.name}`;
    const skill = idNameRows(read("skills/ddb-mcp-regression/references/test-characters.md")).map(key);
    expect(new Set(skill).size).toBe(skill.length); // no duplicates
    expect([...skill].sort()).toEqual(characterList().map(key).sort());
  });
});
