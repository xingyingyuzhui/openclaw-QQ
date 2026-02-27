#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${HOME}/.openclaw"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --openclaw-home)
      OPENCLAW_HOME="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

LOG="${OPENCLAW_HOME}/logs/gateway.log"
if [[ ! -f "$LOG" ]]; then
  echo "[verify] missing gateway log: $LOG" >&2
  exit 2
fi

echo "[verify] checking plugin load markers..."
rg -n "plugin=qq|plugin=qq-automation-manager|qq-automation-manager: internal scheduler started|\[QQ\] Connected" "$LOG" -S || true

echo "[verify] checking config presence..."
rg -n '"qq"|"qq-automation-manager"|"plugins"' "${OPENCLAW_HOME}/openclaw.json" -S || true

echo "[verify] done"
