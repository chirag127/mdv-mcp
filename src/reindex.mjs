#!/usr/bin/env node
// reindex.mjs — one-shot full index build (no server / no watcher).
import { Indexer } from "./indexer.mjs";

const t0 = Date.now();
const indexer = new Indexer();
await indexer.store.load();
await indexer.loadDocs();
console.error(`[reindex] docs loaded: ${indexer.docList().length}`);
const r = await indexer.syncEmbeddings({ log: (m) => console.error("[reindex]", m) });
console.error(`[reindex] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, r);
