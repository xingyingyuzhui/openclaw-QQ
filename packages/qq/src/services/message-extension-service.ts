import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function markMessageAsRead(
  client: OneBotClient,
  messageId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("mark_msg_as_read", { message_id: messageId }, ctx);
}

export async function sendLike(
  client: OneBotClient,
  userId: number | string,
  times = 1,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_like", { user_id: userId, times }, ctx);
}

export async function setEssenceMessage(
  client: OneBotClient,
  messageId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_essence_msg", { message_id: messageId }, ctx);
}

export async function deleteEssenceMessage(
  client: OneBotClient,
  messageId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("delete_essence_msg", { message_id: messageId }, ctx);
}

export async function getEssenceMessageList(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_essence_msg_list", { group_id: groupId }, ctx);
}
