# sulus-web-mcp deployment (`browse.sulus.ai`)

Manual **Node.js + systemd + nginx** on the **same DigitalOcean droplet as MiniERP**. No Docker.

| Host | Upstream | systemd | App dir |
| --- | --- | --- | --- |
| `erp.sulus.ai` | `127.0.0.1:3010` | `minierp.service` | `/var/www/minierp` |
| `browse.sulus.ai` | `127.0.0.1:3100` | `sulus-web-mcp.service` | `/var/www/sulus-web-mcp` |

Public URL: `https://browse.sulus.ai/mcp`  
Health: `https://browse.sulus.ai/health` (no bearer)

Templates: [`deploy/vps/`](../deploy/vps/). Day-2 updates: [`./deploy.sh`](../deploy.sh) (same pattern as MiniERP).

---

## Prerequisites

- The MiniERP droplet (Ubuntu, nginx, certbot, `deploy` user, Node 20+)
- DNS **A/AAAA** for `browse.sulus.ai` → that droplet
- ~2 GB RAM free for Chromium
- Playwright OS libs once: `sudo npx playwright install-deps chromium`

Do **not** open port **3100** publicly. systemd binds `127.0.0.1`. nginx terminates TLS.

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

## 2. Playwright OS dependencies (once)

As root, on the droplet (installs Chromium system libraries, not the browser itself):

```bash
cd /var/www/sulus-web-mcp
sudo npx playwright install-deps chromium
```

`deploy.sh` then installs the browser binary as `deploy` into `.playwright/`.

---

## 3. Production env

```bash
sudo -iu deploy bash -lc '
  cd /var/www/sulus-web-mcp
  cp deploy/vps/env.production.example .env.production
  chmod 600 .env.production
'
```

Set `MCP_SHARED_SECRET`:

```bash
openssl rand -hex 32
# paste into .env.production
```

| Variable | Production value |
| --- | --- |
| `MCP_SHARED_SECRET` | Long random secret. Clients send `Authorization: Bearer <secret>` |
| `MCP_HOST` | `127.0.0.1` |
| `MCP_PORT` | `3100` (MiniERP uses `3010`) |
| `MCP_ALLOWED_HOSTS` | `browse.sulus.ai` |
| `ALLOW_INSECURE_HTTP` | `false` |

`deploy.sh` refuses to start if the secret is missing or still a placeholder.

---

## 4. systemd

```bash
sudo cp /var/www/sulus-web-mcp/deploy/vps/sulus-web-mcp.service \
  /etc/systemd/system/sulus-web-mcp.service
sudo systemctl daemon-reload
sudo systemctl enable sulus-web-mcp
```

If `node` is not `/usr/bin/node`:

```bash
sudo -iu deploy bash -lc 'which node'
# edit ExecStart= in the unit, then daemon-reload
```

First build + start:

```bash
sudo -iu deploy bash /var/www/sulus-web-mcp/deploy.sh
sudo systemctl status sulus-web-mcp --no-pager
curl -fsS http://127.0.0.1:3100/health
```

Logs:

```bash
journalctl -u sulus-web-mcp -f
```

---

## 5. nginx

```bash
sudo cp /var/www/sulus-web-mcp/deploy/vps/nginx-browse.sulus.ai.conf \
  /etc/nginx/sites-available/browse.sulus.ai
sudo ln -sf /etc/nginx/sites-available/browse.sulus.ai /etc/nginx/sites-enabled/browse.sulus.ai
sudo nginx -t && sudo systemctl reload nginx
curl -fsS http://browse.sulus.ai/health
```

`/mcp` is proxied with buffering off and a 90s read timeout. Everything else returns 404.

---

## 6. TLS

```bash
sudo certbot --nginx -d browse.sulus.ai
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://browse.sulus.ai/health
```

---

## 7. Connect clients

### ai-phone-system Agents

1. **MCP Connectors** → add a custom server
2. URL: `https://browse.sulus.ai/mcp`
3. Auth: Bearer, token = `MCP_SHARED_SECRET`
4. Enable the connector on the agent

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

Tools: `browse_page`, `extract_links`, `search_page`.

---

## 8. Updates

Same as MiniERP (`./deploy.sh` on the droplet):

```bash
cd /var/www/sulus-web-mcp
./deploy.sh
```

That fetches `main`, `npm ci`, installs Chromium if needed, builds, restarts `sulus-web-mcp`, and checks `/health`.

| Flag | Effect |
| --- | --- |
| `--no-pull` | Skip `git fetch` / `reset` |
| `--no-restart` | Build only |
| `--no-playwright` | Skip Chromium install |
| `--no-health-check` | Skip curl |

Restart only:

```bash
sudo bash /var/www/sulus-web-mcp/deploy/vps/restart-services.sh
```

---

## 9. Firewall

- Do **not** open port **3100** (or MiniERP **3010**) publicly.
- Public traffic only via nginx on 80/443.

---

## Server config reference

| File | Purpose |
| --- | --- |
| [`deploy/vps/env.production.example`](../deploy/vps/env.production.example) | `.env.production` template |
| [`deploy/vps/sulus-web-mcp.service`](../deploy/vps/sulus-web-mcp.service) | systemd unit |
| [`deploy/vps/nginx-browse.sulus.ai.conf`](../deploy/vps/nginx-browse.sulus.ai.conf) | nginx vhost |
| [`deploy.sh`](../deploy.sh) | Pull, install, build, restart, health-check |
| [`deploy/vps/restart-services.sh`](../deploy/vps/restart-services.sh) | Restart unit + health-check |

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Health fails after deploy | `journalctl -u sulus-web-mcp -n 80 --no-pager` |
| `401` on `/mcp` | Bearer token must match `MCP_SHARED_SECRET` |
| `Host not allowed` | Add the public hostname to `MCP_ALLOWED_HOSTS` |
| Chromium launch / missing libs | Re-run `sudo npx playwright install-deps chromium` |
| Browser crash / SIGBUS | Check `/dev/shm` (`df -h /dev/shm`); lower `BROWSER_MAX_CONCURRENT` |
| Agent tool timeout | Keep `TOOL_TIMEOUT_MS` ≤ 45000; nginx `proxy_read_timeout` is 90s |
| Port already in use | `sudo ss -tlnp \| grep 3100` — change `MCP_PORT` **and** nginx `upstream` |
| `node` not found in systemd | Set `ExecStart=` to `which node` for `deploy` |

Local run remains `npm run start:http` — see [README.md](../README.md).
