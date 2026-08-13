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

## Transports

mdv-mcp speaks two MCP transports. **stdio is the default** and needs no flags —
it is what the Claude Code / Cursor configs above use.

### stdio (default)

```bash
npx -y @chirag127/mdv-mcp --vault /path/to/notes
```

### Streamable HTTP (MCP 2.0)

A first-class, spec-correct Streamable HTTP transport (session management via the
`mcp-session-id` header; `POST`/`GET`/`DELETE` on `/mcp`; CORS enabled). Enable it
with the `--http` flag, the `HTTP_TRANSPORT=1` env var, or by setting `HTTP_PORT`:

```bash
# any of these enables HTTP (default host localhost, port 3777)
npm run start:http -- --vault /path/to/notes
node src/index.mjs --http --vault /path/to/notes
HTTP_TRANSPORT=1 node src/index.mjs --vault /path/to/notes
HTTP_PORT=3777 node src/index.mjs --vault /path/to/notes
```

Endpoints:

| Route | Method(s) | Purpose |
|---|---|---|
| `/mcp` | POST / GET / DELETE | MCP Streamable HTTP endpoint (session-managed) |
| `/health` | GET | Liveness probe → `{ "status": "ok", ... }` |

Register it in an HTTP-capable MCP client with:

```json
{ "type": "http", "url": "http://localhost:3777/mcp" }
```

> **Local by design.** HTTP runs on `localhost` and serves the *local* vault
> (the machine's own file index + memory store) — it is not a public/remote
> service unless you deliberately host it behind a reverse proxy and secure it.
> Point `HTTP_HOST` elsewhere only if you understand the exposure.



- **Hybrid search** — NVIDIA nemotron-3-embed-1b (2048-dim) + TF-IDF via reciprocal-rank fusion
- **Local vector store** — pure-JS int8-quantized, on-disk, incremental (mtime-keyed)
- **Live watcher** — chokidar keeps the index current on file add/change/delete
- **OKF v0.2 frontmatter** — detect, validate, enrich (apply with `vault_format apply=true`)
- **Wikilinks** — extract + resolve `[[wikilinks]]` to vault-relative paths
- **Persistent memory** — remember decisions/insights/todos across sessions
- **Dual transport** — stdio by default; first-class Streamable HTTP (MCP 2.0) via `--http`

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
