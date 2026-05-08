#!/usr/bin/env node
/**
 * Release script — bumps version, generates release notes via Claude, and
 * publishes a GitHub release.
 *
 * Usage: node scripts/release.js <patch|minor|major>
 *
 * Prerequisites: claude and gh must be on PATH.
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Argument validation ────────────────────────────────────────────────────────

const bumpType = process.argv[2];
if (!["patch", "minor", "major"].includes(bumpType)) {
  console.error("Usage: node scripts/release.js <patch|minor|major>");
  process.exit(1);
}

// ── Check required tools ───────────────────────────────────────────────────────

function requireTool(name, hint) {
  if (spawnSync("which", [name], { encoding: "utf8" }).status !== 0) {
    console.error(`\nERROR: '${name}' not found on PATH.\n${hint}\n`);
    process.exit(1);
  }
}

requireTool("gh", "Install GitHub CLI: https://cli.github.com");

// Find the claude binary by scanning mise's node installs directory directly.
// This avoids shim resolution issues entirely — no bash, no mise commands.
function findClaude() {
  // 1. Check common direct locations first (non-mise installs)
  const directPaths = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
  ];
  for (const p of directPaths) {
    if (existsSync(p)) return p;
  }

  // 2. Scan mise node installs for a claude binary
  const miseNodeDir = join(homedir(), ".local", "share", "mise", "installs", "node");
  if (existsSync(miseNodeDir)) {
    const versions = readdirSync(miseNodeDir).sort().reverse(); // newest first
    for (const version of versions) {
      const candidate = join(miseNodeDir, version, "bin", "claude");
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

const claudePath = findClaude();
if (!claudePath) {
  console.error("\nERROR: 'claude' not found. Install Claude Code: https://claude.ai/code\n");
  process.exit(1);
}

// ── Get last tag (fall back to full history if none) ──────────────────────────

let lastTag = null;
try {
  lastTag = execSync("git describe --tags --abbrev=0", {
    encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
  }).trim();
} catch {
  // No tags yet — will use full commit history
}

// ── Gather git log and diff stat ──────────────────────────────────────────────

const logCmd = lastTag
  ? `git log ${lastTag}..HEAD --pretty=format:"%h %s (%an)"`
  : `git log --pretty=format:"%h %s (%an)"`;
const gitLog = execSync(logCmd, { encoding: "utf8" }).trim();

if (!gitLog) {
  console.error("No commits found since last release. Nothing to release.");
  process.exit(1);
}

const diffBase = lastTag
  ?? execSync("git rev-list --max-parents=0 HEAD", { encoding: "utf8" }).trim();
const diffStat = execSync(`git diff --stat ${diffBase}..HEAD`, { encoding: "utf8" }).trim();

// ── Compute new version ────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
let [major, minor, patch] = pkg.version.split(".").map(Number);
if      (bumpType === "major") { major++; minor = 0; patch = 0; }
else if (bumpType === "minor") { minor++;             patch = 0; }
else                           { patch++;                        }
const newVersion = `${major}.${minor}.${patch}`;

// ── Generate release notes with Claude ────────────────────────────────────────

const prompt = [
  `Write release notes for ddb-mcp v${newVersion}.`,
  `ddb-mcp is a Model Context Protocol server that gives Claude access to D&D Beyond`,
  `character sheets, spells, monsters, and campaign data.`,
  `The audience is D&D players and Dungeon Masters — not developers.`,
  `Translate commit messages into plain English. Focus on player-facing impact.`,
  ``,
  `Format (skip sections with no relevant changes):`,
  `  2–3 sentence plain-English summary of what changed and why it matters.`,
  `  ## New Features`,
  `  ## Bug Fixes`,
  `  ## Improvements`,
  `  ## Security`,
  `  ## Breaking Changes`,
  ``,
  `Commits since ${lastTag ?? "the beginning"}:`,
  gitLog,
  ``,
  `Files changed:`,
  diffStat,
].join("\n");

console.log("\nGenerating release notes with Claude...\n");
const claudeResult = spawnSync(
  claudePath, ["-p", prompt],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
);
if (claudeResult.status !== 0) {
  console.error("Claude failed:", claudeResult.stderr || "(no output)");
  process.exit(1);
}
const releaseNotes = claudeResult.stdout.trim();

// ── Review and confirm ─────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
console.log(releaseNotes);
console.log("─".repeat(60));
console.log(`\nReady to release: v${pkg.version} → v${newVersion} (${bumpType} bump)`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => {
  rl.question("\nPress Enter to continue or Ctrl+C to abort: ", () => {
    rl.close();
    resolve();
  });
});

// ── Update version in package.json and package-lock.json ─────────────────────
// Direct JSON manipulation avoids triggering the preinstall guard that blocks
// `npm install`. For a pure version bump the only fields that change are
// `version` (top-level) and `packages[""].version` in the lock file.

pkg.version = newVersion;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const lockRaw = readFileSync("package-lock.json", "utf8");
const lock = JSON.parse(lockRaw);
lock.version = newVersion;
if (lock.packages?.[""] !== undefined) lock.packages[""].version = newVersion;
writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");

// ── Commit, tag, push ─────────────────────────────────────────────────────────

execSync("git add package.json package-lock.json", { stdio: "inherit" });
execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: "inherit" });
execSync(`git tag v${newVersion}`, { stdio: "inherit" });
execSync("git push && git push --tags", { stdio: "inherit" });

// ── Create GitHub release ─────────────────────────────────────────────────────

const ghResult = spawnSync(
  "gh",
  ["release", "create", `v${newVersion}`, "--title", `v${newVersion}`, "--notes", releaseNotes],
  { stdio: "inherit" }
);
if (ghResult.status !== 0) {
  console.error(
    `\nGitHub release creation failed. Tag v${newVersion} was already pushed.`,
    `\nCreate the release manually: gh release create v${newVersion} --title "v${newVersion}" --notes "..."`
  );
  process.exit(1);
}

console.log(`\n✓ Released v${newVersion}`);
