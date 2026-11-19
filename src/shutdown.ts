import type { EventEmitter } from "node:events";

/** How long an immediate shutdown waits for the browsers to close before exiting anyway. */
export const SHUTDOWN_GRACE_MS = 5_000;
/** After stdin ends, the longest the process stays up to send replies already in flight. */
export const SHUTDOWN_DRAIN_MS = 30_000;

export interface ShutdownDeps {
  /** The server's stdin: its end (or close) means the MCP client has gone. */
  stdin: Pick<EventEmitter, "on">;
  /** The process, for its termination signals. */
  proc: Pick<EventEmitter, "on">;
  /** The MCP transport; its onclose is set here (the SDK chains its own onto it in connect()). */
  transport: { onclose?: () => void };
  /** Close every browser, the login browser included. */
  closeAll: () => Promise<void>;
  exit: (code: number) => void;
  log: (line: string) => void;
}

/**
 * Shut the server down when the client goes away or the process is told to stop.
 *
 * - **stdin ends or closes** (the client disconnected, or a one-shot client
 *   piped its requests and closed its end): every browser closes at once, the
 *   login window included, and the process is left to exit by itself once the
 *   replies already in flight are sent, or at SHUTDOWN_DRAIN_MS (an unref'd
 *   timer, so it never holds the process open by itself). The MCP SDK's
 *   StdioServerTransport listens only for stdin data and errors, never its
 *   end, so without this a ddb_login waiting for a sign-in kept this process
 *   and its login window alive for up to 3 minutes after the client had gone
 *   (regression 2026-11-19 F3).
 * - **SIGTERM / SIGINT / SIGHUP, or the transport closing:** close every
 *   browser (at most SHUTDOWN_GRACE_MS, so a hung close can't keep the
 *   process alive), then exit 0, once, also in the middle of a drain.
 */
export function installShutdownHandlers(deps: ShutdownDeps): void {
  let draining = false;
  let exiting = false;

  const exitNow = (reason: string): void => {
    if (exiting) return;
    exiting = true;
    deps.log(`[ddb-mcp] ${reason}, shutting down...\n`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>(resolve => { timer = setTimeout(resolve, SHUTDOWN_GRACE_MS); });
    void Promise.race([deps.closeAll().catch(() => { /* exiting anyway */ }), grace]).then(() => {
      clearTimeout(timer);
      deps.exit(0);
    });
  };

  const drain = (reason: string): void => {
    if (draining || exiting) return;
    draining = true;
    deps.log(`[ddb-mcp] ${reason}: closing browsers, exiting once in-flight replies are sent...\n`);
    void deps.closeAll().catch(() => { /* the drain deadline still exits */ });
    setTimeout(() => exitNow("Drain deadline reached"), SHUTDOWN_DRAIN_MS).unref();
  };

  deps.stdin.on("end", () => drain("Client disconnected (stdin ended)"));
  deps.stdin.on("close", () => drain("Client disconnected (stdin closed)"));
  deps.transport.onclose = () => exitNow("Transport closed");
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    deps.proc.on(signal, () => exitNow(`Received ${signal}`));
  }
}
