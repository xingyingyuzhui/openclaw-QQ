import path from "node:path";
import { pathToFileURL } from "node:url";
import type { QQConfig } from "../config.js";
import type { OneBotClient } from "../client.js";
import type { MediaItem, MediaKind } from "../types/media.js";
import type { OneBotMessage } from "../types.js";
import {
  isAudioFile,
  isBase64Like,
  isDataUriLike,
  isHttpLike,
  isImageFile,
  isVideoFile,
  persistOutboundLocalMedia,
  resolveMediaCandidates,
  maybeCleanupOutboundSource,
  buildMediaDedupKey,
} from "../media.js";
import { enforceMediaPathPolicy } from "../media/path-policy.js";
import { uploadFileStreamIfAvailable } from "../media/stream-adapter.js";
import { logMediaTrace } from "../diagnostics/logger.js";

function inferKind(path: string): MediaKind {
  if (isImageFile(path)) return "image";
  if (isAudioFile(path)) return "record";
  if (isVideoFile(path)) return "video";
  return "file";
}

function toSegments(kind: MediaKind, candidateUrl: string, fileName?: string): OneBotMessage {
  if (kind === "image") return [{ type: "image", data: { file: candidateUrl } }];
  if (kind === "record") return [{ type: "record", data: { file: candidateUrl } } as any];
  if (kind === "video") return [{ type: "video", data: { file: candidateUrl } } as any];
  return [{ type: "file", data: { file: candidateUrl, name: fileName || "file" } } as any];
}

type PreparedCandidate = {
  url: string;
  candidateType: "stream" | "http" | "base64" | "data" | "unknown";
  fallbackStage: "stream" | "http" | "http-base64" | "local-base64";
};

function classifyCandidateType(url: string): PreparedCandidate["candidateType"] {
  if (url.startsWith("base64://")) return "base64";
  if (url.startsWith("http")) return "http";
  if (url.startsWith("data:")) return "data";
  if (url.startsWith("stream://")) return "stream";
  return "unknown";
}

function classifyFallbackStage(candidateUrl: string, persistedPath: string): PreparedCandidate["fallbackStage"] {
  if (candidateUrl.startsWith("stream://")) return "stream";
  if (candidateUrl.startsWith("http")) return "http";
  if (candidateUrl.startsWith("base64://") || candidateUrl.startsWith("data:")) {
    return isHttpLike(persistedPath) ? "http-base64" : "local-base64";
  }
  return "local-base64";
}

