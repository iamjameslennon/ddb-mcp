import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGit,
  resolveReleaseCommit,
  collectReleaseHistory,
} from "../scripts/release-history.mjs";

// A literal tag containing shell metacharacters, exactly as `git describe`
// could hand back from an attacker-controlled ref. TEST DATA ONLY — this is
// never interpolated into a real shell command anywhere in this file. Every
// use below either (a) goes to a mocked `git` runner that just records argv,
// or (b) goes to the real `git` binary via `execFileSync(..., { shell: false
// })`, where it is inert: a single argv element, not shell-parsed.
const MALICIOUS_TAG = "v2.10.2$(id)";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main", dir], { shell: false });
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"], { shell: false });
  execFileSync("git", ["-C", dir, "config", "user.name", "Test User"], { shell: false });
  execFileSync("git", ["-C", dir, "config", "commit.gpgsign", "false"], { shell: false });
}

function commit(dir: string, file: string, contents: string, message: string): void {
  writeFileSync(join(dir, file), contents);
  execFileSync("git", ["-C", dir, "add", file], { shell: false });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", message], { shell: false });
}

function tag(dir: string, name: string): void {
  execFileSync("git", ["-C", dir, "tag", name], { shell: false });
}

/** Runs `fn` with process.cwd() pointed at `dir`, always restoring it after. */
function withCwd<T>(dir: string, fn: () => T): T {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(original);
  }
}

describe("runGit — process boundary (real git, no shell)", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "release-history-"));
    initRepo(repo);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes a metacharacter-bearing argument through inert, never spawning a shell", () => {
    // Old vulnerable shape (never executed here — string-built only, for
    // contrast/documentation): `git rev-parse ${tag}^{commit}` run through
    // execSync would let a shell interpret `$(touch pwned-marker)`.
    const vulnerableCommand = `git rev-parse --verify --end-of-options ${MALICIOUS_TAG}^{commit}`;
    expect(vulnerableCommand).toContain("$(id)"); // documents what a shell would expand

    // New behavior: the same text, as a single argv element via runGit
    // (execFileSync, shell: false). git rejects it as an invalid ref
    // (nonexistent besides) — it never reaches a shell to be expanded.
    const markerPath = join(repo, "pwned-marker");
    expect(() =>
      withCwd(repo, () =>
        runGit(["rev-parse", "--verify", "--end-of-options", `$(touch ${markerPath})^{commit}`])
      )
    ).toThrow();
    expect(existsSync(markerPath)).toBe(false);
  });

  it("declares shell: false on every execFileSync call in the module source", () => {
    // Static check, independent of ESM mocking quirks: every git invocation
    // in the helper must explicitly disable the shell. This is the property
    // that makes the marker-file test above (and the real fix) safe.
    const source = readFileSync(
      new URL("../scripts/release-history.mjs", import.meta.url),
      "utf8"
    );
    const executions = source.match(/execFileSync\([\s\S]*?\)\.trim\(\)/g) ?? [];
    expect(executions.length).toBeGreaterThan(0);
    for (const call of executions) {
      expect(call).toMatch(/shell:\s*false/);
    }
  });
});

