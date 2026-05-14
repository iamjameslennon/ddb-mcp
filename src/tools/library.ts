import { BrowserContext } from "playwright";
import { getPage } from "../browser.js";
import { hasValidSession } from "../session-fetch.js";

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
 * Resolve a user-supplied book identifier to a slug.
 * If input already contains "/" it is treated as a slug and returned as-is.
 * Otherwise, listLibrary() is called and the title is fuzzy-matched.
 */
export async function resolveBookSlug(context: BrowserContext, input: string): Promise<string> {
  if (input.includes("/")) return input;
  const raw = await listLibrary(context);
  const { books } = JSON.parse(raw) as { books: Array<{ title: string; slug: string }> };
  return matchBookSlug(books, input);
}

export async function listLibrary(context: BrowserContext): Promise<string> {
  const page = await getPage(context);

  if (!hasValidSession()) {
    throw new Error("Not logged in. Please run ddb_login first.");
  }

  await page.goto("https://www.dndbeyond.com/en/library?type=sourcebooks&ownership=owned-shared", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForSelector("div[data-testid='sourceCard'], .library-empty", { timeout: 15000 }).catch(() => {});

  const books = await page.evaluate(() => {
    const items: Array<{ title: string; slug: string; ownership: string }> = [];
    document.querySelectorAll("div[data-testid='sourceCard']").forEach((card) => {
      const titleEl = card.querySelector("a[class*='SourceCard_sourceTitle']") as HTMLAnchorElement | null;
      const title = titleEl?.textContent?.trim() ?? "";
      const href = titleEl?.href ?? "";
      const slugMatch = href.match(/\/sources\/(.+)/);
      const slug = slugMatch?.[1] ?? "";
      const ownership = card.querySelector("p[class*='SourceCard_sourceSubtitle']")?.textContent?.trim() ?? "";
      if (title) items.push({ title, slug, ownership });
    });
    return items;
  });

  return JSON.stringify({ count: books.length, books });
}

export async function readBook(
  context: BrowserContext,
  bookSlug: string,
  chapterSlug?: string,
  maxChars = 3000,
  query?: string
): Promise<string> {
  const page = await getPage(context);

  if (!hasValidSession()) {
    throw new Error("Not logged in. Please run ddb_login first.");
  }

  // Resolve plain title → slug (passthrough if input already contains "/")
  const resolvedSlug = await resolveBookSlug(context, bookSlug);

  // Encode per path segment so legitimate slug separators (e.g. 'dnd/phb-2024')
  // are preserved while any other character is percent-encoded. Defense in depth
  // — the Zod schema already restricts slug shape.
  const encodePath = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  let url = `https://www.dndbeyond.com/sources/${encodePath(resolvedSlug)}`;
  if (chapterSlug) url += `/${encodePath(chapterSlug)}`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Wait for content to render (DDB uses heavy JS rendering)
  await page.waitForSelector("article, .content-container, .p-content-title", { timeout: 15000 }).catch(() => {});

  const content = await page.evaluate(() => {
    // Remove non-content elements
    document
      .querySelectorAll("script, style, nav, header, footer, .ad-container, .sidebar, .toc, .breadcrumb")
      .forEach((el) => el.remove());

    // Try to find the main reading area
    const article =
      document.querySelector("article") ??
      document.querySelector(".content-container") ??
      document.querySelector(".p-content") ??
      document.querySelector("main");

    if (!article) return document.body.innerText;

    // Extract text preserving basic structure
    function processNode(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      if (["script", "style", "aside", "nav"].includes(tag)) return "";

      const childText = Array.from(el.childNodes).map(processNode).join("");

      if (["h1", "h2"].includes(tag)) return `\n\n## ${childText.trim()}\n\n`;
      if (["h3", "h4"].includes(tag)) return `\n\n### ${childText.trim()}\n\n`;
      if (tag === "p") return `\n${childText.trim()}\n`;
      if (tag === "li") return `\n- ${childText.trim()}`;
      if (["ul", "ol"].includes(tag)) return `\n${childText}\n`;
      if (tag === "strong" || tag === "b") return `**${childText}**`;
      if (tag === "em" || tag === "i") return `_${childText}_`;
      if (tag === "hr") return `\n---\n`;
      if (tag === "br") return "\n";
      if (tag === "table") {
        // Simplify tables to text
        return `\n[Table]\n${childText}\n`;
      }

      return childText;
    }

    return processNode(article);
  });

  const trimmed = content.trim();
  let contentToReturn = trimmed;

  if (query) {
    const q = query.toLowerCase();
    const headingRegex = /^#{1,4}\s.+$/gm;
    let bestPos = -1;
    let match;
    while ((match = headingRegex.exec(trimmed)) !== null) {
      if (match[0].toLowerCase().includes(q)) {
        bestPos = match.index;
        break;
      }
    }
    if (bestPos >= 0) contentToReturn = trimmed.slice(bestPos);
  }

  const truncated = contentToReturn.length > maxChars
    ? contentToReturn.slice(0, maxChars) +
      `\n\n[Truncated at ${maxChars} chars. Use a larger max_chars or specify query/chapter_slug to narrow scope.]`
    : contentToReturn;

  return `# ${resolvedSlug}${chapterSlug ? ` / ${chapterSlug}` : ""}\nURL: ${url}\n\n${truncated}`;
}
