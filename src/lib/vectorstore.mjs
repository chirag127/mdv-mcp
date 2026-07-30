// lib/vectorstore.mjs — pure-JS on-disk vector index with int8 quantization.
// One entry per chunk: { rel, chunkIdx, mtimeMs, norm, q(int8) }.
// Cosine similarity via dequantized dot product. Local/offline only.
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { config } from "../config.mjs";

const DIMS = config.EMBED_DIMS;

/** @returns {string} */
function indexFile() {
  return path.join(config.CACHE_DIR, "vectors.json");
}

/**
 * Quantize a Float32 unit-ish vector to int8 with per-vector scale.
 * @param {Float32Array} vec
 * @returns {{ q: number[], scale: number }}
 */
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
      const raw = await fs.readFile(indexFile(), "utf8");
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
    await fs.writeFile(indexFile(), JSON.stringify(data), "utf8");
  }

  /** @param {string} rel */
  has(rel) { return this.files.has(rel); }

  /**
   * @param {string} rel
   * @param {number} mtimeMs
   */
  isFresh(rel, mtimeMs) {
    const e = this.files.get(rel);
    return e != null && e.mtimeMs === mtimeMs;
  }

  /**
   * @param {string} rel
   * @param {number} mtimeMs
   * @param {string[]} chunkTexts
   * @param {Float32Array[]} vecs
   */
  upsert(rel, mtimeMs, chunkTexts, vecs) {
    const chunks = vecs.map((vec, i) => {
      const { q, scale } = quantize(vec);
      return { chunkIdx: i, text: chunkTexts[i].slice(0, 300), q, scale, mag: norm(vec) };
    });
    this.files.set(rel, { mtimeMs, chunks });
  }

  /** @param {string} rel */
  remove(rel) { this.files.delete(rel); }

  /** @returns {string[]} */
  keys() { return [...this.files.keys()]; }

  /**
   * Search top-k files by cosine similarity (best chunk per file).
   * @param {Float32Array} queryVec
   * @param {number} topK
   * @returns {{ rel: string, score: number, snippet: string }[]}
   */
  search(queryVec, topK = 10) {
    const { q: qq, scale: qScale } = quantize(queryVec);
    const qMag = norm(queryVec);
    const best = new Map();
    for (const [rel, entry] of this.files) {
      for (const c of entry.chunks) {
        const dot = dequantDot(qq, qScale, c.q, c.scale);
        const score = dot / (qMag * c.mag);
        const prev = best.get(rel);
        if (!prev || score > prev.score) best.set(rel, { score, snippet: c.text });
      }
    }
    return [...best.entries()]
      .map(([rel, v]) => ({ rel, score: v.score, snippet: v.snippet }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** @returns {{ files: number, chunks: number, dims: number }} */
  stats() {
    let chunks = 0;
    for (const e of this.files.values()) chunks += e.chunks.length;
    return { files: this.files.size, chunks, dims: DIMS };
  }
}

/** @returns {boolean} */
export function indexExists() {
  return fssync.existsSync(indexFile());
}
