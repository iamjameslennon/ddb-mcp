import { describe, it, expect, vi, afterEach } from "vitest";
import { guardRoute, MAX_REDIRECT_HOPS, NAVIGATION_TIMEOUT_MS } from "../src/tools/navigate.js";

// A fake Playwright Route for the shared context's guard. `server` maps a URL
// to the response route.fetch() gets for it (no redirects followed, as with
// maxRedirects: 0). Every fetch, fulfill, abort and continue is recorded, so
// the tests can prove a foreign URL was never requested.
type Route = Parameters<typeof guardRoute>[0];

interface FakeResponse { status: number; headers?: Record<string, string> }
interface FetchCall { url?: string; method?: string; postData?: Buffer; headers?: Record<string, string>; maxRedirects?: number; timeout?: number }

function makeRoute(opts: {
  url: string;
  method?: string;
  postData?: Buffer;
  headers?: Record<string, string>;
  navigation?: boolean;
  server: Record<string, FakeResponse>;
}) {
  const calls = {
    fetched: [] as FetchCall[],
    fulfilled: [] as Array<{ response?: { status(): number }; status?: number; headers?: Record<string, string> }>,
    aborted: [] as string[],
    continued: 0,
    disposed: [] as string[],
  };
  const request = {
    url: () => opts.url,
    method: () => opts.method ?? "GET",
    headers: () => opts.headers ?? { "user-agent": "UA", accept: "text/html" },
    postDataBuffer: () => opts.postData ?? null,
    isNavigationRequest: () => opts.navigation ?? true,
    frame: () => ({ parentFrame: () => null }),
  };
  const route = {
    request: () => request,
    fetch: async (o: FetchCall) => {
      calls.fetched.push(o);
      const url = o.url ?? opts.url;
      const r = opts.server[url];
      if (!r) throw new Error(`unexpected fetch of ${url}`);
      return { status: () => r.status, headers: () => r.headers ?? {}, dispose: async () => { calls.disposed.push(url); } };
    },
    fulfill: async (o: (typeof calls.fulfilled)[number]) => { calls.fulfilled.push(o); },
    abort: async (code?: string) => { calls.aborted.push(code ?? "failed"); },
    continue: async () => { calls.continued++; },
  };
  return { route: route as unknown as Route, calls };
}

const A = "https://www.dndbeyond.com/a";
const B = "https://www.dndbeyond.com/b";
const C = "https://www.dndbeyond.com/c";
const EVIL = "https://evil.example/steal?d=secret";

