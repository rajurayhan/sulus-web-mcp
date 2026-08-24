import type { Response } from "express";
import type { AppConfig } from "./config.js";
import type { BrowserPool } from "./browser.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";
import { SERVER_INFO } from "./server.js";

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export function jsonRpcError(
  res: Response,
  status: number,
  message: string,
  id: string | number | null = null,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id,
  });
}

export function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as JsonRpcRequest).method === "initialize";
}

export async function handleStatelessJsonRpc(
  body: JsonRpcRequest,
  pool: BrowserPool,
  config: AppConfig,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const method = body.method ?? "";
  const params = (body.params ?? {}) as Record<string, unknown>;

  if (method === "initialize") {
    return {
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }

  if (method === "notifications/initialized" || method === "ping") {
    return { result: {} };
  }

  if (method === "tools/list") {
    return {
      result: {
        tools: TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};
    const result = await executeTool(name, args, pool, config);
    return {
      result: {
        content: [{ type: "text", text: result.text }],
        isError: result.isError,
      },
    };
  }

  return {
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
