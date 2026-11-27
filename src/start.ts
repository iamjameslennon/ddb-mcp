import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { installShutdownHandlers } from "./shutdown.js";
import { safeErrorLine } from "./utils.js";

export interface StdioServerDeps {
  stdin: Readable;
  stdout: Writable;
  /** The process, for its termination signals. */
  proc: Pick<EventEmitter, "on">;
  /** Close every browser, the login browser included. */
  closeAll: () => Promise<void>;
  exit: (code: number) => void;
  log: (line: string) => void;
}

/**
 * Serve the MCP server over the given stdio streams. index.ts passes the
 * process's own; tests pass in-memory streams (tests/protocol-eras.test.ts).
 *
 * - `serveStdio`, not `server.connect()`: it answers both protocol eras
 *   (2025-11-25 `initialize` and 2026-07-28 `server/discover`), while
 *   `connect()` serves only the 2025 era. The factory builds a new server
 *   each call: on one connection `serveStdio` can build a 2026 probe
 *   instance and then a 2025 fallback one, and the probe instance must not
 *   be reused (final review 2026-11-27, I1).
 * - The shutdown hook goes in **after** `serveStdio`, which assigns
 *   `transport.onclose` (v1's `connect()` chained onto it). Installed before,
 *   the hook would be dropped and a transport close would never exit; the
 *   hook chains onto the SDK's handler instead. It closes every browser (a
 *   login window included) and exits when the client goes away, the transport
 *   closes, or a termination signal arrives.
 */
export function startStdioServer(deps: StdioServerDeps): void {
  const transport = new StdioServerTransport(deps.stdin, deps.stdout);
  serveStdio(() => createServer(), {
    transport,
    // The entry's own errors (a malformed line, a rejected request, a probe
    // discard timeout): only the safe first line, as everywhere else.
    onerror: err => deps.log(`[ddb-mcp] MCP stdio error: ${safeErrorLine(err)}\n`),
  });
  installShutdownHandlers({
    stdin: deps.stdin,
    proc: deps.proc,
    transport,
    closeAll: deps.closeAll,
    exit: deps.exit,
    log: deps.log,
  });
  deps.log("D&D Beyond MCP server running on stdio\n");
}
