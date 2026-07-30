// tools/reindex.mjs — vault_reindex + vault_install_opencode
import { z } from "zod";
import { install as installOpenCode } from "../opencode.mjs";

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server */
export function registerAdminTools(server, indexer) {
  server.tool(
    "vault_reindex",
    "Force a full incremental re-embed sync of the vault.",
    {},
    async () => {
      const log = (...a) => console.error("[mdv-mcp:reindex]", ...a);
      const r = await indexer.syncEmbeddings({ log });
      return textResult(r);
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
}

function textResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }] };
}
