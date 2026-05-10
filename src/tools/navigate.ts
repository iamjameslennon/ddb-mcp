import { BrowserContext } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { getPage } from "../browser.js";

// Reject Playwright selector forms that go beyond CSS/text matching. A prompt
// injection on a rendered DDB page could otherwise craft a selector that runs
// arbitrary XPath, calls into Playwright internals, or chains across frames.
function assertSafeSelector(selector: string): void {
  const lower = selector.toLowerCase();
  if (
    lower.startsWith("xpath=") ||
    lower.startsWith("xpath/") ||
    lower.includes("javascript:") ||
    lower.startsWith(">>") ||
    lower.includes("__playwright") ||
    lower.includes("_eval")
  ) {
    throw new Error("Selector contains disallowed syntax. Use CSS selectors or Playwright text selectors only.");
  }
}

export async function navigate(context: BrowserContext, url: string): Promise<string> {
  const page = await getPage(context);

  // Only allow D&D Beyond URLs — validate the actual hostname to prevent subdomain spoofing.
  let validatedUrl: URL;
  try {
    validatedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL.");
  }
  const h = validatedUrl.hostname;
  if (validatedUrl.protocol !== "https:" || !(h === "dndbeyond.com" || h.endsWith(".dndbeyond.com"))) {
    throw new Error("Only D&D Beyond URLs (https://www.dndbeyond.com/...) are supported.");
  }

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // Extract page text content and convert to readable markdown-ish format
  const content = await page.evaluate(() => {
    // Remove scripts and styles
    document.querySelectorAll("script, style, nav, footer, .ad-container, .advertisement").forEach((el) =>
      el.remove()
    );

    // Try to get the main content area
    const main =
      document.querySelector("main, article, .main-content, .page-content, #content") ?? document.body;

    return (main as HTMLElement).innerText;
  });

  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n\n[Content truncated — use ddb_read_book or a more specific URL to get full content]" : content;

  return `URL: ${url}\n\n${truncated}`;
}

export async function interact(
  context: BrowserContext,
  action: "click" | "fill" | "screenshot",
  selector: string,
  value?: string
): Promise<string> {
  assertSafeSelector(selector);
  const page = await getPage(context);

  switch (action) {
    case "click": {
      // Filter to visible elements before .first() — prevents matching hidden
      // nav dropdown links that appear earlier in the DOM than the intended target.
      const locator = page.locator(selector).filter({ visible: true }).first();
      await locator.waitFor({ state: "visible", timeout: 10000 });
      await locator.click();
      await page.waitForTimeout(1000);
      return `Clicked element: ${selector}`;
    }

    case "fill": {
      if (value === undefined) throw new Error("'value' is required for fill action.");
      await page.locator(selector).first().fill(value);
      await page.waitForTimeout(500);
      return `Filled '${selector}'.`;
    }

    case "screenshot": {
      const screenshotPath = join(homedir(), "Downloads", `ddb-screenshot-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      return `Screenshot saved to: ${screenshotPath}`;
    }

    default:
      throw new Error(`Unknown action: ${action}. Use 'click', 'fill', or 'screenshot'.`);
  }
}

export async function getCurrentPageContent(context: BrowserContext): Promise<string> {
  const page = await getPage(context);
  const url = page.url();
  const content = await page.evaluate(() => {
    document.querySelectorAll("script, style, nav, footer, .ad-container").forEach((el) => el.remove());
    const main =
      document.querySelector("main, article, .main-content, .page-content") ?? document.body;
    return (main as HTMLElement).innerText;
  });

  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n[truncated]" : content;
  return `Current URL: ${url}\n\n${truncated}`;
}
