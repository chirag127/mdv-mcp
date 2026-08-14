// test/vectorstore.test.mjs — int8-quantized vector store: quantization fidelity,
// cosine ranking, freshness, upsert/remove, and stats. No network.
import { describe, it, expect } from "vitest";
import { VectorStore } from "../src/lib/vectorstore.mjs";
import { config } from "../src/config.mjs";

const DIMS = config.EMBED_DIMS;

/** Build a Float32 vector, one-hot-ish so cosine ordering is predictable. */
function vec(fill) {
  const v = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) v[i] = fill(i);
  return v;
}

describe("VectorStore upsert / freshness / remove", () => {
  it("starts empty", () => {
    const s = new VectorStore();
    expect(s.stats()).toEqual({ files: 0, chunks: 0, dims: DIMS });
    expect(s.has("x.md")).toBe(false);
  });

  it("upserts chunks and reports stats", () => {
    const s = new VectorStore();
    s.upsert("a.md", 100, ["chunk one", "chunk two"], [vec(() => 1), vec(() => 0.5)]);
    expect(s.has("a.md")).toBe(true);
    expect(s.stats()).toEqual({ files: 1, chunks: 2, dims: DIMS });
    expect(s.keys()).toEqual(["a.md"]);
  });

  it("tracks freshness by mtime", () => {
    const s = new VectorStore();
    s.upsert("a.md", 100, ["c"], [vec(() => 1)]);
    expect(s.isFresh("a.md", 100)).toBe(true);
    expect(s.isFresh("a.md", 200)).toBe(false);
    expect(s.isFresh("missing.md", 100)).toBe(false);
  });

  it("truncates stored snippet text to 300 chars", () => {
    const s = new VectorStore();
    const long = "z".repeat(500);
    s.upsert("a.md", 1, [long], [vec(() => 1)]);
    const entry = [...s.files.values()][0];
    expect(entry.chunks[0].text.length).toBe(300);
  });

  it("removes a file", () => {
    const s = new VectorStore();
    s.upsert("a.md", 1, ["c"], [vec(() => 1)]);
    s.remove("a.md");
    expect(s.has("a.md")).toBe(false);
    expect(s.stats().files).toBe(0);
  });
});

describe("VectorStore search (cosine ranking via int8)", () => {
  it("ranks the most similar file first and returns a score near 1 for identical vectors", () => {
    const s = new VectorStore();
    // 'aligned' points along dim 0; 'orthogonal' points along dim 1.
    s.upsert("aligned.md", 1, ["aligned"], [vec((i) => (i === 0 ? 1 : 0))]);
    s.upsert("orthogonal.md", 1, ["orthogonal"], [vec((i) => (i === 1 ? 1 : 0))]);

    const query = vec((i) => (i === 0 ? 1 : 0));
    const results = s.search(query, 10);

    expect(results[0].rel).toBe("aligned.md");
    expect(results[0].score).toBeGreaterThan(0.99);
    // orthogonal vector should score ~0
    const orth = results.find((r) => r.rel === "orthogonal.md");
    expect(Math.abs(orth.score)).toBeLessThan(0.05);
  });

  it("keeps only the best chunk per file", () => {
    const s = new VectorStore();
    s.upsert("multi.md", 1, ["weak", "strong"], [
      vec((i) => (i === 5 ? 1 : 0)),
      vec((i) => (i === 0 ? 1 : 0)),
    ]);
    const results = s.search(vec((i) => (i === 0 ? 1 : 0)), 10);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("strong");
  });

  it("respects topK", () => {
    const s = new VectorStore();
    for (let f = 0; f < 5; f++) {
      s.upsert(`f${f}.md`, 1, [`c${f}`], [vec((i) => (i === f ? 1 : 0))]);
    }
    expect(s.search(vec((i) => (i === 0 ? 1 : 0)), 2)).toHaveLength(2);
  });

  it("preserves cosine similarity within quantization error for scaled vectors", () => {
    const s = new VectorStore();
    // Same direction, different magnitude => cosine should still be ~1.
    s.upsert("scaled.md", 1, ["c"], [vec((i) => (i % 2 === 0 ? 2 : -1))]);
    const query = vec((i) => (i % 2 === 0 ? 8 : -4));
    const [top] = s.search(query, 1);
    expect(top.score).toBeGreaterThan(0.99);
  });
});
