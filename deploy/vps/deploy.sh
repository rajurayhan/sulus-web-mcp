#!/usr/bin/env bash
# sulus-web-mcp — manual production deploy (native Node + systemd).
# Same droplet as MiniERP. No Docker.
# Run on the server from the app directory, e.g. /var/www/sulus-web-mcp:
#   ./deploy.sh
#   # or: bash deploy/vps/deploy.sh
#
# See docs/DEPLOY.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${APP_ROOT:-$ROOT}"
cd "${ROOT}"

ENV_FILE="${ENV_FILE:-.env.production}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-sulus-web-mcp}"
SKIP_PULL="${SKIP_PULL:-0}"
SKIP_RESTART="${SKIP_RESTART:-0}"
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-0}"
SKIP_PLAYWRIGHT="${SKIP_PLAYWRIGHT:-0}"

usage() {
  cat <<EOF
Usage: ./deploy.sh [options]

Options:
  --no-pull          Skip git fetch/reset
  --no-restart       Build only; do not restart systemd
  --no-health-check  Skip post-deploy curl check
  --no-playwright    Skip Playwright Chromium install
  -h, --help         Show this help

Environment:
  ENV_FILE           Env file (default: .env.production)
  GIT_BRANCH         Branch to deploy (default: main)
  SYSTEMD_SERVICE    systemd unit name (default: sulus-web-mcp)
  SKIP_PULL=1        Same as --no-pull
  SKIP_RESTART=1     Same as --no-restart
  SKIP_HEALTH_CHECK=1 Same as --no-health-check
  SKIP_PLAYWRIGHT=1  Same as --no-playwright
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)
      SKIP_PULL=1
      shift
      ;;
    --no-restart)
      SKIP_RESTART=1
      shift
      ;;
    --no-health-check)
      SKIP_HEALTH_CHECK=1
      shift
      ;;
    --no-playwright)
      SKIP_PLAYWRIGHT=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${ROOT}/${ENV_FILE}" ]]; then
  printf 'error: missing %s — copy deploy/vps/env.production.example and fill MCP_SHARED_SECRET\n' "${ENV_FILE}" >&2
  printf '  cp deploy/vps/env.production.example %s\n' "${ENV_FILE}" >&2
  exit 1
fi

secret="$(awk -F= '/^MCP_SHARED_SECRET=/{print $2; exit}' "${ENV_FILE}" | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
if [[ -z "${secret}" || "${secret}" == "generate-a-long-random-secret" || "${secret}" == "replace-with-a-long-random-secret" ]]; then
  printf 'error: set MCP_SHARED_SECRET in %s to a long random value before deploying\n' "${ENV_FILE}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'error: node not found (need Node.js 20+)\n' >&2
  exit 1
fi

echo "==> Deploying sulus-web-mcp from ${ROOT} (branch: ${GIT_BRANCH})"

if [[ "${SKIP_PULL}" != "1" && -d "${ROOT}/.git" ]]; then
  echo "==> git fetch origin ${GIT_BRANCH}"
  git fetch origin "${GIT_BRANCH}"
  git reset --hard "origin/${GIT_BRANCH}"
fi

echo "==> npm ci"
npm ci

if [[ "${SKIP_PLAYWRIGHT}" != "1" ]]; then
  echo "==> playwright install chromium"
  mkdir -p .playwright
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${ROOT}/.playwright}"
  npx playwright install chromium
else
  echo "==> skipping Playwright install (--no-playwright)"
fi

echo "==> npm run build"
npm run build

host_port="$(awk -F= '/^MCP_PORT=/{print $2; exit}' "${ENV_FILE}" | tr -d '[:space:]' | tr -d '"' | tr -d "'")"
host_port="${host_port:-3100}"

if [[ "${SKIP_RESTART}" != "1" ]]; then
  echo "==> sudo systemctl restart ${SYSTEMD_SERVICE}"
  sudo systemctl restart "${SYSTEMD_SERVICE}"
else
  echo "==> skipping systemd restart (--no-restart)"
fi

if [[ "${SKIP_HEALTH_CHECK}" != "1" && "${SKIP_RESTART}" != "1" ]]; then
  echo "==> health check http://127.0.0.1:${host_port}/health"
  ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  if [[ "${ok}" -ne 1 ]]; then
    printf 'error: health check failed\n' >&2
    sudo journalctl -u "${SYSTEMD_SERVICE}" -n 50 --no-pager || true
    exit 1
  fi
  echo "Deploy OK — http://127.0.0.1:${host_port}/health"
else
  echo "Deploy build finished."
fi

printf 'Public MCP (after nginx + TLS): https://browse.sulus.ai/mcp\n'
printf 'Restart only: sudo bash %s/deploy/vps/restart-services.sh\n' "${ROOT}"
