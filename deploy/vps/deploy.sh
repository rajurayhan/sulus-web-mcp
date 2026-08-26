#!/usr/bin/env bash
# sulus-web-mcp — VPS deploy: git pull, Docker rebuild, health check.
# Run as the Unix user that owns the repo and can talk to Docker (usually `deploy`).
# See docs/DEPLOY.md.
#
#   bash deploy/vps/deploy.sh
#
# Environment (optional):
#   SKIP_PULL=1     — already at the desired SHA
#   SKIP_BUILD=1    — restart existing image only (no rebuild)
#   APP_ROOT=…      — override checkout path (default: this repo)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${APP_ROOT:-$ROOT}"
cd "${ROOT}"

COMPOSE=(docker compose -f compose.yaml -f deploy/vps/compose.prod.yaml)
SKIP_PULL="${SKIP_PULL:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"

if [[ ! -f "${ROOT}/.env" ]]; then
  printf 'error: missing .env — copy deploy/vps/env.production.example and fill secrets\n' >&2
  printf '  cp deploy/vps/env.production.example .env\n' >&2
  exit 1
fi

secret="$(awk -F= '/^MCP_SHARED_SECRET=/{print $2; exit}' .env | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
if [[ -z "${secret}" || "${secret}" == "generate-a-long-random-secret" || "${secret}" == "replace-with-a-long-random-secret" ]]; then
  printf 'error: set MCP_SHARED_SECRET in .env to a long random value before deploying\n' >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'error: docker not found. Install Docker Engine + Compose plugin, then retry.\n' >&2
  exit 1
fi

if [[ "${SKIP_PULL}" != "1" && -d "${ROOT}/.git" ]]; then
  git pull --ff-only
fi

if [[ "${SKIP_BUILD}" == "1" ]]; then
  "${COMPOSE[@]}" up -d
else
  "${COMPOSE[@]}" up -d --build
fi

host_port="$(awk -F= '/^MCP_PORT=/{print $2; exit}' .env | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
host_port="${host_port:-3100}"

printf '\nWaiting for health on 127.0.0.1:%s …\n' "${host_port}"
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "${ok}" -ne 1 ]]; then
  printf 'error: health check failed. Logs:\n' >&2
  "${COMPOSE[@]}" logs --tail 80 web-mcp >&2 || true
  exit 1
fi

printf 'OK — sulus-web-mcp is up on 127.0.0.1:%s\n' "${host_port}"
printf 'Public MCP (after nginx + TLS): https://browse.sulus.ai/mcp\n'
printf 'Restart only: sudo bash %s/deploy/vps/restart-services.sh\n' "${ROOT}"
