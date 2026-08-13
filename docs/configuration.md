# Configuration

## Vault root precedence

The vault root is resolved in this order (first match wins):

| Priority | Source | How to set |
|---|---|---|
| 1 | `--vault <path>` CLI arg | `node src/index.mjs --vault /my/notes` |
| 2 | MCP roots capability | Client sends `roots` at initialize |
| 3 | `VAULT_ROOT` env var | `.env` or shell export |
| 4 | `cwd` | Default if nothing else is set |

The server validates the resolved path exists and is a directory at startup. A clear error is printed if not.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VAULT_ROOT` | No (see precedence) | `cwd` | Absolute path to vault |
| `NVIDIA_API_KEY` | No | — | `nvapi-...` key from [build.nvidia.com](https://build.nvidia.com). Without it, TF-IDF fallback is used. |
| `NVIDIA_EMBED_MODEL` | No | `nvidia/nemotron-3-embed-1b` | Embedding model |
| `NVIDIA_BASE_URL` | No | `https://integrate.api.nvidia.com/v1` | NIM endpoint |
| `MDV_CACHE_DIR` | No | `<vault>/.mdv-cache` | Vector index + memory storage directory |
| `HTTP_PORT` | No | — | Set to enable HTTP transport on this port |
| `HTTP_TRANSPORT` | No | — | Set to `1` to enable HTTP transport on default port 3777 |
| `HTTP_HOST` | No | `localhost` | HTTP transport bind host |

Copy `.env.example` to `.env` and fill in values. The server loads `.env` at startup.

## Client config examples

### Claude Code (`~/.claude.json`)

```jsonc
{
  "mcpServers": {
    "mdv-mcp": {
      "command": "npx",
      "args": ["-y", "@chirag127/mdv-mcp", "--vault", "C:/g/md"],
      "env": {
        "NVIDIA_API_KEY": "nvapi-..."
      }
    }
  }
}
```

### OpenCode (`opencode.json`)

```jsonc
{
  "mcpServers": {
    "mdv-mcp": {
      "command": "node",
      "args": ["/path/to/mdv-mcp/src/index.mjs", "--vault", "C:/g/md"],
      "env": {
        "NVIDIA_API_KEY": "nvapi-..."
      }
    }
  }
}
```

### Cursor (`settings.json`)

```jsonc
{
  "mcpServers": {
    "mdv-mcp": {
      "command": "npx",
      "args": ["-y", "@chirag127/mdv-mcp", "--vault", "/Users/you/notes"],
      "env": {
        "NVIDIA_API_KEY": "nvapi-..."
      }
    }
  }
}
```

### Via env var only (no `--vault` arg)

```jsonc
{
  "mcpServers": {
    "mdv-mcp": {
      "command": "npx",
      "args": ["-y", "@chirag127/mdv-mcp"],
      "env": {
        "VAULT_ROOT": "C:/g/md",
        "NVIDIA_API_KEY": "nvapi-..."
      }
    }
  }
}
```

### MCP roots (automatic)

If your client sends workspace roots via the MCP `roots` capability at initialize,
mdv-mcp will use the first root as the vault — no explicit config needed.

## HTTP transport

A first-class Streamable HTTP (MCP 2.0) transport. stdio stays the default;
enable HTTP with the `--http` flag, `HTTP_TRANSPORT=1`, or by setting `HTTP_PORT`:

```bash
node src/index.mjs --http --vault /my/notes
# or
HTTP_PORT=3777 node src/index.mjs --vault /my/notes
# or
npm run start:http -- --vault /my/notes
```

Endpoint: `http://localhost:3777/mcp`. Health check: `http://localhost:3777/health`.

Register in an HTTP-capable MCP client:

```json
{ "type": "http", "url": "http://localhost:3777/mcp" }
```

HTTP binds to `localhost` and serves the local vault — it is not a remote service
unless you deliberately host and secure it (`HTTP_HOST` changes the bind address).

