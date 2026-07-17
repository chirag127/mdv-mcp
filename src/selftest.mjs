#!/usr/bin/env node
// selftest.mjs — verify NVIDIA API key + embedding round-trip work.
import { config, hasApiKey } from "./config.mjs";
import { embedPassages, embedQuery } from "./embeddings.mjs";

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log("mdv-mcp self-test");
  console.log("model:", config.EMBED_MODEL);
  console.log("endpoint:", config.BASE_URL);
  if (!hasApiKey()) {
    console.error("FAIL: NVIDIA_API_KEY missing/invalid (need nvapi-...).");
    process.exit(1);
  }
  const [pDog, pFinance] = await embedPassages([
    "The dog ran across the green park chasing a ball.",
    "Quarterly revenue rose after the new pricing tier launched.",
  ]);
  console.log("passage dims:", pDog.length);
  const q = await embedQuery("a puppy playing outside");
  const simDog = cosine(q, pDog);
  const simFin = cosine(q, pFinance);
  console.log(`cosine(query, dog-passage)     = ${simDog.toFixed(4)}`);
  console.log(`cosine(query, finance-passage) = ${simFin.toFixed(4)}`);
  if (pDog.length !== config.EMBED_DIMS) {
    console.error(`WARN: dims ${pDog.length} != expected ${config.EMBED_DIMS}`);
  }
  if (simDog > simFin) {
    console.log("PASS: semantically relevant passage ranked higher.");
    process.exit(0);
  }
  console.error("FAIL: relevance ordering wrong.");
  process.exit(1);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
