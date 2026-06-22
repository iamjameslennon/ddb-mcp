import { BrowserContext } from "playwright";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { getPage } from "../browser.js";
import { wrapUntrusted } from "../utils.js";

// Hosts the browser tools are allowed to navigate to. The wildcard form
// `*.dndbeyond.com` is intentionally NOT used here: every code path that
// drives the browser already targets www.dndbeyond.com specifically, and
// pinning the allowlist avoids trust spillover to other DDB subdomains
// (including any user-controlled ones DDB might host in future).
const ALLOWED_NAVIGATE_HOSTS = new Set<string>([
  "www.dndbeyond.com",
  "dndbeyond.com", // apex redirects to www; accept so users can pass either form
]);

/**
 * True when `url` is an https page on an allowlisted D&D Beyond host.
 * Exported for unit testing.
 */
export function isAllowedPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_NAVIGATE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// The ddb_navigate allowlist only checks the URL passed to that tool — without
// this guard, a click on a prompt-injected DDB page could follow an off-site
// link and ddb_get_page would then scrape an arbitrary origin. Abort top-level
// navigations to non-allowlisted hosts at the network layer (covers link
// clicks, JS redirects, and popups). Subresources (CDN assets, images) are
// unaffected. Context-level so popups are covered too; the ddb_login context
// never passes through here, so the Wizards SSO redirect flow stays unguarded.
const guardedContexts = new WeakSet<BrowserContext>();
async function ensureNavigationGuard(context: BrowserContext): Promise<void> {
  if (guardedContexts.has(context)) return;
  guardedContexts.add(context);
  await context.route("**/*", (route) => {
    const req = route.request();
    let isTopLevelNav = false;
    try {
      isTopLevelNav = req.isNavigationRequest() && req.frame().parentFrame() === null;
    } catch {
      // frame() throws for service-worker requests and detached frames —
      // neither can change the page the tools scrape, so let them through.
    }
    if (isTopLevelNav && !isAllowedPageUrl(req.url())) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
}

// Reject Playwright selector forms that go beyond CSS / text-locator matching.
// A prompt-injected DDB page could otherwise craft a selector that runs
// XPath, calls Playwright internals, pierces frames, or invokes an engine we
// haven't reviewed. Deny-list (not allow-list) because legitimate CSS is a
// regular-language we can't easily white-list; we instead exclude every
// known engine prefix that introduces non-CSS behavior. Engine prefixes are
// `<name>=` at the start of a selector chunk, plus `>>` for chaining.
export function assertSafeSelector(selector: string): void {
  const lower = selector.toLowerCase();
  if (
    lower.startsWith("xpath=") ||
    lower.startsWith("xpath/") ||
    lower.startsWith("id=") ||           // Playwright id-engine — bypasses CSS escaping
    lower.startsWith("data-testid=") ||  // Use `[data-testid="..."]` (CSS) instead
    lower.startsWith("internal:") ||     // Playwright internal engines (chromium, react, vue, etc.)
    lower.includes("javascript:") ||
    lower.startsWith(">>") ||
    lower.includes(">>") ||              // Frame piercing / chaining anywhere in the selector
    lower.includes("__playwright") ||
    lower.includes("_eval")
  ) {
    throw new Error("Selector contains disallowed syntax. Use CSS selectors or text-locator selectors only (e.g. 'button:has-text(\"…\")' or '[data-testid=\"…\"]').");
  }
}

export async function navigate(context: BrowserContext, url: string): Promise<string> {
  const page = await getPage(context);
  await ensureNavigationGuard(context);

  // Only allow D&D Beyond URLs — validate the actual hostname.
  let validatedUrl: URL;
  try {
    validatedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (validatedUrl.protocol !== "https:" || !ALLOWED_NAVIGATE_HOSTS.has(validatedUrl.hostname)) {
    throw new Error("Only https://www.dndbeyond.com/ URLs are supported.");
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

  // Wrap scraped content in delimiters so callers can clearly separate
  // trusted tool output from untrusted page content (potential prompt-
  // injection surface). The page may contain user-authored text from DMs,
  // forum posts, or campaign notes.
  return `URL: ${url}\n\n${wrapUntrusted(truncated)}`;
}

export async function interact(
  context: BrowserContext,
  action: "click" | "fill" | "screenshot",
  selector: string,
  value?: string
): Promise<string> {
  assertSafeSelector(selector);
  const page = await getPage(context);
  await ensureNavigationGuard(context);

  switch (action) {
    case "click": {
      // Filter to visible elements before .first() — prevents matching hidden
      // nav dropdown links that appear earlier in the DOM than the intended target.
      const locator = page.locator(selector).filter({ visible: true }).first();
      await locator.waitFor({ state: "visible", timeout: 10000 });
      await locator.click();
      await page.waitForTimeout(1000);
      // Defense in depth alongside the navigation guard: if the click somehow
      // landed the page off-allowlist (e.g. the blocked navigation committed
      // an error page carrying the target URL), say so instead of letting a
      // follow-up ddb_get_page scrape a cross-origin page.
      if (!isAllowedPageUrl(page.url())) {
        throw new Error(
          `Click triggered a navigation away from dndbeyond.com (to ${page.url()}) — ` +
          `it was blocked and no cross-origin content will be returned. ` +
          `Use ddb_navigate to load a D&D Beyond page.`
        );
      }
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
      // ~/Downloads isn't guaranteed to exist on minimal Linux profiles.
      try {
        mkdirSync(dirname(screenshotPath), { recursive: true });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        throw new Error(
          `Cannot create ${dirname(screenshotPath)} (${code ?? "unknown"}). ` +
          `Ensure ~/Downloads exists and is writable.`
        );
      }
      await page.screenshot({ path: screenshotPath, fullPage: false });
      return `Screenshot saved to: ${screenshotPath}`;
    }

    default:
      throw new Error(`Unknown action: ${action}. Use 'click', 'fill', or 'screenshot'.`);
  }
}

export async function getCurrentPageContent(context: BrowserContext): Promise<string> {
  const page = await getPage(context);
  await ensureNavigationGuard(context);
  const url = page.url();
  if (url === "about:blank") {
    throw new Error("No page is loaded yet — call ddb_navigate first.");
  }
  // The page can only leave the allowlist through paths the guard doesn't
  // cover (e.g. a data: URL navigation, which never hits the network layer).
  // Refuse to scrape anything that isn't an allowlisted DDB page.
  if (!isAllowedPageUrl(url)) {
    throw new Error(
      `Current page (${url}) is outside the dndbeyond.com allowlist — refusing to return its content. ` +
      `Use ddb_navigate to load a D&D Beyond page.`
    );
  }
  const content = await page.evaluate(() => {
    document.querySelectorAll("script, style, nav, footer, .ad-container").forEach((el) => el.remove());
    const main =
      document.querySelector("main, article, .main-content, .page-content") ?? document.body;
    return (main as HTMLElement).innerText;
  });

  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n[truncated]" : content;
  // See note in navigate() — wrap scraped content so untrusted page text is
  // visibly separated from trusted tool output.
  return `Current URL: ${url}\n\n${wrapUntrusted(truncated)}`;
}
