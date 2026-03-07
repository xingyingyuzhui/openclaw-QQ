# QQ Automation Manager

`qq-automation-manager` is the companion plugin for the QQ channel package. It manages scheduled QQ nudges and route-bound automation targets without bypassing the normal OpenClaw agent flow.

## What it does

- Reads `plugins.entries.qq-automation-manager.config.targets[]` from `openclaw.json`
- Resolves `route -> agentId` using QQ route rules
- Runs scheduled checks and triggers the bound agent
- Preserves `agent-only` delivery semantics
- Reads Role Pack and `relationship.json` to make smarter skip/send decisions

## What it does not do

- It does not send QQ messages through a side channel
- It does not create cross-route deliveries for normal QQ agents
- It does not replace the QQ plugin's normal `reply + MEDIA:` path

## Target model

Each target should use an explicit QQ route:

- `user:123456789`
- `group:123456789`
- `guild:guild_id:channel_id`

Bare numeric ids are intentionally invalid.

## Smart skip

When `job.smart.enabled` is on, the plugin can consider:

- recent inbound activity
- recent outbound activity
- random interval windows
- Role Pack relationship state

Supported relationship-sensitive knobs:

- `lowInitiativeExtraSilenceMinutes`
- `lowAffinityExtraSilenceMinutes`
- `coldStageSkip`

## Checks

Run from this package directory:

```bash
pnpm run check
```

## Compatibility

- OpenClaw: see the repository root `COMPATIBILITY.md`
- QQ plugin: install `packages/qq` first
