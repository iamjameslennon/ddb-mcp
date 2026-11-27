import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import type { Transport, JSONRPCMessage, CallToolResult } from "@modelcontextprotocol/client";

/**
 * protocol-eras.test.ts — the real entry-point wiring (startStdioServer), driven
 * in-process over PassThrough streams.
 *
 * - Both protocol eras: `server.connect()`, which every other test uses, serves
 *   only the 2025 era; a client pinned to 2026-07-28 fails against it (measured
 *   2026-11-27). Only `serveStdio` answers both, so this pins that the entry
 *   point uses it and that both eras see the same tools and instructions.
 * - The shutdown hook order: `serveStdio` assigns `transport.onclose`, so a hook
 *   installed before it is dropped and a stdin EOF would only reach the 30 s
 *   drain. Installed after it, the EOF closes the transport and exits at once
 *   through the chained onclose.
 *
 * Each start imports a fresh module graph, as a new process would: one server
 * instance that served a 2026-era connection answers a later 2025 `initialize`
 * with "Method not found" (seen 2026-11-27). A process serves one connection,
 * so that never happens outside tests.
 *
 * The tools called here read no session, so the process's HOME doesn't matter.
 */

/** A client-side Transport over the server's two streams: newline-delimited JSON-RPC. */
class StreamClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = "";
  private closed = false;

  constructor(private readonly toServer: PassThrough, private readonly fromServer: PassThrough) {}

  async start(): Promise<void> {
    this.fromServer.setEncoding("utf8");
    this.fromServer.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, "");
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
        } catch (err) {
          this.onerror?.(err as Error);
        }
      }
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("transport closed");
    this.toServer.write(JSON.stringify(message) + "\n");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.toServer.end();
    this.onclose?.();
  }
}

async function start() {
  vi.resetModules();
  const { startStdioServer } = await import("../src/start.js");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = new EventEmitter();
  const closeAll = vi.fn(async () => {});
  const exit = vi.fn();
  const log = vi.fn();
  startStdioServer({ stdin, stdout, proc, closeAll, exit, log });
  return { stdin, stdout, closeAll, exit, log };
}

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as Record<string, unknown>)[k])]))
      : v;

const loggedLines = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(c => String(c[0]));

describe("startStdioServer: both protocol eras through the real entry point", () => {
  it("serves the same tools and instructions to a 2025 client and a 2026-pinned client", async () => {
    const seen: { tools: unknown; instructions: string | undefined }[] = [];
    for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
      const s = await start();
      const client = new Client({ name: "eras-test", version: "0.0.0" }, { versionNegotiation: { mode } });
      await client.connect(new StreamClientTransport(s.stdin, s.stdout));
      try {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(36);
        const result = await client.callTool({ name: "ddb_get_condition", arguments: { name: "grappled" } }) as CallToolResult;
        expect(result.isError).toBeFalsy();
        expect(result.content.map(c => (c.type === "text" ? c.text : "")).join("\n")).toContain("Grappled");
        seen.push({ tools: canon(tools), instructions: client.getInstructions() });
      } finally {
        await client.close();
        // The client closing ends the server's stdin: the transport closes and exits through the hook.
        await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0), { timeout: 2_000 });
      }
    }
    expect(seen).toHaveLength(2);
    expect(seen[0].instructions).toBeTruthy();
    expect(seen[1].instructions).toBe(seen[0].instructions);
    expect(seen[1].tools).toEqual(seen[0].tools);
  });

  it("stdin EOF closes the transport and exits through the chained onclose", async () => {
    const s = await start();
    const client = new Client({ name: "eras-test", version: "0.0.0" }, { versionNegotiation: { mode: "legacy" } });
    await client.connect(new StreamClientTransport(s.stdin, s.stdout));
    s.stdin.end();
    await vi.waitFor(() => {
      expect(loggedLines(s.log).some(l => l.includes("Transport closed"))).toBe(true);
      expect(s.exit).toHaveBeenCalledWith(0);
    }, { timeout: 2_000 });
    expect(s.closeAll).toHaveBeenCalledTimes(1);
  });
});
