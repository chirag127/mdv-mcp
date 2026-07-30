// tools/search.mjs — vault_search + vault_tags + vault_backlinks + vault_stats
import { z } from "zod";
import { config, hasApiKey } from "../config.mjs";
import { extractTags, findBacklinks, toRelative } from "../lib/vault.mjs";

/** @param {import('../lib/indexer.mjs').Indexer} indexer */
export function registerSearchTools(server, indexer) {
  server.tool(
    "vault_search",
    "Semantic + keyword hybrid search across all markdown files. " +
      "Uses NVIDIA nemotron-3-embed-1b embeddings when available, falls back to TF-IDF. " +
      "Returns ranked files with snippets.",
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
    "vault_stats",
    "Report index status: vault root, file/chunk counts, dims, embedding status.",
    {},
    async () =>
      textResult({
        vault: config.VAULT_ROOT,
        embeddingsEnabled: hasApiKey(),
        model: config.EMBED_MODEL,
        ...indexer.store.stats(),
        docsLoaded: indexer.docList().length,
      })
  );
}

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}
