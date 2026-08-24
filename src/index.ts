#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadProjectEnv } from "./load-env.js";
import { loadAppConfig } from "./config.js";
import { BrowserPool } from "./browser.js";
import { createWebMcpServer } from "./server.js";

async function main() {
  loadProjectEnv();
  const config = loadAppConfig();
  const pool = new BrowserPool(config);
  const server = createWebMcpServer(pool, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
