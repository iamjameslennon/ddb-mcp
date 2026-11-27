import { vi, describe, it, expect, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

/**
 * Task 12b: ddb_logout never prints a raw cleanup error. A Playwright error
 * carries a "Call log:" / "Browser logs:" tail (launch command line, cookie
 * headers); the reply and stderr keep the first line only.
 */

const rmSyncMock = vi.hoisted(() => vi.fn());
vi.mock("fs", async importOriginal => {
  const real = await importOriginal<typeof import("fs")>();
  const isSession = (p: unknown) => String(p).endsWith("ddb-mcp/session.json") || String(p).endsWith("ddb-mcp\\session.json");
  return {
    ...real,
    existsSync: (p: never) => (isSession(p) ? false : real.existsSync(p)),
    rmSync: (...a: unknown[]) => rmSyncMock(...a),
  };
});

import { server } from "../src/server.js";
import { onSessionInvalidated, SESSION_PATH, __resetSessionStateForTests } from "../src/session-state.js";

const PLAYWRIGHT_ERROR =
  "browserContext.close: Target closed\nCall log:\n  - closing context\nBrowser logs:\n" +
  "<launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x";

let unsub: (() => void) | undefined;
afterEach(() => {
  unsub?.();
  unsub = undefined;
  rmSyncMock.mockReset();
  __resetSessionStateForTests();
  vi.restoreAllMocks();
});

describe("ddb_logout cleanup errors", () => {
  it("reply and stderr carry the first line only, the failed step is still named, revoked stays set", async () => {
    unsub = onSessionInvalidated(() => Promise.reject(new Error(PLAYWRIGHT_ERROR)));
    rmSyncMock.mockImplementation(() => {
      throw new Error(`EPERM: operation not permitted, unlink '${SESSION_PATH}'\nCall log:\n  - secret`);
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "logout-test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    let res;
    try {
      res = await client.callTool({ name: "ddb_logout", arguments: {} });
    } finally {
      await client.close();
    }

    const reply = JSON.stringify(res);
    const logged = stderr.mock.calls.map(c => String(c[0])).join("");
    expect(res.isError).toBe(true);
    for (const text of [reply, logged]) {
      expect(text).toContain("Target closed");
      expect(text).toContain("EPERM");
      for (const leak of ["Call log", "Browser logs", "<launching>", "/Applications", "secret"]) {
        expect(text).not.toContain(leak);
      }
    }
    // Revoked stays set: the session file mock says "absent" but authority is blocked.
    const { captureSession } = await import("../src/session-state.js");
    const snap = captureSession();
    expect(snap.state.kind).toBe("anonymous");
  });
});
