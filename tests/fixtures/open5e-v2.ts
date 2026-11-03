// Recorded Open5e v2 documents (scripts/record-open5e-fixtures.mts) and a fetch
// stub that serves them. Each file holds the named records of one document and
// endpoint. The stub serves `count` as the number of records kept (the recorded files hold a
// subset of the live document, and the loader rejects a count above what it collected).
import { readFileSync } from "node:fs";
import type { O5Endpoint, O5Record } from "../../src/open5e.js";

type Doc = "srd-2024" | "srd-2014";
interface Page { count: number; next: null; previous: null; results: unknown[] }

function page(doc: Doc, endpoint: O5Endpoint): Page {
  return JSON.parse(readFileSync(new URL(`./open5e-v2/${doc}/${endpoint}.json`, import.meta.url), "utf8")) as Page;
}

export function o5Fixture<T = O5Record>(doc: Doc, endpoint: O5Endpoint): T[] {
  return page(doc, endpoint).results as T[];
}

export function o5Record<T = O5Record>(doc: Doc, endpoint: O5Endpoint, name: string): T {
  const found = (o5Fixture<O5Record>(doc, endpoint) as O5Record[]).find(r => r.name === name);
  if (!found) throw new Error(`No fixture record "${name}" in ${doc}/${endpoint}`);
  return found as unknown as T;
}

/** A hand-built Open5e response. A real `fetch` response carries its final url and the loader requires it, so a hand-built one gets `url` (default: an Open5e v2 URL). */
export function o5Response(body: BodyInit | null, init: ResponseInit = {}, url = "https://api.open5e.com/v2/spells/"): Response {
  const resp = new Response(body, init);
  Object.defineProperty(resp, "url", { value: url });
  return resp;
}

const URL_RE = /^https:\/\/api\.open5e\.com\/v2\/([a-z]+)\/\?document__key__in=(srd-2024|srd-2014)&limit=1000$/;

/** Serves `…/v2/<endpoint>/?document__key__in=<doc>&limit=1000` from the fixtures; anything else is a 404. `overrides` is keyed `"<doc>/<endpoint>"`. */
export function o5FixtureFetch(overrides: Partial<Record<string, unknown[]>> = {}, counts: Partial<Record<string, number>> = {}): (input: unknown) => Promise<Response> {
  return async (input: unknown) => {
    const m = URL_RE.exec(String(input));
    if (!m) return o5Response("not found", { status: 404 }, String(input));
    const doc = m[2] as Doc;
    const endpoint = m[1] as O5Endpoint;
    let body: Page;
    try {
      body = page(doc, endpoint);
    } catch {
      return o5Response("not found", { status: 404 }, String(input));
    }
    const results = overrides[`${doc}/${endpoint}`] ?? body.results;
    const count = counts[`${doc}/${endpoint}`] ?? results.length;
    return o5Response(JSON.stringify({ count, next: null, previous: null, results }), { status: 200, headers: { "Content-Type": "application/json" } }, String(input));
  };
}
