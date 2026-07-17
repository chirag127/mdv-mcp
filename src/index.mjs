#!/usr/bin/env node
// mdv-mcp — local, private MCP server for a markdown/Obsidian vault.
// Semantic search via NVIDIA nemotron-3-embed-1b + TF-IDF hybrid.
// Tools: vault_search, vault_read, vault_write, vault_delete,
//        vault_list, vault_tags, vault_backlinks, vault_frontmatter,
//        vault_stats, vault_reindex.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import chokidar from "chokidar";
import { config, hasApiKey } from "./config.mjs";
import {
  readDoc, writeDoc, deleteDoc, listDir, toRelative,
  extractTags, findBacklinks, VAULT_ROOT,
} from "./vault.mjs";
import { Indexer } from "./indexer.mjs";

const log = (...a) => console.error("[mdv-mcp]", ...a);

const indexer = new Indexer();

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}

const server = new McpServer({ name: "mdv-mcp", version: "1.0.0" });

server.tool(
  "vault_search",
  "Semantic + keyword hybrid search across all markdown files. " +
    "Uses NVIDIA nemotron-3-embed-1b embeddings when available, " +
    "falls back to TF-IDF. Returns ranked files with snippets.",
  {
    query: z.string().describe("Natural-language or keyword query"),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ query, limit }) => {
    const results = await indexer.search(query, limit);
    return textResult({ query, count: results.length, results });
  }
);

server.tool(
  "vault_read",
  "Read one markdown file by vault-relative path. Returns frontmatter + body.",
  { path: z.string().describe("Vault-relative path, e.g. okf/index.md") },
  async ({ path: p }) => {
    const d = await readDoc(p);
    return textResult({
      path: d.rel,
      frontmatter: d.frontmatter,
      body: d.body,
    });
  }
);

server.tool(
  "vault_write",
  "Create or overwrite a markdown file in the vault. Re-indexes it.",
  {
    path: z.string().describe("Vault-relative path"),
    content: z.string().describe("Full file content (incl. frontmatter)"),
    overwrite: z.boolean().default(true),
  },
  async ({ path: p, content, overwrite }) => {
    const r = await writeDoc(p, content, { overwrite });
    await indexer.reindexOne(r.rel);
    return textResult({ written: r.rel, bytes: r.bytes });
  }
);

server.tool(
  "vault_delete",
  "Delete a markdown file from the vault and its index entry.",
  { path: z.string().describe("Vault-relative path") },
  async ({ path: p }) => {
    const r = await deleteDoc(p);
    await indexer.removeOne(r.rel);
    return textResult({ deleted: r.rel });
  }
);

server.tool(
  "vault_list",
  "List markdown files, optionally under a subdirectory.",
  {
    subdir: z.string().default("").describe("Subdir filter, e.g. okf/runbooks"),
  },
  async ({ subdir }) => {
    const files = await listDir(subdir);
    return textResult({ subdir: subdir || "(root)", count: files.length, files });
  }
);

server.tool(
  "vault_tags",
  "Aggregate all #tags and frontmatter tags across the vault by frequency.",
  {},
  async () => {
    const counts = Object.create(null);
    for (const d of indexer.docList()) {
      for (const t of extractTags(d.frontmatter, d.body)) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    const tags = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
    return textResult({ count: tags.length, tags });
  }
);

server.tool(
  "vault_backlinks",
  "Find all files that link to the given file ([[wikilink]] or [](path)).",
  { path: z.string().describe("Vault-relative path of the target file") },
  async ({ path: p }) => {
    const rel = toRelative(p);
    const links = findBacklinks(rel, indexer.docList());
    return textResult({ target: rel, count: links.length, backlinks: links });
  }
);

server.tool(
  "vault_frontmatter",
  "Read just the parsed YAML frontmatter of a file (no body).",
  { path: z.string().describe("Vault-relative path") },
  async ({ path: p }) => {
    const d = await readDoc(p);
    return textResult({ path: d.rel, frontmatter: d.frontmatter });
  }
);

server.tool(
  "vault_stats",
  "Report index status: file/chunk counts, dims, embedding status.",
  {},
  async () => {
    return textResult({
      vault: VAULT_ROOT,
      embeddingsEnabled: hasApiKey(),
      model: config.EMBED_MODEL,
      ...indexer.store.stats(),
      docsLoaded: indexer.docList().length,
    });
  }
);

server.tool(
  "vault_reindex",
  "Force a full incremental re-embed sync of the vault.",
  {},
  async () => {
    const r = await indexer.syncEmbeddings({ log });
    return textResult(r);
  }
);

// ── file watcher: keep index live ────────────────────────────────────────────
function startWatcher() {
  const watcher = chokidar.watch(`${VAULT_ROOT}/**/*.md`, {
    ignored: /(^|[/\\])(\.git|\.obsidian|node_modules|\.mdv-cache)([/\\]|$)/,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400 },
  });
  watcher
    .on("add", (p) => indexer.reindexOne(toRelative(p)))
    .on("change", (p) => indexer.reindexOne(toRelative(p)))
    .on("unlink", (p) => indexer.removeOne(toRelative(p)));
  return watcher;
}

async function main() {
  log(`vault: ${VAULT_ROOT}`);
  log(`embeddings: ${hasApiKey() ? config.EMBED_MODEL : "DISABLED (no key)"}`);
  const stats = await indexer.init({ embed: hasApiKey() });
  log(`index ready:`, JSON.stringify(stats));
  startWatcher();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected over stdio.");
}

main().catch((e) => {
  log("FATAL:", e.message);
  process.exit(1);
});
