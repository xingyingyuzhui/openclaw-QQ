import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { QQConfig } from "../config.js";
import type { OneBotClient } from "../client.js";
import type { OneBotMessage } from "../types.js";
import type { QQReplyPayload } from "../types/reply.js";
import { resolveOutboundTarget, buildResidentSessionKey, routeToResidentAgentId } from "../routing.js";
import { getQQRuntime } from "../runtime.js";
import { ensureRouteAgentMetadata, migrateLegacySessionIfNeeded, bumpRouteUsage, consumeImageQuota } from "../session-store.js";
import { normalizeReplyPayload } from "./media-payload-normalizer.js";
import { sendTextChunks } from "./text-sender.js";
import { sendMediaItems } from "./media-sender.js";
import { sendToParsedTarget } from "./send-target.js";
import { checkConversationPolicyHook } from "../policy/capability-guard.js";
import { checkRouteUsageQuota } from "../policy/quota-guard.js";
import { sanitizeOutboundText } from "../diagnostics/logger.js";
import { isAutomationMetaLeakText } from "../services/outbound-guard-service.js";
import { canSendImage, canSendRecord } from "../services/message-service.js";

type DeliveryManagerLike = {
  sendWithRetry: (config: QQConfig, meta: any, run: () => Promise<any>) => Promise<any>;
  enqueueSend: (config: QQConfig, fn: () => Promise<void>) => Promise<void>;
};

export async function sendDirectOutbound(params: {
  to: string;
  text?: string;
  mediaUrl?: string;
  replyTo?: string | number;
  accountId: string;
  cfg: any;
  client: OneBotClient;
  deliveryManager: DeliveryManagerLike;
  defaultSendConfig: QQConfig;
  resolveAccountWorkspaceRoot: (accountId: string) => string;
  conversationBaseDir: (accountId: string, route: string) => string;
  appendConversationLog: (
    route: string,
    accountId: string,
    direction: "in" | "out",
    data: {
      messageId?: string | number | null;
      text?: string;
      mediaCount?: number;
      filePath?: string;
      mediaItemsTotal?: number;
      mediaItemsMaterialized?: number;
      mediaItemsUnresolved?: number;
      unresolvedReasons?: string[];
    },
  ) => Promise<void>;
}): Promise<{ channel: "qq"; sent: boolean; error?: string }> {
  const {
    to,
    text,
    mediaUrl,
    replyTo,
    accountId,
    cfg,
    client,
    deliveryManager,
    defaultSendConfig,
    resolveAccountWorkspaceRoot,
    conversationBaseDir,
    appendConversationLog,
  } = params;

  const parsed = await resolveOutboundTarget(to);
  if (!parsed) return { channel: "qq", sent: false, error: `Unknown target format: ${to}` };

  const outboundWorkspaceRoot = resolveAccountWorkspaceRoot(accountId);
  await ensureRouteAgentMetadata(outboundWorkspaceRoot, parsed.route, DEFAULT_ACCOUNT_ID);

  const runtime = getQQRuntime();
  const canonicalSessionKey = buildResidentSessionKey(parsed.route);
  const canonicalAgentId = routeToResidentAgentId(parsed.route);
  await migrateLegacySessionIfNeeded(runtime, cfg || {}, accountId, parsed.route, canonicalSessionKey, canonicalAgentId);

  const outboundConfig = (cfg?.channels?.qq?.accounts?.[accountId] || cfg?.channels?.qq || defaultSendConfig) as QQConfig;
  const normalized = normalizeReplyPayload(
    {
      text: sanitizeOutboundText(text || ""),
      ...(mediaUrl ? { mediaUrl } : {}),
    } as QQReplyPayload,
    outboundConfig,
    { splitSendRequested: false, maxMessageLength: outboundConfig.maxMessageLength || 4000 },
  );

  let replyInjected = false;

  await checkConversationPolicyHook(defaultSendConfig, outboundWorkspaceRoot, "beforeOutbound", parsed.route, "sendText");
  await sendTextChunks({
    chunks: normalized.textChunks,
    targetKind: parsed.kind,
    userId: parsed.kind === "user" ? parsed.userId : 0,
    enqueue: async (fn) => deliveryManager.enqueueSend(defaultSendConfig, fn),
    sendTextChunk: async (chunk) => {
      if (isAutomationMetaLeakText(chunk)) {
        console.log(`[QQ][outbound] route=${parsed.route} source=automation skip_reason=automation_meta_leak_guard`);
        return false;
      }
      let message: OneBotMessage | string = chunk;
      if (replyTo && !replyInjected) {
        message = [{ type: "reply", data: { id: String(replyTo) } }, { type: "text", data: { text: chunk } }];
        replyInjected = true;
      }
      await checkRouteUsageQuota(outboundWorkspaceRoot, parsed.route, "sendText");
      await deliveryManager.sendWithRetry(
        defaultSendConfig,
        {
          accountId,
          route: parsed.route,
          targetKind: parsed.kind,
          action: "send_text",
          summary: chunk,
        },
        async () => sendToParsedTarget(client, parsed, message),
      );
      return true;
    },
    onChunkSent: async (chunk) => {
      await appendConversationLog(parsed.route, accountId, "out", { text: chunk, mediaCount: 0 });
      await bumpRouteUsage(outboundWorkspaceRoot, parsed.route, "sendText");
    },
  });

  await sendMediaItems({
    items: normalized.mediaItems,
    route: parsed.route,
    workspaceRoot: outboundWorkspaceRoot,
    config: outboundConfig,
    conversationBaseDir: (r) => conversationBaseDir(accountId, r),
    enqueue: async (fn) => deliveryManager.enqueueSend(defaultSendConfig, fn),
    sendSegments: async (segments, mediaDedupKey) => {
      let message = segments;
      if (replyTo && !replyInjected) {
        message = [{ type: "reply", data: { id: String(replyTo) } }, ...segments];
        replyInjected = true;
      }
      await deliveryManager.sendWithRetry(
        defaultSendConfig,
        {
          accountId,
          route: parsed.route,
          targetKind: parsed.kind,
          action: "send_media",
          summary: JSON.stringify(segments).slice(0, 180),
          mediaDedupKey,
        },
        async () => sendToParsedTarget(client, parsed, message),
      );
    },
    checkBeforeOutboundMedia: async () =>
      checkConversationPolicyHook(defaultSendConfig, outboundWorkspaceRoot, "beforeOutbound", parsed.route, "sendMedia"),
    checkQuota: async (kind) =>
      checkRouteUsageQuota(outboundWorkspaceRoot, parsed.route, kind === "sendVoice" ? "sendVoice" : "sendMedia"),
    canSendRecord: async () => canSendRecord(client, { route: parsed.route, source: "chat", stage: "direct_send_media" }),
    canSendImage: async () => canSendImage(client, { route: parsed.route, source: "chat", stage: "direct_send_media" }),
    consumeImageQuota: async () => consumeImageQuota(outboundWorkspaceRoot, parsed.route),
    onSent: async (item, persistedPath, kind) => {
      await appendConversationLog(parsed.route, accountId, "out", {
        text: item.name || item.source,
        mediaCount: 1,
        filePath: persistedPath,
      });
      await bumpRouteUsage(outboundWorkspaceRoot, parsed.route, kind === "record" ? "sendVoice" : "sendMedia");
    },
    streamClient: client,
  });

  return { channel: "qq", sent: true };
}
