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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpType = args.find(a => !a.startsWith("--"));
if (!["patch", "minor", "major"].includes(bumpType)) {
  console.error("Usage: node scripts/release.js <patch|minor|major> [--dry-run]");
  process.exit(1);
}

if (dryRun) {
  console.log("\n[dry-run] No commits, tags, pushes, or GitHub releases will be created.");
  console.log("[dry-run] Files WILL be mutated locally — run `git restore .` after to revert.\n");
}

// ── Guard: clean working tree on main ─────────────────────────────────────────
// In --dry-run we warn but don't fail, so the script can be exercised from a
// feature branch with uncommitted edits (the whole point of the dry run).

const gitStatus = execSync("git status --porcelain", { encoding: "utf8" }).trim();
if (gitStatus) {
  if (dryRun) {
    console.log("[dry-run] Working tree is dirty — proceeding anyway:");
    console.log(gitStatus + "\n");
  } else {
    console.error("\nERROR: Working tree is not clean. Commit or stash your changes before releasing.\n");
    console.error(gitStatus);
    process.exit(1);
  }
}

const currentBranch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
if (currentBranch !== "main") {
  if (dryRun) {
    console.log(`[dry-run] Not on 'main' (current: '${currentBranch}') — proceeding anyway.\n`);
  } else {
    console.error(`\nERROR: Releases must be cut from 'main'. Currently on '${currentBranch}'.\n`);
    process.exit(1);
  }
}

// ── Check required tools ───────────────────────────────────────────────────────

const isWindows = process.platform === "win32";

// Windows-aware spawn helper. .cmd shims (gh on Windows is gh.cmd, claude is
// claude.cmd) require shell:true to be resolved by cmd.exe. But Node's
// spawn-with-shell joins argv into a single command string without quoting,
// which breaks paths containing spaces (e.g. C:\Users\First Last\…\claude.cmd
// would be parsed as program `C:\Users\First` with arg `Last\…`, ENOENT — or
// worse, hijacked by an unrelated `First.exe` earlier on PATH). On POSIX we
// spawn directly. On Windows we build the command string with explicit
// quoting so cmd.exe re-tokenizes it correctly.
function spawnExecutable(executable, args, options = {}) {
  if (!isWindows) return spawnSync(executable, args, options);
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const command = [executable, ...args].map(quote).join(" ");
  return spawnSync(command, { ...options, shell: true });
}

function requireTool(name, hint) {
  // Portable existence check: invoke the tool with --version. The Windows
  // .cmd-shim handling lives in spawnExecutable above. 10 s cap so a tool
  // that hangs on first-run auth/keychain doesn't wedge the release.
  const result = spawnExecutable(name, ["--version"], { stdio: "ignore", timeout: 10_000 });
  // On POSIX, spawning a missing binary produces ENOENT; on Windows the .cmd
  // shim is invoked through cmd.exe so result.error stays empty and the exit
  // status reflects cmd.exe's "not recognized" response — we can't always
  // distinguish "missing" from "broken" there.
  if (result.error?.code === "ENOENT") {
    console.error(`\nERROR: '${name}' not on PATH.\n${hint}\n`);
    process.exit(1);
  }
  if (result.error || result.status !== 0) {
    const detail = result.error?.code ?? (result.status !== null ? `exit ${result.status}` : "no exit status");
    console.error(`\nERROR: '${name}' is missing or non-functional (${detail}).\n${hint}\n`);
    process.exit(1);
  }
}

requireTool("gh", "Install GitHub CLI: https://cli.github.com");

