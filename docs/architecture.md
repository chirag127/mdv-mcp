# Architecture

## Module map

```
src/
  index.mjs          Thin entrypoint: parse config, wire server, register tools, start watcher
  config.mjs         All config resolution: --vault arg / MCP roots / VAULT_ROOT env / cwd
  server.mjs         McpServer factory
  http.mjs           Optional HTTP/SSE transport (StreamableHTTPServerTransport)
  opencode.mjs       Install helper: opencode.json + AGENTS.md + skill file generator
  reindex.mjs        One-shot CLI reindex (no server, no watcher)
  selftest.mjs       Startup config + NVIDIA embedding round-trip test

  lib/
    embeddings.mjs   NVIDIA NIM client — embedPassages() + embedQuery()
    vectorstore.mjs  Pure-JS on-disk int8 vector index — VectorStore class
    indexer.mjs      Orchestrates vectorstore + vault walker + hybrid search — Indexer class
    vault.mjs        Markdown I/O: readDoc/writeDoc/deleteDoc/listDir/walkVault/chunkText
    formats.mjs      Format detection, OKF v0.2 validation/enrichment, wikilink parsing
    memory-store.mjs Persistent JSON memory — Memory class

  tools/
    search.mjs       vault_search, vault_tags, vault_backlinks, vault_stats
    read.mjs         vault_read, vault_frontmatter, vault_list, vault_wikilinks
    write.mjs        vault_write, vault_delete, vault_format
    memory.mjs       vault_remember, vault_recall, vault_memory_stats, vault_memory_archive
    reindex.mjs      vault_reindex, vault_install_opencode
```

## Data flow

```
Client ──(stdio/HTTP)──► index.mjs
                            │
                            ├── config.mjs        resolves vault root
                            ├── Indexer.init()    walks vault, loads vectorstore
                            ├── Memory.load()     reads memories.json
                            └── chokidar watcher  live re-index on fs change

Tool call ──► tools/*.mjs
                  │
                  ├── lib/vault.mjs      readDoc / writeDoc / listDir
                  ├── lib/indexer.mjs    search / reindexOne / removeOne
                  ├── lib/formats.mjs    detectFormat / suggestOkfFields
                  └── lib/memory-store.mjs  remember / recall
```

## Vector store format

File: `<CACHE_DIR>/vectors.json`

```jsonc
{
  "dims": 2048,
  "files": {
    "okf/index.md": {
      "mtimeMs": 1722000000000,
      "chunks": [
        {
          "chunkIdx": 0,
          "text": "first 300 chars of chunk for snippet display",
          "q": [12, -34, ...],    // int8 quantized vector (2048 values)
          "scale": 0.0078,        // dequant scale factor
          "mag": 0.9987           // original vector norm
        }
      ]
    }
  }
}
```

- Quantization: per-vector int8 with scale = max(|v|) / 127
- Similarity: cosine via dequantized dot product
- One entry per file; multiple chunks per file (best chunk wins per query)
- Incremental: only changed files (by mtimeMs) are re-embedded

## Embedding pipeline

1. `walkVault()` — collect all `.md` files
2. `readDoc()` — parse frontmatter + body via gray-matter
3. `chunkText()` — split body into overlapping chunks (4000 chars, 400 overlap; prefers paragraph breaks)
4. `embedPassages()` — batched NVIDIA NIM calls (max 64 per request), with 3-retry backoff
5. `VectorStore.upsert()` — quantize + store; save to `vectors.json`

Query path:
1. `embedQuery()` — single NIM call with `input_type: "query"`
2. `VectorStore.search()` — dequantized cosine over all chunks, best per file
3. `Indexer.tfidfSearch()` — token frequency over raw doc text + filename bonus
4. Reciprocal-rank fusion — merge semantic + TF-IDF scores (k=60)

## Memory store format

File: `<CACHE_DIR>/memories.json`

```jsonc
[
  {
    "id": "lnp7k2-abc123",
    "timestamp": "2026-07-30T10:00:00.000Z",
    "project": "okf",
    "type": "decision",
    "title": "...",
    "content": "...",
    "tags": ["..."],
    "related": ["okf/index.md"],
    "source": "claude-code",
    "status": "active"
  }
]
```

Status values: `active`, `archived`, `superseded`.
