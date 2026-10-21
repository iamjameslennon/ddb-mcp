// Compare the vendored 2024 condition text (src/tools/conditions.ts) with the
// conditions in D&D Beyond's rule-data. Needs `ddb_login`. A sanity check only:
// it always exits 0 once the data has loaded, and runtime never depends on it.
import { beginAuthenticatedSession } from "../src/session-fetch.js";
import { stripHtml } from "../src/utils.js";
import { getCondition, CONDITION_NAMES } from "../src/tools/conditions.js";

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

for (const name of CONDITION_NAMES) {
  // Vendored text: description + effects, i.e. everything after the title, rules line and blank line.
  const vendored = getCondition(name, "2024").split("\n").slice(3).join(" ").replace(/• /g, "");
  const ddbText = ddbByName.get(norm(name));
  if (ddbText === undefined) {
    console.log(`DIFF ${name}\n  not present in rule-data`);
    continue;
  }
  const a = norm(vendored);
  // D&D Beyond appends the 2014 text after an <hr> ("Legacy Definition"), and wraps cross-references as [condition]X[/condition].
  const current = ddbText.split("<hr>")[0].replace(/\[(\w+)\]([^[]*)\[\/\1\]/g, "$2");
  const b = norm(stripHtml(current));
  if (a === b) { console.log(`ok ${name}`); continue; }
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 20);
  console.log(`DIFF ${name}\n  vendored: ${a.slice(from, from + 80)}\n  d&d beyond: ${b.slice(from, from + 80)}`);
}
