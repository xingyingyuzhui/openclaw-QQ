import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function sendForwardMessage(
  client: OneBotClient,
  messageType: "private" | "group",
  id: number | string,
  messages: unknown[],
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_forward_msg", {
    message_type: messageType,
    user_id: messageType === "private" ? id : undefined,
    group_id: messageType === "group" ? id : undefined,
    messages,
  }, ctx);
}

export async function sendGroupForwardMessage(
  client: OneBotClient,
  groupId: number | string,
  messages: unknown[],
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_group_forward_msg", { group_id: groupId, messages }, ctx);
}

export async function sendPrivateForwardMessage(
  client: OneBotClient,
  userId: number | string,
  messages: unknown[],
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_private_forward_msg", { user_id: userId, messages }, ctx);
}
