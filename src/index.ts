#!/usr/bin/env node
import { closeAllBrowsers } from "./browser.js";
import { startStdioServer } from "./start.js";

// ─── Start server ─────────────────────────────────────────────────────────────
// startStdioServer serves both protocol eras through serveStdio and installs
// the shutdown hook after it (serveStdio assigns transport.onclose); see start.ts.
async function main() {
  startStdioServer({
    stdin: process.stdin,
    stdout: process.stdout,
    proc: process,
    closeAll: closeAllBrowsers,
    exit: code => process.exit(code),
    log: line => { process.stderr.write(line); },
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
