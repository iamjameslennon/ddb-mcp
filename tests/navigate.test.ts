import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAllowedPageUrl, assertSafeSelector, navigate, getCurrentPageContent } from "../src/tools/navigate.js";

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

  // (bs) round 3: a page operation that rejects because a session change closed the
  // context mid-flight reports the session change, not Playwright's own error.
  describe("a page operation cut off mid-flight", () => {
    const CLOSED = "Target page, context or browser has been closed";
    type Op = "goto" | "evaluate" | "click" | "fill" | "screenshot";
    /** A fake whose `op` runs `during()` (a session flip, or nothing) and then rejects as Playwright does. */
    function makeFailing(op: Op, during: () => void) {
      const fail = async (): Promise<never> => { during(); throw new Error(CLOSED); };
      const ok = async () => {};
      const locator = {
        filter: () => locator, first: () => locator,
        waitFor: ok,
        click: op === "click" ? fail : ok,
        fill: op === "fill" ? fail : ok,
      };
      const page = {
        url: () => "https://www.dndbeyond.com/characters/1",
        goto: op === "goto" ? fail : ok,
        waitForLoadState: ok,
        evaluate: op === "evaluate" ? fail : async () => "TEXT",
        waitForTimeout: ok,
        screenshot: op === "screenshot" ? fail : async () => Buffer.from(""),
        locator: () => locator,
      };
      const context = { pages: () => [page], newPage: async () => page, route: async () => {} };
      return context as unknown as Parameters<typeof nav.navigate>[0];
    }
    const run = (op: Op, context: Parameters<typeof nav.navigate>[0]) =>
      op === "goto" ? nav.navigate(context, "https://www.dndbeyond.com/characters/1")
        : op === "evaluate" ? nav.getCurrentPageContent(context)
          : op === "click" ? nav.interact(context, "click", "button")
            : op === "fill" ? nav.interact(context, "fill", 'input[name="search"]', "goblin")
              : nav.interact(context, "screenshot", "body");
    const OPS: Op[] = ["goto", "evaluate", "click", "fill", "screenshot"];

    it.each(OPS)("%s rejecting after a session change throws SessionChangedError", async op => {
      setSessionFile(sessionJson("SECRET_A"));
      sf.hasValidSession();
      await expect(run(op, makeFailing(op, () => setSessionFile(sessionJson("SECRET_B"))))).rejects.toThrow(sf.SessionChangedError);
      if (op === "screenshot") expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it.each(OPS)("%s rejecting with no session change keeps Playwright's own error", async op => {
      setSessionFile(sessionJson("SECRET_A"));
      sf.hasValidSession();
      const err = await run(op, makeFailing(op, () => {})).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(sf.SessionChangedError);
      expect((err as Error).message).toBe(CLOSED);
    });
  });

  // Carry-over (bs): after ddb_logout the browser tools work signed out, as on
  // a fresh logged-out server, instead of refusing until the next ddb_login.
  describe("after ddb_logout (bs)", () => {
    async function logout(): Promise<void> {
      setSessionFile(sessionJson("SECRET_A"));
      sf.hasValidSession();
      const ss = await import("../src/session-state.js");
      await ss.revokeSession();
      setSessionFile(null);
    }
    const URL_1 = "https://www.dndbeyond.com/monsters/16762-aboleth";

    it("navigate() returns the page", async () => {
      await logout();
      const out = await nav.navigate(makeFake(URL_1, () => {}), URL_1);
      expect(out).toContain("SECRET_SCRAPE");
    });

    it("getCurrentPageContent() returns the page", async () => {
      await logout();
      const out = await nav.getCurrentPageContent(makeFake(URL_1, () => {}));
      expect(out).toContain("SECRET_SCRAPE");
    });

    it("interact() fills a field", async () => {
      await logout();
      const fake = makeFake(URL_1, () => {}) as unknown as { pages: () => Array<Record<string, unknown>> };
      const page = fake.pages()[0];
      const loc = { filter: () => loc, first: () => loc, fill: async () => {}, waitFor: async () => {}, click: async () => {} };
      page.locator = () => loc;
      await expect(nav.interact(fake as never, "fill", 'input[name="search"]', "goblin")).resolves.toMatch(/Filled/);
    });

    // Codex review: the context was obtained signed in, then ddb_logout landed
    // before the tool ran. Bound to the context's own snapshot, the call refuses
    // before any page action, not only at the end.
    describe("a logout between getting the signed-in context and using it", () => {
      async function signedInThenLogout() {
        setSessionFile(sessionJson("SECRET_A"));
        sf.hasValidSession();
        const bound = sf.captureSession();
        expect(bound.state.kind).toBe("authenticated");
        const ss = await import("../src/session-state.js");
        await ss.revokeSession();
        setSessionFile(null);
        let touched = 0;
        const context = makeFake(URL_1, () => { touched++; });
        const page = (context as unknown as { pages: () => Array<Record<string, unknown>> }).pages()[0];
        page.goto = async () => { touched++; };
        page.screenshot = async () => { touched++; };
        return { bound, context, touched: () => touched };
      }

      it("navigate() refuses without loading the page", async () => {
        const { bound, context, touched } = await signedInThenLogout();
        await expect(nav.navigate(context, URL_1, bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });

      it("getCurrentPageContent() refuses without reading the page", async () => {
        const { bound, context, touched } = await signedInThenLogout();
        await expect(nav.getCurrentPageContent(context, bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });

      it("interact() refuses a screenshot without taking it", async () => {
        const { bound, context, touched } = await signedInThenLogout();
        await expect(nav.interact(context, "screenshot", "body", undefined, bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });
    });

    it("a session change during a screenshot refuses it and writes no file (Codex review)", async () => {
      setSessionFile(sessionJson("SECRET_A"));
      sf.hasValidSession();
      const context = makeFake(URL_1, () => {});
      const page = (context as unknown as { pages: () => Array<Record<string, unknown>> }).pages()[0];
      page.screenshot = async () => { setSessionFile(sessionJson("SECRET_B")); return Buffer.from("png"); };
      await expect(nav.interact(context, "screenshot", "body")).rejects.toThrow(sf.SessionChangedError);
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it("a screenshot with no session change is written to ~/Downloads", async () => {
      await logout();
      const context = makeFake(URL_1, () => {});
      const page = (context as unknown as { pages: () => Array<Record<string, unknown>> }).pages()[0];
      page.screenshot = async (opts?: { path?: string }) => { expect(opts?.path).toBeUndefined(); return Buffer.from("png"); };
      const out = await nav.interact(context, "screenshot", "body");
      expect(out).toMatch(/^Screenshot saved to: .*ddb-screenshot-\d+\.png$/);
      expect(fsMock.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/Downloads.*ddb-screenshot-\d+\.png$/), Buffer.from("png"));
    });

    // Codex review round 2: a session change during getPage()/the guard setup,
    // after the entry check, must still stop the first page operation.
    describe("a session change while the page and guard are being set up", () => {
      function swapDuringGuard() {
        setSessionFile(sessionJson("SECRET_A"));
        sf.hasValidSession();
        const bound = sf.captureSession();
        let touched = 0;
        const context = makeFake(URL_1, () => { touched++; }) as unknown as Record<string, unknown> & { pages: () => Array<Record<string, unknown>> };
        context.route = async () => { setSessionFile(sessionJson("SECRET_B")); };
        const page = context.pages()[0];
        page.goto = async () => { touched++; };
        const loc = { filter: () => loc, first: () => loc, fill: async () => { touched++; }, waitFor: async () => {}, click: async () => { touched++; } };
        page.locator = () => loc;
        page.screenshot = async () => { touched++; return Buffer.from("png"); };
        return { bound, context: context as never, touched: () => touched };
      }

      it("navigate() never starts the load", async () => {
        const { bound, context, touched } = swapDuringGuard();
        await expect(nav.navigate(context, URL_1, bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });

      it("interact() never fills", async () => {
        const { bound, context, touched } = swapDuringGuard();
        await expect(nav.interact(context, "fill", 'input[name="search"]', "goblin", bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });

      it("interact() never clicks", async () => {
        const { bound, context, touched } = swapDuringGuard();
        await expect(nav.interact(context, "click", "button", undefined, bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });

      it("the session change wins over page-state errors (Codex review round 3)", async () => {
        for (const run of [
          (c: never, b: never) => nav.getCurrentPageContent(c, b),
          (c: never, b: never) => nav.interact(c, "screenshot", "body", undefined, b),
        ]) {
          const { bound, context } = swapDuringGuard();
          ((context as unknown as { pages: () => Array<Record<string, unknown>> }).pages()[0]).url = () => "about:blank";
          await expect(run(context, bound as never)).rejects.toThrow(sf.SessionChangedError);
        }
        const { bound, context } = swapDuringGuard();
        await expect(nav.navigate(context, "not a url", bound)).rejects.toThrow(sf.SessionChangedError);
      });

      it("getCurrentPageContent() never reads the page", async () => {
        const { bound, context, touched } = swapDuringGuard();
        await expect(nav.getCurrentPageContent(context, bound)).rejects.toThrow(sf.SessionChangedError);
        expect(touched()).toBe(0);
      });
    });

    it("a sign-in landing mid-navigate still refuses the signed-out scrape", async () => {
      await logout();
      const context = makeFake(URL_1, () => {
        // ddb_login saves a session: the revoke is cleared and the generation moves.
        setSessionFile(sessionJson("SECRET_B"));
        sf.invalidateSessionCache();
      });
      await expect(nav.navigate(context, URL_1)).rejects.toThrow(sf.SessionChangedError);
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// What the page tools report (regression run 2026-11-27): ddb_navigate names
// the page it ended on after redirects, as ddb_get_page does, and lines that
// hold only invisible characters (D&D Beyond's /sources list puts a U+200B
// line after almost every book) are dropped from the page text.
// ─────────────────────────────────────────────────────────────────────────────
describe("page text and the reported URL", () => {
  const PAGE_TEXT = "Library\n​\nPlayer's Handbook\n ​ \n‌‍⁠﻿\nMonster Manual\n\nDungeon Master's Guide 👨‍👩‍👧";
  function makeRedirectFake(finalUrl: string) {
    let currentUrl = "about:blank";
    const page = {
      url: () => currentUrl,
      goto: async () => { currentUrl = finalUrl; },
      waitForLoadState: async () => {},
      evaluate: async () => PAGE_TEXT,
    };
    const context = { pages: () => [page], newPage: async () => page, route: async () => {} };
    return context as unknown as Parameters<typeof navigate>[0];
  }

  it("ddb_navigate reports the final URL after a redirect", async () => {
    const out = await navigate(makeRedirectFake("https://www.dndbeyond.com/en/library"), "https://www.dndbeyond.com/sources");
    expect(out).toMatch(/^URL: https:\/\/www\.dndbeyond\.com\/en\/library\n/);
  });

  it("drops invisible-only lines and keeps the rest, blank lines and emoji joiners included", async () => {
    const context = makeRedirectFake("https://www.dndbeyond.com/en/library");
    const expected = "Library\nPlayer's Handbook\nMonster Manual\n\nDungeon Master's Guide 👨‍👩‍👧";
    expect(await navigate(context, "https://www.dndbeyond.com/sources")).toContain(expected);
    expect(await getCurrentPageContent(context)).toContain(expected);
  });
});
