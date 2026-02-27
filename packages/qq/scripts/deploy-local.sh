#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="${OPENCLAW_HOME}/extensions/qq"

mkdir -p "${OPENCLAW_HOME}/extensions"
rm -rf "${DEST_DIR}"
cp -R "${SRC_DIR}" "${DEST_DIR}"

echo "[qq-deploy] deployed to ${DEST_DIR}"
echo "[qq-deploy] restart gateway: openclaw gateway restart"
