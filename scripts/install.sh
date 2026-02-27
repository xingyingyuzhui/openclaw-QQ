#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${HOME}/.openclaw"
REPO_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --openclaw-home)
      OPENCLAW_HOME="$2"; shift 2 ;;
    --repo-path)
      REPO_PATH="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${REPO_PATH}" ]]; then
  REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
fi

mkdir -p "${OPENCLAW_HOME}/extensions"
rm -rf "${OPENCLAW_HOME}/extensions/qq" "${OPENCLAW_HOME}/extensions/qq-automation-manager"
cp -R "${REPO_PATH}/packages/qq" "${OPENCLAW_HOME}/extensions/qq"
cp -R "${REPO_PATH}/packages/qq-automation-manager" "${OPENCLAW_HOME}/extensions/qq-automation-manager"

echo "[install] copied plugins to ${OPENCLAW_HOME}/extensions"
echo "[install] next: merge openclaw.example.json into ${OPENCLAW_HOME}/openclaw.json"
echo "[install] next: openclaw gateway restart"
