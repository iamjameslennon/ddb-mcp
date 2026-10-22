/** Stand-ins for the library page's RSC payload. */
// Build a minimal stand-in for the RSC stream that DDB's library page emits.
// Each chunk is a `self.__next_f.push([1, "<JSON-string-literal>"])` call, and
// the same `sources:[…]` array appears twice in the real HTML — once in the
// head stream, once in the body stream. We replicate both.
export function rscChunk(payload: string): string {
  const escaped = JSON.stringify(payload).slice(1, -1); // strip outer quotes; keep escapes
  return `<script>self.__next_f.push([1,"${escaped}"])</script>`;
}

export function buildFixture(sources: Array<Record<string, unknown>>): string {
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
