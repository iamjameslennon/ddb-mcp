import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import { installShutdownHandlers, SHUTDOWN_DRAIN_MS } from "../src/shutdown.js";

/**
 * shutdown.test.ts — regression 2026-11-19 F3. The MCP SDK's stdio transport
 * never closes on stdin EOF, so a client that went away (a disconnect, or a
 * client restarting the server) left this server running with its login
 * window open until the 3-minute deadline. Every way the process is told to
 * stop must close every browser, the login browser included, exactly once.
 */

function setup(closeAll = vi.fn(async () => {})) {
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  const transport: { onclose?: () => void } = {};
  const exit = vi.fn();
  const log = vi.fn();
  installShutdownHandlers({ stdin, proc, transport, closeAll, exit, log });
  return { stdin, proc, transport, closeAll, exit, log };
}

const settle = () => new Promise(r => setImmediate(r));

describe("installShutdownHandlers (2026-11-19 F3)", () => {
  it.each(["end", "close"])("stdin %s (the client went away) closes every browser at once, but leaves replies in flight to finish", async event => {
    vi.useFakeTimers();
    try {
      const s = setup();
      s.stdin.emit(event);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.closeAll).toHaveBeenCalledTimes(1);
      // A one-shot or half-closing client still gets its replies: the process exits by itself once
      // nothing is left to do (the drain timer is unref'd), or at the drain deadline.
      await vi.advanceTimersByTimeAsync(SHUTDOWN_DRAIN_MS - 1);
      expect(s.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(s.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the drain timer doesn't keep the process alive by itself", () => {
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation((() => ({ unref })) as never);
    try {
      const s = setup();
      s.stdin.emit("end");
      expect(unref).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("a signal during the drain exits at once", async () => {
    const s = setup();
    s.stdin.emit("end");
    await settle();
    expect(s.exit).not.toHaveBeenCalled();
    s.proc.emit("SIGTERM");
    await settle();
    expect(s.exit).toHaveBeenCalledWith(0);
    expect(s.exit).toHaveBeenCalledTimes(1);
  });

  it.each(["SIGTERM", "SIGINT", "SIGHUP"])("%s closes every browser, then exits 0", async signal => {
    const s = setup();
    s.proc.emit(signal);
    await settle();
    expect(s.closeAll).toHaveBeenCalledTimes(1);
    expect(s.exit).toHaveBeenCalledWith(0);
  });

  it("the transport closing does the same", async () => {
    const s = setup();
    s.transport.onclose!();
    await settle();
    expect(s.closeAll).toHaveBeenCalledTimes(1);
    expect(s.exit).toHaveBeenCalledWith(0);
  });

  it("several triggers exit once", async () => {
    const s = setup();
    s.stdin.emit("end");
    s.stdin.emit("close");
    s.proc.emit("SIGTERM");
    s.transport.onclose!();
    s.proc.emit("SIGINT");
    await settle();
    expect(s.exit).toHaveBeenCalledTimes(1);
  });

  it("still exits when closing a browser fails", async () => {
    const s = setup(vi.fn(async () => { throw new Error("close failed"); }));
    s.proc.emit("SIGTERM");
    await settle();
    expect(s.exit).toHaveBeenCalledWith(0);
  });

  it("still exits when closing hangs, after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const s = setup(vi.fn(() => new Promise<void>(() => {})));
      s.proc.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(4_999);
      expect(s.exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(s.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
