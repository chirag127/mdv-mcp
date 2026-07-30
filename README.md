# mdv-mcp

[![GitHub stars](https://img.shields.io/github/stars/chirag127/mdv-mcp?style=flat-square)](https://github.com/chirag127/mdv-mcp/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)

**Live site:** [mdv-mcp.oriz.in](https://mdv-mcp.oriz.in)

Local MCP server for Obsidian/markdown vaults. NVIDIA nemotron-3-embed-1b
semantic search, pure-JS int8 vector store, OKF v0.2 frontmatter, wikilinks,
persistent memory, live file watcher. Folder-scoped via `--vault` arg or MCP roots.

## Install

```bash
# Run directly (no install needed)
npx -y @chirag127/mdv-mcp --vault /path/to/notes

# Or install globally
npm install -g @chirag127/mdv-mcp
mdv-mcp --vault /path/to/notes
```

## Quick start (Claude Code)

Add to `~/.claude.json`:

```json
"mdv-mcp": {
  "command": "npx",
  "args": ["-y", "@chirag127/mdv-mcp", "--vault", "C:/path/to/notes"],
  "env": { "NVIDIA_API_KEY": "nvapi-..." }
}
```

No NVIDIA key? The server starts in TF-IDF fallback mode — works without any API.

## Vault targeting

Precedence (highest → lowest):

| Priority | Source |
|---|---|
| 1 | `--vault <path>` CLI arg |
| 2 | MCP `roots` capability (first root from client) |
| 3 | `VAULT_ROOT` env var |
| 4 | `cwd` |

## Features

- **Hybrid search** — NVIDIA nemotron-3-embed-1b (2048-dim) + TF-IDF via reciprocal-rank fusion
- **Local vector store** — pure-JS int8-quantized, on-disk, incremental (mtime-keyed)
- **Live watcher** — chokidar keeps the index current on file add/change/delete
- **OKF v0.2 frontmatter** — detect, validate, enrich (apply with `vault_format apply=true`)
- **Wikilinks** — extract + resolve `[[wikilinks]]` to vault-relative paths
- **Persistent memory** — remember decisions/insights/todos across sessions
- **HTTP transport** — optional SSE transport for browser/remote clients

Your vault is never uploaded. Only short text chunks are sent to NVIDIA for embedding; vectors are stored locally in `<VAULT_ROOT>/.mdv-cache/vectors.json`.

## Tools

16 MCP tools. See [docs/tools.md](./docs/tools.md) for full params + examples.

| Tool | Description |
|---|---|
| `vault_search` | Hybrid semantic + keyword search |
| `vault_read` | Read file (frontmatter + body + format + wikilinks) |
| `vault_write` | Create/overwrite file (auto re-indexed) |
| `vault_delete` | Delete file (index entry removed) |
| `vault_list` | List `.md` files, optional subdir filter |
| `vault_tags` | Aggregate all tags by frequency |
| `vault_backlinks` | Files linking to a given file |
| `vault_frontmatter` | Parsed YAML frontmatter only |
| `vault_stats` | Index status (vault root, dims, embedding mode) |
| `vault_reindex` | Force incremental re-embed sync |
| `vault_remember` | Save persistent memory |
| `vault_recall` | Retrieve past memories |
| `vault_memory_stats` | Memory store statistics |
| `vault_memory_archive` | Archive a memory by ID |
| `vault_format` | OKF validation + enrichment (apply=true writes back) |
| `vault_wikilinks` | Extract + resolve [[wikilinks]] |

## Docs

- [Configuration](./docs/configuration.md) — env vars, client examples, HTTP transport
- [Tools](./docs/tools.md) — all 16 tools with params + returns
- [Architecture](./docs/architecture.md) — module map, vector store format, data flow
- [OKF frontmatter](./docs/okf.md) — OKF v0.2 schema, validation, enrichment
- [Development](./docs/development.md) — setup, selftest, reindex, contributing

## Self-test

```bash
node src/selftest.mjs --vault /path/to/notes
```

Verifies config resolution and (if key present) NVIDIA embedding round-trip.

## License

MIT
