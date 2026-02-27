# openclaw-QQ

OpenClaw QQ ecosystem monorepo:
- `packages/qq`: QQ channel plugin (OneBot v11)
- `packages/qq-automation-manager`: route-scoped automation trigger plugin (agent-only)

## Version Baseline
- OpenClaw: `>= 2026.2.26`
- NapCatQQ: tested with `v4.17.25` (latest release at 2026-02-22)
- OneBot protocol: v11 (forward WebSocket server)

See details in:
- `COMPATIBILITY.md`
- `NAPCAT_SETUP.md`

## Features
- Route-isolated QQ sessions (`user:/group:/guild:`)
- Inbound aggregation + media resolve/materialize traces
- Outbound text/media queue with retry/drop reasons
- Automation manager triggers `agent turn` only (no direct bypass send)

## Quick Install (Git)
```bash
git clone https://github.com/xingyingyuzhui/openclaw-QQ.git
cd openclaw-QQ
bash scripts/install.sh --openclaw-home "$HOME/.openclaw" --repo-path "$PWD"
```

Then merge `openclaw.example.json` into `${HOME}/.openclaw/openclaw.json`, and restart gateway:
```bash
openclaw gateway restart
```

Verify:
```bash
bash scripts/verify.sh --openclaw-home "$HOME/.openclaw"
```

## Install (npm)
```bash
npm install @openclaw/qq @openclaw/qq-automation-manager
```

Use this path only if your OpenClaw extension loader is configured to resolve package entry files from npm modules.

## Required OpenClaw Config
Minimal required keys:
- `channels.qq.wsUrl`
- `channels.qq.accessToken`
- `plugins.entries.qq.enabled=true`
- `plugins.entries.qq-automation-manager.enabled=true`

Optional owner binding:
- `channels.qq.ownerUserId`

## NapCat Critical Requirements
- Must enable OneBot v11 WebSocket server for OpenClaw to connect.
- Must use `messagePostFormat: "array"` (required for stable media parsing).
- `host/port/token` must match your `channels.qq.wsUrl` and `channels.qq.accessToken`.

Read full setup:
- `NAPCAT_SETUP.md`

## Security Notice
- This repository intentionally excludes production tokens, local absolute paths, and personal IDs.
- Do not commit your real `openclaw.json` or NapCat runtime config.
