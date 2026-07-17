// indexer.mjs — builds/maintains the vector index + in-memory doc cache.
import fs from "node:fs/promises";
import { config, hasApiKey } from "./config.mjs";
import {
  walkVault, readDoc, toRelative, chunkText,
} from "./vault.mjs";
import { embedPassages, embedQuery } from "./embeddings.mjs";
import { VectorStore } from "./vectorstore.mjs";

export class Indexer {
  constructor() {
    this.store = new VectorStore();
    this.docs = new Map(); // rel -> { rel, raw, body, frontmatter }
    this.ready = false;
  }

  async loadDocs() {
    this.docs.clear();
    const files = await walkVault();
    for (const abs of files) {
      const rel = toRelative(abs);
      try {
        const d = await readDoc(rel);
        this.docs.set(rel, d);
      } catch {
        /* skip unreadable */
      }
    }
  }

  async init({ embed = true } = {}) {
    await this.store.load();
    await this.loadDocs();
    if (embed && hasApiKey()) {
      await this.syncEmbeddings();
    }
    this.ready = true;
    return this.store.stats();
  }

  // Embed any new/changed files; drop deleted ones. Incremental.
  async syncEmbeddings({ log = () => {} } = {}) {
    if (!hasApiKey()) return { skipped: "no-api-key" };
    let changed = 0;
    const seen = new Set();
    for (const [rel, doc] of this.docs) {
      seen.add(rel);
      const stat = await fs.stat(doc.abs);
      if (this.store.isFresh(rel, stat.mtimeMs)) continue;
      const chunks = buildChunks(doc);
      if (chunks.length === 0) {
        // Nothing embeddable (empty/whitespace-only). Mark as seen so we
        // don't retry every run, but store no vectors.
        this.store.upsert(rel, stat.mtimeMs, [], []);
        continue;
      }
      log(`embed ${rel} (${chunks.length} chunks)`);
      const vecs = await embedPassages(chunks);
      this.store.upsert(rel, stat.mtimeMs, chunks, vecs);
      changed++;
      // Persist periodically so long runs are resumable.
      if (changed % 25 === 0) await this.store.save();
    }
    // Remove index entries for deleted files.
    for (const rel of this.store.keys()) {
      if (!seen.has(rel)) this.store.remove(rel);
    }
    await this.store.save();
    return { changed, ...this.store.stats() };
  }

  async reindexOne(rel) {
    try {
      const doc = await readDoc(rel);
      this.docs.set(rel, doc);
      if (hasApiKey()) {
        const stat = await fs.stat(doc.abs);
        const chunks = buildChunks(doc);
        if (chunks.length === 0) {
          this.store.upsert(rel, stat.mtimeMs, [], []);
        } else {
          const vecs = await embedPassages(chunks);
          this.store.upsert(rel, stat.mtimeMs, chunks, vecs);
        }
        await this.store.save();
      }
    } catch {
      /* file may have been deleted between event and read */
    }
  }

  async removeOne(rel) {
    this.docs.delete(rel);
    this.store.remove(rel);
    await this.store.save();
  }

  docList() {
    return [...this.docs.values()];
  }

  // Hybrid search: semantic (if key) merged with TF-IDF keyword fallback.
  async search(query, limit = 10) {
    const tfidf = this.tfidfSearch(query, limit * 2);
    if (!hasApiKey()) {
      return tfidf.slice(0, limit).map((r) => ({ ...r, via: "tfidf" }));
    }
    const qvec = await embedQuery(query);
    const sem = this.store.search(qvec, limit * 2);
    // Reciprocal-rank fusion.
    const scores = new Map();
    const meta = new Map();
    sem.forEach((r, i) => {
      scores.set(r.rel, (scores.get(r.rel) ?? 0) + 1 / (60 + i));
      meta.set(r.rel, { snippet: r.snippet, sem: r.score });
    });
    tfidf.forEach((r, i) => {
      scores.set(r.rel, (scores.get(r.rel) ?? 0) + 1 / (60 + i));
      if (!meta.has(r.rel)) meta.set(r.rel, { snippet: r.snippet });
    });
    return [...scores.entries()]
      .map(([rel, score]) => ({ rel, score, ...meta.get(rel), via: "hybrid" }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  tfidfSearch(query, topK = 10) {
    const qTokens = new Set(
      query.toLowerCase().match(/\b\w+\b/g) ?? []
    );
    if (qTokens.size === 0) return [];
    const out = [];
    for (const { rel, raw } of this.docs.values()) {
      const tokens = raw.toLowerCase().match(/\b\w+\b/g) ?? [];
      const total = tokens.length || 1;
      const freq = Object.create(null);
      for (const t of tokens) freq[t] = (freq[t] ?? 0) + 1;
      let score = 0;
      for (const qt of qTokens) if (freq[qt]) score += freq[qt] / total;
      const name = rel.toLowerCase();
      for (const qt of qTokens) if (name.includes(qt)) score += 0.5;
      if (score > 0) {
        out.push({ rel, score, snippet: snippet(raw, qTokens) });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

function buildChunks(doc) {
  const head = (doc.frontmatter?.title ?? "").trim();
  const text = head ? `${head}\n${doc.body}` : doc.body;
  const chunks = chunkText(text).filter((c) => c.trim().length > 0);
  return chunks;
}

function snippet(text, qTokens, win = 200) {
  const lower = text.toLowerCase();
  let best = -1;
  for (const qt of qTokens) {
    const i = lower.indexOf(qt);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  if (best === -1) return text.slice(0, win).replace(/\s+/g, " ");
  return text.slice(Math.max(0, best - 60), best + win - 60)
    .replace(/\s+/g, " ");
}
