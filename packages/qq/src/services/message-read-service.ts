import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function markGroupMessageAsRead(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("mark_group_msg_as_read", { group_id: groupId }, ctx);
}

export async function markPrivateMessageAsRead(
  client: OneBotClient,
  userId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("mark_private_msg_as_read", { user_id: userId }, ctx);
}
