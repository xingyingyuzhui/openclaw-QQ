# @openclaw/qq

QQ channel plugin for OpenClaw via OneBot v11.

## What it provides
- QQ route isolation: `user:<id>`, `group:<id>`, `guild:<guildId>:<channelId>`
- Inbound aggregation + dispatch lifecycle
- Outbound text/media pipeline with retry and trace logs
- Session metadata and capability/quota guards

## Install
Use the monorepo root install flow in `/README.md` and `/AGENTS.md`.

## Minimal config
```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://127.0.0.1:3001/",
      "accessToken": "YOUR_ONEBOT_ACCESS_TOKEN",
      "ownerUserId": "QQ_OWNER_ID"
    }
  },
  "plugins": {
    "entries": {
      "qq": { "enabled": true }
    }
  }
}
```

## Notes
- `ownerUserId` is optional. If provided, that private route can be mapped to `main` agent.
- For diagnostics, see `LOGGING.md`.
