/**
 * Public API surface for character tools. The 1000-line `parseCharacterData`
 * and 220-line `getDefinition` that used to live here have been carved into
 * per-domain modules under `./character/` — see docs/character-refactor.md.
 *
 * What stays here: network/IO (getCharacter, downloadCharacter,
 * listCharacters, findCharacterByName), the in-process JSON cache, and
 * thin re-exports of the moved entry points.
 */

import { sessionFetch, hasValidSession, getCobaltToken } from "../session-fetch.js";
import { TtlCache } from "../cache.js";
import { writeFileSync, mkdirSync, realpathSync } from "fs";
import { join, resolve, relative, basename, dirname, isAbsolute } from "path";
import { homedir } from "os";
import type { ParseSection } from "./character/types.js";
import { levenshteinDistance } from "./character/helpers.js";
import { parseCharacterData } from "./character/parse.js";

// Re-export so MCP server registrations (src/index.ts) and tests
// (tests/character-parser.test.ts, party.test.ts, character-snapshot.test.ts)
// can keep importing from `./tools/character.js`. New code should prefer the
// per-domain modules under `./character/`.
export { parseCharacterData } from "./character/parse.js";
export { getDefinition } from "./character/definition.js";

// Cache character JSON to avoid redundant API calls within a session.
// TTL is configurable via DDB_CHARACTER_CACHE_TTL (seconds); default 60 s.
const CHARACTER_CACHE_TTL_MS = (() => {
  const raw = process.env.DDB_CHARACTER_CACHE_TTL;
  const seconds = raw ? parseInt(raw, 10) : 60;
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
})();
const characterCache = new TtlCache<string>(CHARACTER_CACHE_TTL_MS, 50);

/** Wipe the in-process character JSON cache. */
export function clearCharacterCache(): void {
  characterCache.clear();
}

/**
 * Resolve a character name to a numeric ID using the character list API.
 * Resolution order: exact match → substring match → Levenshtein ≤3 on full
 * name and individual words (e.g. "Throin" matches "Thorin Ironforge").
 * Returns null if no match or multiple ambiguous fuzzy matches are found.
 */
