#!/usr/bin/env node
/**
 * Compendium build diagnostic.
 *
 * Fires the exact same 32 parallel requests that `loadSpellCompendium()` uses
 * (8 classes × 2 endpoints × 2 levels) and reports per-request status, latency,
 * response size, and spell count. Use this to figure out *why* the spell
 * compendium fell back to SRD-only results.
 *
 * Reads the session from the same path the MCP server uses
 * (~/.config/ddb-mcp/session.json on macOS/Linux, %APPDATA%/ddb-mcp/session.json
 * on Windows). Run ddb_login first if you don't have a session.
 *
 * Usage:
 *   node scripts/diagnose-compendium.mjs
 *
 * Output is safe to share in a bug report — no cookie values or tokens are
 * printed, only the user ID, HTTP statuses, sizes, latencies, and a probe
 * for known 2024 PHB cantrips.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

// ── Step 2: fire the 32 parallel requests ─────────────────────────────────────

const CHARACTER_SERVICE = "https://character-service.dndbeyond.com";
const SPELLCASTING_CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const CLASS_NAMES = {
  1: "Bard", 2: "Cleric", 3: "Druid", 4: "Paladin",
  5: "Ranger", 6: "Sorcerer", 7: "Warlock", 8: "Wizard",
};

const tasks = [];
for (const classId of SPELLCASTING_CLASS_IDS) {
  for (const endpoint of ["always-known-spells", "always-prepared-spells"]) {
    for (const level of [1, 20]) {
      tasks.push({ classId, endpoint, level });
    }
  }
}

console.log(`\n→ Firing ${tasks.length} parallel requests to character-service.dndbeyond.com...\n`);

const buildStart = Date.now();
const allSpellNames = new Set();
// Capture one Wizard L20 response so we can dump its shape if names don't match
// expected cantrips. Wizard L20 is the largest response (typically the full
// class spell list) so it gives us the clearest view of the data shape.
let sampleResponse = null;

const results = await Promise.all(tasks.map(async ({ classId, endpoint, level }) => {
  const url = `${CHARACTER_SERVICE}/character/v5/game-data/${endpoint}?classId=${classId}&classLevel=${level}&sharingSetting=2`;
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
    let spellCount = 0;
    let errorPreview = null;
    if (resp.ok) {
      try {
        const json = JSON.parse(bodyText);
        if (classId === 8 && endpoint === "always-known-spells" && level === 20) {
          sampleResponse = json;
        }
        const spells = (Array.isArray(json) ? json : json.data) ?? [];
        spellCount = spells.length;
        for (const s of spells) if (s.definition?.name) allSpellNames.add(s.definition.name);
      } catch (e) {
        errorPreview = `parse error: ${e.message}`;
      }
    } else {
      errorPreview = bodyText.slice(0, 120).replace(/\s+/g, " ").trim();
    }
    return {
      classId, endpoint, level,
      status: resp.status, ok: resp.ok,
      elapsed, bodyBytes: bodyText.length, spellCount, errorPreview,
    };
  } catch (e) {
    return {
      classId, endpoint, level,
      status: 0, ok: false,
      elapsed: Date.now() - start, bodyBytes: 0, spellCount: 0,
      errorPreview: `network: ${e.message}`,
    };
  }
}));

const totalElapsed = Date.now() - buildStart;

// ── Per-request table ─────────────────────────────────────────────────────────

console.log(`Per-request results:`);
console.log(`  class     endpoint                 lvl  status  ms     bytes      spells`);
console.log(`  -----     --------                 ---  ------  -----  --------   ------`);
for (const r of results) {
  const cls = CLASS_NAMES[r.classId].padEnd(9);
  const endpoint = r.endpoint.padEnd(24);
  const lvl = `L${r.level}`.padEnd(4);
  const status = String(r.status).padEnd(6);
  const ms = `${r.elapsed}`.padStart(5);
  const bytes = `${r.bodyBytes}`.padStart(8);
  const spells = String(r.spellCount).padStart(6);
  const mark = r.ok ? "✓" : "✗";
  console.log(`  ${mark} ${cls}${endpoint}${lvl} ${status}  ${ms}  ${bytes}   ${spells}`);
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

console.log(`\nUnique spells gathered: ${allSpellNames.size}`);

// ── 2024 PHB cantrip probe ────────────────────────────────────────────────────

const PROBE = [
  "Booming Blade", "Mind Sliver", "Toll the Dead", "Thunderclap",
  "Green-Flame Blade", "Friends", "Blade Ward", "Elementalism",
  // Sanity-check entries that exist in BOTH 2014 and 2024:
  "Fire Bolt", "Mage Hand", "Prestidigitation",
];
const present = PROBE.filter(s => allSpellNames.has(s));
const missing = PROBE.filter(s => !allSpellNames.has(s));

console.log(`\n2024 PHB cantrip probe (${PROBE.length} known cantrips):`);
console.log(`  Present: ${present.length}/${PROBE.length} — ${present.join(", ") || "(none)"}`);
console.log(`  Missing: ${missing.length}/${PROBE.length} — ${missing.join(", ") || "(none)"}`);

// ── Response-shape dump when baseline cantrips missing ────────────────────────
// If even Fire Bolt / Mage Hand / Prestidigitation aren't found, our `definition.name`
// extraction is wrong for this endpoint — dump the shape so we can fix the parser.

const baselineCantrips = ["Fire Bolt", "Mage Hand", "Prestidigitation"];
const baselineFound = baselineCantrips.filter(s => allSpellNames.has(s));
if (baselineFound.length === 0 && sampleResponse) {
  console.log(`\n⚠ None of the baseline 2014 cantrips (Fire Bolt, Mage Hand, Prestidigitation)`);
  console.log(`  were found. The 363 names we extracted are something else. Dumping`);
  console.log(`  Wizard L20 always-known-spells response shape:\n`);

  console.log(`  Top-level keys: ${Object.keys(sampleResponse).join(", ")}`);
  const items = Array.isArray(sampleResponse) ? sampleResponse : sampleResponse.data;
  if (Array.isArray(items)) {
    console.log(`  Array length: ${items.length}`);
    if (items[0]) {
      console.log(`  First item keys: ${Object.keys(items[0]).join(", ")}`);
      if (items[0].definition) {
        console.log(`  First item .definition keys: ${Object.keys(items[0].definition).slice(0, 25).join(", ")}`);
        console.log(`  First item .definition.name: ${JSON.stringify(items[0].definition.name)}`);
        console.log(`  First item .definition.id: ${JSON.stringify(items[0].definition.id ?? items[0].definition.entityId)}`);
      } else {
        console.log(`  First item (no .definition):`);
        console.log(`    ${JSON.stringify(items[0]).slice(0, 400)}…`);
      }
    }
  } else {
    console.log(`  Not an array. First 400 chars of response:`);
    console.log(`    ${JSON.stringify(sampleResponse).slice(0, 400)}…`);
  }

  console.log(`\n  First 20 names we extracted (alphabetical):`);
  const sorted = [...allSpellNames].sort().slice(0, 20);
  for (const n of sorted) console.log(`    - ${n}`);

  // Case-insensitive substring probe — maybe the names use different casing or
  // wording (e.g. "Firebolt" vs "Fire Bolt", "Mage's Hand" vs "Mage Hand").
  console.log(`\n  Case-insensitive contains-probe for baseline cantrips:`);
  for (const target of baselineCantrips) {
    const targetLower = target.toLowerCase().replace(/\s/g, "");
    const matches = [...allSpellNames]
      .filter(n => n.toLowerCase().replace(/\s/g, "").includes(targetLower))
      .slice(0, 3);
    console.log(`    "${target}" loose-matches: ${matches.length ? matches.join(", ") : "(none)"}`);
  }
}

// ── Cantrip-endpoint probe ────────────────────────────────────────────────────
// The main loop showed the always-known-spells endpoint returns leveled spells
// only (no cantrips). Probe a handful of plausible alternative endpoints for
// Wizard (classId=8) to see if any of them returns cantrips. We check for the
// presence of "Fire Bolt" in the response body as the signal.

console.log(`\n→ Probing candidate cantrip endpoints (looking for "Fire Bolt")...\n`);

const PROBES = [
  // The current endpoint, but at classLevel=0 (cantrip level)
  "character/v5/game-data/always-known-spells?classId=8&classLevel=0&sharingSetting=2",
  // Guesses based on naming conventions
  "character/v5/game-data/cantrips?classId=8",
  "character/v5/game-data/cantrips?classId=8&classLevel=20",
  "character/v5/game-data/known-cantrips?classId=8&classLevel=20",
  "character/v5/game-data/class-spells?classId=8&classLevel=20",
  // The character-builder URL pattern
  "character/v5/game-data/spells?classId=8&classLevel=20",
  "character/v5/game-data/spells?classId=8&classLevel=20&spellLevel=0",
  // Class features may enumerate cantrip choices
  "character/v5/game-data/class-features?classId=8&classLevel=20",
];

console.log(`  status  bytes      hasFireBolt  endpoint`);
console.log(`  ------  ---------  -----------  --------`);
for (const path of PROBES) {
  const url = `${CHARACTER_SERVICE}/${path}`;
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
    const hasFireBolt = /\bFire\s?Bolt\b/i.test(bodyText) ? "✓ yes" : "  no  ";
    const status = `${resp.status}`.padEnd(6);
    const bytes = `${bodyText.length}`.padStart(8);
    console.log(`  ${status}  ${bytes}   ${hasFireBolt}      ${path}  (${elapsed}ms)`);
  } catch (e) {
    console.log(`  ERR     —          —            ${path}  (${e.message})`);
  }
}

console.log(`\n  If any row has 'hasFireBolt: yes' we've found the cantrip endpoint;`);
console.log(`  add it to loadSpellCompendium's task list.`);
console.log(`  If all rows are 'no' (likely), DDB doesn't expose cantrips via game-data;`);
console.log(`  cantrip data only exists per-character in choiceDefinitions, and the`);
console.log(`  compendium can only learn cantrips as a side-channel from ddb_get_character`);
console.log(`  calls — same pattern as the existing characterSpellBuffer.`);

// ── Verify the candidate `spells` endpoint shape ──────────────────────────────
// The probe above confirmed presence of "Fire Bolt" via substring match. Before
// committing to use this endpoint in loadSpellCompendium, validate that:
//   (1) the JSON shape matches `always-known-spells` (items at .data[*].definition.name)
//   (2) the spell count covers cantrips + leveled (~430 for Wizard, vs 423 leveled only)
//   (3) the 2024 cantrip probe set is actually present

console.log(`\n→ Verifying response shape for spells?classId=8&classLevel=20...\n`);

const verifyUrl = `${CHARACTER_SERVICE}/character/v5/game-data/spells?classId=8&classLevel=20&sharingSetting=2`;
try {
  const resp = await fetch(verifyUrl, {
    headers: {
      ...COMMON_HEADERS,
      Authorization: `Bearer ${token}`,
      Cookie: buildCookieHeader(verifyUrl),
    },
  });
  if (!resp.ok) {
    console.log(`  ✗ Unexpected status ${resp.status} — can't validate shape.`);
  } else {
    const json = await resp.json();
    const items = Array.isArray(json) ? json : json.data;
    console.log(`  Top-level keys: ${Object.keys(json).join(", ")}`);
    console.log(`  Array length: ${Array.isArray(items) ? items.length : "(not an array)"}`);
    if (Array.isArray(items) && items.length > 0) {
      const first = items[0];
      console.log(`  First item keys: ${Object.keys(first).slice(0, 12).join(", ")}…`);
      if (first.definition) {
        console.log(`  First item .definition.name: ${JSON.stringify(first.definition.name)}`);
        console.log(`  First item .definition.level: ${first.definition.level}`);
      } else {
        console.log(`  ⚠ First item has no .definition — parser shape would need to change.`);
      }

      // Collect names + split cantrips/leveled
      const names = new Set();
      const cantrips = [];
      const byLevel = new Map();
      for (const s of items) {
        const name = s.definition?.name;
        if (name) names.add(name);
        const lvl = s.definition?.level;
        if (lvl === 0 && name) cantrips.push(name);
        byLevel.set(lvl, (byLevel.get(lvl) || 0) + 1);
      }
      const byLevelStr = [...byLevel.entries()]
        .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
        .map(([l, c]) => `L${l ?? "?"}: ${c}`)
        .join(", ");
      console.log(`  Spell counts by level: ${byLevelStr}`);
      console.log(`  Unique names: ${names.size} (of which ${cantrips.length} are cantrips)`);

      const sampleCantrips = cantrips.sort().slice(0, 25);
      console.log(`\n  First 25 cantrips alphabetically:`);
      for (const n of sampleCantrips) console.log(`    - ${n}`);

      console.log(`\n  2024 PHB probe against this endpoint:`);
      const probePresent = PROBE.filter(s => names.has(s));
      const probeMissing = PROBE.filter(s => !names.has(s));
      console.log(`    Present (${probePresent.length}/${PROBE.length}): ${probePresent.join(", ") || "(none)"}`);
      console.log(`    Missing (${probeMissing.length}/${PROBE.length}): ${probeMissing.join(", ") || "(none)"}`);

      // Final go/no-go signal
      const baselineFound2 = baselineCantrips.filter(s => names.has(s));
      console.log();
      if (baselineFound2.length === baselineCantrips.length && cantrips.length >= 20) {
        console.log(`  ✓ SHAPE OK — same {data:[{definition:{name,level,...}}]} structure,`);
        console.log(`    cantrips present, baseline 2014 cantrips all found.`);
        console.log(`    Safe to switch loadSpellCompendium to use this endpoint.`);
      } else if (baselineFound2.length < baselineCantrips.length) {
        console.log(`  ⚠ SHAPE PARSES but ${baselineCantrips.length - baselineFound2.length} baseline cantrips are still missing.`);
        console.log(`    Something about this endpoint is also incomplete. Investigate further.`);
      } else {
        console.log(`  ⚠ Cantrip count low (${cantrips.length}). Check whether this endpoint really`);
        console.log(`    includes all cantrips a Wizard can learn at level 20.`);
      }
    }
  }
} catch (e) {
  console.log(`  ✗ network error: ${e.message}`);
}

// ── Verdict ───────────────────────────────────────────────────────────────────

console.log(`\nVerdict`);
console.log(`-------`);
if (successful === tasks.length) {
  if (missing.length === 0) {
    console.log(`All 32 requests succeeded and the response contains 2024 cantrips. ` +
                `The compendium build is healthy. If you're still seeing SRD-only results in Claude, ` +
                `the cache may be stale — run ddb_clear_cache and retry.`);
  } else {
    console.log(`All 32 requests succeeded but ${missing.length} known 2024 cantrips are still missing. ` +
                `The character-service endpoints aren't returning them for any spellcasting class — ` +
                `that's a DDB API question, not an MCP bug.`);
  }
} else if (successful === 0) {
  console.log(`All 32 requests failed. See the breakdown above — the most common status will tell you ` +
              `whether this is auth (401/403), rate limiting (429), or a server problem (5xx). ` +
              `If 401/403, the cobalt token is being rejected for these endpoints specifically; ` +
              `if 429, we need a concurrency cap; if 5xx, retry later.`);
} else {
  console.log(`Partial success: ${successful}/${tasks.length} requests OK. ` +
              `This is the cache-poisoning failure mode — the MCP will cache the partial response ` +
              `for 5 min (or 24 h on pre-2.7.2 installs). See the failure breakdown above for the cause.`);
  if (results.filter(r => !r.ok && r.status === 429).length > 0) {
    console.log(`\nThe presence of 429 responses suggests DDB is rate-limiting the 32-way burst. ` +
                `Adding a concurrency cap in loadSpellCompendium would help.`);
  }
}

console.log();
