import type { OneBotMessage } from "../types.js";
import type { QQConfig } from "../config.js";

export async function sendTextChunks(params: {
  chunks: string[];
  targetKind: "user" | "group" | "guild";
  userId: number;
  enqueue: (fn: () => Promise<void>) => Promise<void>;
  sendTextChunk: (chunk: string) => Promise<boolean | void>;
  onChunkSent: (chunk: string) => Promise<void>;
}) {
  const { chunks, targetKind, userId, enqueue, sendTextChunk, onChunkSent } = params;
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (targetKind === "group" && i === 0) chunk = `[CQ:at,qq=${userId}] ${chunk}`;
    await enqueue(async () => {
      const sent = await sendTextChunk(chunk);
      if (sent !== false) {
        await onChunkSent(chunk);
      }
    });
  }
}

export function buildTextMessage(chunk: string, replyId?: string): OneBotMessage | string {
  if (!replyId) return chunk;
  return [{ type: "reply", data: { id: replyId } }, { type: "text", data: { text: chunk } }];
}