export async function sendMediaItems(params: {
  items: MediaItem[];
  route: string;
  workspaceRoot: string;
  config: QQConfig;
  conversationBaseDir: (route: string) => string;
  enqueue: (fn: () => Promise<void>) => Promise<void>;
  sendSegments: (segments: OneBotMessage, mediaDedupKey?: string) => Promise<void>;
  checkBeforeOutboundMedia: () => Promise<void>;
  checkQuota: (kind: "sendMedia" | "sendVoice") => Promise<void>;
  canSendRecord: () => Promise<boolean>;
  canSendImage?: () => Promise<boolean>;
  consumeImageQuota: () => Promise<void>;
  onSent: (item: MediaItem, persistedPath: string, kind: MediaKind) => Promise<void>;
  streamClient?: OneBotClient;
}) {
  const {
    items,
    route,
    workspaceRoot,
    config,
    conversationBaseDir,
    enqueue,
    sendSegments,
    checkBeforeOutboundMedia,
    checkQuota,
    canSendRecord,
    canSendImage,
    consumeImageQuota,
    onSent,
    streamClient,
  } = params;

  for (const item of items) {
    const mediaPath = item.source;
    const kind = item.kindHint || inferKind(mediaPath);

    const persistedPath = await persistOutboundLocalMedia(workspaceRoot, conversationBaseDir, route, mediaPath, item.name);

    if (!isHttpLike(persistedPath) && !isBase64Like(persistedPath) && !isDataUriLike(persistedPath)) {
      const policy = await enforceMediaPathPolicy(persistedPath, workspaceRoot, config);
      if (!policy.allowed) {
        logMediaTrace({ route, media_source: mediaPath, media_kind: kind, deny_reason: policy.denyReason, resolved_realpath: policy.realPath });
        throw new Error(`MEDIA path rejected: ${mediaPath} (${policy.denyReason || "unknown"})`);
      }
      logMediaTrace({ route, media_source: mediaPath, media_kind: kind, resolved_realpath: policy.realPath, fallback_stage: "local-base64" });
    }

    let streamCandidate: string | null = null;
    if (streamClient && config.streamTransportEnabled !== false && !isHttpLike(persistedPath) && !isBase64Like(persistedPath) && !isDataUriLike(persistedPath)) {
      streamCandidate = await uploadFileStreamIfAvailable(streamClient, persistedPath, config);
      if (streamCandidate) {
        logMediaTrace({ route, media_source: mediaPath, media_kind: kind, candidate_type: "stream", fallback_stage: "stream" });
      }
    }

    const legacyCandidates = await resolveMediaCandidates(
      workspaceRoot,
      persistedPath,
      config,
      kind === "record" ? "record" : kind === "image" ? "image" : kind === "video" ? "video" : "file",
    );
    const legacyPrepared: PreparedCandidate[] = legacyCandidates
      .map((url) => String(url || "").trim())
      .filter(Boolean)
      .map((url) => ({
        url,
        candidateType: classifyCandidateType(url),
        fallbackStage: classifyFallbackStage(url, persistedPath),
      }));
    const streamPrepared = streamCandidate
      ? [{
          url: streamCandidate,
          candidateType: "stream" as const,
          fallbackStage: "stream" as const,
        }]
      : [];
    const preferLegacy = config.streamTransportPrefer === "legacy-first";
    const mediaCandidates: PreparedCandidate[] = preferLegacy
      ? [...legacyPrepared, ...streamPrepared]
      : [...streamPrepared, ...legacyPrepared];

    const mediaDedupKey = await buildMediaDedupKey(route, persistedPath, kind === "record" ? "audio" : kind);

    await enqueue(async () => {
      await checkBeforeOutboundMedia();

      if (kind === "record") {
        await checkQuota("sendVoice");
        const can = await canSendRecord();
        if (!can) throw new Error("NapCat reported can_send_record=no");
      } else {
        await checkQuota("sendMedia");
        if (kind === "image") {
          const can = await canSendImage?.().catch(() => true);
          if (can === false) throw new Error("NapCat reported can_send_image=no");
          await consumeImageQuota();
        }
      }

      let sent = false;
      let lastErr: any = null;
      for (const candidate of mediaCandidates) {
        const candidateUrl = candidate.url;
        if (kind === "record" && (!candidateUrl || candidateUrl === "base64://")) continue;
        const isLocalPathCandidate = !isHttpLike(candidateUrl) && !isBase64Like(candidateUrl) && !isDataUriLike(candidateUrl);
        const allowLocalPathForFile = kind === "file" && isLocalPathCandidate;
        if (candidate.candidateType !== "stream" && !isHttpLike(candidateUrl) && !isBase64Like(candidateUrl) && !isDataUriLike(candidateUrl) && !allowLocalPathForFile) continue;

        const derivedFileName = item.name || path.basename(String(persistedPath || mediaPath || "file")) || "file";
        const sendUrl = allowLocalPathForFile
          ? (/^file:\/\//i.test(candidateUrl) ? candidateUrl : pathToFileURL(candidateUrl).toString())
          : candidateUrl;

        try {
          await sendSegments(toSegments(kind, sendUrl, derivedFileName), mediaDedupKey);
          logMediaTrace({
            route,
            media_source: mediaPath,
            media_kind: kind,
            candidate_type: candidate.candidateType,
            fallback_stage: candidate.fallbackStage,
          });
          sent = true;
          break;
        } catch (e: any) {
          lastErr = e;
          logMediaTrace({
            route,
            media_source: mediaPath,
            media_kind: kind,
            candidate_type: candidate.candidateType,
            fallback_stage: candidate.fallbackStage,
            error: e?.message || String(e),
          });
        }
      }

      if (!sent) throw new Error(`all media candidates failed for ${mediaPath}: ${lastErr?.message || lastErr || "unknown"}`);
      await onSent(item, persistedPath, kind);
      await maybeCleanupOutboundSource(workspaceRoot, mediaPath, persistedPath);
    });
  }
}
