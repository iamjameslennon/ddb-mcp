#!/usr/bin/env node
/**
 * Compendium build diagnostic.
 *
 * Fires the same 16 parallel requests that `loadSpellCompendium()` uses
 * (`/game-data/spells` and `/game-data/always-known-spells` at classLevel=20,
 * for each of the 8 spellcasting classes) and reports per-request status,
 * latency, response size, and spell count. Use this to figure out *why* the
 * spell compendium is incomplete or fell back to SRD-only results.
 *
 * It also replays the server's id-keyed merge (fixed request order, first id
 * wins) and reports, per endpoint and combined, how many twin groups hold
 * 2024 only / 2014 only / both editions, and how many spells the merge loses
 * (it must be none). Concentration is reported per twin group, per edition.
 *
 * Unlike the server, this script exchanges one cobalt token and reuses it, so
 * it cannot reproduce auth-service rate-limiting of the server's per-request
 * token exchange (CLAUDE.md Next steps).
 *
 * Reads the session from the same path the MCP server uses
 * (~/.config/ddb-mcp/session.json on macOS/Linux, %APPDATA%/ddb-mcp/session.json
 * on Windows). Run ddb_login first if you don't have a session.
 *
 * Usage:
 *   npx tsx scripts/diagnose-compendium.mjs
 *
 * Output is safe to share in a bug report — no cookie values or tokens are
 * printed, only the user ID, HTTP statuses, sizes, latencies, and spell names.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSpellStore, addSpells, spellList } from "../src/tools/spell-store.js";
import { classifyEdition, buildSourceIndex } from "../src/edition.js";
import { SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES } from "../src/source-snapshot.js";

// ── Session loading (mirrors src/session-fetch.ts) ────────────────────────────

function resolveSessionPath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "ddb-mcp", "session.json");
  }
  return join(homedir(), ".config", "ddb-mcp", "session.json");
}

const SESSION_PATH = resolveSessionPath();
if (!existsSync(SESSION_PATH)) {
  console.error(`ERROR: session file not found at ${SESSION_PATH}`);
  console.error("Run ddb_login from your MCP client first to authenticate.");
  process.exit(1);
}

const session = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
const allCookies = session.cookies ?? [];

function buildCookieHeader(url) {
  const now = Date.now() / 1000;
  const { hostname } = new URL(url);
  const relevant = allCookies.filter(c => {
    const domain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const domainMatches = hostname === domain || hostname.endsWith("." + domain);
    const notExpired = c.expires < 0 || c.expires > now;
    return domainMatches && notExpired && c.secure;
  });
  return relevant.map(c => `${c.name}=${c.value}`).join("; ");
}

const COMMON_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

// ── Step 1: cobalt token ──────────────────────────────────────────────────────

console.log(`ddb-mcp compendium diagnostic`);
console.log(`=============================\n`);
console.log(`Session: ${SESSION_PATH}`);
const ddbCookies = allCookies.filter(c => c.domain.includes("dndbeyond.com"));
console.log(`Cookies: ${allCookies.length} total, ${ddbCookies.length} for dndbeyond.com`);

console.log(`\n→ Requesting cobalt token...`);
const cobaltStart = Date.now();
let token;
let userId;
try {
  const resp = await fetch("https://auth-service.dndbeyond.com/v1/cobalt-token", {
    method: "POST",
    headers: { ...COMMON_HEADERS, Cookie: buildCookieHeader("https://auth-service.dndbeyond.com/") },
  });
  const elapsed = Date.now() - cobaltStart;
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`✗ ${resp.status} ${resp.statusText} after ${elapsed}ms`);
    console.error(`  body: ${body.slice(0, 200)}`);
    console.error(`\nLikely cause: session is expired or the cookie was rejected. Run ddb_login again.`);
    process.exit(1);
  }
  const json = await resp.json();
  token = json.token;
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  userId = payload["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"];
  const exp = payload.exp;
  const expiresInMin = Math.round((exp - Date.now() / 1000) / 60);
  console.log(`✓ ${resp.status} in ${elapsed}ms`);
  console.log(`  userId: ${userId}`);
  console.log(`  expires in: ${expiresInMin} min`);
} catch (e) {
  console.error(`✗ network error: ${e.message}`);
  process.exit(1);
}

// ── Step 2: fire the 16 parallel requests ─────────────────────────────────────

const CHARACTER_SERVICE = "https://character-service.dndbeyond.com";
const SPELLCASTING_CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const CLASS_NAMES = {
  1: "Bard", 2: "Cleric", 3: "Druid", 4: "Paladin",
  5: "Ranger", 6: "Sorcerer", 7: "Warlock", 8: "Wizard",
};

// Same order as loadSpellCompendium(): every class's /spells, then every
// class's /always-known-spells. The merge below depends on this order.
const tasks = ["spells", "always-known-spells"].flatMap(endpoint =>
  SPELLCASTING_CLASS_IDS.map(classId => ({ endpoint, classId })),
);

console.log(`\n→ Firing ${tasks.length} parallel requests to character-service.dndbeyond.com...\n`);

const buildStart = Date.now();

const results = await Promise.all(tasks.map(async ({ classId, endpoint }) => {
  const url = `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=20&sharingSetting=2`;
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      headers: {
        ...COMMON_HEADERS,
        Authorization: `Bearer ${token}`,
        Cookie: buildCookieHeader(url),
      },
    });
    const bodyText = await resp.text();
    const elapsed = Date.now() - start;
    let spells = [];
    let errorPreview = null;
    if (resp.ok) {
      try {
        const json = JSON.parse(bodyText);
        spells = (Array.isArray(json) ? json : json.data) ?? [];
      } catch (e) {
        errorPreview = `parse error: ${e.message}`;
      }
    } else {
      errorPreview = bodyText.slice(0, 120).replace(/\s+/g, " ").trim();
    }
    return {
      classId, endpoint,
      status: resp.status, ok: resp.ok && errorPreview === null,
      elapsed, bodyBytes: bodyText.length, spells, errorPreview,
    };
  } catch (e) {
    return {
      classId, endpoint,
      status: 0, ok: false,
      elapsed: Date.now() - start, bodyBytes: 0, spells: [],
      errorPreview: `network: ${e.message}`,
    };
  }
}));

const totalElapsed = Date.now() - buildStart;

// ── Per-request table ─────────────────────────────────────────────────────────

console.log(`Per-request results:`);
console.log(`  class     endpoint             status  ms     bytes      spells  cantrips`);
console.log(`  -----     --------             ------  -----  --------   ------  --------`);
for (const r of results) {
  const cls = CLASS_NAMES[r.classId].padEnd(9);
  const endpoint = r.endpoint.padEnd(20);
  const status = String(r.status).padEnd(6);
  const ms = `${r.elapsed}`.padStart(5);
  const bytes = `${r.bodyBytes}`.padStart(8);
  const spells = String(r.spells.length).padStart(6);
  const cantrips = String(r.spells.filter(s => s.definition?.level === 0).length).padStart(8);
  const mark = r.ok ? "✓" : "✗";
  console.log(`  ${mark} ${cls}${endpoint} ${status}  ${ms}  ${bytes}   ${spells}  ${cantrips}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const successful = results.filter(r => r.ok).length;
const failed = tasks.length - successful;

console.log(`\nSummary`);
console.log(`-------`);
console.log(`Total:      ${tasks.length} requests in ${totalElapsed}ms (wall clock for the parallel batch)`);
console.log(`Successful: ${successful}/${tasks.length} (${Math.round(successful * 100 / tasks.length)}%)`);
console.log(`Failed:     ${failed}/${tasks.length}`);

if (failed > 0) {
  const byStatus = new Map();
  for (const r of results) {
    if (!r.ok) {
      const key = `${r.status} ${r.errorPreview ? `· ${r.errorPreview}` : ""}`.trim();
      byStatus.set(key, (byStatus.get(key) || 0) + 1);
    }
  }
  console.log(`\nFailure breakdown:`);
  for (const [key, count] of byStatus) {
    console.log(`  ${count}× ${key}`);
  }
}

// ── Merge exactly as loadSpellCompendium() does ───────────────────────────────

const sourceIndex = buildSourceIndex(SNAPSHOT_SOURCES, SNAPSHOT_CATEGORIES);
const editionOf = d => classifyEdition(d, sourceIndex).ruleset;

/** Build a store from some results (in task order) and measure it. */
function measure(label, subset) {
  const store = createSpellStore();
  let total = 0;
  let dropped = 0;
  const seenIds = new Set();
  for (const r of subset) {
    total += r.spells.length;
    dropped += addSpells(store, r.spells);
    for (const s of r.spells) {
      const id = s?.definition?.id;
      if (typeof id === "number" && Number.isFinite(id)) seenIds.add(id);
    }
  }
  let only2024 = 0, only2014 = 0, both = 0, nonEdition = 0;
  for (const ids of store.byTwin.values()) {
    const sets = new Set(ids.map(id => editionOf(store.byId.get(id).definition)));
    for (const set of sets) if (set !== "2024" && set !== "2014") nonEdition += ids.filter(id => editionOf(store.byId.get(id).definition) === set).length;
    if (sets.has("2024") && sets.has("2014")) both++;
    else if (sets.has("2024")) only2024++;
    else if (sets.has("2014")) only2014++;
  }
  const absent = [...seenIds].filter(id => !store.byId.has(id)).length;
  return { label, store, total, only2024, only2014, both, nonEdition, lost: dropped + absent };
}

