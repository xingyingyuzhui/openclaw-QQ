import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaSendTrace } from "../types/media.js";
import type { InboundMediaResolveTrace } from "../types/media.js";
import type { DeliveryAttemptTrace } from "../types/reply.js";
import type { QQLogTrace } from "../types/logging.js";

const FALLBACK_WORKSPACE = path.join(process.env.HOME || "", ".openclaw", "workspace");
const loggerState = {
  traceEnabled: true,
  verboseErrors: false,
  workspaceRootByAccount: new Map<string, string>(),
};

function redactHostSensitive(text: string): string {
  return String(text || "")
    .replace(/host\.docker\.internal/gi, "[host]")
    .replace(/127\.0\.0\.1/g, "[loopback]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
}

export function sanitizeOutboundText(text: string): string {
  return redactHostSensitive(text);
}

export function configureQQLogger(params: {
  accountId: string;
  workspaceRoot: string;
  traceEnabled?: boolean;
  verboseErrors?: boolean;
}) {
  const accountId = String(params.accountId || "").trim() || "default";
  const workspaceRoot = String(params.workspaceRoot || "").trim() || FALLBACK_WORKSPACE;
  loggerState.workspaceRootByAccount.set(accountId, workspaceRoot);
  if (typeof params.traceEnabled === "boolean") loggerState.traceEnabled = params.traceEnabled;
  if (typeof params.verboseErrors === "boolean") loggerState.verboseErrors = params.verboseErrors;
}

export function resetQQLoggerAccount(accountId: string) {
  loggerState.workspaceRootByAccount.delete(String(accountId || "").trim() || "default");
}

export function logQQTrace(trace: QQLogTrace): void {
  const event = String(trace.event || "unknown");
  const route = String(trace.route || "");
  const msgId = String(trace.msg_id || "");
  const dispatchId = String(trace.dispatch_id || "");
  const dropReason = String(trace.drop_reason || "");
  const error = String(trace.error || "");
  const suffix = [
    `event=${event}`,
    route ? `route=${route}` : "",
    msgId ? `msg_id=${msgId}` : "",
    dispatchId ? `dispatch_id=${dispatchId}` : "",
    dropReason ? `drop_reason=${dropReason}` : "",
    error ? `error=${error}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(`[QQ][trace] ${suffix}`);
  appendTrace(trace);
}

function routeDirName(route: string): string {
  return String(route || "").replace(/[^a-zA-Z0-9:_-]/g, "_").replace(/:/g, "__");
}

function resolveWorkspaceRoot(trace: QQLogTrace): string {
  const fromTrace = String(trace.workspace_root || "").trim();
  if (fromTrace) return fromTrace;
  const accountId = String(trace.account_id || "").trim();
  if (accountId && loggerState.workspaceRootByAccount.has(accountId)) {
    return String(loggerState.workspaceRootByAccount.get(accountId));
  }
  return loggerState.workspaceRootByAccount.get("default") || FALLBACK_WORKSPACE;
}

function appendTrace(trace: QQLogTrace): void {
  if (!loggerState.traceEnabled) return;
  const route = String(trace.route || "").trim();
  if (!route) return;
  const workspaceRoot = resolveWorkspaceRoot(trace);
  const day = new Date().toISOString().slice(0, 10);
  const logsDir = path.join(workspaceRoot, "qq_sessions", routeDirName(route), "logs");
  const filePath = path.join(logsDir, `trace-${day}.ndjson`);
  const payload = JSON.stringify({
    ts: Date.now(),
    ...trace,
    workspace_root: workspaceRoot,
  }) + "\n";
  void fs.mkdir(logsDir, { recursive: true }).then(() => fs.appendFile(filePath, payload, "utf8")).catch((err) => {
    if (loggerState.verboseErrors) {
      console.warn(`[QQ][trace-write-failed] route=${route} error=${(err as any)?.message || err}`);
    }
  });
}

export function logMediaTrace(trace: MediaSendTrace) {
  const suffix = [
    `route=${trace.route}`,
    `media_source=${trace.media_source}`,
    `media_kind=${trace.media_kind}`,
    trace.resolved_realpath ? `resolved_realpath=${trace.resolved_realpath}` : "",
    trace.candidate_type ? `candidate_type=${trace.candidate_type}` : "",
    trace.deny_reason ? `deny_reason=${trace.deny_reason}` : "",
    trace.fallback_stage ? `fallback_stage=${trace.fallback_stage}` : "",
    trace.error ? `error=${trace.error}` : "",
  ].filter(Boolean).join(" ");
  console.log(`[QQ][media-trace] ${suffix}`);
  appendTrace({
    event: "qq_outbound_send",
    route: trace.route,
    source: "chat",
    resolve_stage: "send_media",
    resolve_result: trace.error ? "failed" : "ok",
    fallback_stage: trace.fallback_stage,
    materialize_error_code: trace.deny_reason,
    error: trace.error,
  });
}

export function logInboundMediaTrace(trace: InboundMediaResolveTrace) {
  const suffix = [
    `route=${trace.route}`,
    trace.dispatch_id ? `dispatch_id=${trace.dispatch_id}` : "",
    trace.msg_id ? `msg_id=${trace.msg_id}` : "",
    `segment_type=${trace.segment_type}`,
    `resolve_stage=${trace.resolve_stage}`,
    trace.resolve_action ? `resolve_action=${trace.resolve_action}` : "",
    `resolve_result=${trace.resolve_result}`,
    trace.materialize_result ? `materialize_result=${trace.materialize_result}` : "",
    trace.materialize_error_code ? `materialize_error_code=${trace.materialize_error_code}` : "",
    typeof trace.http_status === "number" ? `http_status=${trace.http_status}` : "",
    typeof trace.retry_count === "number" ? `retry_count=${trace.retry_count}` : "",
    trace.error ? `error=${trace.error}` : "",
  ].filter(Boolean).join(" ");
  console.log(`[QQ][inbound-media-trace] ${suffix}`);
  appendTrace({
    event: trace.resolve_stage === "materialize" ? "qq_inbound_media_materialize" : "qq_inbound_media_resolve",
    route: trace.route,
    source: "inbound",
    msg_id: trace.msg_id,
    dispatch_id: trace.dispatch_id,
    resolve_stage: trace.resolve_stage,
    resolve_action: trace.resolve_action,
    resolve_result: trace.resolve_result,
    materialize_result: trace.materialize_result,
    materialize_error_code: trace.materialize_error_code,
    http_status: trace.http_status,
    retry_count: trace.retry_count,
    error: trace.error,
    segment_type: trace.segment_type,
  });
}

export function logDeliveryAttemptTrace(trace: DeliveryAttemptTrace) {
  const suffix = [
    `route=${trace.route}`,
    `msg_id=${trace.msgId}`,
    `dispatch_id=${trace.dispatchId}`,
    `attempt_id=${trace.attemptId}`,
    `phase=${trace.phase}`,
    trace.action ? `action=${trace.action}` : "",
    trace.result ? `result=${trace.result}` : "",
    trace.dropReason ? `drop_reason=${trace.dropReason}` : "",
    typeof trace.retryIndex === "number" ? `retry_index=${trace.retryIndex}` : "",
    trace.error ? `error=${trace.error}` : "",
  ].filter(Boolean).join(" ");
  console.log(`[QQ][delivery-attempt] ${suffix}`);
  appendTrace({
    event: trace.result === "failed" ? "qq_outbound_drop" : "qq_outbound_send",
    route: trace.route,
    source: "chat",
    msg_id: trace.msgId,
    dispatch_id: trace.dispatchId,
    attempt_id: trace.attemptId,
    drop_reason: trace.dropReason,
    retry_count: trace.retryIndex,
    resolve_action: trace.action,
    resolve_result: trace.result,
    error: trace.error,
    phase: trace.phase,
  });
}
