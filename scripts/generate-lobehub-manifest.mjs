#!/usr/bin/env node
/**
 * Generates lhm.plugin.json — the manifest `lhm plugin publish` reads when
 * publishing this server to the LobeHub Marketplace.
 *
 * Usage: node scripts/generate-lobehub-manifest.mjs
 *
 * The manifest is a build artifact, not a source file (it's gitignored). Its
 * `tools` array is ~41 KB dumped from the running server, and its `version`
 * has to track package.json — a hand-maintained copy would rot silently, and
 * publishing with a stale `version` *merges into that existing version*
 * instead of erroring, so the drift would be invisible. Regenerate it
 * immediately before every publish.
 *
 * Only LISTING_METADATA below is hand-written. Everything else is derived.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Hand-written listing metadata ─────────────────────────────────────────────
// `identifier` was assigned by the marketplace when the repository was imported
// (2026-08-05). It is NOT derived from the package name or the repo slug — it
// cannot be reconstructed, only looked up via `lhm plugin list --output json`.
// Never invent one: publishing under an identifier you don't own is rejected,
// and under one you do own but didn't mean, it overwrites that listing.
//
// `name`, `description` and `tags` are the en-US source of truth. LobeHub
// stores them verbatim and machine-translates the other locales from them in
// the background; owner-provided locales are never overwritten by that
// translator. `homepage` is validated but discarded by the publish endpoint —
// the listing keeps the URL from its original import — so it's here for
// completeness rather than effect.

const LISTING_METADATA = {
  author: "James Lennon",
  authorUrl: "https://github.com/iamjameslennon",
  category: "gaming-entertainment",
  description:
    "Bring your D&D Beyond account into Claude: read character sheets, campaigns, and party rosters; " +
    "search spells, monsters, items, races, classes, feats, and rules; read owned sourcebooks; " +
    "and rate encounter difficulty or roll treasure. Logs in once through a browser, then works from " +
    "saved session cookies. Falls back to the Open5e SRD when D&D Beyond is unavailable.",
  homepage: "https://github.com/iamjameslennon/ddb-mcp",
  icon: "🐉",
  identifier: "iamjameslennon-ddb-mcp",
  name: "D&D Beyond MCP Server",
  tags: ["dnd", "dungeons-and-dragons", "dndbeyond", "ttrpg", "character-sheet", "srd", "tabletop"],
};

const TOOLS_LIST_TIMEOUT_MS = 60_000;

// ── Dump the live tool definitions ────────────────────────────────────────────
// A non-empty `tools` array is what sets the marketplace's "tools" capability
// badge, and the schemas are what users see on the listing page. Rather than
// transcribing 35 zod schemas by hand, drive the compiled server over stdio and
// ask it — the answer is then correct by construction.
//
// Runs dist/ rather than src/ via tsx: `node <path>` needs no shim, so this
// works identically on Windows, and during a release dist/ is already built
// (`npm ci` runs the `prepare` hook).

function dumpTools() {
  const entrypoint = join(repoRoot, "dist", "index.js");
  if (!existsSync(entrypoint)) {
    throw new Error(`${entrypoint} not found — run \`npm run build\` first.`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    const finish = (fn, value) => {
      clearTimeout(timer);
      child.kill();
      fn(value);
    };

    const timer = setTimeout(
      () => finish(reject, new Error(`Timed out after ${TOOLS_LIST_TIMEOUT_MS} ms waiting for tools/list.`)),
      TOOLS_LIST_TIMEOUT_MS
    );

    child.on("error", (err) => finish(reject, err));

    // The server writes diagnostics to stderr; surface them so a crash on
    // startup doesn't just look like a timeout.
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        finish(reject, new Error(`Server exited with code ${code}.\n${stderr}`));
      }
    });

    // MCP stdio framing is one JSON object per line.
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // not a JSON-RPC frame — ignore
        }

        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          if (message.error) {
            finish(reject, new Error(`tools/list failed: ${JSON.stringify(message.error)}`));
          } else {
            finish(resolve, message.result.tools);
          }
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "generate-lobehub-manifest", version: "1.0.0" },
      },
    });
  });
}

// ── Write the manifest ────────────────────────────────────────────────────────

const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

let tools;
try {
  tools = await dumpTools();
} catch (err) {
  console.error(`\nERROR: could not read the tool list from the server.\n${err.message}\n`);
  process.exit(1);
}

if (!Array.isArray(tools) || tools.length === 0) {
  console.error("\nERROR: the server returned no tools — refusing to publish a manifest with an empty `tools` array.\n");
  process.exit(1);
}

const manifestPath = join(repoRoot, "lhm.plugin.json");
writeFileSync(manifestPath, JSON.stringify({ ...LISTING_METADATA, tools, version }, null, 2) + "\n");

console.log(`✓ Wrote lhm.plugin.json — ${LISTING_METADATA.identifier}@${version}, ${tools.length} tools`);
console.log("  Publish with: npx -y @lobehub/market-cli plugin publish --dir .");
