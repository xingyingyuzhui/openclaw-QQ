#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
DEST_DIR="${OPENCLAW_HOME}/extensions/qq"

echo "[qq-deploy] source: $SRC_DIR"
echo "[qq-deploy] dest  : $DEST_DIR"

mkdir -p "$DEST_DIR"

# Sync code but keep destination node_modules out of rsync delete scope
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  "$SRC_DIR/" "$DEST_DIR/"

cd "$DEST_DIR"
echo "[qq-deploy] installing runtime deps..."
npm install --omit=dev

echo "[qq-deploy] done. next: openclaw gateway restart"
