import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.js";
import type { BrowserPool } from "./browser.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

export const SERVER_INFO = {
  name: "sulus-web-mcp",
  version: "0.1.0",
};

export function createWebMcpServer(pool: BrowserPool, config: AppConfig): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const result = await executeTool(name, args, pool, config);
    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError,
    };
  });

  return server;
}
