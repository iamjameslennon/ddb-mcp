import { BrowserContext, Page, Route } from "playwright";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { getPage } from "../browser.js";
import { captureSession, assertSessionCurrent } from "../session-fetch.js";
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

/** What a refusal calls a page that has no meaningful origin to print. */
export const FOREIGN_PAGE_PLACEHOLDER = "a non-D&D Beyond page";

/**
 * How a refusal names a page off the allowlist: its origin (scheme, host,
 * port) only. The path and query are the foreign server's choice, so printing
 * them would put attacker text in trusted tool output (final review m1). A URL
 * that can't be parsed or has an opaque origin (about:, data:, chrome-error:,
 * javascript:, file:) gets FOREIGN_PAGE_PLACEHOLDER. Exported for unit testing.
 */
export function foreignPageLabel(url: string): string {
  try {
    const { origin } = new URL(url);
    if (origin && origin !== "null") return origin;
  } catch {
    // unparsable: the placeholder below
  }
  return FOREIGN_PAGE_PLACEHOLDER;
}

// The ddb_navigate allowlist only checks the URL passed to that tool — without
// this guard, a click on a prompt-injected DDB page could follow an off-site
// link and ddb_get_page would then scrape an arbitrary origin. Abort routed
// top-level navigations to non-allowlisted hosts at the network layer (link
// clicks, JS redirects, a popup's later navigations; a popup's FIRST
// navigation is never routed by Playwright, carry-over (bx)). Subresources
// (CDN assets, images) are unaffected. Context-level so popups are covered
// too; the ddb_login context never passes through here, so the Wizards SSO
// redirect flow stays unguarded.
const guardedContexts = new WeakSet<BrowserContext>();
async function ensureNavigationGuard(context: BrowserContext): Promise<void> {
  if (guardedContexts.has(context)) return;
  guardedContexts.add(context);
  await context.route("**/*", (route) => guardRoute(route));
}

