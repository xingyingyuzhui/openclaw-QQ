import { cleanCQCodes } from "./message-normalizer.js";
import type { OneBotClient } from "../client.js";
import {
  collectInboundMediaCandidatesFromFields,
  normalizeInboundMediaSource,
  resolveFileMediaSource,
  resolveImageMediaSource,
  resolveRecordMediaSource,
  resolveVideoMediaSource,
  materializeInboundMediaDetailed,
} from "../media.js";
import { logInboundMediaTrace } from "../diagnostics/logger.js";
import type { InboundMediaRef, InboundResolveResult, MaterializeResult } from "../types/media.js";

function decodeCqValue(v: string): string {
  return String(v || "")
    .replace(/&#44;/g, ",")
    .replace(/&amp;/g, "&")
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]");
}

function parseCqParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(raw || "").split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeCqValue(part.slice(idx + 1).trim());
    if (key) out[key] = val;
  }
  return out;
}

export type ParsedInbound = {
  text: string;
  inboundRoute: string;
  routeGen: number;
  userId: number;
  groupId?: number;
  guildId?: string;
  channelId?: string;
  isGroup: boolean;
  isGuild: boolean;
  effectiveInboundMediaUrls: string[];
  materializedInboundMediaUrls: string[];
  mediaItemsTotal: number;
  mediaItemsMaterialized: number;
  mediaItemsUnresolved: number;
  unresolvedReasons: string[];
};

