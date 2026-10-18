#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeBrowser } from "./browser.js";
import { server } from "./server.js";

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[ddb-mcp] Received ${signal}, shutting down...\n`);
  await closeBrowser().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  // Clean up the browser if the MCP client disconnects (e.g. host process exits
  // without sending a signal). Without this, Playwright can leak processes.
  transport.onclose = () => { void shutdown("transport-close"); };
  await server.connect(transport);
  process.stderr.write("D&D Beyond MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
