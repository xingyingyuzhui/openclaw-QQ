# @openclaw/qq-automation-manager

Route-scoped automation manager for OpenClaw QQ ecosystem.

## Behavior
- Reads plugin config targets.
- Validates route and schedule.
- Triggers agent turn (`executionMode=agent-only`).
- Writes automation state into route metadata.

## Safety contract
- No direct QQ bypass send in default mode.
- Uses route -> agent mapping.
- Logs skip/send/fail with structured fields.
