#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeAllBrowsers } from "./browser.js";
import { server } from "./server.js";
import { installShutdownHandlers } from "./shutdown.js";

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  // Close every browser (a login window included) and exit when the client
  // goes away (stdin ends: the SDK transport doesn't notice that itself), the
  // transport closes, or a termination signal arrives. Without this, an
  // in-flight ddb_login kept the process and its window alive after a
  // disconnect, and Playwright could leak processes.
  installShutdownHandlers({
    stdin: process.stdin,
    proc: process,
    transport,
    closeAll: closeAllBrowsers,
    exit: code => process.exit(code),
    log: line => { process.stderr.write(line); },
  });
  await server.connect(transport);
  process.stderr.write("D&D Beyond MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
