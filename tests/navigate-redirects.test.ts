import { describe, it, expect, vi, afterEach } from "vitest";
import { guardRoute, walkCookieHeader, MAX_REDIRECT_HOPS, NAVIGATION_TIMEOUT_MS } from "../src/tools/navigate.js";

// A fake Playwright Route for the shared context's guard. `server` maps a URL
// to the response route.fetch() gets for it (no redirects followed, as with
// maxRedirects: 0). Every fetch, fulfill, abort and continue is recorded, so
// the tests can prove a foreign URL was never requested.
type Route = Parameters<typeof guardRoute>[0];

interface FakeResponse { status: number; headers?: Record<string, string> }
interface FetchCall { url?: string; method?: string; postData?: Buffer; headers?: Record<string, string>; maxRedirects?: number; timeout?: number }

const JAR = [
  { name: "Lax1", value: "a", sameSite: "Lax" },
  { name: "Strict1", value: "b", sameSite: "Strict" },
  { name: "None1", value: "c", sameSite: "None" },
  { name: "Part1", value: "d", sameSite: "None", partitionKey: "https://www.dndbeyond.com" },
];

function makeRoute(opts: {
  jar?: typeof JAR;
  cookiesError?: Error;
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
    cookieUrls: [] as string[],
  };
  const request = {
    url: () => opts.url,
    method: () => opts.method ?? "GET",
    headers: () => opts.headers ?? { "user-agent": "UA", accept: "text/html" },
    postDataBuffer: () => opts.postData ?? null,
    isNavigationRequest: () => opts.navigation ?? true,
    frame: () => ({
      parentFrame: () => null,
      page: () => ({
        context: () => ({
          cookies: async (u: string) => {
            calls.cookieUrls.push(u);
            if (opts.cookiesError) throw opts.cookiesError;
            return opts.jar ?? JAR;
          },
        }),
      }),
    }),
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
      headers: { cookie: "Lax1=a; None1=c", host: "www.dndbeyond.com", "user-agent": "UA" },
      server: { [A]: { status: 302, headers: { location: B } }, [B]: { status: 200 } },
    });
    await guardRoute(route);
    for (const f of calls.fetched) expect(f.headers).toEqual({ "user-agent": "UA", cookie: "Lax1=a; None1=c" });
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

  it("a hop that fails at the network level falls back to Chrome's own request (12c MIN-7)", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 302, headers: { location: B } } }, // B: fetch throws
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A, B]);
    expect(calls.continued).toBe(1);
    expect(calls.aborted).toEqual([]);
    expect(calls.fulfilled).toEqual([]);
  });

  it("a first request that fails at the network level falls back too (a proxy, a TLS rule)", async () => {
    const { route, calls } = makeRoute({ url: A, server: {} }); // A: fetch throws
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.continued).toBe(1);
    expect(calls.aborted).toEqual([]);
  });

  it("a fetch that fails on the deadline aborts the navigation, never falls back", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { route, calls } = makeRoute({ url: A, server: { [A]: { status: 302, headers: { location: B } } } });
    const fetch = (route as unknown as { fetch: (o: FetchCall) => Promise<unknown> }).fetch;
    (route as unknown as { fetch: (o: FetchCall) => Promise<unknown> }).fetch = async (o: FetchCall) => {
      if (o.url === B) { now += NAVIGATION_TIMEOUT_MS; throw new Error("socket hang up"); } // the deadline passed mid-fetch
      return fetch(o);
    };
    await guardRoute(route);
    expect(calls.continued).toBe(0);
    expect(calls.aborted).toEqual(["timedout"]);
  });

  it("Playwright's own TimeoutError aborts the navigation, never falls back", async () => {
    const { route, calls } = makeRoute({ url: A, server: {} });
    (route as unknown as { fetch: (o: FetchCall) => Promise<unknown> }).fetch = async () => {
      const e = new Error("apiRequestContext.fetch: Timeout 30000ms exceeded."); e.name = "TimeoutError"; throw e;
    };
    await guardRoute(route);
    expect(calls.continued).toBe(0);
    expect(calls.aborted).toEqual(["timedout"]);
  });

  it("never falls back once a foreign Location was seen, even when the abort itself fails", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 302, headers: { location: EVIL } } },
    });
    const abort = (route as unknown as { abort: (c?: string) => Promise<void> }).abort;
    let first = true;
    (route as unknown as { abort: (c?: string) => Promise<void> }).abort = async (code?: string) => {
      await abort(code);
      if (first) { first = false; throw new Error("Target page, context or browser has been closed"); }
    };
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.continued).toBe(0);
    expect(calls.aborted).toEqual(["blockedbyclient", "failed"]);
  });

  it("a fulfill that fails (the page closed) aborts, never falls back", async () => {
    const { route, calls } = makeRoute({ url: A, server: { [A]: { status: 200 } } });
    (route as unknown as { fulfill: () => Promise<void> }).fulfill = async () => { throw new Error("Target closed"); };
    await guardRoute(route);
    expect(calls.continued).toBe(0);
    expect(calls.aborted).toEqual(["failed"]);
  });
});

