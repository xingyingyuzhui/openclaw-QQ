# QQ Extension Architecture (Dispatcher-first)

## Current layering (2026-03 refactor)

- `src/channel.ts`: channel adapter/composer only.
  - account lifecycle wiring (`startAccount/stopAccount`)
  - plugin-sdk bridge (`config/status/outbound/messaging/proactive`)
  - runtime setup/teardown for OneBot client
- `src/inbound/inbound-orchestrator.ts`: inbound orchestration brain.
  - message normalization + route resolution
  - context assembly + media attach policy
  - dispatch strategy (`direct` vs child task) and fallback hooks
- `src/inbound/dispatch-executor.ts`: dispatch state machine.
  - inflight/pending-latest handling
  - coalesce/preempt policies
  - timeout/superseded/drop lifecycle logging
- `src/inbound/dispatch-policy.ts`: pure dispatch policy helpers.
  - coalesce window resolution
  - busy followup hint detection
  - post-coalesce disposition classification
- `src/inbound/dispatch-flow.ts`: reusable dispatch side-effect flows.
  - busy-route queue handling
  - dispatch failure notify/fallback flow
- `src/outbound/deliver.ts`: outbound commitment boundary.
  - payload normalization
  - text/media attempt lifecycle (`prepared -> queued -> sending -> sent|dropped|failed`)
  - abort leak suppression and fallback-on-drop
- `src/state/*-registry.ts`: in-memory route/account/media registries (no business I/O).
- `src/services/role-pack-service.ts` + `src/services/role-pack-defaults.ts` + `src/services/role-pack-importer.ts`
  - route-bound role pack persistence
  - template seeding / legacy persona migration
  - imported character-card normalization
- `src/services/relationship-state-service.ts`
  - structured affinity/trust/initiative state
- `src/services/context-assembler.ts`
  - compact role summary injection for QQ route prompts
- `src/services/role-command-service.ts`
  - Chinese-first `/角色` `/好感度` `/关系` `/代理` management commands

## NapCat layering (contract-aligned)

- L0 transport
  - `src/napcat/transport/action-invoker.ts`: timeout/retry + transport invoke wrapper.
  - `src/napcat/transport/ws-client-adapter.ts`: OneBot WS adapter.
- L1 contracts
  - `src/napcat/contracts/generated/*`: generated action/request/response map.
  - `src/napcat/contracts/manual/*`: overrides and compatibility patches.
  - `src/napcat/contracts/index.ts`: unified `NapCatAction`, `NapCatRequestMap`, `NapCatResponseMap`.
- L2 compatibility
  - `src/napcat/compat/fallback-map.ts`: new->legacy fallback map.
  - `src/napcat/compat/capability-probe.ts`: account-level action capability cache.
  - `src/napcat/compat/invoke-napcat.ts`: unified `new-first-with-legacy-fallback` invoker.
- L3 application
  - `src/services/*`: facade layer grouped by business domain.
    - messaging: `message-service`, `message-read-service`, `message-extension-service`, `message-misc-service`, `forward-message-service`
    - account/social: `account-capability-service`, `account-social-service`, `profile-status-service`, `social-extension-service`
    - group: `group-admin-service`, `group-query-service`, `group-insight-service`, `group-profile-service`, `notice-service`
    - file/media: `file-transfer-service`, `group-file-admin-service`, `online-file-service`, `media-extension-service`, `fileset-service`, `inbound-media-service`, `outbound-media-service`
    - ai/ark/album: `ai-ark-service`, `album-service`
    - orchestration/support: `resident-agent-service`, `proactive-*`, `route-persona-service`, `voice-transcription-service`
- L4 observability
  - `src/diagnostics/napcat-trace.ts`: action lifecycle structured trace.

Dependency direction is strictly one-way:
`channel -> services -> napcat/compat -> napcat/contracts + napcat/transport`.

## Route agent model

- Main route agent is chat + orchestration only.
- Heavy tasks (media parsing / file analysis / long generation) are delegated to child task units.
- Heavy task flow is ack-first + async-final-result.
- Non-owner QQ routes now also carry a local role pack under the bound workspace:
  - `character/persona-core.json`
  - `character/style.md`
  - `character/examples.md`
  - `channel/qq-rules.md`
  - `channel/capabilities.md`
  - `runtime/relationship.json`
  - `runtime/preferences.json`
  - `runtime/role-pack.meta.json`

## Child task guardrails

Configured by QQ channel config:

- `taskMaxRuntimeMs`
- `taskMaxRetries`
- `taskMaxConcurrency`
- `taskIdempotencyEnabled`

These are hard guardrails for heavy task units.


## Task lifecycle persistence

Per route:

- `qq_sessions/<route>/meta/task-state.json` (latest)
- `qq_sessions/<route>/meta/task-lifecycle.ndjson` (append-only history)
- `qq_sessions/<route>/meta/task-<taskKey>.json` (per-task latest)

Lifecycle states:

`queued -> running -> succeeded|failed|timeout`

Each record includes:

- task key
- msgId
- dispatchId
- retry count
- error reason
- result summary

## Isolation + idempotency

- Route queues are isolated per route.
- Task idempotency key is deterministic (`route + msgId + taskKind + payloadSummary` hash).
- When idempotency is enabled, repeated dispatches with same key skip duplicate side effects.

## Engineering gates

- `pnpm run lint` runs architecture boundary checks:
  - layer import direction
  - line count caps for service/compat/transport/manual-contract files
  - `channel.ts` upper bound (guard against regression to mega-file)
- `pnpm run typecheck` validates compile-time wiring for plugin code.
- `pnpm run test` validates generated NapCat contract snapshot sanity.
  - service facade coverage
  - unit tests for policy/flow/runtime-state/automation target evaluation

## NapCat facade coverage

- Source of truth: `src/napcat/contracts/generated/actions.ts`
- Coverage gate: `scripts/verify-service-coverage.mjs`
- Current policy:
  - every generated NapCat action must appear in `src/services/*`
  - exception: `unknown`

Why `unknown` is excluded:
- it is a literal action name from the upstream contract set
- it collides with ordinary string matching and causes false positives in coverage scanning
- it is intentionally excluded from the direct-literal gate, but all concrete actionable interfaces are covered

Practical result:
- generated contract actions are checked against service facades automatically
- the gate no longer relies on a hand-maintained action allowlist
