# QQ Extension Architecture (Dispatcher-first)

## Route agent model

- Main route agent is chat + orchestration only.
- Heavy tasks (media parsing / file analysis / long generation) are delegated to child task units.
- Heavy task flow is ack-first + async-final-result.

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
