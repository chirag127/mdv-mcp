# Development

## Setup

```bash
git clone https://github.com/chirag127/mdv-mcp.git
cd mdv-mcp
npm install
cp .env.example .env
# edit .env — set VAULT_ROOT and optionally NVIDIA_API_KEY
```

## Running

```bash
# Start server (reads vault from .env or --vault arg)
node src/index.mjs --vault /path/to/notes

# Dev mode (auto-restart on file changes)
node --watch src/index.mjs --vault /path/to/notes

# HTTP transport
HTTP_PORT=3777 node src/index.mjs --vault /path/to/notes
```

## Self-test

Verifies config resolution + NVIDIA embedding round-trip:

```bash
node src/selftest.mjs --vault /path/to/notes
```

Without `NVIDIA_API_KEY`, exits with `SKIP` (TF-IDF mode is still functional).

## Reindex

Force a full re-embed of all vault files (no server, no watcher):

```bash
node src/reindex.mjs --vault /path/to/notes
```

Useful after bulk file changes or initial setup when the server was run without a key.

## Project structure

```
src/
  index.mjs          Entrypoint
  config.mjs         Config resolution (--vault / roots / env / cwd)
  server.mjs         McpServer factory
  http.mjs           HTTP transport
  opencode.mjs       Project install helper
  reindex.mjs        CLI reindex
  selftest.mjs       Test runner

  lib/               Core logic (pure, no MCP deps)
    embeddings.mjs
    vectorstore.mjs
    indexer.mjs
    vault.mjs
    formats.mjs
    memory-store.mjs

  tools/             One file per concern, each registers tools onto the server
    search.mjs
    read.mjs
    write.mjs
    memory.mjs
    reindex.mjs

docs/                This documentation
```

## Contributing

1. One module per concern — keep `lib/` pure (no MCP SDK imports).
2. `tools/*.mjs` only import from `lib/` and `config.mjs`.
3. `index.mjs` stays thin — no business logic.
4. Don't break the `vectors.json` format (would invalidate existing caches).
5. Run `node src/selftest.mjs --vault .` before pushing.

## Vault cache

The vector index is stored in `<VAULT_ROOT>/.mdv-cache/` by default:
- `vectors.json` — int8 quantized embeddings
- `memories.json` — persistent memory store

Both are safe to delete (server rebuilds on next start). Add `.mdv-cache` to `.gitignore`.
