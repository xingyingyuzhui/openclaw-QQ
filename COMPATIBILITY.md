# Compatibility

## Baseline Matrix
- OpenClaw: `>= 2026.2.26`
- QQ plugin: this repository
- QQ automation manager: this repository
- NapCatQQ: tested with `v4.17.25`
- OneBot: v11

## NapCat Protocol Requirements
- Forward WebSocket server enabled
- `messagePostFormat: "array"`
- Stable token mapping with OpenClaw `channels.qq.accessToken`

## Runtime Notes
- This repository does not patch OpenClaw core.
- Automation manager default is `agent-only`.
- Owner mapping is configurable via:
  - `channels.qq.ownerUserId`
  - `OPENCLAW_QQ_OWNER_ID` (fallback)
