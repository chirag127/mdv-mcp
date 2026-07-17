# mdv-mcp

**Local, private MCP server for a markdown/Obsidian vault.** Hybrid semantic +
keyword search over all your `.md` notes, plus read/write/delete/list/tags/
backlinks tools. No cloud, no npm publish, no telemetry. Runs on your machine only.

- **Embeddings:** NVIDIA `nemotron-3-embed-1b` via NVIDIA NIM
  (`https://integrate.api.nvidia.com/v1`, OpenAI-compatible). Multilingual,
  2048-dim, `input_type` passage/query handled automatically.
- **Vector store:** pure-JS, on-disk, int8-quantized (about 4x smaller than float).
  Incremental — only changed files are re-embedded (keyed by mtime).
- **Hybrid search:** semantic ranking fused with TF-IDF keyword fallback
  (so it still works if the API key is missing).
- **Live index:** `chokidar` watcher re-indexes edited files in place.

> Your vault (with the OKF `knowledge/` tree) is **never uploaded**. Only short
> text chunks are sent to NVIDIA for embedding; the returned vectors are stored
> locally in `<VAULT_ROOT>/.mdv-cache/vectors.json` (gitignored).

## Setup

```bash
npm install
cp .env.example .env        # then set NVIDIA_API_KEY=nvapi-...
node src/selftest.mjs       # verify key + embedding round-trip
node src/reindex.mjs        # one-shot full index (incremental afterwards)
node src/index.mjs          # start the MCP server (stdio)
```

## Configure (OpenCode / Claude Code)

```json
"mdv-mcp": {
  "type": "local",
  "command": ["node", "C:/g/mdv-mcp/src/index.mjs"],
  "env": { "VAULT_ROOT": "C:/g/md", "NVIDIA_API_KEY": "nvapi-..." }
}
```

`VAULT_ROOT` and `NVIDIA_API_KEY` may also live in `.env`.

## Tools

| Tool | Purpose |
|---|---|
| `vault_search` | Hybrid semantic + keyword search to ranked files + snippets |
| `vault_read` | Read one file (frontmatter + body) |
| `vault_write` | Create/overwrite a file (re-indexed) |
| `vault_delete` | Delete a file (index entry removed) |
| `vault_list` | List `.md` files, optional subdir filter |
| `vault_tags` | Aggregate all #tags / frontmatter tags by frequency |
| `vault_backlinks` | Files linking to a given file |
| `vault_frontmatter` | Parsed YAML frontmatter only |
| `vault_stats` | Index status (counts, dims, embedding on/off) |
| `vault_reindex` | Force incremental re-embed sync |

## Notes

- `package.json` is `"private": true`. Nothing is published to npm. Keep it that way.
- The knowledge format follows **OKF (Open Knowledge Format)** already used in the
  vault. Frontmatter stays minimal: `type` required, `title`/`description`/`tags`
  recommended — small, and it improves retrieval.
