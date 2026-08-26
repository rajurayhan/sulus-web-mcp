# sulus-web-mcp VPS deployment (`browse.sulus.ai`)

Docker Compose + nginx on the same Ubuntu VPS as MCPConnect (`mcp.sulus.ai` / `connect.sulus.ai`) and SulusPin (`pins.sulus.ai`). Chromium ships in the official Playwright image — do not run headless Chrome on the host.

| Host | Upstream | Role |
| --- | --- | --- |
| `mcp.sulus.ai` | `127.0.0.1:3000` | MCPConnect dashboard (existing) |
| `connect.sulus.ai` | `127.0.0.1:8790` | MCP plane (existing) |
| `pins.sulus.ai` | `127.0.0.1:7300` | SulusPin (existing) |
| `browse.sulus.ai` | `127.0.0.1:3100` | **sulus-web-mcp** (this service) |

Public URL: `https://browse.sulus.ai/mcp`  
Health: `https://browse.sulus.ai/health` (no bearer)

Templates live under [`deploy/vps/`](../deploy/vps/).

---

## Prerequisites

- Ubuntu VPS with **Docker Engine + Compose plugin**, **nginx**, and **certbot**
- Linux user that owns the app (examples use `deploy`) and is in the `docker` group
- DNS **A/AAAA** for `browse.sulus.ai` → this server
- At least **2 GB RAM** free for Chromium (`shm_size: 1gb` is required)

```bash
# Docker access for deploy (once)
sudo usermod -aG docker deploy
# re-login as deploy after this
```

Do **not** publish port 3100 on the public interface. The prod overlay binds `127.0.0.1` only; nginx terminates TLS.

---

## 1. Clone

```bash
sudo mkdir -p /var/www/sulus-web-mcp
sudo chown deploy:deploy /var/www/sulus-web-mcp
sudo -iu deploy bash -lc '
  cd /var/www/sulus-web-mcp
  git clone git@github.com:rajurayhan/sulus-web-mcp.git .
'
```

HTTPS if `deploy` has no GitHub SSH key:

```bash
git clone https://github.com/rajurayhan/sulus-web-mcp.git .
```

---

## 2. Production env

```bash
sudo -iu deploy bash -lc '
  cd /var/www/sulus-web-mcp
  cp deploy/vps/env.production.example .env
  # edit .env — set MCP_SHARED_SECRET (openssl rand -hex 32)
'
```

| Variable | Production value |
| --- | --- |
| `MCP_SHARED_SECRET` | Long random secret. Required. Clients send `Authorization: Bearer <secret>` |
| `MCP_PORT` | **Host** port, default `3100` (container still listens on `3000`) |
| `MCP_ALLOWED_HOSTS` | `browse.sulus.ai` |
| `ALLOW_INSECURE_HTTP` | `false` |
| `NAVIGATION_TIMEOUT_MS` / `TOOL_TIMEOUT_MS` | Keep under Agents' 60s `tools/call` timeout |

Never commit `.env`. `deploy.sh` refuses to start if the secret is missing or still a placeholder.

---

## 3. First start

```bash
sudo -iu deploy bash /var/www/sulus-web-mcp/deploy/vps/deploy.sh
```

That pulls, builds the Playwright image, starts the container, and waits for `GET /health`.

Loopback smoke test:

```bash
curl -fsS http://127.0.0.1:3100/health
# {"status":"ok","service":"sulus-web-mcp"}
```

Logs:

```bash
cd /var/www/sulus-web-mcp
docker compose -f compose.yaml -f deploy/vps/compose.prod.yaml logs -f web-mcp
```

---

## 4. nginx

```bash
sudo cp /var/www/sulus-web-mcp/deploy/vps/nginx-browse.sulus.ai.conf \
  /etc/nginx/sites-available/browse.sulus.ai
sudo ln -sf /etc/nginx/sites-available/browse.sulus.ai /etc/nginx/sites-enabled/browse.sulus.ai
sudo nginx -t && sudo systemctl reload nginx
curl -fsS http://browse.sulus.ai/health
```

