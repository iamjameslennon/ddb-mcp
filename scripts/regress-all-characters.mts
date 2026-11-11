#!/usr/bin/env -S npx tsx
/**
 * Whole-corpus character regression (regression report 2026-11-06, item I4).
 *
 * Parses every character in testcharacters.md's "Character List", for every
 * section, with two parsers: a baseline (the published npm package by
 * default) and HEAD (this checkout's src/, run through tsx, so no build is
 * needed and a stale dist/ can't mislead). Then it:
 *
 *   1. diffs baseline against HEAD after stripping the cosmetic additions
 *      (untrusted-content wrapper lines, `Rules:` lines, inline edition tags);
 *   2. scans HEAD's output for anomalies (NaN, undefined, [object Object],
 *      HTML entities, double spaces, sign glitches, unbalanced wrappers);
 *   3. checks that every line of summary/combat/spells/inventory/features/notes
 *      also appears in `full`.
 *
 * Each character's JSON is fetched once, anonymously (all are public), cached
 * under the work dir, and fed to both parsers, so edits on D&D Beyond between
 * runs can't show up as differences. --refresh re-fetches.
 *
 *   npx tsx scripts/regress-all-characters.mts                 # vs latest npm release
 *   npx tsx scripts/regress-all-characters.mts --baseline 2.10.2
 *   npx tsx scripts/regress-all-characters.mts --baseline-dir ../old-checkout/dist
 *
 * Options:
 *   --baseline <version>   npm version to compare against (default: latest on npm)
 *   --baseline-dir <dir>   a built dist/ (or a package root holding dist/) instead
 *   --work-dir <dir>       cache and output root (default: <os tmpdir>/ddb-mcp-regress)
 *   --refresh              re-fetch every character's JSON
 *   --only <id,id,…>       limit the run to these character IDs
 *   --keep-tags            don't strip wrappers, Rules: lines and edition tags before diffing
 *   --diff                 also print the diffs to stdout (they always go to report.md)
 *
 * Exit status: 0 clean; 1 a HEAD crash, a consistency failure or an anomaly
 * the baseline doesn't have; 2 setup failure (no baseline, no characters).
 * Differences alone never fail the run: most are intended, so read them.
 *
 * Nothing it writes belongs in the repo: the character JSON and sheets hold
 * other people's characters and PHB text. Needs no login. The live game config
 * is used for HEAD's source index when reachable, else the bundled snapshot.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCharacterData as headParse } from "../src/tools/character/parse.js";
import { getSourceIndex } from "../src/game-config.js";
import { mapWithConcurrency } from "../src/utils.js";

const PACKAGE = "@iamjameslennon/ddb-mcp";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SECTIONS = ["full", "summary", "combat", "spells", "inventory", "features", "notes", "concentration"] as const;
type Section = (typeof SECTIONS)[number];
/** Sections whose every line must also appear in `full` (concentration isn't part of full). */
const SUBSET_OF_FULL: readonly Section[] = ["summary", "combat", "spells", "inventory", "features", "notes"];
const NO_SPELLCASTING = "No spellcasting on this character.";
const WRAP_OPEN = "<untrusted_dndbeyond_content>";
const WRAP_CLOSE = "</untrusted_dndbeyond_content>";
const EDITION_TAG_RE = / ?\[(?:2024|2014|homebrew|third-party|playtest|edition not stated)\]/g;

type Parser = (raw: unknown, section: Section) => string;

// ── arguments ───────────────────────────────────────────────────────────────

interface Options {
  baseline?: string;
  baselineDir?: string;
  workDir: string;
  refresh: boolean;
  only?: Set<string>;
  keepTags: boolean;
  printDiff: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { workDir: join(tmpdir(), "ddb-mcp-regress"), refresh: false, keepTags: false, printDiff: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) fail(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--baseline": opts.baseline = value(); break;
      case "--baseline-dir": opts.baselineDir = resolve(value()); break;
      case "--work-dir": opts.workDir = resolve(value()); break;
      case "--refresh": opts.refresh = true; break;
      case "--only": opts.only = new Set(value().split(",").map(s => s.trim()).filter(Boolean)); break;
      case "--keep-tags": opts.keepTags = true; break;
      case "--diff": opts.printDiff = true; break;
      case "-h": case "--help":
        process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0] + "*/\n");
        process.exit(0);
        break;
      default: fail(`unknown option ${arg} (try --help)`);
    }
  }
  if (opts.baseline && opts.baselineDir) fail("pass --baseline or --baseline-dir, not both");
  return opts;
}

