# mdv-mcp documentation

Local MCP server for Obsidian/markdown vaults — semantic search, OKF frontmatter, memory, live watcher.

## Contents

- [configuration.md](./configuration.md) — vault targeting, env vars, client examples
- [tools.md](./tools.md) — all 16 MCP tools with params + examples
- [architecture.md](./architecture.md) — module map, data flow, vector store, embedding pipeline
- [okf.md](./okf.md) — OKF v0.2 frontmatter support
- [development.md](./development.md) — setup, selftest, reindex, contributing

## Quick start

```jsonc
// Claude Code ~/.claude.json mcpServers entry
"mdv-mcp": {
  "command": "npx",
  "args": ["-y", "@chirag127/mdv-mcp", "--vault", "C:/path/to/vault"],
  "env": { "NVIDIA_API_KEY": "nvapi-..." }
}
```

No NVIDIA key? Server starts in TF-IDF fallback mode — no API needed.
