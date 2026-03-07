import type { OneBotClient } from "./client.js";
import type { OneBotMessage } from "./types.js";
import { resolveInboundMediaByActionSequence, type InboundMediaAction } from "./services/inbound-media-service.js";
import {
  normalizeInboundMediaSource,
} from "./media/common.js";
export { materializeInboundMedia, materializeInboundMediaDetailed } from "./media/inbound-materializer.js";
export {
  buildMediaDedupKey,
  persistOutboundLocalMedia,
  maybeCleanupOutboundSource,
  resolveMediaCandidates,
} from "./media/outbound-storage.js";
export {
  normalizeInboundMediaSource,
  isImageFile,
  isAudioFile,
  isVideoFile,
  isHttpLike,
  isBase64Like,
  isDataUriLike,
} from "./media/common.js";

export function extractImageUrls(message: OneBotMessage | string | undefined, maxImages = 3): string[] {
  const urls: string[] = [];
  if (Array.isArray(message)) {
    for (const segment of message) {
      if (segment.type === "image") {
        const url = segment.data?.url || (typeof segment.data?.file === "string" && (segment.data.file.startsWith("http") || segment.data.file.startsWith("base64://")) ? segment.data.file : undefined);
        if (url) {
          urls.push(url);
          if (urls.length >= maxImages) break;
        }
      }
    }
  } else if (typeof message === "string") {
    const imageRegex = /\[CQ:image,[^\]]*(?:url|file)=([^,\]]+)[^\]]*\]/g;
    let match;
    while ((match = imageRegex.exec(message)) !== null) {
      const val = match[1].replace(/&amp;/g, "&");
      if (val.startsWith("http") || val.startsWith("base64://")) {
        urls.push(val);
        if (urls.length >= maxImages) break;
      }
    }
  }
  return urls;
}

function pickMediaLocationFromApiResult(result: any): string {
  const d = result?.data ?? result ?? {};
  const candidates = [d?.url, d?.download_url, d?.downloadUrl, d?.src, d?.file, d?.path, d?.file_path, d?.local_path, d?.temp_file];
  for (const c of candidates) {
    const normalized = normalizeInboundMediaSource(c);
    if (normalized) return normalized;
  }
  const b64Candidates = [d?.base64, d?.b64, d?.file_data, d?.data];
  for (const c of b64Candidates) {
    const raw = String(c || "").trim();
    if (!raw) continue;
    if (/^base64:\/\//i.test(raw)) return raw;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length > 32) return `base64://${raw}`;
  }
  return "";
}

type InboundResolveOptions = {
  prefer?: "napcat-first" | "direct-first";
  useStream?: boolean;
  route?: string;
  msgId?: string;
};

export function collectInboundMediaCandidatesFromFields(segData: any): string[] {
  const direct = [
    segData?.url,
    segData?.src,
    segData?.download_url,
    segData?.downloadUrl,
    segData?.file,
    segData?.path,
    segData?.file_path,
    segData?.local_path,
    segData?.temp_file,
  ];
  return direct.map((it) => normalizeInboundMediaSource(it)).filter(Boolean);
}

export async function resolveRecordMediaSource(client: OneBotClient, segData: any, opts?: InboundResolveOptions): Promise<string> {
  const directResolved = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  const fileArg = segData?.file || segData?.file_id || segData?.id;
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];
  if (fileArg) {
    const attempts: Array<{ action: InboundMediaAction; params: any }> = [
      { action: "get_file", params: { file: fileArg } },
      { action: "get_file", params: { file_id: fileArg } },
    ];
    if (useStream) attempts.push({ action: "download_file_record_stream", params: { file: fileArg } });
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "get_record", params: { file: fileArg, out_format: "amr" } });
    attempts.push({ action: "get_record", params: { file_id: fileArg, out_format: "amr" } });
    const resolved = await resolveInboundMediaByActionSequence(client, attempts, pickMediaLocationFromApiResult, { route: opts?.route, msgId: opts?.msgId });
    if (resolved) return resolved;
  }
  return directResolved[0] || "";
}

export async function resolveImageMediaSource(client: OneBotClient, segData: any, opts?: InboundResolveOptions): Promise<string> {
  const fileArg = segData?.file_id || segData?.id || segData?.fid || segData?.file;
  const direct = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  const directResolved = direct.filter(Boolean);
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];

  if (fileArg) {
    const attempts: Array<{ action: InboundMediaAction; params: any }> = [
      { action: "get_image", params: { file: fileArg } },
      { action: "get_image", params: { file_id: fileArg } },
      { action: "get_file", params: { file: fileArg } },
      { action: "get_file", params: { file_id: fileArg } },
    ];
    if (useStream) attempts.push({ action: "download_file_image_stream", params: { file: fileArg } });
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file_id: fileArg } });
    const resolved = await resolveInboundMediaByActionSequence(client, attempts, pickMediaLocationFromApiResult, { route: opts?.route, msgId: opts?.msgId });
    if (resolved) return resolved;
  }

  return directResolved[0] || "";
}

export async function resolveVideoMediaSource(client: OneBotClient, segData: any, opts?: InboundResolveOptions): Promise<string> {
  const fileArg = segData?.file_id || segData?.id || segData?.fid || segData?.file;
  const directResolved = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];

  if (fileArg) {
    const attempts: Array<{ action: InboundMediaAction; params: any }> = [
      { action: "get_file", params: { file: fileArg } },
      { action: "get_file", params: { file_id: fileArg } },
    ];
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file_id: fileArg } });
    const resolved = await resolveInboundMediaByActionSequence(client, attempts, pickMediaLocationFromApiResult, { route: opts?.route, msgId: opts?.msgId });
    if (resolved) return resolved;
  }

  return directResolved[0] || "";
}

export async function resolveFileMediaSource(client: OneBotClient, segData: any, isGroup: boolean, groupId?: number, opts?: InboundResolveOptions): Promise<string> {
  const directResolved = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];
  const attempts: Array<{ action: InboundMediaAction; params: any }> = [];
  const fileArg = segData?.file_id || segData?.id || segData?.fid || segData?.file;
  if (isGroup && groupId) {
    if (segData?.file_id || segData?.id) {
      attempts.push({ action: "get_group_file_url", params: { group_id: groupId, file_id: segData?.file_id || segData?.id, busid: segData?.busid } });
    }
  }
  if (fileArg) {
    if (!isGroup) {
      attempts.push({ action: "get_private_file_url", params: { file_id: fileArg } });
      attempts.push({ action: "get_private_file_url", params: { file: fileArg } });
    }
    attempts.push({ action: "get_file", params: { file_id: fileArg } });
    attempts.push({ action: "get_file", params: { file: fileArg } });
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file_id: fileArg } });
    attempts.push({ action: "download_file", params: { file: fileArg } });
  }
  const resolved = await resolveInboundMediaByActionSequence(client, attempts, pickMediaLocationFromApiResult, { route: opts?.route, msgId: opts?.msgId });
  if (resolved) return resolved;
  return directResolved[0] || "";
}
