import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { sessionFetch, hasValidSession } from "../session-fetch.js";
import { wrapUntrusted, stripHtml } from "../utils.js";
import { getSourceIndex } from "../game-config.js";
import { classifyEdition, normalizeName, rulesLine, editionTag, type EditionInfo, type SourceIndex } from "../edition.js";

const LIBRARY_URL =
  "https://www.dndbeyond.com/en/library?type=sourcebooks&ownership=owned-shared";

// ── Library scrape deduplication ─────────────────────────────────────────────

export interface LibraryBook { title: string; slug: string; ownership: string }

/**
 * Dedupe library entries by `slug` (with `title` as fallback when slug is
 * empty). The DDB library page embeds the same source list twice in its
 * server-rendered RSC payload — we parse both arrays for resilience but the
 * caller wants a unique list. Order is preserved by first occurrence so the
 * displayed list keeps DDB's intended sort. Exported for unit testing.
 */
export function dedupeLibraryBooks(books: ReadonlyArray<LibraryBook>): LibraryBook[] {
  const seen = new Set<string>();
  const out: LibraryBook[] = [];
  for (const b of books) {
    const key = b.slug || b.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

// ── HTML/RSC parser ──────────────────────────────────────────────────────────

interface LibrarySource {
  name?: string;
  relativePath?: string;
  isOwned?: boolean;
  isSharedWithMe?: boolean;
  // Other fields exist (image, sku, ruleset, etc.) but we don't surface them.
}

/**
 * Pull the `sources:[…]` array(s) from the library page's React Server Component
 * payload. The page is a Next.js app-router route; its initial data is streamed
 * as a sequence of `self.__next_f.push([1, "<chunk>"])` calls in the HTML, with
 * the same payload appearing twice (head + body stream). We concatenate all
 * chunks, then bracket-balance every `"sources":[…]` occurrence into JSON.
 * Exported for unit testing without a live HTTP request.
 */
export function parseSourcesFromLibraryHtml(html: string): LibraryBook[] {
  const chunks: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    chunks.push(JSON.parse(`"${m[1]}"`));
  }
  const combined = chunks.join("");

  const collected: LibrarySource[] = [];
  let from = 0;
  while (true) {
    const keyAt = combined.indexOf('"sources":[', from);
    if (keyAt < 0) break;
    const arrayStart = combined.indexOf("[", keyAt);
    const end = findMatchingBracket(combined, arrayStart);
    if (end < 0) break;
    try {
      const arr = JSON.parse(combined.slice(arrayStart, end + 1)) as LibrarySource[];
      collected.push(...arr);
    } catch {
      // Skip malformed slices and continue scanning — the second occurrence may
      // still parse cleanly.
    }
    from = end + 1;
  }

  const books: LibraryBook[] = [];
  for (const s of collected) {
    if (!s.isOwned && !s.isSharedWithMe) continue;
    const name = s.name?.trim();
    const relPath = s.relativePath ?? "";
    const slug = relPath.startsWith("/sources/") ? relPath.slice("/sources/".length) : "";
    if (!name) continue;
    const ownership = s.isOwned
      ? (s.isSharedWithMe ? "Owned, Shared" : "Owned")
      : "Shared with you";
    books.push({ title: name, slug, ownership });
  }
  return dedupeLibraryBooks(books);
}

function findMatchingBracket(s: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (inStr) { if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i;
  }
  return -1;
}

// ── Book slug resolution ───────────────────────────────────────────────────────

/**
 * Match a plain-text book title against a library list.
 * Exported for unit testing without a browser context.
 *
 * Resolution order:
 *   1. Exact match (case-insensitive)
 *   2. Substring: input is contained in the title (unambiguous)
 *   3. Error with available options
 */
export function matchBookSlug(
  books: Array<{ title: string; slug: string }>,
  input: string
): string {
  const lower = input.toLowerCase();

  // 1. Exact match
  const exact = books.find(b => b.title.toLowerCase() === lower);
  if (exact) return exact.slug;

  // 2. Substring match
  const matches = books.filter(b => b.title.toLowerCase().includes(lower));
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) {
    const list = matches.map(b => `  • ${b.title} (${b.slug})`).join("\n");
    throw new Error(`Multiple books match "${input}" — be more specific:\n${list}`);
  }

  // 3. No match
  const all = books.map(b => `  • ${b.title} (${b.slug})`).join("\n");
  throw new Error(`No book found matching "${input}".\nAvailable books:\n${all}`);
}

