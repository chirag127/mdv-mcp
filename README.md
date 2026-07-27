# mdv-mcp

**Local MCP server for Obsidian/markdown vaults.** Hybrid semantic + keyword
search, OKF frontmatter, wikilinks, persistent memory, live file watcher.

## Install

```bash
npm install -g @chirag127/mdv-mcp
```

Or run directly with `npx`:

```bash
npx -y @chirag127/mdv-mcp
```

## Features

- **Embeddings:** NVIDIA `nemotron-3-embed-1b` via NVIDIA NIM (OpenAI-compatible).
  Multilingual, 2048-dim, `input_type` passage/query handled automatically.
- **Vector store:** pure-JS, on-disk, int8-quantized (~4x smaller than float).
  Incremental — only changed files are re-embedded (keyed by mtime).
- **Hybrid search:** semantic ranking fused with TF-IDF keyword fallback
  (works without API key).
- **Live index:** `chokidar` watcher re-indexes edited files in place.
- **OKF frontmatter:** detect, validate, and enrich Open Knowledge Format metadata.
- **Wikilinks:** extract and resolve `[[wikilinks]]` to vault-relative paths.
- **Persistent memory:** remember decisions, insights, bugs, todos across sessions.

> Your vault is **never uploaded**. Only short text chunks are sent to NVIDIA for
> embedding; vectors are stored locally in `<VAULT_ROOT>/.mdv-cache/vectors.json`.

## Quick Start

```bash
cp .env.example .env        # set NVIDIA_API_KEY=nvapi-...
node src/selftest.mjs       # verify key + embedding round-trip
node src/reindex.mjs        # one-shot full index (incremental afterwards)
node src/index.mjs          # start the MCP server (stdio)
```

## Configure

### OpenCode

```json
"mdv-mcp": {
  "type": "local",
  "command": ["npx", "-y", "@chirag127/mdv-mcp"],
  "env": { "VAULT_ROOT": "/path/to/vault", "NVIDIA_API_KEY": "nvapi-..." }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "mdv-mcp": {
      "command": "npx",
      "args": ["-y", "@chirag127/mdv-mcp"],
      "env": {
        "VAULT_ROOT": "/path/to/vault",
        "NVIDIA_API_KEY": "nvapi-..."
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VAULT_ROOT` | (required) | Path to markdown/Obsidian vault root |
| `NVIDIA_API_KEY` | (optional) | NVIDIA NIM API key for embeddings |
| `NVIDIA_EMBED_MODEL` | `nvidia/nemotron-3-embed-1b` | Embedding model |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA endpoint |
| `MDV_CACHE_DIR` | `<VAULT_ROOT>/.mdv-cache` | Vector index storage |
| `HTTP_TRANSPORT` | (unset) | Set `1` to enable SSE transport |
| `HTTP_PORT` | (unset) | Port for SSE transport |

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
| `vault_remember` | Save a memory (decision, insight, bug, todo) |
| `vault_recall` | Retrieve past memories |
| `vault_memory_stats` | Memory store statistics |
| `vault_memory_archive` | Archive a memory by ID |
| `vault_format` | Detect OKF format + suggest frontmatter improvements |
| `vault_wikilinks` | Extract and resolve [[wikilinks]] |
| `vault_install_opencode` | Install config into a project directory |

## License

MIT
