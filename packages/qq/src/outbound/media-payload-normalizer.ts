import type { QQConfig } from "../config.js";
import type { MediaItem, MediaKind } from "../types/media.js";
import type { NormalizedReplyPayload, QQReplyPayload } from "../types/reply.js";
import { sanitizeOutboundText } from "../diagnostics/logger.js";

function inferKind(source: string): MediaKind {
  const l = String(source || "").toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(l)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac|flac|amr|silk)$/.test(l)) return "record";
  if (/\.(mp4|mov|m4v|webm|mkv|avi)$/.test(l)) return "video";
  return "file";
}

export function normalizeReplyPayload(
  payload: QQReplyPayload,
  config: QQConfig,
  opts?: { splitSendRequested?: boolean; maxMessageLength?: number },
): NormalizedReplyPayload {
  const splitSendRequested = Boolean(opts?.splitSendRequested);
  const maxMessageLength = Math.max(1, Number(opts?.maxMessageLength ?? 4000));

  const directMediaUrls = [
    ...(typeof payload?.mediaUrl === "string" ? [payload.mediaUrl] : []),
    ...(Array.isArray(payload?.mediaUrls) ? payload.mediaUrls : []),
  ].map((v) => String(v || "").trim()).filter(Boolean);

  const fileMedia = Array.isArray(payload?.files)
    ? payload.files
        .filter((f) => f && typeof f.url === "string" && f.url.trim())
        .map((f) => ({ source: String(f.url).trim(), name: f.name ? String(f.name) : undefined }))
    : [];

  let text = typeof payload?.text === "string" ? payload.text : "";
  if (config.formatMarkdown) {
    text = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`(.*?)`/g, "$1")
      .replace(/#+\s+(.*)/g, "$1");
  }
  if (config.antiRiskMode) text = text.replace(/(https?:\/\/)/gi, "$1 ");

  const inlineMedia = [...text.matchAll(/^\s*MEDIA:\s*(.+)\s*$/gim)].map((m) => m[1].trim()).filter(Boolean);
  text = text.replace(/^\s*MEDIA:\s*.+\s*$/gim, "").trim();
  text = sanitizeOutboundText(text);

  const mediaItems: MediaItem[] = [
    ...Array.from(new Set([...directMediaUrls, ...inlineMedia])).map((source) => ({ source, kindHint: inferKind(source) })),
    ...fileMedia.map((f) => ({ source: f.source, name: f.name, kindHint: inferKind(f.source) })),
  ];

  const textChunks: string[] = [];
  if (text) {
    if (splitSendRequested) {
      const lineParts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      if (lineParts.length >= 2 && lineParts.length <= 12) {
        textChunks.push(...lineParts);
      }
    }
    if (textChunks.length === 0) {
      for (let i = 0; i < text.length; i += maxMessageLength) {
        textChunks.push(text.slice(i, i + maxMessageLength));
      }
    }
  }

  return { textChunks, mediaItems };
}
