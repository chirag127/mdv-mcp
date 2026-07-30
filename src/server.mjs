// server.mjs — MCP server factory.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SERVER_VERSION = "3.0.0";

/**
 * Create and return a configured McpServer instance.
 * @returns {McpServer}
 */
export function createServer() {
  return new McpServer({
    name: "mdv-mcp",
    version: SERVER_VERSION,
  });
}
