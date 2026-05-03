import { BrowserContext } from "playwright";
import { getPage } from "../browser.js";
import { hasValidSession } from "../session-fetch.js";

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
  chapterSlug?: string
): Promise<string> {
  const page = await getPage(context);

  if (!hasValidSession()) {
    throw new Error("Not logged in. Please run ddb_login first.");
  }

  let url = `https://www.dndbeyond.com/sources/${bookSlug}`;
  if (chapterSlug) url += `/${chapterSlug}`;

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
  const truncated =
    trimmed.length > 8000
      ? trimmed.slice(0, 8000) + "\n\n[Content truncated. Specify a chapter_slug to read a specific section.]"
      : trimmed;

  return `# ${bookSlug}${chapterSlug ? ` / ${chapterSlug}` : ""}\nURL: ${url}\n\n${truncated}`;
}
