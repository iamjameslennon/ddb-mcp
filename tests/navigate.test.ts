import { describe, it, expect } from "vitest";
import { isAllowedPageUrl, assertSafeSelector } from "../src/tools/navigate.js";

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
