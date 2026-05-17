// Fetch rule-data and emit every language with rpgSourceId != null,
// formatted as TypeScript Record<number, string> entries ready to paste.
import { sessionFetch, getCobaltToken } from "../src/session-fetch.js";

const { token } = await getCobaltToken();
const url = "https://character-service.dndbeyond.com/character/v5/rule-data?v=%40dndbeyond%2Fcharacter-app%401.70.129";
const resp = await sessionFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
const body = await resp.json() as Record<string, unknown>;

type Lang = { id: number; name: string; rpgSourceId: number | null };
const langs = ((body.data as Record<string, unknown>)?.languages as Lang[] | undefined) ?? [];

const sourced = langs.filter(l => l.rpgSourceId != null).sort((a, b) => a.id - b.id);
const unsourced = langs.filter(l => l.rpgSourceId == null).sort((a, b) => a.id - b.id);

console.log(`Total: ${langs.length}, sourced: ${sourced.length}, unsourced: ${unsourced.length}\n`);

// Group by source for tidier formatting
const bySource = new Map<number, Lang[]>();
for (const l of sourced) {
  if (!bySource.has(l.rpgSourceId!)) bySource.set(l.rpgSourceId!, []);
  bySource.get(l.rpgSourceId!)!.push(l);
}

console.log("=== Entries (TypeScript-ready, grouped by rpgSourceId) ===\n");
for (const [src, list] of [...bySource.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  // rpgSourceId: ${src} — ${list.length} languages`);
  // Wrap at ~95 chars
  let line = "  ";
  for (const l of list) {
    const entry = `${l.id}: ${JSON.stringify(l.name)}, `;
    if (line.length + entry.length > 95) {
      console.log(line);
      line = "  ";
    }
    line += entry;
  }
  if (line.trim()) console.log(line);
  console.log("");
}

console.log("=== Unsourced (rpgSourceId: null) — typically creature languages, NOT including ===");
for (const l of unsourced) console.log(`  ${l.id}: ${JSON.stringify(l.name)}`);
