## Prerequisites
- OpenClaw `>= 2026.2.26`
- NapCatQQ `v4.17.25` (or newer with same OneBot semantics)
- OneBot v11 forward WebSocket enabled
- `messagePostFormat` must be `array`

See full setup in `NAPCAT_SETUP.md`.

## Install (Git)
```bash
bash scripts/install.sh --openclaw-home "$HOME/.openclaw" --repo-path "/path/to/openclaw-QQ"
```

## Install (npm)
```bash
npm install @openclaw/qq @openclaw/qq-automation-manager
```

## Configure
1. Merge `openclaw.example.json` into `${OPENCLAW_HOME}/openclaw.json`.
2. Fill:
- `channels.qq.wsUrl` (e.g. `ws://127.0.0.1:3001/`)
- `channels.qq.accessToken`
- `channels.qq.ownerUserId` (optional)
3. Ensure plugin IDs exist in:
- `plugins.allow`
- `plugins.entries` and set `enabled=true`

## Verify
```bash
bash scripts/verify.sh --openclaw-home "$HOME/.openclaw"
```

Expected gateway log markers:
- plugin `qq` loaded
- plugin `qq-automation-manager` loaded
- `[QQ] Connected to OneBot server`
- `[QQ] Logged in as:`

## Troubleshooting
- WS connect fails: verify host/port routing and token.
- Media parsing unstable: ensure `messagePostFormat=array`.
- Automation not firing: verify `targets[].enabled=true`, valid route, and schedule window.

## Rollback
1. Set:
- `plugins.entries.qq.enabled=false`
- `plugins.entries.qq-automation-manager.enabled=false`
2. Restart gateway.