const rows = [
  measure("spells", results.filter(r => r.endpoint === "spells")),
  measure("always-known-spells", results.filter(r => r.endpoint === "always-known-spells")),
  measure("combined", results),
];
const combined = rows[2].store;

console.log(`\nCompendium after merge: ${combined.byId.size} spells in ${combined.byTwin.size} twin groups`);
console.log(`\nEdition table (twin groups by the editions present; non-edition counts definitions):`);
console.log(`  ${"endpoint".padEnd(20)} ${"total".padStart(6)} ${"2024-only".padStart(10)} ${"2014-only".padStart(10)} ${"both".padStart(6)} ${"non-edition".padStart(12)} ${"lost".padStart(6)}`);
for (const r of rows) {
  console.log(`  ${r.label.padEnd(20)} ${String(r.total).padStart(6)} ${String(r.only2024).padStart(10)} ${String(r.only2014).padStart(10)} ${String(r.both).padStart(6)} ${String(r.nonEdition).padStart(12)} ${String(r.lost).padStart(6)}`);
}

// Probes look at names present in any definition.
const namesPresent = new Set(spellList(combined).map(s => s.definition.name));

// ── Content probe ─────────────────────────────────────────────────────────────
// Cantrips come only from /spells; prepared casters' leveled spells come only
// from /always-known-spells. A miss in either group points at that endpoint.
// Every probe spell is in the free basic rules, so results don't depend on
// which sourcebooks the account owns.

