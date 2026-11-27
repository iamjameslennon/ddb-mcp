import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/server.js";

/**
 * server-info.test.ts — the `initialize` reply names the server and its real
 * version. It said "1.0.0" from the first release to 3.1.0, whatever was installed.
 */
describe("serverInfo", () => {
  it("names the server dndbeyond and reports package.json's version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "server-info-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "dndbeyond", version: pkg.version });
      expect(pkg.version).not.toBe("1.0.0");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
