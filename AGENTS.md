## Prerequisites
- OpenClaw `>= 2026.2.26`
- OneBot v11 server ready (`message_post_format=array`)
- Access to OpenClaw home (`OPENCLAW_HOME`, default `~/.openclaw`)

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
- `channels.qq.wsUrl`
- `channels.qq.accessToken`
- `channels.qq.ownerUserId` (optional)
3. Ensure plugin IDs are in:
- `plugins.allow`
- `plugins.entries`

## Verify
```bash
bash scripts/verify.sh --openclaw-home "$HOME/.openclaw"
```

Expected:
- gateway running
- qq plugin loaded
- qq-automation-manager plugin loaded
- QQ connected to OneBot

## Troubleshooting
- If plugin not loaded: check `plugins.allow` and `plugins.entries.<id>.enabled`
- If QQ not connected: check `wsUrl`/`accessToken` and OneBot logs
- If automation not firing: check `targets[].enabled`, schedule, and route validity

## Rollback
1. Disable plugin entry:
- `plugins.entries.qq.enabled=false`
- `plugins.entries.qq-automation-manager.enabled=false`
2. Restart gateway.