const PROBES = {
  "cantrips (/spells)": ["Fire Bolt", "Mage Hand", "Prestidigitation", "Sacred Flame", "Guidance", "Elementalism"],
  "prepared-caster leveled (/always-known-spells)": ["Bless", "Spirit Guardians", "Divine Smite", "Moonbeam", "Heal"],
};
const missingProbes = [];
console.log(`\nContent probe:`);
for (const [group, names] of Object.entries(PROBES)) {
  const missing = names.filter(n => !namesPresent.has(n));
  missingProbes.push(...missing);
  console.log(`  ${group}: ${names.length - missing.length}/${names.length} present` +
              (missing.length ? ` — missing: ${missing.join(", ")}` : ""));
}

// ── Concentration per twin group ──────────────────────────────────────────────

const concDiffers = [];
for (const [key, ids] of combined.byTwin) {
  const defs = ids.map(id => combined.byId.get(id).definition);
  const editions = new Set(defs.map(editionOf));
  if (!(editions.has("2024") && editions.has("2014"))) continue;
  if (new Set(defs.map(d => d.concentration === true)).size > 1) concDiffers.push([key, defs]);
}
console.log(`\nConcentration differs between editions in ${concDiffers.length} twin group(s)` +
            `${concDiffers.length ? " (a character's own definition decides which one it reports):" : ""}`);
for (const [key, defs] of concDiffers) {
  const editions = defs.map(d => `${d.name} [${editionOf(d)}]=${d.concentration ? "conc" : "no conc"}`).join(", ");
  console.log(`    - ${key}: ${editions}`);
}

const lostTotal = rows.reduce((n, r) => n + r.lost, 0);
if (lostTotal > 0) {
  console.log(`\nLOST: ${lostTotal}`);
  process.exit(1);
}

// ── Verdict ───────────────────────────────────────────────────────────────────

console.log(`\nVerdict`);
console.log(`-------`);
if (successful === tasks.length) {
  if (missingProbes.length === 0) {
    console.log(`All ${tasks.length} requests succeeded and every probe spell is present. ` +
                `The compendium build is healthy. If Claude still shows SRD-only results, ` +
                `the cache may be stale — run ddb_clear_cache and retry.`);
  } else {
    console.log(`All ${tasks.length} requests succeeded but ${missingProbes.length} probe spell(s) missing ` +
                `(${missingProbes.join(", ")}). character-service isn't returning them for any ` +
                `spellcasting class — check whether DDB changed the endpoints' contents.`);
  }
} else if (successful === 0) {
  console.log(`All ${tasks.length} requests failed. See the breakdown above — the most common status will tell you ` +
              `whether this is auth (401/403), rate limiting (429), or a server problem (5xx). ` +
              `If 401/403, the cobalt token is being rejected for these endpoints specifically; ` +
              `if 429, we need a concurrency cap; if 5xx, retry later.`);
} else {
  console.log(`Partial success: ${successful}/${tasks.length} requests OK. ` +
              `The MCP marks this build ddb-partial and caches it for only 5 min. ` +
              `See the failure breakdown above for the cause.`);
  if (results.some(r => !r.ok && r.status === 429)) {
    console.log(`\nThe presence of 429 responses suggests DDB is rate-limiting the ${tasks.length}-way burst. ` +
                `Adding a concurrency cap in loadSpellCompendium would help.`);
  }
}

console.log();