/** Most redirects one navigation may follow (Playwright's own default). */
export const MAX_REDIRECT_HOPS = 20;
/** Deadline for one navigation: goto's timeout, and the whole redirect walk's. */
export const NAVIGATION_TIMEOUT_MS = 30000;
// Statuses Chromium (and Playwright's own fetch) follow through `Location`.
// Any other 3xx, 300 included, is shown as-is by the browser.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The shared context's route handler. Exported for unit testing.
 *
 * Playwright routes only the first request of a redirect chain: every later
 * hop, including one from a fulfilled 3xx, is continued natively without a
 * handler (checked against Playwright 1.64.1, Task 12c). So for a top-level
 * GET to an allowlisted URL whose request has no `Origin` or an allowlisted
 * one, the handler walks the chain itself, one
 * `route.fetch({ maxRedirects: 0 })` per hop, and checks each `Location`
 * before requesting it: a foreign hop is aborted and its host never contacted.
 * Chrome sends no `Origin` on a GET navigation, so that includes a GET a
 * foreign frame started (a `target=_top` link). route.fetch would send every
 * cookie of the context's jar, SameSite=Strict and partitioned ones too, so
 * the walk sends only what Chrome's own `cookie` header on the paused request
 * allowed (walkCookieHeader): Lax and None cookies always, a Strict or
 * partitioned one only if Chrome sent that same name=value (carry-over
 * (bx)(5), owner ruling 2026-11-19). This trusts that the route handler's
 * `cookie` header is Chrome's SameSite-filtered one (true on Chrome 157 and
 * Playwright 1.65.1); with no such header no Strict or partitioned cookie is
 * sent. The walk still sends no Sec-Fetch-Site.
 *
 * route.fetch takes the context's cookies but enforces no SameSite and sends
 * no Sec-Fetch-* headers, so a non-GET navigation (a foreign frame's form POST
 * with target=_top, say) must keep Chrome's own request: every non-GET, and
 * every GET carrying a foreign `Origin` header, is continued natively, as
 * before Task 12c (fix round 1, adversarial IMP-1).
 *
 * A hop whose route.fetch fails for a reason other than the deadline (Node's
 * network stack, not Chrome's) falls back to Chrome's own request,
 * `route.continue()`; never after a foreign `Location`, which aborts first
 * (12c MIN-7). The deadline aborts with `timedout`.
 */
export async function guardRoute(route: Route): Promise<void> {
  const req = route.request();
  let isTopLevelNav = false;
  try {
    isTopLevelNav = req.isNavigationRequest() && req.frame().parentFrame() === null;
  } catch {
    // frame() throws for service-worker requests and detached frames —
    // neither can change the page the tools scrape, so let them through.
  }
  if (!isTopLevelNav) return route.continue();
  if (!isAllowedPageUrl(req.url())) return route.abort("blockedbyclient");
  const origin = req.headers()["origin"];
  if (req.method() !== "GET" || (origin !== undefined && !isAllowedPageUrl(origin))) {
    return route.continue();
  }
  try {
    await followAllowedRedirects(route);
  } catch {
    // Anything else that fails (a page closed mid-chain, a fulfill or abort
    // that throws) fails the navigation; the request is never left pending
    // and never falls back to Chrome's own request.
    await route.abort("failed").catch(() => {});
  }
}

async function followAllowedRedirects(route: Route): Promise<void> {
  const req = route.request();
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  let url = req.url();
  // Read once, outside the try around route.fetch: a throw (a closed page)
  // aborts via guardRoute's catch and never falls back to Chrome's request.
  const context = req.frame().page().context();
  // What Chrome itself allowed to send on this navigation (its SameSite rules).
  const chromeCookie = req.headers()["cookie"];
  // Each hop takes its cookies from the context's jar for that hop's URL,
  // filtered by walkCookieHeader, never a header carried over from another hop
  // or host. `cookie` is always set (even ""): Playwright refills the jar only
  // when the header is absent.
  const headers = withoutHeaders(req.headers(), ["cookie", "host"]);

  for (let redirects = 0; ; redirects++) {
    // Looked up before `remaining` is computed, so the fetch timeout never
    // overruns the shared deadline by the lookup time (a throw still aborts).
    const cookie = walkCookieHeader(await context.cookies(url), chromeCookie);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return route.abort("timedout");
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch({ url, method: "GET", headers: { ...headers, cookie }, maxRedirects: 0, timeout: remaining });
    } catch (err) {
      // The deadline fails the navigation, as goto's own timeout would.
      if (Date.now() >= deadline || (err instanceof Error && err.name === "TimeoutError")) return route.abort("timedout");
      // Any other failure is Node's network stack, not Chrome's (a bot rule
      // keyed on its TLS fingerprint, a mandatory proxy, a CA only the OS
      // store has): Chrome loads the original request itself, as before
      // Task 12c, and follows its redirects natively (12c MIN-7, carry-over
      // (bx)(4)). Reached only while every Location so far was allowlisted:
      // a foreign one returns an abort below and is never fetched, so the
      // walk never falls back after seeing one. The post-load allowlist
      // checks still apply.
      return route.continue();
    }
    const status = response.status();
    const location = utf8Header(response.headers()["location"]);
    if (!REDIRECT_STATUSES.has(status) || !location) {
      if (redirects === 0) return route.fulfill({ response });
      await response.dispose();
      // Answer with a redirect to the checked final URL so the page's URL is
      // right. The browser fetches that URL again natively (carry-over (bx)).
      return route.fulfill({ status: 302, headers: { location: url } });
    }
    await response.dispose();

    let next: string;
    try {
      next = new URL(location, url).href;
    } catch {
      return route.abort("blockedbyclient");
    }
    if (!isAllowedPageUrl(next) || redirects + 1 > MAX_REDIRECT_HOPS) {
      return route.abort("blockedbyclient");
    }
    url = next;
  }
}

/**
 * The `Cookie` header for one walked hop: every Lax or None non-partitioned
 * cookie of the jar (a cookie without sameSite counts as Lax), plus a Strict
 * or partitioned one only when the same `name=value` is in Chrome's own cookie
 * header for the first request. No Chrome header means no such cookie (fail
 * closed). Returns "" when nothing is allowed, never undefined.
 */
export function walkCookieHeader(
  jar: ReadonlyArray<{ name: string; value: string; sameSite?: string; partitionKey?: string }>,
  chromeCookieHeader: string | undefined,
): string {
  // Matched by name=value only: the jar is already per-URL, so domain and path are pre-filtered.
  const chromeSent = new Set((chromeCookieHeader ?? "").split(";").map((c) => c.trim()).filter(Boolean));
  return jar
    .filter((c) => (c.sameSite !== "Strict" && !c.partitionKey) || chromeSent.has(`${c.name}=${c.value}`))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * A header value Node handed over as latin1 (one char per byte), read as the
 * UTF-8 its bytes are, as Chrome and Playwright's own redirect code read a
 * Location (12c MIN-8). A value with a char above U+00FF was decoded already.
 */
function utf8Header(value: string | undefined): string | undefined {
  if (value === undefined || !/^[\x00-\xff]*$/.test(value)) return value;
  return Buffer.from(value, "latin1").toString("utf8");
}

function withoutHeaders(headers: Record<string, string>, names: string[]): Record<string, string> {
  const drop = new Set(names);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !drop.has(name.toLowerCase())));
}

