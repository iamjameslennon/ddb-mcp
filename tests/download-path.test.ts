import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveSafeSavePath } from "../src/tools/character.js";

// Real temp dirs + a planted symlink — the symlink-escape case is exactly
// what a lexical (resolve-only) containment check fails to catch.
let root: string;
let allowedDir: string;
let outsideDir: string;

beforeAll(() => {
  // realpath the tmp root: on macOS /tmp itself is a symlink to /private/tmp,
  // and we compare realpaths, so the test fixtures must start from a realpath.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ddb-dl-")));
  allowedDir = join(root, "Documents");
  outsideDir = join(root, "secret");
  mkdirSync(allowedDir);
  mkdirSync(outsideDir);
  // ~/Documents/escape -> ../secret  (a symlink planted inside the allowed dir)
  symlinkSync(outsideDir, join(allowedDir, "escape"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSafeSavePath", () => {
  it("accepts a plain file directly under an allowed dir", () => {
    const out = resolveSafeSavePath(join(allowedDir, "hero-1.json"), [allowedDir]);
    expect(out).toBe(join(allowedDir, "hero-1.json"));
  });

  it("accepts a file in a real subdirectory of an allowed dir", () => {
    const sub = join(allowedDir, "dnd");
    mkdirSync(sub, { recursive: true });
    const out = resolveSafeSavePath(join(sub, "hero-1.json"), [allowedDir]);
    expect(out).toBe(join(sub, "hero-1.json"));
  });

  it("rejects a path that escapes via a symlink planted inside the allowed dir", () => {
    // Lexically this is `<allowed>/escape/loot.json` — a child of the allowed
    // dir — but `escape` is a symlink to outside it. Must be rejected.
    expect(() =>
      resolveSafeSavePath(join(allowedDir, "escape", "loot.json"), [allowedDir])
    ).toThrow(/under ~\/Downloads or ~\/Documents/);
  });

  it("rejects ../ traversal outside the allowed dir", () => {
    expect(() =>
      resolveSafeSavePath(join(allowedDir, "..", "secret", "loot.json"), [allowedDir])
    ).toThrow(/under ~\/Downloads or ~\/Documents/);
  });

  it("rejects the allowed dir itself (no filename)", () => {
    expect(() => resolveSafeSavePath(allowedDir, [allowedDir])).toThrow();
  });

  it("accepts a file when the allowed dir itself is a symlink", () => {
    // e.g. ~/Downloads -> /Volumes/ext/Downloads
    const realDownloads = join(root, "real-downloads");
    mkdirSync(realDownloads);
    const linkedDownloads = join(root, "Downloads");
    symlinkSync(realDownloads, linkedDownloads);
    const out = resolveSafeSavePath(join(linkedDownloads, "hero-1.json"), [linkedDownloads]);
    expect(out).toBe(join(realDownloads, "hero-1.json"));
  });

  it("rejects NUL bytes in the path", () => {
    expect(() => resolveSafeSavePath(join(allowedDir, "a\0b.json"), [allowedDir])).toThrow(
      /invalid characters/
    );
  });
});
