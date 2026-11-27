import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { server } from "./server.js";
import { installShutdownHandlers } from "./shutdown.js";

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
 *   `connect()` serves only the 2025 era. One connection pins one instance,
 *   and the factory returns the module server.
 * - The shutdown hook goes in **after** `serveStdio`, which assigns
 *   `transport.onclose` (v1's `connect()` chained onto it). Installed before,
 *   the hook would be dropped and a transport close would never exit; the
 *   hook chains onto the SDK's handler instead. It closes every browser (a
 *   login window included) and exits when the client goes away, the transport
 *   closes, or a termination signal arrives.
 */
export function startStdioServer(deps: StdioServerDeps): void {
  const transport = new StdioServerTransport(deps.stdin, deps.stdout);
  serveStdio(() => server, { transport });
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