/**
 * Resolve a user-supplied book identifier to a slug and, when it came from the
 * library list, that book's title.
 * If input already contains "/" it is treated as a slug and returned as-is.
 * Otherwise, listLibrary() is called and the title is fuzzy-matched.
 */
export async function resolveBookSlug(input: string): Promise<{ slug: string; title: string | null }> {
  if (input.includes("/")) return { slug: input, title: null };
  const raw = await listLibrary();
  const { books } = JSON.parse(raw) as { books: Array<{ title: string; slug: string }> };
  const slug = matchBookSlug(books, input);
  return { slug, title: books.find(b => b.slug === slug)?.title ?? null };
}

// ── Edition join ─────────────────────────────────────────────────────────────

const lastSegment = (path: string | null | undefined): string =>
  (path ?? "").split("/").filter(Boolean).pop() ?? "";

/** Choose one id among candidates: agreeing editions take the lowest id; disagreeing ones fail. */
function pickCandidate(ids: number[], index: SourceIndex): number | null {
  if (ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => a - b);
  const staged = sorted.filter(id => classifyEdition({ sourceId: id }, index).ruleset !== "unstated");
  if (staged.length === 0) return sorted[0];
  const rulesets = new Set(staged.map(id => classifyEdition({ sourceId: id }, index).ruleset));
  return rulesets.size === 1 ? staged[0] : null;
}

/**
 * Join a library book to a game-config source: (a) the slug's last segment
 * equals a source's `sourceURL` last segment, else (b) the title equals a
 * source's description or book label. An ambiguous step fails.
 */
export function librarySourceId(
  book: { slug: string; title: string | null },
  index: SourceIndex,
): number | null {
  // Segments right to left: a chapter path ("dnd/phb-2024/chapter") joins on
  // its book segment. The first segment with any candidate decides step (a).
  const segs = book.slug.split("/").filter(Boolean).reverse();
  for (const seg of segs) {
    const ids = [...index.sources].filter(([, s]) => lastSegment(s.sourceURL) === seg).map(([id]) => id);
    if (ids.length === 0) continue;
    const hit = pickCandidate(ids, index);
    if (hit !== null) return hit;
    break;
  }
  const title = book.title ? normalizeName(book.title) : "";
  if (title) {
    const ids = [...index.sources]
      .filter(([, s]) => normalizeName(stripHtml(s.description ?? "")) === title || normalizeName(s.book) === title)
      .map(([id]) => id);
    return pickCandidate(ids, index);
  }
  return null;
}

export function libraryBookInfo(
  book: { slug: string; title: string | null },
  index: SourceIndex,
): EditionInfo {
  const id = librarySourceId(book, index);
  return id === null ? { ruleset: "unstated", book: null } : classifyEdition({ sourceId: id }, index);
}

export function tagLibraryBooks(
  books: readonly LibraryBook[],
  index: SourceIndex,
): Array<LibraryBook & { edition: string }> {
  return books.map(b => ({ ...b, edition: editionTag(libraryBookInfo(b, index)) }));
}

// ── Public tools ─────────────────────────────────────────────────────────────

async function fetchLibraryBooks(): Promise<LibraryBook[]> {
  const resp = await sessionFetch(LIBRARY_URL);
  if (!resp.ok) {
    throw new Error(`Library fetch failed: ${resp.status} ${resp.statusText}`);
  }
  return parseSourcesFromLibraryHtml(await resp.text());
}

export async function listLibrary(): Promise<string> {
  if (!hasValidSession()) {
    throw new Error("Not logged in. Please run ddb_login first.");
  }

  const books = await fetchLibraryBooks();
  return JSON.stringify({ count: books.length, books: tagLibraryBooks(books, await getSourceIndex()) });
}

/**
 * Convert a DDB sourcebook page's article HTML into plain markdown.
 * Mirrors the tag mapping the previous browser-based extractor used
 * (h1/h2 → ##, h3/h4 → ###, p, li, ul/ol, strong/em, hr, br, table).
 * Exported for unit testing.
 */
