// Compare the vendored 2024 and 2014 condition text (src/tools/conditions.ts) with
// the conditions in D&D Beyond's rule-data. Needs `ddb_login`. A sanity check only:
// it always exits 0 once the data has loaded, and runtime never depends on it.
import { beginAuthenticatedSession } from "../src/session-fetch.js";
import { stripHtml } from "../src/utils.js";
import { getCondition, CONDITION_NAMES } from "../src/tools/conditions.js";
import type { RulesEdition } from "../src/edition.js";

const session = await beginAuthenticatedSession();
const url = "https://character-service.dndbeyond.com/character/v5/rule-data?v=%40dndbeyond%2Fcharacter-app%401.70.129";
const resp = await session.fetch(url, { headers: { Accept: "application/json" } });
const body = await resp.json() as Record<string, unknown>;

type Entry = { definition?: { name?: string; description?: string } };
const entries = ((body.data as Record<string, unknown> | undefined)?.conditions as Entry[] | undefined) ?? [];

const first = entries[0];
if (!first || typeof first.definition?.name !== "string" || typeof first.definition?.description !== "string") {
  console.error("Unexpected rule-data shape. First conditions entry keys:", first ? Object.keys(first) : "(none)");
  if (first?.definition) console.error("definition keys:", Object.keys(first.definition));
  process.exit(1);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ddbByName = new Map(entries.map(e => [norm(e.definition?.name ?? ""), e.definition?.description ?? ""]));

// Everything after the title, rules line and blank line, as one string. The 2014
// Exhaustion level table has no counterpart in D&D Beyond's legacy text (which is
// prose only), so its "Level N:" rows are left out of that comparison.
function vendoredText(name: string, edition: RulesEdition): string {
  return getCondition(name, edition).split("\n").slice(3)
    .filter(line => !(edition === "2014" && /^• Level \d: /.test(line)))
    .join(" ").replace(/• /g, "");
}

function report(label: string, name: string, a: string, b: string): void {
  if (a === b) { console.log(`ok ${label} ${name}`); return; }
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 20);
  console.log(`DIFF ${label} ${name}\n  vendored: ${a.slice(from, from + 80)}\n  d&d beyond: ${b.slice(from, from + 80)}`);
}

// D&D Beyond wraps cross-references as [condition]X[/condition].
const unwrapTags = (s: string) => s.replace(/\[(\w+)\]([^[]*)\[\/\1\]/g, "$2");
// The SRD's "(see the condition)" / "(see appendix A)" pointers are not in every D&D Beyond entry.
const dropSeeRefs = (s: string) => s.replace(/\(see (?:the condition|appendix [A-Z])\)/gi, "");

for (const name of CONDITION_NAMES) {
  const ddbText = ddbByName.get(norm(name));
  if (ddbText === undefined) {
    console.log(`DIFF 2024 ${name}\n  not present in rule-data\nDIFF 2014 ${name}\n  not present in rule-data`);
    continue;
  }
  // D&D Beyond puts the 2024 text first, then an <hr> and the 2014 text under a "Legacy Definition" heading.
  const [current, ...legacy] = ddbText.split("<hr>");
  report("2024", name, norm(vendoredText(name, "2024")), norm(stripHtml(unwrapTags(current))));
  if (legacy.length === 0) {
    console.log(`DIFF 2014 ${name}\n  no legacy definition in rule-data`);
    continue;
  }
  const legacyText = unwrapTags(legacy.join(" ")).replace(/<h3>\s*Legacy Definition\s*<\/h3>/i, "");
  report("2014", name, norm(dropSeeRefs(vendoredText(name, "2014"))), norm(dropSeeRefs(stripHtml(legacyText))));
}
