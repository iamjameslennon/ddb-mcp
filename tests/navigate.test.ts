import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAllowedPageUrl, assertSafeSelector, navigate } from "../src/tools/navigate.js";

// Stable fs mock so the transition tests below can flip the session file and
// drive a REAL session-state transition through navigate()'s authority checks.
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  chmodSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("fs", () => fsMock);

describe("isAllowedPageUrl", () => {
  it("allows https URLs on www.dndbeyond.com", () => {
    expect(isAllowedPageUrl("https://www.dndbeyond.com/monsters/16762-aboleth")).toBe(true);
    expect(isAllowedPageUrl("https://www.dndbeyond.com/")).toBe(true);
  });

  it("allows the apex domain", () => {
    expect(isAllowedPageUrl("https://dndbeyond.com/characters")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(isAllowedPageUrl("https://example.com/")).toBe(false);
    expect(isAllowedPageUrl("https://evil.com/?ref=dndbeyond.com")).toBe(false);
  });

  it("rejects lookalike and subdomain-confusion hosts", () => {
    expect(isAllowedPageUrl("https://www.dndbeyond.com.evil.com/")).toBe(false);
    expect(isAllowedPageUrl("https://wwwdndbeyond.com/")).toBe(false);
    // Non-allowlisted DDB subdomains are intentionally rejected too
    expect(isAllowedPageUrl("https://forums.dndbeyond.com/")).toBe(false);
  });

  it("rejects credential-prefix tricks", () => {
    expect(isAllowedPageUrl("https://www.dndbeyond.com@evil.com/")).toBe(false);
  });

  it("rejects non-https protocols", () => {
    expect(isAllowedPageUrl("http://www.dndbeyond.com/")).toBe(false);
    expect(isAllowedPageUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedPageUrl("data:text/html,<h1>hi</h1>")).toBe(false);
    expect(isAllowedPageUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects about:blank, error pages, and malformed URLs", () => {
    expect(isAllowedPageUrl("about:blank")).toBe(false);
    expect(isAllowedPageUrl("chrome-error://chromewebdata/")).toBe(false);
    expect(isAllowedPageUrl("not a url")).toBe(false);
    expect(isAllowedPageUrl("")).toBe(false);
  });
});

describe("assertSafeSelector", () => {
  it("allows ordinary CSS and text-locator selectors", () => {
    for (const sel of [
      'button:has-text("Spells")',
      '[data-testid="signedInUserButton"]',
      '[role="tab"]:has-text("Inventory")',
      ".c-site-header a.nav-link",
      "#content > div.page",
      'input[name="search"]',
    ]) {
      expect(() => assertSafeSelector(sel)).not.toThrow();
    }
  });

  it("rejects XPath engine prefixes", () => {
    expect(() => assertSafeSelector("xpath=//button")).toThrow(/disallowed syntax/);
    expect(() => assertSafeSelector("xpath/html/body")).toThrow(/disallowed syntax/);
    // case-insensitive
    expect(() => assertSafeSelector("XPath=//a")).toThrow(/disallowed syntax/);
  });

  it("rejects Playwright non-CSS engine prefixes", () => {
    expect(() => assertSafeSelector("id=submit")).toThrow(/disallowed syntax/);
    expect(() => assertSafeSelector("data-testid=submit")).toThrow(/disallowed syntax/);
    expect(() => assertSafeSelector("internal:role=button")).toThrow(/disallowed syntax/);
  });

  it("rejects frame-piercing / chaining via >>", () => {
    expect(() => assertSafeSelector("div >> button")).toThrow(/disallowed syntax/);
    expect(() => assertSafeSelector(">>button")).toThrow(/disallowed syntax/);
  });

  it("rejects javascript: and Playwright-internal hooks", () => {
    expect(() => assertSafeSelector('a[href="javascript:alert(1)"]')).toThrow(/disallowed syntax/);
    expect(() => assertSafeSelector("__playwright_target__")).toThrow(/disallowed syntax/);
    expect(() => assertSafeSelector("button >> internal:control=enter-frame >> _evaluate")).toThrow(
      /disallowed syntax/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// navigate()/getCurrentPageContent() refresh authority before returning
// account-derived scraped content: a session change mid-scrape must throw.
// ─────────────────────────────────────────────────────────────────────────────
describe("navigate refuses scraped content across a session transition", () => {
  let nav: typeof import("../src/tools/navigate.js");
  let sf: typeof import("../src/session-fetch.js");

  function sessionJson(v: string): string {
    return JSON.stringify({
      cookies: [{
        name: "CobaltSession", value: v, domain: ".dndbeyond.com", path: "/",
        expires: Date.now() / 1000 + 3600, httpOnly: true, secure: true,
      }],
    });
  }
  function setSessionFile(content: string | null): void {
    if (content === null) { fsMock.existsSync.mockReturnValue(false); return; }
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(content);
  }

  // A fake Playwright context whose page.evaluate() flips the session file to a
  // different account mid-scrape (simulating a concurrent logout/replacement).
  function makeFake(url: string, onEvaluate: () => void) {
    const page = {
      url: () => url,
      goto: async () => {},
      waitForLoadState: async () => {},
      evaluate: async () => { onEvaluate(); return "SECRET_SCRAPE"; },
      waitForTimeout: async () => {},
      locator: () => ({ filter: () => page.locator(), first: () => page.locator() }),
    };
    const context = { pages: () => [page], newPage: async () => page, route: async () => {} };
    return context as unknown as Parameters<typeof nav.navigate>[0];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReset();
    fsMock.readFileSync.mockReset();
    vi.resetModules();
    nav = await import("../src/tools/navigate.js");
    sf = await import("../src/session-fetch.js");
  });

  it("throws SessionChangedError when the account changes during navigate()", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    sf.hasValidSession(); // establish account A as the observed baseline

    const context = makeFake(
      "https://www.dndbeyond.com/characters/1",
      () => setSessionFile(sessionJson("SECRET_B")),
    );

    await expect(
      nav.navigate(context, "https://www.dndbeyond.com/characters/1"),
    ).rejects.toThrow(sf.SessionChangedError);
  });

  it("throws SessionChangedError when the account changes during getCurrentPageContent()", async () => {
    setSessionFile(sessionJson("SECRET_A"));
    sf.hasValidSession();

    const context = makeFake(
      "https://www.dndbeyond.com/characters/1",
      () => setSessionFile(null),
    );

    await expect(nav.getCurrentPageContent(context)).rejects.toThrow(sf.SessionChangedError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A loaded page is a success (F8). navigate() waits for "load"; networkidle is
// a best-effort extra wait whose timeout must not fail the call.
// ─────────────────────────────────────────────────────────────────────────────
describe("navigate() counts a loaded page as a success", () => {
  function makeLoadFake(opts: { networkidleTimesOut: boolean; gotoError?: Error }) {
    const gotoCalls: Array<{ url: string; options: unknown }> = [];
    const loadStateCalls: Array<{ state: string; options: unknown }> = [];
    let currentUrl = "about:blank";
    const page = {
      url: () => currentUrl,
      goto: async (url: string, options: unknown) => {
        gotoCalls.push({ url, options });
        if (opts.gotoError) throw opts.gotoError;
        currentUrl = url;
      },
      waitForLoadState: async (state: string, options: unknown) => {
        loadStateCalls.push({ state, options });
        if (opts.networkidleTimesOut) throw new Error("Timeout 5000ms exceeded.");
      },
      evaluate: async () => "Aboleth stat block",
      waitForTimeout: async () => {},
      locator: () => ({ filter: () => page.locator(), first: () => page.locator() }),
    };
    const context = { pages: () => [page], newPage: async () => page, route: async () => {} };
    return { context: context as unknown as Parameters<typeof navigate>[0], gotoCalls, loadStateCalls };
  }

  it("navigate returns the page when networkidle never comes", async () => {
    const { context, loadStateCalls } = makeLoadFake({ networkidleTimesOut: true });
    const out = await navigate(context, "https://www.dndbeyond.com/monsters/16762-aboleth");
    expect(out).toContain("URL: https://www.dndbeyond.com/monsters/16762-aboleth");
    expect(out).toContain("<untrusted_dndbeyond_content>");
    expect(out).toContain("Aboleth stat block");
    expect(loadStateCalls).toEqual([{ state: "networkidle", options: { timeout: 5000 } }]);
  });

  it("navigate waits for load, not networkidle, and keeps the 30 s deadline", async () => {
    const { context, gotoCalls } = makeLoadFake({ networkidleTimesOut: false });
    await navigate(context, "https://www.dndbeyond.com/monsters/16762-aboleth");
    expect(gotoCalls).toEqual([
      { url: "https://www.dndbeyond.com/monsters/16762-aboleth", options: { waitUntil: "load", timeout: 30000 } },
    ]);
  });

  it("a failed load (goto rejects) still fails the call", async () => {
    const { context } = makeLoadFake({
      networkidleTimesOut: false,
      gotoError: new Error("page.goto: Timeout 30000ms exceeded."),
    });
    await expect(
      navigate(context, "https://www.dndbeyond.com/monsters/16762-aboleth"),
    ).rejects.toThrow(/Timeout 30000ms exceeded/);
  });
});
