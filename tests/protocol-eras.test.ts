import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import type { Transport, JSONRPCMessage, CallToolResult } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { startStdioServer } from "../src/start.js";

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
 * - A fresh server per factory call: `serveStdio` can call its factory twice on
 *   one connection (a 2026 `server/discover` probe instance, then a 2025
 *   `initialize` fallback). The probe instance keeps its 2026-only handlers, so
 *   reusing it answers the `initialize` with "Method not found" (final review
 *   2026-11-27, I1).
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

function start() {
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

/** Raw newline-delimited JSON-RPC on the server's streams, for exchanges the SDK client won't make. */
function rawPeer(stdin: PassThrough, stdout: PassThrough) {
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  let buffer = "";
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.id === "number") waiting.get(message.id)?.(message);
    }
  });
  return {
    request(id: number, method: string, params: Record<string, unknown>) {
      const reply = new Promise<Record<string, unknown>>(resolve => waiting.set(id, resolve));
      stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return reply;
    },
    notify(method: string) {
      stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    },
  };
}

describe("startStdioServer: both protocol eras through the real entry point", () => {
  it("serves the same tools and instructions to a 2025 client and a 2026-pinned client", async () => {
    const seen: { tools: unknown; instructions: string | undefined }[] = [];
    for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
      const s = start();
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

  it("a 2025 initialize after a 2026 server/discover on the same connection gets a fresh server (in-place probe fallback)", async () => {
    const s = start();
    const peer = rawPeer(s.stdin, s.stdout);
    try {
      const discover = await peer.request(1, "server/discover", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "eras-test", version: "0.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      });
      expect(discover.error).toBeUndefined();
      // The client gave up on its probe (e.g. a timeout) and falls back to the 2025 handshake.
      const init = await peer.request(2, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "eras-test", version: "0.0.0" },
      });
      expect(init.error).toBeUndefined();
      expect((init.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
      peer.notify("notifications/initialized");
      const list = await peer.request(3, "tools/list", {});
      expect(list.error).toBeUndefined();
      expect((list.result as { tools: unknown[] }).tools).toHaveLength(36);
    } finally {
      s.stdin.end();
      await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0), { timeout: 2_000 });
    }
  });

  it("logs the SDK's own errors (a JSON line that isn't JSON-RPC) and keeps serving", async () => {
    const s = start();
    const peer = rawPeer(s.stdin, s.stdout);
    try {
      // A non-JSON line is skipped silently; JSON that isn't a JSON-RPC message is an error.
      s.stdin.write(JSON.stringify({ not: "jsonrpc" }) + "\n");
      const init = await peer.request(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "eras-test", version: "0.0.0" },
      });
      expect(init.error).toBeUndefined();
      await vi.waitFor(() => expect(loggedLines(s.log).some(l => l.startsWith("[ddb-mcp] MCP stdio error:"))).toBe(true), { timeout: 2_000 });
    } finally {
      s.stdin.end();
      await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0), { timeout: 2_000 });
    }
  });

  it("stdin EOF closes the transport and exits through the chained onclose", async () => {
    const closeSpy = vi.spyOn(McpServer.prototype, "close");
    const s = start();
    const client = new Client({ name: "eras-test", version: "0.0.0" }, { versionNegotiation: { mode: "legacy" } });
    await client.connect(new StreamClientTransport(s.stdin, s.stdout));
    s.stdin.end();
    await vi.waitFor(() => {
      expect(loggedLines(s.log).some(l => l.includes("Transport closed"))).toBe(true);
      expect(s.exit).toHaveBeenCalledWith(0);
    }, { timeout: 2_000 });
    expect(s.closeAll).toHaveBeenCalledTimes(1);
    // The SDK's own onclose (which serveStdio assigned) still ran: it closes the pinned server.
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });
});