// Node hands header values over as latin1; a Location's bytes are UTF-8 (12c MIN-8).
describe("guardRoute: a Location header is decoded as UTF-8", () => {
  const asLatin1 = (utf8: string) => Buffer.from(utf8, "utf8").toString("latin1");

  it("a raw UTF-8 path resolves to the right page, not mojibake", async () => {
    const target = "https://www.dndbeyond.com/sources/caf\u00e9-r\u00e8gles";
    const { route, calls } = makeRoute({
      url: A,
      server: {
        [A]: { status: 302, headers: { location: asLatin1("/sources/caf\u00e9-r\u00e8gles") } },
        [new URL(target).href]: { status: 200 },
      },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A, "https://www.dndbeyond.com/sources/caf%C3%A9-r%C3%A8gles"]);
    expect(calls.fulfilled).toEqual([{ status: 302, headers: { location: "https://www.dndbeyond.com/sources/caf%C3%A9-r%C3%A8gles" } }]);
  });

  it("an ASCII Location is unchanged", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 301, headers: { location: "/b" } }, [B]: { status: 200 } },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A, B]);
  });

  it("a UTF-8 foreign host is still refused, never requested", async () => {
    const { route, calls } = makeRoute({
      url: A,
      server: { [A]: { status: 302, headers: { location: asLatin1("https://d\u00f1dbeyond.com/x") } } },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.aborted).toEqual(["blockedbyclient"]);
    expect(calls.continued).toBe(0);
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

describe("walkCookieHeader", () => {
  it("sends Lax and None cookies and drops Strict and partitioned ones Chrome did not send", () => {
    expect(walkCookieHeader(JAR, "Lax1=a; None1=c")).toBe("Lax1=a; None1=c");
  });
  it("sends a Strict cookie Chrome itself sent (same-site initiator)", () => {
    expect(walkCookieHeader(JAR, "Lax1=a; Strict1=b; None1=c")).toBe("Lax1=a; Strict1=b; None1=c");
  });
  it("sends a partitioned cookie only if Chrome sent it", () => {
    expect(walkCookieHeader(JAR, "Lax1=a; None1=c")).not.toContain("Part1");
    expect(walkCookieHeader(JAR, "Lax1=a; None1=c; Part1=d")).toBe("Lax1=a; None1=c; Part1=d");
  });
  it("matches by name and value: a Strict cookie with another value is not sent", () => {
    expect(walkCookieHeader(JAR, "Strict1=other")).toBe("Lax1=a; None1=c");
  });
  it("no Chrome cookie header: only Lax and None, no Strict or partitioned (fail closed)", () => {
    expect(walkCookieHeader(JAR, undefined)).toBe("Lax1=a; None1=c");
  });
  it("an empty result is the empty string, never undefined", () => {
    expect(walkCookieHeader([{ name: "S", value: "1", sameSite: "Strict" }], undefined)).toBe("");
  });
  it("a cookie without sameSite counts as Lax", () => {
    expect(walkCookieHeader([{ name: "X", value: "1" }], undefined)).toBe("X=1");
  });
});

describe("guardRoute: a cross-site-initiated GET is walked without the cookies Chrome withheld (bx)(5)", () => {
  const twoHops = { [A]: { status: 302, headers: { location: B } }, [B]: { status: 200 } };

  it("a cross-site link (Chrome's cookie header lacks the Strict cookie) fetches with Lax and None only, on every hop", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { cookie: "Lax1=a; None1=c", referer: "https://evil.example/", "user-agent": "UA" },
      server: twoHops,
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.headers?.cookie)).toEqual(["Lax1=a; None1=c", "Lax1=a; None1=c"]);
    expect(calls.cookieUrls).toEqual([A, B]);
  });

  it("a same-site navigation (Chrome sent the Strict cookie) walks with it, every hop", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { cookie: "Lax1=a; Strict1=b; None1=c", "user-agent": "UA" },
      server: twoHops,
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.headers?.cookie)).toEqual(["Lax1=a; Strict1=b; None1=c", "Lax1=a; Strict1=b; None1=c"]);
  });

  it("a tool goto (no Referer, Chrome sent every cookie) keeps the Strict cookie", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { cookie: "Lax1=a; Strict1=b; None1=c; Part1=d", "user-agent": "UA" },
      server: { [A]: { status: 200 } },
    });
    await guardRoute(route);
    expect(calls.fetched[0].headers?.cookie).toBe("Lax1=a; Strict1=b; None1=c; Part1=d");
  });

  it("a request with no cookie header and a Strict cookie in the jar sends none of them", async () => {
    const { route, calls } = makeRoute({ url: A, headers: { "user-agent": "UA" }, server: twoHops });
    await guardRoute(route);
    for (const f of calls.fetched) {
      expect(f.headers?.cookie).toBe("Lax1=a; None1=c");
      expect(f.headers?.cookie).not.toContain("Strict1");
      expect(f.headers?.cookie).not.toContain("Part1");
    }
  });

  it("every hop's cookies come from the jar for that hop's URL, never from a header carried over", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { cookie: "Lax1=a; Forged=1", "user-agent": "UA" },
      server: twoHops,
    });
    await guardRoute(route);
    for (const f of calls.fetched) expect(f.headers?.cookie).not.toContain("Forged");
    expect(calls.cookieUrls).toEqual([A, B]);
  });

  it("Playwright's fill-in is prevented: the cookie header is always present, even empty", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { "user-agent": "UA" },
      jar: [{ name: "S", value: "1", sameSite: "Strict" }],
      server: { [A]: { status: 200 } },
    });
    await guardRoute(route);
    expect(Object.prototype.hasOwnProperty.call(calls.fetched[0].headers, "cookie")).toBe(true);
    expect(calls.fetched[0].headers?.cookie).toBe("");
    expect(Object.prototype.hasOwnProperty.call(calls.fetched[0].headers, "host")).toBe(false);
  });

  it("a cookie lookup that throws aborts the navigation, never falls back to Chrome's request", async () => {
    const { route, calls } = makeRoute({ url: A, cookiesError: new Error("closed"), server: { [A]: { status: 200 } } });
    await guardRoute(route);
    expect(calls.aborted).toEqual(["failed"]);
    expect(calls.continued).toBe(0);
    expect(calls.fulfilled).toEqual([]);
    expect(calls.fetched).toEqual([]);
  });

  it("the cross-site decision does not widen the walk: a foreign hop is still aborted and never fetched", async () => {
    const { route, calls } = makeRoute({
      url: A,
      headers: { cookie: "Lax1=a", "user-agent": "UA" },
      server: { [A]: { status: 302, headers: { location: EVIL } }, [EVIL]: { status: 200 } },
    });
    await guardRoute(route);
    expect(calls.fetched.map(f => f.url)).toEqual([A]);
    expect(calls.cookieUrls).toEqual([A]);
    expect(calls.aborted).toEqual(["blockedbyclient"]);
  });

  it("non-GET, foreign-Origin and subresource requests are still continued natively, without a cookie lookup", async () => {
    const cases = [
      { url: A, method: "POST" },
      { url: A, headers: { origin: "https://evil.example" } },
      { url: "https://cdn.example/app.js", navigation: false },
    ];
    for (const c of cases) {
      const { route, calls } = makeRoute({ ...c, server: {} });
      await guardRoute(route);
      expect(calls.continued).toBe(1);
      expect(calls.cookieUrls).toEqual([]);
      expect(calls.fetched).toEqual([]);
    }
  });
});
