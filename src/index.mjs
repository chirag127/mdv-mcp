#!/usr/bin/env node
// index.mjs — thin entrypoint: parse config, wire server, register tools, start.
//
// Vault root precedence (highest → lowest):
//   1. --vault <path>  CLI arg
//   2. MCP roots capability (first root sent by client at initialize)
//   3. VAULT_ROOT env var
//   4. cwd
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import chokidar from "chokidar";

import {
  config, hasApiKey, parseVaultArg, resolveVaultRoot, setRootsVault, validateVaultRoot,
} from "./config.mjs";
import { createServer } from "./server.mjs";
import { Indexer } from "./lib/indexer.mjs";
import { Memory } from "./lib/memory-store.mjs";
import { toRelative } from "./lib/vault.mjs";
import { startHttpTransport } from "./http.mjs";

import { registerSearchTools } from "./tools/search.mjs";
import { registerReadTools }   from "./tools/read.mjs";
import { registerWriteTools }  from "./tools/write.mjs";
import { registerMemoryTools } from "./tools/memory.mjs";
import { registerAdminTools }  from "./tools/reindex.mjs";

const log = (...a) => console.error("[mdv-mcp]", ...a);

// ── file watcher: keep index live ────────────────────────────────────────────
function startWatcher(indexer) {
  const watcher = chokidar.watch(`${config.VAULT_ROOT}/**/*.md`, {
    ignored: /(^|[/\\])(\.git|\.obsidian|node_modules|\.mdv-cache)([/\\]|$)/,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400 },
  });
  watcher
    .on("add",    (p) => indexer.reindexOne(toRelative(p)))
    .on("change", (p) => indexer.reindexOne(toRelative(p)))
    .on("unlink", (p) => indexer.removeOne(toRelative(p)));
  return watcher;
}

async function main() {
  // Create server + transport first so that MCP initialize handshake fires,
  // which lets us call listRoots() to honour the roots precedence rule.
  const server = createServer();
  const transport = new StdioServerTransport();

  // Register all tool groups (indexer/memory not ready yet — that's fine,
  // registrations are closures; init fires before any tool call).
  const indexer = new Indexer();
  const memory  = new Memory();

  registerSearchTools(server, indexer);
  registerReadTools(server, indexer);
  registerWriteTools(server, indexer);
  registerMemoryTools(server, memory);
  registerAdminTools(server, indexer);

  // Connect so the MCP handshake happens.
  await server.connect(transport);
  log("MCP server connected over stdio.");

  // Attempt to read roots from client (some clients populate this).
  // Only do this if --vault was NOT explicitly set.
  if (!parseVaultArg()) {
    try {
      const rootsResult = await server.server.sendRequest(
        { method: "roots/list", params: {} },
        {}
      );
      const roots = rootsResult?.roots;
      if (Array.isArray(roots) && roots.length > 0) {
        const first = roots[0];
        const uri = typeof first === "string" ? first : first?.uri ?? first?.path;
        if (uri) {
          const p = uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : uri;
          setRootsVault(p);
          log(`vault root from MCP roots: ${p}`);
        }
      }
    } catch {
      /* client does not support roots/list — fine */
    }
  }

  // Validate + log the resolved vault root.
  const vaultRoot = resolveVaultRoot();
  try {
    validateVaultRoot(vaultRoot);
  } catch (e) {
    log("ERROR:", e.message);
    process.exit(1);
  }

  log(`vault: ${vaultRoot}`);
  log(`embeddings: ${hasApiKey() ? config.EMBED_MODEL : "DISABLED (no key)"}`);

  const stats = await indexer.init({ embed: hasApiKey() });
  log(`index ready:`, JSON.stringify(stats));

  await memory.load();
  log(`memories loaded: ${(await memory.stats()).total}`);

  startWatcher(indexer);

  if (process.env.HTTP_TRANSPORT === "1" || process.env.HTTP_PORT) {
    try {
      await startHttpTransport(server);
    } catch (e) {
      log("HTTP transport failed:", e.message);
    }
  }
}

main().catch((e) => {
  console.error("[mdv-mcp] FATAL:", e.message);
  process.exit(1);
});
