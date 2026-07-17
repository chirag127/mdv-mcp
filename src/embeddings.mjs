// embeddings.mjs — NVIDIA NIM embedding client (nemotron-3-embed-1b).
// OpenAI-compatible /v1/embeddings. Requires input_type: passage|query.
import { config, hasApiKey } from "./config.mjs";

const MAX_BATCH = 64; // NIM accepts arrays; keep batches modest.

async function callEmbeddings(inputs, inputType) {
  if (!hasApiKey()) {
    throw new Error(
      "NVIDIA_API_KEY not set (expected nvapi-...). Semantic search disabled."
    );
  }
  const res = await fetch(`${config.BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      input: inputs,
      model: config.EMBED_MODEL,
      input_type: inputType, // "passage" (index) | "query" (search)
      encoding_format: "float",
      truncate: "END", // clip inputs over max token length instead of erroring
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`NVIDIA embeddings ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = await res.json();
  // Preserve request order via `index`.
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => Float32Array.from(d.embedding));
}

async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      // Don't retry auth errors.
      if (msg.includes("401") || msg.includes("403")) break;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

// Embed an array of passages (for indexing). Returns Float32Array[].
export async function embedPassages(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const vecs = await withRetry(() => callEmbeddings(batch, "passage"));
    out.push(...vecs);
  }
  return out;
}

// Embed a single query string (for search). Returns one Float32Array.
export async function embedQuery(text) {
  const [vec] = await withRetry(() => callEmbeddings([text], "query"));
  return vec;
}
