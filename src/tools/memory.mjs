// tools/memory.mjs — vault_remember + vault_recall + vault_memory_stats + vault_memory_archive
import { z } from "zod";

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server */
export function registerMemoryTools(server, memory) {
  server.tool(
    "vault_remember",
    "Save a session conclusion, decision, insight, or todo to persistent memory. " +
      "Survives across sessions. Use at session end or when learning something important.",
    {
      title:   z.string().describe("Short summary of the memory"),
      content: z.string().describe("Full text of what was learned/decided"),
      project: z.string().optional().describe("Project subdirectory name, e.g. 'okf'"),
      type:    z.enum(["session", "decision", "insight", "bug", "todo"]).default("insight"),
      tags:    z.array(z.string()).default([]),
      related: z.array(z.string()).default([]).describe("Vault-relative paths of related notes"),
      source:  z.enum(["opencode", "claude-code", "manual"]).default("opencode"),
    },
    async ({ title, content, project, type, tags, related, source }) => {
      const mem = await memory.remember({ project, type, title, content, tags, related, source });
      return textResult({ saved: true, memory: mem });
    }
  );

  server.tool(
    "vault_recall",
    "Retrieve past session memories. Use at session start to load context, " +
      "or anytime to find past decisions/insights.",
    {
      query:           z.string().optional().describe("Search term to filter memories"),
      project:         z.string().optional().describe("Filter by project subdirectory"),
      type:            z.enum(["session", "decision", "insight", "bug", "todo"]).optional(),
      limit:           z.number().int().min(1).max(50).default(10),
      includeArchived: z.boolean().default(false),
    },
    async ({ query, project, type, limit, includeArchived }) => {
      const results = await memory.recall({ query, project, type, limit, includeArchived });
      return textResult({ query: query ?? "(all)", project: project ?? "(all)", count: results.length, memories: results });
    }
  );

  server.tool(
    "vault_memory_stats",
    "Report memory store statistics: total, active, archived, by project, by type.",
    {},
    async () => textResult(await memory.stats())
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
}

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}