function fail(message: string): never {
  process.stderr.write(`[regress] ${message}\n`);
  process.exit(2);
}

function log(message: string): void {
  process.stderr.write(`[regress] ${message}\n`);
}

// ── baseline ────────────────────────────────────────────────────────────────

function npm(args: string[], cwd?: string): string {
  // npm is a .cmd shim on Windows, which execFile can only start through a shell.
  return execFileSync("npm", args, { cwd, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Returns the path to the baseline's `tools/character/parse.js` and a label for the report. */
function resolveBaseline(opts: Options): { parseJs: string; label: string } {
  if (opts.baselineDir) {
    for (const dist of [opts.baselineDir, join(opts.baselineDir, "dist")]) {
      const parseJs = join(dist, "tools", "character", "parse.js");
      if (existsSync(parseJs)) return { parseJs, label: dist };
    }
    fail(`no tools/character/parse.js under ${opts.baselineDir} (pass a built dist/ directory)`);
  }
  const version = opts.baseline ?? npm(["view", PACKAGE, "version"]);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`not a version number: ${version}`);
  const prefix = join(opts.workDir, `baseline-${version}`);
  const parseJs = join(prefix, "node_modules", ...PACKAGE.split("/"), "dist", "tools", "character", "parse.js");
  if (!existsSync(parseJs)) {
    log(`installing ${PACKAGE}@${version} into ${prefix}`);
    mkdirSync(prefix, { recursive: true });
    writeFileSync(join(prefix, "package.json"), '{ "private": true }\n');
    // --ignore-scripts: nothing from the package runs except the parser we import.
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", `${PACKAGE}@${version}`], prefix);
    if (!existsSync(parseJs)) fail(`${PACKAGE}@${version} has no dist/tools/character/parse.js`);
  }
  return { parseJs, label: `${PACKAGE}@${version} (npm)` };
}

async function loadBaselineParser(parseJs: string): Promise<Parser> {
  const mod = (await import(pathToFileURL(parseJs).href)) as { parseCharacterData?: unknown };
  if (typeof mod.parseCharacterData !== "function") fail(`${parseJs} exports no parseCharacterData`);
  const fn = mod.parseCharacterData as (raw: unknown, section: string) => string;
  // Older releases take (raw, section); newer ones add an optional source index,
  // which they then read from their own (never-fetched) snapshot.
  return (raw, section) => fn(raw, section);
}

// ── characters ──────────────────────────────────────────────────────────────

interface Character { id: string; name: string }

function readCharacterList(): Character[] {
  const text = readFileSync(join(REPO_ROOT, "testcharacters.md"), "utf8");
  const start = text.indexOf("## Character List");
  if (start < 0) fail("testcharacters.md has no '## Character List' section");
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end < 0 ? undefined : end);
  const chars: Character[] = [];
  for (const line of section.split("\n")) {
    const m = /^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (m) chars.push({ id: m[1], name: m[2] });
  }
  return chars;
}

type FetchResult = { ok: true; json: string } | { ok: false; error: string };

async function fetchCharacterJson(id: string, cacheDir: string, refresh: boolean): Promise<FetchResult> {
  const file = join(cacheDir, `${id}.json`);
  if (!refresh && existsSync(file)) return { ok: true, json: readFileSync(file, "utf8") };
  const url = `https://character-service.dndbeyond.com/character/v5/character/${encodeURIComponent(id)}?includeCustomItems=true`;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Anonymous on purpose: no cookie, no token. Every test character is public.
      const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (resp.ok) {
        const json = JSON.stringify(await resp.json());
        writeFileSync(file, json);
        return { ok: true, json };
      }
      lastError = `HTTP ${resp.status}`;
      if (resp.status < 500) break; // 403/404 won't change on a retry
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

// ── normalising, diffing, scanning ──────────────────────────────────────────

function normalise(text: string, keepTags: boolean): string[] {
  const lines = text.split("\n").map(l => l.trimEnd());
  if (keepTags) return lines;
  return lines
    .filter(l => l !== WRAP_OPEN && l !== WRAP_CLOSE && !/^\W*Rules:/.test(l))
    .map(l => l.replace(EDITION_TAG_RE, "").trimEnd());
}

type Op = { t: " " | "-" | "+"; line: string };

/** Line diff by longest common subsequence (sheets are a few hundred lines). */
function diffLines(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length;
  const lcs = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = A[i] === B[j]
        ? lcs[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }
  const ops: Op[] = a.slice(0, pre).map(line => ({ t: " ", line }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: " ", line: A[i] }); i++; j++; }
    else if (lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) ops.push({ t: "-", line: A[i++] });
    else ops.push({ t: "+", line: B[j++] });
  }
  while (i < n) ops.push({ t: "-", line: A[i++] });
  while (j < m) ops.push({ t: "+", line: B[j++] });
  for (const line of a.slice(a.length - suf)) ops.push({ t: " ", line });
  return ops;
}

