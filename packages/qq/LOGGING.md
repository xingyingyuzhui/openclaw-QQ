# QQ Logging Guide

## Goals
- Separate chat summary logs and structured trace logs.
- Make every drop/failure searchable by reason code.
- Keep fields backward compatible when adding new diagnostics.

## Log Layers
- Chat log:
  - Path: `${OPENCLAW_HOME}/workspace/qq_sessions/<route_key>/logs/chat-YYYY-MM-DD.ndjson`
  - Purpose: inbound/outbound conversation summary.
- Trace log:
  - Path: `${OPENCLAW_HOME}/workspace/qq_sessions/<route_key>/logs/trace-YYYY-MM-DD.ndjson`
  - Purpose: structured pipeline diagnostics (resolve/dispatch/send/migrate/proactive).
- Gateway log:
  - Path: `${OPENCLAW_HOME}/logs/gateway.log`
  - Purpose: runtime lifecycle and high-level warnings.

`<route_key>` uses canonical encoding: replace `:` with `__`.
`OPENCLAW_HOME` defaults to `~/.openclaw` in examples.

## Core Fields
- Required:
  - `event`
  - `route`
  - `agent_id`
  - `session_key`
  - `msg_id`
  - `dispatch_id`
  - `attempt_id`
  - `source` (`chat|automation|inbound`)
- Optional:
  - `resolve_stage`, `resolve_action`, `resolve_result`
  - `materialize_result`, `materialize_error_code`
  - `drop_reason`, `fallback_stage`
  - `retry_count`, `duration_ms`, `http_status`
  - NapCat: `action`, `request_id`, `retcode`, `error_code`, `error_message`, `fallback_from`, `fallback_to`, `fallback_reason`

## Event Dictionary
- Inbound/media:
  - `qq_inbound_received`
  - `qq_inbound_media_resolve`
  - `qq_inbound_media_materialize`
- Dispatch:
  - `qq_dispatch_start`
  - `qq_dispatch_done`
  - `qq_dispatch_drop`
  - `qq_dispatch_timeout`
  - `qq_dispatch_error`
  - `qq_dispatch_*` events are typically emitted from `dispatch-executor`, while queue/fallback side effects are orchestrated via `dispatch-flow`
- Outbound:
  - `qq_outbound_send`
  - `qq_outbound_drop`
  - `qq_outbound_retry`
- Session migration:
  - `qq_session_migrate_start`
  - `qq_session_migrate_move`
  - `qq_session_migrate_done`
- Role/relationship:
  - role and relationship commands currently reuse gateway command logs plus route trace context
  - role-pack persistence is intentionally file-backed first, so failures will surface as command errors rather than a separate event family
- Proactive:
  - `qq_proactive_tick`
  - `qq_proactive_skip`
  - `qq_proactive_send`
  - `qq_proactive_state`
- NapCat action lifecycle:
  - `napcat_action_start`
  - `napcat_action_success`
  - `napcat_action_fallback`
  - `napcat_action_failed`
  - `napcat_action_unsupported`

## Common Troubleshooting
1. Inbound exists but no outbound
- Check trace for same `route/msg_id`.
- Verify `qq_dispatch_*` exists.
- If no send, look at `drop_reason` on `qq_outbound_drop`.
- `duplicate_text_suppressed` / `automation_meta_leak_guard` is expected silent drop and will not trigger fallback.

2. Automation triggered but not sent
- Check `automation-state.ndjson` note:
  - `error:*` means pre-trigger failure.
  - `skip:*` means policy/silence/interval skip.
- Cross-check `source=automation` in trace.
- Guarded meta text such as `ANNOUNCE_SKIP` / `QQ_AUTO_SKIP` / `Subagent ... failed` must be dropped by QQ outbound guard.

3. Non-text inbound unresolved
- Filter `event=qq_inbound_media_materialize`.
- Inspect `materialize_error_code`.
- Check `unresolvedReasons` in chat ndjson.

4. Session split or route mismatch
- Search `qq_session_migrate_*` for target route.
- Confirm only `agent:<agentId>:main` remains in `sessions.json`.

5. Policy/quota blocked send
- Check `drop_reason=policy_blocked|quota_exceeded`.

## Module-to-Log Mapping
- `src/diagnostics/napcat-trace.ts`
  - `napcat_action_*`
- `src/services/*`
  - business-domain NapCat facades; these generally do not log directly and rely on NapCat trace + caller trace
- `src/services/role-pack-service.ts` + `src/services/relationship-state-service.ts`
  - route role-pack persistence and relationship state files
- `src/services/role-command-service.ts`
  - Chinese management commands (`/角色` `/好感度` `/关系` `/代理`)
- `src/inbound/dispatch-executor.ts`
  - `qq_dispatch_start|done|drop|timeout|error`
- `src/inbound/dispatch-flow.ts`
  - gateway-side queue/fallback trace lines that explain `queued_while_busy`, `queued_superseded_by_newer_inbound`, `fallback_sent_after_dispatch_error`
- `src/outbound/deliver.ts`
  - `qq_outbound_send|drop|retry`
- `src/services/inbound-media-service.ts` + `src/media/inbound-materializer.ts`
  - `qq_inbound_media_resolve|materialize`
- `src/reconcile-target.ts` in automation manager
  - automation skip/send/fail semantics persisted into route automation state files

## Coverage Notes
- NapCat action lifecycle coverage is enforced from the generated contract list, not from a manual action checklist.
- The only intentional exception is the action literal `unknown`, which is excluded from direct-string coverage checks because it causes false-positive matches in unrelated code paths.

## Quick Queries
```bash
# Route recent trace
rg "route=user:123456789" ${OPENCLAW_HOME}/workspace/qq_sessions/user__123456789/logs/trace-*.ndjson

# Dispatch failures
rg "qq_dispatch_(drop|timeout|error)" ${OPENCLAW_HOME}/workspace/qq_sessions/*/logs/trace-*.ndjson

# Fallback and guarded-drop behavior
rg "fallback_sent|drop_reason=(duplicate_text_suppressed|automation_meta_leak_guard|abort_text_suppressed)" ${OPENCLAW_HOME}/logs/gateway.log

# Media unresolved reasons
rg "materialize_error_code|unresolvedReasons" ${OPENCLAW_HOME}/workspace/qq_sessions/*/logs/*.ndjson

# NapCat fallback / unsupported actions
rg "napcat_action_(fallback|failed|unsupported)" ${OPENCLAW_HOME}/workspace/qq_sessions/*/logs/trace-*.ndjson
```

## Compatibility Rules
- Additive changes only for trace fields.
- Do not change existing field semantics.
- New error codes/events must keep old grep patterns usable.
