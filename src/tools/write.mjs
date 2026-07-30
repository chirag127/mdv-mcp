// tools/write.mjs — vault_write + vault_delete + vault_format (OKF enrichment)
import { z } from "zod";
import matter from "gray-matter";
import { writeDoc, deleteDoc, readDoc } from "../lib/vault.mjs";
import {
  detectFormat, suggestOkfFields, buildOkfFrontmatter, enrichOkfFrontmatter,
} from "../lib/formats.mjs";

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server */
export function registerWriteTools(server, indexer) {
  server.tool(
    "vault_write",
    "Create or overwrite a markdown file in the vault. Re-indexes it automatically.",
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
    "vault_format",
    "Detect the format of a vault file, validate OKF v0.2 compliance, " +
      "and suggest or apply frontmatter improvements.",
    {
      path: z.string().describe("Vault-relative path"),
      apply: z.boolean().default(false).describe(
        "If true, write the enriched frontmatter back to the file"
      ),
    },
    async ({ path: p, apply }) => {
      const d = await readDoc(p);
      const fmt = detectFormat(d);
      const suggestions = suggestOkfFields(d);
      const enriched = buildOkfFrontmatter(suggestions, d.frontmatter);
      let wrote = false;

      if (apply && suggestions.length > 0) {
        const { changed } = enrichOkfFrontmatter(d);
        if (changed) {
          // Rebuild the file: new frontmatter + existing body
          const newContent = matter.stringify(d.body, enriched);
          await writeDoc(p, newContent, { overwrite: true });
          await indexer.reindexOne(p);
          wrote = true;
        }
      }

      return textResult({
        path: d.rel,
        format: fmt,
        currentFrontmatter: d.frontmatter,
        suggestedFrontmatter: enriched,
        suggestions,
        applied: wrote,
      });
    }
  );
}

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}