function findClaude() {
  // Platform-specific install locations for Claude Code. Use `||` (not `??`)
  // for the env-var fallbacks so an empty-string APPDATA/LOCALAPPDATA still
  // falls through to the homedir() default rather than producing a
  // CWD-relative path.
  const candidates = isWindows
    ? [
        // npm global on Windows installs to %APPDATA%\npm with a .cmd shim.
        join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "npm", "claude"),
        join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "npm", "claude"),
      ]
    : [
        join(homedir(), ".local", "bin", "claude"),
        "/usr/local/bin/claude",
      ];

  // Windows executables: prefer .cmd / .exe over the bare name, since npm-installed
  // CLIs ship both an extensionless POSIX sh shim *and* a .cmd shim — cmd.exe can't
  // execute the bare sh script.
  const suffixes = isWindows ? [".cmd", ".exe", ""] : [""];

  for (const base of candidates) {
    for (const suffix of suffixes) {
      const candidate = base + suffix;
      if (existsSync(candidate)) return candidate;
    }
  }

  // Fallback: scan mise's node installs (POSIX layout only — mise on Windows
  // uses a different path structure that we don't probe).
  if (!isWindows) {
    const miseNodeDir = join(homedir(), ".local", "share", "mise", "installs", "node");
    if (existsSync(miseNodeDir)) {
      const versions = readdirSync(miseNodeDir).sort().reverse(); // newest first
      for (const version of versions) {
        const candidate = join(miseNodeDir, version, "bin", "claude");
        if (existsSync(candidate)) return candidate;
      }
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

let releaseNotes;
if (dryRun) {
  console.log("[dry-run] Skipping Claude release-notes generation (would call `claude -p` with the commit log).");
  releaseNotes = `[dry-run placeholder release notes for v${"NEW_VERSION_PLACEHOLDER"}]`;
} else {
  console.log("\nGenerating release notes with Claude...\n");
  // Pipe the prompt via stdin rather than passing it as an argv. Multi-line
  // strings with shell metacharacters are unsafe through cmd.exe (which we need
  // for .cmd shims on Windows); stdin sidesteps the escaping problem entirely.
  // Requires a Claude CLI that accepts the prompt on stdin when no positional
  // arg is given (true since Claude Code 0.2.x).
  const claudeResult = spawnExecutable(
    claudePath, ["-p"],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      input: prompt,
    }
  );
  if (claudeResult.status !== 0) {
    console.error("Claude failed:", claudeResult.stderr || "(no output)");
    process.exit(1);
  }
  releaseNotes = claudeResult.stdout.trim();
}

// ── Review and confirm ─────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
console.log(releaseNotes);
console.log("─".repeat(60));
console.log(`\nReady to release: v${pkg.version} → v${newVersion} (${bumpType} bump)`);

if (!dryRun) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => {
    rl.question("\nPress Enter to continue or Ctrl+C to abort: ", () => {
      rl.close();
      resolve();
    });
  });
}

// ── Update version in package.json, package-lock.json, and README.md ─────────
// Direct JSON manipulation avoids triggering the preinstall guard that blocks
// `npm install`. For a pure version bump the only fields that change are
// `version` (top-level) and `packages[""].version` in the lock file.
//
// README.md has two kinds of version pin to keep in sync:
//   - the @iamjameslennon/ddb-mcp@X.Y.Z install/config examples
//   - any version strings in the install instructions
// Single regex replace covers both.

pkg.version = newVersion;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const lockRaw = readFileSync("package-lock.json", "utf8");
const lock = JSON.parse(lockRaw);
lock.version = newVersion;
if (lock.packages?.[""] !== undefined) lock.packages[""].version = newVersion;
writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");

const readmePath = "README.md";
const readmeBefore = readFileSync(readmePath, "utf8");
const readmeAfter = readmeBefore.replace(
  /@iamjameslennon\/ddb-mcp@\d+\.\d+\.\d+/g,
  `@iamjameslennon/ddb-mcp@${newVersion}`
);
const readmeChanged = readmeAfter !== readmeBefore;
if (readmeChanged) {
  writeFileSync(readmePath, readmeAfter);
  console.log(`\nUpdated README.md version pins → ${newVersion}`);
} else {
  console.log("\nNo README.md version pins needed updating.");
}

// ── Commit, tag, push ─────────────────────────────────────────────────────────

if (dryRun) {
  console.log(`\n[dry-run] Would run:`);
  console.log(`  git add package.json package-lock.json${readmeChanged ? " README.md" : ""}`);
  console.log(`  git commit -m "chore: release v${newVersion}"`);
  console.log(`  git tag -a v${newVersion} -m "Release v${newVersion}"`);
  console.log(`  git push origin HEAD --follow-tags`);
  console.log(`  gh release create v${newVersion} --title "v${newVersion}" --notes-file -`);
  console.log(`\n[dry-run] Inspect the file changes with \`git diff\`, then revert with \`git restore .\``);
  console.log(`[dry-run] ✓ Dry run complete (would release v${newVersion}).`);
  process.exit(0);
}

const filesToAdd = ["package.json", "package-lock.json", ...(readmeChanged ? [readmePath] : [])];
execSync(`git add ${filesToAdd.join(" ")}`, { stdio: "inherit" });
execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: "inherit" });
execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: "inherit" });
execSync("git push origin HEAD --follow-tags", { stdio: "inherit" });

// ── Create GitHub release ─────────────────────────────────────────────────────
// Pipe notes via stdin (--notes-file -) so multi-line markdown with backticks
// and quotes doesn't have to survive cmd.exe escaping on Windows.

const ghResult = spawnExecutable(
  "gh",
  ["release", "create", `v${newVersion}`, "--title", `v${newVersion}`, "--notes-file", "-"],
  { stdio: ["pipe", "inherit", "inherit"], input: releaseNotes }
);
if (ghResult.status !== 0) {
  console.error(
    `\nGitHub release creation failed. Tag v${newVersion} was already pushed.`,
    `\nCreate the release manually: gh release create v${newVersion} --title "v${newVersion}" --notes "..."`
  );
  process.exit(1);
}

console.log(`\n✓ Released v${newVersion}`);
