// tools/read.mjs — vault_read + vault_frontmatter + vault_list + vault_wikilinks
import { z } from "zod";
import { readDoc, listDir } from "../lib/vault.mjs";
import { detectFormat, extractWikilinks, resolveWikilink } from "../lib/formats.mjs";

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server */
export function registerReadTools(server, indexer) {
  server.tool(
    "vault_read",
    "Read one markdown file by vault-relative path. Returns frontmatter + body.",
    { path: z.string().describe("Vault-relative path, e.g. okf/index.md") },
    async ({ path: p }) => {
      const d = await readDoc(p);
      const fmt = detectFormat(d);
      const wikilinks = extractWikilinks(d.body);
      return textResult({ path: d.rel, frontmatter: d.frontmatter, body: d.body, format: fmt, wikilinks });
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
    "vault_list",
    "List markdown files, optionally under a subdirectory.",
    { subdir: z.string().default("").describe("Subdir filter, e.g. okf/runbooks") },
    async ({ subdir }) => {
      const files = await listDir(subdir);
      return textResult({ subdir: subdir || "(root)", count: files.length, files });
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
      return textResult({ path: d.rel, count: resolved.length, wikilinks: resolved });
    }
  );
}

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}