/** Changed lines with one line of context; hunks separated by "…". */
function formatHunks(ops: Op[], context = 1): string[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, k) => {
    if (op.t === " ") return;
    for (let c = Math.max(0, k - context); c <= Math.min(ops.length - 1, k + context); c++) keep[c] = true;
  });
  const out: string[] = [];
  let gap = false;
  ops.forEach((op, k) => {
    if (!keep[k]) { gap = true; return; }
    if (gap && out.length) out.push("  …");
    gap = false;
    out.push(`${op.t} ${op.line}`);
  });
  return out;
}

const ANOMALIES: { kind: string; re: RegExp }[] = [
  { kind: "NaN", re: /\bNaN\b/ },
  { kind: "undefined", re: /\bundefined\b/ },
  { kind: "[object Object]", re: /\[object Object\]/ },
  { kind: "HTML entity", re: /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i },
  // Runs of spaces align the sheet's columns on purpose, so only the shapes a
  // bad join leaves are flagged: spaces before a tag or punctuation
  // ("Filigreed Longsword  [edition not stated]", "Dagger ,").
  { kind: "stray space", re: /\S {2,}[[,.;:!?)]|\S ,/ },
  { kind: "sign glitch", re: /\+\s*-|-\s*\+|\+\+|--\d/ },
];

function scanAnomalies(text: string): Map<string, string> {
  // key "kind\u0000line" → kind
  const found = new Map<string, string>();
  let depth = 0;
  for (const line of text.split("\n")) {
    if (line === WRAP_OPEN) {
      if (depth > 0) found.set(`nested wrapper\u0000${line}`, "nested wrapper");
      depth++;
      continue;
    }
    if (line === WRAP_CLOSE) {
      if (depth === 0) found.set(`unopened wrapper close\u0000${line}`, "unopened wrapper close");
      depth = Math.max(0, depth - 1);
      continue;
    }
    for (const { kind, re } of ANOMALIES) if (re.test(line)) found.set(`${kind}\u0000${line.trim()}`, kind);
  }
  if (depth > 0) found.set("unclosed wrapper\u0000(end of output)", "unclosed wrapper");
  return found;
}

// ── main ────────────────────────────────────────────────────────────────────