`/mcp` is proxied with buffering off and a 90s read timeout (browse + extract can take ~45s). Everything else returns 404.

---

## 5. TLS

```bash
sudo certbot --nginx -d browse.sulus.ai
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://browse.sulus.ai/health
```

If certbot does not rewrite the vhost, uncomment the HTTPS block in `deploy/vps/nginx-browse.sulus.ai.conf` and turn port 80 into a redirect.

---

## 6. Connect clients

### ai-phone-system Agents

1. **MCP Connectors** → add a custom server
2. URL: `https://browse.sulus.ai/mcp`
3. Auth: Bearer, token = `MCP_SHARED_SECRET`
4. Enable the connector on the agent

The HTTP handler answers `tools/list` and `tools/call` without `initialize` / `Mcp-Session-Id`.

### Cursor (HTTP)

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

### MCPConnect

Same URL + bearer token as a custom HTTPS MCP server. Do not put the secret in logs or the browser.

Tools: `browse_page`, `extract_links`, `search_page`.

---

## 7. Updates

Same two-step pattern as MCPConnect / SulusPin:

```bash
# As deploy — pull + rebuild image
sudo -iu deploy bash /var/www/sulus-web-mcp/deploy/vps/deploy.sh

# Restart only (no rebuild)
sudo bash /var/www/sulus-web-mcp/deploy/vps/restart-services.sh
```

| Var | Effect |
| --- | --- |
| `SKIP_PULL=1` | Skip `git pull` |
| `SKIP_BUILD=1` | Recreate from the current image (no `--build`) |

```bash
sudo -iu deploy env SKIP_PULL=1 bash /var/www/sulus-web-mcp/deploy/vps/deploy.sh
```

Ensure Docker starts on boot so `restart: unless-stopped` brings the container back:

```bash
sudo systemctl enable --now docker
```

---

## 8. Firewall

- Do **not** open port **3100** publicly. Compose binds `127.0.0.1`.
- Public traffic only via nginx on 80/443 for `browse.sulus.ai`.

---

## 9. Server config reference

| File | Purpose |
| --- | --- |
| [`deploy/vps/env.production.example`](../deploy/vps/env.production.example) | Production `.env` template |
| [`deploy/vps/compose.prod.yaml`](../deploy/vps/compose.prod.yaml) | Loopback publish on host `:3100` |
| [`deploy/vps/nginx-browse.sulus.ai.conf`](../deploy/vps/nginx-browse.sulus.ai.conf) | TLS-ready nginx vhost |
| [`deploy/vps/deploy.sh`](../deploy/vps/deploy.sh) | Pull, build, start, health-check |
| [`deploy/vps/restart-services.sh`](../deploy/vps/restart-services.sh) | Restart container + health-check |
| [`compose.yaml`](../compose.yaml) | Base image, `shm_size`, in-container `:3000` |
| [`Dockerfile`](../Dockerfile) | Playwright `v1.62.1-noble` + `node dist/http-server.js` |

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Health fails after deploy | `docker compose -f compose.yaml -f deploy/vps/compose.prod.yaml logs --tail 80 web-mcp` |
| `401` on `/mcp` | Bearer token must match `MCP_SHARED_SECRET` exactly |
| `Host not allowed` | Add the public hostname to `MCP_ALLOWED_HOSTS` |
| Browser launch / crash | Confirm `shm_size: 1gb`; add RAM or lower `BROWSER_MAX_CONCURRENT` |
| Agent tool timeout | Keep `TOOL_TIMEOUT_MS` ≤ 45000; nginx `proxy_read_timeout` is 90s |
| Port already in use | Another service on `3100` — change `MCP_PORT` in `.env` **and** the nginx `upstream` |
| Container not after reboot | `sudo systemctl enable docker` |

Local (non-VPS) run remains `npm run start:http` or `docker compose up` — see [README.md](../README.md).