describe("resolveReleaseCommit — injected git runner", () => {
  it("passes the complete tag as a single rev-parse argument", () => {
    const calls: string[][] = [];
    const fakeOid = "a".repeat(40);
    const git = (args: string[]) => {
      calls.push(args);
      return fakeOid;
    };

    const oid = resolveReleaseCommit(MALICIOUS_TAG, git);

    expect(oid).toBe(fakeOid);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${MALICIOUS_TAG}^{commit}`,
    ]);
    // The whole tag (including the shell metacharacters) is one element of
    // the argv array, not concatenated into a string anywhere.
    expect(calls[0]).toContain(`${MALICIOUS_TAG}^{commit}`);
  });

  it("rejects a non-hex / malformed oid from the git runner", () => {
    const git = () => "not-a-commit-id";
    expect(() => resolveReleaseCommit("v1.0.0", git)).toThrow(/invalid release commit ID/);
  });

  it("propagates a real git failure for a tag that does not resolve", () => {
    const repo = mkdtempSync(join(tmpdir(), "release-history-"));
    try {
      initRepo(repo);
      commit(repo, "a.txt", "a", "init");
      expect(() => withCwd(repo, () => resolveReleaseCommit("v9.9.9-does-not-exist"))).toThrow();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("collectReleaseHistory — injected git runner regression", () => {
  it("uses the resolved commit ID (not the raw tag) for both log and diff, with no shell option", () => {
    const oid = "b".repeat(40);
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse") return oid;
      if (args[0] === "log") return "abc123 fix things (Someone)";
      if (args[0] === "diff") return " 1 file changed";
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    };

    const { gitLog, diffStat } = collectReleaseHistory(MALICIOUS_TAG, git);

    expect(gitLog).toBe("abc123 fix things (Someone)");
    expect(diffStat).toBe(" 1 file changed");

    const revParseCall = calls.find((c) => c[0] === "rev-parse");
    const logCall = calls.find((c) => c[0] === "log");
    const diffCall = calls.find((c) => c[0] === "diff");

    expect(revParseCall).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${MALICIOUS_TAG}^{commit}`,
    ]);
    expect(logCall).toEqual(["log", `${oid}..HEAD`, "--pretty=format:%h %s (%an)"]);
    expect(diffCall).toEqual(["diff", "--stat", `${oid}..HEAD`]);

    // The raw malicious tag text never appears in the log/diff argv — only
    // the resolved oid does.
    expect(logCall?.some((a) => a.includes("$("))).toBe(false);
    expect(diffCall?.some((a) => a.includes("$("))).toBe(false);

    // Every call is a plain argv array of strings — nothing here is a shell
    // command string, and the injected runner itself never sets `shell`.
    for (const call of calls) {
      for (const arg of call) {
        expect(typeof arg).toBe("string");
      }
    }
  });

  it("throws instead of falling back to empty history when a git call fails", () => {
    const git = (args: string[]) => {
      if (args[0] === "rev-parse") return "c".repeat(40);
      if (args[0] === "log") throw new Error("git log exploded");
      return "";
    };
    expect(() => collectReleaseHistory("v1.0.0", git)).toThrow(/git log exploded/);
  });

  it("aborts when the selected tag fails to resolve, rather than treating it as untagged", () => {
    const git = (args: string[]) => {
      if (args[0] === "rev-parse") throw new Error("fatal: bad revision");
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    };
    expect(() => collectReleaseHistory("v1.0.0", git)).toThrow(/bad revision/);
  });
});

describe("collectReleaseHistory — real git repositories", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "release-history-"));
    initRepo(repo);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns log and diff since the given tag", () => {
    commit(repo, "a.txt", "a", "first commit");
    tag(repo, "v1.0.0");
    commit(repo, "b.txt", "b", "second commit");
    commit(repo, "c.txt", "c", "third commit");

    const { gitLog, diffStat } = withCwd(repo, () => collectReleaseHistory("v1.0.0", runGit));

    expect(gitLog).toContain("second commit");
    expect(gitLog).toContain("third commit");
    expect(gitLog).not.toContain("first commit");
    expect(diffStat).toContain("b.txt");
    expect(diffStat).toContain("c.txt");
  });

  it("keeps existing full-log behavior for an untagged repository", () => {
    commit(repo, "a.txt", "a", "root commit");
    commit(repo, "b.txt", "b", "second commit");

    const { gitLog, diffStat } = withCwd(repo, () => collectReleaseHistory(null, runGit));

    expect(gitLog).toContain("root commit");
    expect(gitLog).toContain("second commit");
    // diff --stat is root..HEAD, so it shows changes made *since* the root
    // commit — a.txt was introduced by the root commit itself, so only
    // b.txt (added afterwards) shows up here.
    expect(diffStat).toContain("b.txt");
  });

  it("returns an empty log when there are no commits since the last tag", () => {
    commit(repo, "a.txt", "a", "only commit");
    tag(repo, "v1.0.0");

    const { gitLog } = withCwd(repo, () => collectReleaseHistory("v1.0.0", runGit));

    expect(gitLog).toBe("");
  });

  it("throws when a tag that no longer resolves is passed in", () => {
    commit(repo, "a.txt", "a", "only commit");

    expect(() =>
      withCwd(repo, () => collectReleaseHistory("v9.9.9-nonexistent", runGit))
    ).toThrow();
  });

  it("throws with a clear error instead of interpolating a multi-line root-commit set", () => {
    // Two independent root commits merged with --allow-unrelated-histories:
    // `git rev-list --max-parents=0 HEAD` now returns two lines.
    commit(repo, "a.txt", "a", "root one");
    execFileSync("git", ["-C", repo, "checkout", "-q", "--orphan", "second"], { shell: false });
    execFileSync("git", ["-C", repo, "rm", "-rf", "-q", "."], { shell: false });
    commit(repo, "b.txt", "b", "root two");
    execFileSync("git", ["-C", repo, "checkout", "-q", "main"], { shell: false });
    execFileSync(
      "git",
      ["-C", repo, "merge", "second", "-q", "--allow-unrelated-histories", "-m", "merge"],
      { shell: false }
    );

    expect(() => withCwd(repo, () => collectReleaseHistory(null, runGit))).toThrow(
      /multiple root commits|2 root commits/i
    );
  });
});
