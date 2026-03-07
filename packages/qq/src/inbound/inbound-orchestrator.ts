import { DEFAULT_ACCOUNT_ID, type ReplyPayload } from "openclaw/plugin-sdk";
import type { OneBotClient } from "../client.js";
import type { QQConfig } from "../config.js";
import { handleQQSlashCommand } from "../commands.js";
import { withTimeout } from "../utils/timeouts.js";
import { enqueueRouteTask } from "../task-units.js";
import { deliverReplyPayload } from "../outbound/deliver.js";
import { sendToParsedTarget } from "../outbound/send-target.js";
import { logQQTrace } from "../diagnostics/logger.js";
import { checkConversationPolicyHook } from "../policy/capability-guard.js";
import { getRouteSendBudget } from "../policy/quota-guard.js";
import { cleanCQCodes, getReplyMessageId } from "./message-normalizer.js";
import {
  buildQQSystemBlock,
  resolveInboundRouteContext,
  shouldSplitSendRequested,
} from "./session-pipeline.js";
import {
  finalizeRouteAggregation,
  getRouteAggregationSeq,
  isRouteGenerationCurrent,
  nextRouteGeneration,
  pushRouteAggregation,
} from "./aggregation.js";
import { messageMentionsSelf } from "../inbound-utils.js";
import { parseInboundMessage } from "./message-handler.js";
import {
  buildGroupHistoryContext,
  isTriggeredByMentionOrKeyword,
  passesRequireMention,
} from "./message-handler.js";
import { runInboundDispatchCycle } from "./dispatch-executor.js";
import { createTaskStatePersister, prepareInboundSessionPipeline } from "./session-orchestrator.js";
import {
  beginRouteInFlight,
  clearRouteInFlight,
  getRouteInFlight,
  hasRouteInFlight,
  routeHadRecentTimeout,
} from "../core/runtime-context.js";
import {
  buildResidentSessionKey,
  parseTarget,
  routeToResidentAgentId,
} from "../routing.js";
import {
  bumpRouteUsage,
  ensureRouteAgentMetadata,
  migrateLegacySessionIfNeeded,
  readRouteCapabilityPolicy,
  readRouteUsageStats,
  updateConversationStateOnInbound,
  writeRouteCapabilityPolicy,
  writeRouteUsageStats,
} from "../session-store.js";
import { getQQRuntime } from "../runtime.js";
import {
  getCachedMemberName,
  getRouteLatestMediaManifest,
  getRouteMediaManifest,
  getRouteRecentMedia,
  isRouteFileTaskLocked,
  lockRouteFileTask,
  rememberRouteMediaManifest,
  rememberRouteRecentMedia,
  setCachedMemberName,
} from "../state/media-state-registry.js";
import {
  canSendRouteFallback,
  markRouteFallbackSent,
  nextRouteInboundSeq,
  setRouteLastInboundAt,
} from "../state/route-runtime-registry.js";
import { ensureResidentAgentVisible } from "../services/resident-agent-service.js";
import { persistProactiveState } from "../services/proactive-state-service.js";
import { readRoutePersonaPrompt } from "../services/route-persona-service.js";
import { upsertRelationshipForRoute } from "../services/role-pack-service.js";
import { transcribeInboundVoiceOnce } from "../services/voice-transcription-service.js";
import { getMessage, sendGroupMessage, sendPrivateMessage } from "../services/message-service.js";
import { setGroupBan, setGroupKick } from "../services/group-admin-service.js";
import {
  scrubControlTokensForContext,
  scrubLiteHistoryContext,
  scrubLiteRouteNoise,
} from "../services/outbound-guard-service.js";
import type { DeliveryDropReason } from "../types/reply.js";
import type { ResolvedQQAccount } from "../types/channel.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class DispatchDropError extends Error {
  reason: DeliveryDropReason;

  constructor(reason: DeliveryDropReason) {
    super(reason);
    this.reason = reason;
    this.name = "DispatchDropError";
  }
}

function assertDispatchCanSend(
  route: string,
  msgIdText: string,
  dispatchId: string,
  opts?: { allowMissingInFlight?: boolean },
): void {
  const inflight = getRouteInFlight(route);
  if (!inflight) {
    if (opts?.allowMissingInFlight) return;
    throw new DispatchDropError("dispatch_id_mismatch");
  }
  if (inflight.dispatchId !== dispatchId) {
    throw new DispatchDropError("dispatch_id_mismatch");
  }
  if (inflight.abortController.signal.aborted) {
    throw new DispatchDropError("dispatch_aborted");
  }
}