export async function parseInboundMessage(params: {
  event: any;
  client: OneBotClient;
  aggregateWindowMs: number;
  conversationBaseDir: (route: string) => string;
  nextRouteGeneration: (route: string) => number;
  pushRouteAggregation: (
    route: string,
    text: string,
    mediaUrls: string[],
    stats?: {
      mediaItemsTotal?: number;
      mediaItemsMaterialized?: number;
      mediaItemsUnresolved?: number;
      unresolvedReasons?: string[];
    },
  ) => number;
  isRouteGenerationCurrent: (route: string, generation: number) => boolean;
  getRouteAggregationSeq: (route: string) => number | null;
  finalizeRouteAggregation: (route: string) => {
    text: string;
    mediaUrls: string[];
    mediaItemsTotal: number;
    mediaItemsMaterialized: number;
    mediaItemsUnresolved: number;
    unresolvedReasons: string[];
  };
  getCachedMemberName: (groupId: string, userId: string) => string | null;
  setCachedMemberName: (groupId: string, userId: string, name: string) => void;
  sleep: (ms: number) => Promise<void>;
  inboundMediaResolvePrefer?: "napcat-first" | "direct-first";
  inboundMediaHttpTimeoutMs?: number;
  inboundMediaHttpRetries?: number;
  inboundMediaUseStream?: boolean;
  inboundMediaFallbackGetMsg?: boolean;
  inboundMediaMaxPerMessage?: number;
}): Promise<ParsedInbound | null> {
  const {
    event,
    client,
    aggregateWindowMs,
    conversationBaseDir,
    nextRouteGeneration,
    pushRouteAggregation,
    isRouteGenerationCurrent,
    getRouteAggregationSeq,
    finalizeRouteAggregation,
    getCachedMemberName,
    setCachedMemberName,
    sleep,
    inboundMediaResolvePrefer,
    inboundMediaHttpTimeoutMs,
    inboundMediaHttpRetries,
    inboundMediaUseStream,
    inboundMediaFallbackGetMsg,
    inboundMediaMaxPerMessage,
  } = params;

  const isGroup = event.message_type === "group";
  const isGuild = event.message_type === "guild";
  const userId = event.user_id;
  const groupId = event.group_id;
  const guildId = event.guild_id;
  const channelId = event.channel_id;
  const rawMessage = String(event.raw_message || event.message || "");
  const inboundRoute = isGroup ? `group:${groupId}` : isGuild ? `guild:${guildId}:${channelId}` : `user:${userId}`;
  const msgIdText = String(event.message_id || "");
  const maxMediaRefs = Math.max(1, Number(inboundMediaMaxPerMessage ?? 8));
  const useStream = inboundMediaUseStream !== false;

  let text = event.raw_message || "";
  const mediaRefs: InboundMediaRef[] = [];
  const pushMediaRef = (segmentType: InboundMediaRef["segmentType"], segmentIndex: number, data: any) => {
    if (mediaRefs.length >= maxMediaRefs) return;
    const normalizedData = (data && typeof data === "object") ? data : {};
    mediaRefs.push({
      route: inboundRoute,
      messageId: msgIdText || undefined,
      segmentType,
      segmentIndex,
      file: normalizedData?.file,
      file_id: normalizedData?.file_id,
      url: normalizedData?.url,
      path: normalizedData?.path || normalizedData?.file_path,
      name: normalizedData?.name,
      busid: normalizedData?.busid,
      data: normalizedData,
    });
  };

  const resolveInboundRef = async (ref: InboundMediaRef): Promise<InboundResolveResult> => {
    let resolvedSource = "";
    let resolveAction = "segment_fields";
    let resolveErrorCode = "";
    try {
      if (ref.segmentType === "image") {
        resolvedSource = await resolveImageMediaSource(client, ref.data || {}, { prefer: inboundMediaResolvePrefer, useStream });
        resolveAction = "get_image_chain";
      } else if (ref.segmentType === "video") {
        resolvedSource = await resolveVideoMediaSource(client, ref.data || {}, { prefer: inboundMediaResolvePrefer, useStream });
        resolveAction = "video_chain";
      } else if (ref.segmentType === "record") {
        resolvedSource = await resolveRecordMediaSource(client, ref.data || {}, { prefer: inboundMediaResolvePrefer, useStream });
        resolveAction = "get_record_chain";
      } else if (ref.segmentType === "file") {
        resolvedSource = await resolveFileMediaSource(client, ref.data || {}, isGroup, groupId, { prefer: inboundMediaResolvePrefer, useStream });
        resolveAction = isGroup ? "group_file_chain" : "private_file_chain";
      }
    } catch (err: any) {
      resolveErrorCode = "resolve_action_failed";
      console.warn(
        `[QQ][inbound-media] error_code=resolve_action_failed route=${inboundRoute} msgId=${msgIdText} segment_type=${ref.segmentType} action=${resolveAction} error=${err?.message || err}`,
      );
    }
    const directCandidates = collectInboundMediaCandidatesFromFields(ref.data || {});
    const allCandidates = Array.from(new Set([resolvedSource, ...directCandidates].map((it) => normalizeInboundMediaSource(it)).filter(Boolean)));
    return {
      ref,
      candidates: allCandidates,
      resolvedSource: resolvedSource || undefined,
      resolveAction,
      resolveResult: allCandidates.length > 0 ? "ok" : "failed",
      errorCode: allCandidates.length > 0 ? undefined : (resolveErrorCode || "resolve_failed"),
    };
  };

  if (Array.isArray(event.message)) {
    let resolvedText = "";
    for (let idx = 0; idx < event.message.length; idx++) {
      const seg = event.message[idx];
      const segAny = seg as any;
      if (segAny.type === "text") resolvedText += segAny.data?.text || "";
      else if (segAny.type === "at") {
        let name = segAny.data?.qq;
        if (name !== "all" && isGroup) {
          const cached = getCachedMemberName(String(groupId), String(name));
          if (cached) name = cached;
          else {
            try {
              const info = await (client as any).sendWithResponse("get_group_member_info", { group_id: groupId, user_id: name });
              name = info?.card || info?.nickname || name;
              setCachedMemberName(String(groupId), String(segAny.data.qq), name);
            } catch (err: any) {
              console.warn(
                `[QQ][inbound-media] error_code=group_member_lookup_failed route=${inboundRoute} msgId=${msgIdText} group=${groupId} user=${String(name)} error=${err?.message || err}`,
              );
            }
          }
        }
        resolvedText += ` @${name} `;
      } else if (segAny.type === "record") {
        pushMediaRef("record", idx, segAny.data || {});
        resolvedText += ` [语音消息]${segAny.data?.text ? `(${segAny.data.text})` : ""}`;
      } else if (segAny.type === "image") {
        pushMediaRef("image", idx, segAny.data || {});
        resolvedText += " [图片]";
      } else if (segAny.type === "video") {
        pushMediaRef("video", idx, segAny.data || {});
        resolvedText += " [视频消息]";
      } else if (segAny.type === "json") {
        resolvedText += " [卡片消息]";
      } else if (segAny.type === "forward" && segAny.data?.id) {
        try {
          const forwardData = await client.getForwardMsg(segAny.data.id);
          if (forwardData?.messages) {
            resolvedText += "\n[转发聊天记录]:";
            for (const m of forwardData.messages.slice(0, 10)) {
              resolvedText += `\n${m.sender?.nickname || m.user_id}: ${cleanCQCodes(m.content || m.raw_message)}`;
            }
          }
        } catch (err: any) {
          console.warn(
            `[QQ][inbound-media] error_code=resolve_action_failed route=${inboundRoute} msgId=${msgIdText} segment_type=forward action=get_forward_msg error=${err?.message || err}`,
          );
        }
      } else if (segAny.type === "file") {
        pushMediaRef("file", idx, segAny.data || {});
        resolvedText += ` [文件: ${segAny.data?.file || segAny.data?.name || "未命名"}]`;
      }
    }
    if (resolvedText) text = resolvedText;
  } else {
    const raw = rawMessage;
    const cqRegex = /\[CQ:([a-zA-Z0-9_]+),([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    let segmentIndex = 0;
    while ((m = cqRegex.exec(raw)) !== null) {
      segmentIndex += 1;
      const segType = String(m[1] || "").toLowerCase();
      if (!["image", "video", "record", "file"].includes(segType)) continue;
      pushMediaRef(segType as "image" | "video" | "record" | "file", segmentIndex, parseCqParams(m[2] || ""));
    }
  }

  for (const ref of mediaRefs) {
    logInboundMediaTrace({
      route: inboundRoute,
      msg_id: msgIdText,
      segment_type: ref.segmentType,
      resolve_stage: "collect",
      resolve_action: "segment_collect",
      resolve_result: "ok",
    });
  }

  let resolveResults: InboundResolveResult[] = [];
  for (const ref of mediaRefs) {
    const result = await resolveInboundRef(ref);
    resolveResults.push(result);
    logInboundMediaTrace({
      route: inboundRoute,
      msg_id: msgIdText,
      segment_type: ref.segmentType,
      resolve_stage: "resolve",
      resolve_action: result.resolveAction,
      resolve_result: result.resolveResult,
      error: result.errorCode,
    });
  }

  const unresolvedIndexes = resolveResults
    .map((it, idx) => ({ it, idx }))
    .filter((it) => {
      if (it.it.resolveResult !== "ok") return true;
      if (!it.it.candidates.length) return true;
      return it.it.candidates.every((src) => /^file:\/\//i.test(String(src || "")));
    })
    .map((it) => it.idx);

  if ((inboundMediaFallbackGetMsg ?? true) && unresolvedIndexes.length > 0 && event.message_id) {
    try {
      console.warn(
        `[QQ][inbound-media] fallback_get_msg route=${inboundRoute} msgId=${String(event.message_id)} unresolved=${unresolvedIndexes.length}`,
      );
      const fullMsg = await client.getMsg(event.message_id);
      const fullSegments = Array.isArray(fullMsg?.message) ? fullMsg.message : [];
      const pools: Record<InboundMediaRef["segmentType"], any[]> = { image: [], video: [], record: [], file: [] };
      for (const seg of fullSegments) {
        const segAny = seg as any;
        if (segAny && (segAny.type === "image" || segAny.type === "video" || segAny.type === "record" || segAny.type === "file")) {
          pools[segAny.type].push(segAny.data || {});
        }
      }
      for (const idx of unresolvedIndexes) {
        const current = resolveResults[idx];
        const retryData = pools[current.ref.segmentType].shift();
        if (!retryData) continue;
        const retryRef: InboundMediaRef = { ...current.ref, data: retryData };
        const retried = await resolveInboundRef(retryRef);
        logInboundMediaTrace({
          route: inboundRoute,
          msg_id: msgIdText,
          segment_type: retryRef.segmentType,
          resolve_stage: "fallback_get_msg",
          resolve_action: retried.resolveAction,
          resolve_result: retried.resolveResult,
          error: retried.errorCode,
        });
        if (retried.resolveResult === "ok") {
          resolveResults[idx] = retried;
        }
      }
    } catch (err: any) {
      console.warn(
        `[QQ][inbound-media] error_code=resolve_action_failed route=${inboundRoute} msgId=${String(event.message_id)} segment_type=mixed action=get_msg error=${err?.message || err}`,
      );
    }
  }

  const sourceCandidates = Array.from(new Set(resolveResults.flatMap((it) => it.candidates).filter(Boolean)));
  const sourceNameHints: Record<string, string> = {};
  for (const rr of resolveResults) {
    const hint = String(rr.ref.name || rr.ref.file || rr.ref.data?.name || rr.ref.data?.file || "").trim();
    if (!hint) continue;
    for (const c of rr.candidates || []) {
      const key = String(c || "").trim();
      if (!key) continue;
      if (!sourceNameHints[key]) sourceNameHints[key] = hint;
    }
  }
  if (mediaRefs.length > 0 && sourceCandidates.length === 0) {
    console.warn(
      `[QQ][inbound-media] unresolved route=${inboundRoute} msgId=${msgIdText} media_segments=${mediaRefs.length} unresolved=${resolveResults.filter((it) => it.resolveResult !== "ok").length} raw=${rawMessage.slice(0, 180).replace(/\s+/g, " ")}`,
    );
  }
  const routeGen = nextRouteGeneration(inboundRoute);

  const materializeResults = await materializeInboundMediaDetailed(
    conversationBaseDir,
    inboundRoute,
    sourceCandidates,
    {
      inboundMediaHttpRetries,
      inboundMediaHttpTimeoutMs,
      inboundNameHints: sourceNameHints,
    },
  );
  let materializedInboundMediaUrls = materializeResults.filter((it) => it.materialized && it.outputUrl).map((it) => String(it.outputUrl));
  const bySource = new Map<string, MaterializeResult>();
  for (const r of materializeResults) {
    const key = String(r.url || "");
    if (!key) continue;
    const prev = bySource.get(key);
    if (!prev || (!prev.materialized && r.materialized)) bySource.set(key, r);
  }

  let mediaItemsTotal = mediaRefs.length;
  let mediaItemsMaterialized = 0;
  const unresolvedReasonsList: string[] = [];
  for (const rr of resolveResults) {
    let materialized = false;
    let unresolvedCode = rr.errorCode || "resolve_failed";
    let status: number | undefined;
    let retries: number | undefined;
    let detailErr: string | undefined;
    for (const src of rr.candidates) {
      const result = bySource.get(src);
      if (!result) continue;
      status = result.httpStatus;
      retries = result.retryCount;
      detailErr = result.error;
      if (result.materialized && result.outputUrl) {
        materialized = true;
        unresolvedCode = "";
        break;
      }
      if (result.errorCode) unresolvedCode = result.errorCode;
    }
    if (materialized) {
      mediaItemsMaterialized += 1;
    } else {
      unresolvedReasonsList.push(unresolvedCode || "materialize_failed");
    }
    logInboundMediaTrace({
      route: inboundRoute,
      msg_id: msgIdText,
      segment_type: rr.ref.segmentType,
      resolve_stage: "materialize",
      resolve_action: "materialize_inbound",
      resolve_result: materialized ? "ok" : "failed",
      materialize_result: materialized ? "materialized" : "unresolved",
      materialize_error_code: materialized ? undefined : unresolvedCode || "materialize_failed",
      http_status: status,
      retry_count: retries,
      error: detailErr,
    });
  }
  let mediaItemsUnresolved = Math.max(0, mediaItemsTotal - mediaItemsMaterialized);
  let unresolvedReasons = Array.from(new Set(unresolvedReasonsList.filter(Boolean)));
  let effectiveInboundMediaUrls = materializedInboundMediaUrls.length > 0
    ? materializedInboundMediaUrls
    : sourceCandidates;

  if (aggregateWindowMs > 0) {
    const mySeq = pushRouteAggregation(inboundRoute, text, effectiveInboundMediaUrls, {
      mediaItemsTotal,
      mediaItemsMaterialized,
      mediaItemsUnresolved,
      unresolvedReasons,
    });
    await sleep(aggregateWindowMs);
    if (!isRouteGenerationCurrent(inboundRoute, routeGen)) return null;
    const currentSeq = getRouteAggregationSeq(inboundRoute);
    if (!currentSeq || currentSeq !== mySeq) return null;
    const merged = finalizeRouteAggregation(inboundRoute);
    if (merged.text) text = merged.text;
    effectiveInboundMediaUrls = merged.mediaUrls;
    mediaItemsTotal = merged.mediaItemsTotal;
    mediaItemsMaterialized = merged.mediaItemsMaterialized;
    mediaItemsUnresolved = merged.mediaItemsUnresolved;
    unresolvedReasons = merged.unresolvedReasons;
    materializedInboundMediaUrls = effectiveInboundMediaUrls.filter((it) => /^file:\/\//i.test(String(it || "")));
  }

  return {
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
  };
}

export async function buildGroupHistoryContext(params: {
  isGroup: boolean;
  historyLimit: number;
  groupId?: number;
  client: OneBotClient;
}): Promise<string> {
  const { isGroup, historyLimit, groupId, client } = params;
  if (!isGroup || historyLimit === 0 || !groupId) return "";
  try {
    const history = await client.getGroupMsgHistory(groupId);
    if (!history?.messages) return "";
    const limit = historyLimit || 5;
    return history.messages
      .slice(-(limit + 1), -1)
      .map((m: any) => `${m.sender?.nickname || m.user_id}: ${cleanCQCodes(m.raw_message || "")}`)
      .join("\n");
  } catch {
    return "";
  }
}

export function isTriggeredByMentionOrKeyword(params: {
  text: string;
  isGroup: boolean;
  isGuild: boolean;
  keywordTriggers?: string[];
}): boolean {
  const { text, isGroup, keywordTriggers } = params;
  let isTriggered = !isGroup || text.includes("[动作] 用户戳了你一下");
  if (!isTriggered && keywordTriggers) {
    for (const kw of keywordTriggers) {
      if (text.includes(kw)) {
        isTriggered = true;
        break;
      }
    }
  }
  return isTriggered;
}

export function passesRequireMention(params: {
  event: any;
  requireMention: boolean;
  isGroup: boolean;
  isGuild: boolean;
  isTriggered: boolean;
  selfId?: number | null;
  repliedMsg?: any;
}): boolean {
  const { event, requireMention, isGroup, isGuild, isTriggered, selfId, repliedMsg } = params;
  const checkMention = isGroup || isGuild;
  if (!checkMention || !requireMention || isTriggered) return true;
  const effectiveSelfId = selfId ?? event.self_id;
  if (!effectiveSelfId) return false;
  let mentioned = false;
  if (Array.isArray(event.message)) {
    for (const s of event.message) {
      if (s.type === "at" && (String(s.data?.qq) === String(effectiveSelfId) || s.data?.qq === "all")) {
        mentioned = true;
        break;
      }
    }
  } else if (String(event.raw_message || "").includes(`[CQ:at,qq=${effectiveSelfId}]`)) {
    mentioned = true;
  }
  if (!mentioned && repliedMsg?.sender?.user_id === effectiveSelfId) mentioned = true;
  return mentioned;
}