describe("guardRoute: redirect hops are checked before they are requested", () => {
  it("fulfills a non-redirect response directly", async () => {
    const { route, calls } = makeRoute({ url: A, server: { [A]: { status: 200 } } });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.fetched[0].maxRedirects).toBe(0);
    expect(calls.fulfilled).toHaveLength(1);
    expect(calls.fulfilled[0].response?.status()).toBe(200);
    expect(calls.aborted).toEqual([]);
  });

  it("allowed → allowed → 200 answers with a 302 to the final URL", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: {
        [A]: { status: 301, headers: { location: B } },
        [B]: { status: 302, headers: { location: C } },
        [C]: { status: 200 },
      },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A, B, C]);
    expect(calls.fetched.every(f => f.maxRedirects === 0)).toBe(true);
    expect(calls.fulfilled).toEqual([{ status: 302, headers: { location: C } }]);
    expect(calls.aborted).toEqual([]);
  });

  it("allowed → allowed → foreign aborts and never requests the foreign URL", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: {
        [A]: { status: 302, headers: { location: B } },
        [B]: { status: 302, headers: { location: EVIL } },
        [EVIL]: { status: 200 },
      },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A, B]);
    expect(calls.aborted).toEqual(["blockedbyclient"]);
    expect(calls.fulfilled).toEqual([]);
  });

  it("resolves a relative Location against the current hop", async () => {
    const { route, calls } = makeRoute({
      url: "https://www.dndbeyond.com/sources/phb",
      server: {
        "https://www.dndbeyond.com/sources/phb": { status: 302, headers: { location: "dnd/phb-2014" } },
        "https://www.dndbeyond.com/sources/dnd/phb-2014": { status: 200 },
      },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([
      "https://www.dndbeyond.com/sources/phb",
      "https://www.dndbeyond.com/sources/dnd/phb-2014",
    ]);
    expect(calls.fulfilled).toEqual([
      { status: 302, headers: { location: "https://www.dndbeyond.com/sources/dnd/phb-2014" } },
    ]);
  });

  it("a protocol-relative Location to a foreign host is aborted", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 302, headers: { location: "//evil.example/x" } } },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.aborted).toEqual(["blockedbyclient"]);
  });

  it("a 3xx with no Location is fulfilled as-is", async () => {
    const { route, calls } = makeRoute({ url: A, server: { [A]: { status: 302 } } });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.fulfilled).toHaveLength(1);
    expect(calls.fulfilled[0].response?.status()).toBe(302);
    expect(calls.aborted).toEqual([]);
  });

  it("a status 300 is fulfilled as-is, not followed (Chromium doesn't follow it)", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 300, headers: { location: B } }, [B]: { status: 200 } },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.fulfilled).toHaveLength(1);
    expect(calls.fulfilled[0].response?.status()).toBe(300);
  });

  it("an unparsable Location aborts without another fetch", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 302, headers: { location: "https://[not-a-host" } } },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.aborted).toEqual(["blockedbyclient"]);
  });

  it("disposes every hop's response except the one it fulfills with", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: {
        [A]: { status: 301, headers: { location: B } },
        [B]: { status: 307, headers: { location: C } },
        [C]: { status: 200 },
      },
    });
    await guardRoute(route);
    expect(calls.disposed).toEqual([A, B, C]); // C is answered with a synthetic 302
    const direct = makeRoute({ url: A, server: { [A]: { status: 200 } } });
    await guardRoute(direct.route);
    expect(direct.calls.disposed).toEqual([]); // fulfilled with the response itself
  });

  it("every hop shares one deadline, and the walk aborts once it passes", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { route, calls } = makeRoute({
      url: A,
      server: {
        [A]: { status: 302, headers: { location: B } },
        [B]: { status: 302, headers: { location: C } },
        [C]: { status: 200 },
      },
    });
    const fetch = (route as unknown as { fetch: (o: FetchCall) => Promise<unknown> }).fetch;
    (route as unknown as { fetch: (o: FetchCall) => Promise<unknown> }).fetch = async (o: FetchCall) => {
      const r = await fetch(o);
      now += NAVIGATION_TIMEOUT_MS / 2; // each hop takes half the budget
      return r;
    };
    await guardRoute(route);
    expect(calls.fetched.map(f => [f.url, f.timeout])).toEqual([[A, NAVIGATION_TIMEOUT_MS], [B, NAVIGATION_TIMEOUT_MS / 2]]);
    expect(calls.aborted).toEqual(["timedout"]);
    expect(calls.fulfilled).toEqual([]);
  });

  it("never forwards a Cookie or Host header between hops", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { cookie: "CobaltSession=x", host: "www.dndbeyond.com", "user-agent": "UA" },
      server: { [A]: { status: 302, headers: { location: B } }, [B]: { status: 200 } },
    });
    await guardRoute(route);
    for (const f of calls.fetched) expect(f.headers).toEqual({ "user-agent": "UA" });
  });

  it(`follows ${MAX_REDIRECT_HOPS} redirects but aborts the ${MAX_REDIRECT_HOPS + 1}st`, async () => {
    const hop = (i: number) => `https://www.dndbeyond.com/hop/${i}`;
    const chain = (redirects: number) => {
      const server: Record<string, FakeResponse> = {};
      for (let i = 0; i < redirects; i++) server[hop(i)] = { status: 302, headers: { location: hop(i + 1) } };
      server[hop(redirects)] = { status: 200 };
      return server;
    };

    const ok = makeRoute({ url: hop(0), server: chain(MAX_REDIRECT_HOPS) });
    await guardRoute(ok.route);
    expect(ok.calls.fetched).toHaveLength(MAX_REDIRECT_HOPS + 1);
    expect(ok.calls.fulfilled).toEqual([{ status: 302, headers: { location: hop(MAX_REDIRECT_HOPS) } }]);

    const tooMany = makeRoute({ url: hop(0), server: chain(MAX_REDIRECT_HOPS + 1) });
    await guardRoute(tooMany.route);
    expect(tooMany.calls.fetched).toHaveLength(MAX_REDIRECT_HOPS + 1);
    expect(tooMany.calls.fetched.map(f => f.url)).not.toContain(hop(MAX_REDIRECT_HOPS + 1));
    expect(tooMany.calls.aborted).toEqual(["blockedbyclient"]);
    expect(tooMany.calls.fulfilled).toEqual([]);
  });

  it("a failed hop fails the navigation instead of leaving it pending", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 302, headers: { location: B } } }, // B: fetch throws
    });
    await guardRoute(route);
    expect(calls.aborted).toEqual(["failed"]);
    expect(calls.fulfilled).toEqual([]);
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe("guardRoute: navigations left to Chrome (SameSite and Sec-Fetch-* stay native)", () => {
  for (const method of ["POST", "PUT"]) {
    it(`a ${method} navigation to an allowed URL is continued natively, never fetched`, async () => {
      const { route, calls } = makeRoute({
        url: A,
        method,
        postData: Buffer.from("q=1"),
        headers: { origin: "https://www.dndbeyond.com", "content-type": "application/x-www-form-urlencoded" },
        server: { [A]: { status: 303, headers: { location: B } } },
      });
      await guardRoute(route);
      expect(calls.continued).toBe(1);
      expect(calls.fetched).toEqual([]);
    });
  }

  it("a cross-origin POST (a foreign frame's form, target=_top) is continued natively", async () => {
    const { route, calls } = makeRoute({
      url: A,
      method: "POST",
      postData: Buffer.from("x=1"),
      headers: { origin: "https://evil.example" },
      server: {},
    });
    await guardRoute(route);
    expect(calls.continued).toBe(1);
    expect(calls.fetched).toEqual([]);
  });

  for (const origin of ["https://evil.example", "null"]) {
    it(`a GET with Origin ${origin} is continued natively`, async () => {
      const { route, calls } = makeRoute({ url: A, headers: { origin }, server: {} });
      await guardRoute(route);
      expect(calls.continued).toBe(1);
      expect(calls.fetched).toEqual([]);
    });
  }

  it("a GET with an allowlisted Origin, or none (our own goto), is still walked", async () => {
    for (const headers of [{ origin: "https://www.dndbeyond.com" }, { "user-agent": "UA" }] as Array<Record<string, string>>) {
      const { route, calls } = makeRoute({ url: A, headers, server: { [A]: { status: 200 } } });
      await guardRoute(route);
      expect(calls.continued).toBe(0);
      expect(calls.fetched.map(f => [f.url, f.method])).toEqual([[A, "GET"]]);
    }
  });
});

describe("guardRoute: unchanged paths", () => {
  it("a top-level navigation to a foreign URL is aborted without a fetch", async () => {
    const { route, calls } = makeRoute({ url: EVIL, server: {} });
    await guardRoute(route);
    expect(calls.fetched).toEqual([]);
    expect(calls.aborted).toEqual(["blockedbyclient"]);
  });

  it("a subresource is continued untouched", async () => {
    const { route, calls } = makeRoute({ url: "https://cdn.example/app.js", navigation: false, server: {} });
    await guardRoute(route);
    expect(calls.continued).toBe(1);
    expect(calls.fetched).toEqual([]);
  });
});