interface CharResult {
  char: Character;
  fetchError?: string;
  crashes: string[];          // "<version> <section>: message"
  diffs: { section: Section; changed: number; hunks: string[] }[];
  newAnomalies: { kind: string; line: string }[];
  oldAnomalies: { kind: string; line: string }[];
  fixedAnomalies: number;     // in the baseline, gone from HEAD
  consistency: string[];
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.workDir, { recursive: true });
  const cacheDir = join(opts.workDir, "characters");
  mkdirSync(cacheDir, { recursive: true });

  const baseline = resolveBaseline(opts);
  const baseParse = await loadBaselineParser(baseline.parseJs);
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"], { cwd: REPO_ROOT, encoding: "utf8" }).trim() !== "";
  const headLabel = `HEAD ${head}${dirty ? " + uncommitted src/ changes" : ""} (src/ via tsx)`;

  let chars = readCharacterList();
  if (opts.only) chars = chars.filter(c => opts.only!.has(c.id));
  if (chars.length === 0) fail("no characters to run");

  log(`fetching ${chars.length} characters (cache: ${cacheDir})`);
  const fetched = await mapWithConcurrency(chars, 4, c => fetchCharacterJson(c.id, cacheDir, opts.refresh));
  const index = await getSourceIndex();
  if (fetched.every(f => !f.ok)) fail("every character fetch failed — offline?");

  const runDir = join(opts.workDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(join(runDir, "baseline"), { recursive: true });
  mkdirSync(join(runDir, "head"), { recursive: true });

  log(`parsing ${chars.length} × ${SECTIONS.length} sections with both versions`);
  const results: CharResult[] = [];
  // Characters run in list order in both versions: the parsers' spell compendium
  // accumulates each character's spells (characterSpellBuffer), so order matters
  // to concentration lookups and must match on both sides.
  for (const [k, char] of chars.entries()) {
    const f = fetched[k];
    const r: CharResult = { char, crashes: [], diffs: [], newAnomalies: [], oldAnomalies: [], fixedAnomalies: 0, consistency: [] };
    results.push(r);
    if (!f.ok) { r.fetchError = f.error; continue; }

    const outputs: Record<"baseline" | "head", Partial<Record<Section, string>>> = { baseline: {}, head: {} };
    for (const section of SECTIONS) {
      for (const [side, parse] of [["baseline", baseParse], ["head", (raw: unknown, s: Section) => headParse(raw as never, s, index)]] as const) {
        try {
          // A fresh copy per call, in case a parser mutates its input.
          const text = parse(JSON.parse(f.json), section);
          outputs[side][section] = text;
          writeFileSync(join(runDir, side, `${char.id}-${section}.txt`), text + "\n");
        } catch (e) {
          r.crashes.push(`${side} ${section}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Diffs: full and concentration always; another section only when it holds
    // a changed line that full's diff doesn't (otherwise it repeats full).
    const fullChanged = new Set<string>();
    for (const section of SECTIONS) {
      const a = outputs.baseline[section], b = outputs.head[section];
      if (a === undefined || b === undefined) continue;
      const ops = diffLines(normalise(a, opts.keepTags), normalise(b, opts.keepTags));
      const changed = ops.filter(o => o.t !== " ");
      if (changed.length === 0) continue;
      if (section === "full") changed.forEach(o => fullChanged.add(`${o.t}${o.line}`));
      else if (section !== "concentration" && changed.every(o => fullChanged.has(`${o.t}${o.line}`))) continue;
      r.diffs.push({ section, changed: changed.length, hunks: formatHunks(ops) });
    }

    // Anomalies in HEAD, split by whether the baseline shows the same line.
    const baseFound = new Map<string, string>();
    for (const s of SECTIONS) {
      const t = outputs.baseline[s];
      if (t !== undefined) for (const [key, kind] of scanAnomalies(t)) baseFound.set(key, kind);
    }
    const headFound = new Map<string, string>();
    for (const s of SECTIONS) {
      const t = outputs.head[s];
      if (t !== undefined) for (const [key, kind] of scanAnomalies(t)) headFound.set(key, kind);
    }
    for (const [key, kind] of headFound) {
      const line = key.split("\u0000")[1];
      (baseFound.has(key) ? r.oldAnomalies : r.newAnomalies).push({ kind, line });
    }
    for (const key of baseFound.keys()) if (!headFound.has(key)) r.fixedAnomalies++;

    // Every line of the subset sections must appear in full.
    const full = outputs.head.full;
    if (full !== undefined) {
      const fullLines = new Set(full.split("\n"));
      for (const s of SUBSET_OF_FULL) {
        const t = outputs.head[s];
        if (t === undefined) continue;
        const missing = t.split("\n").filter(l => l.trim() !== "" && l !== NO_SPELLCASTING && !fullLines.has(l));
        if (missing.length) r.consistency.push(`${s}: ${missing.length} line(s) not in full, e.g. ${JSON.stringify(missing[0])}`);
      }
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const ran = results.filter(r => !r.fetchError);
  const headCrashes = results.flatMap(r => r.crashes.filter(c => c.startsWith("head")).map(c => `${r.char.id} ${r.char.name} — ${c}`));
  const baseCrashes = results.flatMap(r => r.crashes.filter(c => c.startsWith("baseline")).map(c => `${r.char.id} ${r.char.name} — ${c}`));
  const changedChars = results.filter(r => r.diffs.length);
  const fullChangedLines = results.reduce((n, r) => n + (r.diffs.find(d => d.section === "full")?.changed ?? 0), 0);
  const newAnoms = results.flatMap(r => r.newAnomalies.map(a => ({ r, ...a })));
  const oldAnoms = results.flatMap(r => r.oldAnomalies.map(a => ({ r, ...a })));
  const inconsistent = results.flatMap(r => r.consistency.map(c => `${r.char.id} ${r.char.name} — ${c}`));

  const summary: string[] = [
    `# Character regression — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `- Baseline: ${baseline.label}`,
    `- Compared: ${headLabel}`,
    `- Characters: ${ran.length} of ${results.length} parsed × ${SECTIONS.length} sections${opts.keepTags ? "" : " (wrappers, Rules: lines and edition tags stripped before diffing)"}`,
    `- Outputs: ${runDir}`,
    "",
    `- Fetch failures: ${results.length - ran.length}${results.filter(r => r.fetchError).map(r => `\n  - ${r.char.id} ${r.char.name}: ${r.fetchError}`).join("")}`,
    `- HEAD crashes: ${headCrashes.length}${headCrashes.map(c => `\n  - ${c}`).join("")}`,
    `- Baseline crashes: ${baseCrashes.length}${baseCrashes.map(c => `\n  - ${c}`).join("")}`,
    `- Section consistency failures: ${inconsistent.length}${inconsistent.map(c => `\n  - ${c}`).join("")}`,
    `- New anomalies (in HEAD, not baseline): ${newAnoms.length}${newAnoms.map(a => `\n  - [${a.kind}] ${a.r.char.id} ${a.r.char.name}: ${JSON.stringify(a.line)}`).join("")}`,
    `- Anomalies also in baseline: ${oldAnoms.length}${oldAnoms.map(a => `\n  - [${a.kind}] ${a.r.char.id} ${a.r.char.name}: ${JSON.stringify(a.line)}`).join("")}`,
    `- Anomalies fixed since baseline: ${results.reduce((n, r) => n + r.fixedAnomalies, 0)}`,
    `- Characters with differences: ${changedChars.length} (${fullChangedLines} changed lines in full)`,
    ...changedChars.map(r => `  - ${r.char.id} ${r.char.name}: ${r.diffs.map(d => `${d.section} ${d.changed}`).join(", ")}`),
  ];
  const diffText: string[] = ["", "## Differences (- baseline, + HEAD)"];
  for (const r of changedChars) {
    for (const d of r.diffs) {
      diffText.push("", `### ${r.char.id} ${r.char.name} — ${d.section}`, "", "```diff", ...d.hunks, "```");
    }
  }
  const reportPath = join(runDir, "report.md");
  writeFileSync(reportPath, [...summary, ...diffText].join("\n") + "\n");

  process.stdout.write(summary.join("\n") + "\n");
  if (opts.printDiff) process.stdout.write(diffText.join("\n") + "\n");
  process.stdout.write(`\nFull report with diffs: ${reportPath}\n`);

  const failed = headCrashes.length > 0 || inconsistent.length > 0 || newAnoms.length > 0;
  process.exit(failed ? 1 : 0);
}

main().catch((e: unknown) => {
  process.stderr.write(`[regress] ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(2);
});
