# QQ Logging Guide

## Log layers
1. Gateway log
- Path: `${OPENCLAW_HOME}/logs/gateway.log`
- Use for startup/connectivity/plugin load failures.

2. Route chat log
- Path: `${OPENCLAW_HOME}/workspace/qq_sessions/<route_key>/logs/chat-YYYY-MM-DD.ndjson`
- Use for in/out message records.

3. Route trace log
- Path: `${OPENCLAW_HOME}/workspace/qq_sessions/<route_key>/logs/trace-YYYY-MM-DD.ndjson`
- Use for resolve/materialize/delivery/drop reason analysis.

## Key events
- `qq_inbound_received`
- `qq_inbound_media_resolve`
- `qq_inbound_media_materialize`
- `qq_dispatch_start|done|drop|timeout|error`
- `qq_outbound_send|drop|retry`
- `qq_session_migrate_*`

## Core fields
- `route`, `msg_id`, `dispatch_id`, `attempt_id`, `source`
- `resolve_stage`, `resolve_action`, `resolve_result`
- `materialize_result`, `materialize_error_code`, `http_status`
- `drop_reason`, `retry_count`, `duration_ms`

## Common troubleshooting
1. Inbound present, outbound missing
- Search `qq_dispatch_drop` and `qq_outbound_drop` by same `dispatch_id`.

2. Media unresolved
- Filter `qq_inbound_media_materialize` where `materialize_result=unresolved`.

3. Automation was skipped
- Check automation manager logs (`source=automation`) and skip reason.

## Quick queries
```bash
rg "qq_dispatch_(drop|timeout|error)" "${OPENCLAW_HOME}/workspace/qq_sessions" -g "trace-*.ndjson"
rg "materialize_error_code|unresolvedReasons" "${OPENCLAW_HOME}/workspace/qq_sessions" -g "*.ndjson"
rg "\[QQ\]|qq-automation-manager" "${OPENCLAW_HOME}/logs/gateway.log"
```