// Leave a page that is off the allowlist, so the shared authenticated page
// never stays on (and keeps running the JS of) a foreign site after a refusal.
// Best effort: its own failure is swallowed, never printed, and the caller's
// refusal or original error is what the client sees.
async function leaveForeignPage(page: Page): Promise<void> {
  const url = page.url();
  if (url === "about:blank" || isAllowedPageUrl(url)) return;
  await page.goto("about:blank").catch(() => {});
}

// Refuse to act on the current page unless it is an allowlisted DDB page.
// about:blank (nothing loaded yet, or a page left after a refusal) is not one.
function assertActionablePage(page: Page): void {
  const url = page.url();
  if (url === "about:blank") {
    throw new Error("No page is loaded yet — call ddb_navigate first.");
  }
  if (!isAllowedPageUrl(url)) {
    throw new Error(
      `Current page (${foreignPageLabel(url)}) is outside the dndbeyond.com allowlist — refusing to act on it. ` +
      `Use ddb_navigate to load a D&D Beyond page.`
    );
  }
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
  // Bind this authenticated browser action to the current generation so a
  // logout/replacement mid-navigation refuses to return account-derived content.
  const snapshot = captureSession();
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

  // "load" is the success signal: a page that has loaded is a success even if
  // D&D Beyond keeps a connection open (analytics, polling) and networkidle
  // never comes. The networkidle wait below is best-effort only.
  try {
    await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
  } catch (err) {
    // A load that fails or times out after a redirect off-site must not leave
    // the shared page on the foreign site.
    await leaveForeignPage(page);
    throw err;
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

  // The route guard checks the redirect hops it fetches, but the browser's
  // repeat request for a chain's final URL, and the hops of a navigation it
  // leaves to Chrome, are hops no handler sees (carry-over (bx)). Re-check
  // where the page actually ended up, as getCurrentPageContent does, and
  // leave the foreign page before refusing.
  const finalUrl = page.url();
  if (!isAllowedPageUrl(finalUrl)) {
    await leaveForeignPage(page);
    throw new Error(
      `Navigation ended on ${foreignPageLabel(finalUrl)}, outside the dndbeyond.com allowlist — refusing to return its content. ` +
      `Use ddb_navigate with a D&D Beyond page URL.`
    );
  }

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

  // Refresh authority before returning account-derived scraped content.
  assertSessionCurrent(snapshot);

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
  const snapshot = captureSession();
  const page = await getPage(context);
  await ensureNavigationGuard(context);
  // Never fill, click, wait on or capture a page that isn't an allowlisted
  // DDB page (a foreign page could take a typed value anywhere).
  assertActionablePage(page);

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
      const afterClickUrl = page.url();
      if (!isAllowedPageUrl(afterClickUrl)) {
        await leaveForeignPage(page);
        throw new Error(
          `Click triggered a navigation away from dndbeyond.com (to ${foreignPageLabel(afterClickUrl)}) — ` +
          `it was blocked and no cross-origin content will be returned. ` +
          `Use ddb_navigate to load a D&D Beyond page.`
        );
      }
      // Refresh authority before reporting an authenticated action complete.
      assertSessionCurrent(snapshot);
      return `Clicked element: ${selector}`;
    }

    case "fill": {
      if (value === undefined) throw new Error("'value' is required for fill action.");
      await page.locator(selector).first().fill(value);
      await page.waitForTimeout(500);
      assertSessionCurrent(snapshot);
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
  const snapshot = captureSession();
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
      `Current page (${foreignPageLabel(url)}) is outside the dndbeyond.com allowlist — refusing to return its content. ` +
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
  // Refresh authority before returning account-derived scraped content.
  assertSessionCurrent(snapshot);
  // See note in navigate() — wrap scraped content so untrusted page text is
  // visibly separated from trusted tool output.
  return `Current URL: ${url}\n\n${wrapUntrusted(truncated)}`;
}