function routeUsesLiteContext(config: QQConfig, route: string): boolean {
  const routes = Array.isArray((config as any)?.liteContextRoutes) ? (config as any).liteContextRoutes : [];
  const target = String(route || "").trim();
  if (!target) return false;
  return routes.some((it: unknown) => {
    const rule = String(it || "").trim();
    if (!rule) return false;
    if (rule === "*") return true;
    if (rule.endsWith("*")) return target.startsWith(rule.slice(0, -1));
    return rule === target;
  });
}

export async function handleInboundMessageEvent(params: {
  event: any;
  client: OneBotClient;
  account: ResolvedQQAccount;
  cfg: any;
  config: QQConfig;
  accountWorkspaceRoot: string;
  processedMsgIds: Set<string>;
  deliveryManager: any;
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
}): Promise<void> {
  const {
    event,
    client,
    account,
    cfg,
    config,
    accountWorkspaceRoot,
    processedMsgIds,
    deliveryManager,
    conversationBaseDir,
    appendConversationLog,
  } = params;

  try {
    if (event.post_type === "meta_event") {
      if (event.meta_event_type === "lifecycle" && event.sub_type === "connect" && event.self_id) client.setSelfId(event.self_id);
      return;
    }

    if (event.post_type === "notice" && event.notice_type === "notify" && event.sub_type === "poke") {
      if (String(event.target_id) === String(client.getSelfId())) {
        event.post_type = "message";
        event.message_type = event.group_id ? "group" : "private";
        event.raw_message = `[动作] 用户戳了你一下`;
        event.message = [{ type: "text", data: { text: event.raw_message } }];
      } else return;
    }

    if (event.post_type !== "message") return;

    const selfId = client.getSelfId() || event.self_id;
    if (selfId && String(event.user_id) === String(selfId)) return;

    if (config.enableDeduplication !== false && event.message_id) {
      const msgIdKey = [
        account.accountId,
        String(event.self_id ?? client.getSelfId() ?? ""),
        String(event.message_type || ""),
        String(event.group_id ?? ""),
        String(event.user_id ?? ""),
        String(event.message_id),
      ].join("|");
      if (processedMsgIds.has(msgIdKey)) return;
      processedMsgIds.add(msgIdKey);
    }

    if (event.message_type === "guild" && !config.enableGuilds) return;

    const isGroupMsg = event.message_type === "group";
    const aggregateWindowMs = Math.max(
      0,
      Number(
        isGroupMsg
          ? ((config as any).groupAggregateWindowMs ?? (config as any).aggregateWindowMs ?? 900)
          : ((config as any).dmAggregateWindowMs ?? (config as any).aggregateWindowMs ?? 900),
      ),
    );
    const parsedInbound = await parseInboundMessage({
      event,
      client,
      aggregateWindowMs,
      conversationBaseDir: (route) => conversationBaseDir(account.accountId, route),
      nextRouteGeneration,
      pushRouteAggregation,
      isRouteGenerationCurrent,
      getRouteAggregationSeq,
      finalizeRouteAggregation,
      getCachedMemberName,
      setCachedMemberName,
      sleep,
      inboundMediaResolvePrefer: (config as any).inboundMediaResolvePrefer ?? "napcat-first",
      inboundMediaHttpTimeoutMs: Number((config as any).inboundMediaHttpTimeoutMs ?? 8000),
      inboundMediaHttpRetries: Number((config as any).inboundMediaHttpRetries ?? 2),
      inboundMediaUseStream: (config as any).inboundMediaUseStream !== false,
      inboundMediaFallbackGetMsg: (config as any).inboundMediaFallbackGetMsg !== false,
      inboundMediaMaxPerMessage: Math.max(1, Number((config as any).inboundMediaMaxPerMessage ?? 8)),
    });
    if (!parsedInbound) return;

    const {
      text,
      inboundRoute,
      routeGen,
      userId,
      groupId,
      guildId,
      channelId,
      isGroup,
      isGuild,
      effectiveInboundMediaUrls,
      materializedInboundMediaUrls,
      mediaItemsTotal,
      mediaItemsMaterialized,
      mediaItemsUnresolved,
      unresolvedReasons,
    } = parsedInbound;
    const inboundTs = Date.now();
    setRouteLastInboundAt(account.accountId, inboundRoute, inboundTs);
    const proactiveRoute = String((config as any).proactiveDmRoute || "user:123456789").trim();
    if ((config as any).proactiveDmEnabled === true && inboundRoute === proactiveRoute) {
      void persistProactiveState(
        accountWorkspaceRoot,
        account.accountId,
        inboundRoute,
        (config as any).proactiveDmLogVerbose === true,
      );
    }
    const mergedLocalInboundMediaUrls = Array.from(
      new Set(
        [...materializedInboundMediaUrls, ...effectiveInboundMediaUrls.filter((u) => /^file:\/\//i.test(String(u || "")))]
          .filter(Boolean)
          .map((u) => String(u)),
      ),
    );
    const currentMsgId = String(event.message_id ?? "");
    const inboundSeq = nextRouteInboundSeq(inboundRoute);
    if (currentMsgId) {
      rememberRouteMediaManifest(inboundRoute, currentMsgId, effectiveInboundMediaUrls, mergedLocalInboundMediaUrls);
    }
    if (mergedLocalInboundMediaUrls.length > 0) {
      rememberRouteRecentMedia(inboundRoute, mergedLocalInboundMediaUrls, currentMsgId);
      lockRouteFileTask(inboundRoute, Number((config as any).fileTaskLockMs || 60_000));
    }

    if (config.blockedUsers?.includes(userId)) return;
    if (isGroup && config.allowedGroups?.length && !config.allowedGroups.includes(groupId)) return;

    const isAdmin = config.admins?.includes(userId) ?? false;

    const currentRouteContext = resolveInboundRouteContext({
      isGroup,
      isGuild,
      userId,
      groupId,
      guildId,
      channelId,
    });
    const runtime = getQQRuntime();

    const slashHandled = await handleQQSlashCommand({
      text,
      isGuild,
      isGroup,
      isAdmin,
      userId,
      groupId,
      selfId: client.getSelfId(),
      sendGroup: (msg) => {
        void sendGroupMessage(client, groupId, msg, { route: `group:${String(groupId)}`, source: "chat", stage: "slash_command" });
      },
      sendPrivate: (msg) => {
        void sendPrivateMessage(client, userId, msg, { route: `user:${String(userId)}`, source: "chat", stage: "slash_command" });
      },
      setGroupBan: (gid, uid, durationSec) => {
        void setGroupBan(client, gid, uid, durationSec, { route: `group:${String(gid)}`, source: "chat", stage: "slash_command" });
      },
      setGroupKick: (gid, uid) => {
        void setGroupKick(client, gid, uid, false, { route: `group:${String(gid)}`, source: "chat", stage: "slash_command" });
      },
      readRouteCapabilityPolicy: (route) => readRouteCapabilityPolicy(accountWorkspaceRoot, route),
      readRouteUsageStats: (route) => readRouteUsageStats(accountWorkspaceRoot, route),
      writeRouteCapabilityPolicy: (route, caps) => writeRouteCapabilityPolicy(accountWorkspaceRoot, route, caps),
      writeRouteUsageStats: (route, stats) => writeRouteUsageStats(accountWorkspaceRoot, route, stats),
      adminsConfigured: Boolean(config.admins?.length),
      currentRoute: currentRouteContext.route,
      accountWorkspaceRoot,
      accountId: account.accountId,
      runtime,
    });
    if (slashHandled) return;

    if (isGroup) {
      const selfIdForMention = client.getSelfId();
      if (!messageMentionsSelf(event, selfIdForMention)) return;
    }

    let repliedMsg: any = null;
    const replyMsgId = getReplyMessageId(event.message, text);
    if (replyMsgId) {
      try {
        repliedMsg = await getMessage(client, replyMsgId, {
          route: isGroup ? `group:${String(groupId)}` : `user:${String(userId)}`,
          msgId: String(event.message_id ?? ""),
          source: "inbound",
          stage: "reply_context_lookup",
        });
      } catch {}
    }

    const historyContext = await buildGroupHistoryContext({
      isGroup,
      historyLimit: config.historyLimit ?? 5,
      groupId,
      client,
    });

    const isTriggered = isTriggeredByMentionOrKeyword({
      text,
      isGroup,
      isGuild,
      keywordTriggers: config.keywordTriggers,
    });

    const mentionPassed = passesRequireMention({
      event,
      requireMention: Boolean(config.requireMention),
      isGroup,
      isGuild,
      isTriggered,
      selfId: client.getSelfId(),
      repliedMsg,
    });
    if (!mentionPassed) return;

    const { route, conversationLabel } = currentRouteContext;
    const normalizedAccountId = DEFAULT_ACCOUNT_ID;
    const residentAgentId = routeToResidentAgentId(route);
    const residentSessionKey = buildResidentSessionKey(route);
    const msgIdText = String(event.message_id ?? "");
    await ensureResidentAgentVisible(runtime, accountWorkspaceRoot, residentAgentId);
    await ensureRouteAgentMetadata(accountWorkspaceRoot, route, normalizedAccountId);
    const conversationState = await updateConversationStateOnInbound(accountWorkspaceRoot, route, text);
    await upsertRelationshipForRoute(accountWorkspaceRoot, route, {
      affinity: Math.max(0, Math.min(100, 50 + Number(conversationState.affinity || 0))),
      trust: Math.max(0, Math.min(100, 50 - (conversationState.mood === "cold" ? 10 : conversationState.mood === "annoyed" ? 5 : 0))),
      initiative_level:
        conversationState.mood === "tired" || conversationState.mood === "annoyed"
          ? "low"
          : conversationState.affinity >= 15
            ? "high"
            : "medium",
    }).catch(() => null);
    logQQTrace({
      event: "qq_inbound_received",
      route,
      agent_id: residentAgentId,
      session_key: residentSessionKey,
      msg_id: msgIdText,
      source: "chat",
      account_id: account.accountId,
      workspace_root: accountWorkspaceRoot,
    });

    await appendConversationLog(route, account.accountId, "in", {
      messageId: event.message_id,
      text,
      mediaCount: effectiveInboundMediaUrls.length,
      filePath: mergedLocalInboundMediaUrls[0],
      mediaItemsTotal,
      mediaItemsMaterialized,
      mediaItemsUnresolved,
      unresolvedReasons,
    });

    const splitSendRequested = shouldSplitSendRequested(cleanCQCodes(text));
    const inboundTextForRepeatGuard = cleanCQCodes(text || "").trim();
    const inboundLowSignalForRepeatGuard =
      inboundTextForRepeatGuard.length <= 8 ||
      /^\[CQ:face/i.test(String(event.raw_message || "")) ||
      /^(好|嗯|哦|ok|okk|收到|知道了|哈哈|哈+|表情)+[!！。.\s]*$/i.test(inboundTextForRepeatGuard);
    const hasInboundMediaLike = mediaItemsTotal > 0 || mergedLocalInboundMediaUrls.length > 0;
    const replyRunTimeoutMs = Math.max(1000, Number((config as any).replyRunTimeoutMs ?? 600000));
    const routePreemptOldRunBase = (config as any).routePreemptOldRun !== false;
    const interruptPolicy = String((config as any).interruptPolicy ?? "adaptive");
    const adaptiveTimeoutDegradeWindowMs = Math.max(
      0,
      Number((config as any).adaptiveTimeoutDegradeWindowMs ?? 60_000),
    );
    const degradeToQueueLatest =
      interruptPolicy === "adaptive" &&
      adaptiveTimeoutDegradeWindowMs > 0 &&
      routeHadRecentTimeout(route, adaptiveTimeoutDegradeWindowMs);
    const mediaInterruptPolicy = String((config as any).mediaInterruptPolicy ?? "queue-latest");
    const lockBlocksPreempt = isRouteFileTaskLocked(route);
    const routePreemptOldRun =
      routePreemptOldRunBase &&
      !lockBlocksPreempt &&
      interruptPolicy !== "queue-latest" &&
      !degradeToQueueLatest &&
      (!hasInboundMediaLike || mediaInterruptPolicy === "adaptive-preempt");
    const replyAbortOnTimeout = (config as any).replyAbortOnTimeout !== false;
    let dispatchId = "";
    let routeHadDelivered = false;
    let routeHadMediaDelivered = false;
    let routeHadDropped = false;
    let routeHadFallbackEligibleDrop = false;
    let deliveryAttemptSeq = 0;
    const nextAttemptId = (kind: "text" | "media") => `${dispatchId || "none"}:${kind}:${++deliveryAttemptSeq}`;
    const recordFallbackSent = () => {
      markRouteFallbackSent(route);
    };
    const canSendFallbackNow = () => {
      const enabled = (config as any).outboundFallbackOnDrop !== false;
      if (!enabled) return false;
      const cooldownMs = Math.max(1000, Number((config as any).outboundFallbackCooldownMs ?? 30_000));
      return canSendRouteFallback(route, cooldownMs);
    };

    const useLiteContext = routeUsesLiteContext(config, route);
    const deliver = async (payload: ReplyPayload) => {
      await deliverReplyPayload({
        payload,
        route,
        msgIdText,
        userId: String(userId),
        accountId: account.accountId,
        config,
        client,
        splitSendRequested,
        useLiteContext,
        inboundLowSignalForRepeatGuard,
        accountWorkspaceRoot,
        getDispatchId: () => dispatchId,
        assertDispatchCanSend: (currentDispatchId, opts) =>
          assertDispatchCanSend(route, msgIdText, currentDispatchId, opts),
        getDropReasonFromError: (error) => (error instanceof DispatchDropError ? error.reason : undefined),
        canSendFallbackNow,
        recordFallbackSent,
        nextAttemptId,
        deliveryManager,
        conversationBaseDir: (r) => conversationBaseDir(account.accountId, r),
        appendConversationOut: async (data) =>
          appendConversationLog(route, account.accountId, "out", {
            text: data.text,
            mediaCount: data.mediaCount,
            filePath: data.filePath,
          }),
        state: {
          getRouteHadDelivered: () => routeHadDelivered,
          setRouteHadDelivered: (value) => {
            routeHadDelivered = value;
          },
          getRouteHadMediaDelivered: () => routeHadMediaDelivered,
          setRouteHadMediaDelivered: (value) => {
            routeHadMediaDelivered = value;
          },
          getRouteHadDropped: () => routeHadDropped,
          setRouteHadDropped: (value) => {
            routeHadDropped = value;
          },
          getRouteHadFallbackEligibleDrop: () => routeHadFallbackEligibleDrop,
          setRouteHadFallbackEligibleDrop: (value) => {
            routeHadFallbackEligibleDrop = value;
          },
          setRouteFallbackSentAt: () => {},
        },
      });
    };

    const { dispatcher, replyOptions: baseReplyOptions } = runtime.channel.reply.createReplyDispatcherWithTyping({ deliver });
    const replyOptions = {
      ...baseReplyOptions,
      disableBlockStreaming: (config as any).blockStreaming !== true,
    };

    let replyToBody = "";
    let replyToSender = "";
    if (replyMsgId && repliedMsg) {
      replyToBody = cleanCQCodes(typeof repliedMsg.message === "string" ? repliedMsg.message : repliedMsg.raw_message || "");
      replyToSender = repliedMsg.sender?.nickname || repliedMsg.sender?.card || String(repliedMsg.sender?.user_id || "");
    }

    const replySuffix = replyToBody ? `\n\n[Replying to ${replyToSender || "unknown"}]\n${replyToBody}\n[/Replying]` : "";
    let bodyWithReply = cleanCQCodes(text) + replySuffix;

    const sendBudget = await getRouteSendBudget(accountWorkspaceRoot, route);
    const mediaBlocked = sendBudget.mediaRemaining <= 0;
    const voiceBlocked = sendBudget.voiceRemaining <= 0;
    const inboundTextClean = cleanCQCodes(text);
    const asksForMediaAnalysis = /看图|识图|图片|附件|文件|语音|视频|内容|解析/i.test(inboundTextClean);
    const routeIsBusy = hasRouteInFlight(route);
    const routeRecentlyTimedOut = routeHadRecentTimeout(route, 2 * 60 * 1000);
    let effectiveHistoryContext = historyContext;
    if (useLiteContext && historyContext) {
      const cleanedHistory = scrubLiteHistoryContext(historyContext);
      const lines = cleanedHistory.split("\n").filter((it) => String(it || "").trim().length > 0);
      effectiveHistoryContext = lines.slice(-2).join("\n");
    }
    if ((routeIsBusy || routeRecentlyTimedOut) && historyContext) {
      const lines = historyContext.split("\n").filter((it) => String(it || "").trim().length > 0);
      const degraded = Math.max(1, Math.floor((config.historyLimit ?? 5) / 2));
      effectiveHistoryContext = lines.slice(-degraded).join("\n");
    }
    const routePersonaPrompt = await readRoutePersonaPrompt(accountWorkspaceRoot, route);
    const mergedSystemPrompt = [String(config.systemPrompt || "").trim(), routePersonaPrompt].filter(Boolean).join("\n\n");
    const blockBuild = buildQQSystemBlock({
      systemPrompt: mergedSystemPrompt || undefined,
      splitSendRequested,
      historyContext: effectiveHistoryContext,
      mediaBlocked,
      voiceBlocked,
      inboundTextClean,
      mediaRemaining: sendBudget.mediaRemaining,
      voiceRemaining: sendBudget.voiceRemaining,
      compactMode: useLiteContext,
    });
    if (blockBuild.shouldHardBlockMediaIntent) {
      await deliver({ text: blockBuild.hardBlockMessage || "已触发权限上限，请联系管理员。" });
      return;
    }

    bodyWithReply = blockBuild.systemBlock + bodyWithReply;
    if (!useLiteContext) {
      const routeInboundFilesDir = `${conversationBaseDir(account.accountId, route)}/in/files`;
      bodyWithReply = `<system>QQ入站非文本兜底规则：当消息包含“[图片]/[语音消息]/[文件]”占位，且上下文未显式提供可用媒体URL/本地路径时，必须主动检查当前route的入站落盘目录（${routeInboundFilesDir}），优先读取最近3分钟内最新的1-3个文件进行判断；禁止读取其他route目录。</system>\n\n` + bodyWithReply;
    }
    const historyIncludeMedia = Boolean((config as any).historyIncludeMedia);
    const historyMediaMaxItems = useLiteContext
      ? 1
      : Math.max(1, Number((config as any).historyMediaMaxItems ?? 1));
    const recentMediaTtlMs = Math.max(1000, Number((config as any).recentInboundMediaTtlMs ?? 10 * 60 * 1000));
    const currentMsgManifest = getRouteMediaManifest(route, msgIdText, recentMediaTtlMs);
    const latestManifest = getRouteLatestMediaManifest(route, recentMediaTtlMs);
    const recentInboundMediaUrls = getRouteRecentMedia(route, recentMediaTtlMs, historyMediaMaxItems);

    const attachInboundMediaUrls = (currentMsgManifest?.localUrls?.length ? currentMsgManifest.localUrls : [])
      .concat(mergedLocalInboundMediaUrls)
      .concat(asksForMediaAnalysis ? (latestManifest?.localUrls || recentInboundMediaUrls) : []);
    const attachMediaUrls = (currentMsgManifest?.mediaUrls?.length ? currentMsgManifest.mediaUrls : [])
      .concat(effectiveInboundMediaUrls)
      .concat(asksForMediaAnalysis ? (latestManifest?.mediaUrls || recentInboundMediaUrls) : []);

    const attachLocalFinal = Array.from(new Set(attachInboundMediaUrls.map((u) => String(u || "").trim()).filter(Boolean)));
    const attachMediaFinal = Array.from(new Set(attachMediaUrls.map((u) => String(u || "").trim()).filter(Boolean)));

    if (mediaItemsMaterialized > 0 && attachLocalFinal.length === 0 && attachMediaFinal.length === 0) {
      console.warn(
        `[QQ][ctx-attach-assert] route=${route} msgId=${msgIdText} materialized=${mediaItemsMaterialized} but no media attached`,
      );
    }

    const shouldAttachInboundMedia = useLiteContext
      ? attachLocalFinal.length > 0
      : historyIncludeMedia || attachLocalFinal.length > 0 || asksForMediaAnalysis;
    if (shouldAttachInboundMedia && attachLocalFinal.length > 0) {
      const mediaHints = attachLocalFinal.slice(0, historyMediaMaxItems).map((u, i) => `[入站媒体#${i + 1}] ${u}`);
      bodyWithReply = `${bodyWithReply}\n\n<inbound_media>\n${mediaHints.join("\n")}\n</inbound_media>`;
    }
    if (!useLiteContext && (attachMediaFinal.length > 0 || attachLocalFinal.length > 0)) {
      bodyWithReply = `${bodyWithReply}\n\n<inbound_media_manifest msg_id="${msgIdText}">\nmedia_urls=${attachMediaFinal.length}\nlocal_urls=${attachLocalFinal.length}\n</inbound_media_manifest>`;
    }
    bodyWithReply = scrubControlTokensForContext(bodyWithReply);
    if (useLiteContext) {
      bodyWithReply = scrubLiteRouteNoise(bodyWithReply);
    }
    if (useLiteContext) {
      console.log(
        `[QQ][ctx-lite] route=${route} msgId=${msgIdText} prompt_chars=${bodyWithReply.length} history_lines=${effectiveHistoryContext ? effectiveHistoryContext.split("\n").filter(Boolean).length : 0} media_hints=${attachLocalFinal.length}`,
      );
    }

    console.log(
      `[QQ][ctx-attach] route=${route} msgId=${msgIdText} media_urls=${attachMediaFinal.length} local_urls=${attachLocalFinal.length} asks_analysis=${asksForMediaAnalysis} manifest=${currentMsgManifest ? "hit" : "miss"}`,
    );

    const inboundHasVoice = mediaItemsTotal > 0 && /\[语音消息\]/.test(text);
    if (inboundHasVoice) {
      const voiceTranscript = await transcribeInboundVoiceOnce({
        workspaceRoot: accountWorkspaceRoot,
        localFileUrls: attachLocalFinal,
        route,
        msgId: msgIdText,
      });
      if (voiceTranscript?.text) {
        const voiceMeta = [
          `<voice_message source="qq_record">`,
          `transcript=${voiceTranscript.text}`,
          voiceTranscript.durationSec ? `duration_sec=${voiceTranscript.durationSec}` : "",
          voiceTranscript.language ? `language=${voiceTranscript.language}` : "",
          `</voice_message>`,
        ]
          .filter(Boolean)
          .join("\n");
        bodyWithReply = `${bodyWithReply}\n\n${voiceMeta}`;
      }
    }

    const ctxPayload = runtime.channel.reply.finalizeInboundContext({
      Provider: "qq",
      Channel: "qq",
      From: route,
      To: "qq:bot",
      Body: bodyWithReply,
      RawBody: text,
      BodyForAgent: bodyWithReply,
      BodyForCommands: cleanCQCodes(text),
      SenderId: String(userId),
      SenderName: event.sender?.nickname || "Unknown",
      ConversationLabel: conversationLabel,
      SessionKey: residentSessionKey,
      AccountId: normalizedAccountId,
      ChatType: isGroup ? "group" : isGuild ? "channel" : "direct",
      Timestamp: event.time * 1000,
      OriginatingChannel: "qq",
      OriginatingTo: route,
      CommandAuthorized: true,
      ...(attachMediaFinal.length > 0 && { MediaUrls: attachMediaFinal }),
      ...(attachLocalFinal.length > 0 && { QQInboundMediaLocalUrls: attachLocalFinal }),
      ...(replyMsgId && { ReplyToId: replyMsgId, ReplyToBody: replyToBody, ReplyToSender: replyToSender }),
    });

    await prepareInboundSessionPipeline({
      route,
      msgIdText,
      runtime,
      cfg,
      accountId: account.accountId,
      residentAgentId,
      residentSessionKey,
      ctxPayload,
      migrateLegacy: () => migrateLegacySessionIfNeeded(runtime, cfg, account.accountId, route, residentSessionKey, residentAgentId),
    });

    const taskKind = mediaItemsTotal > 0 ? "heavy_media" : "chat";
    const persistTaskState = createTaskStatePersister({
      conversationBaseDir: (r) => conversationBaseDir(account.accountId, r),
      route,
      msgIdText,
      taskKind,
      getDispatchId: () => dispatchId,
    });

    await persistTaskState("queued", { inboundSeq, mediaCount: mediaItemsTotal });

    const heavyByMedia = mediaItemsTotal > 0;
    const heavyByLongGen = cleanCQCodes(text || "").length >= 800;
    const shouldDispatchAsChildTask = heavyByMedia || heavyByLongGen;
    if (shouldDispatchAsChildTask) {
      const taskResult = await enqueueRouteTask({
        workspaceRoot: accountWorkspaceRoot,
        route,
        msgId: msgIdText,
        dispatchId: dispatchId || undefined,
        taskKind: heavyByMedia ? "heavy_media" : "heavy_long_generation",
        payloadSummary: cleanCQCodes(text || "").slice(0, 200),
        guardrails: {
          taskMaxRuntimeMs: Number((config as any).taskMaxRuntimeMs ?? 120000),
          taskMaxRetries: Number((config as any).taskMaxRetries ?? 1),
          taskMaxConcurrency: Number((config as any).taskMaxConcurrency ?? 1),
          taskIdempotencyEnabled: (config as any).taskIdempotencyEnabled !== false,
        },
        run: async (attempt) => {
          const inflightBegin = beginRouteInFlight({ route, msgId: msgIdText });
          dispatchId = inflightBegin.current.dispatchId;
          try {
            await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeDispatch", route);
            await bumpRouteUsage(accountWorkspaceRoot, route, "dispatch");
            console.log(`[QQ][task-unit] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} task_attempt=${attempt} stage=dispatch_start`);
            await persistTaskState("running", { dispatchId, inboundSeq, taskAttempt: attempt, childTask: true });
            const replyOptionsWithAbort = {
              ...replyOptions,
              abortSignal: inflightBegin.current.abortController.signal,
            } as typeof replyOptions;
            const startedAt = Date.now();
            await withTimeout(
              runtime.channel.reply.dispatchReplyFromConfig({ ctx: ctxPayload, cfg, dispatcher, replyOptions: replyOptionsWithAbort }),
              Number((config as any).taskMaxRuntimeMs ?? (config as any).replyRunTimeoutMs ?? 600000),
              "qq_dispatch_child_task",
            );
            const durationMs = Date.now() - startedAt;
            await persistTaskState("succeeded", { dispatchId, dispatchDurationMs: durationMs, taskAttempt: attempt, childTask: true });
            console.log(`[QQ][task-unit] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} task_attempt=${attempt} stage=dispatch_done duration_ms=${durationMs}`);
            return { resultSummary: `dispatch_done_${durationMs}ms` };
          } finally {
            if (dispatchId) clearRouteInFlight(route, dispatchId);
          }
        },
        onFailed: async (error, status) => {
          const reason = String((error as any)?.message || error || "child_task_failed");
          await persistTaskState(status === "timeout" ? "timeout" : "failed", {
            dispatchId,
            dropReason: reason,
            childTask: true,
          });
          console.warn(`[QQ][task-unit] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} status=${status} error=${reason}`);
          if (config.enableErrorNotify) {
            try {
              await deliver({ text: status === "timeout" ? "处理超时了，请稍后重试。" : "处理失败了，我稍后可以重试。" });
            } catch {}
          }
        },
      });
      console.log(`[QQ][task-unit] route=${route} msg_id=${msgIdText} task_key=${taskResult.taskKey} deduped=${taskResult.deduped}`);
      return;
    }

    await runInboundDispatchCycle({
      route,
      routeGen,
      msgIdText,
      inboundSeq,
      hasInboundMediaLike,
      mediaItemsTotal,
      text,
      userId,
      isGroup,
      isGuild,
      aggregateWindowMs,
      routePreemptOldRun,
      replyRunTimeoutMs,
      replyAbortOnTimeout,
      config,
      runtime,
      cfg,
      ctxPayload,
      dispatcher,
      replyOptions,
      accountId: account.accountId,
      accountWorkspaceRoot,
      residentAgentId,
      residentSessionKey,
      sleep,
      client,
      isRouteGenerationCurrent,
      deliver,
      persistTaskState,
      state: {
        getDispatchId: () => dispatchId,
        setDispatchId: (next) => {
          dispatchId = next;
        },
        getRouteHadDelivered: () => routeHadDelivered,
        setRouteHadDelivered: (value) => {
          routeHadDelivered = value;
        },
        getRouteHadMediaDelivered: () => routeHadMediaDelivered,
        setRouteHadMediaDelivered: (value) => {
          routeHadMediaDelivered = value;
        },
        getRouteHadFallbackEligibleDrop: () => routeHadFallbackEligibleDrop,
      },
      canSendFallbackNow,
      recordFallbackSent,
      sendFallbackAfterDispatchError: async ({ dispatchId: failedDispatchId, fallbackText }) => {
        const target = parseTarget(route);
        if (!target) return false;
        await deliveryManager.sendWithRetry(
          config,
          {
            accountId: account.accountId,
            route,
            targetKind: target.kind,
            action: "send_text",
            summary: fallbackText,
            msgId: msgIdText,
            dispatchId: failedDispatchId || "none",
            attemptId: `${failedDispatchId || "none"}:fallback-catch:${Date.now()}`,
            source: "chat",
          },
          async () => sendToParsedTarget(client, target, fallbackText),
        );
        await appendConversationLog(route, account.accountId, "out", { text: fallbackText, mediaCount: 0 });
        return true;
      },
    });
  } catch (err) {
    console.error("[QQ] Critical error in message handler:", err);
  }
}
