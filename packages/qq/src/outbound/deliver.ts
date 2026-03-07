import type { ReplyPayload } from "openclaw/plugin-sdk";
import { logDeliveryAttemptTrace } from "../diagnostics/logger.js";
import { checkConversationPolicyHook } from "../policy/capability-guard.js";
import { checkRouteUsageQuota } from "../policy/quota-guard.js";
import { getRouteInFlight } from "../core/runtime-context.js";
import { consumeImageQuota, bumpRouteUsage } from "../session-store.js";
import { parseTarget } from "../routing.js";
import type { OneBotClient } from "../client.js";
import type { OneBotMessage } from "../types.js";
import type { QQConfig } from "../config.js";
import type { QQReplyPayload, DeliveryDropReason } from "../types/reply.js";
import { normalizeReplyPayload } from "./media-payload-normalizer.js";
import { sendTextChunks, buildTextMessage } from "./text-sender.js";
import { sendMediaItems } from "./media-sender.js";
import { sendToParsedTarget } from "./send-target.js";
import { canSendImage, canSendRecord } from "../services/message-service.js";
import {
  isAbortLeakText,
  isAbortLeakTextLoose,
  isAutomationMetaLeakText,
  isAutomationSkipText,
  isFallbackEligibleDropReason,
  scrubLiteRouteNoise,
} from "../services/outbound-guard-service.js";
import { shouldSuppressDuplicateOutboundText, rememberRouteOutboundText } from "../state/route-runtime-registry.js";

export { normalizeReplyPayload } from "./media-payload-normalizer.js";
export { sendTextChunks } from "./text-sender.js";
export { sendMediaItems } from "./media-sender.js";

type DeliveryManagerLike = {
  sendWithRetry: (config: QQConfig, meta: any, run: () => Promise<any>) => Promise<any>;
  enqueueSend: (config: QQConfig, fn: () => Promise<void>) => Promise<void>;
};

type AppendConversationOutPayload = {
  text?: string;
  mediaCount?: number;
  filePath?: string;
};

type DeliverStateAccess = {
  getRouteHadDelivered: () => boolean;
  setRouteHadDelivered: (value: boolean) => void;
  getRouteHadMediaDelivered: () => boolean;
  setRouteHadMediaDelivered: (value: boolean) => void;
  getRouteHadDropped: () => boolean;
  setRouteHadDropped: (value: boolean) => void;
  getRouteHadFallbackEligibleDrop: () => boolean;
  setRouteHadFallbackEligibleDrop: (value: boolean) => void;
  setRouteFallbackSentAt: (value: number) => void;
};

