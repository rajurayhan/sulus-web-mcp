# sulus-web-mcp

Stateless **Playwright MCP** for live-web research. Agents get three tools — `browse_page`, `extract_links`, `search_page` — each of which opens a URL, extracts text, and closes the browser context. No click/type/login tools.

Built for Sulus Agents (`ai-phone-system` MCP connectors) and the rest of the ecosystem (Cursor, MCPConnect). Laravel cannot run Chromium in-process; this service is the HTTP MCP those agents call.

## Tools

| Tool | When to use | What it returns |
| --- | --- | --- |
| `browse_page` | Need the content of a public page | Title, final URL, cleaned markdown (or links/title only) |
| `extract_links` | Need outbound links | Markdown list of href + text |
| `search_page` | Need excerpts matching a query | Up to N snippets around the query |

Each call is self-contained (navigate + extract). That matches `ai-phone-system`'s connector client, which POSTs `tools/list` / `tools/call` with **no MCP session**.

## Requirements

- Node.js 20+
- Playwright Chromium (`npx playwright install chromium` after `npm install`)

## Setup

```bash
cd /Users/macbook/Workshop/Sulus.ai/sulus-web-mcp
npm install
npx playwright install chromium
cp .env.example .env
# set MCP_SHARED_SECRET
npm run build
```

### HTTP (Agents, team, production)

```bash
npm run start:http
# or: npm run dev:http
```

Health: `GET /health`  
MCP: `POST /mcp` (JSON-RPC, Streamable HTTP)

| Variable | Description |
| --- | --- |
| `MCP_SHARED_SECRET` | Bearer token required on `/mcp` |
| `MCP_HOST` / `MCP_PORT` / `MCP_PATH` | Bind (default `0.0.0.0:3000/mcp`) |
| `MCP_ALLOWED_HOSTS` | Allowed `Host` header values |
| `ALLOW_INSECURE_HTTP` | Set `true` only for local http:// testing |
| `ALLOW_HOSTS` / `DENY_HOSTS` | Optional host lists |
| `NAVIGATION_TIMEOUT_MS` | Default 25000 (stay under Agents' 60s tool timeout) |
| `BROWSER_MAX_CONCURRENT` | Default 3 |
| `RATE_LIMIT_PER_MINUTE` | Per bearer token, default 30 |
| `MAX_OUTPUT_CHARS` | Default 18000 (Agents truncate at 20k) |

Logs are one JSON line per browse (`url` origin+path, status, ms). Page bodies are never logged.

### Production (`browse.sulus.ai`, same droplet as MiniERP)

Native Node + systemd + nginx — **no Docker**. Runbook, unit file, nginx, and `./deploy.sh`:

**[docs/DEPLOY.md](docs/DEPLOY.md)**

```bash
# On the droplet, as deploy:
cp deploy/vps/env.production.example .env.production   # set MCP_SHARED_SECRET
./deploy.sh
```

### stdio (local Cursor)

```bash
npm run start
```

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sulus-web": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/Users/macbook/Workshop/Sulus.ai/sulus-web-mcp"
    }
  }
}
```

HTTP from Cursor (after deploy):

```json
{
  "mcpServers": {
    "sulus-web": {
      "url": "https://browse.sulus.ai/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SHARED_SECRET"
      }
    }
  }
}
```

## Connect from ai-phone-system Agents

1. Deploy this service behind HTTPS.
2. In **MCP Connectors**, add a custom server:
   - URL: `https://browse.sulus.ai/mcp`
   - Auth: Bearer, token = `MCP_SHARED_SECRET`
3. Enable the connector on the agent.

The HTTP handler answers `tools/list` and `tools/call` **without** `initialize` / `Mcp-Session-Id`, which is what [`ExternalMcpClientService`](../ai-phone-system/app/Services/ExternalMcpClientService.php) sends. Sessionful Streamable HTTP still works for Cursor.

## Safety

- HTTPS only (unless `ALLOW_INSECURE_HTTP=true`)
- Blocks localhost, RFC1918, link-local, CGNAT, cloud metadata hosts
- Resolves DNS and rejects private answers
- Aborts in-page requests to blocked URLs
- New browser context per call — no cookie sharing
- No form-fill / click / file-upload tools

## Scripts

```bash
npm run typecheck
npm test
npm run build
```
