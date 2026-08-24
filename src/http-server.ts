#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadProjectEnv } from "./load-env.js";
import { loadAppConfig } from "./config.js";
import { rateLimitKey, verifySharedSecret } from "./http-auth.js";
import { BrowserPool } from "./browser.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { createWebMcpServer } from "./server.js";
import {
  handleStatelessJsonRpc,
  isInitializeRequest,
  jsonRpcError,
  type JsonRpcRequest,
} from "./json-rpc.js";

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
};

async function main() {
  loadProjectEnv();
  const config = loadAppConfig();
  const pool = new BrowserPool(config);
  const limiter = new SlidingWindowLimiter();

  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });
  const sessions: Record<string, SessionEntry> = {};

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "sulus-web-mcp" });
  });

  const gate = (req: import("express").Request, res: Response): boolean => {
    if (!verifySharedSecret(req.headers, config.sharedSecret)) {
      jsonRpcError(res, 401, "Unauthorized");
      return false;
    }
    const key = rateLimitKey(req.headers);
    if (!limiter.allow(key, config.rateLimitPerMinute)) {
      jsonRpcError(res, 429, "Rate limit exceeded. Try again shortly.");
      return false;
    }
    return true;
  };

  const handleMcp = async (
    req: import("express").Request,
    res: Response,
  ) => {
    if (!gate(req, res)) return;

    const body = (req.body ?? {}) as JsonRpcRequest;
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    try {
      const existing = sessionId !== undefined ? sessions[sessionId] : undefined;

      if (existing) {
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions[sid] = { transport };
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions[sid]) delete sessions[sid];
        };

        const server = createWebMcpServer(pool, config);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // ai-phone-system posts tools/list and tools/call with no session.
      if (!sessionId && body.method) {
        const rpc = await handleStatelessJsonRpc(body, pool, config);
        if (rpc.error) {
          res.status(200).json({
            jsonrpc: "2.0",
            error: rpc.error,
            id: body.id ?? null,
          });
          return;
        }
        res.status(200).json({
          jsonrpc: "2.0",
          result: rpc.result,
          id: body.id ?? 1,
        });
        return;
      }

      jsonRpcError(res, 400, "Bad Request: No valid session ID provided", body.id ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, message, body.id ?? null);
      }
    }
  };

  app.post(config.path, handleMcp);

  app.get(config.path, async (req, res) => {
    if (!verifySharedSecret(req.headers, config.sharedSecret)) {
      res.status(401).send("Unauthorized");
      return;
    }
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;
    const entry = sessionId !== undefined ? sessions[sessionId] : undefined;
    if (!entry) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await entry.transport.handleRequest(req, res);
  });

  app.delete(config.path, async (req, res) => {
    if (!verifySharedSecret(req.headers, config.sharedSecret)) {
      res.status(401).send("Unauthorized");
      return;
    }
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;
    const entry = sessionId !== undefined ? sessions[sessionId] : undefined;
    if (!entry) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await entry.transport.handleRequest(req, res);
    if (sessionId && sessions[sessionId]) delete sessions[sessionId];
  });

  const shutdown = async () => {
    await pool.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  app.listen(config.port, config.host, () => {
    console.error(
      `sulus-web-mcp HTTP listening on http://${config.host}:${config.port}${config.path}`,
    );
    if (config.sharedSecret) {
      console.error("Bearer gate enabled via MCP_SHARED_SECRET.");
    } else {
      console.error(
        "Warning: MCP_SHARED_SECRET is not set. Protect this endpoint with a reverse proxy or set a secret.",
      );
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
