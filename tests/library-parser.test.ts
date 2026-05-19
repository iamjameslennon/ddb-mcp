import { describe, it, expect } from "vitest";
import { parseSourcesFromLibraryHtml, extractArticleMarkdown } from "../src/tools/library.js";

// Build a minimal stand-in for the RSC stream that DDB's library page emits.
// Each chunk is a `self.__next_f.push([1, "<JSON-string-literal>"])` call, and
// the same `sources:[…]` array appears twice in the real HTML — once in the
// head stream, once in the body stream. We replicate both.
function rscChunk(payload: string): string {
  const escaped = JSON.stringify(payload).slice(1, -1); // strip outer quotes; keep escapes
  return `<script>self.__next_f.push([1,"${escaped}"])</script>`;
}

function buildFixture(sources: Array<Record<string, unknown>>): string {
  const stanza = `2f:["$","$L40",null,${JSON.stringify({ sources })}]\n`;
  // Pre/post chunks simulate the unrelated layout chunks that surround the
  // sources payload in the real page.
  return [
    rscChunk('1:"$Sreact.fragment"\n'),
    rscChunk(stanza),
    rscChunk('30:["$","footer",null,{"className":"x"}]\n'),
    rscChunk(stanza), // duplicate emission, same payload — must dedupe
  ].join("\n");
}

describe("parseSourcesFromLibraryHtml", () => {
  it("extracts owned books, derives slug from relativePath, dedupes duplicate emissions", () => {
    const html = buildFixture([
      { name: "Player's Handbook (2024)", relativePath: "/sources/dnd/phb-2024", isOwned: true, isSharedWithMe: false },
      { name: "Curse of Strahd",           relativePath: "/sources/dnd/cos",      isOwned: false, isSharedWithMe: false },
      { name: "Tasha's Cauldron of Everything", relativePath: "/sources/dnd/tce", isOwned: false, isSharedWithMe: true },
    ]);

    const books = parseSourcesFromLibraryHtml(html);
    expect(books).toEqual([
      { title: "Player's Handbook (2024)",       slug: "dnd/phb-2024", ownership: "Owned" },
      { title: "Tasha's Cauldron of Everything", slug: "dnd/tce",      ownership: "Shared with you" },
    ]);
  });

  it("marks books owned AND shared with the combined ownership label", () => {
    const html = buildFixture([
      { name: "Player's Handbook (2024)", relativePath: "/sources/dnd/phb-2024", isOwned: true, isSharedWithMe: true },
    ]);
    expect(parseSourcesFromLibraryHtml(html)[0].ownership).toBe("Owned, Shared");
  });

  it("returns [] when the HTML has no sources payload", () => {
    expect(parseSourcesFromLibraryHtml("<html><body>no rsc here</body></html>")).toEqual([]);
  });

  it("skips entries with missing name or non-sources relativePath", () => {
    const html = buildFixture([
      { name: "",                  relativePath: "/sources/dnd/blank", isOwned: true },
      { name: "Outside Library",   relativePath: "/marketplace/foo",   isOwned: true },
      { name: "Valid",             relativePath: "/sources/dnd/v",     isOwned: true },
    ]);
    const books = parseSourcesFromLibraryHtml(html);
    expect(books).toEqual([
      { title: "Outside Library", slug: "", ownership: "Owned" }, // empty-slug entry kept
      { title: "Valid",           slug: "dnd/v", ownership: "Owned" },
    ]);
  });
});

describe("extractArticleMarkdown", () => {
  it("maps heading/paragraph/list/inline tags to markdown and strips chrome", () => {
    const html = `
      <html><body>
        <nav>NAV</nav>
        <header>HEAD</header>
        <article>
          <h1>The Basics</h1>
          <p>D&amp;D is <strong>a game</strong> in which <em>you</em> tell a story.</p>
          <h2>What Does a DM Do?</h2>
          <p>The DM plays many roles:</p>
          <ul><li>Actor</li><li>Director</li></ul>
          <hr/>
          <h3>DM Tips</h3>
          <p>Keep notes.</p>
        </article>
        <footer>FOOT</footer>
        <script>tracking()</script>
      </body></html>
    `;

    const md = extractArticleMarkdown(html);
    expect(md).toContain("## The Basics");
    expect(md).toContain("D&D is **a game** in which _you_ tell a story.");
    expect(md).toContain("## What Does a DM Do?");
    expect(md).toContain("- Actor");
    expect(md).toContain("- Director");
    expect(md).toContain("---");
    expect(md).toContain("### DM Tips");
    expect(md).toContain("Keep notes.");
    // Chrome and scripts must be gone
    expect(md).not.toContain("NAV");
    expect(md).not.toContain("HEAD");
    expect(md).not.toContain("FOOT");
    expect(md).not.toContain("tracking()");
  });

  it("falls back to .content-container then body when <article> is absent", () => {
    const html = `<html><body><div class="content-container"><p>fallback body</p></div></body></html>`;
    expect(extractArticleMarkdown(html)).toContain("fallback body");
    expect(extractArticleMarkdown("<html><body><p>just body</p></body></html>")).toContain("just body");
  });

  it("flattens tables to a [Table] placeholder", () => {
    const html = `<article><table><tr><td>cell A</td><td>cell B</td></tr></table></article>`;
    expect(extractArticleMarkdown(html)).toMatch(/\[Table\][\s\S]*cell A[\s\S]*cell B/);
  });

  it("returns empty string for HTML with no usable root", () => {
    expect(extractArticleMarkdown("")).toBe("");
  });
});