export async function findCharacterByName(name: string): Promise<{ id: string; name: string } | null> {
  // Throw rather than return null when there's no session — otherwise callers
  // surface a misleading "No character found matching '<name>'" message that
  // looks like the character doesn't exist, when really the user just hasn't
  // logged in yet.
  if (!hasValidSession()) {
    throw new Error("No session found. Please run ddb_login first to authenticate.");
  }
  const { token, userId } = await getCobaltToken();
  const resp = await sessionFetch(
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const result = await resp.json() as {
    data?: { characters?: Array<{ id: number; name: string }> };
  };
  const chars = (result.data?.characters ?? []).map(c => ({ id: String(c.id), name: c.name }));
  const lower = name.toLowerCase();

  // 1. Exact match
  const exact = chars.find(c => c.name.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Substring match (only if unambiguous)
  const sub = chars.filter(c => c.name.toLowerCase().includes(lower));
  if (sub.length === 1) return sub[0];

  // 3. Levenshtein fuzzy match on full name and individual words
  const fuzzy = chars.filter(c => {
    if (levenshteinDistance(lower, c.name.toLowerCase()) <= 3) return true;
    return c.name.split(/\s+/).some(w => levenshteinDistance(lower, w.toLowerCase()) <= 3);
  });
  if (fuzzy.length === 1) return fuzzy[0];

  return null;
}

export async function parseCharacter(
  characterId: string,
  sections: ParseSection = "full"
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const raw = JSON.parse(jsonData) as Record<string, unknown>;
  return parseCharacterData(raw, sections);
}

/**
 * Fetch raw character JSON from the DnD Beyond API.
 * Uses saved session cookies — no browser needed after initial login.
 */
export async function getCharacter(
  characterId: string
): Promise<string> {
  const cacheKey = `character:${characterId}`;
  const cached = characterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://character-service.dndbeyond.com/character/v5/character/${encodeURIComponent(characterId)}?includeCustomItems=true`;

  // Public characters work without auth. Use session cookies if available so
  // private/campaign-only characters owned by the logged-in user also work.
  const resp = hasValidSession()
    ? await sessionFetch(url)
    : await fetch(url, { headers: { Accept: "application/json" } });

  if (resp.ok) {
    const result = await resp.json();
    const json = JSON.stringify(result);
    characterCache.set(cacheKey, json);
    return json;
  }

  // 404 = character doesn't exist; 403 = private
  if (resp.status === 403) {
    throw new Error(`Character ${characterId} is private and cannot be accessed.`);
  }
  throw new Error(`DnD Beyond API returned ${resp.status}: ${resp.statusText}`);
}

/**
 * Realpath the nearest existing ancestor of `p`, then re-attach the
 * non-existent tail. The target file usually doesn't exist yet, so we can't
 * realpath it directly — but resolving symlinks in the existing portion of the
 * path is what matters: it collapses a planted symlink to its real location.
 */
function realpathNearestAncestor(p: string): string {
  const tail: string[] = [];
  let current = p;
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return p; // hit the filesystem root; nothing resolved
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `outputPath` and verify it lands strictly inside one of
 * `allowedDirs`, returning the symlink-resolved absolute path to write to.
 *
 * Symlinks are resolved on BOTH sides before the containment check: a symlink
 * planted inside an allowed dir (e.g. ~/Documents/x → /etc) can't redirect the
 * write outside the allowlist, and a legitimately symlinked allowed dir (e.g.
 * ~/Downloads → an external volume) still validates. Throws on escape.
 *
 * Exported for unit testing.
 */
export function resolveSafeSavePath(outputPath: string, allowedDirs: string[]): string {
  const resolved = resolve(outputPath);
  if (resolved.includes("\0")) throw new Error("Output path contains invalid characters.");

  const realTarget = realpathNearestAncestor(resolved);
  const realAllowed = allowedDirs.map(d => {
    try { return realpathSync(d); } catch { return resolve(d); }
  });

  // rel must be non-empty (rejects the allowed dir itself, which would later
  // EISDIR), not escape with .., and not be absolute (cross-drive on Windows).
  const isAllowed = realAllowed.some(dir => {
    const rel = relative(dir, realTarget);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
  if (!isAllowed) {
    throw new Error("Output path must be a file under ~/Downloads or ~/Documents.");
  }
  return realTarget;
}

export async function downloadCharacter(
  characterId: string,
  outputPath?: string
): Promise<string> {
  const jsonData = await getCharacter(characterId);
  const parsed = JSON.parse(jsonData);
  const charName: string = parsed?.data?.name ?? `character-${characterId}`;

  // Sanitize the character name: keep only alphanumeric, spaces, hyphens, apostrophes.
  // basename ensures no path separators survive; the allowlist strips anything else.
  const safeName = basename(charName)
    .replace(/[^a-zA-Z0-9 '\-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 64) || `character-${characterId}`;
  const filename = `${safeName}-${characterId}.json`;
  const downloadsDir = join(homedir(), "Downloads");
  const defaultPath = join(downloadsDir, filename);

  let savePath: string;
  if (outputPath) {
    savePath = resolveSafeSavePath(outputPath, [
      join(homedir(), "Downloads"),
      join(homedir(), "Documents"),
    ]);
  } else {
    savePath = defaultPath;
  }

  // Minimal Linux installs (and some Windows profiles) don't ship with ~/Downloads
  // or ~/Documents — create the target dir so the write doesn't ENOENT. Safe to
  // do unconditionally because the allowlist above already constrained savePath.
  try {
    mkdirSync(dirname(savePath), { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(
      `Cannot create directory ${dirname(savePath)} (${code ?? "unknown"}). ` +
      `Pass output_path pointing to an existing directory under ~/Downloads or ~/Documents.`
    );
  }
  writeFileSync(savePath, JSON.stringify(parsed, null, 2), "utf8");
  return `Character data for '${charName}' saved to: ${savePath}`;
}

export async function listCharacters(): Promise<string> {
  if (!hasValidSession()) {
    throw new Error("No session found. Please run ddb_login first.");
  }

  const { token, userId } = await getCobaltToken();
  const resp = await sessionFetch(
    `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) throw new Error(`Character list API returned ${resp.status}: ${resp.statusText}`);

  const result = await resp.json() as {
    data?: {
      characters?: Array<{
        id: number; name: string; level: number; raceName: string;
        classDescription: string; campaignId: number | null; campaignName: string | null;
        statusSlug: string;
      }>;
    };
  };

  const characters = (result.data?.characters ?? []).map((c) => ({
    id: String(c.id),
    name: c.name,
    level: c.level,
    race: c.raceName,
    class: c.classDescription,
    status: c.statusSlug,
    campaignId: c.campaignId ? String(c.campaignId) : null,
    campaignName: c.campaignName ?? null,
  }));

  return JSON.stringify(characters);
}
