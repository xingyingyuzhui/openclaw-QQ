import type { ReplyPayload } from "openclaw/plugin-sdk";
import {
  classifyPostCoalesceDisposition,
  shouldSendBusyFollowupHint,
} from "./dispatch-policy.js";

export async function handleBusyRouteQueue(params: {
  route: string;
  msgIdText: string;
  inboundSeq: number;
  hasInboundMediaLike: boolean;
  text: string;
  replyRunTimeoutMs: number;
  interruptCoalesceEnabled: boolean;
  persistTaskState: (
    state: "queued" | "running" | "succeeded" | "failed" | "timeout",
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  deliver: (payload: ReplyPayload) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  upsertRoutePendingLatest: (params: {
    route: string;
    msgId: string;
    inboundSeq: number;
    hasInboundMediaLike: boolean;
  }) => { inboundSeq: number };
  hasRouteInFlight: (route: string) => boolean;
  claimRoutePendingLatest: (route: string, inboundSeq: number) => boolean;
  getRoutePendingLatest: (route: string) => { inboundSeq?: number } | undefined;
}): Promise<"continue" | "queued_superseded_by_newer_inbound"> {
  const {
    route,
    msgIdText,
    inboundSeq,
    hasInboundMediaLike,
    text,
    replyRunTimeoutMs,
    interruptCoalesceEnabled,
    persistTaskState,
    deliver,
    sleep,
    upsertRoutePendingLatest,
    hasRouteInFlight,
    claimRoutePendingLatest,
    getRoutePendingLatest,
  } = params;

  const pending = upsertRoutePendingLatest({
    route,
    msgId: msgIdText,
    inboundSeq,
    hasInboundMediaLike,
  });
  console.warn(
    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=false drop_reason=queued_while_busy pending_seq=${pending.inboundSeq}`,
  );
  await persistTaskState("queued", { reason: "busy", pendingSeq: pending.inboundSeq });

  if (shouldSendBusyFollowupHint(text)) {
    try {
      await deliver({ text: "正在处理你刚发的文件，马上给你结果。" });
    } catch {}
  }

  const waitDeadline = Date.now() + Math.max(15_000, replyRunTimeoutMs * 2);
  while (hasRouteInFlight(route) && Date.now() < waitDeadline) {
    await sleep(80);
  }
  if (!claimRoutePendingLatest(route, inboundSeq)) {
    const latestPending = getRoutePendingLatest(route);
    const disposition = classifyPostCoalesceDisposition({
      hasExistingInFlight: true,
      routePreemptOldRun: false,
      interruptCoalesceEnabled,
      currentInboundSeq: latestPending?.inboundSeq ?? -1,
      expectedInboundSeq: inboundSeq,
    });
    console.warn(
      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=${disposition} latest_seq=${latestPending?.inboundSeq ?? -1}`,
    );
    return "queued_superseded_by_newer_inbound";
  }
  console.log(
    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=false drop_reason=queued_resumed_after_busy`,
  );
  return "continue";
}

export async function handleDispatchFailure(params: {
  route: string;
  msgIdText: string;
  dispatchId: string;
  runTimedOut: boolean;
  runSuperseded: boolean;
  dropReason: string;
  enableErrorNotify: boolean;
  hadDelivered: boolean;
  hadFallbackEligibleDrop: boolean;
  canSendFallbackNow: () => boolean;
  recordFallbackSent: () => void;
  setRouteHadDelivered: (value: boolean) => void;
  deliver: (payload: ReplyPayload) => Promise<void>;
  persistTaskState: (
    state: "queued" | "running" | "succeeded" | "failed" | "timeout",
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  sendFallbackAfterDispatchError: (args: {
    dispatchId: string;
    fallbackText: string;
  }) => Promise<boolean>;
}): Promise<{ sentFallback: boolean }> {
  const {
    route,
    msgIdText,
    dispatchId,
    runTimedOut,
    runSuperseded,
    dropReason,
    enableErrorNotify,
    hadDelivered,
    hadFallbackEligibleDrop,
    canSendFallbackNow,
    recordFallbackSent,
    setRouteHadDelivered,
    deliver,
    persistTaskState,
    sendFallbackAfterDispatchError,
  } = params;

  if (runTimedOut) {
    await persistTaskState("timeout", { dispatchId, dropReason });
  } else {
    await persistTaskState("failed", { dispatchId, dropReason });
  }

  if (enableErrorNotify && !runSuperseded) {
    try {
      await deliver({ text: runTimedOut ? "处理中超时，请稍后重试。" : "⚠️ 服务调用失败，请稍后重试。" });
    } catch {}
  }

  if (!hadDelivered && !runSuperseded && (runTimedOut || hadFallbackEligibleDrop) && canSendFallbackNow()) {
    const fallbackText = "处理中断，请再发一次。";
    try {
      const sent = await sendFallbackAfterDispatchError({ dispatchId, fallbackText });
      if (sent) {
        recordFallbackSent();
        setRouteHadDelivered(true);
        console.warn(
          `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} run_timeout=${runTimedOut} superseded=${runSuperseded} drop_reason=fallback_sent_after_dispatch_error`,
        );
        return { sentFallback: true };
      }
    } catch (fallbackErr: any) {
      console.warn(
        `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} run_timeout=${runTimedOut} superseded=${runSuperseded} drop_reason=fallback_send_failed error=${fallbackErr?.message || fallbackErr}`,
      );
    }
  }

  return { sentFallback: false };
}
