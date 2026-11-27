import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F8 (Task 12): the four browser tools' catch blocks reply and log with an
 * error's safe first line only. Playwright's "Call log:" and "Browser logs:"
 * blocks (and the Chrome path they print) must reach neither the client nor
 * stderr. The tool bodies are stubbed; the registrations are real.
 */

const SAFE_ERROR_PREFIX = "page.goto: Timeout 30000ms exceeded.";
const LEAKY_MESSAGE =
  `${SAFE_ERROR_PREFIX}\n` +
  "Call log:\n" +
  "  - navigating to \"https://www.dndbeyond.com/monsters\", waiting until \"load\"\n" +
  "Browser logs:\n" +
  "<launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x\n";

// The context and the snapshot getBoundContext hands back together (carry-over (bs)).
const BOUND = vi.hoisted(() => ({ context: { bound: "context" }, snapshot: { generation: 7, state: { kind: "anonymous" } } }));

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  interact: vi.fn(),
  getCurrentPageContent: vi.fn(),
  closeBrowser: vi.fn(),
}));

vi.mock("../src/tools/navigate.js", async (orig) => {
  const real = await orig<typeof import("../src/tools/navigate.js")>();
  return {
    ...real,
    navigate: mocks.navigate,
    interact: mocks.interact,
    getCurrentPageContent: mocks.getCurrentPageContent,
  };
});

vi.mock("../src/browser.js", async (orig) => {
  const real = await orig<typeof import("../src/browser.js")>();
  return {
    ...real,
    getBrowser: vi.fn(async () => ({})),
    getContext: vi.fn(async () => ({})),
    getBoundContext: vi.fn(async () => ({ context: BOUND.context, snapshot: BOUND.snapshot })),
    closeBrowser: mocks.closeBrowser,
  };
});

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { server } from "../src/server.js";

let client: Client;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  mocks.navigate.mockReset();
  mocks.interact.mockReset();
  mocks.getCurrentPageContent.mockReset();
  mocks.closeBrowser.mockReset();
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
  stderr.mockRestore();
});

function textOf(result: CallToolResult): string {
  return result.content.map(c => (c.type === "text" ? c.text : "")).join("\n");
}

function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
}

function loggedText(): string {
  return stderr.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

function expectNoPlaywrightLog(text: string): void {
  for (const leak of ["Call log", "Browser logs", "<launching>", "/Applications"]) {
    expect(text).not.toContain(leak);
  }
}

describe("browser tool errors print only the safe first line (F8)", () => {
  it("ddb_navigate's error reply and stderr line have the first line only", async () => {
    mocks.navigate.mockRejectedValue(new Error(LEAKY_MESSAGE));
    const result = await call("ddb_navigate", { url: "https://www.dndbeyond.com/monsters" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Navigation failed: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(textOf(result));
    expect(loggedText()).toContain("ddb_navigate error: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(loggedText());
  });

  it("ddb_interact's error reply and stderr line have the first line only", async () => {
    mocks.interact.mockRejectedValue(new Error(LEAKY_MESSAGE));
    const result = await call("ddb_interact", { action: "screenshot", selector: "body" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Interaction failed: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(textOf(result));
    expect(loggedText()).toContain("ddb_interact error: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(loggedText());
  });

  it("ddb_get_page's error reply and stderr line have the first line only", async () => {
    mocks.getCurrentPageContent.mockRejectedValue(new Error(LEAKY_MESSAGE));
    const result = await call("ddb_get_page", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Failed to get page content: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(textOf(result));
    expect(loggedText()).toContain("ddb_get_page error: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(loggedText());
  });

  it("ddb_close_browser's error reply and stderr line have the first line only", async () => {
    mocks.closeBrowser.mockRejectedValue(new Error(LEAKY_MESSAGE));
    const result = await call("ddb_close_browser", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Failed to close browser: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(textOf(result));
    expect(loggedText()).toContain("ddb_close_browser error: Timeout 30000ms exceeded.");
    expectNoPlaywrightLog(loggedText());
  });
});

describe("browser tools bind the call to the context's own snapshot (carry-over (bs))", () => {
  it("ddb_navigate passes getBoundContext's snapshot", async () => {
    mocks.navigate.mockResolvedValue("ok");
    await call("ddb_navigate", { url: "https://www.dndbeyond.com/monsters" });
    expect(mocks.navigate).toHaveBeenCalledWith(BOUND.context, "https://www.dndbeyond.com/monsters", BOUND.snapshot);
  });

  it("ddb_interact passes getBoundContext's snapshot", async () => {
    mocks.interact.mockResolvedValue("ok");
    await call("ddb_interact", { action: "screenshot", selector: "body" });
    expect(mocks.interact).toHaveBeenCalledWith(BOUND.context, "screenshot", "body", undefined, BOUND.snapshot);
  });

  it("ddb_get_page passes getBoundContext's snapshot", async () => {
    mocks.getCurrentPageContent.mockResolvedValue("ok");
    await call("ddb_get_page", {});
    expect(mocks.getCurrentPageContent).toHaveBeenCalledWith(BOUND.context, BOUND.snapshot);
  });
});
