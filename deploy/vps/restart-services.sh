#!/usr/bin/env bash
# sulus-web-mcp — restart systemd unit after deploy.
#
#   sudo bash deploy/vps/restart-services.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT="${SYSTEMD_SERVICE:-sulus-web-mcp.service}"
ENV_FILE="${ENV_FILE:-${ROOT}/.env.production}"

if ! command -v systemctl >/dev/null 2>&1; then
  printf 'error: systemctl not found (not a systemd host?)\n' >&2
  exit 1
fi

if [[ "${EUID:-0}" -eq 0 ]]; then
  systemctl restart "${UNIT}"
else
  sudo systemctl restart "${UNIT}"
fi

printf 'OK — restarted %s\n' "${UNIT}"
systemctl --no-pager --full status "${UNIT}" || true

host_port="3100"
if [[ -f "${ENV_FILE}" ]]; then
  parsed="$(awk -F= '/^MCP_PORT=/{print $2; exit}' "${ENV_FILE}" | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
  if [[ -n "${parsed}" ]]; then
    host_port="${parsed}"
  fi
fi

if curl -fsS --max-time 8 "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then
  printf 'Health: OK (http://127.0.0.1:%s/health)\n' "${host_port}"
else
  printf 'Health: not ready yet — check: journalctl -u %s -n 50 --no-pager\n' "${UNIT}" >&2
fi
