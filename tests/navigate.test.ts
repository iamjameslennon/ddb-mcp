import { describe, it, expect } from "vitest";
import { isAllowedPageUrl } from "../src/tools/navigate.js";

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
