import { logQQTrace } from "./logger.js";

export type NapCatTraceEvent =
  | "napcat_action_start"
  | "napcat_action_success"
  | "napcat_action_fallback"
  | "napcat_action_failed"
  | "napcat_action_unsupported";

export type NapCatInvokeContext = {
  accountId: string;
  route: string;
  requestId: string;
  source: "chat" | "automation" | "inbound";
  stage?: string;
  msgId?: string;
  dispatchId?: string;
  attemptId?: string;
};

export function logNapCatTrace(params: {
  event: NapCatTraceEvent;
  ctx: NapCatInvokeContext;
  action: string;
  result?: "ok" | "failed" | "fallback" | "unsupported";
  durationMs?: number;
  retcode?: number;
  errorCode?: string;
  errorMessage?: string;
  fallbackFrom?: string;
  fallbackTo?: string;
  fallbackReason?: string;
}): void {
  logQQTrace({
    event: params.event,
    route: params.ctx.route,
    source: params.ctx.source,
    account_id: params.ctx.accountId,
    msg_id: params.ctx.msgId,
    dispatch_id: params.ctx.dispatchId,
    attempt_id: params.ctx.attemptId || params.ctx.requestId,
    action: params.action,
    request_id: params.ctx.requestId,
    stage: params.ctx.stage,
    result: params.result,
    duration_ms: params.durationMs,
    retcode: params.retcode,
    error_code: params.errorCode,
    error_message: params.errorMessage,
    fallback_from: params.fallbackFrom,
    fallback_to: params.fallbackTo,
    fallback_reason: params.fallbackReason,
  });
}
