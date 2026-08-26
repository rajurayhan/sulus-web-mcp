#!/usr/bin/env bash
# sulus-web-mcp — restart the Compose service after deploy.
#
#   sudo bash deploy/vps/restart-services.sh
#   # or as deploy if that user can run docker:
#   bash deploy/vps/restart-services.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

COMPOSE=(docker compose -f compose.yaml -f deploy/vps/compose.prod.yaml)

if ! command -v docker >/dev/null 2>&1; then
  printf 'error: docker not found\n' >&2
  exit 1
fi

"${COMPOSE[@]}" restart web-mcp

host_port="3100"
if [[ -f "${ROOT}/.env" ]]; then
  parsed="$(awk -F= '/^MCP_PORT=/{print $2; exit}' .env | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
  if [[ -n "${parsed}" ]]; then
    host_port="${parsed}"
  fi
fi

printf 'OK — restarted web-mcp\n'
"${COMPOSE[@]}" ps web-mcp || true

if curl -fsS --max-time 8 "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then
  printf 'Health: OK (http://127.0.0.1:%s/health)\n' "${host_port}"
else
  printf 'Health: not ready yet — check: docker compose -f compose.yaml -f deploy/vps/compose.prod.yaml logs --tail 80 web-mcp\n' >&2
fi