export async function deliverReplyPayload(params: {
  payload: ReplyPayload;
  route: string;
  msgIdText: string;
  userId: string;
  accountId: string;
  config: QQConfig;
  client: OneBotClient;
  splitSendRequested: boolean;
  useLiteContext: boolean;
  inboundLowSignalForRepeatGuard: boolean;
  accountWorkspaceRoot: string;
  getDispatchId: () => string;
  assertDispatchCanSend: (dispatchId: string, opts?: { allowMissingInFlight?: boolean }) => void;
  getDropReasonFromError: (error: unknown) => DeliveryDropReason | undefined;
  canSendFallbackNow: () => boolean;
  recordFallbackSent: () => void;
  nextAttemptId: (kind: "text" | "media") => string;
  deliveryManager: DeliveryManagerLike;
  conversationBaseDir: (route: string) => string;
  appendConversationOut: (data: AppendConversationOutPayload) => Promise<void>;
  state: DeliverStateAccess;
}): Promise<void> {
  const {
    payload,
    route,
    msgIdText,
    userId,
    accountId,
    config,
    client,
    splitSendRequested,
    useLiteContext,
    inboundLowSignalForRepeatGuard,
    accountWorkspaceRoot,
    getDispatchId,
    assertDispatchCanSend,
    getDropReasonFromError,
    canSendFallbackNow,
    recordFallbackSent,
    nextAttemptId,
    deliveryManager,
    conversationBaseDir,
    appendConversationOut,
    state,
  } = params;

  const boundRoute = route;
  const initialDispatchId = getDispatchId();
  if (initialDispatchId) {
    const inflight = getRouteInFlight(route);
    if (!inflight || inflight.dispatchId !== initialDispatchId) {
      console.warn(
        `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${initialDispatchId} run_timeout=false superseded=true drop_reason=dispatch_id_mismatch`,
      );
      return;
    }
  }

  try {
    const textPreview = typeof payload?.text === "string" ? payload.text.slice(0, 120).replace(/\s+/g, " ") : "";
    const fileCount = Array.isArray((payload as any)?.files) ? (payload as any).files.length : 0;
    console.log(
      `[QQ][deliver] route=${route} msg_id=${msgIdText} dispatch_id=${initialDispatchId || "none"} hasText=${Boolean(payload?.text)} files=${fileCount} preview=${textPreview}`,
    );
  } catch {}

  const target = parseTarget(route);
  if (!target) return;
  if (target.route !== boundRoute) throw new Error(`QQ route isolation violation: ${boundRoute} -> ${target.route}`);

  const normalized = normalizeReplyPayload(payload as QQReplyPayload, config, {
    splitSendRequested,
    maxMessageLength: config.maxMessageLength || 4000,
  });
  const strictAbortPattern = (config as any).outboundAbortPatternStrict !== false;
  const prefilteredChunks = normalized.textChunks
    .map((chunk) => {
      const base = useLiteContext ? scrubLiteRouteNoise(chunk) : chunk;
      return String(base || "").trim();
    })
    .filter((chunk) => chunk.length > 0);
  const filteredTextChunks = prefilteredChunks.filter((chunk) =>
    strictAbortPattern ? !isAbortLeakText(chunk) : !isAbortLeakTextLoose(chunk),
  );

  if (normalized.textChunks.length > 0 && filteredTextChunks.length !== normalized.textChunks.length) {
    console.warn(
      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${getDispatchId() || "none"} run_timeout=false superseded=false drop_reason=abort_text_suppressed`,
    );
    state.setRouteHadDropped(true);
    state.setRouteHadFallbackEligibleDrop(
      state.getRouteHadFallbackEligibleDrop() || isFallbackEligibleDropReason("abort_text_suppressed"),
    );
  }

  const sendTextChunk = async (chunk: string, replyId?: string, action = "send_text") => {
    const dispatchId = getDispatchId();
    const attemptId = nextAttemptId("text");
    logDeliveryAttemptTrace({
      route,
      msgId: msgIdText,
      dispatchId: dispatchId || "none",
      attemptId,
      phase: "prepared",
      action,
    });

    try {
      if (isAutomationMetaLeakText(chunk)) {
        state.setRouteHadDropped(true);
        state.setRouteHadFallbackEligibleDrop(
          state.getRouteHadFallbackEligibleDrop() || isFallbackEligibleDropReason("automation_meta_leak_guard"),
        );
        logDeliveryAttemptTrace({
          route,
          msgId: msgIdText,
          dispatchId: dispatchId || "none",
          attemptId,
          phase: "dropped",
          result: "dropped",
          dropReason: "automation_meta_leak_guard",
          action,
        });
        console.log(
          `[QQ][deliver] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} source=automation skip_reason=automation_meta_leak_guard`,
        );
        return false;
      }

      const dedupWindowMs = Math.max(0, Number((config as any).outboundTextDedupWindowMs ?? 12_000));
      if (dedupWindowMs > 0 && shouldSuppressDuplicateOutboundText(route, chunk, dedupWindowMs)) {
        state.setRouteHadDropped(true);
        state.setRouteHadFallbackEligibleDrop(
          state.getRouteHadFallbackEligibleDrop() || isFallbackEligibleDropReason("duplicate_text_suppressed"),
        );
        logDeliveryAttemptTrace({
          route,
          msgId: msgIdText,
          dispatchId: dispatchId || "none",
          attemptId,
          phase: "dropped",
          result: "dropped",
          dropReason: "duplicate_text_suppressed",
          action,
        });
        console.warn(
          `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=duplicate_text_suppressed`,
        );
        return false;
      }

      const repeatGuardWindowMs = Math.max(0, Number((config as any).outboundRepeatGuardWindowMs ?? 2 * 60 * 60 * 1000));
      if (
        inboundLowSignalForRepeatGuard &&
        repeatGuardWindowMs > 0 &&
        chunk.trim().length >= 24 &&
        shouldSuppressDuplicateOutboundText(route, chunk, repeatGuardWindowMs)
      ) {
        state.setRouteHadDropped(true);
        state.setRouteHadFallbackEligibleDrop(
          state.getRouteHadFallbackEligibleDrop() || isFallbackEligibleDropReason("duplicate_text_suppressed"),
        );
        logDeliveryAttemptTrace({
          route,
          msgId: msgIdText,
          dispatchId: dispatchId || "none",
          attemptId,
          phase: "dropped",
          result: "dropped",
          dropReason: "duplicate_text_suppressed",
          action,
        });
        console.warn(
          `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=repeat_guard_suppressed`,
        );
        return false;
      }

      await checkRouteUsageQuota(accountWorkspaceRoot, route, "sendText");
      const message = buildTextMessage(chunk, replyId);
      logDeliveryAttemptTrace({
        route,
        msgId: msgIdText,
        dispatchId: dispatchId || "none",
        attemptId,
        phase: "queued",
        action,
      });
      await deliveryManager.sendWithRetry(
        config,
        {
          accountId,
          route,
          targetKind: target.kind,
          action,
          summary: chunk,
          msgId: msgIdText,
          dispatchId: dispatchId || "none",
          attemptId,
          source: isAutomationSkipText(chunk) ? "automation" : "chat",
          preflight: () => {
            const latestDispatchId = getDispatchId();
            if (latestDispatchId) assertDispatchCanSend(latestDispatchId, { allowMissingInFlight: true });
            logDeliveryAttemptTrace({
              route,
              msgId: msgIdText,
              dispatchId: latestDispatchId || "none",
              attemptId,
              phase: "sending",
              action,
            });
          },
        },
        async () => sendToParsedTarget(client, target, message),
      );

      state.setRouteHadDelivered(true);
      logDeliveryAttemptTrace({
        route,
        msgId: msgIdText,
        dispatchId: dispatchId || "none",
        attemptId,
        phase: "sent",
        result: "ok",
        action,
      });
      rememberRouteOutboundText(route, chunk);
      return true;
    } catch (err: any) {
      state.setRouteHadDropped(true);
      const dropReason = getDropReasonFromError(err);
      if (dropReason) {
        state.setRouteHadFallbackEligibleDrop(state.getRouteHadFallbackEligibleDrop() || isFallbackEligibleDropReason(dropReason));
        logDeliveryAttemptTrace({
          route,
          msgId: msgIdText,
          dispatchId: dispatchId || "none",
          attemptId,
          phase: "dropped",
          result: "dropped",
          dropReason,
          action,
        });
        return false;
      }

      const maybeQuota = String(err?.message || "").toLowerCase().includes("quota exceeded");
      if (!maybeQuota) {
        state.setRouteHadFallbackEligibleDrop(true);
      }
      logDeliveryAttemptTrace({
        route,
        msgId: msgIdText,
        dispatchId: dispatchId || "none",
        attemptId,
        phase: "failed",
        result: "failed",
        dropReason: maybeQuota ? "quota_exceeded" : undefined,
        action,
        error: err?.message || String(err),
      });
      throw err;
    }
  };

  const sendSegments = async (segments: OneBotMessage, mediaDedupKey?: string) => {
    const dispatchId = getDispatchId();
    const attemptId = nextAttemptId("media");
    logDeliveryAttemptTrace({
      route,
      msgId: msgIdText,
      dispatchId: dispatchId || "none",
      attemptId,
      phase: "queued",
      action: "send_media",
    });

    if (dispatchId) assertDispatchCanSend(dispatchId, { allowMissingInFlight: true });
    await deliveryManager.sendWithRetry(
      config,
      {
        accountId,
        route,
        targetKind: target.kind,
        action: "send_media",
        summary: JSON.stringify(segments).slice(0, 180),
        mediaDedupKey,
        msgId: msgIdText,
        dispatchId: dispatchId || "none",
        attemptId,
        source: "chat",
        preflight: () => {
          const latestDispatchId = getDispatchId();
          if (latestDispatchId) assertDispatchCanSend(latestDispatchId, { allowMissingInFlight: true });
          logDeliveryAttemptTrace({
            route,
            msgId: msgIdText,
            dispatchId: latestDispatchId || "none",
            attemptId,
            phase: "sending",
            action: "send_media",
          });
        },
      },
      async () => sendToParsedTarget(client, target, segments),
    );

    state.setRouteHadDelivered(true);
    state.setRouteHadMediaDelivered(true);
    logDeliveryAttemptTrace({
      route,
      msgId: msgIdText,
      dispatchId: dispatchId || "none",
      attemptId,
      phase: "sent",
      result: "ok",
      action: "send_media",
    });
  };

  try {
    await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeOutbound", route, "sendText");
  } catch (err: any) {
    state.setRouteHadDropped(true);
    state.setRouteHadFallbackEligibleDrop(state.getRouteHadFallbackEligibleDrop() || isFallbackEligibleDropReason("policy_blocked"));
    const dispatchId = getDispatchId();
    logDeliveryAttemptTrace({
      route,
      msgId: msgIdText,
      dispatchId: dispatchId || "none",
      attemptId: `${dispatchId || "none"}:policy:${nextAttemptId("text")}`,
      phase: "dropped",
      result: "dropped",
      dropReason: "policy_blocked",
      action: "send_text",
      error: err?.message || String(err),
    });
    throw err;
  }

  await sendTextChunks({
    chunks: filteredTextChunks,
    targetKind: target.kind,
    userId,
    enqueue: async (fn) => deliveryManager.enqueueSend(config, fn),
    sendTextChunk: async (chunk) => sendTextChunk(chunk),
    onChunkSent: async (chunk) => {
      const dispatchId = getDispatchId();
      if (dispatchId) assertDispatchCanSend(dispatchId, { allowMissingInFlight: true });
      await appendConversationOut({ text: chunk, mediaCount: 0 });
      await bumpRouteUsage(accountWorkspaceRoot, route, "sendText");
    },
  });

  await sendMediaItems({
    items: normalized.mediaItems,
    route,
    workspaceRoot: accountWorkspaceRoot,
    config,
    conversationBaseDir,
    enqueue: async (fn) => deliveryManager.enqueueSend(config, fn),
    sendSegments: async (segments, dedup) => sendSegments(segments, dedup),
    checkBeforeOutboundMedia: async () =>
      checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeOutbound", route, "sendMedia"),
    checkQuota: async (kind) => checkRouteUsageQuota(accountWorkspaceRoot, route, kind === "sendVoice" ? "sendVoice" : "sendMedia"),
    canSendRecord: async () =>
      canSendRecord(client, {
        route,
        msgId: msgIdText,
        dispatchId: getDispatchId() || undefined,
        source: "chat",
        stage: "deliver_media",
      }),
    canSendImage: async () =>
      canSendImage(client, {
        route,
        msgId: msgIdText,
        dispatchId: getDispatchId() || undefined,
        source: "chat",
        stage: "deliver_media",
      }),
    consumeImageQuota: async () => consumeImageQuota(accountWorkspaceRoot, route),
    onSent: async (item, persistedPath, kind) => {
      const dispatchId = getDispatchId();
      if (dispatchId) assertDispatchCanSend(dispatchId, { allowMissingInFlight: true });
      await appendConversationOut({ text: item.name || item.source, mediaCount: 1, filePath: persistedPath });
      await bumpRouteUsage(accountWorkspaceRoot, route, kind === "record" ? "sendVoice" : "sendMedia");
    },
    streamClient: client,
  });

  if (!state.getRouteHadDelivered() && state.getRouteHadDropped() && state.getRouteHadFallbackEligibleDrop() && canSendFallbackNow()) {
    const dispatchId = getDispatchId();
    const fallbackText = "处理中断，请再发一次。";
    try {
      if (dispatchId) {
        const inflight = getRouteInFlight(route);
        if (!inflight || inflight.dispatchId !== dispatchId) {
          state.setRouteHadDropped(true);
          logDeliveryAttemptTrace({
            route,
            msgId: msgIdText,
            dispatchId: dispatchId || "none",
            attemptId: `${nextAttemptId("text")}:fallback`,
            phase: "dropped",
            result: "dropped",
            dropReason: "dispatch_id_mismatch",
            action: "send_text",
          });
          console.warn(
            `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=true drop_reason=fallback_dispatch_mismatch`,
          );
          return;
        }
      }

      await deliveryManager.sendWithRetry(
        config,
        {
          accountId,
          route,
          targetKind: target.kind,
          action: "send_text",
          summary: fallbackText,
          msgId: msgIdText,
          dispatchId: dispatchId || "none",
          attemptId: `${nextAttemptId("text")}:fallback`,
          source: "chat",
        },
        async () => sendToParsedTarget(client, target, fallbackText),
      );
      await appendConversationOut({ text: fallbackText, mediaCount: 0 });
      const fallbackAt = Date.now();
      state.setRouteFallbackSentAt(fallbackAt);
      recordFallbackSent();
      state.setRouteHadDelivered(true);
      console.warn(
        `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=fallback_sent_on_drop fallback_at=${fallbackAt}`,
      );
    } catch (fallbackErr: any) {
      console.warn(
        `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=fallback_send_failed error=${fallbackErr?.message || fallbackErr}`,
      );
    }
  }
}
