#!/usr/bin/env bash
# Convenience wrapper — same as MiniERP's ./deploy.sh on the droplet.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/vps/deploy.sh" "$@"
