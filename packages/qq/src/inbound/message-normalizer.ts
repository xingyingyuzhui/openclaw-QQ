import type { OneBotMessage } from "../types.js";

export function cleanCQCodes(text: string | undefined): string {
  if (!text) return "";

  let result = text;
  const imageUrls: string[] = [];
  const imageRegex = /\[CQ:image,[^\]]*(?:url|file)=([^,\]]+)[^\]]*\]/g;
  let match;
  while ((match = imageRegex.exec(text)) !== null) {
    const val = match[1].replace(/&amp;/g, "&");
    if (val.startsWith("http")) imageUrls.push(val);
  }

  result = result.replace(/\[CQ:face,id=(\d+)\]/g, "[表情]");
  result = result.replace(/\[CQ:[^\]]+\]/g, (m) => (m.startsWith("[CQ:image") ? "[图片]" : ""));
  result = result.replace(/\s+/g, " ").trim();

  if (imageUrls.length > 0) {
    result = result ? `${result} [图片: ${imageUrls.join(", ")}]` : `[图片: ${imageUrls.join(", ")}]`;
  }
  return result;
}

export function getReplyMessageId(message: OneBotMessage | string | undefined, rawMessage?: string): string | null {
  if (message && typeof message !== "string") {
    for (const segment of message) {
      if (segment.type === "reply" && segment.data?.id) {
        const id = String(segment.data.id).trim();
        if (id && /^-?\d+$/.test(id)) return id;
      }
    }
  }
  if (rawMessage) {
    const match = rawMessage.match(/\[CQ:reply,id=(\d+)\]/);
    if (match) return match[1];
  }
  return null;
}
