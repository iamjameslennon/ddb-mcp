import { describe, it, expect } from "vitest";
import { navigate, interact, getCurrentPageContent } from "../src/tools/navigate.js";

// Lightweight Playwright doubles — enough surface for getPage(),
// ensureNavigationGuard(), and the guard logic in the three tools. No real
// Chromium: these assert the decision logic (host allowlist, post-click URL
// re-validation, scrape refusal), not browser behavior. The actual
// network-layer route abort needs a real browser and is verified separately.
type Ctx = Parameters<typeof navigate>[0];

interface FakeOpts {
  url?: string;            // current page url
  content?: string;        // what page.evaluate() returns
  urlAfterClick?: string;  // url the page lands on after a click, if any
}

function makeFake(opts: FakeOpts = {}) {
  let currentUrl = opts.url ?? "about:blank";
  const calls = { goto: [] as string[], routes: 0, clicked: 0, filled: [] as string[] };

  const locator = {
    filter: () => locator,
    first: () => locator,
    waitFor: async () => {},
    click: async () => {
      calls.clicked++;
      if (opts.urlAfterClick !== undefined) currentUrl = opts.urlAfterClick;
    },
    fill: async (v: string) => { calls.filled.push(v); },
  };

  const page = {
    url: () => currentUrl,
    goto: async (u: string) => { calls.goto.push(u); currentUrl = u; },
    evaluate: async () => opts.content ?? "",
    waitForTimeout: async () => {},
    locator: () => locator,
  };

  const context = {
    pages: () => [page],
    newPage: async () => page,
    route: async () => { calls.routes++; },
  };

  return { context: context as unknown as Ctx, calls };
}

describe("navigate() host allowlist", () => {
  it("rejects non-dndbeyond hosts", async () => {
    const { context } = makeFake();
    await expect(navigate(context, "https://evil.com/")).rejects.toThrow(/dndbeyond\.com/);
  });

  it("rejects http (non-https) even on an allowed host", async () => {
    const { context } = makeFake();
    await expect(navigate(context, "http://www.dndbeyond.com/")).rejects.toThrow(/dndbeyond\.com/);
  });

  it("rejects a credential-prefix lookalike host", async () => {
    const { context } = makeFake();
    await expect(navigate(context, "https://www.dndbeyond.com@evil.com/")).rejects.toThrow(
      /dndbeyond\.com/
    );
  });

  it("rejects malformed URLs", async () => {
    const { context } = makeFake();
    await expect(navigate(context, "not a url")).rejects.toThrow(/Invalid URL/);
  });

  it("scrapes an allowed page and wraps the content as untrusted", async () => {
    const { context, calls } = makeFake({ content: "Aboleth stat block" });
    const out = await navigate(context, "https://www.dndbeyond.com/monsters/16762-aboleth");
    expect(out).toContain("URL: https://www.dndbeyond.com/monsters/16762-aboleth");
    expect(out).toContain("<untrusted_dndbeyond_content>");
    expect(out).toContain("Aboleth stat block");
    // The network-layer guard was installed before navigating
    expect(calls.routes).toBe(1);
  });
});

describe("getCurrentPageContent() scrape refusal", () => {
  it("refuses when no page is loaded (about:blank)", async () => {
    const { context } = makeFake({ url: "about:blank" });
    await expect(getCurrentPageContent(context)).rejects.toThrow(/call ddb_navigate first/);
  });

  it("refuses to scrape a page outside the allowlist", async () => {
    const { context } = makeFake({ url: "https://evil.com/phish" });
    await expect(getCurrentPageContent(context)).rejects.toThrow(/outside the dndbeyond\.com allowlist/);
  });

  it("refuses to scrape a data: URL (bypasses the network guard)", async () => {
    const { context } = makeFake({ url: "data:text/html,<h1>injected</h1>" });
    await expect(getCurrentPageContent(context)).rejects.toThrow(/outside the dndbeyond\.com allowlist/);
  });

  it("returns wrapped content for an allowlisted page", async () => {
    const { context } = makeFake({ url: "https://www.dndbeyond.com/characters/1", content: "Sheet text" });
    const out = await getCurrentPageContent(context);
    expect(out).toContain("Current URL: https://www.dndbeyond.com/characters/1");
    expect(out).toContain("<untrusted_dndbeyond_content>");
    expect(out).toContain("Sheet text");
  });
});

describe("interact() guards", () => {
  it("rejects an unsafe selector before touching the page", async () => {
    const { context, calls } = makeFake({ url: "https://www.dndbeyond.com/x" });
    await expect(interact(context, "click", "xpath=//button")).rejects.toThrow(/disallowed syntax/);
    expect(calls.clicked).toBe(0);
  });

  it("throws if a click navigates the page off the allowlist", async () => {
    const { context, calls } = makeFake({
      url: "https://www.dndbeyond.com/x",
      urlAfterClick: "https://evil.com/",
    });
    await expect(interact(context, "click", "button")).rejects.toThrow(/navigation away from dndbeyond\.com/);
    expect(calls.clicked).toBe(1); // the click happened; re-validation caught the result
  });

  it("succeeds on a click that stays on the allowlist", async () => {
    const { context } = makeFake({ url: "https://www.dndbeyond.com/x" });
    const out = await interact(context, "click", "button:has-text(\"Spells\")");
    expect(out).toContain("Clicked element");
  });

  it("fills a field and reports the value field name", async () => {
    const { context, calls } = makeFake({ url: "https://www.dndbeyond.com/x" });
    const out = await interact(context, "fill", "input[name=q]", "fireball");
    expect(out).toContain("Filled");
    expect(calls.filled).toEqual(["fireball"]);
  });

  it("requires a value for fill", async () => {
    const { context } = makeFake({ url: "https://www.dndbeyond.com/x" });
    await expect(interact(context, "fill", "input[name=q]")).rejects.toThrow(/'value' is required/);
  });
});
