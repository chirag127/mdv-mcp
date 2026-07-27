#!/usr/bin/env node
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
import { Memory } from "./memory.mjs";
import {
  detectFormat, suggestOkfFields, buildOkfFrontmatter,
  isSystemContextFile, extractWikilinks, resolveWikilink,
} from "./formats.mjs";
import { startHttpTransport } from "./http.mjs";
import { install as installOpenCode } from "./opencode.mjs";

const log = (...a) => console.error("[mdv-mcp]", ...a);

const indexer = new Indexer();
const memory = new Memory();

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}

const server = new McpServer({ name: "mdv-mcp", version: "2.0.0" });

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
    const fmt = detectFormat(d);
    const wikilinks = extractWikilinks(d.body);
    return textResult({
      path: d.rel,
      frontmatter: d.frontmatter,
      body: d.body,
      format: fmt,
      wikilinks,
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

server.tool(
  "vault_remember",
  "Save a session conclusion, decision, insight, or todo to persistent memory. " +
    "Survives across sessions. Use at session end or when learning something important.",
  {
    title: z.string().describe("Short summary of the memory"),
    content: z.string().describe("Full text of what was learned/decided"),
    project: z.string().optional().describe("Project subdirectory name, e.g. 'okf'"),
    type: z.enum(["session", "decision", "insight", "bug", "todo"]).default("insight"),
    tags: z.array(z.string()).default([]),
    related: z.array(z.string()).default([]).describe("Vault-relative paths of related notes"),
    source: z.enum(["opencode", "claude-code", "manual"]).default("opencode"),
  },
  async ({ title, content, project, type, tags, related, source }) => {
    const mem = await memory.remember({
      project, type, title, content, tags, related, source,
    });
    return textResult({ saved: true, memory: mem });
  }
);

server.tool(
  "vault_recall",
  "Retrieve past session memories. Use at session start to load context, " +
    "or anytime to find past decisions/insights.",
  {
    query: z.string().optional().describe("Search term to filter memories"),
    project: z.string().optional().describe("Filter by project subdirectory"),
    type: z.enum(["session", "decision", "insight", "bug", "todo"]).optional(),
    limit: z.number().int().min(1).max(50).default(10),
    includeArchived: z.boolean().default(false),
  },
  async ({ query, project, type, limit, includeArchived }) => {
    const results = await memory.recall({
      query, project, type, limit, includeArchived,
    });
    return textResult({
      query: query ?? "(all)",
      project: project ?? "(all)",
      count: results.length,
      memories: results,
    });
  }
);

server.tool(
  "vault_memory_stats",
  "Report memory store statistics: total, active, archived, by project, by type.",
  {},
  async () => {
    const s = await memory.stats();
    return textResult(s);
  }
);

server.tool(
  "vault_memory_archive",
  "Archive a memory by ID (mark as no longer active).",
  { id: z.string().describe("Memory ID to archive") },
  async ({ id }) => {
    const r = await memory.archive(id);
    if (!r) return textResult({ error: "Memory not found", id });
    return textResult({ archived: true, memory: r });
  }
);

server.tool(
  "vault_format",
  "Detect the format of a vault file and suggest OKF frontmatter improvements.",
  { path: z.string().describe("Vault-relative path") },
  async ({ path: p }) => {
    const d = await readDoc(p);
    const fmt = detectFormat(d);
    const suggestions = suggestOkfFields(d);
    const enriched = buildOkfFrontmatter(suggestions, d.frontmatter);
    return textResult({
      path: d.rel,
      format: fmt,
      currentFrontmatter: d.frontmatter,
      suggestedFrontmatter: enriched,
      suggestions,
    });
  }
);

server.tool(
  "vault_wikilinks",
  "Extract and resolve [[wikilinks]] from a vault file.",
  { path: z.string().describe("Vault-relative path") },
  async ({ path: p }) => {
    const d = await readDoc(p);
    const links = extractWikilinks(d.body);
    const allPaths = indexer.docList().map((doc) => doc.rel);
    const resolved = links.map((l) => ({
      ...l,
      resolvedPath: resolveWikilink(l.target, d.rel, allPaths),
    }));
    return textResult({
      path: d.rel,
      count: resolved.length,
      wikilinks: resolved,
    });
  }
);

server.tool(
  "vault_install_opencode",
  "Install mdv-mcp config into a project directory for OpenCode discovery.",
  {
    targetDir: z.string().describe("Project directory to install into"),
    transport: z.enum(["stdio", "http"]).default("stdio"),
  },
  async ({ targetDir, transport }) => {
    const r = await installOpenCode(targetDir, { transport });
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
  await memory.load();
  log(`memories loaded: ${(await memory.stats()).total}`);
  startWatcher();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected over stdio.");

  if (process.env.HTTP_TRANSPORT === "1" || process.env.HTTP_PORT) {
    try {
      await startHttpTransport(server);
    } catch (e) {
      log("HTTP transport failed:", e.message);
    }
  }
}

main().catch((e) => {
  log("FATAL:", e.message);
  process.exit(1);
});
