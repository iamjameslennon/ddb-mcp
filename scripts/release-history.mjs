/**
 * Side-effect-free release-history collection.
 *
 * Extracted out of scripts/release.js: the old code built `git log` / `git
 * diff` commands by interpolating a tag name (from `git describe --tags
 * --abbrev=0`) straight into a shell command string passed to `execSync`. A
 * tag such as `v2.10.2$(id)` would run arbitrary shell syntax. Everything
 * here goes through `execFileSync` with `shell: false`, so the tag is always
 * a single argv element — never shell-parsed — and a resolved commit object
 * ID (not the raw tag text) is what actually gets used to build the log/diff
 * ranges.
 *
 * Importing this module must not run the release entry point, fetch
 * remotes, run verification, invoke Claude, or change files — it only
 * shells out to `git` (or the injected runner) when its exported functions
 * are called.
 */

import { execFileSync } from "node:child_process";

export function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function resolveReleaseCommit(tag, git = runGit) {
  const oid = git(["rev-parse", "--verify", "--end-of-options", `${tag}^{commit}`]);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(oid)) {
    throw new Error("Git returned an invalid release commit ID.");
  }
  return oid;
}

/**
 * Resolve the single root commit of the current history. Throws rather than
 * silently picking one when the repo has multiple roots (e.g. an
 * unrelated-histories merge) — a multi-line result must never be
 * interpolated into a revision range.
 */
function resolveRootCommit(git) {
  const roots = git(["rev-list", "--max-parents=0", "HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (roots.length === 0) {
    throw new Error("Could not determine the repository's root commit.");
  }
  if (roots.length > 1) {
    throw new Error(
      `Repository has ${roots.length} root commits — cannot pick a single diff base. ` +
      "Rewrite this history collection if unrelated-histories merges are expected."
    );
  }
  return roots[0];
}

/**
 * Collects the commit log and diff stat since `tag` (or, when there is no
 * prior tag, since the beginning of history) for release-notes generation.
 *
 * @param {string|null|undefined} tag - the last release tag, or a falsy
 *   value when the repository has no tags yet (full history is used).
 * @param {(args: string[]) => string} git - injectable git command runner,
 *   defaults to `runGit`. Tests inject a stub to assert the exact argv each
 *   call receives without touching a real shell.
 * @returns {{ gitLog: string, diffStat: string }}
 */
export function collectReleaseHistory(tag, git = runGit) {
  let gitLog;
  let diffBaseOid;

  if (tag) {
    // Resolve the tag to a commit object ID *before* building any revision
    // range — the range that goes to `log`/`diff` is always `${oid}..HEAD`,
    // never `${tag}..HEAD`. A tag that fails to resolve aborts here instead
    // of silently falling back to "no history since last release".
    const oid = resolveReleaseCommit(tag, git);
    gitLog = git(["log", `${oid}..HEAD`, "--pretty=format:%h %s (%an)"]);
    diffBaseOid = oid;
  } else {
    gitLog = git(["log", "--pretty=format:%h %s (%an)"]);
    diffBaseOid = resolveRootCommit(git);
  }

  const diffStat = git(["diff", "--stat", `${diffBaseOid}..HEAD`]);

  return { gitLog, diffStat };
}
