# openclaw-QQ

OpenClaw QQ ecosystem monorepo:
- `packages/qq`: QQ channel plugin (OneBot v11)
- `packages/qq-automation-manager`: route-scoped automation trigger plugin (agent-only)

## Features
- Route-isolated QQ sessions (`user:/group:/guild:`)
- Robust outbound delivery queue with retries and drop reasons
- Inbound media resolve/materialize traces
- Automation manager triggers agent turn, does not bypass channel sending

## Quick Install (Git)
1. Clone into OpenClaw extensions directory.
2. Enable plugin IDs in `plugins.allow` and `plugins.entries`.
3. Apply config from `openclaw.example.json`.
4. Restart gateway.

```bash
git clone https://github.com/xingyingyuzhui/openclaw-QQ.git
cd openclaw-QQ
bash scripts/install.sh --openclaw-home "$HOME/.openclaw" --repo-path "$PWD"
bash scripts/verify.sh --openclaw-home "$HOME/.openclaw"
```

## Install (npm)
You can install each plugin package directly:

```bash
npm install @openclaw/qq @openclaw/qq-automation-manager
```

Then reference package entry files from your OpenClaw extension loading path.

## Configuration
Use `openclaw.example.json` as the baseline. Required keys:
- `channels.qq.wsUrl`
- `channels.qq.accessToken`
- `plugins.entries.qq.enabled=true`
- `plugins.entries.qq-automation-manager.enabled=true`

Optional owner binding:
- `channels.qq.ownerUserId` (string QQ ID)

## Security Notes
- No production tokens, QQ IDs, or local absolute paths are included.
- Review config before deployment.

## Troubleshooting
- See `AGENTS.md` for deterministic install/verify flow.
- See `packages/qq/LOGGING.md` for trace/event-level diagnosis.