export function extractArticleMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // Strip non-content chrome — matches the browser version's removals.
  $("script, style, nav, header, footer, aside, .ad-container, .sidebar, .toc, .breadcrumb").remove();

  const root =
    $("article").first().get(0) ??
    $(".content-container").first().get(0) ??
    $(".p-content").first().get(0) ??
    $("main").first().get(0) ??
    $("body").first().get(0);

  if (!root) return "";

  const processNode = (node: AnyNode): string => {
    if (node.type === "text") return (node as { data: string }).data ?? "";
    if (node.type !== "tag") return "";

    const el = node as { name: string; children: AnyNode[] };
    const tag = el.name.toLowerCase();
    if (["script", "style", "aside", "nav"].includes(tag)) return "";

    const childText = el.children.map(processNode).join("");

    if (tag === "h1" || tag === "h2") return `\n\n## ${childText.trim()}\n\n`;
    if (tag === "h3" || tag === "h4") return `\n\n### ${childText.trim()}\n\n`;
    if (tag === "p")                  return `\n${childText.trim()}\n`;
    if (tag === "li")                 return `\n- ${childText.trim()}`;
    if (tag === "ul" || tag === "ol") return `\n${childText}\n`;
    if (tag === "strong" || tag === "b") return `**${childText}**`;
    if (tag === "em" || tag === "i")     return `_${childText}_`;
    if (tag === "hr")                 return `\n---\n`;
    if (tag === "br")                 return "\n";
    if (tag === "table")              return `\n[Table]\n${childText}\n`;
    return childText;
  };

  return processNode(root as AnyNode).trim();
}

export async function readBook(
  bookSlug: string,
  chapterSlug?: string,
  maxChars = 3000,
  query?: string
): Promise<string> {
  if (!hasValidSession()) {
    throw new Error("Not logged in. Please run ddb_login first.");
  }

  // Resolve plain title → slug (passthrough if input already contains "/")
  const resolved = await resolveBookSlug(bookSlug);
  const resolvedSlug = resolved.slug;

  // Edition: join by slug; when that fails and no title is known yet, look the
  // slug up in the library once. A failed lookup just leaves the book unlabelled.
  const index = await getSourceIndex();
  let bookRef = resolved;
  if (bookRef.title === null && librarySourceId(bookRef, index) === null) {
    try {
      const title = (await fetchLibraryBooks()).find(b => b.slug === resolvedSlug)?.title ?? null;
      bookRef = { slug: resolvedSlug, title };
    } catch {
      // no title: stays "edition not stated"
    }
  }
  const rules = rulesLine(libraryBookInfo(bookRef, index));

  // Encode per path segment so legitimate slug separators (e.g. 'dnd/phb-2024')
  // are preserved while any other character is percent-encoded. Defense in depth
  // — the Zod schema already restricts slug shape.
  const encodePath = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  let url = `https://www.dndbeyond.com/sources/${encodePath(resolvedSlug)}`;
  if (chapterSlug) url += `/${encodePath(chapterSlug)}`;

  const resp = await sessionFetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });
  if (!resp.ok) {
    throw new Error(`Book fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  }
  const html = await resp.text();
  const content = extractArticleMarkdown(html);

  let contentToReturn = content;
  if (query) {
    const q = query.toLowerCase();
    const headingRegex = /^#{1,4}\s.+$/gm;
    let bestPos = -1;
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      if (match[0].toLowerCase().includes(q)) {
        bestPos = match.index;
        break;
      }
    }
    if (bestPos >= 0) contentToReturn = content.slice(bestPos);
  }

  const wasTruncated = contentToReturn.length > maxChars;
  const body = wasTruncated ? contentToReturn.slice(0, maxChars) : contentToReturn;
  const truncNote = wasTruncated
    ? `\n\n[Truncated at ${maxChars} chars. Use a larger max_chars or specify query/chapter_slug to narrow scope.]`
    : "";

  // Book text is DDB-served page content — keep it inside untrusted
  // delimiters (and the tool-generated truncation note outside them), same
  // as the ddb_navigate / ddb_get_page scrapers.
  return `# ${resolvedSlug}${chapterSlug ? ` / ${chapterSlug}` : ""}\n${rules}\nURL: ${url}\n\n${wrapUntrusted(body)}${truncNote}`;
}
