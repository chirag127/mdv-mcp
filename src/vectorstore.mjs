// vectorstore.mjs — pure-JS on-disk vector index with int8 quantization.
// Stores one entry per chunk: { rel, chunkIdx, mtimeMs, norm, q(int8) }.
// Cosine similarity computed from dequantized vectors. Local only.
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

const INDEX_FILE = path.join(config.CACHE_DIR, "vectors.json");
const DIMS = config.EMBED_DIMS;

// Quantize a Float32 unit-ish vector to int8 with a per-vector scale.
function quantize(vec) {
  let max = 1e-8;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i]);
    if (a > max) max = a;
  }
  const scale = max / 127;
  const q = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    q[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / scale)));
  }
  return { q, scale };
}

function dequantDot(qa, scaleA, qb, scaleB) {
  let dot = 0;
  for (let i = 0; i < qa.length; i++) dot += qa[i] * qb[i];
  return dot * scaleA * scaleB;
}

function norm(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  return Math.sqrt(s) || 1e-8;
}

export class VectorStore {
  constructor() {
    // rel -> { mtimeMs, chunks: [{ chunkIdx, text, q, scale, mag }] }
    this.files = new Map();
    this.dims = DIMS;
  }

  async load() {
    try {
      const raw = await fs.readFile(INDEX_FILE, "utf8");
      const data = JSON.parse(raw);
      if (data.dims !== DIMS) return; // dims changed => rebuild
      for (const [rel, entry] of Object.entries(data.files)) {
        this.files.set(rel, entry);
      }
    } catch {
      /* no index yet */
    }
  }

  async save() {
    await fs.mkdir(config.CACHE_DIR, { recursive: true });
    const data = { dims: DIMS, files: Object.fromEntries(this.files) };
    await fs.writeFile(INDEX_FILE, JSON.stringify(data), "utf8");
  }

  has(rel) {
    return this.files.has(rel);
  }

  isFresh(rel, mtimeMs) {
    const e = this.files.get(rel);
    return e && e.mtimeMs === mtimeMs;
  }

  // vecs: Float32Array[] aligned with chunkTexts.
  upsert(rel, mtimeMs, chunkTexts, vecs) {
    const chunks = vecs.map((vec, i) => {
      const { q, scale } = quantize(vec);
      return {
        chunkIdx: i,
        text: chunkTexts[i].slice(0, 300),
        q,
        scale,
        mag: norm(vec),
      };
    });
    this.files.set(rel, { mtimeMs, chunks });
  }

  remove(rel) {
    this.files.delete(rel);
  }

  keys() {
    return [...this.files.keys()];
  }

  // queryVec: Float32Array. Returns [{ rel, score, snippet }] top-k, best chunk per file.
  search(queryVec, topK = 10) {
    const { q: qq, scale: qScale } = quantize(queryVec);
    const qMag = norm(queryVec);
    const best = new Map(); // rel -> { score, snippet }
    for (const [rel, entry] of this.files) {
      for (const c of entry.chunks) {
        const dot = dequantDot(qq, qScale, c.q, c.scale);
        const score = dot / (qMag * c.mag);
        const prev = best.get(rel);
        if (!prev || score > prev.score) {
          best.set(rel, { score, snippet: c.text });
        }
      }
    }
    return [...best.entries()]
      .map(([rel, v]) => ({ rel, score: v.score, snippet: v.snippet }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  stats() {
    let chunks = 0;
    for (const e of this.files.values()) chunks += e.chunks.length;
    return { files: this.files.size, chunks, dims: DIMS };
  }
}

export function indexExists() {
  return fssync.existsSync(INDEX_FILE);
}
