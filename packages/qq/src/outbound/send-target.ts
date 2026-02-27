import type { OneBotClient } from "../client.js";
import type { ParsedTarget } from "../routing.js";
import type { OneBotMessage } from "../types.js";

export function summarizeText(text?: string, limit = 180): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > limit ? `${t.slice(0, limit)}…` : t;
}

export function logSendAttempt(meta: {
  accountId: string;
  route: string;
  targetKind: ParsedTarget["kind"];
  action: string;
  retryIndex: number;
  summary?: string;
  msgId?: string;
  dispatchId?: string;
  attemptId?: string;
  source?: "chat" | "automation";
}) {
  console.log(
    `[QQ][send] account=${meta.accountId} route=${meta.route} msg_id=${meta.msgId || ""} dispatch_id=${meta.dispatchId || ""} attempt_id=${meta.attemptId || ""} source=${meta.source || "chat"} target=${meta.targetKind} action=${meta.action} retry=${meta.retryIndex} summary=${summarizeText(meta.summary, 80)}`,
  );
}

export async function sendToParsedTarget(client: OneBotClient, target: ParsedTarget, message: OneBotMessage | string) {
  if (target.kind === "group") {
    return { action: "send_group_msg", response: await client.sendGroupMsgWithResponse(target.groupId, message) };
  }
  if (target.kind === "guild") {
    return {
      action: "send_guild_channel_msg",
      response: await client.sendGuildChannelMsgWithResponse(target.guildId, target.channelId, message),
    };
  }
  return { action: "send_private_msg", response: await client.sendPrivateMsgWithResponse(target.userId, message) };
}

export function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = text;
  while (current.length > 0) {
    chunks.push(current.slice(0, limit));
    current = current.slice(limit);
  }
  return chunks;
}
